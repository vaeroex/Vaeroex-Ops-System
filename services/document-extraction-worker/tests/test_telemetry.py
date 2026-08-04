from __future__ import annotations

import json

import pytest

from vaeroex_document_worker.telemetry import emit_operational_event


def test_operational_telemetry_accepts_only_content_free_fields(capsys: pytest.CaptureFixture[str]) -> None:
    emit_operational_event(
        "job_result",
        deployment_version="phase-c1-preview-1",
        status="needs_review",
        provider_calls=1,
        latency_ms=120,
        cleanup_result="clean",
    )
    payload = json.loads(capsys.readouterr().out)
    assert payload["event"] == "job_result"
    assert payload["deployment_version"] == "phase-c1-preview-1"
    assert "workspace" not in payload
    assert "text" not in payload
    assert "filename" not in payload


def test_operational_telemetry_rejects_raw_or_unknown_fields() -> None:
    with pytest.raises(ValueError, match="field_rejected"):
        emit_operational_event("job_result", document_text="private")
    with pytest.raises(ValueError, match="value_rejected"):
        emit_operational_event("job_result", status="contains customer prose")
