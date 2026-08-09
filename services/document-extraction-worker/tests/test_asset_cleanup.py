from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import httpx
import pytest

from vaeroex_document_worker.asset_cleanup import (
    ASSET_ENDPOINT,
    DELETE_CONFIRMATION,
    AssetCleanupFailure,
    cleanup_qualification_assets,
)
from vaeroex_document_worker.rest_adapter import NVCF_ASSET_DESCRIPTION


def test_cleanup_is_dry_run_by_default_and_filters_exact_window() -> None:
    start = datetime(2026, 8, 3, 10, tzinfo=UTC)
    matching_id = str(uuid4())
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            json={
                "assets": [
                    {
                        "assetId": matching_id,
                        "description": NVCF_ASSET_DESCRIPTION,
                        "contentType": "image/png",
                        "createdAt": (start + timedelta(minutes=5)).isoformat(),
                    },
                    {
                        "assetId": str(uuid4()),
                        "description": "unrelated",
                        "contentType": "image/png",
                        "createdAt": (start + timedelta(minutes=5)).isoformat(),
                    },
                ]
            },
        )

    result = cleanup_qualification_assets(
        "not-logged",
        window_start=start,
        window_end=start + timedelta(minutes=30),
        confirmation=None,
        transport=httpx.MockTransport(handler),
    )

    assert result == {"listed": 2, "matched": 1, "deleted": 0, "dryRun": True}
    assert [request.method for request in requests] == ["GET"]
    assert "not-logged" not in repr(result)


def test_confirmed_cleanup_deletes_only_matching_assets() -> None:
    start = datetime(2026, 8, 3, 10, tzinfo=UTC)
    matching_id = str(uuid4())
    methods: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        methods.append(request.method)
        if request.method == "GET":
            return httpx.Response(
                200,
                headers={"content-type": "application/json"},
                json={
                    "assets": [
                        {
                            "assetId": matching_id,
                            "description": NVCF_ASSET_DESCRIPTION,
                            "contentType": "image/png",
                            "createdAt": (start + timedelta(minutes=5)).isoformat(),
                        }
                    ]
                },
            )
        assert str(request.url) == f"{ASSET_ENDPOINT}/{matching_id}"
        return httpx.Response(204)

    result = cleanup_qualification_assets(
        "not-logged",
        window_start=start,
        window_end=start + timedelta(minutes=30),
        confirmation=DELETE_CONFIRMATION,
        transport=httpx.MockTransport(handler),
    )

    assert result["deleted"] == 1
    assert methods == ["GET", "DELETE"]


@pytest.mark.parametrize(
    ("start", "end"),
    (
        (
            datetime(2026, 8, 3, 10, tzinfo=UTC),
            datetime(2026, 8, 3, 9, tzinfo=UTC),
        ),
        (
            datetime(2026, 8, 3, 10, tzinfo=UTC),
            datetime(2026, 8, 3, 13, tzinfo=UTC),
        ),
    ),
)
def test_unbounded_cleanup_window_fails_before_network(
    start: datetime,
    end: datetime,
) -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    with pytest.raises(AssetCleanupFailure, match="nvcf_cleanup_window_invalid"):
        cleanup_qualification_assets(
            "not-logged",
            window_start=start,
            window_end=end,
            confirmation=DELETE_CONFIRMATION,
            transport=httpx.MockTransport(handler),
        )
    assert calls == 0
