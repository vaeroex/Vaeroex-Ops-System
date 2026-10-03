\set ON_ERROR_STOP on
BEGIN;
\ir target-gate.sql
DO $absent$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'vaeroex_jit_feasibility_20260908')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'vaeroex_jit_feasibility') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'fixture_already_exists_no_adoption';
  END IF;
END
$absent$;
CREATE ROLE vaeroex_jit_feasibility_20260908 NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
ALTER ROLE vaeroex_jit_feasibility_20260908 SET default_transaction_read_only = on;
ALTER ROLE vaeroex_jit_feasibility_20260908 SET statement_timeout = '5s';
ALTER ROLE vaeroex_jit_feasibility_20260908 SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE vaeroex_jit_feasibility_20260908 SET search_path = pg_catalog;
CREATE SCHEMA vaeroex_jit_feasibility;
REVOKE ALL ON SCHEMA vaeroex_jit_feasibility FROM PUBLIC;
CREATE TABLE vaeroex_jit_feasibility.rows (workspace_id uuid PRIMARY KEY, marker text NOT NULL);
CREATE TABLE vaeroex_jit_feasibility.denied (marker text NOT NULL);
REVOKE ALL ON ALL TABLES IN SCHEMA vaeroex_jit_feasibility FROM PUBLIC;
-- Supabase may define automatic grants on objects created by the setup operator.
-- Remove those grants only from this new, exact fixture; never touch other schemas.
DO $private$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA vaeroex_jit_feasibility FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA vaeroex_jit_feasibility FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA vaeroex_jit_feasibility FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA vaeroex_jit_feasibility FROM authenticated;
  END IF;
END
$private$;
INSERT INTO vaeroex_jit_feasibility.rows VALUES
  ('11111111-1111-4111-8111-111111111111', 'allowed'),
  ('22222222-2222-4222-8222-222222222222', 'denied');
INSERT INTO vaeroex_jit_feasibility.denied VALUES ('prohibited');
ALTER TABLE vaeroex_jit_feasibility.rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaeroex_jit_feasibility.rows FORCE ROW LEVEL SECURITY;
ALTER TABLE vaeroex_jit_feasibility.denied ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaeroex_jit_feasibility.denied FORCE ROW LEVEL SECURITY;
CREATE POLICY exact_test_identity ON vaeroex_jit_feasibility.rows
  FOR SELECT TO vaeroex_jit_feasibility_20260908 USING (
    session_user = 'vaeroex_jit_feasibility_20260908'
    AND workspace_id = '11111111-1111-4111-8111-111111111111'::uuid
  );
GRANT CONNECT ON DATABASE postgres TO vaeroex_jit_feasibility_20260908;
GRANT USAGE ON SCHEMA vaeroex_jit_feasibility TO vaeroex_jit_feasibility_20260908;
GRANT SELECT ON vaeroex_jit_feasibility.rows TO vaeroex_jit_feasibility_20260908;
SELECT oid AS expected_role_oid FROM pg_catalog.pg_roles
 WHERE rolname = 'vaeroex_jit_feasibility_20260908';
COMMIT;
