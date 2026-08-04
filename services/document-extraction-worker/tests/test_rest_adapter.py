from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest

from vaeroex_document_worker.provider_contract import (
    HOSTED_CONTRACT,
    HOSTED_ENDPOINT,
    NVCF_ASSET_ENDPOINT,
    V1_2_NIM_CONTRACT,
    V1_2_TASK_PROMPT,
)
from vaeroex_document_worker.provider_types import ProviderFailure, RenderedPage
from vaeroex_document_worker.rest_adapter import (
    MAX_PROVIDER_RESPONSE_BYTES,
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
    content = b"P" * byte_length
    path.write_bytes(content)
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


def test_request_binding_is_content_derived_and_stable(tmp_path: Path) -> None:
    page = rendered_page(tmp_path)
    first = request_binding(HOSTED_CONTRACT, page, "d" * 64)
    second = request_binding(HOSTED_CONTRACT, page, "d" * 64)
    assert first.fingerprint() == second.fingerprint()
    assert first.payload_mode == "inline_base64"
    assert "workspace" not in json.dumps(first.__dict__).lower()
