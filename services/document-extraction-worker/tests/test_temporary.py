from __future__ import annotations

import os
import time

from vaeroex_document_worker.temporary import (
    RUN_PREFIX,
    SecureTemporaryWorkspace,
    scavenge_stale_worker_directories,
    worker_temporary_root,
)


def test_temporary_workspace_is_private_and_removed() -> None:
    with SecureTemporaryWorkspace() as temporary:
        assert temporary.path is not None
        path = temporary.path
        assert path.stat().st_mode & 0o777 == 0o700
        temporary.file("source.bin").write_bytes(b"synthetic")
    assert not path.exists()


def test_stale_crash_directory_is_scavenged_without_touching_other_paths() -> None:
    root = worker_temporary_root()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    stale = root / f"{RUN_PREFIX}stale-test"
    stale.mkdir(mode=0o700, exist_ok=True)
    stale.joinpath("page.png").write_bytes(b"synthetic")
    old = time.time() - 7_200
    os.utime(stale, (old, old))
    unrelated = root / "unrelated"
    unrelated.mkdir(exist_ok=True)
    assert scavenge_stale_worker_directories(max_age_seconds=3_600) >= 1
    assert not stale.exists()
    assert unrelated.exists()
    unrelated.rmdir()
