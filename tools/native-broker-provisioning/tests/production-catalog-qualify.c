/* Local-only catalog harness. It includes the real native implementation so
 * the exact managed Production ledger/schema/function/trigger/ACL predicates
 * execute in one translation unit, without enabling a hosted provisioning
 * entry point or accepting a password. */
#if !defined(VAEROEX_SYNTHETIC_ONLY) || !defined(VAEROEX_MANAGED_PROFILE_TEST)
#error Production catalog qualification is synthetic and local only
#endif
#ifndef VAEROEX_CATALOG_SOCKET_PATH
#error Production catalog qualification requires an exact disposable socket path
#endif

#define main vaeroex_native_provisioning_entry_not_called
#include "../native.c"
#undef main

static bool catalog_step(const char *name,bool value) {
  if (!value) fprintf(stderr,"production_catalog_contract_invalid:%s\n",name);
  return value;
}

static bool managed_catalog_fence_shape(void) {
  return true_query("SELECT EXISTS (SELECT FROM pg_locks WHERE pid=pg_backend_pid() "
      "AND relation='private.integration_production_platform_bindings'::regclass "
      "AND mode='ShareRowExclusiveLock' AND granted) "
    "AND NOT EXISTS (SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND granted "
      "AND locktype='advisory') "
    "AND NOT EXISTS (SELECT FROM pg_locks WHERE pid=pg_backend_pid() AND granted "
      "AND mode='ShareRowExclusiveLock' AND relation=ANY(array["
        "'pg_catalog.pg_proc'::regclass,'pg_catalog.pg_authid'::regclass,"
        "'pg_catalog.pg_auth_members'::regclass,'pg_catalog.pg_db_role_setting'::regclass,"
        "'pg_catalog.pg_namespace'::regclass,'pg_catalog.pg_class'::regclass,"
        "'pg_catalog.pg_database'::regclass,'pg_catalog.pg_parameter_acl'::regclass,"
        "'pg_catalog.pg_default_acl'::regclass]))",0,NULL);
}

int main(int argc,char **argv) {
  bool contract=argc==5 && !strcmp(argv[4],"postgres");
  bool fence_only=argc==6 && !strcmp(argv[4],"synthetic_hosted_operator") &&
    !strcmp(argv[5],"managed-fence");
  bool password_fence=argc==6 && !strcmp(argv[4],"postgres") &&
    !strcmp(argv[5],"managed-password-fence");
  bool interrupted_recovery=argc==6 && !strcmp(argv[4],"postgres") &&
    !strcmp(argv[5],"managed-interrupted-recovery");
  bool application_lock_fence=argc==6 && !strcmp(argv[4],"postgres") &&
    !strcmp(argv[5],"managed-application-lock-fence");
  if ((!contract && !fence_only && !password_fence && !interrupted_recovery && !application_lock_fence) || strcmp(argv[1],VAEROEX_CATALOG_SOCKET_PATH) || !digits(argv[2],5) ||
      strcmp(argv[3],"production_catalog_runtime")) return 2;
  const char *keys[]={"host","port","dbname","user","passfile","sslmode","connect_timeout","application_name",NULL};
  const char *values[]={argv[1],argv[2],argv[3],argv[4],"/dev/null/vaeroex-no-passfile","disable","5",
    "vaeroex-production-catalog-qualification",NULL};
  db=PQconnectdbParams(keys,values,0);
  bool ok=db && PQstatus(db)==CONNECTION_OK;
  if (ok && application_lock_fence) {
    control_db=PQconnectdbParams(keys,values,0);
    ok=control_db && PQstatus(control_db)==CONNECTION_OK;
    if (ok) {
      PQsetNoticeProcessor(db,notice,NULL);
      PQsetNoticeProcessor(control_db,notice,NULL);
      transaction=command("BEGIN");
      ok=transaction && production_authority_catalog_fence() &&
        managed_close_capability(MAPPED_ROLE);
      if (ok) { ok=command("COMMIT"); transaction=!ok; }
      if (ok) ok=terminate_target_sessions(control_db,MAPPED_ROLE) && no_sessions(MAPPED_ROLE);
      if (ok) {
        transaction=command("BEGIN");
        ok=transaction && closed_authority(MAPPED_ROLE) && lock_target(MAPPED_ROLE);
      }
      if (transaction) { (void)command("ROLLBACK"); transaction=false; }
    }
    if (control_db) PQfinish(control_db);
    control_db=NULL;
    if (db) PQfinish(db);
    db=NULL;
    if (!ok) return 3;
    puts("production_managed_application_lock_fence_valid");
    return 0;
  }
  if (ok && (password_fence || interrupted_recovery)) {
    control_db=PQconnectdbParams(keys,values,0);
    ok=control_db && PQstatus(control_db)==CONNECTION_OK;
    if (ok) {
      PQsetNoticeProcessor(db,notice,NULL);
      PQsetNoticeProcessor(control_db,notice,NULL);
      transaction=catalog_step("managed_recovery_begin",command("BEGIN"));
      ok=transaction && catalog_step("managed_recovery_catalog_fence",production_authority_catalog_fence());
      if (ok) ok=password_fence
        ? catalog_step("managed_recovery_active_contract",production_authority_valid(MAPPED_ROLE,true,false))
        : catalog_step("managed_recovery_transition_contract",production_authority_valid(MAPPED_ROLE,true,true));
      const char *target_values[]={MAPPED_ROLE};
      PGresult *identity=ok ? query("SELECT oid::text FROM pg_roles WHERE rolname=$1",1,target_values) : NULL;
      char target_oid[24]={0};
      ok=ok && identity && PQntuples(identity)==1 && digits(PQgetvalue(identity,0,0),10);
      if (ok) snprintf(target_oid,sizeof(target_oid),"%s",PQgetvalue(identity,0,0));
      if (identity) PQclear(identity);
      if (ok) ok=password_fence
        ? catalog_step("managed_recovery_active_entry_role",role_valid(MAPPED_ROLE,target_oid,2))
        : catalog_step("managed_recovery_transition_entry_role",role_valid(MAPPED_ROLE,target_oid,3));
      ok=ok &&
        catalog_step("managed_recovery_close_capability",managed_close_capability(MAPPED_ROLE));
      if (ok) { ok=catalog_step("managed_recovery_first_commit",command("COMMIT")); transaction=!ok; }
      if (ok) ok=catalog_step("managed_recovery_first_drain",
        terminate_target_sessions(control_db,MAPPED_ROLE) && no_sessions(MAPPED_ROLE));
      if (ok) {
        transaction=catalog_step("managed_recovery_second_begin",command("BEGIN"));
        ok=transaction && catalog_step("managed_recovery_closed_authority",closed_authority(MAPPED_ROLE)) &&
          catalog_step("managed_recovery_target_lock",lock_target(MAPPED_ROLE)) &&
          catalog_step("managed_recovery_transition_role",role_valid(MAPPED_ROLE,target_oid,3)) &&
          catalog_step("managed_recovery_fence_role",managed_fence_role(MAPPED_ROLE)) &&
          catalog_step("managed_recovery_closed_role",role_valid(MAPPED_ROLE,target_oid,0));
      }
      if (ok) { ok=catalog_step("managed_recovery_second_commit",command("COMMIT")); transaction=!ok; }
      if (ok) ok=catalog_step("managed_recovery_second_drain",
        terminate_target_sessions(control_db,MAPPED_ROLE) && no_sessions(MAPPED_ROLE));
      if (ok) {
        transaction=catalog_step("managed_recovery_verify_begin",command("BEGIN"));
        ok=transaction && catalog_step("managed_recovery_verify_authority",closed_authority(MAPPED_ROLE)) &&
          catalog_step("managed_recovery_verify_target",lock_target(MAPPED_ROLE)) &&
          catalog_step("managed_recovery_verify_role",role_valid(MAPPED_ROLE,target_oid,0)) &&
          catalog_step("managed_recovery_verify_sessions",no_sessions(MAPPED_ROLE));
      }
      if (transaction) { (void)command("ROLLBACK"); transaction=false; }
    }
    if (control_db) PQfinish(control_db);
    control_db=NULL;
    if (db) PQfinish(db);
    db=NULL;
    if (!ok) return 3;
    puts(password_fence ? "production_managed_password_fence_valid" :
      "production_managed_interrupted_recovery_valid");
    return 0;
  }
  if (ok && fence_only) {
    PQsetNoticeProcessor(db,notice,NULL);
    ok=command("BEGIN") && !lock_target(MAPPED_ROLE) && production_authority_catalog_fence() &&
      lock_target(MAPPED_ROLE) && !lock_target("square_production_unmapped") && managed_catalog_fence_shape();
    (void)command("ROLLBACK");
    if (db) PQfinish(db);
    db=NULL;
    if (!ok) return 3;
    puts("production_managed_catalog_fence_valid");
    return 0;
  }
  if (ok) {
    PQsetNoticeProcessor(db,notice,NULL);
    ok=catalog_step("begin",command("BEGIN"));
    production_phase phase=ok?production_ledger_phase():PRODUCTION_PHASE_INVALID;
    ok=ok && catalog_step("closed_authority",closed_authority(MAPPED_ROLE));
    ok=ok && catalog_step("managed_catalog_fence",managed_catalog_fence_shape());
    ok=ok && catalog_step("ledger_phase",phase!=PRODUCTION_PHASE_INVALID);
    ok=ok && catalog_step("relations",production_relations_valid());
    ok=ok && catalog_step("foundation_schema",production_foundation_schema_valid());
    ok=ok && catalog_step("overlay_schema",production_overlay_schema_valid());
    ok=ok && catalog_step("baseline_triggers",production_baseline_triggers_valid(phase));
    ok=ok && catalog_step("baseline_function_abi",production_function_abi_valid());
    if (ok && phase==PRODUCTION_PHASE_INTERNAL_RUNTIME) {
      ok=catalog_step("internal_relations",production_internal_runtime_relations_valid()) &&
        catalog_step("internal_schema",production_internal_runtime_schema_valid()) &&
        catalog_step("internal_triggers",production_internal_runtime_triggers_valid()) &&
        catalog_step("internal_functions",production_internal_runtime_functions_valid());
    }
    ok=ok && catalog_step("authority",production_authority_valid(MAPPED_ROLE,false,false));
    (void)command("ROLLBACK");
  }
  if (db) PQfinish(db);
  db=NULL;
  if (!ok) return 3;
  puts("production_catalog_contract_valid");
  return 0;
}
