import styles from "./VeteranOwned.module.css";

// U.S. flag proportions: 1:1.9 field, seven-stripe canton, and nine
// alternating rows of six and five stars. Geometry stays crisp at any size.
const stripeHeight = 100 / 13;
const starPoints = Array.from({ length: 10 }, (_, index) => {
  const angle = -Math.PI / 2 + (index * Math.PI) / 5;
  const radius = index % 2 === 0 ? 3.08 : 1.176;
  return `${(Math.cos(angle) * radius).toFixed(3)},${(Math.sin(angle) * radius).toFixed(3)}`;
}).join(" ");

export function VeteranOwned() {
  return (
    <p className={styles.detail}>
      <svg
        className={styles.flag}
        viewBox="0 0 190 100"
        width="57"
        height="30"
        role="img"
        aria-label="United States flag"
        focusable="false"
      >
        <rect width="190" height="100" fill="#fff" />
        {Array.from({ length: 7 }, (_, row) => (
          <rect
            key={row}
            y={row * stripeHeight * 2}
            width="190"
            height={stripeHeight}
            fill="#b31942"
          />
        ))}
        <rect width="76" height={stripeHeight * 7} fill="#0a3161" />
        {Array.from({ length: 9 }, (_, row) =>
          Array.from({ length: row % 2 === 0 ? 6 : 5 }, (_, column) => (
            <polygon
              key={`${row}-${column}`}
              points={starPoints}
              transform={`translate(${6.3 + column * 12.6 + (row % 2) * 6.3} ${5.4 + row * 5.4})`}
              fill="#fff"
            />
          )),
        )}
      </svg>
      <span className={styles.words}>
        <span className={styles.red}>Veteran</span>{" "}
        <span className={styles.white}>owned and</span>{" "}
        <span className={styles.blue}>operated</span>
      </span>
    </p>
  );
}
