/** Width/touch select a lighter renderer; only resource constraints suppress it. */
export function clarityDevicePolicy({
  reducedMotion,
  compact,
  saveData = false,
  memory,
  cores,
}: {
  reducedMotion: boolean;
  compact: boolean;
  saveData?: boolean;
  memory?: number;
  cores?: number;
}) {
  const constrained =
    (memory !== undefined && memory > 0 && memory <= 2) ||
    (cores !== undefined && cores > 0 && cores <= 2);
  return {
    compact:
      compact ||
      (memory !== undefined && memory > 0 && memory <= 4) ||
      (cores !== undefined && cores > 0 && cores <= 4),
    fallback: reducedMotion
      ? "reduced-motion"
      : saveData || constrained
        ? "low-power"
        : null,
  } as const;
}
