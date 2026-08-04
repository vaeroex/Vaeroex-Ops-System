#!/usr/bin/env python3
"""Generate one deployment-bound Ed25519 identity without printing key material."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat

IDENTIFIER = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def _new_file(path: Path, content: str, mode: int) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(descriptor, "w", encoding="ascii") as output:
        output.write(content)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker-id", required=True)
    parser.add_argument("--key-version", required=True)
    parser.add_argument("--environment", choices=("preview", "production"), required=True)
    parser.add_argument("--deployment-id", required=True)
    parser.add_argument("--private-key-file", type=Path, required=True)
    parser.add_argument("--public-record-file", type=Path, required=True)
    arguments = parser.parse_args()
    for value in (arguments.worker_id, arguments.key_version, arguments.deployment_id):
        if not IDENTIFIER.fullmatch(value):
            raise SystemExit("A worker identity argument is malformed.")
    if arguments.private_key_file.parent != arguments.public_record_file.parent:
        raise SystemExit("Identity outputs must share one operator-controlled directory.")
    arguments.private_key_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(arguments.private_key_file.parent, 0o700)

    private_key = Ed25519PrivateKey.generate()
    private_bytes = private_key.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())
    public_bytes = private_key.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
    _new_file(
        arguments.private_key_file,
        base64.b64encode(private_bytes).decode("ascii"),
        0o600,
    )
    public_record = {
        arguments.worker_id: {
            "keyVersion": arguments.key_version,
            "publicKeySpkiBase64": base64.b64encode(public_bytes).decode("ascii"),
            "environment": arguments.environment,
            "deploymentId": arguments.deployment_id,
        }
    }
    _new_file(
        arguments.public_record_file,
        json.dumps(public_record, sort_keys=True, separators=(",", ":")),
        0o600,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
