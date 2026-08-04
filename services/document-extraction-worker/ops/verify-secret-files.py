#!/usr/bin/env python3
"""Fail closed unless operator-provided secret files are private regular files."""

from __future__ import annotations

import os
import stat
import sys
from pathlib import Path


def _verify(path: Path) -> None:
    metadata = path.lstat()
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise SystemExit("secret_file_type_invalid")
    if metadata.st_uid != os.getuid():
        raise SystemExit("secret_file_owner_invalid")
    if stat.S_IMODE(metadata.st_mode) != 0o600:
        raise SystemExit("secret_file_mode_invalid")
    if metadata.st_size <= 0:
        raise SystemExit("secret_file_empty")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("secret_file_required")
    for value in sys.argv[1:]:
        _verify(Path(value))


if __name__ == "__main__":
    main()
