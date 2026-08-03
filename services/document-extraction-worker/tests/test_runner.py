from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from vaeroex_document_worker.config import WorkerConfig
from vaeroex_document_worker.official_client import ProviderFailure, ProviderResult
from vaeroex_document_worker import runner


class FakeBroker:
    def __init__(self, _config: WorkerConfig) -> None:
        self.operations: list[str] = []
        self.payloads: list[dict[str, Any]] = []
        self.dispatch_authorizations: list[bool] = []
        self.dispatch_authorization_responses: list[dict[str, Any]] = []
        self.retry_authorizations: list[bool] = []

    async def __aenter__(self) -> "FakeBroker":
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def post(self, payload: dict[str, Any]) -> dict[str, Any]:
        operation = str(payload["operation"])
        self.operations.append(operation)
        self.payloads.append(payload)
        if operation == "claim":
            return {
                "claimed": True,
                "job": {
                    "leaseCapability": "lease-token",
                    "route": "nvidia_primary",
                    "documentClass": "scanned_pdf",
                    "pageCount": 1,
                },
            }
        if operation == "heartbeat":
            return {"ok": True, "leaseCapability": "lease-token"}
        if operation == "issue_file_access":
            return {"ok": True, "fileCapability": "file-token"}
        if operation == "advance_stage":
            return {"ok": True}
        if operation == "authorize_dispatch":
            if self.dispatch_authorization_responses:
                return self.dispatch_authorization_responses.pop(0)
            authorized = self.dispatch_authorizations.pop(0) if self.dispatch_authorizations else True
            return {"ok": authorized, "authorized": authorized}
        if operation == "provider_outcome":
            return {
                "ok": True,
                "recorded": True,
                "retry_permitted": payload["resultClass"] == "transport",
            }
        if operation == "authorize_retry":
            authorized = self.retry_authorizations.pop(0) if self.retry_authorizations else True
            return {"ok": authorized, "authorized": authorized}
        if operation == "complete":
            return {"ok": True, "status": "needs_review"}
        if operation == "fail":
            return {"ok": True, "status": "failed"}
        raise AssertionError(f"Unexpected broker operation: {operation}")

    async def download(self, _capability: str, destination: Path, expected_bytes: int | None = None) -> int:
        del expected_bytes
        content = b"%PDF-1.4\n%%EOF\n"
        destination.write_bytes(content)
        return len(content)


def worker_config() -> WorkerConfig:
    return WorkerConfig(
        broker_url="https://preview.example.test",
        worker_id="worker-1",
        worker_key_version="key-v1",
        worker_private_key_der=b"unused-by-fake",
        nvidia_api_key="unused-by-fake",
        vercel_environment="preview",
        synthetic_qualification_enabled=False,
    )


def test_one_safe_transport_retry_is_broker_authorized(monkeypatch: Any) -> None:
    fake = FakeBroker(worker_config())
    monkeypatch.setattr(runner, "BrokerClient", lambda _config: fake)
    attempts = 0

    def provider(_path: Path, _pages: int) -> ProviderResult:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ProviderFailure("transport", "transport", retryable=True)
        return ProviderResult(
            pages=[{"page": 1, "blocks": [{"id": "p1", "kind": "text", "text": "synthetic", "coordinates": None}]}],
            latency_ms=10,
        )

    monkeypatch.setattr(runner, "invoke_official_client", provider)
    result = asyncio.run(runner.run_one_job(worker_config()))
    assert result.status == "needs_review"
    assert result.provider_calls == 2
    assert result.retry_count == 1
    assert fake.operations.count("authorize_retry") == 1
    assert fake.operations.count("authorize_dispatch") == 1
    assert fake.operations.count("complete") == 1


def test_ambiguous_dispatch_never_retries(monkeypatch: Any) -> None:
    fake = FakeBroker(worker_config())
    monkeypatch.setattr(runner, "BrokerClient", lambda _config: fake)

    def provider(_path: Path, _pages: int) -> ProviderResult:
        raise ProviderFailure(
            "provider_timeout_ambiguous",
            "ambiguous_dispatch",
            retryable=False,
            ambiguous=True,
        )

    monkeypatch.setattr(runner, "invoke_official_client", provider)
    result = asyncio.run(runner.run_one_job(worker_config()))
    assert result.status == "dispatch_unknown"
    assert result.provider_calls == 1
    assert fake.operations.count("authorize_retry") == 0
    assert fake.operations.count("fail") == 1


def test_empty_provider_output_is_validation_failure_before_completion(monkeypatch: Any) -> None:
    fake = FakeBroker(worker_config())
    monkeypatch.setattr(runner, "BrokerClient", lambda _config: fake)
    monkeypatch.setattr(
        runner,
        "invoke_official_client",
        lambda _path, _pages: ProviderResult(pages=[{"page": 1, "blocks": []}], latency_ms=4),
    )

    result = asyncio.run(runner.run_one_job(worker_config()))

    assert result.status == "failed"
    assert result.failure_code == "normalized_output_empty"
    assert fake.operations.count("complete") == 0
    outcomes = [payload for payload in fake.payloads if payload["operation"] == "provider_outcome"]
    assert len(outcomes) == 1
    assert outcomes[0]["resultClass"] == "validation"


def test_provider_gate_is_rechecked_immediately_before_invocation(monkeypatch: Any) -> None:
    fake = FakeBroker(worker_config())
    fake.dispatch_authorizations = [False]
    monkeypatch.setattr(runner, "BrokerClient", lambda _config: fake)
    provider_calls = 0

    def provider(_path: Path, _pages: int) -> ProviderResult:
        nonlocal provider_calls
        provider_calls += 1
        raise AssertionError("provider must not run after the gate closes")

    monkeypatch.setattr(runner, "invoke_official_client", provider)
    result = asyncio.run(runner.run_one_job(worker_config()))

    assert result.status == "failed"
    assert result.failure_code == "provider_dispatch_denied"
    assert provider_calls == 0
    assert fake.operations.count("authorize_dispatch") == 1
    assert fake.operations.count("provider_outcome") == 0


def test_dispatch_authorization_replay_never_calls_or_fails_shared_job(monkeypatch: Any) -> None:
    fake = FakeBroker(worker_config())
    fake.dispatch_authorization_responses = [{
        "ok": False,
        "authorized": False,
        "idempotent": True,
        "reason": "dispatch_already_authorized",
    }]
    monkeypatch.setattr(runner, "BrokerClient", lambda _config: fake)
    provider_calls = 0

    def provider(_path: Path, _pages: int) -> ProviderResult:
        nonlocal provider_calls
        provider_calls += 1
        raise AssertionError("provider must not run for a consumed dispatch claim")

    monkeypatch.setattr(runner, "invoke_official_client", provider)
    result = asyncio.run(runner.run_one_job(worker_config()))

    assert result.status == "dispatch_in_flight"
    assert result.failure_code is None
    assert result.provider_calls == 0
    assert provider_calls == 0
    assert fake.operations.count("authorize_dispatch") == 1
    assert fake.operations.count("provider_outcome") == 0
    assert fake.operations.count("fail") == 0


def test_retry_provider_gate_is_rechecked_before_second_invocation(monkeypatch: Any) -> None:
    fake = FakeBroker(worker_config())
    fake.retry_authorizations = [False]
    monkeypatch.setattr(runner, "BrokerClient", lambda _config: fake)
    provider_calls = 0

    def provider(_path: Path, _pages: int) -> ProviderResult:
        nonlocal provider_calls
        provider_calls += 1
        raise ProviderFailure("transport", "transport", retryable=True)

    monkeypatch.setattr(runner, "invoke_official_client", provider)
    result = asyncio.run(runner.run_one_job(worker_config()))

    assert result.status == "failed"
    assert result.failure_code == "transport"
    assert provider_calls == 1
    assert fake.operations.count("authorize_dispatch") == 1
    assert fake.operations.count("authorize_retry") == 1
