export const ACTIVE_AI_AGENT_RUN_TYPES = [
  "business_health_explanation_v1",
  "finding_explanation_v1",
  "file_analysis"
] as const;

export type ActiveAiAgentRunType = (typeof ACTIVE_AI_AGENT_RUN_TYPES)[number];
