"use client";

import { useRef, useState } from "react";
import styles from "./WorkspaceScreenshots.module.css";

const captures = {
  intelligence: { label: "Intelligence", title: "Performance and information coverage, kept distinct.", caption: "Juniper Table’s sales and margin pressure sit alongside a separate view of information coverage. Scores come from the demo records, not a promised outcome.", alt: "Actual Vaeroex Intelligence screen for fictional Juniper Table: Business Health 20 out of 100, At Risk, and Intelligence Readiness 45 percent, Limited understanding.", desktop: [1410, 656], mobile: [335, 888] },
  findings: { label: "Findings", title: "A finding you can investigate.", caption: "Four weekly sales observations remain below the confirmed target. The selected finding explains the gap and states that its cause has not been established.", alt: "Actual Vaeroex findings list and selected sales finding for Juniper Table, showing $19,800 against a $24,000 target, Medium confidence, and a warning that KPI history does not establish the cause.", desktop: [1140, 1311], mobile: [336, 771] },
  performance: { label: "Performance", title: "See the movement behind the latest number.", caption: "Weekly sales history, a confirmed target, and the latest recorded value. The mobile detail focuses on the historical chart and its summary.", alt: "Actual Vaeroex Performance view for Juniper Table’s weekly net sales, with recorded sales declining to $19,800 and a confirmed $24,000 target. The chart shows the latest 12 observations.", desktop: [1140, 947], mobile: [353, 428] },
  notes: { label: "Business Notes", title: "Keep the context behind the figures.", caption: "An unsubmitted meeting-note draft records operating context and questions to investigate. Extraction and approval have not been performed.", alt: "Actual Vaeroex Business Note editor containing a fictional Juniper Table meeting draft, an October 12 observation date, and the Review and Extract Business Context action.", desktop: [1140, 1084], mobile: [361, 848] },
  evidence: { label: "Supporting evidence", title: "Follow a finding back to its records.", caption: "Four dated sales records from one source support this finding. Missing evidence remains explicit: the records establish the gap, not why it happened.", alt: "Actual Vaeroex evidence panel for a fictional Juniper Table sales finding: four supporting records, one independent source, Medium evidence strength, and a missing-evidence warning.", desktop: [719, 836], mobile: [336, 1016] },
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
        <source media="(max-width: 600px)" srcSet={`${base}-mobile.webp`} width={capture.mobile[0]} height={capture.mobile[1]} />
        {/* Art-directed screenshots retain their own intrinsic dimensions. */}
        <img src={`${base}-desktop.webp`} width={capture.desktop[0]} height={capture.desktop[1]} alt={capture.alt} loading="lazy" decoding="async" />
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
      {views.map((key, index) => <button key={key} ref={element => { tabs.current[index] = element; }} type="button" role="tab" id={`workspace-shot-tab-${key}`} aria-controls={`workspace-shot-panel-${key}`} aria-selected={view === key} tabIndex={view === key ? 0 : -1} onClick={() => setView(key)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % views.length : event.key === "ArrowLeft" ? (index + views.length - 1) % views.length : event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : null;
        if (next !== null) { event.preventDefault(); setView(views[next]); tabs.current[next]?.focus(); }
      }}>{captures[key].label}</button>)}
    </div>
    <div role="tabpanel" id={`workspace-shot-panel-${view}`} aria-labelledby={`workspace-shot-tab-${view}`} tabIndex={0}>
      <WorkspaceCapture view={view} />
    </div>
  </div>;
}
