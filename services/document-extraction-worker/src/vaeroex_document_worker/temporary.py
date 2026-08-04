"""Restrictive temporary storage with crash-recovery scavenging."""

from __future__ import annotations

import atexit
import os
import shutil
import signal
import tempfile
import threading
import time
from pathlib import Path
from types import FrameType
from typing import Any, Callable

ROOT_NAME = "vaeroex-document-extraction-private"
RUN_PREFIX = "run-"


def worker_temporary_root() -> Path:
    return Path(tempfile.gettempdir()) / ROOT_NAME


def _safe_run_directory(path: Path, root: Path) -> bool:
    try:
        stat = path.lstat()
    except FileNotFoundError:
        return False
    return (
        path.parent == root
        and path.name.startswith(RUN_PREFIX)
        and path.is_dir()
        and not path.is_symlink()
        and stat.st_uid == os.getuid()
    )


def remove_run_directory(path: Path) -> None:
    root = worker_temporary_root()
    if _safe_run_directory(path, root):
        shutil.rmtree(path, ignore_errors=False)


def scavenge_stale_worker_directories(max_age_seconds: int = 3_600, now: float | None = None) -> int:
    root = worker_temporary_root()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    cutoff = (time.time() if now is None else now) - max_age_seconds
    removed = 0
    for path in root.iterdir():
        if _safe_run_directory(path, root) and path.stat().st_mtime <= cutoff:
            remove_run_directory(path)
            removed += 1
    return removed


class SecureTemporaryWorkspace:
    def __init__(self) -> None:
        self.path: Path | None = None
        self._previous_handlers: dict[int, Any] = {}
        self._atexit_callback: Callable[[], None] | None = None

    def __enter__(self) -> "SecureTemporaryWorkspace":
        root = worker_temporary_root()
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(root, 0o700)
        self.path = Path(tempfile.mkdtemp(prefix=RUN_PREFIX, dir=root))
        os.chmod(self.path, 0o700)
        self._atexit_callback = self.cleanup
        atexit.register(self._atexit_callback)
        if threading.current_thread() is threading.main_thread():
            for signal_number in (signal.SIGTERM, signal.SIGINT):
                try:
                    self._previous_handlers[signal_number] = signal.getsignal(signal_number)
                    signal.signal(signal_number, self._signal_cleanup)
                except ValueError:
                    self._previous_handlers.clear()
                    break
        return self

    def _signal_cleanup(self, signal_number: int, _frame: FrameType | None) -> None:
        self.cleanup()
        previous = self._previous_handlers.get(signal_number)
        if callable(previous):
            previous(signal_number, _frame)
            return
        raise SystemExit(128 + signal_number)

    def file(self, name: str) -> Path:
        if self.path is None or not name or "/" in name or "\\" in name:
            raise RuntimeError("Invalid private-worker temporary file request.")
        return self.path / name

    def cleanup(self) -> None:
        if self.path is not None:
            remove_run_directory(self.path)
            self.path = None

    def __exit__(self, *_: object) -> None:
        for signal_number, previous in self._previous_handlers.items():
            try:
                signal.signal(signal_number, previous)
            except ValueError:
                pass
        self._previous_handlers.clear()
        if self._atexit_callback is not None:
            atexit.unregister(self._atexit_callback)
            self._atexit_callback = None
        self.cleanup()
