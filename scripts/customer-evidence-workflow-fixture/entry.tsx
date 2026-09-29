import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { UploadSourceForm } from "@/components/evidence/UploadSourceForm";
import { PrimaryButton } from "@/components/operations/FormControls";
import { AnalysisProgressSubmit } from "@/components/operations/AnalysisProgressSubmit";
import { ToastRegion } from "@/components/app/ToastRegion";
import { ActivityProvider } from "@/components/app/ActivityProvider";
import { completeSharedAction, runSharedAction, setMode, snapshot, subscribe, type FixtureMode } from "./actions";
import Link, { usePathname } from "./navigation";

const localFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
  if (url.origin !== window.location.origin || url.pathname !== "/__fixture/inspect") throw new Error("Only the loopback fixture inspector may be called.");
  return localFetch(input, init);
};
const panel = "rounded-lg border border-white/10 bg-[#08111f] p-4 sm:p-5";
const runPrimary = async () => { await runSharedAction("primary"); };
const runAnalysis = async () => { await runSharedAction("analysis"); };
function Preview() {
  const pathname = usePathname();
  const fixture = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [formVersion, setFormVersion] = useState(0);
  const record = fixture.records.find((item) => pathname === `/app/sources/${item.id}`);
  return <ActivityProvider><div className="min-h-screen bg-[#06101e] text-slate-100">
    <div className="border-b border-white/10 bg-[#08111f] p-3 text-xs leading-5 text-amber-100">LOCAL SYNTHETIC PREVIEW — actual upload form, buttons, toast, file validator and spreadsheet parser. Server actions, storage, permissions, duplicate checks, redirects and record persistence are simulated. No Production or provider access.</div>
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header><p className="text-xs uppercase tracking-wide text-slate-400">Vaeroex · Synthetic workspace</p><h1 className="mt-1 text-2xl font-semibold">Evidence workflow qualification</h1></header>
      <div className={`${panel} space-y-3`}>
        <label className="block text-sm font-semibold">Fixture scenario<select value={fixture.mode} onChange={(event) => setMode(event.target.value as FixtureMode)} className="ml-3 max-w-full rounded-lg border border-white/10 bg-slate-950 p-2 text-sm"><option value="success">Success</option><option value="delayed">Delayed success · 8 seconds</option><option value="recoverable">Recoverable failure</option><option value="unknown">Unknown result · fixture source saved</option></select></label>
        <p data-fixture-counts className="text-xs text-slate-300">Upload submissions: {fixture.uploadRequests} · Primary action submissions: {fixture.primaryRequests} · Analysis submissions: {fixture.analysisRequests} · Saved fixture sources: {fixture.records.length}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-cyan-200">{["synthetic.csv", "synthetic.xlsx", "synthetic.pdf", "invalid.pdf"].map((name) => <a key={name} href={`/samples/${name}`} download>{name}</a>)}</div>
        <p className="text-xs leading-5 text-slate-400">Use synthetic files only. The sample workbook contains 303 synthetic retail rows. Files are inspected in memory and discarded; fixture metadata disappears when this preview stops. PDF contents are validated as a file but not analyzed.</p>
      </div>
      {record ? <section className={`${panel} space-y-4`}>
        <Link href="/app/sources" className="text-sm font-semibold text-cyan-200">← Back to saved fixture sources</Link>
        <h2 className="text-xl font-semibold">{record.displayName}</h2>
        <p className="text-sm text-slate-300">{record.status}</p>
        <p className="text-xs text-slate-400">{record.fileName} · {record.size} bytes · Folder: {record.folder}</p>
        {record.worksheets.length ? <><p className="text-sm">Actual local parser: {record.rowCount} rows across {record.worksheets.length} worksheets.</p><ul className="space-y-1 text-sm text-slate-300">{record.worksheets.map((sheet) => <li key={sheet.name}>{sheet.name}: {sheet.rows} rows ({sheet.status})</li>)}</ul><details><summary className="cursor-pointer text-sm font-semibold text-cyan-200">Preview first five parsed rows</summary><pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs">{JSON.stringify(record.rows, null, 2)}</pre></details></> : <p className="text-sm text-slate-300">A separate analysis decision is required. This fixture does not execute extraction or approval.</p>}
        {record.issues.length ? <p className="text-sm text-amber-100">{record.issues.map((issue) => `${issue.worksheet}: ${issue.message}`).join(" · ")}</p> : null}
        <p className="text-xs text-amber-100">This detail view is a synthetic summary, not the production mapping review or database persistence flow.</p>
      </section> : <>
        <section className={panel}><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Upload Source</h2><button type="button" onClick={() => setFormVersion((value) => value + 1)} className="text-xs font-semibold text-slate-400">Reset fixture form</button></div><UploadSourceForm key={formVersion} folders={[{ id: "synthetic-operations", name: "Synthetic Operations" }, { id: "synthetic-finance", name: "Synthetic Finance" }]} /></section>
        <section className={`${panel} space-y-3`}><h2 className="text-lg font-semibold">Saved fixture sources</h2>{fixture.records.length ? fixture.records.map((item) => <Link key={item.id} href={`/app/sources/${item.id}`} className="block rounded-lg border border-white/10 p-3 text-sm text-cyan-200">{item.displayName} · {item.status}</Link>) : <p className="text-sm text-slate-400">No fixture sources saved yet.</p>}</section>
        <section className={`${panel} space-y-4`}><h2 className="text-lg font-semibold">Shared-control feedback</h2><p className="text-xs text-slate-400">Each synthetic action waits for its explicit fixture completion control. Repeated clicks should increase its count once. No time-based result is inferred.</p><form action={runPrimary}><PrimaryButton>Run synthetic primary action</PrimaryButton></form><button type="button" onClick={() => completeSharedAction("primary")}>Complete primary fixture response</button><form action={runAnalysis}><AnalysisProgressSubmit pendingLabel="Running synthetic analysis…" className="min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white" steps={["Synthetic action received", "Waiting for fixture result"]}>Run synthetic analysis</AnalysisProgressSubmit></form><button type="button" onClick={() => completeSharedAction("analysis")}>Complete analysis fixture response</button></section>
      </>}
    </main><ToastRegion />
  </div></ActivityProvider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
