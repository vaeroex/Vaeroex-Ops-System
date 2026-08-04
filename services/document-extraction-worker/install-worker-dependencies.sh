#!/usr/bin/env bash
set -euo pipefail

python_bin="${1:-python3.12}"
worker_root="$(cd "$(dirname "$0")" && pwd)"

if [[ "$($python_bin -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')" != "3.12" ]]; then
  echo "The private document extraction worker requires Python 3.12." >&2
  exit 1
fi

"$python_bin" -m pip install \
  --require-virtualenv \
  --disable-pip-version-check \
  --no-cache-dir \
  --require-hashes \
  -r "$worker_root/build-requirements.lock"

"$python_bin" -m pip install \
  --require-virtualenv \
  --disable-pip-version-check \
  --no-cache-dir \
  --require-hashes \
  -r "$worker_root/requirements.lock"

"$python_bin" -m pip check
