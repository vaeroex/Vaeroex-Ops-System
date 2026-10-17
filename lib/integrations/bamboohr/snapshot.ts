import { z } from "zod";

const employeePage = z.object({
  data: z.array(z.object({
    employeeId: z.string(), status: z.string().nullable().optional(),
    _restrictedFields: z.array(z.string()).optional()
  }).passthrough()).max(250),
  meta: z.object({
    total: z.number().int().nonnegative(),
    page: z.object({ nextCursor: z.string().nullable().optional() }).passthrough()
  }).passthrough()
}).passthrough();
const timeOffRequests = z.array(z.object({ status: z.string() }).passthrough()).max(10_000);

export type StaffingSnapshot = {
  activeHeadcount: number | null;
  rosterReadable: number;
  rosterTotal: number;
  approvedTimeOffRequests: number;
};

export async function collectStaffingSnapshot(get: (path: string) => Promise<unknown>, now: Date): Promise<StaffingSnapshot> {
  let cursor: string | undefined, rosterTotal: number | null = null;
  let rosterReadable = 0, active = 0, fetched = 0;
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ "page[limit]": "250", fields: "status" });
    if (cursor) query.set("page[after]", cursor);
    const result = employeePage.parse(await get(`employees?${query}`));
    if (rosterTotal !== null && result.meta.total !== rosterTotal) throw new Error("bamboohr_roster_changed");
    rosterTotal = result.meta.total;
    fetched += result.data.length;
    for (const item of result.data) {
      if (seen.has(item.employeeId)) throw new Error("bamboohr_duplicate_employee");
      seen.add(item.employeeId);
      if (item.status == null || item._restrictedFields?.includes("status")) continue;
      rosterReadable++;
      if (item.status.toLowerCase() === "active") active++;
    }
    const next = result.meta.page.nextCursor ?? undefined;
    if (!next) {
      if (fetched !== rosterTotal) throw new Error("bamboohr_roster_incomplete");
      break;
    }
    if (next === cursor || page === 19) throw new Error("bamboohr_pagination_invalid");
    cursor = next;
  }
  if (rosterTotal === null) throw new Error("bamboohr_roster_unavailable");
  const end = new Date(now.getTime() + 13 * 86_400_000);
  const query = new URLSearchParams({ start: now.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10),
    status: "approved", excludeNote: "true" });
  const requests = timeOffRequests.parse(await get(`time_off/requests?${query}`));
  return { activeHeadcount: rosterReadable === rosterTotal ? active : null, rosterReadable, rosterTotal,
    approvedTimeOffRequests: requests.filter((request) => request.status === "approved").length };
}
