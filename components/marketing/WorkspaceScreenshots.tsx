"use client";

import { useRef, useState } from "react";
import styles from "./WorkspaceScreenshots.module.css";

const captures = {
  intelligence: {"label": "Intelligence", "title": "Performance and information coverage, kept distinct.", "caption": "Coastal Kitchen’s healthy results sit alongside a separate view of information coverage. Both scores and the previous review are calculated from fictional records, not promised outcomes.", "alt": "Actual Vaeroex Intelligence screen for fictional Coastal Kitchen: Business Health 90 out of 100, Strong, and Intelligence Readiness 87 percent, Strong understanding.", "desktop": [920, 722], "mobile": [378, 929]},
  findings: {"label": "Findings", "title": "A finding you can investigate.", "caption": "Two supplier invoices are marked overdue. Vaeroex identifies the $600 total and recommends checking payment status and supplier dependency before acting.", "alt": "Actual Vaeroex supplier finding for Coastal Kitchen: two of six invoices marked overdue, totaling $600, Medium confidence, with a specific reconciliation step and an explicit limit on what the register proves.", "desktop": [736, 528], "mobile": [352, 762]},
  performance: {"label": "Performance", "title": "See the movement behind the latest number.", "caption": "Weekly sales history, a confirmed target, and the latest recorded value. The mobile detail focuses on the historical chart and its summary.", "alt": "Actual Vaeroex Performance view for fictional Coastal Kitchen: weekly net sales of $27,600 against a $24,000 target. The chart shows the latest 12 observations.", "desktop": [916, 956], "mobile": [346, 435]},
  notes: {"label": "Business Notes", "title": "Keep the context behind the figures.", "caption": "An unsubmitted meeting-note draft records operating context and the supplier follow-up. Review and approval remain a separate step.", "alt": "Actual Vaeroex Business Note editor containing a fictional Coastal Kitchen meeting draft, an October 12 observation date, and the Review and Extract Business Context action.", "desktop": [916, 790], "mobile": [378, 796]},
  evidence: {"label": "Supporting evidence", "title": "Follow a finding back to its records.", "caption": "Two dated invoices from one supplier register support this finding. Their recorded amounts are $420 and $180; current settlement status still needs confirmation.", "alt": "Actual Vaeroex evidence panel for Coastal Kitchen: two original invoice records totaling $600, one independent source, Medium evidence strength, and explicit missing payment-status evidence.", "desktop": [736, 840], "mobile": [352, 1078]},
} as const;
type CaptureView = keyof typeof captures;
const views = ["intelligence", "findings", "performance", "notes"] as const;

export function WorkspaceCapture({ view }: { view: CaptureView }) {
  const capture = captures[view];
  const base = `/images/workspace-demo/${view}`;
  return <figure className={styles.capture} data-workspace-capture={view}>
    <figcaption className={styles.caption}>
      <span className={styles.label}>Actual Vaeroex workspace · Demo data</span>
      <strong>{capture.title}</strong>
      <span>{capture.caption}</span>
    </figcaption>
    <a href={`${base}-desktop.webp`} target="_blank" rel="noopener noreferrer" className={styles.imageLink} aria-label={`Open full-size ${capture.label} screenshot`}>
      <picture>
        <source media="(max-width: 600px)" srcSet={`${base}-mobile.webp 2x`} width={capture.mobile[0]} height={capture.mobile[1]} />
        {/* Native 2× captures; dimensions below describe CSS pixels, not encoded pixels. */}
        <img src={`${base}-desktop.webp`} srcSet={`${base}-desktop.webp 2x`} width={capture.desktop[0]} height={capture.desktop[1]} alt={capture.alt} loading="lazy" decoding="async" />
      </picture>
    </a>
    <p className={styles.enlarge}>Select the image to view it at full size.</p>
  </figure>;
}

export function WorkspaceScreenshotTour() {
  const [view, setView] = useState<(typeof views)[number]>("intelligence");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  return <div className={styles.tour}>
    <div role="tablist" aria-label="Workspace screenshot views" className={styles.tabs}>
      {views.map((key, index) => <button key={key} ref={element => { tabs.current[index] = element; }} type="button" role="tab" id={`workspace-shot-tab-${key}`} aria-controls="workspace-shot-panel" aria-selected={view === key} tabIndex={view === key ? 0 : -1} onClick={() => setView(key)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % views.length : event.key === "ArrowLeft" ? (index + views.length - 1) % views.length : event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : null;
        if (next !== null) { event.preventDefault(); setView(views[next]); tabs.current[next]?.focus(); }
      }}>{captures[key].label}</button>)}
    </div>
    <div role="tabpanel" id="workspace-shot-panel" aria-labelledby={`workspace-shot-tab-${view}`} tabIndex={0}>
      <WorkspaceCapture view={view} />
    </div>
  </div>;
}
