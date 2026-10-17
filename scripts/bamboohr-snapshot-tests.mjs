import assert from "node:assert/strict";
import { test } from "node:test";
import { collectStaffingSnapshot } from "../lib/integrations/bamboohr/snapshot.ts";

const now = new Date("2026-10-17T12:00:00.000Z");

test("complete roster and approved requests produce bounded counts without carrying HR records forward", async () => {
  const paths = [];
  const result = await collectStaffingSnapshot(async (path) => {
    paths.push(path);
    if (path.startsWith("employees?")) return {
      data: [
        { employeeId: "1", status: "Active", firstName: "Do not retain" },
        { employeeId: "2", status: "Inactive", sensitiveField: "Do not retain" }
      ], meta: { total: 2, page: {} }
    };
    return [
      { status: "approved", notes: { note: "Do not retain" } },
      { status: "requested" }
    ];
  }, now);
  assert.deepEqual(result, {
    activeHeadcount: 1, rosterReadable: 2, rosterTotal: 2, approvedTimeOffRequests: 1
  });
  assert.match(paths[1], /excludeNote=true/);
  assert.match(paths[1], /start=2026-10-17/);
  assert.equal(JSON.stringify(result).includes("Do not retain"), false);
});

test("restricted employee status suppresses company headcount instead of showing a partial count", async () => {
  const result = await collectStaffingSnapshot(async (path) => path.startsWith("employees?") ? {
    data: [
      { employeeId: "1", status: "Active" },
      { employeeId: "2", status: null, _restrictedFields: ["status"] }
    ], meta: { total: 2, page: {} }
  } : [{ status: "approved" }], now);
  assert.equal(result.activeHeadcount, null);
  assert.equal(result.rosterReadable, 1);
  assert.equal(result.rosterTotal, 2);
});

test("missing page rejects the snapshot before it can be saved", async () => {
  await assert.rejects(collectStaffingSnapshot(async () => ({
    data: [{ employeeId: "1", status: "Active" }], meta: { total: 2, page: {} }
  }), now), /bamboohr_roster_incomplete/);
});

test("duplicate employees across pages reject the snapshot", async () => {
  await assert.rejects(collectStaffingSnapshot(async (path) => path.includes("page%5Bafter%5D") ? {
    data: [{ employeeId: "1", status: "Active" }], meta: { total: 2, page: {} }
  } : {
    data: [{ employeeId: "1", status: "Active" }], meta: { total: 2, page: { nextCursor: "next" } }
  }, now), /bamboohr_duplicate_employee/);
});
