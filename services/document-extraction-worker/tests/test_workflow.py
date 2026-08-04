from __future__ import annotations

from vaeroex_document_worker.workflow import workflows


def test_workflow_registry_is_deployable_and_platform_retries_are_disabled() -> None:
    assert workflows.namespace == "vaeroexdocumentextractionprivatev1"
    assert len(workflows._workflows) == 1
    assert len(workflows._steps) == 1
    assert next(iter(workflows._steps.values())).max_retries == 0
