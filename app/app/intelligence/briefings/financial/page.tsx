import Link from "next/link";
import type { Route } from "next";
import type { IntelligenceBriefingArtifact, IntelligenceBriefingClaim } from "@/lib/ai/intelligence-briefing/contracts";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { loadOwnerFinancialBriefContext } from "@/lib/ai/intelligence-briefing/owner-financial-service";
import { isIntelligenceBriefingEnabled } from "@/lib/ai/providers/workflow-provider-policy";
import { generateOwnerFinancialBriefAction } from "./actions";

function ClaimCitations({claim,artifact}:{claim:IntelligenceBriefingClaim;artifact:IntelligenceBriefingArtifact}) {
  const ids=new Set(artifact.signals.filter(s=>claim.support_refs.includes(s.ref)).flatMap(s=>s.citationIds));
  return <span className="ml-1 inline-flex gap-1">{artifact.citations.filter(c=>ids.has(c.citationId)).map(c=><Link key={c.citationId} href={c.href as Route} title={c.title} className="text-cyan-200 underline">[{c.citationId}]</Link>)}</span>;
}
export const dynamic="force-dynamic";
export default async function OwnerFinancialBriefPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const access=await requireWorkspaceAccess();
  if(access.membership.role!=="owner"||access.membership.user_id!==access.user.id||access.membership.status!=="active")return <p>Owner access is required.</p>;
  const params=await searchParams;
  const input={connectionId:params.connectionId,from:params.from,to:params.to};
  const context=await loadOwnerFinancialBriefContext(access,input).catch(()=>null);
  return <div className="mx-auto max-w-5xl space-y-6">
    <Link href="/app/intelligence/briefings" className="text-cyan-200 underline">Intelligence Briefings</Link>
    <header><h1 className="text-2xl font-semibold text-white">Private financial briefing</h1><p className="mt-2 text-slate-300">Journal subtotals and an optional generated financial summary, visible only to the workspace owner. Full ledger completeness and overall Business Health remain unverified.</p></header>
    <form method="get" className="flex flex-wrap gap-3">
      <input type="hidden" name="connectionId" value={typeof params.connectionId==="string"?params.connectionId:""} />
      <label className="text-sm">Period start<input name="from" type="date" required defaultValue={typeof params.from==="string"?params.from:""} className="block rounded border p-2 text-black" /></label>
      <label className="text-sm">Period end<input name="to" type="date" required defaultValue={typeof params.to==="string"?params.to:""} className="block rounded border p-2 text-black" /></label>
      <button className="self-end rounded border px-4 py-2">Inspect period</button>
    </form>
    {!context?<p>Choose a period for the connection opened from journal settings or KPIs. Journal accounting must be enabled. Unavailable or unauthorized evidence is withheld.</p>:<>
      <section id="journal-evidence" className="space-y-4"><h2 className="text-xl font-semibold">Journal evidence</h2>
        {context.periods.map(p=><article key={p.receiptHash} className="rounded border border-white/15 p-4">
          <h3>{p.periodStart} – {p.periodEnd} · {p.currency} · {p.basis}</h3><p className="mt-2 text-sm text-slate-300">{p.coverage.limitation} {p.coverage.journalCount} journals.</p>
          <dl className="my-3 grid grid-cols-2 gap-2">{[["Revenue",p.recognizedRevenue],["Cost of goods sold",p.costOfGoodsSold],["Labor",p.labor],["Other operating costs",p.otherOperatingCosts],["Operating profit",p.operatingProfit]].map(([label,value])=><div key={label}><dt className="text-sm text-slate-400">{label}</dt><dd>{p.currency} {value}</dd></div>)}</dl>
          <details><summary className="cursor-pointer text-cyan-200">Inspect contributing records ({p.sources.length})</summary><ul className="mt-2 max-h-64 overflow-auto text-sm">{p.sources.map(s=><li key={s.versionId}><Link className="underline" href={(`/app/settings/integrations/quickbooks/journal-evidence?connectionId=${p.connectionId}&from=${p.periodStart}&to=${p.periodEnd}&versionId=${s.versionId}`) as Route}>{s.recordType} · {s.recordId}</Link><span className="text-slate-400"> · version {s.versionId}</span></li>)}</ul></details>
        </article>)}
      </section>
      <section className="space-y-3"><h2 className="text-xl font-semibold">Generated financial summary</h2>
        {context.status==="ready"&&isIntelligenceBriefingEnabled()?<form action={generateOwnerFinancialBriefAction}>{Object.entries(context.query).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}<button className="rounded bg-cyan-700 px-4 py-2">Generate private summary</button></form>:null}
        {!isIntelligenceBriefingEnabled()?<p>Generation is disabled in this environment.</p>:null}
        {context.status==="processing"?<p>Generation is in progress. Refresh to check the result.</p>:null}
        {context.status==="failed"||params.failed?<p>The generation attempt failed. The unchanged journal evidence remains available.</p>:null}
        {context.artifact?<><p className="text-sm text-slate-400">Generated {context.artifact.generatedAt} · {context.artifact.confidence} confidence · Financial scope only</p><p>{context.artifact.analysis.executive_summary.text}<ClaimCitations claim={context.artifact.analysis.executive_summary} artifact={context.artifact}/></p>
          {context.artifact.analysis.sections.map(s=><div key={s.section_id}><p>{s.summary}<ClaimCitations claim={{text:s.summary,support_refs:s.support_refs}} artifact={context.artifact!}/></p><ul className="ml-5 list-disc">{s.claims.map((c,i)=><li key={i}>{c.text} <ClaimCitations claim={c} artifact={context.artifact!}/></li>)}</ul></div>)}
          <ul className="ml-5 list-disc">{context.artifact.analysis.leadership_considerations.map((c,i)=><li key={i}>{c.text}<ClaimCitations claim={c} artifact={context.artifact!}/></li>)}</ul>
          <ul className="text-sm text-slate-400">{context.artifact.limitations.map(l=><li key={l.ref}>{l.text}</li>)}</ul>
        </>:null}
      </section>
    </>}
  </div>;
}
