/** Navigation compatibility only: never rewrite stored citation snapshots. */
export function vsiCitationNavigationUrl(source: { sourceType: string; url: string }): string {
  if (source.sourceType !== "kpi") return source.url;
  const legacy = /^\/app\/kpis\?q=([^&#]+)$/.exec(source.url);
  if (!legacy) return source.url;
  try {
    const metric = decodeURIComponent(legacy[1]);
    if (!metric || encodeURIComponent(metric) !== legacy[1]) return source.url;
    return `/app/kpis?metric=${encodeURIComponent(metric)}&section=detail#kpi-detail`;
  } catch { return source.url; }
}
