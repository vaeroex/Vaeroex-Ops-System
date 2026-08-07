from __future__ import annotations

import asyncio
from dataclasses import replace
from typing import Any

from vaeroex_document_worker import daemon
from vaeroex_document_worker.config import WorkerConfig
from vaeroex_document_worker.google_document_ai_contract import GoogleDocumentAiContract
from vaeroex_document_worker.google_qualification_controller import (
    GoogleFrozenQualificationResult,
)
from vaeroex_document_worker.provider_contract import HOSTED_CONTRACT
from vaeroex_document_worker.runner import WorkerRunResult


def worker_config() -> WorkerConfig:
    return WorkerConfig(
        broker_url="https://preview.example.test",
        broker_audience="https://preview.example.test",
        broker_auth_mode="google_oidc_v1",
        worker_id="worker-1",
        worker_key_version="key-v1",
        worker_private_key_der=b"unused-by-fake",
        nvidia_api_key="unused-by-fake",
        provider_contract=HOSTED_CONTRACT,
        runtime_environment="preview",
        deployment_id="phase-c1-preview-1",
        provider_execution_enabled=True,
        authentication_qualification_enabled=False,
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


def test_authentication_qualification_never_enters_job_runner(monkeypatch: Any) -> None:
    server = FakeServer()
    config = WorkerConfig(
        **{
            **worker_config().__dict__,
            "provider_execution_enabled": False,
            "authentication_qualification_enabled": True,
        }
    )
    events: list[tuple[str, dict[str, object]]] = []

    async def verify(_config: object) -> None:
        return None

    monkeypatch.setattr(daemon, "assert_runtime_resources", lambda: None)
    monkeypatch.setattr(daemon, "scavenge_stale_worker_directories", lambda: 0)
    monkeypatch.setattr(daemon, "start_health_server", lambda _state, _port: server)
    monkeypatch.setattr(daemon, "_verify_broker", verify)
    monkeypatch.setattr(
        daemon,
        "run_one_job",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("authentication qualification cannot run a job")
        ),
    )
    monkeypatch.setattr(
        daemon,
        "emit_operational_event",
        lambda event, **fields: events.append((event, fields)),
    )

    asyncio.run(daemon.run_worker(config, max_cycles=0))

    assert any(event == "broker_auth_qualification_passed" for event, _ in events)
    qualification = next(fields for event, fields in events if event == "broker_auth_qualification_passed")
    assert qualification["provider_calls"] == 0
    assert server.shutdown_called
    assert server.close_called


def test_google_frozen_controller_runs_once_without_entering_polling_daemon(
    monkeypatch: Any,
) -> None:
    server = FakeServer()
    config = replace(
        worker_config(),
        nvidia_api_key=None,
        provider_contract=None,
        google_provider_contract=GoogleDocumentAiContract(
            project_number="123456789012",
            processor_id="0123456789abcdef",
        ),
        synthetic_qualification_enabled=True,
        google_frozen_qualification_controller_enabled=True,
    )
    controller_calls = 0
    events: list[tuple[str, dict[str, object]]] = []

    async def verify(_config: object) -> None:
        return None

    async def run_controller(
        _config: WorkerConfig,
        *,
        progress_callback: Any = None,
    ) -> GoogleFrozenQualificationResult:
        nonlocal controller_calls
        controller_calls += 1
        assert progress_callback is not None
        return GoogleFrozenQualificationResult("completed", 8, 9, 9, 0, None)

    monkeypatch.setattr(daemon, "assert_runtime_resources", lambda: None)
    monkeypatch.setattr(daemon, "scavenge_stale_worker_directories", lambda: 0)
    monkeypatch.setattr(daemon, "start_health_server", lambda _state, _port: server)
    monkeypatch.setattr(daemon, "_verify_broker", verify)
    monkeypatch.setattr(daemon, "run_google_frozen_qualification", run_controller)
    monkeypatch.setattr(
        daemon,
        "run_one_job",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("frozen qualification cannot enter ordinary polling")
        ),
    )
    monkeypatch.setattr(
        daemon,
        "emit_operational_event",
        lambda event, **fields: events.append((event, fields)),
    )

    asyncio.run(daemon.run_worker(config, max_cycles=5))

    assert controller_calls == 1
    result = next(
        fields
        for event, fields in events
        if event == "google_frozen_qualification_result"
    )
    assert result["provider_calls"] == 9
    assert result["retry_count"] == 0
    assert server.shutdown_called
    assert server.close_called


def test_google_frozen_controller_holds_terminal_worker_until_shutdown(
    monkeypatch: Any,
) -> None:
    server = FakeServer()
    config = replace(
        worker_config(),
        nvidia_api_key=None,
        provider_contract=None,
        google_provider_contract=GoogleDocumentAiContract(
            project_number="123456789012",
            processor_id="0123456789abcdef",
        ),
        synthetic_qualification_enabled=True,
        google_frozen_qualification_controller_enabled=True,
    )
    controller_finished = asyncio.Event()

    async def verify(_config: object) -> None:
        return None

    async def run_controller(
        _config: WorkerConfig,
        *,
        progress_callback: Any = None,
    ) -> GoogleFrozenQualificationResult:
        del progress_callback
        controller_finished.set()
        return GoogleFrozenQualificationResult(
            "stopped", 8, 9, 1, 0, "qualification_controller_failure"
        )

    monkeypatch.setattr(daemon, "assert_runtime_resources", lambda: None)
    monkeypatch.setattr(daemon, "scavenge_stale_worker_directories", lambda: 0)
    monkeypatch.setattr(daemon, "start_health_server", lambda _state, _port: server)
    monkeypatch.setattr(daemon, "_verify_broker", verify)
    monkeypatch.setattr(daemon, "run_google_frozen_qualification", run_controller)
    monkeypatch.setattr(daemon, "emit_operational_event", lambda *_args, **_kwargs: None)

    async def exercise() -> None:
        task = asyncio.create_task(daemon.run_worker(config))
        await controller_finished.wait()
        await asyncio.sleep(0)
        assert not task.done()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(exercise())

    assert server.shutdown_called
    assert server.close_called
