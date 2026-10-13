import Link from "next/link";
import { LeadershipDecisionJournal } from "@/components/intelligence/LeadershipDecisionJournal";
import type { Database } from "@/lib/supabase/types";

type Rows = Database["public"]["Tables"];
export type IntelligenceWorkspaceContextProps = {
  shares: Rows["record_shares"]["Row"][];
  people: Rows["people"]["Row"][];
  decisions: Rows["business_decisions"]["Row"][];
  unavailable?: boolean;
  legacyView?: string;
};

// Keep the working journal and internal share history; assignment workflows were retired.
export function IntelligenceWorkspaceContext({ shares, people, decisions, unavailable, legacyView }: IntelligenceWorkspaceContextProps) {
  const recentShares = shares.filter(item => item.source_type !== "report").slice(0, 6);
  return (
    <section className="intelligence-context space-y-3" aria-label="Workspace review context">
      <details open={legacyView === "Intelligence View"} className="intelligence-summary-card" id="leadership-decisions">
        <summary className="intelligence-disclosure">Decision journal <span className="font-normal text-slate-400">· {decisions.length} retained</span></summary>
        <div className="pt-3"><LeadershipDecisionJournal decisions={decisions} returnPath="/app/intelligence" /></div>
      </details>
      <details open={legacyView === "Operations View"} className="intelligence-summary-card">
        <summary className="intelligence-disclosure">Internal share records</summary>
        <p className="py-3 text-sm leading-6 text-slate-400">Recent internal share records. KPI shares are saved from Performance’s records view. No messages or scheduled deliveries are sent.</p>
        {unavailable ? <p role="status" className="py-3 text-sm text-slate-300">Share history is temporarily unavailable. Existing records have not changed.</p> : <>
          <ul className="divide-y divide-white/10">{recentShares.map(item => (
            <li key={item.id} className="py-3 text-sm">
              <p className="text-slate-100">{item.source_title}</p>
              <p className="mt-1 text-slate-400">{item.source_type.replace(/_/g, " ")} · {people.find(person => person.id === item.person_id)?.full_name || item.role || item.department || "Entire workspace"}</p>
            </li>
          ))}</ul>
          {!recentShares.length ? <p className="py-3 text-sm text-slate-400">No internal share records yet.</p> : null}
        </>}
        <Link className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-cyan-200 hover:underline" href="/app/kpis?section=records">Open Performance records</Link>
      </details>
    </section>
  );
}
