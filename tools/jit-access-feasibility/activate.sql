\set ON_ERROR_STOP on
BEGIN;
\ir target-gate.sql
SELECT pg_catalog.set_config('vaeroex_jit.expected_role_oid', :'expected_role_oid', true);
DO $activate$
DECLARE
  target_oid oid := current_setting('vaeroex_jit.expected_role_oid')::oid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
    WHERE oid = target_oid AND rolname = 'vaeroex_jit_feasibility_20260908'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit AND rolconnlimit = 2)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = target_oid) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'fixture_role_identity_or_privilege_rejected';
  END IF;
  -- Never silently revoke inherited PUBLIC grants on the project. An unexpectedly
  -- reachable table, sequence, unsafe schema, or SECURITY DEFINER is a hard stop.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_toast' AND n.nspname !~ '^pg_temp'
      AND pg_catalog.has_schema_privilege(target_oid, n.oid, 'CREATE'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_toast' AND n.nspname !~ '^pg_temp'
        AND pg_catalog.has_schema_privilege(target_oid, n.oid, 'USAGE')
        AND ((c.relkind IN ('r','p','v','m','f')
          AND pg_catalog.has_table_privilege(target_oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          AND c.oid <> 'vaeroex_jit_feasibility.rows'::regclass)
          OR (c.relkind = 'S' AND pg_catalog.has_sequence_privilege(target_oid, c.oid, 'USAGE,SELECT,UPDATE'))))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND pg_catalog.has_schema_privilege(target_oid, n.oid, 'USAGE')
        AND pg_catalog.has_function_privilege(target_oid, p.oid, 'EXECUTE')
        -- The reviewed Supabase RLS DDL hook is not an ordinary SQL-callable
        -- definer. PL/pgSQL rejects direct event_trigger calls before its body.
        -- This exact shape exception does not cover ordinary-return functions,
        -- other names/languages/configurations, or other event bindings.
        AND NOT COALESCE((n.nspname = 'public' AND p.proname = 'rls_auto_enable'
          AND p.pronargs = 0 AND p.prokind = 'f' AND NOT p.proretset
          AND p.prorettype = 'pg_catalog.event_trigger'::regtype
          AND p.prolang = (SELECT l.oid FROM pg_catalog.pg_language l WHERE l.lanname = 'plpgsql')
          AND p.proconfig = ARRAY['search_path=pg_catalog']::text[]
          AND (SELECT count(*) FROM pg_catalog.pg_event_trigger e WHERE e.evtfoid = p.oid) = 1
          AND EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger e WHERE e.evtfoid = p.oid
            AND e.evtevent = 'ddl_command_end' AND e.evtenabled = 'O'
            AND cardinality(e.evttags) = 3
            AND e.evttags @> ARRAY['CREATE TABLE','CREATE TABLE AS','SELECT INTO']::text[])
        ), false)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fixture_inherited_public_authority_rejected';
  END IF;
  IF pg_catalog.has_table_privilege(target_oid, 'vaeroex_jit_feasibility.rows', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR NOT pg_catalog.has_table_privilege(target_oid, 'vaeroex_jit_feasibility.rows', 'SELECT') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fixture_table_privilege_rejected';
  END IF;
  ALTER ROLE vaeroex_jit_feasibility_20260908 LOGIN;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
     WHERE oid = target_oid AND rolname = 'vaeroex_jit_feasibility_20260908' AND rolcanlogin) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'fixture_role_changed';
  END IF;
END
$activate$;
COMMIT;
