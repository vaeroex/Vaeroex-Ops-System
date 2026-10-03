import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppNavigation } from "@/components/app/AppNavigation";
import { WorkspacePageTitle } from "@/components/app/WorkspacePageTitle";
import { IntelligenceSignalInbox } from "@/components/intelligence/IntelligenceSignalInbox";
import { IntelligenceBriefingCards } from "@/components/intelligence/IntelligenceBriefingCards";
import { EvidenceBatchList } from "@/components/evidence/EvidenceBatchList";
import { EvidenceLifecycleCheckbox } from "@/components/evidence/EvidenceLifecycleSelection";
import { BusinessNoteEntry } from "@/components/evidence/BusinessNotesPanel";
import { SavedAnalysisList } from "@/components/reports/SavedAnalysisList";
import SettingsPage from "@/app/app/settings/page";
import { usePathname } from "./navigation";

// No live data, credentials, providers, or state-changing calls are available in this preview.
window.fetch = async () => { throw new Error("Synthetic preview: network calls are blocked"); };
document.addEventListener("submit", (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
const rejectAction = async () => { throw new Error("Synthetic preview: mutations are blocked"); };
const items = [
  { href: "/app", label: "Overview" }, { href: "/app/intelligence", label: "Intelligence" },
  { href: "/app/kpis", label: "Performance" }, { href: "/app/sources", label: "Evidence" },
  { href: "/app/reports", label: "Saved Analyses" }, { href: "/app/settings", label: "Settings" }
];
const sections = [{ label: "Workspace", collapsible: false, items }];
const date = "2026-09-29T08:00:00Z";
const cards = Array.from({ length: 320 }, (_, index) => {
  const type = index % 2 ? "Opportunity" : "Risk";
  const snapshot = { version: "intelligence_card_lifecycle_v1", findingId: `fixture-${index}`, type, title: `Synthetic ${type.toLowerCase()} ${index + 1}`, summary: "A synthetic operational finding for interface qualification only.", priority: "Medium", confidence: index % 3 ? "High" : "Low", affectedArea: "Operations", lastUpdated: date };
  return { findingKeyHash: String(index).padStart(4, "0"), materialSignature: `fixture-${index}`, findingId: snapshot.findingId, snapshot,
    insight: { ...snapshot, id: snapshot.findingId, why: "Fixture evidence", impact: "Review a synthetic operational variance.", recommendedAction: "Inspect the evidence and compare the result.", evidence: [], evidenceCount: 0, supportingRecords: [], independentSourceCount: 0, contradictoryEvidence: [], missingEvidence: [], sourceTypes: [], sourceHref: "/app/sources", timePeriod: "September 2026", limitation: "Synthetic fixture only.", fingerprint: `fixture-${index}` },
    lifecycleState: "active", pinned: false, view: "current", currentFeedStatus: "surfaced", reopenReason: null, reopenedFrom: null, reasonCode: null, reasonText: null, dismissedBy: null, recheckAfter: null, stateChangedAt: null, lifecycleToken: null };
});
const states = Object.fromEntries(["weekly", "monthly"].map((briefingType) => [briefingType, { briefingType, status: "unavailable", eligibility: "no_eligible_evidence", confidence: "Low", artifact: null, message: "No eligible evidence in this synthetic fixture.", period: { start: "2026-09-01", end: "2026-09-29", cutoff: date, dayCount: 29, timeZone: "UTC" } }]));
const analyses = Array.from({ length: 300 }, (_, index) => ({ id: `analysis-${index}`, title: `Synthetic analysis ${index + 1}`, analysisType: index % 2 ? "weekly_briefing" : "business_health", generatedAt: date, savedAt: date, confidence: "High", evidenceStatus: "Synthetic evidence", dateRange: "September 2026", businessHealthState: null }));
function Evidence() {
  const [query, setQuery] = useState("");
  const records = Array.from({ length: 350 }, (_, index) => ({ id: `source-${index}`, label: `Synthetic file ${index + 1}`, content: <article data-fixture-source className="rounded-lg border border-white/10 bg-[#08111f] p-4"><div className="flex items-start gap-3"><EvidenceLifecycleCheckbox id={`source-${index}`} label={`Synthetic file ${index + 1}`} /><div><h3 className="font-semibold text-white">Synthetic file {index + 1}</h3><p className="text-sm text-slate-400">Saved source · Synthetic qualification data</p></div></div></article> }));
  const visible = records.filter((record) => record.label.toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-5"><header className="rounded-lg border border-white/10 bg-[#08111f] p-4"><h1 className="text-2xl font-semibold text-white">Evidence</h1><p className="my-3 text-sm text-slate-300">Synthetic browser fixture. No uploads or submissions can execute.</p><BusinessNoteEntry enabled /></header><label className="block text-sm text-white">Search loaded files<input className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 p-3" value={query} onChange={(event) => setQuery(event.target.value)} /></label><h2 className="text-lg font-semibold text-white">Source Files</h2><EvidenceBatchList key={query} items={visible} pluralLabel="files" selection={{ singularLabel: "file", action: rejectAction }} /></div>;
}
function App() {
  const pathname = usePathname();
  const [settings, setSettings] = useState<React.ReactNode>(null);
  useEffect(() => { SettingsPage({ searchParams: Promise.resolve({}) }).then(setSettings); }, []);
  const body = pathname === "/app/sources" ? <Evidence /> : pathname === "/app/reports" ? <><h1 className="mb-5 text-2xl font-semibold text-white">Saved Analyses</h1><SavedAnalysisList analyses={analyses as React.ComponentProps<typeof SavedAnalysisList>["analyses"]} loadLimitReached /></> : pathname === "/app/settings" ? settings : pathname === "/app/intelligence" ? <div className="space-y-6"><h1 className="text-2xl font-semibold text-white">Intelligence</h1><IntelligenceSignalInbox currentCards={cards as React.ComponentProps<typeof IntelligenceSignalInbox>["currentCards"]} historyCards={[]} canManageLifecycle={false} /><IntelligenceBriefingCards states={states as React.ComponentProps<typeof IntelligenceBriefingCards>["states"]} generationEnabled={false} compactUnavailable /></div> : <p className="text-slate-300">This destination is outside the synthetic preview. Use Intelligence, Evidence, Saved Analyses, or Settings. Performance is covered by focused tests; browser verification awaits a preview deployment.</p>;
  return <div className="min-h-screen bg-[#06101e] text-slate-100"><div className="border-b border-white/10 bg-[#08111f] p-3 text-xs text-amber-100">LOCAL SYNTHETIC PREVIEW — no Production access; all submissions blocked</div><div className="mx-auto flex max-w-[1600px]"><aside className="hidden w-60 shrink-0 border-r border-white/10 p-4 lg:block"><h2 className="mb-2 text-xl font-semibold">Vaeroex</h2><p className="text-xs text-slate-400">Synthetic workspace</p><AppNavigation sections={sections} /></aside><div className="min-w-0 flex-1"><header className="border-b border-white/10 bg-[#08111f] p-4"><p className="text-xs text-slate-400">Synthetic workspace</p><WorkspacePageTitle items={items} /><div className="mt-3 lg:hidden"><AppNavigation sections={sections} mobile /></div></header><main className="p-4 md:p-6">{body}</main></div></div></div>;
}
createRoot(document.getElementById("root")!).render(<App />);
