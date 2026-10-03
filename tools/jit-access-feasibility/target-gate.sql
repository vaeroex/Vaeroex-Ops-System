-- Nonsecret psql inputs only. Include inside the caller's transaction.
-- All callers must use psql -X --set ON_ERROR_STOP=1; no connection secrets in argv.
SELECT pg_catalog.set_config('vaeroex_jit.expected_system_id', :'expected_system_id', true),
       pg_catalog.set_config('vaeroex_jit.expected_database_oid', :'expected_database_oid', true);
DO $gate$
BEGIN
  IF session_user <> current_user OR current_database() <> 'postgres'
     OR pg_catalog.pg_is_in_recovery()
     OR current_setting('server_version_num')::integer / 10000 <> 17
     OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
        <> current_setting('vaeroex_jit.expected_system_id')
     OR (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database())
        <> current_setting('vaeroex_jit.expected_database_oid') THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'fixture_target_identity_rejected';
  END IF;
  -- Serializes only these reviewed scripts; not a lock against other administrators.
  PERFORM pg_catalog.pg_advisory_xact_lock(7520913371643201);
END
$gate$;
