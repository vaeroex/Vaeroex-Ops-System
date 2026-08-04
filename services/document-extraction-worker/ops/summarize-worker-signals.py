#!/usr/bin/env python3
"""Summarize only privacy-safe worker signals from a Cloud Logging export."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

EVENT = re.compile(r"^[a-z0-9._:-]{1,80}$")
CRITICAL_EVENTS = frozenset(
    {
        "worker_startup_failed",
        "worker_internal_failure",
        "provider_circuit_opened",
        "nvcf_cleanup_failed",
        "temporary_cleanup_failed",
        "lease_starvation",
        "provider_schema_changed",
    }
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("log_file", type=Path)
    arguments = parser.parse_args()
    try:
        records = json.loads(arguments.log_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemExit("worker_signal_export_invalid") from error
    if not isinstance(records, list):
        raise SystemExit("worker_signal_export_invalid")
    events: Counter[str] = Counter()
    severities: Counter[str] = Counter()
    for record in records:
        if not isinstance(record, dict):
            continue
        payload = record.get("jsonPayload")
        if not isinstance(payload, dict):
            continue
        event = payload.get("event")
        if isinstance(event, str) and EVENT.fullmatch(event):
            events[event] += 1
            severity = record.get("severity") or payload.get("severity")
            if severity in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
                severities[str(severity)] += 1
    critical = sum(events[event] for event in CRITICAL_EVENTS) + severities["CRITICAL"]
    result = {
        "ok": critical == 0,
        "eventCounts": dict(sorted(events.items())),
        "severityCounts": dict(sorted(severities.items())),
        "criticalOperatorSignals": critical,
        "rawPayloadReturned": False,
    }
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if critical == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
