/*
 * One-shot, fixed-operation libpq broker provisioner. No general SQL interface.
 * The ordinary entry point stays closed. An explicitly pinned managed build
 * implements the approved restricted-admin diagnostic risk policy; synthetic
 * builds can connect only to a private local socket or loopback TLS fixture.
 */
#define _POSIX_C_SOURCE 200809L
#define _DEFAULT_SOURCE 1
#define _DARWIN_C_SOURCE
#include <libpq-fe.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/prctl.h>
#include <sys/random.h>
#else
#include <sys/random.h>
#endif

#if defined(VAEROEX_MAPPED_ENROLLER) && defined(VAEROEX_MAPPED_RUNTIME)
#error Choose one fixed mapped capability
#elif defined(VAEROEX_MAPPED_ENROLLER)
#define CAPABILITY "square_verified_enrollment_authority"
#define MAPPED_ROLE "square_sandbox_enroller"
#elif defined(VAEROEX_MAPPED_RUNTIME)
#define CAPABILITY "square_ingestion_runtime_authority"
#define MAPPED_ROLE "square_sandbox_runtime"
#else
#define CAPABILITY "square_account_broker_authority"
#endif
#define PASSWORD_BYTES 64
#define PASSWORD_CHARS (PASSWORD_BYTES * 2)
#define DEADLINE_SECONDS 15

#if defined(VAEROEX_MANAGED_SUPABASE) && defined(VAEROEX_SYNTHETIC_ONLY)
#error Choose exactly one target profile
#endif
#if defined(VAEROEX_MANAGED_PROFILE_TEST) && !defined(VAEROEX_SYNTHETIC_ONLY)
#error Managed profile tests require the local-only synthetic target gate
#endif
#ifdef VAEROEX_MANAGED_SUPABASE
#if !defined(VAEROEX_MANAGED_HOST) || !defined(VAEROEX_MANAGED_PORT) || \
    !defined(VAEROEX_MANAGED_DATABASE) || !defined(VAEROEX_MANAGED_ADMIN) || \
    !defined(VAEROEX_MANAGED_TARGET) || !defined(VAEROEX_MANAGED_SYSTEM_ID) || \
    !defined(VAEROEX_MANAGED_DATABASE_OID) || !defined(VAEROEX_MANAGED_CA) || \
    !defined(VAEROEX_MANAGED_ADMIN_USER) || !defined(VAEROEX_MANAGED_TARGET_USER)
#error Managed builds require immutable nonsecret target and transport pins
#endif
#endif

static bool managed_profile(void) {
#if defined(VAEROEX_MANAGED_SUPABASE) || defined(VAEROEX_MANAGED_PROFILE_TEST)
  return true;
#else
  return false;
#endif
}

extern char **environ;
_Static_assert(ATOMIC_INT_LOCK_FREE == 2, "cancellation requires signal-safe lock-free atomics");
static atomic_int cancelled = 0;
static atomic_int watched_socket = -1;
static atomic_bool watcher_done = false;
static atomic_bool expired = false;
static struct timespec started;
static PGconn *db = NULL;
static bool sensitive_started = false;
static bool transaction = false;

static void wipe(void *p, size_t n) {
  volatile unsigned char *v = p;
  while (n--) *v++ = 0;
}
static void notice(void *arg, const char *message) { (void)arg; (void)message; }
static void signal_stop(int sig) { (void)sig; atomic_store_explicit(&cancelled, 1, memory_order_relaxed); }
static bool stopped(void) { return atomic_load_explicit(&cancelled, memory_order_relaxed) || atomic_load(&expired); }
static long elapsed_ms(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (now.tv_sec - started.tv_sec) * 1000L + (now.tv_nsec - started.tv_nsec) / 1000000L;
}
static void *watch(void *unused) {
  (void)unused;
  while (!atomic_load(&watcher_done)) {
    if (elapsed_ms() >= DEADLINE_SECONDS * 1000L) atomic_store(&expired, true);
    if (stopped()) {
      int fd = atomic_load(&watched_socket);
      if (fd >= 0) shutdown(fd, SHUT_RDWR);
    }
    struct timespec pause = {0, 20000000};
    nanosleep(&pause, NULL);
  }
  return NULL;
}
static bool identifier(const char *s) {
  size_t n = strlen(s);
  if (!n || n > 63 || !(s[0] >= 'a' && s[0] <= 'z')) return false;
  for (size_t i = 1; i < n; i++)
    if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= '0' && s[i] <= '9') || s[i] == '_')) return false;
  return true;
}
static bool digits(const char *s, size_t max) {
  if (!*s || strlen(s) > max) return false;
  for (; *s; s++) if (*s < '0' || *s > '9') return false;
  return true;
}
static bool label(const char *s) {
  if (!*s || strlen(s) > 80) return false;
  for (; *s; s++) if (!(isalnum((unsigned char)*s) || *s == '-' || *s == '_')) return false;
  return true;
}
static bool private_pipe(int fd) {
  struct stat st;
  return fd > STDERR_FILENO && fstat(fd, &st) == 0 && (S_ISFIFO(st.st_mode) || S_ISSOCK(st.st_mode));
}
static bool read_line(int fd, char *out, size_t capacity, long limit_ms) {
  long until = elapsed_ms() + limit_ms;
  size_t used = 0;
  while (!stopped() && elapsed_ms() < until) {
    struct pollfd p = {fd, POLLIN, 0};
    int ready = poll(&p, 1, 20);
    if (ready < 0 && errno == EINTR) continue;
    if (ready < 0) return false;
    if (!ready) continue;
    char c;
    if (read(fd, &c, 1) != 1) return false;
    if (c == '\n') { out[used] = 0; return true; }
    if (c == 0 || used + 1 >= capacity) return false;
    out[used++] = c;
  }
  return false;
}
static bool write_private(int fd, const char *s, size_t n) {
  long until = elapsed_ms() + 5000;
  int flags = fcntl(fd, F_GETFL);
  if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0) return false;
  while (n && !stopped() && elapsed_ms() < until) {
    struct pollfd p = {fd, POLLOUT, 0};
    if (poll(&p, 1, 20) <= 0) continue;
    ssize_t written = write(fd, s, n);
    if (written < 0 && (errno == EINTR || errno == EAGAIN)) continue;
    if (written <= 0) return false;
    s += written;
    n -= (size_t)written;
  }
  return n == 0;
}
static bool command(const char *sql) {
  if (stopped()) return false;
  PGresult *r = PQexec(db, sql);
  bool ok = r && PQresultStatus(r) == PGRES_COMMAND_OK;
  if (r) PQclear(r);
  return ok && !stopped();
}
static PGresult *query(const char *sql, int count, const char *const *values) {
  if (stopped()) return NULL;
  PGresult *r = PQexecParams(db, sql, count, NULL, values, NULL, NULL, 0);
  if (!r || PQresultStatus(r) != PGRES_TUPLES_OK || stopped()) {
    if (r) PQclear(r);
    return NULL;
  }
  return r;
}
static bool true_query(const char *sql, int count, const char *const *values) {
  PGresult *r = query(sql, count, values);
  bool ok = r && PQntuples(r) == 1 && PQnfields(r) == 1 && strcmp(PQgetvalue(r, 0, 0), "t") == 0;
  if (r) PQclear(r);
  return ok;
}
static bool role_command(const char *prefix, const char *role, const char *suffix) {
  /* role has already passed the restrictive ASCII identifier validation. */
  char sql[512];
  int n = snprintf(sql, sizeof(sql), "%s \"%s\" %s", prefix, role, suffix);
  return n > 0 && (size_t)n < sizeof(sql) && command(sql);
}
static bool profile(void) {
  /* SET, not set_config: Supautils handles the supported VariableSetStmt path.
   * Native parameter ACL false is not a substitute for effective readback. */
  static const struct { const char *name; const char *sql; const char *value; } settings[] = {
    {"log_statement", "SET log_statement = 'none'", "none"},
    {"log_min_error_statement", "SET log_min_error_statement = 'panic'", "panic"},
    {"log_parameter_max_length", "SET log_parameter_max_length = 0", "0"},
    {"log_parameter_max_length_on_error", "SET log_parameter_max_length_on_error = 0", "0"},
    {"log_min_duration_statement", "SET log_min_duration_statement = -1", "-1"},
    {"log_min_duration_sample", "SET log_min_duration_sample = -1", "-1"},
    {"log_transaction_sample_rate", "SET log_transaction_sample_rate = 0", "0"},
    {"log_duration", "SET log_duration = off", "off"},
    {"log_lock_waits", "SET log_lock_waits = off", "off"},
    {"debug_print_parse", "SET debug_print_parse = off", "off"},
    {"debug_print_rewritten", "SET debug_print_rewritten = off", "off"},
    {"debug_print_plan", "SET debug_print_plan = off", "off"},
    {"track_activities", "SET track_activities = off", "off"},
    {"pg_stat_statements.track", "SET pg_stat_statements.track = 'none'", "none"},
    {"pgaudit.log", "SET pgaudit.log = 'role'", "role"},
    {"pgaudit.log_parameter", "SET pgaudit.log_parameter = off", "off"},
    {"pgaudit.log_statement", "SET pgaudit.log_statement = on", "on"},
    {"pgaudit.log_client", "SET pgaudit.log_client = off", "off"},
    {"auto_explain.log_min_duration", "SET auto_explain.log_min_duration = -1", "-1"},
    {"password_encryption", "SET password_encryption = 'scram-sha-256'", "scram-sha-256"},
    {"search_path", "SET search_path = 'pg_catalog'", "pg_catalog"},
    {"lock_timeout", "SET lock_timeout = '1500ms'", "1500ms"},
    {"statement_timeout", "SET statement_timeout = '4000ms'", "4s"},
    {"idle_in_transaction_session_timeout", "SET idle_in_transaction_session_timeout = '8000ms'", "8s"}
  };
  for (size_t i = 0; i < sizeof(settings) / sizeof(settings[0]); i++) {
    if (managed_profile() && !strcmp(settings[i].name,"track_activities")) {
      /* Managed operators cannot SET this superuser GUC. Its bounded activity
       * visibility is an explicitly accepted restricted-admin diagnostic risk,
       * not a claim that verifier-bearing activity is never observable. */
      if (!true_query("SELECT current_setting('track_activities') IN ('on','off')",0,NULL)) return false;
      continue;
    }
    const char *values[] = {settings[i].name, settings[i].value};
    /* Do not demand SET privilege for an already-safe effective value. Use
     * VariableSetStmt when a change is necessary, then verify the result. */
    if (managed_profile() && true_query("SELECT current_setting($1) = $2",2,values)) continue;
    if (!command(settings[i].sql)) return false;
    if (!true_query("SELECT current_setting($1) = $2", 2, values)) return false;
  }
  /* A placeholder custom GUC alone does not prove a hook is installed. The
   * managed profile accepts the observed provider-supported preload family,
   * including session-loaded Supautils, not arbitrary third-party hooks. */
  PGresult *r = query("SELECT current_setting('shared_preload_libraries'), "
    "(SELECT extversion FROM pg_extension WHERE extname='pg_stat_statements'), "
    "current_setting('session_preload_libraries'), current_setting('local_preload_libraries')", 0, NULL);
  bool audit = false, statistics = false, utilities = false, ok = r && PQntuples(r) == 1;
  if (ok) {
    ok = PQnfields(r)==4 && !PQgetisnull(r,0,1) && strcmp(PQgetvalue(r,0,1),"1.11")==0;
    if (ok && managed_profile() && *PQgetvalue(r,0,3)) ok=false;
    for (int column=0; ok && column<=2;column+=2) {
      if (column && !managed_profile()) break;
      char *list=strdup(PQgetvalue(r,0,column));
      if (!list) {ok=false;break;}
      char *save=NULL;
      for (char *part=strtok_r(list,",",&save);part;part=strtok_r(NULL,",",&save)) {
        while (*part==' ' || *part=='"')part++;
        size_t n=strlen(part);
        while(n && (part[n-1]==' ' || part[n-1]=='"'))part[--n]=0;
        char *base=strrchr(part,'/');base=base?base+1:part;
        bool trusted_path=base==part || ((size_t)(base-part)==8 && !strncmp(part,"$libdir/",8));
#if defined(VAEROEX_MANAGED_PROFILE_TEST) && defined(VAEROEX_TEST_AUDIT_PRELOAD) && defined(VAEROEX_TEST_UTILS_PRELOAD)
        /* Only the local-only test profile may use these exact fixture build
         * pins. The harness verifies their dependency hashes before startup.
         * They cannot widen a managed hosted build's loader namespace. */
        trusted_path=trusted_path || !strcmp(part,VAEROEX_TEST_AUDIT_PRELOAD) || !strcmp(part,VAEROEX_TEST_UTILS_PRELOAD);
#endif
        if (managed_profile() && !trusted_path) {ok=false;break;}
        if (!strcmp(base,"pgaudit")) { if (!column) audit=true; }
        else if (!strcmp(base,"pg_stat_statements")) { if (!column) statistics=true; }
        else if (!strcmp(base,"supautils")) utilities=true;
        else if (!strcmp(base,"auto_explain")) { /* Explicitly disabled above. */ }
        else if (managed_profile() && (!strcmp(base,"plpgsql") || !strcmp(base,"plpgsql_check") ||
          !strcmp(base,"pg_cron") || !strcmp(base,"pg_net") || !strcmp(base,"pgsodium") ||
          !strcmp(base,"pg_tle") || !strcmp(base,"plan_filter") || !strcmp(base,"supabase_vault"))) { /* Managed baseline. */ }
        else ok=false;
      }
      free(list);
    }
  }
  if (r) PQclear(r);
  return ok && audit && statistics && utilities;
}
static bool local_transport(const char *host, const char *cert) {
  if (host[0] == '/') {
    struct stat st;
    char *real = realpath(host, NULL);
    bool ok = real && strcmp(real, host) == 0 && stat(host, &st) == 0 && S_ISDIR(st.st_mode)
      && st.st_uid == getuid() && (st.st_mode & 0077) == 0 && !strcmp(cert, "-");
    free(real);
    return ok;
  }
  if (strcmp(host, "127.0.0.1") && strcmp(host, "::1")) return false;
  struct stat st;
  return cert[0] == '/' && stat(cert, &st) == 0 && S_ISREG(st.st_mode) && st.st_uid == getuid()
    && (st.st_mode & 0022) == 0;
}
static bool transport(const char *host,const char *port,const char *database,const char *admin,
                      const char *target,const char *system_id,const char *oid,const char *cert) {
#ifdef VAEROEX_MANAGED_SUPABASE
  (void)local_transport;
  struct stat st;
  if (strcmp(host,VAEROEX_MANAGED_HOST) || strcmp(port,VAEROEX_MANAGED_PORT) ||
    strcmp(database,VAEROEX_MANAGED_DATABASE) || strcmp(admin,VAEROEX_MANAGED_ADMIN) ||
    strcmp(target,VAEROEX_MANAGED_TARGET) || strcmp(system_id,VAEROEX_MANAGED_SYSTEM_ID) ||
    strcmp(oid,VAEROEX_MANAGED_DATABASE_OID) || strcmp(cert,VAEROEX_MANAGED_CA) || host[0]=='/')return false;
  char *real=realpath(cert,NULL);
  bool ok=real && !strcmp(real,cert) && stat(cert,&st)==0 && S_ISREG(st.st_mode) &&
    (st.st_uid==0 || st.st_uid==getuid()) && !(st.st_mode&0022);
  free(real);return ok;
#else
  (void)port;(void)database;(void)admin;(void)target;(void)system_id;(void)oid;
  return local_transport(host,cert);
#endif
}
static const char *transport_user(const char *role,bool candidate) {
#ifdef VAEROEX_MANAGED_SUPABASE
  (void)role;return candidate?VAEROEX_MANAGED_TARGET_USER:VAEROEX_MANAGED_ADMIN_USER;
#else
  (void)candidate;return role;
#endif
}
static bool library_version(void) {
  int version=PQlibVersion();
  return managed_profile()?((version>=160015 && version<170000) || (version>=170006 && version<180000)):version==170006;
}
static bool identity(const char *host, const char *database, const char *admin, const char *system_id, const char *oid) {
  const char *values[] = {database, admin, system_id, oid};
  bool ok = true_query("SELECT current_database()=$1 AND session_user::text=$2 AND current_user::text=$2 "
    "AND (SELECT system_identifier::text FROM pg_control_system())=$3 "
    "AND (SELECT oid::text FROM pg_database WHERE datname=current_database())=$4 "
    "AND current_setting('server_version_num')::integer>=170006 "
    "AND current_setting('server_version_num')::integer<180000 AND NOT pg_is_in_recovery()", 4, values);
  if (!ok) return false;
#ifdef VAEROEX_MANAGED_SUPABASE
  (void)host;return PQsslInUse(db)!=0;
#endif
  if (!managed_profile() && !true_query("SELECT current_setting('server_version_num')='170006'",0,NULL))return false;
  if (host[0] == '/') return true_query("SELECT inet_server_addr() IS NULL AND inet_client_addr() IS NULL", 0, NULL);
  return PQsslInUse(db) && true_query("SELECT inet_server_addr() IN ('127.0.0.1'::inet,'::1'::inet) "
    "AND inet_client_addr() IN ('127.0.0.1'::inet,'::1'::inet) "
    "AND (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())", 0, NULL);
}
static bool candidate_identity(const char *host,const char *database,const char *target,
                               const char *system_id,const char *oid,const char *role_oid) {
  if (!managed_profile()) return identity(host,database,target,system_id,oid);
  /* The administrator already verified physical identity while holding the
   * authority locks. The broker receives no pg_control_system/admin privilege.
   * Its separate verified-TLS session must prove its own native identity. */
  const char *values[]={database,target,oid,role_oid};
  return PQsslInUse(db) && true_query("SELECT current_database()=$1 AND session_user::text=$2 AND current_user::text=$2 "
    "AND (SELECT oid::text FROM pg_database WHERE datname=current_database())=$3 "
    "AND (SELECT oid::text FROM pg_roles WHERE rolname=session_user)=$4 AND NOT pg_is_in_recovery()",4,values);
}
static bool closed_authority(const char *target) {
  const char *values[] = {target};
#ifdef MAPPED_ROLE
  /* Mapped maintenance requires the additive schema and known-disabled joined
   * gates. SHARE locks fence concurrent activation through credential commit.
   * FORCE RLS visibility must be established; hidden rows cannot prove closure. */
  if(strcmp(target,MAPPED_ROLE))return false;
  return command("LOCK TABLE private.square_account_configuration, private.square_remote_sandbox_binding, "
    "private.square_gcp_callback_binding, private.square_gcp_mapped_runtime_binding, "
    "private.square_qualification_gate IN SHARE MODE") &&
    (!managed_profile() || true_query("SELECT NOT row_security_active('private.square_account_configuration') "
      "AND NOT row_security_active('private.square_remote_sandbox_binding') "
      "AND NOT row_security_active('private.square_gcp_callback_binding') "
      "AND NOT row_security_active('private.square_gcp_mapped_runtime_binding') "
      "AND NOT row_security_active('private.square_qualification_gate')",0,NULL)) &&
    true_query("SELECT NOT EXISTS (SELECT FROM private.square_account_configuration "
      "WHERE broker_login=$1 OR webhook_login=$1 OR (enrollment_login=$1 AND "
      "(enrollment_enabled IS NOT FALSE OR (surface_enabled IS NOT FALSE AND blocked IS NOT TRUE)))) "
      /* Require independent account/qualification closure during provisioning,
       * including before any mapped binding exists. Do not depend solely on
       * a runtime wrapper: all isolated account gates must be known closed
       * while these maintenance locks are held, without mutating their state. */
      "AND NOT EXISTS (SELECT FROM private.square_account_configuration "
      "WHERE enrollment_enabled IS NOT FALSE AND blocked IS NOT TRUE) "
      "AND NOT EXISTS (SELECT FROM private.square_qualification_gate "
      "WHERE expires_at IS NULL OR expires_at>clock_timestamp()) "
      "AND NOT EXISTS (SELECT FROM private.square_remote_sandbox_binding "
      "WHERE broker_login=$1 OR enroller_login=$1 OR webhook_login=$1 OR runtime_login=$1) "
      "AND NOT EXISTS (SELECT FROM private.square_gcp_callback_binding WHERE broker_login=$1) "
      "AND NOT EXISTS (SELECT FROM private.square_gcp_mapped_runtime_binding m "
      "LEFT JOIN private.square_gcp_callback_binding b ON b.deployment_key=m.deployment_key "
      "WHERE (m.enroller_login=$1 OR m.runtime_login=$1) AND "
      "(m.enabled IS NOT FALSE OR m.provider_calls_enabled IS NOT FALSE "
      "OR b.enabled IS NOT FALSE OR b.provider_calls_enabled IS NOT FALSE))",1,values);
#else
  /* These predicates select DENIAL rows inside NOT EXISTS. Including a NULL
   * flag as a denial therefore rejects unknown authority; it never enables it.
   * Acceptance requires known surface=false or blocked=true, and enabled=false. */
  return command("LOCK TABLE private.square_account_configuration, private.square_remote_sandbox_binding, "
    "private.square_gcp_callback_binding IN SHARE MODE") &&
    (!managed_profile() || true_query("SELECT NOT row_security_active('private.square_account_configuration') "
      "AND NOT row_security_active('private.square_remote_sandbox_binding') "
      "AND NOT row_security_active('private.square_gcp_callback_binding')",0,NULL)) &&
    true_query("SELECT NOT EXISTS (SELECT FROM private.square_account_configuration "
      "WHERE (broker_login=$1 AND surface_enabled IS NOT FALSE AND blocked IS NOT TRUE) OR enrollment_login=$1 OR webhook_login=$1) "
      "AND NOT EXISTS (SELECT FROM private.square_remote_sandbox_binding "
      "WHERE (broker_login=$1 AND enabled IS NOT FALSE) OR enroller_login=$1 OR webhook_login=$1 OR runtime_login=$1) "
      "AND NOT EXISTS (SELECT FROM private.square_gcp_callback_binding WHERE broker_login=$1 AND enabled IS NOT FALSE)", 1, values);
#endif
}
static bool role_valid(const char *target, const char *oid, bool allow_login) {
  const char *values[] = {target, oid, allow_login ? "true" : "false", CAPABILITY};
  return true_query("SELECT EXISTS (SELECT FROM pg_roles r WHERE r.rolname=$1 AND r.oid::text=$2 "
    "AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication "
    "AND NOT r.rolbypassrls AND r.rolinherit AND (NOT r.rolcanlogin OR $3::boolean) "
    "AND r.rolconfig IS NULL) "
    "AND EXISTS (SELECT FROM pg_roles c WHERE c.rolname=$4 "
    "AND NOT c.rolcanlogin AND NOT c.rolsuper AND NOT c.rolcreaterole AND NOT c.rolcreatedb "
    "AND NOT c.rolreplication AND NOT c.rolbypassrls AND c.rolconfig IS NULL) "
    "AND EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member "
    "JOIN pg_roles c ON c.oid=m.roleid WHERE r.rolname=$1 AND c.rolname=$4 "
    "AND NOT m.admin_option AND m.inherit_option AND m.set_option) "
    /* Grants are keyed by grantor too: one good row must not hide a second
     * ADMIN-capable grant of the same capability from another grantor. */
    "AND NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member "
    "JOIN pg_roles c ON c.oid=m.roleid WHERE r.rolname=$1 AND "
    "(c.rolname<>$4 OR m.admin_option OR NOT m.inherit_option OR NOT m.set_option)) "
    "AND NOT EXISTS (SELECT FROM pg_roles c WHERE c.rolname NOT IN ($1,$4) "
    "AND pg_has_role($1,c.oid,'MEMBER')) "
    /* PG16+ gives a non-superuser CREATEROLE operator an inherent ADMIN-only
     * membership. That exact authenticated operator may manage this role but
     * must not inherit or SET ROLE into it. No other member is permitted. */
    "AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE m.roleid=(SELECT oid FROM pg_roles WHERE rolname=$1) "
    "AND NOT (m.member=(SELECT oid FROM pg_roles WHERE rolname=session_user) "
    "AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)) "
    /* Native shared dependencies cover direct ACLs (including column/function
     * grants), ownership, initial ACLs and policy references across databases.
     * A dedicated login may inherit the capability, not own extra authority. */
    "AND NOT EXISTS (SELECT FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass "
    "AND d.refobjid=(SELECT oid FROM pg_roles WHERE rolname=$1) AND d.deptype IN ('o','a','i','r')) "
    "AND NOT EXISTS (SELECT FROM pg_db_role_setting WHERE setrole=(SELECT oid FROM pg_roles WHERE rolname=$1))", 4, values);
}
static bool no_sessions(const char *target) {
  const char *values[] = {target};
  return true_query("SELECT NOT EXISTS (SELECT FROM pg_stat_activity WHERE usename=$1)", 1, values);
}
static bool lock_target(const char *target) {
  const char *values[] = {target};
  PGresult *r = query("SELECT pg_advisory_xact_lock(1936744818, hashtext($1))", 1, values);
  bool ok = r != NULL;
  if (r) PQclear(r);
  return ok;
}
static bool random_password(char *password) {
  /* Expand backwards in the already locked candidate buffer: no second,
   * password-equivalent entropy array is left on an unlocked stack page. */
  if (getentropy(password, PASSWORD_BYTES) != 0) return false;
  static const char hex[] = "0123456789abcdef";
  for (size_t i = PASSWORD_BYTES; i-- > 0;) {
    unsigned char value = (unsigned char)password[i];
    password[2*i] = hex[value >> 4];
    password[2*i+1] = hex[value & 15];
  }
  password[PASSWORD_CHARS] = 0;
  return true;
}
static bool assign_scram(const char *target,const char *password) {
  /* PQencryptPasswordConn is the supported libpq16+ password-management API.
   * Supplying the algorithm avoids its implicit SHOW query. The only SQL is
   * the fixed escaped ALTER USER containing a verifier, never the password. */
  char *verifier=PQencryptPasswordConn(db,password,target,"scram-sha-256");
  if (!verifier) return false;
  size_t verifier_size=strlen(verifier)+1;
  bool verifier_locked=verifier_size<=512 && mlock(verifier,verifier_size)==0;
  char *name=NULL,*literal=NULL;
  const size_t sql_size=4096;
  char *sql=mmap(NULL,sql_size,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
  bool sql_locked=sql!=MAP_FAILED && mlock(sql,sql_size)==0, literal_locked=false,ok=false;
  size_t literal_size=0;
  if (verifier_locked && sql_locked && !strncmp(verifier,"SCRAM-SHA-256$",14)) {
    name=PQescapeIdentifier(db,target,strlen(target));
    literal=PQescapeLiteral(db,verifier,verifier_size-1);
    if (literal) { literal_size=strlen(literal)+1;literal_locked=mlock(literal,literal_size)==0; }
    if (name && literal_locked) {
      int n=snprintf(sql,sql_size,"ALTER USER %s PASSWORD %s",name,literal);
      ok=n>0 && (size_t)n<sql_size && command(sql);
    }
  }
  /* Wipe both malloc regions before either page-granular unlock: allocator
   * neighbors can share a page. SQL uses its own mapping, not the caller's
   * locked password stack page. Library-internal copies are not zeroized here. */
  if (sql!=MAP_FAILED) { wipe(sql,sql_size);if(sql_locked)munlock(sql,sql_size);munmap(sql,sql_size); }
  if (literal) wipe(literal,literal_size);
  if (name) PQfreemem(name);
  wipe(verifier,verifier_size);
  if (literal_locked) munlock(literal,literal_size);
  if (verifier_locked) munlock(verifier,verifier_size);
  if (literal) PQfreemem(literal);
  PQfreemem(verifier);
  return ok;
}
static bool environment_safe(void) {
  for (char **p = environ; *p; p++)
    if (!strncmp(*p, "PG", 2) || !strncmp(*p, "LD_", 3) || !strncmp(*p, "DYLD_", 5)
      || !strncmp(*p, "MALLOC", 6) || !strncmp(*p, "LIBPQ", 5)) return false;
  return true;
}
static int run(int argc, char **argv) {
  if (argc != 14 || !environment_safe()) return 2;
  const char *op = argv[1], *host = argv[2], *port = argv[3], *database = argv[4], *admin = argv[5];
  const char *target = argv[6], *capability = argv[7], *system_id = argv[8], *db_oid = argv[9];
  const char *certificate = argv[10], *intent = argv[11], *role_oid = argv[12], *approval = argv[13];
  if (strcmp(op,"inspect") && strcmp(op,"prepare") && strcmp(op,"fence") && strcmp(op,"assign") && strcmp(op,"activate") && strcmp(op,"authenticate")) return 2;
  if (!digits(port,5) || strtoul(port,NULL,10) < 1 || strtoul(port,NULL,10) > 65535
    || !identifier(database) || !identifier(admin) || !identifier(target)
    || (strncmp(target,"square_",7) && strncmp(target,"vaeroex_",8))
    || strstr(target,"password") || strstr(target,"qbo") || !strcmp(target,capability) || !strcmp(target,admin)
    || strcmp(capability,CAPABILITY) || !digits(system_id,20) || !digits(db_oid,10) || !digits(role_oid,10)
    || !label(intent) || !label(approval) || !transport(host,port,database,admin,target,system_id,db_oid,certificate) || !library_version()
    || !private_pipe(3) || (!strcmp(op,"assign") && (!private_pipe(4) || !private_pipe(5)))
    || (!strcmp(op,"authenticate") && !private_pipe(6))) return 2;
  struct rlimit limit = {0,0};
  if (setrlimit(RLIMIT_CORE,&limit) != 0) return 2;
#ifdef __linux__
  if (prctl(PR_SET_DUMPABLE,0,0,0,0) != 0) return 2;
#endif
  char password[PASSWORD_CHARS+2] = {0}, admin_password[512] = {0};
  if (mlock(password,sizeof(password)) != 0) return 2;
  if (mlock(admin_password,sizeof(admin_password)) != 0) { munlock(password,sizeof(password)); return 2; }
  bool commit_attempted = false;
  bool ok = read_line(3,admin_password,sizeof(admin_password),5000);
  if (ok) {
    const char *keywords[] = {"host","port","dbname","user","password","passfile","sslmode","sslrootcert",
      "connect_timeout","application_name","options","sslcertmode","gssencmode","require_auth",NULL};
    const char *values[] = {host,port,database,transport_user(admin,false),admin_password,"/dev/null/vaeroex-no-passfile",host[0]=='/'?"disable":"verify-full",
      host[0]=='/'?NULL:certificate,"5","vaeroex-native-provisioner","","disable","disable",
#ifdef VAEROEX_MANAGED_SUPABASE
      "scram-sha-256",
#else
      NULL,
#endif
      NULL};
    db = PQconnectdbParams(keywords,values,0);
  }
  wipe(admin_password,sizeof(admin_password));
  /* mlock is page-granular and locks do not stack. These arrays may share a
   * page, so keep BOTH locks until all owned credential material is wiped. */
  ok = ok && db && PQstatus(db)==CONNECTION_OK && !stopped();
  if (ok) {
    PQsetNoticeProcessor(db,notice,NULL);
    atomic_store(&watched_socket,PQsocket(db));
    ok = identity(host,database,admin,system_id,db_oid) && profile();
  }
  if (ok) { ok = command("BEGIN"); transaction = ok; }
  if (ok) ok = closed_authority(target) && lock_target(target);
  if (ok && !strcmp(op,"prepare")) {
    const char *values[] = {target,CAPABILITY};
    ok = !strcmp(role_oid,"0") && true_query("SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname=$1) "
      "AND EXISTS (SELECT FROM pg_roles WHERE rolname=$2 AND NOT rolcanlogin "
      "AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls "
      "AND rolconfig IS NULL)",2,values);
    if (ok) ok = role_command("CREATE ROLE",target,"NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS");
    if (ok) ok = role_command("GRANT " CAPABILITY " TO",target,"WITH ADMIN FALSE, INHERIT TRUE, SET TRUE");
  } else if (ok && !strcmp(op,"inspect") && !strcmp(role_oid,"0")) {
    const char *values[]={target};
    ok=true_query("SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname=$1)",1,values);
  } else if (ok) {
    bool allow_login = !strcmp(op,"fence") || !strcmp(op,"inspect") || !strcmp(op,"authenticate");
    ok = strcmp(role_oid,"0") && role_valid(target,role_oid,allow_login);
    if (ok && strcmp(op,"inspect") && strcmp(op,"authenticate")) ok = role_command("ALTER ROLE",target,"NOLOGIN");
    if (ok && !strcmp(op,"fence")) {
      /* NOLOGIN must commit before termination so new authentication is denied.
       * Existing sessions are not revoked merely by changing their password. */
      commit_attempted = true;
      ok = command("COMMIT");
      transaction = false;
      const char *values[] = {target};
      if (ok) {
        PGresult *r = query("SELECT bool_and(pg_terminate_backend(pid,1000)) IS NOT FALSE FROM pg_stat_activity WHERE usename=$1",1,values);
        ok = r && PQntuples(r)==1 && !strcmp(PQgetvalue(r,0,0),"t");
        if (r) PQclear(r);
      }
      if (ok) ok = command("BEGIN");
      transaction = ok;
      if (ok) ok = closed_authority(target) && lock_target(target) && role_valid(target,role_oid,false) && no_sessions(target);
    }
    if (ok && (!strcmp(op,"assign") || !strcmp(op,"activate")))
      ok = role_valid(target,role_oid,false) && no_sessions(target);
    if (ok && !strcmp(op,"assign")) {
      puts("{\"phase\":\"ready\"}");
      fflush(stdout);
      ok = !stopped() && random_password(password);
      if (ok) {
        sensitive_started = true;
        ok = assign_scram(target,password);
      }
      if (ok) {
        password[PASSWORD_CHARS]='\n';
        ok = write_private(4,password,PASSWORD_CHARS+1);
        char ack[16] = {0};
        if (ok) ok = read_line(5,ack,sizeof(ack),5000) && !strcmp(ack,"STORED");
        wipe(ack,sizeof(ack));
      }
      wipe(password,sizeof(password));
    }
    if (ok && !strcmp(op,"activate")) ok = role_command("ALTER ROLE",target,"LOGIN");
    if (ok && !strcmp(op,"authenticate")) {
      /* The supervisor holds the staged value only in a private pipe. Keep the
       * authority-table locks until actual candidate authentication completes. */
      ok = read_line(6,password,sizeof(password),5000) && strlen(password)==PASSWORD_CHARS;
      for (size_t i=0; ok && i<PASSWORD_CHARS; i++)
        if (!((password[i]>='0' && password[i]<='9') || (password[i]>='a' && password[i]<='f'))) ok=false;
      PGconn *candidate=NULL;
      if (ok) {
        const char *keys[]={"host","port","dbname","user","password","passfile","sslmode","sslrootcert",
          "connect_timeout","application_name","options","sslcertmode","gssencmode","require_auth",NULL};
        const char *vals[]={host,port,database,transport_user(target,true),password,"/dev/null/vaeroex-no-passfile",host[0]=='/'?"disable":"verify-full",
          host[0]=='/'?NULL:certificate,"5","vaeroex-native-authentication","","disable","disable","scram-sha-256",NULL};
        candidate=PQconnectdbParams(keys,vals,0);
        ok=candidate && PQstatus(candidate)==CONNECTION_OK && !stopped();
      }
      wipe(password,sizeof(password));
      if (ok) {
        PQsetNoticeProcessor(candidate,notice,NULL);
        PGconn *admin_connection=db;
        db=candidate;
        atomic_store(&watched_socket,PQsocket(candidate));
        const char *values[]={target,role_oid};
        ok=candidate_identity(host,database,target,system_id,db_oid,role_oid) && true_query(
          "SELECT session_user::text=$1 AND (SELECT oid::text FROM pg_roles WHERE rolname=session_user)=$2",2,values);
        db=admin_connection;
        atomic_store(&watched_socket,PQsocket(db));
      }
      if (candidate) PQfinish(candidate);
    }
  }
  char resolved_oid[24]={0};
  if (ok && strcmp(op,"prepare")) {
    /* Existing roles were already OID-checked under the target lock. Keep the
     * secret-store acknowledgement immediately adjacent to the COMMIT attempt. */
    snprintf(resolved_oid,sizeof(resolved_oid),"%s",role_oid);
  } else if (ok) {
    const char *values[]={target};
    PGresult *r=query("SELECT oid::text FROM pg_roles WHERE rolname=$1",1,values);
    ok=r && PQntuples(r)==1 && digits(PQgetvalue(r,0,0),10);
    if (ok) snprintf(resolved_oid,sizeof(resolved_oid),"%s",PQgetvalue(r,0,0));
    if (r) PQclear(r);
  }
  /* A transport loss at COMMIT is never treated as rollback or success. */
  if (ok) { commit_attempted = true; ok = command("COMMIT"); transaction = !ok; }
  if (!ok && transaction && db && PQstatus(db)==CONNECTION_OK && !stopped()) (void)command("ROLLBACK");
  wipe(password,sizeof(password));
  munlock(password,sizeof(password));
  munlock(admin_password,sizeof(admin_password));
  if (!ok) return (sensitive_started || commit_attempted) ? 3 : 2;
  const char *outcome=!strcmp(op,"assign")?"assigned":!strcmp(op,"prepare")?"prepared":!strcmp(op,"fence")?"fenced":
    !strcmp(op,"activate")?"activated":!strcmp(op,"authenticate")?"authenticated":"inspected";
  printf("{\"outcome\":\"%s\",\"committed\":true,\"role_oid\":\"%s\"}\n",outcome,resolved_oid);
  return 0;
}
int main(int argc, char **argv) {
#if !defined(VAEROEX_SYNTHETIC_ONLY) && !defined(VAEROEX_MANAGED_SUPABASE)
  (void)argc; (void)argv; (void)run; (void)watch; (void)signal_stop;
  puts("{\"outcome\":\"policy_blocked\"}");
  return 4;
#else
  signal(SIGPIPE,SIG_IGN);
  struct sigaction action;
  memset(&action,0,sizeof(action));
  action.sa_handler=signal_stop;
  sigemptyset(&action.sa_mask);
  sigaction(SIGTERM,&action,NULL);
  sigaction(SIGINT,&action,NULL);
  clock_gettime(CLOCK_MONOTONIC,&started);
  pthread_t thread;
  if (pthread_create(&thread,NULL,watch,NULL)!=0) { puts("{\"outcome\":\"failed\"}"); return 2; }
  int result=run(argc,argv);
  atomic_store(&watcher_done,true);
  pthread_join(thread,NULL);
  atomic_store(&watched_socket,-1);
  if (db) PQfinish(db);
  if (result==2) puts("{\"outcome\":\"failed\"}");
  if (result==3) puts("{\"outcome\":\"uncertain\"}");
  return result;
#endif
}
