import "server-only";

import { z } from "zod";
import type { QboReadOnlyClient } from "@/lib/integrations/provider-runtime/qbo/client";
import { QBO_MASTER_RECORD_TYPES, QBO_TRANSACTION_RECORD_TYPES, type QboSupportedObjectType } from "@/lib/integrations/providers/qbo/contracts";
import { QBO_CDC_LOOKBACK_DAYS, QBO_CDC_OVERLAP_SECONDS, QBO_CDC_RESPONSE_OBJECT_CAP } from "@/lib/integrations/providers/qbo/planning";

export class QboCdcCoverageError extends Error {
  constructor(readonly code: "qbo_cdc_lookback_gap" | "qbo_cdc_single_entity_cap" | "qbo_cdc_window_invalid") {
    super(code);
    this.name = "QboCdcCoverageError";
  }
}

const instant = z.string().datetime({ offset: true });
const cdcTypes: readonly QboSupportedObjectType[] = [
  ...QBO_MASTER_RECORD_TYPES.filter(type => type !== "CompanyInfo" && type !== "Preferences"),
  ...QBO_TRANSACTION_RECORD_TYPES
];

/** Fetch every partition before callers persist records or advance a watermark. */
export async function fetchCompleteQboCdc(input: {
  client: Pick<QboReadOnlyClient, "fetchCdc">;
  changedSince: string;
  until: string;
  accessToken: string;
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  const start = instant.safeParse(input.changedSince), end = instant.safeParse(input.until);
  if (!start.success || !end.success) throw new QboCdcCoverageError("qbo_cdc_window_invalid");
  const startMs = Date.parse(start.data), endMs = Date.parse(end.data), requestedAt = now().getTime();
  if (startMs > endMs || endMs > requestedAt) throw new QboCdcCoverageError("qbo_cdc_window_invalid");
  const earliest = requestedAt - QBO_CDC_LOOKBACK_DAYS * 86_400_000;
  if (startMs < earliest) throw new QboCdcCoverageError("qbo_cdc_lookback_gap");
  const changedSince = new Date(Math.max(earliest, startMs - QBO_CDC_OVERLAP_SECONDS * 1_000)).toISOString();
  let requestCount = 0;
  const visit = async (recordTypes: readonly QboSupportedObjectType[]): Promise<Awaited<ReturnType<QboReadOnlyClient["fetchCdc"]>>["records"]> => {
    // Queue delay and time spent in previous partitions cannot silently truncate coverage.
    if (startMs < now().getTime() - QBO_CDC_LOOKBACK_DAYS * 86_400_000) {
      throw new QboCdcCoverageError("qbo_cdc_lookback_gap");
    }
    const page = await input.client.fetchCdc({ recordTypes, changedSince, accessToken: input.accessToken });
    requestCount += 1;
    if (page.observedObjectCount < QBO_CDC_RESPONSE_OBJECT_CAP) return page.records;
    if (recordTypes.length === 1) throw new QboCdcCoverageError("qbo_cdc_single_entity_cap");
    // CDC has no upper-bound parameter; split entity sets, never time windows.
    const midpoint = Math.ceil(recordTypes.length / 2);
    return [...await visit(recordTypes.slice(0, midpoint)), ...await visit(recordTypes.slice(midpoint))];
  };
  return { records: await visit(cdcTypes), requestCount, watermarkAt: new Date(endMs).toISOString() };
}
