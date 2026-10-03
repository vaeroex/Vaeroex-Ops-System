/* No sockets, database, HTTP client, DNS, credential files or remote services.
 * Link-boundary fixture only; this is not a PostgreSQL authentication server. */
#define _POSIX_C_SOURCE 200809L
#include <libpq-fe.h>
#include <assert.h>
#include <stdlib.h>
#include <string.h>

struct pg_conn { int number, consumed; PQnoticeProcessor notice; void *arg; char *sql; char secret[4097]; };
struct pg_result { ExecStatusType status; int fields, rows; const char *values[13]; };
static int connections, open_connections;
static const char *scenario(void) { const char *s=getenv("JIT_MOCK_CASE"); return s ? s : "success"; }
static int is(const char *s) { return !strcmp(scenario(),s); }
void jit_local_mock_link_required(void) { }
void jit_mock_verify_wipe(const void *p,size_t n) { const unsigned char *q=p; while(n--) assert(*q++ == 0); }
int PQlibVersion(void) {
  if(is("pq1615")||is("pq_missing_sslcertmode")||is("pq_missing_auth")||is("pq_wrong_auth")||is("pq_parse_failure"))return 160015;
  if(is("pq1614"))return 160014;
  if(is("pq1519"))return 150019;
  if(is("pq1806"))return 180006;
  return 170006;
}
PQconninfoOption *PQconninfoParse(const char *input,char **error) {
  assert(error==NULL);assert(connections==0);assert(!strstr(input,"password="));
  assert(!strstr(input,"service=")&&!strstr(input,"sslkey="));
  assert(strstr(input,"require_auth=password,scram-sha-256"));
  if(is("pq_parse_failure"))return NULL;
  const char *keys[]={"sslmode","sslcertmode","gssencmode","require_auth","passfile","sslrootcert","hostaddr"};
  assert(strstr(input,"sslrootcert=/etc/vaeroex-jit/supabase-root-2021.crt"));
  const char *values[]={"verify-full","disable","disable","password,scram-sha-256","/dev/null","/etc/vaeroex-jit/supabase-root-2021.crt","127.0.0.1"};
  PQconninfoOption *options=calloc(8,sizeof *options);assert(options);
  for(int i=0;i<7;++i){options[i].keyword=strdup(keys[i]);options[i].val=strdup(values[i]);assert(options[i].keyword&&options[i].val);}
  if(is("pq_missing_sslcertmode")){free(options[1].val);options[1].val=NULL;}
  if(is("pq_missing_auth")){free(options[3].val);options[3].val=NULL;}
  if(is("pq_wrong_auth")){free(options[3].val);options[3].val=strdup("gss");}
  return options;
}
void PQconninfoFree(PQconninfoOption *options) {
  for(int i=0;options[i].keyword;++i){free(options[i].keyword);free(options[i].val);}free(options);
}
PGconn *PQconnectStartParams(const char *const *keys,const char *const *values,int expand) {
  assert(expand == 0); assert(open_connections < 2);
  PGconn *c=calloc(1,sizeof *c); assert(c); c->number=++connections; ++open_connections;
  int host=0, tls=0, pass=0, file=0, ca=0;
  for(int i=0;keys[i];++i) {
    if(!strcmp(keys[i],"host")) { assert(!strcmp(values[i],"aws-0-us-west-2.pooler.supabase.com")); host=1; }
    if(!strcmp(keys[i],"hostaddr")) assert(!strcmp(values[i],"127.0.0.1"));
    if(!strcmp(keys[i],"user")) assert(!strcmp(values[i],"vaeroex_jit_feasibility_20260908.oysjpoondtcrqpghhrbd"));
    if(!strcmp(keys[i],"options")) assert(strstr(values[i],"-c jit=true") && strstr(values[i],"-c search_path=pg_catalog"));
    if(!strcmp(keys[i],"require_auth"))assert(!strcmp(values[i],"password,scram-sha-256"));
    if(!strcmp(keys[i],"sslmode")) { assert(!strcmp(values[i],"verify-full")); tls=1; }
    if(!strcmp(keys[i],"sslrootcert")) { assert(!strcmp(values[i],"/etc/vaeroex-jit/supabase-root-2021.crt")); ca=1; }
    if(!strcmp(keys[i],"passfile")) { assert(!strcmp(values[i],"/dev/null")); file=1; }
    if(!strcmp(keys[i],"password")) { assert(strlen(values[i])<=4096); strcpy(c->secret,values[i]); pass=1; }
  }
  assert(host&&tls&&pass&&file&&ca); return c;
}
PQnoticeProcessor PQsetNoticeProcessor(PGconn *c,PQnoticeProcessor p,void *arg) {
  c->notice=p;c->arg=arg; p(arg,c->secret); return NULL;
}
PostgresPollingStatusType PQconnectPoll(PGconn *c) {
  if(is("connection_failure") || is("tls_mismatch") || is("unsupported_auth_method") || (is("reconnect_failure")&&c->number>1) ||
    ((is("revoked")||is("fenced"))&&c->number>2)) return PGRES_POLLING_FAILED;
  return PGRES_POLLING_OK;
}
ConnStatusType PQstatus(const PGconn *c) { (void)c; return CONNECTION_OK; }
int PQsslInUse(PGconn *c) { (void)c; return !is("tls_absent"); }
char *PQdb(const PGconn *c) { (void)c; return "postgres"; }
int PQsetnonblocking(PGconn *c,int n) { (void)c;assert(n==1);return 0; }
int PQsocket(const PGconn *c) { (void)c;return -1; }
int PQsendQuery(PGconn *c,const char *q) {
  assert(!strstr(q,c->secret)); assert(!strstr(q,"PASSWORD"));
  free(c->sql);c->sql=strdup(q);assert(c->sql);c->consumed=0;
  if(c->notice)c->notice(c->arg,c->secret);
  return 1;
}
int PQflush(PGconn *c) { (void)c;return 0; }
int PQisBusy(PGconn *c) { (void)c;return 0; }
int PQconsumeInput(PGconn *c) { (void)c;return 1; }
PGresult *PQgetResult(PGconn *c) {
  if(c->consumed++)return NULL;
  PGresult *r=calloc(1,sizeof *r); assert(r);
  if(is("fenced")&&connections>2) { r->status=PGRES_FATAL_ERROR;return r; }
  if(!strncmp(c->sql,"SELECT session_user",19)) {
    r->status=PGRES_TUPLES_OK;r->fields=13;r->rows=1;
    r->values[0]=is("wrong_identity")?"postgres":"vaeroex_jit_feasibility_20260908";
    r->values[1]="vaeroex_jit_feasibility_20260908";r->values[2]="postgres";r->values[3]="12345";
    for(int i=4;i<10;++i)r->values[i]="false";
    r->values[10]="2";r->values[11]=is("wrong_database")?"6":"5";
    r->values[12]=is("unexpected_membership")?"1":"0";
  } else if(!strncmp(c->sql,"SELECT workspace_id",19)) {
    r->status=PGRES_TUPLES_OK;r->fields=2;r->rows=1;
    r->values[0]="11111111-1111-4111-8111-111111111111";
    r->values[1]=is("row_leak")?"denied":"allowed";
  } else if(!strcmp(c->sql,"BEGIN")||!strcmp(c->sql,"ROLLBACK")||!strcmp(c->sql,"SET TRANSACTION READ WRITE")) {
    r->status=PGRES_COMMAND_OK;
  } else { r->status=is("excess_privilege")?PGRES_COMMAND_OK:PGRES_FATAL_ERROR; }
  return r;
}
ExecStatusType PQresultStatus(const PGresult *r) { return r->status; }
int PQntuples(const PGresult *r) { return r->rows; }
int PQnfields(const PGresult *r) { return r->fields; }
char *PQgetvalue(const PGresult *r,int row,int field) { assert(row==0&&field<r->fields);return (char*)r->values[field]; }
char *PQresultErrorField(const PGresult *r,int field) { (void)r;assert(field==PG_DIAG_SQLSTATE);return "42501"; }
void PQclear(PGresult *r) { free(r); }
void PQfinish(PGconn *c) {
  volatile unsigned char *p=(unsigned char*)c->secret; for(size_t i=0;i<sizeof c->secret;++i)p[i]=0;
  free(c->sql);free(c);--open_connections;assert(open_connections>=0);
}
