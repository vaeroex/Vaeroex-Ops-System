from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

WORKER_ROOT = Path(__file__).resolve().parents[1]
OPS = WORKER_ROOT / "ops"
VERIFY = OPS / "verify-google-document-ai-worker-pool.py"
IMAGE = (
    "us-west1-docker.pkg.dev/vaeroex-document-worker/"
    "vaeroex-document-workers-preview/document-extraction-worker@sha256:"
    + "a" * 64
)
SERVICE_ACCOUNT = (
    "vaeroex-doc-worker-preview@vaeroex-document-worker.iam.gserviceaccount.com"
)
WORKER_POOL = "vaeroex-document-extraction-preview"
BROKER_URL = "https://vaeroex-doc-broker-pr265-abc1234-uw.a.run.app"
PROJECT_NUMBER = "626856681952"
PROCESSOR_ID = "948f589143795629"


def _environment(mode: str = "disabled") -> list[dict[str, Any]]:
    gate_values = {
        "disabled": ("false", "false", "false", "false", "false"),
        "authentication": ("true", "false", "false", "false", "true"),
        "qualification": ("true", "true", "true", "true", "false"),
    }[mode]
    values = {
        "DOCUMENT_EXTRACTION_WORKER_ENVIRONMENT": "preview",
        "DOCUMENT_EXTRACTION_WORKER_DEPLOYMENT_ID": "phase-c1-pr265-google",
        "DOCUMENT_EXTRACTION_WORKER_ID": "preview-worker-google",
        "DOCUMENT_EXTRACTION_WORKER_KEY_VERSION": "worker-key-google-v1",
        "DOCUMENT_EXTRACTION_BROKER_URL": BROKER_URL,
        "DOCUMENT_EXTRACTION_BROKER_AUDIENCE": BROKER_URL,
        "DOCUMENT_EXTRACTION_BROKER_AUTH_MODE": "google_oidc_v1",
        "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED": gate_values[0],
        "DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED": gate_values[1],
        "DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED": gate_values[2],
        "DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED": gate_values[3],
        "DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED": gate_values[4],
        "DOCUMENT_EXTRACTION_ACTIVE_PROVIDER_PROFILE": "google_document_ai_enterprise_ocr_v1",
        "DOCUMENT_EXTRACTION_RESPONSE_PROFILE_DIAGNOSTIC_ENABLED": "false",
        "DOCUMENT_EXTRACTION_FIELD_PATH_DIAGNOSTIC_ENABLED": "false",
        "DOCUMENT_EXTRACTION_GOOGLE_PROJECT_NUMBER": PROJECT_NUMBER,
        "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_ID": PROCESSOR_ID,
        "DOCUMENT_EXTRACTION_GOOGLE_LOCATION": "us",
        "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_VERSION": "pretrained-ocr-v2.1-2024-08-07",
        "DOCUMENT_EXTRACTION_GOOGLE_MODEL": "pretrained-ocr-v2.1-2024-08-07",
        "DOCUMENT_EXTRACTION_GOOGLE_CLIENT_REVISION": "vaeroex_google_document_ai_rest_v1",
        "DOCUMENT_EXTRACTION_GOOGLE_PARSER_REVISION": "google_document_ai_enterprise_ocr_v1",
        "DOCUMENT_EXTRACTION_IDLE_POLL_SECONDS": "5",
        "TMPDIR": "/var/tmp/vaeroex-document-worker",
    }
    if mode == "qualification":
        values["DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL"] = (
            "google_document_ai_preview_qualification_v1"
        )
    return [
        *({"name": key, "value": value} for key, value in values.items()),
        {
            "name": "DOCUMENT_EXTRACTION_WORKER_PRIVATE_KEY_PKCS8_BASE64",
            "valueSource": {
                "secretKeyRef": {
                    "secret": "vaeroex-document-worker-preview-ed25519",
                    "version": "2",
                }
            },
        },
    ]


def _description(mode: str = "disabled", instances: int = 0) -> dict[str, Any]:
    return {
        "name": f"projects/vaeroex-document-worker/locations/us-west1/workerPools/{WORKER_POOL}",
        "template": {
            "serviceAccount": SERVICE_ACCOUNT,
            "containers": [
                {
                    "image": IMAGE,
                    "env": _environment(mode),
                    "startupProbe": {"httpGet": {"path": "/startup", "port": 8080}},
                    "livenessProbe": {"httpGet": {"path": "/health", "port": 8080}},
                }
            ],
        },
        "scaling": {"manualInstanceCount": instances},
    }


def _run_verifier(
    tmp_path: Path,
    description: dict[str, Any],
    mode: str = "disabled",
    instances: int = 0,
) -> subprocess.CompletedProcess[str]:
    path = tmp_path / "description.json"
    path.write_text(json.dumps(description), encoding="utf-8")
    return subprocess.run(
        [
            sys.executable,
            str(VERIFY),
            "--description-file",
            str(path),
            "--worker-pool",
            WORKER_POOL,
            "--service-account",
            SERVICE_ACCOUNT,
            "--image-digest",
            IMAGE,
            "--deployment-id",
            "phase-c1-pr265-google",
            "--worker-id",
            "preview-worker-google",
            "--worker-key-version",
            "worker-key-google-v1",
            "--broker-url",
            BROKER_URL,
            "--worker-secret-name",
            "vaeroex-document-worker-preview-ed25519",
            "--worker-secret-version",
            "2",
            "--google-project-number",
            PROJECT_NUMBER,
            "--google-processor-id",
            PROCESSOR_ID,
            "--expected-instances",
            str(instances),
            "--expected-mode",
            mode,
        ],
        capture_output=True,
        text=True,
        check=False,
    )


def test_google_manifest_is_inert_and_has_no_provider_secret(tmp_path: Path) -> None:
    output = tmp_path / "worker.yaml"
    result = subprocess.run(
        [
            sys.executable,
            str(OPS / "render-google-document-ai-worker-pool.py"),
            "--template",
            str(WORKER_ROOT / "cloud-run-google-document-ai-worker-pool.yaml.template"),
            "--output",
            str(output),
            "--worker-pool",
            WORKER_POOL,
            "--service-account",
            SERVICE_ACCOUNT,
            "--image-digest",
            IMAGE,
            "--deployment-id",
            "phase-c1-pr265-google",
            "--worker-id",
            "preview-worker-google",
            "--worker-key-version",
            "worker-key-google-v1",
            "--broker-url",
            BROKER_URL,
            "--broker-audience",
            BROKER_URL,
            "--worker-secret-name",
            "vaeroex-document-worker-preview-ed25519",
            "--worker-secret-version",
            "2",
            "--google-project-number",
            PROJECT_NUMBER,
            "--google-processor-id",
            PROCESSOR_ID,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    rendered = output.read_text(encoding="ascii")
    assert 'run.googleapis.com/manualInstanceCount: "0"' in rendered
    assert "google_document_ai_enterprise_ocr_v1" in rendered
    assert PROJECT_NUMBER in rendered
    assert PROCESSOR_ID in rendered
    assert "NVIDIA_API_KEY" not in rendered
    assert "GOOGLE_APPLICATION_CREDENTIALS" not in rendered
    assert "DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL" not in rendered
    assert "DOCUMENT_EXTRACTION_GOOGLE_PRODUCTION_APPROVAL" not in rendered


def test_google_verifier_accepts_disabled_authentication_and_qualification(
    tmp_path: Path,
) -> None:
    for mode, instances in (
        ("disabled", 0),
        ("authentication", 1),
        ("qualification", 1),
    ):
        result = _run_verifier(
            tmp_path,
            _description(mode, instances),
            mode,
            instances,
        )
        assert result.returncode == 0, result.stderr
        evidence = json.loads(result.stdout)
        assert evidence["providerProfile"] == "google_document_ai_enterprise_ocr_v1"
        assert evidence["nvidiaCredential"] is False
        assert evidence["productionApproval"] is False


def test_google_verifier_rejects_nvidia_static_google_and_production_credentials(
    tmp_path: Path,
) -> None:
    for key in (
        "NVIDIA_API_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "DOCUMENT_EXTRACTION_GOOGLE_PRODUCTION_APPROVAL",
    ):
        description = _description()
        description["template"]["containers"][0]["env"].append(
            {"name": key, "value": "forbidden"}
        )
        result = _run_verifier(tmp_path, description)
        assert result.returncode != 0
        assert "worker_pool_environment_scope_invalid" in result.stderr


def test_google_verifier_rejects_qualification_without_exact_preview_approval(
    tmp_path: Path,
) -> None:
    description = _description("qualification", 1)
    environment = description["template"]["containers"][0]["env"]
    for item in environment:
        if item["name"] == "DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL":
            item["value"] = "wrong"
    result = _run_verifier(tmp_path, description, "qualification", 1)
    assert result.returncode != 0
    assert "worker_pool_preview_approval_invalid" in result.stderr


def test_google_mode_script_has_bounded_confirmations_and_removes_approval() -> None:
    script = (OPS / "set-google-document-ai-preview-worker-mode.sh").read_text(
        encoding="ascii"
    )
    assert "google-document-ai-one-page-one-call-zero-retry" in script
    assert "google-document-ai-frozen-corpus-12-documents-13-pages-zero-retry" in script
    assert '--remove-env-vars "DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL"' in script
    assert "DOCUMENT_EXTRACTION_GOOGLE_PRODUCTION_APPROVAL" not in script
    assert "NVIDIA_API_KEY" not in script
