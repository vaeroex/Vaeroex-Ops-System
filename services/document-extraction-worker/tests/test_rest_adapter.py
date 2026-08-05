from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from PIL import Image

from vaeroex_document_worker import rest_adapter
from vaeroex_document_worker.field_path_diagnostic import FieldPathDiagnosticV1
from vaeroex_document_worker.provider_contract import (
    HOSTED_ACCEPTED_FINISH_REASONS,
    HOSTED_COMPATIBILITY_CONTRACT_VERSION,
    HOSTED_CONTRACT,
    HOSTED_ENDPOINT,
    HOSTED_ENDPOINT_PROFILE,
    HOSTED_RESPONSE_PROFILE,
    HOSTED_TOOL_NAME,
    LEGACY_HOSTED_CONTRACT,
    NVCF_ASSET_ENDPOINT,
    V1_2_NIM_CONTRACT,
    V1_2_TASK_PROMPT,
)
from vaeroex_document_worker.provider_types import (
    MAX_PROVIDER_LATENCY_MS,
    ProviderFailure,
    RenderedPage,
)
from vaeroex_document_worker.response_profile import (
    ResponseProfileDiagnosticV1,
    classify_response_profile,
)
from vaeroex_document_worker.rest_adapter import (
    MAX_HOSTED_ARGUMENT_BYTES,
    MAX_PROVIDER_RESPONSE_BYTES,
    HostedProviderRequestBindingV2,
    invoke_rest_adapter,
    normalize_provider_response,
    request_binding,
    serialize_provider_request,
)


def rendered_page(
    tmp_path: Path,
    *,
    byte_length: int = 64,
    width: int = 100,
    height: int = 100,
) -> RenderedPage:
    path = tmp_path / "page.png"
    if byte_length > 180_000:
        width = max(width, 300)
        height = max(height, 300)
        image = Image.new("RGB", (width, height), "white")
        image.save(path, "PNG", compress_level=0)
        image.close()
    else:
        image = Image.new("RGB", (width, height), "white")
        image.save(path, "PNG")
        image.close()
    content = path.read_bytes()
    return RenderedPage(
        page=1,
        path=path,
        mime_type="image/png",
        width=width,
        height=height,
        byte_length=len(content),
        content_sha256=hashlib.sha256(content).hexdigest(),
    )


def hosted_response(text: str = "Synthetic extraction") -> bytes:
    arguments = json.dumps(
        [
            {
                "type": "Text",
                "text": text,
                "bbox": {"xmin": 0.1, "ymin": 0.2, "xmax": 0.8, "ymax": 0.4},
            }
        ]
    )
    return json.dumps(
        {
            "model": HOSTED_CONTRACT.model,
            "choices": [
                {
                    "finish_reason": "tool_calls",
                    "message": {
                        "content": None,
                        "tool_calls": [
                            {
                                "type": "function",
                                "function": {"name": "markdown_bbox", "arguments": arguments},
                            }
                        ],
                    },
                }
            ],
        }
    ).encode("utf-8")


def hosted_stop_envelope() -> dict[str, Any]:
    response: dict[str, Any] = json.loads(hosted_response())
    response["choices"][0]["finish_reason"] = "stop"
    return response


def set_hosted_arguments(response: dict[str, Any], value: object) -> None:
    response["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = value


def test_hosted_request_serialization_matches_pinned_contract(tmp_path: Path) -> None:
    page = rendered_page(tmp_path)
    body = serialize_provider_request(
        HOSTED_CONTRACT,
        page,
        "data:image/png;base64,UFBQ",
        payload_mode="inline_base64",
    )
    payload = json.loads(body)

    assert payload == {
        "max_tokens": 8192,
        "messages": [
            {
                "content": [
                    {"image_url": {"url": "data:image/png;base64,UFBQ"}, "type": "image_url"}
                ],
                "role": "user",
            }
        ],
        "model": "nvidia/nemotron-parse",
        "temperature": 0.0,
        "tools": [{"function": {"name": "markdown_bbox"}, "type": "function"}],
    }


def test_hosted_v2_request_binding_seals_the_complete_compatibility_policy(
    tmp_path: Path,
) -> None:
    binding = request_binding(HOSTED_CONTRACT, rendered_page(tmp_path), "d" * 64)

    assert isinstance(binding, HostedProviderRequestBindingV2)
    assert binding.endpoint_profile == HOSTED_ENDPOINT_PROFILE
    assert binding.compatibility_contract_version == HOSTED_COMPATIBILITY_CONTRACT_VERSION
    assert binding.accepted_finish_reasons == HOSTED_ACCEPTED_FINISH_REASONS
    assert binding.tool_name == HOSTED_TOOL_NAME
    assert binding.request_serializer_version == "nemotron_parse_hosted_request_v1"
    assert binding.response_validator_version == "nemotron_parse_hosted_response_v2"
    assert binding.normalization_version == "nemotron_parse_hosted_normalization_v1"
    assert binding.coordinate_contract_version == "normalized_xyxy_unit_interval_v1"
    assert binding.compatibility_rationale.endswith("observed_stop_v1")


def test_hosted_v2_request_identity_is_distinct_from_historical_v1(
    tmp_path: Path,
) -> None:
    page = rendered_page(tmp_path)
    current = request_binding(HOSTED_CONTRACT, page, "d" * 64)
    historical = request_binding(LEGACY_HOSTED_CONTRACT, page, "d" * 64)

    assert current.fingerprint() != historical.fingerprint()
    assert current.adapter_version == "vaeroex_nemotron_parse_rest_v2"
    assert historical.adapter_version == "vaeroex_nemotron_parse_rest_v1"


def test_historical_hosted_v1_keeps_its_original_stop_rejection(
    tmp_path: Path,
) -> None:
    response = json.loads(hosted_response())
    response["choices"][0]["finish_reason"] = "stop"

    with pytest.raises(ProviderFailure, match="provider_malformed_hosted_finish_stop"):
        normalize_provider_response(
            LEGACY_HOSTED_CONTRACT,
            rendered_page(tmp_path),
            json.dumps(response).encode("utf-8"),
        )


def test_v1_2_request_and_response_profile_is_explicitly_distinct(tmp_path: Path) -> None:
    page = rendered_page(tmp_path, width=1_664, height=2_048)
    body = serialize_provider_request(
        V1_2_NIM_CONTRACT,
        page,
        "data:image/png;base64,UFBQ",
        payload_mode="inline_base64",
    )
    payload = json.loads(body)
    assert payload["model"] == "nvidia/nemotron-parse-v1.2"
    assert payload["messages"][0]["content"][0] == {"type": "text", "text": V1_2_TASK_PROMPT}
    assert payload["skip_special_tokens"] is False
    response = json.dumps(
        {
            "model": V1_2_NIM_CONTRACT.model,
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": "<x_0.1><y_0.1>Heading<x_0.5><y_0.2><class_Title>"
                    },
                }
            ],
        }
    ).encode("utf-8")
    normalized = normalize_provider_response(V1_2_NIM_CONTRACT, page, response)
    assert normalized["blocks"][0]["kind"] == "heading"


def test_inline_inference_normalizes_without_retaining_raw_response(tmp_path: Path) -> None:
    page = rendered_page(tmp_path)
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, headers={"content-type": "application/json"}, content=hosted_response())

    result = invoke_rest_adapter(
        [page],
        "d" * 64,
        HOSTED_CONTRACT,
        "secret-not-returned",
        transport=httpx.MockTransport(handler),
    )

    assert len(requests) == 1
    assert requests[0].url == httpx.URL(HOSTED_ENDPOINT)
    assert requests[0].headers["authorization"] == "Bearer secret-not-returned"
    assert result.pages[0]["blocks"][0]["text"] == "Synthetic extraction"
    assert "raw" not in repr(result).lower()
    assert "secret-not-returned" not in repr(result)


@pytest.mark.parametrize("content", (None, ""))
def test_hosted_v2_accepts_complete_tool_payload_for_both_approved_finish_reasons(
    tmp_path: Path,
    content: object,
) -> None:
    for finish_reason in HOSTED_ACCEPTED_FINISH_REASONS:
        response = json.loads(hosted_response())
        response["choices"][0]["finish_reason"] = finish_reason
        response["choices"][0]["message"]["content"] = content

        normalized = normalize_provider_response(
            HOSTED_CONTRACT,
            rendered_page(tmp_path),
            json.dumps(response).encode("utf-8"),
        )

        assert normalized["blocks"][0]["text"] == "Synthetic extraction"


def test_observed_content_free_stop_envelope_is_accepted_only_by_hosted_v2(
    tmp_path: Path,
) -> None:
    element = {
        "type": "Text",
        "text": "",
        "bbox": {"xmin": 0.1, "ymin": 0.2, "xmax": 0.8, "ymax": 0.4},
    }
    base = json.dumps([element], separators=(",", ":"))
    element["text"] = "S" * (1_892 - len(base.encode("utf-8")))
    arguments = json.dumps([element], separators=(",", ":"))
    assert len(arguments.encode("utf-8")) == 1_892
    response = {
        "id": "chatcmpl-content-free-test",
        "object": "chat.completion",
        "created": 1,
        "model": HOSTED_CONTRACT.model,
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "logprobs": None,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "refusal": None,
                    "tool_calls": [
                        {
                            "id": "call_content_free_test",
                            "type": "function",
                            "function": {
                                "name": "markdown_bbox",
                                "arguments": arguments,
                            },
                        }
                    ],
                },
            }
        ],
        "usage": {"completion_tokens": 512},
    }
    body = json.dumps(response).encode("utf-8")
    observed: list[ResponseProfileDiagnosticV1] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={
                "content-type": "application/json",
                "nvcf-reqid": "6cf6e948-8c47-4347-b450-50458387eff7",
            },
            content=body,
        )

    result = invoke_rest_adapter(
        [rendered_page(tmp_path)],
        "d" * 64,
        HOSTED_CONTRACT,
        "test-secret",
        transport=httpx.MockTransport(handler),
        response_profile_observer=observed.append,
    )

    assert len(result.pages[0]["blocks"][0]["text"]) > 1_700
    assert observed[0].finish_reason == "stop"
    assert observed[0].arguments_byte_lengths == (1_892,)
    assert observed[0].arguments_complete_json == (True,)
    assert observed[0].provider_request_id == "6cf6e948-8c47-4347-b450-50458387eff7"
    # Historical diagnostics remain comparable; only the new v2 validator
    # interprets this complete envelope as accepted extraction.
    assert classify_response_profile(observed[0]) == 5


def test_response_profile_observer_runs_before_fail_closed_validation(
    tmp_path: Path,
) -> None:
    response = json.loads(hosted_response())
    response["choices"][0]["finish_reason"] = "stop"
    response["choices"][0]["message"]["content"] = "private provider prose"
    response["choices"][0]["message"]["tool_calls"] = []
    body = json.dumps(response).encode("utf-8")
    observed: list[ResponseProfileDiagnosticV1] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={
                "content-type": "application/json",
                "nvcf-reqid": "safe-provider-request-id",
            },
            content=body,
        )

    with pytest.raises(ProviderFailure) as caught:
        invoke_rest_adapter(
            [rendered_page(tmp_path)],
            "d" * 64,
            HOSTED_CONTRACT,
            "test-secret",
            transport=httpx.MockTransport(handler),
            response_profile_observer=observed.append,
        )

    assert caught.value.code == "provider_malformed_hosted_content"
    assert len(observed) == 1
    assert classify_response_profile(observed[0]) == 4
    assert observed[0].provider_request_id == "safe-provider-request-id"
    assert "private provider prose" not in json.dumps(
        observed[0].privacy_safe_event()
    )


def test_response_profile_observer_failure_cannot_change_provider_result(
    tmp_path: Path,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            content=hosted_response(),
        )

    def broken_observer(_diagnostic: ResponseProfileDiagnosticV1) -> None:
        raise RuntimeError("observer failure")

    result = invoke_rest_adapter(
        [rendered_page(tmp_path)],
        "d" * 64,
        HOSTED_CONTRACT,
        "test-secret",
        transport=httpx.MockTransport(handler),
        response_profile_observer=broken_observer,
    )

    assert result.pages[0]["blocks"][0]["text"] == "Synthetic extraction"


class AdvancingClock:
    def __init__(self, step: float = 0.025) -> None:
        self.value = 100.0
        self.step = step

    def __call__(self) -> float:
        self.value += self.step
        return self.value


def test_field_path_observer_runs_before_unchanged_schema_rejection(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    response = hosted_stop_envelope()
    set_hosted_arguments(
        response,
        json.dumps(
            [
                {
                    "class": "private-class-value",
                    "text": "private extracted value",
                    "bbox": [0.1, 0.2, 0.8, 0.4],
                }
            ]
        ),
    )
    body = json.dumps(response).encode("utf-8")
    observed: list[FieldPathDiagnosticV1] = []
    monkeypatch.setattr(
        "vaeroex_document_worker.rest_adapter.time.perf_counter",
        AdvancingClock(),
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={
                "content-type": "application/json",
                "nvcf-reqid": "safe-provider-request-id",
            },
            content=body,
        )

    with pytest.raises(ProviderFailure) as caught:
        invoke_rest_adapter(
            [rendered_page(tmp_path)],
            "d" * 64,
            HOSTED_CONTRACT,
            "test-secret",
            transport=httpx.MockTransport(handler),
            field_path_observer=observed.append,
        )

    assert caught.value.code == "provider_output_schema_mismatch"
    assert caught.value.provider_request_started
    assert caught.value.latency_ms is not None and caught.value.latency_ms > 0
    assert len(observed) == 1
    assert observed[0].first_failure_class == "missing_required_key"
    event = json.dumps(observed[0].privacy_safe_event(), sort_keys=True)
    assert "private extracted value" not in event
    assert "private-class-value" not in event
    assert "0.1" not in event


def test_field_path_observer_reports_valid_shape_without_changing_acceptance(
    tmp_path: Path,
) -> None:
    response = hosted_stop_envelope()
    observed: list[FieldPathDiagnosticV1] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            content=json.dumps(response).encode("utf-8"),
        )

    result = invoke_rest_adapter(
        [rendered_page(tmp_path)],
        "d" * 64,
        HOSTED_CONTRACT,
        "test-secret",
        transport=httpx.MockTransport(handler),
        field_path_observer=observed.append,
    )

    assert result.pages[0]["blocks"][0]["text"] == "Synthetic extraction"
    assert len(observed) == 1
    assert observed[0].first_failure_class is None


def test_field_path_observer_failure_cannot_change_provider_result(
    tmp_path: Path,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            content=hosted_response(),
        )

    def broken_observer(_diagnostic: FieldPathDiagnosticV1) -> None:
        raise RuntimeError("provider-controlled private exception text")

    result = invoke_rest_adapter(
        [rendered_page(tmp_path)],
        "d" * 64,
        HOSTED_CONTRACT,
        "test-secret",
        transport=httpx.MockTransport(handler),
        field_path_observer=broken_observer,
    )

    assert result.pages[0]["blocks"][0]["text"] == "Synthetic extraction"


def test_field_path_observer_rejects_every_non_v2_contract_before_network() -> None:
    with pytest.raises(ValueError, match="exact hosted_tool_call_v2 contract"):
        invoke_rest_adapter(
            [],
            "d" * 64,
            LEGACY_HOSTED_CONTRACT,
            "test-secret",
            field_path_observer=lambda _diagnostic: None,
        )


def test_success_schema_failure_malformed_json_and_timeout_record_bounded_latency(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(
        "vaeroex_document_worker.rest_adapter.time.perf_counter",
        AdvancingClock(),
    )

    def success(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            content=hosted_response(),
        )

    result = invoke_rest_adapter(
        [rendered_page(tmp_path)],
        "d" * 64,
        HOSTED_CONTRACT,
        "test-secret",
        transport=httpx.MockTransport(success),
    )
    assert 0 < result.latency_ms <= MAX_PROVIDER_LATENCY_MS

    for body, expected_code in (
        (b"{", "provider_output_malformed"),
        (
            json.dumps(
                {
                    "model": HOSTED_CONTRACT.model,
                    "choices": [{"finish_reason": "stop", "message": {}}],
                }
            ).encode("utf-8"),
            "provider_output_schema_mismatch",
        ),
    ):
        with pytest.raises(ProviderFailure) as caught:
            invoke_rest_adapter(
                [rendered_page(tmp_path)],
                "d" * 64,
                HOSTED_CONTRACT,
                "test-secret",
                transport=httpx.MockTransport(
                    lambda _request, payload=body: httpx.Response(
                        200,
                        headers={"content-type": "application/json"},
                        content=payload,
                    )
                ),
            )
        assert caught.value.code == expected_code
        assert caught.value.provider_request_started
        assert caught.value.latency_ms is not None and caught.value.latency_ms > 0

    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("private provider timeout text", request=request)

    with pytest.raises(ProviderFailure) as timed_out:
        invoke_rest_adapter(
            [rendered_page(tmp_path)],
            "d" * 64,
            HOSTED_CONTRACT,
            "test-secret",
            transport=httpx.MockTransport(timeout),
        )
    assert timed_out.value.provider_request_started
    assert timed_out.value.latency_ms is not None and timed_out.value.latency_ms > 0
    assert "private provider timeout text" not in str(timed_out.value)


def test_pre_network_rejection_and_elapsed_bounds_are_explicit(
    monkeypatch: Any,
) -> None:
    with pytest.raises(ProviderFailure) as rejected:
        invoke_rest_adapter([], "d" * 64, HOSTED_CONTRACT, "test-secret")
    assert rejected.value.latency_ms is None
    assert not rejected.value.provider_request_started

    monkeypatch.setattr(
        "vaeroex_document_worker.rest_adapter.time.perf_counter",
        lambda: 9.0,
    )
    assert rest_adapter._bounded_elapsed_ms(10.0) == 0
    monkeypatch.setattr(
        "vaeroex_document_worker.rest_adapter.time.perf_counter",
        lambda: 1_000.0,
    )
    assert rest_adapter._bounded_elapsed_ms(0.0) == MAX_PROVIDER_LATENCY_MS


@pytest.mark.parametrize(
    ("finish_reason", "content", "expected_code"),
    (
        ("length", None, "provider_malformed_output_truncated"),
        (
            "stop",
            "<x_0.1><y_0.1>synthetic<x_0.2><y_0.2><class_Text>",
            "provider_malformed_hosted_content",
        ),
        (None, None, "provider_malformed_hosted_finish_missing"),
        ("content_filter", None, "provider_malformed_hosted_finish_invalid"),
        ("tool_calls", "synthetic parallel content", "provider_malformed_hosted_content"),
    ),
)
def test_hosted_completion_shape_fails_closed_with_content_free_diagnostics(
    tmp_path: Path,
    finish_reason: object,
    content: object,
    expected_code: str,
) -> None:
    response = json.loads(hosted_response())
    response["choices"][0]["finish_reason"] = finish_reason
    response["choices"][0]["message"]["content"] = content

    with pytest.raises(ProviderFailure) as caught:
        normalize_provider_response(
            HOSTED_CONTRACT,
            rendered_page(tmp_path),
            json.dumps(response).encode("utf-8"),
        )

    assert caught.value.code == expected_code
    assert caught.value.result_class == "malformed_output"
    assert caught.value.retryable is False
    assert "synthetic" not in caught.value.code


@pytest.mark.parametrize(
    ("variant", "expected_code"),
    (
        ("no_tool_call", "provider_output_schema_mismatch"),
        ("ordinary_content_only", "provider_malformed_hosted_content"),
        ("conflicting_content", "provider_malformed_hosted_content"),
        ("multiple_tool_calls", "provider_output_schema_mismatch"),
        ("wrong_tool_type", "provider_output_schema_mismatch"),
        ("wrong_function", "provider_output_schema_mismatch"),
        ("arguments_not_string", "provider_output_schema_mismatch"),
        ("unknown_envelope_key", "provider_output_schema_mismatch"),
        ("unknown_tool_key", "provider_output_schema_mismatch"),
    ),
)
def test_hosted_v2_stop_rejects_every_unapproved_envelope_shape(
    tmp_path: Path,
    variant: str,
    expected_code: str,
) -> None:
    response = hosted_stop_envelope()
    message = response["choices"][0]["message"]
    tool_call = message["tool_calls"][0]
    if variant == "no_tool_call":
        message["tool_calls"] = []
    elif variant == "ordinary_content_only":
        message["tool_calls"] = []
        message["content"] = "ordinary assistant content"
    elif variant == "conflicting_content":
        message["content"] = "conflicting assistant content"
    elif variant == "multiple_tool_calls":
        message["tool_calls"].append(dict(tool_call))
    elif variant == "wrong_tool_type":
        tool_call["type"] = "text"
    elif variant == "wrong_function":
        tool_call["function"]["name"] = "other_tool"
    elif variant == "arguments_not_string":
        tool_call["function"]["arguments"] = []
    elif variant == "unknown_envelope_key":
        response["provider_extension"] = True
    elif variant == "unknown_tool_key":
        tool_call["provider_extension"] = True

    with pytest.raises(ProviderFailure) as caught:
        normalize_provider_response(
            HOSTED_CONTRACT,
            rendered_page(tmp_path),
            json.dumps(response).encode("utf-8"),
        )

    assert caught.value.code == expected_code
    assert caught.value.result_class == "malformed_output"
    assert caught.value.retryable is False


@pytest.mark.parametrize(
    ("arguments", "expected_code"),
    (
        ("[", "provider_output_malformed"),
        ('[{"type":"Text"', "provider_output_malformed"),
        ("{}", "provider_output_schema_mismatch"),
        (
            '[{"type":"Text","text":"value"}]',
            "provider_output_schema_mismatch",
        ),
        (
            '[{"id":"provider-id","type":"Text","text":"value","bbox":{"xmin":0.1,"ymin":0.1,"xmax":0.2,"ymax":0.2}}]',
            "provider_output_schema_mismatch",
        ),
        (
            '[{"page":2,"type":"Text","text":"value","bbox":{"xmin":0.1,"ymin":0.1,"xmax":0.2,"ymax":0.2}}]',
            "provider_output_schema_mismatch",
        ),
        (
            '[{"order":2,"type":"Text","text":"value","bbox":{"xmin":0.1,"ymin":0.1,"xmax":0.2,"ymax":0.2}}]',
            "provider_output_schema_mismatch",
        ),
        (
            '[{"type":"Text","text":"value","bbox":{"xmin":0.1,"ymin":0.1,"xmax":1.1,"ymax":0.2}}]',
            "provider_coordinates_invalid",
        ),
        (
            '[{"type":"Text","text":"value","bbox":{"xmin":NaN,"ymin":0.1,"xmax":0.2,"ymax":0.2}}]',
            "provider_output_malformed",
        ),
        (
            '[{"type":"Text","text":"value","bbox":{"xmin":"0.1","ymin":0.1,"xmax":0.2,"ymax":0.2}}]',
            "provider_coordinates_invalid",
        ),
        (
            '[{"type":"Text","text":"value","bbox":{"xmin":true,"ymin":0.1,"xmax":0.2,"ymax":0.2}}]',
            "provider_coordinates_invalid",
        ),
        (
            '[{"type":"Text","text":"<x_0.1><y_0.1>mixed<x_0.2><y_0.2><class_Text>","bbox":{"xmin":0.1,"ymin":0.1,"xmax":0.2,"ymax":0.2}}]',
            "provider_mixed_response_profile",
        ),
    ),
)
def test_hosted_v2_stop_rejects_malformed_schema_bounds_and_mixed_profiles(
    tmp_path: Path,
    arguments: str,
    expected_code: str,
) -> None:
    response = hosted_stop_envelope()
    set_hosted_arguments(response, arguments)

    with pytest.raises(ProviderFailure) as caught:
        normalize_provider_response(
            HOSTED_CONTRACT,
            rendered_page(tmp_path),
            json.dumps(response).encode("utf-8"),
        )

    assert caught.value.code == expected_code
    assert caught.value.result_class == "malformed_output"


def test_hosted_v2_stop_rejects_oversized_tool_arguments_before_json_parsing(
    tmp_path: Path,
) -> None:
    response = hosted_stop_envelope()
    set_hosted_arguments(response, "[" + ("x" * MAX_HOSTED_ARGUMENT_BYTES) + "]")

    with pytest.raises(ProviderFailure, match="provider_arguments_oversized"):
        normalize_provider_response(
            HOSTED_CONTRACT,
            rendered_page(tmp_path),
            json.dumps(response).encode("utf-8"),
        )


@pytest.mark.parametrize(
    "signal",
    ("response_truncated", "choice_incomplete", "message_truncated", "token_limit"),
)
def test_hosted_v2_rejects_explicit_truncation_or_token_limit_signals(
    tmp_path: Path,
    signal: str,
) -> None:
    response = hosted_stop_envelope()
    if signal == "response_truncated":
        response["truncated"] = True
    elif signal == "choice_incomplete":
        response["choices"][0]["incomplete"] = True
    elif signal == "message_truncated":
        response["choices"][0]["message"]["truncated"] = True
    else:
        response["usage"] = {"completion_tokens": 8_192}

    with pytest.raises(ProviderFailure, match="provider_malformed_output_truncated"):
        normalize_provider_response(
            HOSTED_CONTRACT,
            rendered_page(tmp_path),
            json.dumps(response).encode("utf-8"),
        )


def test_profile_responses_cannot_cross_adapter_contracts(tmp_path: Path) -> None:
    page = rendered_page(tmp_path, width=1_664, height=2_048)
    tagged = json.dumps(
        {
            "model": HOSTED_CONTRACT.model,
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": "<x_0.1><y_0.1>Heading<x_0.5><y_0.2><class_Title>"
                    },
                }
            ],
        }
    ).encode("utf-8")

    with pytest.raises(ProviderFailure):
        normalize_provider_response(HOSTED_CONTRACT, page, tagged)
    with pytest.raises(ProviderFailure):
        normalize_provider_response(V1_2_NIM_CONTRACT, page, hosted_response())


def test_large_page_uses_bounded_nvcf_asset_flow_and_deletes_asset(tmp_path: Path) -> None:
    page = rendered_page(tmp_path, byte_length=180_001)
    asset_id = str(uuid.uuid4())
    operations: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        operations.append(f"{request.method} {request.url}")
        if request.method == "POST" and str(request.url) == NVCF_ASSET_ENDPOINT:
            return httpx.Response(
                200,
                headers={"content-type": "application/json"},
                json={
                    "assetId": asset_id,
                    "uploadUrl": "https://synthetic-bucket.s3.us-west-2.amazonaws.com/upload?signature=test",
                },
            )
        if request.method == "PUT":
            assert "authorization" not in request.headers
            assert request.headers["x-amz-meta-nvcf-asset-description"] == "vaeroex-document-page"
            return httpx.Response(200)
        if request.method == "POST" and str(request.url) == HOSTED_ENDPOINT:
            assert request.headers["nvcf-input-asset-references"] == asset_id
            assert f"asset_id,{asset_id}" in request.content.decode("utf-8")
            return httpx.Response(200, headers={"content-type": "application/json"}, content=hosted_response())
        if request.method == "DELETE":
            return httpx.Response(204)
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    result = invoke_rest_adapter(
        [page],
        "d" * 64,
        HOSTED_CONTRACT,
        "test-secret",
        transport=httpx.MockTransport(handler),
    )

    assert result.payload_modes == ("nvcf_asset_reference",)
    assert [operation.split(" ", 1)[0] for operation in operations] == ["POST", "PUT", "POST", "DELETE"]


def test_ambiguous_asset_upload_never_dispatches_inference(tmp_path: Path) -> None:
    page = rendered_page(tmp_path, byte_length=180_001)
    asset_id = str(uuid.uuid4())
    inference_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal inference_calls
        if request.method == "POST" and str(request.url) == NVCF_ASSET_ENDPOINT:
            return httpx.Response(
                200,
                headers={"content-type": "application/json"},
                json={
                    "assetId": asset_id,
                    "uploadUrl": "https://synthetic-bucket.s3.us-west-2.amazonaws.com/upload",
                },
            )
        if request.method == "PUT":
            raise httpx.ReadTimeout("synthetic ambiguous upload", request=request)
        if request.method == "DELETE":
            return httpx.Response(204)
        if str(request.url) == HOSTED_ENDPOINT:
            inference_calls += 1
        raise AssertionError("inference must not follow an ambiguous asset upload")

    with pytest.raises(ProviderFailure) as caught:
        invoke_rest_adapter(
            [page],
            "d" * 64,
            HOSTED_CONTRACT,
            "test-secret",
            transport=httpx.MockTransport(handler),
        )
    assert caught.value.ambiguous is True
    assert caught.value.retryable is False
    assert inference_calls == 0


def test_rate_limit_is_retryable_but_adapter_does_not_retry_internally(tmp_path: Path) -> None:
    page = rendered_page(tmp_path)
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(429, request=request)

    with pytest.raises(ProviderFailure) as caught:
        invoke_rest_adapter(
            [page],
            "d" * 64,
            HOSTED_CONTRACT,
            "test-secret",
            transport=httpx.MockTransport(handler),
        )
    assert caught.value.retryable is True
    assert caught.value.ambiguous is False
    assert calls == 1


def test_unsupported_endpoint_version_fails_closed_before_request(tmp_path: Path) -> None:
    page = rendered_page(tmp_path)
    invalid = replace(HOSTED_CONTRACT, endpoint="https://example.test/v1/chat/completions")
    with pytest.raises(ProviderFailure, match="provider_endpoint_contract_mismatch"):
        invoke_rest_adapter([page], "d" * 64, invalid, "test-secret")


@pytest.mark.parametrize(
    "invalid",
    (
        replace(HOSTED_CONTRACT, endpoint_contract_version="unknown-contract-v99"),
        replace(HOSTED_CONTRACT, model="nvidia/unknown-model"),
        replace(
            HOSTED_CONTRACT,
            response_profile="unknown-profile",
            endpoint="https://example.test/v1/chat/completions",
        ),
    ),
)
def test_unknown_contract_values_fail_before_any_request(
    tmp_path: Path,
    invalid: object,
) -> None:
    page = rendered_page(tmp_path)
    requests = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(500)

    with pytest.raises(ProviderFailure, match="provider_contract_unsupported"):
        invoke_rest_adapter(
            [page],
            "d" * 64,
            invalid,  # type: ignore[arg-type]
            "must-not-leave-process",
            transport=httpx.MockTransport(handler),
        )
    assert requests == 0


def test_forged_page_dimensions_fail_before_any_request(tmp_path: Path) -> None:
    page = rendered_page(tmp_path)
    forged = replace(page, width=page.width + 1)
    requests = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(500)

    with pytest.raises(ProviderFailure, match="provider_page_dimensions_mismatch"):
        invoke_rest_adapter(
            [forged],
            "d" * 64,
            HOSTED_CONTRACT,
            "test-secret",
            transport=httpx.MockTransport(handler),
        )
    assert requests == 0


def test_duplicate_bounding_box_fails_closed(tmp_path: Path) -> None:
    arguments = json.dumps(
        [
            {
                "type": "Text",
                "text": "First value",
                "bbox": {"xmin": 0.1, "ymin": 0.2, "xmax": 0.8, "ymax": 0.4},
            },
            {
                "type": "Text",
                "text": "Different value",
                "bbox": {"xmin": 0.1, "ymin": 0.2, "xmax": 0.8, "ymax": 0.4},
            },
        ]
    )
    response = json.dumps(
        {
            "model": HOSTED_CONTRACT.model,
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": None,
                        "tool_calls": [
                            {
                                "type": "function",
                                "function": {"name": "markdown_bbox", "arguments": arguments},
                            }
                        ],
                    },
                }
            ],
        }
    ).encode("utf-8")

    with pytest.raises(ProviderFailure, match="provider_duplicate_coordinates"):
        normalize_provider_response(HOSTED_CONTRACT, rendered_page(tmp_path), response)


def test_hosted_v2_generates_unique_ordered_ids_and_authoritative_page_references(
    tmp_path: Path,
) -> None:
    response = hosted_stop_envelope()
    set_hosted_arguments(
        response,
        json.dumps(
            [
                {
                    "type": "Title",
                    "text": "First",
                    "bbox": {"xmin": 0.1, "ymin": 0.1, "xmax": 0.8, "ymax": 0.2},
                },
                {
                    "type": "Text",
                    "text": "Second",
                    "bbox": {"xmin": 0.1, "ymin": 0.3, "xmax": 0.8, "ymax": 0.4},
                },
            ]
        ),
    )

    normalized = normalize_provider_response(
        HOSTED_CONTRACT,
        rendered_page(tmp_path),
        json.dumps(response).encode("utf-8"),
    )

    assert [block["id"] for block in normalized["blocks"]] == [
        "page-1-element-1",
        "page-1-element-2",
    ]
    assert [block["text"] for block in normalized["blocks"]] == ["First", "Second"]
    assert {block["coordinates"]["page"] for block in normalized["blocks"]} == {1}


@pytest.mark.parametrize(
    "response",
    (
        b'{"model":"nvidia/nemotron-parse","model":"other"}',
        json.dumps(
            {
                "model": HOSTED_CONTRACT.model,
                "choices": [
                    {
                        "finish_reason": "tool_calls",
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "type": "function",
                                    "function": {
                                        "name": "markdown_bbox",
                                        "arguments": '[{"type":"Unknown","text":"x","bbox":{"xmin":0,"ymin":0,"xmax":1,"ymax":1}}]',
                                    },
                                }
                            ],
                        },
                    }
                ],
            }
        ).encode("utf-8"),
    ),
)
def test_malformed_or_unsupported_responses_fail_closed(tmp_path: Path, response: bytes) -> None:
    with pytest.raises(ProviderFailure):
        normalize_provider_response(HOSTED_CONTRACT, rendered_page(tmp_path), response)


def test_oversized_response_fails_closed(tmp_path: Path) -> None:
    with pytest.raises(ProviderFailure, match="provider_response_oversized"):
        normalize_provider_response(
            HOSTED_CONTRACT,
            rendered_page(tmp_path),
            b"{" + (b" " * MAX_PROVIDER_RESPONSE_BYTES) + b"}",
        )


def test_wrong_model_and_truncated_response_fail_closed(tmp_path: Path) -> None:
    wrong_model = hosted_stop_envelope()
    wrong_model["model"] = "nvidia/other-model"
    with pytest.raises(ProviderFailure, match="provider_output_contract_mismatch"):
        normalize_provider_response(
            HOSTED_CONTRACT,
            rendered_page(tmp_path),
            json.dumps(wrong_model).encode("utf-8"),
        )
    with pytest.raises(ProviderFailure, match="provider_output_malformed"):
        normalize_provider_response(
            HOSTED_CONTRACT,
            rendered_page(tmp_path),
            b'{"model":"nvidia/nemotron-parse","choices":[',
        )


def test_content_type_mismatch_rejects_before_hosted_v2_normalization(
    tmp_path: Path,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/plain"},
            content=hosted_response(),
        )

    with pytest.raises(ProviderFailure, match="provider_content_type_invalid"):
        invoke_rest_adapter(
            [rendered_page(tmp_path)],
            "d" * 64,
            HOSTED_CONTRACT,
            "test-secret",
            transport=httpx.MockTransport(handler),
        )


def test_request_binding_is_content_derived_and_stable(tmp_path: Path) -> None:
    page = rendered_page(tmp_path)
    first = request_binding(HOSTED_CONTRACT, page, "d" * 64)
    second = request_binding(HOSTED_CONTRACT, page, "d" * 64)
    assert first.fingerprint() == second.fingerprint()
    assert first.payload_mode == "inline_base64"
    assert "workspace" not in json.dumps(first.__dict__).lower()
