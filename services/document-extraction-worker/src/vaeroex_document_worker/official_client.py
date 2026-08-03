"""Pinned official NeMo Retriever client and provider-neutral normalization."""

from __future__ import annotations

import contextlib
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import (
    ENDPOINT,
    MAX_PAGES,
    MAX_RENDERED_DIMENSION,
    MODEL,
    TIMEOUT_SECONDS,
)


class ProviderFailure(RuntimeError):
    def __init__(self, code: str, result_class: str, *, retryable: bool, ambiguous: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.result_class = result_class
        self.retryable = retryable
        self.ambiguous = ambiguous


@dataclass(frozen=True)
class ProviderResult:
    pages: list[dict[str, Any]]
    latency_ms: int


def prepare_provider_input(source: Path, destination: Path) -> None:
    header = source.read_bytes()[:8]
    if header.startswith(b"%PDF-"):
        destination.write_bytes(source.read_bytes())
        os.chmod(destination, 0o600)
        return

    from PIL import Image, ImageOps

    try:
        with Image.open(source) as opened:
            if opened.format not in ("PNG", "JPEG"):
                raise ProviderFailure("unsupported_worker_render_input", "validation", retryable=False)
            image = ImageOps.exif_transpose(opened).convert("RGB")
            image.thumbnail((MAX_RENDERED_DIMENSION, MAX_RENDERED_DIMENSION), Image.Resampling.LANCZOS)
            image.save(destination, "PDF", resolution=144.0)
            image.close()
    except ProviderFailure:
        raise
    except Exception as error:
        raise ProviderFailure("unsupported_worker_render_input", "validation", retryable=False) from error
    os.chmod(destination, 0o600)


def _coordinates(value: Any, page: int) -> dict[str, float | int] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        x1, y1, x2, y2 = (float(item) for item in value)
    except (TypeError, ValueError):
        return None
    if not all(0 <= item <= 1 for item in (x1, y1, x2, y2)) or x2 <= x1 or y2 <= y1:
        return None
    return {"page": page, "x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1}


def _blocks(row: dict[str, Any], page: int) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    page_text = row.get("text")
    if isinstance(page_text, str) and page_text.strip():
        blocks.append(
            {
                "id": f"page-{page}-text-1",
                "kind": "text",
                "text": page_text.strip(),
                "coordinates": None,
            }
        )
    for source_key, kind in (("table", "table"), ("chart", "text"), ("infographic", "text")):
        candidates = row.get(source_key)
        if not isinstance(candidates, list):
            continue
        for index, candidate in enumerate(candidates, start=1):
            if not isinstance(candidate, dict):
                continue
            text = candidate.get("text")
            if isinstance(text, str) and text.strip():
                blocks.append(
                    {
                        "id": f"page-{page}-{source_key}-{index}",
                        "kind": kind,
                        "text": text.strip(),
                        "coordinates": _coordinates(candidate.get("bbox_xyxy_norm"), page),
                    }
                )
    return blocks


def _classify_exception(error: BaseException) -> ProviderFailure:
    error_name = error.__class__.__name__.lower()
    message = str(error).lower()
    if "429" in message or "rate limit" in message:
        return ProviderFailure("provider_rate_limited", "rate_limit", retryable=True)
    if "connecttimeout" in error_name or "connect timeout" in message:
        return ProviderFailure("provider_connect_timeout", "timeout", retryable=True)
    if "connecterror" in error_name or "connection refused" in message or "name resolution" in message:
        return ProviderFailure("provider_transport_failure", "transport", retryable=True)
    if "timeout" in error_name or "timed out" in message:
        return ProviderFailure("provider_timeout_ambiguous", "ambiguous_dispatch", retryable=False, ambiguous=True)
    if "json" in message or "parse" in message or "malformed" in message:
        return ProviderFailure("provider_output_malformed", "malformed_output", retryable=False)
    return ProviderFailure("provider_failure", "provider", retryable=False)


def invoke_official_client(pdf_path: Path, page_count: int) -> ProviderResult:
    if not 1 <= page_count <= MAX_PAGES:
        raise ProviderFailure("provider_page_limit_exceeded", "validation", retryable=False)
    from nemo_retriever import create_ingestor  # type: ignore[import-untyped]
    from nemo_retriever.common.params.models import ExtractParams, RemoteRetryParams  # type: ignore[import-untyped]
    from nemo_retriever.operators.extract.parse.nemotron_parse import (  # type: ignore[import-untyped]
        _resolve_nemotron_parse_contract,
    )

    contract = _resolve_nemotron_parse_contract(ENDPOINT, MODEL)
    if contract.model != MODEL or contract.profile.value != "hosted_tool_call":
        raise ProviderFailure("official_client_contract_mismatch", "validation", retryable=False)

    started = time.perf_counter()
    try:
        ingestor = create_ingestor(run_mode="inprocess", allow_no_gpu=True, error_policy="collect")
        params = ExtractParams(
            method="nemotron_parse",
            extract_text=True,
            extract_images=False,
            extract_tables=True,
            extract_charts=True,
            extract_infographics=True,
            extract_page_as_image=False,
            dpi=144,
            image_format="png",
            render_mode="fit_to_model",
            request_timeout_s=float(TIMEOUT_SECONDS),
            api_key="os.environ/NVIDIA_API_KEY",
            nemotron_parse_invoke_url=ENDPOINT,
            nemotron_parse_model=MODEL,
            remote_retry=RemoteRetryParams(
                remote_max_pool_workers=1,
                remote_max_retries=0,
                remote_max_429_retries=0,
            ),
        )
        with open(os.devnull, "w", encoding="utf-8") as devnull:
            with contextlib.redirect_stdout(devnull), contextlib.redirect_stderr(devnull):
                frame = ingestor.files([str(pdf_path)]).extract(params=params, extraction_mode="pdf").ingest()
        rows = frame.to_dict(orient="records")
        pages: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                raise ProviderFailure("provider_output_malformed", "malformed_output", retryable=False)
            metadata = row.get("nemotron_parse_v1_2")
            if isinstance(metadata, dict) and metadata.get("error"):
                raise ProviderFailure("provider_page_failure", "provider", retryable=False)
            page = int(row.get("page_number", len(pages) + 1))
            pages.append({"page": page, "blocks": _blocks(row, page)})
        pages.sort(key=lambda value: int(value["page"]))
        if len(pages) != page_count or [item["page"] for item in pages] != list(range(1, page_count + 1)):
            raise ProviderFailure("provider_page_count_mismatch", "validation", retryable=False)
        return ProviderResult(pages=pages, latency_ms=round((time.perf_counter() - started) * 1_000))
    except ProviderFailure:
        raise
    except Exception as error:
        raise _classify_exception(error) from error
