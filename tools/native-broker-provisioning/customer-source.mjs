import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const customerMigrationVersion = "20260925032300";
export const customerMigrationSha256 = "4e35c1cb33fd0a793611c2bf3ee43539ba95d00a47ca79fdd2e492b28bdad146";
export const customerMigrationFile = fileURLToPath(new URL(
  "../../supabase/production-migrations/20260925032300_square_production_customer_connection.sql", import.meta.url));

// Exact extra contract for the customer phase; never accepts arbitrary later
// ledgers or extra reachable RPCs. Builder and disposable native tests share it.
export function customerNativeContract() {
  const source = readFileSync(customerMigrationFile, "utf8");
  if (createHash("sha256").update(source).digest("hex") !== customerMigrationSha256) {
    throw new Error("production_customer_source_pin_denied");
  }
  const signatures = [
    "private.square_production_customer_fingerprint_v1(text[])",
    "private.square_production_customer_require_keys_v1(jsonb,text[])",
    "private.square_production_customer_require_login_v1(text)",
    "private.square_production_customer_require_owner_v1(uuid,uuid,uuid,uuid)",
    "private.square_production_customer_require_eligible_v1(uuid)",
    "private.square_production_customer_require_gate_v1(bigint,text,text)",
    "private.square_production_customer_immutable_v1()",
    "public.square_production_customer_v1(text,jsonb)",
  ];
  const tuples = signatures.map(signature => {
    const name = signature.slice(0, signature.indexOf("("));
    const definition = source.match(new RegExp(`create function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?as \\$function\\$([\\s\\S]*?)\\$function\\$;`));
    if (!definition) throw new Error("production_customer_source_pin_denied");
    return `('${signature}','${createHash("sha256").update(definition[1]).digest("hex")}')`;
  });
  const sql = `WITH expected(signature,hash) AS (VALUES ${tuples.join(",")})
    SELECT (SELECT count(*)=8 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('private','public') AND left(p.proname,27)='square_production_customer_')
    AND NOT EXISTS (SELECT FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
      WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.proconfig IS DISTINCT FROM array['search_path=""']::text[]
        OR encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')<>e.hash
        OR (e.signature LIKE 'public.%' AND (NOT p.prosecdef OR p.prorettype<>'jsonb'::regtype))
        OR EXISTS (SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee<>p.proowner AND NOT (e.signature LIKE 'public.%' AND NOT a.is_grantable
            AND a.privilege_type='EXECUTE' AND a.grantee IN ('authenticated'::regrole,
              'square_production_oauth_authority'::regrole,'square_production_broker_authority'::regrole))))
    AND (SELECT count(*)=3 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      WHERE p.oid=to_regprocedure('public.square_production_customer_v1(text,jsonb)')
        AND a.grantee<>p.proowner AND NOT a.is_grantable AND a.privilege_type='EXECUTE')
    AND (SELECT count(*)=4 FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname='private' AND r.relname IN ('square_production_customer_bindings',
        'square_production_customer_connections','square_production_customer_oauth_states','square_production_customer_credentials')
        AND r.relkind='r' AND r.relowner='postgres'::regrole AND r.relrowsecurity AND r.relforcerowsecurity
        AND NOT EXISTS (SELECT FROM aclexplode(r.relacl) a WHERE a.grantee<>r.relowner)
        AND NOT EXISTS (SELECT FROM pg_attribute col CROSS JOIN LATERAL aclexplode(col.attacl) a
          WHERE col.attrelid=r.oid AND a.grantee<>r.relowner)
        AND NOT EXISTS (SELECT FROM pg_policy WHERE polrelid=r.oid))`;
  return { sql, sha256: customerMigrationSha256 };
}
