import styles from "./EvidenceVisualization.module.css";

/** A static teaching example; no customer data or product results are represented. */
export function EvidenceVisualization({
  className = "",
}: {
  className?: string;
}) {
  return (
    <figure
      className={`${styles.evidence} ${className}`}
      aria-label="An illustrative evidence trail using synthetic financial figures"
    >
      <figcaption className={styles.caption}>
        <span>
          <i aria-hidden="true" /> ANATOMY OF A FINDING
        </span>
        <span className={styles.sample}>ILLUSTRATIVE / SYNTHETIC DATA</span>
      </figcaption>

      <div className={styles.trail}>
        <section className={styles.source} aria-label="Source information">
          <p className={styles.step}>
            <span>01</span> SOURCE INFORMATION
          </p>
          <h3>Begin with the figures.</h3>
          <p className={styles.context}>Two supplied lines. Currency: USD.</p>
          <table className={styles.table}>
            <caption className={styles.srOnly}>
              Synthetic revenue and listed costs for two undated periods
            </caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Period A</th>
                <th scope="col">Period B</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  Revenue <span>+12%</span>
                </th>
                <td>$100,000</td>
                <td>$112,000</td>
              </tr>
              <tr>
                <th scope="row">
                  Listed costs <span>+18%</span>
                </th>
                <td>$70,000</td>
                <td>$82,600</td>
              </tr>
            </tbody>
          </table>
          <p className={styles.sourceNote}>
            Change is relative to Period A. No dates or additional cost
            categories are supplied.
          </p>
        </section>

        <div className={styles.connector} aria-hidden="true">
          <svg viewBox="0 0 52 32" fill="none">
            <path d="M0 16H45M40 11l5 5-5 5" />
            <circle cx="4" cy="16" r="2.5" />
          </svg>
        </div>

        <section
          className={styles.interpretation}
          aria-label="Interpretation of the supplied figures"
        >
          <p className={styles.step}>
            <span>02</span> INTERPRETATION
          </p>
          <h3>Growth has a second story.</h3>
          <div className={styles.result}>
            <strong>
              −3.75<span>pp</span>
            </strong>
            <p>
              Change in illustrative margin
              <br />
              <span>Percentage points · A to B</span>
            </p>
          </div>
          <div className={styles.comparison}>
            <div>
              <span>A</span>
              <i aria-hidden="true">
                <b style={{ width: "30%" }} />
              </i>
              <strong>30.00%</strong>
            </div>
            <div>
              <span>B</span>
              <i aria-hidden="true">
                <b style={{ width: "26.25%" }} />
              </i>
              <strong>26.25%</strong>
            </div>
          </div>
          <p className={styles.takeaway}>
            On these inputs, listed costs grow faster than revenue. The
            calculated margin narrows.
          </p>
        </section>
      </div>

      <div className={styles.calculation}>
        <p className={styles.calculationLabel}>
          THE CALCULATION <span>(revenue − listed costs) ÷ revenue</span>
        </p>
        <div className={styles.equations}>
          <p>
            <span>A</span>
            <span>
              ($100,000 − $70,000) ÷ $100,000 <b>= 30.00%</b>
            </span>
          </p>
          <p>
            <span>B</span>
            <span>
              ($112,000 − $82,600) ÷ $112,000 <b>= 26.25%</b>
            </span>
          </p>
        </div>
      </div>

      <section
        className={styles.limits}
        aria-label="Limitations of this example"
      >
        <div className={styles.limitsHeading}>
          <p className={styles.step}>
            <span>03</span> LIMITATIONS
          </p>
          <h3>The context still matters.</h3>
        </div>
        <dl className={styles.limitList}>
          <div>
            <dt>Period</dt>
            <dd>A and B are undated. Comparability is unverified.</dd>
          </div>
          <div>
            <dt>Coverage</dt>
            <dd>Only listed costs are included. Other expenses are unknown.</dd>
          </div>
          <div>
            <dt>Freshness</dt>
            <dd>
              No “as of” date is supplied. Current conditions are unknown.
            </dd>
          </div>
        </dl>
      </section>
      <p className={styles.disclosure}>
        Invented figures for explanation. This is not customer data, a product
        result, or a complete profitability assessment.
      </p>
    </figure>
  );
}
