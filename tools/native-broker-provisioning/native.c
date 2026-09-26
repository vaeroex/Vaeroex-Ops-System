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
#ifndef PG_DIAG_SQLSTATE
#define PG_DIAG_SQLSTATE 'C'
#endif
/* The synthetic libpq header intentionally exposes only the small API surface
 * used by the provisioner. Keep this fixed diagnostic lookup available there
 * too; it returns only a SQLSTATE category, never the provider error text. */
extern char *PQresultErrorField(const PGresult *, int);
#ifdef __linux__
#include <sys/prctl.h>
#include <sys/random.h>
#else
#include <sys/random.h>
#endif

#if (defined(VAEROEX_PRODUCTION_OAUTH) + defined(VAEROEX_PRODUCTION_BROKER) + \
     defined(VAEROEX_PRODUCTION_SCHEDULER) + defined(VAEROEX_PRODUCTION_WEBHOOK) + \
     defined(VAEROEX_PRODUCTION_RUNTIME) + defined(VAEROEX_PRODUCTION_EVIDENCE)) > 0 && \
    (defined(VAEROEX_MAPPED_ENROLLER) || defined(VAEROEX_MAPPED_RUNTIME))
#error Production and Sandbox capability profiles are mutually exclusive
#elif (defined(VAEROEX_PRODUCTION_OAUTH) + defined(VAEROEX_PRODUCTION_BROKER) + \
       defined(VAEROEX_PRODUCTION_SCHEDULER) + defined(VAEROEX_PRODUCTION_WEBHOOK) + \
       defined(VAEROEX_PRODUCTION_RUNTIME) + defined(VAEROEX_PRODUCTION_EVIDENCE)) > 1
#error Choose one fixed Production capability
#elif defined(VAEROEX_PRODUCTION_OAUTH)
#define CAPABILITY "square_production_oauth_authority"
#define CAPABILITY_NAME "oauth"
#define MAPPED_ROLE "square_production_oauth"
#define AUTHORITY_FUNCTION "public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)"
#define VAEROEX_PRODUCTION_PROFILE 1
#elif defined(VAEROEX_PRODUCTION_BROKER)
#define CAPABILITY "square_production_broker_authority"
#define CAPABILITY_NAME "broker"
#define MAPPED_ROLE "square_production_broker"
#define AUTHORITY_FUNCTION "public.check_square_production_broker_authority_v1(text,text,text,bigint,text)"
#define VAEROEX_PRODUCTION_PROFILE 1
#elif defined(VAEROEX_PRODUCTION_SCHEDULER)
#define CAPABILITY "square_production_scheduler_authority"
#define CAPABILITY_NAME "scheduler"
#define MAPPED_ROLE "square_production_scheduler"
#define AUTHORITY_FUNCTION "public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)"
#define VAEROEX_PRODUCTION_PROFILE 1
#elif defined(VAEROEX_PRODUCTION_WEBHOOK)
#define CAPABILITY "square_production_webhook_authority"
#define CAPABILITY_NAME "webhook"
#define MAPPED_ROLE "square_production_webhook"
#define AUTHORITY_FUNCTION "public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)"
#define VAEROEX_PRODUCTION_PROFILE 1
#elif defined(VAEROEX_PRODUCTION_RUNTIME)
#define CAPABILITY "square_production_runtime_authority"
#define CAPABILITY_NAME "runtime"
#define MAPPED_ROLE "square_production_runtime"
#define AUTHORITY_FUNCTION "public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)"
#define VAEROEX_PRODUCTION_PROFILE 1
#elif defined(VAEROEX_PRODUCTION_EVIDENCE)
#define CAPABILITY "square_production_evidence_authority"
#define CAPABILITY_NAME "evidence"
#define MAPPED_ROLE "square_production_evidence"
#define AUTHORITY_FUNCTION "public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)"
#define VAEROEX_PRODUCTION_PROFILE 1
#elif defined(VAEROEX_MAPPED_ENROLLER) && defined(VAEROEX_MAPPED_RUNTIME)
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
#ifdef VAEROEX_PRODUCTION_PROFILE
/* The authority RPC is a fixed, reviewed capability boundary.  ACL shape
 * alone does not prove that a same-signature replacement still performs the
 * generation check, so the native recheck pins the stored PL/pgSQL source too.
 * `prosrc` preserves the dollar-quoted body byte-for-byte on PostgreSQL. */
#define AUTHORITY_SOURCE_FOR(capability,capability_name) \
  "\nbegin\n" \
  "  if not pg_catalog.pg_has_role(session_user,'" capability "','MEMBER') then\n" \
  "    raise exception '" capability "_denied' using errcode='42501';\n" \
  "  end if;\n" \
  "  perform private.check_square_production_operational_generation_v1(\n" \
  "    p_provider_key,p_environment,p_project_id,p_generation,p_configuration_fingerprint,'" capability_name "');\n" \
  "end\n"
#define AUTHORITY_SOURCE AUTHORITY_SOURCE_FOR(CAPABILITY,CAPABILITY_NAME)
#define OPERATIONAL_AUTHORITY_FUNCTION \
  "private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)"
/* PostgreSQL's built-in md5(text) is sufficient here because this is an
 * equality pin, not a password hash. It avoids making the native authority
 * recheck depend on an extension ACL while detecting any helper replacement. */
#define OPERATIONAL_AUTHORITY_SOURCE_MD5 "0af0303c9f714bea9662be9b85c6b9c7"
typedef enum {
  PRODUCTION_PHASE_INVALID = 0,
  PRODUCTION_PHASE_OVERLAY = 1,
  PRODUCTION_PHASE_INTERNAL_RUNTIME = 2,
  PRODUCTION_PHASE_CUSTOMER = 3
} production_phase;
static production_phase production_ledger_phase(void);
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
#if defined(VAEROEX_PRODUCTION_INTERNAL_RUNTIME_TEST) && !defined(VAEROEX_SYNTHETIC_ONLY)
#error Internal runtime profile tests require the local-only synthetic target gate
#endif
#if defined(VAEROEX_PRODUCTION_INTERNAL_RUNTIME_SOURCE_SHA256) && !defined(VAEROEX_PRODUCTION_PROFILE)
#error Internal runtime source pins are valid only for Production profiles
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
static atomic_int watched_control_socket = -1;
static atomic_bool watcher_done = false;
static atomic_bool expired = false;
static struct timespec started;
static PGconn *db = NULL;
static PGconn *control_db = NULL;
static bool sensitive_started = false;
static bool transaction = false;
static bool last_query_error = false;
static const char *last_query_error_category = "none";

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
      int control_fd = atomic_load(&watched_control_socket);
      if (fd >= 0) shutdown(fd, SHUT_RDWR);
      if (control_fd >= 0 && control_fd != fd) shutdown(control_fd, SHUT_RDWR);
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
  last_query_error = false;
  last_query_error_category = "none";
  if (stopped()) return NULL;
  PGresult *r = PQexecParams(db, sql, count, NULL, values, NULL, NULL, 0);
  if (!r || PQresultStatus(r) != PGRES_TUPLES_OK || stopped()) {
    last_query_error = true;
    const char *state = r ? PQresultErrorField(r, PG_DIAG_SQLSTATE) : NULL;
    if (state && !strcmp(state,"42703")) last_query_error_category = "undefined_column";
    else if (state && !strcmp(state,"42883")) last_query_error_category = "undefined_function";
    else if (state && !strcmp(state,"42P01")) last_query_error_category = "undefined_table";
    else if (state && !strcmp(state,"42704")) last_query_error_category = "undefined_object";
    else if (state && !strcmp(state,"42601")) last_query_error_category = "syntax";
    else if (state && !strcmp(state,"42804")) last_query_error_category = "datatype";
    else if (state && !strcmp(state,"42846")) last_query_error_category = "cannot_coerce";
    else if (state && !strcmp(state,"42809")) last_query_error_category = "wrong_object_type";
    else if (state && !strcmp(state,"42P02")) last_query_error_category = "undefined_parameter";
    else if (state && !strcmp(state,"42P10")) last_query_error_category = "invalid_column_reference";
    else if (state && !strcmp(state,"42P16")) last_query_error_category = "invalid_table_definition";
    else if (state && !strcmp(state,"42P17")) last_query_error_category = "invalid_object_definition";
    else if (state && !strcmp(state,"42P18")) last_query_error_category = "indeterminate_datatype";
    else if (state && !strcmp(state,"22023")) last_query_error_category = "invalid_parameter_value";
    else if (state && !strcmp(state,"0A000")) last_query_error_category = "feature_not_supported";
    else if (state && !strcmp(state,"42501")) last_query_error_category = "permission";
    else if (state && !strcmp(state,"25P02")) last_query_error_category = "aborted_transaction";
    else if (state && !strcmp(state,"55000")) last_query_error_category = "prerequisite_state";
    else if (state && !strcmp(state,"2BP01")) last_query_error_category = "dependent_objects";
    else if (state) last_query_error_category = "other_sqlstate";
    else last_query_error_category = "transport";
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
#ifdef VAEROEX_PRODUCTION_PROFILE
#ifdef VAEROEX_MANAGED_PROFILE_TEST
static bool managed_test_block_control = false;
static int managed_test_transition_waits = 0;
#endif
static bool terminate_target_sessions(PGconn *connection,const char *target) {
  const char *values[]={target};
  PGresult *r=PQexecParams(connection,
#ifdef VAEROEX_MANAGED_PROFILE_TEST
    managed_test_block_control ? "SELECT true FROM (SELECT pg_sleep(30)) blocked" :
#endif
    "SELECT coalesce(bool_and(pg_terminate_backend(pid,1000)),true) "
    "FROM pg_stat_activity WHERE usename=$1",1,NULL,values,NULL,NULL,0);
  bool ok=r && PQresultStatus(r)==PGRES_TUPLES_OK && PQntuples(r)==1 &&
    PQnfields(r)==1 && !strcmp(PQgetvalue(r,0,0),"t");
  if (r) PQclear(r);
  return ok && !stopped();
}
static bool managed_fence_command(const char *sql,const char *target) {
  if (!managed_profile() || !control_db || PQstatus(control_db)!=CONNECTION_OK ||
      strcmp(target,MAPPED_ROLE)) return false;
  /* A target LOGIN may hold its own pg_authid tuple with an uncommitted
   * ALTER ROLE CURRENT_USER PASSWORD.  The hosted operator cannot lock that
   * provider-owned catalog first.  Drain the exact target, then keep draining
   * through the bounded asynchronous NOLOGIN transition.  Once ALTER ROLE
   * owns the tuple, reconnecting sessions cannot change it; the normal
   * post-commit drain removes any session authenticated in the preceding
   * race window.  No query contains a credential or accepts a caller-selected
   * role. */
  if (!terminate_target_sessions(control_db,target)) return false;
  if (PQsetnonblocking(db,1)!=0 || !PQsendQuery(db,sql)) {
    (void)PQsetnonblocking(db,0);
    return false;
  }
  bool ok=true;
  while (ok && !stopped() && PQisBusy(db)) {
    ok=terminate_target_sessions(control_db,target);
    struct pollfd descriptor={PQsocket(db),POLLIN,0};
    int ready=poll(&descriptor,1,20);
    if (ready<0 && errno==EINTR) continue;
    if (ready<0 || (ready>0 && !PQconsumeInput(db))) ok=false;
  }
  int results=0;
  if (ok && !PQisBusy(db)) {
    for (PGresult *r=PQgetResult(db);r;r=PQgetResult(db)) {
      results++;
      if (PQresultStatus(r)!=PGRES_COMMAND_OK) ok=false;
      PQclear(r);
    }
  } else ok=false;
  if (PQsetnonblocking(db,0)!=0) ok=false;
  return ok && results==1 && !stopped();
}
static bool managed_close_capability(const char *target) {
  return managed_profile() && !strcmp(target,MAPPED_ROLE) &&
    role_command("GRANT " CAPABILITY " TO",target,
      "WITH ADMIN FALSE, INHERIT FALSE, SET FALSE");
}
static bool managed_fence_role(const char *target) {
  char alter[128];
  int alter_length=snprintf(alter,sizeof(alter),"ALTER ROLE \"%s\" NOLOGIN NOINHERIT",target);
  return alter_length>0 && (size_t)alter_length<sizeof(alter) &&
    managed_fence_command(alter,target);
}
#endif
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
#ifdef VAEROEX_PRODUCTION_PROFILE
static bool production_authority_catalog_fence(void) {
  if (managed_profile()) {
    /* Hosted Supabase owns system catalogs as supabase_admin.  The supported
     * password-backed postgres operator can read them and manage the fixed
     * roles, but cannot take write-strength LOCK TABLE modes on those catalogs.
     * Serialize every reviewed native Production worker with a write-strength
     * lock on the fixed private platform-binding relation instead.  Only its
     * owner or a role with a qualifying write/MAINTAIN privilege can acquire
     * this mode; application LOGINs receive neither.  The remaining authority
     * tables are locked below, and the complete ledger, schema,
     * ABI, ACL and role contract is re-read both before mutation and
     * immediately before COMMIT under READ COMMITTED.  The bounded operator
     * window prohibits out-of-band administrative DDL while this fence is held;
     * a later boundary still rejects any committed drift. */
    return command("LOCK TABLE private.integration_production_platform_bindings IN SHARE ROW EXCLUSIVE MODE");
  }
  return command("LOCK TABLE pg_catalog.pg_proc IN SHARE ROW EXCLUSIVE MODE") &&
    command("LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE") &&
    command("LOCK TABLE pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE") &&
    command("LOCK TABLE pg_catalog.pg_db_role_setting IN SHARE ROW EXCLUSIVE MODE") &&
    command("LOCK TABLE pg_catalog.pg_namespace IN SHARE ROW EXCLUSIVE MODE") &&
    command("LOCK TABLE pg_catalog.pg_class IN SHARE ROW EXCLUSIVE MODE") &&
    command("LOCK TABLE pg_catalog.pg_database IN SHARE ROW EXCLUSIVE MODE") &&
    command("LOCK TABLE pg_catalog.pg_parameter_acl IN SHARE ROW EXCLUSIVE MODE") &&
    command("LOCK TABLE pg_catalog.pg_default_acl IN SHARE ROW EXCLUSIVE MODE");
}
#endif
#ifdef VAEROEX_PRODUCTION_PROFILE
static bool production_contract_valid(production_phase phase);
#endif
static bool checked_authority(const char *target,bool customer_fence) {
  const char *values[] = {target};
#ifdef VAEROEX_PRODUCTION_PROFILE
  if(strcmp(target,MAPPED_ROLE))return false;
  if (!production_authority_catalog_fence()) return false;
  if (managed_profile() && !command("LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE")) return false;
  production_phase phase=production_ledger_phase();
  if (phase==PRODUCTION_PHASE_INVALID || !command("LOCK TABLE private.integration_production_platform_bindings, "
    "private.integration_production_provider_bindings, private.integration_production_provider_secrets, "
    "private.integration_production_provider_capabilities, private.square_production_configuration_generations, "
    "private.square_production_runtime_bindings, private.square_production_generation_fences, "
    "private.square_production_lifecycle_audit_events IN SHARE MODE")) return false;
  if (phase>=PRODUCTION_PHASE_INTERNAL_RUNTIME && !command(
    "LOCK TABLE private.square_production_internal_permits, private.square_production_internal_oauth_states, "
    "private.square_production_internal_credentials, private.square_production_internal_scans, "
    "private.square_production_internal_page_receipts, private.square_production_internal_source_versions, "
    "private.square_production_internal_fences, private.square_production_internal_audit_events IN SHARE MODE")) return false;
  if (managed_profile() && !true_query("SELECT NOT row_security_active('private.integration_production_platform_bindings') "
      "AND NOT row_security_active('private.integration_production_provider_bindings') "
      "AND NOT row_security_active('private.integration_production_provider_secrets') "
      "AND NOT row_security_active('private.integration_production_provider_capabilities') "
      "AND NOT row_security_active('private.square_production_configuration_generations') "
      "AND NOT row_security_active('private.square_production_runtime_bindings') "
      "AND NOT row_security_active('private.square_production_generation_fences') "
      "AND NOT row_security_active('private.square_production_lifecycle_audit_events')",0,NULL)) return false;
  if (phase>=PRODUCTION_PHASE_INTERNAL_RUNTIME && managed_profile() && !true_query(
      "SELECT NOT row_security_active('private.square_production_internal_permits') "
      "AND NOT row_security_active('private.square_production_internal_oauth_states') "
      "AND NOT row_security_active('private.square_production_internal_credentials') "
      "AND NOT row_security_active('private.square_production_internal_scans') "
      "AND NOT row_security_active('private.square_production_internal_page_receipts') "
      "AND NOT row_security_active('private.square_production_internal_source_versions') "
      "AND NOT row_security_active('private.square_production_internal_fences') "
      "AND NOT row_security_active('private.square_production_internal_audit_events')",0,NULL)) return false;
  if (phase==PRODUCTION_PHASE_CUSTOMER && (!command(
      "LOCK TABLE private.square_production_customer_bindings, private.square_production_customer_connections, "
      "private.square_production_customer_oauth_states, private.square_production_customer_credentials IN SHARE MODE") ||
      !true_query("SELECT NOT row_security_active('private.square_production_customer_bindings')",0,NULL) ||
      (customer_fence ? !production_contract_valid(phase) :
        !true_query("SELECT NOT EXISTS (SELECT FROM private.square_production_customer_bindings "
          "WHERE consent_enabled)",0,NULL)))) return false;
  return true_query("SELECT NOT EXISTS (SELECT FROM private.integration_production_platform_bindings "
      "WHERE infrastructure_provisioned OR runtime_enabled OR economic_contributions_enabled OR ai_dispatch_enabled) "
      "AND NOT EXISTS (SELECT FROM private.integration_production_provider_bindings "
      "WHERE provider_key='square' AND environment='production' AND "
      "(enabled OR provider_calls_enabled OR customer_onboarding_enabled OR webhook_intake_enabled "
      "OR evidence_enabled OR economic_contributions_enabled OR ai_dispatch_enabled)) "
      "AND NOT EXISTS (SELECT FROM private.square_production_configuration_generations WHERE "
      "runtime_enabled OR provider_calls_enabled OR customer_onboarding_enabled OR webhook_intake_enabled "
      "OR evidence_enabled OR economic_contributions_enabled OR ai_dispatch_enabled) "
      "AND NOT EXISTS (SELECT FROM private.integration_production_provider_capabilities "
      "WHERE database_login=$1 AND NOT (provider_key='square' AND environment='production' "
      "AND project_id='vaeroex-integrations-prod' AND capability='" CAPABILITY_NAME "' "
      "AND database_secret_purpose='database_" CAPABILITY_NAME "'))",1,values);
#elif defined(MAPPED_ROLE)
  (void)customer_fence;
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
  (void)customer_fence;
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
static bool closed_authority(const char *target) {
  return checked_authority(target,false);
}
#ifdef VAEROEX_PRODUCTION_PROFILE
/* Revocation must remain possible while the customer consent binding is open.
 * This exception is fence-only, checks the exact customer protection contract,
 * and does not grant authority or change any activation binding. Provisioning,
 * admission and ordinary inspection still require the binding closed. */
static bool fence_authority(const char *target) {
  return checked_authority(target,true);
}
#endif

#ifdef VAEROEX_PRODUCTION_PROFILE
static bool production_internal_runtime_source_pinned(void) {
#ifdef VAEROEX_PRODUCTION_INTERNAL_RUNTIME_SOURCE_SHA256
  /* This second pin is deliberately compiled into the broker. The offline
   * builder also verifies the migration bytes before defining the macro, so a
   * final-ledger database cannot be accepted by a baseline-source binary. */
  return !strcmp(VAEROEX_PRODUCTION_INTERNAL_RUNTIME_SOURCE_SHA256,
    "ff2182044f28d6901f1582db3d31ef20d027a1e4590f0b295a7a64a1ad4c1325");
#else
  return false;
#endif
}

static production_phase production_ledger_phase(void) {
  if (!managed_profile()) {
#ifdef VAEROEX_PRODUCTION_INTERNAL_RUNTIME_TEST
    return production_internal_runtime_source_pinned()
      ? PRODUCTION_PHASE_INTERNAL_RUNTIME : PRODUCTION_PHASE_INVALID;
#else
    return PRODUCTION_PHASE_OVERLAY;
#endif
  }
  PGresult *r=query("SELECT CASE "
    "WHEN (SELECT count(*)=103 FROM supabase_migrations.schema_migrations) "
      "AND (SELECT count(*)=102 FROM supabase_migrations.schema_migrations WHERE version<='20260902191323') "
      "AND (SELECT 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to("
        "pg_catalog.string_agg(pg_catalog.length(version)::text||':'||version,'' ORDER BY version),'UTF8'),'sha256'),'hex') "
        "='sha256:3326a738d016df98e0fd22830b8c950dac3cc6d50bd26b61de1d9ebd282c201f' "
        "FROM supabase_migrations.schema_migrations WHERE version<='20260902191323') "
      "AND (SELECT 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to("
        "pg_catalog.string_agg(pg_catalog.length(version)::text||':'||version,'' ORDER BY version),'UTF8'),'sha256'),'hex') "
        "='sha256:224d377fe3f44a59dabd188ad897624207830940a985e408e0072fb7941db146' "
        "FROM supabase_migrations.schema_migrations WHERE version<='20260902191324') "
      "AND (SELECT count(*)=1 FROM supabase_migrations.schema_migrations WHERE version='20260902191323') "
      "AND (SELECT count(*)=1 FROM supabase_migrations.schema_migrations WHERE version='20260902191324') "
      "AND NOT EXISTS (SELECT FROM supabase_migrations.schema_migrations WHERE version>'20260902191324') THEN 'overlay' "
    "WHEN (SELECT count(*) IN (104,105) FROM supabase_migrations.schema_migrations) "
      "AND (SELECT count(*)=102 FROM supabase_migrations.schema_migrations WHERE version<='20260902191323') "
      "AND (SELECT 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to("
        "pg_catalog.string_agg(pg_catalog.length(version)::text||':'||version,'' ORDER BY version),'UTF8'),'sha256'),'hex') "
        "='sha256:3326a738d016df98e0fd22830b8c950dac3cc6d50bd26b61de1d9ebd282c201f' "
        "FROM supabase_migrations.schema_migrations WHERE version<='20260902191323') "
      "AND (SELECT 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to("
        "pg_catalog.string_agg(pg_catalog.length(version)::text||':'||version,'' ORDER BY version),'UTF8'),'sha256'),'hex') "
        "='sha256:224d377fe3f44a59dabd188ad897624207830940a985e408e0072fb7941db146' "
        "FROM supabase_migrations.schema_migrations WHERE version<='20260902191324') "
      "AND (SELECT 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to("
        "pg_catalog.string_agg(pg_catalog.length(version)::text||':'||version,'' ORDER BY version),'UTF8'),'sha256'),'hex') "
        "='sha256:7dc51d888ee9c4a6bb595b1a4431ab5fcdb649e34c871ba91a6512d5fa2dc89f' "
        "FROM supabase_migrations.schema_migrations WHERE version<='20260902191325') "
      "AND (SELECT count(*)=1 FROM supabase_migrations.schema_migrations WHERE version='20260902191323') "
      "AND (SELECT count(*)=1 FROM supabase_migrations.schema_migrations WHERE version='20260902191324') "
      "AND (SELECT count(*)=1 FROM supabase_migrations.schema_migrations WHERE version='20260902191325') "
      "AND ((SELECT count(*)=104 FROM supabase_migrations.schema_migrations) "
        "AND NOT EXISTS (SELECT FROM supabase_migrations.schema_migrations WHERE version>'20260902191325') "
        "OR (SELECT count(*)=105 FROM supabase_migrations.schema_migrations) "
        "AND (SELECT count(*)=1 FROM supabase_migrations.schema_migrations WHERE version='20260925032300') "
        "AND NOT EXISTS (SELECT FROM supabase_migrations.schema_migrations WHERE version>'20260902191325' AND version<>'20260925032300')) "
      "THEN CASE WHEN (SELECT count(*)=105 FROM supabase_migrations.schema_migrations) THEN 'customer' ELSE 'internal' END "
    "ELSE 'invalid' END",0,NULL);
  production_phase phase=PRODUCTION_PHASE_INVALID;
  if (r && PQntuples(r)==1) {
    if (!strcmp(PQgetvalue(r,0,0),"overlay")) phase=PRODUCTION_PHASE_OVERLAY;
    if (!strcmp(PQgetvalue(r,0,0),"internal") && production_internal_runtime_source_pinned())
      phase=PRODUCTION_PHASE_INTERNAL_RUNTIME;
#ifdef VAEROEX_PRODUCTION_CUSTOMER_CONTRACT
    if (!strcmp(PQgetvalue(r,0,0),"customer") && production_internal_runtime_source_pinned())
      phase=PRODUCTION_PHASE_CUSTOMER;
#endif
  }
  if (r) PQclear(r);
  return phase;
}

static bool production_relations_valid(void) {
#ifdef VAEROEX_PRODUCTION_PROFILE
  if (!managed_profile()) return true;
  return true_query("WITH expected(name,triggers) AS (VALUES "
      "('private.integration_production_platform_bindings',0),"
      "('private.integration_production_provider_bindings',0),"
      "('private.integration_production_provider_secrets',0),"
      "('private.integration_production_provider_capabilities',0),"
      "('private.square_production_configuration_generations',3),"
      "('private.square_production_runtime_bindings',4),"
      "('private.square_production_generation_fences',3),"
      "('private.square_production_lifecycle_audit_events',2)), "
    "resolved AS (SELECT expected.*,to_regclass(expected.name) oid FROM expected) "
    "SELECT (SELECT count(*)=8 FROM resolved WHERE oid IS NOT NULL) "
    "AND NOT EXISTS (SELECT FROM resolved e LEFT JOIN pg_class r ON r.oid=e.oid WHERE r.oid IS NULL "
      "OR r.relkind<>'r' OR r.relpersistence<>'p' OR r.relowner<>current_user::regrole::oid "
      "OR NOT r.relrowsecurity OR NOT r.relforcerowsecurity OR r.relhassubclass "
      "OR e.triggers<>(SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal AND t.tgenabled='O') "
      "OR e.triggers<>(SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal)) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_inherits i ON i.inhrelid=e.oid OR i.inhparent=e.oid) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_rewrite w ON w.ev_class=e.oid) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_policy p ON p.polrelid=e.oid) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_class r ON r.oid=e.oid "
      "CROSS JOIN LATERAL aclexplode(r.relacl) a WHERE a.grantee<>r.relowner) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_attribute col ON col.attrelid=e.oid AND col.attnum>0 AND NOT col.attisdropped "
      "CROSS JOIN LATERAL aclexplode(col.attacl) a JOIN pg_class r ON r.oid=e.oid WHERE a.grantee<>r.relowner) "
    "AND NOT EXISTS (SELECT FROM pg_publication WHERE puballtables) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_publication_rel p ON p.prrelid=e.oid) "
    "AND NOT EXISTS (SELECT FROM pg_publication_namespace WHERE pnnspid='private'::regnamespace)",0,NULL);
#else
  return true;
#endif
}

static bool production_function_abi_valid(void) {
#ifdef VAEROEX_PRODUCTION_PROFILE
  if (!managed_profile()) return true;
  return true_query("WITH expected(signature,language,volatility,security_definer,is_strict,parallel,result,names,source_hash) AS (VALUES "
      "('private.square_production_generation_fingerprint_v1(bigint,text[])','sql','i',false,true,'s','text',"
        "array['p_generation','p_parts']::text[],'def74b5d5cad41db546e9d892226a2cc83c76d19274e2a021f04b13d640bc71d'),"
      "('private.square_production_configuration_fingerprint_v1(bigint,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,text,text[],text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean)',"
        "'sql','i',false,true,'s','text',array['p_generation','p_provider_key','p_environment','p_project_id','p_region','p_lifecycle_state','p_application_id','p_callback_origin','p_callback_method','p_callback_path','p_callback_uri','p_webhook_method','p_webhook_path','p_webhook_uri','p_api_version','p_authorization_endpoint','p_provider_origin','p_requested_scopes','p_kms_key_resource','p_application_secret_purpose','p_webhook_signature_secret_purpose','p_database_secret_purposes','p_provider_policy_version','p_source_commit','p_runtime_enabled','p_provider_calls_enabled','p_customer_onboarding_enabled','p_webhook_intake_enabled','p_evidence_enabled','p_economic_contributions_enabled','p_ai_dispatch_enabled']::text[],"
        "'5d7db71e0b5586089ac422a2eea3b0a0e85b1439314e6dcb238f1b91b85a8bea'),"
      "('private.reject_square_production_immutable_mutation_v1()','plpgsql','v',false,false,'u','trigger',null::text[],'9aeed7ebf8d8f94a6d1a368296e90c9db1e1eecaf5c87adcf095c1149f9612f8'),"
      "('private.validate_square_production_runtime_binding_v1()','plpgsql','v',false,false,'u','trigger',null::text[],'58e0806b2d796690b3be6c4d1939f81c84ed9481aa4a4cdac10210f22d0dc2f7'),"
      "('private.record_square_production_lifecycle_audit_v1()','plpgsql','v',false,false,'u','trigger',null::text[],'81460db3bc5c19b6e6b27e119be59cf5d172427790fb4deaef7194195e2c85d4'),"
      "('private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)','plpgsql','s',false,false,'u','void',"
        "array['p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint','p_capability']::text[],'9f88e3f2787d4e7a30f66e4a42b00a8044b0c51cd69f9368b4bb9f45c0f8fdab')"
    "), resolved AS (SELECT e.*,to_regprocedure(e.signature) oid FROM expected e) "
    "SELECT (SELECT count(*)=6 FROM resolved WHERE oid IS NOT NULL) "
    "AND NOT EXISTS (SELECT FROM resolved e LEFT JOIN pg_proc p ON p.oid=e.oid "
      "LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR l.lanname<>e.language "
      "OR p.proowner<>current_user::regrole::oid OR p.provolatile<>e.volatility::\"char\" "
      "OR p.prosecdef<>e.security_definer OR p.proisstrict<>e.is_strict OR p.proparallel<>e.parallel::\"char\" "
      "OR p.proretset OR p.prokind<>'f' OR p.prorettype<>to_regtype(e.result) "
      "OR p.proargnames IS DISTINCT FROM e.names OR p.proargmodes IS NOT NULL "
      "OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL "
      "OR p.proconfig IS DISTINCT FROM array['search_path=\"\"']::text[] "
      "OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256'),'hex')<>e.source_hash) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_proc p ON p.oid=e.oid "
      "CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) "
    "AND EXISTS (SELECT FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang "
      "WHERE p.oid=to_regprocedure('private.integration_production_fingerprint_v1(text[])') "
      "AND p.proowner=current_user::regrole::oid AND p.provolatile='i' AND p.proisstrict AND p.proparallel='s' "
      "AND NOT p.prosecdef AND p.proconfig IS NOT DISTINCT FROM array['search_path=\"\"']::text[] "
      "AND p.prokind='f' AND NOT p.proretset AND p.pronargs=1 AND p.prorettype='text'::regtype AND l.lanname='sql' "
      "AND p.proargnames IS NOT DISTINCT FROM array['p_parts']::text[] AND p.proargmodes IS NULL "
      "AND p.pronargdefaults=0 AND p.proargdefaults IS NULL "
      "AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256'),'hex') "
        "='98a86fc4d75c479b10ae63900cdf1c03a5083fb59a52d61636cc3a886acfa096' "
      "AND NOT EXISTS (SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a "
        "WHERE a.grantee<>p.proowner))",0,NULL);
#else
  return true;
#endif
}

static bool production_foundation_schema_valid(void) {
#ifdef VAEROEX_PRODUCTION_PROFILE
  if (!managed_profile()) return true;
  return true_query("SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to((pg_catalog.jsonb_build_object("
    "'columns',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array("
      "r.relname,a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),"
      "a.attnotnull,a.attidentity,a.attgenerated,pg_catalog.pg_get_expr(d.adbin,d.adrelid,true)) "
      "ORDER BY r.relname,a.attnum) FROM pg_catalog.pg_class r "
      "JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace "
      "JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid "
      "LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum "
      "WHERE n.nspname='private' AND r.relname=ANY(array["
        "'integration_production_platform_bindings','integration_production_provider_bindings',"
        "'integration_production_provider_secrets','integration_production_provider_capabilities']) "
      "AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),"
    "'constraints',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array("
      "r.relname,c.conname,c.contype,c.condeferrable,c.condeferred,c.convalidated,"
      "pg_catalog.pg_get_constraintdef(c.oid,true)) ORDER BY r.relname,c.conname) "
      "FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class r ON r.oid=c.conrelid "
      "JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='private' "
      "AND r.relname=ANY(array['integration_production_platform_bindings','integration_production_provider_bindings',"
        "'integration_production_provider_secrets','integration_production_provider_capabilities'])),'[]'::jsonb),"
    "'indexes',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array("
      "r.relname,ir.relname,pg_catalog.pg_get_indexdef(i.indexrelid,0,true)) ORDER BY r.relname,ir.relname) "
      "FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class r ON r.oid=i.indrelid "
      "JOIN pg_catalog.pg_class ir ON ir.oid=i.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace "
      "WHERE n.nspname='private' AND r.relname=ANY(array["
        "'integration_production_platform_bindings','integration_production_provider_bindings',"
        "'integration_production_provider_secrets','integration_production_provider_capabilities'])),'[]'::jsonb),"
    "'policy_count',(SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=ANY(array["
      "'private.integration_production_platform_bindings'::regclass,"
      "'private.integration_production_provider_bindings'::regclass,"
      "'private.integration_production_provider_secrets'::regclass,"
      "'private.integration_production_provider_capabilities'::regclass])),"
    "'trigger_count',(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid=ANY(array["
      "'private.integration_production_platform_bindings'::regclass,"
      "'private.integration_production_provider_bindings'::regclass,"
      "'private.integration_production_provider_secrets'::regclass,"
      "'private.integration_production_provider_capabilities'::regclass]))"
    "))::text,'UTF8'),'sha256'),'hex')='0fe4e1c2080fed1725db60ddb1643f4cd2d979a1a261c3445aae54c56788897e'",0,NULL);
#else
  return true;
#endif
}

static bool production_overlay_schema_valid(void) {
#ifdef VAEROEX_PRODUCTION_PROFILE
  if (!managed_profile()) return true;
  return true_query("SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to((pg_catalog.jsonb_build_object("
    "'columns',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array("
      "r.relname,a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),"
      "a.attnotnull,a.attidentity,a.attgenerated,pg_catalog.pg_get_expr(d.adbin,d.adrelid,true),"
      "CASE WHEN a.attcollation=0 THEN NULL ELSE pg_catalog.format('%I.%I',cn.nspname,col.collname) END,"
      "col.collprovider::text,col.collisdeterministic,col.collversion) ORDER BY r.relname,a.attnum) "
      "FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace "
      "JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid "
      "LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum "
      "LEFT JOIN pg_catalog.pg_collation col ON col.oid=a.attcollation "
      "LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=col.collnamespace "
      "WHERE n.nspname='private' AND r.relname=ANY(array["
        "'square_production_configuration_generations','square_production_runtime_bindings',"
        "'square_production_generation_fences','square_production_lifecycle_audit_events']) "
      "AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),"
    "'constraints',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array("
      "r.relname,c.conname,c.contype,c.condeferrable,c.condeferred,c.convalidated,"
      "pg_catalog.pg_get_constraintdef(c.oid,true)) ORDER BY r.relname,c.conname) "
      "FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class r ON r.oid=c.conrelid "
      "JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='private' "
      "AND r.relname=ANY(array['square_production_configuration_generations','square_production_runtime_bindings',"
        "'square_production_generation_fences','square_production_lifecycle_audit_events'])),'[]'::jsonb),"
    "'indexes',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array("
      "r.relname,ir.relname,pg_catalog.pg_get_indexdef(i.indexrelid,0,true)) ORDER BY r.relname,ir.relname) "
      "FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class r ON r.oid=i.indrelid "
      "JOIN pg_catalog.pg_class ir ON ir.oid=i.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace "
      "WHERE n.nspname='private' AND r.relname=ANY(array["
        "'square_production_configuration_generations','square_production_runtime_bindings',"
        "'square_production_generation_fences','square_production_lifecycle_audit_events'])),'[]'::jsonb),"
    "'policy_count',(SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=ANY(array["
      "'private.square_production_configuration_generations'::regclass,"
      "'private.square_production_runtime_bindings'::regclass,"
      "'private.square_production_generation_fences'::regclass,"
      "'private.square_production_lifecycle_audit_events'::regclass])),"
    "'trigger_count',(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid=ANY(array["
      "'private.square_production_configuration_generations'::regclass,"
      "'private.square_production_runtime_bindings'::regclass,"
      "'private.square_production_generation_fences'::regclass,"
      "'private.square_production_lifecycle_audit_events'::regclass]))"
    "))::text,'UTF8'),'sha256'),'hex')='2739c85b607701a5635c636112a32122ea7d244dc569273d5c9ea3fd05300d26'",0,NULL);
#else
  return true;
#endif
}

static bool production_baseline_triggers_valid(production_phase phase) {
  if (!managed_profile()) return true;
  const char *values[]={phase==PRODUCTION_PHASE_CUSTOMER?"customer":
    phase>=PRODUCTION_PHASE_INTERNAL_RUNTIME?"internal":"overlay"};
  return true_query("WITH expected(relation_name,trigger_name,function_signature,trigger_type,definition_hash) AS (VALUES "
      "('square_production_configuration_generations','square_production_configuration_audit','private.record_square_production_lifecycle_audit_v1()',5,'adc6b33177ba624f1464c5b0e10ebb4db8082cfeb74bcc2ba2261356cdfaf6c7'),"
      "('square_production_configuration_generations','square_production_configuration_immutable','private.reject_square_production_immutable_mutation_v1()',27,'11a01f225b7d5045d5514ea975220ed0338701c9eaafeef22836369460fec63d'),"
      "('square_production_configuration_generations','square_production_configuration_truncate_immutable','private.reject_square_production_immutable_mutation_v1()',34,'8c4836750759ca542890417233a6d9b9e5dcedf3283fbd8ba3d433c99eb94daf'),"
      "('square_production_generation_fences','square_production_fence_audit','private.record_square_production_lifecycle_audit_v1()',5,'a885169065930abdcc58be3c67a30d636c7d0b05019154e3ec382c1784b13ee1'),"
      "('square_production_generation_fences','square_production_fence_immutable','private.reject_square_production_immutable_mutation_v1()',27,'6dbf4385acf6404cbfc6c12417527e1b70a5be4f772fe744650f1c42502ffefa'),"
      "('square_production_generation_fences','square_production_fence_truncate_immutable','private.reject_square_production_immutable_mutation_v1()',34,'7a8c9133fde7fb723a061147ebd3525d9ab5673279da2da6ea6b472696e394a3'),"
      "('square_production_lifecycle_audit_events','square_production_audit_immutable','private.reject_square_production_immutable_mutation_v1()',27,'acd67e020314b4b20173cca7f9deac5b32136bc20cb328def573962a37e3f26d'),"
      "('square_production_lifecycle_audit_events','square_production_audit_truncate_immutable','private.reject_square_production_immutable_mutation_v1()',34,'d4b7717cd9b3d3cc5f5ed99cca466722da173b302232d4b25b9cf3beb0ec6991'),"
      "('square_production_runtime_bindings','square_production_binding_audit','private.record_square_production_lifecycle_audit_v1()',5,'3a886f47af1d77955049135720723c19872aebede7a17c638f3e54e3f1803d1f'),"
      "('square_production_runtime_bindings','square_production_binding_authority','private.validate_square_production_runtime_binding_v1()',7,'46cf9b1bef6379035248bffe82409c74c4cd328692ef31c41cb37abae194128d'),"
      "('square_production_runtime_bindings','square_production_binding_immutable','private.reject_square_production_immutable_mutation_v1()',27,'ee597c2ef4536c8ff62069bbee0a0d528d3f20d15be255b184ea23f84651cf58'),"
      "('square_production_runtime_bindings','square_production_binding_truncate_immutable','private.reject_square_production_immutable_mutation_v1()',34,'d7d255c8629b61c21cb032e411d93ca399b545667d117ac725e7bcc9ea8b849a')"
    "), resolved AS (SELECT e.*,r.oid relation_oid,t.oid trigger_oid FROM expected e "
      "LEFT JOIN pg_catalog.pg_class r ON r.oid=pg_catalog.to_regclass('private.'||e.relation_name) "
      "LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.oid AND t.tgname=e.trigger_name AND NOT t.tgisinternal) "
    "SELECT (SELECT count(*)=12 FROM resolved WHERE trigger_oid IS NOT NULL) "
    "AND (SELECT count(*)=12 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class r ON r.oid=t.tgrelid "
      "JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='private' AND NOT t.tgisinternal "
      "AND r.relname=ANY(array['integration_production_platform_bindings','integration_production_provider_bindings',"
        "'integration_production_provider_secrets','integration_production_provider_capabilities',"
        "'square_production_configuration_generations','square_production_runtime_bindings',"
        "'square_production_generation_fences','square_production_lifecycle_audit_events'])) "
    "AND NOT EXISTS (SELECT FROM resolved e LEFT JOIN pg_catalog.pg_trigger t ON t.oid=e.trigger_oid "
      "WHERE t.oid IS NULL OR t.tgfoid<>pg_catalog.to_regprocedure(e.function_signature) "
      "OR t.tgtype<>e.trigger_type OR t.tgattr::text<>'' OR pg_catalog.octet_length(t.tgargs)<>0 "
      "OR t.tgqual IS NOT NULL OR t.tgenabled<>'O' OR t.tgconstraint<>0 "
      "OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(t.oid,true),'UTF8'),'sha256'),'hex')<>e.definition_hash) "
    "AND (SELECT ($1='overlay' AND count(*)=44 AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce("
      "pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(r.relname,c.conname,crn.nspname||'.'||cr.relname,"
        "frn.nspname||'.'||fr.relname,c.contype::text,c.condeferrable,c.condeferred,c.convalidated,"
        "pg_catalog.pg_get_constraintdef(c.oid,true),pn.nspname||'.'||p.proname||'('||"
        "pg_catalog.pg_get_function_identity_arguments(p.oid)||')',t.tgtype::integer,t.tgattr::text,"
        "pg_catalog.encode(t.tgargs,'hex'),pg_catalog.pg_get_expr(t.tgqual,t.tgrelid,true),t.tgenabled::text) "
        "ORDER BY r.relname,c.conname,pn.nspname,p.proname,t.tgtype),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')="
        "'e236e65bb2a97355712eda632b18dd8113608c605495561cf26a1d536d3f0152') OR "
      "($1 IN ('internal','customer') AND count(*)=46 AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce("
      "pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(r.relname,c.conname,crn.nspname||'.'||cr.relname,"
        "frn.nspname||'.'||fr.relname,c.contype::text,c.condeferrable,c.condeferred,c.convalidated,"
        "pg_catalog.pg_get_constraintdef(c.oid,true),pn.nspname||'.'||p.proname||'('||"
        "pg_catalog.pg_get_function_identity_arguments(p.oid)||')',t.tgtype::integer,t.tgattr::text,"
        "pg_catalog.encode(t.tgargs,'hex'),pg_catalog.pg_get_expr(t.tgqual,t.tgrelid,true),t.tgenabled::text) "
        "ORDER BY r.relname,c.conname,pn.nspname,p.proname,t.tgtype),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')="
        "'7f38e1cd66b2410975a43507ba2d6f72483b896115a86560f1b1c1f93146c086') "
      "FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class r ON r.oid=t.tgrelid "
      "JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid "
      "JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace "
      "LEFT JOIN pg_catalog.pg_constraint c ON c.oid=t.tgconstraint "
      "LEFT JOIN pg_catalog.pg_class cr ON cr.oid=c.conrelid LEFT JOIN pg_catalog.pg_namespace crn ON crn.oid=cr.relnamespace "
      "LEFT JOIN pg_catalog.pg_class fr ON fr.oid=c.confrelid LEFT JOIN pg_catalog.pg_namespace frn ON frn.oid=fr.relnamespace "
      "WHERE n.nspname='private' AND t.tgisinternal AND r.relname=ANY(array["
        "'integration_production_platform_bindings','integration_production_provider_bindings',"
        "'integration_production_provider_secrets','integration_production_provider_capabilities',"
        "'square_production_configuration_generations','square_production_runtime_bindings',"
        "'square_production_generation_fences','square_production_lifecycle_audit_events']) "
      /* The exact customer contract separately pins both sides of these new
       * FKs. Preserve the frozen legacy trigger inventory without omitting any
       * unknown or non-customer dependency. */
      "AND ($1<>'customer' OR c.conrelid IS NULL OR c.conrelid NOT IN ("
        "pg_catalog.to_regclass('private.square_production_customer_bindings'),"
        "pg_catalog.to_regclass('private.square_production_customer_connections'),"
        "pg_catalog.to_regclass('private.square_production_customer_oauth_states'),"
        "pg_catalog.to_regclass('private.square_production_customer_credentials'))))",1,values);
}

static bool production_internal_runtime_relations_valid(void) {
  if (!managed_profile()) return true;
  return true_query("WITH expected(name,triggers) AS (VALUES "
      "('private.square_production_internal_permits',2),"
      "('private.square_production_internal_oauth_states',2),"
      "('private.square_production_internal_credentials',1),"
      "('private.square_production_internal_scans',2),"
      "('private.square_production_internal_page_receipts',1),"
      "('private.square_production_internal_source_versions',1),"
      "('private.square_production_internal_fences',1),"
      "('private.square_production_internal_audit_events',1)), "
    "resolved AS (SELECT expected.*,to_regclass(expected.name) oid FROM expected) "
    "SELECT (SELECT count(*)=8 FROM resolved WHERE oid IS NOT NULL) "
    "AND (SELECT count(*)=8 FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace "
      "WHERE n.nspname='private' AND r.relkind='r' "
      "AND r.relname LIKE 'square\\_production\\_internal\\_%' ESCAPE '\\') "
    "AND NOT EXISTS (SELECT FROM resolved e LEFT JOIN pg_class r ON r.oid=e.oid WHERE r.oid IS NULL "
      "OR r.relkind<>'r' OR r.relpersistence<>'p' OR r.relowner<>current_user::regrole::oid "
      "OR NOT r.relrowsecurity OR NOT r.relforcerowsecurity OR r.relhassubclass "
      "OR e.triggers<>(SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal AND t.tgenabled='O') "
      "OR e.triggers<>(SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal)) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_inherits i ON i.inhrelid=e.oid OR i.inhparent=e.oid) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_rewrite w ON w.ev_class=e.oid) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_policy p ON p.polrelid=e.oid) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_class r ON r.oid=e.oid "
      "CROSS JOIN LATERAL aclexplode(r.relacl) a WHERE a.grantee<>r.relowner) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_attribute col ON col.attrelid=e.oid AND col.attnum>0 AND NOT col.attisdropped "
      "CROSS JOIN LATERAL aclexplode(col.attacl) a JOIN pg_class r ON r.oid=e.oid WHERE a.grantee<>r.relowner) "
    "AND NOT EXISTS (SELECT FROM pg_publication WHERE puballtables) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_publication_rel p ON p.prrelid=e.oid) "
    "AND NOT EXISTS (SELECT FROM pg_publication_namespace WHERE pnnspid='private'::regnamespace)",0,NULL);
}

static bool production_internal_runtime_schema_valid(void) {
  if (!managed_profile()) return true;
  return true_query("SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to((pg_catalog.jsonb_build_object("
    "'columns',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array("
      "r.relname,a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),"
      "a.attnotnull,a.attidentity,a.attgenerated,pg_catalog.pg_get_expr(d.adbin,d.adrelid,true),"
      "CASE WHEN a.attcollation=0 THEN NULL ELSE pg_catalog.format('%I.%I',cn.nspname,col.collname) END,"
      "col.collprovider::text,col.collisdeterministic,col.collversion) ORDER BY r.relname,a.attnum) "
      "FROM pg_catalog.pg_class r JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace "
      "JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid "
      "LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum "
      "LEFT JOIN pg_catalog.pg_collation col ON col.oid=a.attcollation "
      "LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=col.collnamespace "
      "WHERE n.nspname='private' AND r.relname=ANY(array["
        "'square_production_internal_permits','square_production_internal_oauth_states',"
        "'square_production_internal_credentials','square_production_internal_scans',"
        "'square_production_internal_page_receipts','square_production_internal_source_versions',"
        "'square_production_internal_fences','square_production_internal_audit_events']) "
      "AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),"
    "'constraints',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array("
      "r.relname,c.conname,c.contype,c.condeferrable,c.condeferred,c.convalidated,"
      "pg_catalog.pg_get_constraintdef(c.oid,true)) ORDER BY r.relname,c.conname) "
      "FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class r ON r.oid=c.conrelid "
      "JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='private' "
      "AND r.relname=ANY(array['square_production_internal_permits','square_production_internal_oauth_states',"
        "'square_production_internal_credentials','square_production_internal_scans',"
        "'square_production_internal_page_receipts','square_production_internal_source_versions',"
        "'square_production_internal_fences','square_production_internal_audit_events'])),'[]'::jsonb),"
    "'indexes',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array("
      "r.relname,ir.relname,pg_catalog.pg_get_indexdef(i.indexrelid,0,true)) ORDER BY r.relname,ir.relname) "
      "FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class r ON r.oid=i.indrelid "
      "JOIN pg_catalog.pg_class ir ON ir.oid=i.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace "
      "WHERE n.nspname='private' AND r.relname=ANY(array["
        "'square_production_internal_permits','square_production_internal_oauth_states',"
        "'square_production_internal_credentials','square_production_internal_scans',"
        "'square_production_internal_page_receipts','square_production_internal_source_versions',"
        "'square_production_internal_fences','square_production_internal_audit_events'])),'[]'::jsonb),"
    "'policy_count',(SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=ANY(array["
      "'private.square_production_internal_permits'::regclass,"
      "'private.square_production_internal_oauth_states'::regclass,"
      "'private.square_production_internal_credentials'::regclass,"
      "'private.square_production_internal_scans'::regclass,"
      "'private.square_production_internal_page_receipts'::regclass,"
      "'private.square_production_internal_source_versions'::regclass,"
      "'private.square_production_internal_fences'::regclass,"
      "'private.square_production_internal_audit_events'::regclass])),"
    "'trigger_count',(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid=ANY(array["
      "'private.square_production_internal_permits'::regclass,"
      "'private.square_production_internal_oauth_states'::regclass,"
      "'private.square_production_internal_credentials'::regclass,"
      "'private.square_production_internal_scans'::regclass,"
      "'private.square_production_internal_page_receipts'::regclass,"
      "'private.square_production_internal_source_versions'::regclass,"
      "'private.square_production_internal_fences'::regclass,"
      "'private.square_production_internal_audit_events'::regclass]))"
    "))::text,'UTF8'),'sha256'),'hex')='3b1cfe4165a510c73e9192c94937695204899f2bd58b69d5d5d034bb6d4a8d92'",0,NULL);
}

static bool production_internal_runtime_triggers_valid(void) {
  if (!managed_profile()) return true;
  return true_query("WITH expected(relation_name,trigger_name,function_signature,trigger_type,definition_hash) AS (VALUES "
      "('square_production_internal_audit_events','square_production_internal_audit_events_immutable','private.square_production_internal_reject_immutable_mutation_v1()',58,'56b6c13a6951cb7d04d4b05759821cb38ebca7ff5fbd8b771201729a9179b784'),"
      "('square_production_internal_credentials','square_production_internal_credentials_immutable','private.square_production_internal_reject_immutable_mutation_v1()',58,'75e506533897efa5a91119d758feec3a0c6a2e9ab08616b02a67c78315f3b45f'),"
      "('square_production_internal_fences','square_production_internal_fences_immutable','private.square_production_internal_reject_immutable_mutation_v1()',58,'b1d5b3e6cde6beaba2a0f237442d5b7617ff447297ec9a9b90d28482af15d5ec'),"
      "('square_production_internal_oauth_states','square_production_internal_oauth_state_delete_guard','private.square_production_internal_reject_immutable_mutation_v1()',42,'c75c1a6505c73b14548119b2d48ebbf65428117588d02077355071370e06f427'),"
      "('square_production_internal_oauth_states','square_production_internal_oauth_state_update_guard','private.square_production_internal_guard_lifecycle_update_v1()',19,'dd53b845b550ecc5adf60ba730c5d1e69575f5b596597f5944d6508f318db58c'),"
      "('square_production_internal_page_receipts','square_production_internal_page_receipts_immutable','private.square_production_internal_reject_immutable_mutation_v1()',58,'67e242c38f4b027eb4aa5de3cce96c575445222b26d020923b5461922970ad29'),"
      "('square_production_internal_permits','square_production_internal_permit_delete_guard','private.square_production_internal_reject_immutable_mutation_v1()',42,'b3bfbab3cd47b89db396a3126673b0c0608e6eda0392d664c534c8deeb260978'),"
      "('square_production_internal_permits','square_production_internal_permit_update_guard','private.square_production_internal_guard_lifecycle_update_v1()',19,'a0c405a92f0792095c2721ce7dd1c50f1cc9db50f8e130aff9433606f19133bf'),"
      "('square_production_internal_scans','square_production_internal_scan_delete_guard','private.square_production_internal_reject_immutable_mutation_v1()',42,'420916208512c502d3521c1ef7da7fda854ed9281347bdba20656326c126869e'),"
      "('square_production_internal_scans','square_production_internal_scan_update_guard','private.square_production_internal_guard_lifecycle_update_v1()',19,'7dda55baf049b978b31b0dcb314509ce13baf68b020b23b9aab6d0b958cf8a24'),"
      "('square_production_internal_source_versions','square_production_internal_source_versions_immutable','private.square_production_internal_reject_immutable_mutation_v1()',58,'238b59f5ca4071cd6de823c6e42eac24b9b73e4459e16e4a97a7e6d9bd378390')"
    "), resolved AS (SELECT e.*,r.oid relation_oid,t.oid trigger_oid FROM expected e "
      "LEFT JOIN pg_catalog.pg_class r ON r.oid=pg_catalog.to_regclass('private.'||e.relation_name) "
      "LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.oid AND t.tgname=e.trigger_name AND NOT t.tgisinternal) "
    "SELECT (SELECT count(*)=11 FROM resolved WHERE trigger_oid IS NOT NULL) "
    "AND (SELECT count(*)=11 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class r ON r.oid=t.tgrelid "
      "JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='private' AND NOT t.tgisinternal "
      "AND r.relname=ANY(array['square_production_internal_permits','square_production_internal_oauth_states',"
        "'square_production_internal_credentials','square_production_internal_scans',"
        "'square_production_internal_page_receipts','square_production_internal_source_versions',"
        "'square_production_internal_fences','square_production_internal_audit_events'])) "
    "AND NOT EXISTS (SELECT FROM resolved e LEFT JOIN pg_catalog.pg_trigger t ON t.oid=e.trigger_oid "
      "WHERE t.oid IS NULL OR t.tgfoid<>pg_catalog.to_regprocedure(e.function_signature) "
      "OR t.tgtype<>e.trigger_type OR t.tgattr::text<>'' OR pg_catalog.octet_length(t.tgargs)<>0 "
      "OR t.tgqual IS NOT NULL OR t.tgenabled<>'O' OR t.tgconstraint<>0 "
      "OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(t.oid,true),'UTF8'),'sha256'),'hex')<>e.definition_hash) "
    "AND (SELECT count(*)=48 AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce("
      "pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(n.nspname,r.relname,c.conname,crn.nspname||'.'||cr.relname,"
        "frn.nspname||'.'||fr.relname,c.contype::text,c.condeferrable,c.condeferred,c.convalidated,"
        "pg_catalog.pg_get_constraintdef(c.oid,true),pn.nspname||'.'||p.proname||'('||"
        "pg_catalog.pg_get_function_identity_arguments(p.oid)||')',t.tgtype::integer,t.tgattr::text,"
        "pg_catalog.encode(t.tgargs,'hex'),pg_catalog.pg_get_expr(t.tgqual,t.tgrelid,true),t.tgenabled::text) "
        "ORDER BY n.nspname,r.relname,c.conname,pn.nspname,p.proname,t.tgtype),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')="
        "'d5b54b7b0dc5f17fbc057488ce87b2a7dbb21321a67754a509f4660ef0de4190' "
      "FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class r ON r.oid=t.tgrelid "
      "JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid "
      "JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace "
      "LEFT JOIN pg_catalog.pg_constraint c ON c.oid=t.tgconstraint "
      "LEFT JOIN pg_catalog.pg_class cr ON cr.oid=c.conrelid LEFT JOIN pg_catalog.pg_namespace crn ON crn.oid=cr.relnamespace "
      "LEFT JOIN pg_catalog.pg_class fr ON fr.oid=c.confrelid LEFT JOIN pg_catalog.pg_namespace frn ON frn.oid=fr.relnamespace "
      "WHERE t.tgisinternal AND ((n.nspname='private' AND r.relname=ANY(array["
        "'square_production_internal_permits','square_production_internal_oauth_states',"
        "'square_production_internal_credentials','square_production_internal_scans',"
        "'square_production_internal_page_receipts','square_production_internal_source_versions',"
        "'square_production_internal_fences','square_production_internal_audit_events'])) "
      "OR (crn.nspname='private' AND cr.relname=ANY(array["
        "'square_production_internal_permits','square_production_internal_oauth_states',"
        "'square_production_internal_credentials','square_production_internal_scans',"
        "'square_production_internal_page_receipts','square_production_internal_source_versions',"
        "'square_production_internal_fences','square_production_internal_audit_events']) "
      "AND c.contype='f')))",0,NULL);
}

static bool production_internal_runtime_functions_valid(void) {
  if (!managed_profile()) return true;
  return true_query("WITH expected(signature,language,volatility,security_definer,is_strict,parallel,result,names,default_count,default_expression,source_hash) AS (VALUES "
      "('private.square_production_internal_reject_immutable_mutation_v1()','plpgsql','v',true,false,'u','trigger',null::text[],0,null::text,'879e64a04de08a3fb906ce6f0a5675627ecace40386769247cf0a44c817dd82e'),"
      "('private.square_production_internal_guard_lifecycle_update_v1()','plpgsql','v',true,false,'u','trigger',null::text[],0,null::text,'61cbb7ce05f9bf6c574f44f7642c6bb239815b639fc1fc00fe65fa753f1cd818'),"
      "('private.square_production_internal_require_keys_v1(jsonb,text[])','plpgsql','i',false,true,'s','void',array['p_payload','p_required_keys']::text[],0,null::text,'ec3eb20a72acab3d1c18c6d5eb9b2fb1eb4d8c6743af2c4f2e4c80bba0d91d61'),"
      "('private.square_production_internal_fingerprint_v1(text[])','sql','i',false,true,'s','text',array['p_parts']::text[],0,null::text,'3f77909a44ff2bbc574f8b3228482aac0e9c55a1dd3356001384efe21db560b4'),"
      "('private.square_production_internal_audit_v1(uuid,bigint,text,text,text,text,timestamptz)','plpgsql','v',true,false,'u','text',array['p_permit_id','p_generation','p_event_kind','p_outcome','p_reason_code','p_subject_fingerprint','p_recorded_at']::text[],0,null::text,'4d548e25a8988edc1fdfa8b719bf5d7195e32d9f44bde5b584f8484fc30539cb'),"
      "('private.square_production_internal_require_login_v1(text)','plpgsql','s',true,false,'u','void',array['p_capability']::text[],0,null::text,'bef67b686c3168496fcc46e2518e1555b694faef1168f5612caf2921183107df'),"
      "('private.square_production_internal_lock_permit_v1(uuid,text,boolean)','plpgsql','v',true,false,'u','private.square_production_internal_permits',array['p_permit_id','p_capability','p_allow_internal_fence']::text[],1,'false','70e8f973ca1942bf69d6e0c0228a145eb44edfc1bc26ed153fae3321de08b920'),"
      "('private.square_production_internal_install_permit_v1(jsonb)','plpgsql','v',true,false,'u','jsonb',array['p_payload']::text[],0,null::text,'efa4aa61687f5580ceb24897fb1ad6a83527c765a37804bcc03cbbfa375b1905'),"
      "('public.square_production_internal_oauth_v1(text,jsonb)','plpgsql','v',true,false,'u','jsonb',array['p_operation','p_payload']::text[],0,null::text,'6ff215c19aa5c66b607c307d26bcf8f53cc8b3308bd929a50a5f97c5e049d860'),"
      "('public.square_production_internal_broker_v1(text,jsonb)','plpgsql','v',true,false,'u','jsonb',array['p_operation','p_payload']::text[],0,null::text,'386b2afeeb21c1884b1d1e4869ceccde87218f2201c4e5c802c74b3ff7ec5b61'),"
      "('public.square_production_internal_runtime_v1(text,jsonb)','plpgsql','v',true,false,'u','jsonb',array['p_operation','p_payload']::text[],0,null::text,'63024be692c785827b982945c220b0268d8e57ee2db4f3d46a8033a5f5fe3301'),"
      "('public.square_production_internal_evidence_v1(text,jsonb)','plpgsql','v',true,false,'u','jsonb',array['p_operation','p_payload']::text[],0,null::text,'98e2d0363897ad1020fb4296dd643ccd4798cac10030b8a4883379844d954877')"
    "), resolved AS (SELECT e.*,to_regprocedure(e.signature) oid FROM expected e) "
    "SELECT (SELECT count(*)=12 FROM resolved WHERE oid IS NOT NULL) "
    "AND (SELECT count(*)=12 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
      "WHERE n.nspname IN ('private','public') "
      "AND p.proname LIKE 'square\\_production\\_internal\\_%' ESCAPE '\\') "
    "AND NOT EXISTS (SELECT FROM resolved e LEFT JOIN pg_proc p ON p.oid=e.oid "
      "LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR l.lanname<>e.language "
      "OR p.proowner<>current_user::regrole::oid OR p.provolatile<>e.volatility::\"char\" "
      "OR p.prosecdef<>e.security_definer OR p.proisstrict<>e.is_strict OR p.proparallel<>e.parallel::\"char\" "
      "OR p.proretset OR p.prokind<>'f' OR p.prorettype<>to_regtype(e.result) "
      "OR p.proargnames IS DISTINCT FROM e.names OR p.proargmodes IS NOT NULL "
      "OR p.pronargdefaults<>e.default_count "
      "OR pg_catalog.pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM e.default_expression "
      "OR p.proconfig IS DISTINCT FROM array['search_path=\"\"']::text[] "
      "OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256'),'hex')<>e.source_hash) "
    "AND NOT EXISTS (SELECT FROM resolved e JOIN pg_proc p ON p.oid=e.oid "
      "CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a "
      "WHERE e.signature LIKE 'private.%' AND a.grantee<>p.proowner)",0,NULL);
}

static bool production_internal_runtime_contract_valid(void) {
  return production_internal_runtime_source_pinned() && production_internal_runtime_relations_valid() &&
    production_internal_runtime_schema_valid() && production_internal_runtime_triggers_valid() &&
    production_internal_runtime_functions_valid();
}

static bool production_contract_valid(production_phase phase) {
#ifdef VAEROEX_PRODUCTION_CUSTOMER_CONTRACT
  if (phase==PRODUCTION_PHASE_CUSTOMER && !true_query(VAEROEX_PRODUCTION_CUSTOMER_CONTRACT,0,NULL)) return false;
#else
  if (phase==PRODUCTION_PHASE_CUSTOMER) return false;
#endif
  /* Evaluate the unchanged legacy fingerprint in its qualified canonical
   * context; pg_catalog is implicitly first. The customer fingerprint and
   * subsequent native work retain the native pg_catalog context. */
  if (phase==PRODUCTION_PHASE_CUSTOMER && !command("SET LOCAL search_path=public")) return false;
  bool valid=phase!=PRODUCTION_PHASE_INVALID && production_relations_valid() &&
    production_foundation_schema_valid() && production_overlay_schema_valid() && production_baseline_triggers_valid(phase) &&
    production_function_abi_valid() &&
    (phase==PRODUCTION_PHASE_OVERLAY || production_internal_runtime_contract_valid());
  if (phase==PRODUCTION_PHASE_CUSTOMER) {
    bool restored=command("SET LOCAL search_path=pg_catalog");
    return valid && restored;
  }
  return valid;
}
#endif
#ifdef VAEROEX_PRODUCTION_PROFILE
static bool production_named_authority_valid(const char *capability,const char *authority_function,
                                             const char *authority_source,const char *target,bool internal_runtime,
                                             const char *settings_exception,bool membership_transition) {
  bool customer=production_ledger_phase()==PRODUCTION_PHASE_CUSTOMER &&
    (!strcmp(capability,"square_production_oauth_authority") || !strcmp(capability,"square_production_broker_authority"));
  const char *values[]={capability,authority_function,authority_source,
    OPERATIONAL_AUTHORITY_FUNCTION,OPERATIONAL_AUTHORITY_SOURCE_MD5,target,
    internal_runtime?"internal":"overlay",settings_exception,membership_transition?"transition":"",
    customer?"public.square_production_customer_v1(text,jsonb)":""};
  return true_query("SELECT to_regprocedure($2) IS NOT NULL "
    "AND EXISTS (SELECT FROM pg_namespace n JOIN pg_proc p ON p.pronamespace=n.oid "
      "JOIN pg_language l ON l.oid=p.prolang "
      "WHERE p.oid=to_regprocedure($2) AND n.nspname='public' "
      "AND has_schema_privilege($1,n.oid,'USAGE') AND l.lanname='plpgsql' "
      "AND p.proowner=current_user::regrole::oid AND p.prosecdef "
      "AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.proretset AND p.prokind='f' "
      "AND p.proargmodes IS NULL AND p.pronargdefaults=0 AND p.proargdefaults IS NULL "
      "AND p.proconfig IS NOT DISTINCT FROM array['search_path=\"\"']::text[] "
      "AND (($7='overlay' AND p.provolatile='s' AND p.pronargs=5 AND p.prorettype='void'::regtype "
        "AND p.proargnames IS NOT DISTINCT FROM "
          "array['p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint']::text[] "
        "AND p.prosrc=$3) "
      "OR ($7='internal' AND p.provolatile='v' AND p.pronargs=2 AND p.prorettype='jsonb'::regtype "
        "AND p.proargnames IS NOT DISTINCT FROM array['p_operation','p_payload']::text[] "
        "AND pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=$3))) "
    "AND ($7='internal' OR EXISTS (SELECT FROM pg_namespace n JOIN pg_proc p ON p.pronamespace=n.oid "
      "JOIN pg_language l ON l.oid=p.prolang "
      "WHERE p.oid=to_regprocedure($4) AND n.nspname='private' "
      "AND l.lanname='plpgsql' "
      "AND p.proowner=current_user::regrole::oid AND NOT p.prosecdef AND p.provolatile='s' "
      "AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.proretset AND p.prokind='f' "
      "AND p.pronargs=6 AND p.prorettype='void'::regtype "
      "AND p.proargnames IS NOT DISTINCT FROM "
        "array['p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint','p_capability']::text[] "
      "AND p.proargmodes IS NULL AND p.pronargdefaults=0 AND p.proargdefaults IS NULL "
      "AND p.proconfig is not distinct from array['search_path=\"\"']::text[] "
      "AND md5(p.prosrc)=$5)) "
    "AND ($7='internal' OR NOT EXISTS (SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode("
      "coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure($4) "
      "AND a.grantee<>p.proowner)) "
    "AND EXISTS (SELECT FROM pg_roles c WHERE c.rolname=$1 AND NOT c.rolcanlogin AND NOT c.rolinherit "
      "AND NOT c.rolsuper AND NOT c.rolcreaterole AND NOT c.rolcreatedb AND NOT c.rolreplication "
      "AND NOT c.rolbypassrls AND c.rolconfig IS NULL) "
    /* PostgreSQL 16+ records the one automatic creator edge as if bootstrap
     * superuser OID 10 granted it to the non-superuser CREATEROLE session that
     * created the role. Count alone is not identity: bind the optional edge to
     * this exact maintenance session and grantor. The fixed candidate edge is
     * the only other permitted membership after prepare. */
    "AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE m.member=$1::regrole) "
    /* Each fixed login is independently bounded too. A current-target-only
     * check would let a peer role accumulate attributes, membership or direct
     * object authority while a different profile is being maintained. */
    "AND NOT EXISTS (SELECT FROM pg_roles target_role WHERE target_role.rolname=$6 AND NOT ("
      "NOT target_role.rolsuper AND NOT target_role.rolcreaterole AND NOT target_role.rolcreatedb "
      "AND NOT target_role.rolreplication AND NOT target_role.rolbypassrls "
      "AND ($8=$6 OR target_role.rolconfig IS NULL) "
      "AND ((target_role.rolcanlogin AND target_role.rolinherit) OR "
        "(NOT target_role.rolcanlogin AND NOT target_role.rolinherit)) "
      "AND NOT EXISTS (SELECT FROM pg_roles other_role WHERE other_role.rolname NOT IN ($6,$1) "
        "AND pg_has_role(target_role.oid,other_role.oid,'MEMBER')) "
      "AND NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member "
        "WHERE m.roleid=target_role.oid AND NOT ("
          "m.member=session_user::regrole::oid AND m.grantor='10'::oid "
          "AND NOT member_role.rolsuper AND member_role.rolcreaterole "
          "AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)) "
      "AND NOT EXISTS (SELECT FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass "
        "AND d.refobjid=target_role.oid AND d.deptype IN ('o','a','i','r')) "
      "AND ($8=$6 OR NOT EXISTS (SELECT FROM pg_db_role_setting s WHERE s.setrole=target_role.oid))"
    ")) "
    /* A fixed login may be absent before prepare, or must otherwise be an
     * exact active pair (LOGIN/INHERIT plus membership INHERIT) or exact
     * closed pair (NOLOGIN/NOINHERIT plus membership INHERIT FALSE).  This
     * checks every profile independently: fencing one role must not require
     * unrelated legitimate service roles to lose their own authority. */
    "AND NOT EXISTS (SELECT FROM pg_roles target_role WHERE target_role.rolname=$6 "
      "AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE m.roleid=$1::regrole AND m.member=target_role.oid)) "
    "AND (SELECT count(*) FROM pg_auth_members m JOIN pg_roles target_role ON target_role.oid=m.member "
      "WHERE m.roleid=$1::regrole AND target_role.rolname=$6)<=1 "
    "AND (SELECT count(*) FROM pg_auth_members m WHERE m.roleid=$1::regrole)<=CASE WHEN EXISTS ("
      "SELECT FROM pg_auth_members m JOIN pg_roles target_role ON target_role.oid=m.member "
      "WHERE m.roleid=$1::regrole AND target_role.rolname=$6 "
      "AND NOT m.admin_option AND NOT m.set_option AND ("
        "(target_role.rolcanlogin AND target_role.rolinherit AND m.inherit_option) OR "
        "(NOT target_role.rolcanlogin AND NOT target_role.rolinherit AND NOT m.inherit_option) OR "
        "($9='transition' AND target_role.rolcanlogin AND target_role.rolinherit AND NOT m.inherit_option)"
      ")"
    ") THEN 2 ELSE 1 END "
    "AND NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member "
    "WHERE m.roleid=$1::regrole AND NOT ("
        "(member_role.rolname=$6 AND NOT m.admin_option AND NOT m.set_option AND ("
          "(member_role.rolcanlogin AND member_role.rolinherit AND m.inherit_option) OR "
          "(NOT member_role.rolcanlogin AND NOT member_role.rolinherit AND NOT m.inherit_option) OR "
          "($9='transition' AND member_role.rolcanlogin AND member_role.rolinherit AND NOT m.inherit_option)"
        ")) OR "
        "(m.member=session_user::regrole::oid AND m.grantor='10'::oid "
          "AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option "
          "AND NOT member_role.rolsuper AND member_role.rolcreaterole)"
      ")) "
    /* The required non-grantable public-schema USAGE and EXECUTE ACL on the
     * one pinned authority RPC necessarily record two current-database ACL
     * dependencies. Reject every other direct/initial ACL, owner, or policy
     * dependency. */
    "AND NOT EXISTS (SELECT FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass "
      "AND d.refobjid=$1::regrole AND d.deptype IN ('o','a','i','r') AND NOT ("
        "d.deptype='a' AND d.dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) "
        "AND d.objsubid=0 AND ((d.classid='pg_proc'::regclass AND (d.objid=to_regprocedure($2) OR ($10<>'' AND d.objid=to_regprocedure($10)))) "
          "OR (d.classid='pg_namespace'::regclass AND d.objid='public'::regnamespace)))) "
    "AND NOT EXISTS (SELECT FROM pg_db_role_setting s WHERE s.setrole=$1::regrole) "
    "AND (SELECT count(*)=1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode("
      "coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.oid='public'::regnamespace "
      "AND a.grantee=$1::regrole AND a.privilege_type='USAGE' AND NOT a.is_grantable) "
    "AND NOT EXISTS (SELECT FROM pg_namespace n CROSS JOIN LATERAL aclexplode("
      "coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.oid='public'::regnamespace "
      "AND a.grantee=$1::regrole AND (a.privilege_type<>'USAGE' OR a.is_grantable)) "
    "AND (SELECT count(*)=1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a "
      "WHERE a.grantee=$1::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable AND p.oid=to_regprocedure($2)) "
    "AND NOT EXISTS (SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode("
      "coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure($2) "
      "AND (a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) "
      "AND NOT (a.grantee=$1::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)) "
    "AND NOT EXISTS (SELECT FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema') "
      "AND n.nspname NOT LIKE 'pg\\_toast%' ESCAPE '\\' AND n.nspname NOT LIKE 'pg\\_temp%' ESCAPE '\\' "
      "AND has_schema_privilege($1,n.oid,'CREATE')) "
    "AND NOT has_schema_privilege($1,'private','USAGE') "
    "AND NOT EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
      "WHERE n.nspname NOT IN ('pg_catalog','information_schema') "
      "AND n.nspname NOT LIKE 'pg\\_toast%' ESCAPE '\\' AND n.nspname NOT LIKE 'pg\\_temp%' ESCAPE '\\' "
      "AND p.oid<>to_regprocedure($2) AND ($10='' OR p.oid<>to_regprocedure($10)) AND has_schema_privilege($1,n.oid,'USAGE') "
      "AND has_function_privilege($1,p.oid,'EXECUTE')) "
    "AND NOT EXISTS (SELECT FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace "
      "CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) privilege(name) "
      "WHERE n.nspname NOT IN ('pg_catalog','information_schema') "
      "AND n.nspname NOT LIKE 'pg\\_toast%' ESCAPE '\\' AND n.nspname NOT LIKE 'pg\\_temp%' ESCAPE '\\' "
      "AND r.relkind IN ('r','p','v','m','f') AND has_table_privilege($1,r.oid,privilege.name) AND NOT ("
        "privilege.name='SELECT' AND n.nspname='extensions' "
        "AND r.relname IN ('pg_stat_statements','pg_stat_statements_info') AND r.relkind='v' "
        "AND NOT has_schema_privilege($1,n.oid,'USAGE') AND NOT pg_has_role($1,'pg_read_all_stats','USAGE') "
        "AND EXISTS (SELECT FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid "
          "WHERE d.classid='pg_class'::regclass AND d.objid=r.oid AND d.objsubid=0 "
          "AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='pg_stat_statements'))) "
    "AND NOT EXISTS (SELECT FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace "
      "JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped "
      "CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) privilege(name) "
      "WHERE n.nspname NOT IN ('pg_catalog','information_schema') "
      "AND n.nspname NOT LIKE 'pg\\_toast%' ESCAPE '\\' AND n.nspname NOT LIKE 'pg\\_temp%' ESCAPE '\\' "
      "AND r.relkind IN ('r','p','v','m','f') AND has_column_privilege($1,r.oid,a.attnum,privilege.name) AND NOT ("
        "privilege.name='SELECT' AND n.nspname='extensions' "
        "AND r.relname IN ('pg_stat_statements','pg_stat_statements_info') AND r.relkind='v' "
        "AND NOT has_schema_privilege($1,n.oid,'USAGE') AND NOT pg_has_role($1,'pg_read_all_stats','USAGE') "
        "AND EXISTS (SELECT FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid "
          "WHERE d.classid='pg_class'::regclass AND d.objid=r.oid AND d.objsubid=0 "
          "AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='pg_stat_statements'))) "
    "AND NOT EXISTS (SELECT FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace "
      "WHERE n.nspname NOT IN ('pg_catalog','information_schema') "
      "AND n.nspname NOT LIKE 'pg\\_toast%' ESCAPE '\\' AND n.nspname NOT LIKE 'pg\\_temp%' ESCAPE '\\' "
      /* PostgreSQL may reorder ordinary AND predicates. CASE is required so
       * has_sequence_privilege never receives a non-sequence OID. */
      "AND CASE WHEN r.relkind='S' THEN has_sequence_privilege($1,r.oid,'USAGE,SELECT,UPDATE') ELSE false END) "
    "AND NOT EXISTS (SELECT FROM pg_foreign_data_wrapper f "
      "WHERE has_foreign_data_wrapper_privilege($1,f.oid,'USAGE')) "
    "AND NOT EXISTS (SELECT FROM pg_foreign_server s WHERE has_server_privilege($1,s.oid,'USAGE')) "
    "AND NOT EXISTS (SELECT FROM pg_tablespace t WHERE has_tablespace_privilege($1,t.oid,'CREATE')) "
    "AND NOT EXISTS (SELECT FROM pg_parameter_acl parameter WHERE "
      "has_parameter_privilege($1,parameter.parname,'SET') "
      "OR has_parameter_privilege($1,parameter.parname,'ALTER SYSTEM')) "
    "AND has_database_privilege($1,current_database(),'CONNECT') "
    "AND has_database_privilege($1,current_database(),'TEMP') "
    "AND NOT has_database_privilege($1,current_database(),'CREATE') "
    "AND NOT EXISTS (SELECT FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a "
      "WHERE a.grantee=$1::regrole) "
    "AND NOT EXISTS (SELECT FROM pg_database d WHERE d.datallowconn AND d.datname<>current_database() "
      "AND has_database_privilege($1,d.oid,'CONNECT') AND NOT EXISTS (SELECT FROM aclexplode("
        "coalesce(d.datacl,acldefault('d',d.datdba))) a "
        "WHERE a.grantee=0 AND a.privilege_type='CONNECT')) "
    "AND NOT EXISTS (SELECT FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a "
        "WHERE d.defaclobjtype IN ('r','S','f','n') AND a.grantee IN (0,$1::regrole))",10,values);
}

static bool production_overlay_wrapper_owner_only(const char *authority_function,const char *authority_source) {
  const char *values[]={authority_function,authority_source};
  return true_query("SELECT EXISTS (SELECT FROM pg_namespace n JOIN pg_proc p ON p.pronamespace=n.oid "
      "JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure($1) AND n.nspname='public' "
      "AND l.lanname='plpgsql' AND p.proowner=current_user::regrole::oid AND p.prosecdef "
      "AND p.provolatile='s' AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.proretset AND p.prokind='f' "
      "AND p.pronargs=5 AND p.prorettype='void'::regtype AND p.proargmodes IS NULL "
      "AND p.pronargdefaults=0 AND p.proargdefaults IS NULL "
      "AND p.proargnames IS NOT DISTINCT FROM "
        "array['p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint']::text[] "
      "AND p.proconfig IS NOT DISTINCT FROM array['search_path=\"\"']::text[] AND p.prosrc=$2) "
    "AND NOT EXISTS (SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode("
      "coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure($1) "
      "AND a.grantee<>p.proowner)",2,values);
}
#endif
static bool production_authority_valid(const char *target,bool allow_target_settings,
                                       bool membership_transition) {
#ifdef VAEROEX_PRODUCTION_PROFILE
  production_phase phase=production_ledger_phase();
  if (strcmp(target,MAPPED_ROLE) || !production_contract_valid(phase)) return false;
  const char *settings_exception=allow_target_settings?target:"";
  if (phase>=PRODUCTION_PHASE_INTERNAL_RUNTIME) {
    return production_overlay_wrapper_owner_only(
        "public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)",
        AUTHORITY_SOURCE_FOR("square_production_oauth_authority","oauth")) &&
      production_overlay_wrapper_owner_only(
        "public.check_square_production_broker_authority_v1(text,text,text,bigint,text)",
        AUTHORITY_SOURCE_FOR("square_production_broker_authority","broker")) &&
      production_overlay_wrapper_owner_only(
        "public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)",
        AUTHORITY_SOURCE_FOR("square_production_runtime_authority","runtime")) &&
      production_overlay_wrapper_owner_only(
        "public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)",
        AUTHORITY_SOURCE_FOR("square_production_evidence_authority","evidence")) &&
      production_named_authority_valid("square_production_oauth_authority",
        "public.square_production_internal_oauth_v1(text,jsonb)",
        "6ff215c19aa5c66b607c307d26bcf8f53cc8b3308bd929a50a5f97c5e049d860","square_production_oauth",true,settings_exception,
        membership_transition && !strcmp(target,"square_production_oauth")) &&
      production_named_authority_valid("square_production_broker_authority",
        "public.square_production_internal_broker_v1(text,jsonb)",
        "386b2afeeb21c1884b1d1e4869ceccde87218f2201c4e5c802c74b3ff7ec5b61","square_production_broker",true,settings_exception,
        membership_transition && !strcmp(target,"square_production_broker")) &&
      production_named_authority_valid("square_production_scheduler_authority",
        "public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)",
        AUTHORITY_SOURCE_FOR("square_production_scheduler_authority","scheduler"),"square_production_scheduler",false,settings_exception,
        membership_transition && !strcmp(target,"square_production_scheduler")) &&
      production_named_authority_valid("square_production_webhook_authority",
        "public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)",
        AUTHORITY_SOURCE_FOR("square_production_webhook_authority","webhook"),"square_production_webhook",false,settings_exception,
        membership_transition && !strcmp(target,"square_production_webhook")) &&
      production_named_authority_valid("square_production_runtime_authority",
        "public.square_production_internal_runtime_v1(text,jsonb)",
        "63024be692c785827b982945c220b0268d8e57ee2db4f3d46a8033a5f5fe3301","square_production_runtime",true,settings_exception,
        membership_transition && !strcmp(target,"square_production_runtime")) &&
      production_named_authority_valid("square_production_evidence_authority",
        "public.square_production_internal_evidence_v1(text,jsonb)",
        "98e2d0363897ad1020fb4296dd643ccd4798cac10030b8a4883379844d954877","square_production_evidence",true,settings_exception,
        membership_transition && !strcmp(target,"square_production_evidence"));
  }
  return production_named_authority_valid("square_production_oauth_authority",
      "public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)",
      AUTHORITY_SOURCE_FOR("square_production_oauth_authority","oauth"),"square_production_oauth",false,settings_exception,
      membership_transition && !strcmp(target,"square_production_oauth")) &&
    production_named_authority_valid("square_production_broker_authority",
      "public.check_square_production_broker_authority_v1(text,text,text,bigint,text)",
      AUTHORITY_SOURCE_FOR("square_production_broker_authority","broker"),"square_production_broker",false,settings_exception,
      membership_transition && !strcmp(target,"square_production_broker")) &&
    production_named_authority_valid("square_production_scheduler_authority",
      "public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)",
      AUTHORITY_SOURCE_FOR("square_production_scheduler_authority","scheduler"),"square_production_scheduler",false,settings_exception,
      membership_transition && !strcmp(target,"square_production_scheduler")) &&
    production_named_authority_valid("square_production_webhook_authority",
      "public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)",
      AUTHORITY_SOURCE_FOR("square_production_webhook_authority","webhook"),"square_production_webhook",false,settings_exception,
      membership_transition && !strcmp(target,"square_production_webhook")) &&
    production_named_authority_valid("square_production_runtime_authority",
      "public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)",
      AUTHORITY_SOURCE_FOR("square_production_runtime_authority","runtime"),"square_production_runtime",false,settings_exception,
      membership_transition && !strcmp(target,"square_production_runtime")) &&
    production_named_authority_valid("square_production_evidence_authority",
      "public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)",
      AUTHORITY_SOURCE_FOR("square_production_evidence_authority","evidence"),"square_production_evidence",false,settings_exception,
      membership_transition && !strcmp(target,"square_production_evidence"));
#else
  (void)target;
  (void)allow_target_settings;
  (void)membership_transition;
  return true;
#endif
}
#ifdef VAEROEX_PRODUCTION_PROFILE
static bool lock_target(const char *target);
#endif
#ifdef VAEROEX_SYNTHETIC_ONLY
#ifdef VAEROEX_PRODUCTION_PROFILE
static bool diagnostic_named_authority(const char *capability,const char *authority_function,
                                       const char *authority_source,const char *target,bool *query_error,
                                       const char **error_category) {
  if (!command("SAVEPOINT vaeroex_authority_diagnostic")) { *query_error=true; *error_category="other"; return false; }
  bool value=production_named_authority_valid(capability,authority_function,authority_source,target,false,"",false);
  *query_error=last_query_error;
  *error_category=last_query_error_category;
  if (!command("ROLLBACK TO SAVEPOINT vaeroex_authority_diagnostic")) { *query_error=true; *error_category="other"; }
  return value;
}
typedef enum {
  DIAGNOSTIC_SCHEMA_FUNCTION, DIAGNOSTIC_FUNCTION_FUNCTION, DIAGNOSTIC_TABLE_FUNCTION,
  DIAGNOSTIC_COLUMN_FUNCTION, DIAGNOSTIC_SEQUENCE_FUNCTION, DIAGNOSTIC_FDW_FUNCTION,
  DIAGNOSTIC_SERVER_FUNCTION, DIAGNOSTIC_TABLESPACE_FUNCTION, DIAGNOSTIC_PARAMETER_FUNCTION,
  DIAGNOSTIC_ROLE_FUNCTION, DIAGNOSTIC_ACLEXPLODE_FUNCTION, DIAGNOSTIC_ACLDEFAULT_FUNCTION,
  DIAGNOSTIC_REGPROCEDURE_FUNCTION, DIAGNOSTIC_DIGEST_FUNCTION, DIAGNOSTIC_CONVERT_TO_FUNCTION,
  DIAGNOSTIC_DIGEST_TYPED_FUNCTION, DIAGNOSTIC_GET_EXPR_FUNCTION
} diagnostic_function;
/* A closed set of probes for the fixed predicate below; callers cannot supply
 * SQL. Each probe reports only a finite SQLSTATE category. */
static const char *diagnostic_function_probe(diagnostic_function probe, const char *const *values) {
  const char *sql;
  switch (probe) {
    case DIAGNOSTIC_SCHEMA_FUNCTION: sql="SELECT has_schema_privilege($1,n.oid,'USAGE') FROM pg_namespace n LIMIT 1"; break;
    case DIAGNOSTIC_FUNCTION_FUNCTION: sql="SELECT has_function_privilege($1,p.oid,'EXECUTE') FROM pg_proc p LIMIT 1"; break;
    case DIAGNOSTIC_TABLE_FUNCTION: sql="SELECT has_table_privilege($1,r.oid,'SELECT') FROM pg_class r LIMIT 1"; break;
    case DIAGNOSTIC_COLUMN_FUNCTION: sql="SELECT has_column_privilege($1,r.oid,a.attnum,'SELECT') FROM pg_class r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 LIMIT 1"; break;
    case DIAGNOSTIC_SEQUENCE_FUNCTION: sql="SELECT has_sequence_privilege($1,r.oid,'USAGE') FROM pg_class r LIMIT 1"; break;
    case DIAGNOSTIC_FDW_FUNCTION: sql="SELECT has_foreign_data_wrapper_privilege($1,f.oid,'USAGE') FROM pg_foreign_data_wrapper f LIMIT 1"; break;
    case DIAGNOSTIC_SERVER_FUNCTION: sql="SELECT has_server_privilege($1,s.oid,'USAGE') FROM pg_foreign_server s LIMIT 1"; break;
    case DIAGNOSTIC_TABLESPACE_FUNCTION: sql="SELECT has_tablespace_privilege($1,t.oid,'CREATE') FROM pg_tablespace t LIMIT 1"; break;
    case DIAGNOSTIC_PARAMETER_FUNCTION: sql="SELECT has_parameter_privilege($1,p.parname,'SET') FROM pg_parameter_acl p LIMIT 1"; break;
    case DIAGNOSTIC_ROLE_FUNCTION: sql="SELECT pg_has_role($1,'pg_read_all_stats','USAGE')"; break;
    case DIAGNOSTIC_ACLEXPLODE_FUNCTION: sql="SELECT aclexplode(n.nspacl) FROM pg_namespace n LIMIT 1"; break;
    case DIAGNOSTIC_ACLDEFAULT_FUNCTION: sql="SELECT acldefault('n',n.nspowner) FROM pg_namespace n LIMIT 1"; break;
    case DIAGNOSTIC_REGPROCEDURE_FUNCTION: sql="SELECT to_regprocedure($1)"; break;
    case DIAGNOSTIC_DIGEST_FUNCTION: sql="SELECT extensions.digest(pg_catalog.convert_to('x','UTF8'),'sha256')"; break;
    case DIAGNOSTIC_CONVERT_TO_FUNCTION: sql="SELECT pg_catalog.convert_to($1::text,'UTF8'::name)"; break;
    case DIAGNOSTIC_DIGEST_TYPED_FUNCTION: sql="SELECT extensions.digest(pg_catalog.convert_to($1::text,'UTF8'::name),'sha256'::text)"; break;
    case DIAGNOSTIC_GET_EXPR_FUNCTION: sql="SELECT pg_catalog.pg_get_expr(NULL::pg_node_tree,0)"; break;
    default: return "other";
  }
  if (!command("SAVEPOINT vaeroex_function_diagnostic")) return "other";
  PGresult *r=query(sql,1,values);
  const char *category=last_query_error ? last_query_error_category : "none";
  if (r) PQclear(r);
  if (!command("ROLLBACK TO SAVEPOINT vaeroex_function_diagnostic")) return "other";
  return category;
}
/* Local qualification only. This emits fixed predicate labels and booleans so
 * a failed synthetic inspection can distinguish fixture setup from recovery;
 * it never includes connection data, SQL, credentials, or provider values. */
static void production_authority_diagnostic(const char *target, bool identity_ok, bool profile_ok) {
  const char *target_value[]={target};
  production_phase phase=production_ledger_phase();
  bool platform_closed=true_query("SELECT NOT EXISTS (SELECT FROM private.integration_production_platform_bindings "
    "WHERE infrastructure_provisioned OR runtime_enabled OR economic_contributions_enabled OR ai_dispatch_enabled)",0,NULL);
  bool provider_closed=true_query("SELECT NOT EXISTS (SELECT FROM private.integration_production_provider_bindings "
    "WHERE provider_key='square' AND environment='production' AND (enabled OR provider_calls_enabled "
    "OR customer_onboarding_enabled OR webhook_intake_enabled OR evidence_enabled "
    "OR economic_contributions_enabled OR ai_dispatch_enabled))",0,NULL);
  bool configuration_closed=true_query("SELECT NOT EXISTS (SELECT FROM private.square_production_configuration_generations "
    "WHERE runtime_enabled OR provider_calls_enabled OR customer_onboarding_enabled OR webhook_intake_enabled "
    "OR evidence_enabled OR economic_contributions_enabled OR ai_dispatch_enabled)",0,NULL);
  bool capability_closed=true_query("SELECT NOT EXISTS (SELECT FROM private.integration_production_provider_capabilities "
    "WHERE database_login=$1 AND NOT (provider_key='square' AND environment='production' "
    "AND project_id='vaeroex-integrations-prod' AND capability='" CAPABILITY_NAME "' "
    "AND database_secret_purpose='database_" CAPABILITY_NAME "'))",1,target_value);
  bool closed=closed_authority(target);
  bool locked=closed && lock_target(target);
  bool contract=phase!=PRODUCTION_PHASE_INVALID && production_contract_valid(phase);
  bool oauth_error=false,broker_error=false,scheduler_error=false,webhook_error=false,runtime_error=false,evidence_error=false;
  const char *oauth_category="none",*broker_category="none",*scheduler_category="none",*webhook_category="none",*runtime_category="none",*evidence_category="none";
  bool oauth=diagnostic_named_authority("square_production_oauth_authority",
    "public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)",
    AUTHORITY_SOURCE_FOR("square_production_oauth_authority","oauth"),"square_production_oauth",&oauth_error,&oauth_category);
  bool broker=diagnostic_named_authority("square_production_broker_authority",
    "public.check_square_production_broker_authority_v1(text,text,text,bigint,text)",
    AUTHORITY_SOURCE_FOR("square_production_broker_authority","broker"),"square_production_broker",&broker_error,&broker_category);
  bool scheduler=diagnostic_named_authority("square_production_scheduler_authority",
    "public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)",
    AUTHORITY_SOURCE_FOR("square_production_scheduler_authority","scheduler"),"square_production_scheduler",&scheduler_error,&scheduler_category);
  bool webhook=diagnostic_named_authority("square_production_webhook_authority",
    "public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)",
    AUTHORITY_SOURCE_FOR("square_production_webhook_authority","webhook"),"square_production_webhook",&webhook_error,&webhook_category);
  bool runtime=diagnostic_named_authority("square_production_runtime_authority",
    "public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)",
    AUTHORITY_SOURCE_FOR("square_production_runtime_authority","runtime"),"square_production_runtime",&runtime_error,&runtime_category);
  bool evidence=diagnostic_named_authority("square_production_evidence_authority",
    "public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)",
    AUTHORITY_SOURCE_FOR("square_production_evidence_authority","evidence"),"square_production_evidence",&evidence_error,&evidence_category);
  const char *broker_values[]={"square_production_broker_authority",
    "public.check_square_production_broker_authority_v1(text,text,text,bigint,text)",
    "private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)",
    "square_production_broker"};
  bool broker_wrapper=production_overlay_wrapper_owner_only(broker_values[1],
    AUTHORITY_SOURCE_FOR("square_production_broker_authority","broker"));
  bool broker_role_exists=true_query("SELECT EXISTS (SELECT FROM pg_roles WHERE rolname=$1)",1,&broker_values[3]);
  bool broker_capability_exists=true_query("SELECT EXISTS (SELECT FROM pg_roles WHERE rolname=$1)",1,broker_values);
  bool broker_wrapper_exists=true_query("SELECT to_regprocedure($1) IS NOT NULL",1,&broker_values[1]);
  const char *broker_wrapper_shape_values[]={broker_values[0],broker_values[1],
    AUTHORITY_SOURCE_FOR("square_production_broker_authority","broker")};
  bool broker_wrapper_shape=true_query("SELECT EXISTS (SELECT FROM pg_namespace n JOIN pg_proc p ON p.pronamespace=n.oid "
    "JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure($2) AND n.nspname='public' "
    "AND has_schema_privilege($1,n.oid,'USAGE') AND l.lanname='plpgsql' "
    "AND p.proowner=current_user::regrole::oid AND p.prosecdef AND p.proparallel='u' AND NOT p.proisstrict "
    "AND NOT p.proretset AND p.prokind='f' AND p.proargmodes IS NULL AND p.pronargdefaults=0 "
    "AND p.proargdefaults IS NULL AND p.proconfig IS NOT DISTINCT FROM array['search_path=\"\"']::text[] "
    "AND p.provolatile='s' AND p.pronargs=5 AND p.prorettype='void'::regtype AND p.proargnames IS NOT DISTINCT FROM "
    "array['p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint']::text[] "
    "AND p.prosrc=$3)",3,broker_wrapper_shape_values);
  bool broker_helper=true_query("SELECT EXISTS (SELECT FROM pg_namespace n JOIN pg_proc p ON p.pronamespace=n.oid "
    "JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure($1) AND n.nspname='private' "
    "AND l.lanname='plpgsql' AND p.proowner=current_user::regrole::oid AND NOT p.prosecdef AND p.provolatile='s' "
    "AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.proretset AND p.prokind='f' AND p.pronargs=6 "
    "AND p.prorettype='void'::regtype AND p.proargnames IS NOT DISTINCT FROM array["
      "'p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint','p_capability']::text[] "
    "AND p.proargmodes IS NULL AND p.pronargdefaults=0 AND p.proargdefaults IS NULL "
    "AND p.proconfig IS NOT DISTINCT FROM array['search_path=\"\"']::text[] AND md5(p.prosrc)=$2)",2,
    (const char *[]){broker_values[2],OPERATIONAL_AUTHORITY_SOURCE_MD5});
  bool broker_capability_role=true_query("SELECT EXISTS (SELECT FROM pg_roles c WHERE c.rolname=$1 AND NOT c.rolcanlogin "
    "AND NOT c.rolinherit AND NOT c.rolsuper AND NOT c.rolcreaterole AND NOT c.rolcreatedb "
    "AND NOT c.rolreplication AND NOT c.rolbypassrls AND c.rolconfig IS NULL)",1,broker_values);
  bool broker_no_membership=true_query("SELECT NOT EXISTS (SELECT FROM pg_auth_members m WHERE m.member=$1::regrole)",1,broker_values);
  bool broker_target_absent=true_query("SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname=$1)",1,&broker_values[3]);
  bool broker_public_usage=true_query("SELECT (SELECT count(*)=1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a "
    "WHERE n.oid='public'::regnamespace AND a.grantee=$1::regrole AND a.privilege_type='USAGE' AND NOT a.is_grantable) "
    "AND NOT EXISTS (SELECT FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a "
    "WHERE n.oid='public'::regnamespace AND a.grantee=$1::regrole AND (a.privilege_type<>'USAGE' OR a.is_grantable))",1,broker_values);
  bool broker_execute_acl=true_query("SELECT (SELECT count(*)=1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a "
    "WHERE a.grantee=$1::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable "
    "AND p.oid=to_regprocedure($2)) AND NOT EXISTS (SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a "
    "WHERE p.oid=to_regprocedure($2) AND (a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) "
    "AND NOT (a.grantee=$1::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable))",2,broker_values);
  bool broker_private_closed=true_query("SELECT NOT has_schema_privilege($1,'private','USAGE')",1,broker_values);
  const char *function_probe_values[]={target};
  const char *schema_category=diagnostic_function_probe(DIAGNOSTIC_SCHEMA_FUNCTION,function_probe_values);
  const char *function_category=diagnostic_function_probe(DIAGNOSTIC_FUNCTION_FUNCTION,function_probe_values);
  const char *table_category=diagnostic_function_probe(DIAGNOSTIC_TABLE_FUNCTION,function_probe_values);
  const char *column_category=diagnostic_function_probe(DIAGNOSTIC_COLUMN_FUNCTION,function_probe_values);
  const char *sequence_category=diagnostic_function_probe(DIAGNOSTIC_SEQUENCE_FUNCTION,function_probe_values);
  const char *fdw_category=diagnostic_function_probe(DIAGNOSTIC_FDW_FUNCTION,function_probe_values);
  const char *server_category=diagnostic_function_probe(DIAGNOSTIC_SERVER_FUNCTION,function_probe_values);
  const char *tablespace_category=diagnostic_function_probe(DIAGNOSTIC_TABLESPACE_FUNCTION,function_probe_values);
  const char *parameter_category=diagnostic_function_probe(DIAGNOSTIC_PARAMETER_FUNCTION,function_probe_values);
  const char *role_category=diagnostic_function_probe(DIAGNOSTIC_ROLE_FUNCTION,function_probe_values);
  const char *aclexplode_category=diagnostic_function_probe(DIAGNOSTIC_ACLEXPLODE_FUNCTION,function_probe_values);
  const char *acldefault_category=diagnostic_function_probe(DIAGNOSTIC_ACLDEFAULT_FUNCTION,function_probe_values);
  const char *regprocedure_category=diagnostic_function_probe(DIAGNOSTIC_REGPROCEDURE_FUNCTION,function_probe_values);
  const char *digest_category=diagnostic_function_probe(DIAGNOSTIC_DIGEST_FUNCTION,function_probe_values);
  const char *convert_to_category=diagnostic_function_probe(DIAGNOSTIC_CONVERT_TO_FUNCTION,function_probe_values);
  const char *digest_typed_category=diagnostic_function_probe(DIAGNOSTIC_DIGEST_TYPED_FUNCTION,function_probe_values);
  const char *get_expr_category=diagnostic_function_probe(DIAGNOSTIC_GET_EXPR_FUNCTION,function_probe_values);
  printf("{\"outcome\":\"production_authority_diagnostic\",\"identity\":%s,\"profile\":%s,\"platformClosed\":%s,\"providerClosed\":%s,\"configurationClosed\":%s,\"capabilityClosed\":%s,\"closedAuthority\":%s,\"targetLock\":%s,\"phaseValid\":%s,\"productionContract\":%s,\"oauthAuthority\":%s,\"brokerAuthority\":%s,\"schedulerAuthority\":%s,\"webhookAuthority\":%s,\"runtimeAuthority\":%s,\"evidenceAuthority\":%s,\"oauthQueryError\":%s,\"oauthQueryCategory\":\"%s\",\"brokerQueryError\":%s,\"brokerQueryCategory\":\"%s\",\"schedulerQueryError\":%s,\"schedulerQueryCategory\":\"%s\",\"webhookQueryError\":%s,\"webhookQueryCategory\":\"%s\",\"runtimeQueryError\":%s,\"runtimeQueryCategory\":\"%s\",\"evidenceQueryError\":%s,\"evidenceQueryCategory\":\"%s\",\"schemaCategory\":\"%s\",\"functionCategory\":\"%s\",\"tableCategory\":\"%s\",\"columnCategory\":\"%s\",\"sequenceCategory\":\"%s\",\"fdwCategory\":\"%s\",\"serverCategory\":\"%s\",\"tablespaceCategory\":\"%s\",\"parameterCategory\":\"%s\",\"roleCategory\":\"%s\",\"aclexplodeCategory\":\"%s\",\"acldefaultCategory\":\"%s\",\"regprocedureCategory\":\"%s\",\"digestCategory\":\"%s\",\"convertToCategory\":\"%s\",\"digestTypedCategory\":\"%s\",\"getExprCategory\":\"%s\",\"brokerRoleExists\":%s,\"brokerCapabilityExists\":%s,\"brokerWrapperExists\":%s,\"brokerWrapper\":%s,\"brokerWrapperShape\":%s,\"brokerHelper\":%s,\"brokerCapabilityRole\":%s,\"brokerNoMembership\":%s,\"brokerTargetAbsent\":%s,\"brokerPublicUsage\":%s,\"brokerExecuteAcl\":%s,\"brokerPrivateClosed\":%s}\n",
    identity_ok?"true":"false",profile_ok?"true":"false",platform_closed?"true":"false",provider_closed?"true":"false",
    configuration_closed?"true":"false",capability_closed?"true":"false",closed?"true":"false",locked?"true":"false",
    phase!=PRODUCTION_PHASE_INVALID?"true":"false",contract?"true":"false",oauth?"true":"false",broker?"true":"false",
    scheduler?"true":"false",webhook?"true":"false",runtime?"true":"false",evidence?"true":"false",
    oauth_error?"true":"false",oauth_category,broker_error?"true":"false",broker_category,scheduler_error?"true":"false",scheduler_category,webhook_error?"true":"false",webhook_category,runtime_error?"true":"false",runtime_category,evidence_error?"true":"false",evidence_category,
    schema_category,function_category,table_category,column_category,sequence_category,fdw_category,server_category,tablespace_category,parameter_category,role_category,aclexplode_category,acldefault_category,regprocedure_category,digest_category,convert_to_category,digest_typed_category,get_expr_category,
    broker_role_exists?"true":"false",broker_capability_exists?"true":"false",broker_wrapper_exists?"true":"false",broker_wrapper?"true":"false",broker_wrapper_shape?"true":"false",
    broker_helper?"true":"false",broker_capability_role?"true":"false",broker_no_membership?"true":"false",broker_target_absent?"true":"false",
    broker_public_usage?"true":"false",broker_execute_acl?"true":"false",broker_private_closed?"true":"false");
  fflush(stdout);
}
#endif
#endif
static bool role_valid(const char *target, const char *oid, int state) {
  const char *values[] = {target, oid, state==3 ? "3" : state==2 ? "2" : state==1 ? "1" : "0", CAPABILITY};
  return true_query("SELECT EXISTS (SELECT FROM pg_roles r WHERE r.rolname=$1 AND r.oid::text=$2 "
    "AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication "
    "AND NOT r.rolbypassrls "
#ifdef VAEROEX_PRODUCTION_PROFILE
    "AND (($3::integer=2 AND r.rolcanlogin=r.rolinherit) "
      "OR ($3::integer=3 AND r.rolcanlogin AND r.rolinherit) "
      "OR ($3::integer=1 AND r.rolcanlogin AND r.rolinherit) "
      "OR ($3::integer=0 AND NOT r.rolcanlogin AND NOT r.rolinherit)) "
#else
    "AND r.rolinherit AND (NOT r.rolcanlogin OR $3::integer<>0) "
#endif
    "AND ($3::integer IN (2,3) OR r.rolconfig IS NULL)) "
    "AND EXISTS (SELECT FROM pg_roles c WHERE c.rolname=$4 "
    "AND NOT c.rolcanlogin AND NOT c.rolsuper AND NOT c.rolcreaterole AND NOT c.rolcreatedb "
    "AND NOT c.rolreplication AND NOT c.rolbypassrls AND c.rolconfig IS NULL) "
    "AND EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member "
    "JOIN pg_roles c ON c.oid=m.roleid WHERE r.rolname=$1 AND c.rolname=$4 "
    "AND NOT m.admin_option "
#ifdef VAEROEX_PRODUCTION_PROFILE
    "AND NOT m.set_option AND m.inherit_option=CASE WHEN $3::integer=1 THEN true "
      "WHEN $3::integer IN (0,3) THEN false ELSE (SELECT rolinherit FROM pg_roles WHERE rolname=$1) END) "
#else
    "AND m.inherit_option AND m.set_option) "
#endif
    /* Grants are keyed by grantor too: one good row must not hide a second
     * ADMIN-capable grant of the same capability from another grantor. */
    "AND NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member "
    "JOIN pg_roles c ON c.oid=m.roleid WHERE r.rolname=$1 AND "
    "(c.rolname<>$4 OR m.admin_option "
#ifdef VAEROEX_PRODUCTION_PROFILE
    "OR m.inherit_option<>CASE WHEN $3::integer=1 THEN true "
      "WHEN $3::integer IN (0,3) THEN false ELSE (SELECT rolinherit FROM pg_roles WHERE rolname=$1) END "
    "OR m.set_option)) "
#else
    "OR NOT m.inherit_option OR NOT m.set_option)) "
#endif
#ifdef VAEROEX_PRODUCTION_PROFILE
    /* The optional automatic creator membership must be the exact current
     * non-superuser CREATEROLE session and bootstrap-superuser grant, not merely
     * any role having a sufficiently powerful attribute. */
    "AND (SELECT count(*) BETWEEN 1 AND 2 FROM pg_auth_members m WHERE m.roleid=$4::regrole) "
    "AND NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member "
      "WHERE m.roleid=$4::regrole AND NOT ("
        "(m.member=$1::regrole AND NOT m.admin_option AND NOT m.set_option AND m.inherit_option=CASE "
          "WHEN $3::integer=1 THEN true WHEN $3::integer IN (0,3) THEN false "
          "ELSE (SELECT rolinherit FROM pg_roles WHERE rolname=$1) END) OR "
        "(m.member=session_user::regrole::oid AND m.grantor='10'::oid "
          "AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option "
          "AND NOT member_role.rolsuper AND member_role.rolcreaterole)"
      ")) "
#endif
    "AND NOT EXISTS (SELECT FROM pg_roles c WHERE c.rolname NOT IN ($1,$4) "
    "AND pg_has_role($1,c.oid,'MEMBER')) "
    /* PG16+ gives a non-superuser CREATEROLE operator an inherent ADMIN-only
     * membership. That exact authenticated operator may manage this role but
     * must not inherit or SET ROLE into it. No other member is permitted. */
    "AND NOT EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member "
    "WHERE m.roleid=(SELECT oid FROM pg_roles WHERE rolname=$1) AND NOT ("
    "m.member=session_user::regrole::oid AND m.grantor='10'::oid AND NOT member_role.rolsuper "
    "AND member_role.rolcreaterole AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)) "
    /* Native shared dependencies cover direct ACLs (including column/function
     * grants), ownership, initial ACLs and policy references across databases.
     * A dedicated login may inherit the capability, not own extra authority. */
    "AND NOT EXISTS (SELECT FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass "
    "AND d.refobjid=(SELECT oid FROM pg_roles WHERE rolname=$1) AND d.deptype IN ('o','a','i','r')) "
    "AND ($3::integer IN (2,3) OR NOT EXISTS (SELECT FROM pg_db_role_setting "
      "WHERE setrole=(SELECT oid FROM pg_roles WHERE rolname=$1)))", 4, values)
    && production_authority_valid(target,state==2 || state==3,state==3);
}
#ifdef VAEROEX_PRODUCTION_PROFILE
static int managed_fence_entry_role_state(const char *target,const char *oid) {
  /* Preserve which exact contract admitted the role.  State 2 intentionally
   * remains the existing active-path assertion, while state 3 is the single
   * safe capability-only recovery transition.  Test exact closure first so a
   * no-op fence of an already-closed role remains closed through phase two. */
  if (role_valid(target,oid,0)) return 0;
  if (role_valid(target,oid,3)) return 3;
  if (role_valid(target,oid,2)) return 2;
  return -1;
}
static bool begin_locked_authority_after_transition(const char *operation,const char *target,
                                                    const char *role_oid,int *fence_entry_state,
                                                    bool *capability_transition) {
  for (;;) {
    if (!command("BEGIN")) return false;
    transaction=true;
    if (!(!strcmp(operation,"fence") ? fence_authority(target) : closed_authority(target)) ||
        !lock_target(target)) return false;
    if (managed_profile() && strcmp(operation,"fence") && strcmp(role_oid,"0") &&
        role_valid(target,role_oid,3)) {
      /* A concurrently running fence has committed the capability-only
       * transition but has not yet committed NOLOGIN/NOINHERIT.  Do not
       * reject an otherwise valid queued operation or act on the transitional
       * role. Release the transaction locks and retry only this exact state;
       * every other invalid authority shape still fails closed below. */
      if (!command("ROLLBACK")) return false;
      transaction=false;
#ifdef VAEROEX_MANAGED_PROFILE_TEST
      managed_test_transition_waits++;
#endif
      struct timespec pause={0,20000000};
      while (nanosleep(&pause,&pause)!=0 && errno==EINTR) {}
      if (stopped()) return false;
      continue;
    }
    if (managed_profile() && !strcmp(operation,"fence") && *fence_entry_state>=0) {
      int observed=managed_fence_entry_role_state(target,role_oid);
      bool valid=(*fence_entry_state==0 && observed==0) ||
        (*fence_entry_state==2 && (observed==3 || observed==0)) ||
        (*fence_entry_state==3 && (observed==3 || observed==0));
      if (!valid) return false;
      /* A second fence queued during the first fence's transaction gap may
       * observe exact closure after taking the relation lock. Reconcile that
       * completed transition as a no-op fence rather than reporting an
       * uncertain operation. */
      *fence_entry_state=observed;
      *capability_transition=observed!=0;
    }
    return true;
  }
}
#endif
static bool no_sessions(const char *target) {
  const char *values[] = {target};
  return true_query("SELECT NOT EXISTS (SELECT FROM pg_stat_activity WHERE usename=$1)", 1, values);
}
static bool lock_target(const char *target) {
#ifdef VAEROEX_PRODUCTION_PROFILE
  if (managed_profile()) {
    /* The managed Production authority boundary already holds the fixed,
     * restricted ShareRowExclusiveLock acquired by closed_authority().  Use
     * that application-owned fence for target serialization too: an ordinary
     * LOGIN must not be able to pre-acquire a predictable public advisory key
     * and delay NOLOGIN/revocation.  Fail closed if this helper is called out
     * of order or for any target other than the compile-time capability role. */
    if (strcmp(target,MAPPED_ROLE)) return false;
    return true_query("SELECT EXISTS (SELECT FROM pg_locks WHERE pid=pg_backend_pid() "
      "AND locktype='relation' "
      "AND relation='private.integration_production_platform_bindings'::regclass "
      "AND mode='ShareRowExclusiveLock' AND granted)",0,NULL);
  }
#endif
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
  if (strcmp(op,"inspect") && strcmp(op,"prepare") && strcmp(op,"fence") && strcmp(op,"assign") && strcmp(op,"activate") && strcmp(op,"authenticate")
#ifdef VAEROEX_SYNTHETIC_ONLY
      && strcmp(op,"diagnose")
#endif
      ) return 2;
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
  bool ok = !strcmp(op,"diagnose") || read_line(3,admin_password,sizeof(admin_password),5000);
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
#ifdef VAEROEX_PRODUCTION_PROFILE
    /* Fence alone receives a second independently authenticated administrator
     * session.  It is used only to terminate exact-target sessions while the
     * primary connection waits for the NOLOGIN tuple transition. */
    if (!strcmp(op,"fence") && managed_profile())
      control_db=PQconnectdbParams(keywords,values,0);
#endif
  }
  wipe(admin_password,sizeof(admin_password));
  /* mlock is page-granular and locks do not stack. These arrays may share a
   * page, so keep BOTH locks until all owned credential material is wiped. */
  ok = ok && db && PQstatus(db)==CONNECTION_OK &&
    (!control_db || PQstatus(control_db)==CONNECTION_OK) && !stopped();
  if (control_db && PQstatus(control_db)==CONNECTION_OK)
    atomic_store(&watched_control_socket,PQsocket(control_db));
  if (ok) {
    PQsetNoticeProcessor(db,notice,NULL);
    atomic_store(&watched_socket,PQsocket(db));
    bool identity_ok = identity(host,database,admin,system_id,db_oid);
    bool profile_ok = identity_ok && profile();
    ok = identity_ok && profile_ok;
#ifdef VAEROEX_PRODUCTION_PROFILE
    if (ok && control_db) {
      PGconn *primary=db;
      PQsetNoticeProcessor(control_db,notice,NULL);
      db=control_db;
      ok=identity(host,database,admin,system_id,db_oid) && profile();
      db=primary;
    }
#endif
#if defined(VAEROEX_SYNTHETIC_ONLY) && defined(VAEROEX_PRODUCTION_PROFILE)
    if (!ok && !strcmp(op,"diagnose")) {
      production_authority_diagnostic(target,identity_ok,profile_ok);
      return 2;
    }
#endif
  }
 #if defined(VAEROEX_SYNTHETIC_ONLY) && defined(VAEROEX_PRODUCTION_PROFILE)
  if (ok && !strcmp(op,"diagnose")) {
    if (!command("BEGIN")) return 2;
    transaction = true;
    production_authority_diagnostic(target,true,true);
    (void)command("ROLLBACK");
    transaction = false;
    return 0;
  }
 #endif
  bool managed_capability_transition=false;
#ifdef VAEROEX_PRODUCTION_PROFILE
  bool managed_capability_closed=false;
  int managed_fence_entry_state=-1;
  if (ok && !strcmp(op,"fence") && managed_profile()) {
    /* Close inherited RPC authority before taking application-table locks.
     * A previously authorized request may already hold a RowExclusiveLock on
     * those tables. This first, deliberately small transaction prevents any
     * new request from inheriting the capability; the exact-login drain then
     * rolls back existing requests and releases their locks. Any later failure
     * is checked-recovery territory because this safe closure has committed.
     * The full contract is validated once before this transition and again
     * under the normal locks below. */
    ok=command("BEGIN");
    transaction=ok;
    if (ok) ok=production_authority_catalog_fence();
    if (ok && strcmp(role_oid,"0")) {
      managed_fence_entry_state=managed_fence_entry_role_state(target,role_oid);
      ok=managed_fence_entry_state>=0;
    } else if (ok) ok=false;
    if (ok) ok=managed_close_capability(target);
    if (ok) {
      commit_attempted=true;
      ok=command("COMMIT");
      transaction=!ok;
    }
    if (ok) ok=terminate_target_sessions(control_db,target);
    managed_capability_closed=ok;
    managed_capability_transition=ok && managed_fence_entry_state!=0;
  }
#endif
#ifdef VAEROEX_PRODUCTION_PROFILE
  if (ok) ok=begin_locked_authority_after_transition(op,target,role_oid,
    &managed_fence_entry_state,&managed_capability_transition);
#else
  if (ok) { ok = command("BEGIN"); transaction = ok; }
  if (ok) ok = closed_authority(target) && lock_target(target);
#endif
  /* Fence must not depend on settings that the target LOGIN can assign to
   * itself.  Only this pre-revocation path permits those two catalog fields;
   * every other role, privilege, membership, object and gate predicate remains
   * exact, and the normal post-commit validation below rejects residual
   * settings after NOLOGIN/NOINHERIT commits and sessions are terminated. */
  if (ok) ok = production_authority_valid(target,!strcmp(op,"fence"),managed_capability_transition);
  if (ok && !strcmp(op,"prepare")) {
    const char *values[] = {target,CAPABILITY};
    ok = !strcmp(role_oid,"0") && true_query("SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname=$1) "
      "AND EXISTS (SELECT FROM pg_roles WHERE rolname=$2 AND NOT rolcanlogin "
      "AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls "
      "AND rolconfig IS NULL)",2,values);
    if (ok) ok = role_command("CREATE ROLE",target,
#ifdef VAEROEX_PRODUCTION_PROFILE
      "NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS"
#else
      "NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS"
#endif
    );
    if (ok) ok = role_command("GRANT " CAPABILITY " TO",target,
#ifdef VAEROEX_PRODUCTION_PROFILE
      "WITH ADMIN FALSE, INHERIT FALSE, SET FALSE"
#else
      "WITH ADMIN FALSE, INHERIT TRUE, SET TRUE"
#endif
    );
  } else if (ok && !strcmp(op,"inspect") && !strcmp(role_oid,"0")) {
    const char *values[]={target};
    ok=true_query("SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname=$1)",1,values);
  } else if (ok) {
    /* An ordinary inspection is a closed-state proof. Only fence may accept
     * either the bounded active state or the already-closed state because it
     * is the compensating operation after an interrupted authentication. */
    int expected_state=!strcmp(op,"authenticate")?1:
#ifdef VAEROEX_PRODUCTION_PROFILE
      !strcmp(op,"fence") && managed_capability_closed?
        (managed_fence_entry_state==0?0:3):
#endif
      !strcmp(op,"fence")?2:0;
    ok = strcmp(role_oid,"0") && role_valid(target,role_oid,expected_state);
    if (ok && strcmp(op,"inspect") && strcmp(op,"authenticate")) {
      if (!strcmp(op,"fence")) {
#ifdef VAEROEX_PRODUCTION_PROFILE
        /* Managed Production already committed the capability-inheritance
         * fence and drained existing RPCs before these application locks were
         * acquired. Keep draining exact-target catalog lockers while the
         * remaining NOLOGIN tuple transition waits. */
        if (managed_profile()) ok=managed_fence_role(target);
        else {
          ok=role_command("GRANT " CAPABILITY " TO",target,
            "WITH ADMIN FALSE, INHERIT FALSE, SET FALSE");
          if (ok) ok=role_command("ALTER ROLE",target,"NOLOGIN NOINHERIT");
        }
#else
        ok=role_command("ALTER ROLE",target,"NOLOGIN");
#endif
      } else if (ok) ok = role_command("ALTER ROLE",target,
#ifdef VAEROEX_PRODUCTION_PROFILE
        "NOLOGIN NOINHERIT"
#else
        "NOLOGIN"
#endif
      );
    }
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
      if (ok) ok =
#ifdef VAEROEX_PRODUCTION_PROFILE
        fence_authority(target) &&
#else
        closed_authority(target) &&
#endif
        lock_target(target) && role_valid(target,role_oid,0) && no_sessions(target);
    }
    if (ok && (!strcmp(op,"assign") || !strcmp(op,"activate")))
      ok = role_valid(target,role_oid,0) && no_sessions(target);
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
    if (ok && !strcmp(op,"activate")) {
#ifdef VAEROEX_PRODUCTION_PROFILE
      ok = role_command("GRANT " CAPABILITY " TO",target,
        "WITH ADMIN FALSE, INHERIT TRUE, SET FALSE");
#endif
      if (ok) ok = role_command("ALTER ROLE",target,
#ifdef VAEROEX_PRODUCTION_PROFILE
        "LOGIN INHERIT"
#else
        "LOGIN"
#endif
      );
    }
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
#ifdef VAEROEX_PRODUCTION_PROFILE
  /* Re-run the exact managed ledger/schema/ABI/authority closure immediately
   * before commit, after the final role transition and secret-store ack. The
   * authority/table locks remain held; an absent-role inspection still proves
   * the profile contract rather than silently skipping the postflight. */
  if (ok) {
    int final_state=(!strcmp(op,"activate") || !strcmp(op,"authenticate")) ? 1 : 0;
    ok=strcmp(resolved_oid,"0") ? role_valid(target,resolved_oid,final_state)
      : (!strcmp(op,"inspect") && production_authority_valid(target,false,false));
  }
#endif
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
  atomic_store(&watched_control_socket,-1);
  if (control_db) PQfinish(control_db);
  if (db) PQfinish(db);
  if (result==2) puts("{\"outcome\":\"failed\"}");
  if (result==3) puts("{\"outcome\":\"uncertain\"}");
  return result;
#endif
}
