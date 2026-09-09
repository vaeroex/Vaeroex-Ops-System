/* Offline profile/loader-namespace boundary tests. Actual libpq result objects,
 * fixed in-memory observations; no connection or credential is ever created. */
#define _POSIX_C_SOURCE 200809L
/* glibc normalizes this to 1 before native.c is included below. Use the same
 * definition so -Werror also permits the real Linux translation unit. */
#define _DEFAULT_SOURCE 1
#define _DARWIN_C_SOURCE
#include <assert.h>
#include <libpq-fe.h>
#include <stdio.h>
#include <string.h>
static PGresult *observed_query(PGconn *,const char *,int,const Oid *,const char *const *,const int *,const int *,int);
static PGresult *observed_command(PGconn *,const char *);
#define PQexecParams observed_query
#define PQexec observed_command
#define main unexecuted_native_main
#define VAEROEX_SYNTHETIC_ONLY
#define VAEROEX_MANAGED_PROFILE_TEST
#include "../native.c"
#undef main
#undef PQexec
#undef PQexecParams

static const char *shared_names="pg_stat_statements,pgaudit,plpgsql,plpgsql_check,pg_cron,pg_net,pgsodium,auto_explain,pg_tle,plan_filter,supabase_vault";
static const char *session_names="supautils", *local_names="", *statistics_version="1.11";
static bool drift, denied_set;
static unsigned sets;
static PGresult *row(const char *const *values,int count) {
  PGresult *result=PQmakeEmptyPGresult(NULL,PGRES_TUPLES_OK);
  PGresAttDesc attributes[4]={{0}};
  assert(result && count<=4);
  for(int i=0;i<count;i++){attributes[i].name="observation";attributes[i].typid=25;attributes[i].typlen=-1;}
  assert(PQsetResultAttrs(result,count,attributes));
  /* libpq's legacy signature is non-const; PQsetvalue copies this input. */
  for(int i=0;i<count;i++)assert(PQsetvalue(result,0,i,(char *)values[i],(int)strlen(values[i])));
  assert(PQresultStatus(result)==PGRES_TUPLES_OK && PQntuples(result)==1 && PQnfields(result)==count);
  assert(!strcmp(PQgetvalue(result,0,0),values[0]));
  return result;
}
static PGresult *observed_query(PGconn *connection,const char *sql,int count,const Oid *types,
                                const char *const *values,const int *lengths,const int *formats,int format) {
  (void)connection;assert(!types && !lengths && !formats && !format);
  if(!strcmp(sql,"SELECT current_setting($1) = $2")) {
    assert(count==2 && strcmp(values[0],"track_activities"));
    const char *out[]={drift && !strcmp(values[0],"log_statement")?"f":"t"};
    return row(out,1);
  }
  if(!strcmp(sql,"SELECT current_setting('track_activities') IN ('on','off')")) {
    assert(!count);const char *out[]={"t"};return row(out,1);
  }
  assert(!count && strstr(sql,"SELECT current_setting('shared_preload_libraries')"));
  const char *out[]={shared_names,statistics_version,session_names,local_names};
  return row(out,4);
}
static PGresult *observed_command(PGconn *connection,const char *sql) {
  (void)connection;assert(!strcmp(sql,"SET log_statement = 'none'"));++sets;
  if(denied_set)return PQmakeEmptyPGresult(NULL,PGRES_FATAL_ERROR);
  drift=false;return PQmakeEmptyPGresult(NULL,PGRES_COMMAND_OK);
}
int main(void) {
  unsigned checks=0;
  assert(profile() && !sets);++checks;
  drift=true;assert(profile() && sets==1 && !drift);++checks;
  drift=true;denied_set=true;assert(!profile() && sets==2);++checks;
  drift=false;denied_set=false;
  const char *baseline=shared_names;
  shared_names="pg_stat_statements,pgaudit,unexpected_hook";assert(!profile());++checks;
  shared_names="pg_stat_statements,/unapproved/pgaudit";assert(!profile());++checks;
  shared_names="pg_stat_statements,$libdir/../unapproved/pgaudit";assert(!profile());++checks;
  shared_names="pg_stat_statements,$libdir/pgaudit";assert(profile());++checks;
  shared_names="pg_stat_statements";session_names="pgaudit,supautils";assert(!profile());++checks;
  shared_names="pgaudit";session_names="pg_stat_statements,supautils";assert(!profile());++checks;
  shared_names=baseline;session_names="";assert(!profile());++checks;
  session_names="supautils";local_names="supautils";assert(!profile());++checks;
  local_names="";statistics_version="1.10";assert(!profile());++checks;
  printf("%u managed profile observations PASS; no connections or credentials\n",checks);
  return 0;
}
