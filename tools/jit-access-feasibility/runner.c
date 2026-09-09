#define _POSIX_C_SOURCE 200809L
#include <libpq-fe.h>
#include <curl/curl.h>
#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/select.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/prctl.h>
#endif

/* User's 2026-09-08 execution approval permits only this isolated test profile.
 * Ordinary builds remain blocked. Neither profile accepts arbitrary targets. */
#if defined(JIT_LOCAL_MOCK) && defined(JIT_APPROVED_SANDBOX_20260908)
#error "Choose exactly one profile"
#endif
#if !defined(JIT_LOCAL_MOCK) && !defined(JIT_APPROVED_SANDBOX_20260908)
int main(void) { puts("hosted_execution_blocked"); return 78; }
#else
extern char **environ;
#ifdef JIT_LOCAL_MOCK
/* Undefined in real libpq: the only runnable build must link our local fake. */
extern void jit_local_mock_link_required(void);
extern void jit_mock_verify_wipe(const void *, size_t);
#endif
static const char ROLE[] = "vaeroex_jit_feasibility_20260908";
static const char POOLER[] = "aws-0-us-west-2.pooler.supabase.com";
static const char TRANSPORT_USER[] = "vaeroex_jit_feasibility_20260908.oysjpoondtcrqpghhrbd";
static const char WORKSPACE[] = "11111111-1111-4111-8111-111111111111";
static struct { char token[4097]; char authorization[4140]; } sensitive;
#define credential sensitive.token
static char pooler_address[INET_ADDRSTRLEN], api_address[INET_ADDRSTRLEN];
static volatile sig_atomic_t interrupted;
static int tty = -1, tty_changed, locked;
static struct termios saved_tty;
static PGconn *held, *fresh;
static time_t deadline;
static unsigned attempts;
static int attempt_budget_exhausted;
static int curl_initialized;

static void wipe(void *p, size_t n) { volatile unsigned char *q = p; while (n--) *q++ = 0; }
static void signal_stop(int n) { (void)n; interrupted = 1; }
static time_t monotonic_now(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC,&now) != 0) { interrupted=1; return 0; }
  return now.tv_sec;
}
static int alive(void) { return !interrupted && monotonic_now() < deadline; }
static int take_attempt(void) {
  if (attempts >= 60) { attempt_budget_exhausted=1; return 0; }
  ++attempts; return 1;
}
static void discard_notice(void *ctx, const char *message) { (void)ctx; (void)message; }
static void restore_tty(void) {
  if (tty_changed) { tcsetattr(tty, TCSAFLUSH, &saved_tty); tty_changed = 0; }
}
static void cleanup(void) {
  restore_tty();
  if (fresh) { PQfinish(fresh); fresh = NULL; }
  if (held) { PQfinish(held); held = NULL; }
  if (curl_initialized) { curl_global_cleanup(); curl_initialized=0; }
  wipe(&sensitive, sizeof sensitive);
#ifdef JIT_LOCAL_MOCK
  jit_mock_verify_wipe(&sensitive, sizeof sensitive);
#endif
  if (locked) { munlock(&sensitive, sizeof sensitive); locked = 0; }
  if (tty >= 0) { close(tty); tty = -1; }
}
static int finish(const char *label, int status) {
  cleanup(); puts(label); return status;
}
static int private_environment(void) {
  for (char **p = environ; *p; ++p) {
    const char *equal = strchr(*p, '=');
    if (!equal) return 0;
    size_t n = (size_t)(equal - *p);
    char key[256];
    if (n >= sizeof key) return 0;
    memcpy(key, *p, n); key[n] = 0;
    for (size_t i=0;i<n;++i) key[i]=(char)toupper((unsigned char)key[i]);
    if (!strncmp(key, "PG", 2) || strstr(key, "PASSWORD") || strstr(key, "TOKEN") ||
        !strncmp(key,"LD_",3) || !strncmp(key,"DYLD_",5) || strstr(key,"PROXY") ||
        !strncmp(key,"SSL",3) || !strncmp(key,"OPENSSL_",8) || !strncmp(key,"CURL_",5) ||
        !strncmp(key,"GNUTLS_",7) || !strncmp(key,"NSS_",4) ||
        strstr(key, "SECRET") || !strcmp(key, "DATABASE_URL") || !strcmp(key, "DATABASE_DSN")) return 0;
  }
  return 1;
}
static int harden(void) {
  struct rlimit core = {0, 0};
  if (setrlimit(RLIMIT_CORE, &core) != 0) return 0;
  if (getrlimit(RLIMIT_CORE,&core) != 0 || core.rlim_cur != 0 || core.rlim_max != 0) return 0;
#ifdef __linux__
  if (prctl(PR_SET_DUMPABLE, 0) != 0 || prctl(PR_GET_DUMPABLE) != 0) return 0;
#endif
  if (mlock(&sensitive, sizeof sensitive) != 0) return 0;
  locked = 1;
  struct sigaction action;
  memset(&action, 0, sizeof action); action.sa_handler = signal_stop;
  sigemptyset(&action.sa_mask);
  if (sigaction(SIGINT, &action, NULL) || sigaction(SIGTERM, &action, NULL) ||
      sigaction(SIGHUP, &action, NULL)) return 0;
  signal(SIGPIPE, SIG_IGN);
  return 1;
}
static int resolve_ipv4(const char *host, char destination[INET_ADDRSTRLEN]) {
#ifdef JIT_LOCAL_MOCK
  (void)host; strcpy(destination,"127.0.0.1"); return 1;
#else
  struct addrinfo hints, *addresses=NULL;
  memset(&hints,0,sizeof hints); hints.ai_family=AF_INET; hints.ai_socktype=SOCK_STREAM;
  if (getaddrinfo(host,NULL,&hints,&addresses) != 0 || !addresses) return 0;
  struct sockaddr_in *address=(struct sockaddr_in *)addresses->ai_addr;
  int ok=inet_ntop(AF_INET,&address->sin_addr,destination,INET_ADDRSTRLEN) != NULL;
  freeaddrinfo(addresses); return ok;
#endif
}
static int transport_preflight(void) {
  /* Reviewed profiles only: official Noble 16.15 and the existing 17.6 local
   * reference. Version labels alone are insufficient: parse/read back each
   * privacy-critical option without defaults, credentials, service files or I/O. */
  int pq_version=PQlibVersion();
  if (pq_version != 160015 && pq_version != 170006) return 0;
  static const char *required[][2] = {
    {"sslmode","verify-full"}, {"sslcertmode","disable"}, {"gssencmode","disable"},
    {"require_auth","password,scram-sha-256"}, {"passfile","/dev/null"},
    {"sslrootcert","/etc/vaeroex-jit/supabase-root-2021.crt"}, {"hostaddr","127.0.0.1"}
  };
  PQconninfoOption *options=PQconninfoParse("sslmode=verify-full sslcertmode=disable "
    "gssencmode=disable require_auth=password,scram-sha-256 passfile=/dev/null "
    "sslrootcert=/etc/vaeroex-jit/supabase-root-2021.crt hostaddr=127.0.0.1",NULL);
  if (!options) return 0;
  int supported=1;
  for (size_t i=0;i<sizeof required/sizeof required[0];++i) {
    unsigned matches=0;
    for (size_t j=0;j<256 && options[j].keyword;++j)
      if (!strcmp(options[j].keyword,required[i][0]) && options[j].val &&
          !strcmp(options[j].val,required[i][1])) ++matches;
    if (matches != 1) supported=0;
  }
  PQconninfoFree(options);
  if (!supported) return 0;
  if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) return 0;
  curl_initialized=1;
  const curl_version_info_data *version=curl_version_info(CURLVERSION_NOW);
  if (!version || version->version_num < 0x075500 || !(version->features & CURL_VERSION_SSL)) return 0;
  /* DNS is deliberately before token acquisition; subsequent requests use these
   * nonsecret addresses while verifying the exact approved TLS DNS identities. */
  return resolve_ipv4(POOLER,pooler_address) && resolve_ipv4("api.supabase.com",api_address);
}
static int tty_byte(char *out, time_t until) {
  while (alive() && monotonic_now() < until) {
    fd_set reads; FD_ZERO(&reads); FD_SET(tty,&reads);
    struct timeval wait = {0,100000};
    int n = select(tty+1, &reads, NULL, NULL, &wait);
    if (n < 0 && errno != EINTR) return 0;
    if (n > 0 && FD_ISSET(tty,&reads)) {
      ssize_t got = read(tty, out, 1);
      if (got == 1) return 1;
      if (got == 0 || (errno != EINTR && errno != EAGAIN)) return 0;
    }
  }
  return 0;
}
static int read_credential(void) {
  if (!isatty(STDIN_FILENO) || !isatty(STDOUT_FILENO) || !isatty(STDERR_FILENO)) return 0;
  tty = open("/dev/tty", O_RDWR | O_NOCTTY);
  if (tty < 0 || !isatty(tty) || tcgetattr(tty, &saved_tty)) return 0;
  struct termios private_tty = saved_tty;
  private_tty.c_lflag &= (tcflag_t)~(ECHO | ECHONL | ICANON);
  private_tty.c_cc[VMIN] = 1; private_tty.c_cc[VTIME] = 0;
  if (tcsetattr(tty, TCSAFLUSH, &private_tty)) return 0;
  tty_changed = 1;
  puts("private_token_entry"); fflush(stdout);
  size_t count = 0; char ch = 0; int valid = 1;
  time_t until = monotonic_now() + 60;
  while (tty_byte(&ch, until)) {
    if (ch == '\n' || ch == '\r') {
      wipe(&ch, sizeof ch); credential[count] = 0;
      restore_tty();
      return valid && count > 6 && count <= 4096 && !strncmp(credential, "sbp_fc", 6);
    }
    if (count == 4096 || !((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
                           (ch >= '0' && ch <= '9') || ch == '_' || ch == '-')) {
      valid = 0; wipe(&ch, sizeof ch); continue;
    }
    credential[count++] = ch; wipe(&ch, sizeof ch);
  }
  wipe(&ch, sizeof ch); return 0;
}
static int wait_socket(PGconn *connection, short events, time_t until) {
  int fd = PQsocket(connection);
  if (fd < 0) return 0;
  while (alive() && monotonic_now() < until) {
    struct pollfd p = {fd, events, 0};
    int n = poll(&p, 1, 100);
    if (n < 0 && errno != EINTR) return 0;
    if (n > 0 && p.revents & (POLLERR | POLLHUP | POLLNVAL)) return 0;
    if (n > 0 && p.revents & events) return 1;
  }
  return 0;
}
static PGconn *connect_private(void) {
  if (!take_attempt()) return NULL;
  const char *keys[] = {"host", "hostaddr", "port", "dbname", "user", "password", "passfile",
    "sslmode", "sslrootcert", "sslcertmode", "gssencmode", "require_auth", "application_name",
    "connect_timeout", "options", NULL};
  const char *values[] = {POOLER, pooler_address, "5432", "postgres", TRANSPORT_USER, credential, "/dev/null",
    "verify-full", "/etc/vaeroex-jit/supabase-root-2021.crt", "disable", "disable", "password,scram-sha-256",
    "vaeroex-jit-feasibility", "5", "-c jit=true -c search_path=pg_catalog -c statement_timeout=4000 -c lock_timeout=1000", NULL};
  PGconn *c = PQconnectStartParams(keys, values, 0);
  if (!c) return NULL;
  PQsetNoticeProcessor(c, discard_notice, NULL);
  time_t until = monotonic_now() + 5;
  for (;;) {
    PostgresPollingStatusType status = PQconnectPoll(c);
    if (!alive() || monotonic_now() >= until || status == PGRES_POLLING_FAILED) break;
    if (status == PGRES_POLLING_OK) {
      if (PQstatus(c) == CONNECTION_OK && PQsslInUse(c) && !strcmp(PQdb(c), "postgres") &&
          PQsetnonblocking(c, 1) == 0) return c;
      break;
    }
    if (!wait_socket(c, status == PGRES_POLLING_READING ? POLLIN : POLLOUT, until)) break;
  }
  PQfinish(c); return NULL;
}
static PGresult *query(PGconn *c, const char *sql) {
  if (!alive() || !PQsendQuery(c, sql)) return NULL;
  time_t until = monotonic_now() + 5;
  int flush;
  while ((flush = PQflush(c)) == 1) if (!wait_socket(c, POLLOUT, until)) return NULL;
  if (flush < 0) return NULL;
  while (PQisBusy(c)) {
    if (!wait_socket(c, POLLIN, until) || !PQconsumeInput(c)) return NULL;
  }
  PGresult *r = PQgetResult(c);
  while (PQisBusy(c)) {
    if (!wait_socket(c, POLLIN, until) || !PQconsumeInput(c)) { if (r) PQclear(r); return NULL; }
  }
  PGresult *extra = PQgetResult(c);
  if (extra) { PQclear(extra); if (r) PQclear(r); return NULL; }
  return r;
}
static int command(PGconn *c, const char *sql) {
  PGresult *r = query(c, sql);
  int ok = r && PQresultStatus(r) == PGRES_COMMAND_OK;
  if (r) PQclear(r);
  return ok;
}
static int identity(PGconn *c, const char *oid) {
  PGresult *r = query(c, "SELECT session_user::text,current_user::text,current_database(),"
    "oid::text,rolsuper::text,rolcreaterole::text,rolcreatedb::text,rolreplication::text,"
    "rolbypassrls::text,rolinherit::text,rolconnlimit::text,"
    "(SELECT d.oid::text FROM pg_catalog.pg_database d WHERE d.datname=current_database()),"
    "(SELECT count(*)::text FROM pg_catalog.pg_auth_members a WHERE a.member=r.oid) "
    "FROM pg_catalog.pg_roles r WHERE rolname=session_user");
  int ok = r && PQresultStatus(r) == PGRES_TUPLES_OK && PQntuples(r) == 1 && PQnfields(r) == 13;
  if (ok) ok = !strcmp(PQgetvalue(r,0,0),ROLE) && !strcmp(PQgetvalue(r,0,1),ROLE) &&
    !strcmp(PQgetvalue(r,0,2),"postgres") && !strcmp(PQgetvalue(r,0,3),oid);
  for (int i = 4; ok && i < 10; ++i) ok = !strcmp(PQgetvalue(r,0,i),"false");
  if (ok) ok=!strcmp(PQgetvalue(r,0,10),"2") && !strcmp(PQgetvalue(r,0,11),"5") && !strcmp(PQgetvalue(r,0,12),"0");
  if (r) PQclear(r);
  return ok;
}
static int fixture(PGconn *c) {
  PGresult *r = query(c, "SELECT workspace_id::text,marker FROM vaeroex_jit_feasibility.rows ORDER BY workspace_id");
  int ok = r && PQresultStatus(r) == PGRES_TUPLES_OK && PQntuples(r) == 1 && PQnfields(r) == 2 &&
    !strcmp(PQgetvalue(r,0,0), WORKSPACE) && !strcmp(PQgetvalue(r,0,1), "allowed");
  if (r) PQclear(r);
  return ok;
}
static int denied(PGconn *c, const char *sql) {
  if (!command(c, "BEGIN")) return 0;
  /* Measure missing privileges, not the fixture's read-only session default. */
  if (!command(c, "SET TRANSACTION READ WRITE")) return 0;
  PGresult *r = query(c, sql);
  const char *state = r ? PQresultErrorField(r, PG_DIAG_SQLSTATE) : NULL;
  int ok = r && PQresultStatus(r) == PGRES_FATAL_ERROR && state && !strcmp(state,"42501");
  if (r) PQclear(r);
  return command(c, "ROLLBACK") && ok;
}
static int checks(PGconn *c, const char *oid) {
  return identity(c,oid) && fixture(c) && denied(c,"SET ROLE postgres") &&
    denied(c,"SELECT 1 FROM vaeroex_jit_feasibility.denied LIMIT 1") &&
    denied(c,"INSERT INTO vaeroex_jit_feasibility.rows(workspace_id,marker) VALUES ('11111111-1111-4111-8111-111111111111','disallowed')") &&
    denied(c,"UPDATE vaeroex_jit_feasibility.rows SET marker='disallowed' WHERE workspace_id='11111111-1111-4111-8111-111111111111'");
}
struct discard_limit { size_t count, maximum; };
static size_t discard_response(char *bytes,size_t size,size_t count,void *context) {
  (void)bytes;
  struct discard_limit *limit=context;
  if (!alive() || (size && count > limit->maximum/size)) return 0;
  size_t n=size*count;
  if (limit->count > limit->maximum-n) return 0;
  limit->count+=n; return n;
}
static int transfer_progress(void *context,curl_off_t a,curl_off_t b,curl_off_t c,curl_off_t d) {
  (void)context;(void)a;(void)b;(void)c;(void)d;return !alive();
}
static int api_denied(const char *url,int post) {
  if (!alive()) return 0;
  CURL *http=curl_easy_init();
  if (!http) return 0;
  int length=snprintf(sensitive.authorization,sizeof sensitive.authorization,"Authorization: Bearer %s",credential);
  if (length < 0 || (size_t)length >= sizeof sensitive.authorization) {
    curl_easy_cleanup(http);wipe(sensitive.authorization,sizeof sensitive.authorization);return 0;
  }
  struct curl_slist *headers=curl_slist_append(NULL,sensitive.authorization);
  if (!headers) { curl_easy_cleanup(http);wipe(sensitive.authorization,sizeof sensitive.authorization);return 0; }
  size_t header_size=(size_t)length+1;
  int header_locked=mlock(headers->data,header_size)==0;
  int ok=header_locked;
  struct curl_slist *next=curl_slist_append(headers,"Content-Type: application/json");
  if (next) headers=next; else ok=0;
  char resolve[64];
  snprintf(resolve,sizeof resolve,"api.supabase.com:443:%s",api_address);
  struct curl_slist *addresses=curl_slist_append(NULL,resolve);
  if (!addresses) ok=0;
  struct discard_limit body={0,65536}, response_headers={0,16384};
  long status=0;
#define OPTION(option,value) do { if (curl_easy_setopt(http,option,value)!=CURLE_OK) ok=0; } while(0)
  OPTION(CURLOPT_URL,url); OPTION(CURLOPT_HTTPHEADER,headers);
  OPTION(CURLOPT_RESOLVE,addresses); OPTION(CURLOPT_PROXY,"");
  OPTION(CURLOPT_FOLLOWLOCATION,0L); OPTION(CURLOPT_MAXREDIRS,0L);
  OPTION(CURLOPT_SSL_VERIFYPEER,1L); OPTION(CURLOPT_SSL_VERIFYHOST,2L);
  OPTION(CURLOPT_CAINFO,"/etc/ssl/certs/ca-certificates.crt");
  OPTION(CURLOPT_CAPATH,"/etc/ssl/certs");
  OPTION(CURLOPT_PROTOCOLS_STR,"https"); OPTION(CURLOPT_REDIR_PROTOCOLS_STR,"https");
  OPTION(CURLOPT_TIMEOUT_MS,5000L); OPTION(CURLOPT_CONNECTTIMEOUT_MS,3000L);
  OPTION(CURLOPT_NOSIGNAL,1L); OPTION(CURLOPT_VERBOSE,0L);
  OPTION(CURLOPT_FRESH_CONNECT,1L); OPTION(CURLOPT_FORBID_REUSE,1L);
  OPTION(CURLOPT_NETRC,(long)CURL_NETRC_IGNORED);
  OPTION(CURLOPT_WRITEFUNCTION,discard_response); OPTION(CURLOPT_WRITEDATA,&body);
  OPTION(CURLOPT_HEADERFUNCTION,discard_response); OPTION(CURLOPT_HEADERDATA,&response_headers);
  OPTION(CURLOPT_NOPROGRESS,0L); OPTION(CURLOPT_XFERINFOFUNCTION,transfer_progress);
  if (post) {
    OPTION(CURLOPT_POST,1L); OPTION(CURLOPT_POSTFIELDS,"{\"query\":\"SELECT 1\"}");
  }
  if (ok) ok=curl_easy_perform(http)==CURLE_OK && alive() &&
    curl_easy_getinfo(http,CURLINFO_RESPONSE_CODE,&status)==CURLE_OK && status==403;
  curl_easy_cleanup(http);
  /* HTTPHEADER storage remains owned by the caller and alive through cleanup. */
  wipe(headers->data,header_size);
#ifdef JIT_LOCAL_MOCK
  jit_mock_verify_wipe(headers->data,header_size);
#endif
  if (header_locked) munlock(headers->data,header_size);
  curl_slist_free_all(headers);curl_slist_free_all(addresses);
  wipe(sensitive.authorization,sizeof sensitive.authorization);
  return ok;
#undef OPTION
}
int main(int argc, char **argv) {
#ifdef JIT_LOCAL_MOCK
  jit_local_mock_link_required();
#elif !defined(__linux__)
  (void)argc;(void)argv;return finish("unsupported_host",78);
#endif
  if (argc != 3 || (strcmp(argv[1], "probe") && strcmp(argv[1], "observe"))) return finish("arguments_rejected",64);
  size_t n = strlen(argv[2]);
  if (n == 0 || n > 10 || argv[2][0] == '0') return finish("arguments_rejected",64);
  for (size_t i=0;i<n;++i) if (argv[2][i] < '0' || argv[2][i] > '9') return finish("arguments_rejected",64);
  if (!private_environment()) return finish("environment_rejected",64);
  deadline = monotonic_now() + 1800;
  if (!harden()) return finish("privacy_preflight_failed",70);
  if (!transport_preflight()) return finish("transport_preflight_failed",70);
  if (!read_credential()) return finish(interrupted ? "cancelled" : "private_input_rejected",65);
  held = connect_private();
  if (!held) return finish("connection_rejected",69);
  if (!checks(held,argv[2])) return finish("scope_assertion_failed",1);
  if (!api_denied("https://api.supabase.com/v1/projects/oysjpoondtcrqpghhrbd",0) ||
      !api_denied("https://api.supabase.com/v1/projects/oysjpoondtcrqpghhrbd/database/query",1))
    return finish(interrupted ? "cancelled" : "api_scope_failed",1);
  puts("api_scope_pass");fflush(stdout);
  puts("initial_scope_pass"); fflush(stdout);
  fresh = connect_private();
  if (!fresh || !checks(fresh,argv[2])) return finish("reconnection_failed",1);
  PQfinish(fresh); fresh = NULL;
  puts("reconnection_pass"); fflush(stdout);
  if (!strcmp(argv[1],"probe")) return finish("probe_pass",0);
  puts("observe_ready_r_reconnect_n_replace_s_existing_q_quit"); fflush(stdout);
  while (alive()) {
    char cue = 0;
    if (!tty_byte(&cue,deadline)) break;
    if (cue == 'q') return finish("observation_complete",0);
    if (cue == 'r' || cue == 'n') {
      fresh = connect_private();
      if (attempt_budget_exhausted) return finish("attempt_budget_exhausted",75);
      if (fresh && !identity(fresh,argv[2])) return finish("identity_changed",1);
      if (cue == 'n' && fresh) {
        if (!checks(fresh,argv[2])) return finish("scope_assertion_failed",1);
        PQfinish(held);held=fresh;fresh=NULL;
        puts("held_session_replaced");fflush(stdout);continue;
      }
      puts(fresh ? "new_session_accepted" : "new_session_rejected");
      if (fresh) { PQfinish(fresh); fresh = NULL; }
    } else if (cue == 's') {
      if (!take_attempt()) return finish("attempt_budget_exhausted",75);
      puts(identity(held,argv[2]) && fixture(held) ? "existing_session_usable" : "existing_session_unusable");
    }
    else if (cue != '\n' && cue != '\r') return finish("cue_rejected",64);
    fflush(stdout);
  }
  return finish(interrupted ? "cancelled" : "window_expired",75);
}
#endif
