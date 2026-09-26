import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const customerMigrationVersion = "20260925032300";
export const customerMigrationSha256 = "59261c8a3cc8c09cd83ea3817f5ad3adba89ef89aa735a1a611b3f3858ad3c92";
export const customerMigrationFile = fileURLToPath(new URL(
  "../../supabase/production-migrations/20260925032300_square_production_customer_connection.sql", import.meta.url));

// OID-independent PostgreSQL 17 catalog contract for exactly these four
// migration-defined tables, including both sides of their foreign keys. The
// fingerprint is qualified under the native profile's exact pg_catalog path;
// public/private relation identities remain fully represented.
export const customerCatalogSha256 = "eb6bb3581d7b3b04c91adabbea4ec764302b53de02f24c001b16681080c576e0";
export const customerCatalogSql = `WITH protected AS (
  SELECT r.* FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname='private' AND r.relname IN ('square_production_customer_bindings',
    'square_production_customer_connections','square_production_customer_oauth_states','square_production_customer_credentials')
) SELECT encode(extensions.digest(convert_to(jsonb_build_object(
  'columns',coalesce((SELECT jsonb_agg(jsonb_build_array(r.relname,a.attnum,a.attname,
    format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
    pg_get_expr(d.adbin,d.adrelid,true),CASE WHEN a.attcollation=0 THEN NULL
      ELSE format('%I.%I',cn.nspname,col.collname) END,col.collprovider::text,col.collisdeterministic,col.collversion)
    ORDER BY r.relname,a.attnum) FROM protected r JOIN pg_attribute a ON a.attrelid=r.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum
    LEFT JOIN pg_collation col ON col.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=col.collnamespace
    WHERE a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
  'constraints',coalesce((SELECT jsonb_agg(jsonb_build_array(r.relname,c.conname,c.contype,
    c.condeferrable,c.condeferred,c.convalidated,pg_get_constraintdef(c.oid,true)) ORDER BY r.relname,c.conname)
    FROM protected r JOIN pg_constraint c ON c.conrelid=r.oid),'[]'::jsonb),
  'indexes',coalesce((SELECT jsonb_agg(jsonb_build_array(r.relname,ir.relname,i.indisvalid,i.indisready,
    i.indislive,pg_get_indexdef(i.indexrelid,0,true)) ORDER BY r.relname,ir.relname)
    FROM protected r JOIN pg_index i ON i.indrelid=r.oid JOIN pg_class ir ON ir.oid=i.indexrelid),'[]'::jsonb),
  'triggers',coalesce((SELECT jsonb_agg(jsonb_build_array(n.nspname,r.relname,
    CASE WHEN t.tgisinternal THEN c.conname ELSE t.tgname END,t.tgisinternal,t.tgenabled,t.tgtype,
    t.tgdeferrable,t.tginitdeferred,pn.nspname,p.proname,pg_get_function_identity_arguments(p.oid),
    pg_get_expr(t.tgqual,t.tgrelid,true),encode(t.tgargs,'hex'),t.tgattr::text,
    pg_get_constraintdef(c.oid,true)) ORDER BY n.nspname,r.relname,c.conname,t.tgisinternal,
      p.proname,t.tgtype,t.tgname) FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    JOIN pg_namespace pn ON pn.oid=p.pronamespace LEFT JOIN pg_constraint c ON c.oid=t.tgconstraint
    WHERE t.tgrelid IN (SELECT oid FROM protected) OR c.conrelid IN (SELECT oid FROM protected)),'[]'::jsonb)
)::text,'UTF8'),'sha256'),'hex')`;

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
        AND r.relkind='r' AND r.relpersistence='p' AND r.relowner='postgres'::regrole AND r.relrowsecurity AND r.relforcerowsecurity
        AND NOT EXISTS (SELECT FROM aclexplode(r.relacl) a WHERE a.grantee<>r.relowner)
        AND NOT EXISTS (SELECT FROM pg_attribute col CROSS JOIN LATERAL aclexplode(col.attacl) a
          WHERE col.attrelid=r.oid AND a.grantee<>r.relowner)
        AND NOT EXISTS (SELECT FROM pg_policy WHERE polrelid=r.oid))
    AND (${customerCatalogSql})='${customerCatalogSha256}'`;
  return { sql, sha256: customerMigrationSha256 };
}
