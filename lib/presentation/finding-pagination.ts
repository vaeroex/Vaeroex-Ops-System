/** Presentation only: never filters evidence or changes finding order. */
export const findingPageSize = 5;

export function findingPage<T>(items: readonly T[], requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / findingPageSize));
  const page = Math.min(totalPages, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1));
  const start = (page - 1) * findingPageSize;
  return { page, totalPages, items: items.slice(start, start + findingPageSize), start: items.length ? start + 1 : 0, end: Math.min(start + findingPageSize, items.length) };
}

export function findingPageNumbers(page: number, totalPages: number): Array<number | "…"> {
  const visible = [...new Set([1, totalPages, page - 1, page, page + 1])].filter(value => value >= 1 && value <= totalPages).sort((a, b) => a - b);
  return visible.flatMap((value, index) => index && value - visible[index - 1] > 1 ? ["…" as const, value] : [value]);
}

/** Suppress only an entire duplicate sentence, retaining qualifiers and extra context. */
export function repeatsFindingFigures(summary: string, figures: string | undefined) {
  if (!figures) return false;
  const structured = /^Actual\s+(.+?)\s*·\s*Target\s+(.+)$/i.exec(figures.trim());
  const sentence = /^Actual\s+(.+?)\s+vs\.?\s+target\s+(.+?)\.?$/i.exec(summary.trim());
  return Boolean(structured && sentence && structured[1] === sentence[1] && structured[2] === sentence[2]);
}
