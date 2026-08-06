from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

BROKER_ROOT = Path(__file__).resolve().parents[1]
VERIFY = BROKER_ROOT / "ops" / "verify-google-document-ai-preview-broker.py"
SERVICE = "vaeroex-doc-broker-pr265-abc1234"
BROKER_SA = "vx-doc-broker-abc1234@vaeroex-document-worker.iam.gserviceaccount.com"
WORKER_SA = "vaeroex-doc-worker-preview@vaeroex-document-worker.iam.gserviceaccount.com"
IMAGE = (
    "us-west1-docker.pkg.dev/vaeroex-document-worker/"
    "vaeroex-document-workers-preview/document-extraction-broker@sha256:"
    + "a" * 64
)
PROJECT_NUMBER = "626856681952"
PROCESSOR_ID = "948f589143795629"


def _environment(mode: str = "inert") -> list[dict[str, object]]:
    gates = {
        "inert": ("false", "false", "false", "false", "false"),
        "authentication": ("true", "false", "false", "false", "false"),
        "qualification": ("true", "true", "true", "true", "false"),
        "frozen-corpus": ("true", "true", "true", "true", "true"),
    }[mode]
    plain = {
        "DOCUMENT_EXTRACTION_BROKER_RUNTIME_ENVIRONMENT": "preview",
        "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED": gates[0],
        "DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED": gates[1],
        "DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED": gates[2],
        "DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED": gates[3],
        "DOCUMENT_EXTRACTION_GOOGLE_FROZEN_CONTROLLER_ENABLED": gates[4],
        "DOCUMENT_EXTRACTION_ACTIVE_PROVIDER_PROFILE": "google_document_ai_enterprise_ocr_v1",
        "DOCUMENT_EXTRACTION_GOOGLE_PROJECT_NUMBER": PROJECT_NUMBER,
        "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_ID": PROCESSOR_ID,
        "DOCUMENT_EXTRACTION_GOOGLE_LOCATION": "us",
        "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_VERSION": "pretrained-ocr-v2.1-2024-08-07",
        "DOCUMENT_EXTRACTION_GOOGLE_MODEL": "pretrained-ocr-v2.1-2024-08-07",
        "DOCUMENT_EXTRACTION_GOOGLE_CLIENT_REVISION": "vaeroex_google_document_ai_rest_v1",
        "DOCUMENT_EXTRACTION_GOOGLE_PARSER_REVISION": "google_document_ai_enterprise_ocr_v1",
        "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_CURRENT_KEY_VERSION": "broker-capability-pr265-v1",
        "DOCUMENT_EXTRACTION_ENCRYPTION_CURRENT_KEY_VERSION": "cache-encryption-pr265-v1",
        "NEXT_PUBLIC_SUPABASE_URL": "https://zfpnhvcmuuvtswttmnjd.supabase.co",
    }
    if mode in ("qualification", "frozen-corpus"):
        plain["DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL"] = (
            "google_document_ai_preview_qualification_v1"
        )
    if mode == "frozen-corpus":
        plain["DOCUMENT_EXTRACTION_GOOGLE_FROZEN_CONTROLLER_CONFIRMATION"] = (
            "google_frozen_corpus_controller_v1"
        )
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
                    "secretKeyRef": {"name": f"{SERVICE}-{suffix}", "key": "1"}
                },
            }
            for key, suffix in secret_names.items()
        ),
    ]


def _description(mode: str = "inert") -> dict[str, Any]:
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
                    "containers": [{"image": IMAGE, "env": _environment(mode)}],
                },
            }
        },
        "status": {"url": f"https://{SERVICE}-abc-uw.a.run.app"},
    }


def _run(
    tmp_path: Path,
    description: dict[str, Any],
    mode: str = "inert",
) -> subprocess.CompletedProcess[str]:
    description_file = tmp_path / "description.json"
    policy_file = tmp_path / "policy.json"
    description_file.write_text(json.dumps(description), encoding="utf-8")
    policy_file.write_text(
        json.dumps(
            {
                "bindings": [
                    {
                        "role": "roles/run.invoker",
                        "members": [f"serviceAccount:{WORKER_SA}"],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
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
            "--google-project-number",
            PROJECT_NUMBER,
            "--google-processor-id",
            PROCESSOR_ID,
            "--expected-mode",
            mode,
        ],
        capture_output=True,
        text=True,
        check=False,
    )


def test_google_broker_verifier_accepts_exact_modes(tmp_path: Path) -> None:
    for mode in ("inert", "authentication", "qualification", "frozen-corpus"):
        result = _run(tmp_path, _description(mode), mode)
        assert result.returncode == 0, result.stderr
        evidence = json.loads(result.stdout)
        assert evidence["exactInvoker"] is True
        assert evidence["providerProfile"] == "google_document_ai_enterprise_ocr_v1"
        assert evidence["nvidiaCredential"] is False
        assert evidence["productionApproval"] is False


def test_google_broker_verifier_rejects_provider_credentials_and_production(
    tmp_path: Path,
) -> None:
    for key in (
        "NVIDIA_API_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "DOCUMENT_EXTRACTION_GOOGLE_PRODUCTION_APPROVAL",
    ):
        description = _description()
        description["spec"]["template"]["spec"]["containers"][0]["env"].append(
            {"name": key, "value": "forbidden"}
        )
        result = _run(tmp_path, description)
        assert result.returncode != 0
        assert "broker_environment_scope_invalid" in result.stderr


def test_google_broker_verifier_rejects_wrong_processor_or_missing_approval(
    tmp_path: Path,
) -> None:
    description = _description("qualification")
    environment = description["spec"]["template"]["spec"]["containers"][0]["env"]
    for item in environment:
        if item["name"] == "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_ID":
            item["value"] = "0000000000000000"
    result = _run(tmp_path, description, "qualification")
    assert result.returncode != 0
    assert "broker_version_or_environment_mismatch" in result.stderr

    description = _description("qualification")
    environment = description["spec"]["template"]["spec"]["containers"][0]["env"]
    environment[:] = [
        item
        for item in environment
        if item["name"] != "DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL"
    ]
    result = _run(tmp_path, description, "qualification")
    assert result.returncode != 0
    assert "broker_environment_scope_invalid" in result.stderr


def test_google_broker_mode_script_is_bounded_and_revokes_preview_approval() -> None:
    script = (
        BROKER_ROOT / "ops" / "set-google-document-ai-preview-broker-mode.sh"
    ).read_text(encoding="ascii")
    assert "google-document-ai-one-page-one-call-zero-retry" in script
    assert "google-document-ai-frozen-corpus-8-documents-9-pages-zero-retry" in script
    assert (
        'remove_vars="DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL,'
        'DOCUMENT_EXTRACTION_GOOGLE_FROZEN_CONTROLLER_CONFIRMATION"'
    ) in script
    assert "DOCUMENT_EXTRACTION_GOOGLE_PRODUCTION_APPROVAL" not in script
    assert "NVIDIA_API_KEY" not in script


def test_google_broker_deploy_script_has_no_provider_secret_or_fallback() -> None:
    script = (
        BROKER_ROOT / "ops" / "deploy-google-document-ai-preview-broker.sh"
    ).read_text(encoding="ascii")
    assert "DOCUMENT_EXTRACTION_ACTIVE_PROVIDER_PROFILE=google_document_ai_enterprise_ocr_v1" in script
    assert "NVIDIA_API_KEY" not in script
    assert "GOOGLE_APPLICATION_CREDENTIALS" not in script
    assert "DOCUMENT_EXTRACTION_GOOGLE_PRODUCTION_APPROVAL" not in script
    assert "fallback" not in script.lower()
