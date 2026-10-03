"use client";

import { useState } from "react";
import {
  ArrowRight,
  FileText,
  FileSpreadsheet,
  NotebookPen,
  ScanLine,
} from "lucide-react";
import styles from "./SignalSequence.module.css";

const stages = [
  {
    title: "Bring your information",
    label: "01 / INPUT",
    headline: "Start with what you have.",
    copy: "Bring supported spreadsheets, reports, PDFs, and business notes into your private workspace. Keep the source context attached.",
    outcome: "Business information",
  },
  {
    title: "Understand the connections",
    label: "02 / CONTEXT",
    headline: "See the relationships.",
    copy: "View business conditions, performance movement, and supported findings together. Inspect the evidence and the limits behind an interpretation.",
    outcome: "Evidence in context",
  },
  {
    title: "Make an informed decision",
    label: "03 / PERSPECTIVE",
    headline: "Know where to look next.",
    copy: "Use the resulting context to prioritize a question, investigate a finding, or save an analysis. Recommendations remain drafts for your review.",
    outcome: "A clearer next question",
  },
] as const;

export function SignalSequence() {
  const [stage, setStage] = useState(0);
  const selected = stages[stage];
  return (
    <div className={styles.sequence}>
      <div
        className={styles.selectors}
        role="tablist"
        aria-label="From information to decisions"
      >
        {stages.map((item, index) => (
          <button
            key={item.label}
            id={`signal-tab-${index}`}
            role="tab"
            aria-selected={stage === index}
            aria-controls="signal-panel"
            tabIndex={stage === index ? 0 : -1}
            onClick={() => setStage(index)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? (index + 1) % 3
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? (index + 2) % 3
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 2
                        : null;
              if (next !== null) {
                event.preventDefault();
                setStage(next);
                document.getElementById(`signal-tab-${next}`)?.focus();
              }
            }}
          >
            <span>0{index + 1}</span>
            {item.title}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div
        className={styles.panel}
        id="signal-panel"
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`signal-tab-${stage}`}
      >
        <div className={styles.diagram} data-stage={stage} aria-hidden="true">
          <div className={styles.sources}>
            <span>
              <FileSpreadsheet size={19} />
              PERFORMANCE
            </span>
            <span>
              <FileText size={19} />
              REPORTS
            </span>
            <span>
              <NotebookPen size={19} />
              BUSINESS NOTES
            </span>
          </div>
          <div className={styles.connection}>
            <i />
            <i />
            <i />
          </div>
          <div className={styles.aperture}>
            <ScanLine size={30} />
            <span>VAEROEX</span>
          </div>
          <div className={styles.outputLine} />
          <div className={styles.output}>
            <i />
            <span>{selected.outcome}</span>
          </div>
        </div>
        <div className={styles.panelCopy}>
          <span>{selected.label}</span>
          <h3>{selected.headline}</h3>
          <p>{selected.copy}</p>
        </div>
        <p className={styles.caption}>
          CONCEPTUAL WORKFLOW / YOUR INFORMATION. YOUR JUDGMENT.
        </p>
      </div>
    </div>
  );
}
