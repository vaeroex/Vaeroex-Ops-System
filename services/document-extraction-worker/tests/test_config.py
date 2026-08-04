from __future__ import annotations

import base64

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat

from vaeroex_document_worker.config import (
    CLIENT_REVISION,
    MODEL,
    PARSER_REVISION,
    WorkerConfig,
)
from vaeroex_document_worker.provider_contract import HOSTED_CONTRACT


def environment() -> dict[str, str]:
    key = Ed25519PrivateKey.generate().private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())
    return {
        "DOCUMENT_EXTRACTION_WORKER_ENVIRONMENT": "preview",
        "DOCUMENT_EXTRACTION_WORKER_DEPLOYMENT_ID": "phase-c1-preview-1",
        "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED": "true",
        "DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED": "true",
        "DOCUMENT_EXTRACTION_BROKER_URL": "https://preview-broker.us-west1.run.app",
        "DOCUMENT_EXTRACTION_BROKER_AUDIENCE": "https://preview-broker.us-west1.run.app",
        "DOCUMENT_EXTRACTION_BROKER_AUTH_MODE": "google_oidc_v1",
        "DOCUMENT_EXTRACTION_WORKER_ID": "preview-worker-1",
        "DOCUMENT_EXTRACTION_WORKER_KEY_VERSION": "worker-key-v1",
        "DOCUMENT_EXTRACTION_WORKER_PRIVATE_KEY_PKCS8_BASE64": base64.b64encode(key).decode("ascii"),
        "DOCUMENT_EXTRACTION_NVIDIA_MODEL": MODEL,
        "DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION": CLIENT_REVISION,
        "DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION": PARSER_REVISION,
        "NVIDIA_API_KEY": "test-only-placeholder",
    }


def test_configuration_is_disabled_without_every_gate() -> None:
    values = environment()
    values["DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED"] = "false"
    with pytest.raises(RuntimeError, match="disabled"):
        WorkerConfig.from_environment(values)


def test_preview_authentication_qualification_requires_provider_and_synthetic_gates_closed() -> None:
    values = environment()
    values["DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED"] = "false"
    values["DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED"] = "true"
    config = WorkerConfig.from_environment(values)
    assert config.authentication_qualification_enabled
    assert not config.provider_execution_enabled
    assert not config.synthetic_qualification_enabled

    values["DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED"] = "true"
    with pytest.raises(RuntimeError, match="every provider gate closed"):
        WorkerConfig.from_environment(values)


@pytest.mark.parametrize(
    "name",
    (
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_KEY",
        "SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_ANON_KEY",
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_DB_PASSWORD",
        "DATABASE_URL",
        "POSTGRES_PASSWORD",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "AWS_SHARED_CREDENTIALS_FILE",
        "AWS_CONTAINER_CREDENTIALS_FULL_URI",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "MINIO_ROOT_PASSWORD",
        "OBJECT_STORAGE_SECRET_KEY",
        "AZURE_STORAGE_ACCOUNT_KEY",
        "AZURE_STORAGE_CONNECTION_STRING",
        "AZURE_STORAGE_SAS_TOKEN",
        "AZURE_CLIENT_SECRET",
        "AZURE_FEDERATED_TOKEN_FILE",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON",
        "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        "GOOGLE_SERVICE_ACCOUNT_KEY",
        "GOOGLE_PRIVATE_KEY",
        "VERCEL_BLOB_READ_WRITE_TOKEN",
        "DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON",
        "DOCUMENT_EXTRACTION_ENCRYPTION_CURRENT_KEY_VERSION",
        "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_SECRET",
        "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_KEYS_JSON",
        "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_CURRENT_KEY_VERSION",
        "DOCUMENT_EXTRACTION_WORKER_PUBLIC_KEYS_JSON",
        "DOCUMENT_EXTRACTION_TELEMETRY_HMAC_SECRET",
        "DOCUMENT_EXTRACTION_EXTERNAL_ACCESS_TOKEN",
        "KMS_MASTER_KEY",
        "CACHE_MASTER_KEY",
    ),
)
def test_worker_refuses_database_storage_and_authority_credentials(name: str) -> None:
    secret = "must-not-enter-worker-value"
    values = environment()
    values[name] = secret
    with pytest.raises(RuntimeError) as caught:
        WorkerConfig.from_environment(values)
    message = str(caught.value)
    assert name in message
    assert secret not in message


def test_worker_allows_only_intended_credentials_and_harmless_public_config() -> None:
    values = environment()
    values.update(
        {
            "AWS_REGION": "us-west-2",
            "PUBLIC_STATUS_URL": "https://status.example.test",
            "DOCUMENT_EXTRACTION_PUBLIC_LABEL": "preview-worker",
        }
    )
    config = WorkerConfig.from_environment(values)
    assert config.nvidia_api_key == "test-only-placeholder"
    assert config.provider_contract == HOSTED_CONTRACT
    assert config.worker_private_key_der
    assert config.runtime_environment == "preview"
    assert config.deployment_id == "phase-c1-preview-1"


def test_production_requires_application_owned_approval() -> None:
    values = environment()
    values["DOCUMENT_EXTRACTION_WORKER_ENVIRONMENT"] = "production"
    with pytest.raises(RuntimeError, match="approval"):
        WorkerConfig.from_environment(values)


def test_synthetic_mode_requires_both_additional_non_production_gates() -> None:
    values = environment()
    values["DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED"] = "true"
    assert not WorkerConfig.from_environment(values).synthetic_qualification_enabled
    values["DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED"] = "true"
    config = WorkerConfig.from_environment(values)
    assert config.synthetic_qualification_enabled


def test_broker_requires_google_oidc_and_exact_cloud_run_audience() -> None:
    values = environment()
    values["DOCUMENT_EXTRACTION_BROKER_AUTH_MODE"] = "static_token"
    with pytest.raises(RuntimeError, match="authentication mode"):
        WorkerConfig.from_environment(values)

    values = environment()
    values["DOCUMENT_EXTRACTION_BROKER_AUDIENCE"] = "https://other.run.app"
    with pytest.raises(RuntimeError, match="audience"):
        WorkerConfig.from_environment(values)

    values = environment()
    values["DOCUMENT_EXTRACTION_BROKER_URL"] = "https://preview.example.test"
    values["DOCUMENT_EXTRACTION_BROKER_AUDIENCE"] = "https://preview.example.test"
    with pytest.raises(RuntimeError, match="Cloud Run"):
        WorkerConfig.from_environment(values)
