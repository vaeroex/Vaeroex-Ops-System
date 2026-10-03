/* Test-only translation unit. Existing fake libpq/libcurl supply every network
 * symbol; this executable has no provider transport and accepts synthetic input. */
#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>
#include <curl/curl.h>
#ifndef ENTRY_ADMIN
#include <libpq-fe.h>
#endif

static const char *entry_case;
static time_t entry_now = 1000;
static unsigned entry_reads, entry_selects, entry_network_calls;
static int entry_clock(clockid_t, struct timespec *);
static int entry_select(int, fd_set *, fd_set *, fd_set *, struct timeval *);
static ssize_t entry_read(int, void *, size_t);
static CURLcode entry_perform(CURL *);
#ifndef ENTRY_ADMIN
static PGconn *entry_connect(const char *const *, const char *const *, int);
#endif
#define main entry_native_main
#define clock_gettime entry_clock
#define select entry_select
#define read entry_read
#define curl_easy_perform entry_perform
#ifndef ENTRY_ADMIN
#define PQconnectStartParams entry_connect
#endif
#include ENTRY_SOURCE
#undef main
#undef clock_gettime
#undef select
#undef read
#undef curl_easy_perform
#ifndef ENTRY_ADMIN
#undef PQconnectStartParams
#endif

static int same(const char *name) { return !strcmp(entry_case, name); }
static int successful(void) { return same("after_sixty") || same("before_limit"); }
static int entry_clock(clockid_t id, struct timespec *out) {
  assert(id == CLOCK_MONOTONIC);
  /* Before the private reader calculates its cap, impose an already shorter
   * process deadline. This changes test state, not the approved executable. */
  if ((same("earlier_deadline") || same("ready_after_deadline")) && tty_changed) deadline = 1120;
  out->tv_sec = entry_now; out->tv_nsec = 0; return 0;
}
static int entry_select(int nfds, fd_set *reads, fd_set *writes,
                        fd_set *excepts, struct timeval *wait) {
  assert(!writes && !excepts && wait && nfds == tty + 1);
  struct termios current;
  assert(!tcgetattr(tty, &current));
  if (tty_changed) {
    assert(!(current.c_lflag & (ECHO | ECHONL | ICANON)));
    /* Advance only after the parent has delivered its synthetic input. Without
     * this handshake an immediate simulated expiry could restore echo before
     * the test driver writes, testing a harness race instead of the reader. */
    fd_set ready = *reads;
    struct timeval bound = *wait;
    int available = select(nfds, &ready, NULL, NULL, &bound);
    if (available <= 0) return available;
    ++entry_selects;
    if (same("after_sixty") && entry_selects == 1) { entry_now = 1061; return 0; }
    if (same("before_limit") && entry_selects == 1) { entry_now = 1299; return 0; }
    if (same("at_limit")) { entry_now = 1300; return 0; }
    if (same("ready_at_limit")) { entry_now = 1300; return 1; }
    if (same("ready_after_deadline")) { entry_now = 1121; return 1; }
    if (same("earlier_deadline")) { entry_now = 1120; return 0; }
    if (same("partial_timeout") && entry_reads >= 6) { entry_now = 1300; return 0; }
    if (same("rolling_input")) {
      time_t next = 1000 + (time_t)(entry_reads + 1) * 40;
      if (next != entry_now) { entry_now = next; return 0; }
    }
    if (same("cancel_partial") && entry_reads >= 6) { interrupted = 1; return 0; }
  }
  return select(nfds, reads, writes, excepts, wait);
}
static ssize_t entry_read(int fd, void *buffer, size_t size) {
  assert(fd == tty && size == 1);
  ssize_t result = read(fd, buffer, size);
  if (result == 1 && tty_changed) ++entry_reads;
  return result;
}
static CURLcode entry_perform(CURL *http) {
  ++entry_network_calls;
  assert(successful());
  return curl_easy_perform(http);
}
#ifndef ENTRY_ADMIN
static PGconn *entry_connect(const char *const *keys, const char *const *values, int expand) {
  ++entry_network_calls;
  assert(successful());
  return PQconnectStartParams(keys, values, expand);
}
#endif
int main(int argc, char **argv) {
  assert(argc == 2); entry_case = argv[1];
  assert(same("after_sixty") || same("at_limit") || same("earlier_deadline") ||
         same("before_limit") || same("ready_at_limit") || same("ready_after_deadline") ||
         same("partial_timeout") || same("rolling_input") ||
         same("cancel_partial") || same("invalid_input"));
  struct termios before, after;
  assert(!tcgetattr(STDIN_FILENO, &before));
#ifdef ENTRY_ADMIN
  char *native[] = {"synthetic-admin", "1788883600", NULL};
  int result = entry_native_main(2, native);
  const unsigned char *private_bytes = (const unsigned char *)&private_memory;
  size_t private_size = sizeof private_memory;
#else
  char *native[] = {"synthetic-runner", "probe", "12345", NULL};
  int result = entry_native_main(3, native);
  const unsigned char *private_bytes = (const unsigned char *)&sensitive;
  size_t private_size = sizeof sensitive;
#endif
  assert(!tcgetattr(STDIN_FILENO, &after));
  assert(after.c_lflag == before.c_lflag && !tty_changed);
  for (size_t i = 0; i < private_size; ++i) assert(!private_bytes[i]);
  if (!successful()) { assert(result != 0); assert(!entry_network_calls); }
  if (same("ready_at_limit") || same("ready_after_deadline")) assert(!entry_reads);
  if (same("rolling_input")) assert(entry_reads < 8);
  puts("entry_test_wipe_tty_and_call_boundary_pass");
  return result;
}
