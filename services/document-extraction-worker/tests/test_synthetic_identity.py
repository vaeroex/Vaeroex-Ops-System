from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest

from vaeroex_document_worker.synthetic import (
    BENCHMARK_EVENT,
    BENCHMARK_VERSION,
    SYNTHETIC_CONTRACT_VERSION,
    SyntheticQualificationFailure,
    _benchmark_record_fingerprint,
    aggregate_synthetic_records,
    benchmark_profile_fingerprint,
    failed_synthetic_evaluation,
    load_frozen_corpus,
)


def _records() -> list[dict[str, Any]]:
    return [
        failed_synthetic_evaluation(
            fixture,
            provider_calls=0,
            retry_count=0,
            failure_code="provider_not_called",
        ).privacy_safe_record()
        for fixture in load_frozen_corpus()
    ]


def _rebind_record(record: dict[str, Any]) -> None:
    identity = record["benchmarkIdentity"]
    profile_fingerprint = benchmark_profile_fingerprint(identity)
    record["benchmarkProfileFingerprint"] = profile_fingerprint
    record["benchmarkRecordFingerprint"] = _benchmark_record_fingerprint(
        profile_fingerprint=profile_fingerprint,
        fixture_identity_fingerprint=record["fixtureIdentityFingerprint"],
        fixture_index=record["fixtureIndex"],
        page_count=record["pageCount"],
    )


def test_profile_bound_records_aggregate_when_every_identity_matches() -> None:
    records = _records()
    aggregate = aggregate_synthetic_records(records)

    assert aggregate["benchmarkVersion"] == BENCHMARK_VERSION
    assert aggregate["qualificationContractVersion"] == SYNTHETIC_CONTRACT_VERSION
    assert aggregate["benchmarkProfileFingerprint"] == records[0]["benchmarkProfileFingerprint"]
    assert aggregate["fixtureIdentityFingerprints"] == [
        record["fixtureIdentityFingerprint"] for record in records
    ]


@pytest.mark.parametrize(
    ("field", "historical_value"),
    (
        ("parserRevision", "nemotron_parse_hosted_tool_call_rest_v1"),
        ("clientRevision", "vaeroex_nemotron_parse_rest_v1"),
        ("providerProfile", "hosted_tool_call"),
        ("endpointContractVersion", "nvidia_build_nemotron_parse_hosted_tool_call_v1"),
        ("requestSerializerVersion", "nemotron_parse_hosted_request_v0"),
        ("responseValidatorVersion", "nemotron_parse_hosted_response_v1"),
        ("normalizationVersion", "nemotron_parse_hosted_normalization_v0"),
        ("compatibilityPolicyVersion", "hosted_tool_call_v1"),
        ("modelAlias", "nvidia/nemotron-parse-v1"),
    ),
)
def test_one_different_provider_identity_record_fails_closed(
    field: str,
    historical_value: str,
) -> None:
    records = _records()
    records[4] = deepcopy(records[4])
    records[4]["benchmarkIdentity"][field] = historical_value
    _rebind_record(records[4])

    with pytest.raises(SyntheticQualificationFailure, match="record_invalid"):
        aggregate_synthetic_records(records)


def test_fixture_corpus_mismatch_fails_even_with_self_consistent_fingerprints() -> None:
    records = _records()
    records[2] = deepcopy(records[2])
    records[2]["benchmarkIdentity"]["fixtureCorpusIdentity"]["corpusSha256"] = "f" * 64
    _rebind_record(records[2])

    with pytest.raises(SyntheticQualificationFailure, match="record_invalid"):
        aggregate_synthetic_records(records)


def test_fixture_or_page_identity_substitution_fails_closed() -> None:
    records = _records()
    records[1] = deepcopy(records[1])
    records[1]["fixtureIdentityFingerprint"] = records[0]["fixtureIdentityFingerprint"]
    _rebind_record(records[1])

    with pytest.raises(SyntheticQualificationFailure, match="identity_mismatch"):
        aggregate_synthetic_records(records)


def test_historical_v1_records_are_not_reclassified_as_v2() -> None:
    records = _records()
    records[0] = deepcopy(records[0])
    records[0]["event"] = "document_extraction_synthetic_fixture_v1"
    records[0]["contractVersion"] = "document_extraction_phase_c1_synthetic_v1"
    records[0]["benchmarkVersion"] = "document_intelligence_benchmark_v1"

    with pytest.raises(SyntheticQualificationFailure, match="record_invalid"):
        aggregate_synthetic_records(records)


def test_privacy_safe_identity_contains_no_content_bearing_fields() -> None:
    record = _records()[0]
    serialized_keys = set()

    def visit(value: object) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                serialized_keys.add(key)
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(record)
    assert record["event"] == BENCHMARK_EVENT
    assert not serialized_keys.intersection(
        {
            "documentText",
            "extractedValues",
            "coordinates",
            "rawProviderOutput",
            "workspaceId",
            "customerId",
            "credential",
            "prompt",
            "imageBytes",
        }
    )
