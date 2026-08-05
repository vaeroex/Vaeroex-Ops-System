#!/usr/bin/env python3
"""Render the inert Google Document AI WorkerPool manifest."""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from urllib.parse import urlparse

IDENTIFIER = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
WORKER_VALUE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
SERVICE_ACCOUNT = re.compile(
    r"^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$"
)
IMAGE_DIGEST = re.compile(r"^[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$")
PROJECT_NUMBER = re.compile(r"^[1-9][0-9]{5,19}$")
PROCESSOR_ID = re.compile(r"^[0-9a-f]{16}$")


def _positive_version(value: str) -> str:
    if not value.isdigit() or int(value) <= 0:
        raise SystemExit("Secret versions must be explicit positive integers.")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--worker-pool", required=True)
    parser.add_argument("--service-account", required=True)
    parser.add_argument("--image-digest", required=True)
    parser.add_argument("--deployment-id", required=True)
    parser.add_argument("--worker-id", required=True)
    parser.add_argument("--worker-key-version", required=True)
    parser.add_argument("--broker-url", required=True)
    parser.add_argument("--broker-audience", required=True)
    parser.add_argument("--worker-secret-name", required=True)
    parser.add_argument("--worker-secret-version", required=True)
    parser.add_argument("--google-project-number", required=True)
    parser.add_argument("--google-processor-id", required=True)
    arguments = parser.parse_args()

    if not IDENTIFIER.fullmatch(arguments.worker_pool):
        raise SystemExit("The WorkerPool name is malformed.")
    if not SERVICE_ACCOUNT.fullmatch(arguments.service_account):
        raise SystemExit("The WorkerPool service account is malformed.")
    if not IMAGE_DIGEST.fullmatch(arguments.image_digest):
        raise SystemExit("WORKER_IMAGE_DIGEST must be immutable.")
    if not all(
        WORKER_VALUE.fullmatch(value)
        for value in (
            arguments.deployment_id,
            arguments.worker_id,
            arguments.worker_key_version,
        )
    ):
        raise SystemExit("A WorkerPool identity value is malformed.")
    if not IDENTIFIER.fullmatch(arguments.worker_secret_name):
        raise SystemExit("The WorkerPool secret name is malformed.")
    if not PROJECT_NUMBER.fullmatch(arguments.google_project_number):
        raise SystemExit("The Google project number is malformed.")
    if not PROCESSOR_ID.fullmatch(arguments.google_processor_id):
        raise SystemExit("The Google processor ID is malformed.")
    broker = urlparse(arguments.broker_url)
    if (
        broker.scheme != "https"
        or not broker.hostname
        or not broker.hostname.endswith(".run.app")
        or broker.path not in ("", "/")
        or broker.params
        or broker.query
        or broker.fragment
        or broker.username
        or broker.password
    ):
        raise SystemExit("BROKER_URL must be an HTTPS Cloud Run origin.")
    if arguments.broker_audience.rstrip("/") != arguments.broker_url.rstrip("/"):
        raise SystemExit("BROKER_AUDIENCE must equal the exact broker origin.")

    replacements = {
        "DOCUMENT_EXTRACTION_WORKER_POOL": arguments.worker_pool,
        "DOCUMENT_EXTRACTION_SERVICE_ACCOUNT": arguments.service_account,
        "DOCUMENT_EXTRACTION_IMAGE_DIGEST": arguments.image_digest,
        "DOCUMENT_EXTRACTION_DEPLOYMENT_ID": arguments.deployment_id,
        "DOCUMENT_EXTRACTION_WORKER_ID_VALUE": arguments.worker_id,
        "DOCUMENT_EXTRACTION_WORKER_KEY_VERSION_VALUE": arguments.worker_key_version,
        "DOCUMENT_EXTRACTION_BROKER_URL_VALUE": arguments.broker_url.rstrip("/"),
        "DOCUMENT_EXTRACTION_BROKER_AUDIENCE_VALUE": arguments.broker_audience.rstrip("/"),
        "DOCUMENT_EXTRACTION_WORKER_SECRET_NAME": arguments.worker_secret_name,
        "DOCUMENT_EXTRACTION_WORKER_SECRET_VERSION": _positive_version(
            arguments.worker_secret_version
        ),
        "DOCUMENT_EXTRACTION_GOOGLE_PROJECT_NUMBER_VALUE": arguments.google_project_number,
        "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_ID_VALUE": arguments.google_processor_id,
    }
    content = arguments.template.read_text(encoding="ascii")
    for placeholder, value in replacements.items():
        if placeholder not in content:
            raise SystemExit(f"WorkerPool template placeholder is missing: {placeholder}.")
        content = content.replace(placeholder, value)
    if any(placeholder in content for placeholder in replacements):
        raise SystemExit("WorkerPool template contains an unresolved placeholder.")
    arguments.output.write_text(content, encoding="ascii")
    arguments.output.chmod(0o600)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
