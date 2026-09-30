import { createHash } from "node:crypto";

// Supabase's published database CA, already verified in the repository. This
// trust root applies only to this PostgreSQL connection, not general fetches.
export const QBO_DATABASE_CA_SHA256 =
  "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";

export function qboDatabaseConfiguration(connectionString: string, ca: string) {
  const denied = () => new Error("qbo_production_database_tls_configuration_denied");
  let url: URL;
  try { url = new URL(connectionString); } catch { throw denied(); }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) ||
    url.port !== "5432" || url.pathname !== "/postgres" ||
    !url.username || !url.password || url.hash ||
    [...url.searchParams.keys()].some((key) => !["sslmode", "application_name"].includes(key)) ||
    (url.searchParams.has("sslmode") && !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode")!)) ||
    url.searchParams.getAll("sslmode").length > 1 ||
    typeof ca !== "string" || ca.length > 16_384 ||
    createHash("sha256").update(ca, "utf8").digest("hex") !== QBO_DATABASE_CA_SHA256
  ) throw denied();
  // pg-connection-string can override the explicit ssl object when sslmode is
  // present. Remove it so certificate AND hostname verification always apply.
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: { ca, rejectUnauthorized: true as const },
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true
  };
}
