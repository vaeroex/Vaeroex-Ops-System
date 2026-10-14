"use client";

import { useRef, useState } from "react";
import styles from "./IntegrationScreenshots.module.css";

const captures = {
  financial: { label: "Costs & profitability", desktop: [930, 233], mobile: [360, 360], narrow: [290, 408], alt: "Actual VSI question and answer for Coastal Kitchen. Sales increased $400, but net income fell $357.60 and net margin declined from 33.28 to 31.50 percent, citing the recorded accrual P&L." },
  recommendation: { label: "Recommendation", desktop: [786, 400], mobile: [372, 485], narrow: [302, 605], alt: "Actual Vaeroex conversation recommending a small Bring Someone New campaign for fictional Coastal Kitchen, citing sales, guest satisfaction and gross margin, while preserving uncertainty about referrals and capacity." },
  plan: { label: "Proposed plan", desktop: [786, 581], mobile: [372, 527], narrow: [302, 621], alt: "Actual Vaeroex campaign proposal: a $500 planning cap, with $250 for local promotion, up to $150 for shared items, and $50 each for materials and contingency. The budget is explicitly unapproved; channels and costs must be confirmed." },
} as const;
const views = ["financial", "recommendation", "plan"] as const;

export function VsiScreenshotTour() {
  const [view, setView] = useState<(typeof views)[number]>("financial");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const capture = captures[view];
  const base = `/images/workspace-demo/vsi-${view === "financial" ? "financial-answer" : view}`;
  return <div className={`${styles.tour} ${styles.vsiTour} ${view === "financial" ? styles.financialTour : ""}`} data-vsi-captures>
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
            <source media="(max-width: 360px)" srcSet={`${base}-narrow.webp 2x`} width={capture.narrow[0]} height={capture.narrow[1]} />
            <source media="(max-width: 600px)" srcSet={`${base}-mobile.webp 2x`} width={capture.mobile[0]} height={capture.mobile[1]} />
            <img key={view} src={`${base}-desktop.webp`} srcSet={`${base}-desktop.webp 2x`} width={capture.desktop[0]} height={capture.desktop[1]} alt={capture.alt} loading="lazy" decoding="async" />
          </picture>
        </a>
        {view === "financial" && <a href="/images/workspace-demo/vsi-financial-charts-desktop.webp" target="_blank" rel="noopener noreferrer" className={`${styles.imageLink} ${styles.comparisonImage}`} aria-label="Open full-size VSI financial comparison charts">
          <picture>
            <source media="(max-width: 360px)" srcSet="/images/workspace-demo/vsi-financial-charts-narrow.webp 2x" width={290} height={431} />
            <source media="(max-width: 600px)" srcSet="/images/workspace-demo/vsi-financial-charts-mobile.webp 2x" width={360} height={430} />
            <img src="/images/workspace-demo/vsi-financial-charts-desktop.webp" srcSet="/images/workspace-demo/vsi-financial-charts-desktop.webp 2x" width={930} height={518} alt="Actual VSI evidence charts comparing September 29–October 5 with October 6–12, 2026. Revenue rises from $27,200 to $27,600 while net income falls from $9,052.80 to $8,695.20. The mobile crop focuses on net income; source coverage and reconciliation limitations remain visible." loading="lazy" decoding="async" />
          </picture>
        </a>}
        <figcaption className={styles.caption}>Coastal Kitchen · Fictional business example</figcaption>
      </figure>
    </div>
    {view === "financial" ? <p className={styles.caption}>An actual VSI answer using recorded QuickBooks P&amp;L evidence. It identifies an expense increase to investigate; it does not establish the cause or equate profit with cash flow. <a href="/images/workspace-demo/coastal-kitchen-financial-conversation.txt" target="_blank" rel="noopener noreferrer" className={styles.transcriptLink}>Read the complete financial question, answer, and sources</a>.</p> : <p className={styles.caption}>Excerpts from one actual VSI conversation. The campaign and budget are proposals for the owner to review. <a href="/images/workspace-demo/coastal-kitchen-vsi-conversation.txt" target="_blank" rel="noopener noreferrer" className={styles.transcriptLink}>Read the complete question, answer, and sources</a>.</p>}
  </div>;
}
