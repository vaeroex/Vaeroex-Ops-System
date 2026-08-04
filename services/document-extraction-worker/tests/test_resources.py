from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from vaeroex_document_worker.resources import assert_runtime_resources


def test_runtime_resource_preflight_accepts_sufficient_memory(tmp_path: Path) -> None:
    memory = tmp_path / "memory.max"
    memory.write_text("2147483648", encoding="ascii")
    assert_runtime_resources(temporary_root=tmp_path, memory_limit_path=memory)


def test_runtime_resource_preflight_rejects_small_memory_limit(tmp_path: Path) -> None:
    memory = tmp_path / "memory.max"
    memory.write_text("1073741824", encoding="ascii")
    with pytest.raises(RuntimeError, match="memory_limit_insufficient"):
        assert_runtime_resources(temporary_root=tmp_path, memory_limit_path=memory)


def test_runtime_resource_preflight_rejects_small_temporary_volume(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    memory = tmp_path / "memory.max"
    memory.write_text("2147483648", encoding="ascii")
    monkeypatch.setattr(
        "vaeroex_document_worker.resources.shutil.disk_usage",
        lambda _path: SimpleNamespace(free=255_999_999),
    )
    with pytest.raises(RuntimeError, match="temporary_storage_insufficient"):
        assert_runtime_resources(temporary_root=tmp_path, memory_limit_path=memory)
