import type { VsiCitation } from "@/lib/vsi/types";
import { parseComparisons } from "./comparison";
/** Old citations without chart snapshots remain valid; no values are reconstructed from prose. */
export function vsiComparisons(citations: readonly VsiCitation[]) {
  return citations.flatMap(source => source.sourceType === "financial_calculation" ? parseComparisons(source.comparisons) : []).slice(0, 6);
}
