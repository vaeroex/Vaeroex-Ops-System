/* Sole supported privileged entry: static Linux ELF, before Node or its loader.
 * No credential is read here. sudo/OS Login controls who may invoke this entry;
 * an already privileged operator able to replace installed code is not isolated.
 */
#define _POSIX_C_SOURCE 200809L
#define _DEFAULT_SOURCE 1
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/syscall.h>
#elif !defined(VAEROEX_LAUNCHER_SYNTHETIC_ONLY)
#error Production maintenance launcher requires Linux
#endif

#ifdef VAEROEX_LAUNCHER_SYNTHETIC_ONLY
#if !defined(VAEROEX_TEST_NODE) || !defined(VAEROEX_TEST_INSTALL)
#error Synthetic launcher requires immutable local fixture paths
#endif
#define NODE_PATH VAEROEX_TEST_NODE
#define INSTALL_PATH VAEROEX_TEST_INSTALL
#else
#define NODE_PATH "/usr/bin/node"
#define INSTALL_PATH "/opt/vaeroex-native-broker"
#endif
#define SCRIPT_PATH INSTALL_PATH "/maintenance.mjs"

static int deny(void) {
  static const char result[] = "native_maintenance_launcher_denied\n";
  ssize_t ignored=write(STDOUT_FILENO, result, sizeof(result)-1);
  (void)ignored;
  return 2;
}
static uid_t owner(void) {
#ifdef VAEROEX_LAUNCHER_SYNTHETIC_ONLY
  return getuid();
#else
  return 0;
#endif
}
static bool trusted(const char *path, bool directory, bool executable, bool ancestor) {
  struct stat st;
  if (lstat(path,&st) || (st.st_mode & 0022) ||
      (st.st_uid != owner() && !(ancestor && st.st_uid == 0))) return false;
  if (directory) return S_ISDIR(st.st_mode);
  return S_ISREG(st.st_mode) && (!executable || (st.st_mode & 0111));
}
static bool parents(const char *path) {
  char part[PATH_MAX];
  size_t length=strlen(path);
  if (!length || length>=sizeof(part) || path[0]!='/' || strstr(path,"//") ||
      strstr(path,"/../") || strstr(path,"/./")) return false;
  memcpy(part,path,length+1);
  if (!trusted("/",true,false,true)) return false;
  for (size_t i=1;i<length;i++) if (part[i]=='/') {
    part[i]=0;
#ifdef VAEROEX_LAUNCHER_SYNTHETIC_ONLY
    /* Local fixtures use a private mkdtemp under the shared temporary root.
     * Only that root may be writable; it must be root-owned and sticky. */
    struct stat st;
    bool temporary = (!strcmp(part,"/tmp") || !strcmp(part,"/private/tmp")) &&
      !lstat(part,&st) && S_ISDIR(st.st_mode) && st.st_uid==0 && (st.st_mode&S_ISVTX);
    if (!temporary && !trusted(part,true,false,true)) return false;
#else
    if (!trusted(part,true,false,true)) return false;
#endif
    part[i]='/';
  }
  return true;
}
static bool installation(void) {
  /* Synthetic runners may use a root-owned packaged Node; production's owner
   * is already root, so this does not widen the installed trust boundary. */
  if (!parents(NODE_PATH) || !trusted(NODE_PATH,false,true,true) ||
      !parents(INSTALL_PATH) || !trusted(INSTALL_PATH,true,false,false) ||
      !trusted(SCRIPT_PATH,false,false,false)) return false;
  DIR *directory=opendir(INSTALL_PATH);
  if (!directory) return false;
  bool ok=true;
  struct dirent *entry;
  for (;;) {
    errno=0;entry=readdir(directory);
    if (!entry) {if(errno)ok=false;break;}
    if (!strcmp(entry->d_name,".") || !strcmp(entry->d_name,"..")) continue;
    char path[PATH_MAX];
    int n=snprintf(path,sizeof(path),"%s/%s",INSTALL_PATH,entry->d_name);
    /* The installation is deliberately flat: imports, native binary and hash
     * file must all be immutable to non-root operators; no symlink imports. */
    if (n<0 || (size_t)n>=sizeof(path) || !trusted(path,false,false,false)) {ok=false;break;}
  }
  if (closedir(directory)) ok=false;
  return ok;
}
static bool token(const char *value) {
  size_t n=strlen(value);
  if (!n || n>80) return false;
  for(size_t i=0;i<n;i++) if (!((value[i]>='a' && value[i]<='z') ||
    (value[i]>='A' && value[i]<='Z') || (value[i]>='0' && value[i]<='9') ||
    value[i]=='_' || value[i]=='-')) return false;
  return true;
}
static bool digits(const char *value,size_t minimum,size_t maximum) {
  size_t n=strlen(value);
  if(n<minimum || n>maximum || (n>1 && value[0]=='0')) return false;
  for(size_t i=0;i<n;i++) if(value[i]<'0' || value[i]>'9')return false;
  return true;
}
static bool arguments(int argc,char **argv) {
  if(argc!=6 || (strcmp(argv[1],"create") && strcmp(argv[1],"rotate") && strcmp(argv[1],"recover")) ||
    !digits(argv[2],1,10) || !token(argv[3]) || !token(argv[4]) || !digits(argv[5],13,13))return false;
  return !strcmp(argv[1],"create") ? !strcmp(argv[2],"0") : strcmp(argv[2],"0")!=0;
}
static bool close_private_descriptors(void) {
#ifdef __linux__
  return syscall(SYS_close_range,3U,~0U,0)==0;
#else
  /* Test-only macOS path; no production fallback to an unbounded descriptor loop. */
  struct rlimit limit;
  if(getrlimit(RLIMIT_NOFILE,&limit) || limit.rlim_cur>1048576)return false;
  for(int fd=3;fd<(int)limit.rlim_cur;fd++)close(fd);
  return true;
#endif
}
int main(int argc,char **argv) {
  struct rlimit zero={0,0};
  if(getuid()!=owner() || geteuid()!=owner() || !arguments(argc,argv) ||
    setrlimit(RLIMIT_CORE,&zero) || !installation() || !close_private_descriptors())return deny();
  char *const clean[]={"PATH=/usr/bin:/bin","LANG=C","LC_ALL=C",NULL};
  char *const child[]={NODE_PATH,SCRIPT_PATH,argv[1],argv[2],argv[3],argv[4],argv[5],NULL};
  execve(NODE_PATH,child,clean);
  return deny();
}
