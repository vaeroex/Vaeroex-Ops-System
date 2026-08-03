from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from vaeroex_document_worker.official_client import ProviderFailure, prepare_provider_input


def test_image_is_rendered_to_bounded_pdf(tmp_path: Path) -> None:
    source = tmp_path / "source.bin"
    destination = tmp_path / "provider.pdf"
    image = Image.new("RGB", (3_000, 2_000), "white")
    image.save(source, "PNG")
    image.close()
    prepare_provider_input(source, destination)
    assert destination.read_bytes().startswith(b"%PDF-")


def test_unsupported_input_fails_before_provider_dispatch(tmp_path: Path) -> None:
    source = tmp_path / "source.bin"
    source.write_bytes(b"PK\x03\x04synthetic-docx-placeholder")
    with pytest.raises(ProviderFailure, match="unsupported_worker_render_input"):
        prepare_provider_input(source, tmp_path / "provider.pdf")
