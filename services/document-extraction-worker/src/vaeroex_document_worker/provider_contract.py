"""Versioned, application-owned NVIDIA REST contract profiles."""

from __future__ import annotations

from dataclasses import dataclass

REST_ADAPTER_VERSION = "vaeroex_nemotron_parse_rest_v2"
LEGACY_REST_ADAPTER_VERSION = "vaeroex_nemotron_parse_rest_v1"
HOSTED_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions"
HOSTED_MODEL = "nvidia/nemotron-parse"
HOSTED_CONTRACT_VERSION = "nvidia_build_nemotron_parse_hosted_tool_call_v2"
HOSTED_PARSER_REVISION = "nemotron_parse_hosted_tool_call_rest_v2"
LEGACY_HOSTED_CONTRACT_VERSION = "nvidia_build_nemotron_parse_hosted_tool_call_v1"
LEGACY_HOSTED_PARSER_REVISION = "nemotron_parse_hosted_tool_call_rest_v1"
HOSTED_ENDPOINT_PROFILE = "hosted_tool_call"
HOSTED_RESPONSE_PROFILE = "hosted_tool_call_v2"
HOSTED_COMPATIBILITY_CONTRACT_VERSION = "hosted_tool_call_v2"
HOSTED_ACCEPTED_FINISH_REASONS = ("tool_calls", "stop")
HOSTED_TOOL_NAME = "markdown_bbox"
HOSTED_REQUEST_SERIALIZER_VERSION = "nemotron_parse_hosted_request_v1"
HOSTED_RESPONSE_VALIDATOR_VERSION = "nemotron_parse_hosted_response_v2"
HOSTED_NORMALIZATION_VERSION = "nemotron_parse_hosted_normalization_v1"
HOSTED_COORDINATE_CONTRACT_VERSION = "normalized_xyxy_unit_interval_v1"
HOSTED_COMPATIBILITY_RATIONALE = (
    "official_tool_payload_consumers_without_finish_gate_plus_observed_stop_v1"
)

V1_2_NIM_ENDPOINT = "http://127.0.0.1:8000/v1/chat/completions"
V1_2_MODEL = "nvidia/nemotron-parse-v1.2"
V1_2_CONTRACT_VERSION = "nemotron_parse_v1_2_openai_chat_v1"
V1_2_PARSER_REVISION = "nemotron_parse_v1_2_tagged_rest_v1"
V1_2_TASK_PROMPT = (
    "</s><s><predict_bbox><predict_classes><output_markdown>"
    "<predict_no_text_in_pic>"
)

NVCF_ASSET_ENDPOINT = "https://api.nvcf.nvidia.com/v2/nvcf/assets"
NVCF_INLINE_IMAGE_LIMIT_BYTES = 180_000


@dataclass(frozen=True)
class ProviderContract:
    endpoint: str
    endpoint_contract_version: str
    model: str
    parser_revision: str
    response_profile: str
    task_prompt: str | None
    supports_nvcf_assets: bool
    sends_nvidia_credential: bool
    endpoint_profile: str | None = None
    compatibility_contract_version: str | None = None
    accepted_finish_reasons: tuple[str, ...] = ()
    tool_name: str | None = None
    request_serializer_version: str | None = None
    response_validator_version: str | None = None
    normalization_version: str | None = None
    coordinate_contract_version: str | None = None
    compatibility_rationale: str | None = None


# Historical hosted v1 remains available for compatibility tests only. Its
# response validator continues to reject finish_reason=stop.
LEGACY_HOSTED_CONTRACT = ProviderContract(
    endpoint=HOSTED_ENDPOINT,
    endpoint_contract_version=LEGACY_HOSTED_CONTRACT_VERSION,
    model=HOSTED_MODEL,
    parser_revision=LEGACY_HOSTED_PARSER_REVISION,
    response_profile=HOSTED_ENDPOINT_PROFILE,
    task_prompt=None,
    supports_nvcf_assets=True,
    sends_nvidia_credential=True,
    endpoint_profile=HOSTED_ENDPOINT_PROFILE,
)

# This is the only runtime-admissible contract. It remains bound to the legacy
# hosted endpoint profile while applying Vaeroex's separately versioned v2
# structural-completeness policy. The v1.2 profile below remains unavailable
# to runtime configuration until an exact NIM endpoint receives approval.
HOSTED_CONTRACT = ProviderContract(
    endpoint=HOSTED_ENDPOINT,
    endpoint_contract_version=HOSTED_CONTRACT_VERSION,
    model=HOSTED_MODEL,
    parser_revision=HOSTED_PARSER_REVISION,
    response_profile=HOSTED_RESPONSE_PROFILE,
    task_prompt=None,
    supports_nvcf_assets=True,
    sends_nvidia_credential=True,
    endpoint_profile=HOSTED_ENDPOINT_PROFILE,
    compatibility_contract_version=HOSTED_COMPATIBILITY_CONTRACT_VERSION,
    accepted_finish_reasons=HOSTED_ACCEPTED_FINISH_REASONS,
    tool_name=HOSTED_TOOL_NAME,
    request_serializer_version=HOSTED_REQUEST_SERIALIZER_VERSION,
    response_validator_version=HOSTED_RESPONSE_VALIDATOR_VERSION,
    normalization_version=HOSTED_NORMALIZATION_VERSION,
    coordinate_contract_version=HOSTED_COORDINATE_CONTRACT_VERSION,
    compatibility_rationale=HOSTED_COMPATIBILITY_RATIONALE,
)

V1_2_NIM_CONTRACT = ProviderContract(
    endpoint=V1_2_NIM_ENDPOINT,
    endpoint_contract_version=V1_2_CONTRACT_VERSION,
    model=V1_2_MODEL,
    parser_revision=V1_2_PARSER_REVISION,
    response_profile="v1_2_tagged",
    task_prompt=V1_2_TASK_PROMPT,
    supports_nvcf_assets=False,
    sends_nvidia_credential=False,
)


def active_provider_contract() -> ProviderContract:
    return HOSTED_CONTRACT
