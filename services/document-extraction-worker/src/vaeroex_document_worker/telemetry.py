"""Privacy-safe structured operational signals for the private worker."""

from __future__ import annotations

import json
import math
import re
import sys
from datetime import UTC, datetime

from .field_path_diagnostic import FieldPathDiagnosticV1
from .response_profile import ResponseProfileDiagnosticV1

_EVENT = re.compile(r"^[a-z0-9._:-]{1,80}$")
_TEXT = re.compile(r"^[A-Za-z0-9._:-]{1,160}$")
_ALLOWED_FIELDS = frozenset(
    {
        "broker_connectivity",
        "circuit_state",
        "cleanup_result",
        "consecutive_failures",
        "cost_rate_version",
        "deployment_version",
        "eligible_documents",
        "eligible_pages",
        "failure_code",
        "latency_ms",
        "nvcf_cleanup_result",
        "pages_dispatched",
        "provider_calls",
        "provider_connectivity",
        "retry_count",
        "runtime_version",
        "status",
    }
)


def _safe_value(value: object) -> str | int | float | bool | None:
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        if not -(2**53) < value < 2**53:
            raise ValueError("operational_telemetry_integer_out_of_bounds")
        return value
    if isinstance(value, float):
        if not math.isfinite(value) or abs(value) >= 2**53:
            raise ValueError("operational_telemetry_number_out_of_bounds")
        return value
    if isinstance(value, str) and _TEXT.fullmatch(value):
        return value
    raise ValueError("operational_telemetry_value_rejected")


def emit_operational_event(
    event: str,
    *,
    severity: str = "INFO",
    **fields: object,
) -> None:
    if not _EVENT.fullmatch(event) or severity not in ("DEBUG", "INFO", "WARNING", "ERROR"):
        raise ValueError("operational_telemetry_event_rejected")
    unknown = set(fields) - _ALLOWED_FIELDS
    if unknown:
        raise ValueError("operational_telemetry_field_rejected")
    payload: dict[str, object] = {
        "event": event,
        "severity": severity,
        "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds"),
    }
    payload.update({name: _safe_value(value) for name, value in fields.items()})
    print(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True),
        file=sys.stdout,
        flush=True,
    )


def emit_response_profile_diagnostic(
    diagnostic: ResponseProfileDiagnosticV1,
) -> None:
    """Emit only the response-profile contract's allowlisted structural fields."""

    print(
        json.dumps(
            diagnostic.privacy_safe_event(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ),
        file=sys.stdout,
        flush=True,
    )


def emit_field_path_diagnostic(
    diagnostic: FieldPathDiagnosticV1,
) -> None:
    """Emit only the field-path contract's bounded structural metadata."""

    print(
        json.dumps(
            diagnostic.privacy_safe_event(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ),
        file=sys.stdout,
        flush=True,
    )
