"""Google-only frozen-corpus qualification contract.

The historical NVIDIA benchmark serializer and aggregate remain in
``synthetic.py``. This module creates a separate identity domain for the exact
Google Enterprise OCR profile and rejects unsupported fixtures before they can
become provider jobs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Sequence

from .google_document_ai_adapter import GOOGLE_DOCUMENT_AI_PAYLOAD_MODE
from .google_document_ai_contract import (
    GOOGLE_DOCUMENT_AI_ADAPTER_VERSION,
    GOOGLE_DOCUMENT_AI_COMPATIBILITY_POLICY_VERSION,
    GOOGLE_DOCUMENT_AI_ENDPOINT_CONTRACT_VERSION,
    GOOGLE_DOCUMENT_AI_NORMALIZATION_VERSION,
    GOOGLE_DOCUMENT_AI_PROCESSOR_TYPE,
    GOOGLE_DOCUMENT_AI_PROVIDER,
    GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE,
    GOOGLE_DOCUMENT_AI_REQUEST_SERIALIZER_VERSION,
    GOOGLE_DOCUMENT_AI_RESPONSE_VALIDATOR_VERSION,
    GOOGLE_DOCUMENT_AI_REVIEW_PROVENANCE_VERSION,
    GOOGLE_DOCUMENT_AI_ROUTING_POLICY_VERSION,
    GoogleDocumentAiContract,
)
from .synthetic import (
    BASELINE_PATH,
    FIXTURE_CORPUS_SHA256,
    FIXTURE_COUNT,
    FIXTURE_SOURCE_COMMIT,
    METRIC_KEYS,
    PAGE_COUNT,
    SYNTHETIC_CONTRACT_VERSION,
    FrozenSyntheticFixture,
    JsonObject,
    Metrics,
    SyntheticEvaluation,
    SyntheticQualificationFailure,
    _aggregate_metrics,
    _canonical_fingerprint,
    _fixture_identity_fingerprint,
    _percentile,
    approved_fixture_for_source,
    failed_synthetic_evaluation,
    load_frozen_corpus,
)

GOOGLE_SYNTHETIC_CONTRACT_VERSION = (
    "document_extraction_phase_c1_google_enterprise_ocr_v1"
)
GOOGLE_BENCHMARK_VERSION = "google_document_intelligence_benchmark_profile_v1"
GOOGLE_BENCHMARK_EVENT = "document_extraction_google_synthetic_fixture_v1"
GOOGLE_BENCHMARK_IDENTITY_VERSION = "document_extraction_google_benchmark_identity_v1"
GOOGLE_BENCHMARK_RECORD_IDENTITY_VERSION = (
    "document_extraction_google_benchmark_record_identity_v1"
)
GOOGLE_PAGE_IDENTITY_VERSION = "document_extraction_google_page_identity_v1"
GOOGLE_ELIGIBILITY_POLICY_VERSION = (
    "google_frozen_corpus_printed_document_eligibility_v1"
)
GOOGLE_EXPECTED_LOCAL_REJECTIONS = 4
GOOGLE_EXPECTED_PROVIDER_DOCUMENTS = 8
GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS = 9
GOOGLE_MAX_PROVIDER_ATTEMPTS = 9
GOOGLE_MAX_RETRIES = 0
GOOGLE_MAX_CONCURRENCY = 1

GOOGLE_LOCAL_REJECTION_POLICY: dict[str, tuple[frozenset[str], str]] = {
    "synthetic-doc-three-column-brief": (
        frozenset({"screenshot", "mixed_text_image_page"}),
        "google_fixture_unsupported_screenshot",
    ),
    "synthetic-doc-dashboard-chart": (
        frozenset({"screenshot", "chart_with_labels"}),
        "google_fixture_unsupported_screenshot",
    ),
    "synthetic-doc-handwritten-annotation": (
        frozenset({"handwritten_annotation", "mixed_text_image_page"}),
        "google_fixture_unsupported_handwriting",
    ),
    "synthetic-doc-corrupted-image": (
        frozenset({"corrupted_page"}),
        "synthetic_fixture_locally_invalid",
    ),
}

_PRIVACY_FORBIDDEN_KEYS = frozenset(
    {
        "documentText",
        "extractedValues",
        "coordinates",
        "rawProviderOutput",
        "rawRequest",
        "rawResponse",
        "workspaceId",
        "customerId",
        "userId",
        "credential",
        "prompt",
        "imageBytes",
    }
)
_AMBIGUOUS_FAILURE_CODES = frozenset(
    {
        "provider_dispatch_ambiguous",
        "google_document_ai_dispatch_ambiguous",
    }
)
_CATASTROPHIC_ERROR_CODES = frozenset(
    {
        "critical_page_omitted",
        "numeric_sign_changed",
        "decimal_shift",
        "currency_magnitude_changed",
        "wrong_source_coordinates",
        "wrong_kpi_assignment",
        "current_target_confusion",
        "reporting_period_merged",
        "fabricated_business_value",
    }
)
_FAILURE_CODE = re.compile(r"^[a-z][a-z0-9_]{0,119}$")
_GOOGLE_RECORD_KEYS = frozenset(
    {
        "event",
        "contractVersion",
        "benchmarkVersion",
        "benchmarkIdentity",
        "benchmarkProfileFingerprint",
        "fixtureIdentityFingerprint",
        "pageIdentityFingerprints",
        "benchmarkRecordFingerprint",
        "syntheticOnly",
        "fixtureIndex",
        "documentClasses",
        "providerEligible",
        "localRejectionReason",
        "status",
        "pageCount",
        "providerCalls",
        "retryCount",
        "latencyMs",
        "payloadModes",
        "metrics",
        "catastrophicErrors",
        "failureCode",
    }
)


@dataclass(frozen=True)
class GoogleFixtureEligibility:
    fixture_index: int
    fixture_identity_fingerprint: str
    page_identity_fingerprints: tuple[str, ...]
    provider_eligible: bool
    local_rejection_reason: str | None


@dataclass(frozen=True)
class GoogleQualificationPlan:
    benchmark_profile_fingerprint: str
    eligible_fixtures: tuple[FrozenSyntheticFixture, ...]
    local_rejections: tuple[GoogleFixtureEligibility, ...]
    eligible_page_count: int
    provider_attempt_ceiling: int
    retry_ceiling: int
    concurrency: int


def google_benchmark_profile_identity(
    contract: GoogleDocumentAiContract,
) -> JsonObject:
    required = {
        "provider": GOOGLE_DOCUMENT_AI_PROVIDER,
        "providerProfile": contract.provider_profile,
        "processorType": GOOGLE_DOCUMENT_AI_PROCESSOR_TYPE,
        "processorId": contract.processor_id,
        "processorResource": contract.processor_resource,
        "processorLocation": contract.location,
        "processorVersion": contract.processor_version,
        "modelIdentity": contract.processor_version,
        "parserRevision": GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE,
        "clientRevision": GOOGLE_DOCUMENT_AI_ADAPTER_VERSION,
        "endpointContractVersion": GOOGLE_DOCUMENT_AI_ENDPOINT_CONTRACT_VERSION,
        "requestSerializerVersion": GOOGLE_DOCUMENT_AI_REQUEST_SERIALIZER_VERSION,
        "responseValidatorVersion": GOOGLE_DOCUMENT_AI_RESPONSE_VALIDATOR_VERSION,
        "normalizationVersion": GOOGLE_DOCUMENT_AI_NORMALIZATION_VERSION,
        "routingPolicyVersion": GOOGLE_DOCUMENT_AI_ROUTING_POLICY_VERSION,
        "compatibilityPolicyVersion": GOOGLE_DOCUMENT_AI_COMPATIBILITY_POLICY_VERSION,
        "reviewProvenanceVersion": GOOGLE_DOCUMENT_AI_REVIEW_PROVENANCE_VERSION,
    }
    if any(not isinstance(value, str) or not value for value in required.values()):
        raise SyntheticQualificationFailure("google_synthetic_benchmark_profile_incomplete")
    return {
        "identityVersion": GOOGLE_BENCHMARK_IDENTITY_VERSION,
        "benchmarkContractVersion": GOOGLE_SYNTHETIC_CONTRACT_VERSION,
        "syntheticCorpusContractVersion": SYNTHETIC_CONTRACT_VERSION,
        "benchmarkVersion": GOOGLE_BENCHMARK_VERSION,
        "fixtureCorpusIdentity": {
            "sourceCommit": FIXTURE_SOURCE_COMMIT,
            "corpusSha256": FIXTURE_CORPUS_SHA256,
            "fixtureCount": FIXTURE_COUNT,
            "pageCount": PAGE_COUNT,
        },
        "eligibilityPolicyVersion": GOOGLE_ELIGIBILITY_POLICY_VERSION,
        **required,
    }


def google_benchmark_profile_fingerprint(
    contract: GoogleDocumentAiContract,
    identity: JsonObject | None = None,
) -> str:
    return _canonical_fingerprint(identity or google_benchmark_profile_identity(contract))


def _google_page_identity_fingerprints(
    fixture: FrozenSyntheticFixture,
) -> tuple[str, ...]:
    return tuple(
        _canonical_fingerprint(
            {
                "identityVersion": GOOGLE_PAGE_IDENTITY_VERSION,
                "corpusSha256": FIXTURE_CORPUS_SHA256,
                "fixtureIndex": fixture.fixture_index,
                "pageIndex": page_index,
                "pageSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
        for page_index, path in enumerate(fixture.rendered_page_paths, start=1)
    )


def google_fixture_eligibility(
    fixture: FrozenSyntheticFixture,
) -> GoogleFixtureEligibility:
    corpus = load_frozen_corpus()
    if not 1 <= fixture.fixture_index <= len(corpus):
        raise SyntheticQualificationFailure("google_synthetic_fixture_identity_invalid")
    canonical = corpus[fixture.fixture_index - 1]
    if fixture != canonical:
        raise SyntheticQualificationFailure("google_synthetic_fixture_identity_invalid")
    policy = GOOGLE_LOCAL_REJECTION_POLICY.get(fixture.document_id)
    local_reason: str | None = None
    if policy is not None:
        required_classes, local_reason = policy
        if not required_classes.issubset(frozenset(fixture.document_classes)):
            raise SyntheticQualificationFailure("google_synthetic_eligibility_identity_invalid")
    return GoogleFixtureEligibility(
        fixture_index=fixture.fixture_index,
        fixture_identity_fingerprint=_fixture_identity_fingerprint(
            fixture.fixture_index,
            len(fixture.rendered_page_paths),
        ),
        page_identity_fingerprints=_google_page_identity_fingerprints(fixture),
        provider_eligible=local_reason is None,
        local_rejection_reason=local_reason,
    )


def google_qualification_plan(
    contract: GoogleDocumentAiContract,
) -> GoogleQualificationPlan:
    fixtures = load_frozen_corpus()
    decisions = tuple(google_fixture_eligibility(fixture) for fixture in fixtures)
    local_rejections = tuple(
        decision for decision in decisions if not decision.provider_eligible
    )
    eligible_fixtures = tuple(
        fixture
        for fixture, decision in zip(fixtures, decisions, strict=True)
        if decision.provider_eligible
    )
    eligible_pages = sum(len(fixture.rendered_page_paths) for fixture in eligible_fixtures)
    if (
        len(fixtures) != FIXTURE_COUNT
        or sum(len(fixture.rendered_page_paths) for fixture in fixtures) != PAGE_COUNT
        or len(local_rejections) != GOOGLE_EXPECTED_LOCAL_REJECTIONS
        or len(eligible_fixtures) != GOOGLE_EXPECTED_PROVIDER_DOCUMENTS
        or eligible_pages != GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS
        or GOOGLE_MAX_PROVIDER_ATTEMPTS != eligible_pages
        or GOOGLE_MAX_RETRIES != 0
        or GOOGLE_MAX_CONCURRENCY != 1
    ):
        raise SyntheticQualificationFailure("google_synthetic_qualification_bound_invalid")
    return GoogleQualificationPlan(
        benchmark_profile_fingerprint=google_benchmark_profile_fingerprint(contract),
        eligible_fixtures=eligible_fixtures,
        local_rejections=local_rejections,
        eligible_page_count=eligible_pages,
        provider_attempt_ceiling=GOOGLE_MAX_PROVIDER_ATTEMPTS,
        retry_ceiling=GOOGLE_MAX_RETRIES,
        concurrency=GOOGLE_MAX_CONCURRENCY,
    )


def authorize_google_provider_reservation(
    *,
    prior_provider_attempts: int,
    requested_pages: int,
    retry_count: int,
    active_concurrency: int,
) -> None:
    if (
        prior_provider_attempts < 0
        or requested_pages < 1
        or retry_count != GOOGLE_MAX_RETRIES
        or active_concurrency != GOOGLE_MAX_CONCURRENCY
        or prior_provider_attempts + requested_pages > GOOGLE_MAX_PROVIDER_ATTEMPTS
    ):
        raise SyntheticQualificationFailure("google_synthetic_provider_bound_exceeded")


def google_approved_fixture_for_source(
    document_sha256: str,
    expected_pages: int,
) -> FrozenSyntheticFixture:
    fixture = approved_fixture_for_source(document_sha256, expected_pages)
    decision = google_fixture_eligibility(fixture)
    if not decision.provider_eligible:
        raise SyntheticQualificationFailure(
            decision.local_rejection_reason or "google_synthetic_fixture_not_eligible"
        )
    return fixture


def _google_benchmark_record_fingerprint(
    *,
    profile_fingerprint: str,
    eligibility: GoogleFixtureEligibility,
) -> str:
    return _canonical_fingerprint(
        {
            "identityVersion": GOOGLE_BENCHMARK_RECORD_IDENTITY_VERSION,
            "benchmarkProfileFingerprint": profile_fingerprint,
            "fixtureIdentityFingerprint": eligibility.fixture_identity_fingerprint,
            "pageIdentityFingerprints": list(eligibility.page_identity_fingerprints),
            "fixtureIndex": eligibility.fixture_index,
            "providerEligible": eligibility.provider_eligible,
            "localRejectionReason": eligibility.local_rejection_reason,
        }
    )


def google_privacy_safe_record(
    evaluation: SyntheticEvaluation,
    contract: GoogleDocumentAiContract,
) -> JsonObject:
    fixtures = load_frozen_corpus()
    if not 1 <= evaluation.fixture_index <= len(fixtures):
        raise SyntheticQualificationFailure("google_synthetic_fixture_identity_invalid")
    fixture = fixtures[evaluation.fixture_index - 1]
    eligibility = google_fixture_eligibility(fixture)
    if (
        evaluation.page_count != len(fixture.rendered_page_paths)
        or evaluation.document_classes != fixture.document_classes
    ):
        raise SyntheticQualificationFailure("google_synthetic_evaluation_invalid")
    _validate_google_evaluation(evaluation, provider_eligible=eligibility.provider_eligible)
    if eligibility.provider_eligible:
        status = evaluation.status
        local_reason = None
    else:
        status = "locally_rejected"
        local_reason = eligibility.local_rejection_reason
        if (
            evaluation.provider_calls != 0
            or evaluation.retry_count != 0
            or evaluation.failure_code != local_reason
        ):
            raise SyntheticQualificationFailure("google_synthetic_local_rejection_invalid")
    profile_identity = google_benchmark_profile_identity(contract)
    profile_fingerprint = google_benchmark_profile_fingerprint(contract, profile_identity)
    record: JsonObject = {
        "event": GOOGLE_BENCHMARK_EVENT,
        "contractVersion": GOOGLE_SYNTHETIC_CONTRACT_VERSION,
        "benchmarkVersion": GOOGLE_BENCHMARK_VERSION,
        "benchmarkIdentity": profile_identity,
        "benchmarkProfileFingerprint": profile_fingerprint,
        "fixtureIdentityFingerprint": eligibility.fixture_identity_fingerprint,
        "pageIdentityFingerprints": list(eligibility.page_identity_fingerprints),
        "benchmarkRecordFingerprint": _google_benchmark_record_fingerprint(
            profile_fingerprint=profile_fingerprint,
            eligibility=eligibility,
        ),
        "syntheticOnly": True,
        "fixtureIndex": evaluation.fixture_index,
        "documentClasses": list(evaluation.document_classes),
        "providerEligible": eligibility.provider_eligible,
        "localRejectionReason": local_reason,
        "status": status,
        "pageCount": evaluation.page_count,
        "providerCalls": evaluation.provider_calls,
        "retryCount": evaluation.retry_count,
        "latencyMs": evaluation.latency_ms,
        "payloadModes": list(evaluation.payload_modes),
        "metrics": evaluation.metrics,
        "catastrophicErrors": list(evaluation.catastrophic_errors),
        "failureCode": evaluation.failure_code,
    }
    _assert_privacy_safe(record)
    return record


def google_local_rejection_record(
    fixture: FrozenSyntheticFixture,
    contract: GoogleDocumentAiContract,
) -> JsonObject:
    eligibility = google_fixture_eligibility(fixture)
    if eligibility.provider_eligible or eligibility.local_rejection_reason is None:
        raise SyntheticQualificationFailure("google_synthetic_fixture_not_locally_rejected")
    return google_privacy_safe_record(
        failed_synthetic_evaluation(
            fixture,
            provider_calls=0,
            retry_count=0,
            failure_code=eligibility.local_rejection_reason,
        ),
        contract,
    )


def emit_google_synthetic_evaluation(
    evaluation: SyntheticEvaluation,
    contract: GoogleDocumentAiContract,
) -> None:
    payload = google_privacy_safe_record(evaluation, contract)
    payload["timestamp"] = datetime.now(UTC).isoformat(timespec="milliseconds")
    print(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True), flush=True)


def _assert_privacy_safe(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in _PRIVACY_FORBIDDEN_KEYS:
                raise SyntheticQualificationFailure("google_synthetic_telemetry_privacy_violation")
            _assert_privacy_safe(child)
    elif isinstance(value, list):
        for child in value:
            _assert_privacy_safe(child)


def _validate_google_evaluation(
    evaluation: SyntheticEvaluation,
    *,
    provider_eligible: bool,
) -> None:
    if (
        type(evaluation.provider_calls) is not int
        or type(evaluation.retry_count) is not int
        or type(evaluation.latency_ms) is not int
        or evaluation.provider_calls < 0
        or evaluation.retry_count != GOOGLE_MAX_RETRIES
        or evaluation.latency_ms < 0
        or set(evaluation.metrics) != set(METRIC_KEYS)
        or any(
            value is not None
            and (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value < 0
                or value > 1
            )
            for value in evaluation.metrics.values()
        )
        or any(code not in _CATASTROPHIC_ERROR_CODES for code in evaluation.catastrophic_errors)
        or len(set(evaluation.catastrophic_errors)) != len(evaluation.catastrophic_errors)
        or (
            evaluation.failure_code is not None
            and _FAILURE_CODE.fullmatch(evaluation.failure_code) is None
        )
    ):
        raise SyntheticQualificationFailure("google_synthetic_evaluation_invalid")
    if provider_eligible:
        if (
            evaluation.status not in {"success", "failed"}
            or evaluation.provider_calls > evaluation.page_count
            or (
                evaluation.status == "success"
                and (
                    evaluation.provider_calls != evaluation.page_count
                    or evaluation.failure_code is not None
                    or evaluation.payload_modes
                    != (GOOGLE_DOCUMENT_AI_PAYLOAD_MODE,) * evaluation.page_count
                )
            )
            or (
                evaluation.status == "failed"
                and (
                    evaluation.failure_code is None
                    or evaluation.payload_modes
                    or any(value is not None for value in evaluation.metrics.values())
                    or evaluation.catastrophic_errors
                )
            )
        ):
            raise SyntheticQualificationFailure("google_synthetic_evaluation_invalid")
    elif (
        evaluation.status != "failed"
        or evaluation.provider_calls != 0
        or evaluation.payload_modes
        or any(value is not None for value in evaluation.metrics.values())
        or evaluation.catastrophic_errors
    ):
        raise SyntheticQualificationFailure("google_synthetic_evaluation_invalid")


def _validate_google_record_shape(record: JsonObject) -> None:
    keys = set(record)
    if not _GOOGLE_RECORD_KEYS.issubset(keys) or not keys.issubset(
        _GOOGLE_RECORD_KEYS | {"timestamp"}
    ):
        raise SyntheticQualificationFailure("google_synthetic_record_shape_invalid")
    if "timestamp" in record and (
        not isinstance(record["timestamp"], str) or len(record["timestamp"]) > 40
    ):
        raise SyntheticQualificationFailure("google_synthetic_record_shape_invalid")
    metrics = record.get("metrics")
    catastrophic_errors = record.get("catastrophicErrors")
    payload_modes = record.get("payloadModes")
    failure_code = record.get("failureCode")
    status = record.get("status")
    provider_eligible = record.get("providerEligible")
    page_count = record.get("pageCount")
    provider_calls = record.get("providerCalls")
    retry_count = record.get("retryCount")
    latency_ms = record.get("latencyMs")
    if (
        record.get("syntheticOnly") is not True
        or type(record.get("fixtureIndex")) is not int
        or type(provider_eligible) is not bool
        or type(page_count) is not int
        or page_count < 1
        or type(provider_calls) is not int
        or provider_calls < 0
        or provider_calls > page_count
        or type(retry_count) is not int
        or retry_count != GOOGLE_MAX_RETRIES
        or type(latency_ms) is not int
        or latency_ms < 0
        or not isinstance(metrics, dict)
        or set(metrics) != set(METRIC_KEYS)
        or any(
            value is not None
            and (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value < 0
                or value > 1
            )
            for value in metrics.values()
        )
        or not isinstance(catastrophic_errors, list)
        or not all(
            isinstance(code, str) and code in _CATASTROPHIC_ERROR_CODES
            for code in catastrophic_errors
        )
        or len(set(catastrophic_errors)) != len(catastrophic_errors)
        or not isinstance(payload_modes, list)
        or not all(mode == GOOGLE_DOCUMENT_AI_PAYLOAD_MODE for mode in payload_modes)
        or (
            failure_code is not None
            and (
                not isinstance(failure_code, str)
                or _FAILURE_CODE.fullmatch(failure_code) is None
            )
        )
        or (
            status == "success"
            and (
                provider_eligible is not True
                or provider_calls != page_count
                or failure_code is not None
                or len(payload_modes) != page_count
            )
        )
        or (
            status in {"failed", "locally_rejected"}
            and (
                failure_code is None
                or payload_modes
                or any(value is not None for value in metrics.values())
                or catastrophic_errors
            )
        )
        or status not in {"success", "failed", "locally_rejected"}
    ):
        raise SyntheticQualificationFailure("google_synthetic_record_shape_invalid")


def _google_recommendation(
    current: Metrics,
    provider: Metrics,
    records: Sequence[JsonObject],
) -> str:
    if any(record.get("status") != "success" for record in records):
        return "REJECT FOR THIS DOCUMENT CLASS"
    if provider["exactNumericAccuracy"] is None and provider["wordErrorRate"] is None:
        return "REJECT FOR THIS DOCUMENT CLASS"
    if (
        provider["catastrophicBusinessErrorRate"] != 0
        or (provider["signAccuracy"] is not None and provider["signAccuracy"] != 1)
        or (provider["decimalAccuracy"] is not None and provider["decimalAccuracy"] != 1)
        or (provider["dateAccuracy"] is not None and provider["dateAccuracy"] != 1)
    ):
        return "REJECT FOR THIS DOCUMENT CLASS"
    current_numeric = current["exactNumericAccuracy"] or 0
    provider_numeric = provider["exactNumericAccuracy"] or 0
    current_word_error = current["wordErrorRate"]
    provider_word_error = provider["wordErrorRate"]
    word_improvement = (
        (current_word_error - provider_word_error) / current_word_error
        if current_word_error and provider_word_error is not None
        else 0
    )
    if provider_numeric - current_numeric >= 0.05 or word_improvement >= 0.25:
        return "QUALIFIED FOR CONDITIONAL PILOT"
    return "REMAIN SHADOW ONLY"


def _load_baseline() -> dict[str, Metrics]:
    try:
        raw = json.loads(BASELINE_PATH.read_text(encoding="ascii"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SyntheticQualificationFailure("google_synthetic_baseline_invalid") from error
    if not isinstance(raw, dict):
        raise SyntheticQualificationFailure("google_synthetic_baseline_invalid")
    result: dict[str, Metrics] = {}
    by_class = raw.get("byClass")
    if not isinstance(by_class, list):
        raise SyntheticQualificationFailure("google_synthetic_baseline_invalid")
    for item in by_class:
        if not isinstance(item, dict):
            continue
        document_class = item.get("documentClass")
        current = item.get("current")
        if isinstance(document_class, str) and isinstance(current, dict):
            if set(current) != set(METRIC_KEYS):
                raise SyntheticQualificationFailure("google_synthetic_baseline_invalid")
            result[document_class] = {
                key: value if isinstance(value, (int, float)) else None
                for key, value in current.items()
            }
    return result


def aggregate_google_synthetic_records(
    records: Sequence[JsonObject],
    contract: GoogleDocumentAiContract,
) -> JsonObject:
    plan = google_qualification_plan(contract)
    fixtures = load_frozen_corpus()
    if len(records) != FIXTURE_COUNT:
        raise SyntheticQualificationFailure("google_synthetic_record_count_invalid")
    expected_identity = google_benchmark_profile_identity(contract)
    expected_profile_fingerprint = google_benchmark_profile_fingerprint(
        contract,
        expected_identity,
    )
    by_index: dict[int, JsonObject] = {}
    for record in records:
        _validate_google_record_shape(record)
        index = record.get("fixtureIndex")
        if (
            record.get("event") != GOOGLE_BENCHMARK_EVENT
            or record.get("contractVersion") != GOOGLE_SYNTHETIC_CONTRACT_VERSION
            or record.get("benchmarkVersion") != GOOGLE_BENCHMARK_VERSION
            or record.get("benchmarkIdentity") != expected_identity
            or record.get("benchmarkProfileFingerprint") != expected_profile_fingerprint
            or not isinstance(index, int)
            or not 1 <= index <= FIXTURE_COUNT
            or index in by_index
        ):
            raise SyntheticQualificationFailure("google_synthetic_record_invalid")
        fixture = fixtures[index - 1]
        eligibility = google_fixture_eligibility(fixture)
        expected_record_fingerprint = _google_benchmark_record_fingerprint(
            profile_fingerprint=expected_profile_fingerprint,
            eligibility=eligibility,
        )
        if (
            record.get("fixtureIdentityFingerprint")
            != eligibility.fixture_identity_fingerprint
            or record.get("pageIdentityFingerprints")
            != list(eligibility.page_identity_fingerprints)
            or record.get("benchmarkRecordFingerprint")
            != expected_record_fingerprint
            or record.get("documentClasses") != list(fixture.document_classes)
            or record.get("pageCount") != len(fixture.rendered_page_paths)
            or record.get("providerEligible") != eligibility.provider_eligible
            or record.get("localRejectionReason")
            != eligibility.local_rejection_reason
        ):
            raise SyntheticQualificationFailure("google_synthetic_identity_mismatch")
        _assert_privacy_safe(record)
        provider_calls = record.get("providerCalls")
        retries = record.get("retryCount")
        if (
            not isinstance(provider_calls, int)
            or provider_calls < 0
            or not isinstance(retries, int)
            or retries != 0
        ):
            raise SyntheticQualificationFailure("google_synthetic_execution_bound_invalid")
        if eligibility.provider_eligible:
            if record.get("status") not in {"success", "failed"}:
                raise SyntheticQualificationFailure("google_synthetic_status_invalid")
            if provider_calls > len(fixture.rendered_page_paths):
                raise SyntheticQualificationFailure("google_synthetic_execution_bound_invalid")
            if (
                record.get("status") == "success"
                and provider_calls != len(fixture.rendered_page_paths)
            ):
                raise SyntheticQualificationFailure("google_synthetic_execution_bound_invalid")
            if record.get("failureCode") in _AMBIGUOUS_FAILURE_CODES:
                raise SyntheticQualificationFailure("google_synthetic_dispatch_ambiguous")
        elif (
            record.get("status") != "locally_rejected"
            or provider_calls != 0
            or record.get("failureCode") != eligibility.local_rejection_reason
        ):
            raise SyntheticQualificationFailure("google_synthetic_local_rejection_invalid")
        by_index[index] = record

    ordered = [by_index[index] for index in range(1, FIXTURE_COUNT + 1)]
    eligible = [record for record in ordered if record["providerEligible"] is True]
    rejected = [record for record in ordered if record["providerEligible"] is False]
    provider_calls = sum(int(record["providerCalls"]) for record in eligible)
    if provider_calls > GOOGLE_MAX_PROVIDER_ATTEMPTS:
        raise SyntheticQualificationFailure("google_synthetic_provider_bound_exceeded")
    successful = [record for record in eligible if record.get("status") == "success"]
    qualification_complete = (
        len(successful) == GOOGLE_EXPECTED_PROVIDER_DOCUMENTS
        and provider_calls == GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS
    )
    if len(successful) == GOOGLE_EXPECTED_PROVIDER_DOCUMENTS and not qualification_complete:
        raise SyntheticQualificationFailure("google_synthetic_provider_bound_invalid")

    baseline = _load_baseline()
    eligible_fixture_indexes = {fixture.fixture_index for fixture in plan.eligible_fixtures}
    classes = sorted(
        {
            document_class
            for fixture in fixtures
            if fixture.fixture_index in eligible_fixture_indexes
            for document_class in fixture.document_classes
        }
    )
    by_class: list[JsonObject] = []
    for document_class in classes:
        class_records = [
            by_index[fixture.fixture_index]
            for fixture in fixtures
            if fixture.fixture_index in eligible_fixture_indexes
            and document_class in fixture.document_classes
        ]
        current = baseline.get(document_class)
        if current is None:
            raise SyntheticQualificationFailure("google_synthetic_baseline_invalid")
        provider_metrics = _aggregate_metrics(
            [record for record in class_records if record.get("status") == "success"]
        )
        by_class.append(
            {
                "documentClass": document_class,
                "eligibleFixtureCount": len(class_records),
                "successfulFixtureCount": sum(
                    record.get("status") == "success" for record in class_records
                ),
                "current": current,
                "providerMetrics": provider_metrics,
                "recommendation": _google_recommendation(
                    current,
                    provider_metrics,
                    class_records,
                ),
            }
        )

    provider_metrics = _aggregate_metrics(successful)
    latencies = [
        int(record["latencyMs"])
        for record in successful
        if isinstance(record.get("latencyMs"), int)
    ]
    failure_codes = Counter(
        str(record.get("failureCode"))
        for record in eligible
        if record.get("failureCode")
    )
    recommendations = {item["recommendation"] for item in by_class}
    adoption_pass = qualification_complete and recommendations <= {
        "QUALIFIED FOR CONDITIONAL PILOT"
    }
    aggregate: JsonObject = {
        "benchmarkVersion": GOOGLE_BENCHMARK_VERSION,
        "qualificationContractVersion": GOOGLE_SYNTHETIC_CONTRACT_VERSION,
        "benchmarkIdentity": expected_identity,
        "benchmarkProfileFingerprint": expected_profile_fingerprint,
        "fixtureIdentityFingerprints": [
            record["fixtureIdentityFingerprint"] for record in ordered
        ],
        "pageIdentityFingerprints": [
            fingerprint
            for record in ordered
            for fingerprint in record["pageIdentityFingerprints"]
        ],
        "fixtureSourceCommit": FIXTURE_SOURCE_COMMIT,
        "syntheticOnly": True,
        "provider": {
            "name": GOOGLE_DOCUMENT_AI_PROVIDER,
            "profile": GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE,
            "processorType": GOOGLE_DOCUMENT_AI_PROCESSOR_TYPE,
            "processorVersion": contract.processor_version,
        },
        "corpus": {"fixtureCount": FIXTURE_COUNT, "pageCount": PAGE_COUNT},
        "eligibility": {
            "policyVersion": GOOGLE_ELIGIBILITY_POLICY_VERSION,
            "eligibleFixtures": len(eligible),
            "eligiblePages": sum(int(record["pageCount"]) for record in eligible),
            "locallyRejectedFixtures": len(rejected),
            "locallyRejectedPages": sum(int(record["pageCount"]) for record in rejected),
            "localRejections": [
                {
                    "fixtureIndex": int(record["fixtureIndex"]),
                    "reason": record["localRejectionReason"],
                }
                for record in rejected
            ],
        },
        "execution": {
            "serial": True,
            "concurrency": GOOGLE_MAX_CONCURRENCY,
            "providerAttempts": provider_calls,
            "providerAttemptCeiling": GOOGLE_MAX_PROVIDER_ATTEMPTS,
            "retries": 0,
            "retryCeiling": GOOGLE_MAX_RETRIES,
            "ambiguousDispatches": 0,
            "successfulFixtures": len(successful),
            "successfulPages": sum(int(record["pageCount"]) for record in successful),
            "providerFailures": len(eligible) - len(successful),
            "malformedResponses": sum(
                count
                for code, count in failure_codes.items()
                if "malformed" in code
            ),
        },
        "quality": {
            "metrics": provider_metrics,
            "numericTranscriptionAccuracy": provider_metrics["exactNumericAccuracy"],
            "signAccuracy": provider_metrics["signAccuracy"],
            "decimalAccuracy": provider_metrics["decimalAccuracy"],
            "dateAccuracy": provider_metrics["dateAccuracy"],
            "pageAssociationAccuracy": provider_metrics["pageAssociationAccuracy"],
            "textOrderAccuracy": provider_metrics["readingOrderAccuracy"],
            "tableReconstructionAccuracy": provider_metrics[
                "rowReconstructionAccuracy"
            ],
            "missingTextRate": provider_metrics["omittedTextRate"],
            "fabricatedTextRate": provider_metrics["hallucinatedTextRate"],
            "fabricatedCriticalValueCount": sum(
                sum(
                    code == "fabricated_business_value"
                    for code in record.get("catastrophicErrors", [])
                )
                for record in successful
            ),
            "providerFailureRate": (
                (len(eligible) - len(successful)) / len(eligible) if eligible else None
            ),
            "malformedResponseRate": (
                sum(
                    count
                    for code, count in failure_codes.items()
                    if "malformed" in code
                )
                / len(eligible)
                if eligible
                else None
            ),
        },
        "latencyMs": {
            "p50": _percentile(latencies, 0.5),
            "p95": _percentile(latencies, 0.95) if len(latencies) >= 20 else None,
            "p99": _percentile(latencies, 0.99) if len(latencies) >= 100 else None,
        },
        "byClass": by_class,
        "qualificationComplete": qualification_complete,
        "adoptionRecommendation": "passed" if adoption_pass else "failed",
        "costEvidence": {
            "authoritativePricingAvailable": False,
            "observedCostUsd": None,
        },
        "authorityBoundary": {
            "productionEnabled": False,
            "activeIngestionChanged": False,
            "writesBusinessMemory": False,
            "writesEvidence": False,
            "writesKpis": False,
            "entersSnapshot": False,
            "changesBusinessHealth": False,
            "writesTrust": False,
            "writesSavedAnalyses": False,
            "rawContentInTelemetry": False,
            "requiresHumanReview": True,
        },
    }
    _assert_privacy_safe(aggregate)
    return aggregate


def load_google_records(path: Path) -> list[JsonObject]:
    records: list[JsonObject] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip():
            continue
        try:
            value = json.loads(raw_line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("event") == GOOGLE_BENCHMARK_EVENT:
            records.append(value)
    return records


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-number", required=True)
    parser.add_argument("--processor-id", required=True)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("verify")
    subparsers.add_parser("local-rejections")
    aggregate = subparsers.add_parser("aggregate")
    aggregate.add_argument("log_file", type=Path)
    arguments = parser.parse_args()
    contract = GoogleDocumentAiContract(
        project_number=str(arguments.project_number),
        processor_id=str(arguments.processor_id),
    )
    plan = google_qualification_plan(contract)
    if arguments.command == "verify":
        result: object = {
            "ok": True,
            "benchmarkVersion": GOOGLE_BENCHMARK_VERSION,
            "benchmarkProfileFingerprint": plan.benchmark_profile_fingerprint,
            "sourceCommit": FIXTURE_SOURCE_COMMIT,
            "corpusSha256": FIXTURE_CORPUS_SHA256,
            "fixtureCount": FIXTURE_COUNT,
            "pageCount": PAGE_COUNT,
            "locallyRejectedFixtures": len(plan.local_rejections),
            "providerEligibleDocuments": len(plan.eligible_fixtures),
            "providerEligiblePages": plan.eligible_page_count,
            "providerAttemptCeiling": plan.provider_attempt_ceiling,
            "retryCeiling": plan.retry_ceiling,
            "concurrency": plan.concurrency,
        }
        print(json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=True))
    elif arguments.command == "local-rejections":
        for decision in plan.local_rejections:
            fixture = load_frozen_corpus()[decision.fixture_index - 1]
            print(
                json.dumps(
                    google_local_rejection_record(fixture, contract),
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=True,
                )
            )
    else:
        result = aggregate_google_synthetic_records(
            load_google_records(arguments.log_file),
            contract,
        )
        print(json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
