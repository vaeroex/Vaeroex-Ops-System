#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#if defined(JIT_ADMIN_APPROVED_SANDBOX_20260909) && defined(JIT_ADMIN_LOCAL_MOCK)
#error incompatible_admin_profiles
#endif
#if !defined(JIT_ADMIN_APPROVED_SANDBOX_20260909) && !defined(JIT_ADMIN_LOCAL_MOCK)
int main(void) { puts("jit_admin_hosted_execution_blocked"); return 78; }
#else
#include <curl/curl.h>
#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/select.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/prctl.h>
#endif
#ifdef JIT_ADMIN_LOCAL_MOCK
extern void jit_admin_mock_link_required(void);
extern void jit_admin_mock_wipe(const void *,size_t);
extern time_t jit_admin_mock_wall(void);
#endif
#define BASE "https://api.supabase.com/v1/projects/oysjpoondtcrqpghhrbd/database/jit"
#define EMAIL "isaac+vaeroex-jit-feasibility@vaeroex.com"
#define ROLE "vaeroex_jit_feasibility_20260908"
#define CIDR "8.229.223.109/32"
static struct { char token[4097],header[4140],response[16385]; } private_memory;
static volatile sig_atomic_t interrupted;
enum { PRIVATE_ENTRY_SECONDS = 300 };
static int input_timed_out;
static int tty=-1,tty_changed,locked,curl_initialized,uncertain,owned,stage;
static struct termios saved_tty;
static time_t deadline,window_end,expected_expiry;
static unsigned requests;
static char address[INET_ADDRSTRLEN],invite_id[37],user_id[37];
extern char **environ;
static time_t wall(void) {
#ifdef JIT_ADMIN_LOCAL_MOCK
  return jit_admin_mock_wall();
#else
  return time(NULL);
#endif
}
static time_t monotonic_now(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC,&t)) { interrupted=1; return 0; }
  return t.tv_sec;
}
static int alive(void) { return !interrupted&&monotonic_now()<deadline; }
static void stop(int sig) { (void)sig; interrupted=1; }
static void wipe(void *v,size_t n) { volatile unsigned char *p=v;while(n--)*p++=0; }
static void restore(void) { if(tty_changed){tcsetattr(tty,TCSAFLUSH,&saved_tty);tty_changed=0;} }
static int finish(const char *label,int code) {
  restore(); if(curl_initialized)curl_global_cleanup();
  wipe(&private_memory,sizeof private_memory);
#ifdef JIT_ADMIN_LOCAL_MOCK
  jit_admin_mock_wipe(&private_memory,sizeof private_memory);
#endif
  if(locked)munlock(&private_memory,sizeof private_memory);
  if(tty>=0)close(tty);
  puts(label);return code;
}
static int environment(void) {
  for(char **p=environ;*p;++p){
    const char *eq=strchr(*p,'=');if(!eq)return 0;size_t n=(size_t)(eq-*p);
#ifdef JIT_ADMIN_LOCAL_MOCK
    if(n==19&&!strncmp(*p,"JIT_ADMIN_MOCK_CASE",19))continue;
#endif
    if(n==4&&!strncmp(*p,"PATH",4)&&!strcmp(eq+1,"/usr/bin:/bin"))continue;
    if(((n==4&&!strncmp(*p,"LANG",4))||(n==6&&!strncmp(*p,"LC_ALL",6)))&&!strcmp(eq+1,"C"))continue;
    return 0;
  }return 1;
}
static int harden(void) {
  struct rlimit r={0,0};
  if(setrlimit(RLIMIT_CORE,&r)||getrlimit(RLIMIT_CORE,&r)||r.rlim_cur||r.rlim_max)return 0;
#ifdef __linux__
  if(prctl(PR_SET_DUMPABLE,0)||prctl(PR_GET_DUMPABLE)!=0)return 0;
#endif
  if(mlock(&private_memory,sizeof private_memory))return 0;
  locked=1;
  struct sigaction a;memset(&a,0,sizeof a);sigemptyset(&a.sa_mask);a.sa_handler=stop;
  if(sigaction(SIGINT,&a,NULL)||sigaction(SIGTERM,&a,NULL)||sigaction(SIGHUP,&a,NULL))return 0;
  signal(SIGPIPE,SIG_IGN);return 1;
}
static int transport_preflight(void) {
  if(curl_global_init(CURL_GLOBAL_DEFAULT)!=CURLE_OK)return 0;
  curl_initialized=1;
  const curl_version_info_data *v=curl_version_info(CURLVERSION_NOW);
  if(!v||v->version_num<0x075500||!(v->features&CURL_VERSION_SSL))return 0;
#ifdef JIT_ADMIN_LOCAL_MOCK
  strcpy(address,"127.0.0.1");return 1;
#else
  struct addrinfo hints,*list=NULL;memset(&hints,0,sizeof hints);
  hints.ai_family=AF_INET;hints.ai_socktype=SOCK_STREAM;
  if(getaddrinfo("api.supabase.com",NULL,&hints,&list)||!list)return 0;
  const struct sockaddr_in *first=(const struct sockaddr_in *)list->ai_addr;
  int ok=inet_ntop(AF_INET,&first->sin_addr,address,sizeof address)!=NULL;
  freeaddrinfo(list);return ok;
#endif
}
static int byte(char *c,time_t until) {
  while(alive()&&monotonic_now()<until){
    fd_set rd;FD_ZERO(&rd);FD_SET(tty,&rd);struct timeval t={0,100000};
    int n=select(tty+1,&rd,NULL,NULL,&t);
    if(n<0&&errno!=EINTR)return 0;
    if(n>0&&FD_ISSET(tty,&rd)){
      if(!alive()||monotonic_now()>=until)return 0;
      ssize_t z=read(tty,c,1);if(z==1)return 1;if(!z)return 0;
    }
  }return 0;
}
static int read_token(void) {
  if(!isatty(0)||!isatty(1)||!isatty(2))return 0;
  tty=open("/dev/tty",O_RDWR|O_NOCTTY);
  if(tty<0||!isatty(tty)||tcgetattr(tty,&saved_tty))return 0;
  struct termios t=saved_tty;t.c_lflag&=(tcflag_t)~(ECHO|ECHONL|ICANON);
  t.c_cc[VMIN]=1;t.c_cc[VTIME]=0;if(tcsetattr(tty,TCSAFLUSH,&t))return 0;tty_changed=1;
  time_t until=monotonic_now()+PRIVATE_ENTRY_SECONDS;
  if(until>deadline)until=deadline;
  puts("jit_admin_private_entry_maximum_300_seconds_or_remaining_window");
  puts("jit_admin_private_token_entry");fflush(stdout);
  size_t n=0;char c=0;int valid=1;
  while(byte(&c,until)){
    if(c=='\r'||c=='\n'){wipe(&c,1);restore();return valid&&n>6&&!strncmp(private_memory.token,"sbp_fc",6);}
    if(n==4096||!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='_'||c=='-'))valid=0;
    else private_memory.token[n++]=c;
    wipe(&c,1);
  }wipe(&c,1);input_timed_out=!interrupted&&monotonic_now()>=until;return 0;
}

/* Strict, bounded response parser. Strings are slices; no payload is printed.
 * Escaped/non-ASCII strings, duplicate/unknown keys and unexpected JSON reject.
 * This intentionally supports only the fixed currently documented test shape. */
enum tag { OBJ,ARR,STR,NUM,NUL,BOOL };
struct node {enum tag tag;unsigned start,len,child,next;};
static struct node nodes[128];static unsigned used,pos;static size_t json_size,response_size;
static char *json;
static void ws(void){while(pos<json_size&&(json[pos]==' '||json[pos]=='\n'||json[pos]=='\r'||json[pos]=='\t'))++pos;}
static int equal(unsigned n,const char *s){return n&&nodes[n].len==strlen(s)&&!memcmp(json+nodes[n].start,s,nodes[n].len);}
static unsigned value(unsigned depth){
  ws();if(depth>8||used==127||pos>=json_size)return 0;unsigned n=++used;nodes[n].start=pos;
  char c=json[pos++];
  if(c=='{'||c=='['){
    nodes[n].tag=c=='{'?OBJ:ARR;ws();char end=c=='{'?'}':']';unsigned last=0;
    if(pos<json_size&&json[pos]==end){++pos;return n;}
    for(;;){
      unsigned key=0;
      if(c=='{'){
        key=value(depth+1);if(!key||nodes[key].tag!=STR)return 0;ws();if(pos>=json_size||json[pos++]!=':')return 0;
        for(unsigned old=nodes[n].child;old;old=nodes[nodes[old].next].next)
          if(nodes[old].len==nodes[key].len&&!memcmp(json+nodes[old].start,json+nodes[key].start,nodes[key].len))return 0;
      }
      unsigned v=value(depth+1);if(!v)return 0;
      if(key){nodes[key].next=v;if(last)nodes[last].next=key;else nodes[n].child=key;}
      else {if(last)nodes[last].next=v;else nodes[n].child=v;}
      last=v;ws();if(pos>=json_size)return 0;if(json[pos]==end){++pos;return n;}if(json[pos++]!=',')return 0;
    }
  }
  if(c=='"'){
    nodes[n].tag=STR;nodes[n].start=pos;
    while(pos<json_size&&json[pos]!='"'){
      unsigned char ch=(unsigned char)json[pos++];if(ch<32||ch>126||ch=='\\'||pos-nodes[n].start>4096)return 0;
    }
    if(pos>=json_size||json[pos]!='"')return 0;
    nodes[n].len=pos++-nodes[n].start;return n;
  }
  if(c>='0'&&c<='9'){
    nodes[n].tag=NUM;while(pos<json_size&&json[pos]>='0'&&json[pos]<='9')++pos;
    nodes[n].len=pos-nodes[n].start;
    if(nodes[n].len>10||(c=='0'&&nodes[n].len>1))return 0;
    return n;
  }
  --pos;
  if(json_size-pos>=4&&!memcmp(json+pos,"null",4)){nodes[n].tag=NUL;pos+=4;nodes[n].len=4;return n;}
  if(json_size-pos>=5&&!memcmp(json+pos,"false",5)){nodes[n].tag=BOOL;pos+=5;nodes[n].len=5;return n;}
  if(json_size-pos>=4&&!memcmp(json+pos,"true",4)){nodes[n].tag=BOOL;pos+=4;nodes[n].len=4;return n;}
  return 0;
}
static unsigned parse(void){
  memset(nodes,0,sizeof nodes);used=pos=0;json=private_memory.response;json_size=response_size;
  if(memchr(json,0,json_size))return 0;
  unsigned root=value(0);ws();return root&&pos==json_size?root:0;
}
static unsigned field(unsigned n,const char *name){
  if(!n||nodes[n].tag!=OBJ)return 0;
  for(unsigned k=nodes[n].child;k;k=nodes[nodes[k].next].next)if(equal(k,name))return nodes[k].next;
  return 0;
}
static int keys(unsigned n,const char *const *allowed){
  if(!n||nodes[n].tag!=OBJ)return 0;
  for(unsigned k=nodes[n].child;k;k=nodes[nodes[k].next].next){int found=0;
    for(unsigned i=0;allowed[i];++i)if(equal(k,allowed[i]))found=1;
    if(!found)return 0;
  }return 1;
}
static int number(unsigned n,time_t *out){
  if(!n||nodes[n].tag!=NUM)return 0;
  time_t v=0;
  for(unsigned i=0;i<nodes[n].len;++i)v=v*10+(json[nodes[n].start+i]-'0');
  *out=v;return 1;
}
static int uuid(unsigned n,char out[37]){
  if(!n||nodes[n].tag!=STR||nodes[n].len!=36)return 0;
  const char *p=json+nodes[n].start;
  for(unsigned i=0;i<36;++i){if(i==8||i==13||i==18||i==23){if(p[i]!='-')return 0;}
    else if(!((p[i]>='0'&&p[i]<='9')||(p[i]>='a'&&p[i]<='f')))return 0;}
  if(p[14]<'1'||p[14]>'8'||!strchr("89ab",p[19]))return 0;
  memcpy(out,p,36);out[36]=0;return 1;
}
static int role(unsigned roles,time_t *expiry){
  if(!roles||nodes[roles].tag!=ARR)return 0;
  unsigned r=nodes[roles].child;
  static const char *const rk[]={"role","expires_at","allowed_networks","branches_only",NULL};
  static const char *const nk[]={"allowed_cidrs","allowed_cidrs_v6",NULL};
  static const char *const ck[]={"cidr",NULL};
  if(!r||nodes[r].next||!keys(r,rk)||!equal(field(r,"role"),ROLE)||
     !number(field(r,"expires_at"),expiry)||*expiry>window_end||*expiry<window_end-3600||
     nodes[field(r,"branches_only")].tag!=BOOL||!equal(field(r,"branches_only"),"false"))return 0;
  unsigned net=field(r,"allowed_networks"),v4=field(net,"allowed_cidrs"),v6=field(net,"allowed_cidrs_v6");
  if(!keys(net,nk)||!v4||nodes[v4].tag!=ARR)return 0;
  unsigned cidr=nodes[v4].child;
  if(!cidr||nodes[cidr].next||!keys(cidr,ck)||!equal(field(cidr,"cidr"),CIDR))return 0;
  return !v6||(nodes[v6].tag==ARR&&!nodes[v6].child);
}
struct snapshot {int kind;char id[37];time_t expiry;};
static int list_snapshot(struct snapshot *s){
  memset(s,0,sizeof *s);unsigned root=parse();
  static const char *const rk[]={"items",NULL};
  static const char *const ik[]={"user_id","primary_email","invite_id","expires_at","user_roles",NULL};
  unsigned items=field(root,"items");
  if(!keys(root,rk)||!items||nodes[items].tag!=ARR)return 0;
  unsigned item=nodes[items].child;if(!item)return 1;
  /* Pristine exclusive test: never adopt or mutate any preexisting/foreign row. */
  if(nodes[item].next||!keys(item,ik)||!equal(field(item,"primary_email"),EMAIL)||
     !role(field(item,"user_roles"),&s->expiry))return 0;
  unsigned u=field(item,"user_id"),i=field(item,"invite_id"),e=field(item,"expires_at");
  if(u&&nodes[u].tag==NUL&&uuid(i,s->id)&&e&&nodes[e].tag==STR)s->kind=1;
  else if(uuid(u,s->id)&&i&&nodes[i].tag==NUL&&e&&nodes[e].tag==NUL)s->kind=2;
  else return 0;
  return 1;
}
struct response_limit {size_t bytes;int invalid;};
static size_t body(char *p,size_t size,size_t count,void *arg){
  struct response_limit *r=arg;
  if(!alive()||(size&&count>16384/size))return 0;
  size_t n=size*count;
  if(r->bytes>16384-n)return 0;
  memcpy(private_memory.response+r->bytes,p,n);r->bytes+=n;return n;
}
static size_t headers(char *p,size_t size,size_t count,void *arg){
  struct response_limit *r=arg;
  if(!alive()||(size&&count>16384/size))return 0;
  size_t n=size*count;
  if(r->bytes>16384-n)return 0;
  r->bytes+=n;
  if((n>=5&&!strncasecmp(p,"Link:",5))||(n>=14&&!strncasecmp(p,"Content-Range:",14))){r->invalid=1;return 0;}
  return n;
}
static int progress(void *arg,curl_off_t a,curl_off_t b,curl_off_t c,curl_off_t d){
  (void)arg;(void)a;(void)b;(void)c;(void)d;return !alive();
}
static int request(const char *url,const char *method,const char *payload,int cleanup){
  if(!alive()||requests>=(cleanup?60u:40u))return 0;
  ++requests;
  wipe(private_memory.response,sizeof private_memory.response);response_size=0;
  CURL *h=curl_easy_init();if(!h)return 0;
  int n=snprintf(private_memory.header,sizeof private_memory.header,"Authorization: Bearer %s",private_memory.token);
  if(n<0||(size_t)n>=sizeof private_memory.header){curl_easy_cleanup(h);return 0;}
  struct curl_slist *auth=curl_slist_append(NULL,private_memory.header);
  if(!auth){curl_easy_cleanup(h);return 0;}
  size_t auth_size=(size_t)n+1;int auth_locked=mlock(auth->data,auth_size)==0,ok=auth_locked;
  struct curl_slist *next=curl_slist_append(auth,"Content-Type: application/json");
  if(next)auth=next;else ok=0;
  char resolved[64];snprintf(resolved,sizeof resolved,"api.supabase.com:443:%s",address);
  struct curl_slist *addresses=curl_slist_append(NULL,resolved);if(!addresses)ok=0;
  struct response_limit b={0,0},hd={0,0};long status=0;
#define OPT(k,v) do{if(curl_easy_setopt(h,k,v)!=CURLE_OK)ok=0;}while(0)
  OPT(CURLOPT_URL,url);OPT(CURLOPT_CUSTOMREQUEST,method);OPT(CURLOPT_HTTPHEADER,auth);
  OPT(CURLOPT_RESOLVE,addresses);OPT(CURLOPT_PROXY,"");OPT(CURLOPT_FOLLOWLOCATION,0L);OPT(CURLOPT_MAXREDIRS,0L);
  OPT(CURLOPT_SSL_VERIFYPEER,1L);OPT(CURLOPT_SSL_VERIFYHOST,2L);
  OPT(CURLOPT_CAINFO,"/etc/ssl/certs/ca-certificates.crt");OPT(CURLOPT_CAPATH,"/etc/ssl/certs");
  OPT(CURLOPT_PROTOCOLS_STR,"https");OPT(CURLOPT_REDIR_PROTOCOLS_STR,"https");
  OPT(CURLOPT_TIMEOUT_MS,5000L);OPT(CURLOPT_CONNECTTIMEOUT_MS,3000L);
  OPT(CURLOPT_NOSIGNAL,1L);OPT(CURLOPT_VERBOSE,0L);OPT(CURLOPT_FRESH_CONNECT,1L);OPT(CURLOPT_FORBID_REUSE,1L);
  OPT(CURLOPT_NETRC,(long)CURL_NETRC_IGNORED);OPT(CURLOPT_ACCEPT_ENCODING,"identity");
  OPT(CURLOPT_WRITEFUNCTION,body);OPT(CURLOPT_WRITEDATA,&b);OPT(CURLOPT_HEADERFUNCTION,headers);OPT(CURLOPT_HEADERDATA,&hd);
  OPT(CURLOPT_NOPROGRESS,0L);OPT(CURLOPT_XFERINFOFUNCTION,progress);
  if(payload){OPT(CURLOPT_POSTFIELDS,payload);OPT(CURLOPT_POSTFIELDSIZE,(long)strlen(payload));}
  if(ok)ok=curl_easy_perform(h)==CURLE_OK&&alive()&&!hd.invalid&&
    curl_easy_getinfo(h,CURLINFO_RESPONSE_CODE,&status)==CURLE_OK&&status==200;
  response_size=b.bytes;curl_easy_cleanup(h);wipe(auth->data,auth_size);
#ifdef JIT_ADMIN_LOCAL_MOCK
  jit_admin_mock_wipe(auth->data,auth_size);
#endif
  if(auth_locked)munlock(auth->data,auth_size);
  curl_slist_free_all(auth);curl_slist_free_all(addresses);
  wipe(private_memory.header,sizeof private_memory.header);return ok;
#undef OPT
}
static int readback(struct snapshot *s,int cleanup){
  int ok=request(BASE "/list","GET",NULL,cleanup)&&list_snapshot(s);
  wipe(private_memory.response,sizeof private_memory.response);return ok;
}
static int matches(const struct snapshot *s){
  if(!s->kind)return 1;
  if(!owned||s->expiry!=expected_expiry)return 0;
  if(s->kind==1)return invite_id[0]&&!strcmp(s->id,invite_id);
  return !user_id[0]||!strcmp(s->id,user_id);
}
static int observe(int cleanup){
  struct snapshot s;
  if(!readback(&s,cleanup)){uncertain=1;puts("jit_admin_readback_unavailable_or_scope_changed");return 0;}
  if(!matches(&s)){uncertain=1;puts("jit_admin_foreign_or_changed_scope_stop");return 0;}
  if(s.kind==2&&!user_id[0]){strcpy(user_id,s.id);printf("jit_admin_bound_user %s\n",user_id);}
  puts(s.kind==0?"jit_admin_access_absent":s.kind==1?"jit_admin_invitation_pending":"jit_admin_exact_mapping_observed");
  if(uncertain)puts("jit_admin_mutation_ack_uncertain_no_further_grants");
  return 1;
}
static int mutation_response(int invitation,time_t expiry){
  unsigned root=parse();time_t got=0;char id[37];
  static const char *const ik[]={"email","invite_id","user_roles",NULL};
  static const char *const uk[]={"user_id","user_roles",NULL};
  if(!keys(root,invitation?ik:uk)||!role(field(root,"user_roles"),&got)||got!=expiry)return 0;
  if(invitation){if(!equal(field(root,"email"),EMAIL)||!uuid(field(root,"invite_id"),id))return 0;strcpy(invite_id,id);}
  else if(!uuid(field(root,"user_id"),id)||strcmp(id,user_id))return 0;
  return 1;
}
static int grant(int mode){
  struct snapshot s;
  if(uncertain||!readback(&s,0)||!matches(&s)){uncertain=1;puts("jit_admin_grant_precondition_failed");return 0;}
  time_t current=wall();
  if((mode==0&&(owned||s.kind))||(mode==1&&(stage!=1||!user_id[0]||s.kind!=2||current<expected_expiry))||
     (mode==2&&(stage!=3||!user_id[0]||s.kind))){puts("jit_admin_phase_precondition_failed");return 0;}
  time_t expiry=mode==0?current+480:mode==1?current+600:window_end-600;
  if(expiry>window_end-600||expiry<current+120){puts("jit_admin_time_admission_failed");return 0;}
  char payload[768];
  int n=snprintf(payload,sizeof payload,"{\"%s\":\"%s\",\"roles\":[{\"role\":\"" ROLE "\",\"expires_at\":%lld,"
    "\"allowed_networks\":{\"allowed_cidrs\":[{\"cidr\":\"" CIDR "\"}],\"allowed_cidrs_v6\":[]},\"branches_only\":false}]}",
    mode==0?"email":"user_id",mode==0?EMAIL:user_id,(long long)expiry);
  if(n<0||(size_t)n>=sizeof payload)return 0;
  owned=1;expected_expiry=expiry;stage=mode==0?1:mode==1?2:4;
  int ack=request(mode==0?BASE "/invite":BASE,mode==0?"POST":"PUT",payload,0)&&mutation_response(mode==0,expiry);
  wipe(private_memory.response,sizeof private_memory.response);
  if(!ack)uncertain=1;
  if(!readback(&s,1)){uncertain=1;puts("jit_admin_mutation_uncertain_readback_required");return 0;}
  /* A lost invite response can identify cleanup scope only via pristine-baseline
   * exact email/role/expiry readback. It never clears the acknowledgement latch. */
  if(mode==0&&!invite_id[0]&&s.kind==1&&s.expiry==expiry)strcpy(invite_id,s.id);
  if(!s.kind||!matches(&s)){uncertain=1;puts("jit_admin_mutation_scope_unconfirmed_stop");return 0;}
  if(s.kind==2&&!user_id[0])strcpy(user_id,s.id);
  puts(uncertain?"jit_admin_mutation_observed_ack_uncertain":"jit_admin_grant_and_readback_confirmed");
  printf("jit_admin_grant_expires_unix_seconds %lld\n",(long long)expiry);return !uncertain;
}
static int revoke(void){
  struct snapshot s;
  if(!readback(&s,1)||!matches(&s)){uncertain=1;puts("jit_admin_cleanup_scope_unconfirmed_do_not_delete");return 0;}
  if(!s.kind){puts(uncertain?"jit_admin_absent_but_ack_uncertain":"jit_admin_cleanup_absence_confirmed");return !uncertain;}
  char url[256];int n=snprintf(url,sizeof url,s.kind==1?BASE "/invite/%s":BASE "/%s",s.id);
  if(n<0||(size_t)n>=sizeof url)return 0;
  int ack=request(url,"DELETE",NULL,1);wipe(private_memory.response,sizeof private_memory.response);
  if(!ack)uncertain=1;
  if(!readback(&s,1)||s.kind){uncertain=1;puts("jit_admin_cleanup_unconfirmed");return 0;}
  if(stage==2)stage=3;else stage=5;
  puts(uncertain?"jit_admin_cleanup_absent_ack_uncertain":"jit_admin_cleanup_absence_confirmed");return !uncertain;
}
int main(int argc,char **argv){
#ifdef JIT_ADMIN_LOCAL_MOCK
  jit_admin_mock_link_required();
#elif !defined(__linux__)
  (void)argc;(void)argv;return finish("jit_admin_unsupported_host",78);
#endif
  if(argc!=2||strlen(argv[1])!=10)return finish("jit_admin_arguments_rejected",64);
  for(unsigned i=0;i<10;++i){if(argv[1][i]<'0'||argv[1][i]>'9')return finish("jit_admin_arguments_rejected",64);window_end=window_end*10+argv[1][i]-'0';}
  time_t current=wall();if(window_end<=current+600||window_end>current+3600)return finish("jit_admin_window_rejected",64);
  if(!environment())return finish("jit_admin_environment_rejected",64);
  deadline=monotonic_now()+(window_end-current);
  if(!harden())return finish("jit_admin_privacy_preflight_failed",70);
  if(!transport_preflight())return finish("jit_admin_transport_preflight_failed",70);
  if(!read_token())return finish(interrupted?"jit_admin_cancelled_no_mutation":
    input_timed_out?"jit_admin_private_input_timed_out":"jit_admin_private_input_rejected",65);
  struct snapshot initial;
  if(!readback(&initial,0)||initial.kind)return finish("jit_admin_pristine_baseline_required",1);
  puts("jit_admin_ready_i_invite_r_read_t_ten_minute_f_final_x_revoke_q_quit");fflush(stdout);
  char cue=0;
  while(byte(&cue,deadline)){
    if(cue=='i')grant(0);
    else if(cue=='r')observe(0);
    else if(cue=='t')grant(1);
    else if(cue=='f')grant(2);
    else if(cue=='x')revoke();
    else if(cue=='q'){
      if(revoke())return finish("jit_admin_finished_revoke_admin_pat_and_finish_external_cleanup",0);
      return finish("jit_admin_cleanup_unknown_independent_owner_required",1);
    }else if(cue!='\r'&&cue!='\n')return finish("jit_admin_cue_rejected_cleanup_required",64);
    fflush(stdout);
  }
  return finish("jit_admin_interrupted_or_expired_independent_cleanup_required",75);
}
#endif
