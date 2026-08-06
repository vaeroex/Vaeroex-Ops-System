"""One durable, bounded document extraction job execution."""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from dataclasses import dataclass
from typing import Any, Callable

from .broker import BrokerClient, BrokerFailure
from .config import MAX_PAGES, WorkerConfig
from .google_access_token import (
    GoogleAccessTokenFailure,
    GoogleMetadataAccessTokenProvider,
)
from .google_document_ai_adapter import invoke_google_document_ai_adapter
from .google_document_ai_contract import (
    GOOGLE_DOCUMENT_AI_ADAPTER_VERSION,
    GOOGLE_DOCUMENT_AI_ARTIFACT_CONTRACT_VERSION,
    GOOGLE_DOCUMENT_AI_ARTIFACT_NORMALIZATION_VERSION,
    GOOGLE_DOCUMENT_AI_COMPATIBILITY_POLICY_VERSION,
    GOOGLE_DOCUMENT_AI_CONFIDENCE_POLICY_VERSION,
    GOOGLE_DOCUMENT_AI_ENDPOINT_CONTRACT_VERSION,
    GOOGLE_DOCUMENT_AI_MAX_PAGES,
    GOOGLE_DOCUMENT_AI_NORMALIZATION_VERSION,
    GOOGLE_DOCUMENT_AI_PROCESSOR_TYPE,
    GOOGLE_DOCUMENT_AI_PROVIDER,
    GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE,
    GOOGLE_DOCUMENT_AI_REQUEST_SERIALIZER_VERSION,
    GOOGLE_DOCUMENT_AI_REVIEW_PROVENANCE_VERSION,
    GOOGLE_DOCUMENT_AI_ROUTING_POLICY_VERSION,
    GOOGLE_DOCUMENT_AI_RESPONSE_VALIDATOR_VERSION,
    GOOGLE_DOCUMENT_AI_SELECTION_MARK_POLICY_VERSION,
    GOOGLE_DOCUMENT_AI_TABLE_POLICY_VERSION,
)
from .google_synthetic import (
    emit_google_synthetic_evaluation,
    google_approved_fixture_for_source,
)
from .provider_contract import (
    HOSTED_COMPATIBILITY_CONTRACT_VERSION,
    HOSTED_NORMALIZATION_VERSION,
    HOSTED_REQUEST_SERIALIZER_VERSION,
    HOSTED_RESPONSE_PROFILE,
    HOSTED_RESPONSE_VALIDATOR_VERSION,
    REST_ADAPTER_VERSION,
)
from .provider_types import MAX_PROVIDER_LATENCY_MS, ProviderFailure, ProviderResult
from .renderer import render_source
from .rest_adapter import invoke_rest_adapter
from .response_profile import DIAGNOSTIC_FIXTURE_ID
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
from .telemetry import emit_field_path_diagnostic, emit_response_profile_diagnostic


@dataclass(frozen=True)
class WorkerRunResult:
    status: str
    provider_calls: int
    retry_count: int
    failure_code: str | None


def _bounded_provider_latency(value: object) -> int:
    if type(value) is not int:
        return 0
    return max(0, min(value, MAX_PROVIDER_LATENCY_MS))


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


def _expected_claim_identity(config: WorkerConfig) -> dict[str, object]:
    if config.provider_profile == GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE:
        google_contract = config.google_provider_contract
        if (
            google_contract is None
            or config.provider_contract is not None
            or config.nvidia_api_key is not None
        ):
            raise RuntimeError("google_document_ai_worker_profile_invalid")
        return {
            "providerProfile": GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE,
            "parserProvider": GOOGLE_DOCUMENT_AI_PROVIDER,
            "parserModel": google_contract.processor_version,
            "parserRevision": GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE,
            "clientRevision": GOOGLE_DOCUMENT_AI_ADAPTER_VERSION,
            "processorType": GOOGLE_DOCUMENT_AI_PROCESSOR_TYPE,
            "processorId": google_contract.processor_id,
            "processorResource": google_contract.processor_resource,
            "processorLocation": google_contract.location,
            "processorVersion": google_contract.processor_version,
            "endpointContractVersion": GOOGLE_DOCUMENT_AI_ENDPOINT_CONTRACT_VERSION,
            "requestSerializerVersion": GOOGLE_DOCUMENT_AI_REQUEST_SERIALIZER_VERSION,
            "responseValidatorVersion": GOOGLE_DOCUMENT_AI_RESPONSE_VALIDATOR_VERSION,
            "providerNormalizationVersion": GOOGLE_DOCUMENT_AI_NORMALIZATION_VERSION,
            "compatibilityPolicyVersion": GOOGLE_DOCUMENT_AI_COMPATIBILITY_POLICY_VERSION,
            "tablePolicyVersion": GOOGLE_DOCUMENT_AI_TABLE_POLICY_VERSION,
            "confidencePolicyVersion": GOOGLE_DOCUMENT_AI_CONFIDENCE_POLICY_VERSION,
            "selectionMarkPolicyVersion": GOOGLE_DOCUMENT_AI_SELECTION_MARK_POLICY_VERSION,
            "routingPolicyVersion": GOOGLE_DOCUMENT_AI_ROUTING_POLICY_VERSION,
            "reviewProvenanceVersion": GOOGLE_DOCUMENT_AI_REVIEW_PROVENANCE_VERSION,
            "extractionContractVersion": GOOGLE_DOCUMENT_AI_ARTIFACT_CONTRACT_VERSION,
            "normalizationVersion": GOOGLE_DOCUMENT_AI_ARTIFACT_NORMALIZATION_VERSION,
        }
    nvidia_contract = config.provider_contract
    if (
        config.provider_profile != HOSTED_RESPONSE_PROFILE
        or nvidia_contract is None
        or config.google_provider_contract is not None
        or not config.nvidia_api_key
    ):
        raise RuntimeError("nvidia_document_extraction_worker_profile_invalid")
    return {
        "providerProfile": HOSTED_RESPONSE_PROFILE,
        "parserProvider": "nvidia",
        "parserModel": nvidia_contract.model,
        "parserRevision": nvidia_contract.parser_revision,
        "clientRevision": REST_ADAPTER_VERSION,
        "processorType": None,
        "processorId": None,
        "processorResource": None,
        "processorLocation": None,
        "processorVersion": None,
        "endpointContractVersion": nvidia_contract.endpoint_contract_version,
        "requestSerializerVersion": HOSTED_REQUEST_SERIALIZER_VERSION,
        "responseValidatorVersion": HOSTED_RESPONSE_VALIDATOR_VERSION,
        "providerNormalizationVersion": HOSTED_NORMALIZATION_VERSION,
        "compatibilityPolicyVersion": HOSTED_COMPATIBILITY_CONTRACT_VERSION,
        "tablePolicyVersion": None,
        "confidencePolicyVersion": None,
        "selectionMarkPolicyVersion": None,
        "routingPolicyVersion": "document_extraction_routing_v1",
        "reviewProvenanceVersion": "document_extraction_review_provenance_v1",
        "extractionContractVersion": "document_extraction_artifact_v1",
        "normalizationVersion": "document_extraction_normalization_v1",
    }


def _assert_claim_identity(raw_job: dict[str, Any], config: WorkerConfig) -> None:
    expected = _expected_claim_identity(config)
    if any(raw_job.get(key) != value for key, value in expected.items()):
        raise BrokerFailure("claim_provider_identity_mismatch")
    route = raw_job.get("route")
    if (
        config.provider_profile == GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE
        and route not in ("google_primary", "google_fallback")
    ) or (
        config.provider_profile == HOSTED_RESPONSE_PROFILE
        and route not in ("nvidia_primary", "nvidia_fallback")
    ):
        raise BrokerFailure("claim_provider_route_mismatch")


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
    *,
    qualification_page_index: int | None = None,
    qualification_dispatch_request_id: str | None = None,
) -> tuple[str, str | None]:
    payload: dict[str, Any] = {
        "operation": "check_provider_boundary",
        "leaseCapability": lease,
        "boundary": boundary,
    }
    if qualification_page_index is not None:
        if qualification_dispatch_request_id is None:
            raise ProviderFailure(
                "qualification_dispatch_identity_missing",
                "authorization",
                retryable=False,
            )
        payload["qualificationPageIndex"] = qualification_page_index
        payload["qualificationReservationRequestId"] = _request_id()
        payload["qualificationDispatchRequestId"] = qualification_dispatch_request_id
    response = await broker.post(payload)
    if not response.get("allowed"):
        raise ProviderFailure(
            "provider_boundary_denied",
            "authorization",
            retryable=False,
        )
    reservation_id = response.get("qualificationReservationId")
    if reservation_id is not None and not isinstance(reservation_id, str):
        raise ProviderFailure(
            "qualification_reservation_identity_invalid",
            "authorization",
            retryable=False,
        )
    return (
        _required_string(
            response.get("leaseCapability"),
            "provider_boundary_lease_missing",
        ),
        reservation_id,
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


def _draft(
    result: ProviderResult,
    route: str,
    document_class: str,
    page_count: int,
    max_pages: int,
) -> dict[str, Any]:
    if len(result.pages) != page_count or not 1 <= page_count <= max_pages:
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
    config: WorkerConfig,
    *,
    provider_calls: int,
    retry_count: int,
    failure_code: str,
) -> None:
    if fixture is None:
        return
    evaluation = failed_synthetic_evaluation(
        fixture,
        provider_calls=provider_calls,
        retry_count=retry_count,
        failure_code=failure_code,
    )
    if config.provider_profile == GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE:
        contract = config.google_provider_contract
        if contract is None:
            raise RuntimeError("google_document_ai_contract_missing")
        emit_google_synthetic_evaluation(evaluation, contract)
    else:
        emit_synthetic_evaluation(evaluation)


async def run_one_job(
    config: WorkerConfig | None = None,
    *,
    progress_callback: ProgressCallback | None = None,
) -> WorkerRunResult:
    active_config = config or WorkerConfig.from_environment()
    if active_config.field_path_diagnostic_enabled and (
        active_config.runtime_environment != "preview"
        or not active_config.provider_execution_enabled
        or not active_config.synthetic_qualification_enabled
        or active_config.provider_profile != HOSTED_RESPONSE_PROFILE
    ):
        raise RuntimeError("Field-path diagnostics are not authorized for this runtime.")
    scavenge_stale_worker_directories()
    async with BrokerClient(active_config) as broker:
        claim = await broker.post(
            {
                "operation": "claim",
                "providerProfile": active_config.provider_profile,
                "leaseSeconds": 300,
            }
        )
        if not claim.get("claimed"):
            return WorkerRunResult(status="idle", provider_calls=0, retry_count=0, failure_code=None)
        raw_job = claim.get("job")
        if not isinstance(raw_job, dict):
            raise BrokerFailure("claim_response_invalid")
        _assert_claim_identity(raw_job, active_config)
        lease = _required_string(raw_job.get("leaseCapability"), "claim_lease_missing")
        route = _required_string(raw_job.get("route"), "claim_route_missing")
        document_class = _required_string(raw_job.get("documentClass"), "claim_document_class_missing")
        page_count = _required_int(raw_job.get("pageCount"), "claim_page_count_missing")
        provider_calls = 0
        observed_google_page_calls = 0
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
                active_config,
                provider_calls=(
                    observed_google_page_calls
                    if active_config.provider_profile
                    == GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE
                    else provider_calls
                ),
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
                        synthetic_fixture = (
                            google_approved_fixture_for_source(
                                document_sha256,
                                page_count,
                            )
                            if active_config.provider_profile
                            == GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE
                            else approved_fixture_for_source(
                                document_sha256,
                                page_count,
                            )
                        )
                        rendered_pages = await asyncio.to_thread(
                            materialize_approved_pages,
                            synthetic_fixture,
                            rendered_directory,
                        )
                        diagnostic_enabled = (
                            active_config.response_profile_diagnostic_enabled
                            or active_config.field_path_diagnostic_enabled
                        )
                        if diagnostic_enabled and (
                            synthetic_fixture.document_id != DIAGNOSTIC_FIXTURE_ID
                            or len(rendered_pages) != 1
                        ):
                            raise SyntheticQualificationFailure(
                                (
                                    "response_profile_diagnostic_fixture_rejected"
                                    if active_config.response_profile_diagnostic_enabled
                                    else "field_path_diagnostic_fixture_rejected"
                                )
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
                if not active_config.google_frozen_qualification_controller_enabled:
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
                    attempt_latency_ms = 0
                    try:
                        event_loop = asyncio.get_running_loop()
                        qualification_page_cursor = 0
                        qualification_reservations: dict[int, str] = {}

                        def check_provider_boundary(boundary: str) -> None:
                            nonlocal lease, qualification_page_cursor
                            _notify(progress_callback, boundary)
                            page_index: int | None = None
                            if active_config.google_frozen_qualification_controller_enabled:
                                if boundary != "inference":
                                    raise ProviderFailure(
                                        "qualification_unexpected_network_route",
                                        "authorization",
                                        retryable=False,
                                    )
                                qualification_page_cursor += 1
                                page_index = qualification_page_cursor
                            future = asyncio.run_coroutine_threadsafe(
                                _check_provider_boundary(
                                    broker,
                                    lease,
                                    boundary,
                                    qualification_page_index=page_index,
                                    qualification_dispatch_request_id=(
                                        dispatch_request_id
                                        if page_index is not None
                                        else None
                                    ),
                                ),
                                event_loop,
                            )
                            try:
                                lease, reservation_id = future.result(timeout=35)
                                if page_index is not None:
                                    if not reservation_id:
                                        raise ProviderFailure(
                                            "qualification_reservation_missing",
                                            "authorization",
                                            retryable=False,
                                        )
                                    qualification_reservations[page_index] = reservation_id
                                _notify(progress_callback, f"{boundary}_authorized")
                            except ProviderFailure:
                                raise
                            except Exception as error:
                                raise ProviderFailure(
                                    "provider_boundary_unavailable",
                                    "authorization",
                                    retryable=False,
                                ) from error

                        def record_provider_page_outcome(
                            page_index: int,
                            succeeded: bool,
                            result_class: str,
                            provider_request_started: bool,
                        ) -> None:
                            reservation_id = qualification_reservations.pop(page_index, None)
                            if not reservation_id:
                                raise ProviderFailure(
                                    "qualification_reservation_missing",
                                    "authorization",
                                    retryable=False,
                                )
                            future = asyncio.run_coroutine_threadsafe(
                                broker.post(
                                    {
                                        "operation": "qualification_page_outcome",
                                        "leaseCapability": lease,
                                        "reservationId": reservation_id,
                                        "succeeded": succeeded,
                                        "resultClass": result_class,
                                        "providerRequestStarted": provider_request_started,
                                    }
                                ),
                                event_loop,
                            )
                            try:
                                outcome = future.result(timeout=35)
                            except Exception as error:
                                raise ProviderFailure(
                                    "qualification_page_outcome_unavailable",
                                    "authorization",
                                    retryable=False,
                                ) from error
                            if outcome.get("recorded") is not True:
                                raise ProviderFailure(
                                    "qualification_page_outcome_rejected",
                                    "authorization",
                                    retryable=False,
                                )

                        provider_options: dict[str, Any] = {
                            "completed_pages": completed_pages,
                            "before_provider_boundary": check_provider_boundary,
                        }
                        if active_config.response_profile_diagnostic_enabled:
                            provider_options["response_profile_observer"] = (
                                emit_response_profile_diagnostic
                            )
                        if active_config.field_path_diagnostic_enabled:
                            provider_options["field_path_observer"] = (
                                emit_field_path_diagnostic
                            )
                        if active_config.provider_profile == GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE:
                            google_contract = active_config.google_provider_contract
                            if google_contract is None:
                                raise ProviderFailure(
                                    "google_document_ai_contract_missing",
                                    "authorization",
                                    retryable=False,
                                )

                            def invoke_google() -> ProviderResult:
                                try:
                                    with GoogleMetadataAccessTokenProvider() as token_provider:
                                        google_options: dict[str, Any] = {}
                                        if active_config.google_frozen_qualification_controller_enabled:
                                            google_options["provider_page_outcome"] = (
                                                record_provider_page_outcome
                                            )
                                        return invoke_google_document_ai_adapter(
                                            rendered_pages,
                                            document_sha256,
                                            google_contract,
                                            token_provider.token,
                                            completed_pages=completed_pages,
                                            before_provider_boundary=check_provider_boundary,
                                            **google_options,
                                        )
                                except GoogleAccessTokenFailure as error:
                                    raise ProviderFailure(
                                        str(error),
                                        "provider",
                                        retryable=False,
                                    ) from error

                            result = await asyncio.to_thread(invoke_google)
                            observed_google_page_calls = len(
                                result.request_contract_hashes
                            )
                            max_pages = GOOGLE_DOCUMENT_AI_MAX_PAGES
                        else:
                            nvidia_contract = active_config.provider_contract
                            if nvidia_contract is None or not active_config.nvidia_api_key:
                                raise ProviderFailure(
                                    "nvidia_document_extraction_contract_missing",
                                    "authorization",
                                    retryable=False,
                                )
                            result = await asyncio.to_thread(
                                invoke_rest_adapter,
                                rendered_pages,
                                document_sha256,
                                nvidia_contract,
                                active_config.nvidia_api_key,
                                **provider_options,
                            )
                            max_pages = MAX_PAGES
                        attempt_latency_ms = _bounded_provider_latency(result.latency_ms)
                        artifact = _draft(
                            result,
                            route,
                            document_class,
                            page_count,
                            max_pages,
                        )
                        _notify(progress_callback, "provider_completed")
                        await broker.post(
                            {
                                "operation": "provider_outcome",
                                "leaseCapability": lease,
                                "dispatchRequestId": dispatch_request_id,
                                "resultClass": "success",
                                "latencyMs": attempt_latency_ms,
                            }
                        )
                        break
                    except ProviderFailure as failure:
                        if (
                            active_config.provider_profile
                            == GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE
                        ):
                            observed_google_page_calls = max(
                                observed_google_page_calls,
                                len(failure.completed_pages)
                                + int(failure.provider_request_started),
                            )
                        failure_latency_ms = _bounded_provider_latency(
                            failure.latency_ms
                            if failure.latency_ms is not None
                            else attempt_latency_ms
                        )
                        outcome = await broker.post(
                            {
                                "operation": "provider_outcome",
                                "leaseCapability": lease,
                                "dispatchRequestId": dispatch_request_id,
                                "resultClass": failure.result_class,
                                "latencyMs": failure_latency_ms,
                            }
                        )
                        if (
                            not active_config.response_profile_diagnostic_enabled
                            and not active_config.field_path_diagnostic_enabled
                            and active_config.provider_profile == HOSTED_RESPONSE_PROFILE
                            and failure.retryable
                            and retry_count == 0
                            and outcome.get("retry_permitted")
                        ):
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
                            broker,
                            lease,
                            failure,
                            provider_calls,
                            retry_count,
                            failure_latency_ms,
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
                    if active_config.provider_profile == GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE:
                        emission_contract = active_config.google_provider_contract
                        if emission_contract is None:
                            raise RuntimeError("google_document_ai_contract_missing")
                        emit_google_synthetic_evaluation(
                            synthetic_evaluation,
                            emission_contract,
                        )
                    else:
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
