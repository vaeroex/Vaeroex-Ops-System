import type { CSSProperties } from "react";

type BusinessHealthInstrumentProps = {
  score: number | null;
  status: string;
};

export function BusinessHealthInstrument({ score, status }: BusinessHealthInstrumentProps) {
  const available = score !== null;
  const displayScore = available ? Math.max(0, Math.min(100, score)) : null;
  const style = {
    "--vaeroex-health-score": `${displayScore ?? 0}%`
  } as CSSProperties;

  return (
    <div
      className="vaeroex-health-instrument"
      data-available={available ? "true" : "false"}
      style={style}
      role="img"
      aria-label={available ? `Business Health score ${displayScore} out of 100. ${status}.` : `Business Health unavailable. ${status}.`}
    >
      <div className="vaeroex-health-instrument__ticks" aria-hidden="true">
        {Array.from({ length: 20 }, (_, index) => (
          <span key={index} style={{ "--vaeroex-health-tick": index } as CSSProperties} />
        ))}
      </div>
      <div className="vaeroex-health-instrument__inner-ring" aria-hidden="true" />
      <div className="vaeroex-health-instrument__face" aria-hidden="true">
        {available ? (
          <>
            <span className="vaeroex-health-instrument__score">{displayScore}</span>
            <span className="vaeroex-health-instrument__scale">out of 100</span>
          </>
        ) : (
          <span className="vaeroex-health-instrument__unavailable">Insufficient data</span>
        )}
      </div>
      <span className="vaeroex-health-instrument__datum" aria-hidden="true" />
    </div>
  );
}
