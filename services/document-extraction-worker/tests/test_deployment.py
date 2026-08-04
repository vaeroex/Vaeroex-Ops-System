from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

WORKER_ROOT = Path(__file__).resolve().parents[1]
OPS = WORKER_ROOT / "ops"
IMAGE = (
    "us-west1-docker.pkg.dev/vaeroex-preview-123/workers/document-extraction-worker"
    "@sha256:" + ("a" * 64)
)
SERVICE_ACCOUNT = (
    "vaeroex-doc-worker-preview@vaeroex-preview-123.iam.gserviceaccount.com"
)


def _environment(gate_value: str = "false") -> list[dict[str, Any]]:
    values = {
        "DOCUMENT_EXTRACTION_WORKER_ENVIRONMENT": "preview",
        "DOCUMENT_EXTRACTION_WORKER_DEPLOYMENT_ID": "phase-c1-preview-1",
        "DOCUMENT_EXTRACTION_WORKER_ID": "preview-worker-1",
        "DOCUMENT_EXTRACTION_WORKER_KEY_VERSION": "worker-key-v1",
        "DOCUMENT_EXTRACTION_BROKER_URL": "https://preview-branch.vercel.app",
        "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED": gate_value,
        "DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED": gate_value,
        "DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED": gate_value,
        "DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED": gate_value,
        "DOCUMENT_EXTRACTION_NVIDIA_MODEL": "nvidia/nemotron-parse",
        "DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION": "vaeroex_nemotron_parse_rest_v1",
        "DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION": "nemotron_parse_hosted_tool_call_rest_v1",
        "DOCUMENT_EXTRACTION_IDLE_POLL_SECONDS": "5",
        "TMPDIR": "/var/tmp/vaeroex-document-worker",
    }
    environment: list[dict[str, Any]] = [
        {"name": name, "value": value} for name, value in values.items()
    ]
    environment.extend(
        {
            "name": name,
            "valueSource": {"secretKeyRef": {"secret": f"preview-{name.lower()}"}},
        }
        for name in (
            "DOCUMENT_EXTRACTION_WORKER_PRIVATE_KEY_PKCS8_BASE64",
            "NVIDIA_API_KEY",
        )
    )
    return environment


def _description(gate_value: str = "false", instances: int = 0) -> dict[str, Any]:
    return {
        "name": "projects/vaeroex-preview-123/locations/us-west1/workerPools/vaeroex-document-extraction-preview",
        "template": {
            "serviceAccount": SERVICE_ACCOUNT,
            "containers": [
                {
                    "image": IMAGE,
                    "env": _environment(gate_value),
                    "startupProbe": {"httpGet": {"path": "/startup", "port": 8080}},
                    "livenessProbe": {"httpGet": {"path": "/health", "port": 8080}},
                }
            ],
        },
        "scaling": {"manualInstanceCount": instances},
    }


def _verifier_arguments(description: Path) -> list[str]:
    return [
        sys.executable,
        str(OPS / "verify-worker-pool.py"),
        "--description-file",
        str(description),
        "--worker-pool",
        "vaeroex-document-extraction-preview",
        "--service-account",
        SERVICE_ACCOUNT,
        "--image-digest",
        IMAGE,
        "--deployment-id",
        "phase-c1-preview-1",
        "--worker-id",
        "preview-worker-1",
        "--worker-key-version",
        "worker-key-v1",
        "--expected-instances",
        "0",
        "--expected-gate-state",
        "disabled",
    ]


def test_manifest_renderer_keeps_preview_worker_inert_and_secret_referenced(
    tmp_path: Path,
) -> None:
    output = tmp_path / "worker.yaml"
    result = subprocess.run(
        [
            sys.executable,
            str(OPS / "render-worker-pool.py"),
            "--template",
            str(WORKER_ROOT / "cloud-run-worker-pool.yaml.template"),
            "--output",
            str(output),
            "--worker-pool",
            "vaeroex-document-extraction-preview",
            "--service-account",
            SERVICE_ACCOUNT,
            "--image-digest",
            IMAGE,
            "--deployment-id",
            "phase-c1-preview-1",
            "--worker-id",
            "preview-worker-1",
            "--worker-key-version",
            "worker-key-v1",
            "--broker-url",
            "https://preview-branch.vercel.app",
            "--worker-secret-name",
            "vaeroex-document-worker-preview-ed25519",
            "--worker-secret-version",
            "1",
            "--nvidia-secret-name",
            "vaeroex-document-worker-preview-nvidia",
            "--nvidia-secret-version",
            "2",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    rendered = output.read_text(encoding="ascii")
    assert "run.googleapis.com/scalingMode: manual" in rendered
    assert 'run.googleapis.com/manualInstanceCount: "0"' in rendered
    assert 'value: "false"' in rendered
    assert "value: /var/tmp/vaeroex-document-worker" in rendered
    assert "sizeLimit: 768Mi" in rendered
    assert "name: PORT" not in rendered
    assert "@sha256:" in rendered
    assert 'key: "1"' in rendered
    assert 'key: "2"' in rendered
    assert "DOCUMENT_EXTRACTION_IMAGE_DIGEST" not in rendered


def test_deployed_worker_verifier_accepts_only_expected_inert_configuration(
    tmp_path: Path,
) -> None:
    description = tmp_path / "description.json"
    description.write_text(json.dumps(_description()), encoding="utf-8")
    result = subprocess.run(
        _verifier_arguments(description),
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "gateState": "disabled",
        "immutableImage": True,
        "instances": 0,
        "ok": True,
        "publicEndpoint": False,
        "secretValuesRead": False,
        "workerPool": "vaeroex-document-extraction-preview",
    }


def test_deployed_worker_verifier_rejects_unapproved_environment_scope(
    tmp_path: Path,
) -> None:
    resource = _description()
    resource["template"]["containers"][0]["env"].append(
        {"name": "SUPABASE_SERVICE_ROLE_KEY", "value": "not-a-real-secret"}
    )
    description = tmp_path / "description.json"
    description.write_text(json.dumps(resource), encoding="utf-8")
    result = subprocess.run(
        _verifier_arguments(description),
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "worker_pool_environment_scope_invalid" in result.stderr


def test_signal_summary_never_returns_raw_payloads(tmp_path: Path) -> None:
    logs = tmp_path / "logs.json"
    logs.write_text(
        json.dumps(
            [
                {
                    "severity": "INFO",
                    "jsonPayload": {
                        "event": "worker_ready",
                        "document_text": "must not be returned",
                    },
                }
            ]
        ),
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, str(OPS / "summarize-worker-signals.py"), str(logs)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "must not be returned" not in result.stdout
    assert json.loads(result.stdout)["rawPayloadReturned"] is False


def test_secret_file_verifier_accepts_only_private_owned_regular_files(
    tmp_path: Path,
) -> None:
    secret = tmp_path / "secret"
    secret.write_text("synthetic-value", encoding="ascii")
    secret.chmod(0o600)
    command = [sys.executable, str(OPS / "verify-secret-files.py"), str(secret)]

    accepted = subprocess.run(command, check=False, capture_output=True, text=True)
    assert accepted.returncode == 0
    assert accepted.stdout == ""

    secret.chmod(0o640)
    unsafe_mode = subprocess.run(command, check=False, capture_output=True, text=True)
    assert unsafe_mode.returncode != 0
    assert "secret_file_mode_invalid" in unsafe_mode.stderr

    secret.chmod(0o600)
    link = tmp_path / "secret-link"
    os.symlink(secret, link)
    symlink = subprocess.run(
        [sys.executable, str(OPS / "verify-secret-files.py"), str(link)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert symlink.returncode != 0
    assert "secret_file_type_invalid" in symlink.stderr
