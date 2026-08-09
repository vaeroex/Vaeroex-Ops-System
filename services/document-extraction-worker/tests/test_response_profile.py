from __future__ import annotations

import json
from dataclasses import replace

import pytest

from vaeroex_document_worker.response_profile import (
    DIAGNOSTIC_EVENT,
    ResponseProfileDiagnosticV1,
    classify_response_profile,
    inspect_response_profile,
)


def response(
    *,
    model: str = "nvidia/nemotron-parse",
    finish_reason: str = "tool_calls",
    content: object = None,
    tool_calls: object = None,
) -> bytes:
    if tool_calls is None and finish_reason == "tool_calls":
        tool_calls = [
            {
                "type": "function",
                "function": {
                    "name": "markdown_bbox",
                    "arguments": '[{"type":"Text","text":"never retained","bbox":{"xmin":0.1}}]',
                },
            }
        ]
    return json.dumps(
        {
            "id": "provider-response-safe-id",
            "object": "chat.completion",
            "model": model,
            "choices": [
                {
                    "finish_reason": finish_reason,
                    "message": {"content": content, "tool_calls": tool_calls},
                }
            ],
            "usage": {"completion_tokens": 42},
        }
    ).encode("utf-8")


def inspect(body: bytes) -> ResponseProfileDiagnosticV1:
    return inspect_response_profile(
        http_status=200,
        headers={
            "content-type": "application/json; charset=utf-8",
            "nvcf-reqid": "provider-trace-safe-id",
            "authorization": "must-never-be-retained",
        },
        response_body=body,
        response_byte_count=len(body),
        latency_ms=321,
    )


def test_legacy_tool_call_profile_retains_only_approved_structure() -> None:
    diagnostic = inspect(response())
    payload = diagnostic.privacy_safe_event()

    assert classify_response_profile(diagnostic) == 1
    assert set(payload) == {
        "event",
        "httpStatus",
        "responseContentType",
        "returnedModel",
        "finishReason",
        "assistantContentState",
        "toolCallCount",
        "toolCallTypes",
        "functionNames",
        "argumentsTransportTypes",
        "argumentsByteLengths",
        "argumentsCompleteJson",
        "topLevelResponseKeys",
        "truncationIndicator",
        "tokenLimitIndicator",
        "providerRequestId",
        "responseByteCount",
        "latencyMs",
    }
    assert payload["event"] == DIAGNOSTIC_EVENT
    assert payload["assistantContentState"] == "null"
    assert payload["toolCallTypes"] == ["function"]
    assert payload["functionNames"] == ["markdown_bbox"]
    assert payload["argumentsTransportTypes"] == ["string"]
    assert payload["argumentsCompleteJson"] == [True]
    serialized = json.dumps(payload)
    for prohibited in (
        "never retained",
        "xmin",
        "authorization",
        "must-never-be-retained",
        "completion_tokens",
    ):
        assert prohibited not in serialized


def test_v1_2_tagged_profile_is_structurally_distinct() -> None:
    diagnostic = inspect(
        response(
            model="nvidia/nemotron-parse-v1.2",
            finish_reason="stop",
            content="private tagged provider content",
            tool_calls=[],
        )
    )

    assert diagnostic.assistant_content_state == "non_empty"
    assert diagnostic.tool_call_count == 0
    assert classify_response_profile(diagnostic) == 2
    assert "private tagged provider content" not in json.dumps(
        diagnostic.privacy_safe_event()
    )


def test_truncated_and_ordinary_content_profiles_remain_separate() -> None:
    truncated = inspect(
        response(finish_reason="length", content=None, tool_calls=[])
    )
    ordinary = inspect(
        response(finish_reason="stop", content="private prose", tool_calls=[])
    )

    assert classify_response_profile(truncated) == 3
    assert truncated.token_limit_indicator == "indicated"
    assert classify_response_profile(ordinary) == 4


def test_malformed_arguments_record_only_length_and_completeness() -> None:
    arguments = "private incomplete arguments {"
    diagnostic = inspect(
        response(
            tool_calls=[
                {
                    "type": "function",
                    "function": {
                        "name": "markdown_bbox",
                        "arguments": arguments,
                    },
                }
            ]
        )
    )

    assert diagnostic.arguments_byte_lengths == (len(arguments.encode("utf-8")),)
    assert diagnostic.arguments_complete_json == (False,)
    assert classify_response_profile(diagnostic) == 5
    assert arguments not in json.dumps(diagnostic.privacy_safe_event())


def test_invalid_provider_json_is_malformed_without_content_retention() -> None:
    body = b'{"model":"nvidia/nemotron-parse","private":"never retained"'
    diagnostic = inspect_response_profile(
        http_status=200,
        headers={"content-type": "application/json"},
        response_body=body,
        response_byte_count=len(body),
        latency_ms=10,
    )

    assert diagnostic.top_level_response_keys == ()
    assert classify_response_profile(diagnostic) == 5
    assert "never retained" not in json.dumps(diagnostic.privacy_safe_event())


def test_unrecognized_success_shape_is_malformed_not_inconclusive() -> None:
    diagnostic = inspect(
        json.dumps(
            {
                "model": "nvidia/nemotron-parse",
                "choices": [{"message": {"content": None}}],
            }
        ).encode("utf-8")
    )

    assert classify_response_profile(diagnostic) == 5


def test_untrusted_structural_strings_cannot_become_content_channels() -> None:
    private_value = "CustomerRevenue"
    body = json.dumps(
        {
            private_value: "not retained",
            "model": f"nvidia/{private_value}",
            "choices": [
                {
                    "finish_reason": private_value,
                    "message": {
                        "content": None,
                        "tool_calls": [
                            {
                                "type": private_value,
                                "function": {
                                    "name": private_value,
                                    "arguments": "{}",
                                },
                            }
                        ],
                    },
                }
            ],
        }
    ).encode("utf-8")
    diagnostic = inspect(body)
    serialized = json.dumps(diagnostic.privacy_safe_event())

    assert diagnostic.returned_model == "other_nvidia_model"
    assert diagnostic.finish_reason is None
    assert diagnostic.tool_call_types == ("other",)
    assert diagnostic.function_names == ("other",)
    assert private_value not in serialized


def test_diagnostic_record_rejects_unbounded_caller_supplied_content() -> None:
    diagnostic = inspect(response())

    with pytest.raises(ValueError, match="response_profile_diagnostic_invalid"):
        replace(diagnostic, returned_model="private-document-text")
    with pytest.raises(ValueError, match="response_profile_diagnostic_invalid"):
        replace(diagnostic, top_level_response_keys=("private-document-text",))
