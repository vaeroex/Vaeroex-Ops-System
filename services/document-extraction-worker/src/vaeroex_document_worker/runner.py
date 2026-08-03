"""One durable, bounded document extraction job execution."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from typing import Any

from .broker import BrokerClient, BrokerFailure
from .config import MAX_PAGES, WorkerConfig
from .official_client import ProviderFailure, ProviderResult, invoke_official_client, prepare_provider_input
from .temporary import SecureTemporaryWorkspace, scavenge_stale_worker_directories


@dataclass(frozen=True)
class WorkerRunResult:
    status: str
    provider_calls: int
    retry_count: int
    failure_code: str | None


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


async def run_one_job(config: WorkerConfig | None = None) -> WorkerRunResult:
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

        await _advance(broker, lease, "leased", "preparing")
        try:
            with SecureTemporaryWorkspace() as temporary:
                source = temporary.file("source.bin")
                provider_input = temporary.file("provider-input.pdf")
                grant = await broker.post(
                    {"operation": "issue_file_access", "leaseCapability": lease, "ttlSeconds": 60}
                )
                file_capability = _required_string(grant.get("fileCapability"), "file_capability_missing")
                await broker.download(file_capability, source)
                prepare_provider_input(source, provider_input)
                source.unlink(missing_ok=True)
                lease = await _heartbeat(broker, lease)
                await _advance(broker, lease, "preparing", "dispatching")

                dispatch_request_id = _request_id()
                authorization = await broker.post(
                    {
                        "operation": "authorize_dispatch",
                        "leaseCapability": lease,
                        "dispatchRequestId": dispatch_request_id,
                    }
                )
                if not authorization.get("authorized"):
                    raise ProviderFailure("provider_dispatch_denied", "authorization", retryable=False)

                provider_calls = 0
                retry_count = 0
                while True:
                    provider_calls += 1
                    try:
                        result = await asyncio.to_thread(invoke_official_client, provider_input, page_count)
                        artifact = _draft(result, route, document_class, page_count)
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
                                retry_count = 1
                                dispatch_request_id = next_dispatch_request_id
                                lease = await _heartbeat(broker, lease)
                                continue
                        return await _fail_job(
                            broker, lease, failure, provider_calls, retry_count, 0
                        )

                await _advance(broker, lease, "provider_dispatched", "extracting")
                await _advance(broker, lease, "extracting", "normalizing")
                await _advance(broker, lease, "normalizing", "validating")
                await _advance(broker, lease, "validating", "encrypting")
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
                return WorkerRunResult(
                    status=_required_string(completion.get("status"), "completion_status_missing"),
                    provider_calls=provider_calls,
                    retry_count=retry_count,
                    failure_code=None,
                )
        except ProviderFailure as failure:
            return await _fail_job(broker, lease, failure, 0, 0, None)
