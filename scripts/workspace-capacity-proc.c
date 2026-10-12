/* Read-only macOS process telemetry. No privilege elevation, subprocesses,
 * files, command lines, environment or network. Only same-UID roots/descendants.
 * Build: clang -O2 -Wall -Wextra scripts/workspace-capacity-proc.c -o PRIVATE_PATH
 */
#include <libproc.h>
#include <mach/mach_time.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <unistd.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#define MAX_PIDS 65536
#define MAX_ROOTS 32
struct sample { pid_t pid, ppid; uint64_t rss, user_ns, system_ns, start_sec, start_usec; int group; };
int main(int argc, char **argv) {
  if (argc < 2 || argc > MAX_ROOTS + 1) { fprintf(stderr,"process_roots_required\n"); return 2; }
  mach_timebase_info_data_t timebase; if(mach_timebase_info(&timebase)!=0 || !timebase.denom) return 6;
  pid_t roots[MAX_ROOTS];
  for (int i=1;i<argc;i++) { char *end=NULL; errno=0; long value=strtol(argv[i],&end,10); if(errno || !end || *end || value<1 || value>INT32_MAX) return 2; roots[i-1]=(pid_t)value; }
  pid_t *pids=calloc(MAX_PIDS,sizeof(pid_t)); struct sample *samples=calloc(MAX_PIDS,sizeof(struct sample));
  if(!pids || !samples) return 3;
  int bytes=proc_listpids(PROC_ALL_PIDS,0,pids,MAX_PIDS*sizeof(pid_t));
  if(bytes<=0 || bytes >= (int)(MAX_PIDS*sizeof(pid_t))) return 4;
  int count=0;
  for(int i=0;i<bytes/(int)sizeof(pid_t);i++) {
    if(pids[i]<=0) continue;
    struct proc_taskallinfo info; memset(&info,0,sizeof(info));
    if(proc_pidinfo(pids[i],PROC_PIDTASKALLINFO,0,&info,sizeof(info)) != sizeof(info)) continue;
    if(info.pbsd.pbi_uid != getuid()) continue;
    struct rusage_info_v2 usage; memset(&usage,0,sizeof(usage));
    if(proc_pid_rusage(pids[i],RUSAGE_INFO_V2,(rusage_info_t *)&usage)!=0) continue;
    struct sample *s=&samples[count++]; s->pid=pids[i];s->ppid=(pid_t)info.pbsd.pbi_ppid;s->rss=info.ptinfo.pti_resident_size;
    /* XNU Recount reports Mach time units. Convert with the host timebase.
     * https://github.com/apple-oss-distributions/xnu/blob/main/doc/observability/recount.md */
    s->user_ns=(uint64_t)((__uint128_t)usage.ri_user_time*timebase.numer/timebase.denom);s->system_ns=(uint64_t)((__uint128_t)usage.ri_system_time*timebase.numer/timebase.denom);s->start_sec=info.pbsd.pbi_start_tvsec;s->start_usec=info.pbsd.pbi_start_tvusec;s->group=-1;
    for(int r=0;r<argc-1;r++) if(s->pid==roots[r]) s->group=r;
  }
  int missing=0;
  for(int r=0;r<argc-1;r++) { int found=0; for(int i=0;i<count;i++) if(samples[i].pid==roots[r]) found=1; if(!found) missing++; }
  for(int changed=1;changed;) { changed=0;for(int i=0;i<count;i++) if(samples[i].group<0) for(int j=0;j<count;j++) if(samples[j].group>=0 && samples[i].ppid==samples[j].pid) { samples[i].group=samples[j].group;changed=1;break; } }
  printf("{\"source\":\"darwin_libproc_same_uid\",\"uid\":%u,\"missingRoots\":%d,\"processes\":[",(unsigned)getuid(),missing);
  int emitted=0;
  for(int i=0;i<count;i++) { struct sample *s=&samples[i];if(s->group<0) continue;
    printf("%s{\"pid\":%d,\"ppid\":%d,\"rootIndex\":%d,\"rssBytes\":%llu,\"userCpuNanoseconds\":%llu,\"systemCpuNanoseconds\":%llu,\"startSeconds\":%llu,\"startMicroseconds\":%llu}",emitted++?",":"",s->pid,s->ppid,s->group,(unsigned long long)s->rss,(unsigned long long)s->user_ns,(unsigned long long)s->system_ns,(unsigned long long)s->start_sec,(unsigned long long)s->start_usec);
  }
  printf("]}\n"); free(pids);free(samples);return missing?5:0;
}
