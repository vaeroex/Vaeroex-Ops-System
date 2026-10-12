/** Customer allowances use decimal GB. Upload transport limits use binary MiB. */
export const INCLUDED_STORAGE_BYTES = 15_000_000_000;
export const INCLUDED_FILE_SLOTS = 500;
export const CAPACITY_PACK_BYTES = 10_000_000_000;
export const CAPACITY_PACK_FILE_SLOTS = 500;
export const CAPACITY_PACK_MONTHLY_CENTS = 500;
export const MAX_SELF_SERVE_PACKS = 10;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const TRASH_RETENTION_DAYS = 30;

export function capacityAllowance(packs: number) {
  if (!Number.isSafeInteger(packs) || packs < 0 || packs > MAX_SELF_SERVE_PACKS) {
    throw new RangeError("Capacity pack quantity is outside the qualified self-service limit.");
  }
  return {
    bytes: INCLUDED_STORAGE_BYTES + packs * CAPACITY_PACK_BYTES,
    files: INCLUDED_FILE_SLOTS + packs * CAPACITY_PACK_FILE_SLOTS,
    monthlyCents: packs * CAPACITY_PACK_MONTHLY_CENTS,
  };
}

export function storageWarning(used: number, allowance: number): "full" | "critical" | "warning" | null {
  if (allowance <= 0 || used >= allowance) return "full";
  if (used / allowance >= 0.95) return "critical";
  if (used / allowance >= 0.8) return "warning";
  return null;
}

export function formatStorageBytes(bytes: number, options: { gb?: boolean } = {}): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Not measured";
  if (options.gb && bytes > 0 && bytes < 1_000_000) return "<0.001 GB";
  if (options.gb) return `${(bytes / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 3 })} GB`;
  if (bytes === 0) return "0 bytes";
  if (bytes < 1_000) return `${bytes.toLocaleString("en-US")} bytes`;
  const unit = bytes >= 1_000_000_000 ? "GB" : bytes >= 1_000_000 ? "MB" : "KB";
  const divisor = unit === "GB" ? 1_000_000_000 : unit === "MB" ? 1_000_000 : 1_000;
  return `${(bytes / divisor).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}`;
}
