from __future__ import annotations

import base64
import hashlib
import json
import stat
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat

from vaeroex_document_worker import BROKER_PROTOCOL_VERSION
from vaeroex_document_worker.broker import BROKER_PATH, BrokerClient, BrokerFailure
from vaeroex_document_worker.config import WorkerConfig
from vaeroex_document_worker.provider_contract import HOSTED_CONTRACT


def _config(
    private_key: Ed25519PrivateKey,
    *,
    broker_url: str = "https://preview.example.test",
    vercel_share_token: str | None = None,
) -> WorkerConfig:
    return WorkerConfig(
        broker_url=broker_url,
        worker_id="preview-worker-1",
        worker_key_version="worker-key-v1",
        worker_private_key_der=private_key.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption()),
        nvidia_api_key="test-only-placeholder",
        provider_contract=HOSTED_CONTRACT,
        runtime_environment="preview",
        deployment_id="phase-c1-preview-1",
        synthetic_qualification_enabled=False,
        vercel_share_token=vercel_share_token,
    )


def test_broker_requests_are_signed_and_nonces_are_not_reused() -> None:
    private_key = Ed25519PrivateKey.generate()
    observed_nonces: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        body = await request.aread()
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
        async with BrokerClient(_config(private_key), transport=httpx.MockTransport(handler)) as broker:
            await broker.post({"operation": "health"})
            await broker.post({"operation": "health"})

    import asyncio

    asyncio.run(run())
    assert len(observed_nonces) == 2
    assert observed_nonces[0] != observed_nonces[1]


def test_broker_download_writes_private_source_file(tmp_path: Path) -> None:
    private_key = Ed25519PrivateKey.generate()
    destination = tmp_path / "source.bin"

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer file-capability"
        return httpx.Response(200, content=b"bounded-source")

    async def run() -> int:
        async with BrokerClient(_config(private_key), transport=httpx.MockTransport(handler)) as broker:
            return await broker.download("file-capability", destination, expected_bytes=14)

    import asyncio

    assert asyncio.run(run()) == 14
    assert destination.read_bytes() == b"bounded-source"
    assert stat.S_IMODE(destination.stat().st_mode) == 0o600


def test_vercel_share_bootstrap_sets_cookie_only_for_exact_broker_origin() -> None:
    private_key = Ed25519PrivateKey.generate()
    token = "preview-share-token-1234567890"
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            assert request.url.path == "/"
            assert request.url.params.get("_vercel_share") == token
            return httpx.Response(
                302,
                headers={
                    "location": "/",
                    "set-cookie": "_vercel_auth=opaque-cookie; Path=/; Secure; HttpOnly; SameSite=Lax",
                },
            )
        assert request.url.path == BROKER_PATH
        assert request.url.query == b""
        assert token not in str(request.url)
        assert request.headers.get("cookie") == "_vercel_auth=opaque-cookie"
        return httpx.Response(200, json={"ok": True})

    async def run() -> None:
        config = _config(
            private_key,
            broker_url="https://vaeroex-ops-system-abc123-team.vercel.app",
            vercel_share_token=token,
        )
        async with BrokerClient(config, transport=httpx.MockTransport(handler)) as broker:
            await broker.post({"operation": "health"})

    import asyncio

    asyncio.run(run())
    assert [request.method for request in requests] == ["GET", "POST"]


def test_vercel_share_bootstrap_rejects_cross_origin_redirect() -> None:
    private_key = Ed25519PrivateKey.generate()

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            302,
            headers={
                "location": "https://unrelated-preview.vercel.app/",
                "set-cookie": "_vercel_auth=opaque-cookie; Path=/; Secure; HttpOnly",
            },
        )

    async def run() -> None:
        config = _config(
            private_key,
            broker_url="https://vaeroex-ops-system-abc123-team.vercel.app",
            vercel_share_token="preview-share-token-1234567890",
        )
        async with BrokerClient(config, transport=httpx.MockTransport(handler)):
            pass

    import asyncio
    import pytest

    with pytest.raises(BrokerFailure, match="vercel_share_redirect_rejected"):
        asyncio.run(run())


def test_vercel_share_bootstrap_rejects_missing_secure_cookie() -> None:
    private_key = Ed25519PrivateKey.generate()

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "/"})

    async def run() -> None:
        config = _config(
            private_key,
            broker_url="https://vaeroex-ops-system-abc123-team.vercel.app",
            vercel_share_token="preview-share-token-1234567890",
        )
        async with BrokerClient(config, transport=httpx.MockTransport(handler)):
            pass

    import asyncio
    import pytest

    with pytest.raises(BrokerFailure, match="vercel_share_cookie_rejected"):
        asyncio.run(run())
