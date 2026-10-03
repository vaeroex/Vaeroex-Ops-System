import test from "node:test";
import assert from "node:assert/strict";
import { sandboxTarget, sandboxMaintenance, sandboxProvisioningProfile, sandboxProvisioningInstallation, nativeCapabilityAllowed } from "../sandbox-profile.mjs";
import { checkRecoveryClearance } from "../maintenance-policy.mjs";
import { createSandboxSecretManagerRestClient } from "../secret-manager-rest.mjs";

test("fixed profiles preserve callback and split role/capability/store/installation", () => {
  assert.equal(sandboxProvisioningProfile().target, sandboxTarget);
  assert.equal(sandboxProvisioningProfile().maintenance, sandboxMaintenance);
  const seen = new Set();
  for (const name of ["callback", "enroller", "runtime"]) {
    const p = sandboxProvisioningProfile(name);
    assert.equal(Object.isFrozen(p), true); assert.equal(Object.isFrozen(p.target), true);
    assert.equal(sandboxProvisioningInstallation(p.install).name, name);
    assert.equal(p.maintenance.instanceId, "9094944541973315575"); assert.equal(p.maintenance.zone, "us-west1-a");
    assert.equal(p.maintenance.serviceAccount, sandboxMaintenance.serviceAccount);
    assert.equal(p.target.systemIdentifier, sandboxTarget.systemIdentifier);
    assert.equal(nativeCapabilityAllowed(p.target), true);
    for (const value of [p.target.role, p.target.capabilityRole, p.maintenance.secretParent, p.install, p.state]) {
      assert.equal(seen.has(value), false); seen.add(value);
    }
    for (const other of ["callback", "enroller", "runtime"].filter(value => value !== name)) {
      const candidate = sandboxProvisioningProfile(other);
      assert.equal(nativeCapabilityAllowed({ ...p.target, capabilityRole: candidate.target.capabilityRole }), false);
    }
  }
  for (const value of ["latest", "production", "__proto__", "constructor", "enroller/../runtime", {}, null]) {
    assert.throws(() => sandboxProvisioningProfile(value)); assert.throws(() => sandboxProvisioningInstallation(value));
  }
});

test("mapped secret clients reject all other parents before token acquisition", async () => {
  for (const profile of ["enroller", "runtime"]) {
    let calls = 0;
    const client = createSandboxSecretManagerRestClient({ profile, withAccessToken: async () => { calls++; throw Error("synthetic"); } });
    for (const other of ["callback", "enroller", "runtime"].filter(value => value !== profile)) {
      const name = sandboxProvisioningProfile(other).maintenance.secretParent + "/versions/1";
      await assert.rejects(client.accessSecretVersion({ name }));
      await assert.rejects(client.disableSecretVersion({ name }));
    }
    assert.equal(calls, 0);
  }
});

test("mapped recovery clearance cannot authorize another role's recovery", () => {
  const now = 1000000;
  for (const profile of ["enroller", "runtime"]) {
    const p = sandboxProvisioningProfile(profile);
    const input = { profile, last: { intent: "prior" }, operation: "recover", roleOid: "42", intent: "next", approvalId: "approval", now,
      clearance: { priorIntent: "prior", nextIntent: "next", approvalId: "approval", projectReference: p.target.projectReference,
        targetRole: p.target.role, roleOid: "42", roleFenced: true, sessions: 0, unresolvedSecretVersions: false, expiresAt: now + 300000 } };
    assert.equal(checkRecoveryClearance(input), now + 300000);
    assert.throws(() => checkRecoveryClearance({ ...input, clearance: { ...input.clearance, targetRole: sandboxTarget.role } }));
    assert.throws(() => checkRecoveryClearance({ ...input, profile: "callback" }));
  }
});
