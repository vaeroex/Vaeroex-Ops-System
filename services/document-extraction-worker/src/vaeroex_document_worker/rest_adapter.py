"""Minimal, versioned NVIDIA Nemotron Parse REST adapter."""

from __future__ import annotations

import base64
import hashlib
import json
import math
import re
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Any, Iterable, NoReturn
from urllib.parse import urlsplit

import httpx

from .provider_contract import (
    HOSTED_CONTRACT,
    HOSTED_ENDPOINT,
    NVCF_ASSET_ENDPOINT,
    NVCF_INLINE_IMAGE_LIMIT_BYTES,
    REST_ADAPTER_VERSION,
    V1_2_NIM_CONTRACT,
    V1_2_NIM_ENDPOINT,
    ProviderContract,
)
from .provider_types import ProviderFailure, ProviderResult, RenderedPage

MAX_PROVIDER_RESPONSE_BYTES = 2_000_000
MAX_HOSTED_REQUEST_BYTES = 300_000
MAX_SELF_HOSTED_REQUEST_BYTES = 16_500_000
MAX_RENDERED_PAGE_BYTES = 12_000_000
MAX_RENDERED_WIDTH = 1_664
MAX_RENDERED_HEIGHT = 2_048
MAX_ELEMENTS_PER_PAGE = 500
MAX_ELEMENT_TEXT_LENGTH = 50_000
MAX_PAGE_TEXT_LENGTH = 250_000
TIMEOUT_POLICY_VERSION = "connect_10_read_120_write_30_no_internal_retry_v1"
NVCF_ASSET_DESCRIPTION = "vaeroex-document-page"

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_TAGGED_ELEMENT = re.compile(
    r"<x_(\d+(?:\.\d+)?)><y_(\d+(?:\.\d+)?)>(.*?)"
    r"<x_(\d+(?:\.\d+)?)><y_(\d+(?:\.\d+)?)><class_([^>]+)>",
    re.DOTALL,
)
_TAG_SEPARATOR = re.compile(r"(?:\s|</?s>)*")
_ALLOWED_LABELS = frozenset(
    {
        "Text",
        "Title",
        "Section-header",
        "List-item",
        "TOC",
        "Bibliography",
        "Formula",
        "Page-header",
        "Page-footer",
        "Caption",
        "Footnote",
        "Floating-text",
        "Table",
        "Picture",
        "Chart",
        "Infographic",
        "Header_footer",
    }
)


def _validate_contract(contract: ProviderContract) -> None:
    if contract in (HOSTED_CONTRACT, V1_2_NIM_CONTRACT):
        return
    if contract.response_profile == "hosted_tool_call" and contract.endpoint != HOSTED_ENDPOINT:
        raise ProviderFailure("provider_endpoint_contract_mismatch", "validation", retryable=False)
    if contract.response_profile == "v1_2_tagged" and contract.endpoint != V1_2_NIM_ENDPOINT:
        raise ProviderFailure("provider_endpoint_contract_mismatch", "validation", retryable=False)
    raise ProviderFailure("provider_contract_unsupported", "validation", retryable=False)


@dataclass(frozen=True)
class ProviderRequestBindingV1:
    adapter_version: str
    endpoint_contract_version: str
    model: str
    document_sha256: str
    page_sha256: str
    page_index: int
    mime_type: str
    rendered_width: int
    rendered_height: int
    payload_mode: str
    timeout_policy_version: str

    def fingerprint(self) -> str:
        payload = json.dumps(
            asdict(self),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()


def request_binding(
    contract: ProviderContract,
    page: RenderedPage,
    document_sha256: str,
) -> ProviderRequestBindingV1:
    _validate_contract(contract)
    if not _SHA256.fullmatch(document_sha256) or not _SHA256.fullmatch(page.content_sha256):
        raise ProviderFailure("provider_request_identity_invalid", "validation", retryable=False)
    payload_mode = (
        "nvcf_asset_reference"
        if contract.supports_nvcf_assets and page.byte_length > NVCF_INLINE_IMAGE_LIMIT_BYTES
        else "inline_base64"
    )
    return ProviderRequestBindingV1(
        adapter_version=REST_ADAPTER_VERSION,
        endpoint_contract_version=contract.endpoint_contract_version,
        model=contract.model,
        document_sha256=document_sha256,
        page_sha256=page.content_sha256,
        page_index=page.page,
        mime_type=page.mime_type,
        rendered_width=page.width,
        rendered_height=page.height,
        payload_mode=payload_mode,
        timeout_policy_version=TIMEOUT_POLICY_VERSION,
    )


def serialize_provider_request(
    contract: ProviderContract,
    page: RenderedPage,
    image_reference: str,
    *,
    payload_mode: str,
) -> bytes:
    _validate_contract(contract)
    del page
    if payload_mode not in ("inline_base64", "nvcf_asset_reference"):
        raise ProviderFailure("provider_payload_mode_invalid", "validation", retryable=False)
    if payload_mode == "nvcf_asset_reference" and not contract.supports_nvcf_assets:
        raise ProviderFailure("provider_payload_mode_unsupported", "validation", retryable=False)
    content: list[dict[str, Any]] = [
        {"type": "image_url", "image_url": {"url": image_reference}}
    ]
    if contract.task_prompt is not None:
        content.insert(0, {"type": "text", "text": contract.task_prompt})
    body: dict[str, object] = {
        "model": contract.model,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.0,
        "max_tokens": 8_192,
    }
    if contract.response_profile == "hosted_tool_call":
        body["tools"] = [
            {"type": "function", "function": {"name": "markdown_bbox"}}
        ]
    else:
        body.update(
            {
                "repetition_penalty": 1.1,
                "top_k": 1,
                "skip_special_tokens": False,
            }
        )
    serialized = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    request_limit = (
        MAX_HOSTED_REQUEST_BYTES
        if contract.response_profile == "hosted_tool_call"
        else MAX_SELF_HOSTED_REQUEST_BYTES
    )
    if len(serialized) > request_limit:
        raise ProviderFailure("provider_request_oversized", "validation", retryable=False)
    return serialized


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

    return json.loads(text, object_pairs_hook=_unique_object, parse_constant=reject_constant)


def _coordinates(values: Iterable[Any]) -> dict[str, float] | None:
    try:
        x1, y1, x2, y2 = (float(value) for value in values)
    except (TypeError, ValueError):
        return None
    if (
        not all(math.isfinite(value) and 0 <= value <= 1 for value in (x1, y1, x2, y2))
        or x2 <= x1
        or y2 <= y1
    ):
        return None
    return {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1}


def _v1_2_coordinates(values: tuple[str, str, str, str], page: RenderedPage) -> dict[str, float] | None:
    raw = _coordinates(values)
    if raw is None:
        return None
    x1 = raw["x"]
    y1 = raw["y"]
    x2 = x1 + raw["width"]
    y2 = y1 + raw["height"]
    target_width = 1_664
    target_height = 2_048
    resized_width = page.width
    resized_height = page.height
    pad_left = (target_width - resized_width) // 2
    pad_top = (target_height - resized_height) // 2
    return _coordinates(
        (
            max(0.0, ((x1 * target_width) - pad_left) / resized_width),
            max(0.0, ((y1 * target_height) - pad_top) / resized_height),
            min(1.0, ((x2 * target_width) - pad_left) / resized_width),
            min(1.0, ((y2 * target_height) - pad_top) / resized_height),
        )
    )


def _normalized_label(value: Any) -> str:
    label = "Formula" if value == "Inline-formula" else value
    if not isinstance(label, str) or label not in _ALLOWED_LABELS:
        raise ProviderFailure("provider_semantic_label_invalid", "malformed_output", retryable=False)
    return label


def _clean_text(value: Any) -> str:
    if not isinstance(value, str):
        raise ProviderFailure("provider_element_text_invalid", "malformed_output", retryable=False)
    text = value.replace("<tbc>", "").replace("\\<|unk|\\>", "").replace("\\unknown", "").strip()
    if not text or len(text) > MAX_ELEMENT_TEXT_LENGTH:
        raise ProviderFailure("provider_element_text_invalid", "malformed_output", retryable=False)
    return text


def _kind(label: str) -> str:
    if label == "Table":
        return "table"
    if label in ("Title", "Section-header"):
        return "heading"
    return "text"


def _legacy_elements(arguments: str) -> list[tuple[str, str, dict[str, float]]]:
    try:
        parsed = _strict_json(arguments)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise ProviderFailure("provider_output_malformed", "malformed_output", retryable=False) from error
    if not isinstance(parsed, list):
        raise ProviderFailure("provider_output_schema_mismatch", "malformed_output", retryable=False)
    if len(parsed) == 1 and isinstance(parsed[0], list):
        parsed = parsed[0]
    if len(parsed) > MAX_ELEMENTS_PER_PAGE or not all(isinstance(item, dict) for item in parsed):
        raise ProviderFailure("provider_element_limit_exceeded", "malformed_output", retryable=False)
    elements: list[tuple[str, str, dict[str, float]]] = []
    for raw in parsed:
        label = _normalized_label(raw.get("type"))
        text = _clean_text(raw.get("text"))
        bbox = raw.get("bbox")
        if not isinstance(bbox, dict):
            raise ProviderFailure("provider_coordinates_invalid", "malformed_output", retryable=False)
        coordinates = _coordinates(
            (bbox.get("xmin"), bbox.get("ymin"), bbox.get("xmax"), bbox.get("ymax"))
        )
        if coordinates is None:
            raise ProviderFailure("provider_coordinates_invalid", "malformed_output", retryable=False)
        elements.append((label, text, coordinates))
    return elements


def _tagged_elements(content: str, page: RenderedPage) -> list[tuple[str, str, dict[str, float]]]:
    if len(content) > MAX_PAGE_TEXT_LENGTH * 2:
        raise ProviderFailure("provider_output_malformed", "malformed_output", retryable=False)
    elements: list[tuple[str, str, dict[str, float]]] = []
    cursor = 0
    for match in _TAGGED_ELEMENT.finditer(content):
        if _TAG_SEPARATOR.fullmatch(content[cursor:match.start()]) is None:
            raise ProviderFailure("provider_output_schema_mismatch", "malformed_output", retryable=False)
        x1, y1, text, x2, y2, raw_label = match.groups()
        label = _normalized_label(raw_label)
        coordinates = _v1_2_coordinates((x1, y1, x2, y2), page)
        if coordinates is None:
            raise ProviderFailure("provider_coordinates_invalid", "malformed_output", retryable=False)
        elements.append((label, _clean_text(text), coordinates))
        cursor = match.end()
    if _TAG_SEPARATOR.fullmatch(content[cursor:]) is None:
        raise ProviderFailure("provider_output_schema_mismatch", "malformed_output", retryable=False)
    if len(elements) > MAX_ELEMENTS_PER_PAGE:
        raise ProviderFailure("provider_element_limit_exceeded", "malformed_output", retryable=False)
    return elements


def normalize_provider_response(
    contract: ProviderContract,
    page: RenderedPage,
    response_body: bytes,
) -> dict[str, Any]:
    _validate_contract(contract)
    if len(response_body) > MAX_PROVIDER_RESPONSE_BYTES:
        raise ProviderFailure("provider_response_oversized", "malformed_output", retryable=False)
    try:
        response = _strict_json(response_body)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise ProviderFailure("provider_output_malformed", "malformed_output", retryable=False) from error
    if not isinstance(response, dict) or response.get("model") != contract.model:
        raise ProviderFailure("provider_output_contract_mismatch", "malformed_output", retryable=False)
    choices = response.get("choices")
    if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
        raise ProviderFailure("provider_output_schema_mismatch", "malformed_output", retryable=False)
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ProviderFailure("provider_output_schema_mismatch", "malformed_output", retryable=False)
    finish_reason = choices[0].get("finish_reason")
    if contract.response_profile == "hosted_tool_call":
        if finish_reason != "tool_calls" or message.get("content") not in (None, ""):
            raise ProviderFailure("provider_output_incomplete", "malformed_output", retryable=False)
        tool_calls = message.get("tool_calls")
        if not isinstance(tool_calls, list) or len(tool_calls) != 1 or not isinstance(tool_calls[0], dict):
            raise ProviderFailure("provider_output_schema_mismatch", "malformed_output", retryable=False)
        function = tool_calls[0].get("function")
        if (
            tool_calls[0].get("type") != "function"
            or not isinstance(function, dict)
            or function.get("name") != "markdown_bbox"
            or not isinstance(function.get("arguments"), str)
        ):
            raise ProviderFailure("provider_output_schema_mismatch", "malformed_output", retryable=False)
        elements = _legacy_elements(function["arguments"])
    elif contract.response_profile == "v1_2_tagged":
        content_value = message.get("content")
        if finish_reason != "stop" or message.get("tool_calls") not in (None, []) or not isinstance(content_value, str):
            raise ProviderFailure("provider_output_schema_mismatch", "malformed_output", retryable=False)
        elements = _tagged_elements(content_value, page)
    else:
        raise ProviderFailure("provider_contract_unsupported", "validation", retryable=False)
    if not elements:
        raise ProviderFailure("provider_page_output_empty", "malformed_output", retryable=False)
    total_text = 0
    seen: set[tuple[object, ...]] = set()
    seen_coordinates: set[tuple[float, float, float, float]] = set()
    blocks: list[dict[str, Any]] = []
    for index, (label, text, coordinates) in enumerate(elements, start=1):
        total_text += len(text)
        if total_text > MAX_PAGE_TEXT_LENGTH:
            raise ProviderFailure("provider_page_text_limit_exceeded", "malformed_output", retryable=False)
        identity = (
            label,
            text,
            coordinates["x"],
            coordinates["y"],
            coordinates["width"],
            coordinates["height"],
        )
        if identity in seen:
            raise ProviderFailure("provider_duplicate_element", "malformed_output", retryable=False)
        seen.add(identity)
        geometry = (
            coordinates["x"],
            coordinates["y"],
            coordinates["width"],
            coordinates["height"],
        )
        if geometry in seen_coordinates:
            raise ProviderFailure("provider_duplicate_coordinates", "malformed_output", retryable=False)
        seen_coordinates.add(geometry)
        blocks.append(
            {
                "id": f"page-{page.page}-element-{index}",
                "kind": _kind(label),
                "text": text,
                "coordinates": {"page": page.page, **coordinates},
            }
        )
    return {"page": page.page, "blocks": blocks}


def _transport_failure(error: httpx.HTTPError, completed_pages: tuple[dict[str, Any], ...]) -> ProviderFailure:
    if isinstance(error, (httpx.ConnectTimeout, httpx.ConnectError, httpx.PoolTimeout)):
        return ProviderFailure(
            "provider_pre_acceptance_transport_failure",
            "transport",
            retryable=True,
            completed_pages=completed_pages,
        )
    return ProviderFailure(
        "provider_dispatch_ambiguous",
        "ambiguous_dispatch",
        retryable=False,
        ambiguous=True,
        completed_pages=completed_pages,
    )


class NvidiaNemotronParseRestAdapter:
    def __init__(
        self,
        contract: ProviderContract,
        api_key: str,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        _validate_contract(contract)
        if contract.sends_nvidia_credential and not api_key:
            raise ProviderFailure("provider_credential_missing", "authorization", retryable=False)
        self._contract = contract
        self._api_key = api_key
        self._client = httpx.Client(
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "NvidiaNemotronParseRestAdapter":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _headers(self) -> dict[str, str]:
        headers = {"accept": "application/json", "content-type": "application/json"}
        if self._contract.sends_nvidia_credential:
            headers["authorization"] = f"Bearer {self._api_key}"
        return headers

    def _send(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        content: bytes,
        accepted_statuses: frozenset[int],
        completed_pages: tuple[dict[str, Any], ...],
        response_limit: int = MAX_PROVIDER_RESPONSE_BYTES,
        request_limit: int = MAX_SELF_HOSTED_REQUEST_BYTES,
    ) -> tuple[int, httpx.Headers, bytes]:
        if len(content) > request_limit:
            raise ProviderFailure(
                "provider_request_oversized",
                "validation",
                retryable=False,
                completed_pages=completed_pages,
            )
        request = self._client.build_request(method, url, headers=headers, content=content)
        try:
            response = self._client.send(request, stream=True)
            try:
                if response.status_code == 429:
                    raise ProviderFailure(
                        "provider_rate_limited",
                        "rate_limit",
                        retryable=True,
                        completed_pages=completed_pages,
                    )
                if response.status_code == 202:
                    raise ProviderFailure(
                        "provider_pending_without_approved_poll_contract",
                        "ambiguous_dispatch",
                        retryable=False,
                        ambiguous=True,
                        completed_pages=completed_pages,
                    )
                if response.status_code not in accepted_statuses:
                    code = (
                        "provider_input_rejected"
                        if response.status_code in (400, 413, 415, 422)
                        else "provider_request_failed"
                    )
                    result_class = "validation" if response.status_code in (400, 413, 415, 422) else "provider"
                    raise ProviderFailure(code, result_class, retryable=False, completed_pages=completed_pages)
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > response_limit:
                        raise ProviderFailure(
                            "provider_response_oversized",
                            "malformed_output",
                            retryable=False,
                            completed_pages=completed_pages,
                        )
                    chunks.append(chunk)
                return response.status_code, response.headers, b"".join(chunks)
            finally:
                response.close()
        except ProviderFailure:
            raise
        except httpx.HTTPError as error:
            raise _transport_failure(error, completed_pages) from error

    def _delete_asset(self, asset_id: str, completed_pages: tuple[dict[str, Any], ...]) -> None:
        self._send(
            "DELETE",
            f"{NVCF_ASSET_ENDPOINT}/{asset_id}",
            headers=self._headers(),
            content=b"",
            accepted_statuses=frozenset({204}),
            completed_pages=completed_pages,
            response_limit=4_096,
            request_limit=0,
        )

    def _reject_created_asset(
        self,
        asset_id: str,
        completed_pages: tuple[dict[str, Any], ...],
        code: str,
    ) -> NoReturn:
        try:
            self._delete_asset(asset_id, completed_pages)
        except ProviderFailure as error:
            raise ProviderFailure(
                "provider_asset_cleanup_failed",
                "provider",
                retryable=False,
                ambiguous=error.ambiguous,
                completed_pages=completed_pages,
            ) from error
        raise ProviderFailure(code, "malformed_output", retryable=False, completed_pages=completed_pages)

    def _create_asset(
        self,
        page: RenderedPage,
        completed_pages: tuple[dict[str, Any], ...],
    ) -> tuple[str, str]:
        body = json.dumps(
            {"contentType": page.mime_type, "description": NVCF_ASSET_DESCRIPTION},
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        _, headers, response_body = self._send(
            "POST",
            NVCF_ASSET_ENDPOINT,
            headers=self._headers(),
            content=body,
            accepted_statuses=frozenset({200}),
            completed_pages=completed_pages,
            response_limit=32_768,
            request_limit=32_768,
        )
        if headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise ProviderFailure("provider_asset_response_invalid", "malformed_output", retryable=False)
        try:
            response = _strict_json(response_body)
            if not isinstance(response, dict):
                raise ValueError("asset_response_not_object")
            asset_id = str(uuid.UUID(response["assetId"]))
        except (KeyError, TypeError, ValueError) as error:
            raise ProviderFailure("provider_asset_response_invalid", "malformed_output", retryable=False) from error
        upload_url = response.get("uploadUrl")
        if not isinstance(upload_url, str):
            self._reject_created_asset(asset_id, completed_pages, "provider_asset_response_invalid")
        if response.get("contentType", page.mime_type) != page.mime_type or response.get(
            "description", NVCF_ASSET_DESCRIPTION
        ) != NVCF_ASSET_DESCRIPTION:
            self._reject_created_asset(asset_id, completed_pages, "provider_asset_response_invalid")
        parsed = urlsplit(upload_url)
        hostname = (parsed.hostname or "").lower()
        if (
            parsed.scheme != "https"
            or not hostname.endswith(".amazonaws.com")
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
        ):
            self._reject_created_asset(asset_id, completed_pages, "provider_asset_upload_url_invalid")
        return asset_id, upload_url

    def _upload_asset(
        self,
        page: RenderedPage,
        page_bytes: bytes,
        upload_url: str,
        completed_pages: tuple[dict[str, Any], ...],
    ) -> None:
        self._send(
            "PUT",
            upload_url,
            headers={
                "content-type": page.mime_type,
                "x-amz-meta-nvcf-asset-description": NVCF_ASSET_DESCRIPTION,
            },
            content=page_bytes,
            accepted_statuses=frozenset({200, 201, 204}),
            completed_pages=completed_pages,
            response_limit=4_096,
            request_limit=MAX_RENDERED_PAGE_BYTES,
        )

    def _validated_page_bytes(self, page: RenderedPage) -> bytes:
        if (
            page.mime_type != "image/png"
            or not 1 <= page.width <= MAX_RENDERED_WIDTH
            or not 1 <= page.height <= MAX_RENDERED_HEIGHT
            or not 1 <= page.byte_length <= MAX_RENDERED_PAGE_BYTES
            or not _SHA256.fullmatch(page.content_sha256)
        ):
            raise ProviderFailure("provider_page_input_invalid", "validation", retryable=False)
        try:
            content = page.path.read_bytes()
        except OSError as error:
            raise ProviderFailure("provider_page_input_unavailable", "validation", retryable=False) from error
        if len(content) != page.byte_length or hashlib.sha256(content).hexdigest() != page.content_sha256:
            raise ProviderFailure("provider_page_identity_mismatch", "validation", retryable=False)
        if (
            len(content) < 24
            or content[:8] != _PNG_SIGNATURE
            or content[8:12] != b"\x00\x00\x00\r"
            or content[12:16] != b"IHDR"
            or int.from_bytes(content[16:20], "big") != page.width
            or int.from_bytes(content[20:24], "big") != page.height
        ):
            raise ProviderFailure("provider_page_dimensions_mismatch", "validation", retryable=False)
        return content

    def _invoke_page(
        self,
        page: RenderedPage,
        binding: ProviderRequestBindingV1,
        completed_pages: tuple[dict[str, Any], ...],
    ) -> dict[str, Any]:
        content_type = page.mime_type.split("/", 1)[1]
        asset_id: str | None = None
        primary_failure: ProviderFailure | None = None
        normalized: dict[str, Any] | None = None
        page_bytes = self._validated_page_bytes(page)
        try:
            if binding.payload_mode == "nvcf_asset_reference":
                asset_id, upload_url = self._create_asset(page, completed_pages)
                self._upload_asset(page, page_bytes, upload_url, completed_pages)
                image_reference = f"data:image/{content_type};asset_id,{asset_id}"
                extra_headers = {"NVCF-INPUT-ASSET-REFERENCES": asset_id}
            else:
                encoded = base64.b64encode(page_bytes).decode("ascii")
                image_reference = f"data:{page.mime_type};base64,{encoded}"
                extra_headers = {}
            body = serialize_provider_request(
                self._contract,
                page,
                image_reference,
                payload_mode=binding.payload_mode,
            )
            _, response_headers, response_body = self._send(
                "POST",
                self._contract.endpoint,
                headers={**self._headers(), **extra_headers},
                content=body,
                accepted_statuses=frozenset({200}),
                completed_pages=completed_pages,
                request_limit=(
                    MAX_HOSTED_REQUEST_BYTES
                    if self._contract.response_profile == "hosted_tool_call"
                    else MAX_SELF_HOSTED_REQUEST_BYTES
                ),
            )
            if response_headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
                raise ProviderFailure("provider_content_type_invalid", "malformed_output", retryable=False)
            normalized = normalize_provider_response(self._contract, page, response_body)
        except ProviderFailure as failure:
            primary_failure = failure
        if asset_id is not None:
            try:
                self._delete_asset(asset_id, completed_pages)
            except ProviderFailure as cleanup_failure:
                primary_failure = ProviderFailure(
                    "provider_asset_cleanup_failed",
                    primary_failure.result_class if primary_failure is not None else "provider",
                    retryable=False,
                    ambiguous=(
                        cleanup_failure.ambiguous
                        or (primary_failure.ambiguous if primary_failure is not None else False)
                    ),
                    completed_pages=completed_pages,
                )
        if primary_failure is not None:
            raise primary_failure
        if normalized is None:
            raise ProviderFailure("provider_output_missing", "malformed_output", retryable=False)
        return normalized

    def invoke(
        self,
        pages: list[RenderedPage],
        document_sha256: str,
        *,
        completed_pages: tuple[dict[str, Any], ...] = (),
    ) -> ProviderResult:
        if not pages or [page.page for page in pages] != list(range(1, len(pages) + 1)):
            raise ProviderFailure("provider_page_sequence_invalid", "validation", retryable=False)
        if len(completed_pages) > len(pages):
            raise ProviderFailure("provider_resume_state_invalid", "validation", retryable=False)
        normalized_pages = list(completed_pages)
        request_hashes: list[str] = []
        payload_modes: list[str] = []
        started = time.perf_counter()
        for page in pages:
            binding = request_binding(self._contract, page, document_sha256)
            request_hashes.append(binding.fingerprint())
            payload_modes.append(binding.payload_mode)
            if page.page <= len(completed_pages):
                continue
            try:
                normalized_pages.append(self._invoke_page(page, binding, tuple(normalized_pages)))
            except ProviderFailure as failure:
                if failure.completed_pages:
                    raise
                raise ProviderFailure(
                    failure.code,
                    failure.result_class,
                    retryable=failure.retryable,
                    ambiguous=failure.ambiguous,
                    completed_pages=tuple(normalized_pages),
                ) from failure
        return ProviderResult(
            pages=normalized_pages,
            latency_ms=round((time.perf_counter() - started) * 1_000),
            request_contract_hashes=tuple(request_hashes),
            payload_modes=tuple(payload_modes),
        )


def invoke_rest_adapter(
    pages: list[RenderedPage],
    document_sha256: str,
    contract: ProviderContract,
    api_key: str,
    *,
    completed_pages: tuple[dict[str, Any], ...] = (),
    transport: httpx.BaseTransport | None = None,
) -> ProviderResult:
    with NvidiaNemotronParseRestAdapter(contract, api_key, transport=transport) as adapter:
        return adapter.invoke(pages, document_sha256, completed_pages=completed_pages)
