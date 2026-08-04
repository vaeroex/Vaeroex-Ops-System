from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from vaeroex_document_worker.provider_types import ProviderFailure
from vaeroex_document_worker.renderer import render_source


@pytest.mark.parametrize("image_format", ("PNG", "JPEG"))
def test_direct_images_render_to_one_bounded_png(tmp_path: Path, image_format: str) -> None:
    source = tmp_path / "source.bin"
    image = Image.new("RGB", (3_000, 2_000), "white")
    image.save(source, image_format)
    image.close()

    pages = render_source(source, tmp_path / "rendered", 1)

    assert len(pages) == 1
    assert pages[0].mime_type == "image/png"
    assert pages[0].width <= 1_664
    assert pages[0].height <= 2_048
    assert pages[0].path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


def test_pdf_is_rendered_page_by_page(tmp_path: Path) -> None:
    source = tmp_path / "source.pdf"
    first = Image.new("RGB", (400, 600), "white")
    second = Image.new("RGB", (600, 400), "white")
    first.save(source, "PDF", save_all=True, append_images=[second])
    first.close()
    second.close()

    pages = render_source(source, tmp_path / "rendered", 2)

    assert [page.page for page in pages] == [1, 2]
    assert all(page.path.exists() for page in pages)


def test_renderer_rejects_page_count_mismatch(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    image = Image.new("RGB", (100, 100), "white")
    image.save(source, "PNG")
    image.close()

    with pytest.raises(ProviderFailure, match="renderer_page_count_mismatch"):
        render_source(source, tmp_path / "rendered", 2)


def test_renderer_rejects_unsupported_input(tmp_path: Path) -> None:
    source = tmp_path / "source.bin"
    source.write_bytes(b"PK\x03\x04synthetic-docx-placeholder")

    with pytest.raises(ProviderFailure, match="renderer_unsupported_input"):
        render_source(source, tmp_path / "rendered", 1)
