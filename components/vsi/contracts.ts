export type VsiChat = {
  id: string;
  title: string;
  exchangeCount: number;
  createdAt: string;
  updatedAt: string;
  parentConversationId?: string | null;
};

export type VsiSource = {
  id: string;
  title: string;
  url: string;
  sourceType: string;
  sourceId: string | null;
  evidenceDate: string | null;
  evidenceDateKind?: "publication" | "updated" | "observation" | "event";
  evidenceDateText?: string;
  retrievedAt: string;
  excerpt?: string;
};

export type VsiExchange = {
  id: string;
  userMessage: string;
  answer: string;
  citations: VsiSource[];
  createdAt: string;
  rememberProposal?: { title: string; content: string } | null;
  savedNoteId?: string | null;
};

export type VsiUsageView = {
  used: number;
  limit: number;
  remaining: number;
  resetsAt?: string | null;
  workspaceBudget?: { spentUsd: number; reservedUsd: number; limitUsd: number; periodStart: string } | null;
};

export function safeSourceUrl(value: string): string | null {
  // Internal source routes or secure public source URLs only. Text is never HTML.
  if (/^\/app(?:\/|\?|#|$)/.test(value) && !/[\\\r\n]/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function displayDate(value: string | null | undefined, includeTime = false, timeZone?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? "UTC" : timeZone,
    ...(includeTime ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } : {})
  }).format(new Date(value));
}
