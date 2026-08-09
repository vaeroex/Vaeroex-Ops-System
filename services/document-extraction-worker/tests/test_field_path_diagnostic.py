from __future__ import annotations

import json

import pytest

from vaeroex_document_worker.field_path_diagnostic import (
    FIELD_PATH_DIAGNOSTIC_EVENT,
    MAX_DIAGNOSTIC_PAYLOAD_BYTES,
    FieldPathDiagnosticV1,
    inspect_markdown_bbox_arguments,
)
from vaeroex_document_worker.provider_contract import HOSTED_MODEL, HOSTED_RESPONSE_PROFILE


def inspect(arguments: object) -> FieldPathDiagnosticV1:
    return inspect_markdown_bbox_arguments(
        arguments,
        returned_model=HOSTED_MODEL,
        provider_request_id="safe-provider-request-id",
        finish_reason="stop",
        response_byte_count=2_758,
        latency_ms=1_220,
    )


def valid_element(**updates: object) -> dict[str, object]:
    value: dict[str, object] = {
        "type": "Text",
        "text": "synthetic",
        "bbox": {"xmin": 0.1, "ymin": 0.2, "xmax": 0.8, "ymax": 0.4},
    }
    value.update(updates)
    return value


def serialized(arguments: object) -> str:
    return json.dumps(arguments, separators=(",", ":"))


def test_valid_strict_payload_has_no_structural_failure() -> None:
    diagnostic = inspect(serialized([valid_element()]))

    assert diagnostic.parse_success
    assert diagnostic.root_type == "array"
    assert diagnostic.first_failure_class is None
    assert diagnostic.missing_paths == ()
    assert diagnostic.unknown_paths == ()
    assert diagnostic.duplicate_paths == ()
    assert diagnostic.type_mismatch_paths == ()
    assert diagnostic.provider_profile == HOSTED_RESPONSE_PROFILE


@pytest.mark.parametrize(
    ("arguments", "failure_class", "failure_path"),
    (
        (serialized({"elements": [valid_element()]}), "unexpected_wrapper", "$"),
        (serialized("not-an-array"), "wrong_root_type", "$"),
        (serialized([["not-an-object"]]), "wrong_value_type", "$[0]"),
        (serialized([{"type": "Text", "text": "synthetic"}]), "missing_required_key", "$[0].bbox"),
        (
            serialized([valid_element(provider_extension=True)]),
            "unknown_key",
            "$[0].unknown_key",
        ),
        (
            serialized([{"type": "Text", "text": "synthetic", "box": [0, 0, 1, 1]}]),
            "missing_required_key",
            "$[0].bbox",
        ),
        (
            serialized([valid_element(bbox=[0.1, 0.2, 0.8, 0.4])]),
            "malformed_bbox_container",
            "$[0].bbox",
        ),
        (
            serialized(
                [
                    valid_element(
                        bbox={"left": 0.1, "top": 0.2, "right": 0.8, "bottom": 0.4}
                    )
                ]
            ),
            "bbox_key_mismatch",
            "$[0].bbox",
        ),
        (
            serialized(
                [
                    valid_element(
                        bbox={"xmin": "0.1", "ymin": 0.2, "xmax": 0.8, "ymax": 0.4}
                    )
                ]
            ),
            "nonnumeric_coordinate_type",
            "$[0].bbox.xmin",
        ),
        (serialized([valid_element(text=["synthetic"])]), "invalid_text_type", "$[0].text"),
        (serialized([valid_element(type={"label": "Text"})]), "invalid_class_type", "$[0].type"),
        (
            serialized(
                [
                    valid_element(
                        text="<x_0.1><y_0.2>synthetic<x_0.8><y_0.4><class_Text>"
                    )
                ]
            ),
            "mixed_profile_marker",
            "$[0].text",
        ),
    ),
)
def test_first_failure_classes_are_stable_and_content_free(
    arguments: str,
    failure_class: str,
    failure_path: str,
) -> None:
    diagnostic = inspect(arguments)

    assert diagnostic.first_failure_class == failure_class
    assert diagnostic.first_failure_path == failure_path
    assert arguments not in json.dumps(diagnostic.privacy_safe_event())


def test_duplicate_keys_and_geometry_are_classified_without_values() -> None:
    duplicate_key = inspect(
        '[{"type":"Text","type":"Title","text":"synthetic",'
        '"bbox":{"xmin":0.1,"ymin":0.2,"xmax":0.8,"ymax":0.4}}]'
    )
    duplicate_geometry = inspect(serialized([valid_element(), valid_element(text="other")]))

    assert duplicate_key.first_failure_class == "duplicate_key"
    assert duplicate_key.duplicate_paths == ("$[0].type",)
    assert duplicate_geometry.first_failure_class == "duplicate_geometry"
    assert duplicate_geometry.first_failure_path == "$[1].bbox"


def test_multiple_element_shapes_are_bounded_and_type_only() -> None:
    diagnostic = inspect(
        serialized(
            [
                valid_element(),
                valid_element(text=7),
                valid_element(bbox=[0.1, 0.2, 0.8, 0.4]),
            ]
        )
    )
    event = diagnostic.privacy_safe_event()

    assert len(diagnostic.element_schemas) == 3
    assert event["observedElementCount"] == 3
    assert "synthetic" not in json.dumps(event)
    assert "0.1" not in json.dumps(event)


def test_malformed_and_incomplete_json_are_indistinguishable_from_content() -> None:
    malformed = inspect("not-json-with-private-content")
    incomplete = inspect('[{"text":"private-content"')

    for diagnostic in (malformed, incomplete):
        assert diagnostic.parse_success is False
        assert diagnostic.first_failure_class == "malformed_json"
        event = json.dumps(diagnostic.privacy_safe_event())
        assert "private-content" not in event
        assert "not-json" not in event


def test_excessive_elements_fail_with_a_bounded_structural_class() -> None:
    diagnostic = inspect(serialized([valid_element() for _ in range(501)]))

    assert diagnostic.root_array_length == 501
    assert diagnostic.first_failure_class == "element_count_exceeded"
    assert diagnostic.observed_element_count == 0


@pytest.mark.parametrize(
    "arguments",
    (
        serialized([{f"provider_key_{index}": True for index in range(33)}]),
        serialized([{} for _ in range(13)]),
        serialized([valid_element(bbox=list(range(33)))]),
        "[" + (" " * 1_000_000) + "]",
    ),
)
def test_structure_bounds_collapse_to_one_minimal_event(arguments: str) -> None:
    event = inspect(arguments).privacy_safe_event()

    assert event == {
        "event": FIELD_PATH_DIAGNOSTIC_EVENT,
        "diagnosticVersion": FIELD_PATH_DIAGNOSTIC_EVENT,
        "firstFailureClass": "diagnostic_structure_limit_exceeded",
    }


def test_previous_live_envelope_metadata_can_be_represented_without_content() -> None:
    diagnostic = inspect(serialized({"data": []}))
    event = diagnostic.privacy_safe_event()

    assert event["providerProfile"] == "hosted_tool_call_v2"
    assert event["configuredModel"] == "nvidia/nemotron-parse"
    assert event["finishReason"] == "stop"
    assert isinstance(event["argumentByteCount"], int)
    assert event["argumentByteCount"] > 0
    assert event["responseByteCount"] == 2_758
    assert event["latencyMs"] == 1_220
    assert event["firstFailureClass"] == "unexpected_wrapper"


def test_adversarial_values_and_key_names_cannot_enter_diagnostic_output() -> None:
    forbidden = (
        "sk-secret-provider-credential",
        "Bearer-private-token",
        "https://private.example.test/signed?token=secret",
        "/workspace/private/customer-file.pdf",
        "raw-ed25519-signature",
        "workspace-customer-id",
        "987654321.123456",
    )
    payload = [
        {
            "type": forbidden[0],
            "text": " ".join(forbidden),
            "bbox": {
                "xmin": 987654321.123456,
                "ymin": 0.2,
                "xmax": 0.8,
                "ymax": 0.9,
            },
            forbidden[1]: forbidden[2],
            forbidden[3]: forbidden[4],
        }
    ]
    raw_arguments = serialized(payload)
    event_text = json.dumps(inspect(raw_arguments).privacy_safe_event(), sort_keys=True)

    for value in forbidden:
        assert value not in event_text
    assert raw_arguments not in event_text
    assert "unknown_key" in event_text
    assert len(event_text.encode("ascii")) <= MAX_DIAGNOSTIC_PAYLOAD_BYTES


def test_non_string_arguments_retain_only_transport_type_failure() -> None:
    secret_container = {"secret": "must-not-escape"}
    event_text = json.dumps(inspect(secret_container).privacy_safe_event())

    assert "must-not-escape" not in event_text
    assert "secret" not in event_text
    assert "wrong_value_type" in event_text


@pytest.mark.parametrize(
    ("field_name", "field_value", "failure_class"),
    (
        ("page", "one", "invalid_page_type"),
        ("page_number", [], "invalid_page_type"),
        ("id", 42, "invalid_identifier_type"),
        ("element_id", {}, "invalid_identifier_type"),
        ("class", [], "invalid_class_type"),
        ("content", {}, "invalid_text_type"),
    ),
)
def test_alternate_structural_fields_report_types_without_values(
    field_name: str,
    field_value: object,
    failure_class: str,
) -> None:
    diagnostic = inspect(serialized([valid_element(**{field_name: field_value})]))
    event_text = json.dumps(diagnostic.privacy_safe_event(), sort_keys=True)

    assert diagnostic.first_failure_class == failure_class
    assert f"$[0].{field_name}" in diagnostic.type_mismatch_paths
    assert field_name in event_text


def test_bbox_alias_and_array_length_are_structural_only() -> None:
    diagnostic = inspect(
        serialized(
            [
                {
                    "type": "Text",
                    "text": "synthetic",
                    "bounding_box": [0.1, 0.2, 0.8],
                }
            ]
        )
    )
    event = diagnostic.privacy_safe_event()

    assert diagnostic.first_failure_class == "missing_required_key"
    assert diagnostic.element_schemas[0].bbox_field_names == ("bounding_box",)
    assert diagnostic.element_schemas[0].bbox_container_type == "array"
    assert diagnostic.element_schemas[0].bbox_array_length == 3
    assert diagnostic.additional_failure_count >= 3
    assert "0.1" not in json.dumps(event)
