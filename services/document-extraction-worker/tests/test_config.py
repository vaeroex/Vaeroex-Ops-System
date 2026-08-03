from __future__ import annotations

import base64

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat

from vaeroex_document_worker.config import CLIENT_REVISION, MODEL, PARSER_REVISION, WorkerConfig


def environment() -> dict[str, str]:
    key = Ed25519PrivateKey.generate().private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())
    return {
        "VERCEL_ENV": "preview",
        "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED": "true",
        "DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED": "true",
        "DOCUMENT_EXTRACTION_BROKER_URL": "https://preview.example.test",
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


def test_worker_refuses_database_and_encryption_authority_secrets() -> None:
    for name in (
        "SUPABASE_SERVICE_ROLE_KEY",
        "DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON",
        "DOCUMENT_EXTRACTION_ENCRYPTION_CURRENT_KEY_VERSION",
    ):
        values = environment()
        values[name] = "must-not-enter-worker"
        with pytest.raises(RuntimeError, match="forbidden"):
            WorkerConfig.from_environment(values)


def test_production_requires_application_owned_approval() -> None:
    values = environment()
    values["VERCEL_ENV"] = "production"
    with pytest.raises(RuntimeError, match="approval"):
        WorkerConfig.from_environment(values)


def test_synthetic_mode_requires_both_additional_non_production_gates() -> None:
    values = environment()
    values["DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED"] = "true"
    assert not WorkerConfig.from_environment(values).synthetic_qualification_enabled
    values["DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED"] = "true"
    assert WorkerConfig.from_environment(values).synthetic_qualification_enabled
