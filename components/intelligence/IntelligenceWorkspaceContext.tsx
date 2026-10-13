import Link from "next/link";
import { LeadershipDecisionJournal } from "@/components/intelligence/LeadershipDecisionJournal";
import type { Database } from "@/lib/supabase/types";
type Rows = Database["public"]["Tables"];
export type IntelligenceWorkspaceContextProps = {
  assignments: Rows["operational_assignments"]["Row"][];
  shares: Rows["record_shares"]["Row"][];
  people: Rows["people"]["Row"][];
  decisions: Rows["business_decisions"]["Row"][];
  userEmail?: string;
  unavailable?: boolean;
  legacyView?: string;
};

// Retains the former Overview's bounded personal/role/area context and shares.
export function IntelligenceWorkspaceContext({ assignments, shares, people, decisions, userEmail, unavailable, legacyView }: IntelligenceWorkspaceContextProps) {
  const today = new Date().toISOString().slice(0, 10);
  const dueEnd = new Date(); dueEnd.setUTCDate(dueEnd.getUTCDate() + 14);
  const person = people.find(item => item.email?.toLowerCase() === userEmail?.toLowerCase());
  const active = assignments.filter(item => !item.archived_at && !["done", "dismissed", "complete"].includes((item.status || "").toLowerCase()));
  const groups = [
    { label: "Personal context", rows: person ? active.filter(item => item.assigned_person_id === person.id).slice(0, 5) : [] },
    { label: "Role context", rows: person?.role_title ? active.filter(item => item.assigned_role === person.role_title).slice(0, 5) : [] },
    { label: "Area context", rows: person?.department ? active.filter(item => item.assigned_department === person.department).slice(0, 5) : [] },
    { label: "Unresolved review items", rows: active.filter(item => item.due_date && item.due_date < today).slice(0, 5) },
    { label: "Upcoming review items", rows: active.filter(item => item.due_date && item.due_date >= today && item.due_date <= dueEnd.toISOString().slice(0, 10)).slice(0, 5) },
  ];
  return <section className="intelligence-context space-y-3" aria-label="Workspace review context">
    <details open={legacyView === "Intelligence View"} className="intelligence-summary-card" id="leadership-decisions"><summary className="intelligence-disclosure">Decision journal <span className="font-normal text-slate-400">· {decisions.length} retained</span></summary><div className="pt-3"><LeadershipDecisionJournal decisions={decisions} returnPath="/app/intelligence" /></div></details>
    <details open={legacyView === "Operations View"} className="intelligence-summary-card"><summary className="intelligence-disclosure">Assignments &amp; shared context</summary>
      {unavailable ? <p role="status" className="py-3 text-sm text-slate-300">Some workspace context is temporarily unavailable. Existing records have not changed.</p> : <>
        <p className="py-3 text-sm text-slate-400">{active.filter(item => item.source_type === "vaeroex_recommendation").length} saved recommendations in the current assignment context.</p>
        <div className="grid gap-5 md:grid-cols-2">{groups.map(group => <section key={group.label}><h3 className="text-sm font-semibold text-white">{group.label}</h3><ul className="mt-2 divide-y divide-white/10">{group.rows.map(item => <li key={item.id} className="py-3 text-sm"><p className="text-slate-100">{item.title}</p><p className="mt-1 text-slate-400">{item.source_title || item.status}{item.due_date ? ` · ${item.due_date}` : ""}</p></li>)}</ul>{!group.rows.length ? <p className="py-3 text-sm text-slate-400">No matching review items.</p> : null}</section>)}</div>
        <h3 className="mt-5 text-sm font-semibold text-white">Recent shares</h3><ul className="divide-y divide-white/10">{shares.filter(item => item.source_type !== "report").slice(0, 6).map(item => <li key={item.id} className="py-3 text-sm"><p className="text-slate-100">{item.source_title}</p><p className="mt-1 text-slate-400">{item.source_type.replace(/_/g, " ")} · {people.find(person => person.id === item.person_id)?.full_name || item.role || item.department || "Entire workspace"} · {item.distribution_schedule.replace(/_/g, " ")}</p></li>)}</ul>{!shares.filter(item => item.source_type !== "report").length ? <p className="py-3 text-sm text-slate-400">No records have been shared yet.</p> : null}
      </>}
      <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold text-cyan-200"><Link className="min-h-11 py-3 hover:underline" href="/app/kpis">Review Performance</Link><Link className="min-h-11 py-3 hover:underline" href="/app/sources">Review Files &amp; Notes</Link><Link className="min-h-11 py-3 hover:underline" href="/app/reports">Saved Analyses</Link></div>
    </details>
  </section>;
}
