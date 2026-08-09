"""Short-lived Google identity tokens for the exact Cloud Run broker audience."""

from __future__ import annotations

import base64
import json
import time
from collections.abc import Callable
from typing import Any

import httpx

METADATA_ORIGIN = "http://metadata.google.internal"
METADATA_IDENTITY_PATH = "/computeMetadata/v1/instance/service-accounts/default/identity"
TOKEN_REFRESH_SKEW_SECONDS = 60
MAX_TOKEN_LIFETIME_SECONDS = 3_700


class GoogleIdentityFailure(RuntimeError):
    """Content-free Google workload identity failure."""


def _decode_payload(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3 or any(not part for part in parts):
        raise GoogleIdentityFailure("google_identity_token_malformed")
    encoded = parts[1]
    try:
        payload = json.loads(
            base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        )
    except (ValueError, json.JSONDecodeError) as error:
        raise GoogleIdentityFailure("google_identity_token_malformed") from error
    if not isinstance(payload, dict):
        raise GoogleIdentityFailure("google_identity_token_malformed")
    return payload


class GoogleIdentityTokenProvider:
    def __init__(
        self,
        audience: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._audience = audience
        self._clock = clock
        self._token: str | None = None
        self._expires_at = 0
        self._client = httpx.AsyncClient(
            base_url=METADATA_ORIGIN,
            timeout=httpx.Timeout(5.0),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    async def close(self) -> None:
        self._token = None
        self._expires_at = 0
        await self._client.aclose()

    async def token(self) -> str:
        now = int(self._clock())
        if self._token is not None and self._expires_at > now + TOKEN_REFRESH_SKEW_SECONDS:
            return self._token
        try:
            response = await self._client.get(
                METADATA_IDENTITY_PATH,
                params={"audience": self._audience, "format": "full"},
                headers={"Metadata-Flavor": "Google", "Accept": "text/plain"},
            )
        except httpx.TimeoutException as error:
            raise GoogleIdentityFailure("google_identity_metadata_timeout") from error
        except httpx.TransportError as error:
            raise GoogleIdentityFailure("google_identity_metadata_transport") from error
        if response.status_code != 200:
            raise GoogleIdentityFailure("google_identity_metadata_rejected")
        if response.headers.get("Metadata-Flavor", "").lower() != "google":
            raise GoogleIdentityFailure("google_identity_metadata_untrusted")
        token = response.text.strip()
        if not token or len(token) > 16_384 or any(character.isspace() for character in token):
            raise GoogleIdentityFailure("google_identity_token_malformed")
        payload = _decode_payload(token)
        audience = payload.get("aud")
        issuer = payload.get("iss")
        subject = payload.get("sub")
        issued_at = payload.get("iat")
        expires_at = payload.get("exp")
        if (
            audience != self._audience
            or issuer not in ("https://accounts.google.com", "accounts.google.com")
            or not isinstance(subject, str)
            or not subject.isdigit()
            or not isinstance(issued_at, int)
            or not isinstance(expires_at, int)
            or issued_at > now + 30
            or expires_at <= now + TOKEN_REFRESH_SKEW_SECONDS
            or expires_at - issued_at > MAX_TOKEN_LIFETIME_SECONDS
        ):
            raise GoogleIdentityFailure("google_identity_token_invalid")
        self._token = token
        self._expires_at = expires_at
        return token
