from __future__ import annotations

import json

import httpx
import pytest

from vaeroex_document_worker.google_access_token import (
    GoogleAccessTokenFailure,
    GoogleMetadataAccessTokenProvider,
)


def test_metadata_access_token_is_memory_only_and_refreshes_before_expiry() -> None:
    clock = [1_000]
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.url == (
            "http://metadata.google.internal/computeMetadata/v1/instance/"
            "service-accounts/default/token"
        )
        assert request.headers["Metadata-Flavor"] == "Google"
        return httpx.Response(
            200,
            json={
                "access_token": f"opaque-token-{calls}",
                "expires_in": 3_600,
                "token_type": "Bearer",
            },
            headers={"Metadata-Flavor": "Google"},
        )

    with GoogleMetadataAccessTokenProvider(
        transport=httpx.MockTransport(handler),
        clock=lambda: clock[0],
    ) as provider:
        first = provider.token()
        assert provider.token() == first
        assert calls == 1
        clock[0] += 3_301
        assert provider.token() != first
        assert calls == 2


@pytest.mark.parametrize(
    "payload",
    (
        {},
        {"access_token": "token", "expires_in": 3_600},
        {"access_token": "token", "expires_in": "3600", "token_type": "Bearer"},
        {"access_token": "token", "expires_in": 3_600, "token_type": "bearer"},
        {"access_token": "token with spaces", "expires_in": 3_600, "token_type": "Bearer"},
        {
            "access_token": "token",
            "expires_in": 3_600,
            "token_type": "Bearer",
            "unexpected": True,
        },
    ),
)
def test_metadata_access_token_rejects_malformed_contract(payload: object) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Metadata-Flavor": "Google",
            },
        )

    with GoogleMetadataAccessTokenProvider(
        transport=httpx.MockTransport(handler)
    ) as provider:
        with pytest.raises(
            GoogleAccessTokenFailure,
            match="google_access_token_metadata_malformed",
        ):
            provider.token()


def test_metadata_access_token_requires_google_metadata_response() -> None:
    secret = "must-never-appear-in-error"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "access_token": secret,
                "expires_in": 3_600,
                "token_type": "Bearer",
            },
        )

    with GoogleMetadataAccessTokenProvider(
        transport=httpx.MockTransport(handler)
    ) as provider:
        with pytest.raises(GoogleAccessTokenFailure) as caught:
            provider.token()
    assert str(caught.value) == "google_access_token_metadata_untrusted"
    assert secret not in str(caught.value)


def test_metadata_access_token_rejects_duplicate_json_keys() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=(
                b'{"access_token":"one","access_token":"two",'
                b'"expires_in":3600,"token_type":"Bearer"}'
            ),
            headers={
                "Content-Type": "application/json",
                "Metadata-Flavor": "Google",
            },
        )

    with GoogleMetadataAccessTokenProvider(
        transport=httpx.MockTransport(handler)
    ) as provider:
        with pytest.raises(
            GoogleAccessTokenFailure,
            match="google_access_token_metadata_malformed",
        ):
            provider.token()
