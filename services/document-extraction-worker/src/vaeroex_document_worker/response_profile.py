"""Content-free Nemotron Parse response-profile diagnostics."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .provider_contract import HOSTED_MODEL, V1_2_MODEL

DIAGNOSTIC_EVENT = "nemotron_parse_response_profile_v1"
DIAGNOSTIC_FIXTURE_ID = "synthetic-doc-executive-kpi-review"
DIAGNOSTIC_CONFIRMATION = "nemotron-parse-response-profile-one-call-v1"
MAX_DIAGNOSTIC_TOOL_CALLS = 16

_TOKEN = re.compile(r"^[A-Za-z0-9._:/+-]{1,160}$")
_MIME_TYPE = re.compile(r"^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$")
_TRACE_HEADERS = ("nvcf-reqid", "x-request-id", "traceparent")
_KNOWN_TOP_LEVEL_KEYS = frozenset(
    {
        "choices",
        "created",
        "id",
        "model",
        "object",
        "service_tier",
        "system_fingerprint",
        "usage",
    }
)
_KNOWN_FINISH_REASONS = frozenset(
    {"content_filter", "length", "stop", "tool_calls"}
)
_KNOWN_MODELS = frozenset({HOSTED_MODEL, V1_2_MODEL, "other_nvidia_model"})
_CONTENT_STATES = frozenset({"null", "empty", "non_empty"})
_KNOWN_TOOL_TYPES = frozenset({"function"})
_TOOL_TYPES = frozenset({"function", "other"})
_FUNCTION_NAMES = frozenset({"markdown_bbox", "other"})
_ARGUMENT_TYPES = frozenset(
    {"null", "string", "boolean", "number", "array", "object", "unknown"}
)
_TRUNCATION_INDICATORS = frozenset(
    {"finish_reason_length", "not_indicated", "unknown"}
)
_TOKEN_LIMIT_INDICATORS = frozenset({"indicated", "not_indicated", "unknown"})
MAX_DIAGNOSTIC_RESPONSE_BYTES = 2_000_000
MAX_DIAGNOSTIC_LATENCY_MS = 300_000


def _strict_json(value: bytes | str) -> Any:
    text = value.decode("utf-8") if isinstance(value, bytes) else value

    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, item in pairs:
            if key in result:
                raise ValueError("duplicate_json_key")
            result[key] = item
        return result

    def reject_constant(_value: str) -> None:
        raise ValueError("non_finite_json_number")

    return json.loads(
        text,
        object_pairs_hook=unique_object,
        parse_constant=reject_constant,
    )


def _safe_token(value: object) -> str | None:
    return value if isinstance(value, str) and _TOKEN.fullmatch(value) else None


def _known_token(value: object, allowed: frozenset[str]) -> str | None:
    return value if isinstance(value, str) and value in allowed else None


def _model_identifier(value: object) -> str | None:
    if value in (HOSTED_MODEL, V1_2_MODEL):
        return str(value)
    if isinstance(value, str) and value.startswith("nvidia/") and _TOKEN.fullmatch(value):
        return "other_nvidia_model"
    return None


def _transport_type(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, str):
        return "string"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "unknown"


def _content_state(message: Mapping[str, object] | None) -> str | None:
    if message is None or "content" not in message:
        return None
    content = message.get("content")
    if content is None:
        return "null"
    if content == "":
        return "empty"
    return "non_empty"


def _normalized_content_type(headers: Mapping[str, str]) -> str | None:
    value = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    return value if _MIME_TYPE.fullmatch(value) else None


def _provider_request_id(headers: Mapping[str, str], response: object) -> str | None:
    for name in _TRACE_HEADERS:
        value = _safe_token(headers.get(name))
        if value is not None:
            return value
    if isinstance(response, dict):
        return _safe_token(response.get("id"))
    return None


@dataclass(frozen=True)
class ResponseProfileDiagnosticV1:
    http_status: int
    response_content_type: str | None
    returned_model: str | None
    finish_reason: str | None
    assistant_content_state: str | None
    tool_call_count: int
    tool_call_types: tuple[str | None, ...]
    function_names: tuple[str | None, ...]
    arguments_transport_types: tuple[str, ...]
    arguments_byte_lengths: tuple[int, ...]
    arguments_complete_json: tuple[bool | None, ...]
    top_level_response_keys: tuple[str, ...]
    truncation_indicator: str
    token_limit_indicator: str
    provider_request_id: str | None
    response_byte_count: int
    latency_ms: int

    def __post_init__(self) -> None:
        retained_count = (
            min(self.tool_call_count, MAX_DIAGNOSTIC_TOOL_CALLS)
            if self.tool_call_count >= 0
            else 0
        )
        parallel_fields = (
            self.tool_call_types,
            self.function_names,
            self.arguments_transport_types,
            self.arguments_byte_lengths,
            self.arguments_complete_json,
        )
        if (
            not 100 <= self.http_status <= 599
            or (
                self.response_content_type is not None
                and _MIME_TYPE.fullmatch(self.response_content_type) is None
            )
            or (
                self.returned_model is not None
                and self.returned_model not in _KNOWN_MODELS
            )
            or (
                self.finish_reason is not None
                and self.finish_reason not in _KNOWN_FINISH_REASONS
            )
            or (
                self.assistant_content_state is not None
                and self.assistant_content_state not in _CONTENT_STATES
            )
            or not -1 <= self.tool_call_count <= 10_000
            or any(len(field) != retained_count for field in parallel_fields)
            or any(
                value is not None and value not in _TOOL_TYPES
                for value in self.tool_call_types
            )
            or any(
                value is not None and value not in _FUNCTION_NAMES
                for value in self.function_names
            )
            or any(
                value not in _ARGUMENT_TYPES
                for value in self.arguments_transport_types
            )
            or any(
                not 0 <= value <= MAX_DIAGNOSTIC_RESPONSE_BYTES
                for value in self.arguments_byte_lengths
            )
            or any(
                value is not None and not isinstance(value, bool)
                for value in self.arguments_complete_json
            )
            or tuple(sorted(set(self.top_level_response_keys)))
            != self.top_level_response_keys
            or not set(self.top_level_response_keys).issubset(_KNOWN_TOP_LEVEL_KEYS)
            or self.truncation_indicator not in _TRUNCATION_INDICATORS
            or self.token_limit_indicator not in _TOKEN_LIMIT_INDICATORS
            or (
                self.provider_request_id is not None
                and _safe_token(self.provider_request_id) is None
            )
            or not 0 <= self.response_byte_count <= MAX_DIAGNOSTIC_RESPONSE_BYTES
            or not 0 <= self.latency_ms <= MAX_DIAGNOSTIC_LATENCY_MS
        ):
            raise ValueError("response_profile_diagnostic_invalid")

    def privacy_safe_event(self) -> dict[str, object]:
        return {
            "event": DIAGNOSTIC_EVENT,
            "httpStatus": self.http_status,
            "responseContentType": self.response_content_type,
            "returnedModel": self.returned_model,
            "finishReason": self.finish_reason,
            "assistantContentState": self.assistant_content_state,
            "toolCallCount": self.tool_call_count,
            "toolCallTypes": list(self.tool_call_types),
            "functionNames": list(self.function_names),
            "argumentsTransportTypes": list(self.arguments_transport_types),
            "argumentsByteLengths": list(self.arguments_byte_lengths),
            "argumentsCompleteJson": list(self.arguments_complete_json),
            "topLevelResponseKeys": list(self.top_level_response_keys),
            "truncationIndicator": self.truncation_indicator,
            "tokenLimitIndicator": self.token_limit_indicator,
            "providerRequestId": self.provider_request_id,
            "responseByteCount": self.response_byte_count,
            "latencyMs": self.latency_ms,
        }


def inspect_response_profile(
    *,
    http_status: int,
    headers: Mapping[str, str],
    response_body: bytes | None,
    response_byte_count: int,
    latency_ms: int,
) -> ResponseProfileDiagnosticV1:
    response: object = None
    if response_body is not None:
        try:
            response = _strict_json(response_body)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            response = None

    top_level_keys: tuple[str, ...] = ()
    returned_model: str | None = None
    choice: Mapping[str, object] | None = None
    if isinstance(response, dict):
        safe_keys = sorted(
            key
            for key in response
            if isinstance(key, str) and key in _KNOWN_TOP_LEVEL_KEYS
        )
        top_level_keys = tuple(safe_keys[:32])
        returned_model = _model_identifier(response.get("model"))
        choices = response.get("choices")
        if isinstance(choices, list) and len(choices) == 1 and isinstance(choices[0], dict):
            choice = choices[0]

    finish_reason = (
        _known_token(choice.get("finish_reason"), _KNOWN_FINISH_REASONS)
        if choice is not None
        else None
    )
    message: Mapping[str, object] | None = None
    raw_message = choice.get("message") if choice is not None else None
    if isinstance(raw_message, dict):
        message = raw_message

    tool_calls_value = message.get("tool_calls") if message is not None else None
    tool_calls: Sequence[object]
    if tool_calls_value is None:
        tool_calls = ()
        tool_call_count = 0
    elif isinstance(tool_calls_value, list):
        tool_calls = tool_calls_value
        tool_call_count = len(tool_calls_value)
    else:
        tool_calls = ()
        tool_call_count = -1

    tool_types: list[str | None] = []
    function_names: list[str | None] = []
    argument_types: list[str] = []
    argument_lengths: list[int] = []
    arguments_complete: list[bool | None] = []
    invalid_arguments_json = False
    for raw_call in tool_calls[:MAX_DIAGNOSTIC_TOOL_CALLS]:
        call = raw_call if isinstance(raw_call, dict) else {}
        tool_types.append(
            _known_token(call.get("type"), _KNOWN_TOOL_TYPES)
            or ("other" if isinstance(call.get("type"), str) else None)
        )
        raw_function = call.get("function")
        function: Mapping[str, object] = (
            raw_function if isinstance(raw_function, dict) else {}
        )
        function_names.append(
            "markdown_bbox"
            if function.get("name") == "markdown_bbox"
            else ("other" if isinstance(function.get("name"), str) else None)
        )
        arguments = function.get("arguments")
        argument_types.append(_transport_type(arguments))
        if isinstance(arguments, str):
            argument_lengths.append(len(arguments.encode("utf-8")))
            try:
                _strict_json(arguments)
                arguments_complete.append(True)
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
                arguments_complete.append(False)
                invalid_arguments_json = True
        else:
            argument_lengths.append(0)
            arguments_complete.append(None)

    if finish_reason == "length":
        truncation_indicator = "finish_reason_length"
        token_limit_indicator = "indicated"
    elif invalid_arguments_json:
        truncation_indicator = "not_indicated"
        token_limit_indicator = "unknown"
    elif finish_reason in ("stop", "tool_calls"):
        truncation_indicator = "not_indicated"
        token_limit_indicator = "not_indicated"
    else:
        truncation_indicator = "unknown"
        token_limit_indicator = "unknown"

    return ResponseProfileDiagnosticV1(
        http_status=http_status,
        response_content_type=_normalized_content_type(headers),
        returned_model=returned_model,
        finish_reason=finish_reason,
        assistant_content_state=_content_state(message),
        tool_call_count=tool_call_count,
        tool_call_types=tuple(tool_types),
        function_names=tuple(function_names),
        arguments_transport_types=tuple(argument_types),
        arguments_byte_lengths=tuple(argument_lengths),
        arguments_complete_json=tuple(arguments_complete),
        top_level_response_keys=top_level_keys,
        truncation_indicator=truncation_indicator,
        token_limit_indicator=token_limit_indicator,
        provider_request_id=_provider_request_id(headers, response),
        response_byte_count=response_byte_count,
        latency_ms=latency_ms,
    )


def classify_response_profile(diagnostic: ResponseProfileDiagnosticV1) -> int:
    """Return one of the six approved operator-facing profile classes."""

    if (
        diagnostic.http_status == 200
        and diagnostic.response_content_type == "application/json"
        and diagnostic.returned_model == HOSTED_MODEL
        and diagnostic.finish_reason == "tool_calls"
        and diagnostic.assistant_content_state in ("null", "empty")
        and diagnostic.tool_call_count == 1
        and diagnostic.tool_call_types == ("function",)
        and diagnostic.function_names == ("markdown_bbox",)
        and diagnostic.arguments_transport_types == ("string",)
        and diagnostic.arguments_complete_json == (True,)
    ):
        return 1
    if (
        diagnostic.http_status == 200
        and diagnostic.response_content_type == "application/json"
        and diagnostic.returned_model == V1_2_MODEL
        and diagnostic.finish_reason == "stop"
        and diagnostic.assistant_content_state == "non_empty"
        and diagnostic.tool_call_count == 0
    ):
        return 2
    if (
        diagnostic.finish_reason == "length"
        or diagnostic.truncation_indicator == "finish_reason_length"
    ):
        return 3
    if (
        diagnostic.http_status == 200
        and diagnostic.finish_reason == "stop"
        and diagnostic.assistant_content_state == "non_empty"
        and diagnostic.tool_call_count == 0
    ):
        return 4
    if diagnostic.http_status == 200:
        return 5
    return 6
