"""Explicit, non-Production, synthetic-only provider qualification harness."""

from __future__ import annotations

import json
import hashlib
import os
import sys
from dataclasses import dataclass

from .config import CLIENT_REVISION, MODEL, PARSER_REVISION
from .provider_contract import active_provider_contract
from .renderer import render_source
from .rest_adapter import invoke_rest_adapter
from .temporary import SecureTemporaryWorkspace

SYNTHETIC_CONTRACT_VERSION = "document_extraction_phase_b_synthetic_v1"
APPROVED_FIXTURES = frozenset({"synthetic-one-page-invoice-v1"})


def _enabled(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() == "true"


def _assert_synthetic_mode(fixture_id: str) -> None:
    if os.environ.get("VERCEL_ENV", "development").strip().lower() == "production":
        raise RuntimeError("Synthetic qualification refuses Production.")
    if fixture_id not in APPROVED_FIXTURES:
        raise RuntimeError("The synthetic fixture is not approved.")
    required = (
        "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED",
        "DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED",
        "DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED",
        "DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED",
    )
    if not all(_enabled(name) for name in required):
        raise RuntimeError("Synthetic qualification gates are not all enabled.")
    if not os.environ.get("NVIDIA_API_KEY"):
        raise RuntimeError("Synthetic qualification credential is unavailable.")
    if os.environ.get("DOCUMENT_EXTRACTION_NVIDIA_MODEL") != MODEL:
        raise RuntimeError("Synthetic qualification model is not approved.")
    if os.environ.get("DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION") != CLIENT_REVISION:
        raise RuntimeError("Synthetic qualification client revision is not approved.")
    if os.environ.get("DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION") != PARSER_REVISION:
        raise RuntimeError("Synthetic qualification parser revision is not approved.")


def _render_fixture(destination: object) -> None:
    from pathlib import Path
    from PIL import Image, ImageDraw

    path = destination if isinstance(destination, Path) else Path(str(destination))
    image = Image.new("RGB", (1_200, 1_600), "white")
    draw = ImageDraw.Draw(image)
    draw.text((90, 100), "SYNTHETIC INVOICE - NOT CUSTOMER DATA", fill="black")
    draw.text((90, 180), "Invoice: SYN-0001", fill="black")
    draw.text((90, 240), "Total: $125.00", fill="black")
    draw.text((90, 300), "Reporting period: August 2026", fill="black")
    image.save(path, "PNG")
    image.close()
    os.chmod(path, 0o600)


@dataclass(frozen=True)
class SyntheticResult:
    contract_version: str
    fixture_id: str
    status: str
    pages: int
    provider_calls: int
    latency_ms: int
    model: str
    client_revision: str


def run_synthetic_fixture(fixture_id: str) -> SyntheticResult:
    _assert_synthetic_mode(fixture_id)
    with SecureTemporaryWorkspace() as temporary:
        source = temporary.file("synthetic.png")
        rendered_directory = temporary.file("rendered-pages")
        _render_fixture(source)
        document_sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
        rendered_pages = render_source(source, rendered_directory, 1)
        source.unlink(missing_ok=True)
        result = invoke_rest_adapter(
            rendered_pages,
            document_sha256,
            active_provider_contract(),
            os.environ["NVIDIA_API_KEY"],
        )
        return SyntheticResult(
            contract_version=SYNTHETIC_CONTRACT_VERSION,
            fixture_id=fixture_id,
            status="success",
            pages=len(result.pages),
            provider_calls=1,
            latency_ms=result.latency_ms,
            model=MODEL,
            client_revision=CLIENT_REVISION,
        )


def main() -> None:
    fixture_id = sys.argv[1] if len(sys.argv) == 2 else ""
    result = run_synthetic_fixture(fixture_id)
    sys.stdout.write(json.dumps(result.__dict__, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
