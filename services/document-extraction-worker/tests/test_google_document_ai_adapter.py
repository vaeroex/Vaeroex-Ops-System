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
    GoogleDocumentAiRestAdapter,
    google_document_ai_request_binding,
    invoke_google_document_ai_adapter,
    normalize_google_document_ai_response,
    serialize_google_document_ai_request,
)
from vaeroex_document_worker.google_document_ai_contract import (
    GOOGLE_DOCUMENT_AI_FIELD_MASK,
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


def process_response() -> dict[str, Any]:
    text = "Heading\nTable value\nFooter\n"
    return {
        "document": {
            "mimeType": "image/png",
            "pages": [
                {
                    "pageNumber": 1,
                    "lines": [
                        {"layout": _layout(0, 8, (0.1, 0.1, 0.8, 0.2))},
                        {"layout": _layout(8, 20, (0.1, 0.3, 0.8, 0.4))},
                        {"layout": _layout(20, 27, (0.1, 0.7, 0.8, 0.8))},
                    ],
                    "tables": [
                        {"layout": _layout(8, 20, (0.05, 0.25, 0.9, 0.5))}
                    ],
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


def test_request_is_imageless_inline_and_contains_no_customer_labels_or_credentials(
    tmp_path: Path,
) -> None:
    page = rendered_page(tmp_path)
    page_bytes = page.path.read_bytes()
    payload = json.loads(serialize_google_document_ai_request(page, page_bytes))

    assert payload == {
        "fieldMask": GOOGLE_DOCUMENT_AI_FIELD_MASK,
        "imagelessMode": True,
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
    assert "token" not in json.dumps(first.__dict__).lower()


def test_strict_response_normalizes_tables_and_excludes_duplicate_table_lines(
    tmp_path: Path,
) -> None:
    normalized = normalize_google_document_ai_response(
        contract(),
        rendered_page(tmp_path),
        response_bytes(),
    )

    assert normalized == {
        "page": 1,
        "blocks": [
            {
                "id": "page-1-element-1",
                "kind": "text",
                "text": "Heading",
                "coordinates": {
                    "page": 1,
                    "x": 0.1,
                    "y": 0.1,
                    "width": pytest.approx(0.7),
                    "height": pytest.approx(0.1),
                },
            },
            {
                "id": "page-1-element-2",
                "kind": "table",
                "text": "Table value",
                "coordinates": {
                    "page": 1,
                    "x": 0.05,
                    "y": 0.25,
                    "width": pytest.approx(0.85),
                    "height": pytest.approx(0.25),
                },
            },
            {
                "id": "page-1-element-3",
                "kind": "text",
                "text": "Footer",
                "coordinates": {
                    "page": 1,
                    "x": 0.1,
                    "y": 0.7,
                    "width": pytest.approx(0.7),
                    "height": pytest.approx(0.1),
                },
            },
        ],
    }


def test_provider_confidence_never_changes_normalized_output(tmp_path: Path) -> None:
    page = rendered_page(tmp_path)
    low = process_response()
    high = process_response()
    low["document"]["pages"][0]["lines"][0]["layout"]["confidence"] = 0.01
    high["document"]["pages"][0]["lines"][0]["layout"]["confidence"] = 0.99

    assert normalize_google_document_ai_response(contract(), page, response_bytes(low)) == (
        normalize_google_document_ai_response(contract(), page, response_bytes(high))
    )


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
    assert set(result.pages[0]) == {"page", "blocks"}


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
        "unknown_line_key",
        "empty_elements",
        "partial_table_overlap",
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
    elif mutation == "unknown_line_key":
        response["document"]["pages"][0]["lines"][0]["providerField"] = True
    elif mutation == "empty_elements":
        response["document"]["pages"][0]["lines"] = []
        response["document"]["pages"][0]["tables"] = []
    elif mutation == "partial_table_overlap":
        response["document"]["pages"][0]["lines"][1]["layout"]["textAnchor"][
            "textSegments"
        ][0] = {"startIndex": "7", "endIndex": "20"}

    with pytest.raises(ProviderFailure):
        normalize_google_document_ai_response(
            contract(),
            rendered_page(tmp_path),
            response_bytes(response),
        )


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
