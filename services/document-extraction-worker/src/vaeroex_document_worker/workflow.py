"""Durable Vercel Workflow registration for one bounded private-worker run."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, cast

from vercel.workflow import Workflows

from .runner import run_one_job

workflows = Workflows(namespace="vaeroexdocumentextractionprivatev1")


@workflows.step(max_retries=0)  # type: ignore[misc]
async def execute_one_claimed_job() -> dict[str, Any]:
    result = await run_one_job()
    return asdict(result)


@workflows.workflow  # type: ignore[misc]
async def document_extraction_worker_once() -> dict[str, Any]:
    # A run handles at most one durable database claim. It never polls forever,
    # so concurrency is controlled by the Phase A workspace claim plus the
    # deployment's Workflow concurrency setting.
    return cast(dict[str, Any], await execute_one_claimed_job())
