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
    GOOGLE_DOCUMENT_AI_ARTIFACT_CONTRACT_VERSION,
    GOOGLE_DOCUMENT_AI_ARTIFACT_NORMALIZATION_VERSION,
    GOOGLE_DOCUMENT_AI_COMPATIBILITY_POLICY_VERSION,
    GOOGLE_DOCUMENT_AI_CONFIDENCE_POLICY_VERSION,
    GOOGLE_DOCUMENT_AI_FIELD_MASK,
    GOOGLE_DOCUMENT_AI_MAX_PAGES,
    GOOGLE_DOCUMENT_AI_PROCESSOR_TYPE,
    GOOGLE_DOCUMENT_AI_SELECTION_MARK_POLICY_VERSION,
    GOOGLE_DOCUMENT_AI_SUPPORTED_MIME_TYPES,
    GOOGLE_DOCUMENT_AI_TABLE_POLICY_VERSION,
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
MAX_SUMMARY_BLOCKS_PER_PAGE = 1_000
MAX_STRUCTURAL_BLOCKS_PER_PAGE = 1_000
MAX_PARAGRAPHS_PER_PAGE = 2_000
MAX_LINES_PER_PAGE = 4_000
MAX_TOKENS_PER_PAGE = 20_000
MAX_TABLES_PER_PAGE = 100
MAX_TABLE_CELLS_PER_PAGE = 5_000
MAX_ELEMENT_TEXT_LENGTH = 50_000
MAX_PAGE_TEXT_LENGTH = 250_000
GOOGLE_DOCUMENT_AI_PAYLOAD_MODE = "inline_raw_document"

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_BLOCK_ID = re.compile(r"^page-[1-9][0-9]*-element-[1-9][0-9]*$")
_INT64 = re.compile(r"^(?:0|[1-9][0-9]{0,18})$")
_PROCESS_RESPONSE_KEYS = frozenset({"document", "humanReviewStatus"})
_DOCUMENT_KEYS = frozenset({"mimeType", "pages", "text"})
_PAGE_REQUIRED_KEYS = frozenset(
    {
        "blocks",
        "imageQualityScores",
        "layout",
        "lines",
        "pageNumber",
        "paragraphs",
        "tokens",
    }
)
_PAGE_KEYS = _PAGE_REQUIRED_KEYS | frozenset({"detectedLanguages", "tables"})
_ANNOTATION_KEYS = frozenset({"detectedLanguages", "layout", "provenance"})
_TOKEN_KEYS = frozenset(
    {"detectedBreak", "detectedLanguages", "layout", "provenance"}
)
_TABLE_KEYS = frozenset(
    {"bodyRows", "detectedLanguages", "headerRows", "layout", "provenance"}
)
_TABLE_ROW_KEYS = frozenset({"cells"})
_TABLE_CELL_KEYS = frozenset(
    {"colSpan", "detectedLanguages", "layout", "rowSpan"}
)
_LAYOUT_KEYS = frozenset({"boundingPoly", "confidence", "orientation", "textAnchor"})
_TEXT_ANCHOR_KEYS = frozenset({"content", "textSegments"})
_TEXT_SEGMENT_KEYS = frozenset({"endIndex", "startIndex"})
_BOUNDING_POLY_KEYS = frozenset({"normalizedVertices", "vertices"})
_VERTEX_KEYS = frozenset({"x", "y"})
_DETECTED_LANGUAGE_KEYS = frozenset({"confidence", "languageCode"})
_DETECTED_BREAK_KEYS = frozenset({"type"})
_IMAGE_QUALITY_KEYS = frozenset({"detectedDefects", "qualityScore"})
_DETECTED_DEFECT_KEYS = frozenset({"confidence", "type"})
_HUMAN_REVIEW_STATUS_KEYS = frozenset(
    {"humanReviewOperation", "state", "stateMessage"}
)
_ORIENTATIONS = frozenset(
    {"ORIENTATION_UNSPECIFIED", "PAGE_DOWN", "PAGE_LEFT", "PAGE_RIGHT", "PAGE_UP"}
)
_BREAK_TYPES = frozenset({"TYPE_UNSPECIFIED", "SPACE", "WIDE_SPACE", "HYPHEN"})
_QUALITY_DEFECT_TYPES = frozenset(
    {
        "quality/defect_blurry",
        "quality/defect_noisy",
        "quality/defect_dark",
        "quality/defect_faint",
        "quality/defect_text_too_small",
        "quality/defect_document_cutoff",
        "quality/defect_text_cutoff",
        "quality/defect_glare",
    }
)
_LANGUAGE_CODE = re.compile(r"^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$")

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
    compatibility_policy_version: str
    table_policy_version: str
    confidence_policy_version: str
    selection_mark_policy_version: str
    artifact_contract_version: str
    artifact_normalization_version: str
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
        compatibility_policy_version=contract.compatibility_policy_version,
        table_policy_version=contract.table_policy_version,
        confidence_policy_version=contract.confidence_policy_version,
        selection_mark_policy_version=contract.selection_mark_policy_version,
        artifact_contract_version=contract.artifact_contract_version,
        artifact_normalization_version=contract.artifact_normalization_version,
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
        page.mime_type not in GOOGLE_DOCUMENT_AI_SUPPORTED_MIME_TYPES
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
    *,
    allow_empty: bool = False,
) -> tuple[str, tuple[tuple[int, int], ...]]:
    if text_anchor is None and allow_empty:
        return "", ()
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
    raw_value = "".join(pieces)
    value = raw_value.strip()
    if (
        (not value and not allow_empty)
        or len(value) > MAX_ELEMENT_TEXT_LENGTH
        or "\x00" in value
    ):
        raise ProviderFailure(
            "google_document_ai_element_text_invalid",
            "malformed_output",
            retryable=False,
        )
    supplied_content = text_anchor.get("content")
    if supplied_content is not None and supplied_content not in (raw_value, value):
        raise ProviderFailure(
            "google_document_ai_text_anchor_conflict",
            "malformed_output",
            retryable=False,
        )
    return value, tuple(ranges)


def _normalized_geometry(
    value: object,
    page_number: int,
) -> tuple[dict[str, float], list[dict[str, float]]]:
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
    polygon: list[dict[str, float]] = []
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
        if (
            not math.isfinite(x)
            or not math.isfinite(y)
            or not 0 <= x <= 1
            or not 0 <= y <= 1
        ):
            raise ProviderFailure(
                "google_document_ai_coordinates_invalid",
                "malformed_output",
                retryable=False,
            )
        points.append((x, y))
        polygon.append({"x": x, "y": y})
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
    return (
        {
            "page": page_number,
            "x": x1,
            "y": y1,
            "width": x2 - x1,
            "height": y2 - y1,
        },
        polygon,
    )


def _confidence(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProviderFailure(
            "google_document_ai_confidence_invalid",
            "malformed_output",
            retryable=False,
        )
    numeric = float(value)
    if (
        not math.isfinite(numeric)
        or not 0 <= numeric <= 1
    ):
        raise ProviderFailure(
            "google_document_ai_confidence_invalid",
            "malformed_output",
            retryable=False,
        )
    return numeric


def _required_confidence(value: object, code: str) -> float:
    confidence = _confidence(value)
    if confidence is None:
        raise ProviderFailure(code, "malformed_output", retryable=False)
    return confidence


def _detected_languages(value: object) -> list[dict[str, object]]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 64:
        raise ProviderFailure(
            "google_document_ai_languages_invalid",
            "malformed_output",
            retryable=False,
        )
    languages: list[dict[str, object]] = []
    seen: set[str] = set()
    for language in value:
        if (
            not isinstance(language, dict)
            or set(language) != _DETECTED_LANGUAGE_KEYS
            or not isinstance(language.get("languageCode"), str)
            or _LANGUAGE_CODE.fullmatch(language["languageCode"]) is None
            or language["languageCode"] in seen
        ):
            raise ProviderFailure(
                "google_document_ai_languages_invalid",
                "malformed_output",
                retryable=False,
            )
        seen.add(language["languageCode"])
        languages.append(
            {
                "languageCode": language["languageCode"],
                "confidence": _confidence(language.get("confidence")),
            }
        )
    return languages


def _layout_v2(
    value: object,
    document_text: str,
    page_number: int,
    *,
    allow_empty_text: bool = False,
) -> tuple[dict[str, Any], tuple[tuple[int, int], ...]]:
    if not isinstance(value, dict) or set(value) - _LAYOUT_KEYS:
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
    text, ranges = _anchored_text(
        value.get("textAnchor"),
        document_text,
        allow_empty=allow_empty_text,
    )
    coordinates, polygon = _normalized_geometry(
        value.get("boundingPoly"),
        page_number,
    )
    return (
        {
            "text": text,
            "textSegments": [
                {"start": start, "end": end} for start, end in ranges
            ],
            "confidence": _confidence(value.get("confidence")),
            "orientation": orientation,
            "coordinates": coordinates,
            "polygon": polygon,
        },
        ranges,
    )


@dataclass(frozen=True)
class _StructuralElement:
    value: dict[str, Any]
    ranges: tuple[tuple[int, int], ...]

    @property
    def order(self) -> int:
        return self.ranges[0][0] if self.ranges else MAX_PAGE_TEXT_LENGTH + 1


def _validated_provenance(value: object) -> None:
    if value is not None and (
        not isinstance(value, dict)
        or len(json.dumps(value, separators=(",", ":"), ensure_ascii=True)) > 8_192
    ):
        raise ProviderFailure(
            "google_document_ai_annotation_invalid",
            "malformed_output",
            retryable=False,
        )


def _annotation_v2(
    value: object,
    document_text: str,
    page_number: int,
    *,
    kind: str,
    identifier: str,
) -> _StructuralElement:
    allowed_keys = _TOKEN_KEYS if kind == "token" else _ANNOTATION_KEYS
    if not isinstance(value, dict) or set(value) - allowed_keys:
        raise ProviderFailure(
            "google_document_ai_annotation_invalid",
            "malformed_output",
            retryable=False,
        )
    _validated_provenance(value.get("provenance"))
    layout, ranges = _layout_v2(value.get("layout"), document_text, page_number)
    normalized: dict[str, Any] = {
        "id": identifier,
        "kind": kind,
        "layout": layout,
        "detectedLanguages": _detected_languages(value.get("detectedLanguages")),
    }
    if kind == "token":
        detected_break = value.get("detectedBreak")
        if detected_break is None:
            normalized["detectedBreak"] = None
        elif (
            not isinstance(detected_break, dict)
            or set(detected_break) != _DETECTED_BREAK_KEYS
            or detected_break.get("type") not in _BREAK_TYPES
        ):
            raise ProviderFailure(
                "google_document_ai_token_break_invalid",
                "malformed_output",
                retryable=False,
            )
        else:
            normalized["detectedBreak"] = detected_break["type"]
    return _StructuralElement(value=normalized, ranges=ranges)


def _ranges_overlap(
    left: Iterable[tuple[int, int]],
    right: Iterable[tuple[int, int]],
) -> bool:
    return any(
        max(a_start, b_start) < min(a_end, b_end)
        for a_start, a_end in left
        for b_start, b_end in right
    )


def _ranges_contained(
    inner: Iterable[tuple[int, int]],
    outer: Iterable[tuple[int, int]],
) -> bool:
    outer_ranges = tuple(outer)
    return all(
        any(outer_start <= start and end <= outer_end for outer_start, outer_end in outer_ranges)
        for start, end in inner
    )


def _ordered_annotations(
    raw: object,
    document_text: str,
    page_number: int,
    *,
    kind: str,
    limit: int,
) -> list[_StructuralElement]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= limit:
        raise ProviderFailure(
            "google_document_ai_annotation_limit_invalid",
            "malformed_output",
            retryable=False,
        )
    annotations = [
        _annotation_v2(
            item,
            document_text,
            page_number,
            kind=kind,
            identifier=f"page-{page_number}-{kind}-{index}",
        )
        for index, item in enumerate(raw, start=1)
    ]
    ordered = sorted(annotations, key=lambda item: (item.order, item.value["id"]))
    seen: set[tuple[object, ...]] = set()
    furthest_end = -1
    for annotation in ordered:
        layout = annotation.value["layout"]
        identity = (
            tuple(annotation.ranges),
            tuple((point["x"], point["y"]) for point in layout["polygon"]),
            layout["text"],
        )
        if identity in seen or annotation.ranges[0][0] < furthest_end:
            raise ProviderFailure(
                "google_document_ai_duplicate_or_overlapping_annotation",
                "malformed_output",
                retryable=False,
            )
        seen.add(identity)
        furthest_end = max(furthest_end, max(end for _, end in annotation.ranges))
    return ordered


def _table_cell(
    value: object,
    document_text: str,
    page_number: int,
    identifier: str,
) -> _StructuralElement:
    if not isinstance(value, dict) or set(value) - _TABLE_CELL_KEYS:
        raise ProviderFailure(
            "google_document_ai_table_cell_invalid",
            "malformed_output",
            retryable=False,
        )
    row_span = value.get("rowSpan")
    col_span = value.get("colSpan")
    if (
        type(row_span) is not int
        or type(col_span) is not int
        or not 1 <= row_span <= 100
        or not 1 <= col_span <= 100
    ):
        raise ProviderFailure(
            "google_document_ai_table_cell_invalid",
            "malformed_output",
            retryable=False,
        )
    layout, ranges = _layout_v2(
        value.get("layout"),
        document_text,
        page_number,
        allow_empty_text=True,
    )
    return _StructuralElement(
        value={
            "id": identifier,
            "layout": layout,
            "rowSpan": row_span,
            "colSpan": col_span,
            "detectedLanguages": _detected_languages(value.get("detectedLanguages")),
        },
        ranges=ranges,
    )


def _table_rows(
    raw: object,
    document_text: str,
    page_number: int,
    table_index: int,
    section: str,
) -> tuple[list[dict[str, Any]], list[_StructuralElement]]:
    if raw is None:
        return [], []
    if not isinstance(raw, list) or len(raw) > 1_000:
        raise ProviderFailure(
            "google_document_ai_table_rows_invalid",
            "malformed_output",
            retryable=False,
        )
    rows: list[dict[str, Any]] = []
    cells: list[_StructuralElement] = []
    for row_index, row in enumerate(raw, start=1):
        if not isinstance(row, dict) or set(row) != _TABLE_ROW_KEYS:
            raise ProviderFailure(
                "google_document_ai_table_rows_invalid",
                "malformed_output",
                retryable=False,
            )
        raw_cells = row.get("cells")
        if not isinstance(raw_cells, list) or not raw_cells:
            raise ProviderFailure(
                "google_document_ai_table_rows_invalid",
                "malformed_output",
                retryable=False,
            )
        normalized_cells = [
            _table_cell(
                cell,
                document_text,
                page_number,
                f"page-{page_number}-table-{table_index}-{section}-row-{row_index}-cell-{cell_index}",
            )
            for cell_index, cell in enumerate(raw_cells, start=1)
        ]
        cells.extend(normalized_cells)
        rows.append(
            {
                "id": f"page-{page_number}-table-{table_index}-{section}-row-{row_index}",
                "cells": [cell.value for cell in normalized_cells],
            }
        )
    return rows, cells


def _tables_v2(
    raw: object,
    document_text: str,
    page_number: int,
) -> list[_StructuralElement]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_TABLES_PER_PAGE:
        raise ProviderFailure(
            "google_document_ai_table_limit_invalid",
            "malformed_output",
            retryable=False,
        )
    tables: list[_StructuralElement] = []
    cell_count = 0
    seen_cells: set[tuple[object, ...]] = set()
    for table_index, raw_table in enumerate(raw, start=1):
        if not isinstance(raw_table, dict) or set(raw_table) - _TABLE_KEYS:
            raise ProviderFailure(
                "google_document_ai_table_invalid",
                "malformed_output",
                retryable=False,
            )
        _validated_provenance(raw_table.get("provenance"))
        layout, ranges = _layout_v2(
            raw_table.get("layout"),
            document_text,
            page_number,
        )
        header_rows, header_cells = _table_rows(
            raw_table.get("headerRows"),
            document_text,
            page_number,
            table_index,
            "header",
        )
        body_rows, body_cells = _table_rows(
            raw_table.get("bodyRows"),
            document_text,
            page_number,
            table_index,
            "body",
        )
        table_cells = [*header_cells, *body_cells]
        if not table_cells:
            raise ProviderFailure(
                "google_document_ai_table_empty",
                "malformed_output",
                retryable=False,
            )
        cell_count += len(table_cells)
        if cell_count > MAX_TABLE_CELLS_PER_PAGE:
            raise ProviderFailure(
                "google_document_ai_table_cell_limit_invalid",
                "malformed_output",
                retryable=False,
            )
        ranged_cells: list[_StructuralElement] = []
        for cell in table_cells:
            cell_layout = cell.value["layout"]
            identity = (
                tuple(cell.ranges),
                tuple((point["x"], point["y"]) for point in cell_layout["polygon"]),
            )
            if identity in seen_cells or (
                cell.ranges and not _ranges_contained(cell.ranges, ranges)
            ):
                raise ProviderFailure(
                    "google_document_ai_table_cell_identity_invalid",
                    "malformed_output",
                    retryable=False,
                )
            seen_cells.add(identity)
            if cell.ranges:
                ranged_cells.append(cell)
        furthest_cell_end = -1
        for cell in sorted(ranged_cells, key=lambda item: item.order):
            if cell.ranges[0][0] < furthest_cell_end:
                raise ProviderFailure(
                    "google_document_ai_table_cell_identity_invalid",
                    "malformed_output",
                    retryable=False,
                )
            furthest_cell_end = max(
                furthest_cell_end,
                max(end for _, end in cell.ranges),
            )
        tables.append(
            _StructuralElement(
                value={
                    "id": f"page-{page_number}-table-{table_index}",
                    "kind": "table",
                    "layout": layout,
                    "detectedLanguages": _detected_languages(
                        raw_table.get("detectedLanguages")
                    ),
                    "headerRows": header_rows,
                    "bodyRows": body_rows,
                },
                ranges=ranges,
            )
        )
    ordered = sorted(tables, key=lambda item: (item.order, item.value["id"]))
    for index, table in enumerate(ordered):
        if any(
            _ranges_overlap(table.ranges, other.ranges)
            for other in ordered[index + 1 :]
        ):
            raise ProviderFailure(
                "google_document_ai_table_overlap",
                "malformed_output",
                retryable=False,
            )
    return ordered


def _image_quality(value: object) -> dict[str, Any]:
    if (
        not isinstance(value, dict)
        or set(value) - _IMAGE_QUALITY_KEYS
        or "qualityScore" not in value
    ):
        raise ProviderFailure(
            "google_document_ai_image_quality_invalid",
            "malformed_output",
            retryable=False,
        )
    raw_defects = value.get("detectedDefects", [])
    if not isinstance(raw_defects, list) or len(raw_defects) > len(_QUALITY_DEFECT_TYPES):
        raise ProviderFailure(
            "google_document_ai_image_quality_invalid",
            "malformed_output",
            retryable=False,
        )
    defects: list[dict[str, object]] = []
    seen: set[str] = set()
    for defect in raw_defects:
        if (
            not isinstance(defect, dict)
            or set(defect) != _DETECTED_DEFECT_KEYS
            or defect.get("type") not in _QUALITY_DEFECT_TYPES
            or defect["type"] in seen
        ):
            raise ProviderFailure(
                "google_document_ai_image_quality_invalid",
                "malformed_output",
                retryable=False,
            )
        seen.add(defect["type"])
        defects.append(
            {
                "type": defect["type"],
                "confidence": _confidence(defect.get("confidence")),
            }
        )
    return {
        "qualityScore": _required_confidence(
            value.get("qualityScore"),
            "google_document_ai_image_quality_invalid",
        ),
        "detectedDefects": defects,
    }


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


def _summary_blocks(
    page_number: int,
    structural_blocks: list[_StructuralElement],
    paragraphs: list[_StructuralElement],
    lines: list[_StructuralElement],
    tables: list[_StructuralElement],
) -> list[dict[str, Any]]:
    source = structural_blocks or paragraphs or lines
    candidates: list[tuple[str, _StructuralElement]] = []
    for element in source:
        overlapping_tables = [
            table for table in tables if _ranges_overlap(element.ranges, table.ranges)
        ]
        if overlapping_tables:
            if len(overlapping_tables) != 1 or not _ranges_contained(
                element.ranges,
                overlapping_tables[0].ranges,
            ):
                raise ProviderFailure(
                    "google_document_ai_annotation_overlap",
                    "malformed_output",
                    retryable=False,
                )
            continue
        candidates.append(("text", element))
    candidates.extend(("table", table) for table in tables)
    ordered = sorted(
        candidates,
        key=lambda item: (item[1].order, item[0], item[1].value["id"]),
    )
    if not ordered or len(ordered) > MAX_SUMMARY_BLOCKS_PER_PAGE:
        raise ProviderFailure(
            "google_document_ai_element_limit_invalid",
            "malformed_output",
            retryable=False,
        )
    blocks: list[dict[str, Any]] = []
    seen: set[tuple[object, ...]] = set()
    for index, (kind, element) in enumerate(ordered, start=1):
        layout = element.value["layout"]
        identity = (
            kind,
            layout["text"],
            tuple((point["x"], point["y"]) for point in layout["polygon"]),
        )
        if identity in seen:
            raise ProviderFailure(
                "google_document_ai_duplicate_element",
                "malformed_output",
                retryable=False,
            )
        seen.add(identity)
        blocks.append(
            {
                "id": f"page-{page_number}-element-{index}",
                "kind": kind,
                "text": layout["text"],
                "coordinates": layout["coordinates"],
            }
        )
    return blocks


def normalize_google_document_ai_response(
    contract: GoogleDocumentAiContract,
    page: RenderedPage,
    response_body: bytes,
) -> dict[str, Any]:
    if (
        contract.artifact_contract_version
        != GOOGLE_DOCUMENT_AI_ARTIFACT_CONTRACT_VERSION
        or contract.artifact_normalization_version
        != GOOGLE_DOCUMENT_AI_ARTIFACT_NORMALIZATION_VERSION
        or contract.compatibility_policy_version
        != GOOGLE_DOCUMENT_AI_COMPATIBILITY_POLICY_VERSION
        or contract.table_policy_version != GOOGLE_DOCUMENT_AI_TABLE_POLICY_VERSION
        or contract.confidence_policy_version
        != GOOGLE_DOCUMENT_AI_CONFIDENCE_POLICY_VERSION
        or contract.selection_mark_policy_version
        != GOOGLE_DOCUMENT_AI_SELECTION_MARK_POLICY_VERSION
    ):
        raise ProviderFailure(
            "google_document_ai_output_contract_mismatch",
            "validation",
            retryable=False,
        )
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
        or not document_text.strip()
        or len(document_text) > MAX_PAGE_TEXT_LENGTH
        or "\x00" in document_text
        or not isinstance(pages, list)
        or len(pages) != 1
        or not isinstance(pages[0], dict)
        or not _PAGE_REQUIRED_KEYS.issubset(pages[0])
        or bool(set(pages[0]) - _PAGE_KEYS)
        or pages[0].get("pageNumber") != 1
    ):
        raise ProviderFailure(
            "google_document_ai_output_schema_mismatch",
            "malformed_output",
            retryable=False,
        )
    provider_page = pages[0]
    page_layout, _ = _layout_v2(
        provider_page.get("layout"),
        document_text,
        page.page,
    )
    structural_blocks = _ordered_annotations(
        provider_page.get("blocks"),
        document_text,
        page.page,
        kind="block",
        limit=MAX_STRUCTURAL_BLOCKS_PER_PAGE,
    )
    paragraphs = _ordered_annotations(
        provider_page.get("paragraphs"),
        document_text,
        page.page,
        kind="paragraph",
        limit=MAX_PARAGRAPHS_PER_PAGE,
    )
    lines = _ordered_annotations(
        provider_page.get("lines"),
        document_text,
        page.page,
        kind="line",
        limit=MAX_LINES_PER_PAGE,
    )
    tokens = _ordered_annotations(
        provider_page.get("tokens"),
        document_text,
        page.page,
        kind="token",
        limit=MAX_TOKENS_PER_PAGE,
    )
    tables = _tables_v2(
        provider_page.get("tables"),
        document_text,
        page.page,
    )
    return {
        "page": page.page,
        "blocks": _summary_blocks(
            page.page,
            structural_blocks,
            paragraphs,
            lines,
            tables,
        ),
        "structure": {
            "structureVersion": "provider_neutral_document_structure_v1",
            "pageLayout": page_layout,
            "detectedLanguages": _detected_languages(
                provider_page.get("detectedLanguages")
            ),
            "blocks": [item.value for item in structural_blocks],
            "paragraphs": [item.value for item in paragraphs],
            "lines": [item.value for item in lines],
            "tokens": [item.value for item in tokens],
            "tables": [item.value for item in tables],
            "selectionMarks": [],
            "imageQuality": _image_quality(
                provider_page.get("imageQualityScores")
            ),
        },
    }


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
        if (
            not pages
            or len(pages) > GOOGLE_DOCUMENT_AI_MAX_PAGES
            or [page.page for page in pages] != list(range(1, len(pages) + 1))
        ):
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
