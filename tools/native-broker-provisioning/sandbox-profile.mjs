// Public, immutable isolated maintenance target. These are not credentials.
export const sandboxTarget = Object.freeze({
  projectReference: "oysjpoondtcrqpghhrbd", host: "aws-0-us-west-2.pooler.supabase.com", port: 5432,
  database: "postgres", role: "square_sandbox_callback_broker", systemIdentifier: "7678069749886157684",
  databaseOid: "5", adminRole: "postgres", capabilityRole: "square_account_broker_authority",
  rootCertificate: "/etc/vaeroex-native-broker/supabase-root-2021.crt", roleOid: "0",
});
export const sandboxMaintenance = Object.freeze({
  projectId: "vaeroex-square-sandbox", projectNumber: "112579468800", instanceId: "9094944541973315575",
  zone: "us-west1-a", serviceAccount: "vx-square-sandbox-provisioner@vaeroex-square-sandbox.iam.gserviceaccount.com",
  secretParent: "projects/vaeroex-square-sandbox/secrets/square-sandbox-callback-db",
  caSha256: "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
});

// Selection is a reviewed installation/build choice, never arbitrary role,
// capability, host or Secret Manager input. Callback defaults remain unchanged.
const profiles = Object.freeze({
  callback: Object.freeze({ target: sandboxTarget, maintenance: sandboxMaintenance,
    install: "/opt/vaeroex-native-broker", state: "/var/lib/vaeroex-native-broker" }),
  enroller: Object.freeze({ target: Object.freeze({ ...sandboxTarget, role: "square_sandbox_enroller",
    capabilityRole: "square_verified_enrollment_authority" }),
    maintenance: Object.freeze({ ...sandboxMaintenance, secretParent: "projects/vaeroex-square-sandbox/secrets/square-sandbox-enroller-db" }),
    install: "/opt/vaeroex-native-enroller", state: "/var/lib/vaeroex-native-enroller" }),
  runtime: Object.freeze({ target: Object.freeze({ ...sandboxTarget, role: "square_sandbox_runtime",
    capabilityRole: "square_ingestion_runtime_authority" }),
    maintenance: Object.freeze({ ...sandboxMaintenance, secretParent: "projects/vaeroex-square-sandbox/secrets/square-sandbox-runtime-db" }),
    install: "/opt/vaeroex-native-runtime", state: "/var/lib/vaeroex-native-runtime" })
});
export function sandboxProvisioningProfile(name = "callback") {
  if (typeof name !== "string" || !Object.hasOwn(profiles, name)) throw new Error("native_profile_denied");
  return profiles[name];
}
export function sandboxProvisioningInstallation(install) {
  const name = Object.keys(profiles).find(name => profiles[name].install === install);
  if (!name) throw new Error("native_profile_denied");
  return Object.freeze({ name, ...profiles[name] });
}
export function nativeCapabilityAllowed(target) {
  return target.capabilityRole === "square_account_broker_authority" &&
    ![profiles.enroller.target.role, profiles.runtime.target.role].includes(target.role) ||
    ["enroller", "runtime"].some(name => target.role === profiles[name].target.role && target.capabilityRole === profiles[name].target.capabilityRole);
}
