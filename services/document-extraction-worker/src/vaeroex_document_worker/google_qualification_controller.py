"""One-shot Preview-only controller for the frozen Google OCR qualification."""

from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass
from typing import Any, Callable

from .broker import BrokerClient, BrokerFailure
from .config import WorkerConfig
from .google_document_ai_contract import GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE
from .google_synthetic import (
    GOOGLE_EXPECTED_LOCAL_REJECTIONS,
    GOOGLE_EXPECTED_PROVIDER_DOCUMENTS,
    GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS,
    GoogleQualificationPlan,
    google_fixture_eligibility,
    google_qualification_plan,
)
from .runner import WorkerRunResult, run_one_job
from .synthetic import load_frozen_corpus

CONTROLLER_VERSION = "google_frozen_corpus_qualification_controller_v2"
_DOCUMENT_CLASS = {
    1: "digital_pdf",
    2: "image_only_pdf",
    3: "scanned_pdf",
    4: "printed_document_photo",
    6: "digital_pdf",
    7: "digital_pdf",
    10: "digital_pdf",
    11: "image_only_pdf",
}


@dataclass(frozen=True)
class GoogleFrozenQualificationResult:
    status: str
    eligible_documents: int
    eligible_pages: int
    provider_calls: int
    retry_count: int
    failure_code: str | None


@dataclass(frozen=True)
class _QualificationStatus:
    status: str
    active_fixture_index: int | None
    eligible_documents: int
    eligible_pages: int
    local_rejections: int
    succeeded_documents: int
    provider_reservations: int
    provider_calls: int
    retries: int
    concurrency: int


def _required_string(value: object, code: str) -> str:
    if not isinstance(value, str) or not value:
        raise BrokerFailure(code)
    return value


def _required_int(value: object, code: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise BrokerFailure(code)
    return value


def _status(response: dict[str, Any]) -> _QualificationStatus:
    active_fixture = response.get("active_fixture_index")
    if active_fixture is not None and (
        not isinstance(active_fixture, int) or isinstance(active_fixture, bool)
    ):
        raise BrokerFailure("qualification_status_invalid")
    status = _QualificationStatus(
        status=_required_string(response.get("status"), "qualification_status_invalid"),
        active_fixture_index=active_fixture,
        eligible_documents=_required_int(
            response.get("eligible_documents"), "qualification_status_invalid"
        ),
        eligible_pages=_required_int(
            response.get("eligible_pages"), "qualification_status_invalid"
        ),
        local_rejections=_required_int(
            response.get("local_rejections"), "qualification_status_invalid"
        ),
        succeeded_documents=_required_int(
            response.get("succeeded_documents"), "qualification_status_invalid"
        ),
        provider_reservations=_required_int(
            response.get("provider_reservations"), "qualification_status_invalid"
        ),
        provider_calls=_required_int(
            response.get("provider_calls"), "qualification_status_invalid"
        ),
        retries=_required_int(response.get("retries"), "qualification_status_invalid"),
        concurrency=_required_int(
            response.get("concurrency"), "qualification_status_invalid"
        ),
    )
    if (
        status.eligible_documents != GOOGLE_EXPECTED_PROVIDER_DOCUMENTS
        or status.eligible_pages != GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS
        or status.local_rejections != GOOGLE_EXPECTED_LOCAL_REJECTIONS
        or not 0 <= status.provider_calls <= status.provider_reservations
        <= GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS
        or status.retries != 0
        or status.concurrency != 1
    ):
        raise BrokerFailure("qualification_status_invalid")
    return status


async def _fetch_status(config: WorkerConfig, run_id: str) -> _QualificationStatus:
    async with BrokerClient(config) as broker:
        response = await broker.post(
            {"operation": "qualification_status", "runId": run_id}
        )
    return _status(response)


def qualification_items(
    plan: GoogleQualificationPlan,
) -> list[dict[str, object]]:
    eligible_indices = {fixture.fixture_index for fixture in plan.eligible_fixtures}
    items: list[dict[str, object]] = []
    for fixture in load_frozen_corpus():
        eligibility = google_fixture_eligibility(fixture)
        source_sha256 = hashlib.sha256(fixture.source_path.read_bytes()).hexdigest()
        base: dict[str, object] = {
            "fixtureIndex": fixture.fixture_index,
            "sourceSha256": source_sha256,
            "fixtureIdentityFingerprint": eligibility.fixture_identity_fingerprint,
            "pageIdentityFingerprints": list(eligibility.page_identity_fingerprints),
            "providerEligible": eligibility.provider_eligible,
            "localRejectionReason": eligibility.local_rejection_reason,
            "documentClass": _DOCUMENT_CLASS.get(fixture.fixture_index),
        }
        if eligibility.provider_eligible != (fixture.fixture_index in eligible_indices):
            raise RuntimeError("google_qualification_plan_identity_mismatch")
        items.append(base)
    return items


def _stop_reason(result: WorkerRunResult) -> str:
    raw = result.failure_code or f"qualification_{result.status}"
    safe = re.sub(r"[^a-z0-9_]", "_", raw.lower()).strip("_")
    return (safe or "qualification_worker_failure")[:120]


async def run_google_frozen_qualification(
    config: WorkerConfig,
    *,
    progress_callback: Callable[[str], None] | None = None,
) -> GoogleFrozenQualificationResult:
    if (
        not config.google_frozen_qualification_controller_enabled
        or config.runtime_environment != "preview"
        or config.provider_profile != GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE
        or config.google_provider_contract is None
        or not config.synthetic_qualification_enabled
        or not config.provider_execution_enabled
    ):
        raise RuntimeError("google_frozen_qualification_controller_not_authorized")

    # Planning and local exclusion happen before the broker can create a job.
    plan = google_qualification_plan(config.google_provider_contract)
    items = qualification_items(plan)
    request_id = str(uuid.uuid4())
    run_id: str | None = None
    async with BrokerClient(config) as broker:
        prepared = await broker.post(
            {
                "operation": "qualification_prepare",
                "requestId": request_id,
                "benchmarkProfileFingerprint": plan.benchmark_profile_fingerprint,
                "items": items,
            }
        )
        run_id = _required_string(prepared.get("run_id"), "qualification_run_missing")
        if (
            prepared.get("eligible_documents") != GOOGLE_EXPECTED_PROVIDER_DOCUMENTS
            or prepared.get("eligible_pages") != GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS
        ):
            raise BrokerFailure("qualification_prepare_bounds_invalid")
        restart_latched = prepared.get("restart_latched") is True

    if restart_latched:
        existing = await _fetch_status(config, run_id)
        if existing.status == "active":
            async with BrokerClient(config) as broker:
                await broker.post(
                    {
                        "operation": "qualification_stop",
                        "runId": run_id,
                        "reason": "qualification_worker_restarted",
                    }
                )
            existing = await _fetch_status(config, run_id)
        if existing.status not in {"stopped", "completed"}:
            raise BrokerFailure("qualification_restart_latch_invalid")
        return GoogleFrozenQualificationResult(
            existing.status,
            existing.eligible_documents,
            existing.eligible_pages,
            existing.provider_calls,
            existing.retries,
            (
                "qualification_worker_restart_latched"
                if existing.status == "stopped"
                else None
            ),
        )

    completed = 0
    try:
        expected_fixtures = [
            fixture.fixture_index for fixture in plan.eligible_fixtures
        ]
        while completed < GOOGLE_EXPECTED_PROVIDER_DOCUMENTS:
            before = await _fetch_status(config, run_id)
            if (
                before.status != "active"
                or before.active_fixture_index is not None
                or before.succeeded_documents != completed
            ):
                raise BrokerFailure("qualification_serial_state_invalid")
            async with BrokerClient(config) as broker:
                enqueued = await broker.post(
                    {
                        "operation": "qualification_enqueue_next",
                        "runId": run_id,
                        "requestId": str(uuid.uuid4()),
                    }
                )
            if enqueued.get("enqueued") is not True:
                raise BrokerFailure("qualification_enqueue_rejected")
            job_id = _required_string(enqueued.get("job_id"), "qualification_job_missing")
            expected_fixture = expected_fixtures[completed]
            if enqueued.get("fixture_index") != expected_fixture:
                raise BrokerFailure("qualification_fixture_sequence_invalid")
            enqueued_status = await _fetch_status(config, run_id)
            if (
                enqueued_status.status != "active"
                or enqueued_status.active_fixture_index != expected_fixture
                or enqueued_status.provider_calls != before.provider_calls
                or enqueued_status.provider_reservations != before.provider_reservations
            ):
                raise BrokerFailure("qualification_serial_state_invalid")
            result = await run_one_job(config, progress_callback=progress_callback)
            if result.status != "needs_review" or result.retry_count != 0:
                stop_reason = _stop_reason(result)
                async with BrokerClient(config) as broker:
                    await broker.post(
                        {
                            "operation": "qualification_stop",
                            "runId": run_id,
                            "reason": stop_reason,
                        }
                    )
                stopped = await _fetch_status(config, run_id)
                return GoogleFrozenQualificationResult(
                    "stopped",
                    stopped.eligible_documents,
                    stopped.eligible_pages,
                    stopped.provider_calls,
                    stopped.retries,
                    result.failure_code or stop_reason,
                )
            async with BrokerClient(config) as broker:
                finished = await broker.post(
                    {
                        "operation": "qualification_finish_item",
                        "runId": run_id,
                        "jobId": job_id,
                    }
                )
            if finished.get("finished") is not True:
                raise BrokerFailure("qualification_item_finish_rejected")
            completed += 1
            after = await _fetch_status(config, run_id)
            expected_page_total = sum(
                len(fixture.rendered_page_paths)
                for fixture in plan.eligible_fixtures[:completed]
            )
            if (
                after.status != "active"
                or after.active_fixture_index is not None
                or after.succeeded_documents != completed
                or after.provider_reservations != expected_page_total
                or after.provider_calls != expected_page_total
            ):
                raise BrokerFailure("qualification_serial_state_invalid")

        async with BrokerClient(config) as broker:
            final = await broker.post(
                {"operation": "qualification_complete", "runId": run_id}
            )
        if final.get("completed") is not True:
            raise BrokerFailure("qualification_completion_rejected")
        final_status = await _fetch_status(config, run_id)
        if (
            final_status.status != "completed"
            or final_status.succeeded_documents != GOOGLE_EXPECTED_PROVIDER_DOCUMENTS
            or final_status.provider_reservations != GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS
            or final_status.provider_calls != GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS
        ):
            raise BrokerFailure("qualification_completion_state_invalid")
        return GoogleFrozenQualificationResult(
            "completed",
            final_status.eligible_documents,
            final_status.eligible_pages,
            final_status.provider_calls,
            final_status.retries,
            None,
        )
    except Exception as error:
        if run_id is not None:
            try:
                async with BrokerClient(config) as broker:
                    await broker.post(
                        {
                            "operation": "qualification_stop",
                            "runId": run_id,
                            "reason": "qualification_controller_failure",
                        }
                    )
                stopped = await _fetch_status(config, run_id)
                if stopped.status == "stopped":
                    return GoogleFrozenQualificationResult(
                        "stopped",
                        stopped.eligible_documents,
                        stopped.eligible_pages,
                        stopped.provider_calls,
                        stopped.retries,
                        (
                            error.code
                            if isinstance(error, BrokerFailure)
                            else "qualification_controller_failure"
                        ),
                    )
            except Exception:
                pass
        raise
