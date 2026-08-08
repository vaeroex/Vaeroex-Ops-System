"""Fail-closed local resource preflight for the bounded worker container."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

MIN_MEMORY_BYTES = 1_750_000_000
MIN_TEMP_FREE_BYTES = 256_000_000


def _memory_limit(path: Path = Path("/sys/fs/cgroup/memory.max")) -> int | None:
    try:
        value = path.read_text(encoding="ascii").strip()
    except OSError:
        return None
    if value == "max":
        return None
    try:
        return int(value)
    except ValueError as error:
        raise RuntimeError("worker_memory_limit_malformed") from error


def assert_runtime_resources(
    *,
    temporary_root: Path | None = None,
    memory_limit_path: Path = Path("/sys/fs/cgroup/memory.max"),
) -> None:
    memory_limit = _memory_limit(memory_limit_path)
    if memory_limit is not None and memory_limit < MIN_MEMORY_BYTES:
        raise RuntimeError("worker_memory_limit_insufficient")
    active_temporary_root = temporary_root or Path(tempfile.gettempdir())
    if shutil.disk_usage(active_temporary_root).free < MIN_TEMP_FREE_BYTES:
        raise RuntimeError("worker_temporary_storage_insufficient")
