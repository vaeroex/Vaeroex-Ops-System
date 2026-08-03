#!/usr/bin/env bash
set -euo pipefail

python_bin="${1:-python3.12}"
worker_root="$(cd "$(dirname "$0")" && pwd)"
client_revision="52886112cafab4c4bca1cda0d4f588785adfe4d3"

if [[ "$($python_bin -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')" != "3.12" ]]; then
  echo "The private document extraction worker requires Python 3.12." >&2
  exit 1
fi

SOURCE_DATE_EPOCH=1785542400 \
RETRIEVER_VERSION=2026.8.1 \
RETRIEVER_BUILD_NUMBER=52886112 \
RETRIEVER_RELEASE_TYPE=dev \
RETRIEVER_GIT_SHA="$client_revision" \
  "$python_bin" -m pip install \
    --require-virtualenv \
    --disable-pip-version-check \
    --no-cache-dir \
    -r "$worker_root/requirements.txt"
