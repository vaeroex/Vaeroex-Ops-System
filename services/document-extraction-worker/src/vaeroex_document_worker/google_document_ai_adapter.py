"""Inert, strictly versioned Google Document AI Enterprise OCR REST adapter."""

from __future__ import annotations

import base64
import hashlib
import json
import math
import re
import time
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from typing import Any, Literal

import httpx

from .google_document_ai_contract import (
    GOOGLE_DOCUMENT_AI_FIELD_MASK,
    GOOGLE_DOCUMENT_AI_PROCESSOR_TYPE,
    GOOGLE_DOCUMENT_AI_TIMEOUT_POLICY_VERSION,
    GoogleDocumentAiContract,
)
from .provider_types import (
    MAX_PROVIDER_LATENCY_MS,
    ProviderFailure,
    ProviderResult,
    RenderedPage,
)

MAX_GOOGLE_DOCUMENT_AI_RESPONSE_BYTES = 4_000_000
MAX_GOOGLE_DOCUMENT_AI_REQUEST_BYTES = 16_500_000
MAX_RENDERED_PAGE_BYTES = 12_000_000
MAX_RENDERED_WIDTH = 1_664
MAX_RENDERED_HEIGHT = 2_048
MAX_ELEMENTS_PER_PAGE = 500
MAX_ELEMENT_TEXT_LENGTH = 50_000
MAX_PAGE_TEXT_LENGTH = 250_000
GOOGLE_DOCUMENT_AI_PAYLOAD_MODE = "inline_raw_document"

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_BLOCK_ID = re.compile(r"^page-[1-9][0-9]*-element-[1-9][0-9]*$")
_INT64 = re.compile(r"^(?:0|[1-9][0-9]{0,18})$")
_PROCESS_RESPONSE_KEYS = frozenset({"document", "humanReviewStatus"})
_DOCUMENT_KEYS = frozenset({"mimeType", "pages", "text"})
_PAGE_KEYS = frozenset({"lines", "pageNumber", "tables"})
_LINE_KEYS = frozenset({"detectedLanguages", "layout", "provenance"})
_TABLE_KEYS = frozenset(
    {"bodyRows", "detectedLanguages", "headerRows", "layout", "provenance"}
)
_LAYOUT_KEYS = frozenset({"boundingPoly", "confidence", "orientation", "textAnchor"})
_TEXT_ANCHOR_KEYS = frozenset({"content", "textSegments"})
_TEXT_SEGMENT_KEYS = frozenset({"endIndex", "startIndex"})
_BOUNDING_POLY_KEYS = frozenset({"normalizedVertices", "vertices"})
_VERTEX_KEYS = frozenset({"x", "y"})
_HUMAN_REVIEW_STATUS_KEYS = frozenset(
    {"humanReviewOperation", "state", "stateMessage"}
)
_ORIENTATIONS = frozenset(
    {"ORIENTATION_UNSPECIFIED", "PAGE_DOWN", "PAGE_LEFT", "PAGE_RIGHT", "PAGE_UP"}
)

ProviderBoundary = Literal["inference"]
ProviderBoundaryCheck = Callable[[ProviderBoundary], None]
AccessTokenProvider = Callable[[], str]


def _bounded_elapsed_ms(started: float) -> int:
    elapsed = (time.perf_counter() - started) * 1_000
    if not math.isfinite(elapsed) or elapsed <= 0:
        return 0
    return min(MAX_PROVIDER_LATENCY_MS, round(elapsed))


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate_json_key")
        value[key] = item
    return value


def _strict_json(data: bytes | str) -> Any:
    text = data.decode("utf-8") if isinstance(data, bytes) else data

    def reject_constant(_value: str) -> None:
        raise ValueError("non_finite_json_number")

    return json.loads(
        text,
        object_pairs_hook=_unique_object,
        parse_constant=reject_constant,
    )


@dataclass(frozen=True)
class GoogleDocumentAiRequestBindingV1:
    adapter_version: str
    provider_profile: str
    processor_type: str
    processor_resource: str
    processor_version: str
    endpoint: str
    request_serializer_version: str
    response_validator_version: str
    normalization_version: str
    coordinate_contract_version: str
    document_sha256: str
    page_sha256: str
    page_index: int
    mime_type: str
    rendered_width: int
    rendered_height: int
    payload_mode: str
    field_mask: str
    timeout_policy_version: str

    def fingerprint(self) -> str:
        payload = json.dumps(
            asdict(self),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()


def google_document_ai_request_binding(
    contract: GoogleDocumentAiContract,
    page: RenderedPage,
    document_sha256: str,
) -> GoogleDocumentAiRequestBindingV1:
    if not _SHA256.fullmatch(document_sha256) or not _SHA256.fullmatch(page.content_sha256):
        raise ProviderFailure(
            "google_document_ai_request_identity_invalid",
            "validation",
            retryable=False,
        )
    return GoogleDocumentAiRequestBindingV1(
        adapter_version=contract.adapter_version,
        provider_profile=contract.provider_profile,
        processor_type=GOOGLE_DOCUMENT_AI_PROCESSOR_TYPE,
        processor_resource=contract.processor_resource,
        processor_version=contract.processor_version,
        endpoint=contract.endpoint,
        request_serializer_version=contract.request_serializer_version,
        response_validator_version=contract.response_validator_version,
        normalization_version=contract.normalization_version,
        coordinate_contract_version=contract.coordinate_contract_version,
        document_sha256=document_sha256,
        page_sha256=page.content_sha256,
        page_index=page.page,
        mime_type=page.mime_type,
        rendered_width=page.width,
        rendered_height=page.height,
        payload_mode=GOOGLE_DOCUMENT_AI_PAYLOAD_MODE,
        field_mask=GOOGLE_DOCUMENT_AI_FIELD_MASK,
        timeout_policy_version=GOOGLE_DOCUMENT_AI_TIMEOUT_POLICY_VERSION,
    )


def _validated_page_bytes(page: RenderedPage) -> bytes:
    if (
        page.mime_type != "image/png"
        or not 1 <= page.width <= MAX_RENDERED_WIDTH
        or not 1 <= page.height <= MAX_RENDERED_HEIGHT
        or not 1 <= page.byte_length <= MAX_RENDERED_PAGE_BYTES
        or _SHA256.fullmatch(page.content_sha256) is None
    ):
        raise ProviderFailure("google_document_ai_page_input_invalid", "validation", retryable=False)
    try:
        content = page.path.read_bytes()
    except OSError as error:
        raise ProviderFailure(
            "google_document_ai_page_input_unavailable",
            "validation",
            retryable=False,
        ) from error
    if len(content) != page.byte_length or hashlib.sha256(content).hexdigest() != page.content_sha256:
        raise ProviderFailure(
            "google_document_ai_page_identity_mismatch",
            "validation",
            retryable=False,
        )
    if (
        len(content) < 24
        or content[:8] != _PNG_SIGNATURE
        or content[8:12] != b"\x00\x00\x00\r"
        or content[12:16] != b"IHDR"
        or int.from_bytes(content[16:20], "big") != page.width
        or int.from_bytes(content[20:24], "big") != page.height
    ):
        raise ProviderFailure(
            "google_document_ai_page_dimensions_mismatch",
            "validation",
            retryable=False,
        )
    return content


def serialize_google_document_ai_request(page: RenderedPage, page_bytes: bytes) -> bytes:
    if len(page_bytes) != page.byte_length:
        raise ProviderFailure(
            "google_document_ai_page_identity_mismatch",
            "validation",
            retryable=False,
        )
    body = {
        "fieldMask": GOOGLE_DOCUMENT_AI_FIELD_MASK,
        "imagelessMode": True,
        "rawDocument": {
            "content": base64.b64encode(page_bytes).decode("ascii"),
            "mimeType": page.mime_type,
        },
    }
    serialized = json.dumps(
        body,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    if len(serialized) > MAX_GOOGLE_DOCUMENT_AI_REQUEST_BYTES:
        raise ProviderFailure(
            "google_document_ai_request_oversized",
            "validation",
            retryable=False,
        )
    return serialized


def _index(value: object, *, default_zero: bool = False) -> int:
    if value is None and default_zero:
        return 0
    if not isinstance(value, str) or _INT64.fullmatch(value) is None:
        raise ProviderFailure(
            "google_document_ai_text_anchor_invalid",
            "malformed_output",
            retryable=False,
        )
    return int(value)


def _anchored_text(
    text_anchor: object,
    document_text: str,
) -> tuple[str, tuple[tuple[int, int], ...]]:
    if not isinstance(text_anchor, dict) or set(text_anchor) - _TEXT_ANCHOR_KEYS:
        raise ProviderFailure(
            "google_document_ai_text_anchor_invalid",
            "malformed_output",
            retryable=False,
        )
    segments = text_anchor.get("textSegments")
    if not isinstance(segments, list) or not 1 <= len(segments) <= 64:
        raise ProviderFailure(
            "google_document_ai_text_anchor_invalid",
            "malformed_output",
            retryable=False,
        )
    ranges: list[tuple[int, int]] = []
    pieces: list[str] = []
    previous_end = -1
    for segment in segments:
        if (
            not isinstance(segment, dict)
            or set(segment) - _TEXT_SEGMENT_KEYS
            or "endIndex" not in segment
        ):
            raise ProviderFailure(
                "google_document_ai_text_anchor_invalid",
                "malformed_output",
                retryable=False,
            )
        start = _index(segment.get("startIndex"), default_zero=True)
        end = _index(segment.get("endIndex"))
        if start < previous_end or end <= start or end > len(document_text):
            raise ProviderFailure(
                "google_document_ai_text_anchor_invalid",
                "malformed_output",
                retryable=False,
            )
        ranges.append((start, end))
        pieces.append(document_text[start:end])
        previous_end = end
    value = "".join(pieces).strip()
    if not value or len(value) > MAX_ELEMENT_TEXT_LENGTH or "\x00" in value:
        raise ProviderFailure(
            "google_document_ai_element_text_invalid",
            "malformed_output",
            retryable=False,
        )
    supplied_content = text_anchor.get("content")
    if supplied_content is not None and supplied_content != value:
        raise ProviderFailure(
            "google_document_ai_text_anchor_conflict",
            "malformed_output",
            retryable=False,
        )
    return value, tuple(ranges)


def _normalized_coordinates(value: object) -> dict[str, float]:
    if (
        not isinstance(value, dict)
        or set(value) - _BOUNDING_POLY_KEYS
        or "normalizedVertices" not in value
    ):
        raise ProviderFailure(
            "google_document_ai_coordinates_invalid",
            "malformed_output",
            retryable=False,
        )
    raw_vertices = value.get("vertices")
    if raw_vertices is not None:
        if not isinstance(raw_vertices, list) or len(raw_vertices) != 4:
            raise ProviderFailure(
                "google_document_ai_coordinates_invalid",
                "malformed_output",
                retryable=False,
            )
        for raw_vertex in raw_vertices:
            if not isinstance(raw_vertex, dict) or set(raw_vertex) - _VERTEX_KEYS:
                raise ProviderFailure(
                    "google_document_ai_coordinates_invalid",
                    "malformed_output",
                    retryable=False,
                )
            if any(
                type(coordinate) is not int or coordinate < 0
                for coordinate in raw_vertex.values()
            ):
                raise ProviderFailure(
                    "google_document_ai_coordinates_invalid",
                    "malformed_output",
                    retryable=False,
                )
    vertices = value.get("normalizedVertices")
    if not isinstance(vertices, list) or len(vertices) != 4:
        raise ProviderFailure(
            "google_document_ai_coordinates_invalid",
            "malformed_output",
            retryable=False,
        )
    points: list[tuple[float, float]] = []
    for vertex in vertices:
        if not isinstance(vertex, dict) or set(vertex) - _VERTEX_KEYS:
            raise ProviderFailure(
                "google_document_ai_coordinates_invalid",
                "malformed_output",
                retryable=False,
            )
        raw_x = vertex.get("x", 0)
        raw_y = vertex.get("y", 0)
        if type(raw_x) not in (int, float) or type(raw_y) not in (int, float):
            raise ProviderFailure(
                "google_document_ai_coordinates_invalid",
                "malformed_output",
                retryable=False,
            )
        x = float(raw_x)
        y = float(raw_y)
        if not math.isfinite(x) or not math.isfinite(y) or not 0 <= x <= 1 or not 0 <= y <= 1:
            raise ProviderFailure(
                "google_document_ai_coordinates_invalid",
                "malformed_output",
                retryable=False,
            )
        points.append((x, y))
    x1 = min(point[0] for point in points)
    y1 = min(point[1] for point in points)
    x2 = max(point[0] for point in points)
    y2 = max(point[1] for point in points)
    if x2 <= x1 or y2 <= y1:
        raise ProviderFailure(
            "google_document_ai_coordinates_invalid",
            "malformed_output",
            retryable=False,
        )
    return {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1}


def _layout(
    value: object,
    document_text: str,
) -> tuple[str, tuple[tuple[int, int], ...], dict[str, float]]:
    if not isinstance(value, dict) or set(value) - _LAYOUT_KEYS:
        raise ProviderFailure(
            "google_document_ai_layout_invalid",
            "malformed_output",
            retryable=False,
        )
    confidence = value.get("confidence")
    if confidence is not None and (
        type(confidence) not in (int, float)
        or not math.isfinite(float(confidence))
        or not 0 <= float(confidence) <= 1
    ):
        raise ProviderFailure(
            "google_document_ai_layout_invalid",
            "malformed_output",
            retryable=False,
        )
    orientation = value.get("orientation")
    if orientation is not None and orientation not in _ORIENTATIONS:
        raise ProviderFailure(
            "google_document_ai_layout_invalid",
            "malformed_output",
            retryable=False,
        )
    text, ranges = _anchored_text(value.get("textAnchor"), document_text)
    coordinates = _normalized_coordinates(value.get("boundingPoly"))
    return text, ranges, coordinates


@dataclass(frozen=True)
class _Element:
    kind: str
    text: str
    ranges: tuple[tuple[int, int], ...]
    coordinates: dict[str, float]

    @property
    def order(self) -> int:
        return self.ranges[0][0]


def _annotation(
    value: object,
    document_text: str,
    *,
    kind: str,
) -> _Element:
    allowed_keys = _TABLE_KEYS if kind == "table" else _LINE_KEYS
    if not isinstance(value, dict) or set(value) - allowed_keys:
        raise ProviderFailure(
            "google_document_ai_annotation_invalid",
            "malformed_output",
            retryable=False,
        )
    for list_key in (
        "bodyRows",
        "detectedLanguages",
        "headerRows",
    ):
        if list_key in value and (
            not isinstance(value[list_key], list)
            or len(value[list_key]) > 1_000
            or any(not isinstance(item, dict) for item in value[list_key])
        ):
            raise ProviderFailure(
                "google_document_ai_annotation_invalid",
                "malformed_output",
                retryable=False,
            )
    if "provenance" in value and not isinstance(value["provenance"], dict):
        raise ProviderFailure(
            "google_document_ai_annotation_invalid",
            "malformed_output",
            retryable=False,
        )
    text, ranges, coordinates = _layout(value.get("layout"), document_text)
    return _Element(kind=kind, text=text, ranges=ranges, coordinates=coordinates)


def _validate_human_review_status(value: object) -> None:
    if not isinstance(value, dict) or set(value) - _HUMAN_REVIEW_STATUS_KEYS:
        raise ProviderFailure(
            "google_document_ai_output_schema_mismatch",
            "malformed_output",
            retryable=False,
        )
    state = value.get("state")
    state_message = value.get("stateMessage")
    operation = value.get("humanReviewOperation")
    if (
        (state is not None and (not isinstance(state, str) or len(state) > 128))
        or (
            state_message is not None
            and (not isinstance(state_message, str) or len(state_message) > 4_096)
        )
        or (
            operation is not None
            and (not isinstance(operation, str) or len(operation) > 1_024)
        )
    ):
        raise ProviderFailure(
            "google_document_ai_output_schema_mismatch",
            "malformed_output",
            retryable=False,
        )


def _ranges_overlap(
    left: Iterable[tuple[int, int]],
    right: Iterable[tuple[int, int]],
) -> bool:
    return any(max(a_start, b_start) < min(a_end, b_end) for a_start, a_end in left for b_start, b_end in right)


def _ranges_contained(
    inner: Iterable[tuple[int, int]],
    outer: Iterable[tuple[int, int]],
) -> bool:
    outer_ranges = tuple(outer)
    return all(
        any(outer_start <= start and end <= outer_end for outer_start, outer_end in outer_ranges)
        for start, end in inner
    )


def normalize_google_document_ai_response(
    contract: GoogleDocumentAiContract,
    page: RenderedPage,
    response_body: bytes,
) -> dict[str, Any]:
    del contract
    if len(response_body) > MAX_GOOGLE_DOCUMENT_AI_RESPONSE_BYTES:
        raise ProviderFailure(
            "google_document_ai_response_oversized",
            "malformed_output",
            retryable=False,
        )
    try:
        response = _strict_json(response_body)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise ProviderFailure(
            "google_document_ai_output_malformed",
            "malformed_output",
            retryable=False,
        ) from error
    if not isinstance(response, dict) or set(response) - _PROCESS_RESPONSE_KEYS:
        raise ProviderFailure(
            "google_document_ai_output_schema_mismatch",
            "malformed_output",
            retryable=False,
        )
    human_review_status = response.get("humanReviewStatus")
    if human_review_status is not None:
        _validate_human_review_status(human_review_status)
    document = response.get("document")
    if not isinstance(document, dict) or set(document) != _DOCUMENT_KEYS:
        raise ProviderFailure(
            "google_document_ai_output_schema_mismatch",
            "malformed_output",
            retryable=False,
        )
    if document.get("mimeType") != page.mime_type:
        raise ProviderFailure(
            "google_document_ai_output_contract_mismatch",
            "malformed_output",
            retryable=False,
        )
    document_text = document.get("text")
    pages = document.get("pages")
    if (
        not isinstance(document_text, str)
        or not document_text
        or len(document_text) > MAX_PAGE_TEXT_LENGTH
        or "\x00" in document_text
        or not isinstance(pages, list)
        or len(pages) != 1
        or not isinstance(pages[0], dict)
        or set(pages[0]) - _PAGE_KEYS
        or pages[0].get("pageNumber") != 1
    ):
        raise ProviderFailure(
            "google_document_ai_output_schema_mismatch",
            "malformed_output",
            retryable=False,
        )
    provider_page = pages[0]
    raw_lines = provider_page.get("lines")
    raw_tables = provider_page.get("tables", [])
    if not isinstance(raw_lines, list) or not isinstance(raw_tables, list):
        raise ProviderFailure(
            "google_document_ai_output_schema_mismatch",
            "malformed_output",
            retryable=False,
        )
    tables = [_annotation(item, document_text, kind="table") for item in raw_tables]
    for index, table in enumerate(tables):
        if any(_ranges_overlap(table.ranges, other.ranges) for other in tables[index + 1 :]):
            raise ProviderFailure(
                "google_document_ai_table_overlap",
                "malformed_output",
                retryable=False,
            )
    lines: list[_Element] = []
    for raw_line in raw_lines:
        line = _annotation(raw_line, document_text, kind="text")
        containing_tables = [
            table for table in tables if _ranges_overlap(line.ranges, table.ranges)
        ]
        if containing_tables:
            if len(containing_tables) != 1 or not _ranges_contained(
                line.ranges,
                containing_tables[0].ranges,
            ):
                raise ProviderFailure(
                    "google_document_ai_annotation_overlap",
                    "malformed_output",
                    retryable=False,
                )
            continue
        lines.append(line)
    ordered_lines = sorted(lines, key=lambda item: item.order)
    for index, line in enumerate(ordered_lines):
        if any(_ranges_overlap(line.ranges, other.ranges) for other in ordered_lines[index + 1 :]):
            raise ProviderFailure(
                "google_document_ai_annotation_overlap",
                "malformed_output",
                retryable=False,
            )
    elements = sorted([*tables, *ordered_lines], key=lambda item: (item.order, item.kind))
    if not elements or len(elements) > MAX_ELEMENTS_PER_PAGE:
        raise ProviderFailure(
            "google_document_ai_element_limit_invalid",
            "malformed_output",
            retryable=False,
        )
    total_text = 0
    seen: set[tuple[object, ...]] = set()
    seen_coordinates: set[tuple[float, float, float, float]] = set()
    blocks: list[dict[str, Any]] = []
    for index, element in enumerate(elements, start=1):
        total_text += len(element.text)
        if total_text > MAX_PAGE_TEXT_LENGTH:
            raise ProviderFailure(
                "google_document_ai_page_text_limit_exceeded",
                "malformed_output",
                retryable=False,
            )
        geometry = (
            element.coordinates["x"],
            element.coordinates["y"],
            element.coordinates["width"],
            element.coordinates["height"],
        )
        identity = (element.kind, element.text, *geometry)
        if identity in seen or geometry in seen_coordinates:
            raise ProviderFailure(
                "google_document_ai_duplicate_element",
                "malformed_output",
                retryable=False,
            )
        seen.add(identity)
        seen_coordinates.add(geometry)
        block_id = f"page-{page.page}-element-{index}"
        if _BLOCK_ID.fullmatch(block_id) is None:
            raise ProviderFailure(
                "google_document_ai_element_id_invalid",
                "malformed_output",
                retryable=False,
            )
        blocks.append(
            {
                "id": block_id,
                "kind": element.kind,
                "text": element.text,
                "coordinates": {"page": page.page, **element.coordinates},
            }
        )
    return {"page": page.page, "blocks": blocks}


def _access_token(provider: AccessTokenProvider) -> str:
    try:
        token = provider()
    except Exception as error:
        raise ProviderFailure(
            "google_document_ai_access_token_unavailable",
            "authorization",
            retryable=False,
        ) from error
    if (
        not isinstance(token, str)
        or not token
        or len(token) > 16_384
        or any(character.isspace() for character in token)
    ):
        raise ProviderFailure(
            "google_document_ai_access_token_invalid",
            "authorization",
            retryable=False,
        )
    return token


def _status_failure(status_code: int) -> ProviderFailure:
    if status_code in (401, 403):
        return ProviderFailure(
            "google_document_ai_authorization_rejected",
            "authorization",
            retryable=False,
            provider_request_started=True,
        )
    if status_code in (400, 404, 409, 422):
        return ProviderFailure(
            "google_document_ai_request_rejected",
            "validation",
            retryable=False,
            provider_request_started=True,
        )
    if status_code in (408, 429, 500, 502, 503, 504):
        return ProviderFailure(
            "google_document_ai_unavailable",
            "provider",
            retryable=True,
            provider_request_started=True,
        )
    return ProviderFailure(
        "google_document_ai_provider_rejected",
        "provider",
        retryable=False,
        provider_request_started=True,
    )


class GoogleDocumentAiRestAdapter:
    """No internal retries and no authority beyond normalized draft output."""

    def __init__(
        self,
        contract: GoogleDocumentAiContract,
        access_token_provider: AccessTokenProvider,
        *,
        transport: httpx.BaseTransport | None = None,
        before_provider_boundary: ProviderBoundaryCheck | None = None,
    ) -> None:
        self._contract = contract
        self._access_token_provider = access_token_provider
        self._before_provider_boundary = before_provider_boundary or (lambda _boundary: None)
        self._client = httpx.Client(
            timeout=httpx.Timeout(120.0, connect=10.0, write=30.0, pool=10.0),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    def __enter__(self) -> "GoogleDocumentAiRestAdapter":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def _invoke_page(
        self,
        page: RenderedPage,
        completed_pages: tuple[dict[str, Any], ...],
    ) -> dict[str, Any]:
        page_bytes = _validated_page_bytes(page)
        body = serialize_google_document_ai_request(page, page_bytes)
        self._before_provider_boundary("inference")
        token = _access_token(self._access_token_provider)
        started = time.perf_counter()
        try:
            with self._client.stream(
                "POST",
                self._contract.endpoint,
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                content=body,
            ) as response:
                status_code = response.status_code
                content_type = (
                    response.headers.get("content-type", "")
                    .split(";", 1)[0]
                    .strip()
                    .lower()
                )
                declared_length = response.headers.get("content-length")
                if declared_length is not None and (
                    not declared_length.isdigit()
                    or int(declared_length) > MAX_GOOGLE_DOCUMENT_AI_RESPONSE_BYTES
                ):
                    raise ProviderFailure(
                        "google_document_ai_response_oversized",
                        "malformed_output",
                        retryable=False,
                        completed_pages=completed_pages,
                        latency_ms=_bounded_elapsed_ms(started),
                        provider_request_started=True,
                    )
                response_chunks: list[bytes] = []
                response_size = 0
                if status_code == 200:
                    for chunk in response.iter_bytes():
                        response_size += len(chunk)
                        if response_size > MAX_GOOGLE_DOCUMENT_AI_RESPONSE_BYTES:
                            raise ProviderFailure(
                                "google_document_ai_response_oversized",
                                "malformed_output",
                                retryable=False,
                                completed_pages=completed_pages,
                                latency_ms=_bounded_elapsed_ms(started),
                                provider_request_started=True,
                            )
                        response_chunks.append(chunk)
                response_body = b"".join(response_chunks)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as error:
            raise ProviderFailure(
                "google_document_ai_transport_unavailable",
                "transport",
                retryable=True,
                completed_pages=completed_pages,
                latency_ms=_bounded_elapsed_ms(started),
                provider_request_started=True,
            ) from error
        except httpx.HTTPError as error:
            raise ProviderFailure(
                "google_document_ai_dispatch_ambiguous",
                "transport",
                retryable=False,
                ambiguous=True,
                completed_pages=completed_pages,
                latency_ms=_bounded_elapsed_ms(started),
                provider_request_started=True,
            ) from error
        latency_ms = _bounded_elapsed_ms(started)
        if status_code != 200:
            failure = _status_failure(status_code)
            raise ProviderFailure(
                failure.code,
                failure.result_class,
                retryable=failure.retryable,
                ambiguous=failure.ambiguous,
                completed_pages=completed_pages,
                latency_ms=latency_ms,
                provider_request_started=True,
            )
        if content_type != "application/json":
            raise ProviderFailure(
                "google_document_ai_content_type_invalid",
                "malformed_output",
                retryable=False,
                completed_pages=completed_pages,
                latency_ms=latency_ms,
                provider_request_started=True,
            )
        try:
            return normalize_google_document_ai_response(
                self._contract,
                page,
                response_body,
            )
        except ProviderFailure as failure:
            raise ProviderFailure(
                failure.code,
                failure.result_class,
                retryable=failure.retryable,
                ambiguous=failure.ambiguous,
                completed_pages=completed_pages,
                latency_ms=latency_ms,
                provider_request_started=True,
            ) from failure

    def invoke(
        self,
        pages: list[RenderedPage],
        document_sha256: str,
        *,
        completed_pages: tuple[dict[str, Any], ...] = (),
    ) -> ProviderResult:
        if not pages or [page.page for page in pages] != list(range(1, len(pages) + 1)):
            raise ProviderFailure(
                "google_document_ai_page_sequence_invalid",
                "validation",
                retryable=False,
            )
        if len(completed_pages) > len(pages):
            raise ProviderFailure(
                "google_document_ai_resume_state_invalid",
                "validation",
                retryable=False,
            )
        normalized_pages = list(completed_pages)
        request_hashes: list[str] = []
        started = time.perf_counter()
        for page in pages:
            binding = google_document_ai_request_binding(
                self._contract,
                page,
                document_sha256,
            )
            request_hashes.append(binding.fingerprint())
            if page.page <= len(completed_pages):
                continue
            normalized_pages.append(self._invoke_page(page, tuple(normalized_pages)))
        return ProviderResult(
            pages=normalized_pages,
            latency_ms=_bounded_elapsed_ms(started),
            request_contract_hashes=tuple(request_hashes),
            payload_modes=(GOOGLE_DOCUMENT_AI_PAYLOAD_MODE,) * len(pages),
        )


def invoke_google_document_ai_adapter(
    pages: list[RenderedPage],
    document_sha256: str,
    contract: GoogleDocumentAiContract,
    access_token_provider: AccessTokenProvider,
    *,
    completed_pages: tuple[dict[str, Any], ...] = (),
    transport: httpx.BaseTransport | None = None,
    before_provider_boundary: ProviderBoundaryCheck | None = None,
) -> ProviderResult:
    with GoogleDocumentAiRestAdapter(
        contract,
        access_token_provider,
        transport=transport,
        before_provider_boundary=before_provider_boundary,
    ) as adapter:
        return adapter.invoke(
            pages,
            document_sha256,
            completed_pages=completed_pages,
        )
