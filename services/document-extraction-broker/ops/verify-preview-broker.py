#!/usr/bin/env python3
"""Verify the ephemeral Preview broker without reading secret values."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

GATES = (
    "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED",
    "DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED",
    "DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED",
    "DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED",
)
PLAIN_ENVIRONMENT = frozenset(
    {
        "DOCUMENT_EXTRACTION_BROKER_RUNTIME_ENVIRONMENT",
        *GATES,
        "DOCUMENT_EXTRACTION_NVIDIA_MODEL",
        "DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION",
        "DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION",
        "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_CURRENT_KEY_VERSION",
        "DOCUMENT_EXTRACTION_ENCRYPTION_CURRENT_KEY_VERSION",
        "NEXT_PUBLIC_SUPABASE_URL",
    }
)
SECRET_ENVIRONMENT = frozenset(
    {
        "SUPABASE_SERVICE_ROLE_KEY",
        "DOCUMENT_EXTRACTION_WORKER_PUBLIC_KEYS_JSON",
        "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_KEYS_JSON",
        "DOCUMENT_EXTRACTION_TELEMETRY_HMAC_SECRET",
        "DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON",
    }
)
SECRET_SUFFIXES = {
    "SUPABASE_SERVICE_ROLE_KEY": "supabase-service-role",
    "DOCUMENT_EXTRACTION_WORKER_PUBLIC_KEYS_JSON": "worker-public-keys",
    "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_KEYS_JSON": "capability-keys",
    "DOCUMENT_EXTRACTION_TELEMETRY_HMAC_SECRET": "telemetry-hmac",
    "DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON": "encryption-keys",
}


def _mapping(value: object, code: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SystemExit(code)
    return value


def _secret_reference(item: dict[str, Any]) -> dict[str, Any] | None:
    source = item.get("valueSource") or item.get("valueFrom")
    if not isinstance(source, dict):
        return None
    reference = source.get("secretKeyRef")
    return reference if isinstance(reference, dict) else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--description-file", type=Path, required=True)
    parser.add_argument("--iam-policy-file", type=Path, required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--service-account", required=True)
    parser.add_argument("--worker-service-account", required=True)
    parser.add_argument("--image-digest", required=True)
    parser.add_argument("--expected-mode", choices=("inert", "authentication", "qualification"), required=True)
    arguments = parser.parse_args()

    try:
        resource = json.loads(arguments.description_file.read_text(encoding="utf-8"))
        policy = json.loads(arguments.iam_policy_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemExit("broker_description_invalid") from error
    resource = _mapping(resource, "broker_description_invalid")
    policy = _mapping(policy, "broker_iam_policy_invalid")
    name = str(resource.get("metadata", {}).get("name") or resource.get("name") or "")
    if name != arguments.service and not name.endswith(f"/services/{arguments.service}"):
        raise SystemExit("broker_service_identity_mismatch")
    uri = resource.get("status", {}).get("url") or resource.get("uri")
    parsed_uri = urlparse(str(uri or ""))
    if parsed_uri.scheme != "https" or not (parsed_uri.hostname or "").endswith(".run.app"):
        raise SystemExit("broker_service_url_invalid")

    template = _mapping(resource.get("spec", {}).get("template") or resource.get("template"), "broker_template_invalid")
    template_spec = _mapping(template.get("spec") or template, "broker_template_invalid")
    service_account = template_spec.get("serviceAccountName") or template_spec.get("serviceAccount")
    if service_account != arguments.service_account:
        raise SystemExit("broker_service_account_mismatch")
    containers = template_spec.get("containers")
    if not isinstance(containers, list) or len(containers) != 1 or not isinstance(containers[0], dict):
        raise SystemExit("broker_container_shape_invalid")
    container = containers[0]
    if container.get("image") != arguments.image_digest:
        raise SystemExit("broker_image_mismatch")
    concurrency = template_spec.get("containerConcurrency") or template_spec.get("maxInstanceRequestConcurrency")
    if str(concurrency) != "1":
        raise SystemExit("broker_concurrency_invalid")
    service_metadata = _mapping(resource.get("metadata") or {}, "broker_service_metadata_invalid")
    service_annotations = _mapping(
        service_metadata.get("annotations") or {}, "broker_service_metadata_invalid"
    )
    template_metadata = _mapping(template.get("metadata") or {}, "broker_template_metadata_invalid")
    annotations = _mapping(template_metadata.get("annotations") or {}, "broker_template_metadata_invalid")
    scaling = template.get("scaling") if isinstance(template.get("scaling"), dict) else {}
    maximum = (
        service_annotations.get("run.googleapis.com/maxScale")
        or scaling.get("maxInstanceCount")
        or annotations.get("autoscaling.knative.dev/maxScale")
    )
    minimum = (
        service_annotations.get("run.googleapis.com/minScale")
        or scaling.get("minInstanceCount")
        or annotations.get("autoscaling.knative.dev/minScale")
        or 0
    )
    if str(maximum) != "1" or str(minimum) != "0":
        raise SystemExit("broker_scaling_invalid")

    raw_environment = container.get("env")
    if not isinstance(raw_environment, list):
        raise SystemExit("broker_environment_invalid")
    environment: dict[str, dict[str, Any]] = {}
    for item in raw_environment:
        item = _mapping(item, "broker_environment_invalid")
        key = item.get("name")
        if not isinstance(key, str) or key in environment:
            raise SystemExit("broker_environment_invalid")
        environment[key] = item
    if set(environment) != PLAIN_ENVIRONMENT | SECRET_ENVIRONMENT:
        raise SystemExit("broker_environment_scope_invalid")
    for key in SECRET_ENVIRONMENT:
        reference = _secret_reference(environment[key])
        if "value" in environment[key] or not reference:
            raise SystemExit("broker_secret_reference_invalid")
        secret_name = reference.get("name") or reference.get("secret")
        secret_version = reference.get("key") or reference.get("version")
        if (
            secret_name != f"{arguments.service}-{SECRET_SUFFIXES[key]}"
            or not str(secret_version or "").isdigit()
            or int(str(secret_version)) <= 0
        ):
            raise SystemExit("broker_secret_reference_invalid")
    if environment["DOCUMENT_EXTRACTION_BROKER_RUNTIME_ENVIRONMENT"].get("value") != "preview":
        raise SystemExit("broker_runtime_environment_invalid")
    if environment["NEXT_PUBLIC_SUPABASE_URL"].get("value") != "https://zfpnhvcmuuvtswttmnjd.supabase.co":
        raise SystemExit("broker_supabase_scope_invalid")
    if "mdiianhfrojmxqpwrflh" in json.dumps(resource):
        raise SystemExit("broker_production_reference_detected")
    expected = {
        "inert": ("false", "false", "false", "false"),
        "authentication": ("true", "false", "false", "false"),
        "qualification": ("true", "true", "true", "true"),
    }[arguments.expected_mode]
    if tuple(environment[key].get("value") for key in GATES) != expected:
        raise SystemExit("broker_gate_state_mismatch")
    if any(key in environment for key in ("NVIDIA_API_KEY", "DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL")):
        raise SystemExit("broker_forbidden_credential_present")

    invoker_members: set[str] = set()
    for binding in policy.get("bindings", []):
        if isinstance(binding, dict) and binding.get("role") == "roles/run.invoker":
            invoker_members.update(str(member) for member in binding.get("members", []))
    if invoker_members != {f"serviceAccount:{arguments.worker_service_account}"}:
        raise SystemExit("broker_invoker_policy_invalid")
    if "allUsers" in json.dumps(policy) or "allAuthenticatedUsers" in json.dumps(policy):
        raise SystemExit("broker_public_invocation_detected")

    print(
        json.dumps(
            {
                "ok": True,
                "service": arguments.service,
                "mode": arguments.expected_mode,
                "immutableImage": True,
                "maxInstances": 1,
                "concurrency": 1,
                "publicUnauthenticated": False,
                "exactInvoker": True,
                "previewSupabaseOnly": True,
                "secretValuesRead": False,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
