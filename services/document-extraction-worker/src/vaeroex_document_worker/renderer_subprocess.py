"""Secret-free PDF and image renderer executed in an isolated subprocess."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import warnings
from pathlib import Path
from typing import Any

MAX_PAGES = 16
MAX_RENDERED_WIDTH = 1_664
MAX_RENDERED_HEIGHT = 2_048
MAX_SOURCE_PIXELS = 40_000_000
MAX_RENDERED_PAGE_BYTES = 12_000_000


class RenderFailure(RuntimeError):
    pass


def _bounded_image(image: Any) -> Any:
    from PIL import Image, ImageOps

    normalized = ImageOps.exif_transpose(image).convert("RGB")
    if normalized.width <= 0 or normalized.height <= 0:
        normalized.close()
        raise RenderFailure("renderer_invalid_dimensions")
    if normalized.width * normalized.height > MAX_SOURCE_PIXELS:
        normalized.close()
        raise RenderFailure("renderer_pixel_limit_exceeded")
    normalized.thumbnail(
        (MAX_RENDERED_WIDTH, MAX_RENDERED_HEIGHT),
        Image.Resampling.LANCZOS,
    )
    return normalized


def _write_page(image: Any, destination: Path, page: int) -> dict[str, object]:
    normalized = _bounded_image(image)
    try:
        normalized.save(destination, "PNG", optimize=False, compress_level=6)
        os.chmod(destination, 0o600)
        byte_length = destination.stat().st_size
        if byte_length <= 0 or byte_length > MAX_RENDERED_PAGE_BYTES:
            raise RenderFailure("renderer_page_size_limit_exceeded")
        return {
            "page": page,
            "file": destination.name,
            "mimeType": "image/png",
            "width": normalized.width,
            "height": normalized.height,
            "byteLength": byte_length,
            "contentSha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        }
    finally:
        normalized.close()


def _render_image(source: Path, output: Path) -> list[dict[str, object]]:
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = MAX_SOURCE_PIXELS
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(source) as opened:
            if opened.format not in ("PNG", "JPEG"):
                raise RenderFailure("renderer_unsupported_image")
            return [_write_page(opened, output / "page-0001.png", 1)]


def _render_pdf(source: Path, output: Path) -> list[dict[str, object]]:
    import pypdfium2 as pdfium  # type: ignore[import-untyped]

    try:
        document = pdfium.PdfDocument(str(source))
    except Exception as error:
        raise RenderFailure("renderer_pdf_open_failed") from error
    try:
        page_count = len(document)
        if not 1 <= page_count <= MAX_PAGES:
            raise RenderFailure("renderer_page_limit_exceeded")
        pages: list[dict[str, object]] = []
        for index in range(page_count):
            page = document[index]
            try:
                width, height = page.get_size()
                if width <= 0 or height <= 0:
                    raise RenderFailure("renderer_invalid_dimensions")
                scale = min(MAX_RENDERED_WIDTH / width, MAX_RENDERED_HEIGHT / height)
                if not 0 < scale <= 20:
                    raise RenderFailure("renderer_invalid_scale")
                bitmap = page.render(scale=scale)
                try:
                    image = bitmap.to_pil()
                    try:
                        pages.append(_write_page(image, output / f"page-{index + 1:04d}.png", index + 1))
                    finally:
                        image.close()
                finally:
                    bitmap.close()
            finally:
                page.close()
        return pages
    finally:
        document.close()


def _render(source: Path, output: Path, expected_pages: int) -> list[dict[str, object]]:
    with source.open("rb") as stream:
        header = stream.read(16)
    if header.startswith(b"%PDF-"):
        pages = _render_pdf(source, output)
    elif header.startswith(b"\x89PNG\r\n\x1a\n") or header.startswith(b"\xff\xd8\xff"):
        pages = _render_image(source, output)
    else:
        raise RenderFailure("renderer_unsupported_input")
    if len(pages) != expected_pages:
        raise RenderFailure("renderer_page_count_mismatch")
    return pages


def main() -> int:
    if len(sys.argv) != 4:
        return 2
    source = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    try:
        expected_pages = int(sys.argv[3])
    except ValueError:
        return 2
    if not source.is_file() or not output.is_dir() or not 1 <= expected_pages <= MAX_PAGES:
        return 2
    try:
        pages = _render(source, output, expected_pages)
    except Exception as error:
        code = str(error) if isinstance(error, RenderFailure) else "renderer_failed"
        sys.stdout.write(json.dumps({"ok": False, "code": code}, separators=(",", ":")))
        return 1
    sys.stdout.write(json.dumps({"ok": True, "pages": pages}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
