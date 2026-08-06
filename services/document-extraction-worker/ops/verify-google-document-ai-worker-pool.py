#!/usr/bin/env python3
"""Verify the exact Google Document AI Preview WorkerPool configuration."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

GATES = (
    "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED",
    "DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED",
    "DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED",
    "DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED",
    "DOCUMENT_EXTRACTION_GOOGLE_FROZEN_CONTROLLER_ENABLED",
)
AUTH_GATE = "DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED"
PREVIEW_APPROVAL = "DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL"
PREVIEW_APPROVAL_VALUE = "google_document_ai_preview_qualification_v1"
CONTROLLER_CONFIRMATION = "DOCUMENT_EXTRACTION_GOOGLE_FROZEN_CONTROLLER_CONFIRMATION"
CONTROLLER_CONFIRMATION_VALUE = "google_frozen_corpus_controller_v2"
BASE_ENVIRONMENT = frozenset(
    {
        "DOCUMENT_EXTRACTION_WORKER_ENVIRONMENT",
        "DOCUMENT_EXTRACTION_WORKER_DEPLOYMENT_ID",
        "DOCUMENT_EXTRACTION_WORKER_ID",
        "DOCUMENT_EXTRACTION_WORKER_KEY_VERSION",
        "DOCUMENT_EXTRACTION_BROKER_URL",
        "DOCUMENT_EXTRACTION_BROKER_AUDIENCE",
        "DOCUMENT_EXTRACTION_BROKER_AUTH_MODE",
        AUTH_GATE,
        *GATES,
        "DOCUMENT_EXTRACTION_ACTIVE_PROVIDER_PROFILE",
        "DOCUMENT_EXTRACTION_RESPONSE_PROFILE_DIAGNOSTIC_ENABLED",
        "DOCUMENT_EXTRACTION_FIELD_PATH_DIAGNOSTIC_ENABLED",
        "DOCUMENT_EXTRACTION_GOOGLE_PROJECT_NUMBER",
        "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_ID",
        "DOCUMENT_EXTRACTION_GOOGLE_LOCATION",
        "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_VERSION",
        "DOCUMENT_EXTRACTION_GOOGLE_MODEL",
        "DOCUMENT_EXTRACTION_GOOGLE_CLIENT_REVISION",
        "DOCUMENT_EXTRACTION_GOOGLE_PARSER_REVISION",
        "DOCUMENT_EXTRACTION_IDLE_POLL_SECONDS",
        "DOCUMENT_EXTRACTION_WORKER_PRIVATE_KEY_PKCS8_BASE64",
        "TMPDIR",
    }
)
FORBIDDEN_KEYS = frozenset(
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


def _template(resource: dict[str, Any]) -> dict[str, Any]:
    direct = resource.get("template")
    if isinstance(direct, dict):
        return direct
    spec = _mapping(resource.get("spec"), "worker_pool_shape_invalid")
    template = _mapping(spec.get("template"), "worker_pool_shape_invalid")
    return _mapping(template.get("spec"), "worker_pool_shape_invalid")


def _secret_reference(item: dict[str, Any]) -> dict[str, Any] | None:
    source = item.get("valueSource") or item.get("valueFrom")
    if not isinstance(source, dict):
        return None
    reference = source.get("secretKeyRef")
    return reference if isinstance(reference, dict) else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--description-file", type=Path, required=True)
    parser.add_argument("--worker-pool", required=True)
    parser.add_argument("--service-account", required=True)
    parser.add_argument("--image-digest", required=True)
    parser.add_argument("--deployment-id", required=True)
    parser.add_argument("--worker-id", required=True)
    parser.add_argument("--worker-key-version", required=True)
    parser.add_argument("--broker-url", required=True)
    parser.add_argument("--worker-secret-name", required=True)
    parser.add_argument("--worker-secret-version", required=True)
    parser.add_argument("--google-project-number", required=True)
    parser.add_argument("--google-processor-id", required=True)
    parser.add_argument("--expected-instances", choices=("0", "1"), required=True)
    parser.add_argument(
        "--expected-mode",
        choices=("disabled", "authentication", "qualification", "frozen-corpus"),
        required=True,
    )
    arguments = parser.parse_args()

    try:
        resource = json.loads(arguments.description_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemExit("worker_pool_description_invalid") from error
    resource = _mapping(resource, "worker_pool_description_invalid")
    name = resource.get("name") or _mapping(
        resource.get("metadata"), "worker_pool_shape_invalid"
    ).get("name")
    if name != arguments.worker_pool and not str(name).endswith(
        f"/workerPools/{arguments.worker_pool}"
    ):
        raise SystemExit("worker_pool_identity_mismatch")
    if resource.get("uri") or resource.get("urls"):
        raise SystemExit("worker_pool_public_endpoint_unexpected")

    template = _template(resource)
    containers = template.get("containers")
    if (
        not isinstance(containers, list)
        or len(containers) != 1
        or not isinstance(containers[0], dict)
    ):
        raise SystemExit("worker_pool_container_shape_invalid")
    container = containers[0]
    if container.get("image") != arguments.image_digest:
        raise SystemExit("worker_pool_image_mismatch")
    service_account = template.get("serviceAccount") or template.get(
        "serviceAccountName"
    )
    if service_account != arguments.service_account:
        raise SystemExit("worker_pool_service_account_mismatch")

    raw_environment = container.get("env")
    if not isinstance(raw_environment, list):
        raise SystemExit("worker_pool_environment_invalid")
    environment: dict[str, dict[str, Any]] = {}
    for item in raw_environment:
        item = _mapping(item, "worker_pool_environment_invalid")
        key = item.get("name")
        if not isinstance(key, str) or key in environment:
            raise SystemExit("worker_pool_environment_invalid")
        environment[key] = item
    observed = set(environment)
    expected = set(BASE_ENVIRONMENT)
    if arguments.expected_mode in ("qualification", "frozen-corpus"):
        expected.add(PREVIEW_APPROVAL)
    if arguments.expected_mode == "frozen-corpus":
        expected.add(CONTROLLER_CONFIRMATION)
    if observed != expected or observed.intersection(FORBIDDEN_KEYS):
        raise SystemExit("worker_pool_environment_scope_invalid")

    expected_values = {
        "DOCUMENT_EXTRACTION_WORKER_ENVIRONMENT": "preview",
        "DOCUMENT_EXTRACTION_WORKER_DEPLOYMENT_ID": arguments.deployment_id,
        "DOCUMENT_EXTRACTION_WORKER_ID": arguments.worker_id,
        "DOCUMENT_EXTRACTION_WORKER_KEY_VERSION": arguments.worker_key_version,
        "DOCUMENT_EXTRACTION_BROKER_URL": arguments.broker_url.rstrip("/"),
        "DOCUMENT_EXTRACTION_BROKER_AUDIENCE": arguments.broker_url.rstrip("/"),
        "DOCUMENT_EXTRACTION_BROKER_AUTH_MODE": "google_oidc_v1",
        "DOCUMENT_EXTRACTION_ACTIVE_PROVIDER_PROFILE": "google_document_ai_enterprise_ocr_v1",
        "DOCUMENT_EXTRACTION_RESPONSE_PROFILE_DIAGNOSTIC_ENABLED": "false",
        "DOCUMENT_EXTRACTION_FIELD_PATH_DIAGNOSTIC_ENABLED": "false",
        "DOCUMENT_EXTRACTION_GOOGLE_PROJECT_NUMBER": arguments.google_project_number,
        "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_ID": arguments.google_processor_id,
        "DOCUMENT_EXTRACTION_GOOGLE_LOCATION": "us",
        "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_VERSION": "pretrained-ocr-v2.1-2024-08-07",
        "DOCUMENT_EXTRACTION_GOOGLE_MODEL": "pretrained-ocr-v2.1-2024-08-07",
        "DOCUMENT_EXTRACTION_GOOGLE_CLIENT_REVISION": "vaeroex_google_document_ai_rest_v1",
        "DOCUMENT_EXTRACTION_GOOGLE_PARSER_REVISION": "google_document_ai_enterprise_ocr_v1",
        "TMPDIR": "/var/tmp/vaeroex-document-worker",
    }
    for key, value in expected_values.items():
        if environment[key].get("value") != value:
            raise SystemExit("worker_pool_version_or_environment_mismatch")
    expected_gates = {
        "disabled": ("false", "false", "false", "false", "false", "false"),
        "authentication": ("true", "false", "false", "false", "false", "true"),
        "qualification": ("true", "true", "true", "true", "false", "false"),
        "frozen-corpus": ("true", "true", "true", "true", "true", "false"),
    }[arguments.expected_mode]
    observed_gates = tuple(environment[key].get("value") for key in GATES) + (
        environment[AUTH_GATE].get("value"),
    )
    if observed_gates != expected_gates:
        raise SystemExit("worker_pool_gate_state_mismatch")
    if arguments.expected_mode in ("qualification", "frozen-corpus"):
        if environment[PREVIEW_APPROVAL].get("value") != PREVIEW_APPROVAL_VALUE:
            raise SystemExit("worker_pool_preview_approval_invalid")
    if arguments.expected_mode == "frozen-corpus":
        if environment[CONTROLLER_CONFIRMATION].get("value") != CONTROLLER_CONFIRMATION_VALUE:
            raise SystemExit("worker_pool_controller_confirmation_invalid")

    secret_item = environment["DOCUMENT_EXTRACTION_WORKER_PRIVATE_KEY_PKCS8_BASE64"]
    reference = _secret_reference(secret_item)
    if "value" in secret_item or not reference:
        raise SystemExit("worker_pool_secret_reference_invalid")
    secret_name = reference.get("name") or reference.get("secret")
    secret_version = reference.get("key") or reference.get("version")
    if (
        secret_name != arguments.worker_secret_name
        or str(secret_version or "") != arguments.worker_secret_version
    ):
        raise SystemExit("worker_pool_secret_reference_invalid")

    startup = _mapping(container.get("startupProbe"), "worker_pool_startup_probe_missing")
    liveness = _mapping(container.get("livenessProbe"), "worker_pool_liveness_probe_missing")
    if _mapping(startup.get("httpGet"), "worker_pool_startup_probe_missing").get(
        "path"
    ) != "/startup":
        raise SystemExit("worker_pool_startup_probe_invalid")
    if _mapping(liveness.get("httpGet"), "worker_pool_liveness_probe_missing").get(
        "path"
    ) != "/health":
        raise SystemExit("worker_pool_liveness_probe_invalid")

    scaling = resource.get("scaling")
    instances: object = (
        scaling.get("manualInstanceCount") if isinstance(scaling, dict) else None
    )
    if instances is None:
        metadata = _mapping(resource.get("metadata"), "worker_pool_scaling_invalid")
        annotations = _mapping(
            metadata.get("annotations"), "worker_pool_scaling_invalid"
        )
        instances = annotations.get("run.googleapis.com/manualInstanceCount")
    if str(instances) != arguments.expected_instances:
        raise SystemExit("worker_pool_scaling_mismatch")

    print(
        json.dumps(
            {
                "ok": True,
                "workerPool": arguments.worker_pool,
                "instances": int(arguments.expected_instances),
                "mode": arguments.expected_mode,
                "providerProfile": "google_document_ai_enterprise_ocr_v1",
                "immutableImage": True,
                "secretValuesRead": False,
                "staticGoogleCredential": False,
                "nvidiaCredential": False,
                "productionApproval": False,
                "publicEndpoint": False,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
