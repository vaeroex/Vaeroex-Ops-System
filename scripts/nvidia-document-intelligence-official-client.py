#!/usr/bin/env python3
"""Benchmark-only bridge to NVIDIA's official NeMo Retriever extraction client."""

from __future__ import annotations

import contextlib
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

BRIDGE_CONTRACT_VERSION = "vaeroex_nemo_retriever_bridge_v1"
BENCHMARK_VERSION = "document_intelligence_benchmark_v1"
CLIENT_REVISION = "52886112cafab4c4bca1cda0d4f588785adfe4d3"
MODEL = "nvidia/nemotron-parse"
ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions"
MAX_DOCUMENTS = 12
MAX_PAGES = 16


def _fail(message: str) -> None:
    raise RuntimeError(message)


def _validate_manifest(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, dict) or value.get("benchmarkVersion") != BENCHMARK_VERSION:
        _fail("The benchmark manifest contract is invalid.")
    documents = value.get("documents")
    if not isinstance(documents, list) or len(documents) > MAX_DOCUMENTS:
        _fail("The benchmark document count is invalid.")

    total_pages = 0
    roots: set[Path] = set()
    for document in documents:
        if not isinstance(document, dict) or not re.fullmatch(r"synthetic-doc-[a-z0-9-]+", str(document.get("documentId", ""))):
            _fail("The benchmark contains a non-synthetic document identity.")
        page_paths = document.get("pagePaths")
        if not isinstance(page_paths, list) or not page_paths:
            _fail("The benchmark contains an empty document.")
        total_pages += len(page_paths)
        for raw_path in page_paths:
            page_path = Path(str(raw_path)).resolve(strict=True)
            if not re.fullmatch(r"synthetic-doc-[a-z0-9-]+-page-\d+\.(?:png|jpg)", page_path.name):
                _fail("The benchmark page path is not approved.")
            if not page_path.parent.name.startswith("vaeroex-nemo-retriever-"):
                _fail("The benchmark page is outside the isolated temporary directory.")
            roots.add(page_path.parent)
    if total_pages > MAX_PAGES or len(roots) > 1:
        _fail("The benchmark page boundary is invalid.")
    return documents


def _to_pdf(page_paths: list[str], destination: Path) -> None:
    from PIL import Image

    images = []
    try:
        for raw_path in page_paths:
            with Image.open(raw_path) as source:
                images.append(source.convert("RGB"))
        images[0].save(destination, "PDF", save_all=True, append_images=images[1:], resolution=144.0)
    finally:
        for image in images:
            image.close()


def _safe_bbox(value: Any) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        values = [float(item) for item in value]
    except (TypeError, ValueError):
        return None
    if not all(0 <= item <= 1 for item in values) or values[2] <= values[0] or values[3] <= values[1]:
        return None
    return values


def _safe_elements(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    elements = []
    for item in value:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if isinstance(text, str) and text.strip():
            elements.append({"text": text.strip(), "boundingBox": _safe_bbox(item.get("bbox_xyxy_norm"))})
    return elements


def _classify_error(error: Any) -> tuple[str, int | None, bool]:
    serialized = json.dumps(error, default=str).lower()
    retry_after = "retry-after" in serialized
    for status in (401, 403, 404, 408, 422, 429, 500, 502, 503, 504):
        if str(status) in serialized:
            if status in (401, 403):
                return "authentication_failed", status, retry_after
            if status == 429:
                return "rate_limit", status, retry_after
            if status in (408, 504):
                return "timeout", status, retry_after
            if status >= 500:
                return "provider_unavailable", status, retry_after
            return "unsupported_input", status, retry_after
    if "timeout" in serialized or "timed out" in serialized:
        return "timeout", None, retry_after
    if "json" in serialized or "parse" in serialized:
        return "malformed_response", None, retry_after
    return "transport_failure", None, retry_after


def _document_result(document: dict[str, Any], pdf_path: Path) -> dict[str, Any]:
    from nemo_retriever import create_ingestor
    from nemo_retriever.common.params.models import ExtractParams, RemoteRetryParams

    started = time.perf_counter()
    page_count = len(document["pagePaths"])
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
            request_timeout_s=60.0,
            api_key="os.environ/NVIDIA_API_KEY",
            nemotron_parse_invoke_url=ENDPOINT,
            nemotron_parse_model=MODEL,
            remote_retry=RemoteRetryParams(
                remote_max_pool_workers=1,
                remote_max_retries=1,
                remote_max_429_retries=1,
            ),
        )
        frame = ingestor.files([str(pdf_path)]).extract(params=params, extraction_mode="pdf").ingest()
        rows = frame.to_dict(orient="records")
        pages = []
        first_error = None
        for row in rows:
            metadata = row.get("nemotron_parse_v1_2")
            error = metadata.get("error") if isinstance(metadata, dict) else None
            if error and first_error is None:
                first_error = error
            pages.append(
                {
                    "pageNumber": int(row.get("page_number", len(pages) + 1)),
                    "text": str(row.get("text") or ""),
                    "tables": _safe_elements(row.get("table")),
                    "charts": _safe_elements(row.get("chart")),
                    "infographics": _safe_elements(row.get("infographic")),
                }
            )
        if first_error is not None or len(pages) != page_count:
            failure_code, status_code, retry_after = _classify_error(first_error or {"page_count": len(pages)})
            return {
                "documentId": document["documentId"],
                "status": "failed",
                "pages": [],
                "latencyMs": round((time.perf_counter() - started) * 1000),
                "requestCount": page_count,
                "retryCount": 0,
                "failureCode": failure_code,
                "statusCode": status_code,
                "retryAfterPresent": retry_after,
            }
        return {
            "documentId": document["documentId"],
            "status": "success",
            "pages": sorted(pages, key=lambda page: page["pageNumber"]),
            "latencyMs": round((time.perf_counter() - started) * 1000),
            "requestCount": page_count,
            "retryCount": 0,
            "failureCode": None,
            "statusCode": None,
            "retryAfterPresent": False,
        }
    except BaseException as error:
        failure_code, status_code, retry_after = _classify_error(
            {"type": error.__class__.__name__, "message": str(error)}
        )
        return {
            "documentId": document["documentId"],
            "status": "failed",
            "pages": [],
            "latencyMs": round((time.perf_counter() - started) * 1000),
            "requestCount": page_count,
            "retryCount": 0,
            "failureCode": failure_code,
            "statusCode": status_code,
            "retryAfterPresent": retry_after,
        }


def main() -> None:
    if os.environ.get("VERCEL_ENV") == "production":
        _fail("The official NVIDIA benchmark client refuses Production.")
    if not os.environ.get("NVIDIA_API_KEY"):
        _fail("The official NVIDIA benchmark client requires Preview credentials.")
    if sys.version_info[:2] != (3, 12):
        _fail("The pinned NeMo Retriever client requires Python 3.12.")

    manifest = _validate_manifest(json.load(sys.stdin))
    import nemo_retriever
    from nemo_retriever.operators.extract.parse.nemotron_parse import _resolve_nemotron_parse_contract

    contract = _resolve_nemotron_parse_contract(ENDPOINT, MODEL)
    if contract.model != MODEL or contract.profile.value != "hosted_tool_call":
        _fail("The pinned NeMo Retriever client does not implement the approved hosted contract.")

    results = []
    with tempfile.TemporaryDirectory(prefix="vaeroex-nemo-client-") as temporary_directory:
        root = Path(temporary_directory)
        with open(os.devnull, "w", encoding="utf8") as devnull:
            with contextlib.redirect_stdout(devnull), contextlib.redirect_stderr(devnull):
                for document in manifest:
                    pdf_path = root / f"{document['documentId']}.pdf"
                    _to_pdf(document["pagePaths"], pdf_path)
                    results.append(_document_result(document, pdf_path))

    output = {
        "contractVersion": BRIDGE_CONTRACT_VERSION,
        "clientRevision": CLIENT_REVISION,
        "clientVersion": str(getattr(nemo_retriever, "__version__", "unknown")),
        "model": MODEL,
        "contractProfile": contract.profile.value,
        "documents": results,
    }
    sys.stdout.write(json.dumps(output, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        sys.exit(1)
