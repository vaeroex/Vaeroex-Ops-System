from __future__ import annotations

import json
import urllib.error
import urllib.request

from vaeroex_document_worker.health import WorkerHealthState, start_health_server


def _get(port: int, path: str) -> tuple[int, dict[str, object]]:
    try:
        response = urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2)
    except urllib.error.HTTPError as error:
        body = error.read()
        return error.code, json.loads(body) if body else {}
    with response:
        return response.status, json.loads(response.read())


def test_health_probe_is_content_free_and_tracks_readiness() -> None:
    state = WorkerHealthState("phase-c1-preview-1")
    server = start_health_server(state, 0)
    try:
        port = server.server_address[1]
        assert _get(port, "/startup")[0] == 503
        state.success()
        state.ready()
        status, payload = _get(port, "/startup")
        assert status == 200
        assert payload == {
            "brokerConnectivity": "healthy",
            "busy": False,
            "deploymentVersion": "phase-c1-preview-1",
            "ok": True,
            "runtimeVersion": "document_extraction_worker_v2",
            "stopping": False,
        }
        assert _get(port, "/not-public")[0] == 404
        serialized = json.dumps(payload)
        for forbidden in ("workspace", "filename", "customer", "secret", "token", "asset_id"):
            assert forbidden not in serialized.lower()
    finally:
        server.shutdown()
        server.server_close()
