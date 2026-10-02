#define _GNU_SOURCE
#include "protocol.h"
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <linux/capability.h>
#include <linux/magic.h>
#include <poll.h>
#include <pwd.h>
#include <sched.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#ifndef PROJECT_BUILD
#error PROJECT_BUILD must be the verified source digest
#endif
#if __BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__
#error Unsupported record byte order
#endif

static void refuse(const char *code) {
    fprintf(stderr, "SAKURA_PROJECT_IDENTITY:%s\n", code);
    exit(126);
}
static bool hex(const char *p, size_t size) {
    for (size_t i = 0; i < size; ++i)
        if (!((p[i] >= '0' && p[i] <= '9') || (p[i] >= 'a' && p[i] <= 'f'))) return false;
    return p[size] == 0;
}
static bool uuid(const char *p) {
    if (strlen(p) != 36) return false;
    for (size_t i = 0; i < 36; ++i) {
        if (i == 8 || i == 13 || i == 18 || i == 23) { if (p[i] != '-') return false; }
        else if (!((p[i] >= '0' && p[i] <= '9') || (p[i] >= 'a' && p[i] <= 'f'))) return false;
    }
    return true;
}
static bool project_id(const char *p) { return !strcmp(p, "default") || (strlen(p) == 16 && hex(p, 16)); }
static bool zero(const void *p, size_t size) {
    const unsigned char *b = p;
    for (size_t i = 0; i < size; ++i) if (b[i]) return false;
    return true;
}
static bool fixed_string(const char *p, size_t size) {
    const char *end = memchr(p, 0, size);
    return end && zero(end, size - (size_t)(end - p));
}
static void path(char *out, size_t size, const char *format, const char *a, const char *b) {
    int n = snprintf(out, size, format, a, b);
    if (n < 0 || (size_t)n >= size) refuse("PATH_BOUND");
}
static void trusted(const struct stat *s, bool directory) {
    if ((directory ? !S_ISDIR(s->st_mode) : !S_ISREG(s->st_mode)) || s->st_uid != 0 || (s->st_mode & 022))
        refuse("UNTRUSTED_RECORD");
}
/* Walk every component: O_NOFOLLOW on a final filename alone does not protect
 * a privileged program from a substituted parent directory. */
static int open_directory(const char *name, bool root_owned) {
    if (name[0] != '/' || strlen(name) > 1023) refuse("DIRECTORY_PATH");
    char copy[1024]; strcpy(copy, name);
    int fd = open("/", O_PATH | O_DIRECTORY | O_CLOEXEC);
    if (fd < 0) refuse("DIRECTORY_OPEN");
    char *save = NULL;
    for (char *part = strtok_r(copy + 1, "/", &save); part; part = strtok_r(NULL, "/", &save)) {
        if (!strcmp(part, ".") || !strcmp(part, "..")) refuse("DIRECTORY_PATH");
        int next = openat(fd, part, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        if (next < 0) refuse(root_owned ? "UNTRUSTED_DIRECTORY" : "DIRECTORY_MIGRATION_REQUIRED");
        close(fd); fd = next;
        struct stat s;
        if (fstat(fd, &s) || !S_ISDIR(s.st_mode)) refuse("DIRECTORY_REPLACED");
        if (root_owned) trusted(&s, true);
    }
    return fd;
}
static int record_fd(const char *name) {
    char copy[1024];
    if (strlen(name) >= sizeof(copy)) refuse("PATH_BOUND");
    strcpy(copy, name);
    char *slash = strrchr(copy, '/');
    if (!slash || !slash[1]) refuse("RECORD_PATH");
    *slash = 0;
    int parent = open_directory(copy, true);
    int fd = openat(parent, slash + 1, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    close(parent);
    if (fd < 0) refuse("RECORD_ABSENT");
    struct stat s;
    if (fstat(fd, &s)) refuse("RECORD_STAT");
    trusted(&s, false);
    if ((s.st_mode & 0777) != 0600 || s.st_nlink != 1) refuse("RECORD_PERMISSIONS");
    return fd;
}
static void record(const char *name, void *out, size_t size) {
    int fd = record_fd(name);
    struct stat s;
    if (fstat(fd, &s) || s.st_size != (off_t)size) refuse("RECORD_SIZE");
    size_t done = 0;
    while (done < size) {
        ssize_t n = read(fd, (char *)out + done, size - done);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) refuse("RECORD_READ");
        done += (size_t)n;
    }
    close(fd);
}
static void network_ready(const struct sk_binding *b) {
    int parent = open_directory(SK_ID_RUNTIME "/networks", true);
    char name[64]; path(name, sizeof(name), "%s%s.release.bin", b->project, "");
    int fd = openat(parent, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW); int saved_errno = errno; close(parent);
    if (fd < 0) { if (saved_errno == ENOENT) return; refuse("NETWORK_GUARD_INVALID"); }
    struct sk_network_guard guard; struct stat s;
    if (fstat(fd, &s)) refuse("NETWORK_GUARD_INVALID");
    trusted(&s, false);
    if ((s.st_mode & 0777) != 0600 || s.st_nlink != 1 || s.st_size != (off_t)sizeof(guard)) refuse("NETWORK_GUARD_INVALID");
    size_t done = 0;
    while (done < sizeof(guard)) {
        ssize_t n = read(fd, (char *)&guard + done, sizeof(guard) - done);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) refuse("NETWORK_GUARD_INVALID");
        done += (size_t)n;
    }
    close(fd);
    if (memcmp(guard.magic, "SKIDN001", 8) || guard.version != 1 ||
        guard.flags < SK_NETWORK_PENDING || guard.flags > SK_NETWORK_RELEASED || !guard.revision || !guard.network_inode ||
        !fixed_string(guard.registry, sizeof(guard.registry)) || !fixed_string(guard.identity, sizeof(guard.identity)) ||
        !fixed_string(guard.project, sizeof(guard.project)) || !fixed_string(guard.boot, sizeof(guard.boot)) ||
        !fixed_string(guard.generation, sizeof(guard.generation)) || !fixed_string(guard.release, sizeof(guard.release)) ||
        !uuid(guard.registry) || !uuid(guard.identity) || !project_id(guard.project) || !uuid(guard.boot) ||
        !uuid(guard.generation) || !uuid(guard.release) || !zero(guard.reserved, sizeof(guard.reserved))) refuse("NETWORK_GUARD_INVALID");
    if (strcmp(guard.registry, b->registry) || strcmp(guard.identity, b->identity) || strcmp(guard.project, b->project) ||
        guard.revision != b->revision || b->network != SK_NETWORK_PRIVATE) refuse("NETWORK_GUARD_STALE");
    if (guard.flags != SK_NETWORK_RELEASED) refuse("NETWORK_RETIREMENT_PENDING");
}
static void locked(int fd) {
    const struct timespec pause = {0, 10000000};
    for (int i = 0; i < 1000; ++i) {
        if (!flock(fd, LOCK_SH | LOCK_NB)) return;
        if (errno != EINTR && errno != EWOULDBLOCK) refuse("REGISTRY_LOCK");
        nanosleep(&pause, NULL);
    }
    refuse("REGISTRY_BUSY");
}
static void boot_id(char out[37]) {
    int fd = open("/proc/sys/kernel/random/boot_id", O_RDONLY | O_CLOEXEC);
    char raw[38] = {0};
    if (fd < 0 || read(fd, raw, 37) != 37) refuse("BOOT_ID");
    close(fd); raw[36] = 0;
    if (!uuid(raw)) refuse("BOOT_ID");
    memcpy(out, raw, 37);
}
static bool same_stat(const struct stat *s, uint64_t device, uint64_t inode) {
    return (uint64_t)s->st_dev == device && (uint64_t)s->st_ino == inode;
}
static void current_cgroup(char out[64]) {
    int fd = open("/proc/self/cgroup", O_RDONLY | O_CLOEXEC);
    char raw[4097];
    ssize_t n = fd < 0 ? -1 : read(fd, raw, sizeof(raw) - 1);
    if (fd >= 0) close(fd);
    if (n < 6 || n >= (ssize_t)sizeof(raw) - 1) refuse("CGROUP_MEMBERSHIP");
    raw[n] = 0;
    if (strncmp(raw, "0::/", 4) || raw[n - 1] != '\n' || memchr(raw, '\n', (size_t)n - 1))
        refuse("CGROUP_MEMBERSHIP");
    raw[n - 1] = 0;
    if (strlen(raw + 4) >= 64) refuse("CGROUP_MEMBERSHIP");
    strcpy(out, raw + 4);
}
static bool cgroup_name(const struct sk_run *r, const struct sk_binding *b) {
    if (r->mode == SK_RUN_INDEPENDENT) {
        char expected[64]; path(expected, sizeof(expected), "sakura-identity-%s%s", r->run, "");
        return !strcmp(r->cgroup, expected);
    }
    const char *prefixes[] = {"sakura-task-", "sakura-main-", "sakura-service-"};
    for (size_t i = 0; i < 3; ++i) {
        size_t n = strlen(prefixes[i]);
        if (!strncmp(r->cgroup, prefixes[i], n) && uuid(r->cgroup + n)) return true;
    }
    char expected[64]; path(expected, sizeof(expected), "openrc.sakura-ssh-%s%s", b->project, "");
    if (!strcmp(r->cgroup, expected)) return true;
    path(expected, sizeof(expected), "system.slice/sakura-ssh-%s.service", b->project, "");
    return !strcmp(r->cgroup, expected);
}
static int cgroup_directory(const char *name) {
    char copy[64];
    if (!name[0] || name[0] == '/' || strlen(name) >= sizeof(copy)) refuse("CGROUP_REPLACED");
    strcpy(copy, name);
    int fd = open_directory("/sys/fs/cgroup", true);
    for (char *part = copy;;) {
        char *slash = strchr(part, '/');
        if (slash) *slash = 0;
        if (!part[0] || !strcmp(part, ".") || !strcmp(part, "..")) refuse("CGROUP_REPLACED");
        int next = openat(fd, part, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
        close(fd); fd = next;
        struct stat s;
        if (fd < 0 || fstat(fd, &s)) refuse("CGROUP_REPLACED");
        trusted(&s, true);
        if (!slash) return fd;
        part = slash + 1;
    }
}
static void validate_binding(const struct sk_binding *b, const char *project) {
    if (memcmp(b->magic, "SKIDB001", 8) || b->version != SK_ID_VERSION || b->flags != SK_ID_ACTIVE ||
        b->uid < 20000 || b->uid > 59999 || b->gid != b->uid || !b->revision ||
        b->network > SK_NETWORK_PRIVATE || !zero(b->reserved, sizeof(b->reserved))) refuse("BINDING_INVALID");
#define FIELD(f) if (!fixed_string(b->f, sizeof(b->f))) refuse("BINDING_STRING")
    FIELD(registry); FIELD(project); FIELD(account); FIELD(identity); FIELD(home); FIELD(directory);
#undef FIELD
    if (!uuid(b->registry) || !uuid(b->identity) || !project_id(b->project) || strcmp(b->project, project))
        refuse("BINDING_IDENTITY");
    char account[32], home[256];
    char compact[33]; size_t done = 0;
    for (size_t i = 0; i < 36; ++i) if (b->identity[i] != '-') compact[done++] = b->identity[i];
    compact[32] = 0;
    snprintf(account, sizeof(account), "skp%.24s", compact);
    path(home, sizeof(home), SK_ID_HOMES "/%s%s", b->identity, "");
    if (strcmp(account, b->account) || strcmp(home, b->home)) refuse("ACCOUNT_BINDING");
    struct passwd *p = getpwnam(b->account);
    if (!p || p->pw_uid != b->uid || p->pw_gid != b->gid || strcmp(p->pw_dir, b->home) || strcmp(p->pw_shell, "/bin/sh"))
        refuse("ACCOUNT_REPLACED");
    p = getpwuid(b->uid);
    if (!p || strcmp(p->pw_name, b->account)) refuse("UID_REPLACED");
    struct group *g = getgrgid(b->gid);
    if (!g || strcmp(g->gr_name, b->account) || (g->gr_mem && g->gr_mem[0] &&
        (strcmp(g->gr_mem[0], b->account) || g->gr_mem[1]))) refuse("GROUP_REPLACED");
    gid_t groups[128]; int count = 128;
    if (getgrouplist(b->account, b->gid, groups, &count) < 0 || count < 1 || count > 128)
        refuse("SUPPLEMENTARY_GROUP_CHANGED");
    /* musl may include the primary gid again when /etc/group explicitly lists
     * its own user. Repeated copies grant no additional group permission. */
    for (int i = 0; i < count; ++i) if (groups[i] != b->gid) refuse("SUPPLEMENTARY_GROUP_CHANGED");
    int parent = open_directory(SK_ID_HOMES, true);
    int home_fd = openat(parent, b->identity, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    close(parent);
    struct stat s;
    if (home_fd < 0 || fstat(home_fd, &s) || !same_stat(&s, b->home_device, b->home_inode) || s.st_uid != b->uid ||
        s.st_gid != b->gid || (s.st_mode & 0777) != 0700) refuse("HOME_REPLACED");
    close(home_fd);
}
static void validate_run(const struct sk_run *r, const struct sk_binding *b, const char *run) {
    if (memcmp(r->magic, "SKIDR001", 8) || r->version != SK_ID_VERSION || r->flags != SK_RUN_ACTIVE ||
        (r->mode != SK_RUN_INDEPENDENT && r->mode != SK_RUN_INHERIT) || r->reserved_word ||
        !zero(r->reserved, sizeof(r->reserved))) refuse("RUN_CLOSED_OR_INVALID");
#define FIELD(f) if (!fixed_string(r->f, sizeof(r->f))) refuse("RUN_STRING")
    FIELD(registry); FIELD(identity); FIELD(project); FIELD(run); FIELD(boot); FIELD(build); FIELD(cgroup); FIELD(namespace_name);
#undef FIELD
    char boot[37]; boot_id(boot);
    if (strcmp(r->registry, b->registry) || strcmp(r->identity, b->identity) || strcmp(r->project, b->project) ||
        strcmp(r->run, run) || !uuid(r->run) || r->revision != b->revision || strcmp(r->boot, boot) ||
        strcmp(r->build, PROJECT_BUILD) || !cgroup_name(r, b)) refuse("RUN_IDENTITY");
    char namespace_name[32] = "";
    if (b->network == SK_NETWORK_PRIVATE) path(namespace_name, sizeof(namespace_name), "sk-%s%s", b->project, "");
    if (strcmp(r->namespace_name, namespace_name)) refuse("NETWORK_BINDING");
}
static void native_image(void) {
    char expected[1024], actual[1024];
    path(expected, sizeof(expected), SK_ID_BUILDS "/%s/%s", PROJECT_BUILD, "launch");
    ssize_t n = readlink("/proc/self/exe", actual, sizeof(actual) - 1);
    if (n < 0 || n >= (ssize_t)sizeof(actual) - 1) refuse("LAUNCHER_IMAGE");
    actual[n] = 0;
    if (strcmp(actual, expected)) refuse("LAUNCHER_IMAGE");
    char directory[1024]; path(directory, sizeof(directory), SK_ID_BUILDS "/%s%s", PROJECT_BUILD, "");
    int parent = open_directory(directory, true);
    int fd = openat(parent, "launch", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    close(parent);
    struct stat a, s;
    if (fd < 0 || fstat(fd, &s) || stat("/proc/self/exe", &a)) refuse("LAUNCHER_IMAGE");
    trusted(&s, false);
    if (s.st_nlink != 1 || (s.st_mode & 07777) != 04755 || !same_stat(&a, (uint64_t)s.st_dev, (uint64_t)s.st_ino))
        refuse("LAUNCHER_IMAGE");
    close(fd);
}
static void capabilities_drop(uint32_t uid, uint32_t gid) {
    if (prctl(PR_SET_KEEPCAPS, 0L, 0L, 0L, 0L) || prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0L, 0L, 0L))
        refuse("CAPABILITIES_DROP");
    for (int cap = 0; cap < 64; ++cap) {
        if (prctl(PR_CAPBSET_DROP, cap, 0L, 0L, 0L) && errno != EINVAL) refuse("CAPABILITIES_BOUNDING");
    }
    if (setgroups(0, NULL) || setresgid(gid, gid, gid) || setresuid(uid, uid, uid)) refuse("ACCOUNT_DROP");
    struct __user_cap_header_struct header = {_LINUX_CAPABILITY_VERSION_3, 0};
    struct __user_cap_data_struct data[2] = {{0, 0, 0}, {0, 0, 0}};
    if (syscall(SYS_capset, &header, data) || prctl(PR_SET_NO_NEW_PRIVS, 1L, 0L, 0L, 0L)) refuse("NO_NEW_PRIVILEGES");
    uid_t real_uid, effective_uid, saved_uid; gid_t real_gid, effective_gid, saved_gid;
    if (getresuid(&real_uid, &effective_uid, &saved_uid) || getresgid(&real_gid, &effective_gid, &saved_gid) ||
        real_uid != uid || effective_uid != uid || saved_uid != uid || real_gid != gid || effective_gid != gid ||
        saved_gid != gid || getgroups(0, NULL) != 0 || syscall(SYS_capget, &header, data) ||
        !zero(data, sizeof(data)) || prctl(PR_GET_NO_NEW_PRIVS, 0L, 0L, 0L, 0L) != 1) refuse("ACCOUNT_DROP_VERIFY");
}
static bool session_input_valid(void) {
    struct stat s;
    int flags = fcntl(3, F_GETFL);
    return flags >= 0 && !(flags & O_PATH) &&
        ((flags & O_ACCMODE) == O_RDONLY || (flags & O_ACCMODE) == O_RDWR) &&
        !fstat(3, &s) && (S_ISFIFO(s.st_mode) || S_ISSOCK(s.st_mode) || (S_ISCHR(s.st_mode) && isatty(3)));
}
static void close_extra_fds_except(int preserve, bool keep_session) {
#ifdef SYS_close_range
    unsigned start = keep_session ? 4u : 3u;
    bool first = preserve <= (int)start || !syscall(SYS_close_range, start, (unsigned)preserve - 1u, 0u);
    bool second = !syscall(SYS_close_range, preserve < (int)start ? start : (unsigned)preserve + 1u, ~0u, 0u);
    if (first && second) return;
    if (errno != ENOSYS && errno != EINVAL) refuse("FD_CLEANUP");
#endif
    long limit = sysconf(_SC_OPEN_MAX);
    if (limit < 0 || limit > 1048576) refuse("FD_BOUND");
    for (int fd = 3; fd < limit; ++fd) if (fd != preserve && (!keep_session || fd != 3)) close(fd);
}
static uint32_t rotate(uint32_t v, unsigned n) { return (v >> n) | (v << (32u - n)); }
static void sha_block(uint32_t state[8], const unsigned char block[64]) {
    static const uint32_t constants[64] = {
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    };
    uint32_t words[64];
    for (size_t i = 0; i < 16; ++i) words[i] = ((uint32_t)block[i*4] << 24) | ((uint32_t)block[i*4+1] << 16) |
        ((uint32_t)block[i*4+2] << 8) | block[i*4+3];
    for (size_t i = 16; i < 64; ++i) {
        uint32_t x = words[i-15], y = words[i-2];
        words[i] = words[i-16] + (rotate(x,7)^rotate(x,18)^(x>>3)) + words[i-7] + (rotate(y,17)^rotate(y,19)^(y>>10));
    }
    uint32_t a=state[0],b=state[1],c=state[2],d=state[3],e=state[4],f=state[5],g=state[6],h=state[7];
    for (size_t i = 0; i < 64; ++i) {
        uint32_t one = h + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + ((e&f)^(~e&g)) + constants[i] + words[i];
        uint32_t two = (rotate(a,2)^rotate(a,13)^rotate(a,22)) + ((a&b)^(a&c)^(b&c));
        h=g;g=f;f=e;e=d+one;d=c;c=b;b=a;a=one+two;
    }
    state[0]+=a;state[1]+=b;state[2]+=c;state[3]+=d;state[4]+=e;state[5]+=f;state[6]+=g;state[7]+=h;
}
static void sha256(const unsigned char *data, size_t size, char result[65]) {
    uint32_t state[8] = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    size_t done = 0;
    while (size - done >= 64) { sha_block(state,data+done); done += 64; }
    unsigned char tail[128] = {0}; size_t remaining = size - done;
    memcpy(tail,data+done,remaining); tail[remaining] = 0x80;
    size_t padded = remaining < 56 ? 64 : 128; uint64_t bits = (uint64_t)size * 8;
    for (size_t i = 0; i < 8; ++i) tail[padded-1-i] = (unsigned char)(bits >> (i*8));
    sha_block(state,tail); if (padded == 128) sha_block(state,tail+64);
    static const char digits[] = "0123456789abcdef";
    for (size_t i = 0; i < 32; ++i) {
        unsigned char v = (unsigned char)(state[i/4] >> (24-(i%4)*8));
        result[i*2]=digits[v>>4]; result[i*2+1]=digits[v&15];
    }
    result[64]=0;
}
static bool utf8(const unsigned char *text, size_t size) {
    for (size_t i = 0; i < size;) {
        unsigned char a=text[i++]; if (!a) return false;
        if (a < 0x80) continue;
        unsigned count; uint32_t value, minimum;
        if (a >= 0xc2 && a <= 0xdf) { count=1;value=a&31;minimum=0x80; }
        else if (a >= 0xe0 && a <= 0xef) { count=2;value=a&15;minimum=0x800; }
        else if (a >= 0xf0 && a <= 0xf4) { count=3;value=a&7;minimum=0x10000; }
        else return false;
        if (size - i < count) return false;
        for (unsigned n=0;n<count;++n) { unsigned char b=text[i++]; if ((b&0xc0)!=0x80) return false; value=(value<<6)|(b&63); }
        if (value<minimum || value>0x10ffff || (value>=0xd800 && value<=0xdfff)) return false;
    }
    return true;
}
static long long milliseconds(void) {
    struct timespec now; if (clock_gettime(CLOCK_MONOTONIC,&now)) refuse("PAYLOAD_CLOCK");
    return (long long)now.tv_sec*1000 + now.tv_nsec/1000000;
}
struct payload {
    unsigned char *wire;
    size_t wire_size, script_size;
    unsigned environment_count, flags;
    char *keys[SK_PAYLOAD_ENV_LIMIT], *values[SK_PAYLOAD_ENV_LIMIT];
};
static uint32_t little(const unsigned char *p) { return p[0]|((uint32_t)p[1]<<8)|((uint32_t)p[2]<<16)|((uint32_t)p[3]<<24); }
static struct payload payload_read(const char *expected, bool session_input) {
    struct payload value = {0}; struct stat input_info;
    if (fstat(STDIN_FILENO,&input_info) || (!S_ISFIFO(input_info.st_mode) && !S_ISSOCK(input_info.st_mode))) refuse("PAYLOAD_INPUT_TYPE");
    int flags=fcntl(STDIN_FILENO,F_GETFL);
    if (flags<0 || fcntl(STDIN_FILENO,F_SETFL,flags|O_NONBLOCK)) refuse("PAYLOAD_INPUT");
    value.wire=malloc(SK_PAYLOAD_LIMIT+1u); if (!value.wire) refuse("PAYLOAD_MEMORY");
    long long deadline=milliseconds()+SK_PAYLOAD_TIMEOUT_MS;
    for (;;) {
        long long remaining=deadline-milliseconds(); if (remaining<=0) refuse("PAYLOAD_TIMEOUT");
        struct pollfd fd={STDIN_FILENO,POLLIN,0}; int ready=poll(&fd,1,(int)remaining);
        if (ready<0 && errno==EINTR) continue;
        if (ready<=0) refuse(ready==0?"PAYLOAD_TIMEOUT":"PAYLOAD_INPUT");
        ssize_t n=read(STDIN_FILENO,value.wire+value.wire_size,SK_PAYLOAD_LIMIT+1u-value.wire_size);
        if (n<0 && (errno==EINTR || errno==EAGAIN || errno==EWOULDBLOCK)) continue;
        if (n<0) refuse("PAYLOAD_INPUT");
        if (!n) break;
        value.wire_size+=(size_t)n; if (value.wire_size>SK_PAYLOAD_LIMIT) refuse("PAYLOAD_BOUND");
    }
    if (value.wire_size<sizeof(struct sk_payload_header)) refuse("PAYLOAD_TRUNCATED");
    struct sk_payload_header header; memcpy(&header,value.wire,sizeof(header));
    if (memcmp(header.magic,"SKIDP001",8) || header.version!=SK_PAYLOAD_VERSION ||
        (header.flags && header.flags!=SK_PAYLOAD_TERMINAL && header.flags!=SK_PAYLOAD_SESSION) || header.reserved)
        refuse("PAYLOAD_HEADER");
    if (header.body_size!=value.wire_size-sizeof(header)) refuse("PAYLOAD_LENGTH");
    if (!header.script_size || header.script_size>SK_PAYLOAD_TEXT_LIMIT || header.script_size>header.body_size ||
        header.environment_count>SK_PAYLOAD_ENV_LIMIT) refuse("PAYLOAD_BOUND");
    char actual[65]; sha256(value.wire,value.wire_size,actual);
    if (strcmp(actual,expected)) refuse("PAYLOAD_DIGEST");
    if (!utf8(value.wire+sizeof(header),header.script_size)) refuse("PAYLOAD_UTF8");
    value.script_size=header.script_size; value.environment_count=header.environment_count; value.flags=header.flags;
    if (value.flags & SK_PAYLOAD_TERMINAL) {
        struct stat terminal_info;
        int terminal_flags=fcntl(STDOUT_FILENO,F_GETFL);
        if (terminal_flags<0 || (terminal_flags&O_ACCMODE)!=O_RDWR ||
            fstat(STDOUT_FILENO,&terminal_info) || !S_ISCHR(terminal_info.st_mode) ||
            !isatty(STDOUT_FILENO)) refuse("PAYLOAD_TERMINAL_REQUIRED");
    }
    if ((value.flags & SK_PAYLOAD_SESSION) && (!session_input || !session_input_valid()))
        refuse("PAYLOAD_SESSION_REQUIRED");
    size_t offset=sizeof(header)+header.script_size, total=header.script_size;
    for (unsigned i=0;i<header.environment_count;++i) {
        if (value.wire_size-offset<8) refuse("PAYLOAD_LENGTH");
        uint32_t key_size=little(value.wire+offset), content_size=little(value.wire+offset+4); offset+=8;
        if (!key_size || key_size>128 || content_size>SK_PAYLOAD_ENTRY_LIMIT ||
            (size_t)key_size+1+content_size>SK_PAYLOAD_ENTRY_LIMIT || (size_t)key_size+content_size>value.wire_size-offset)
            refuse("PAYLOAD_ENVIRONMENT_BOUND");
        const unsigned char *key=value.wire+offset, *content=key+key_size;
        for (uint32_t n=0;n<key_size;++n) if (!((key[n]>='A'&&key[n]<='Z')||(key[n]>='a'&&key[n]<='z')||key[n]=='_'||
            (n && key[n]>='0'&&key[n]<='9'))) refuse("PAYLOAD_ENVIRONMENT_NAME");
        if (!utf8(content,content_size)) refuse("PAYLOAD_UTF8");
        value.keys[i]=malloc(key_size+1u); value.values[i]=malloc(content_size+1u);
        if (!value.keys[i] || !value.values[i]) refuse("PAYLOAD_MEMORY");
        memcpy(value.keys[i],key,key_size); value.keys[i][key_size]=0;
        memcpy(value.values[i],content,content_size); value.values[i][content_size]=0;
        if (!strcmp(value.keys[i],"HOME") || !strcmp(value.keys[i],"USER") || !strcmp(value.keys[i],"LOGNAME")) refuse("PAYLOAD_ENVIRONMENT_IDENTITY");
        for (unsigned previous=0;previous<i;++previous) if (!strcmp(value.keys[i],value.keys[previous])) refuse("PAYLOAD_ENVIRONMENT_DUPLICATE");
        total+=(size_t)key_size+1+content_size; if (total>SK_PAYLOAD_TEXT_LIMIT) refuse("PAYLOAD_BOUND");
        offset+=(size_t)key_size+content_size;
    }
    if (offset!=value.wire_size) refuse("PAYLOAD_TRAILING");
    return value;
}
static void wipe(void *buffer, size_t size) { volatile unsigned char *p=buffer; while (size--) *p++=0; }
static void payload_exec(struct payload *value) {
    if (value->flags & SK_PAYLOAD_SESSION) {
        if (dup2(3,STDIN_FILENO)<0) refuse("PAYLOAD_STDIN");
    } else if (value->flags & SK_PAYLOAD_TERMINAL) {
        if (dup2(STDOUT_FILENO,STDIN_FILENO)<0) refuse("PAYLOAD_STDIN");
    } else {
        int input=open("/dev/null",O_RDONLY|O_CLOEXEC); if (input<0 || dup2(input,STDIN_FILENO)<0) refuse("PAYLOAD_STDIN");
        if (input!=STDIN_FILENO) close(input);
    }
    /* The accepted session descriptor is no longer needed after dup2. Release
     * it before the sealed script takes fd 3; no authority fd reaches exec. */
    close(3);
    int descriptor=memfd_create("sakura-project-script",MFD_CLOEXEC|MFD_ALLOW_SEALING);
    if (descriptor<0) refuse("PAYLOAD_MEMFD");
    size_t done=0;
    while (done<value->script_size) {
        ssize_t n=write(descriptor,value->wire+sizeof(struct sk_payload_header)+done,value->script_size-done);
        if (n<0 && errno==EINTR) continue;
        if (n<=0) refuse("PAYLOAD_MEMFD");
        done+=(size_t)n;
    }
    if (fchmod(descriptor,0400) || fcntl(descriptor,F_ADD_SEALS,F_SEAL_WRITE|F_SEAL_GROW|F_SEAL_SHRINK|F_SEAL_SEAL)<0)
        refuse("PAYLOAD_SEAL");
    char pathname[64]; snprintf(pathname,sizeof(pathname),"/proc/self/fd/%d",descriptor);
    int readable=open(pathname,O_RDONLY|O_CLOEXEC); if (readable<0) refuse("PAYLOAD_MEMFD");
    close(descriptor);
    for (unsigned i=0;i<value->environment_count;++i) {
        if (setenv(value->keys[i],value->values[i],1)) refuse("PROJECT_ENVIRONMENT");
        wipe(value->keys[i],strlen(value->keys[i])); wipe(value->values[i],strlen(value->values[i]));
        free(value->keys[i]);free(value->values[i]);
    }
    wipe(value->wire,value->wire_size);free(value->wire);
    if (readable!=3) { if (dup2(readable,3)<0) refuse("PAYLOAD_MEMFD"); close(readable); }
    if (fcntl(3,F_SETFD,0)) refuse("PAYLOAD_MEMFD");
    close_extra_fds_except(3, false);
    char *arguments[]={"/bin/sh","/proc/self/fd/3",NULL};
    execv(arguments[0],arguments); refuse("COMMAND_EXEC");
}
int main(int argc, char **argv) {
    /* Snapshot fd 3 before native_image/record_fd can reuse an absent fd for a
     * root authority file. Only an already-readable client channel is kept. */
    bool session_input = session_input_valid();
    uid_t caller = getuid();
    if (geteuid() != 0) refuse("ELEVATION_REQUIRED");
    if (clearenv() || setenv("PATH", "/usr/sbin:/usr/bin:/sbin:/bin", 1) || setenv("LANG", "C", 1)) refuse("CLEAN_ENVIRONMENT");
    native_image();
    int lock = record_fd(SK_ID_BASE "/lock"); locked(lock);
    const char *project, *identity = NULL, *run; uint64_t revision = 0; int index;
    struct sk_uid_map map;
    if (argc >= 4 && !strcmp(argv[1], "--self")) {
        if (!caller) refuse("ROOT_EXPLICIT_PROJECT_REQUIRED");
        char uid_path[1024], value[32]; snprintf(value, sizeof(value), "%u", (unsigned)caller);
        path(uid_path, sizeof(uid_path), SK_ID_BASE "/uids/%s%s.bin", value, ""); record(uid_path, &map, sizeof(map));
        if (memcmp(map.magic, "SKIDU001", 8) || map.version != 1 || map.uid != caller ||
            !fixed_string(map.registry, sizeof(map.registry)) || !fixed_string(map.project, sizeof(map.project)) ||
            !fixed_string(map.identity, sizeof(map.identity)) || !uuid(map.registry) || !uuid(map.identity) ||
            !project_id(map.project) || !zero(map.reserved, sizeof(map.reserved))) refuse("UID_MAPPING");
        project = map.project; identity = map.identity; run = argv[2]; index = 3;
    } else {
        if (caller || argc < 7 || strcmp(argv[1], "--project")) refuse("ROOT_OR_UID_AUTHORIZATION");
        project = argv[2]; identity = argv[3];
        char *end = NULL; errno = 0; revision = strtoull(argv[4], &end, 10);
        if (errno || !*argv[4] || !end || *end || !revision || argv[4][0] == '-') refuse("REVISION");
        run = argv[5]; index = 6;
    }
    if (!project_id(project) || !uuid(identity) || !uuid(run)) refuse("REQUEST_IDENTITY");
    char name[1024]; struct sk_binding b; struct sk_run r;
    path(name, sizeof(name), SK_ID_BASE "/projects/%s%s.bin", project, ""); record(name, &b, sizeof(b));
    validate_binding(&b, project);
    struct sk_registry registry;
    record(SK_ID_BASE "/registry.bin", &registry, sizeof(registry));
    if (memcmp(registry.magic, "SKIDG001", 8) || registry.version != 1 ||
        !fixed_string(registry.registry, sizeof(registry.registry)) || strcmp(registry.registry, b.registry) ||
        !zero(registry.reserved, sizeof(registry.reserved))) refuse("REGISTRY_REPLACED");
    char uid_path[1024], uid_value[32]; struct sk_uid_map registered;
    snprintf(uid_value, sizeof(uid_value), "%u", b.uid);
    path(uid_path, sizeof(uid_path), SK_ID_BASE "/uids/%s%s.bin", uid_value, "");
    record(uid_path, &registered, sizeof(registered));
    if (memcmp(registered.magic, "SKIDU001", 8) || registered.version != 1 || registered.uid != b.uid ||
        !fixed_string(registered.registry, sizeof(registered.registry)) || !fixed_string(registered.project, sizeof(registered.project)) ||
        !fixed_string(registered.identity, sizeof(registered.identity)) || strcmp(registered.registry, b.registry) ||
        strcmp(registered.project, b.project) || strcmp(registered.identity, b.identity) ||
        !zero(registered.reserved, sizeof(registered.reserved))) refuse("UID_MAPPING");
    if (strcmp(b.identity, identity) || (caller ? (b.uid != caller || strcmp(b.registry, map.registry)) : b.revision != revision))
        refuse("REQUEST_STALE");
    path(name, sizeof(name), SK_ID_RUNTIME "/runs/%s%s.bin", run, ""); record(name, &r, sizeof(r));
    validate_run(&r, &b, run);
    network_ready(&b);
    if (argc-index!=2 || strcmp(argv[index],"--payload") || strlen(argv[index+1])!=64 || !hex(argv[index+1],64))
        refuse("PAYLOAD_REQUIRED");
    const char *payload_sha=argv[index+1];
    int directory = open_directory(b.directory, false); struct stat s;
    if (fstat(directory, &s) || !same_stat(&s, b.directory_device, b.directory_inode)) refuse("DIRECTORY_REPLACED");
    close(directory);
    int network;
    if (b.network == SK_NETWORK_PRIVATE) {
        int parent = open_directory("/run/netns", true);
        network = openat(parent, r.namespace_name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW); close(parent);
    } else network = open("/proc/1/ns/net", O_RDONLY | O_CLOEXEC);
    struct statfs fs;
    if (network < 0 || fstat(network, &s) || !same_stat(&s, r.network_device, r.network_inode) ||
        fstatfs(network, &fs) || (unsigned long)fs.f_type != NSFS_MAGIC || s.st_uid != 0) refuse("NETWORK_REPLACED");
    int cgroup = cgroup_directory(r.cgroup);
    if (cgroup < 0 || fstat(cgroup, &s) || !same_stat(&s, r.cgroup_device, r.cgroup_inode) ||
        fstatfs(cgroup, &fs) || (unsigned long)fs.f_type != CGROUP2_SUPER_MAGIC) refuse("CGROUP_REPLACED");
    trusted(&s, true);
    if (setns(network, CLONE_NEWNET)) refuse("NETWORK_ENTER");
    close(network);
    struct stat actual;
    if (stat("/proc/self/ns/net", &actual) || !same_stat(&actual, r.network_device, r.network_inode)) refuse("NETWORK_VERIFY");
    if (r.mode == SK_RUN_INDEPENDENT) {
        int membership = openat(cgroup, "cgroup.procs", O_WRONLY | O_NOFOLLOW | O_CLOEXEC);
        char pid[32]; int n = snprintf(pid, sizeof(pid), "%ld\n", (long)getpid());
        if (membership < 0 || write(membership, pid, (size_t)n) != n) refuse("CGROUP_ENTER");
        close(membership);
    }
    char membership[64]; current_cgroup(membership);
    if (strcmp(membership, r.cgroup)) refuse("CGROUP_VERIFY");
    close(cgroup);
    // Root scope anchors may inherit cgroup.kill or control locks. Keep only
    // our own registry lock and the validated inherited session input until
    // the complete frame is accepted after dropping credentials.
    close_extra_fds_except(lock, session_input);
    capabilities_drop(b.uid, b.gid);
    directory = open_directory(b.directory, false);
    if (fstat(directory, &s) || !same_stat(&s, b.directory_device, b.directory_inode) ||
        faccessat(directory, ".", R_OK | W_OK | X_OK, AT_EACCESS) || fchdir(directory)) refuse("DIRECTORY_MIGRATION_REQUIRED");
    close(directory);
    if (clearenv() || setenv("HOME", b.home, 1) || setenv("USER", b.account, 1) || setenv("LOGNAME", b.account, 1) ||
        setenv("PATH", "/usr/local/bin:/usr/bin:/bin", 1) || setenv("LANG", "C.UTF-8", 1)) refuse("PROJECT_ENVIRONMENT");
    struct payload body=payload_read(payload_sha, session_input);
    close(lock);
    payload_exec(&body);
}
