/* Offline libcurl boundary fixture. No network library is linked by validate.py. */
#define _POSIX_C_SOURCE 200809L
#define CURL_DISABLE_TYPECHECK
#include <curl/curl.h>
#include <assert.h>
#include <signal.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>

struct fake_http {
  const char *url,*body;
  struct curl_slist *headers,*addresses;
  size_t (*write)(char*,size_t,size_t,void*);
  size_t (*header)(char*,size_t,size_t,void*);
  void *write_data,*header_data;
  int (*progress)(void*,curl_off_t,curl_off_t,curl_off_t,curl_off_t);
  long status,post;
  unsigned flags;
};
static unsigned requests;
static int is(const char *name) { const char *s=getenv("JIT_MOCK_CASE");return s && !strcmp(s,name); }
CURLcode curl_global_init(long flags) { assert(flags==CURL_GLOBAL_DEFAULT);return CURLE_OK; }
void curl_global_cleanup(void) { }
curl_version_info_data *curl_version_info(CURLversion age) {
  static curl_version_info_data info;
  assert(age==CURLVERSION_NOW);info.features=CURL_VERSION_SSL;info.version_num=0x080701;return &info;
}
CURL *curl_easy_init(void) { return calloc(1,sizeof(struct fake_http)); }
void curl_easy_cleanup(CURL *handle) { free(handle); }
struct curl_slist *curl_slist_append(struct curl_slist *head,const char *text) {
  struct curl_slist *node=calloc(1,sizeof *node);assert(node);node->data=strdup(text);assert(node->data);
  if (!head) return node;
  struct curl_slist *tail=head;while(tail->next)tail=tail->next;tail->next=node;return head;
}
void curl_slist_free_all(struct curl_slist *head) {
  while(head) { struct curl_slist *next=head->next;free(head->data);free(head);head=next; }
}
CURLcode curl_easy_setopt(CURL *handle,CURLoption option,...) {
  struct fake_http *h=handle;va_list args;va_start(args,option);
  switch(option) {
    case CURLOPT_URL: h->url=va_arg(args,const char*);break;
    case CURLOPT_HTTPHEADER:h->headers=va_arg(args,struct curl_slist*);break;
    case CURLOPT_RESOLVE:h->addresses=va_arg(args,struct curl_slist*);break;
    case CURLOPT_PROXY:assert(!strcmp(va_arg(args,const char*),""));h->flags|=1;break;
    case CURLOPT_FOLLOWLOCATION:assert(va_arg(args,long)==0);h->flags|=2;break;
    case CURLOPT_MAXREDIRS:assert(va_arg(args,long)==0);break;
    case CURLOPT_SSL_VERIFYPEER:assert(va_arg(args,long)==1);h->flags|=4;break;
    case CURLOPT_SSL_VERIFYHOST:assert(va_arg(args,long)==2);h->flags|=8;break;
    case CURLOPT_CAINFO:assert(!strcmp(va_arg(args,const char*),"/etc/ssl/certs/ca-certificates.crt"));break;
    case CURLOPT_CAPATH:assert(!strcmp(va_arg(args,const char*),"/etc/ssl/certs"));break;
    case CURLOPT_PROTOCOLS_STR:case CURLOPT_REDIR_PROTOCOLS_STR:assert(!strcmp(va_arg(args,const char*),"https"));break;
    case CURLOPT_TIMEOUT_MS:assert(va_arg(args,long)==5000);h->flags|=16;break;
    case CURLOPT_CONNECTTIMEOUT_MS:assert(va_arg(args,long)==3000);break;
    case CURLOPT_NOSIGNAL:case CURLOPT_FRESH_CONNECT:case CURLOPT_FORBID_REUSE:assert(va_arg(args,long)==1);break;
    case CURLOPT_NETRC:assert(va_arg(args,long)==CURL_NETRC_IGNORED);break;
    case CURLOPT_VERBOSE:case CURLOPT_NOPROGRESS:assert(va_arg(args,long)==0);break;
    case CURLOPT_WRITEFUNCTION:h->write=va_arg(args,size_t(*)(char*,size_t,size_t,void*));break;
    case CURLOPT_WRITEDATA:h->write_data=va_arg(args,void*);break;
    case CURLOPT_HEADERFUNCTION:h->header=va_arg(args,size_t(*)(char*,size_t,size_t,void*));break;
    case CURLOPT_HEADERDATA:h->header_data=va_arg(args,void*);break;
    case CURLOPT_XFERINFOFUNCTION:h->progress=va_arg(args,int(*)(void*,curl_off_t,curl_off_t,curl_off_t,curl_off_t));break;
    case CURLOPT_POST:h->post=va_arg(args,long);assert(h->post==1);break;
    case CURLOPT_POSTFIELDS:h->body=va_arg(args,const char*);assert(!strcmp(h->body,"{\"query\":\"SELECT 1\"}"));break;
    default:assert(!"unexpected curl option");
  }
  va_end(args);
  return is("http_option_failure") && option==CURLOPT_SSL_VERIFYHOST ? CURLE_UNKNOWN_OPTION : CURLE_OK;
}
CURLcode curl_easy_perform(CURL *handle) {
  struct fake_http *h=handle;++requests;assert(requests<=2);
  assert(h->flags==31 && h->write && h->header && h->progress && h->headers && h->addresses);
  assert(!strcmp(h->addresses->data,"api.supabase.com:443:127.0.0.1"));
  if(requests==1)assert(!strcmp(h->url,"https://api.supabase.com/v1/projects/oysjpoondtcrqpghhrbd")&&!h->post);
  else assert(!strcmp(h->url,"https://api.supabase.com/v1/projects/oysjpoondtcrqpghhrbd/database/query")&&h->post==1);
  const char *prefix="Authorization: Bearer ";assert(!strncmp(h->headers->data,prefix,strlen(prefix)));
  char *echo=h->headers->data+strlen(prefix);size_t n=strlen(echo);
  if(is("http_cancel"))raise(SIGTERM);
  if(h->progress(NULL,0,0,0,0))return CURLE_ABORTED_BY_CALLBACK;
  if(is("http_tls_failure"))return CURLE_PEER_FAILED_VERIFICATION;
  if(is("http_timeout"))return CURLE_OPERATION_TIMEDOUT;
  if(is("http_oversized_body")) { assert(h->write(echo,1,65537,h->write_data)==0);return CURLE_WRITE_ERROR; }
  if(is("http_oversized_headers")) { assert(h->header(echo,1,16385,h->header_data)==0);return CURLE_WRITE_ERROR; }
  /* Both response surfaces deliberately reflect the synthetic credential. */
  assert(h->write(echo,1,n,h->write_data)==n);
  assert(h->header(echo,1,n,h->header_data)==n);
  h->status=403;
  if(is("http_redirect"))h->status=302;
  if(is("http_permitted") || (is("http_second_permitted")&&requests==2))h->status=200;
  if(is("http_server_error"))h->status=500;
  if(is("http_unauthorized"))h->status=401;
  if(is("http_not_found"))h->status=404;
  return CURLE_OK;
}
CURLcode curl_easy_getinfo(CURL *handle,CURLINFO info,...) {
  struct fake_http *h=handle;assert(info==CURLINFO_RESPONSE_CODE);
  va_list args;va_start(args,info);*va_arg(args,long*)=h->status;va_end(args);return CURLE_OK;
}
