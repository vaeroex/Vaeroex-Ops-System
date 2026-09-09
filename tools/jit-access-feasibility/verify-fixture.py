#!/usr/bin/env python3
"""Local-only PostgreSQL 17.6 fixture test. No credential input or remote option."""
import json
import importlib.util
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import sys

DEFAULT_PG = Path('/private/tmp/vaeroex-square-pg176.ArIWfz/install')
SOURCE = Path(__file__).resolve().parent
ROLE = 'vaeroex_jit_feasibility_20260908'
checks = []
spec = importlib.util.spec_from_file_location('dashboard_renderer', SOURCE / 'render-dashboard.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


def check(condition, name):
    if not condition:
        raise AssertionError(name)
    checks.append(name)


def parse_arguments(arguments):
    dashboard, prefix, seen = False, DEFAULT_PG, set()
    remaining = list(arguments)
    while remaining:
        option = remaining.pop(0)
        if option in seen:
            raise ValueError('duplicate_local_option')
        seen.add(option)
        if option == '--dashboard':
            dashboard = True
        elif option == '--pg-prefix' and remaining:
            prefix = Path(remaining.pop(0))
        else:
            raise ValueError('local_only_fixed_test_mode_required')
    if not prefix.is_absolute():
        raise ValueError('absolute_local_installation_required')
    prefix = prefix.resolve(strict=True)
    if not prefix.is_dir() or not all(
        (prefix / 'bin' / name).is_file() and os.access(prefix / 'bin' / name, os.X_OK)
        for name in ('postgres', 'initdb', 'pg_ctl', 'psql')
    ):
        raise ValueError('existing_local_installation_required')
    return dashboard, prefix


def main(dashboard=False, pg_prefix=DEFAULT_PG):
    # Only the local executable prefix varies; connection targets never do.
    BIN = pg_prefix / 'bin'
    run_root = Path(tempfile.mkdtemp(prefix='jit-fixture-'))
    os.chmod(run_root, 0o700)
    socket = run_root / 'socket'
    socket.mkdir(mode=0o700)
    server_options = f"-h '' -k {shlex.quote(str(socket))} -p 55478"
    data = run_root / 'data'
    env = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'PGPASSFILE': '/dev/null',
           'PGSERVICEFILE': '/dev/null', 'PGAPPNAME': 'vaeroex-jit-local-fixture',
           'PGCONNECT_TIMEOUT': '3'}
    started = False
    clients = []

    def call(args, **kwargs):
        return subprocess.run([str(x) for x in args], env=env, capture_output=True,
                              text=True, timeout=30, **kwargs)

    base = [BIN / 'psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1',
            '-v', 'VERBOSITY=sqlstate', '-h', socket, '-p', '55478', '-d', 'postgres']

    def sql(query, user='fixture_admin'):
        return call([*base, '-U', user, '-c', query])

    def script(name, system_id, database_oid, role_oid='0'):
        if dashboard:
            operations = ['fence-commit', 'drain'] if name == 'fence.sql' else [name[:-4]]
            for operation in operations:
                # Separate native sessions model distinct SQL-editor requests.
                result = sql(renderer.render(operation, system_id, database_oid, role_oid))
                if result.returncode:
                    return result
            return result
        return call([*base, '-U', 'fixture_admin', '-v', f'expected_system_id={system_id}',
                     '-v', f'expected_database_oid={database_oid}',
                     '-v', f'expected_role_oid={role_oid}', '-f', SOURCE / name])

    def command(query, name):
        result = sql(query)
        check(result.returncode == 0, name)
        return result.stdout.strip()

    try:
        check(shlex.split(server_options) == ['-h', '', '-k', str(socket), '-p', '55478'],
              'generated_socket_options_are_single_argument')
        for arguments in [
            ['--host', 'remote.invalid'], ['--pg-prefix', 'https://remote.invalid'],
            ['--pg-prefix', 'relative'], ['--pg-prefix'], ['--dashboard', '--dashboard'],
            ['--pg-prefix', str(run_root / 'absent')], ['--pg-prefix', str(run_root)],
        ]:
            try:
                parse_arguments(arguments)
                check(False, 'fixture_unsupported_arguments_accepted')
            except (ValueError, FileNotFoundError):
                check(True, 'fixture_unsupported_arguments_rejected')
        for arguments in [
            ['--dashboard', '--pg-prefix', str(pg_prefix)],
            ['--pg-prefix', str(pg_prefix), '--dashboard'],
        ]:
            check(parse_arguments(arguments) == (True, pg_prefix), 'fixture_explicit_local_prefix_accepted')
        for invalid in ["1'; SELECT 1; --", 'https://remote.example', '-1', '1e2', '１２']:
            try:
                renderer.render('setup', invalid, '5')
                check(False, 'renderer_invalid_pin_accepted')
            except ValueError:
                check(True, 'renderer_non_decimal_pin_rejected')
        try:
            renderer.render('../setup', '1', '5')
            check(False, 'renderer_arbitrary_operation_accepted')
        except ValueError:
            check(True, 'renderer_arbitrary_operation_rejected')
        check(call([BIN / 'postgres', '--version']).stdout.strip() == 'postgres (PostgreSQL) 17.6',
              'exact_local_pg176')
        check(call([BIN / 'initdb', '-D', data, '-U', 'fixture_admin', '-A', 'trust',
                    '--no-locale', '-E', 'UTF8']).returncode == 0, 'local_cluster_initialized')
        # No network listener. The only transport is this run-owned 0700 UNIX directory.
        result = call([BIN / 'pg_ctl', '-D', data, '-l', run_root / 'server.log',
                       '-o', server_options, '-w', 'start'])
        check(result.returncode == 0, 'private_unix_cluster_started')
        started = True
        check(sql("SHOW listen_addresses").stdout.strip() == '', 'no_tcp_listener')
        ids = command("SELECT system_identifier::text || '|' || "
                      "(SELECT oid::text FROM pg_database WHERE datname='postgres') "
                      "FROM pg_control_system()", 'local_physical_identity').split('|')
        system_id, database_oid = ids
        check(script('setup.sql', '0', database_oid).returncode != 0, 'wrong_system_rejected')
        check(script('setup.sql', system_id, '0').returncode != 0, 'wrong_database_rejected')
        check(command(f"SELECT count(*) FROM pg_roles WHERE rolname='{ROLE}'", 'pre_setup_count') == '0',
              'identity_failure_makes_no_role')
        check(script('setup.sql', system_id, database_oid).returncode == 0, 'setup_succeeds')
        role_oid = command(f"SELECT oid FROM pg_roles WHERE rolname='{ROLE}'", 'role_oid_observed')
        check(script('setup.sql', system_id, database_oid).returncode != 0, 'duplicate_setup_rejected')
        check(command(f"SELECT oid FROM pg_roles WHERE rolname='{ROLE}'", 'role_oid_after_duplicate') == role_oid,
              'no_existing_role_adoption')
        check(sql('SELECT 1', ROLE).returncode != 0, 'nologin_before_activation')
        check(script('activate.sql', system_id, database_oid, '0').returncode != 0,
              'activation_wrong_oid_rejected')
        command('CREATE SCHEMA fixture_hazard; GRANT USAGE ON SCHEMA fixture_hazard TO PUBLIC; '
                'CREATE TABLE fixture_hazard.rows(n integer); GRANT SELECT ON fixture_hazard.rows TO PUBLIC',
                'local_public_table_hazard_installed')
        check(script('activate.sql', system_id, database_oid, role_oid).returncode != 0,
              'inherited_public_table_blocks_activation')
        command('REVOKE SELECT ON fixture_hazard.rows FROM PUBLIC', 'local_table_hazard_removed')
        command("CREATE FUNCTION fixture_hazard.probe() RETURNS integer LANGUAGE sql SECURITY DEFINER "
                "AS 'SELECT 1'", 'local_definer_hazard_installed')
        check(script('activate.sql', system_id, database_oid, role_oid).returncode != 0,
              'public_definer_blocks_activation')
        command('REVOKE EXECUTE ON FUNCTION fixture_hazard.probe() FROM PUBLIC', 'local_definer_hazard_removed')
        command('GRANT CREATE ON SCHEMA fixture_hazard TO PUBLIC', 'local_create_hazard_installed')
        check(script('activate.sql', system_id, database_oid, role_oid).returncode != 0,
              'public_schema_create_blocks_activation')
        command('REVOKE CREATE ON SCHEMA fixture_hazard FROM PUBLIC', 'local_create_hazard_removed')
        command("CREATE FUNCTION public.rls_auto_enable() RETURNS integer LANGUAGE plpgsql "
                "SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RETURN 1; END $$",
                'same_name_ordinary_return_definer_installed')
        check(script('activate.sql', system_id, database_oid, role_oid).returncode != 0,
              'same_name_ordinary_return_definer_still_blocks')
        command("DROP FUNCTION public.rls_auto_enable(); "
                "CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql "
                "SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN "
                "RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='synthetic_event_body_reached'; END $$; "
                "CREATE EVENT TRIGGER fixture_rls_auto_enable ON ddl_command_end "
                "WHEN TAG IN ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') "
                "EXECUTE FUNCTION public.rls_auto_enable()",
                'exact_plpgsql_event_trigger_shape_installed')
        function_acl = command("SELECT COALESCE(proacl::text,'default') FROM pg_proc "
                               "WHERE oid='public.rls_auto_enable()'::regprocedure", 'event_function_acl_before')
        check(command(f"SELECT has_function_privilege('{ROLE}','public.rls_auto_enable()','EXECUTE')",
                      'event_function_execute_before') == 't', 'event_function_execute_not_revoked')
        command("ALTER FUNCTION public.rls_auto_enable() RESET search_path", 'event_shape_config_removed')
        check(script('activate.sql', system_id, database_oid, role_oid).returncode != 0,
              'event_trigger_missing_search_path_still_blocks')
        command("ALTER FUNCTION public.rls_auto_enable() SET search_path=pg_catalog",
                'event_shape_config_restored')
        command("CREATE EVENT TRIGGER fixture_extra_binding ON ddl_command_end "
                "WHEN TAG IN ('ALTER TABLE') EXECUTE FUNCTION public.rls_auto_enable()",
                'unexpected_event_binding_installed')
        check(script('activate.sql', system_id, database_oid, role_oid).returncode != 0,
              'event_trigger_extra_binding_still_blocks')
        command('DROP EVENT TRIGGER fixture_extra_binding', 'unexpected_local_binding_removed')
        check(script('activate.sql', system_id, database_oid, role_oid).returncode == 0, 'activation_succeeds')
        result = sql('SELECT public.rls_auto_enable()', ROLE)
        check(result.returncode != 0 and '0A000' in result.stderr and 'P0001' not in result.stderr,
              'ordinary_native_caller_rejected_before_event_body')
        check(command("SELECT COALESCE(proacl::text,'default') FROM pg_proc "
                      "WHERE oid='public.rls_auto_enable()'::regprocedure", 'event_function_acl_after') == function_acl,
              'event_function_public_acl_unchanged')
        check(command(f"SELECT has_function_privilege('{ROLE}','public.rls_auto_enable()','EXECUTE')",
                      'event_function_execute_after') == 't', 'direct_rejection_is_not_acl_revocation')
        result = sql('SELECT session_user, current_user', ROLE)
        check(result.returncode == 0 and result.stdout.strip() == f'{ROLE}|{ROLE}', 'native_session_identity')
        check(sql('SELECT marker FROM vaeroex_jit_feasibility.rows', ROLE).stdout.strip() == 'allowed',
              'static_tenant_rls_visible_row_only')
        check(sql("SET app.workspace_id='22222222-2222-4222-8222-222222222222'; "
                  "SELECT count(*) FROM vaeroex_jit_feasibility.rows WHERE marker='denied'", ROLE).stdout.strip() == '0',
              'user_guc_cannot_change_tenant_authority')
        result = sql('SELECT * FROM vaeroex_jit_feasibility.denied', ROLE)
        check(result.returncode != 0 and '42501' in result.stderr, 'ungranted_fixture_table_denied')
        result = sql("BEGIN; SET TRANSACTION READ WRITE; INSERT INTO vaeroex_jit_feasibility.rows VALUES "
                     "('33333333-3333-4333-8333-333333333333','blocked'); ROLLBACK", ROLE)
        check(result.returncode != 0 and '42501' in result.stderr, 'write_privileges_denied_after_readwrite_override')
        check(sql('SHOW default_transaction_read_only', ROLE).stdout.strip() == 'on', 'read_only_default')
        result = sql('SET ROLE fixture_admin', ROLE)
        check(result.returncode != 0 and '42501' in result.stderr, 'set_role_admin_denied')
        result = sql('SET SESSION AUTHORIZATION fixture_admin', ROLE)
        check(result.returncode != 0 and '42501' in result.stderr, 'set_session_admin_denied')
        check(command(f"SELECT count(*) FROM pg_auth_members WHERE member={role_oid}", 'membership_count') == '0',
              'no_capability_memberships')
        check(script('fence.sql', system_id, database_oid, '0').returncode != 0, 'fence_wrong_oid_rejected')
        check(sql('SELECT 1', ROLE).returncode == 0, 'wrong_fence_preserves_exact_role')

        # Two live target sessions and a distinct administrator observer. Fixed queries only.
        for user in [ROLE, ROLE, 'fixture_admin']:
            client = subprocess.Popen([str(x) for x in [*base, '-U', user]], env=env,
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True)
            clients.append(client)
            client.stdin.write('SELECT pg_backend_pid();\n')
            client.stdin.flush()
            pid = client.stdout.readline().strip()
            check(pid.isdecimal(), 'target_or_observer_session_opened')
        check(sql('SELECT 1', ROLE).returncode != 0, 'two_connection_limit_enforced_sequentially')
        for client in clients[:2]:
            client.stdin.write('SELECT pg_sleep(4);\n')
            client.stdin.flush()
        check(script('fence.sql', system_id, database_oid, role_oid).returncode == 0, 'committed_fence_and_exact_drain')
        check(command(f"SELECT count(*) FROM pg_stat_activity WHERE usesysid={role_oid}", 'remaining_target_sessions') == '0',
              'target_sessions_zero')
        check(sql('SELECT 1', ROLE).returncode != 0, 'reconnection_denied_after_fence')
        clients[2].stdin.write('SELECT 41 + 1;\n')
        clients[2].stdin.flush()
        check(clients[2].stdout.readline().strip() == '42', 'unrelated_admin_session_preserved')
        check(script('fence.sql', system_id, database_oid, role_oid).returncode == 0, 'repeat_fence_idempotent')
        check(command(f"SELECT count(*) FROM pg_roles WHERE rolname='{ROLE}' AND NOT rolcanlogin", 'preserved_role_count') == '1',
              'fenced_role_preserved_without_drop')
    finally:
        for client in clients:
            try:
                client.communicate(input='\\q\n', timeout=3)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                client.kill()
                client.communicate()
        if started:
            check(call([BIN / 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop']).returncode == 0,
                  'local_cluster_stopped')
    return run_root


if __name__ == '__main__':
    try:
        dashboard, pg_prefix = parse_arguments(sys.argv[1:])
        directory = main(dashboard, pg_prefix)
        print(json.dumps({'result': 'passed', 'checks': len(checks), 'assertions': checks,
                          'transport': 'rendered_separate_sql_requests' if dashboard else 'psql_scripts',
                          'local_runtime_directory': str(directory), 'hosted_qualified': False}))
    except BaseException as error:
        # Never pass PostgreSQL/subprocess diagnostics through the reporting boundary.
        code = str(error) if isinstance(error, AssertionError) else type(error).__name__
        print(json.dumps({'result': 'failed', 'check': code, 'completed_checks': len(checks)}))
        raise SystemExit(1)
