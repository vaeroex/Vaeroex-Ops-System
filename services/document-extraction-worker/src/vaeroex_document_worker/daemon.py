"""Single-concurrency Cloud Run worker-pool process."""

from __future__ import annotations

import asyncio
import signal
from contextlib import suppress

from . import WORKER_RUNTIME_VERSION
from .broker import BrokerClient, BrokerFailure
from .config import WorkerConfig
from .health import WorkerHealthState, start_health_server
from .resources import assert_runtime_resources
from .runner import run_one_job
from .telemetry import emit_operational_event
from .temporary import scavenge_stale_worker_directories


async def _verify_broker(config: WorkerConfig) -> None:
    async with BrokerClient(config) as broker:
        response = await broker.post({"operation": "health"})
    if (
        response.get("ok") is not True
        or response.get("brokerEnabled") is not True
        or response.get("providerExecutionEnabled") is not config.provider_execution_enabled
        or response.get("environment") != config.runtime_environment
    ):
        raise BrokerFailure("broker_health_contract_rejected")


async def run_worker(config: WorkerConfig, *, max_cycles: int | None = None) -> None:
    assert_runtime_resources()
    removed = scavenge_stale_worker_directories()
    health = WorkerHealthState(config.deployment_id)
    server = start_health_server(health, config.health_port)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signal_number in (signal.SIGTERM, signal.SIGINT):
        with suppress(NotImplementedError):
            loop.add_signal_handler(signal_number, stop.set)

    emit_operational_event(
        "worker_starting",
        deployment_version=config.deployment_id,
        runtime_version=WORKER_RUNTIME_VERSION,
        cleanup_result="stale_removed" if removed else "clean",
    )
    try:
        await _verify_broker(config)
        health.success()
        health.ready()
        emit_operational_event(
            "worker_ready",
            deployment_version=config.deployment_id,
            runtime_version=WORKER_RUNTIME_VERSION,
            broker_connectivity="healthy",
        )
        if config.authentication_qualification_enabled:
            emit_operational_event(
                "broker_auth_qualification_passed",
                deployment_version=config.deployment_id,
                runtime_version=WORKER_RUNTIME_VERSION,
                broker_connectivity="healthy",
                provider_calls=0,
            )
            if max_cycles is not None:
                return
            await stop.wait()
            return
        backoff = config.idle_poll_seconds
        completed_cycles = 0
        while not stop.is_set():
            health.progress(busy=True)
            try:
                result = await run_one_job(
                    config,
                    progress_callback=lambda _stage: health.progress(busy=True),
                )
                health.success()
                backoff = config.idle_poll_seconds
                emit_operational_event(
                    "job_result",
                    status=result.status,
                    failure_code=result.failure_code,
                    provider_calls=result.provider_calls,
                    retry_count=result.retry_count,
                    broker_connectivity="healthy",
                )
            except BrokerFailure as error:
                failures = health.failure("unavailable")
                backoff = min(60.0, max(config.idle_poll_seconds, backoff * 2))
                emit_operational_event(
                    "worker_broker_failure",
                    severity="ERROR" if failures >= 3 else "WARNING",
                    failure_code=error.code,
                    consecutive_failures=failures,
                    broker_connectivity="unavailable",
                )
            except Exception:
                failures = health.failure()
                backoff = min(60.0, max(config.idle_poll_seconds, backoff * 2))
                emit_operational_event(
                    "worker_internal_failure",
                    severity="ERROR",
                    failure_code="worker_internal_failure",
                    consecutive_failures=failures,
                    broker_connectivity="degraded",
                )
            finally:
                health.progress(busy=False)
            completed_cycles += 1
            if max_cycles is not None and completed_cycles >= max_cycles:
                stop.set()
            try:
                await asyncio.wait_for(stop.wait(), timeout=backoff)
            except TimeoutError:
                pass
    finally:
        health.stopping()
        server.shutdown()
        server.server_close()
        emit_operational_event(
            "worker_stopped",
            deployment_version=config.deployment_id,
            runtime_version=WORKER_RUNTIME_VERSION,
            cleanup_result="scavenge_pending",
        )


def main() -> int:
    try:
        config = WorkerConfig.from_environment()
        asyncio.run(run_worker(config))
    except Exception:
        emit_operational_event(
            "worker_startup_failed",
            severity="ERROR",
            failure_code="worker_startup_failed",
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
