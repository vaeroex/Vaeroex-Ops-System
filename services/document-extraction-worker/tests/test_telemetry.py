from __future__ import annotations

import json

import pytest

from vaeroex_document_worker.field_path_diagnostic import (
    inspect_markdown_bbox_arguments,
)
from vaeroex_document_worker.response_profile import inspect_response_profile
from vaeroex_document_worker.telemetry import (
    emit_field_path_diagnostic,
    emit_operational_event,
    emit_response_profile_diagnostic,
)


def test_operational_telemetry_accepts_only_content_free_fields(capsys: pytest.CaptureFixture[str]) -> None:
    emit_operational_event(
        "job_result",
        deployment_version="phase-c1-preview-1",
        status="needs_review",
        provider_calls=1,
        latency_ms=120,
        cleanup_result="clean",
    )
    payload = json.loads(capsys.readouterr().out)
    assert payload["event"] == "job_result"
    assert payload["deployment_version"] == "phase-c1-preview-1"
    assert "workspace" not in payload
    assert "text" not in payload
    assert "filename" not in payload


def test_operational_telemetry_rejects_raw_or_unknown_fields() -> None:
    with pytest.raises(ValueError, match="field_rejected"):
        emit_operational_event("job_result", document_text="private")
    with pytest.raises(ValueError, match="value_rejected"):
        emit_operational_event("job_result", status="contains customer prose")


def test_response_profile_telemetry_never_emits_content_or_arguments(
    capsys: pytest.CaptureFixture[str],
) -> None:
    private_content = "private assistant output"
    private_arguments = '{"private":"tool arguments"}'
    response = json.dumps(
        {
            "model": "nvidia/nemotron-parse",
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": private_content,
                        "tool_calls": [
                            {
                                "type": "function",
                                "function": {
                                    "name": "markdown_bbox",
                                    "arguments": private_arguments,
                                },
                            }
                        ],
                    },
                }
            ],
        }
    ).encode("utf-8")
    diagnostic = inspect_response_profile(
        http_status=200,
        headers={"content-type": "application/json"},
        response_body=response,
        response_byte_count=len(response),
        latency_ms=25,
    )

    emit_response_profile_diagnostic(diagnostic)
    output = capsys.readouterr().out
    payload = json.loads(output)
    assert payload["assistantContentState"] == "non_empty"
    assert payload["argumentsByteLengths"] == [len(private_arguments.encode("utf-8"))]
    assert private_content not in output
    assert private_arguments not in output


def test_field_path_telemetry_never_emits_values_or_raw_arguments(
    capsys: pytest.CaptureFixture[str],
) -> None:
    private_values = (
        "private extracted text",
        "sk-private-provider-secret",
        "https://private.example.test/signed?token=secret",
        "/private/customer/document.pdf",
    )
    arguments = json.dumps(
        [
            {
                "type": private_values[1],
                "text": " ".join(private_values),
                "bbox": {
                    "xmin": 0.123456789,
                    "ymin": 0.2,
                    "xmax": 0.8,
                    "ymax": 0.9,
                },
            }
        ]
    )
    diagnostic = inspect_markdown_bbox_arguments(
        arguments,
        returned_model="nvidia/nemotron-parse",
        provider_request_id="safe-provider-request-id",
        finish_reason="stop",
        response_byte_count=2_758,
        latency_ms=1_220,
    )

    emit_field_path_diagnostic(diagnostic)
    output = capsys.readouterr().out
    payload = json.loads(output)
    assert payload["rootType"] == "array"
    assert payload["firstFailureClass"] is None
    assert arguments not in output
    assert "0.123456789" not in output
    for value in private_values:
        assert value not in output
