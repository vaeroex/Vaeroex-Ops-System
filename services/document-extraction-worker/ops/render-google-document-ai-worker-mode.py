#!/usr/bin/env python3
"""Render or verify one bounded Google Document AI Preview worker mode."""

from __future__ import annotations

import argparse
import copy
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

WORKER_POOL = "vaeroex-document-extraction-preview"
SERVICE_ACCOUNT = (
    "vaeroex-doc-worker-preview@vaeroex-document-worker.iam.gserviceaccount.com"
)
IMAGE = re.compile(
    r"^us-west1-docker[.]pkg[.]dev/vaeroex-document-worker/"
    r"vaeroex-document-workers-preview/document-extraction-worker@sha256:[0-9a-f]{64}$"
)
PROCESSOR_ID = re.compile(r"^[0-9a-f]{16}$")
DEPLOYMENT_ID = re.compile(r"^phase-c1-pr265-[0-9a-f]{7,12}-google-v1$")
WORKER_KEY_VERSION = re.compile(r"^pr265-worker-key-[A-Za-z0-9._-]{1,96}$")
PREVIEW_APPROVAL = "DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL"
PREVIEW_APPROVAL_VALUE = "google_document_ai_preview_qualification_v1"
GATE_NAMES = (
    "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED",
    "DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED",
    "DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED",
    "DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED",
    "DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED",
)
MODE_VALUES = {
    "disabled": ("false", "false", "false", "false", "false"),
    "authentication": ("true", "false", "true", "false", "false"),
    "one-page": ("true", "true", "false", "true", "true"),
    "frozen-corpus": ("true", "true", "false", "true", "true"),
}
BASE_VALUES = {
    "DOCUMENT_EXTRACTION_WORKER_ENVIRONMENT": "preview",
    "DOCUMENT_EXTRACTION_WORKER_ID": WORKER_POOL,
    "DOCUMENT_EXTRACTION_BROKER_AUTH_MODE": "google_oidc_v1",
    "DOCUMENT_EXTRACTION_ACTIVE_PROVIDER_PROFILE": (
        "google_document_ai_enterprise_ocr_v1"
    ),
    "DOCUMENT_EXTRACTION_RESPONSE_PROFILE_DIAGNOSTIC_ENABLED": "false",
    "DOCUMENT_EXTRACTION_FIELD_PATH_DIAGNOSTIC_ENABLED": "false",
    "DOCUMENT_EXTRACTION_GOOGLE_PROJECT_NUMBER": "626856681952",
    "DOCUMENT_EXTRACTION_GOOGLE_LOCATION": "us",
    "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_VERSION": (
        "pretrained-ocr-v2.1-2024-08-07"
    ),
    "DOCUMENT_EXTRACTION_GOOGLE_MODEL": "pretrained-ocr-v2.1-2024-08-07",
    "DOCUMENT_EXTRACTION_GOOGLE_CLIENT_REVISION": (
        "vaeroex_google_document_ai_rest_v1"
    ),
    "DOCUMENT_EXTRACTION_GOOGLE_PARSER_REVISION": (
        "google_document_ai_enterprise_ocr_v1"
    ),
    "DOCUMENT_EXTRACTION_IDLE_POLL_SECONDS": "5",
    "TMPDIR": "/var/tmp/vaeroex-document-worker",
}
BASE_NAMES = frozenset(
    {
        *BASE_VALUES,
        *GATE_NAMES,
        "DOCUMENT_EXTRACTION_WORKER_DEPLOYMENT_ID",
        "DOCUMENT_EXTRACTION_WORKER_KEY_VERSION",
        "DOCUMENT_EXTRACTION_BROKER_URL",
        "DOCUMENT_EXTRACTION_BROKER_AUDIENCE",
        "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_ID",
        "DOCUMENT_EXTRACTION_WORKER_PRIVATE_KEY_PKCS8_BASE64",
    }
)
FORBIDDEN_NAMES = frozenset(
    {
        "NVIDIA_API_KEY",
        "DOCUMENT_EXTRACTION_NVIDIA_MODEL",
        "DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION",
        "DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION",
        "DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL",
        "DOCUMENT_EXTRACTION_GOOGLE_PRODUCTION_APPROVAL",
        "GOOGLE_APPLICATION_CREDENTIALS",
    }
)


def _mapping(value: object, code: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SystemExit(code)
    return value


def _load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemExit("worker_mode_description_invalid") from error
    return _mapping(value, "worker_mode_description_invalid")


def _environment(resource: dict[str, Any]) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    if resource.get("apiVersion") != "run.googleapis.com/v1" or resource.get(
        "kind"
    ) != "WorkerPool":
        raise SystemExit("worker_mode_resource_contract_invalid")
    metadata = _mapping(resource.get("metadata"), "worker_mode_resource_contract_invalid")
    if metadata.get("name") != WORKER_POOL:
        raise SystemExit("worker_mode_identity_invalid")
    spec = _mapping(resource.get("spec"), "worker_mode_resource_contract_invalid")
    template = _mapping(spec.get("template"), "worker_mode_resource_contract_invalid")
    template_spec = _mapping(
        template.get("spec"), "worker_mode_resource_contract_invalid"
    )
    if template_spec.get("serviceAccountName") != SERVICE_ACCOUNT:
        raise SystemExit("worker_mode_identity_invalid")
    containers = template_spec.get("containers")
    if (
        not isinstance(containers, list)
        or len(containers) != 1
        or not isinstance(containers[0], dict)
    ):
        raise SystemExit("worker_mode_container_invalid")
    container = containers[0]
    if not IMAGE.fullmatch(str(container.get("image") or "")):
        raise SystemExit("worker_mode_image_invalid")
    raw_environment = container.get("env")
    if not isinstance(raw_environment, list):
        raise SystemExit("worker_mode_environment_invalid")
    environment: dict[str, dict[str, Any]] = {}
    for item in raw_environment:
        item = _mapping(item, "worker_mode_environment_invalid")
        name = item.get("name")
        if not isinstance(name, str) or name in environment:
            raise SystemExit("worker_mode_environment_invalid")
        environment[name] = item
    observed = set(environment)
    if observed.intersection(FORBIDDEN_NAMES) or observed not in (
        set(BASE_NAMES),
        {*BASE_NAMES, PREVIEW_APPROVAL},
    ):
        raise SystemExit("worker_mode_environment_scope_invalid")
    for name, value in BASE_VALUES.items():
        if environment[name].get("value") != value:
            raise SystemExit("worker_mode_contract_drift")
    deployment_id = str(environment["DOCUMENT_EXTRACTION_WORKER_DEPLOYMENT_ID"].get("value") or "")
    worker_key_version = str(environment["DOCUMENT_EXTRACTION_WORKER_KEY_VERSION"].get("value") or "")
    processor_id = str(environment["DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_ID"].get("value") or "")
    if not DEPLOYMENT_ID.fullmatch(deployment_id):
        raise SystemExit("worker_mode_deployment_identity_invalid")
    if not WORKER_KEY_VERSION.fullmatch(worker_key_version):
        raise SystemExit("worker_mode_worker_key_invalid")
    if not PROCESSOR_ID.fullmatch(processor_id):
        raise SystemExit("worker_mode_processor_invalid")
    broker_url = str(environment["DOCUMENT_EXTRACTION_BROKER_URL"].get("value") or "")
    broker_audience = str(
        environment["DOCUMENT_EXTRACTION_BROKER_AUDIENCE"].get("value") or ""
    )
    parsed = urlparse(broker_url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not re.fullmatch(
            r"vaeroex-doc-broker-pr265-[0-9a-f]{7,12}-626856681952[.]us-west1[.]run[.]app",
            parsed.hostname,
        )
        or parsed.path not in ("", "/")
        or parsed.params
        or parsed.query
        or parsed.fragment
        or broker_audience.rstrip("/") != broker_url.rstrip("/")
    ):
        raise SystemExit("worker_mode_broker_identity_invalid")
    secret_item = environment["DOCUMENT_EXTRACTION_WORKER_PRIVATE_KEY_PKCS8_BASE64"]
    secret_reference = _mapping(
        _mapping(secret_item.get("valueFrom"), "worker_mode_secret_reference_invalid").get(
            "secretKeyRef"
        ),
        "worker_mode_secret_reference_invalid",
    )
    if (
        "value" in secret_item
        or secret_reference.get("name") != "vaeroex-document-worker-preview-ed25519"
        or not str(secret_reference.get("key") or "").isdigit()
        or int(str(secret_reference.get("key"))) <= 0
    ):
        raise SystemExit("worker_mode_secret_reference_invalid")
    _observed_mode(environment)
    return template_spec, environment


def _observed_mode(environment: dict[str, dict[str, Any]]) -> str:
    gates = tuple(str(environment[name].get("value") or "") for name in GATE_NAMES)
    approval = environment.get(PREVIEW_APPROVAL)
    if gates == MODE_VALUES["disabled"] and approval is None:
        return "disabled"
    if gates == MODE_VALUES["authentication"] and approval is None:
        return "authentication"
    if (
        gates == MODE_VALUES["one-page"]
        and approval is not None
        and approval.get("value") == PREVIEW_APPROVAL_VALUE
    ):
        return "qualification"
    raise SystemExit("worker_mode_gate_state_invalid")


def _instance_count(resource: dict[str, Any]) -> str:
    metadata = _mapping(resource.get("metadata"), "worker_mode_scaling_invalid")
    annotations = _mapping(metadata.get("annotations"), "worker_mode_scaling_invalid")
    return str(annotations.get("run.googleapis.com/manualInstanceCount") or "")


def _expected_instance_count(mode: str) -> str:
    return "0" if mode == "disabled" else "1"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--description-file", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--worker-pool", required=True)
    parser.add_argument("--mode", choices=tuple(MODE_VALUES), required=True)
    parser.add_argument("--verify-only", action="store_true")
    arguments = parser.parse_args()
    if arguments.worker_pool != WORKER_POOL:
        raise SystemExit("worker_mode_identity_invalid")
    if arguments.verify_only == (arguments.output is not None):
        raise SystemExit("worker_mode_output_contract_invalid")

    resource = _load(arguments.description_file)
    template_spec, environment = _environment(resource)
    if arguments.verify_only:
        expected_mode = (
            "qualification"
            if arguments.mode in ("one-page", "frozen-corpus")
            else arguments.mode
        )
        if _observed_mode(environment) != expected_mode or _instance_count(
            resource
        ) != _expected_instance_count(arguments.mode):
            raise SystemExit("worker_mode_postcondition_failed")
        return 0

    rendered_spec = copy.deepcopy(template_spec)
    rendered_environment = rendered_spec["containers"][0]["env"]
    mode_values = dict(zip(GATE_NAMES, MODE_VALUES[arguments.mode], strict=True))
    updated_environment: list[dict[str, Any]] = []
    for item in rendered_environment:
        name = item["name"]
        if name == PREVIEW_APPROVAL:
            continue
        updated_environment.append(
            {"name": name, "value": mode_values[name]}
            if name in mode_values
            else item
        )
    if arguments.mode in ("one-page", "frozen-corpus"):
        updated_environment.append(
            {"name": PREVIEW_APPROVAL, "value": PREVIEW_APPROVAL_VALUE}
        )
    rendered_spec["containers"][0]["env"] = updated_environment
    manifest = {
        "apiVersion": "run.googleapis.com/v1",
        "kind": "WorkerPool",
        "metadata": {
            "name": WORKER_POOL,
            "annotations": {
                "run.googleapis.com/description": (
                    "Vaeroex Google Document AI Preview worker; disabled at zero "
                    "instances by default."
                ),
                "run.googleapis.com/scalingMode": "manual",
                "run.googleapis.com/manualInstanceCount": _expected_instance_count(
                    arguments.mode
                ),
            },
        },
        "spec": {"template": {"spec": rendered_spec}},
    }
    assert arguments.output is not None
    arguments.output.write_text(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")),
        encoding="ascii",
    )
    arguments.output.chmod(0o600)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
