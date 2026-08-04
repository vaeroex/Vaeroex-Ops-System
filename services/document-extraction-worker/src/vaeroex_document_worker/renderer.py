"""Bounded parent process for secret-free page rendering."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from .provider_types import ProviderFailure, RenderedPage

MAX_RENDERER_OUTPUT_BYTES = 120_000_000
MAX_RENDERER_STDOUT_BYTES = 65_536
RENDERER_TIMEOUT_SECONDS = 45


def _resource_limits() -> None:
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (40, 40))
        resource.setrlimit(resource.RLIMIT_AS, (1_500_000_000, 1_500_000_000))
        resource.setrlimit(resource.RLIMIT_FSIZE, (20_000_000, 20_000_000))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ImportError, OSError, ValueError):
        # Container-level CPU/memory limits remain mandatory. Unsupported
        # process limits do not expand renderer input or output bounds.
        return


def _manifest(stdout: bytes, return_code: int) -> dict[str, Any]:
    if len(stdout) > MAX_RENDERER_STDOUT_BYTES:
        raise ProviderFailure("renderer_manifest_oversized", "validation", retryable=False)
    try:
        value = json.loads(stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProviderFailure("renderer_manifest_invalid", "validation", retryable=False) from error
    if not isinstance(value, dict):
        raise ProviderFailure("renderer_manifest_invalid", "validation", retryable=False)
    if return_code != 0 or value.get("ok") is not True:
        code = value.get("code")
        safe_code = code if isinstance(code, str) and code.startswith("renderer_") else "renderer_failed"
        raise ProviderFailure(safe_code, "validation", retryable=False)
    return value


def render_source(source: Path, output_directory: Path, expected_pages: int) -> list[RenderedPage]:
    output_directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    os.chmod(output_directory, 0o700)
    script = Path(__file__).with_name("renderer_subprocess.py")
    environment = {
        "LANG": "C",
        "LC_ALL": "C",
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "PYTHONUTF8": "1",
    }
    try:
        completed = subprocess.run(
            [sys.executable, "-I", str(script), str(source), str(output_directory), str(expected_pages)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=RENDERER_TIMEOUT_SECONDS,
            check=False,
            env=environment,
            preexec_fn=_resource_limits if os.name == "posix" else None,
        )
    except subprocess.TimeoutExpired as error:
        raise ProviderFailure("renderer_timeout", "validation", retryable=False) from error
    manifest = _manifest(completed.stdout, completed.returncode)
    raw_pages = manifest.get("pages")
    if not isinstance(raw_pages, list) or len(raw_pages) != expected_pages:
        raise ProviderFailure("renderer_page_count_mismatch", "validation", retryable=False)
    rendered: list[RenderedPage] = []
    total_bytes = 0
    for expected_page, row in enumerate(raw_pages, start=1):
        if not isinstance(row, dict) or row.get("page") != expected_page:
            raise ProviderFailure("renderer_manifest_invalid", "validation", retryable=False)
        file_name = row.get("file")
        if not isinstance(file_name, str) or file_name != f"page-{expected_page:04d}.png":
            raise ProviderFailure("renderer_manifest_invalid", "validation", retryable=False)
        path = output_directory / file_name
        try:
            stat = path.lstat()
        except FileNotFoundError as error:
            raise ProviderFailure("renderer_output_missing", "validation", retryable=False) from error
        if path.is_symlink() or not path.is_file() or stat.st_uid != os.getuid():
            raise ProviderFailure("renderer_output_invalid", "validation", retryable=False)
        content = path.read_bytes()
        byte_length = row.get("byteLength")
        content_sha256 = row.get("contentSha256")
        width = row.get("width")
        height = row.get("height")
        if (
            not isinstance(byte_length, int)
            or byte_length != len(content)
            or not isinstance(content_sha256, str)
            or content_sha256 != hashlib.sha256(content).hexdigest()
            or not isinstance(width, int)
            or not 1 <= width <= 1_664
            or not isinstance(height, int)
            or not 1 <= height <= 2_048
            or row.get("mimeType") != "image/png"
        ):
            raise ProviderFailure("renderer_output_invalid", "validation", retryable=False)
        total_bytes += byte_length
        if total_bytes > MAX_RENDERER_OUTPUT_BYTES:
            raise ProviderFailure("renderer_output_limit_exceeded", "validation", retryable=False)
        rendered.append(
            RenderedPage(
                page=expected_page,
                path=path,
                mime_type="image/png",
                width=width,
                height=height,
                byte_length=byte_length,
                content_sha256=content_sha256,
            )
        )
    return rendered
