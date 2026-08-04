"""Bounded operator cleanup for deprecated NVCF qualification assets."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

from .rest_adapter import NVCF_ASSET_DESCRIPTION

ASSET_ENDPOINT = "https://api.nvcf.nvidia.com/v2/nvcf/assets"
MAX_LIST_RESPONSE_BYTES = 1_000_000
MAX_ASSETS = 1_000
MAX_CLEANUP_WINDOW = timedelta(hours=2)
DELETE_CONFIRMATION = "delete-preview-qualification-assets"


class AssetCleanupFailure(RuntimeError):
    """A content-free asset cleanup error."""


def _timestamp(value: object) -> datetime:
    if not isinstance(value, str) or len(value) > 40:
        raise AssetCleanupFailure("nvcf_asset_timestamp_invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise AssetCleanupFailure("nvcf_asset_timestamp_invalid") from error
    if parsed.tzinfo is None:
        raise AssetCleanupFailure("nvcf_asset_timestamp_invalid")
    return parsed.astimezone(UTC)


def _strict_json(content: bytes) -> dict[str, Any]:
    if len(content) > MAX_LIST_RESPONSE_BYTES:
        raise AssetCleanupFailure("nvcf_asset_list_oversized")

    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate_key")
            value[key] = item
        return value

    try:
        result = json.loads(content, object_pairs_hook=unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise AssetCleanupFailure("nvcf_asset_list_invalid") from error
    if not isinstance(result, dict):
        raise AssetCleanupFailure("nvcf_asset_list_invalid")
    return result


def cleanup_qualification_assets(
    api_key: str,
    *,
    window_start: datetime,
    window_end: datetime,
    confirmation: str | None,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, int | bool]:
    start = window_start.astimezone(UTC)
    end = window_end.astimezone(UTC)
    if not api_key or end <= start or end - start > MAX_CLEANUP_WINDOW:
        raise AssetCleanupFailure("nvcf_cleanup_window_invalid")
    delete = confirmation == DELETE_CONFIRMATION
    headers = {"authorization": f"Bearer {api_key}", "accept": "application/json"}
    selected: list[str] = []
    with httpx.Client(
        timeout=httpx.Timeout(connect=10, read=30, write=10, pool=10),
        follow_redirects=False,
        trust_env=False,
        transport=transport,
    ) as client:
        response = client.get(ASSET_ENDPOINT, headers=headers)
        if response.status_code != 200 or response.headers.get("content-type", "").split(";", 1)[0] != "application/json":
            raise AssetCleanupFailure("nvcf_asset_list_failed")
        payload = _strict_json(response.content)
        assets = payload.get("assets")
        if not isinstance(assets, list) or len(assets) > MAX_ASSETS:
            raise AssetCleanupFailure("nvcf_asset_list_invalid")
        for asset in assets:
            if not isinstance(asset, dict):
                raise AssetCleanupFailure("nvcf_asset_list_invalid")
            if (
                asset.get("description") != NVCF_ASSET_DESCRIPTION
                or asset.get("contentType") != "image/png"
            ):
                continue
            created_at = _timestamp(asset.get("createdAt"))
            if not start <= created_at <= end:
                continue
            try:
                asset_id = str(uuid.UUID(str(asset.get("assetId"))))
            except ValueError as error:
                raise AssetCleanupFailure("nvcf_asset_identity_invalid") from error
            selected.append(asset_id)
        if delete:
            for asset_id in selected:
                deleted = client.delete(f"{ASSET_ENDPOINT}/{asset_id}", headers=headers)
                if deleted.status_code != 204:
                    raise AssetCleanupFailure("nvcf_asset_cleanup_failed")
    return {"listed": len(assets), "matched": len(selected), "deleted": len(selected) if delete else 0, "dryRun": not delete}


def cleanup_from_files(
    key_file: Path,
    *,
    window_start: str,
    window_end: str,
    confirmation: str | None,
) -> dict[str, int | bool]:
    try:
        api_key = key_file.read_text(encoding="ascii").strip()
    except OSError as error:
        raise AssetCleanupFailure("nvcf_credential_unavailable") from error
    if not api_key or len(api_key) > 4_096:
        raise AssetCleanupFailure("nvcf_credential_invalid")
    return cleanup_qualification_assets(
        api_key,
        window_start=_timestamp(window_start),
        window_end=_timestamp(window_end),
        confirmation=confirmation,
    )
