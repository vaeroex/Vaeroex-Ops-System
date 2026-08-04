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
from vaeroex_document_worker.broker import BROKER_PATH, BrokerClient
from vaeroex_document_worker.config import WorkerConfig
from vaeroex_document_worker.provider_contract import HOSTED_CONTRACT


def _config(private_key: Ed25519PrivateKey) -> WorkerConfig:
    return WorkerConfig(
        broker_url="https://preview.example.test",
        worker_id="preview-worker-1",
        worker_key_version="worker-key-v1",
        worker_private_key_der=private_key.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption()),
        nvidia_api_key="test-only-placeholder",
        provider_contract=HOSTED_CONTRACT,
        runtime_environment="preview",
        deployment_id="phase-c1-preview-1",
        synthetic_qualification_enabled=False,
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
