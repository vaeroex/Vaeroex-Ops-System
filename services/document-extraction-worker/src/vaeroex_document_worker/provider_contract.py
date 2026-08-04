"""Versioned, application-owned NVIDIA REST contract profiles."""

from __future__ import annotations

from dataclasses import dataclass

REST_ADAPTER_VERSION = "vaeroex_nemotron_parse_rest_v1"
HOSTED_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions"
HOSTED_MODEL = "nvidia/nemotron-parse"
HOSTED_CONTRACT_VERSION = "nvidia_build_nemotron_parse_hosted_tool_call_v1"
HOSTED_PARSER_REVISION = "nemotron_parse_hosted_tool_call_rest_v1"

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


# This is the only runtime-admissible contract in Phase B. NVIDIA documents it
# as the public hosted API. The v1.2 profile below is serialized and validated
# by the adapter, but remains unavailable to runtime configuration until an
# exact enterprise NIM endpoint receives a separate security approval.
HOSTED_CONTRACT = ProviderContract(
    endpoint=HOSTED_ENDPOINT,
    endpoint_contract_version=HOSTED_CONTRACT_VERSION,
    model=HOSTED_MODEL,
    parser_revision=HOSTED_PARSER_REVISION,
    response_profile="hosted_tool_call",
    task_prompt=None,
    supports_nvcf_assets=True,
    sends_nvidia_credential=True,
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
