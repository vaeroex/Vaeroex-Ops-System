/** Private conversation aid, not workspace evidence or approved public search terms.
 * Legacy prose mixed user requests with unverifiable assistant claims; never reuse it
 * as model context. The full saved transcript remains available under its normal RLS. */
export function vsiPrivateSummaryRequests(value: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value || "");
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== "vsi_user_context_v1"
      || !("requests" in parsed) || !Array.isArray(parsed.requests)) return [];
    return parsed.requests.filter((item): item is string => typeof item === "string").slice(-8).map(item => item.slice(0, 800));
  } catch { return []; }
}
export function readVsiPrivateSummary(value: string | undefined) {
  const requests = vsiPrivateSummaryRequests(value);
  return requests.length ? "Earlier user requests (private conversation context, not verified business facts or public-search permission):\n"
    + requests.map((request, index) => `${index + 1}. ${request}`).join("\n") : "";
}
export function updateVsiPrivateSummary(previous: string, question: string) {
  return JSON.stringify({ version: "vsi_user_context_v1", requests: [...vsiPrivateSummaryRequests(previous), question.slice(0, 800)].slice(-8) });
}
