"""Fail-closed runtime configuration for the private worker."""

from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse

from .provider_contract import (
    HOSTED_ENDPOINT,
    HOSTED_MODEL,
    HOSTED_PARSER_REVISION,
    REST_ADAPTER_VERSION,
    ProviderContract,
    active_provider_contract,
)
from .response_profile import DIAGNOSTIC_CONFIRMATION

CLIENT_REVISION = REST_ADAPTER_VERSION
MODEL = HOSTED_MODEL
PARSER_REVISION = HOSTED_PARSER_REVISION
PRODUCTION_APPROVAL = "document_extraction_production_pilot_v1"
ENDPOINT = HOSTED_ENDPOINT
MAX_FILE_BYTES = 25_000_000
MAX_PAGES = 16
MAX_RENDERED_DIMENSION = 2_048
TIMEOUT_SECONDS = 120
MAX_RETRIES = 1

_IDENTIFIER = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_ALLOWED_WORKER_CREDENTIALS = {
    "DOCUMENT_EXTRACTION_WORKER_PRIVATE_KEY_PKCS8_BASE64",
    "NVIDIA_API_KEY",
}

_FORBIDDEN_WORKER_CREDENTIALS = {
    # The worker has no database or Supabase client. Even public project URLs are
    # rejected so adding a database credential later cannot silently expand scope.
    "SUPABASE_URL": "supabase",
    "NEXT_PUBLIC_SUPABASE_URL": "supabase",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "supabase",
    "SUPABASE_ANON_KEY": "supabase",
    "SUPABASE_PUBLISHABLE_KEY": "supabase",
    "SUPABASE_SERVICE_ROLE_KEY": "supabase",
    "SUPABASE_SERVICE_KEY": "supabase",
    "SUPABASE_SECRET_KEY": "supabase",
    "SUPABASE_DB_URL": "database",
    "SUPABASE_DB_PASSWORD": "database",
    "DATABASE_URL": "database",
    "DATABASE_ADMIN_URL": "database",
    "DIRECT_URL": "database",
    "POSTGRES_URL": "database",
    "POSTGRES_PRISMA_URL": "database",
    "POSTGRES_URL_NON_POOLING": "database",
    "POSTGRES_PASSWORD": "database",
    "PGPASSWORD": "database",
    "DB_PASSWORD": "database",
    "DB_ADMIN_PASSWORD": "database",
    "AWS_ACCESS_KEY_ID": "aws_storage",
    "AWS_SECRET_ACCESS_KEY": "aws_storage",
    "AWS_SESSION_TOKEN": "aws_storage",
    "AWS_SECURITY_TOKEN": "aws_storage",
    "AWS_WEB_IDENTITY_TOKEN_FILE": "aws_storage",
    "AWS_SHARED_CREDENTIALS_FILE": "aws_storage",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI": "aws_storage",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI": "aws_storage",
    "S3_ACCESS_KEY": "s3_storage",
    "S3_ACCESS_KEY_ID": "s3_storage",
    "S3_SECRET_KEY": "s3_storage",
    "S3_SECRET_ACCESS_KEY": "s3_storage",
    "S3_SESSION_TOKEN": "s3_storage",
    "MINIO_ACCESS_KEY": "s3_storage",
    "MINIO_SECRET_KEY": "s3_storage",
    "MINIO_ROOT_USER": "s3_storage",
    "MINIO_ROOT_PASSWORD": "s3_storage",
    "OBJECT_STORAGE_ACCESS_KEY": "object_storage",
    "OBJECT_STORAGE_SECRET_KEY": "object_storage",
    "STORAGE_ACCESS_KEY": "object_storage",
    "STORAGE_SECRET_KEY": "object_storage",
    "AZURE_STORAGE_ACCOUNT_KEY": "azure_storage",
    "AZURE_STORAGE_CONNECTION_STRING": "azure_storage",
    "AZURE_STORAGE_SAS_TOKEN": "azure_storage",
    "AZURE_CLIENT_SECRET": "azure_service",
    "AZURE_CLIENT_CERTIFICATE_PASSWORD": "azure_service",
    "AZURE_FEDERATED_TOKEN_FILE": "azure_service",
    "GOOGLE_APPLICATION_CREDENTIALS": "gcp_storage",
    "GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON": "gcp_storage",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON": "gcp_storage",
    "GOOGLE_SERVICE_ACCOUNT_KEY": "gcp_storage",
    "GCP_SERVICE_ACCOUNT_JSON": "gcp_storage",
    "GCP_CREDENTIALS": "gcp_storage",
    "GOOGLE_PRIVATE_KEY": "gcp_storage",
    "GCS_ACCESS_KEY_ID": "gcp_storage",
    "GCS_SECRET_ACCESS_KEY": "gcp_storage",
    "BLOB_READ_WRITE_TOKEN": "vercel_blob",
    "VERCEL_BLOB_READ_WRITE_TOKEN": "vercel_blob",
    "DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON": "cache_encryption",
    "DOCUMENT_EXTRACTION_ENCRYPTION_CURRENT_KEY_VERSION": "cache_encryption",
    "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_SECRET": "broker_authority",
    "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_KEYS_JSON": "broker_authority",
    "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_CURRENT_KEY_VERSION": "broker_authority",
    "DOCUMENT_EXTRACTION_WORKER_PUBLIC_KEYS_JSON": "broker_authority",
    "DOCUMENT_EXTRACTION_TELEMETRY_HMAC_SECRET": "broker_authority",
    "DOCUMENT_EXTRACTION_WORKER_SIGNING_PRIVATE_KEY": "broker_authority",
    "CACHE_ENCRYPTION_KEY": "cache_encryption",
    "CACHE_MASTER_KEY": "cache_encryption",
    "KMS_MASTER_KEY": "kms_master",
    "KMS_MASTER_KEY_BASE64": "kms_master",
}

_FORBIDDEN_CREDENTIAL_PATTERNS = (
    (re.compile(r"^(?:SUPABASE|POSTGRES|PG|DATABASE|DB)_(?:ADMIN_|SERVICE_|ROOT_)?(?:URL|PASSWORD|SECRET|TOKEN|KEY)$"), "database"),
    (re.compile(r"^(?:AWS|S3|MINIO|OBJECT_STORAGE|STORAGE)_.+(?:ACCESS_KEY|SECRET_KEY|SESSION_TOKEN|CREDENTIALS)$"), "object_storage"),
    (re.compile(r"^AZURE_.+(?:ACCOUNT_KEY|CONNECTION_STRING|SAS_TOKEN|CLIENT_SECRET)$"), "azure_storage"),
    (re.compile(r"^(?:GOOGLE|GCP|GCS)_.+(?:SERVICE_ACCOUNT|APPLICATION_CREDENTIALS|PRIVATE_KEY|SECRET_KEY)$"), "gcp_storage"),
    (re.compile(r"^(?:VERCEL_)?BLOB_.+(?:TOKEN|SECRET|KEY)$"), "vercel_blob"),
    (re.compile(r"^DOCUMENT_EXTRACTION_.+(?:MASTER_KEY|ENCRYPTION_KEY|CAPABILITY_SECRET|SIGNING_PRIVATE_KEY)$"), "document_authority"),
    (re.compile(r"^DOCUMENT_EXTRACTION_.+(?:TOKEN|SECRET|PRIVATE_KEY|CREDENTIALS?)$"), "document_authority"),
)


def _forbidden_credential(environment: dict[str, str]) -> tuple[str, str] | None:
    for name, value in environment.items():
        if not value or name in _ALLOWED_WORKER_CREDENTIALS:
            continue
        category = _FORBIDDEN_WORKER_CREDENTIALS.get(name)
        if category:
            return name, category
        for pattern, pattern_category in _FORBIDDEN_CREDENTIAL_PATTERNS:
            if pattern.fullmatch(name):
                return name, pattern_category
    return None


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
    broker_audience: str
    broker_auth_mode: str
    worker_id: str
    worker_key_version: str
    worker_private_key_der: bytes
    nvidia_api_key: str
    provider_contract: ProviderContract
    runtime_environment: str
    deployment_id: str
    provider_execution_enabled: bool
    authentication_qualification_enabled: bool
    synthetic_qualification_enabled: bool
    response_profile_diagnostic_enabled: bool = False
    health_port: int = 8080
    idle_poll_seconds: float = 5.0

    @classmethod
    def from_environment(cls, source: dict[str, str] | None = None) -> "WorkerConfig":
        environment = dict(os.environ if source is None else source)
        leaked = _forbidden_credential(environment)
        if leaked:
            name, category = leaked
            raise RuntimeError(f"Forbidden private-worker credential: {name} ({category}).")
        if not _enabled(environment.get("DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED")):
            raise RuntimeError("The private document extraction worker is disabled.")
        provider_execution_enabled = _enabled(
            environment.get("DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED")
        )

        runtime_environment = _required(
            environment, "DOCUMENT_EXTRACTION_WORKER_ENVIRONMENT"
        ).lower()
        if runtime_environment not in ("preview", "production"):
            raise RuntimeError("The private-worker environment is not approved.")
        if runtime_environment == "production" and (
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
        if (
            parsed_url.scheme != "https"
            or not parsed_url.netloc
            or parsed_url.path not in ("", "/")
            or parsed_url.params
            or parsed_url.query
            or parsed_url.fragment
            or parsed_url.username
            or parsed_url.password
            or not (parsed_url.hostname or "").lower().endswith(".run.app")
        ):
            raise RuntimeError("The private broker must use an HTTPS Cloud Run origin URL.")
        broker_auth_mode = _required(
            environment, "DOCUMENT_EXTRACTION_BROKER_AUTH_MODE"
        )
        if broker_auth_mode != "google_oidc_v1":
            raise RuntimeError("The private broker authentication mode is not approved.")
        broker_audience = _required(
            environment, "DOCUMENT_EXTRACTION_BROKER_AUDIENCE"
        ).rstrip("/")
        if broker_audience != broker_url:
            raise RuntimeError("The private broker audience must match its exact origin.")
        worker_id = _required(environment, "DOCUMENT_EXTRACTION_WORKER_ID")
        worker_key_version = _required(environment, "DOCUMENT_EXTRACTION_WORKER_KEY_VERSION")
        if not _IDENTIFIER.fullmatch(worker_id) or not _IDENTIFIER.fullmatch(worker_key_version):
            raise RuntimeError("The private worker identity is malformed.")
        deployment_id = _required(environment, "DOCUMENT_EXTRACTION_WORKER_DEPLOYMENT_ID")
        if not _IDENTIFIER.fullmatch(deployment_id):
            raise RuntimeError("The private worker deployment identity is malformed.")
        encoded_private_key = _required(environment, "DOCUMENT_EXTRACTION_WORKER_PRIVATE_KEY_PKCS8_BASE64")
        try:
            private_key = base64.b64decode(encoded_private_key, validate=True)
        except ValueError as error:
            raise RuntimeError("The private worker signing key is malformed.") from error
        if not private_key:
            raise RuntimeError("The private worker signing key is malformed.")

        synthetic_qualification_enabled = (
            runtime_environment == "preview"
            and provider_execution_enabled
            and _enabled(environment.get("DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED"))
            and _enabled(environment.get("DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED"))
        )
        authentication_qualification_enabled = (
            runtime_environment == "preview"
            and _enabled(
                environment.get(
                    "DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED"
                )
            )
        )
        response_profile_diagnostic_enabled = _enabled(
            environment.get(
                "DOCUMENT_EXTRACTION_RESPONSE_PROFILE_DIAGNOSTIC_ENABLED"
            )
        )
        if response_profile_diagnostic_enabled and (
            runtime_environment != "preview"
            or not synthetic_qualification_enabled
            or environment.get(
                "DOCUMENT_EXTRACTION_RESPONSE_PROFILE_DIAGNOSTIC_CONFIRMATION",
                "",
            ).strip()
            != DIAGNOSTIC_CONFIRMATION
        ):
            raise RuntimeError(
                "Response-profile diagnostics require the exact Preview-only synthetic confirmation."
            )
        if authentication_qualification_enabled and (
            provider_execution_enabled
            or synthetic_qualification_enabled
            or _enabled(environment.get("DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED"))
            or _enabled(environment.get("DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED"))
        ):
            raise RuntimeError(
                "Broker authentication qualification requires every provider gate closed."
            )
        if not provider_execution_enabled and not authentication_qualification_enabled:
            raise RuntimeError("Document extraction provider execution is disabled.")
        try:
            health_port = int(environment.get("PORT", "8080"))
            idle_poll_seconds = float(
                environment.get("DOCUMENT_EXTRACTION_IDLE_POLL_SECONDS", "5")
            )
        except ValueError as error:
            raise RuntimeError("The private worker runtime limits are malformed.") from error
        if not 1_024 <= health_port <= 65_535 or not 1 <= idle_poll_seconds <= 60:
            raise RuntimeError("The private worker runtime limits are outside approved bounds.")
        return cls(
            broker_url=broker_url,
            broker_audience=broker_audience,
            broker_auth_mode=broker_auth_mode,
            worker_id=worker_id,
            worker_key_version=worker_key_version,
            worker_private_key_der=private_key,
            nvidia_api_key=_required(environment, "NVIDIA_API_KEY"),
            provider_contract=active_provider_contract(),
            runtime_environment=runtime_environment,
            deployment_id=deployment_id,
            provider_execution_enabled=provider_execution_enabled,
            authentication_qualification_enabled=authentication_qualification_enabled,
            synthetic_qualification_enabled=synthetic_qualification_enabled,
            response_profile_diagnostic_enabled=response_profile_diagnostic_enabled,
            health_port=health_port,
            idle_poll_seconds=idle_poll_seconds,
        )
