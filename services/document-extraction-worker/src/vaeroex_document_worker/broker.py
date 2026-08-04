"""Authenticated, replay-resistant client for the narrow Vaeroex broker."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import load_der_private_key

from . import BROKER_PROTOCOL_VERSION
from .config import MAX_FILE_BYTES, WorkerConfig

BROKER_PATH = "/api/internal/document-extraction/broker"


class BrokerFailure(RuntimeError):
    """Content-free broker failure."""

    def __init__(self, code: str, status_code: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class BrokerClient:
    def __init__(self, config: WorkerConfig, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._config = config
        private_key = load_der_private_key(config.worker_private_key_der, password=None)
        if not isinstance(private_key, Ed25519PrivateKey):
            raise RuntimeError("The private worker signing key is not Ed25519.")
        self._private_key = private_key
        self._client = httpx.AsyncClient(
            base_url=config.broker_url,
            timeout=httpx.Timeout(30.0),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    async def __aenter__(self) -> "BrokerClient":
        if self._config.vercel_share_token is not None:
            await self._bootstrap_vercel_share()
        return self

    async def __aexit__(self, *_: object) -> None:
        self._client.cookies.clear()
        await self._client.aclose()

    async def _bootstrap_vercel_share(self) -> None:
        token = self._config.vercel_share_token
        if token is None:
            return
        try:
            response = await self._client.get(
                "/",
                params={"_vercel_share": token},
                headers={"accept": "text/html"},
            )
        except httpx.TimeoutException as error:
            raise BrokerFailure("vercel_share_timeout") from error
        except httpx.TransportError as error:
            raise BrokerFailure("vercel_share_transport") from error
        if response.status_code not in (200, 301, 302, 303, 307, 308):
            raise BrokerFailure("vercel_share_rejected", response.status_code)
        location = response.headers.get("location")
        if location:
            target = urlparse(urljoin(str(response.request.url), location))
            expected = urlparse(self._config.broker_url)
            if (
                target.scheme != expected.scheme
                or target.hostname != expected.hostname
                or target.port != expected.port
                or token in location
            ):
                raise BrokerFailure("vercel_share_redirect_rejected")
        expected_hostname = (urlparse(self._config.broker_url).hostname or "").lower()
        cookies = tuple(self._client.cookies.jar)
        if not cookies or any(
            not cookie.secure
            or not (
                expected_hostname == cookie.domain.lstrip(".").lower()
                or expected_hostname.endswith(
                    "." + cookie.domain.lstrip(".").lower()
                )
            )
            for cookie in cookies
        ):
            self._client.cookies.clear()
            raise BrokerFailure("vercel_share_cookie_rejected")

    def _headers(self, method: str, target: str, body: bytes) -> dict[str, str]:
        timestamp = str(int(time.time()))
        nonce = secrets.token_hex(16)
        body_digest = hashlib.sha256(body).hexdigest()
        canonical = "\n".join(
            (
                BROKER_PROTOCOL_VERSION,
                method.upper(),
                target,
                body_digest,
                self._config.worker_id,
                self._config.worker_key_version,
                self._config.runtime_environment,
                self._config.deployment_id,
                timestamp,
                nonce,
            )
        ).encode("utf-8")
        signature = base64.b64encode(self._private_key.sign(canonical)).decode("ascii")
        return {
            "x-vaeroex-broker-protocol": BROKER_PROTOCOL_VERSION,
            "x-vaeroex-worker-id": self._config.worker_id,
            "x-vaeroex-worker-key-version": self._config.worker_key_version,
            "x-vaeroex-worker-environment": self._config.runtime_environment,
            "x-vaeroex-worker-deployment-id": self._config.deployment_id,
            "x-vaeroex-worker-timestamp": timestamp,
            "x-vaeroex-worker-nonce": nonce,
            "x-vaeroex-worker-signature": signature,
        }

    async def post(self, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        headers = self._headers("POST", BROKER_PATH, body)
        headers["content-type"] = "application/json"
        try:
            response = await self._client.post(BROKER_PATH, content=body, headers=headers)
        except httpx.TimeoutException as error:
            raise BrokerFailure("broker_timeout") from error
        except httpx.TransportError as error:
            raise BrokerFailure("broker_transport") from error
        if response.status_code != 200:
            raise BrokerFailure("broker_request_rejected", response.status_code)
        try:
            value = response.json()
        except ValueError as error:
            raise BrokerFailure("broker_response_invalid", response.status_code) from error
        if not isinstance(value, dict):
            raise BrokerFailure("broker_response_invalid", response.status_code)
        return value

    async def download(self, file_capability: str, destination: Path, expected_bytes: int | None = None) -> int:
        headers = self._headers("GET", BROKER_PATH, b"")
        headers["authorization"] = f"Bearer {file_capability}"
        total = 0
        try:
            async with self._client.stream("GET", BROKER_PATH, headers=headers) as response:
                if response.status_code != 200:
                    raise BrokerFailure("file_access_rejected", response.status_code)
                with destination.open("xb") as output:
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > MAX_FILE_BYTES:
                            raise BrokerFailure("file_size_limit_exceeded")
                        output.write(chunk)
        except httpx.TimeoutException as error:
            destination.unlink(missing_ok=True)
            raise BrokerFailure("file_access_timeout") from error
        except httpx.TransportError as error:
            destination.unlink(missing_ok=True)
            raise BrokerFailure("file_access_transport") from error
        except BrokerFailure:
            destination.unlink(missing_ok=True)
            raise
        if total <= 0 or (expected_bytes is not None and total != expected_bytes):
            destination.unlink(missing_ok=True)
            raise BrokerFailure("file_size_mismatch")
        os.chmod(destination, 0o600)
        return total
