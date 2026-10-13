"use client";

import { useRef, useState } from "react";
import styles from "./IntegrationScreenshots.module.css";

const captures = {
  recommendation: { label: "Recommendation", desktop: [786, 400], mobile: [372, 485], alt: "Actual Vaeroex conversation recommending a small Bring Someone New campaign for fictional Coastal Kitchen, citing sales, guest satisfaction and gross margin, while preserving uncertainty about referrals and capacity." },
  plan: { label: "Proposed plan", desktop: [786, 581], mobile: [372, 527], alt: "Actual Vaeroex campaign proposal: a $500 planning cap, with $250 for local promotion, up to $150 for shared items, and $50 each for materials and contingency. The budget is explicitly unapproved; channels and costs must be confirmed." },
} as const;
const views = ["recommendation", "plan"] as const;

export function VsiScreenshotTour() {
  const [view, setView] = useState<(typeof views)[number]>("recommendation");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const capture = captures[view];
  const base = `/images/workspace-demo/vsi-${view}`;
  return <div className={styles.tour} data-vsi-captures>
    <div role="tablist" aria-label="VSI conversation excerpts" className={styles.tabs}>
      {views.map((key, index) => <button key={key} ref={element => { tabs.current[index] = element; }} type="button" role="tab" id={`vsi-shot-tab-${key}`} aria-controls="vsi-shot-panel" aria-selected={view === key} tabIndex={view === key ? 0 : -1} onClick={() => setView(key)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % views.length : event.key === "ArrowLeft" ? (index + views.length - 1) % views.length : event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : null;
        if (next !== null) { event.preventDefault(); setView(views[next]); tabs.current[next]?.focus(); }
      }}>{captures[key].label}</button>)}
    </div>
    <div role="tabpanel" id="vsi-shot-panel" aria-labelledby={`vsi-shot-tab-${view}`} tabIndex={0}>
      <figure className={styles.capture}>
        <a href={`${base}-desktop.webp`} target="_blank" rel="noopener noreferrer" className={styles.imageLink} aria-label={`Open full-size VSI ${capture.label.toLowerCase()} screenshot`}>
          <picture>
            <source media="(max-width: 600px)" srcSet={`${base}-mobile.webp 2x`} width={capture.mobile[0]} height={capture.mobile[1]} />
            <img key={view} src={`${base}-desktop.webp`} srcSet={`${base}-desktop.webp 2x`} width={capture.desktop[0]} height={capture.desktop[1]} alt={capture.alt} loading="lazy" decoding="async" />
          </picture>
        </a>
        <figcaption className={styles.caption}>Coastal Kitchen · Fictional business example</figcaption>
      </figure>
    </div>
    <p className={styles.caption}>Excerpts from one actual VSI conversation. The campaign and budget are proposals for the owner to review. <a href="/images/workspace-demo/coastal-kitchen-vsi-conversation.txt" target="_blank" rel="noopener noreferrer" className={styles.transcriptLink}>Read the complete question, answer, and sources</a>.</p>
  </div>;
}
