import type { CSSProperties } from "react";

type BusinessHealthInstrumentProps = {
  score: number | null;
  status: string;
  variant?: "scorecard" | "arc";
};

// Both alternatives present the supplied score/status. They do not classify it.
export function BusinessHealthInstrument({ score, status, variant = "scorecard" }: BusinessHealthInstrumentProps) {
  const available = score !== null;
  const displayScore = available ? Math.max(0, Math.min(100, score)) : null;
  const segments = Array.from({ length: 10 }, (_, index) => ({
    index,
    fill: available ? Math.max(0, Math.min(100, ((displayScore ?? 0) - index * 10) * 10)) : 0
  }));

  return (
    <div
      className={`workspace-health-instrument workspace-health-instrument--${variant}`}
      data-available={available ? "true" : "false"}
      data-variant={variant}
      role="img"
      aria-label={available ? `Business Health score ${displayScore} out of 100. ${status}.` : `Business Health unavailable. ${status}.`}
    >
      {variant === "arc" ? (
        <svg className="workspace-health-instrument__arc" viewBox="0 0 280 155" aria-hidden="true">
          {segments.map(({ index, fill }) => {
            const start = Math.PI - (index * 18 + 1.5) * Math.PI / 180;
            const end = Math.PI - (index * 18 + 16.5) * Math.PI / 180;
            const point = (angle: number) => `${(140 + 123 * Math.cos(angle)).toFixed(3)} ${(140 - 123 * Math.sin(angle)).toFixed(3)}`;
            const path = `M ${point(start)} A 123 123 0 0 1 ${point(end)}`;
            return <g key={index}>
              <path d={path} pathLength="100" className="workspace-health-instrument__track" />
              {fill > 0 ? <path d={path} pathLength="100" strokeDasharray={`${fill} 100`} className="workspace-health-instrument__fill" /> : null}
            </g>;
          })}
        </svg>
      ) : null}
      <div className="workspace-health-instrument__value" aria-hidden="true">
        {available ? (
          <>
            <span className="workspace-health-instrument__score">{displayScore}</span>
            <span className="workspace-health-instrument__scale">out of 100</span>
          </>
        ) : (
          <span className="workspace-health-instrument__unavailable">Insufficient data</span>
        )}
      </div>
      {variant === "scorecard" ? (
        <div className="workspace-health-instrument__bar" aria-hidden="true">
          {segments.map(({ index, fill }) => <span key={index}><i style={{ "--health-segment-fill": `${fill}%` } as CSSProperties} /></span>)}
        </div>
      ) : null}
      <div className="workspace-health-instrument__range" aria-hidden="true"><span>0</span><span>100</span></div>
    </div>
  );
}
