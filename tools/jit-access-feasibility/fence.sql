\set ON_ERROR_STOP on
BEGIN;
\ir target-gate.sql
SELECT pg_catalog.set_config('vaeroex_jit.expected_role_oid', :'expected_role_oid', false);
DO $fence$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
    WHERE oid::text = current_setting('vaeroex_jit.expected_role_oid')
      AND rolname = 'vaeroex_jit_feasibility_20260908') THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'fixture_fence_oid_rejected';
  END IF;
  ALTER ROLE vaeroex_jit_feasibility_20260908 NOLOGIN;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
    WHERE oid::text = current_setting('vaeroex_jit.expected_role_oid')
      AND rolname = 'vaeroex_jit_feasibility_20260908' AND NOT rolcanlogin) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'fixture_fence_changed';
  END IF;
END
$fence$;
-- Establish the durable login fence before interrupting any old sessions.
COMMIT;
DO $drain$
DECLARE
  target_oid oid := current_setting('vaeroex_jit.expected_role_oid')::oid;
  candidate record;
  pass integer;
BEGIN
  FOR pass IN 1..3 LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
      WHERE oid = target_oid AND rolname = 'vaeroex_jit_feasibility_20260908' AND NOT rolcanlogin) THEN
      RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'fixture_fence_identity_lost';
    END IF;
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    IF (SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE usesysid = target_oid) > 8 THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'fixture_unexpected_session_count';
    END IF;
    FOR candidate IN SELECT pid, backend_start FROM pg_catalog.pg_stat_activity
      WHERE usesysid = target_oid AND usename = 'vaeroex_jit_feasibility_20260908'
        AND backend_type = 'client backend' AND pid <> pg_catalog.pg_backend_pid()
    LOOP
      -- Take fresh identity/start-time metadata immediately before each signal.
      PERFORM pg_catalog.pg_stat_clear_snapshot();
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
        WHERE pid = candidate.pid AND backend_start = candidate.backend_start
          AND usesysid = target_oid AND usename = 'vaeroex_jit_feasibility_20260908'
          AND backend_type = 'client backend') THEN
        PERFORM pg_catalog.pg_terminate_backend(candidate.pid, 2000);
      END IF;
    END LOOP;
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE usesysid = target_oid);
    PERFORM pg_catalog.pg_sleep(0.1);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE usesysid = target_oid) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'fixture_drain_unconfirmed';
  END IF;
END
$drain$;
SELECT 'fenced' AS role_state, oid AS expected_role_oid FROM pg_catalog.pg_roles
 WHERE oid::text = current_setting('vaeroex_jit.expected_role_oid')
   AND rolname = 'vaeroex_jit_feasibility_20260908' AND NOT rolcanlogin;
