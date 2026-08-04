from __future__ import annotations

import asyncio
from typing import Any

from vaeroex_document_worker import daemon
from vaeroex_document_worker.config import WorkerConfig
from vaeroex_document_worker.provider_contract import HOSTED_CONTRACT
from vaeroex_document_worker.runner import WorkerRunResult


def worker_config() -> WorkerConfig:
    return WorkerConfig(
        broker_url="https://preview.example.test",
        worker_id="worker-1",
        worker_key_version="key-v1",
        worker_private_key_der=b"unused-by-fake",
        nvidia_api_key="unused-by-fake",
        provider_contract=HOSTED_CONTRACT,
        runtime_environment="preview",
        deployment_id="phase-c1-preview-1",
        synthetic_qualification_enabled=False,
    )


class FakeServer:
    def __init__(self) -> None:
        self.shutdown_called = False
        self.close_called = False

    def shutdown(self) -> None:
        self.shutdown_called = True

    def server_close(self) -> None:
        self.close_called = True


def test_daemon_runs_one_job_at_a_time_and_stops_cleanly(monkeypatch: Any) -> None:
    server = FakeServer()
    calls = 0

    async def verify(_config: object) -> None:
        return None

    async def run(_config: object, *, progress_callback: Any = None) -> WorkerRunResult:
        nonlocal calls
        calls += 1
        assert progress_callback is not None
        progress_callback("inference")
        return WorkerRunResult("idle", 0, 0, None)

    monkeypatch.setattr(daemon, "assert_runtime_resources", lambda: None)
    monkeypatch.setattr(daemon, "scavenge_stale_worker_directories", lambda: 0)
    monkeypatch.setattr(daemon, "start_health_server", lambda _state, _port: server)
    monkeypatch.setattr(daemon, "_verify_broker", verify)
    monkeypatch.setattr(daemon, "run_one_job", run)
    monkeypatch.setattr(daemon, "emit_operational_event", lambda *_args, **_kwargs: None)

    asyncio.run(daemon.run_worker(worker_config(), max_cycles=1))

    assert calls == 1
    assert server.shutdown_called
    assert server.close_called
