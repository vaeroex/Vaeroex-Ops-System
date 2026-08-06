from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from PIL import Image

from vaeroex_document_worker.google_document_ai_adapter import (
    GOOGLE_DOCUMENT_AI_PAYLOAD_MODE,
    MAX_GOOGLE_DOCUMENT_AI_RESPONSE_BYTES,
    MAX_RENDERED_PAGE_BYTES,
    MAX_RENDERED_WIDTH,
    GoogleDocumentAiRestAdapter,
    google_document_ai_request_binding,
    invoke_google_document_ai_adapter,
    normalize_google_document_ai_response,
    serialize_google_document_ai_request,
)
from vaeroex_document_worker.google_document_ai_contract import (
    GOOGLE_DOCUMENT_AI_FIELD_MASK,
    GOOGLE_DOCUMENT_AI_MAX_PAGES,
    GOOGLE_DOCUMENT_AI_MAX_SOURCE_BYTES,
    GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION,
    GoogleDocumentAiContract,
)
from vaeroex_document_worker.provider_contract import (
    HOSTED_CONTRACT,
    active_provider_contract,
)
from vaeroex_document_worker.provider_types import ProviderFailure, RenderedPage


def contract(
    *,
    processor_id: str = "0123456789abcdef",
) -> GoogleDocumentAiContract:
    return GoogleDocumentAiContract(
        project_number="123456789012",
        processor_id=processor_id,
    )


def rendered_page(tmp_path: Path, *, page_number: int = 1) -> RenderedPage:
    path = tmp_path / f"page-{page_number}.png"
    image = Image.new("RGB", (120, 160), "white")
    image.save(path, "PNG")
    image.close()
    content = path.read_bytes()
    return RenderedPage(
        page=page_number,
        path=path,
        mime_type="image/png",
        width=120,
        height=160,
        byte_length=len(content),
        content_sha256=hashlib.sha256(content).hexdigest(),
    )


def _vertices(x1: float, y1: float, x2: float, y2: float) -> list[dict[str, float]]:
    return [
        {"x": x1, "y": y1},
        {"x": x2, "y": y1},
        {"x": x2, "y": y2},
        {"x": x1, "y": y2},
    ]


def _layout(
    start: int,
    end: int,
    coordinates: tuple[float, float, float, float],
    *,
    confidence: float = 0.9,
) -> dict[str, Any]:
    return {
        "boundingPoly": {"normalizedVertices": _vertices(*coordinates)},
        "confidence": confidence,
        "orientation": "PAGE_UP",
        "textAnchor": {
            "textSegments": [{"startIndex": str(start), "endIndex": str(end)}]
        },
    }


def _language() -> list[dict[str, object]]:
    return [{"languageCode": "en", "confidence": 0.98}]


def _annotation(
    start: int,
    end: int,
    coordinates: tuple[float, float, float, float],
    *,
    confidence: float = 0.9,
) -> dict[str, Any]:
    return {
        "detectedLanguages": _language(),
        "layout": _layout(start, end, coordinates, confidence=confidence),
    }


def process_response() -> dict[str, Any]:
    text = "Heading\nMetric Value\nFooter\n"
    annotations = [
        _annotation(0, 8, (0.1, 0.1, 0.8, 0.2)),
        _annotation(8, 21, (0.1, 0.3, 0.8, 0.4)),
        _annotation(21, 28, (0.1, 0.7, 0.8, 0.8)),
    ]
    return {
        "document": {
            "mimeType": "image/png",
            "pages": [
                {
                    "pageNumber": 1,
                    "layout": _layout(0, 28, (0.02, 0.02, 0.98, 0.98)),
                    "detectedLanguages": _language(),
                    "blocks": annotations,
                    "paragraphs": annotations,
                    "lines": annotations,
                    "tokens": [
                        {
                            **_annotation(0, 7, (0.1, 0.1, 0.8, 0.2)),
                            "detectedBreak": {"type": "SPACE"},
                        },
                        {
                            **_annotation(8, 14, (0.1, 0.3, 0.4, 0.4)),
                            "detectedBreak": {"type": "SPACE"},
                        },
                        {
                            **_annotation(15, 20, (0.45, 0.3, 0.8, 0.4)),
                            "detectedBreak": {"type": "SPACE"},
                        },
                        {
                            **_annotation(21, 27, (0.1, 0.7, 0.8, 0.8)),
                            "detectedBreak": {"type": "SPACE"},
                        },
                    ],
                    "tables": [
                        {
                            "layout": _layout(8, 21, (0.05, 0.25, 0.9, 0.5)),
                            "detectedLanguages": _language(),
                            "headerRows": [],
                            "bodyRows": [
                                {
                                    "cells": [
                                        {
                                            "layout": _layout(8, 14, (0.1, 0.3, 0.4, 0.4)),
                                            "rowSpan": 1,
                                            "colSpan": 1,
                                            "detectedLanguages": _language(),
                                        },
                                        {
                                            "layout": _layout(15, 20, (0.45, 0.3, 0.8, 0.4)),
                                            "rowSpan": 1,
                                            "colSpan": 1,
                                            "detectedLanguages": _language(),
                                        },
                                    ]
                                }
                            ],
                        }
                    ],
                    "imageQualityScores": {
                        "qualityScore": 0.92,
                        "detectedDefects": [
                            {"type": "quality/defect_faint", "confidence": 0.1}
                        ],
                    },
                }
            ],
            "text": text,
        },
        "humanReviewStatus": {
            "state": "HUMAN_REVIEW_SKIPPED",
            "stateMessage": "",
        },
    }


def response_bytes(value: dict[str, Any] | None = None) -> bytes:
    return json.dumps(
        process_response() if value is None else value,
        separators=(",", ":"),
    ).encode("utf-8")


def test_google_document_ai_adapter_is_inert_and_not_selected_by_runner() -> None:
    assert active_provider_contract() is HOSTED_CONTRACT


def test_contract_pins_exact_processor_version_and_regional_resource() -> None:
    approved = contract()
    assert approved.processor_version == GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION
    assert approved.processor_resource == (
        "projects/123456789012/locations/us/processors/0123456789abcdef/"
        "processorVersions/pretrained-ocr-v2.1-2024-08-07"
    )
    assert approved.endpoint == (
        "https://us-documentai.googleapis.com/v1/"
        f"{approved.processor_resource}:process"
    )

    with pytest.raises(ValueError, match="contract_unapproved"):
        replace(approved, processor_version="pretrained-ocr-v2.1.1-2025-01-31")


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("location", "eu"),
        ("provider_profile", "google_document_ai_enterprise_ocr_v2"),
        ("response_validator_version", "google_document_ai_process_response_v3"),
        ("normalization_version", "google_document_ai_layout_normalization_v3"),
        ("compatibility_policy_version", "google_document_ai_permissive_v1"),
    ),
)
def test_contract_rejects_wrong_region_profile_or_version(
    field: str,
    value: str,
) -> None:
    with pytest.raises(ValueError, match="google_document_ai_contract_unapproved"):
        replace(contract(), **{field: value})


def test_contract_rejects_invalid_processor_and_pins_conservative_limits() -> None:
    with pytest.raises(ValueError, match="google_document_ai_processor_id_invalid"):
        contract(processor_id="not-a-processor")
    assert GOOGLE_DOCUMENT_AI_MAX_PAGES == 15
    assert GOOGLE_DOCUMENT_AI_MAX_SOURCE_BYTES == 25_000_000


def test_request_is_imageless_inline_and_contains_no_customer_labels_or_credentials(
    tmp_path: Path,
) -> None:
    page = rendered_page(tmp_path)
    page_bytes = page.path.read_bytes()
    payload = json.loads(serialize_google_document_ai_request(page, page_bytes))

    assert payload == {
        "fieldMask": GOOGLE_DOCUMENT_AI_FIELD_MASK,
        "imagelessMode": True,
        "processOptions": {
            "ocrConfig": {
                "enableImageQualityScores": True,
                "enableNativePdfParsing": False,
                "enableSymbol": False,
                "premiumFeatures": {
                    "computeStyleInfo": False,
                    "enableMathOcr": False,
                    "enableSelectionMarkDetection": False,
                },
            }
        },
        "rawDocument": {
            "content": base64.b64encode(page_bytes).decode("ascii"),
            "mimeType": "image/png",
        },
    }
    assert "labels" not in payload
    assert "skipHumanReview" not in payload


def test_request_identity_binds_processor_profile_and_document_without_token(
    tmp_path: Path,
) -> None:
    page = rendered_page(tmp_path)
    first = google_document_ai_request_binding(contract(), page, "d" * 64)
    repeated = google_document_ai_request_binding(contract(), page, "d" * 64)
    other_processor = google_document_ai_request_binding(
        contract(processor_id="fedcba9876543210"),
        page,
        "d" * 64,
    )

    assert first.fingerprint() == repeated.fingerprint()
    assert first.fingerprint() != other_processor.fingerprint()
    assert first.payload_mode == GOOGLE_DOCUMENT_AI_PAYLOAD_MODE
    assert first.processor_version == GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION
    serialized_binding = json.dumps(first.__dict__).lower()
    assert "access_token" not in serialized_binding
    assert "authorization" not in serialized_binding


def test_strict_response_normalizes_tables_and_excludes_duplicate_table_lines(
    tmp_path: Path,
) -> None:
    normalized = normalize_google_document_ai_response(
        contract(),
        rendered_page(tmp_path),
        response_bytes(),
    )

    assert [block["kind"] for block in normalized["blocks"]] == [
        "text",
        "table",
        "text",
    ]
    assert [block["text"] for block in normalized["blocks"]] == [
        "Heading",
        "Metric Value",
        "Footer",
    ]
    structure = normalized["structure"]
    assert structure["structureVersion"] == "provider_neutral_document_structure_v1"
    assert len(structure["blocks"]) == 3
    assert len(structure["paragraphs"]) == 3
    assert len(structure["lines"]) == 3
    assert len(structure["tokens"]) == 4
    assert structure["tokens"][1]["layout"]["text"] == "Metric"
    assert structure["tables"][0]["bodyRows"][0]["cells"][1]["layout"]["text"] == "Value"
    assert structure["detectedLanguages"] == [
        {"languageCode": "en", "confidence": 0.98}
    ]
    assert structure["pageLayout"]["orientation"] == "PAGE_UP"
    assert structure["imageQuality"] == {
        "qualityScore": 0.92,
        "detectedDefects": [
            {"type": "quality/defect_faint", "confidence": 0.1}
        ],
    }
    assert structure["selectionMarks"] == []


def test_provider_confidence_is_preserved_only_as_review_metadata(tmp_path: Path) -> None:
    page = rendered_page(tmp_path)
    low = process_response()
    high = process_response()
    low["document"]["pages"][0]["lines"][0]["layout"]["confidence"] = 0.01
    high["document"]["pages"][0]["lines"][0]["layout"]["confidence"] = 0.99

    low_result = normalize_google_document_ai_response(contract(), page, response_bytes(low))
    high_result = normalize_google_document_ai_response(contract(), page, response_bytes(high))

    assert low_result["blocks"] == high_result["blocks"]
    assert low_result["structure"]["lines"][0]["layout"]["confidence"] == 0.01
    assert high_result["structure"]["lines"][0]["layout"]["confidence"] == 0.99


def test_documented_pixel_vertices_may_accompany_required_normalized_vertices(
    tmp_path: Path,
) -> None:
    response = process_response()
    bounding_poly = response["document"]["pages"][0]["lines"][0]["layout"][
        "boundingPoly"
    ]
    bounding_poly["vertices"] = [
        {},
        {"x": 120},
        {"x": 120, "y": 160},
        {"y": 160},
    ]

    normalized = normalize_google_document_ai_response(
        contract(),
        rendered_page(tmp_path),
        response_bytes(response),
    )
    assert normalized["blocks"][0]["coordinates"]["x"] == 0.1


def test_single_request_uses_bearer_workload_token_and_normalizes_only_draft_output(
    tmp_path: Path,
) -> None:
    calls = 0
    boundaries: list[str] = []
    token = "memory-only-access-token"

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.url == contract().endpoint
        assert request.headers["Authorization"] == f"Bearer {token}"
        assert request.headers["Content-Type"] == "application/json"
        return httpx.Response(
            200,
            content=response_bytes(),
            headers={"Content-Type": "application/json"},
        )

    result = invoke_google_document_ai_adapter(
        [rendered_page(tmp_path)],
        "d" * 64,
        contract(),
        lambda: token,
        transport=httpx.MockTransport(handler),
        before_provider_boundary=boundaries.append,
    )

    assert calls == 1
    assert boundaries == ["inference"]
    assert result.payload_modes == (GOOGLE_DOCUMENT_AI_PAYLOAD_MODE,)
    assert len(result.request_contract_hashes) == 1
    assert result.pages[0]["blocks"][1]["kind"] == "table"
    assert set(result.pages[0]) == {"page", "blocks", "structure"}


def test_adapter_has_no_internal_retry(tmp_path: Path) -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503, json={"error": {"status": "UNAVAILABLE"}})

    with pytest.raises(ProviderFailure) as caught:
        invoke_google_document_ai_adapter(
            [rendered_page(tmp_path)],
            "d" * 64,
            contract(),
            lambda: "token",
            transport=httpx.MockTransport(handler),
        )
    assert calls == 1
    assert caught.value.code == "google_document_ai_unavailable"
    assert caught.value.retryable


def test_page_reservation_and_outcome_callbacks_are_strictly_serial(
    tmp_path: Path,
) -> None:
    first = rendered_page(tmp_path, page_number=1)
    second_directory = tmp_path / "second-page"
    second_directory.mkdir()
    second = rendered_page(second_directory, page_number=2)
    events: list[tuple[object, ...]] = []
    next_page = 0

    def boundary(boundary_name: str) -> None:
        nonlocal next_page
        next_page += 1
        events.append(("reservation", next_page, boundary_name))

    def outcome(
        page_index: int,
        succeeded: bool,
        result_class: str,
        provider_request_started: bool,
    ) -> None:
        events.append(
            (
                "outcome",
                page_index,
                succeeded,
                result_class,
                provider_request_started,
            )
        )

    def handler(_request: httpx.Request) -> httpx.Response:
        page_number = 1 + sum(1 for event in events if event[0] == "outcome")
        response = process_response()
        events.append(("network", page_number))
        return httpx.Response(
            200,
            content=response_bytes(response),
            headers={"Content-Type": "application/json"},
        )

    result = invoke_google_document_ai_adapter(
        [first, second],
        "d" * 64,
        contract(),
        lambda: "token",
        transport=httpx.MockTransport(handler),
        before_provider_boundary=boundary,
        provider_page_outcome=outcome,
    )

    assert len(result.pages) == 2
    assert events == [
        ("reservation", 1, "inference"),
        ("network", 1),
        ("outcome", 1, True, "success", True),
        ("reservation", 2, "inference"),
        ("network", 2),
        ("outcome", 2, True, "success", True),
    ]


def test_reserved_page_records_pre_network_token_failure(
    tmp_path: Path,
) -> None:
    calls = 0
    boundaries: list[str] = []
    outcomes: list[tuple[int, bool, str, bool]] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=response_bytes())

    def token_provider() -> str:
        raise RuntimeError("credential unavailable")

    def record_outcome(
        page_index: int,
        succeeded: bool,
        result_class: str,
        provider_request_started: bool,
    ) -> None:
        outcomes.append(
            (page_index, succeeded, result_class, provider_request_started)
        )

    with pytest.raises(
        ProviderFailure,
        match="google_document_ai_access_token_unavailable",
    ):
        invoke_google_document_ai_adapter(
            [rendered_page(tmp_path)],
            "d" * 64,
            contract(),
            token_provider,
            transport=httpx.MockTransport(handler),
            before_provider_boundary=boundaries.append,
            provider_page_outcome=record_outcome,
        )

    assert calls == 0
    assert boundaries == ["inference"]
    assert outcomes == [(1, False, "authorization", False)]


def test_reserved_page_records_malformed_provider_output_once(
    tmp_path: Path,
) -> None:
    calls = 0
    outcomes: list[tuple[int, bool, str, bool]] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            content=b'{"unexpected":true}',
            headers={"Content-Type": "application/json"},
        )

    def record_outcome(
        page_index: int,
        succeeded: bool,
        result_class: str,
        provider_request_started: bool,
    ) -> None:
        outcomes.append(
            (page_index, succeeded, result_class, provider_request_started)
        )

    with pytest.raises(ProviderFailure):
        invoke_google_document_ai_adapter(
            [rendered_page(tmp_path)],
            "d" * 64,
            contract(),
            lambda: "token",
            transport=httpx.MockTransport(handler),
            before_provider_boundary=lambda boundary: (
                None if boundary == "inference" else pytest.fail("unexpected boundary")
            ),
            provider_page_outcome=record_outcome,
        )

    assert calls == 1
    assert outcomes == [(1, False, "malformed_output", True)]


@pytest.mark.parametrize(
    ("status", "code", "retryable"),
    (
        (403, "google_document_ai_authorization_rejected", False),
        (404, "google_document_ai_request_rejected", False),
        (429, "google_document_ai_unavailable", True),
        (500, "google_document_ai_unavailable", True),
    ),
)
def test_provider_status_is_classified_without_retry(
    tmp_path: Path,
    status: int,
    code: str,
    retryable: bool,
) -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(status, json={"error": {"status": "SAFE_CODE"}})

    with pytest.raises(ProviderFailure) as caught:
        invoke_google_document_ai_adapter(
            [rendered_page(tmp_path)],
            "d" * 64,
            contract(),
            lambda: "token",
            transport=httpx.MockTransport(handler),
        )
    assert calls == 1
    assert caught.value.code == code
    assert caught.value.retryable is retryable
    assert caught.value.provider_request_started


def test_read_timeout_is_ambiguous_and_never_retried(tmp_path: Path) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("content-free timeout", request=request)

    with pytest.raises(ProviderFailure) as caught:
        invoke_google_document_ai_adapter(
            [rendered_page(tmp_path)],
            "d" * 64,
            contract(),
            lambda: "token",
            transport=httpx.MockTransport(handler),
        )
    assert calls == 1
    assert caught.value.code == "google_document_ai_dispatch_ambiguous"
    assert caught.value.ambiguous
    assert not caught.value.retryable


@pytest.mark.parametrize(
    "mutation",
    ("mime", "width", "bytes", "hash"),
)
def test_invalid_rendered_page_fails_before_provider_boundary(
    tmp_path: Path,
    mutation: str,
) -> None:
    page = rendered_page(tmp_path)
    if mutation == "mime":
        page = replace(page, mime_type="image/jpeg")
    elif mutation == "width":
        page = replace(page, width=MAX_RENDERED_WIDTH + 1)
    elif mutation == "bytes":
        page = replace(page, byte_length=MAX_RENDERED_PAGE_BYTES + 1)
    elif mutation == "hash":
        page = replace(page, content_sha256="0" * 64)
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=response_bytes())

    with pytest.raises(ProviderFailure):
        invoke_google_document_ai_adapter(
            [page],
            "d" * 64,
            contract(),
            lambda: "token",
            transport=httpx.MockTransport(handler),
        )
    assert calls == 0


def test_empty_or_excessive_page_sets_fail_before_provider_boundary(
    tmp_path: Path,
) -> None:
    page = rendered_page(tmp_path)
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=response_bytes())

    for pages in (
        [],
        [replace(page, page=index) for index in range(1, GOOGLE_DOCUMENT_AI_MAX_PAGES + 2)],
    ):
        with pytest.raises(
            ProviderFailure,
            match="google_document_ai_page_sequence_invalid",
        ):
            invoke_google_document_ai_adapter(
                pages,
                "d" * 64,
                contract(),
                lambda: "token",
                transport=httpx.MockTransport(handler),
            )
    assert calls == 0


def test_response_size_is_bounded_before_body_is_consumed(tmp_path: Path) -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            content=b"not-consumed",
            headers={
                "Content-Length": str(MAX_GOOGLE_DOCUMENT_AI_RESPONSE_BYTES + 1),
                "Content-Type": "application/json",
            },
        )

    with pytest.raises(
        ProviderFailure,
        match="google_document_ai_response_oversized",
    ):
        invoke_google_document_ai_adapter(
            [rendered_page(tmp_path)],
            "d" * 64,
            contract(),
            lambda: "token",
            transport=httpx.MockTransport(handler),
        )
    assert calls == 1


def test_access_token_failure_occurs_before_any_provider_request(tmp_path: Path) -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=response_bytes())

    def token_provider() -> str:
        raise RuntimeError("credential unavailable")

    with pytest.raises(
        ProviderFailure,
        match="google_document_ai_access_token_unavailable",
    ):
        invoke_google_document_ai_adapter(
            [rendered_page(tmp_path)],
            "d" * 64,
            contract(),
            token_provider,
            transport=httpx.MockTransport(handler),
        )
    assert calls == 0


@pytest.mark.parametrize(
    "mutation",
    (
        "unknown_response_key",
        "ordinary_assistant_content",
        "wrong_mime_type",
        "multiple_pages",
        "wrong_provider_page",
        "out_of_bounds_anchor",
        "pixel_coordinates",
        "invalid_normalized_polygon",
        "unknown_line_key",
        "empty_elements",
        "partial_table_overlap",
        "invalid_confidence",
        "missing_quality_score",
        "duplicate_table_cell",
        "missing_required_hierarchy",
        "missing_pages",
        "missing_text_anchor",
        "invalid_text_segment",
        "malformed_table",
        "partial_document",
    ),
)
def test_unapproved_or_malformed_response_shapes_fail_closed(
    tmp_path: Path,
    mutation: str,
) -> None:
    response = process_response()
    if mutation == "unknown_response_key":
        response["providerInternal"] = True
    elif mutation == "ordinary_assistant_content":
        response = {"choices": [{"message": {"content": "text"}}]}
    elif mutation == "wrong_mime_type":
        response["document"]["mimeType"] = "application/pdf"
    elif mutation == "multiple_pages":
        response["document"]["pages"].append(response["document"]["pages"][0])
    elif mutation == "wrong_provider_page":
        response["document"]["pages"][0]["pageNumber"] = 2
    elif mutation == "out_of_bounds_anchor":
        response["document"]["pages"][0]["lines"][0]["layout"]["textAnchor"][
            "textSegments"
        ][0]["endIndex"] = "999"
    elif mutation == "pixel_coordinates":
        bounding_poly = response["document"]["pages"][0]["lines"][0]["layout"][
            "boundingPoly"
        ]
        bounding_poly.clear()
        bounding_poly["vertices"] = [{"x": 1, "y": 1}] * 4
    elif mutation == "invalid_normalized_polygon":
        response["document"]["pages"][0]["lines"][0]["layout"]["boundingPoly"][
            "normalizedVertices"
        ][2]["x"] = 1.1
    elif mutation == "unknown_line_key":
        response["document"]["pages"][0]["lines"][0]["providerField"] = True
    elif mutation == "empty_elements":
        response["document"]["pages"][0]["lines"] = []
        response["document"]["pages"][0]["blocks"] = []
    elif mutation == "partial_table_overlap":
        response["document"]["pages"][0]["lines"][1]["layout"]["textAnchor"][
            "textSegments"
        ][0] = {"startIndex": "7", "endIndex": "21"}
    elif mutation == "invalid_confidence":
        response["document"]["pages"][0]["tokens"][0]["layout"]["confidence"] = 1.1
    elif mutation == "missing_quality_score":
        response["document"]["pages"][0]["imageQualityScores"]["qualityScore"] = None
    elif mutation == "duplicate_table_cell":
        cells = response["document"]["pages"][0]["tables"][0]["bodyRows"][0]["cells"]
        cells.append(cells[0])
    elif mutation == "missing_required_hierarchy":
        del response["document"]["pages"][0]["tokens"]
    elif mutation == "missing_pages":
        response["document"]["pages"] = []
    elif mutation == "missing_text_anchor":
        del response["document"]["pages"][0]["lines"][0]["layout"]["textAnchor"]
    elif mutation == "invalid_text_segment":
        response["document"]["pages"][0]["tokens"][0]["layout"]["textAnchor"][
            "textSegments"
        ][0] = {"startIndex": "7", "endIndex": "1"}
    elif mutation == "malformed_table":
        response["document"]["pages"][0]["tables"][0]["bodyRows"] = [{}]
    elif mutation == "partial_document":
        del response["document"]["text"]

    with pytest.raises(ProviderFailure):
        normalize_google_document_ai_response(
            contract(),
            rendered_page(tmp_path),
            response_bytes(response),
        )


def test_optional_empty_table_and_page_languages_are_preserved_as_unknown(
    tmp_path: Path,
) -> None:
    response = process_response()
    page = response["document"]["pages"][0]
    del page["detectedLanguages"]
    del page["tables"]
    normalized = normalize_google_document_ai_response(
        contract(),
        rendered_page(tmp_path),
        response_bytes(response),
    )
    assert normalized["structure"]["detectedLanguages"] == []
    assert normalized["structure"]["tables"] == []


def test_empty_table_cell_is_preserved_as_unknown_not_invented(tmp_path: Path) -> None:
    response = process_response()
    cell = response["document"]["pages"][0]["tables"][0]["bodyRows"][0]["cells"][1]
    del cell["layout"]["textAnchor"]
    normalized = normalize_google_document_ai_response(
        contract(),
        rendered_page(tmp_path),
        response_bytes(response),
    )
    layout = normalized["structure"]["tables"][0]["bodyRows"][0]["cells"][1]["layout"]
    assert layout["text"] == ""
    assert layout["textSegments"] == []


def test_duplicate_json_keys_fail_closed(tmp_path: Path) -> None:
    with pytest.raises(
        ProviderFailure,
        match="google_document_ai_output_malformed",
    ):
        normalize_google_document_ai_response(
            contract(),
            rendered_page(tmp_path),
            b'{"document":{},"document":{}}',
        )


def test_adapter_resume_does_not_reinvoke_completed_page(tmp_path: Path) -> None:
    first = rendered_page(tmp_path, page_number=1)
    second_path = tmp_path / "second"
    second_path.mkdir()
    second = rendered_page(second_path, page_number=2)
    completed = normalize_google_document_ai_response(
        contract(),
        first,
        response_bytes(),
    )
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            content=response_bytes(),
            headers={"Content-Type": "application/json"},
        )

    with GoogleDocumentAiRestAdapter(
        contract(),
        lambda: "token",
        transport=httpx.MockTransport(handler),
    ) as adapter:
        result = adapter.invoke(
            [first, second],
            "d" * 64,
            completed_pages=(completed,),
        )

    assert calls == 1
    assert len(result.pages) == 2
    assert result.pages[1]["page"] == 2
    assert len(result.request_contract_hashes) == 2
