"""Fail-closed runtime configuration for the private worker."""

from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse

CLIENT_REVISION = "52886112cafab4c4bca1cda0d4f588785adfe4d3"
MODEL = "nvidia/nemotron-parse"
PARSER_REVISION = "nemo_retriever_multimodal_extraction_v1"
PRODUCTION_APPROVAL = "document_extraction_production_pilot_v1"
ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions"
MAX_FILE_BYTES = 25_000_000
MAX_PAGES = 16
MAX_RENDERED_DIMENSION = 2_400
TIMEOUT_SECONDS = 120
MAX_RETRIES = 1

_IDENTIFIER = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_FORBIDDEN_WORKER_SECRETS = (
    "SUPABASE_SERVICE_ROLE_KEY",
    "DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON",
    "DOCUMENT_EXTRACTION_ENCRYPTION_CURRENT_KEY_VERSION",
)


def _enabled(value: str | None) -> bool:
    return bool(value and value.strip().lower() == "true")


def _required(environment: dict[str, str], name: str) -> str:
    value = environment.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required private-worker setting: {name}.")
    return value


@dataclass(frozen=True)
class WorkerConfig:
    broker_url: str
    worker_id: str
    worker_key_version: str
    worker_private_key_der: bytes
    nvidia_api_key: str
    vercel_environment: str
    synthetic_qualification_enabled: bool

    @classmethod
    def from_environment(cls, source: dict[str, str] | None = None) -> "WorkerConfig":
        environment = dict(os.environ if source is None else source)
        leaked = [name for name in _FORBIDDEN_WORKER_SECRETS if environment.get(name)]
        if leaked:
            raise RuntimeError("The private worker was given a forbidden Vaeroex authority secret.")
        if not _enabled(environment.get("DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED")):
            raise RuntimeError("The private document extraction worker is disabled.")
        if not _enabled(environment.get("DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED")):
            raise RuntimeError("Document extraction provider execution is disabled.")

        vercel_environment = environment.get("VERCEL_ENV", "development").strip().lower()
        if vercel_environment == "production" and (
            environment.get("DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL", "").strip()
            != PRODUCTION_APPROVAL
        ):
            raise RuntimeError("Production document extraction approval is absent.")
        if environment.get("DOCUMENT_EXTRACTION_NVIDIA_MODEL", "").strip() != MODEL:
            raise RuntimeError("The configured NVIDIA model is not approved.")
        if environment.get("DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION", "").strip() != CLIENT_REVISION:
            raise RuntimeError("The configured NVIDIA client revision is not approved.")
        if environment.get("DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION", "").strip() != PARSER_REVISION:
            raise RuntimeError("The configured NVIDIA parser revision is not approved.")

        broker_url = _required(environment, "DOCUMENT_EXTRACTION_BROKER_URL").rstrip("/")
        parsed_url = urlparse(broker_url)
        if parsed_url.scheme != "https" or not parsed_url.netloc or parsed_url.path not in ("", "/"):
            raise RuntimeError("The private broker must use an HTTPS origin URL.")
        worker_id = _required(environment, "DOCUMENT_EXTRACTION_WORKER_ID")
        worker_key_version = _required(environment, "DOCUMENT_EXTRACTION_WORKER_KEY_VERSION")
        if not _IDENTIFIER.fullmatch(worker_id) or not _IDENTIFIER.fullmatch(worker_key_version):
            raise RuntimeError("The private worker identity is malformed.")
        encoded_private_key = _required(environment, "DOCUMENT_EXTRACTION_WORKER_PRIVATE_KEY_PKCS8_BASE64")
        try:
            private_key = base64.b64decode(encoded_private_key, validate=True)
        except ValueError as error:
            raise RuntimeError("The private worker signing key is malformed.") from error
        if not private_key:
            raise RuntimeError("The private worker signing key is malformed.")

        synthetic_qualification_enabled = (
            vercel_environment != "production"
            and _enabled(environment.get("DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED"))
            and _enabled(environment.get("DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED"))
        )
        return cls(
            broker_url=broker_url,
            worker_id=worker_id,
            worker_key_version=worker_key_version,
            worker_private_key_der=private_key,
            nvidia_api_key=_required(environment, "NVIDIA_API_KEY"),
            vercel_environment=vercel_environment,
            synthetic_qualification_enabled=synthetic_qualification_enabled,
        )
