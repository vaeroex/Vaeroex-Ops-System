from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from dataclasses import dataclass, field
from typing import Any

import pytest

from vaeroex_document_worker.broker import BrokerFailure
from vaeroex_document_worker.config import WorkerConfig
from vaeroex_document_worker.google_document_ai_contract import GoogleDocumentAiContract
from vaeroex_document_worker import google_qualification_controller as controller
from vaeroex_document_worker.google_synthetic import (
    GOOGLE_EXPECTED_PROVIDER_DOCUMENTS,
    GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS,
    google_qualification_plan,
)
from vaeroex_document_worker.runner import WorkerRunResult
from vaeroex_document_worker.synthetic import (
    SyntheticQualificationFailure,
    load_frozen_corpus,
)


def contract() -> GoogleDocumentAiContract:
    return GoogleDocumentAiContract(
        project_number="123456789012",
        processor_id="0123456789abcdef",
    )


def bindings_json() -> str:
    plan = google_qualification_plan(contract())
    return json.dumps(
        [
            {
                "sourceSha256": hashlib.sha256(
                    fixture.source_path.read_bytes()
                ).hexdigest(),
                "intakeRequestId": str(uuid.UUID(int=fixture.fixture_index)),
                "assessmentFingerprint": hashlib.sha256(
                    f"assessment-{fixture.fixture_index}".encode()
                ).hexdigest(),
                "contentHmac": hashlib.sha256(
                    f"content-{fixture.fixture_index}".encode()
                ).hexdigest(),
                "cacheKey": hashlib.sha256(
                    f"cache-{fixture.fixture_index}".encode()
                ).hexdigest(),
            }
            for fixture in plan.eligible_fixtures
        ],
        sort_keys=True,
        separators=(",", ":"),
    )


def worker_config() -> WorkerConfig:
    return WorkerConfig(
        broker_url="https://preview-broker.run.app",
        broker_audience="https://preview-broker.run.app",
        broker_auth_mode="google_oidc_v1",
        worker_id="qualification-worker",
        worker_key_version="qualification-key-v1",
        worker_private_key_der=b"fake-is-never-read",
        nvidia_api_key=None,
        provider_contract=None,
        runtime_environment="preview",
        deployment_id="pr265-google-controller-v1",
        provider_execution_enabled=True,
        authentication_qualification_enabled=False,
        synthetic_qualification_enabled=True,
        google_provider_contract=contract(),
        google_frozen_qualification_controller_enabled=True,
        google_frozen_intake_bindings_json=bindings_json(),
    )


@dataclass
class QualificationState:
    prepared_items: list[dict[str, object]] = field(default_factory=list)
    operations: list[str] = field(default_factory=list)
    enqueued_fixtures: list[int] = field(default_factory=list)
    active_fixture: int | None = None
    active_job: str | None = None
    succeeded_documents: int = 0
    provider_reservations: int = 0
    provider_calls: int = 0
    retry_count: int = 0
    status: str = "active"
    stop_reason: str | None = None
    running_jobs: int = 0
    max_running_jobs: int = 0


class FakeBroker:
    def __init__(self, _config: WorkerConfig, state: QualificationState) -> None:
        self.state = state

    async def __aenter__(self) -> "FakeBroker":
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def post(self, payload: dict[str, Any]) -> dict[str, Any]:
        operation = str(payload["operation"])
        self.state.operations.append(operation)
        if operation == "qualification_prepare":
            self.state.prepared_items = list(payload["items"])
            return {
                "run_id": str(uuid.UUID(int=100)),
                "eligible_documents": 8,
                "eligible_pages": 9,
            }
        if operation == "qualification_status":
            return {
                "status": self.state.status,
                "active_fixture_index": self.state.active_fixture,
                "eligible_documents": 8,
                "eligible_pages": 9,
                "local_rejections": 4,
                "succeeded_documents": self.state.succeeded_documents,
                "provider_reservations": self.state.provider_reservations,
                "provider_calls": self.state.provider_calls,
                "retries": self.state.retry_count,
                "concurrency": 1,
            }
        if operation == "qualification_enqueue_next":
            if self.state.status != "active" or self.state.active_fixture is not None:
                return {"enqueued": False}
            eligible = [1, 2, 3, 4, 6, 7, 10, 11]
            fixture = eligible[self.state.succeeded_documents]
            self.state.active_fixture = fixture
            self.state.active_job = str(uuid.UUID(int=1_000 + fixture))
            self.state.enqueued_fixtures.append(fixture)
            return {
                "enqueued": True,
                "job_id": self.state.active_job,
                "fixture_index": fixture,
            }
        if operation == "qualification_finish_item":
            if payload["jobId"] != self.state.active_job:
                return {"finished": False}
            self.state.succeeded_documents += 1
            self.state.active_fixture = None
            self.state.active_job = None
            return {"finished": True}
        if operation == "qualification_stop":
            if self.state.status == "active":
                self.state.status = "stopped"
                self.state.stop_reason = str(payload["reason"])
            return {"stopped": True}
        if operation == "qualification_complete":
            if (
                self.state.succeeded_documents == 8
                and self.state.provider_reservations == 9
                and self.state.provider_calls == 9
            ):
                self.state.status = "completed"
                return {"completed": True}
            return {"completed": False}
        raise AssertionError(f"Unexpected controller operation: {operation}")


def install_fake_broker(
    monkeypatch: pytest.MonkeyPatch,
    state: QualificationState,
) -> None:
    monkeypatch.setattr(
        controller,
        "BrokerClient",
        lambda config: FakeBroker(config, state),
    )


def test_plan_and_local_exclusions_complete_before_any_broker_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = QualificationState()
    install_fake_broker(monkeypatch, state)

    async def run_success(
        _config: WorkerConfig,
        *,
        progress_callback: Any = None,
    ) -> WorkerRunResult:
        del progress_callback
        assert state.active_fixture is not None
        state.running_jobs += 1
        state.max_running_jobs = max(state.max_running_jobs, state.running_jobs)
        fixture = load_frozen_corpus()[state.active_fixture - 1]
        pages = len(fixture.rendered_page_paths)
        state.provider_reservations += pages
        state.provider_calls += pages
        state.running_jobs -= 1
        return WorkerRunResult("needs_review", pages, 0, None)

    monkeypatch.setattr(controller, "run_one_job", run_success)
    result = asyncio.run(controller.run_google_frozen_qualification(worker_config()))

    assert result.status == "completed"
    assert result.eligible_documents == GOOGLE_EXPECTED_PROVIDER_DOCUMENTS == 8
    assert result.eligible_pages == GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS == 9
    assert result.provider_calls == 9
    assert state.max_running_jobs == 1
    assert state.enqueued_fixtures == [1, 2, 3, 4, 6, 7, 10, 11]
    local: dict[int, dict[str, object]] = {}
    for item in state.prepared_items:
        if item["providerEligible"] is not False:
            continue
        fixture_index = item["fixtureIndex"]
        assert isinstance(fixture_index, int)
        local[fixture_index] = item
    assert set(local) == {5, 8, 9, 12}
    for item in local.values():
        assert set(item) == {
            "fixtureIndex",
            "sourceSha256",
            "fixtureIdentityFingerprint",
            "pageIdentityFingerprints",
            "providerEligible",
            "localRejectionReason",
            "documentClass",
        }
        assert item["documentClass"] is None
    assert not set(state.enqueued_fixtures).intersection(local)
    assert not {
        "claim",
        "issue_file_access",
        "authorize_dispatch",
        "check_provider_boundary",
        "qualification_page_outcome",
    }.intersection(state.operations)


def test_planner_failure_occurs_before_broker_construction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    constructed = False

    def broker_forbidden(_config: WorkerConfig) -> object:
        nonlocal constructed
        constructed = True
        raise AssertionError("broker must not be constructed before planning")

    monkeypatch.setattr(controller, "BrokerClient", broker_forbidden)
    monkeypatch.setattr(
        controller,
        "google_qualification_plan",
        lambda _contract: (_ for _ in ()).throw(
            SyntheticQualificationFailure("google_synthetic_qualification_bound_invalid")
        ),
    )

    with pytest.raises(
        SyntheticQualificationFailure,
        match="google_synthetic_qualification_bound_invalid",
    ):
        asyncio.run(controller.run_google_frozen_qualification(worker_config()))
    assert not constructed


@pytest.mark.parametrize(
    ("status", "retry_count", "failure_code"),
    (
        ("failed", 0, "google_document_ai_provider_rejected"),
        ("failed", 0, "google_document_ai_output_malformed"),
        ("failed", 0, "claim_provider_identity_mismatch"),
        ("dispatch_unknown", 0, "google_document_ai_dispatch_ambiguous"),
        ("needs_review", 1, "qualification_retry_detected"),
        ("failed", 0, "qualification_review_provenance_mismatch"),
        ("failed", 0, "qualification_authority_boundary_violation"),
    ),
)
def test_fatal_result_latches_corpus_stop_before_next_enqueue(
    monkeypatch: pytest.MonkeyPatch,
    status: str,
    retry_count: int,
    failure_code: str,
) -> None:
    state = QualificationState()
    install_fake_broker(monkeypatch, state)

    async def run_failure(
        _config: WorkerConfig,
        *,
        progress_callback: Any = None,
    ) -> WorkerRunResult:
        del progress_callback
        state.provider_reservations = 1
        state.provider_calls = 1
        return WorkerRunResult(status, 1, retry_count, failure_code)

    monkeypatch.setattr(controller, "run_one_job", run_failure)
    result = asyncio.run(controller.run_google_frozen_qualification(worker_config()))

    assert result.status == "stopped"
    assert result.failure_code == failure_code
    assert state.status == "stopped"
    assert state.enqueued_fixtures == [1]
    assert state.operations.count("qualification_enqueue_next") == 1
    assert state.provider_calls == 1


def test_controller_rejects_non_google_and_production_configuration() -> None:
    google = worker_config()
    for invalid in (
        WorkerConfig(**{**google.__dict__, "runtime_environment": "production"}),
        WorkerConfig(
            **{
                **google.__dict__,
                "google_frozen_qualification_controller_enabled": False,
            }
        ),
    ):
        with pytest.raises(
            RuntimeError,
            match="google_frozen_qualification_controller_not_authorized",
        ):
            asyncio.run(controller.run_google_frozen_qualification(invalid))


def test_binding_substitution_and_local_exclusion_binding_fail_closed() -> None:
    plan = google_qualification_plan(contract())
    bindings = json.loads(bindings_json())
    bindings[0]["sourceSha256"] = "f" * 64
    with pytest.raises(RuntimeError, match="intake_binding_missing"):
        controller.qualification_items(
            plan,
            json.dumps(bindings, separators=(",", ":")),
        )

    excluded = load_frozen_corpus()[4]
    bindings = json.loads(bindings_json())
    bindings[-1]["sourceSha256"] = hashlib.sha256(
        excluded.source_path.read_bytes()
    ).hexdigest()
    with pytest.raises(RuntimeError, match="local_exclusion_has_binding"):
        controller.qualification_items(
            plan,
            json.dumps(bindings, separators=(",", ":")),
        )


def test_status_rejects_call_overrun_retry_or_parallelism() -> None:
    baseline: dict[str, Any] = {
        "status": "active",
        "active_fixture_index": None,
        "eligible_documents": 8,
        "eligible_pages": 9,
        "local_rejections": 4,
        "succeeded_documents": 0,
        "provider_reservations": 0,
        "provider_calls": 0,
        "retries": 0,
        "concurrency": 1,
    }
    for mutation in (
        {"provider_reservations": 10, "provider_calls": 9},
        {"provider_reservations": 1, "provider_calls": 2},
        {"retries": 1},
        {"concurrency": 2},
    ):
        with pytest.raises(BrokerFailure, match="qualification_status_invalid"):
            controller._status({**baseline, **mutation})
