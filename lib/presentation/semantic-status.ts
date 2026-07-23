import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Circle,
  CircleAlert,
  ShieldAlert,
  TrendingUp,
  type LucideIcon
} from "lucide-react";

export type SemanticStatus =
  | "critical"
  | "risk-high"
  | "risk-medium"
  | "positive"
  | "opportunity"
  | "anomaly"
  | "neutral"
  | "unavailable";

type FindingType = "Risk" | "Opportunity" | "Forecast" | "Bottleneck" | "Recommendation" | "Anomaly";
type FindingPriority = "High" | "Medium" | "Low";
type KpiTone = "green" | "yellow" | "red" | "neutral";

export type SemanticPresentation = {
  status: SemanticStatus;
  label: string;
  Icon: LucideIcon;
};

const presentations: Record<SemanticStatus, Omit<SemanticPresentation, "status">> = {
  critical: { label: "Critical", Icon: ShieldAlert },
  "risk-high": { label: "High priority", Icon: AlertTriangle },
  "risk-medium": { label: "Medium priority", Icon: CircleAlert },
  positive: { label: "Positive", Icon: TrendingUp },
  opportunity: { label: "Opportunity", Icon: ArrowUpRight },
  anomaly: { label: "Anomaly", Icon: Activity },
  neutral: { label: "Neutral", Icon: Circle },
  unavailable: { label: "Unavailable", Icon: CircleAlert }
};

export function semanticStatusClass(status: SemanticStatus) {
  return `vaeroex-semantic-${status}`;
}

export function semanticPresentation(status: SemanticStatus): SemanticPresentation {
  return { status, ...presentations[status] };
}

export function findingCategoryStatus(type: FindingType): SemanticStatus {
  if (type === "Opportunity") return "opportunity";
  if (type === "Anomaly") return "anomaly";
  if (type === "Risk" || type === "Bottleneck") return "risk-medium";
  return "neutral";
}

export function findingPriorityStatus(priority: FindingPriority): SemanticStatus {
  if (priority === "High") return "risk-high";
  if (priority === "Medium") return "risk-medium";
  return "neutral";
}

export function businessHealthStatus(status: string): SemanticStatus {
  if (status === "Healthy" || status === "Strong") return "positive";
  if (status === "Watch") return "risk-medium";
  if (status === "Critical" || status === "At Risk") return "critical";
  if (status === "Limited evidence" || status === "Insufficient Data") return "unavailable";
  return "neutral";
}

export function intelligenceReadinessStatus(label: string): SemanticStatus {
  if (label === "Strong") return "positive";
  if (label === "Good") return "opportunity";
  if (label === "Partial") return "risk-medium";
  if (label === "Limited") return "unavailable";
  return "neutral";
}

export function kpiStatus({
  tone,
  hasCurrentValue,
  hasTarget,
  hasDirection
}: {
  tone: KpiTone;
  hasCurrentValue: boolean;
  hasTarget: boolean;
  hasDirection: boolean;
}): SemanticStatus {
  if (!hasCurrentValue) return "unavailable";
  if (!hasTarget || !hasDirection) return "neutral";
  if (tone === "green") return "positive";
  if (tone === "yellow") return "risk-medium";
  if (tone === "red") return "risk-high";
  return "neutral";
}
