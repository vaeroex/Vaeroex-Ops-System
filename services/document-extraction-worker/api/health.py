"""Authenticated, content-free health endpoint for the separate worker project."""

from __future__ import annotations

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel Python entrypoint contract
    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
        expected = os.environ.get("DOCUMENT_EXTRACTION_WORKER_HEALTH_TOKEN", "")
        observed = self.headers.get("authorization", "")
        if not expected or not hmac.compare_digest(observed, f"Bearer {expected}"):
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(
            {
                "ok": sys.version_info[:2] == (3, 12),
                "runtimeVersion": "document_extraction_worker_v1",
                "python": f"{sys.version_info.major}.{sys.version_info.minor}",
                "workerEnabled": os.environ.get("DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED", "").lower() == "true",
            },
            separators=(",", ":"),
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        # Health requests contain no useful operational content and must not
        # create request-header logs through BaseHTTPRequestHandler.
        return
