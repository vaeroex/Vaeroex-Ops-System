// These are public database/source identities, never connection credentials.
// The direct host proves project identity only. It is deliberately not an
// executable maintenance endpoint: the reviewed pooler host, CA file and
// provisioner VM/service-account identity have not yet been bound.
export const productionDatabaseIdentity = Object.freeze({
  projectReference: "mdiianhfrojmxqpwrflh",
  region: "us-west-2",
  directIdentityHost: "db.mdiianhfrojmxqpwrflh.supabase.co",
  database: "postgres",
  databaseOid: "5",
  systemIdentifier: "7642734024280108049",
  postgresBuild: "17.6.1.127",
});

export const productionSourcePins = Object.freeze({
  baselineVersion: "20260902191323",
  baselineMigrationCount: 102,
  baselineLedgerFingerprint: "sha256:3326a738d016df98e0fd22830b8c950dac3cc6d50bd26b61de1d9ebd282c201f",
  foundationSha256: "f8598ca685c795ad56bfdb7a29a1ded3da1c096d42ffb62ea4e123271db54c6d",
  overlayVersion: "20260902191324",
  overlayMigrationCount: 103,
  overlayLedgerFingerprint: "sha256:224d377fe3f44a59dabd188ad897624207830940a985e408e0072fb7941db146",
  overlaySha256: "2cc43a9313d056e58b75143f032f347cb0972f45cc1edbd484f6b1fb0574661f",
  internalRuntimeVersion: "20260902191325",
  internalRuntimeMigrationCount: 104,
  internalRuntimeLedgerFingerprint: "sha256:7dc51d888ee9c4a6bb595b1a4431ab5fcdb649e34c871ba91a6512d5fa2dc89f",
  internalRuntimeSha256: "f7e6f8f72357dafc1a5b6ad0566c2aa90293175420b84b593b98065370e45928",
});

const names = Object.freeze(["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"]);
const internalRuntimeAuthority = Object.freeze({
  oauth: "public.square_production_internal_oauth_v1(text,jsonb)",
  broker: "public.square_production_internal_broker_v1(text,jsonb)",
  scheduler: "public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)",
  webhook: "public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)",
  runtime: "public.square_production_internal_runtime_v1(text,jsonb)",
  evidence: "public.square_production_internal_evidence_v1(text,jsonb)",
});
const profiles = Object.freeze(Object.fromEntries(names.map(name => [name, Object.freeze({
  name,
  role: `square_production_${name}`,
  capabilityRole: `square_production_${name}_authority`,
  authorityRpcByPhase: Object.freeze({
    overlay: `public.check_square_production_${name}_authority_v1(text,text,text,bigint,text)`,
    internalRuntime: internalRuntimeAuthority[name],
  }),
  secretParent: `projects/vaeroex-integrations-prod/secrets/square-production-${name}-db`,
})])));

export const productionDeploymentBinding = Object.freeze({
  status: "blocked_pending_reviewed_identity_manifest",
  connectionHost: null,
  connectionPort: null,
  rootCertificate: null,
  provisionerProjectId: null,
  provisionerInstanceId: null,
  provisionerZone: null,
  provisionerServiceAccount: null,
  provisionerProjectNumber: null,
  adminRole: null,
  rootCaSha256: null,
});

export function productionProvisioningProfile(name) {
  if (typeof name !== "string" || !Object.hasOwn(profiles, name)) throw new Error("production_native_profile_denied");
  return profiles[name];
}

export function productionProvisioningProfiles() {
  return names.map(name => profiles[name]);
}

export function productionAuthorityRpc(name, phase) {
  const profile = productionProvisioningProfile(name);
  if (phase !== "overlay" && phase !== "internalRuntime") throw new Error("production_native_source_phase_denied");
  return profile.authorityRpcByPhase[phase];
}

export function productionCapabilityAllowed(target) {
  const role = typeof target?.role === "string" ? target.role : null;
  const capabilityRole = typeof target?.capabilityRole === "string" ? target.capabilityRole : null;
  const name = role?.match(/^square_production_(oauth|broker|scheduler|webhook|runtime|evidence)$/)?.[1];
  return typeof name === "string" && profiles[name].role === role && profiles[name].capabilityRole === capabilityRole;
}

const installs = Object.freeze(Object.fromEntries(names.map(name => [name, Object.freeze({
  install: `/opt/vaeroex-production-square-${name}`,
  state: `/var/lib/vaeroex-production-square-${name}`,
})])));

function bound() {
  const pin = productionDeploymentBinding;
  if (pin.status !== "reviewed_ready" || typeof pin.connectionHost !== "string" ||
      !Number.isInteger(pin.connectionPort) || typeof pin.rootCertificate !== "string" ||
      typeof pin.provisionerProjectId !== "string" || typeof pin.provisionerProjectNumber !== "string" ||
      typeof pin.provisionerInstanceId !== "string" || typeof pin.provisionerZone !== "string" ||
      typeof pin.provisionerServiceAccount !== "string" || typeof pin.adminRole !== "string" ||
      typeof pin.rootCaSha256 !== "string") throw new Error("production_native_deployment_manifest_required");
  return pin;
}

export function productionProvisioningInstallation(install) {
  const name = names.find(candidate => installs[candidate].install === install);
  if (!name) throw new Error("production_native_profile_denied");
  const pin = bound(), profile = profiles[name];
  return Object.freeze({ kind: "production", name, ...installs[name],
    target: Object.freeze({ projectReference: productionDatabaseIdentity.projectReference,
      host: pin.connectionHost, port: pin.connectionPort, database: productionDatabaseIdentity.database,
      role: profile.role, systemIdentifier: productionDatabaseIdentity.systemIdentifier,
      databaseOid: productionDatabaseIdentity.databaseOid, adminRole: pin.adminRole,
      capabilityRole: profile.capabilityRole, rootCertificate: pin.rootCertificate, roleOid: "0" }),
    maintenance: Object.freeze({ projectId: pin.provisionerProjectId, projectNumber: pin.provisionerProjectNumber,
      instanceId: pin.provisionerInstanceId, zone: pin.provisionerZone, serviceAccount: pin.provisionerServiceAccount,
      secretParent: profile.secretParent, caSha256: pin.rootCaSha256 }),
  });
}

export function productionProvisioningBuildProfile(name) {
  productionProvisioningProfile(name);
  const install = installs[name];
  return productionProvisioningInstallation(install.install);
}
