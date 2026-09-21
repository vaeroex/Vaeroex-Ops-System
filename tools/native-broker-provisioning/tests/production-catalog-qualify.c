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
  if ((!contract && !fence_only) || strcmp(argv[1],VAEROEX_CATALOG_SOCKET_PATH) || !digits(argv[2],5) ||
      strcmp(argv[3],"production_catalog_runtime")) return 2;
  const char *keys[]={"host","port","dbname","user","passfile","sslmode","connect_timeout","application_name",NULL};
  const char *values[]={argv[1],argv[2],argv[3],argv[4],"/dev/null/vaeroex-no-passfile","disable","5",
    "vaeroex-production-catalog-qualification",NULL};
  db=PQconnectdbParams(keys,values,0);
  bool ok=db && PQstatus(db)==CONNECTION_OK;
  if (ok && fence_only) {
    PQsetNoticeProcessor(db,notice,NULL);
    ok=command("BEGIN") && production_authority_catalog_fence() && managed_catalog_fence_shape();
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
    ok=ok && catalog_step("authority",production_authority_valid(MAPPED_ROLE));
    (void)command("ROLLBACK");
  }
  if (db) PQfinish(db);
  db=NULL;
  if (!ok) return 3;
  puts("production_catalog_contract_valid");
  return 0;
}
