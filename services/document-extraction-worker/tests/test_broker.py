from __future__ import annotations

import base64
import hashlib
import json
import stat
import time
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat

from vaeroex_document_worker import BROKER_PROTOCOL_VERSION
from vaeroex_document_worker.broker import BROKER_PATH, BrokerClient
from vaeroex_document_worker.config import WorkerConfig
from vaeroex_document_worker.provider_contract import HOSTED_CONTRACT


def _encode(value: object) -> str:
    encoded = json.dumps(value, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(encoded).rstrip(b"=").decode("ascii")


def _identity_token(audience: str) -> str:
    now = int(time.time())
    return ".".join(
        (
            _encode({"alg": "RS256", "typ": "JWT"}),
            _encode(
                {
                    "iss": "https://accounts.google.com",
                    "sub": "115089995598262472364",
                    "aud": audience,
                    "iat": now,
                    "exp": now + 3_600,
                }
            ),
            "test-signature",
        )
    )


def _config(private_key: Ed25519PrivateKey) -> WorkerConfig:
    broker_url = "https://preview-broker-abc123.us-west1.run.app"
    return WorkerConfig(
        broker_url=broker_url,
        broker_audience=broker_url,
        broker_auth_mode="google_oidc_v1",
        worker_id="preview-worker-1",
        worker_key_version="worker-key-v1",
        worker_private_key_der=private_key.private_bytes(
            Encoding.DER, PrivateFormat.PKCS8, NoEncryption()
        ),
        nvidia_api_key="test-only-placeholder",
        provider_contract=HOSTED_CONTRACT,
        runtime_environment="preview",
        deployment_id="phase-c1-preview-1",
        provider_execution_enabled=True,
        authentication_qualification_enabled=False,
        synthetic_qualification_enabled=False,
    )


def _identity_transport(audience: str, calls: list[httpx.Request]) -> httpx.MockTransport:
    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert request.url.scheme == "http"
        assert request.url.host == "metadata.google.internal"
        assert request.url.params["audience"] == audience
        assert request.url.params["format"] == "full"
        assert request.headers["metadata-flavor"] == "Google"
        return httpx.Response(
            200,
            text=_identity_token(audience),
            headers={"Metadata-Flavor": "Google"},
        )

    return httpx.MockTransport(handler)


def test_broker_requests_require_google_identity_and_ed25519_without_reusing_nonces() -> None:
    private_key = Ed25519PrivateKey.generate()
    config = _config(private_key)
    observed_nonces: list[str] = []
    metadata_calls: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        body = await request.aread()
        assert request.headers["x-serverless-authorization"] == (
            f"Bearer {_identity_token(config.broker_audience)}"
        )
        timestamp = request.headers["x-vaeroex-worker-timestamp"]
        nonce = request.headers["x-vaeroex-worker-nonce"]
        observed_nonces.append(nonce)
        canonical = "\n".join(
            (
                BROKER_PROTOCOL_VERSION,
                request.method,
                BROKER_PATH,
                hashlib.sha256(body).hexdigest(),
                "preview-worker-1",
                "worker-key-v1",
                "preview",
                "phase-c1-preview-1",
                timestamp,
                nonce,
            )
        ).encode("utf-8")
        private_key.public_key().verify(
            base64.b64decode(request.headers["x-vaeroex-worker-signature"], validate=True),
            canonical,
        )
        assert json.loads(body) == {"operation": "health"}
        return httpx.Response(200, json={"ok": True})

    async def run() -> None:
        async with BrokerClient(
            config,
            transport=httpx.MockTransport(handler),
            identity_transport=_identity_transport(config.broker_audience, metadata_calls),
        ) as broker:
            await broker.post({"operation": "health"})
            await broker.post({"operation": "health"})

    import asyncio

    asyncio.run(run())
    assert len(metadata_calls) == 1
    assert len(observed_nonces) == 2
    assert observed_nonces[0] != observed_nonces[1]


def test_broker_download_keeps_google_identity_separate_from_file_capability(tmp_path: Path) -> None:
    private_key = Ed25519PrivateKey.generate()
    config = _config(private_key)
    destination = tmp_path / "source.bin"
    metadata_calls: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer file-capability"
        assert request.headers["x-serverless-authorization"].startswith("Bearer ey")
        return httpx.Response(200, content=b"bounded-source")

    async def run() -> int:
        async with BrokerClient(
            config,
            transport=httpx.MockTransport(handler),
            identity_transport=_identity_transport(config.broker_audience, metadata_calls),
        ) as broker:
            return await broker.download("file-capability", destination, expected_bytes=14)

    import asyncio

    assert asyncio.run(run()) == 14
    assert len(metadata_calls) == 1
    assert destination.read_bytes() == b"bounded-source"
    assert stat.S_IMODE(destination.stat().st_mode) == 0o600
