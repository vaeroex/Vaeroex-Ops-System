"""Pinned, inert Google Document AI Enterprise OCR contract."""

from __future__ import annotations

import re
from dataclasses import dataclass

GOOGLE_DOCUMENT_AI_PROVIDER = "google_document_ai"
GOOGLE_DOCUMENT_AI_ADAPTER_VERSION = "vaeroex_google_document_ai_rest_v1"
GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE = "google_document_ai_enterprise_ocr_v1"
GOOGLE_DOCUMENT_AI_API_VERSION = "v1"
GOOGLE_DOCUMENT_AI_PROCESSOR_TYPE = "OCR_PROCESSOR"
GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION = "pretrained-ocr-v2.1-2024-08-07"
GOOGLE_DOCUMENT_AI_ENDPOINT_CONTRACT_VERSION = (
    "google_document_ai_processor_version_process_v1"
)
GOOGLE_DOCUMENT_AI_REQUEST_SERIALIZER_VERSION = "google_document_ai_process_request_v1"
GOOGLE_DOCUMENT_AI_RESPONSE_VALIDATOR_VERSION = "google_document_ai_process_response_v2"
GOOGLE_DOCUMENT_AI_NORMALIZATION_VERSION = "google_document_ai_layout_normalization_v2"
GOOGLE_DOCUMENT_AI_COORDINATE_CONTRACT_VERSION = "normalized_vertices_unit_interval_v1"
GOOGLE_DOCUMENT_AI_TIMEOUT_POLICY_VERSION = "connect_10_read_120_write_30_no_retry_v1"
GOOGLE_DOCUMENT_AI_COMPATIBILITY_POLICY_VERSION = (
    "google_document_ai_enterprise_ocr_strict_v1"
)
GOOGLE_DOCUMENT_AI_TABLE_POLICY_VERSION = "tables_if_present_strict_v1"
GOOGLE_DOCUMENT_AI_CONFIDENCE_POLICY_VERSION = (
    "preserve_for_review_never_authority_v1"
)
GOOGLE_DOCUMENT_AI_SELECTION_MARK_POLICY_VERSION = "disabled_v1"
GOOGLE_DOCUMENT_AI_ARTIFACT_CONTRACT_VERSION = "document_extraction_artifact_v2"
GOOGLE_DOCUMENT_AI_ARTIFACT_NORMALIZATION_VERSION = (
    "document_extraction_normalization_v2"
)
GOOGLE_DOCUMENT_AI_ROUTING_POLICY_VERSION = "document_extraction_routing_v1"
GOOGLE_DOCUMENT_AI_REVIEW_PROVENANCE_VERSION = (
    "document_extraction_review_provenance_v2"
)
GOOGLE_DOCUMENT_AI_SUPPORTED_MIME_TYPES = ("image/png",)
GOOGLE_DOCUMENT_AI_MAX_PAGES = 15
GOOGLE_DOCUMENT_AI_MAX_SOURCE_BYTES = 25_000_000
GOOGLE_DOCUMENT_AI_FIELD_MASK = ",".join(
    (
        "mimeType",
        "text",
        "pages.pageNumber",
        "pages.layout",
        "pages.detectedLanguages",
        "pages.blocks",
        "pages.paragraphs",
        "pages.lines",
        "pages.tokens",
        "pages.tables",
        "pages.imageQualityScores",
    )
)
GOOGLE_DOCUMENT_AI_LOCATION = "us"

_PROJECT_NUMBER = re.compile(r"^[1-9][0-9]{5,20}$")
_PROCESSOR_ID = re.compile(r"^[a-f0-9]{8,64}$")


@dataclass(frozen=True)
class GoogleDocumentAiContract:
    """Exact processor-version binding; it is not a runtime feature switch."""

    project_number: str
    processor_id: str
    location: str = GOOGLE_DOCUMENT_AI_LOCATION
    processor_version: str = GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION
    provider_profile: str = GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE
    adapter_version: str = GOOGLE_DOCUMENT_AI_ADAPTER_VERSION
    request_serializer_version: str = GOOGLE_DOCUMENT_AI_REQUEST_SERIALIZER_VERSION
    response_validator_version: str = GOOGLE_DOCUMENT_AI_RESPONSE_VALIDATOR_VERSION
    normalization_version: str = GOOGLE_DOCUMENT_AI_NORMALIZATION_VERSION
    coordinate_contract_version: str = GOOGLE_DOCUMENT_AI_COORDINATE_CONTRACT_VERSION
    compatibility_policy_version: str = GOOGLE_DOCUMENT_AI_COMPATIBILITY_POLICY_VERSION
    table_policy_version: str = GOOGLE_DOCUMENT_AI_TABLE_POLICY_VERSION
    confidence_policy_version: str = GOOGLE_DOCUMENT_AI_CONFIDENCE_POLICY_VERSION
    selection_mark_policy_version: str = GOOGLE_DOCUMENT_AI_SELECTION_MARK_POLICY_VERSION
    artifact_contract_version: str = GOOGLE_DOCUMENT_AI_ARTIFACT_CONTRACT_VERSION
    artifact_normalization_version: str = (
        GOOGLE_DOCUMENT_AI_ARTIFACT_NORMALIZATION_VERSION
    )

    def __post_init__(self) -> None:
        if _PROJECT_NUMBER.fullmatch(self.project_number) is None:
            raise ValueError("google_document_ai_project_number_invalid")
        if _PROCESSOR_ID.fullmatch(self.processor_id) is None:
            raise ValueError("google_document_ai_processor_id_invalid")
        if (
            self.location != GOOGLE_DOCUMENT_AI_LOCATION
            or self.processor_version != GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION
            or self.provider_profile != GOOGLE_DOCUMENT_AI_PROVIDER_PROFILE
            or self.adapter_version != GOOGLE_DOCUMENT_AI_ADAPTER_VERSION
            or self.request_serializer_version
            != GOOGLE_DOCUMENT_AI_REQUEST_SERIALIZER_VERSION
            or self.response_validator_version
            != GOOGLE_DOCUMENT_AI_RESPONSE_VALIDATOR_VERSION
            or self.normalization_version != GOOGLE_DOCUMENT_AI_NORMALIZATION_VERSION
            or self.coordinate_contract_version
            != GOOGLE_DOCUMENT_AI_COORDINATE_CONTRACT_VERSION
            or self.compatibility_policy_version
            != GOOGLE_DOCUMENT_AI_COMPATIBILITY_POLICY_VERSION
            or self.table_policy_version != GOOGLE_DOCUMENT_AI_TABLE_POLICY_VERSION
            or self.confidence_policy_version
            != GOOGLE_DOCUMENT_AI_CONFIDENCE_POLICY_VERSION
            or self.selection_mark_policy_version
            != GOOGLE_DOCUMENT_AI_SELECTION_MARK_POLICY_VERSION
            or self.artifact_contract_version
            != GOOGLE_DOCUMENT_AI_ARTIFACT_CONTRACT_VERSION
            or self.artifact_normalization_version
            != GOOGLE_DOCUMENT_AI_ARTIFACT_NORMALIZATION_VERSION
        ):
            raise ValueError("google_document_ai_contract_unapproved")

    @property
    def processor_resource(self) -> str:
        return (
            f"projects/{self.project_number}/locations/{self.location}/"
            f"processors/{self.processor_id}/processorVersions/{self.processor_version}"
        )

    @property
    def endpoint(self) -> str:
        return (
            f"https://{self.location}-documentai.googleapis.com/"
            f"{GOOGLE_DOCUMENT_AI_API_VERSION}/{self.processor_resource}:process"
        )
