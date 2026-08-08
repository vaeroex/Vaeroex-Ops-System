"""Non-public Cloud Run worker-pool startup and liveness probes."""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from . import WORKER_RUNTIME_VERSION


@dataclass(frozen=True)
class HealthSnapshot:
    ready: bool
    live: bool
    busy: bool
    stopping: bool
    broker_connectivity: str
    consecutive_failures: int


class WorkerHealthState:
    def __init__(self, deployment_id: str, stale_after_seconds: float = 360.0) -> None:
        self.deployment_id = deployment_id
        self._stale_after_seconds = stale_after_seconds
        self._lock = threading.Lock()
        self._ready = False
        self._busy = False
        self._stopping = False
        self._broker_connectivity = "unchecked"
        self._consecutive_failures = 0
        self._last_progress = time.monotonic()

    def ready(self) -> None:
        with self._lock:
            self._ready = True
            self._last_progress = time.monotonic()

    def progress(self, *, busy: bool | None = None, broker_connectivity: str | None = None) -> None:
        with self._lock:
            if busy is not None:
                self._busy = busy
            if broker_connectivity is not None:
                if broker_connectivity not in ("healthy", "degraded", "unavailable", "unchecked"):
                    raise ValueError("worker_health_connectivity_invalid")
                self._broker_connectivity = broker_connectivity
            self._last_progress = time.monotonic()

    def failure(self, broker_connectivity: str = "degraded") -> int:
        with self._lock:
            self._consecutive_failures += 1
            self._broker_connectivity = broker_connectivity
            self._last_progress = time.monotonic()
            return self._consecutive_failures

    def success(self) -> None:
        with self._lock:
            self._consecutive_failures = 0
            self._broker_connectivity = "healthy"
            self._last_progress = time.monotonic()

    def stopping(self) -> None:
        with self._lock:
            self._stopping = True
            self._busy = False
            self._last_progress = time.monotonic()

    def snapshot(self) -> HealthSnapshot:
        with self._lock:
            live = not self._stopping and (
                time.monotonic() - self._last_progress <= self._stale_after_seconds
            )
            return HealthSnapshot(
                ready=self._ready,
                live=live,
                busy=self._busy,
                stopping=self._stopping,
                broker_connectivity=self._broker_connectivity,
                consecutive_failures=self._consecutive_failures,
            )


def _handler(state: WorkerHealthState) -> type[BaseHTTPRequestHandler]:
    class HealthHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
            snapshot = state.snapshot()
            if self.path == "/startup":
                ok = snapshot.ready and not snapshot.stopping
            elif self.path == "/health":
                ok = snapshot.ready and snapshot.live
            else:
                self.send_response(404)
                self.end_headers()
                return
            body = json.dumps(
                {
                    "ok": ok,
                    "runtimeVersion": WORKER_RUNTIME_VERSION,
                    "deploymentVersion": state.deployment_id,
                    "busy": snapshot.busy,
                    "stopping": snapshot.stopping,
                    "brokerConnectivity": snapshot.broker_connectivity,
                },
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=True,
            ).encode("utf-8")
            self.send_response(200 if ok else 503)
            self.send_header("content-type", "application/json")
            self.send_header("cache-control", "no-store, max-age=0")
            self.send_header("x-content-type-options", "nosniff")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *_args: Any) -> None:
            return

    return HealthHandler


def start_health_server(state: WorkerHealthState, port: int) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("0.0.0.0", port), _handler(state))
    thread = threading.Thread(
        target=server.serve_forever,
        name="document-extraction-health",
        daemon=True,
    )
    thread.start()
    return server
