"use client";

import { useRef, useState } from "react";
import styles from "./IntegrationScreenshots.module.css";

const captures = {
  square: { label: "Square", desktop: [792, 653], mobile: [358, 903], alt: "Vaeroex saved Square payments for Coastal Kitchen: three completed payments of USD 162, 81 and 108 on October 11, 2026. Previous connection; browsing does not import or update payments." },
  qbo: { label: "QuickBooks", desktop: [740, 439], mobile: [362, 479], alt: "Vaeroex QuickBooks Profit and Loss observation for October 6–12: net sales USD 27,600, gross profit 19,320 and net income 8,695.20, on an accrual basis. Report totals are not added to document amounts." },
  sheets: { label: "Google Sheets · Limited pilot", desktop: [740, 615], mobile: [362, 242], alt: "Vaeroex Google Sheets preview of weekly guest satisfaction: 95, 95 and 96 percent for September 28, October 5 and October 12. Preview does not import data." },
} as const;
const views = ["square", "qbo", "sheets"] as const;

export function IntegrationScreenshotTour() {
  const [view, setView] = useState<(typeof views)[number]>("square");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const capture = captures[view];
  const base = `/images/workspace-demo/integration-${view}`;
  return <div className={styles.tour} data-integration-captures>
    <div role="tablist" aria-label="Integration screenshot views" className={styles.tabs}>
      {views.map((key, index) => <button key={key} ref={element => { tabs.current[index] = element; }} type="button" role="tab" id={`integration-shot-tab-${key}`} aria-controls="integration-shot-panel" aria-selected={view === key} tabIndex={view === key ? 0 : -1} onClick={() => setView(key)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % views.length : event.key === "ArrowLeft" ? (index + views.length - 1) % views.length : event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : null;
        if (next !== null) { event.preventDefault(); setView(views[next]); tabs.current[next]?.focus(); }
      }}>{captures[key].label}</button>)}
    </div>
    <div role="tabpanel" id="integration-shot-panel" aria-labelledby={`integration-shot-tab-${view}`} tabIndex={0}>
      <figure className={styles.capture}>
        <a href={`${base}-desktop.webp`} target="_blank" rel="noopener noreferrer" className={styles.imageLink} aria-label={`Open full-size ${capture.label} screenshot`}>
          <picture>
            <source media="(max-width: 600px)" srcSet={`${base}-mobile.webp 2x`} width={capture.mobile[0]} height={capture.mobile[1]} />
            {/* Native 2× lossless captures, without resampling or edited interface content. */}
            <img key={view} src={`${base}-desktop.webp`} srcSet={`${base}-desktop.webp 2x`} width={capture.desktop[0]} height={capture.desktop[1]} alt={capture.alt} loading="lazy" decoding="async" />
          </picture>
        </a>
        <figcaption className={styles.caption}>Coastal Kitchen · Fictional business example</figcaption>
      </figure>
    </div>
  </div>;
}
