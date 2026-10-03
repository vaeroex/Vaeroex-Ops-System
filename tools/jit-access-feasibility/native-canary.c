#define _POSIX_C_SOURCE 200809L
/* A public invalid marker, never a PAT. No credential input and no SQL/API calls. */
#include <stdio.h>
#if defined(JIT_CANARY_APPROVED_SANDBOX_20260908) && defined(JIT_CANARY_LOCAL_PROTOCOL)
#error incompatible_canary_profiles
#endif
#if !defined(JIT_CANARY_APPROVED_SANDBOX_20260908) && !defined(JIT_CANARY_LOCAL_PROTOCOL)
int main(void) { puts("native_canary_hosted_execution_blocked"); return 78; }
#else
#include <libpq-fe.h>
#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <netdb.h>
#include <poll.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/prctl.h>
#endif
#ifdef JIT_CANARY_LOCAL_PROTOCOL
#ifndef JIT_CANARY_LOCAL_PORT
#error local_protocol_requires_compile_time_port
#endif
#ifndef JIT_CANARY_LOCAL_CA
#error local_protocol_requires_compile_time_public_ca
#endif
#define CANARY_PORT JIT_CANARY_LOCAL_PORT
#define CANARY_CA JIT_CANARY_LOCAL_CA
#define CANARY_ATTEMPT_SECONDS 2
#else
#define CANARY_PORT "5432"
#define CANARY_CA "/etc/vaeroex-jit/supabase-root-2021.crt"
#define CANARY_ATTEMPT_SECONDS 7
#endif
static const char HOST[]="aws-0-us-west-2.pooler.supabase.com";
static const char NEGATIVE_NAME[]="vaeroex-jit-tls-negative.invalid";
static const char USER[]="vaeroex_jit_feasibility_20260908.oysjpoondtcrqpghhrbd";
static const char PUBLIC_INVALID[]="sbp_fcPUBLIC_INVALID_CANARY_20260908_NEVER_ISSUED";
static volatile sig_atomic_t stopped;
static volatile sig_atomic_t negative_started;
extern char **environ;

static void interrupt(int value) { (void)value; stopped=1; }
static void absolute_timeout(int value) {
  (void)value;
  static const char label[]="native_canary_window_exhausted\n";
  ssize_t written=write(STDOUT_FILENO,label,sizeof label-1);
  (void)written;
  static const char unknown[]="native_canary_current_attempt_observations=unknown\n";
  written=write(STDOUT_FILENO,unknown,sizeof unknown-1);
  (void)written;
  static const char ran[]="native_canary_hostname_negative_ran=yes\n";
  static const char skipped[]="native_canary_hostname_negative_ran=no\n";
  written=negative_started ? write(STDOUT_FILENO,ran,sizeof ran-1)
    : write(STDOUT_FILENO,skipped,sizeof skipped-1);
  (void)written;
  _exit(75);
}
static time_t now(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC,&t)) { stopped=1; return 0; }
  return t.tv_sec;
}
static int clean_environment(void) {
  /* This is a check, not protection against an injected loader before main. */
  for (char **p=environ;*p;++p) {
    const char *eq=strchr(*p,'=');
    if (!eq) return 0;
    size_t n=(size_t)(eq-*p);
    if (!((n==4&&!strncmp(*p,"PATH",4)) ||
          (n==4&&!strncmp(*p,"LANG",4)) ||
          (n==6&&!strncmp(*p,"LC_ALL",6)))) return 0;
    if (n==4&&!strncmp(*p,"PATH",4)&&strcmp(eq+1,"/usr/bin:/bin")) return 0;
    if ((n==4&&!strncmp(*p,"LANG",4)) || (n==6&&!strncmp(*p,"LC_ALL",6)))
      if (strcmp(eq+1,"C")) return 0;
  }
  return 1;
}
static int harden(void) {
  struct rlimit limit={0,0};
  if (setrlimit(RLIMIT_CORE,&limit)||getrlimit(RLIMIT_CORE,&limit)||
      limit.rlim_cur||limit.rlim_max) return 0;
#ifdef __linux__
  if (prctl(PR_SET_DUMPABLE,0)||prctl(PR_GET_DUMPABLE)!=0) return 0;
#endif
  struct sigaction a;
  memset(&a,0,sizeof a); sigemptyset(&a.sa_mask); a.sa_handler=interrupt;
  if (sigaction(SIGINT,&a,NULL)||sigaction(SIGTERM,&a,NULL)||sigaction(SIGHUP,&a,NULL)) return 0;
  a.sa_handler=absolute_timeout;
  if (sigaction(SIGALRM,&a,NULL)) return 0;
  signal(SIGPIPE,SIG_IGN);
  alarm(20); /* Includes DNS; no credential or query needs recovery on timeout. */
  return 1;
}
static int capabilities(void) {
  int v=PQlibVersion();
  if (v!=160015&&v!=170006) return 0;
  static const char *required[][2]={
    {"sslmode","verify-full"},{"sslcertmode","disable"},{"gssencmode","disable"},
    {"require_auth","password,scram-sha-256"},{"passfile","/dev/null"},
    {"hostaddr","127.0.0.1"},{"sslrootcert",CANARY_CA}
  };
  const char *fixed="sslmode=verify-full sslcertmode=disable gssencmode=disable "
    "require_auth=password,scram-sha-256 passfile=/dev/null hostaddr=127.0.0.1 "
    "sslrootcert='" CANARY_CA "'";
  PQconninfoOption *o=PQconninfoParse(fixed,NULL);
  if (!o) return 0;
  int ok=1;
  for (size_t i=0;i<sizeof required/sizeof required[0];++i) {
    unsigned matches=0;
    for (size_t j=0;j<256&&o[j].keyword;++j)
      if (!strcmp(o[j].keyword,required[i][0])&&o[j].val&&!strcmp(o[j].val,required[i][1])) ++matches;
    if (matches!=1) ok=0;
  }
  PQconninfoFree(o);
  return ok;
}
static int resolve(char address[INET_ADDRSTRLEN]) {
#ifdef JIT_CANARY_LOCAL_PROTOCOL
  strcpy(address,"127.0.0.1");
  return 1;
#else
  struct addrinfo hints,*list=NULL;
  memset(&hints,0,sizeof hints); hints.ai_family=AF_INET; hints.ai_socktype=SOCK_STREAM;
  if (getaddrinfo(HOST,NULL,&hints,&list)||!list) return 0;
  const struct sockaddr_in *first=(const struct sockaddr_in *)list->ai_addr;
  uint32_t ip=ntohl(first->sin_addr.s_addr);
  /* Reject common nonpublic DNS destinations; TLS still authenticates HOST. */
  int routable=(ip>>24)!=0&&(ip>>24)!=10&&(ip>>24)!=127&&
    (ip>>16)!=0xa9fe&&(ip>>20)!=0xac1&&(ip>>16)!=0xc0a8&&
    (ip>>22)!=0x191&&(ip>>28)<14;
  int ok=routable&&inet_ntop(AF_INET,&first->sin_addr,address,INET_ADDRSTRLEN)!=NULL;
  freeaddrinfo(list);
  return ok;
#endif
}
static void notice(void *arg,const char *message) { (void)arg; (void)message; }
static int suffix(const char *text,const char *tail) {
  if (!text) return 0;
  size_t n=strnlen(text,16385),m=strlen(tail);
  return n<=16384&&n>=m&&!memcmp(text+n-m,tail,m);
}
static int contains_bounded(const char *text,const char *phrase) {
  if (!text||strnlen(text,16385)>16384) return 0;
  return strstr(text,phrase)!=NULL;
}
/* All output values are source-defined. Neither server text nor an arbitrary
 * SQLSTATE is ever printed. A false instantaneous TLS observation cannot prove
 * that TLS never existed: retain a positive seen during polling, else unknown. */
typedef enum { OBS_UNKNOWN, OBS_NO, OBS_YES } observation;
typedef enum { END_UNKNOWN, END_CONNECT_FAILED, END_AUTHENTICATED, END_TIMEOUT,
  END_CANCELLED, END_IO_FAILED, END_SOCKET_UNAVAILABLE, END_ALLOCATION_FAILED } completion;
typedef enum { POLL_NOT_POLLED, POLL_READING, POLL_WRITING, POLL_ACTIVE,
  POLL_FAILED, POLL_OK, POLL_UNKNOWN } polling;
typedef enum { HINT_UNKNOWN, HINT_PASSWORD, HINT_AUTHORIZATION, HINT_INTERNAL,
  HINT_UNCLASSIFIED } rejection_hint;
typedef struct {
  completion end;
  polling poll;
  observation timeout,tls,password,expected_hint,hostname_mismatch;
  rejection_hint hint;
} attempt_observations;

static polling poll_observation(PostgresPollingStatusType state) {
  switch (state) {
    case PGRES_POLLING_READING: return POLL_READING;
    case PGRES_POLLING_WRITING: return POLL_WRITING;
    case PGRES_POLLING_ACTIVE: return POLL_ACTIVE;
    case PGRES_POLLING_FAILED: return POLL_FAILED;
    case PGRES_POLLING_OK: return POLL_OK;
    default: return POLL_UNKNOWN;
  }
}
static void sample(PGconn *c,attempt_observations *o) {
  if (PQsslInUse(c)) o->tls=OBS_YES;
  /* Documented for failed as well as successful connections. */
  o->password=PQconnectionUsedPassword(c) ? OBS_YES : OBS_NO;
}
static void failure_hints(PGconn *c,attempt_observations *o) {
  const char *error=PQerrorMessage(c);
  if (!error||!error[0]||strnlen(error,16385)>16384) return;
  /* The public API has no structured connect-error SQLSTATE accessor. Even
   * these bounded suffix matches are hints, including malformed lookalikes. */
  o->hint=suffix(error,":  28P01\n") ? HINT_PASSWORD :
    suffix(error,":  28000\n") ? HINT_AUTHORIZATION :
    suffix(error,":  XX000\n") ? HINT_INTERNAL : HINT_UNCLASSIFIED;
  o->expected_hint=o->hint==HINT_PASSWORD ? OBS_YES : OBS_NO;
  o->hostname_mismatch=contains_bounded(error,"does not match host name") ? OBS_YES : OBS_NO;
}
static void report(const char *phase,const attempt_observations *o) {
  static const char *const endings[]={"unknown","connect_failed","authenticated","timeout",
    "cancelled","io_failed","socket_unavailable","allocation_failed"};
  static const char *const polls[]={"not_polled","reading","writing","active","failed","ok","unknown"};
  static const char *const flags[]={"unknown","no","yes"};
  static const char *const hints[]={"unknown","28P01","28000","XX000","unclassified"};
  printf("native_canary_%s_completion=%s\n",phase,endings[o->end]);
  printf("native_canary_%s_polling=%s\n",phase,polls[o->poll]);
  printf("native_canary_%s_timeout=%s\n",phase,flags[o->timeout]);
  printf("native_canary_%s_tls_observed=%s\n",phase,flags[o->tls]);
  printf("native_canary_%s_password_used=%s\n",phase,flags[o->password]);
  printf("native_canary_%s_rejection_hint=%s\n",phase,hints[o->hint]);
  printf("native_canary_%s_expected_rejection_hint=%s\n",phase,flags[o->expected_hint]);
  printf("native_canary_%s_hostname_mismatch_hint=%s\n",phase,flags[o->hostname_mismatch]);
  fflush(stdout);
}
static attempt_observations attempt(const char *address,int negative) {
  attempt_observations o={.end=END_UNKNOWN,.poll=POLL_NOT_POLLED,.timeout=OBS_UNKNOWN};
  if (negative) negative_started=1;
  const char *keys[]={"host","hostaddr","port","dbname","user","password","passfile",
    "sslmode","sslrootcert","sslcertmode","gssencmode","require_auth","options",
    "connect_timeout","application_name",NULL};
  const char *values[]={negative?NEGATIVE_NAME:HOST,address,CANARY_PORT,"postgres",USER,
    PUBLIC_INVALID,"/dev/null","verify-full",CANARY_CA,"disable","disable",
    "password,scram-sha-256","-c jit=true -c search_path=pg_catalog","5",
    "vaeroex_public_invalid_jit_canary",NULL};
  time_t until=now()+CANARY_ATTEMPT_SECONDS;
  PGconn *c=PQconnectStartParams(keys,values,0);
  if (!c) { o.end=END_ALLOCATION_FAILED; return o; }
  PQsetNoticeProcessor(c,notice,NULL);
  PQsetErrorVerbosity(c,PQERRORS_SQLSTATE);
  sample(c,&o);
  PostgresPollingStatusType state=PGRES_POLLING_WRITING;
  while (!stopped&&now()<until&&PQstatus(c)!=CONNECTION_BAD) {
    int fd=PQsocket(c);
    if (fd<0) { o.end=END_SOCKET_UNAVAILABLE; break; }
    struct pollfd socket={fd,state==PGRES_POLLING_READING?POLLIN:POLLOUT,0};
    int ready=poll(&socket,1,100);
    if (ready<0&&errno!=EINTR) { o.end=END_IO_FAILED; break; }
    if (ready<=0) continue;
    if (socket.revents&POLLNVAL) { o.end=END_IO_FAILED; break; }
    state=PQconnectPoll(c);
    o.poll=poll_observation(state);
    sample(c,&o);
    if (state==PGRES_POLLING_OK||state==PGRES_POLLING_FAILED) break;
  }
  sample(c,&o);
  if (stopped) o.end=END_CANCELLED;
  else if (now()>=until) { o.end=END_TIMEOUT; o.timeout=OBS_YES; }
  else {
    o.timeout=OBS_NO;
    if (o.end==END_UNKNOWN) {
      if (PQstatus(c)==CONNECTION_OK) o.end=END_AUTHENTICATED;
      else if (state==PGRES_POLLING_FAILED||PQstatus(c)==CONNECTION_BAD) o.end=END_CONNECT_FAILED;
    }
  }
  if (o.end==END_CONNECT_FAILED) failure_hints(c,&o);
  PQfinish(c);
  return o;
}
int main(int argc,char **argv) {
  (void)argv;
#if defined(JIT_CANARY_APPROVED_SANDBOX_20260908) && !defined(__linux__)
  (void)argc; puts("native_canary_unsupported_host"); return 78;
#endif
  if (argc!=1) { puts("native_canary_arguments_rejected"); return 64; }
  if (!clean_environment()) { puts("native_canary_environment_rejected"); return 64; }
  if (!harden()) { puts("native_canary_privacy_preflight_failed"); return 70; }
  if (!capabilities()) { puts("native_canary_capability_failed"); return 70; }
  char address[INET_ADDRSTRLEN];
  if (!resolve(address)) { puts("native_canary_dns_failed"); return 70; }
  attempt_observations positive=attempt(address,0);
  report("primary",&positive);
  int observed=positive.end==END_CONNECT_FAILED&&positive.poll==POLL_FAILED&&
    positive.tls==OBS_YES&&positive.password==OBS_YES&&positive.expected_hint==OBS_YES;
  if (observed) puts("native_canary_verified_tls_password_exchange_failure_28P01_hint");
  int negative_ok=0;
  /* An independent TLS-name diagnostic is useful even when the first rejection
   * has another hint. This does not turn that rejection into an auth pass. */
  if (!stopped&&positive.end==END_CONNECT_FAILED&&positive.tls==OBS_YES) {
    attempt_observations negative=attempt(address,1);
    report("hostname_negative",&negative);
    negative_ok=negative.end==END_CONNECT_FAILED&&negative.password==OBS_NO&&
      negative.hostname_mismatch==OBS_YES;
  }
  puts(negative_started ? "native_canary_hostname_negative_ran=yes" :
    "native_canary_hostname_negative_ran=no");
  if (stopped) { puts("native_canary_cancelled"); return 75; }
  if (positive.end==END_AUTHENTICATED) { puts("native_canary_unexpected_authentication"); return 1; }
  if (!observed) { puts("native_canary_auth_rejection_inconclusive"); return 1; }
  if (!negative_ok) { puts("native_canary_tls_negative_inconclusive"); return 1; }
  puts("native_canary_tls_name_rejection_before_password");
  puts("native_canary_transport_observed_diagnostics_pending");
  return 0;
}
#endif
