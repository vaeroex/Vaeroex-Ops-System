#!/usr/bin/env python3
"""Dry-run or delete only Vaeroex assets in one bounded Preview window."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from vaeroex_document_worker.asset_cleanup import cleanup_from_files


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key-file", type=Path, required=True)
    parser.add_argument("--window-start", required=True)
    parser.add_argument("--window-end", required=True)
    parser.add_argument("--confirmation")
    arguments = parser.parse_args()
    result = cleanup_from_files(
        arguments.api_key_file,
        window_start=arguments.window_start,
        window_end=arguments.window_end,
        confirmation=arguments.confirmation,
    )
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
