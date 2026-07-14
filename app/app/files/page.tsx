import { permanentRedirect } from "next/navigation";
import type { Route } from "next";

type LegacyFilesPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
    file?: string;
    q?: string;
    status?: string;
    view?: string;
    panel?: string;
    section?: string;
  }>;
};

const DETAIL_SECTION_BY_LEGACY_PANEL: Record<string, "summary" | "findings" | "imported" | "history"> = {
  intelligence: "findings",
  "analysis-result": "findings",
  evidence: "summary",
  reports: "history",
  import: "imported",
  "mapping-review": "imported",
  history: "history",
  details: "summary",
  "file-details": "summary",
  analyze: "summary",
  ask: "summary"
};

export default async function LegacyFilesPage({ searchParams }: LegacyFilesPageProps) {
  const params = (await searchParams) || {};

  if (params.file) {
    const query = new URLSearchParams();
    const section = DETAIL_SECTION_BY_LEGACY_PANEL[params.panel || params.section || ""];

    if (section && section !== "summary") query.set("section", section);
    if (params.error) query.set("error", params.error);
    if (params.message) query.set("message", params.message);

    permanentRedirect(`/app/sources/${encodeURIComponent(params.file)}${query.size ? `?${query.toString()}` : ""}` as Route);
  }

  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status) query.set("status", params.status);
  if (params.error) query.set("error", params.error);
  if (params.message) query.set("message", params.message);
  if (params.view === "all" || params.view === "hidden") query.set("tab", "archived");

  permanentRedirect(`/app/sources${query.size ? `?${query.toString()}` : ""}` as Route);
}
