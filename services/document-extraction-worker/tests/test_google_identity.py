from __future__ import annotations

import asyncio
import base64
import json

import httpx
import pytest

from vaeroex_document_worker.google_identity import (
    GoogleIdentityFailure,
    GoogleIdentityTokenProvider,
)


def _encode(value: object) -> str:
    encoded = json.dumps(value, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(encoded).rstrip(b"=").decode("ascii")


def _token(*, audience: str, issued_at: int, expires_at: int) -> str:
    return ".".join(
        (
            _encode({"alg": "RS256"}),
            _encode(
                {
                    "iss": "https://accounts.google.com",
                    "sub": "115089995598262472364",
                    "aud": audience,
                    "iat": issued_at,
                    "exp": expires_at,
                }
            ),
            "signature",
        )
    )


def test_google_identity_token_is_memory_cached_and_refreshed_before_expiry() -> None:
    audience = "https://broker.us-west1.run.app"
    clock = [1_000]
    calls = 0

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            text=_token(audience=audience, issued_at=clock[0], expires_at=clock[0] + 120),
            headers={"Metadata-Flavor": "Google"},
        )

    async def run() -> None:
        provider = GoogleIdentityTokenProvider(
            audience,
            transport=httpx.MockTransport(handler),
            clock=lambda: clock[0],
        )
        first = await provider.token()
        assert await provider.token() == first
        assert calls == 1
        clock[0] += 61
        await provider.token()
        assert calls == 2
        await provider.close()

    asyncio.run(run())


@pytest.mark.parametrize(
    ("body", "code"),
    (
        ("malformed", "google_identity_token_malformed"),
        (_token(audience="https://wrong.run.app", issued_at=1_000, expires_at=2_000), "google_identity_token_invalid"),
        (_token(audience="https://broker.run.app", issued_at=900, expires_at=1_020), "google_identity_token_invalid"),
    ),
)
def test_google_identity_fails_closed_for_malformed_wrong_audience_or_expired_token(
    body: str, code: str
) -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=body, headers={"Metadata-Flavor": "Google"})

    async def run() -> None:
        provider = GoogleIdentityTokenProvider(
            "https://broker.run.app",
            transport=httpx.MockTransport(handler),
            clock=lambda: 1_000,
        )
        with pytest.raises(GoogleIdentityFailure, match=code):
            await provider.token()
        await provider.close()

    asyncio.run(run())


def test_google_identity_rejects_non_metadata_response() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="token")

    async def run() -> None:
        provider = GoogleIdentityTokenProvider(
            "https://broker.run.app",
            transport=httpx.MockTransport(handler),
        )
        with pytest.raises(GoogleIdentityFailure, match="google_identity_metadata_untrusted"):
            await provider.token()
        await provider.close()

    asyncio.run(run())
