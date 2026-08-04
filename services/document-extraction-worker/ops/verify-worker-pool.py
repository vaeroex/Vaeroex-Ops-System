#!/usr/bin/env python3
"""Verify a deployed WorkerPool without reading or printing secret values."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

GATES = (
    "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED",
    "DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED",
    "DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED",
    "DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED",
)
ALLOWED_ENVIRONMENT = frozenset(
    {
        "DOCUMENT_EXTRACTION_WORKER_ENVIRONMENT",
        "DOCUMENT_EXTRACTION_WORKER_DEPLOYMENT_ID",
        "DOCUMENT_EXTRACTION_WORKER_ID",
        "DOCUMENT_EXTRACTION_WORKER_KEY_VERSION",
        "DOCUMENT_EXTRACTION_BROKER_URL",
        *GATES,
        "DOCUMENT_EXTRACTION_NVIDIA_MODEL",
        "DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION",
        "DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION",
        "DOCUMENT_EXTRACTION_IDLE_POLL_SECONDS",
        "DOCUMENT_EXTRACTION_WORKER_PRIVATE_KEY_PKCS8_BASE64",
        "NVIDIA_API_KEY",
        "TMPDIR",
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
    parser.add_argument("--expected-instances", choices=("0", "1"), required=True)
    parser.add_argument("--expected-gate-state", choices=("disabled", "qualification"), required=True)
    arguments = parser.parse_args()

    try:
        resource = json.loads(arguments.description_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemExit("worker_pool_description_invalid") from error
    resource = _mapping(resource, "worker_pool_description_invalid")
    name = resource.get("name") or _mapping(resource.get("metadata"), "worker_pool_shape_invalid").get("name")
    if name != arguments.worker_pool and not str(name).endswith(f"/workerPools/{arguments.worker_pool}"):
        raise SystemExit("worker_pool_identity_mismatch")
    if resource.get("uri") or resource.get("urls"):
        raise SystemExit("worker_pool_public_endpoint_unexpected")

    template = _template(resource)
    containers = template.get("containers")
    if not isinstance(containers, list) or len(containers) != 1 or not isinstance(containers[0], dict):
        raise SystemExit("worker_pool_container_shape_invalid")
    container = containers[0]
    if container.get("image") != arguments.image_digest:
        raise SystemExit("worker_pool_image_mismatch")
    service_account = template.get("serviceAccount") or template.get("serviceAccountName")
    if service_account != arguments.service_account:
        raise SystemExit("worker_pool_service_account_mismatch")

    raw_environment = container.get("env")
    if not isinstance(raw_environment, list):
        raise SystemExit("worker_pool_environment_invalid")
    environment: dict[str, dict[str, Any]] = {}
    for item in raw_environment:
        item = _mapping(item, "worker_pool_environment_invalid")
        name_value = item.get("name")
        if not isinstance(name_value, str) or name_value in environment:
            raise SystemExit("worker_pool_environment_invalid")
        environment[name_value] = item
    if set(environment) != ALLOWED_ENVIRONMENT:
        raise SystemExit("worker_pool_environment_scope_invalid")
    expected_values = {
        "DOCUMENT_EXTRACTION_WORKER_ENVIRONMENT": "preview",
        "DOCUMENT_EXTRACTION_WORKER_DEPLOYMENT_ID": arguments.deployment_id,
        "DOCUMENT_EXTRACTION_WORKER_ID": arguments.worker_id,
        "DOCUMENT_EXTRACTION_WORKER_KEY_VERSION": arguments.worker_key_version,
        "DOCUMENT_EXTRACTION_NVIDIA_MODEL": "nvidia/nemotron-parse",
        "DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION": "vaeroex_nemotron_parse_rest_v1",
        "DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION": "nemotron_parse_hosted_tool_call_rest_v1",
        "TMPDIR": "/var/tmp/vaeroex-document-worker",
    }
    for name_value, expected in expected_values.items():
        if environment[name_value].get("value") != expected:
            raise SystemExit("worker_pool_version_or_environment_mismatch")
    gate_value = "true" if arguments.expected_gate_state == "qualification" else "false"
    if any(environment[name].get("value") != gate_value for name in GATES):
        raise SystemExit("worker_pool_gate_state_mismatch")
    for name_value in ("DOCUMENT_EXTRACTION_WORKER_PRIVATE_KEY_PKCS8_BASE64", "NVIDIA_API_KEY"):
        item = environment[name_value]
        if "value" in item or not _secret_reference(item):
            raise SystemExit("worker_pool_secret_reference_invalid")

    startup = _mapping(container.get("startupProbe"), "worker_pool_startup_probe_missing")
    liveness = _mapping(container.get("livenessProbe"), "worker_pool_liveness_probe_missing")
    if _mapping(startup.get("httpGet"), "worker_pool_startup_probe_missing").get("path") != "/startup":
        raise SystemExit("worker_pool_startup_probe_invalid")
    if _mapping(liveness.get("httpGet"), "worker_pool_liveness_probe_missing").get("path") != "/health":
        raise SystemExit("worker_pool_liveness_probe_invalid")

    scaling = resource.get("scaling")
    instances: object = scaling.get("manualInstanceCount") if isinstance(scaling, dict) else None
    if instances is None:
        metadata = _mapping(resource.get("metadata"), "worker_pool_scaling_invalid")
        annotations = _mapping(metadata.get("annotations"), "worker_pool_scaling_invalid")
        instances = annotations.get("run.googleapis.com/manualInstanceCount")
    if str(instances) != arguments.expected_instances:
        raise SystemExit("worker_pool_scaling_mismatch")

    print(
        json.dumps(
            {
                "ok": True,
                "workerPool": arguments.worker_pool,
                "instances": int(arguments.expected_instances),
                "gateState": arguments.expected_gate_state,
                "immutableImage": True,
                "secretValuesRead": False,
                "publicEndpoint": False,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
