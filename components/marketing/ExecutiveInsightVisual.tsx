import styles from "./ExecutiveInsightVisual.module.css";

/** An editorial illustration, deliberately distinct from an actual product capture. */
export function ExecutiveInsightVisual() {
  return (
    <figure className={styles.visual} aria-labelledby="executive-insight-title">
      <figcaption className={styles.label}>
        EXECUTIVE INTELLIGENCE <span>Illustrative example</span>
      </figcaption>
      <h3 id="executive-insight-title">
        Sales grew.
        <br />
        <em>Profit didn’t.</em>
      </h3>
      <p className={styles.question}>What changed beneath the headline?</p>
      <div className={styles.charts}>
        <div className={styles.chart}>
          <h4>
            Revenue <span>+20%</span>
          </h4>
          <div
            className={styles.bars}
            aria-label="Revenue: prior period $20,000; latest period $24,000"
          >
            <div>
              <strong>$20,000</strong>
              <i style={{ height: 100 }} />
              <span>Prior</span>
            </div>
            <div>
              <strong>$24,000</strong>
              <i style={{ height: 120 }} />
              <span>Latest</span>
            </div>
          </div>
        </div>
        <div className={`${styles.chart} ${styles.profit}`}>
          <h4>
            Net profit <span>−10%</span>
          </h4>
          <div
            className={styles.bars}
            aria-label="Net profit: prior period $4,000; latest period $3,600"
          >
            <div>
              <strong>$4,000</strong>
              <i style={{ height: 120 }} />
              <span>Prior</span>
            </div>
            <div>
              <strong>$3,600</strong>
              <i style={{ height: 108 }} />
              <span>Latest</span>
            </div>
          </div>
        </div>
      </div>
      <p className={styles.scale}>
        Comparable periods · USD · Each chart starts at zero; scales differ.
      </p>
      <div className={styles.connection}>
        <span>CONNECT THE EVIDENCE</span>
        <p>
          Revenue rose <b>$4,000.</b> Expenses rose <b>$4,400.</b> The extra
          sales didn’t cover the increase in costs.
        </p>
        <div className={styles.margin}>
          <span>Net margin</span>
          <strong>
            20% <span>→</span> 15%
          </strong>
        </div>
      </div>
      <div className={styles.sources}>
        <div>
          <span>01 / SOURCE</span>
          <strong>Two comparable P&amp;Ls</strong>
          <p>Revenue, expenses, and profit from the same reporting basis.</p>
        </div>
        <div>
          <span>02 / NEXT QUESTION</span>
          <strong>Which costs changed?</strong>
          <p>Review the expense breakdown before deciding what to change.</p>
        </div>
      </div>
      <p className={styles.note}>
        Fictional figures. An illustration of evidence-led analysis, not a
        product screenshot or a promised result.
      </p>
    </figure>
  );
}
