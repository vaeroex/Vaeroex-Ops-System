"use client";

import { ArrowDownToLine, ArrowUpRight, Check } from "lucide-react";
import Link from "next/link";
import { useState, type MouseEvent } from "react";
import { BindingSiteViewer } from "./BindingSiteViewer";
import { approveRow, approvedCsv, type ApprovedRow } from "./shortlist";
import { assaySource, compounds, pdbUrl, type Compound, type CompoundId } from "./structures";
import styles from "./demo.module.css";

type Draft = Record<CompoundId, { included: boolean; reason: string }>;
type Approval = { at: string; rows: ApprovedRow[] };

export function CompoundDemo({ initialId }: { initialId: CompoundId }) {
  const [activeId,setActiveId] = useState(initialId);
  const [draft,setDraft] = useState<Draft>({ acetazolamide:{included:false,reason:""}, dorzolamide:{included:false,reason:""} });
  const [approved,setApproved] = useState<Approval | null>(null);
  const compound = compounds.find(c=>c.id===activeId)!;
  const selected = compounds.filter(c=>draft[c.id].included);
  const ready = selected.length > 0 && selected.every(c=>draft[c.id].reason.trim());
  const differs = !approved || JSON.stringify(approved.rows) !== JSON.stringify(selected.map(c=>approveRow(c,draft[c.id].reason)));
  function inspect(event: MouseEvent<HTMLAnchorElement>, id: CompoundId) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const url = new URL(window.location.href);
    url.searchParams.set("compound",id);
    window.history.replaceState(window.history.state, "", url);
    setActiveId(id);
  }
  function edit(id: CompoundId, update: Partial<Draft[CompoundId]>) {
    setDraft(prev=>({...prev,[id]:{...prev[id],...update}}));
  }
  function download() {
    if (!approved) return;
    const url = URL.createObjectURL(new Blob([approvedCsv(approved.rows,approved.at)],{type:"text/csv;charset=utf-8"}));
    const a = document.createElement("a");
    a.href=url; a.download="vaeroex-approved-sample-shortlist.csv";
    document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const chip = (c: Compound) => <a key={c.id} href={`?compound=${c.id}`} aria-current={activeId===c.id?"true":undefined} onClick={e=>inspect(e,c.id)}>
    {c.name} <small>{c.pdb}</small>
  </a>;
  return <>
    <nav className={styles.picker} aria-label="Choose a sample compound">{compounds.map(chip)}</nav>
    <section className={styles.research} aria-label="Experimental structure and evidence">
      <BindingSiteViewer key={activeId} compound={compound}/>
      <div className={styles.evidence}>
        <p className={styles.kicker}>Experimental structure</p>
        <h2>{compound.name}</h2>
        <p className={styles.target}>Human carbonic anhydrase II · Chain A</p>
        <dl className={styles.fields}>
          <div><dt>Protein Data Bank (PDB) entry</dt><dd><a href={pdbUrl(compound.pdb)}>{compound.pdb} <ArrowUpRight size={15}/></a></dd></div>
          <div><dt>Ligand in chain A</dt><dd>{compound.ligand} {compound.residue}</dd></div>
          <div><dt>X-ray resolution</dt><dd>{compound.resolution} Å</dd></div>
        </dl>
        <p>The deposited structure places the ligand’s {compound.nitrogen} nitrogen {compound.distance} ångströms (Å) from zinc. Dashed lines mark zinc coordination in the binding site.</p>
        <div className={styles.measure}>
          <span>Published lab measurement</span>
          <strong>Inhibition constant (K<sub>i</sub>) · {compound.ki} nM</strong>
          <p>K<sub>i</sub> measures inhibitor binding under the assay conditions. The value here is in nanomoles per litre.</p>
          <a href={assaySource}>Read assay table 1 <ArrowUpRight size={14}/></a>
        </div>
        <a className={styles.file} href={`/brand/compound-demo/${compound.pdb}.pdb`} download>Download source PDB <ArrowDownToLine size={14}/></a>
      </div>
    </section>
    <section className={styles.review} aria-labelledby="shortlist-heading">
      <div className={styles.reviewHeading}><p className={styles.kicker}>Researcher decision</p><h2 id="shortlist-heading">Build a sample shortlist</h2>
        <p>Choose the compounds you would advance and record your reasoning. This exercise stays in this page until you download the CSV.</p></div>
      <div className={styles.decisions}>
        {compounds.map(c=><div className={styles.decision} key={c.id}>
          <label className={styles.check}><input type="checkbox" checked={draft[c.id].included} onChange={e=>edit(c.id,{included:e.target.checked})}/>
            <span>Shortlist {c.name.toLowerCase()}</span></label>
          <a href={`?compound=${c.id}#sample-compounds`} onClick={e=>{inspect(e,c.id); if(e.defaultPrevented) document.getElementById("sample-compounds")?.scrollIntoView();}}>Inspect {c.pdb} <ArrowUpRight size={14}/></a>
          <label className={styles.note}>Reason for {c.name.toLowerCase()}
            <textarea rows={2} maxLength={400} placeholder="Record the evidence behind your choice." value={draft[c.id].reason} onChange={e=>edit(c.id,{reason:e.target.value})}/></label>
        </div>)}
      </div>
      <div className={styles.approval}>
        <button type="button" className={styles.primary} disabled={!ready || !differs} onClick={()=>setApproved({at:new Date().toISOString(),rows:selected.map(c=>approveRow(c,draft[c.id].reason))})}>
          <Check size={16}/>{approved?"Approve revised shortlist":"Approve sample shortlist"}</button>
        <p>{!selected.length?"Select at least one compound to approve.":!ready?"Add a reason for each selected compound to approve.": "Approval captures the compounds, reasons and evidence links together."}</p>
      </div>
      <div className={styles.snapshot} aria-live="polite">{approved && <>
        <h3>Approved snapshot</h3>
        <ul>{approved.rows.map(r=><li key={r.compound_id}><strong>{r.compound_name}</strong> · {r.researcher_reason}</li>)}</ul>
        {differs && <p>Your draft has changed. This download still contains the last approved snapshot.</p>}
        <button type="button" className={styles.primary} onClick={download}><ArrowDownToLine size={17}/>Download approved CSV</button>
      </>}</div>
    </section>
    <div className={styles.access}><Link className="vx-button vx-button--primary" href="/contact?inquiry=drug-discovery">Request access to use your own compounds <ArrowUpRight size={18}/></Link></div>
  </>;
}
