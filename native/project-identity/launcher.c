#define _GNU_SOURCE
#include "protocol.h"
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <linux/capability.h>
#include <linux/magic.h>
#include <pwd.h>
#include <sched.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
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
    if (strlen(raw + 4) >= 64 || strchr(raw + 4, '/')) refuse("CGROUP_MEMBERSHIP");
    strcpy(out, raw + 4);
}
static bool cgroup_name(const struct sk_run *r) {
    if (r->mode == SK_RUN_INDEPENDENT) {
        char expected[64]; path(expected, sizeof(expected), "sakura-identity-%s%s", r->run, "");
        return !strcmp(r->cgroup, expected);
    }
    const char *prefixes[] = {"sakura-task-", "sakura-main-", "sakura-service-"};
    for (size_t i = 0; i < 3; ++i) {
        size_t n = strlen(prefixes[i]);
        if (!strncmp(r->cgroup, prefixes[i], n) && uuid(r->cgroup + n)) return true;
    }
    return false;
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
        strcmp(r->build, PROJECT_BUILD) || !cgroup_name(r)) refuse("RUN_IDENTITY");
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
static void close_extra_fds(void) {
#ifdef SYS_close_range
    if (!syscall(SYS_close_range, 3u, ~0u, 0u)) return;
    if (errno != ENOSYS && errno != EINVAL) refuse("FD_CLEANUP");
#endif
    long limit = sysconf(_SC_OPEN_MAX);
    if (limit < 0 || limit > 1048576) refuse("FD_BOUND");
    for (int fd = 3; fd < limit; ++fd) close(fd);
}
int main(int argc, char **argv) {
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
    char *environment[129]; int environment_count = 0; size_t argument_bytes = 0;
    while (index < argc && !strcmp(argv[index], "--env")) {
        if (++index >= argc || environment_count == 128) refuse("ENVIRONMENT_BOUND");
        char *value = argv[index++], *equals = strchr(value, '=');
        if (!equals || equals == value || (size_t)(equals - value) > 128 || strlen(value) > 8192) refuse("ENVIRONMENT_NAME");
        for (const char *p = value; p < equals; ++p)
            if (!((*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z') || (p > value && *p >= '0' && *p <= '9') || *p == '_'))
                refuse("ENVIRONMENT_NAME");
        if (!strncmp(value, "HOME=", 5) || !strncmp(value, "USER=", 5) || !strncmp(value, "LOGNAME=", 8)) refuse("ENVIRONMENT_IDENTITY");
        argument_bytes += strlen(value); environment[environment_count++] = value;
    }
    if (index >= argc || strcmp(argv[index++], "--") || index >= argc || argv[index][0] != '/' || argc - index > 128)
        refuse("COMMAND_BOUND");
    for (int i = index; i < argc; ++i) argument_bytes += strlen(argv[i]);
    if (argument_bytes > 65536) refuse("COMMAND_BOUND");
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
    int root = open_directory("/sys/fs/cgroup", true);
    int cgroup = openat(root, r.cgroup, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW); close(root);
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
    capabilities_drop(b.uid, b.gid);
    directory = open_directory(b.directory, false);
    if (fstat(directory, &s) || !same_stat(&s, b.directory_device, b.directory_inode) ||
        faccessat(directory, ".", R_OK | W_OK | X_OK, AT_EACCESS) || fchdir(directory)) refuse("DIRECTORY_MIGRATION_REQUIRED");
    close(directory);
    if (clearenv() || setenv("HOME", b.home, 1) || setenv("USER", b.account, 1) || setenv("LOGNAME", b.account, 1) ||
        setenv("PATH", "/usr/local/bin:/usr/bin:/bin", 1) || setenv("LANG", "C.UTF-8", 1)) refuse("PROJECT_ENVIRONMENT");
    for (int i = 0; i < environment_count; ++i) {
        char *equals = strchr(environment[i], '='); *equals = 0;
        if (setenv(environment[i], equals + 1, 1)) refuse("PROJECT_ENVIRONMENT");
    }
    close(lock); close_extra_fds();
    execv(argv[index], argv + index);
    refuse("COMMAND_EXEC");
}
