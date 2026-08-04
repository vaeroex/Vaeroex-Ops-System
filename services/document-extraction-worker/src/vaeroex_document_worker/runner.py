"""One durable, bounded document extraction job execution."""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from dataclasses import dataclass
from typing import Any, Callable

from .broker import BrokerClient, BrokerFailure
from .config import MAX_PAGES, WorkerConfig
from .provider_types import ProviderFailure, ProviderResult
from .renderer import render_source
from .rest_adapter import invoke_rest_adapter
from .synthetic import (
    FrozenSyntheticFixture,
    SyntheticQualificationFailure,
    approved_fixture_for_source,
    emit_synthetic_evaluation,
    evaluate_synthetic_result,
    failed_synthetic_evaluation,
    materialize_approved_pages,
)
from .temporary import SecureTemporaryWorkspace, scavenge_stale_worker_directories


@dataclass(frozen=True)
class WorkerRunResult:
    status: str
    provider_calls: int
    retry_count: int
    failure_code: str | None


ProgressCallback = Callable[[str], None]


def _request_id() -> str:
    return str(uuid.uuid4())


def _required_string(value: object, code: str) -> str:
    if not isinstance(value, str) or not value:
        raise RuntimeError(code)
    return value


def _required_int(value: object, code: str) -> int:
    if not isinstance(value, int):
        raise RuntimeError(code)
    return value


async def _advance(
    broker: BrokerClient,
    lease: str,
    expected_stage: str,
    next_stage: str,
) -> None:
    result = await broker.post(
        {
            "operation": "advance_stage",
            "leaseCapability": lease,
            "requestId": _request_id(),
            "expectedStage": expected_stage,
            "nextStage": next_stage,
        }
    )
    if not result.get("ok"):
        raise BrokerFailure("stage_transition_denied")


async def _heartbeat(broker: BrokerClient, lease: str) -> str:
    response = await broker.post(
        {"operation": "heartbeat", "leaseCapability": lease, "leaseSeconds": 300}
    )
    return _required_string(response.get("leaseCapability"), "heartbeat_lease_missing")


async def _check_provider_boundary(
    broker: BrokerClient,
    lease: str,
    boundary: str,
) -> str:
    response = await broker.post(
        {
            "operation": "check_provider_boundary",
            "leaseCapability": lease,
            "boundary": boundary,
        }
    )
    if not response.get("allowed"):
        raise ProviderFailure(
            "provider_boundary_denied",
            "authorization",
            retryable=False,
        )
    return _required_string(
        response.get("leaseCapability"),
        "provider_boundary_lease_missing",
    )


def _notify(progress_callback: ProgressCallback | None, stage: str) -> None:
    if progress_callback is not None:
        progress_callback(stage)


async def _fail_job(
    broker: BrokerClient,
    lease: str,
    failure: ProviderFailure,
    provider_calls: int,
    retry_count: int,
    latency_ms: int | None,
) -> WorkerRunResult:
    failure_class = "ambiguous_dispatch" if failure.ambiguous else (
        "unsupported_input" if failure.code == "unsupported_worker_render_input" else (
            "validation" if failure.result_class == "malformed_output" else failure.result_class
        )
    )
    await broker.post(
        {
            "operation": "fail",
            "leaseCapability": lease,
            "failureCode": failure.code,
            "failureClass": failure_class,
            "telemetry": {
                "requestId": _request_id(),
                "latencyMs": latency_ms,
                "validationResult": "failed" if failure.result_class in ("validation", "malformed_output") else None,
                "encryptionResult": None,
                "cacheResult": "not_stored",
            },
        }
    )
    return WorkerRunResult(
        status="dispatch_unknown" if failure.ambiguous else "failed",
        provider_calls=provider_calls,
        retry_count=retry_count,
        failure_code=failure.code,
    )


def _draft(result: ProviderResult, route: str, document_class: str, page_count: int) -> dict[str, Any]:
    if len(result.pages) != page_count or not 1 <= page_count <= MAX_PAGES:
        raise ProviderFailure("normalized_page_count_mismatch", "validation", retryable=False)
    block_count = sum(len(page.get("blocks", [])) for page in result.pages)
    if block_count == 0:
        raise ProviderFailure("normalized_output_empty", "validation", retryable=False)
    if block_count > 4_000:
        raise ProviderFailure("normalized_block_limit_exceeded", "validation", retryable=False)
    return {
        "route": route,
        "documentClass": document_class,
        "pageCount": page_count,
        "pages": result.pages,
        "criticalFields": [],
        "validationFindings": [],
    }


def _emit_synthetic_failure(
    fixture: FrozenSyntheticFixture | None,
    *,
    provider_calls: int,
    retry_count: int,
    failure_code: str,
) -> None:
    if fixture is None:
        return
    emit_synthetic_evaluation(
        failed_synthetic_evaluation(
            fixture,
            provider_calls=provider_calls,
            retry_count=retry_count,
            failure_code=failure_code,
        )
    )


async def run_one_job(
    config: WorkerConfig | None = None,
    *,
    progress_callback: ProgressCallback | None = None,
) -> WorkerRunResult:
    active_config = config or WorkerConfig.from_environment()
    scavenge_stale_worker_directories()
    async with BrokerClient(active_config) as broker:
        claim = await broker.post({"operation": "claim", "leaseSeconds": 300})
        if not claim.get("claimed"):
            return WorkerRunResult(status="idle", provider_calls=0, retry_count=0, failure_code=None)
        raw_job = claim.get("job")
        if not isinstance(raw_job, dict):
            raise BrokerFailure("claim_response_invalid")
        lease = _required_string(raw_job.get("leaseCapability"), "claim_lease_missing")
        route = _required_string(raw_job.get("route"), "claim_route_missing")
        document_class = _required_string(raw_job.get("documentClass"), "claim_document_class_missing")
        page_count = _required_int(raw_job.get("pageCount"), "claim_page_count_missing")
        provider_calls = 0
        retry_count = 0
        synthetic_fixture: FrozenSyntheticFixture | None = None
        synthetic_report_emitted = False
        _notify(progress_callback, "leased")

        def emit_synthetic_failure_once(failure_code: str) -> None:
            nonlocal synthetic_report_emitted
            if synthetic_report_emitted:
                return
            _emit_synthetic_failure(
                synthetic_fixture,
                provider_calls=provider_calls,
                retry_count=retry_count,
                failure_code=failure_code,
            )
            synthetic_report_emitted = synthetic_fixture is not None

        await _advance(broker, lease, "leased", "preparing")
        _notify(progress_callback, "preparing")
        try:
            # The Cloud Run daemon owns SIGTERM. This context still removes all
            # files on normal completion/error; stale crash remnants are
            # scavenged before the next claim.
            with SecureTemporaryWorkspace(install_signal_handlers=False) as temporary:
                source = temporary.file("source.bin")
                rendered_directory = temporary.file("rendered-pages")
                grant = await broker.post(
                    {"operation": "issue_file_access", "leaseCapability": lease, "ttlSeconds": 60}
                )
                file_capability = _required_string(grant.get("fileCapability"), "file_capability_missing")
                await broker.download(file_capability, source)
                _notify(progress_callback, "source_downloaded")
                document_sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
                if active_config.synthetic_qualification_enabled:
                    try:
                        synthetic_fixture = approved_fixture_for_source(
                            document_sha256,
                            page_count,
                        )
                        rendered_pages = await asyncio.to_thread(
                            materialize_approved_pages,
                            synthetic_fixture,
                            rendered_directory,
                        )
                    except SyntheticQualificationFailure as failure:
                        emit_synthetic_failure_once(str(failure))
                        synthetic_fixture = None
                        raise ProviderFailure(
                            str(failure),
                            "validation",
                            retryable=False,
                        ) from failure
                else:
                    rendered_pages = await asyncio.to_thread(
                        render_source,
                        source,
                        rendered_directory,
                        page_count,
                    )
                _notify(progress_callback, "pages_ready")
                source.unlink(missing_ok=True)
                lease = await _heartbeat(broker, lease)
                await _advance(broker, lease, "preparing", "dispatching")
                _notify(progress_callback, "dispatching")

                dispatch_request_id = _request_id()
                authorization = await broker.post(
                    {
                        "operation": "authorize_dispatch",
                        "leaseCapability": lease,
                        "dispatchRequestId": dispatch_request_id,
                    }
                )
                if not authorization.get("authorized"):
                    if (
                        authorization.get("idempotent") is True
                        and authorization.get("reason") == "dispatch_already_authorized"
                    ):
                        # A concurrent caller already owns the single-use
                        # provider dispatch. Do not call the provider and do
                        # not fail the shared job out from under that caller.
                        return WorkerRunResult(
                            status="dispatch_in_flight",
                            provider_calls=0,
                            retry_count=0,
                            failure_code=None,
                        )
                    emit_synthetic_failure_once("provider_dispatch_denied")
                    return await _fail_job(
                        broker,
                        lease,
                        ProviderFailure(
                            "provider_dispatch_denied",
                            "authorization",
                            retryable=False,
                        ),
                        0,
                        0,
                        None,
                    )

                completed_pages: tuple[dict[str, Any], ...] = ()
                while True:
                    provider_calls += 1
                    try:
                        event_loop = asyncio.get_running_loop()

                        def check_provider_boundary(boundary: str) -> None:
                            nonlocal lease
                            _notify(progress_callback, boundary)
                            future = asyncio.run_coroutine_threadsafe(
                                _check_provider_boundary(broker, lease, boundary),
                                event_loop,
                            )
                            try:
                                lease = future.result(timeout=35)
                                _notify(progress_callback, f"{boundary}_authorized")
                            except ProviderFailure:
                                raise
                            except Exception as error:
                                raise ProviderFailure(
                                    "provider_boundary_unavailable",
                                    "authorization",
                                    retryable=False,
                                ) from error

                        result = await asyncio.to_thread(
                            invoke_rest_adapter,
                            rendered_pages,
                            document_sha256,
                            active_config.provider_contract,
                            active_config.nvidia_api_key,
                            completed_pages=completed_pages,
                            before_provider_boundary=check_provider_boundary,
                        )
                        artifact = _draft(result, route, document_class, page_count)
                        _notify(progress_callback, "provider_completed")
                        await broker.post(
                            {
                                "operation": "provider_outcome",
                                "leaseCapability": lease,
                                "dispatchRequestId": dispatch_request_id,
                                "resultClass": "success",
                                "latencyMs": result.latency_ms,
                            }
                        )
                        break
                    except ProviderFailure as failure:
                        outcome = await broker.post(
                            {
                                "operation": "provider_outcome",
                                "leaseCapability": lease,
                                "dispatchRequestId": dispatch_request_id,
                                "resultClass": failure.result_class,
                                "latencyMs": 0,
                            }
                        )
                        if failure.retryable and retry_count == 0 and outcome.get("retry_permitted"):
                            next_dispatch_request_id = _request_id()
                            retry = await broker.post(
                                {
                                    "operation": "authorize_retry",
                                    "leaseCapability": lease,
                                    "priorDispatchRequestId": dispatch_request_id,
                                    "nextDispatchRequestId": next_dispatch_request_id,
                                }
                            )
                            if retry.get("authorized"):
                                # The retry RPC is the atomic second-call claim.
                                # Broker admission checks both application and
                                # database gates immediately before it succeeds.
                                retry_count = 1
                                dispatch_request_id = next_dispatch_request_id
                                completed_pages = failure.completed_pages
                                lease = await _heartbeat(broker, lease)
                                continue
                        emit_synthetic_failure_once(failure.code)
                        return await _fail_job(
                            broker, lease, failure, provider_calls, retry_count, 0
                        )

                await _advance(broker, lease, "provider_dispatched", "extracting")
                _notify(progress_callback, "extracting")
                await _advance(broker, lease, "extracting", "normalizing")
                _notify(progress_callback, "normalizing")
                await _advance(broker, lease, "normalizing", "validating")
                _notify(progress_callback, "validating")
                synthetic_evaluation = None
                if synthetic_fixture is not None:
                    try:
                        synthetic_evaluation = evaluate_synthetic_result(
                            synthetic_fixture,
                            result,
                            provider_calls=len(result.request_contract_hashes),
                            retry_count=retry_count,
                        )
                    except SyntheticQualificationFailure as failure:
                        raise ProviderFailure(
                            str(failure),
                            "validation",
                            retryable=False,
                        ) from failure
                await _advance(broker, lease, "validating", "encrypting")
                _notify(progress_callback, "encrypting")
                completion = await broker.post(
                    {
                        "operation": "complete",
                        "leaseCapability": lease,
                        "artifact": artifact,
                        "telemetry": {
                            "requestId": _request_id(),
                            "latencyMs": result.latency_ms,
                            "validationResult": "passed",
                            "encryptionResult": "broker_managed",
                            "cacheResult": "store_requested",
                        },
                    }
                )
                if not completion.get("ok"):
                    raise BrokerFailure("completion_failed")
                if synthetic_evaluation is not None:
                    emit_synthetic_evaluation(synthetic_evaluation)
                    synthetic_report_emitted = True
                _notify(progress_callback, "completed")
                return WorkerRunResult(
                    status=_required_string(completion.get("status"), "completion_status_missing"),
                    provider_calls=provider_calls,
                    retry_count=retry_count,
                    failure_code=None,
                )
        except ProviderFailure as failure:
            emit_synthetic_failure_once(failure.code)
            return await _fail_job(
                broker,
                lease,
                failure,
                provider_calls,
                retry_count,
                None,
            )
        except BrokerFailure as failure:
            emit_synthetic_failure_once(failure.code)
            return await _fail_job(
                broker,
                lease,
                ProviderFailure(
                    failure.code,
                    "authorization",
                    retryable=False,
                ),
                provider_calls,
                retry_count,
                None,
            )
