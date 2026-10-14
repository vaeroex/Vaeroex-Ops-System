"use client";
import { useRef, useState } from "react";
import styles from "./WorkspaceScreenshots.module.css";
const views = [
  {
    key: "answer",
    label: "The answer",
    title: "Sales are up. Are you keeping more?",
    caption:
      "VSI connects Coastal Kitchen’s sales, costs, and net profit in one cited answer.",
    desktop: [930, 233],
    mobile: [360, 360],
    narrow: [290, 408],
    alt: "Actual Coastal Kitchen VSI conversation: revenue increased $400, net income fell $357.60, and net margin declined from 33.28% to 31.50%.",
  },
  {
    key: "comparison",
    label: "The evidence",
    title: "See the numbers behind the answer.",
    caption:
      "Compare the saved reporting periods. Desktop shows revenue and net income; mobile focuses on net income.",
    desktop: [930, 518],
    mobile: [360, 430],
    narrow: [290, 431],
    alt: "Actual VSI evidence comparison charts for Coastal Kitchen: revenue increases from $27,200 to $27,600 while net income falls from $9,052.80 to $8,695.20. The mobile capture shows net income. Reporting dates and coverage limitations are visible.",
  },
] as const;
export function HomepageWorkspaceTour() {
  const [selected, setSelected] = useState(1);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const view = views[selected];
  const base = `/images/workspace-demo/vsi-financial-${view.key === "answer" ? "answer" : "charts"}`;
  return (
    <div className={styles.tour} data-home-workspace-tour>
      <div
        role="tablist"
        aria-label="Coastal Kitchen workspace example"
        className={styles.tabs}
      >
        {views.map((item, i) => (
          <button
            key={item.key}
            ref={(node) => {
              tabs.current[i] = node;
            }}
            type="button"
            role="tab"
            id={`home-workspace-${item.key}`}
            aria-controls="home-workspace-panel"
            aria-selected={i === selected}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => setSelected(i)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (i + 1) % 2
                  : event.key === "ArrowLeft"
                    ? (i + 1) % 2
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                setSelected(next);
                tabs.current[next]?.focus();
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="home-workspace-panel"
        aria-labelledby={`home-workspace-${view.key}`}
        tabIndex={0}
      >
        <figure className={styles.capture}>
          <div className={styles.caption}>
            <strong>{view.title}</strong>
            <span>{view.caption}</span>
          </div>
          <a
            className={styles.imageLink}
            href={`${base}-desktop.webp`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open full-size Coastal Kitchen ${view.label.toLowerCase()} screenshot`}
          >
            <picture>
              <source media="(max-width:360px)" srcSet={`${base}-narrow.webp 2x`} width={view.narrow[0]} height={view.narrow[1]} />
              <source
                media="(max-width:600px)"
                srcSet={`${base}-mobile.webp 2x`}
                width={view.mobile[0]}
                height={view.mobile[1]}
              />
              <img
                key={view.key}
                src={`${base}-desktop.webp`}
                srcSet={`${base}-desktop.webp 2x`}
                width={view.desktop[0]}
                height={view.desktop[1]}
                alt={view.alt}
                loading="lazy"
                decoding="async"
              />
            </picture>
          </a>
        </figure>
      </div>
      <p className={styles.attribution}>
        Excerpts from one recorded VSI answer using saved P&amp;Ls.{" "}
        <a
          href="/images/workspace-demo/coastal-kitchen-financial-conversation.txt"
          target="_blank"
          rel="noopener noreferrer"
        >
          Read the full answer and sources
        </a>
        .
      </p>
    </div>
  );
}
