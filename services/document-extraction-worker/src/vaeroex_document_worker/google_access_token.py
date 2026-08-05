"""Short-lived Google OAuth tokens from the Cloud Run metadata service only."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any

import httpx

METADATA_ORIGIN = "http://metadata.google.internal"
METADATA_ACCESS_TOKEN_PATH = (
    "/computeMetadata/v1/instance/service-accounts/default/token"
)
TOKEN_REFRESH_SKEW_SECONDS = 300
MAX_TOKEN_LIFETIME_SECONDS = 3_700


class GoogleAccessTokenFailure(RuntimeError):
    """Content-free workload-identity access-token failure."""


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate_json_key")
        value[key] = item
    return value


def _reject_constant(_value: str) -> None:
    raise ValueError("non_finite_json_number")


class GoogleMetadataAccessTokenProvider:
    """Memory-only token cache; no key file or SDK credential chain is used."""

    def __init__(
        self,
        *,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._clock = clock
        self._token: str | None = None
        self._expires_at = 0
        self._client = httpx.Client(
            base_url=METADATA_ORIGIN,
            timeout=httpx.Timeout(5.0),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    def __enter__(self) -> "GoogleMetadataAccessTokenProvider":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        self._token = None
        self._expires_at = 0
        self._client.close()

    def token(self) -> str:
        now = int(self._clock())
        if self._token is not None and self._expires_at > now + TOKEN_REFRESH_SKEW_SECONDS:
            return self._token
        try:
            response = self._client.get(
                METADATA_ACCESS_TOKEN_PATH,
                headers={"Metadata-Flavor": "Google", "Accept": "application/json"},
            )
        except httpx.TimeoutException as error:
            raise GoogleAccessTokenFailure("google_access_token_metadata_timeout") from error
        except httpx.TransportError as error:
            raise GoogleAccessTokenFailure("google_access_token_metadata_transport") from error
        if response.status_code != 200:
            raise GoogleAccessTokenFailure("google_access_token_metadata_rejected")
        if response.headers.get("Metadata-Flavor", "").lower() != "google":
            raise GoogleAccessTokenFailure("google_access_token_metadata_untrusted")
        if response.headers.get("content-type", "").split(";", 1)[0].strip().lower() not in (
            "",
            "application/json",
        ):
            raise GoogleAccessTokenFailure("google_access_token_metadata_malformed")
        try:
            payload = json.loads(
                response.content,
                object_pairs_hook=_unique_object,
                parse_constant=_reject_constant,
            )
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            raise GoogleAccessTokenFailure("google_access_token_metadata_malformed") from error
        if not isinstance(payload, dict) or set(payload) != {
            "access_token",
            "expires_in",
            "token_type",
        }:
            raise GoogleAccessTokenFailure("google_access_token_metadata_malformed")
        token = payload.get("access_token")
        expires_in = payload.get("expires_in")
        if (
            not isinstance(token, str)
            or not token
            or len(token) > 16_384
            or any(character.isspace() for character in token)
            or payload.get("token_type") != "Bearer"
            or type(expires_in) is not int
            or not TOKEN_REFRESH_SKEW_SECONDS < expires_in <= MAX_TOKEN_LIFETIME_SECONDS
        ):
            raise GoogleAccessTokenFailure("google_access_token_metadata_malformed")
        self._token = token
        self._expires_at = now + expires_in
        return token
