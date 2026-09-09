/* Offline HTTP boundary only: linked instead of libcurl, never opens a socket. */
#define _POSIX_C_SOURCE 200809L
#define CURL_DISABLE_TYPECHECK
#include <curl/curl.h>
#include <assert.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#define BASE "https://api.supabase.com/v1/projects/oysjpoondtcrqpghhrbd/database/jit"
#define EMAIL "isaac+vaeroex-jit-feasibility@vaeroex.com"
#define ROLE "vaeroex_jit_feasibility_20260908"
#define USER "11111111-1111-4111-8111-111111111111"
#define INVITE "22222222-2222-4222-8222-222222222222"
struct mock {
 const char *url,*method,*payload;struct curl_slist *headers,*addresses;
 size_t (*write)(char*,size_t,size_t,void*),(*header)(char*,size_t,size_t,void*);
 void *write_data,*header_data;
 int (*progress)(void*,curl_off_t,curl_off_t,curl_off_t,curl_off_t);
 long status;unsigned flags;
};
static unsigned calls,posts,puts_,deletes,lists_after_invite,post_lists,wipes;
static int kind;static time_t now=1788880000,expiry;
static int is(const char *s){const char *c=getenv("JIT_ADMIN_MOCK_CASE");return c&&!strcmp(c,s);}
void jit_admin_mock_link_required(void){}
time_t jit_admin_mock_wall(void){return now;}
void jit_admin_mock_wipe(const void *v,size_t n){const unsigned char *p=v;for(size_t i=0;i<n;++i)assert(!p[i]);++wipes;}
CURLcode curl_global_init(long f){assert(f==CURL_GLOBAL_DEFAULT);return CURLE_OK;}
void curl_global_cleanup(void){
 assert(calls<=60&&posts<=1&&puts_<=2&&deletes<=2);assert(!calls||wipes>=calls);
 if(is("scope_flip_read")||is("scope_flip_grant")||is("scope_flip_cleanup")||is("malformed_then_restored"))assert(!puts_);
}
curl_version_info_data *curl_version_info(CURLversion v){
 static curl_version_info_data info;assert(v==CURLVERSION_NOW);info.features=is("no_tls")?0:CURL_VERSION_SSL;
 info.version_num=is("old_curl")?0x075400:0x080701;return &info;
}
CURL *curl_easy_init(void){return calloc(1,sizeof(struct mock));}
void curl_easy_cleanup(CURL *h){free(h);}
struct curl_slist *curl_slist_append(struct curl_slist *head,const char *s){
 struct curl_slist *n=calloc(1,sizeof *n);assert(n);n->data=strdup(s);assert(n->data);
 if(!head)return n;
 struct curl_slist *p=head;while(p->next)p=p->next;p->next=n;return head;
}
void curl_slist_free_all(struct curl_slist *p){while(p){struct curl_slist *n=p->next;free(p->data);free(p);p=n;}}
CURLcode curl_easy_setopt(CURL *handle,CURLoption o,...){
 struct mock *h=handle;va_list a;va_start(a,o);
 switch(o){
 case CURLOPT_URL:h->url=va_arg(a,const char*);break;
 case CURLOPT_CUSTOMREQUEST:h->method=va_arg(a,const char*);break;
 case CURLOPT_HTTPHEADER:h->headers=va_arg(a,struct curl_slist*);break;
 case CURLOPT_RESOLVE:h->addresses=va_arg(a,struct curl_slist*);break;
 case CURLOPT_PROXY:assert(!strcmp(va_arg(a,const char*),""));h->flags|=1;break;
 case CURLOPT_FOLLOWLOCATION:assert(va_arg(a,long)==0);h->flags|=2;break;
 case CURLOPT_MAXREDIRS:assert(va_arg(a,long)==0);break;
 case CURLOPT_SSL_VERIFYPEER:assert(va_arg(a,long)==1);h->flags|=4;break;
 case CURLOPT_SSL_VERIFYHOST:assert(va_arg(a,long)==2);h->flags|=8;break;
 case CURLOPT_CAINFO:assert(!strcmp(va_arg(a,const char*),"/etc/ssl/certs/ca-certificates.crt"));break;
 case CURLOPT_CAPATH:assert(!strcmp(va_arg(a,const char*),"/etc/ssl/certs"));break;
 case CURLOPT_PROTOCOLS_STR:case CURLOPT_REDIR_PROTOCOLS_STR:assert(!strcmp(va_arg(a,const char*),"https"));break;
 case CURLOPT_TIMEOUT_MS:assert(va_arg(a,long)==5000);h->flags|=16;break;
 case CURLOPT_CONNECTTIMEOUT_MS:assert(va_arg(a,long)==3000);break;
 case CURLOPT_NOSIGNAL:case CURLOPT_FRESH_CONNECT:case CURLOPT_FORBID_REUSE:assert(va_arg(a,long)==1);break;
 case CURLOPT_NETRC:assert(va_arg(a,long)==CURL_NETRC_IGNORED);break;
 case CURLOPT_ACCEPT_ENCODING:assert(!strcmp(va_arg(a,const char*),"identity"));break;
 case CURLOPT_VERBOSE:case CURLOPT_NOPROGRESS:assert(va_arg(a,long)==0);break;
 case CURLOPT_WRITEFUNCTION:h->write=va_arg(a,size_t(*)(char*,size_t,size_t,void*));break;
 case CURLOPT_HEADERFUNCTION:h->header=va_arg(a,size_t(*)(char*,size_t,size_t,void*));break;
 case CURLOPT_WRITEDATA:h->write_data=va_arg(a,void*);break;
 case CURLOPT_HEADERDATA:h->header_data=va_arg(a,void*);break;
 case CURLOPT_XFERINFOFUNCTION:h->progress=va_arg(a,int(*)(void*,curl_off_t,curl_off_t,curl_off_t,curl_off_t));break;
 case CURLOPT_POSTFIELDS:h->payload=va_arg(a,const char*);break;
 case CURLOPT_POSTFIELDSIZE:assert((size_t)va_arg(a,long)==strlen(h->payload));break;
 default:assert(!"unexpected HTTP capability");
 }
 va_end(a);return is("option_failure")&&o==CURLOPT_SSL_VERIFYHOST?CURLE_UNKNOWN_OPTION:CURLE_OK;
}
static void roles(char *out,size_t size){
 const char *role=is("foreign_role")?"postgres":ROLE;
 const char *cidr=is("wide_network")?"0.0.0.0/0":"8.229.223.109/32";
 const char *branches=is("string_boolean")?"\"false\"":is("branches")?"true":"false";
 const char *v6=is("ipv6")?"[{\"cidr\":\"::/0\"}]":"[]";
 snprintf(out,size,"[{\"role\":\"%s\",\"expires_at\":%lld,\"allowed_networks\":{\"allowed_cidrs\":[{\"cidr\":\"%s\"}],\"allowed_cidrs_v6\":%s},\"branches_only\":%s}]",role,(long long)expiry,cidr,v6,branches);
}
static void list(char *out,size_t size){
 if(!kind){snprintf(out,size,"{\"items\":[]}");return;}
 char r[768];roles(r,sizeof r);
 int flip=(is("scope_flip_read")&&post_lists==2)||((is("scope_flip_grant")||is("scope_flip_cleanup"))&&post_lists==3);
 const char *email=is("foreign_email")||flip?"foreign@example.invalid":EMAIL;
 if(kind==1)snprintf(out,size,"{\"items\":[{\"user_id\":null,\"primary_email\":\"%s\",\"invite_id\":\"" INVITE "\",\"expires_at\":\"2026-09-09T00:00:00Z\",\"user_roles\":%s}]}",email,r);
 else snprintf(out,size,"{\"items\":[{\"user_id\":\"%s\",\"primary_email\":\"%s\",\"invite_id\":null,\"expires_at\":null,\"user_roles\":%s}]}",is("changed_user")&&puts_?INVITE:USER,email,r);
}
static void validate_payload(struct mock *h,int invite){
 const char *key=strstr(h->payload,"\"expires_at\":");assert(key);char *end=NULL;
 expiry=(time_t)strtoll(key+13,&end,10);assert(end&&*end==',');
 assert(expiry>1788880000&&expiry<=1788883000);
 char expected[768];snprintf(expected,sizeof expected,"{\"%s\":\"%s\",\"roles\":[{\"role\":\"" ROLE "\",\"expires_at\":%lld,\"allowed_networks\":{\"allowed_cidrs\":[{\"cidr\":\"8.229.223.109/32\"}],\"allowed_cidrs_v6\":[]},\"branches_only\":false}]}",invite?"email":"user_id",invite?EMAIL:USER,(long long)expiry);
 assert(!strcmp(expected,h->payload));
 if(invite)assert(expiry==1788880480);else if(puts_==1)assert(expiry==1788881081);else assert(expiry==1788883000);
}
CURLcode curl_easy_perform(CURL *handle){
 struct mock *h=handle;++calls;assert(calls<=60&&h->flags==31&&h->write&&h->header&&h->progress&&h->headers&&h->addresses);
 assert(!strcmp(h->addresses->data,"api.supabase.com:443:127.0.0.1"));
 assert(!strncmp(h->headers->data,"Authorization: Bearer sbp_fc",27));
 assert(h->headers->next&&!strcmp(h->headers->next->data,"Content-Type: application/json")&&!h->headers->next->next);
 if(is("cancel_http"))raise(SIGTERM);
 if(h->progress(NULL,0,0,0,0))return CURLE_ABORTED_BY_CALLBACK;
 if(is("tls_failure"))return CURLE_PEER_FAILED_VERIFICATION;
 if(is("timeout"))return CURLE_OPERATION_TIMEDOUT;
 h->status=is("redirect")?302:is("forbidden")?403:is("rate_limit")?429:is("server_error")?500:200;
 char out[16385]={0};
 if(!strcmp(h->method,"GET")){
  assert(!strcmp(h->url,BASE "/list")&&!h->payload);
  if(posts)++post_lists;
  if(is("preexisting")&&!posts){kind=2;expiry=1788880480;}
  if(posts&&kind==1&&++lists_after_invite>=2&&!is("pending")){kind=2;now=1788880481;}
  list(out,sizeof out);
  if(is("malformed_then_restored")&&post_lists==2)strcpy(out,"{\"items\":");
 }else if(!strcmp(h->method,"POST")){
  assert(!strcmp(h->url,BASE "/invite")&&!kind&&++posts==1);validate_payload(h,1);kind=1;
  char r[768];roles(r,sizeof r);snprintf(out,sizeof out,"{\"email\":\"" EMAIL "\",\"invite_id\":\"" INVITE "\",\"user_roles\":%s}",r);
  if(is("lost_invite_ack"))return CURLE_OPERATION_TIMEDOUT;
  if(is("missing_invite_id"))snprintf(out,sizeof out,"{\"email\":\"" EMAIL "\",\"user_roles\":%s}",r);
 }else if(!strcmp(h->method,"PUT")){
  assert(!strcmp(h->url,BASE)&&posts==1&&++puts_<=2);validate_payload(h,0);kind=2;
  char r[768];roles(r,sizeof r);snprintf(out,sizeof out,"{\"user_id\":\"" USER "\",\"user_roles\":%s}",r);
  if(is("lost_update_ack"))return CURLE_OPERATION_TIMEDOUT;
  if(is("missing_user_id"))snprintf(out,sizeof out,"{\"user_roles\":%s}",r);
 }else{
  assert(!strcmp(h->method,"DELETE")&&kind&&++deletes<=2&&!h->payload);
  assert(!strcmp(h->url,kind==1?BASE "/invite/" INVITE:BASE "/" USER));kind=0;
  if(is("lost_delete_ack"))return CURLE_OPERATION_TIMEDOUT;
 }
 if(is("hostile_echo"))snprintf(out,sizeof out,"{\"error\":\"%s\"}",h->headers->data+22);
 if(is("unknown_key"))strcpy(out,"{\"items\":[],\"next\":null}");
 if(is("duplicate_key"))strcpy(out,"{\"items\":[],\"items\":[]}");
 if(is("truncated"))strcpy(out,"{\"items\":[{\"user_id\":n");
 if(is("wrong_type"))strcpy(out,"{\"items\":{}}");
 if(is("escaped_key"))strcpy(out,"{\"ite\\u006ds\":[]}");
 if(is("pagination_header")){char line[]="Link: <next>; rel=next\r\n";assert(!h->header(line,1,strlen(line),h->header_data));return CURLE_WRITE_ERROR;}
 if(is("range_header")){char line[]="Content-Range: 0-1/2\r\n";assert(!h->header(line,1,strlen(line),h->header_data));return CURLE_WRITE_ERROR;}
 if(is("oversized_body")){assert(!h->write(out,1,16385,h->write_data));return CURLE_WRITE_ERROR;}
 if(is("oversized_header")){assert(!h->header(out,1,16385,h->header_data));return CURLE_WRITE_ERROR;}
 size_t n=strlen(out);
 if(is("embedded_nul")){memcpy(out,"{\"items\":[]}\0garbage",20);n=20;}
 if(is("boundary_truncated")){memset(out,' ',16384);out[16383]='n';n=16384;}
 /* Sensitive-looking response header is discarded without diagnostic output. */
 assert(h->header(h->headers->data,1,strlen(h->headers->data),h->header_data)==strlen(h->headers->data));
 if(h->write(out,1,n,h->write_data)!=n)return CURLE_WRITE_ERROR;
 return CURLE_OK;
}
CURLcode curl_easy_getinfo(CURL *handle,CURLINFO i,...){
 assert(i==CURLINFO_RESPONSE_CODE);va_list a;va_start(a,i);*va_arg(a,long*)=((struct mock*)handle)->status;va_end(a);return CURLE_OK;
}
