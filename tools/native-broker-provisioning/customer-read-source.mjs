import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {customerCatalogSql} from "./customer-source.mjs";
export const customerReadMigrationVersion="20260926232356";
export const customerReadMigrationFile=fileURLToPath(new URL("../../supabase/production-migrations/20260926232356_square_production_customer_first_read.sql",import.meta.url));
// Filled only from the exact disposable PostgreSQL qualification receipt.
export const customerReadCatalogSha256="aee6932d1ab3bd7fdbd42f2b5065355d0bc47fc9ba073e68cd4702e74a25b653";
export const customerReadRelations=["square_production_workspace_read_bindings","square_production_workspace_locations",
  "square_production_workspace_mappings","square_production_workspace_scans","square_production_workspace_payment_observations"];
export const customerReadCatalogSql=customerCatalogSql.replace(
  /r\.relname IN \('square_production_customer_bindings',[\s\S]*?'square_production_customer_credentials'\)/,
  `r.relname IN (${customerReadRelations.map(name=>`'${name}'`).join(",")})`);
export function customerReadNativeContract(){
  const source=readFileSync(customerReadMigrationFile,"utf8");
  const signatures=["private.square_production_workspace_read_context_v1(uuid,bigint,uuid,uuid,bigint)","public.square_production_workspace_read_v1(text,jsonb)"];
  const tuples=signatures.map(signature=>{
    const name=signature.split("(")[0];const body=source.match(new RegExp(`create function ${name.replaceAll(".","\\.")}\\([\\s\\S]*?as \\$function\\$([\\s\\S]*?)\\$function\\$;`))?.[1];
    if(!body)throw Error("customer_read_source_denied");
    return `('${signature}','${createHash("sha256").update(body).digest("hex")}')`;
  });
  const sql=`WITH expected(signature,hash) AS (VALUES ${tuples.join(",")})
    SELECT NOT EXISTS(SELECT FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
      WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
      OR p.proconfig IS DISTINCT FROM array['search_path=""']::text[]
      OR encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')<>e.hash
      OR EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner
        AND NOT(e.signature LIKE 'public.%' AND NOT a.is_grantable AND a.privilege_type='EXECUTE'
          AND a.grantee IN('authenticated'::regrole,'square_production_broker_authority'::regrole,'square_production_runtime_authority'::regrole))))
    AND (SELECT count(*)=3 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      WHERE p.oid=to_regprocedure('public.square_production_workspace_read_v1(text,jsonb)') AND a.grantee<>p.proowner)
    AND (SELECT count(*)=5 FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname='private' AND r.relname IN(${customerReadRelations.map(name=>`'${name}'`).join(",")})
      AND r.relkind='r' AND r.relpersistence='p' AND r.relowner='postgres'::regrole AND r.relrowsecurity AND r.relforcerowsecurity
      AND NOT EXISTS(SELECT FROM pg_rewrite WHERE ev_class=r.oid)
      AND NOT EXISTS(SELECT FROM aclexplode(r.relacl) a WHERE a.grantee<>r.relowner)
      AND NOT EXISTS(SELECT FROM pg_attribute col CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE col.attrelid=r.oid AND a.grantee<>r.relowner)
      AND NOT EXISTS(SELECT FROM pg_policy WHERE polrelid=r.oid))
    AND (${customerReadCatalogSql})='${customerReadCatalogSha256}'`;
  return {sql,sha256:createHash("sha256").update(source).digest("hex")};
}
