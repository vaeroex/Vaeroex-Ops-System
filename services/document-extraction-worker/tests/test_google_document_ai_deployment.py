from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

WORKER_ROOT = Path(__file__).resolve().parents[1]
OPS = WORKER_ROOT / "ops"
VERIFY = OPS / "verify-google-document-ai-worker-pool.py"
RENDER_MODE = OPS / "render-google-document-ai-worker-mode.py"
IMAGE = (
    "us-west1-docker.pkg.dev/vaeroex-document-worker/"
    "vaeroex-document-workers-preview/document-extraction-worker@sha256:"
    + "a" * 64
)
SERVICE_ACCOUNT = (
    "vaeroex-doc-worker-preview@vaeroex-document-worker.iam.gserviceaccount.com"
)
WORKER_POOL = "vaeroex-document-extraction-preview"
BROKER_URL = (
    "https://vaeroex-doc-broker-pr265-abc1234-626856681952.us-west1.run.app"
)
PROJECT_NUMBER = "626856681952"
PROCESSOR_ID = "948f589143795629"
DEPLOYMENT_ID = "phase-c1-pr265-abc1234-google-v1"
WORKER_KEY_VERSION = "pr265-worker-key-google-v1"


def _environment(mode: str = "disabled") -> list[dict[str, Any]]:
    gate_values = {
        "disabled": ("false", "false", "false", "false", "false", "false"),
        "authentication": ("true", "false", "false", "false", "false", "true"),
        "qualification": ("true", "true", "true", "true", "false", "false"),
        "frozen-corpus": ("true", "true", "true", "true", "true", "false"),
    }[mode]
    values = {
        "DOCUMENT_EXTRACTION_WORKER_ENVIRONMENT": "preview",
        "DOCUMENT_EXTRACTION_WORKER_DEPLOYMENT_ID": DEPLOYMENT_ID,
        "DOCUMENT_EXTRACTION_WORKER_ID": WORKER_POOL,
        "DOCUMENT_EXTRACTION_WORKER_KEY_VERSION": WORKER_KEY_VERSION,
        "DOCUMENT_EXTRACTION_BROKER_URL": BROKER_URL,
        "DOCUMENT_EXTRACTION_BROKER_AUDIENCE": BROKER_URL,
        "DOCUMENT_EXTRACTION_BROKER_AUTH_MODE": "google_oidc_v1",
        "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED": gate_values[0],
        "DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED": gate_values[1],
        "DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED": gate_values[2],
        "DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED": gate_values[3],
        "DOCUMENT_EXTRACTION_GOOGLE_FROZEN_CONTROLLER_ENABLED": gate_values[4],
        "DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED": gate_values[5],
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
    if mode in ("qualification", "frozen-corpus"):
        values["DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL"] = (
            "google_document_ai_preview_qualification_v1"
        )
    if mode == "frozen-corpus":
        values["DOCUMENT_EXTRACTION_GOOGLE_FROZEN_CONTROLLER_CONFIRMATION"] = (
            "google_frozen_corpus_controller_v2"
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


def _v1_description(mode: str = "disabled", instances: int = 0) -> dict[str, Any]:
    environment = _environment(mode)
    secret = environment[-1]
    reference = secret.pop("valueSource")["secretKeyRef"]
    secret["valueFrom"] = {
        "secretKeyRef": {
            "name": reference["secret"],
            "key": reference["version"],
        }
    }
    return {
        "apiVersion": "run.googleapis.com/v1",
        "kind": "WorkerPool",
        "metadata": {
            "name": WORKER_POOL,
            "annotations": {
                "run.googleapis.com/manualInstanceCount": str(instances),
                "run.googleapis.com/scalingMode": "manual",
            },
            "creationTimestamp": "2026-08-06T00:00:00Z",
            "resourceVersion": "server-managed",
        },
        "spec": {
            "template": {
                "spec": {
                    "serviceAccountName": SERVICE_ACCOUNT,
                    "containers": [
                        {
                            "name": "document-extraction-worker",
                            "image": IMAGE,
                            "env": environment,
                            "startupProbe": {
                                "httpGet": {"path": "/startup", "port": 8080}
                            },
                            "livenessProbe": {
                                "httpGet": {"path": "/health", "port": 8080}
                            },
                        }
                    ],
                }
            }
        },
        "status": {"conditions": [{"type": "Ready", "status": "True"}]},
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
            DEPLOYMENT_ID,
            "--worker-id",
            WORKER_POOL,
            "--worker-key-version",
            WORKER_KEY_VERSION,
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
    assert f'value: "{PROJECT_NUMBER}"' in rendered
    assert PROCESSOR_ID in rendered
    assert "NVIDIA_API_KEY" not in rendered
    assert "GOOGLE_APPLICATION_CREDENTIALS" not in rendered
    assert "DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL" not in rendered
    assert "DOCUMENT_EXTRACTION_GOOGLE_PRODUCTION_APPROVAL" not in rendered
    assert "DOCUMENT_EXTRACTION_GOOGLE_FROZEN_CONTROLLER_ENABLED" in rendered


def test_google_verifier_accepts_disabled_authentication_and_qualification(
    tmp_path: Path,
) -> None:
    for mode, instances in (
        ("disabled", 0),
        ("authentication", 1),
        ("qualification", 1),
        ("frozen-corpus", 1),
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


def test_google_verifier_rejects_obsolete_caller_supplied_frozen_bindings(
    tmp_path: Path,
) -> None:
    description = _description("frozen-corpus", 1)
    description["template"]["containers"][0]["env"].append(
        {
            "name": "DOCUMENT_EXTRACTION_GOOGLE_FROZEN_INTAKE_BINDINGS_JSON",
            "value": "[]",
        }
    )
    result = _run_verifier(tmp_path, description, "frozen-corpus", 1)
    assert result.returncode != 0
    assert "worker_pool_environment_scope_invalid" in result.stderr


def test_google_mode_script_has_bounded_confirmations_and_removes_approval() -> None:
    script = (OPS / "set-google-document-ai-preview-worker-mode.sh").read_text(
        encoding="ascii"
    )
    assert "google-document-ai-one-page-one-call-zero-retry" in script
    assert "google-document-ai-frozen-corpus-8-documents-9-pages-zero-retry" in script
    assert "worker-pools replace" in script
    assert "worker-pools update" not in script
    assert "render-google-document-ai-worker-mode.py" in script
    assert "DOCUMENT_EXTRACTION_GOOGLE_PRODUCTION_APPROVAL" not in script
    assert "NVIDIA_API_KEY" not in script


def test_google_mode_renderer_replaces_complete_v1_resource_and_verifies_modes(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.json"
    source.write_text(json.dumps(_v1_description()), encoding="utf-8")
    expected = {
        "disabled": ("0", "false", "false", False),
        "authentication": ("1", "true", "false", False),
        "one-page": ("1", "true", "true", True),
        "frozen-corpus": ("1", "true", "true", True),
    }
    for mode, (instances, private_worker, provider, approval) in expected.items():
        output = tmp_path / f"{mode}.json"
        command = [
            sys.executable,
            str(RENDER_MODE),
            "--description-file",
            str(source),
            "--output",
            str(output),
            "--worker-pool",
            WORKER_POOL,
            "--mode",
            mode,
        ]
        rendered = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
        assert rendered.returncode == 0, rendered.stderr
        manifest = json.loads(output.read_text(encoding="ascii"))
        assert "status" not in manifest
        assert "creationTimestamp" not in manifest["metadata"]
        assert (
            manifest["metadata"]["annotations"][
                "run.googleapis.com/manualInstanceCount"
            ]
            == instances
        )
        environment = {
            item["name"]: item
            for item in manifest["spec"]["template"]["spec"]["containers"][0][
                "env"
            ]
        }
        assert environment["DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED"]["value"] == private_worker
        assert environment["DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED"]["value"] == provider
        assert ("DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL" in environment) is approval
        assert environment[
            "DOCUMENT_EXTRACTION_GOOGLE_FROZEN_CONTROLLER_ENABLED"
        ]["value"] == ("true" if mode == "frozen-corpus" else "false")
        verified = subprocess.run(
            [
                sys.executable,
                str(RENDER_MODE),
                "--description-file",
                str(output),
                "--worker-pool",
                WORKER_POOL,
                "--mode",
                mode,
                "--verify-only",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        assert verified.returncode == 0, verified.stderr


def test_google_mode_renderer_rejects_mixed_or_production_profiles(
    tmp_path: Path,
) -> None:
    for key, value in (
        ("DOCUMENT_EXTRACTION_ACTIVE_PROVIDER_PROFILE", "hosted_tool_call_v2"),
        ("DOCUMENT_EXTRACTION_GOOGLE_PRODUCTION_APPROVAL", "forbidden"),
        ("NVIDIA_API_KEY", "forbidden"),
    ):
        description = _v1_description()
        environment = description["spec"]["template"]["spec"]["containers"][0][
            "env"
        ]
        existing = next((item for item in environment if item["name"] == key), None)
        if existing:
            existing["value"] = value
        else:
            environment.append({"name": key, "value": value})
        source = tmp_path / f"{key}.json"
        output = tmp_path / f"{key}.rendered.json"
        source.write_text(json.dumps(description), encoding="utf-8")
        result = subprocess.run(
            [
                sys.executable,
                str(RENDER_MODE),
                "--description-file",
                str(source),
                "--output",
                str(output),
                "--worker-pool",
                WORKER_POOL,
                "--mode",
                "disabled",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode != 0
