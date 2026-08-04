from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from pathlib import Path

BROKER_ROOT = Path(__file__).resolve().parents[1]
VERIFY = BROKER_ROOT / "ops" / "verify-preview-broker.py"
PROVISION_SECRETS = BROKER_ROOT / "ops" / "add-preview-broker-secret-versions.mjs"
PROVISION_RUNTIME = BROKER_ROOT / "ops" / "provision-preview-broker-runtime.sh"
CLEANUP = BROKER_ROOT / "ops" / "cleanup-preview-broker.sh"
SERVICE = "vaeroex-doc-broker-pr265-cc1d2b4"
BROKER_SA = "vx-doc-broker-cc1d2b4@vaeroex-document-worker.iam.gserviceaccount.com"
WORKER_SA = "vaeroex-doc-worker-preview@vaeroex-document-worker.iam.gserviceaccount.com"
IMAGE = "us-west1-docker.pkg.dev/vaeroex-document-worker/repository/broker@sha256:" + "a" * 64


def _environment() -> list[dict[str, object]]:
    plain = {
        "DOCUMENT_EXTRACTION_BROKER_RUNTIME_ENVIRONMENT": "preview",
        "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED": "false",
        "DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED": "false",
        "DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED": "false",
        "DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED": "false",
        "DOCUMENT_EXTRACTION_NVIDIA_MODEL": "nvidia/nemotron-parse",
        "DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION": "vaeroex_nemotron_parse_rest_v1",
        "DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION": "nemotron_parse_hosted_tool_call_rest_v1",
        "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_CURRENT_KEY_VERSION": "broker-capability-pr265-v1",
        "DOCUMENT_EXTRACTION_ENCRYPTION_CURRENT_KEY_VERSION": "cache-encryption-pr265-v1",
        "NEXT_PUBLIC_SUPABASE_URL": "https://zfpnhvcmuuvtswttmnjd.supabase.co",
    }
    secret_names = {
        "SUPABASE_SERVICE_ROLE_KEY": "supabase-service-role",
        "DOCUMENT_EXTRACTION_WORKER_PUBLIC_KEYS_JSON": "worker-public-keys",
        "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_KEYS_JSON": "capability-keys",
        "DOCUMENT_EXTRACTION_TELEMETRY_HMAC_SECRET": "telemetry-hmac",
        "DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON": "encryption-keys",
    }
    return [
        *({"name": key, "value": value} for key, value in plain.items()),
        *(
            {
                "name": key,
                "valueFrom": {
                    "secretKeyRef": {
                        "name": f"{SERVICE}-{suffix}",
                        "key": "1",
                    }
                },
            }
            for key, suffix in secret_names.items()
        ),
    ]


def _description() -> dict[str, object]:
    return {
        "metadata": {
            "name": SERVICE,
            "annotations": {"run.googleapis.com/maxScale": "1"},
        },
        "spec": {
            "template": {
                "metadata": {
                    "annotations": {
                        "autoscaling.knative.dev/minScale": "0",
                        "autoscaling.knative.dev/maxScale": "20",
                    }
                },
                "spec": {
                    "serviceAccountName": BROKER_SA,
                    "containerConcurrency": 1,
                    "containers": [{"image": IMAGE, "env": _environment()}],
                },
            }
        },
        "status": {"url": f"https://{SERVICE}-abc-uw.a.run.app"},
    }


def _run(tmp_path: Path, description: dict[str, object], policy: dict[str, object]) -> subprocess.CompletedProcess[str]:
    description_file = tmp_path / "description.json"
    policy_file = tmp_path / "policy.json"
    description_file.write_text(json.dumps(description), encoding="utf-8")
    policy_file.write_text(json.dumps(policy), encoding="utf-8")
    return subprocess.run(
        [
            sys.executable,
            str(VERIFY),
            "--description-file",
            str(description_file),
            "--iam-policy-file",
            str(policy_file),
            "--service",
            SERVICE,
            "--service-account",
            BROKER_SA,
            "--worker-service-account",
            WORKER_SA,
            "--image-digest",
            IMAGE,
            "--expected-mode",
            "inert",
        ],
        capture_output=True,
        text=True,
        check=False,
    )


def test_broker_verifier_accepts_exact_inert_preview_service(tmp_path: Path) -> None:
    policy = {"bindings": [{"role": "roles/run.invoker", "members": [f"serviceAccount:{WORKER_SA}"]}]}
    result = _run(tmp_path, _description(), policy)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["exactInvoker"] is True


def test_broker_verifier_rejects_service_level_scaling_above_one(tmp_path: Path) -> None:
    description = _description()
    description["metadata"]["annotations"]["run.googleapis.com/maxScale"] = "2"  # type: ignore[index]
    policy = {"bindings": [{"role": "roles/run.invoker", "members": [f"serviceAccount:{WORKER_SA}"]}]}
    result = _run(tmp_path, description, policy)
    assert result.returncode != 0
    assert "broker_scaling_invalid" in result.stderr


def test_broker_verifier_rejects_public_or_additional_invokers(tmp_path: Path) -> None:
    policy = {
        "bindings": [
            {
                "role": "roles/run.invoker",
                "members": [f"serviceAccount:{WORKER_SA}", "allUsers"],
            }
        ]
    }
    result = _run(tmp_path, _description(), policy)
    assert result.returncode != 0
    assert "broker_invoker_policy_invalid" in result.stderr


def test_broker_verifier_rejects_production_or_plaintext_secret_scope(tmp_path: Path) -> None:
    description = _description()
    container = description["spec"]["template"]["spec"]["containers"][0]  # type: ignore[index]
    for item in container["env"]:  # type: ignore[index]
        if item["name"] == "NEXT_PUBLIC_SUPABASE_URL":
            item["value"] = "https://mdiianhfrojmxqpwrflh.supabase.co"
        if item["name"] == "SUPABASE_SERVICE_ROLE_KEY":
            item.pop("valueFrom")
            item["value"] = "forbidden"
    policy = {"bindings": [{"role": "roles/run.invoker", "members": [f"serviceAccount:{WORKER_SA}"]}]}
    result = _run(tmp_path, description, policy)
    assert result.returncode != 0
    assert "broker_secret_reference_invalid" in result.stderr or "broker_supabase_scope_invalid" in result.stderr


def _jwt(project_ref: str) -> str:
    def encode(value: dict[str, str]) -> str:
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")

    return f"{encode({'alg': 'HS256', 'typ': 'JWT'})}.{encode({'ref': project_ref, 'role': 'service_role'})}.synthetic"


def _fake_gcloud(tmp_path: Path) -> tuple[Path, Path]:
    audit = tmp_path / "gcloud-audit.jsonl"
    executable = tmp_path / "gcloud"
    executable.write_text(
        """#!/usr/bin/env python3
import json
import os
import sys

args = sys.argv[1:]
if args[:3] == ["secrets", "versions", "add"]:
    value = sys.stdin.buffer.read()
    with open(os.environ["FAKE_GCLOUD_AUDIT"], "a", encoding="utf-8") as output:
        output.write(json.dumps({"operation": "add", "secret": args[3], "bytes": len(value)}) + "\\n")
    print(f"projects/test/secrets/{args[3]}/versions/2")
    raise SystemExit(0)
if args[:3] == ["secrets", "versions", "destroy"]:
    raise SystemExit(0)
raise SystemExit(2)
""",
        encoding="utf-8",
    )
    executable.chmod(0o700)
    return executable, audit


def _secret_environment(fake_gcloud: Path, audit: Path) -> dict[str, str]:
    return {
        **os.environ,
        "GCP_PROJECT_ID": "vaeroex-document-worker",
        "GCP_REGION": "us-west1",
        "BROKER_SERVICE": SERVICE,
        "WORKER_ID": "vaeroex-document-extraction-preview",
        "WORKER_KEY_VERSION": "pr265-worker-key-v2",
        "WORKER_DEPLOYMENT_ID": "phase-c1-pr265-cc1d2b4",
        "PHASE_C1_PREVIEW_CONFIRMATION": "vaeroex-document-extraction-phase-c1-preview-only",
        "GCLOUD_BIN": str(fake_gcloud),
        "FAKE_GCLOUD_AUDIT": str(audit),
    }


def test_secret_provisioner_streams_only_scoped_preview_values_without_readback(tmp_path: Path) -> None:
    fake_gcloud, audit = _fake_gcloud(tmp_path)
    token = _jwt("zfpnhvcmuuvtswttmnjd")
    result = subprocess.run(
        ["node", str(PROVISION_SECRETS)],
        input=token,
        capture_output=True,
        text=True,
        check=False,
        env=_secret_environment(fake_gcloud, audit),
    )
    assert result.returncode == 0, result.stderr
    assert token not in result.stdout
    assert json.loads(result.stdout)["ok"] is True
    events = [json.loads(line) for line in audit.read_text(encoding="utf-8").splitlines()]
    assert len(events) == 6
    assert all(event["operation"] == "add" and event["bytes"] > 0 for event in events)
    assert all("value" not in event for event in events)


def test_secret_provisioner_accepts_official_preview_secret_key_after_exact_endpoint_validation(
    tmp_path: Path,
) -> None:
    fake_gcloud, audit = _fake_gcloud(tmp_path)
    preload = tmp_path / "preview-supabase-fetch.mjs"
    preload.write_text(
        """
globalThis.fetch = async (url, options) => {
  if (url !== "https://zfpnhvcmuuvtswttmnjd.supabase.co/rest/v1/") throw new Error();
  if (options?.headers?.apikey !== "sb_secret_synthetic_preview_only") throw new Error();
  return new Response(null, { status: 200 });
};
""",
        encoding="utf-8",
    )
    environment = _secret_environment(fake_gcloud, audit)
    environment["NODE_OPTIONS"] = f"--import={preload}"
    result = subprocess.run(
        ["node", str(PROVISION_SECRETS)],
        input="sb_secret_synthetic_preview_only",
        capture_output=True,
        text=True,
        check=False,
        env=environment,
    )
    assert result.returncode == 0, result.stderr
    assert "sb_secret" not in result.stdout
    assert json.loads(result.stdout)["ok"] is True
    assert len(audit.read_text(encoding="utf-8").splitlines()) == 6


def test_secret_provisioner_rejects_unscoped_official_secret_key_before_gcloud(
    tmp_path: Path,
) -> None:
    fake_gcloud, audit = _fake_gcloud(tmp_path)
    preload = tmp_path / "rejected-supabase-fetch.mjs"
    preload.write_text(
        """
globalThis.fetch = async () => new Response(null, { status: 401 });
""",
        encoding="utf-8",
    )
    environment = _secret_environment(fake_gcloud, audit)
    environment["NODE_OPTIONS"] = f"--import={preload}"
    result = subprocess.run(
        ["node", str(PROVISION_SECRETS)],
        input="sb_secret_synthetic_wrong_project",
        capture_output=True,
        text=True,
        check=False,
        env=environment,
    )
    assert result.returncode != 0
    assert "preview_supabase_service_role_scope_invalid" in result.stderr
    assert not audit.exists()


def test_secret_provisioner_rejects_production_key_before_gcloud(tmp_path: Path) -> None:
    fake_gcloud, audit = _fake_gcloud(tmp_path)
    result = subprocess.run(
        ["node", str(PROVISION_SECRETS)],
        input=_jwt("mdiianhfrojmxqpwrflh"),
        capture_output=True,
        text=True,
        check=False,
        env=_secret_environment(fake_gcloud, audit),
    )
    assert result.returncode != 0
    assert "preview_supabase_service_role_scope_invalid" in result.stderr
    assert not audit.exists()


def test_runtime_and_cleanup_scripts_fail_closed_outside_exact_scope(tmp_path: Path) -> None:
    environment = {
        **os.environ,
        "GCP_PROJECT_ID": "production-project",
        "GCP_REGION": "us-west1",
        "BROKER_SERVICE": SERVICE,
        "BROKER_SERVICE_ACCOUNT": BROKER_SA,
        "WORKER_SERVICE_ACCOUNT": WORKER_SA,
        "WORKER_SECRET_VERSION": "1",
        "PHASE_C1_PREVIEW_CONFIRMATION": "vaeroex-document-extraction-phase-c1-preview-only",
        "PHASE_C1_BROKER_CLEANUP_CONFIRMATION": f"delete-{SERVICE}",
    }
    provision = subprocess.run(
        [str(PROVISION_RUNTIME)], capture_output=True, text=True, check=False, env=environment
    )
    cleanup = subprocess.run(
        [str(CLEANUP)], capture_output=True, text=True, check=False, env=environment
    )
    assert provision.returncode != 0
    assert cleanup.returncode != 0
    assert "isolated Phase C1 Google project" in provision.stderr
    assert "isolated Phase C1 Google project" in cleanup.stderr
