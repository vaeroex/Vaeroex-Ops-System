from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from typing import Any

import pytest

from vaeroex_document_worker.google_document_ai_adapter import (
    GOOGLE_DOCUMENT_AI_PAYLOAD_MODE,
)
from vaeroex_document_worker.google_document_ai_contract import (
    GOOGLE_DOCUMENT_AI_PROVIDER,
    GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE,
    GoogleDocumentAiContract,
)
from vaeroex_document_worker.google_synthetic import (
    GOOGLE_BENCHMARK_EVENT,
    GOOGLE_BENCHMARK_VERSION,
    GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS,
    GOOGLE_LOCAL_REJECTION_POLICY,
    GOOGLE_MAX_CONCURRENCY,
    GOOGLE_MAX_PROVIDER_ATTEMPTS,
    GOOGLE_MAX_RETRIES,
    GOOGLE_SYNTHETIC_CONTRACT_VERSION,
    _google_benchmark_record_fingerprint,
    aggregate_google_synthetic_records,
    authorize_google_provider_reservation,
    google_benchmark_profile_fingerprint,
    google_fixture_eligibility,
    google_local_rejection_record,
    google_privacy_safe_record,
    google_qualification_plan,
)
from vaeroex_document_worker.synthetic import (
    BENCHMARK_EVENT,
    BENCHMARK_VERSION,
    METRIC_KEYS,
    Metrics,
    SYNTHETIC_CONTRACT_VERSION,
    SyntheticEvaluation,
    SyntheticQualificationFailure,
    _canonical_fingerprint,
    aggregate_synthetic_records,
    failed_synthetic_evaluation,
    load_frozen_corpus,
)


def contract() -> GoogleDocumentAiContract:
    return GoogleDocumentAiContract(
        project_number="123456789012",
        processor_id="0123456789abcdef",
    )


def _success(fixture_index: int) -> SyntheticEvaluation:
    fixture = load_frozen_corpus()[fixture_index - 1]
    metrics: Metrics = {
        key: (
            0.0
            if key
            in {
                "characterErrorRate",
                "wordErrorRate",
                "hallucinatedTextRate",
                "omittedTextRate",
                "duplicatedTextRate",
                "catastrophicBusinessErrorRate",
            }
            else 1.0
        )
        for key in METRIC_KEYS
    }
    return SyntheticEvaluation(
        fixture_index=fixture.fixture_index,
        document_classes=fixture.document_classes,
        status="success",
        page_count=len(fixture.rendered_page_paths),
        provider_calls=len(fixture.rendered_page_paths),
        retry_count=0,
        latency_ms=100 + fixture.fixture_index,
        payload_modes=(GOOGLE_DOCUMENT_AI_PAYLOAD_MODE,)
        * len(fixture.rendered_page_paths),
        metrics=metrics,
        catastrophic_errors=(),
        failure_code=None,
    )


def _records() -> list[dict[str, Any]]:
    active_contract = contract()
    records: list[dict[str, Any]] = []
    for fixture in load_frozen_corpus():
        eligibility = google_fixture_eligibility(fixture)
        records.append(
            google_privacy_safe_record(_success(fixture.fixture_index), active_contract)
            if eligibility.provider_eligible
            else google_local_rejection_record(fixture, active_contract)
        )
    return records


def _historical_records() -> list[dict[str, Any]]:
    return [
        failed_synthetic_evaluation(
            fixture,
            provider_calls=0,
            retry_count=0,
            failure_code="provider_not_called",
        ).privacy_safe_record()
        for fixture in load_frozen_corpus()
    ]


def _rebind_google_record(record: dict[str, Any]) -> None:
    profile_fingerprint = _canonical_fingerprint(record["benchmarkIdentity"])
    record["benchmarkProfileFingerprint"] = profile_fingerprint
    fixture = load_frozen_corpus()[int(record["fixtureIndex"]) - 1]
    eligibility = google_fixture_eligibility(fixture)
    record["benchmarkRecordFingerprint"] = _google_benchmark_record_fingerprint(
        profile_fingerprint=profile_fingerprint,
        eligibility=eligibility,
    )


def test_google_plan_binds_exact_identity_eligibility_and_bounds() -> None:
    active_contract = contract()
    plan = google_qualification_plan(active_contract)

    assert len(plan.eligible_fixtures) == 8
    assert len(plan.local_rejections) == 4
    assert plan.eligible_page_count == GOOGLE_EXPECTED_PROVIDER_PAGE_CALLS == 9
    assert plan.provider_attempt_ceiling == GOOGLE_MAX_PROVIDER_ATTEMPTS == 9
    assert plan.retry_ceiling == GOOGLE_MAX_RETRIES == 0
    assert plan.concurrency == GOOGLE_MAX_CONCURRENCY == 1
    assert [item.fixture_index for item in plan.local_rejections] == [5, 8, 9, 12]
    assert [fixture.fixture_index for fixture in plan.eligible_fixtures] == [
        1,
        2,
        3,
        4,
        6,
        7,
        10,
        11,
    ]
    assert plan.benchmark_profile_fingerprint == google_benchmark_profile_fingerprint(
        active_contract
    )


def test_google_unsupported_fixtures_are_removed_before_job_or_grant_planning() -> None:
    plan = google_qualification_plan(contract())
    claimable = {fixture.fixture_index for fixture in plan.eligible_fixtures}
    claims = file_grants = reservations = provider_calls = 0

    for fixture in load_frozen_corpus():
        if fixture.fixture_index in claimable:
            claims += 1
            file_grants += 1
            reservations += len(fixture.rendered_page_paths)
            provider_calls += len(fixture.rendered_page_paths)
        else:
            decision = google_fixture_eligibility(fixture)
            assert decision.local_rejection_reason == GOOGLE_LOCAL_REJECTION_POLICY[
                fixture.document_id
            ][1]

    assert claims == 8
    assert file_grants == 8
    assert reservations == provider_calls == 9
    assert all(index not in claimable for index in (5, 8, 9, 12))


def test_google_fixture_identity_change_fails_closed() -> None:
    fixture = load_frozen_corpus()[4]
    with pytest.raises(SyntheticQualificationFailure, match="identity_invalid"):
        google_fixture_eligibility(
            replace(fixture, document_id="synthetic-doc-substituted")
        )


@pytest.mark.parametrize(
    ("field", "wrong_value"),
    (
        ("provider", "nvidia"),
        ("providerProfile", "hosted_tool_call_v2"),
        ("processorType", "FORM_PARSER_PROCESSOR"),
        ("processorId", "fedcba9876543210"),
        ("processorLocation", "eu"),
        ("processorVersion", "pretrained-ocr-v3"),
        ("benchmarkVersion", "google_document_intelligence_benchmark_profile_v2"),
        ("modelIdentity", "pretrained-ocr-v3"),
        ("endpointContractVersion", "google_document_ai_processor_version_process_v2"),
        ("requestSerializerVersion", "google_document_ai_process_request_v2"),
        ("responseValidatorVersion", "google_document_ai_process_response_v3"),
        ("normalizationVersion", "google_document_ai_layout_normalization_v3"),
        ("routingPolicyVersion", "document_extraction_routing_v2"),
        ("compatibilityPolicyVersion", "google_document_ai_permissive_v1"),
        ("reviewProvenanceVersion", "document_extraction_review_provenance_v1"),
    ),
)
def test_google_identity_mismatch_fails_even_when_record_is_self_consistent(
    field: str,
    wrong_value: str,
) -> None:
    records = _records()
    records[0] = deepcopy(records[0])
    records[0]["benchmarkIdentity"][field] = wrong_value
    _rebind_google_record(records[0])

    with pytest.raises(SyntheticQualificationFailure, match="record_invalid"):
        aggregate_google_synthetic_records(records, contract())


def test_google_records_aggregate_with_provider_neutral_reporting() -> None:
    aggregate = aggregate_google_synthetic_records(_records(), contract())

    assert aggregate["benchmarkVersion"] == GOOGLE_BENCHMARK_VERSION
    assert aggregate["qualificationContractVersion"] == GOOGLE_SYNTHETIC_CONTRACT_VERSION
    assert aggregate["provider"] == {
        "name": GOOGLE_DOCUMENT_AI_PROVIDER,
        "profile": GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE,
        "processorType": "OCR_PROCESSOR",
        "processorVersion": "pretrained-ocr-v2.1-2024-08-07",
    }
    assert aggregate["eligibility"]["eligibleFixtures"] == 8
    assert aggregate["eligibility"]["eligiblePages"] == 9
    assert aggregate["eligibility"]["locallyRejectedFixtures"] == 4
    assert aggregate["execution"]["providerAttempts"] == 9
    assert aggregate["execution"]["providerAttemptCeiling"] == 9
    assert aggregate["execution"]["retries"] == 0
    assert aggregate["execution"]["ambiguousDispatches"] == 0
    assert aggregate["qualificationComplete"] is True
    assert aggregate["latencyMs"]["p50"] is not None
    assert aggregate["latencyMs"]["p95"] is None
    assert aggregate["latencyMs"]["p99"] is None
    serialized = str(aggregate).lower()
    assert "successfulnvidiafixtures" not in serialized
    assert "nvidiaaggregate" not in serialized


def test_historical_nvidia_record_and_aggregate_shape_remain_unchanged() -> None:
    records = _historical_records()
    aggregate = aggregate_synthetic_records(records)

    assert records[0]["event"] == BENCHMARK_EVENT
    assert records[0]["contractVersion"] == SYNTHETIC_CONTRACT_VERSION
    assert records[0]["benchmarkVersion"] == BENCHMARK_VERSION
    assert "provider" not in records[0]["benchmarkIdentity"]
    assert "nvidiaAggregate" in aggregate
    assert "successfulNvidiaFixtures" in aggregate["byClass"][0]


def test_google_and_historical_nvidia_records_cannot_cross_aggregate_boundaries() -> None:
    google_records = _records()
    historical_records = _historical_records()
    google_records[0] = historical_records[0]
    with pytest.raises(SyntheticQualificationFailure, match="record_shape_invalid"):
        aggregate_google_synthetic_records(google_records, contract())

    historical_records[0] = _records()[0]
    with pytest.raises(SyntheticQualificationFailure, match="record_invalid"):
        aggregate_synthetic_records(historical_records)


def test_missing_duplicate_and_substituted_google_records_fail_closed() -> None:
    records = _records()
    with pytest.raises(SyntheticQualificationFailure, match="record_count_invalid"):
        aggregate_google_synthetic_records(records[:-1], contract())

    duplicate = records[:-1] + [deepcopy(records[0])]
    with pytest.raises(SyntheticQualificationFailure, match="record_invalid"):
        aggregate_google_synthetic_records(duplicate, contract())

    substituted = deepcopy(records)
    substituted[0]["pageIdentityFingerprints"] = substituted[1][
        "pageIdentityFingerprints"
    ]
    with pytest.raises(SyntheticQualificationFailure, match="identity_mismatch"):
        aggregate_google_synthetic_records(substituted, contract())


def test_google_attempt_retry_ambiguity_and_concurrency_bounds_fail_closed() -> None:
    authorize_google_provider_reservation(
        prior_provider_attempts=8,
        requested_pages=1,
        retry_count=0,
        active_concurrency=1,
    )
    for arguments in (
        {
            "prior_provider_attempts": 9,
            "requested_pages": 1,
            "retry_count": 0,
            "active_concurrency": 1,
        },
        {
            "prior_provider_attempts": 0,
            "requested_pages": 1,
            "retry_count": 1,
            "active_concurrency": 1,
        },
        {
            "prior_provider_attempts": 0,
            "requested_pages": 1,
            "retry_count": 0,
            "active_concurrency": 2,
        },
    ):
        with pytest.raises(SyntheticQualificationFailure, match="bound_exceeded"):
            authorize_google_provider_reservation(**arguments)

    records = _records()
    records[0] = google_privacy_safe_record(
        failed_synthetic_evaluation(
            load_frozen_corpus()[0],
            provider_calls=1,
            retry_count=0,
            failure_code="google_document_ai_dispatch_ambiguous",
        ),
        contract(),
    )
    with pytest.raises(SyntheticQualificationFailure, match="dispatch_ambiguous"):
        aggregate_google_synthetic_records(records, contract())


@pytest.mark.parametrize(
    "evaluation",
    (
        replace(_success(1), retry_count=1),
        replace(_success(1), payload_modes=("unexpected_payload_mode",)),
        replace(_success(1), provider_calls=0),
        replace(_success(1), failure_code="provider_failed"),
    ),
)
def test_google_record_emission_rejects_invalid_execution_evidence(
    evaluation: SyntheticEvaluation,
) -> None:
    with pytest.raises(SyntheticQualificationFailure, match="evaluation_invalid"):
        google_privacy_safe_record(evaluation, contract())


def test_unsupported_fixture_execution_and_tenth_call_fail_closed() -> None:
    records = _records()
    records[4] = deepcopy(records[4])
    records[4]["providerCalls"] = 1
    with pytest.raises(SyntheticQualificationFailure, match="local_rejection_invalid"):
        aggregate_google_synthetic_records(records, contract())

    records = _records()
    records[0] = deepcopy(records[0])
    records[0]["providerCalls"] = 2
    with pytest.raises(SyntheticQualificationFailure, match="record_shape_invalid"):
        aggregate_google_synthetic_records(records, contract())


def test_google_telemetry_contains_only_content_free_synthetic_evidence() -> None:
    records = _records()
    aggregate = aggregate_google_synthetic_records(records, contract())
    keys: set[str] = set()

    def visit(value: object) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                keys.add(str(key))
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(records)
    visit(aggregate)
    assert not keys.intersection(
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

    tampered = deepcopy(records)
    tampered[0]["rawResponse"] = "forbidden"
    with pytest.raises(SyntheticQualificationFailure, match="record_shape_invalid"):
        aggregate_google_synthetic_records(tampered, contract())


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("syntheticOnly", False),
        ("retryCount", 1),
        ("latencyMs", -1),
        ("payloadModes", []),
        ("failureCode", "provider_failed"),
    ),
)
def test_google_aggregate_revalidates_emitted_record_invariants(
    field: str,
    value: object,
) -> None:
    records = _records()
    records[0] = deepcopy(records[0])
    records[0][field] = value

    with pytest.raises(SyntheticQualificationFailure, match="record_shape_invalid"):
        aggregate_google_synthetic_records(records, contract())

    records = _records()
    records[0] = deepcopy(records[0])
    records[0]["metrics"]["exactNumericAccuracy"] = 1.01
    with pytest.raises(SyntheticQualificationFailure, match="record_shape_invalid"):
        aggregate_google_synthetic_records(records, contract())
