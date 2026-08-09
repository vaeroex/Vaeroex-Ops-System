"""Bounded, content-free diagnostics for hosted markdown_bbox arguments."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from typing import Any, cast

from .provider_contract import HOSTED_MODEL, HOSTED_RESPONSE_PROFILE

FIELD_PATH_DIAGNOSTIC_EVENT = "nemotron_parse_field_path_diagnostic_v1"
FIELD_PATH_DIAGNOSTIC_VERSION = "nemotron_parse_field_path_diagnostic_v1"
FIELD_PATH_DIAGNOSTIC_CONFIRMATION = "nemotron-parse-field-path-one-call-v1"

MAX_OBSERVED_ELEMENT_SCHEMAS = 8
MAX_OBSERVED_KEY_NAMES = 32
MAX_OBSERVED_BBOX_ARRAY_LENGTH = 32
MAX_OBSERVED_PATHS_PER_KIND = 12
MAX_TOTAL_FAILURE_PATHS = 48
MAX_DIAGNOSTIC_PATH_LENGTH = 160
MAX_DIAGNOSTIC_PAYLOAD_BYTES = 12_000
MAX_DIAGNOSTIC_LATENCY_MS = 180_000
MAX_DIAGNOSTIC_ARGUMENT_BYTES = 1_000_000
MAX_DIAGNOSTIC_ELEMENTS = 500

_EXPECTED_ELEMENT_KEYS = frozenset({"bbox", "text", "type"})
_EXPECTED_BBOX_KEYS = frozenset({"xmax", "xmin", "ymax", "ymin"})
_BBOX_FIELD_KEYS = frozenset({"bbox", "bounding_box", "box"})
_CLASS_FIELD_KEYS = frozenset({"class", "label", "type"})
_IDENTIFIER_FIELD_KEYS = frozenset({"element_id", "id", "page_id"})
_PAGE_FIELD_KEYS = frozenset({"page", "page_index", "page_number"})
_TEXT_FIELD_KEYS = frozenset({"content", "text"})
_SAFE_STRUCTURAL_KEYS = frozenset(
    {
        "bbox",
        "block",
        "blocks",
        "bottom",
        "bounding_box",
        "bounding_boxes",
        "box",
        "class",
        "content",
        "data",
        "element",
        "element_id",
        "elements",
        "height",
        "id",
        "label",
        "left",
        "page",
        "page_id",
        "page_index",
        "page_number",
        "results",
        "right",
        "text",
        "top",
        "type",
        "width",
        "x",
        "xmax",
        "xmin",
        "y",
        "ymax",
        "ymin",
    }
)
_JSON_TYPES = frozenset({"array", "boolean", "null", "number", "object", "string"})
_FAILURE_CLASSES = frozenset(
    {
        "argument_size_exceeded",
        "bbox_length_mismatch",
        "bbox_key_mismatch",
        "diagnostic_structure_limit_exceeded",
        "duplicate_geometry",
        "duplicate_key",
        "element_count_exceeded",
        "invalid_class_type",
        "invalid_identifier_type",
        "invalid_page_type",
        "invalid_text_type",
        "malformed_bbox_container",
        "malformed_json",
        "missing_required_key",
        "mixed_profile_marker",
        "nonnumeric_coordinate_type",
        "unexpected_wrapper",
        "unknown_key",
        "wrong_root_type",
        "wrong_value_type",
    }
)
_SAFE_PROVIDER_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:/+-]{1,160}$")
_SAFE_PATH = re.compile(
    r"^\$(?:(?:\[(?:0|[1-9][0-9]{0,2})\])|(?:\.[a-z][a-z0-9_]{0,31})){0,8}$"
)
_MIXED_PROFILE_MARKER = re.compile(r"<x_[^>]+>|<y_[^>]+>|<class_[^>]+>")


class _ObjectPairs(list[tuple[str, Any]]):
    """JSON object that preserves duplicate keys for structural inspection."""


def _pairs(pairs: list[tuple[str, Any]]) -> _ObjectPairs:
    return _ObjectPairs(pairs)


def _reject_constant(_value: str) -> None:
    raise ValueError("non_finite_json_number")


def _json_type(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, _ObjectPairs):
        return "object"
    if isinstance(value, list):
        return "array"
    return "null"


def _safe_key(value: str) -> str:
    return value if value in _SAFE_STRUCTURAL_KEYS else "unknown_key"


def _path(parent: str, key: str) -> str:
    value = f"{parent}.{_safe_key(key)}"
    if len(value) > MAX_DIAGNOSTIC_PATH_LENGTH or _SAFE_PATH.fullmatch(value) is None:
        raise ValueError("diagnostic_structure_limit_exceeded")
    return value


@dataclass(frozen=True)
class ObservedElementSchemaV1:
    element_type: str
    key_names: tuple[str, ...]
    value_types: tuple[tuple[str, str], ...]
    bbox_field_names: tuple[str, ...]
    bbox_container_type: str | None
    bbox_array_length: int | None
    bbox_key_names: tuple[str, ...]
    bbox_value_types: tuple[tuple[str, str], ...]

    def __post_init__(self) -> None:
        names = self.key_names + self.bbox_field_names + self.bbox_key_names
        typed = self.value_types + self.bbox_value_types
        if (
            self.element_type not in _JSON_TYPES
            or len(names) > MAX_OBSERVED_KEY_NAMES
            or any(name not in _SAFE_STRUCTURAL_KEYS | {"unknown_key"} for name in names)
            or any(name not in _SAFE_STRUCTURAL_KEYS | {"unknown_key"} for name, _ in typed)
            or any(value_type not in _JSON_TYPES for _, value_type in typed)
            or (
                self.bbox_container_type is not None
                and self.bbox_container_type not in _JSON_TYPES
            )
            or (
                self.bbox_array_length is not None
                and not 0 <= self.bbox_array_length <= MAX_OBSERVED_BBOX_ARRAY_LENGTH
            )
        ):
            raise ValueError("field_path_element_schema_invalid")

    def event_value(self) -> dict[str, object]:
        return {
            "elementType": self.element_type,
            "keyNames": list(self.key_names),
            "valueTypes": [f"{name}:{value_type}" for name, value_type in self.value_types],
            "bboxFieldNames": list(self.bbox_field_names),
            "bboxContainerType": self.bbox_container_type,
            "bboxArrayLength": self.bbox_array_length,
            "bboxKeyNames": list(self.bbox_key_names),
            "bboxValueTypes": [
                f"{name}:{value_type}" for name, value_type in self.bbox_value_types
            ],
        }


@dataclass(frozen=True)
class FieldPathDiagnosticV1:
    provider_profile: str
    configured_model: str
    returned_model: str | None
    provider_request_id: str | None
    finish_reason: str | None
    response_byte_count: int
    argument_byte_count: int
    latency_ms: int
    parse_success: bool
    root_type: str | None
    top_level_key_names: tuple[str, ...]
    root_array_length: int | None
    observed_element_count: int
    element_schemas: tuple[ObservedElementSchemaV1, ...]
    missing_paths: tuple[str, ...]
    unknown_paths: tuple[str, ...]
    duplicate_paths: tuple[str, ...]
    type_mismatch_paths: tuple[str, ...]
    first_failure_class: str | None
    first_failure_path: str | None
    additional_failure_count: int
    structure_limit_exceeded: bool = False

    def __post_init__(self) -> None:
        paths = (
            self.missing_paths
            + self.unknown_paths
            + self.duplicate_paths
            + self.type_mismatch_paths
            + ((self.first_failure_path,) if self.first_failure_path is not None else ())
        )
        if (
            self.provider_profile != HOSTED_RESPONSE_PROFILE
            or self.configured_model != HOSTED_MODEL
            or self.returned_model not in (None, HOSTED_MODEL, "other_nvidia_model")
            or (
                self.provider_request_id is not None
                and _SAFE_PROVIDER_REQUEST_ID.fullmatch(self.provider_request_id) is None
            )
            or self.finish_reason not in (None, "content_filter", "length", "stop", "tool_calls")
            or not 0 <= self.response_byte_count <= 2_000_000
            or not 0 <= self.argument_byte_count <= MAX_DIAGNOSTIC_ARGUMENT_BYTES + 1
            or not 0 <= self.latency_ms <= MAX_DIAGNOSTIC_LATENCY_MS
            or (self.root_type is not None and self.root_type not in _JSON_TYPES)
            or len(self.top_level_key_names) > MAX_OBSERVED_KEY_NAMES
            or any(
                name not in _SAFE_STRUCTURAL_KEYS | {"unknown_key"}
                for name in self.top_level_key_names
            )
            or (
                self.root_array_length is not None
                and not 0 <= self.root_array_length <= MAX_DIAGNOSTIC_ELEMENTS + 1
            )
            or not 0 <= self.observed_element_count <= MAX_DIAGNOSTIC_ELEMENTS
            or len(self.element_schemas) > MAX_OBSERVED_ELEMENT_SCHEMAS
            or any(len(field) > MAX_OBSERVED_PATHS_PER_KIND for field in (
                self.missing_paths,
                self.unknown_paths,
                self.duplicate_paths,
                self.type_mismatch_paths,
            ))
            or any(
                len(path) > MAX_DIAGNOSTIC_PATH_LENGTH or _SAFE_PATH.fullmatch(path) is None
                for path in paths
            )
            or (
                self.first_failure_class is not None
                and self.first_failure_class not in _FAILURE_CLASSES
            )
            or not 0 <= self.additional_failure_count <= MAX_TOTAL_FAILURE_PATHS
        ):
            raise ValueError("field_path_diagnostic_invalid")

    def privacy_safe_event(self) -> dict[str, object]:
        if self.structure_limit_exceeded:
            return {
                "event": FIELD_PATH_DIAGNOSTIC_EVENT,
                "diagnosticVersion": FIELD_PATH_DIAGNOSTIC_VERSION,
                "firstFailureClass": "diagnostic_structure_limit_exceeded",
            }
        event: dict[str, object] = {
            "event": FIELD_PATH_DIAGNOSTIC_EVENT,
            "diagnosticVersion": FIELD_PATH_DIAGNOSTIC_VERSION,
            "providerProfile": self.provider_profile,
            "configuredModel": self.configured_model,
            "returnedModel": self.returned_model,
            "providerRequestId": self.provider_request_id,
            "finishReason": self.finish_reason,
            "responseByteCount": self.response_byte_count,
            "argumentByteCount": self.argument_byte_count,
            "latencyMs": self.latency_ms,
            "parseSuccess": self.parse_success,
            "rootType": self.root_type,
            "topLevelKeyNames": list(self.top_level_key_names),
            "rootArrayLength": self.root_array_length,
            "observedElementCount": self.observed_element_count,
            "elementSchemas": [schema.event_value() for schema in self.element_schemas],
            "missingPaths": list(self.missing_paths),
            "unknownPaths": list(self.unknown_paths),
            "duplicatePaths": list(self.duplicate_paths),
            "typeMismatchPaths": list(self.type_mismatch_paths),
            "firstFailureClass": self.first_failure_class,
            "firstFailurePath": self.first_failure_path,
            "additionalFailureCount": self.additional_failure_count,
        }
        encoded = json.dumps(event, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        if len(encoded.encode("ascii")) > MAX_DIAGNOSTIC_PAYLOAD_BYTES:
            return {
                "event": FIELD_PATH_DIAGNOSTIC_EVENT,
                "diagnosticVersion": FIELD_PATH_DIAGNOSTIC_VERSION,
                "firstFailureClass": "diagnostic_structure_limit_exceeded",
            }
        return event


class _Collector:
    def __init__(self) -> None:
        self.failures: list[tuple[str, str]] = []
        self.missing: list[str] = []
        self.unknown: list[str] = []
        self.duplicate: list[str] = []
        self.type_mismatch: list[str] = []
        self.limit_exceeded = False

    def add(self, failure_class: str, path: str, category: str | None = None) -> None:
        if failure_class not in _FAILURE_CLASSES or _SAFE_PATH.fullmatch(path) is None:
            self.limit_exceeded = True
            return
        if len(self.failures) >= MAX_TOTAL_FAILURE_PATHS:
            self.limit_exceeded = True
            return
        self.failures.append((failure_class, path))
        target: list[str] | None = None
        if category == "missing":
            target = self.missing
        elif category == "unknown":
            target = self.unknown
        elif category == "duplicate":
            target = self.duplicate
        elif category == "type":
            target = self.type_mismatch
        if target is not None and path not in target:
            if len(target) >= MAX_OBSERVED_PATHS_PER_KIND:
                self.limit_exceeded = True
            else:
                target.append(path)


def _object_summary(
    pairs: _ObjectPairs,
    path: str,
    collector: _Collector,
) -> tuple[dict[str, Any], tuple[str, ...], tuple[tuple[str, str], ...]]:
    if len(pairs) > MAX_OBSERVED_KEY_NAMES:
        collector.limit_exceeded = True
        return {}, (), ()
    values: dict[str, Any] = {}
    safe_names: set[str] = set()
    value_types: dict[str, str] = {}
    seen_raw: set[str] = set()
    for raw_name, value in pairs:
        safe_name = _safe_key(raw_name)
        safe_names.add(safe_name)
        value_types[safe_name] = _json_type(value)
        if raw_name in seen_raw:
            collector.add("duplicate_key", _path(path, raw_name), "duplicate")
        else:
            values[raw_name] = value
            seen_raw.add(raw_name)
    return (
        values,
        tuple(sorted(safe_names)),
        tuple(sorted(value_types.items())),
    )


def _limit_diagnostic(
    *,
    returned_model: str | None,
    provider_request_id: str | None,
    finish_reason: str | None,
    response_byte_count: int,
    argument_byte_count: int,
    latency_ms: int,
) -> FieldPathDiagnosticV1:
    return FieldPathDiagnosticV1(
        provider_profile=HOSTED_RESPONSE_PROFILE,
        configured_model=HOSTED_MODEL,
        returned_model=returned_model,
        provider_request_id=provider_request_id,
        finish_reason=finish_reason,
        response_byte_count=response_byte_count,
        argument_byte_count=min(argument_byte_count, MAX_DIAGNOSTIC_ARGUMENT_BYTES + 1),
        latency_ms=max(0, min(latency_ms, MAX_DIAGNOSTIC_LATENCY_MS)),
        parse_success=False,
        root_type=None,
        top_level_key_names=(),
        root_array_length=None,
        observed_element_count=0,
        element_schemas=(),
        missing_paths=(),
        unknown_paths=(),
        duplicate_paths=(),
        type_mismatch_paths=(),
        first_failure_class="diagnostic_structure_limit_exceeded",
        first_failure_path=None,
        additional_failure_count=0,
        structure_limit_exceeded=True,
    )


def inspect_markdown_bbox_arguments(
    arguments: object,
    *,
    returned_model: str | None,
    provider_request_id: str | None,
    finish_reason: str | None,
    response_byte_count: int,
    latency_ms: int,
) -> FieldPathDiagnosticV1:
    """Inspect only bounded JSON structure; never retain provider values."""

    argument_byte_count = len(arguments.encode("utf-8")) if isinstance(arguments, str) else 0
    if argument_byte_count > MAX_DIAGNOSTIC_ARGUMENT_BYTES:
        return _limit_diagnostic(
            returned_model=returned_model,
            provider_request_id=provider_request_id,
            finish_reason=finish_reason,
            response_byte_count=response_byte_count,
            argument_byte_count=argument_byte_count,
            latency_ms=latency_ms,
        )

    collector = _Collector()
    parsed: object = arguments
    parse_success = False
    if isinstance(arguments, str):
        try:
            parsed = json.loads(
                arguments,
                object_pairs_hook=_pairs,
                parse_constant=_reject_constant,
            )
            parse_success = True
        except (json.JSONDecodeError, RecursionError, UnicodeError, ValueError):
            parsed = None
            collector.add("malformed_json", "$")
    else:
        collector.add("wrong_value_type", "$", "type")

    root_type = _json_type(parsed) if parse_success else None
    top_level_key_names: tuple[str, ...] = ()
    root_array_length: int | None = None
    element_schemas: list[ObservedElementSchemaV1] = []
    observed_signatures: set[tuple[object, ...]] = set()
    observed_element_count = 0
    seen_geometry: set[tuple[float, float, float, float]] = set()

    elements: list[object] = []
    if parse_success and isinstance(parsed, _ObjectPairs):
        _, top_level_key_names, _ = _object_summary(parsed, "$", collector)
        collector.add("unexpected_wrapper", "$")
    elif parse_success and not isinstance(parsed, list):
        collector.add("wrong_root_type", "$")
    elif isinstance(parsed, list):
        root_array_length = min(len(parsed), MAX_DIAGNOSTIC_ELEMENTS + 1)
        # Match the historical validator's single nested-list compatibility
        # without confusing duplicate-key-preserving JSON objects for arrays.
        elements = (
            parsed[0]
            if len(parsed) == 1
            and isinstance(parsed[0], list)
            and not isinstance(parsed[0], _ObjectPairs)
            else parsed
        )
        if len(elements) > MAX_DIAGNOSTIC_ELEMENTS:
            collector.add("element_count_exceeded", "$")
        else:
            observed_element_count = len(elements)

    if not collector.limit_exceeded and len(elements) <= MAX_DIAGNOSTIC_ELEMENTS:
        for index, item in enumerate(elements):
            element_path = f"$[{index}]"
            if _SAFE_PATH.fullmatch(element_path) is None:
                collector.limit_exceeded = True
                break
            if not isinstance(item, _ObjectPairs):
                collector.add("wrong_value_type", element_path, "type")
                schema = ObservedElementSchemaV1(
                    element_type=_json_type(item),
                    key_names=(),
                    value_types=(),
                    bbox_field_names=(),
                    bbox_container_type=None,
                    bbox_array_length=None,
                    bbox_key_names=(),
                    bbox_value_types=(),
                )
            else:
                values, key_names, value_types = _object_summary(item, element_path, collector)
                raw_names = {name for name, _ in item}
                for missing in sorted(_EXPECTED_ELEMENT_KEYS - raw_names):
                    collector.add("missing_required_key", _path(element_path, missing), "missing")

                for name in sorted(raw_names & _IDENTIFIER_FIELD_KEYS):
                    if not isinstance(values.get(name), str):
                        collector.add(
                            "invalid_identifier_type",
                            _path(element_path, name),
                            "type",
                        )
                for name in sorted(raw_names & _PAGE_FIELD_KEYS):
                    if type(values.get(name)) is not int:
                        collector.add(
                            "invalid_page_type",
                            _path(element_path, name),
                            "type",
                        )
                for name in sorted(raw_names & _CLASS_FIELD_KEYS):
                    if not isinstance(values.get(name), str):
                        collector.add(
                            "invalid_class_type",
                            _path(element_path, name),
                            "type",
                        )
                for name in sorted(raw_names & _TEXT_FIELD_KEYS):
                    if not isinstance(values.get(name), str):
                        collector.add(
                            "invalid_text_type",
                            _path(element_path, name),
                            "type",
                        )
                for unknown in sorted(raw_names - _EXPECTED_ELEMENT_KEYS):
                    collector.add("unknown_key", _path(element_path, unknown), "unknown")

                raw_text = values.get("text")
                if isinstance(raw_text, str) and _MIXED_PROFILE_MARKER.search(raw_text):
                    collector.add("mixed_profile_marker", _path(element_path, "text"))

                bbox_field_names = tuple(sorted(raw_names & _BBOX_FIELD_KEYS))
                observed_bbox_name = (
                    "bbox"
                    if "bbox" in values
                    else (bbox_field_names[0] if bbox_field_names else None)
                )
                bbox = values.get(observed_bbox_name) if observed_bbox_name is not None else None
                bbox_type = (
                    _json_type(bbox) if observed_bbox_name is not None else None
                )
                bbox_array_length = len(bbox) if isinstance(bbox, list) else None
                if (
                    bbox_array_length is not None
                    and bbox_array_length > MAX_OBSERVED_BBOX_ARRAY_LENGTH
                ):
                    collector.limit_exceeded = True
                    bbox_array_length = None
                bbox_key_names: tuple[str, ...] = ()
                bbox_value_types: tuple[tuple[str, str], ...] = ()
                if observed_bbox_name is not None and not isinstance(bbox, _ObjectPairs):
                    observed_bbox_path = _path(element_path, observed_bbox_name)
                    collector.add(
                        "malformed_bbox_container",
                        observed_bbox_path,
                        "type",
                    )
                    if isinstance(bbox, list) and len(bbox) != 4:
                        collector.add("bbox_length_mismatch", observed_bbox_path)
                elif isinstance(bbox, _ObjectPairs):
                    bbox_path = _path(element_path, observed_bbox_name or "bbox")
                    bbox_values, bbox_key_names, bbox_value_types = _object_summary(
                        bbox, bbox_path, collector
                    )
                    bbox_raw_names = {name for name, _ in bbox}
                    if bbox_raw_names != _EXPECTED_BBOX_KEYS:
                        collector.add("bbox_key_mismatch", bbox_path)
                    for missing in sorted(_EXPECTED_BBOX_KEYS - bbox_raw_names):
                        collector.add("missing_required_key", _path(bbox_path, missing), "missing")
                    for unknown in sorted(bbox_raw_names - _EXPECTED_BBOX_KEYS):
                        collector.add("unknown_key", _path(bbox_path, unknown), "unknown")
                    raw_coordinates = tuple(
                        bbox_values.get(name) for name in ("xmin", "ymin", "xmax", "ymax")
                    )
                    if all(name in bbox_values for name in _EXPECTED_BBOX_KEYS):
                        if any(type(value) not in (int, float) for value in raw_coordinates):
                            for name, value in zip(
                                ("xmin", "ymin", "xmax", "ymax"), raw_coordinates
                            ):
                                if type(value) not in (int, float):
                                    collector.add(
                                        "nonnumeric_coordinate_type",
                                        _path(bbox_path, name),
                                        "type",
                                    )
                        else:
                            typed_coordinates = cast(
                                tuple[int | float, int | float, int | float, int | float],
                                raw_coordinates,
                            )
                            numeric = (
                                float(typed_coordinates[0]),
                                float(typed_coordinates[1]),
                                float(typed_coordinates[2]),
                                float(typed_coordinates[3]),
                            )
                            if (
                                not all(math.isfinite(value) and 0 <= value <= 1 for value in numeric)
                                or numeric[2] <= numeric[0]
                                or numeric[3] <= numeric[1]
                            ):
                                collector.add("malformed_bbox_container", bbox_path)
                            elif numeric in seen_geometry:
                                collector.add("duplicate_geometry", bbox_path)
                            else:
                                seen_geometry.add(numeric)
                schema = ObservedElementSchemaV1(
                    element_type="object",
                    key_names=key_names,
                    value_types=value_types,
                    bbox_field_names=bbox_field_names,
                    bbox_container_type=bbox_type,
                    bbox_array_length=bbox_array_length,
                    bbox_key_names=bbox_key_names,
                    bbox_value_types=bbox_value_types,
                )
            signature = (
                schema.element_type,
                schema.key_names,
                schema.value_types,
                schema.bbox_field_names,
                schema.bbox_container_type,
                schema.bbox_array_length,
                schema.bbox_key_names,
                schema.bbox_value_types,
            )
            if signature not in observed_signatures:
                if len(element_schemas) >= MAX_OBSERVED_ELEMENT_SCHEMAS:
                    collector.limit_exceeded = True
                    break
                observed_signatures.add(signature)
                element_schemas.append(schema)

    if collector.limit_exceeded:
        return _limit_diagnostic(
            returned_model=returned_model,
            provider_request_id=provider_request_id,
            finish_reason=finish_reason,
            response_byte_count=response_byte_count,
            argument_byte_count=argument_byte_count,
            latency_ms=latency_ms,
        )

    first_class, first_path = collector.failures[0] if collector.failures else (None, None)
    return FieldPathDiagnosticV1(
        provider_profile=HOSTED_RESPONSE_PROFILE,
        configured_model=HOSTED_MODEL,
        returned_model=returned_model,
        provider_request_id=provider_request_id,
        finish_reason=finish_reason,
        response_byte_count=response_byte_count,
        argument_byte_count=argument_byte_count,
        latency_ms=max(0, min(latency_ms, MAX_DIAGNOSTIC_LATENCY_MS)),
        parse_success=parse_success,
        root_type=root_type,
        top_level_key_names=top_level_key_names,
        root_array_length=root_array_length,
        observed_element_count=observed_element_count,
        element_schemas=tuple(element_schemas),
        missing_paths=tuple(collector.missing),
        unknown_paths=tuple(collector.unknown),
        duplicate_paths=tuple(collector.duplicate),
        type_mismatch_paths=tuple(collector.type_mismatch),
        first_failure_class=first_class,
        first_failure_path=first_path,
        additional_failure_count=max(0, len(collector.failures) - 1),
    )
