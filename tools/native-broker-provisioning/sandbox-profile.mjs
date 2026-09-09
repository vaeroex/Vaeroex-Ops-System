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
