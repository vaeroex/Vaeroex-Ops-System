/** Bounded display only: callers retain their existing query and authority rules. */
export function listBatchCount(value: string | undefined, total: number, batchSize: number) {
  const parsed = value && /^\d{1,6}$/.test(value) ? Number(value) : batchSize;
  return Math.min(total, Math.max(batchSize, Number.isSafeInteger(parsed) ? parsed : batchSize));
}

export function performanceSection(
  params: { section?: string; metric?: string | string[]; sort?: string } | undefined,
  primaryMetric: string
) {
  if (params?.section === "compare" || params?.metric === "compare") return "compare";
  if (params?.section === "records" || params?.sort) return "records";
  // A stale bookmark must return to the usable overview, never an empty detail.
  return params?.section === "detail" && primaryMetric ? "detail" : "overview";
}
