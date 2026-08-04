"""Content-free provider failures and normalized in-memory result types."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ProviderFailure(RuntimeError):
    def __init__(
        self,
        code: str,
        result_class: str,
        *,
        retryable: bool,
        ambiguous: bool = False,
        completed_pages: tuple[dict[str, Any], ...] = (),
    ) -> None:
        super().__init__(code)
        self.code = code
        self.result_class = result_class
        self.retryable = retryable
        self.ambiguous = ambiguous
        self.completed_pages = completed_pages


@dataclass(frozen=True)
class RenderedPage:
    page: int
    path: Path
    mime_type: str
    width: int
    height: int
    byte_length: int
    content_sha256: str


@dataclass(frozen=True)
class ProviderResult:
    pages: list[dict[str, Any]]
    latency_ms: int
    request_contract_hashes: tuple[str, ...]
    payload_modes: tuple[str, ...]
