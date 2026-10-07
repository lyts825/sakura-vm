#!/usr/bin/python3
# 项目身份的 root 控制面：持久化 UID 预留、绑定和运行票据，核实目录、网络与 cgroup，并协调 SSH、终端和撤销。
# Root project-identity control plane: persist nonreusable UID reservations/bindings/run tickets, verify directory/network/cgroup identities and coordinate SSH/terminal/revocation transactions.
"""Root control plane for persistent project accounts; commands never run here.

The C entry point consumes only fixed-size records under the same flock. A
reservation survives an interrupted account creation. Neither an incomplete
reservation nor an old boot/revision can authorize an execution.
"""
import base64
import ctypes
import errno
import fcntl
import grp
import hashlib
import json
import os
import pwd
import re
import selectors
import signal
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time
import uuid

BASE = '/var/lib/sakura/project-identities'
HOMES = '/var/lib/sakura-project-homes'
RUNTIME = '/run/sakura-project-identities'
BUILDS = '/usr/local/lib/sakura-project-identity'
MIGRATIONS = '/var/lib/sakura/project-directory-migrations'
CGROUP = '/sys/fs/cgroup'
NAMES = ['protocol.h', 'launcher.c', 'controller.py']
BINDING = struct.Struct('<8sIIIIQQQQQ37s17s32s37s256s1024sI577s')
RUN = struct.Struct('<8sIIIIQQQQQ37s37s17s37s37s65s64s32s634s')
UID_MAP = struct.Struct('<8sII37s17s37s149s')
REGISTRY = struct.Struct('<8sI37s207s')
NETWORK_GUARD = struct.Struct('<8sIIQQQ37s37s17s37s37s37s14s')
UUID = re.compile('[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}')
PROJECT = re.compile('default|[a-f0-9]{16}')
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/', 'LANG': 'C', 'LC_ALL': 'C'}
RUN_LIMIT = 1024
RUN_ARCHIVE_BATCH = 512
RUN_ARCHIVE_BUCKET_LIMIT = 4096
TERMINALS = '/run/sakura-project-terminals'
SSH_CONFIG = '/etc/sakura/ssh'
SSH_SNAPSHOT_LIMIT = 131072
SSH_TEXT_LIMIT = 65536
SSH_ENV_LIMIT = 128
SSH_ENTRY_LIMIT = 8192
SSH_INPUT_TIMEOUT = 8
SSH_SESSION_ERRORS = False
EGRESS = BASE + '/egress'
EGRESS_BOOT = '/etc/sakura-project-egress'
EGRESS_SYSTEMD_UNITS = ('ssh.service', 'sshd.service', 'ssh@.service', 'sshd@.service',
                        'cron.service', 'crond.service', 'cronie.service', 'atd.service',
                        'systemd-user-sessions.service', 'user@.service')
EGRESS_SYSTEMD_GATE = b'[Unit]\nRequires=sakura-project-egress.service\nAfter=sakura-project-egress.service\n[Service]\nNoNewPrivileges=yes\n'


class Refusal(Exception):
    # 保存稳定拒绝码与可选诊断详情，供控制入口转换为结构化失败。
    # Store the stable refusal code and optional detail for structured control failures.
    def __init__(self, code, detail=None):
        self.code = code
        self.detail = detail


# 立即以指定拒绝码结束当前控制流程，不继续执行权限或资源操作。
# Abort control with the supplied refusal code before further authority or resource operations.
def refuse(code, detail=None):
    raise Refusal(code, detail)


# 要求字符串完全匹配给定身份模式，失败用指定代码拒绝，成功返回原值。
# Require a string fully matching the identity pattern; refuse with the supplied code or return it unchanged.
def identifier(value, pattern, code):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        refuse(code)
    return value


# 核实记录的类型、root 所有权、不可被组/其他用户写入及可选精确权限，普通文件禁止额外硬链接。
# Check type, root ownership, nonwritable group/other permissions and optional exact mode; regular files must have one link.
def trusted(info, directory=False, mode=None):
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        refuse('UNTRUSTED_RECORD')
    if info.st_uid != 0 or info.st_mode & 0o022:
        refuse('UNTRUSTED_RECORD')
    if mode is not None and stat.S_IMODE(info.st_mode) != mode:
        refuse('RECORD_PERMISSIONS')
    if not directory and info.st_nlink != 1:
        refuse('RECORD_LINKS')


# 逐级以 O_NOFOLLOW 打开绝对目录并返回固定 FD，拒绝点段和超长路径；异常关闭已取得 FD。
# Walk an absolute directory with O_NOFOLLOW and return a pinned FD; reject dot segments/long paths and close acquired FDs on failure.
def directory_fd(path, root_owned=True):
    if not isinstance(path, str) or not path.startswith('/') or len(path.encode()) > 1023:
        refuse('DIRECTORY_PATH')
    parts = path.split('/')[1:]
    if any(not part or part in ('.', '..') for part in parts) and path != '/':
        refuse('DIRECTORY_PATH')
    descriptor = os.open('/', os.O_PATH | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in parts if path != '/' else []:
            next_fd = os.open(part, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_fd
            info = os.fstat(descriptor)
            if not stat.S_ISDIR(info.st_mode):
                refuse('DIRECTORY_REPLACED')
            if root_owned:
                trusted(info, True)
        return descriptor
    except OSError:
        os.close(descriptor)
        refuse('UNTRUSTED_DIRECTORY' if root_owned else 'DIRECTORY_MIGRATION_REQUIRED')
    except BaseException:
        os.close(descriptor)
        raise


# 在可信父目录下创建或复用指定权限目录，并核实最终对象的 root 身份与模式。
# Create or reuse a directory below a trusted parent and verify its root ownership and exact mode.
def make_directory(path, mode=0o700):
    parent = directory_fd(os.path.dirname(path))
    try:
        try:
            os.mkdir(os.path.basename(path), mode, dir_fd=parent)
        except FileExistsError:
            pass
        descriptor = os.open(os.path.basename(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                             dir_fd=parent)
        try:
            trusted(os.fstat(descriptor), True, mode)
        finally:
            os.close(descriptor)
    finally:
        os.close(parent)


# 从可信父目录无跟随读取 0600 单链接记录，限制大小；missing 只允许真实缺失返回 None。
# Read a bounded 0600 single-link record without following links; missing permits only actual absence to return None.
def read(path, limit=262144, missing=False):
    parent = directory_fd(os.path.dirname(path))
    try:
        try:
            descriptor = os.open(os.path.basename(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            if missing:
                return None
            refuse('RECORD_ABSENT')
    finally:
        os.close(parent)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        trusted(info, mode=0o600)
        if info.st_size > limit:
            refuse('RECORD_BOUND')
        data = stream.read(limit + 1)
        if len(data) > limit:
            refuse('RECORD_BOUND')
        return data


# 权限记录先写完并 fsync，再同目录替换并同步父目录，崩溃后不会授权半份记录。
# 先以 0600 临时文件写入并 fsync，再替换记录并同步父目录，失败清理本次临时文件。
# Write/fsync a private temporary file, replace the record and fsync its parent; clean up this temporary on failure.
def atomic(path, data):
    parent_path = os.path.dirname(path)
    parent = directory_fd(parent_path)
    os.close(parent)
    descriptor, temporary = tempfile.mkstemp(prefix='.record-', dir=parent_path)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        descriptor = os.open(parent_path, os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


# 通过有界可信读取解析 JSON；真实缺失可返回 None，编码或 JSON 错误拒绝。
# Parse JSON after bounded trusted reading; permitted absence returns None and encoding/JSON errors refuse.
def json_read(path, missing=False, limit=262144):
    raw = read(path, limit, missing)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError):
        refuse('RECORD_JSON')


# 以稳定键序和紧凑 JSON 原子持久化记录，保持重试时字节表达一致。
# Persist compact, sorted-key JSON atomically for deterministic bytes on retries.
def json_write(path, value):
    atomic(path, (json.dumps(value, separators=(',', ':'), sort_keys=True) + '\n').encode())


# 编码无 NUL 且能留出终止位的字符串，再零填充到 ABI 固定宽度。
# Encode a NUL-free string with room for termination and zero-pad it to the ABI width.
def text(value, size):
    if not isinstance(value, str) or '\0' in value or len(value.encode()) >= size:
        refuse('RECORD_STRING')
    return value.encode().ljust(size, b'\0')


# 验证固定字段包含终止 NUL 且其后全为零，再严格解码文本。
# Validate a terminator and all-zero tail in a fixed field, then decode strictly.
def decoded(value):
    end = value.find(b'\0')
    if end < 0 or any(value[end:]):
        refuse('RECORD_STRING')
    try:
        return value[:end].decode()
    except UnicodeError:
        refuse('RECORD_STRING')


# 把已校验项目 ID 映射为持久绑定记录的固定路径。
# Map a validated project ID to its fixed persistent binding path.
def binding_path(project):
    return BASE + '/projects/' + project + '.bin'


# 把账号、目录与 Home 的物理身份及绑定阶段编码为固定二进制记录并原子写入。
# Encode account, directory/Home physical identities and phase into the fixed binding record and write atomically.
def binding_write(value):
    atomic(binding_path(value['projectId']), BINDING.pack(
        b'SKIDB001', 1, 2 if value['phase'] == 'active' else 1, value['uid'], value['gid'], value['revision'],
        int(value['directoryDevice']), int(value['directoryInode']), int(value['homeDevice']), int(value['homeInode']),
        text(value['registryId'], 37), text(value['projectId'], 17), text(value['account'], 32),
        text(value['identityId'], 37), text(value['home'], 256), text(value['directory'], 1024),
        1 if value['networkIsolation'] == 'private' else 0, b'\0' * 577))


# 读取并校验固定长度、magic、版本、阶段、保留位和身份字段，返回结构化绑定。
# Validate binding size, magic, version, phase, reserved bits and identity fields before returning its structured form.
def binding_read(project, missing=False):
    data = read(binding_path(project), 2048, missing)
    if data is None:
        return None
    if len(data) != 2048:
        refuse('BINDING_SIZE')
    fields = BINDING.unpack(data)
    if fields[0] != b'SKIDB001' or fields[1] != 1 or fields[2] not in (1, 2) or fields[16] not in (0, 1) or any(fields[17]):
        refuse('BINDING_INVALID')
    registry, project_id, account, identity, home, directory = [decoded(value) for value in fields[10:16]]
    identifier(registry, UUID, 'REGISTRY_ID')
    identifier(identity, UUID, 'IDENTITY_ID')
    if project_id != project or not PROJECT.fullmatch(project_id) or fields[3] < 20000 or fields[3] > 59999 or fields[4] != fields[3] or not fields[5]:
        refuse('BINDING_IDENTITY')
    if account != 'skp' + identity.replace('-', '')[:24] or home != HOMES + '/' + identity:
        refuse('ACCOUNT_BINDING')
    return {'version': 1, 'phase': 'active' if fields[2] == 2 else 'intent', 'registryId': registry,
            'projectId': project_id, 'account': account, 'uid': fields[3], 'gid': fields[4],
            'identityId': identity, 'revision': fields[5], 'home': home, 'directory': directory,
            'directoryDevice': str(fields[6]), 'directoryInode': str(fields[7]),
            'homeDevice': str(fields[8]), 'homeInode': str(fields[9]),
            'networkIsolation': 'private' if fields[16] else 'host'}


# 校验运行 UUID 后构造热运行票据路径，禁止任意路径输入。
# Validate the run UUID before building its hot-ticket path, excluding arbitrary paths.
def run_path(run):
    identifier(run, UUID, 'RUN_ID')
    return RUNTIME + '/runs/' + run + '.bin'


# 将运行阶段、模式、启动代次、构建与网络/cgroup 物理身份编码到固定 ABI。
# Encode phase, mode, boot, build and network/cgroup physical identities in the fixed run ABI.
def run_bytes(value):
    return RUN.pack(
        b'SKIDR001', 1, 1 if value['phase'] == 'active' else 2, 2 if value['mode'] == 'inherit-current' else 1, 0,
        value['revision'], int(value['networkDevice']), int(value['networkInode']),
        int(value['cgroupDevice']), int(value['cgroupInode']), text(value['registryId'], 37),
        text(value['identityId'], 37), text(value['projectId'], 17), text(value['runId'], 37),
        text(value['bootId'], 37), text(value['build'], 65), text(value['cgroupName'], 64),
        text(value['namespace'], 32), b'\0' * 634)


# 严格验证运行票据长度、常量、保留位与 UUID 等字段，拒绝路径 UUID 与内容不一致。
# Strictly validate ticket length, constants, reserved bits and identity fields, including path/content UUID agreement.
def run_decode(run, data):
    if len(data) != 1024:
        refuse('RUN_SIZE')
    f = RUN.unpack(data)
    if f[0] != b'SKIDR001' or f[1] != 1 or f[2] not in (1, 2) or f[3] not in (1, 2) or f[4] or any(f[18]):
        refuse('RUN_INVALID')
    registry, identity, project, run_id, boot, build, cgroup, namespace = [decoded(value) for value in f[10:18]]
    for value in (registry, identity, run_id, boot):
        identifier(value, UUID, 'RUN_IDENTITY')
    if run_id != run or not PROJECT.fullmatch(project) or not re.fullmatch('[a-f0-9]{64}', build):
        refuse('RUN_IDENTITY')
    mode = 'inherit-current' if f[3] == 2 else 'independent'
    if mode == 'independent':
        if cgroup != 'sakura-identity-' + run:
            refuse('CGROUP_IDENTITY')
    elif not re.fullmatch('sakura-(task|main|service)-' + UUID.pattern, cgroup) and \
         cgroup not in ('openrc.sakura-ssh-' + project, 'system.slice/sakura-ssh-' + project + '.service'):
        refuse('CGROUP_IDENTITY')
    if namespace and namespace != 'sk-' + project:
        refuse('NETWORK_BINDING')
    return {'version': 1, 'phase': 'active' if f[2] == 1 else 'closed', 'mode': mode,
            'registryId': registry, 'identityId': identity, 'projectId': project, 'runId': run,
            'revision': f[5], 'networkDevice': str(f[6]), 'networkInode': str(f[7]),
            'cgroupDevice': str(f[8]), 'cgroupInode': str(f[9]), 'bootId': boot,
            'build': build, 'cgroupName': cgroup, 'namespace': namespace}


# 无跟随固定归档分片目录，可按需创建并同步；缺失时返回 None，异常关闭中间 FD。
# Pin the archive shard without links, optionally creating/fsyncing it; return None on absence and close intermediate FDs on failure.
def run_archive_fd(run, create=False):
    identifier(run, UUID, 'RUN_ID')
    parent = directory_fd(RUNTIME)
    descriptors = [parent]
    try:
        for name in ('archives', run[:2]):
            if create:
                try:
                    os.mkdir(name, 0o700, dir_fd=descriptors[-1])
                    sync = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                                   dir_fd=descriptors[-1])
                    try:
                        os.fsync(sync)
                    finally:
                        os.close(sync)
                except FileExistsError:
                    pass
            try:
                descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                                     dir_fd=descriptors[-1])
            except FileNotFoundError:
                if not create:
                    return None
                raise
            descriptors.append(descriptor)
            trusted(os.fstat(descriptor), True, 0o700)
        return descriptors.pop()
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


# 有界读取可信归档票据，缺失返回 None，长度或权限变化拒绝。
# Read a bounded trusted archived ticket; absence returns None and size/permission changes refuse.
def run_archive_read(run):
    parent = run_archive_fd(run)
    if parent is None:
        return None
    try:
        try:
            descriptor = os.open(run + '.bin', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            return None
        with os.fdopen(descriptor, 'rb') as stream:
            info = os.fstat(stream.fileno())
            trusted(info, mode=0o600)
            if info.st_size != RUN.size:
                refuse('RUN_ARCHIVE_SIZE')
            data = stream.read(RUN.size + 1)
        if run_decode(run, data)['phase'] != 'closed':
            refuse('RUN_ARCHIVE_ACTIVE')
        return data
    finally:
        os.close(parent)


# 协调热票据与归档墓碑，只有内容完全一致才可并存；两者皆缺失或冲突拒绝。
# Reconcile hot tickets and archive tombstones, allowing coexistence only for identical bytes; absence/conflict refuses.
def run_read(run):
    data = read(run_path(run), RUN.size, True)
    archived = run_archive_read(run)
    if data is None:
        if archived is None:
            refuse('RECORD_ABSENT')
        return run_decode(run, archived)
    if archived is not None and archived != data:
        refuse('RUN_ARCHIVE_CONFLICT')
    return run_decode(run, data)


# 写入运行票据；已归档 UUID 只能重复相同 closed 内容，绝不复活到热目录。
# Write a run ticket; archived UUIDs allow only identical closed retries and are never revived in the hot directory.
def run_write(value):
    data = run_bytes(value)
    archived = run_archive_read(value['runId'])
    if archived is not None:
        if value['phase'] != 'closed' or archived != data:
            refuse('RUN_ARCHIVED')
        # A repeated stop/read must not put the retired ticket back in the hot
        # directory. A crash may leave an identical original alongside it.
        return
    atomic(run_path(value['runId']), data)


# 按字符串化设备号与 inode 比较已固定对象和记录的物理身份。
# Compare a pinned object’s device/inode with the recorded physical identity.
def same(info, value, prefix):
    return str(info.st_dev) == value[prefix + 'Device'] and str(info.st_ino) == value[prefix + 'Inode']


# 只从固定系统工具目录寻找可执行文件，缺失返回明确工具拒绝码。
# Find executables only in fixed system tool directories and refuse explicitly when absent.
def tool(name):
    for parent in ('/usr/sbin', '/usr/bin', '/sbin', '/bin'):
        candidate = parent + '/' + name
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    refuse('REQUIRED_TOOL', name)


# 在清洁或指定环境中按超时运行工具并传递指定 FD；PIPE 完整捕获后校验输出大小，异常/非零退出拒绝。
# Run tools with a timeout and explicit FDs in clean/controlled env; check output sizes after full PIPE capture, refusing errors/nonzero exits.
def execute(argv, data=None, timeout=15, pass_fds=(), preexec_fn=None, output_limit=65536, executable=None, controlled_env=None):
    try:
        result = subprocess.run(argv, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=CLEAN_ENV if controlled_env is None else controlled_env, timeout=timeout, check=False,
                                pass_fds=pass_fds, preexec_fn=preexec_fn, executable=executable)
    except (OSError, subprocess.SubprocessError):
        refuse('SYSTEM_TOOL_FAILED')
    if result.returncode or len(result.stdout) > output_limit or len(result.stderr) > 65536:
        refuse('SYSTEM_TOOL_FAILED', {'tool': os.path.basename(argv[0]), 'exit': result.returncode})
    return result.stdout


# 交叉核实名称与 UID/GID 查询一致、Home/shell 精确匹配且无补充组污染。
# Cross-check name/UID/GID lookup, exact Home/shell and absence of supplementary-group contamination.
def account_check(value):
    try:
        account = pwd.getpwnam(value['account'])
        by_uid = pwd.getpwuid(value['uid'])
        group = grp.getgrnam(value['account'])
        by_gid = grp.getgrgid(value['gid'])
    except KeyError:
        refuse('ACCOUNT_ABSENT')
    if (account.pw_uid, account.pw_gid, account.pw_dir, account.pw_shell) != (value['uid'], value['gid'], value['home'], '/bin/sh') or by_uid.pw_name != value['account']:
        refuse('ACCOUNT_REPLACED')
    if group.gr_gid != value['gid'] or by_gid.gr_name != value['account'] or group.gr_mem not in ([], [value['account']]):
        refuse('GROUP_REPLACED')
    # No inherited supplementary memberships are accepted, even though the
    # launcher would clear them. This prevents silently adopting another account.
    if any(item.gr_gid != value['gid'] and value['account'] in item.gr_mem for item in grp.getgrall()):
        refuse('SUPPLEMENTARY_GROUP_CHANGED')


# 无跟随固定 Home 并验证设备/inode、UID/GID 和 0700 模式，替代对象拒绝。
# Pin Home without following links and verify device/inode, UID/GID and mode 0700; replacements refuse.
def home_check(value):
    parent = directory_fd(HOMES)
    try:
        descriptor = os.open(value['identityId'], os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
    except OSError:
        refuse('HOME_REPLACED')
    finally:
        os.close(parent)
    try:
        info = os.fstat(descriptor)
        if not same(info, value, 'home') or info.st_uid != value['uid'] or info.st_gid != value['gid'] or stat.S_IMODE(info.st_mode) != 0o700:
            refuse('HOME_REPLACED')
    finally:
        os.close(descriptor)


# 拒绝控制字符与非法目录路径，返回逐级无跟随打开对象的 stat 身份。
# Reject control characters/invalid paths and return stat identity from a no-follow directory walk.
def project_directory(path):
    if not isinstance(path, str) or '\0' in path or any(ord(c) < 32 or ord(c) == 127 for c in path):
        refuse('DIRECTORY_PATH')
    descriptor = directory_fd(path, False)
    try:
        return os.fstat(descriptor)
    finally:
        os.close(descriptor)


# 以真实项目账号在子进程探测目录访问，先封闭权威 FD 并降权；父进程不借 root 权限替用户通过探测。
# Probe directory access in a child after closing authority FDs and dropping to the real project account.
def probe(value):
    info = project_directory(value['directory'])
    if not same(info, value, 'directory'):
        refuse('DIRECTORY_REPLACED')
    child = os.fork()
    if child == 0:
        try:
            # A permissions probe must not keep the parent's authority lock
            # alive if the controller is interrupted or killed.
            os.closerange(3, min(os.sysconf('SC_OPEN_MAX'), 1048576))
            os.setgroups([])
            os.setresgid(value['gid'], value['gid'], value['gid'])
            os.setresuid(value['uid'], value['uid'], value['uid'])
            descriptor = directory_fd(value['directory'], False)
            try:
                now = os.fstat(descriptor)
                allowed = same(now, value, 'directory') and os.access(value['directory'], os.R_OK | os.W_OK | os.X_OK)
                os.fchdir(descriptor)
                allowed = allowed and os.access('.', os.R_OK | os.W_OK | os.X_OK)
            finally:
                os.close(descriptor)
            os._exit(0 if allowed else 1)
        except BaseException:
            os._exit(1)
    reaped = False
    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            found, status = os.waitpid(child, os.WNOHANG)
            if found:
                reaped = True
                if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
                    refuse('DIRECTORY_MIGRATION_REQUIRED', {'uid': value['uid'], 'gid': value['gid'], 'account': value['account']})
                return
            time.sleep(.01)
        refuse('DIRECTORY_PROBE_TIMEOUT')
    finally:
        if not reaped:
            try:
                os.kill(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(child, 0)


# 读取并核实 JSON 注册表与二进制锚点，只允许全新空状态初始化；保留 UID 预留，拒绝部分状态。
# Validate registry JSON and its binary anchor; initialize only an entirely new empty state and retain UID reservations.
def registry(readonly=False):
    value = json_read(BASE + '/registry.json', True, 1048576)
    anchor = read(BASE + '/registry.bin', 256, True)
    if value is None:
        if readonly:
            refuse('REGISTRY_INCOMPLETE')
        if anchor is not None or os.listdir(BASE + '/projects') or os.listdir(BASE + '/uids'):
            refuse('REGISTRY_INCOMPLETE')
        value = {'version': 1, 'registryId': str(uuid.uuid4()), 'reserved': {}}
        json_write(BASE + '/registry.json', value)
    if not isinstance(value, dict) or set(value) != {'version', 'registryId', 'reserved'} or value['version'] != 1:
        refuse('REGISTRY_INVALID')
    identifier(value['registryId'], UUID, 'REGISTRY_ID')
    expected_anchor = REGISTRY.pack(b'SKIDG001', 1, text(value['registryId'], 37), b'\0' * 207)
    if anchor is not None and anchor != expected_anchor:
        refuse('REGISTRY_REPLACED')
    if anchor is None:
        if readonly:
            refuse('REGISTRY_INCOMPLETE')
        atomic(BASE + '/registry.bin', expected_anchor)
    if not isinstance(value['reserved'], dict) or len(value['reserved']) > 4096:
        refuse('REGISTRY_BOUND')
    projects = set()
    for uid, reservation in value['reserved'].items():
        if not re.fullmatch('[0-9]{5}', uid) or not 20000 <= int(uid) <= 59999 or not isinstance(reservation, dict) or set(reservation) != {'projectId', 'identityId'}:
            refuse('REGISTRY_RESERVATION')
        identifier(reservation['projectId'], PROJECT, 'PROJECT_ID')
        identifier(reservation['identityId'], UUID, 'IDENTITY_ID')
        if reservation['projectId'] in projects:
            refuse('REGISTRY_DUPLICATE')
        projects.add(reservation['projectId'])
    return value


# 核对绑定属于当前注册表且 UID 预留精确指向项目与身份 UUID。
# Require the binding’s registry and UID reservation to identify this exact project/identity UUID.
def reservation_check(value, store):
    expected = {'projectId': value['projectId'], 'identityId': value['identityId']}
    if value['registryId'] != store['registryId'] or store['reserved'].get(str(value['uid'])) != expected:
        refuse('REGISTRY_BINDING')


# 检查可选调用方预期身份与修订，拒绝陈旧或多余字段，支持乐观并发边界。
# Validate optional expected identity/revision and reject stale or extra fields for optimistic concurrency.
def expected(value, request):
    prior = request.get('expected')
    if prior is None:
        return
    if not isinstance(prior, dict) or set(prior) != {'registryId', 'identityId', 'revision'}:
        refuse('EXPECTED_IDENTITY')
    if any(value[key] != prior[key] for key in ('registryId', 'identityId', 'revision')):
        refuse('IDENTITY_STALE')


# UID 先进入永久预留表再创建账户；中断重试复用同一身份，不能把旧 UID 分配给另一个项目。
# 先持久预留不复用 UID，再创建账号/Home 并发布绑定；中断可凭相同预留恢复，拒绝身份与目录替换。
# Durably reserve a nonreusable UID before account/Home creation and binding publication; retries recover the same reservation and reject replacements.
def ensure(request, store):
    project = request['projectId']
    directory = request['directory']
    network = request['networkIsolation']
    if network not in ('host', 'private'):
        refuse('NETWORK_MODE')
    info = project_directory(directory)
    value = binding_read(project, True)
    if value is None:
        if request.get('expected') is not None:
            refuse('IDENTITY_ABSENT')
        reserved = next(((int(uid), item) for uid, item in store['reserved'].items() if item['projectId'] == project), None)
        if reserved:
            uid, item = reserved
            identity = item['identityId']
        else:
            if len(store['reserved']) >= 4096:
                refuse('ACCOUNT_LIMIT')
            taken = {account.pw_uid for account in pwd.getpwall()} | {group.gr_gid for group in grp.getgrall()} | {int(uid) for uid in store['reserved']}
            uid = next((candidate for candidate in range(20000, 60000) if candidate not in taken), None)
            if uid is None:
                refuse('UID_EXHAUSTED')
            identity = str(uuid.uuid4())
            store['reserved'][str(uid)] = {'projectId': project, 'identityId': identity}
            json_write(BASE + '/registry.json', store)
        value = {'version': 1, 'phase': 'intent', 'registryId': store['registryId'], 'projectId': project,
                 'account': 'skp' + identity.replace('-', '')[:24], 'uid': uid, 'gid': uid,
                 'identityId': identity, 'revision': 1, 'home': HOMES + '/' + identity,
                 'directory': directory, 'directoryDevice': str(info.st_dev), 'directoryInode': str(info.st_ino),
                 'homeDevice': '0', 'homeInode': '0', 'networkIsolation': network}
        binding_write(value)
    reservation_check(value, store)
    expected(value, request)
    if value['directory'] != directory or value['networkIsolation'] != network:
        refuse('BINDING_CHANGE_REQUIRES_REBIND')
    if not same(info, value, 'directory'):
        refuse('DIRECTORY_REPLACED')
    # Reserve and block the UID before creating an account which another system
    # entry could start. An incomplete migration keeps the blocking intent.
    egress_prepare(value)
    if value['networkIsolation'] == 'private':
        egress_nnp_check(value)
    if value['phase'] == 'intent':
        try:
            group = grp.getgrnam(value['account'])
        except KeyError:
            group = None
        try:
            account = pwd.getpwnam(value['account'])
        except KeyError:
            account = None
        if group is None:
            if any(item.gr_gid == value['gid'] for item in grp.getgrall()):
                refuse('GID_REPLACED')
            execute([tool('groupadd'), '-g', str(value['gid']), value['account']])
        elif group.gr_gid != value['gid'] or group.gr_mem not in ([], [value['account']]):
            refuse('GROUP_REPLACED')
        if account is None:
            if any(item.pw_uid == value['uid'] for item in pwd.getpwall()):
                refuse('UID_REPLACED')
            # A random unknown password keeps key-based SSH possible with
            # UsePAM=no. The plaintext and hash never enter binding/run records.
            password = uuid.uuid4().hex + uuid.uuid4().hex
            hashed = execute([tool('openssl'), 'passwd', '-6', '-stdin'], (password + '\n').encode()).decode().strip()
            if not hashed.startswith('$6$') or '\n' in hashed:
                refuse('ACCOUNT_PASSWORD')
            # System-account mode avoids mail spools, subordinate-ID grants and
            # account log initialization. The reserved UID/GID remain explicit;
            # no distribution's system-account allocator selects either ID.
            execute([tool('useradd'), '-r', '-M', '-l', '-G', '', '-u', str(value['uid']), '-g', str(value['gid']),
                     '-d', value['home'], '-s', '/bin/sh', '-p', hashed, value['account']])
        else:
            # Resume only the exact reserved account, before making any
            # password change. It is not launchable until the whole intent is
            # completed. Shadow utilities use their system account file locks.
            account_check(value)
            password = uuid.uuid4().hex + uuid.uuid4().hex
            hashed = execute([tool('openssl'), 'passwd', '-6', '-stdin'], (password + '\n').encode()).decode().strip()
            if not hashed.startswith('$6$') or '\n' in hashed:
                refuse('ACCOUNT_PASSWORD')
            execute([tool('chpasswd'), '-e'], (value['account'] + ':' + hashed + '\n').encode())
        account_check(value)
        if value['homeInode'] == '0':
            try:
                os.mkdir(value['home'], 0o700)
            except FileExistsError:
                info = os.lstat(value['home'])
                if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700 or os.listdir(value['home']):
                    refuse('HOME_REPLACED')
            info = os.lstat(value['home'])
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
                refuse('HOME_REPLACED')
            value['homeDevice'], value['homeInode'] = str(info.st_dev), str(info.st_ino)
            binding_write(value)
        info = os.lstat(value['home'])
        if not same(info, value, 'home') or not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, value['uid']):
            refuse('HOME_REPLACED')
        if info.st_uid == 0:
            if os.listdir(value['home']) or stat.S_IMODE(info.st_mode) != 0o700:
                refuse('HOME_REPLACED')
            os.chown(value['home'], value['uid'], value['gid'], follow_symlinks=False)
    account_check(value)
    home_check(value)
    probe(value)
    durable_account(value)
    value['phase'] = 'active'
    binding_write(value)
    uid_path = BASE + '/uids/' + str(value['uid']) + '.bin'
    mapping = UID_MAP.pack(b'SKIDU001', 1, value['uid'], text(value['registryId'], 37),
                           text(project, 17), text(value['identityId'], 37), b'\0' * 149)
    prior_mapping = read(uid_path, 256, True)
    if prior_mapping is not None and prior_mapping != mapping:
        refuse('UID_MAPPING_REPLACED')
    atomic(uid_path, mapping)
    egress_commit(value)
    return value


# 核实活动绑定、注册表、账号/Home、UID 映射和出站策略，返回可执行身份；未完整发布的身份拒绝。
# Validate active binding, registry, account/Home, UID mapping and egress policy; incomplete identities cannot execute.
def active(project, request, store, check_egress=True):
    value = binding_read(project)
    reservation_check(value, store)
    expected(value, request)
    if value['phase'] != 'active':
        refuse('IDENTITY_INCOMPLETE')
    account_check(value)
    home_check(value)
    mapping = UID_MAP.pack(b'SKIDU001', 1, value['uid'], text(value['registryId'], 37),
                           text(project, 17), text(value['identityId'], 37), b'\0' * 149)
    if read(BASE + '/uids/' + str(value['uid']) + '.bin', 256) != mapping:
        refuse('UID_MAPPING_REPLACED')
    if check_egress:
        egress_check(value)
    probe(value)
    return value


# 同步实际账号数据库和新 Home，确保 active 绑定不会先于账号持久化；缺失必要文件拒绝。
# Fsync account databases and new Home so active publication cannot precede durable account creation.
def durable_account(value):
    # Account tools differ in their fsync behaviour. Complete these exact
    # system account files and the new home before publishing an active UID.
    for name in ('passwd', 'group', 'shadow', 'gshadow'):
        try:
            descriptor = os.open('/etc/' + name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        except FileNotFoundError:
            if name == 'gshadow':
                continue
            refuse('ACCOUNT_ABSENT')
        try:
            info = os.fstat(descriptor)
            # System account tools can retain a root-owned hard-link backup.
            # The inode's owner/mode protect every link; the stricter one-link
            # rule still applies to all Sakura authority records.
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                refuse('ACCOUNT_DATABASE_PERMISSIONS')
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    for path in ('/etc', value['home'], HOMES):
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


# 为预留项目 UID 构建带注册/身份标记的 inet 输出过滤表、链和规则规范。
# Build the inet output table/chain/rule specification marked by the reserved project UID and identity.
def egress_spec(value):
    name = 'skp_uid_' + str(value['uid'])
    marker = 'sakura-project-egress-v1:' + value['registryId'] + ':' + value['identityId']
    common = {'family': 'inet', 'table': name}
    return name, [
        {'table': {'family': 'inet', 'name': name, 'comment': marker}},
        {'chain': dict(common, name='output', type='filter', hook='output', prio=300, policy='accept')},
        {'rule': dict(common, chain='output', comment=marker, expr=[
            {'match': {'op': '==', 'left': {'meta': {'key': 'skuid'}}, 'right': value['uid']}}, {'drop': None}])}]


# 校验 UID 与身份后生成单次原子 nft create 批次，保留注释标记且不接管已有同名表。
# Validate UID/identity and create one atomic nft batch retaining markers without adopting an existing table.
def egress_create_text(value):
    if type(value.get('uid')) is not int or not 20000 <= value['uid'] < 60000:
        refuse('EGRESS_OWNER_CHANGED')
    for key in ('registryId', 'identityId'):
        identifier(value.get(key), UUID, 'EGRESS_OWNER_CHANGED')
    name, objects = egress_spec(value)
    marker = objects[0]['table']['comment']
    # The 1.0.6 JSON input omits table comments, and CMD_CREATE does not
    # expand nested chains/rules. Three explicit commands in one -f batch
    # preserve the marker and atomicity; create still refuses an existing table.
    return (f'create table inet {name} {{ comment "{marker}"; }}\n'
            f'add chain inet {name} output {{ type filter hook output priority 300; policy accept; }}\n'
            f'add rule inet {name} output meta skuid {value["uid"]} drop comment "{marker}"\n').encode('ascii')


# 固定 PID 1 网络命名空间并核实类型/root 所有权，返回 FD 和物理身份，失败关闭 FD。
# Pin PID 1’s network namespace, validate type/root ownership and return FD/physical identity; failures close it.
def egress_realm():
    descriptor = os.open('/proc/1/ns/net', os.O_RDONLY | os.O_CLOEXEC)
    try:
        info = os.fstat(descriptor)
        if info.st_uid != 0 or fcntl.ioctl(descriptor, 0xb703) != 0x40000000:
            refuse('EGRESS_NAMESPACE_CHANGED')
        return descriptor, {'networkDevice': str(info.st_dev), 'networkInode': str(info.st_ino)}
    except BaseException:
        os.close(descriptor)
        raise


# 固定可信 nft 映像并在 PID 1 网络域执行有界查询或事务，显式保留必需 FD，失败拒绝。
# Pin the trusted nft image and run bounded queries/transactions in PID 1’s network realm with explicit FDs.
def egress_nft(arguments, data=None, *, json_output=True):
    # All queries and transactions run in PID 1's network space, including when
    # a project SSH controller is itself inside the private namespace.
    if type(json_output) is not bool:
        refuse('EGRESS_STATE_INVALID')
    namespace, _realm = egress_realm()
    binary = None
    try:
        path = os.path.realpath(tool('nft'))
        parent = directory_fd(os.path.dirname(path))
        try:
            binary = os.open(os.path.basename(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        finally:
            os.close(parent)
        info = os.fstat(binary)
        trusted(info)
        if not info.st_mode & 0o111 or info.st_mode & 0o6000:
            refuse('EGRESS_TOOL_CHANGED')
        # 让工具子进程进入已固定的宿主网络命名空间，setns 失败立即终止启动。
        # Enter the pinned host network namespace in the tool child; failed setns aborts startup.
        def enter():
            library = ctypes.CDLL(None, use_errno=True)
            if library.setns(namespace, 0x40000000) != 0:
                raise OSError(ctypes.get_errno(), 'network namespace')
        prefix = ['-j', '-n'] if json_output else ['-n']
        return execute(['/proc/self/fd/' + str(binary)] + prefix + arguments,
                       data, timeout=15, pass_fds=(binary, namespace), preexec_fn=enter,
                       output_limit=4 * 1024 * 1024 if arguments == ['list', 'tables'] else 65536)
    except Refusal as error:
        if error.code.startswith('EGRESS_'):
            raise
        refuse('EGRESS_TOOL_FAILED', error.detail)
    finally:
        if binary is not None:
            os.close(binary)
        os.close(namespace)


# 解析严格单根 nftables JSON 并限制项目数，剔除仅含 metainfo 的元数据记录。
# Parse strict single-root nftables JSON with an item bound and remove metainfo-only entries.
def egress_json(raw):
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeError):
        refuse('EGRESS_STATE_INVALID')
    if not isinstance(result, dict) or set(result) != {'nftables'} or not isinstance(result['nftables'], list) or len(result['nftables']) > 8193:
        refuse('EGRESS_STATE_INVALID')
    if any(not isinstance(item, dict) or len(item) != 1 for item in result['nftables']):
        refuse('EGRESS_STATE_INVALID')
    return [item for item in result['nftables'] if set(item) != {'metainfo'}]


# 递归比较 JSON 的精确类型、键集合、数组顺序和值，避免 bool 与 int 被视为相同。
# Recursively compare exact JSON types, keys, array order and values, distinguishing booleans from integers.
def egress_same_json(left, right):
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return set(left) == set(right) and all(egress_same_json(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(egress_same_json(a, b) for a, b in zip(left, right))
    return left == right


# 核对期望表/链/规则的完整形状与句柄，只允许明确兼容的缺失注释，返回规范内容和句柄。
# Check full table/chain/rule shapes and handles, allowing only explicitly compatible missing comments.
def egress_objects(objects, expected, *, allow_missing_comment):
    normalized, handles = [], []
    if len(objects) != 3:
        refuse('EGRESS_TABLE_CHANGED')
    for index, entry in enumerate(objects):
        if not isinstance(entry, dict) or set(entry) != set(expected[index]):
            refuse('EGRESS_TABLE_CHANGED')
        kind, original = next(iter(entry.items()))
        if not isinstance(original, dict):
            refuse('EGRESS_TABLE_CHANGED')
        fields = dict(original)
        handle = fields.pop('handle', None)
        if type(handle) is not int or not 0 < handle <= 0xffffffffffffffff:
            refuse('EGRESS_TABLE_CHANGED')
        handles.append(handle)
        comparison = dict(fields)
        if index == 0 and allow_missing_comment and 'comment' not in comparison:
            # Only an expectation for validation, never an ownership receipt.
            # The caller must obtain the actual marker from the pinned text
            # query and check an unchanged second kernel JSON snapshot.
            comparison['comment'] = expected[0]['table']['comment']
        if not egress_same_json({kind: comparison}, expected[index]):
            refuse('EGRESS_TABLE_CHANGED')
        normalized.append({kind: fields})
    return normalized, handles


# 以有界 ASCII 文本交叉核实 nft 表句柄和身份标记，拒绝控制字符或结构差异。
# Cross-check table handles/identity markers in bounded ASCII nft text, refusing controls or structural differences.
def egress_table_text(raw, name, marker, table_handle):
    if not isinstance(raw, bytes) or len(raw) > 65536:
        refuse('EGRESS_TABLE_CHANGED')
    try:
        text = raw.decode('ascii')
    except UnicodeError:
        refuse('EGRESS_TABLE_CHANGED')
    if any(ord(character) < 32 and character not in '\t\n' for character in text) or not text.endswith('\n'):
        refuse('EGRESS_TABLE_CHANGED')
    lines = text.splitlines()
    if not lines or lines[0] != f'table inet {name} {{ # handle {table_handle}':
        refuse('EGRESS_TABLE_CHANGED')
    # Lex strings before braces. Escapes, braces and embedded line breaks in
    # quoted values are unsupported here, so they cannot falsify depth.
    token = re.compile(r'[ \t]+|"[^"\\{}\n\r]*"|#[^\n]*|[{};]|[^\s{};"#\\]+')
    depth, comments, chains = 1, 0, 0
    for line_index, line in enumerate(lines[1:], 1):
        parts, offset = [], 0
        while offset < len(line):
            match = token.match(line, offset)
            if match is None:
                refuse('EGRESS_TABLE_CHANGED')
            piece = match.group(0)
            offset = match.end()
            if piece.startswith('#'):
                if not re.fullmatch(r'# handle [1-9][0-9]{0,19}', piece):
                    refuse('EGRESS_TABLE_CHANGED')
                if int(piece[len('# handle '):]) > 0xffffffffffffffff:
                    refuse('EGRESS_TABLE_CHANGED')
                break
            if not piece.isspace():
                parts.append(piece)
        if depth == 0:
            refuse('EGRESS_TABLE_CHANGED')
        if not parts:
            continue
        if depth == 1 and parts[0] == 'comment':
            if parts != ['comment', '"' + marker + '"'] or chains:
                refuse('EGRESS_TABLE_CHANGED')
            comments += 1
        elif depth == 1 and parts[0] == 'chain':
            if parts != ['chain', 'output', '{'] or comments != 1:
                refuse('EGRESS_TABLE_CHANGED')
            chains += 1
        elif depth == 1 and parts != ['}']:
            refuse('EGRESS_TABLE_CHANGED')
        for piece in parts:
            if piece == '{':
                depth += 1
            elif piece == '}':
                depth -= 1
            if depth < 0 or depth > 2:
                refuse('EGRESS_TABLE_CHANGED')
        if depth == 0 and line_index != len(lines) - 1:
            refuse('EGRESS_TABLE_CHANGED')
    if depth != 0 or comments != 1 or chains != 1:
        refuse('EGRESS_TABLE_CHANGED')


# 查询并交叉核实当前表内容及精确句柄；不存在返回 None，同名重复或替代规则拒绝。
# Query/cross-check the current table and exact handle; absence returns None while duplicates/replacements refuse.
def egress_table(value):
    name, expected = egress_spec(value)
    tables = egress_json(egress_nft(['list', 'tables']))
    seen = 0
    for entry in tables:
        if set(entry) != {'table'} or not isinstance(entry['table'], dict):
            refuse('EGRESS_STATE_INVALID')
        if entry['table'].get('family') == 'inet' and entry['table'].get('name') == name:
            seen += 1
    if seen == 0:
        return None
    if seen != 1:
        refuse('EGRESS_TABLE_CHANGED')
    objects = egress_json(egress_nft(['list', 'table', 'inet', name]))
    missing = bool(objects and isinstance(objects[0].get('table'), dict) and 'comment' not in objects[0]['table'])
    normalized, handles = egress_objects(objects, expected, allow_missing_comment=missing)
    if not missing:
        return handles[0]
    text = egress_nft(['-a', 'list', 'table', 'inet', name], json_output=False)
    egress_table_text(text, name, expected[0]['table']['comment'], handles[0])
    following = egress_json(egress_nft(['list', 'table', 'inet', name]))
    normalized_after, handles_after = egress_objects(following, expected, allow_missing_comment=True)
    if not egress_same_json(normalized, normalized_after) or handles != handles_after:
        refuse('EGRESS_TABLE_CHANGED')
    return handles[0]


# 为绑定 UID 构造持久出站策略记录路径。
# Build the persistent egress-policy path for the bound UID.
def egress_path(value):
    return EGRESS + '/' + str(value['uid']) + '.json'


# 校验出站状态字段、绑定身份、阶段、句柄与删除标志；真实缺失返回 None。
# Validate egress fields, binding identity, phase, handle and deletion flag; actual absence returns None.
def egress_read(value):
    state = json_read(egress_path(value), True, 4096)
    if state is None:
        return None
    keys = {'version', 'registryId', 'identityId', 'projectId', 'uid', 'mode', 'phase',
            'bootId', 'networkDevice', 'networkInode', 'handle', 'deleteIssued'}
    if not isinstance(state, dict) or set(state) != keys or type(state['version']) is not int or state['version'] != 1 or \
       any(state[key] != value[key] for key in ('registryId', 'identityId', 'projectId', 'uid')) or \
       state['phase'] not in ('pending', 'applied') or state['mode'] not in ('host', 'private') or \
       type(state['deleteIssued']) is not bool or \
       (state['handle'] is not None and (type(state['handle']) is not int or state['handle'] <= 0)):
        refuse('EGRESS_OWNER_CHANGED')
    identifier(state['bootId'], UUID, 'EGRESS_OWNER_CHANGED')
    for key in ('networkDevice', 'networkInode'):
        if not isinstance(state[key], str) or not re.fullmatch('0|[1-9][0-9]*', state[key]):
            refuse('EGRESS_OWNER_CHANGED')
    if state['networkInode'] == '0' or (state['mode'] == 'private' and state['deleteIssued']):
        refuse('EGRESS_OWNER_CHANGED')
    return state


# 获取当前 boot UUID 和宿主网络设备/inode，用于识别重启与命名空间替换。
# Capture the current boot UUID and host network device/inode to detect reboot or namespace replacement.
def egress_context():
    boot = open('/proc/sys/kernel/random/boot_id').read().strip()
    identifier(boot, UUID, 'BOOT_ID')
    descriptor, realm = egress_realm()
    os.close(descriptor)
    return dict(realm, bootId=boot)


# 要求 applied 状态与当前绑定/启动网络一致，并核实精确规则及可选 no_new_privs 防护。
# Require applied policy matching the binding/current boot realm and verify exact rules plus optional no_new_privs guards.
def egress_check(value, check_nnp=True):
    state = egress_read(value)
    if state is None and value['networkIsolation'] == 'host':
        return
    if state is None or state['phase'] != 'applied' or state['mode'] != value['networkIsolation'] or \
       any(state[key] != content for key, content in egress_context().items()):
        refuse('EGRESS_PENDING')
    handle = egress_table(value)
    if (state['mode'] == 'private' and (handle is None or handle != state['handle'])) or \
       (state['mode'] == 'host' and handle is not None):
        refuse('EGRESS_TABLE_CHANGED')
    if state['mode'] == 'private' and check_nnp:
        egress_nnp_check(value)


# 持久化出站变更意图，区分重启恢复与显式模式切换；当前网络域变化或未授权切换拒绝。
# Persist egress transition intent, distinguishing reboot restoration from explicit mode changes; unexpected realm/mode changes refuse.
def egress_prepare(value, transition=False, restoring=False):
    state = egress_read(value)
    mode = value['networkIsolation']
    if state is None and mode == 'host':
        return
    context = egress_context()
    reboot = state is not None and state['bootId'] != context['bootId']
    if state is not None and not reboot and any(state[key] != context[key] for key in ('networkDevice', 'networkInode')):
        refuse('EGRESS_NAMESPACE_CHANGED')
    if state is not None and state['mode'] != mode and not (transition or (restoring and reboot)):
        refuse('EGRESS_PENDING')
    if state is not None and state['phase'] == 'applied' and state['mode'] == mode and not reboot:
        egress_check(value)
        return
    old_handle = None if state is None or reboot else state['handle']
    handle = egress_table(value)
    if reboot and handle is not None:
        refuse('EGRESS_OWNER_ABSENT')
    if old_handle is not None and handle != old_handle and not (mode == 'host' and state['deleteIssued'] and handle is None):
        refuse('EGRESS_TABLE_CHANGED')
    if handle is not None and old_handle is None and state is None:
        # No saved intent means even a similarly named canonical table is not
        # ours to adopt. A lost creation ACK has a prior pending owner.
        refuse('EGRESS_OWNER_ABSENT')
    pending = dict(version=1, registryId=value['registryId'], identityId=value['identityId'],
                   projectId=value['projectId'], uid=value['uid'], mode=mode, phase='pending',
                   handle=handle, deleteIssued=bool(state and not reboot and state['deleteIssued']), **context)
    if mode == 'private':
        pending['deleteIssued'] = False
    json_write(egress_path(value), pending)
    if mode == 'private' and handle is None:
        egress_nft(['-f', '-'], egress_create_text(value), json_output=False)
        pending['handle'] = egress_table(value)
        if pending['handle'] is None:
            refuse('EGRESS_TABLE_CHANGED')
        json_write(egress_path(value), pending)


# 重核持久绑定、上下文和规则后发布 applied；允许的 intent 恢复也不能跳过规则与权限边界。
# Recheck binding/context/rules before publishing applied; allowed intent recovery still preserves rule/authority checks.
def egress_commit(value, allow_intent=False, check_nnp=True):
    state = egress_read(value)
    if state is None and value['networkIsolation'] == 'host':
        return
    recorded = binding_read(value['projectId'])
    if recorded != value or (value['phase'] != 'active' and not allow_intent) or state is None or \
       state['mode'] != value['networkIsolation'] or any(state[key] != content for key, content in egress_context().items()):
        refuse('EGRESS_PENDING')
    if state['phase'] == 'applied':
        egress_check(value, check_nnp)
        return
    handle = egress_table(value)
    if state['mode'] == 'private':
        if handle is None or handle != state['handle']:
            refuse('EGRESS_TABLE_CHANGED')
    else:
        if handle is not None:
            if handle != state['handle']:
                refuse('EGRESS_TABLE_CHANGED')
            state['deleteIssued'] = True
            json_write(egress_path(value), state)
            name, _objects = egress_spec(value)
            egress_nft(['-f', '-'], json.dumps({'nftables': [{'delete': {'table': {'family': 'inet', 'name': name}}}]}, separators=(',', ':')).encode())
            if egress_table(value) is not None:
                refuse('EGRESS_TABLE_CHANGED')
        elif state['handle'] is not None and not state['deleteIssued']:
            refuse('EGRESS_TABLE_CHANGED')
        state['handle'] = None
    state['phase'] = 'applied'
    json_write(egress_path(value), state)
    egress_check(value, check_nnp)


# 只接受标准 OpenRC 启动或简单委托，检查配置及脚本不会自定义启动或重置 no_new_privs。
# Accept only stock OpenRC startup or simple delegation and reject custom launchers/policy resets.
def egress_openrc_nnp(service, script, configuration):
    if not isinstance(script, bytes) or script.splitlines()[0:1] != [b'#!/sbin/openrc-run']:
        refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', {'service': service})
    # Conf.d is sourced before the service script. Accept the stock default
    # launcher or a trivial delegation, never a custom start implementation or
    # an init script which resets the policy after the managed conf.d tail.
    combined = re.sub(br'(?m)^\s*#.*$', b'', configuration + b'\n' + script)
    for function in (b'default_start', b'ssd_start', b'supervise_start'):
        if re.search(br'(?m)^\s*(?:function\s+)?' + function + br'\s*(?:\(\s*\))?\s*\{', combined):
            refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', {'service': service})
    starts = re.findall(br'(?ms)^\s*(?:function\s+)?start\s*(?:\(\s*\))?\s*\{(.*?)\}', combined)
    if len(starts) > 1 or (starts and starts[0].strip().rstrip(b';').strip() != b'default_start') or \
       re.search(br'\bno_new_privs\b', re.sub(br'(?m)^\s*#.*$', b'', script)):
        refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', {'service': service})
    for supervisor in re.findall(br'(?m)^\s*supervisor\s*=\s*([^\n;#]*)', combined):
        if supervisor.strip().strip(b'\"\'') not in (b'', b'start-stop-daemon', b'supervise-daemon'):
            refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', {'service': service})
    # A runlevel-specific conf.d file would replace the file carrying our tail.
    if any(name.startswith(service + '.') for name in os.listdir('/etc/conf.d')):
        refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', {'service': service, 'reason': 'runlevel-configuration'})
    library = next((path for path in ('/lib/rc/sh', '/usr/lib/rc/sh', '/usr/libexec/rc/sh', '/libexec/rc/sh')
                    if os.path.isfile(path + '/openrc-run.sh')), None)
    if library is None:
        refuse('EGRESS_NNP_UNSUPPORTED', {'service': service})
    library = os.path.realpath(library)
    shell = egress_boot_read(library + '/openrc-run.sh')
    if shell is None or b'default_start' not in shell or b'start-stop-daemon.sh' not in shell or b'supervise-daemon.sh' not in shell:
        refuse('EGRESS_NNP_UNSUPPORTED', {'service': service})
    for name in ('start-stop-daemon', 'supervise-daemon'):
        raw = egress_boot_read(library + '/' + name + '.sh')
        if raw is None or b'${no_new_privs:+--no-new-privs}' not in raw:
            refuse('EGRESS_NNP_UNSUPPORTED', {'service': service, 'tool': name})
        try:
            binary = os.path.realpath(tool(name))
        except Refusal:
            refuse('EGRESS_NNP_UNSUPPORTED', {'service': service, 'tool': name})
        parent = directory_fd(os.path.dirname(binary))
        descriptor = None
        try:
            descriptor = os.open(os.path.basename(binary), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
            info = os.fstat(descriptor)
            trusted(info)
            if not info.st_mode & 0o111 or info.st_mode & 0o6000:
                refuse('EGRESS_NNP_UNSUPPORTED', {'service': service, 'tool': name})
            # OpenRC dispatches by argv0. supervise-daemon also requires a
            # matching service argument and RC_SVCNAME before processing help.
            arguments, environment = [name, '--help'], dict(CLEAN_ENV)
            if name == 'supervise-daemon':
                arguments = [name, service, '--help']
                environment['RC_SVCNAME'] = service
            try:
                help_text = execute(arguments, executable='/proc/self/fd/' + str(descriptor),
                                    controlled_env=environment, pass_fds=(descriptor,))
            except Refusal:
                refuse('EGRESS_NNP_UNSUPPORTED', {'service': service, 'tool': name, 'reason': 'launcher-help-unavailable'})
            if b'--no-new-privs' not in help_text:
                refuse('EGRESS_NNP_UNSUPPORTED', {'service': service, 'tool': name, 'reason': 'launcher-flag-unavailable'})
        finally:
            if descriptor is not None:
                os.close(descriptor)
            os.close(parent)


# 生成固定版本的 OpenRC 依赖与 no_new_privs 尾段，local/旧守卫模式保持其支持范围。
# Generate the fixed OpenRC dependency/no_new_privs tail appropriate to local and legacy guard modes.
def egress_openrc_tail(service, guards=2):
    legacy = b'\n# SAKURA_PROJECT_EGRESS_V1\nrc_need="${rc_need-} sakura-project-egress"\n'
    if guards == 1 or service == 'local':
        return legacy
    return b'\n# SAKURA_PROJECT_EGRESS_V2\nrc_need="${rc_need-} sakura-project-egress"\nno_new_privs=yes\n'


# 按已识别 init 管理器构建固定构建入口的恢复文件、链接与追加计划，不直接写文件。
# Build restore files/link/append plans for the recognized init manager and pinned build without writing them.
def egress_boot_plan(build, manager):
    request = base64.b64encode(b'{"action":"restore-egress"}').decode()
    restore = ('#!/bin/sh\nexec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C '
               '/usr/bin/python3 -I -S ' + BUILDS + '/' + build + '/controller.py ' + request + '\n').encode()
    files = {EGRESS_BOOT + '/restore': {'data': restore, 'mode': 0o700}}
    links, appends = {}, {}
    if manager == 'systemd':
        unit = ('[Unit]\nDescription=Restore Sakura project UID network policy\nDefaultDependencies=no\n'
                'After=local-fs.target nftables.service ufw.service firewalld.service iptables.service ip6tables.service\n'
                'Before=network-pre.target ssh.service sshd.service cron.service crond.service cronie.service '
                'atd.service systemd-user-sessions.service\n[Service]\nType=oneshot\nRemainAfterExit=yes\n'
                'ExecStart=' + EGRESS_BOOT + '/restore\n[Install]\nWantedBy=multi-user.target\n').encode()
        files['/etc/systemd/system/sakura-project-egress.service'] = {'data': unit, 'mode': 0o644}
        # These daemon/user-manager settings affect every ordinary user of the
        # same VM. Root controllers retain their existing privilege to drop UID.
        for name in EGRESS_SYSTEMD_UNITS:
            files['/etc/systemd/system/' + name + '.d/sakura-project-egress.conf'] = {'data': EGRESS_SYSTEMD_GATE, 'mode': 0o644}
        links['/etc/systemd/system/multi-user.target.wants/sakura-project-egress.service'] = '/etc/systemd/system/sakura-project-egress.service'
    elif manager == 'openrc':
        init = ('#!/sbin/openrc-run\ndescription="Restore Sakura project UID network policy"\n'
                'depend() { need localmount; after nftables iptables ip6tables; before networking net sshd crond cronie atd local; }\n'
                'start() { ebegin "Restoring Sakura project UID network policy"; '
                + EGRESS_BOOT + '/restore; eend $?; }\n').encode()
        files['/etc/init.d/sakura-project-egress'] = {'data': init, 'mode': 0o755}
        links['/etc/runlevels/boot/sakura-project-egress'] = '/etc/init.d/sakura-project-egress'
        for service in ('sshd', 'crond', 'cronie', 'atd', 'local'):
            path = '/etc/init.d/' + service
            if os.path.lexists(path):
                descriptor = directory_fd('/etc/init.d')
                os.close(descriptor)
                info = os.lstat(path)
                trusted(info)
                configuration = egress_boot_read('/etc/conf.d/' + service) or b''
                for guards in (2, 1):
                    tail = egress_openrc_tail(service, guards)
                    if configuration.endswith(tail):
                        configuration = configuration[:-len(tail)]
                        break
                if service != 'local':
                    egress_openrc_nnp(service, egress_boot_read(path), configuration)
                appends['/etc/conf.d/' + service] = egress_openrc_tail(service)
    else:
        refuse('EGRESS_INIT_UNSUPPORTED')
    return files, links, appends


# 逐级创建并核实 root 控制的恢复配置父目录，已有对象也必须通过无跟随校验。
# Create/verify root-controlled restore parents component by component, also validating existing objects.
def egress_parent(path):
    current = ''
    for part in os.path.dirname(path).split('/')[1:]:
        current += '/' + part
        try:
            os.mkdir(current, 0o755)
        except FileExistsError:
            pass
        descriptor = directory_fd(current)
        os.close(descriptor)


# 无跟随读取可信启动配置，限 64 KiB，真实缺失返回 None。
# Read trusted boot configuration without links, bounded to 64 KiB; actual absence returns None.
def egress_boot_read(path):
    parent = directory_fd(os.path.dirname(path))
    try:
        try:
            descriptor = os.open(os.path.basename(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            return None
    finally:
        os.close(parent)
    with os.fdopen(descriptor, 'rb') as stream:
        trusted(os.fstat(stream.fileno()))
        raw = stream.read(65537)
        if len(raw) > 65536:
            refuse('EGRESS_BOOT_CHANGED')
        return raw


# 核实旧所有权记录后按 init 管理器安装/恢复固定启动防护，使用持久阶段支持中断重试。
# Validate prior ownership and install/recover fixed init guards using durable phases for interrupted retries.
def egress_bootstrap(build):
    manager = 'systemd' if os.path.isdir('/run/systemd/system') else 'openrc' if os.path.isfile('/sbin/openrc-run') else None
    files, links, appends = egress_boot_plan(build, manager)
    path = BASE + '/egress-boot.json'
    prior = json_read(path, True, 262144)
    if prior is not None and (not isinstance(prior, dict) or set(prior) not in (
                              {'version', 'phase', 'manager', 'build', 'files', 'links'},
                              {'version', 'guards', 'phase', 'manager', 'build', 'files', 'links'}) or
                              type(prior['version']) is not int or prior['version'] != 1 or prior['phase'] not in ('pending', 'applied') or prior['manager'] != manager or
                              ('guards' in prior and (type(prior['guards']) is not int or prior['guards'] != 2)) or
                              not isinstance(prior['build'], str) or not re.fullmatch('[a-f0-9]{64}', prior['build']) or
                              not isinstance(prior['files'], dict) or not isinstance(prior['links'], dict)):
        refuse('EGRESS_BOOT_CHANGED')
    # Never accept arbitrary stored paths as write authority. Plans always come
    # from these fixed service names and this verified controller build.
    previous_files = {} if prior is None else prior['files']
    if set(previous_files) - (set(files) | set(appends)) or (prior and prior['links'] != links):
        refuse('EGRESS_BOOT_CHANGED')
    proposed = {}
    for filename in set(files) | set(appends):
        egress_parent(filename)
        raw = egress_boot_read(filename)
        saved = previous_files.get(filename)
        if saved is not None and (not isinstance(saved, dict) or set(saved) != {'sha256', 'mode', 'previousSha256'} or
                                  type(saved['mode']) is not int or saved['mode'] not in (0o600, 0o644, 0o700, 0o755) or
                                  not isinstance(saved['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', saved['sha256']) or
                                  (saved['previousSha256'] is not None and (not isinstance(saved['previousSha256'], str) or
                                    not re.fullmatch('[a-f0-9]{64}', saved['previousSha256'])))):
            refuse('EGRESS_BOOT_CHANGED')
        if filename in appends:
            block = appends[filename]
            legacy = egress_openrc_tail(os.path.basename(filename), 1)
            if raw is not None and (b'SAKURA_PROJECT_EGRESS_V1' in raw or b'SAKURA_PROJECT_EGRESS_V2' in raw):
                if saved is None:
                    refuse('EGRESS_BOOT_CHANGED')
                if raw.count(block) == 1 and raw.endswith(block) and (block == legacy or b'SAKURA_PROJECT_EGRESS_V1' not in raw):
                    data = raw
                elif prior.get('guards') != 2 and raw.count(legacy) == 1 and raw.endswith(legacy) and b'SAKURA_PROJECT_EGRESS_V2' not in raw:
                    data = raw[:-len(legacy)] + block
                elif prior['phase'] == 'pending' and raw.count(legacy) == 1 and raw.endswith(legacy) and \
                     hashlib.sha256(raw).hexdigest() == saved['previousSha256'] and b'SAKURA_PROJECT_EGRESS_V2' not in raw:
                    data = raw[:-len(legacy)] + block
                else:
                    refuse('EGRESS_BOOT_CHANGED')
            else:
                if saved is not None:
                    refuse('EGRESS_BOOT_CHANGED')
                data = (raw or b'') + block
            mode = 0o600
        else:
            data, mode = files[filename]['data'], files[filename]['mode']
            permitted = [] if saved is None else [saved['sha256']] + ([saved['previousSha256']] if prior['phase'] == 'pending' else [])
            if raw is not None and (saved is None or hashlib.sha256(raw).hexdigest() not in permitted):
                refuse('EGRESS_BOOT_CHANGED')
        if filename not in appends and raw is not None and saved is not None and prior['phase'] == 'applied' and hashlib.sha256(raw).hexdigest() != saved['sha256']:
            refuse('EGRESS_BOOT_CHANGED')
        if raw is not None and saved is not None and prior['phase'] == 'applied' and stat.S_IMODE(os.lstat(filename).st_mode) != saved['mode']:
            refuse('EGRESS_BOOT_CHANGED')
        if raw is None and saved is not None and prior['phase'] == 'applied':
            refuse('EGRESS_BOOT_CHANGED')
        proposed[filename] = {'data': data, 'mode': mode}
    for filename, destination in links.items():
        egress_parent(filename)
        if os.path.lexists(filename):
            info = os.lstat(filename)
            if not stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or os.readlink(filename) != destination or prior is None:
                refuse('EGRESS_BOOT_CHANGED')
        elif prior is not None and prior['phase'] == 'applied':
            refuse('EGRESS_BOOT_CHANGED')
    if prior is not None and prior.get('guards') == 2 and prior['phase'] == 'applied' and prior['build'] == build and \
       set(prior['files']) == set(proposed) and all(prior['files'][name]['sha256'] == hashlib.sha256(item['data']).hexdigest()
                                                 for name, item in proposed.items()):
        for filename, item in proposed.items():
            if stat.S_IMODE(os.lstat(filename).st_mode) != item['mode']:
                refuse('EGRESS_BOOT_CHANGED')
        return manager
    owner = {'version': 1, 'guards': 2, 'phase': 'pending', 'manager': manager, 'build': build,
             'files': {name: {'sha256': hashlib.sha256(item['data']).hexdigest(), 'mode': item['mode'],
                              'previousSha256': None if egress_boot_read(name) is None else hashlib.sha256(egress_boot_read(name)).hexdigest()}
                       for name, item in proposed.items()},
             'links': links}
    json_write(path, owner)
    for filename, item in proposed.items():
        if egress_boot_read(filename) != item['data']:
            atomic(filename, item['data'])
        os.chmod(filename, item['mode'], follow_symlinks=False)
        descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            trusted(os.fstat(descriptor), mode=item['mode'])
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    for filename, destination in links.items():
        if not os.path.lexists(filename):
            os.symlink(destination, filename)
        # A previous pending attempt may have created the link before its
        # directory sync failed. Sync the same Root-controlled parent even
        # when the link already exists; O_PATH pins themselves cannot fsync.
        descriptor = egress_nnp_directory(os.path.dirname(filename))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    if manager == 'systemd':
        execute([tool('systemctl'), 'daemon-reload'], timeout=30)
    else:
        execute([tool('rc-update'), '-u'], timeout=30)
    owner['phase'] = 'applied'
    json_write(path, owner)
    return manager


# 通过已固定 systemctl 映像读取指定系统属性，限制时间且不依赖调用方 PATH。
# Query system properties through the pinned systemctl image with a deadline and no caller PATH dependency.
def egress_systemd_query(descriptor, properties, unit=None):
    arguments = ['systemctl', 'show', '--system', '--no-pager', '--all', '--property=' + ','.join(properties)]
    if unit is not None:
        arguments.append(unit)
    return execute(arguments, executable='/proc/self/fd/' + str(descriptor), pass_fds=(descriptor,), timeout=15)


# 仅接受标准 SSH 服务的加载、启动、主 PID/cgroup 与 no_new_privs 证明，拒绝仅凭 PAM scope 或标题判断。
# Verify loaded standard SSH services, main PID/cgroup and no_new_privs rather than trusting PAM scopes or titles.
def egress_systemd_ssh_state(descriptor, unit):
    # A PAM session is moved out of the service's cgroup. Only the loaded
    # standard SSH service can supply its listener authority, never the scope
    # name or the accepted process's mutable title.
    properties = ('Id', 'LoadState', 'ActiveState', 'SubState', 'NeedDaemonReload', 'NoNewPrivileges', 'MainPID', 'ControlGroup')
    detail = {'manager': 'systemd', 'service': unit}
    if unit not in ('ssh.service', 'sshd.service'):
        refuse('EGRESS_NNP_SERVICE_UNVERIFIED', dict(detail, reason='ssh-unit-invalid'))
    try:
        raw = egress_systemd_query(descriptor, properties, unit)
    except Refusal:
        refuse('EGRESS_NNP_SERVICE_UNVERIFIED', dict(detail, reason='ssh-listener-authority-unavailable'))
    values = {}
    try:
        if len(raw) > 65536:
            raise ValueError()
        for line in raw.decode('utf-8').splitlines():
            if not line:
                continue
            key, value = line.split('=', 1)
            if key not in properties or key in values:
                raise ValueError()
            values[key] = value
        if set(values) != set(properties) or values['Id'] not in ('ssh.service', 'sshd.service') or \
           not re.fullmatch('0|[1-9][0-9]{0,9}', values['MainPID']) or int(values['MainPID']) > 2147483647:
            raise ValueError()
    except (UnicodeError, ValueError):
        refuse('EGRESS_NNP_SERVICE_UNVERIFIED', dict(detail, reason='ssh-listener-authority-invalid'))
    if values['NeedDaemonReload'] != 'no':
        refuse('EGRESS_NNP_PENDING', dict(detail, reason='daemon-reload-required'))
    group = '/system.slice/' + values['Id']
    if values['LoadState'] in ('loaded', 'not-found', 'masked') and values['ActiveState'] == 'inactive' and \
       values['MainPID'] == '0' and values['ControlGroup'] in ('', group):
        return None
    if values['LoadState'] != 'loaded' or values['ActiveState'] != 'active' or values['SubState'] != 'running' or \
       values['NoNewPrivileges'] != 'yes' or values['MainPID'] == '0' or values['ControlGroup'] != group:
        refuse('EGRESS_NNP_SERVICE_UNVERIFIED', dict(detail, reason='ssh-listener-authority-unqualified'))
    return values


# 读取实际 UnitPath 并规范有界搜索路径，拒绝畸形输出和不受支持路径。
# Read actual UnitPath and normalize bounded search paths, rejecting malformed or unsupported results.
def egress_systemd_paths(descriptor):
    try:
        lines = egress_systemd_query(descriptor, ('UnitPath',)).decode('utf-8').splitlines()
        if len(lines) != 1 or not lines[0].startswith('UnitPath='):
            raise ValueError()
        entries = lines[0][len('UnitPath='):].split()
        if not entries or len(entries) > 128 or any(not re.fullmatch('/[A-Za-z0-9_./@+-]+', entry) or
             os.path.normpath(entry) != entry for entry in entries):
            raise ValueError()
        # Normal merged-/usr unit search paths may themselves be Root symlinks.
        # Their resolved directories are pinned and owner-checked when scanned.
        return tuple(dict.fromkeys(os.path.realpath(entry) for entry in entries))
    except (Refusal, UnicodeError, ValueError):
        refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', {'manager': 'systemd', 'reason': 'unit-search-path-unavailable'})


# 由已固定 O_PATH 父对象重开可读目录 FD，核实 root 身份，避免再次解析路径竞态。
# Reopen a readable directory relative to its O_PATH pin and verify root ownership, avoiding path re-resolution races.
def egress_nnp_directory(path):
    # directory_fd pins paths with O_PATH. getdents/fdopendir require a readable
    # descriptor, opened relative to that pin without resolving the path again.
    parent = directory_fd(path)
    try:
        descriptor = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        try:
            trusted(os.fstat(descriptor), True)
            return descriptor
        except BaseException:
            os.close(descriptor)
            raise
    finally:
        os.close(parent)


# 列举可信 unit 目录，真实缺失返回空列表，超过 8192 项拒绝以限制预检预算。
# List a trusted unit directory; absence yields an empty list and over 8192 entries refuses.
def egress_systemd_entries(path):
    if not os.path.lexists(path):
        return []
    descriptor = egress_nnp_directory(path)
    try:
        entries = os.listdir(descriptor)
        if len(entries) > 8192:
            refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', {'manager': 'systemd', 'reason': 'unit-search-bound'})
        return entries
    finally:
        os.close(descriptor)


# 在真实 unit 搜索路径检查缺失/屏蔽服务的 fragment 与 drop-in，不能把默认 false 属性当成已保护证明。
# Inspect real search paths for absent/masked fragments and drop-ins instead of treating default properties as protection proof.
def egress_systemd_absent(unit, paths):
    # systemd does not parse drop-ins when the fragment is missing or masked.
    # Inspect the manager's actual search paths instead of trusting its default
    # NoNewPrivileges=false or claiming an absent daemon is already protected.
    detail = {'manager': 'systemd', 'service': unit}
    stem = unit[:-len('.service')]
    template = stem.split('@', 1)[0] + '@.service' if '@' in stem else unit
    scopes = {'service.d', unit + '.d', template + '.d'}
    for index, character in enumerate(stem):
        if character == '-':
            scopes.add(stem[:index + 1] + '.service.d')
    managed = False
    expected = os.path.realpath('/etc/systemd/system') + '/' + template + '.d/sakura-project-egress.conf'
    for root in paths:
        for scope in sorted(scopes):
            folder = root + '/' + scope
            for name in egress_systemd_entries(folder):
                if not name.endswith('.conf'):
                    continue
                filename = folder + '/' + name
                try:
                    raw = egress_boot_read(filename)
                except (OSError, Refusal):
                    refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, path=filename, reason='dropin-unverifiable'))
                if raw == EGRESS_SYSTEMD_GATE:
                    managed = managed or filename == expected
                    continue
                # Retain harmless operator/vendor settings. Policy-changing
                # drop-ins for absent services need a loaded effective-policy
                # check; never guess how continuations or exec prefixes parse.
                try:
                    section = None
                    for line in raw.decode('utf-8').splitlines():
                        line = line.strip()
                        if not line or line.startswith(('#', ';')):
                            continue
                        if '\\' in line:
                            raise ValueError()
                        if line in ('[Unit]', '[Service]', '[Install]'):
                            section = line
                            continue
                        key, value = line.split('=', 1)
                        key, value = key.strip(), value.strip()
                        if section is None or not re.fullmatch('[A-Za-z][A-Za-z0-9]*', key) or key.startswith('Exec') or \
                           key in ('User', 'Group', 'SupplementaryGroups', 'SecureBits', 'AmbientCapabilities') or \
                           (key == 'NoNewPrivileges' and value not in ('yes', 'true', 'on', '1')):
                            raise ValueError()
                except (AttributeError, UnicodeError, ValueError):
                    refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, path=filename, reason='unqualified-extra-dropin'))
    if not managed:
        refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, reason='managed-future-policy-unavailable'))


# 核对系统服务的启动命令、用户、能力及 NNP 属性，拒绝未加载、待重载或绕开守卫的配置。
# Check service commands, user, capabilities and NNP properties, refusing unloaded, stale or guard-bypassing configuration.
def egress_systemd_nnp(units):
    executable = os.path.realpath(tool('systemctl'))
    parent = directory_fd(os.path.dirname(executable))
    descriptor, paths = None, None
    commands = ('ExecStart', 'ExecStartPre', 'ExecStartPost', 'ExecCondition', 'ExecReload', 'ExecStop', 'ExecStopPost')
    base = ('Id', 'LoadState', 'ActiveState', 'NeedDaemonReload', 'NoNewPrivileges', 'User', 'AmbientCapabilities', 'SecureBits')
    properties = base + tuple(name for command in commands for name in (command, command + 'Ex'))
    try:
        descriptor = os.open(os.path.basename(executable), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        info = os.fstat(descriptor)
        trusted(info)
        if not info.st_mode & 0o111 or info.st_mode & 0o6000:
            refuse('EGRESS_NNP_UNSUPPORTED', {'manager': 'systemd'})
        pending = []
        for unit in units:
            if unit.endswith('@.service'):
                unit = unit[:-len('.service')] + 'sakura-nnp-check.service'
            pending.append(unit)
        if any(unit.startswith(('ssh@', 'sshd@')) for unit in pending):
            paths = egress_systemd_paths(descriptor)
            # Instance-specific fragments/drop-ins can override the template.
            # Qualify every currently installed SSH instance, not only a probe.
            for root in paths:
                for name in egress_systemd_entries(root):
                    instance = name[:-2] if name.endswith('.service.d') else name
                    if re.fullmatch('sshd?@[^/@]+\\.service', instance) and '@.service' not in instance:
                        pending.append(instance)
        pending = list(dict.fromkeys(pending))
        if len(pending) > 1024:
            refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', {'manager': 'systemd', 'reason': 'unit-search-bound'})
        for unit in pending:
            detail = {'manager': 'systemd', 'service': unit}
            try:
                raw = egress_systemd_query(descriptor, properties, unit)
            except Refusal:
                refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, reason='effective-policy-unavailable'))
            values = {}
            try:
                for line in raw.decode('utf-8').splitlines():
                    if not line:
                        continue
                    key, value = line.split('=', 1)
                    if key not in properties or (key in values and not key.startswith('Exec')):
                        raise ValueError()
                    values.setdefault(key, []).append(value)
            except (ValueError, UnicodeError):
                refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, reason='effective-policy-invalid'))
            if any(key not in values or len(values[key]) != 1 for key in base):
                refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, reason='effective-policy-incomplete'))
            aliases = {'ssh.service', 'sshd.service'} if unit in ('ssh.service', 'sshd.service') else \
                      {'cron.service', 'crond.service', 'cronie.service'} if unit in ('cron.service', 'crond.service', 'cronie.service') else {unit}
            if values['Id'][0] not in aliases:
                refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, reason='effective-unit-changed'))
            if values['NeedDaemonReload'][0] != 'no':
                refuse('EGRESS_NNP_PENDING', dict(detail, reason='daemon-reload-required'))
            state = values['LoadState'][0]
            if state in ('not-found', 'masked') and values['ActiveState'][0] == 'inactive':
                if paths is None:
                    paths = egress_systemd_paths(descriptor)
                egress_systemd_absent(unit, paths)
                continue
            if state != 'loaded' or values['NoNewPrivileges'][0] != 'yes':
                refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, reason='effective-no-new-privileges'))
            account = re.fullmatch('user@([1-9][0-9]*)\\.service', unit)
            if account:
                uid = account.group(1)
                allowed_users = {uid}
                try:
                    allowed_users.add(pwd.getpwuid(int(uid)).pw_name)
                except KeyError:
                    pass
                if values['User'][0] not in allowed_users or values['AmbientCapabilities'][0] or values['SecureBits'][0] != '0':
                    refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, reason='user-manager-identity-or-capabilities'))
            # Both printers omit empty exec arrays even with --all. A populated
            # legacy command must have an equally populated extended property;
            # otherwise this systemd cannot expose authoritative prefix flags.
            if not any(values.get('ExecStartEx', [])):
                refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, reason='effective-start-unavailable'))
            for key in commands:
                legacy = [command for command in values.get(key, []) if command]
                extended = [command for command in values.get(key + 'Ex', []) if command]
                if len(legacy) != len(extended):
                    refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, reason='effective-exec-flags-unavailable'))
                for command in extended:
                    if not command.startswith('{ path=') or not command.endswith(' }'):
                        refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, reason='effective-exec-flags-invalid'))
                    # The real flag field follows argv, which may itself contain
                    # text resembling the printer's field names.
                    pieces = command.rsplit(' ; flags=', 1)
                    if len(pieces) != 2 or ' ; start_time=' not in pieces[1]:
                        refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, reason='effective-exec-flags-invalid'))
                    flags = pieces[1].split(' ; start_time=', 1)[0].split()
                    if any(flag not in ('ignore-failure', 'no-env-expand', 'via-shell') for flag in flags):
                        refuse('EGRESS_NNP_SERVICE_UNSUPPORTED', dict(detail, reason='privileged-or-unknown-exec-flag'))
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent)


# 要求启动防护所有权记录完整 applied，核对管理器、构建与已安装文件后返回管理器。
# Require an applied boot-guard ownership record and verify manager/build/installed files before returning the manager.
def egress_nnp_configuration():
    owner = json_read(BASE + '/egress-boot.json', True, 262144)
    if not isinstance(owner, dict) or set(owner) != {'version', 'guards', 'phase', 'manager', 'build', 'files', 'links'} or \
       type(owner['version']) is not int or owner['version'] != 1 or type(owner['guards']) is not int or owner['guards'] != 2 or \
       owner['phase'] != 'applied' or not isinstance(owner['build'], str) or not re.fullmatch('[a-f0-9]{64}', owner['build']):
        refuse('EGRESS_NNP_PENDING')
    manager = 'systemd' if os.path.isdir('/run/systemd/system') else 'openrc' if os.path.isfile('/sbin/openrc-run') else None
    if manager != owner['manager']:
        refuse('EGRESS_NNP_UNSUPPORTED')
    files, links, appends = egress_boot_plan(owner['build'], manager)
    if not isinstance(owner['files'], dict) or set(owner['files']) != set(files) | set(appends) or owner['links'] != links:
        refuse('EGRESS_NNP_PENDING')
    for filename in set(files) | set(appends):
        item = owner['files'][filename]
        if not isinstance(item, dict) or set(item) != {'sha256', 'mode', 'previousSha256'} or \
           not isinstance(item['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', item['sha256']):
            refuse('EGRESS_NNP_PENDING')
        raw = egress_boot_read(filename)
        expected_mode = files[filename]['mode'] if filename in files else 0o600
        if raw is None or item['mode'] != expected_mode or stat.S_IMODE(os.lstat(filename).st_mode) != expected_mode:
            refuse('EGRESS_NNP_PENDING')
        if filename in files:
            if raw != files[filename]['data'] or hashlib.sha256(raw).hexdigest() != item['sha256']:
                refuse('EGRESS_NNP_PENDING')
        elif not raw.endswith(appends[filename]) or raw.count(appends[filename]) != 1:
            refuse('EGRESS_NNP_PENDING')
    for filename, destination in links.items():
        info = os.lstat(filename)
        if not stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or os.readlink(filename) != destination:
            refuse('EGRESS_NNP_PENDING')
    if manager == 'systemd':
        egress_systemd_nnp(EGRESS_SYSTEMD_UNITS)
    return manager


# 固定 /proc 进程目录，前后核对创建时刻并读取身份、映像、能力、NNP 和 cgroup；消失可返回 None。
# Pin a proc directory, bracket reads with birth checks and capture identity/image/caps/NNP/cgroup; vanished processes may return None.
def egress_nnp_process(parent, pid):
    descriptor = None
    try:
        descriptor = os.open(str(pid), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        # 相对于已固定进程目录有界读取单个 proc 字段，超限拒绝并总是关闭 FD。
        # Read one bounded proc field relative to the pinned process, refusing excess and always closing its FD.
        def part(name, limit=16384):
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
            try:
                raw = os.read(fd, limit + 1)
                if len(raw) > limit:
                    refuse('EGRESS_NNP_PROCESS_CHANGED', {'pid': pid, 'reason': 'process-field-too-large', 'file': name})
                return raw
            finally:
                os.close(fd)
        # 从固定进程 stat 解析父 PID 与创建 ticks，校验字段形状以识别 PID 重用。
        # Parse parent PID/birth ticks from pinned stat and validate shape to detect PID reuse.
        def identity():
            fields = part('stat').rsplit(b') ', 1)[1].split()
            if len(fields) < 20 or any(not re.fullmatch(b'0|[1-9][0-9]*', fields[index]) for index in (1, 19)):
                refuse('EGRESS_NNP_PROCESS_CHANGED', {'pid': pid, 'reason': 'process-stat-invalid'})
            return int(fields[1]), fields[19].decode('ascii')
        parent_pid, start = identity()
        status = dict(line.split(b':', 1) for line in part('status').splitlines() if b':' in line)
        uids = [int(item) for item in status[b'Uid'].split()]
        if len(uids) != 4 or status[b'NoNewPrivs'].strip() not in (b'0', b'1'):
            refuse('EGRESS_NNP_PROCESS_CHANGED', {'pid': pid, 'reason': 'process-uid-or-nnp-invalid'})
        executable = os.readlink('exe', dir_fd=descriptor)
        image = os.stat('exe', dir_fd=descriptor)
        arguments = part('cmdline', 65536).rstrip(b'\0').split(b'\0')
        groups = part('cgroup').decode('utf-8').splitlines()
        membership = next((line[3:] for line in groups if line.startswith('0::')), None)
        final_image = os.stat('exe', dir_fd=descriptor)
        if identity() != (parent_pid, start) or (final_image.st_dev, final_image.st_ino) != (image.st_dev, image.st_ino) or \
           os.readlink('exe', dir_fd=descriptor) != executable:
            refuse('EGRESS_NNP_PROCESS_CHANGED', {'pid': pid, 'reason': 'process-identity-or-image-changed'})
        return dict(pid=pid, parentPid=parent_pid, startTicks=start, executable=executable, image=image, uids=uids,
                    nnp=int(status[b'NoNewPrivs']), arguments=arguments, cgroupName=membership,
                    caps=[int(status[key].strip(), 16) for key in (b'CapEff', b'CapPrm', b'CapAmb')])
    except (FileNotFoundError, ProcessLookupError):
        return None
    finally:
        if descriptor is not None:
            os.close(descriptor)


# 有界读取内核 stat 创建身份及僵尸状态，缺失返回 None，畸形或变化拒绝。
# Read bounded kernel birth identity/inactive state; absence returns None and malformed/changed data refuses.
def egress_nnp_birth(parent, pid):
    descriptor, file_descriptor = None, None
    try:
        descriptor = os.open(str(pid), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        file_descriptor = os.open('stat', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
        raw = os.read(file_descriptor, 16385)
        prefix, separator, rest = raw.rpartition(b') ')
        fields = rest.split()
        if len(raw) > 16384 or not separator or not prefix.startswith(str(pid).encode() + b' (') or \
           len(fields) < 20 or any(not re.fullmatch(b'0|[1-9][0-9]*', fields[index]) for index in (6, 19)) or \
           int(fields[6]) > 0xffffffff:
            refuse('EGRESS_NNP_PROCESS_CHANGED', {'pid': pid, 'reason': 'process-birth-invalid'})
        # Linux fs/proc/array.c emits task->flags at stat field 9 (index 6
        # after the comm); sched.h defines PF_KTHREAD as 0x00200000. Only
        # these kernel facts, never comm, justify a missing userspace image.
        return dict(startTicks=fields[19].decode('ascii'), inactive=fields[0] in (b'Z', b'X') or bool(int(fields[6]) & 0x00200000))
    except (FileNotFoundError, ProcessLookupError):
        if descriptor is not None:
            try:
                os.stat(str(pid), dir_fd=parent, follow_symlinks=False)
            except (FileNotFoundError, ProcessLookupError):
                return None
            refuse('EGRESS_NNP_PROCESS_CHANGED', {'pid': pid, 'reason': 'process-birth-unavailable'})
        return None
    finally:
        if file_descriptor is not None:
            os.close(file_descriptor)
        if descriptor is not None:
            os.close(descriptor)


# 先完整采集再进行有界增量 census，核实缓存 PID 的真实创建时刻；最终 census 是观察边界而非未来无 fork 保证。
# Collect a full snapshot then bounded incremental censuses, checking cached PID births; the last census bounds observation, not future forks.
def egress_nnp_snapshot(parent, manager):
    # The first collection is complete. Afterwards, bounded censuses add every
    # enumerated new process instead of requiring the whole machine to stop
    # forking. A cached PID still needs its actual kernel birth checked. The
    # final census is the observation boundary, not a claim about future forks.
    deadline, increment = None, 0
    # 在每个采集边界检查单调时间截止，超时拒绝而不返回不完整快照。
    # Check the monotonic collection deadline at each boundary; timeout refuses instead of returning an incomplete snapshot.
    def budget():
        if deadline is not None and time.monotonic() >= deadline:
            refuse('EGRESS_NNP_PROCESS_CHANGED', {'reason': 'process-snapshot-deadline'})
    # 有界列举 /proc 数字 PID，并在前后检查截止时间，过多进程拒绝。
    # Enumerate bounded numeric proc PIDs with deadline checks before/after; excessive process counts refuse.
    def entries():
        budget()
        found = [int(name) for name in os.listdir(parent) if re.fullmatch('[1-9][0-9]*', name)]
        budget()
        if len(found) > 32768:
            refuse('EGRESS_NNP_PROCESS_LIMIT')
        return found
    # 把进程变化诊断补充管理器、快照阶段及重试轮数，便于外层报告具体失败边界。
    # Add manager, snapshot stage and retry-round details to process-change diagnostics.
    def changed(error):
        detail = dict(error.detail) if isinstance(error.detail, dict) else {'reason': 'process-read-changed'}
        detail.update(manager=manager, stage='process-snapshot', snapshotAttempts=attempt, incrementRounds=increment)
        return detail
    # 在预算内读取进程，若读取未完整却仍有活动同 PID 则拒绝，避免静默跳过权限对象。
    # Read within budget; refuse an incomplete read if that PID remains active instead of silently omitting authority.
    def read_process(pid):
        budget()
        process = egress_nnp_process(parent, pid)
        budget()
        if process is None:
            remaining = egress_nnp_birth(parent, pid)
            budget()
            if remaining is not None and not remaining['inactive']:
                refuse('EGRESS_NNP_PROCESS_CHANGED', {'pid': pid, 'reason': 'process-read-incomplete'})
        return process
    for attempt in range(1, 4):
        try:
            processes = {}
            for pid in entries():
                process = read_process(pid)
                if process is not None:
                    processes[pid] = process
            break
        except Refusal as error:
            if error.code != 'EGRESS_NNP_PROCESS_CHANGED':
                raise
            if deadline is None:
                deadline = time.monotonic() + 15
            if attempt == 3 or time.monotonic() >= deadline:
                refuse(error.code, changed(error))
    if deadline is None:
        deadline = time.monotonic() + 15
    try:
        for increment in range(1, 4):
            added = False
            for pid in entries():
                budget()
                previous = processes.get(pid)
                if previous is not None:
                    birth = egress_nnp_birth(parent, pid)
                    if birth is not None and birth['startTicks'] != previous['startTicks']:
                        refuse('EGRESS_NNP_PROCESS_CHANGED', {'pid': pid, 'reason': 'process-pid-reused'})
                else:
                    process = read_process(pid)
                    if process is not None:
                        processes[pid] = process
                        added = True
                        if len(processes) > 32768:
                            refuse('EGRESS_NNP_PROCESS_LIMIT')
                budget()
            if not added:
                break
        return processes
    except Refusal as error:
        if error.code != 'EGRESS_NNP_PROCESS_CHANGED':
            raise
        refuse(error.code, changed(error))


# 按固定映像、创建时刻和父链检查 root 服务的实际 NNP；普通 SSH 子进程需证明可信监听者归属，替代对象拒绝。
# Verify live root services’ NNP from pinned images, births and ancestry; SSH children need trusted-listener ownership proof.
def egress_nnp_live(value, manager):
    # Proc directory FDs pin the actual process while its start ticks, image and
    # cgroup are checked. Neither a process title alone nor a stale PID file is
    # accepted as proof that an ordinary root daemon has the required flag.
    services = {'sshd': ('/usr/sbin/sshd', '/usr/sbin/sshd.pam', '/usr/sbin/sshd.krb5',
                         '/usr/lib/ssh/sshd-session', '/usr/lib/ssh/sshd-auth',
                         '/usr/lib/openssh/sshd-session', '/usr/lib/openssh/sshd-auth',
                         '/usr/libexec/openssh/sshd-session', '/usr/libexec/openssh/sshd-auth'),
                'cron': ('/usr/sbin/cron',), 'crond': ('/usr/sbin/crond',),
                'cronie': ('/usr/sbin/crond',), 'atd': ('/usr/sbin/atd',)}
    images, known_paths = {}, {}
    for service, names in services.items():
        for name in names:
            if not os.path.isfile(name):
                continue
            resolved = os.path.realpath(name)
            parent = directory_fd(os.path.dirname(resolved))
            try:
                descriptor = os.open(os.path.basename(resolved), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
                try:
                    info = os.fstat(descriptor)
                    trusted(info)
                    images.setdefault((info.st_dev, info.st_ino), []).append((service, name))
                    known_paths.setdefault(resolved, []).append((service, name))
                finally:
                    os.close(descriptor)
            finally:
                os.close(parent)
    # 从精确映像身份匹配受支持服务，包升级的 deleted 映像仅在可信所有权及已知内核路径下回退。
    # Match supported services by exact image identity, allowing deleted-image fallback only with trusted ownership/known kernel paths.
    def candidates_for(process):
        candidates = images.get((process['image'].st_dev, process['image'].st_ino), [])
        if not candidates and process['image'].st_uid == 0 and stat.S_ISREG(process['image'].st_mode) and not process['image'].st_mode & 0o022:
            # Package replacement can leave accepted connections running the
            # former Root-owned image. Its exact kernel exe path still matters.
            candidates = known_paths.get(process['executable'].removesuffix(' (deleted)'), [])
        return candidates
    parent = egress_nnp_directory('/proc')
    systemd_descriptor = None
    try:
        processes = egress_nnp_snapshot(parent, manager)
        # Only the verified controller's real, all-root ancestor chain proves
        # an already authenticated Root administration connection. A mutable
        # sshd title naming "root" is not authentication evidence. The listener
        # remains subject to NNP even when it is an ancestor of this request.
        root_ancestors = set()
        ancestor = processes.get(os.getpid())
        while ancestor is not None and ancestor['uids'] == [0] * 4:
            if ancestor['pid'] in root_ancestors or len(root_ancestors) >= 128:
                refuse('EGRESS_NNP_PROCESS_CHANGED', {'manager': manager, 'reason': 'root-ancestor-cycle-or-limit',
                       'pid': ancestor['pid']})
            root_ancestors.add(ancestor['pid'])
            ancestor = processes.get(ancestor['parentPid'])
        if os.getpid() not in root_ancestors:
            refuse('EGRESS_NNP_PROCESS_CHANGED', {'manager': manager, 'reason': 'controller-process-not-root-or-missing',
                   'pid': os.getpid()})
        listeners = {}
        # 重采关键身份和映像字段，发现进程消失、替换或状态漂移就拒绝。
        # Resample key process/image fields and refuse disappearance, replacement or drift.
        def checked(process):
            current = egress_nnp_process(parent, process['pid'])
            fields = ('pid', 'parentPid', 'startTicks', 'executable', 'uids', 'nnp', 'caps', 'cgroupName')
            image_fields = ('st_dev', 'st_ino', 'st_uid', 'st_mode')
            if current is None or any(current[key] != process[key] for key in fields) or \
               any(getattr(current['image'], key) != getattr(process['image'], key) for key in image_fields):
                refuse('EGRESS_NNP_PROCESS_CHANGED', {'manager': manager, 'pid': process['pid'], 'service': 'sshd'})
            return current
        # 判断已核实映像候选中是否包含受支持 SSH 服务。
        # Determine whether verified image candidates include a supported SSH service.
        def ssh_image(process):
            return any(service == 'sshd' for service, _command in candidates_for(process))
        # 识别 root 普通 SSH 监听映像和命令形态，排除本项目固定 sshd 配置与拆分会话进程。
        # Identify ordinary root SSH listeners and command forms, excluding project configs and split session helpers.
        def listener_image(process):
            if process['uids'] != [0] * 4:
                return False
            arguments = process['arguments']
            first = arguments[0] if arguments else b''
            if any(re.fullmatch(b'/etc/sakura/ssh/(default|[a-f0-9]{16})/sshd_config', arg) for arg in arguments):
                return False
            return any(service == 'sshd' and os.path.basename(command) not in ('sshd-session', 'sshd-auth') and
                       (first in (command.encode(), os.path.basename(command).encode()) or b' [listener]' in first)
                       for service, command in candidates_for(process))
        # 要求真实 SSH 进程已设置 NNP，否则报告精确创建身份及需要重启的服务。
        # Require NNP on the real SSH process or report its exact identity and required service restart.
        def protected(process):
            if process['nnp'] != 1:
                refuse('EGRESS_NNP_RESTART_REQUIRED', dict(manager=manager, service='sshd', pid=process['pid'],
                       parentPid=process['parentPid'], startTicks=process['startTicks'], executable=process['executable'],
                       cgroupName=process['cgroupName']))
        # 由可信 PID 文件固定真实受保护监听者，再以未变化父链证明接受连接/拆分子进程的归属。
        # Anchor protected listeners from trusted PID files, then prove accepted/split children through unchanged ancestry.
        def openrc_ssh_owned(process, aliases):
            # Standard OpenRC daemons may inherit '/' before cgroups mount.
            # A Root PID file anchors only an actual protected listener; its
            # accepted/split SSH children need an unchanged kernel parent chain.
            for alias in aliases:
                if alias not in listeners:
                    path = '/run/' + alias + '.pid'
                    raw = egress_boot_read(path)
                    listener = processes.get(int(raw.strip())) if raw is not None and re.fullmatch(b'[1-9][0-9]{0,9}', raw.strip()) else None
                    listeners[alias] = None
                    if listener is not None and listener_image(listener):
                        listener = checked(listener)
                        if listener_image(listener):
                            protected(listener)
                            listeners[alias] = (path, raw, listener)
                authority = listeners[alias]
                if authority is None:
                    continue
                path, raw, listener = authority
                trail, seen, current = [], set(), process
                while current is not None:
                    if current['pid'] in seen or len(seen) >= 128:
                        refuse('EGRESS_NNP_PROCESS_CHANGED', {'manager': manager, 'pid': process['pid'], 'service': 'sshd'})
                    if not ssh_image(current):
                        break
                    seen.add(current['pid'])
                    current = checked(current)
                    protected(current)
                    trail.append(current)
                    if current['pid'] == listener['pid']:
                        # Recheck each relationship after reaching the fixed
                        # listener, including UID/image changes or reparenting.
                        for node in reversed(trail):
                            checked(node)
                        if not listener_image(checked(listener)) or egress_boot_read(path) != raw:
                            refuse('EGRESS_NNP_PROCESS_CHANGED', {'manager': manager, 'pid': listener['pid'], 'service': 'sshd'})
                        return True
                    following = processes.get(current['parentPid'])
                    if following is not None and int(following['startTicks']) > int(current['startTicks']):
                        refuse('EGRESS_NNP_PROCESS_CHANGED', {'manager': manager, 'pid': current['pid'], 'service': 'sshd'})
                    current = following
            return False
        systemd_listeners, systemd_authorities, systemd_nodes = {}, {}, {}
        # 要求可执行、root 所有且非特权/可写的映像与已知 SSH 路径同时匹配。
        # Require a root-owned executable without unsafe mode bits, matching both exact image and known SSH path.
        def systemd_ssh_image(process):
            info = process['image']
            return info.st_uid == 0 and stat.S_ISREG(info.st_mode) and not info.st_mode & 0o6022 and \
                   bool(info.st_mode & 0o111) and \
                   any(service == 'sshd' for service, _command in images.get((info.st_dev, info.st_ino), [])) and \
                   any(service == 'sshd' for service, _command in known_paths.get(process['executable'], []))
        # 对 PAM session scope 查询标准 SSH 服务主进程与固定父链，不能用 scope 名称单独授权。
        # Prove PAM session-scope ownership from the standard SSH service main process and pinned ancestry.
        def systemd_ssh_owned(process, aliases):
            nonlocal systemd_descriptor
            scope = process['cgroupName'] or ''
            if not re.fullmatch(r'/user\.slice/user-(?:0|[1-9][0-9]*)\.slice/session-(?:[1-9][0-9]*|c[1-9][0-9]*)\.scope', scope):
                return False
            if systemd_descriptor is None:
                executable = os.path.realpath(tool('systemctl'))
                directory = directory_fd(os.path.dirname(executable))
                try:
                    systemd_descriptor = os.open(os.path.basename(executable), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
                    info = os.fstat(systemd_descriptor)
                    trusted(info)
                    if not info.st_mode & 0o111 or info.st_mode & 0o6000:
                        refuse('EGRESS_NNP_UNSUPPORTED', {'manager': 'systemd'})
                finally:
                    os.close(directory)
            for alias in aliases:
                unit = alias + '.service'
                if unit not in systemd_listeners:
                    authority = egress_systemd_ssh_state(systemd_descriptor, unit)
                    systemd_listeners[unit] = None
                    listener = processes.get(int(authority['MainPID'])) if authority is not None else None
                    if listener is not None and systemd_ssh_image(listener) and listener_image(listener) and \
                       listener['cgroupName'] == authority['ControlGroup']:
                        listener = checked(listener)
                        protected(listener)
                        if listener_image(listener):
                            systemd_listeners[unit] = (authority, listener)
                receipt = systemd_listeners[unit]
                if receipt is None:
                    continue
                authority, listener = receipt
                trail, seen, current = [], set(), process
                while current is not None:
                    if current['pid'] in seen or len(seen) >= 128:
                        refuse('EGRESS_NNP_PROCESS_CHANGED', {'manager': manager, 'pid': process['pid'], 'service': 'sshd'})
                    if not systemd_ssh_image(current) or current['cgroupName'] not in (scope, authority['ControlGroup']):
                        break
                    seen.add(current['pid'])
                    current = checked(current)
                    protected(current)
                    trail.append(current)
                    if current['pid'] == listener['pid']:
                        for node in reversed(trail):
                            checked(node)
                            systemd_nodes[node['pid']] = node
                        if not listener_image(checked(listener)):
                            refuse('EGRESS_NNP_PROCESS_CHANGED', {'manager': manager, 'pid': listener['pid'], 'service': 'sshd'})
                        systemd_authorities[unit] = authority
                        return True
                    following = processes.get(current['parentPid'])
                    if following is not None and int(following['startTicks']) > int(current['startTicks']):
                        refuse('EGRESS_NNP_PROCESS_CHANGED', {'manager': manager, 'pid': current['pid'], 'service': 'sshd'})
                    current = following
            return False
        for process in processes.values():
            detail = dict(manager=manager, pid=process['pid'], parentPid=process['parentPid'], startTicks=process['startTicks'],
                          executable=process['executable'], cgroupName=process['cgroupName'])
            if value['uid'] in process['uids']:
                # A verified setuid launcher is briefly root before its fixed
                # native drop. Project code cannot execute in this interval.
                native = re.fullmatch(re.escape(BUILDS) + '/[a-f0-9]{64}/launch', process['executable'])
                if native and process['uids'][1] == 0 and process['image'].st_uid == 0 and \
                   stat.S_IMODE(process['image'].st_mode) == 0o4755:
                    continue
                detail['service'] = 'project-existing-process'
                if process['nnp'] != 1:
                    refuse('EGRESS_NNP_RESTART_REQUIRED', detail)
                if process['uids'] != [value['uid']] * 4 or any(process['caps']):
                    refuse('EGRESS_NNP_ACCOUNT_PRIVILEGED', detail)
                continue
            for service, command in candidates_for(process):
                arguments = process['arguments']
                first = arguments[0] if arguments else b''
                direct = first in (command.encode(), os.path.basename(command).encode())
                ssh_helper = service == 'sshd' and os.path.basename(command) in ('sshd-session', 'sshd-auth')
                listener = service == 'sshd' and not ssh_helper and (direct or b' [listener]' in first)
                busybox = service in ('crond', 'cronie') and len(arguments) > 1 and arguments[1] == b'crond'
                # Every live sshd image matters, including accepted/pre-auth
                # Root children and ordinary user sessions surviving a listener
                # restart. Cron/at daemons are Root and keep their launch argv.
                if service != 'sshd' and (process['uids'] != [0] * 4 or not (direct or busybox)):
                    continue
                # Dedicated project SSH is admitted by the separate daemon/run
                # receipt and drops in the native launcher on every session.
                if service == 'sshd' and (any(re.fullmatch(b'/etc/sakura/ssh/(default|[a-f0-9]{16})/sshd_config', arg) for arg in arguments) or
                   re.fullmatch('/(?:openrc\\.sakura-ssh-(?:default|[a-f0-9]{16})|system\\.slice/sakura-ssh-(?:default|[a-f0-9]{16})\\.service)(?:/.*)?',
                                process['cgroupName'] or '')):
                    continue
                if service == 'sshd' and not listener and process['pid'] in root_ancestors:
                    continue
                aliases = ('ssh', 'sshd') if service == 'sshd' else ('cron', 'crond', 'cronie') if service in ('cron', 'crond', 'cronie') else ('atd',)
                domains = [('/system.slice/' + alias + '.service' if manager == 'systemd' else '/openrc.' + alias) for alias in aliases]
                owned_group = any(process['cgroupName'] == domain or (process['cgroupName'] or '').startswith(domain + '/') for domain in domains)
                if service == 'sshd' and manager == 'systemd' and re.fullmatch(
                   r'/system\.slice/(?:system-sshd?\.slice/)?sshd?@[^/]+\.service(?:/.*)?', process['cgroupName'] or ''):
                    owned_group = True
                detail['service'] = service
                if process['nnp'] != 1:
                    # An old orphaned sshd connection may retain its actual
                    # installed image while its former PID file has been replaced.
                    # Refuse it instead of claiming a listener restart secured it.
                    refuse('EGRESS_NNP_RESTART_REQUIRED', detail)
                if not owned_group:
                    # OpenRC can have been started before unified cgroups were
                    # mounted. Its exact root PID file is a second authority,
                    # checked against the already-pinned actual daemon image.
                    owned_pid = False
                    if manager == 'openrc' and service == 'sshd':
                        owned_pid = openrc_ssh_owned(process, aliases)
                    elif manager == 'systemd' and service == 'sshd':
                        owned_pid = systemd_ssh_owned(process, aliases)
                    elif manager == 'openrc':
                        for alias in aliases:
                            raw = egress_boot_read('/run/' + alias + '.pid')
                            if raw is not None and raw.strip() == str(process['pid']).encode():
                                owned_pid = True
                                break
                    if not owned_pid:
                        refuse('EGRESS_NNP_SERVICE_UNVERIFIED', detail)
                break
        # Each used standard service is queried once before its first PAM
        # chain and once here. Even many sessions use at most four queries;
        # revalidate the pinned kernel chains after the final authority query.
        for unit, authority in systemd_authorities.items():
            detail = {'manager': manager, 'service': unit, 'reason': 'ssh-listener-authority-changed'}
            try:
                current = egress_systemd_ssh_state(systemd_descriptor, unit)
            except Refusal:
                refuse('EGRESS_NNP_PROCESS_CHANGED', detail)
            if current != authority:
                refuse('EGRESS_NNP_PROCESS_CHANGED', detail)
        for node in systemd_nodes.values():
            checked(node)
            protected(node)
    finally:
        if systemd_descriptor is not None:
            os.close(systemd_descriptor)
        os.close(parent)


# 先检查持久配置，再检查需要的 systemd 用户服务和真实进程 NNP。
# Check durable configuration, required systemd user service and actual live-process NNP.
def egress_nnp_check(value):
    manager = egress_nnp_configuration()
    if manager == 'systemd':
        egress_systemd_nnp(('user@' + str(value['uid']) + '.service',))
    egress_nnp_live(value, manager)


# 为所有预留身份恢复出站防护，包括未完成账号；先检查启动守卫，再按精确记录提交规则。
# Restore egress guards for all reserved identities including incomplete accounts, checking boot guards before exact-rule commits.
def egress_restore(store):
    manager = egress_nnp_configuration()
    count = 0
    # Intent accounts also get their reserved UID blocked before any SSH/cron
    # process may start, even if their directory migration is still pending.
    for reservation in store['reserved'].values():
        value = binding_read(reservation['projectId'], True)
        if value is None:
            continue
        reservation_check(value, store)
        if value['networkIsolation'] == 'private' and manager == 'systemd':
            egress_systemd_nnp(('user@' + str(value['uid']) + '.service',))
        egress_prepare(value, restoring=True)
        egress_commit(value, allow_intent=True, check_nnp=False)
        count += value['networkIsolation'] == 'private'
    return {'version': 1, 'privateAccounts': count}


# 构造项目网络记录的固定路径，suffix 仅由内部固定调用点提供。
# Build fixed project-network record paths with suffixes supplied only by internal call sites.
def network_path(project, suffix='.json'):
    return RUNTIME + '/networks/' + project + suffix


# 严格检查网络记录的字段、UUID、修订和命名空间身份，返回已验证记录。
# Strictly validate network fields, UUIDs, revision and namespace identity before returning the record.
def network_record(value):
    keys = {'version', 'registryId', 'identityId', 'projectId', 'revision', 'bootId',
            'namespace', 'networkDevice', 'networkInode', 'generation'}
    if not isinstance(value, dict) or set(value) != keys or type(value['version']) is not int or value['version'] != 1 or \
       type(value['revision']) is not int or not 1 <= value['revision'] <= 9007199254740991:
        refuse('NETWORK_RECORD_INVALID')
    for key in ('registryId', 'identityId', 'bootId', 'generation'):
        identifier(value[key], UUID, 'NETWORK_RECORD_INVALID')
    identifier(value['projectId'], PROJECT, 'NETWORK_RECORD_INVALID')
    if value['namespace'] != 'sk-' + value['projectId']:
        refuse('NETWORK_RECORD_INVALID')
    for key in ('networkDevice', 'networkInode'):
        if not isinstance(value[key], str) or not re.fullmatch('0|[1-9][0-9]*', value[key]) or int(value[key]) > 18446744073709551615:
            refuse('NETWORK_RECORD_INVALID')
    if value['networkInode'] == '0':
        refuse('NETWORK_RECORD_INVALID')
    return value


# 要求私有网络记录与绑定注册表、身份、项目和修订完全匹配。
# Require private-network records to match registry, identity, project and revision exactly.
def network_matches(value, network):
    if value['networkIsolation'] != 'private' or any(network[key] != value[key] for key in ('registryId', 'identityId', 'projectId', 'revision')):
        refuse('NETWORK_STALE')


# 移除仅用于控制的项目 ID/代次字段，生成网络 pin 的稳定物理身份内容。
# Remove control-only project/generation fields to form the stable network-pin identity.
def network_plain(network):
    return {key: item for key, item in network.items() if key not in ('projectId', 'generation')}


# 读取并校验项目当前网络 pin，真实缺失返回 None。
# Read/validate the project’s current network pin; actual absence returns None.
def network_pin(project):
    pin = json_read(network_path(project), True)
    if pin is None:
        return None
    if not isinstance(pin, dict) or set(pin) != {'version', 'registryId', 'identityId', 'revision', 'bootId', 'namespace', 'networkDevice', 'networkInode'} or \
       type(pin['version']) is not int or pin['version'] != 1 or type(pin['revision']) is not int or not 1 <= pin['revision'] <= 9007199254740991:
        refuse('NETWORK_RECORD_INVALID')
    for key in ('registryId', 'identityId', 'bootId'):
        identifier(pin[key], UUID, 'NETWORK_RECORD_INVALID')
    if pin['namespace'] not in ('', 'sk-' + project):
        refuse('NETWORK_RECORD_INVALID')
    for key in ('networkDevice', 'networkInode'):
        if not isinstance(pin[key], str) or not re.fullmatch('0|[1-9][0-9]*', pin[key]) or int(pin[key]) > 18446744073709551615:
            refuse('NETWORK_RECORD_INVALID')
    if pin['networkInode'] == '0':
        refuse('NETWORK_RECORD_INVALID')
    return pin


# 无跟随读取指定 netns 的物理身份，真实缺失返回 None，替代类型拒绝。
# Read the named netns physical identity without links; absence returns None and invalid types refuse.
def namespace_stat(namespace):
    try:
        parent = directory_fd('/run/netns')
    except Refusal:
        if not os.path.lexists('/run/netns'):
            return None
        raise
    try:
        try:
            return os.stat(namespace, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            return None
    finally:
        os.close(parent)


# 校验网络释放守卫及其阶段、nonce 和精确网络记录，缺失返回 None。
# Validate release-guard phase, nonce and exact network record; absence returns None.
def network_guard(project):
    raw = read(network_path(project, '.release.bin'), 256, True)
    if raw is None:
        return None
    if len(raw) != 256:
        refuse('NETWORK_GUARD_INVALID')
    fields = NETWORK_GUARD.unpack(raw)
    if fields[0] != b'SKIDN001' or fields[1] != 1 or fields[2] not in (1, 2, 3) or any(fields[12]):
        refuse('NETWORK_GUARD_INVALID')
    registry, identity, project_id, boot, generation, release = [decoded(item) for item in fields[6:12]]
    network = network_record({'version': 1, 'registryId': registry, 'identityId': identity, 'projectId': project_id,
                              'revision': fields[3], 'bootId': boot, 'namespace': 'sk-' + project_id,
                              'networkDevice': str(fields[4]), 'networkInode': str(fields[5]), 'generation': generation})
    if project_id != project:
        refuse('NETWORK_GUARD_INVALID')
    identifier(release, UUID, 'NETWORK_GUARD_INVALID')
    return {'phase': ('pending', 'deleting', 'released')[fields[2] - 1], 'releaseId': release, 'network': network}


# 把网络释放阶段和 nonce 编码为启动器共享固定二进制守卫并原子持久化。
# Atomically encode release phase/nonce in the fixed guard shared with the launcher.
def network_guard_write(project, phase, release_id, network):
    network_record(network)
    if network['projectId'] != project:
        refuse('NETWORK_GUARD_INVALID')
    identifier(release_id, UUID, 'NETWORK_RELEASE_ID')
    atomic(network_path(project, '.release.bin'), NETWORK_GUARD.pack(
        b'SKIDN001', 1, {'pending': 1, 'deleting': 2, 'released': 3}[phase], network['revision'],
        int(network['networkDevice']), int(network['networkInode']), text(network['registryId'], 37),
        text(network['identityId'], 37), text(project, 17), text(network['bootId'], 37),
        text(network['generation'], 37), text(release_id, 37), b'\0' * 14))


# 校验 active/retired 网络代次及项目绑定，返回记录或真实缺失 None。
# Validate active/retired network generations and project binding; return the record or None on actual absence.
def network_generation(project):
    epoch = json_read(network_path(project, '.generation.json'), True)
    if epoch is not None:
        if not isinstance(epoch, dict) or set(epoch) != {'version', 'phase', 'network'} or type(epoch['version']) is not int or epoch['version'] != 1 or epoch['phase'] not in ('active', 'retired'):
            refuse('NETWORK_GENERATION_INVALID')
        network_record(epoch['network'])
        if epoch['network']['projectId'] != project:
            refuse('NETWORK_GENERATION_INVALID')
    return epoch


# 协调删除工具意图、释放守卫及 pin/代次，未完成释放或不一致状态不允许新运行。
# Reconcile delete-tool intent, release guards and pin/generation; incomplete/inconsistent release blocks new execution.
def network_ready(value, boot):
    guard = network_guard(value['projectId'])
    owned_tool = network_tool(value['projectId'])
    if owned_tool is not None:
        network_matches(value, owned_tool['network'])
        if guard is None or guard['phase'] != 'deleting' or guard['releaseId'] != owned_tool['releaseId'] or guard['network'] != owned_tool['network']:
            refuse('NETWORK_TOOL_UNCONFIRMED')
    if guard is not None:
        network_matches(value, guard['network'])
        if guard['phase'] != 'released':
            if guard['network']['bootId'] != boot:
                refuse('NETWORK_STALE')
            refuse('NETWORK_RETIREMENT_PENDING')


# 固定当前绑定的宿主或私有 netns，核实启动/物理身份；readonly 不创建 pin 或代次，失败关闭 FD。
# Pin the bound host/private netns and verify boot/physical identity; readonly creates no pin/generation and failures close FDs.
def network_fd(value, boot, readonly=False):
    network_ready(value, boot)
    namespace = 'sk-' + value['projectId'] if value['networkIsolation'] == 'private' else ''
    try:
        if namespace:
            parent = directory_fd('/run/netns')
            try:
                descriptor = os.open(namespace, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW, dir_fd=parent)
            finally:
                os.close(parent)
        else:
            descriptor = os.open('/proc/1/ns/net', os.O_RDONLY | os.O_CLOEXEC)
    except OSError:
        refuse('NETWORK_ABSENT')
    try:
        info = os.fstat(descriptor)
        # /proc/self/fd of a bind-mounted namespace displays its mount path,
        # not necessarily "net:[inode]". Ask nsfs for the actual namespace type.
        if info.st_uid != 0 or fcntl.ioctl(descriptor, 0xb703) != 0x40000000:
            refuse('NETWORK_IDENTITY')
        if namespace:
            ip = tool('ip')
            links = execute([ip, '-n', namespace, '-o', 'link', 'show']).decode().strip().splitlines()
            if len(links) != 1 or not re.match(r'[0-9]+: lo:', links[0]):
                refuse('NETWORK_INTERFACES')
            if execute([ip, '-n', namespace, '-o', '-4', 'route', 'show']).strip() or execute([ip, '-n', namespace, '-o', '-6', 'route', 'show']).strip():
                refuse('NETWORK_ROUTES')
            now = os.stat('/run/netns/' + namespace, follow_symlinks=False)
            if (now.st_dev, now.st_ino) != (info.st_dev, info.st_ino):
                refuse('NETWORK_REPLACED')
        pinned = {'version': 1, 'registryId': value['registryId'], 'identityId': value['identityId'],
                  'revision': value['revision'], 'bootId': boot, 'namespace': namespace,
                  'networkDevice': str(info.st_dev), 'networkInode': str(info.st_ino)}
        pin_path = network_path(value['projectId'])
        prior = network_pin(value['projectId'])
        if prior is not None and prior != pinned:
            refuse('NETWORK_REPLACED')
        epoch = network_generation(value['projectId']) if namespace else None
        if epoch is not None:
            network_matches(value, epoch['network'])
        if epoch is not None and epoch['phase'] == 'active' and (prior is None or network_plain(epoch['network']) != pinned):
            refuse('NETWORK_REPLACED')
        if prior is None:
            if readonly:
                refuse('NETWORK_ABSENT')
            json_write(pin_path, pinned)
        if namespace and (epoch is None or epoch['phase'] == 'retired'):
            if readonly:
                refuse('NETWORK_GENERATION_INVALID')
            network = dict(pinned, projectId=value['projectId'], generation=str(uuid.uuid4()))
            json_write(network_path(value['projectId'], '.generation.json'), {'version': 1, 'phase': 'active', 'network': network})
        return descriptor, info, namespace
    except BaseException:
        os.close(descriptor)
        raise


# 捕获已准入私有网络的精确记录，区分真实初始缺失和已有 pin 指向的丢失。
# Capture the exact admitted private network, distinguishing initial absence from loss of a previously pinned namespace.
def network_capture(value, boot):
    network_ready(value, boot)
    if value['networkIsolation'] == 'host':
        return None
    info = namespace_stat('sk-' + value['projectId'])
    if info is None:
        pin = network_pin(value['projectId'])
        epoch = network_generation(value['projectId'])
        if pin is not None or (epoch is not None and epoch['phase'] == 'active'):
            refuse('NETWORK_ABSENT')
        if epoch is not None:
            network_matches(value, epoch['network'])
        return None
    descriptor, actual, _namespace = network_fd(value, boot)
    try:
        if (actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino):
            refuse('NETWORK_REPLACED')
        epoch = network_generation(value['projectId'])
        if epoch is None or epoch['phase'] != 'active':
            refuse('NETWORK_GENERATION_INVALID')
        network_matches(value, epoch['network'])
        return epoch['network']
    finally:
        os.close(descriptor)


# 只读核实活动私有网络与迁移守卫，不创建记录也不完成待决事务。
# Read-only validation of active private network/migration guards without creating records or completing transactions.
def network_inspect(value, boot):
    # Capability checks must never create a pin/generation or finish a pending
    # transition. Only already admitted, active private networks are ready.
    if value['networkIsolation'] != 'private':
        refuse('NETWORK_MODE')
    migration_ready(value)
    descriptor, info, _namespace = network_fd(value, boot, readonly=True)
    try:
        epoch = network_generation(value['projectId'])
        if epoch is None or epoch['phase'] != 'active':
            refuse('NETWORK_GENERATION_INVALID')
        network = epoch['network']
        network_matches(value, network)
        if network['bootId'] != boot or (network['networkDevice'], network['networkInode']) != (str(info.st_dev), str(info.st_ino)):
            refuse('NETWORK_REPLACED')
        return {'version': 1, 'identity': value, 'network': network}
    finally:
        os.close(descriptor)


# 先核对调用方 boot 与释放 nonce，再持久发布释放意图，重启后的旧请求不能选择新命名空间。
# Validate requested boot/release nonce before persisting intent so stale post-reboot requests cannot select new namespaces.
def begin_network_release(value, request, boot):
    # The host persists this boot/nonce before asynchronous stop begins. A
    # receipt lost across reboot must never select a newly created namespace.
    requested_boot = identifier(request.get('bootId'), UUID, 'BOOT_ID')
    if requested_boot != boot:
        refuse('BOOT_CHANGED')
    release_id = identifier(request.get('releaseId'), UUID, 'NETWORK_RELEASE_ID')
    guard = network_guard(value['projectId'])
    if guard is not None:
        network_matches(value, guard['network'])
        if guard['releaseId'] == release_id:
            if guard['network']['bootId'] != boot:
                refuse('NETWORK_STALE')
            return {'version': 1, 'phase': 'pending', 'releaseId': release_id, 'network': guard['network']}
        if guard['phase'] != 'released':
            refuse('NETWORK_RETIREMENT_PENDING')
    network = network_capture(value, boot)
    if network is None:
        return None
    network_guard_write(value['projectId'], 'pending', release_id, network)
    return {'version': 1, 'phase': 'pending', 'releaseId': release_id, 'network': network}


# 检查本启动代次的票据和实际 cgroup 无活动后代，closed 标志单独不足以允许释放网络。
# Require same-boot tickets and actual cgroups to have no live descendants; closed alone cannot authorize network release.
def network_idle(value, boot):
    # Closed inherited tickets may still have a populated upper domain. Closed
    # is not proof that detached descendants have stopped.
    for run in runs_for(value):
        if run['bootId'] != boot:
            continue
        descriptor = cgroup_fd(run)
        try:
            if run['phase'] != 'closed' or (descriptor is not None and populated(descriptor)):
                refuse('NETWORK_RUNS_MUST_STOP')
        finally:
            if descriptor is not None:
                os.close(descriptor)


# 固定记录中的 netns 并核实物理身份，只有显式恢复所需的真实缺失返回 None。
# Pin the recorded netns and verify physical identity; only actual absence allowed by recovery returns None.
def network_namespace_fd(network):
    try:
        parent = directory_fd('/run/netns')
    except Refusal as error:
        # Missing parents are allowed only for the caller's explicit recovery
        # checks below; symlinks/permission substitutions are never absence.
        if not os.path.lexists('/run/netns'):
            return None
        raise error
    try:
        try:
            descriptor = os.open(network['namespace'], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            return None
    finally:
        os.close(parent)
    try:
        info = os.fstat(descriptor)
        if info.st_uid != 0 or fcntl.ioctl(descriptor, 0xb703) != 0x40000000 or not same(info, network, 'network'):
            refuse('NETWORK_REPLACED')
        now = os.stat('/run/netns/' + network['namespace'], follow_symlinks=False)
        if (now.st_dev, now.st_ino) != (info.st_dev, info.st_ino):
            refuse('NETWORK_REPLACED')
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


# 相对可信父目录删除精确记录并同步该目录，缺失幂等返回。
# Unlink the exact record relative to a trusted parent and fsync that directory; absence is idempotent.
def durable_unlink(path):
    parent = directory_fd(os.path.dirname(path))
    try:
        try:
            os.unlink(os.path.basename(path), dir_fd=parent)
        except FileNotFoundError:
            return
        # O_PATH cannot fsync. Reopen only the same verified parent.
        descriptor = os.open('.', os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        os.close(parent)


# 拒绝重复 JSON 键并校验删除工具的 nonce、构建、cgroup 与网络身份，缺失返回 None。
# Reject duplicate JSON keys and validate delete-tool nonce/build/cgroup/network identity; absence returns None.
def network_tool(project):
    raw = read(network_path(project, '.tool.json'), 4096, True)
    if raw is None:
        return None
    # 重建 JSON 对象并拒绝重复键，避免两个释放身份被解析器静默覆盖。
    # Rebuild JSON objects while rejecting duplicate keys that could overwrite release identity.
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                refuse('NETWORK_TOOL_INVALID')
            result[key] = item
        return result
    try:
        record = json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError):
        refuse('NETWORK_TOOL_INVALID')
    keys = {'version', 'phase', 'releaseId', 'network', 'build', 'cgroupName', 'cgroupDevice', 'cgroupInode'}
    if not isinstance(record, dict) or set(record) != keys or type(record['version']) is not int or record['version'] != 1 or record['phase'] not in ('creating', 'running'):
        refuse('NETWORK_TOOL_INVALID')
    network_record(record['network'])
    if record['network']['projectId'] != project:
        refuse('NETWORK_TOOL_INVALID')
    identifier(record['releaseId'], UUID, 'NETWORK_TOOL_INVALID')
    if record['cgroupName'] != 'sakura-network-release-' + record['releaseId'] or not isinstance(record['build'], str) or not re.fullmatch('[a-f0-9]{64}', record['build']):
        refuse('NETWORK_TOOL_INVALID')
    for key in ('cgroupDevice', 'cgroupInode'):
        if not isinstance(record[key], str) or not re.fullmatch('0|[1-9][0-9]*', record[key]) or int(record[key]) > 18446744073709551615:
            refuse('NETWORK_TOOL_INVALID')
    if (record['phase'] == 'creating' and (record['cgroupDevice'], record['cgroupInode']) != ('0', '0')) or \
       (record['phase'] == 'running' and record['cgroupInode'] == '0'):
        refuse('NETWORK_TOOL_INVALID')
    return record


# 在有界等待内核实自有删除工具已退出，仅清理精确 cgroup；不得提前退休网络或接管替代对象。
# Wait boundedly for the owned delete tool to exit and retire only its exact cgroup, never adopting replacements.
def network_tool_clear(project, owned_tool):
    """Do not retire a namespace while an interrupted delete can still run.

    The inherited lock normally serializes recovery through exec/exit. A
    separately pinned cgroup remains authoritative even if a root utility
    closes inherited descriptors. No new namespace is selected during this
    bounded wait, and an unknown replacement is never adopted.
    """
    cgroup_available(False)
    parent = directory_fd(CGROUP)
    descriptor = None
    try:
        try:
            descriptor = os.open(owned_tool['cgroupName'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            # An interrupted cleanup may have removed the empty domain before
            # removing its receipt. A nonexistent cgroup cannot contain a tool.
            durable_unlink(network_path(project, '.tool.json'))
            return
        info = os.fstat(descriptor)
        trusted(info, True)
        if owned_tool['phase'] == 'running' and not same(info, owned_tool, 'cgroup'):
            refuse('NETWORK_TOOL_REPLACED')
        if owned_tool['phase'] == 'creating' and populated(descriptor):
            # A creating receipt cannot have launched any process yet.
            refuse('NETWORK_TOOL_REPLACED')
        deadline = time.monotonic() + 15
        while populated(descriptor):
            if time.monotonic() >= deadline:
                refuse('NETWORK_TOOL_RUNNING')
            time.sleep(.02)
        deadline = time.monotonic() + 5
        while True:
            now = os.stat(owned_tool['cgroupName'], dir_fd=parent, follow_symlinks=False)
            if (now.st_dev, now.st_ino) != (info.st_dev, info.st_ino):
                refuse('NETWORK_TOOL_REPLACED')
            try:
                os.rmdir(owned_tool['cgroupName'], dir_fd=parent)
                break
            except OSError as error:
                if error.errno not in (errno.EBUSY, errno.ENOTEMPTY) or time.monotonic() >= deadline:
                    refuse('NETWORK_TOOL_CLEANUP_FAILED')
                time.sleep(.02)
        durable_unlink(network_path(project, '.tool.json'))
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent)


# 删除工具继承已持有的注册排他锁，并进入独立登记 cgroup，避免撤销途中出现新授权启动。
# 持有实际注册 EX 锁并发布工具意图，将固定删除工具置于自有 cgroup；完成前守卫阻止新命名空间复用。
# Hold the real registry EX lock, persist tool intent and place the pinned deletion tool in an owned cgroup until completion.
def network_delete(project, network, release_id, control_lock):
    # This is the controller's already-held EX descriptor, never a caller path.
    info = os.fstat(control_lock)
    trusted(info, mode=0o600)
    actual = os.stat(BASE + '/lock', follow_symlinks=False)
    if (actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino):
        refuse('REGISTRY_LOCK_REPLACED')
    fcntl.flock(control_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    cgroup_available(True)
    record = {'version': 1, 'phase': 'creating', 'releaseId': release_id, 'network': network,
              'build': sources(), 'cgroupName': 'sakura-network-release-' + release_id,
              'cgroupDevice': '0', 'cgroupInode': '0'}
    if network_tool(project) is not None:
        refuse('NETWORK_TOOL_UNCONFIRMED')
    parent = directory_fd(CGROUP)
    descriptor = None
    try:
        # The intent precedes mkdir. Before the running receipt is committed,
        # no child can enter this name; a crash leaves only a known empty domain.
        try:
            os.stat(record['cgroupName'], dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            refuse('NETWORK_TOOL_REPLACED')
        json_write(network_path(project, '.tool.json'), record)
        os.mkdir(record['cgroupName'], 0o755, dir_fd=parent)
        descriptor = os.open(record['cgroupName'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        info = os.fstat(descriptor)
        trusted(info, True)
        if populated(descriptor):
            refuse('NETWORK_TOOL_REPLACED')
        record.update(phase='running', cgroupDevice=str(info.st_dev), cgroupInode=str(info.st_ino))
        json_write(network_path(project, '.tool.json'), record)
        # 把删除工具子进程写入已固定 cgroup，并关闭进入阶段的描述符。
        # Move the delete-tool child into the pinned cgroup and close entry-phase descriptors.
        def enter():
            target = os.open('cgroup.procs', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
            try:
                os.write(target, str(os.getpid()).encode())
            finally:
                os.close(target)
                os.close(descriptor)
        execute([tool('ip'), 'netns', 'delete', network['namespace']],
                pass_fds=(control_lock, descriptor), preexec_fn=enter)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent)
    network_tool_clear(project, record)


# 核对 nonce/网络/守卫和所有运行已停后删除原命名空间，以持久阶段支持中断恢复，替代对象不删除。
# Validate nonce/network/guard and stopped runs, then delete only the original namespace with durable recovery phases.
def release_network(value, request, boot, control_lock):
    network = network_record(request.get('network'))
    network_matches(value, network)
    release_id = identifier(request.get('releaseId'), UUID, 'NETWORK_RELEASE_ID')
    project = value['projectId']
    guard = network_guard(project)
    owned_tool = network_tool(project)
    if guard is not None:
        network_matches(value, guard['network'])
        if guard['releaseId'] != release_id or guard['network'] != network:
            refuse('NETWORK_RELEASE_STALE')
        if guard['phase'] == 'released':
            # This exact acknowledgement remains valid even after a fresh
            # namespace/generation exists. Do not inspect or delete the latter.
            if owned_tool is not None:
                refuse('NETWORK_TOOL_UNCONFIRMED')
            return {'version': 1, 'phase': 'released', 'releaseId': release_id, 'network': network}
    network_idle(value, boot)
    if owned_tool is not None:
        if owned_tool['releaseId'] != release_id or owned_tool['network'] != network or network['bootId'] != boot or guard is None or guard['phase'] != 'deleting':
            refuse('NETWORK_TOOL_UNCONFIRMED')
        network_tool_clear(project, owned_tool)
    pin = network_pin(project)
    epoch = network_generation(project)
    if network['bootId'] != boot:
        # /run authority and namespaces disappear on reboot. Complete only
        # the fixed old lease, without ip deletion or adoption of current state.
        if guard is not None or pin is not None or epoch is not None or namespace_stat(network['namespace']) is not None:
            refuse('NETWORK_RELEASE_STALE')
        network_guard_write(project, 'released', release_id, network)
        return {'version': 1, 'phase': 'released', 'releaseId': release_id, 'network': network}
    if guard is None:
        refuse('NETWORK_RELEASE_REQUIRED')
    if pin is not None and pin != network_plain(network):
        refuse('NETWORK_REPLACED')
    if epoch is None or epoch['network'] != network or (epoch['phase'] == 'retired' and guard['phase'] != 'deleting'):
        refuse('NETWORK_REPLACED')
    if pin is None and guard['phase'] != 'deleting':
        refuse('NETWORK_ABSENT')
    descriptor = network_namespace_fd(network)
    try:
        if descriptor is None and guard['phase'] != 'deleting':
            refuse('NETWORK_ABSENT')
        if descriptor is not None:
            ip = tool('ip')
            if execute([ip, 'netns', 'pids', network['namespace']]).strip():
                refuse('NETWORK_PROCESSES_REMAIN')
            # Persist permission to resume an interrupted delete before invoking
            # the fixed root tool. All new launchers remain blocked throughout.
            network_guard_write(project, 'deleting', release_id, network)
            now = os.stat('/run/netns/' + network['namespace'], follow_symlinks=False)
            if not same(now, network, 'network'):
                refuse('NETWORK_REPLACED')
            network_delete(project, network, release_id, control_lock)
            if namespace_stat(network['namespace']) is not None:
                refuse('NETWORK_REPLACED')
        if pin is not None:
            durable_unlink(network_path(project))
        json_write(network_path(project, '.generation.json'), {'version': 1, 'phase': 'retired', 'network': network})
        network_guard_write(project, 'released', release_id, network)
        return {'version': 1, 'phase': 'released', 'releaseId': release_id, 'network': network}
    finally:
        if descriptor is not None:
            os.close(descriptor)


# 逐级无跟随打开 cgroup 名称并校验可信目录，支持 system.slice 父路径而不允许点段逃逸。
# Walk cgroup names without links, validating each directory and allowing system.slice without dot-segment escape.
def cgroup_name_fd(name):
    # Service cgroups can have a system.slice parent. Verify every component,
    # rather than passing a slash-containing name to one final nofollow open.
    if not isinstance(name, str) or any(not part or part in ('.', '..') for part in name.split('/')):
        refuse('CGROUP_IDENTITY')
    parent = directory_fd(CGROUP)
    try:
        for part in name.split('/'):
            descriptor = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
            try:
                trusted(os.fstat(descriptor), True)
            except BaseException:
                os.close(descriptor)
                raise
            os.close(parent)
            parent = descriptor
        descriptor = parent
        parent = None
        return descriptor
    finally:
        if parent is not None:
            os.close(parent)


# 打开记录的精确 cgroup 并核对设备/inode；真实缺失返回 None，替代目录拒绝。
# Open the recorded cgroup and verify device/inode; absence returns None and replacement refuses.
def cgroup_fd(value):
    cgroup_available(False)
    try:
        descriptor = cgroup_name_fd(value['cgroupName'])
    except FileNotFoundError:
        return None
    info = os.fstat(descriptor)
    if not same(info, value, 'cgroup'):
        os.close(descriptor)
        refuse('CGROUP_REPLACED')
    return descriptor


# 确认 cgroup v2 挂载与可信根，显式 start 时可启动标准 OpenRC cgroups 服务。
# Verify cgroup v2 and its trusted root, optionally starting the stock OpenRC cgroups service when requested.
def cgroup_available(start=False):
    # 解析 mountinfo 确认固定挂载点实际是 cgroup2，不以目录存在替代挂载证明。
    # Confirm the fixed mountpoint is cgroup2 from mountinfo rather than directory existence.
    def mounted():
        for line in open('/proc/self/mountinfo'):
            fields = line.split()
            if len(fields) > 9 and fields[4] == CGROUP and '-' in fields and fields[fields.index('-') + 1] == 'cgroup2':
                return True
        return False
    if not mounted() and start and os.path.isfile('/sbin/rc-service'):
        execute(['/sbin/rc-service', 'cgroups', 'start'], timeout=30)
    if not mounted():
        refuse('CGROUP_UNAVAILABLE')
    descriptor = directory_fd(CGROUP)
    os.close(descriptor)


# 从固定 cgroup.events 读取合法 populated 位，畸形内容拒绝。
# Read a valid populated bit from pinned cgroup.events and refuse malformed content.
def populated(descriptor):
    fd = os.open('cgroup.events', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
    with os.fdopen(fd, 'rb') as stream:
        content = stream.read(4096)
    if not re.search(rb'^populated [01]$', content, re.M):
        refuse('CGROUP_EVENTS')
    return b'populated 1\n' in content


# 有界列举可信热票据目录，只接受合法 UUID.bin 和可信文件，未知条目或容量超限拒绝。
# Boundedly enumerate trusted hot tickets, accepting only valid UUID.bin files and refusing unknown/excess entries.
def run_entries():
    parent = directory_fd(RUNTIME + '/runs')
    try:
        descriptor = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
    finally:
        os.close(parent)
    try:
        entries = []
        with os.scandir(descriptor) as iterator:
            for entry in iterator:
                if len(entries) >= RUN_LIMIT:
                    refuse('RUN_LIMIT')
                if not entry.name.endswith('.bin') or not UUID.fullmatch(entry.name[:-4]):
                    refuse('RUN_UNKNOWN_FILE')
                entries.append(entry.name)
        return sorted(entries)
    finally:
        os.close(descriptor)


# 按注册表与身份 UUID 筛选票据，隔离其他身份，即使项目名称相同也不接管。
# Select tickets by registry/identity UUID, excluding other identities even if project names coincide.
def runs_for(value, records=None):
    result = []
    for run in records if records is not None else [run_read(entry[:-4]) for entry in run_entries()]:
        if run['registryId'] == value['registryId'] and run['identityId'] == value['identityId']:
            result.append(run)
    return result


# 闭合票据是不可覆盖的墓碑；必须原子 no-replace，不能用先检查后 rename 的竞态替代。
# 使用原子不覆盖 renameat2 发布已同步墓碑，未知 ABI 或缺少原语拒绝并保留原票据。
# Publish fsynced tombstones with atomic no-replace renameat2; unsupported ABI/primitive refuses and retains the original ticket.
def run_archive_publish(parent, temporary, destination):
    # Publish a complete, fsynced file without replacing an existing tombstone.
    # Linux guests already require pidfd/cgroup v2. An unavailable atomic
    # no-replace primitive refuses archival and retains the original ticket.
    libc = ctypes.CDLL(None, use_errno=True)
    try:
        rename = libc.renameat2
    except AttributeError:
        # Older musl has the kernel primitive without a libc wrapper. Use the
        # same atomic operation only on known native 64-bit Linux ABIs.
        number = {'x86_64': 316, 'aarch64': 276}.get(os.uname().machine)
        if number is None or ctypes.sizeof(ctypes.c_void_p) != 8 or ctypes.sizeof(ctypes.c_long) != 8:
            refuse('RUN_ARCHIVE_ATOMIC_UNAVAILABLE')
        try:
            syscall = libc.syscall
        except AttributeError:
            refuse('RUN_ARCHIVE_ATOMIC_UNAVAILABLE')
        syscall.argtypes = (ctypes.c_long,)
        syscall.restype = ctypes.c_long
        result = syscall(ctypes.c_long(number), ctypes.c_int(parent), ctypes.c_char_p(temporary.encode()),
                         ctypes.c_int(parent), ctypes.c_char_p(destination.encode()), ctypes.c_uint(1))
    else:
        rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
        rename.restype = ctypes.c_int
        result = rename(parent, temporary.encode(), parent, destination.encode(), 1)
    if result:
        error = ctypes.get_errno()
        if error == errno.EEXIST:
            refuse('RUN_ARCHIVE_CONFLICT')
        if error in (errno.ENOSYS, errno.EINVAL, errno.EOPNOTSUPP):
            refuse('RUN_ARCHIVE_ATOMIC_UNAVAILABLE')
        refuse('RUN_ARCHIVE_PUBLISH_FAILED')


# 只归档当前启动的 closed 且已停止票据；先发布不可覆盖墓碑，再核对并删除原文件，失败保留恢复证据。
# Archive only same-boot closed/stopped tickets; publish an immutable tombstone before verified original removal.
def run_archive(value, boot):
    if value['phase'] != 'closed' or value['bootId'] != boot:
        refuse('RUN_ARCHIVE_STALE')
    run = value['runId']
    data = run_bytes(value)
    source_parent = directory_fd(RUNTIME + '/runs')
    source = destination = None
    temporary = temporary_info = None
    published = False
    try:
        source = os.open(run + '.bin', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=source_parent)
        info = os.fstat(source)
        trusted(info, mode=0o600)
        if info.st_size != RUN.size or os.read(source, RUN.size + 1) != data:
            refuse('RUN_ARCHIVE_CONFLICT')
        descriptor = cgroup_fd(value)
        try:
            if descriptor is not None and populated(descriptor):
                return False
        finally:
            if descriptor is not None:
                os.close(descriptor)
        destination = run_archive_fd(run, True)
        archived = run_archive_read(run)
        if archived is not None and archived != data:
            refuse('RUN_ARCHIVE_CONFLICT')
        if archived is None:
            with os.scandir(destination) as iterator:
                for index, _entry in enumerate(iterator, 1):
                    if index >= RUN_ARCHIVE_BUCKET_LIMIT:
                        refuse('RUN_ARCHIVE_LIMIT')
            temporary = '.record-' + str(uuid.uuid4())
            output = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                             0o600, dir_fd=destination)
            try:
                temporary_info = os.fstat(output)
                trusted(temporary_info, mode=0o600)
                view = memoryview(data)
                while view:
                    written = os.write(output, view)
                    if written <= 0:
                        refuse('RUN_ARCHIVE_WRITE_FAILED')
                    view = view[written:]
                os.fsync(output)
                run_archive_publish(destination, temporary, run + '.bin')
                published = True
            finally:
                os.close(output)
        os.fsync(destination)
        if run_archive_read(run) != data:
            refuse('RUN_ARCHIVE_CONFLICT')
        # A retained descriptor alone does not authorize removal through a new
        # parent or a replaced leaf. The registry EX lock excludes launchers.
        current_parent = directory_fd(RUNTIME + '/runs')
        try:
            old_parent = os.fstat(source_parent)
            new_parent = os.fstat(current_parent)
            if (old_parent.st_dev, old_parent.st_ino) != (new_parent.st_dev, new_parent.st_ino):
                refuse('RUN_ARCHIVE_SOURCE_CHANGED')
        finally:
            os.close(current_parent)
        current = os.stat(run + '.bin', dir_fd=source_parent, follow_symlinks=False)
        trusted(current, mode=0o600)
        fields = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        if any(getattr(current, field) != getattr(info, field) for field in fields):
            refuse('RUN_ARCHIVE_SOURCE_CHANGED')
        os.lseek(source, 0, os.SEEK_SET)
        if os.read(source, RUN.size + 1) != data:
            refuse('RUN_ARCHIVE_SOURCE_CHANGED')
        descriptor = cgroup_fd(value)
        try:
            if descriptor is not None and populated(descriptor):
                refuse('RUN_ARCHIVE_SCOPE_BUSY')
        finally:
            if descriptor is not None:
                os.close(descriptor)
        os.unlink(run + '.bin', dir_fd=source_parent)
        sync = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=source_parent)
        try:
            os.fsync(sync)
        finally:
            os.close(sync)
        return True
    finally:
        try:
            if temporary is not None and not published and destination is not None and temporary_info is not None:
                try:
                    current = os.stat(temporary, dir_fd=destination, follow_symlinks=False)
                    if (current.st_dev, current.st_ino) == (temporary_info.st_dev, temporary_info.st_ino):
                        os.unlink(temporary, dir_fd=destination)
                        os.fsync(destination)
                except FileNotFoundError:
                    pass
        finally:
            for descriptor in (source, destination, source_parent):
                if descriptor is not None:
                    os.close(descriptor)


# 筛选并归档本启动的闭合票据，旧 boot、替代 cgroup 或仍有后代的记录拒绝。
# Archive eligible same-boot closed tickets, refusing old boots, replaced groups or remaining descendants.
def compact_runs(boot, records=None):
    # Never retire active tickets, old boots, changed groups or a closed ticket
    # whose upper task/service domain still has live descendants.
    candidates = []
    for value in records if records is not None else [run_read(entry[:-4]) for entry in run_entries()]:
        if value['phase'] == 'closed':
            if value['bootId'] != boot:
                refuse('RUN_ARCHIVE_STALE')
            candidates.append(value)
    retired = 0
    for value in candidates:
        if run_archive(value, boot):
            retired += 1
            if retired == RUN_ARCHIVE_BATCH:
                break
    return retired


# 核对票据属于当前绑定与 boot，可选要求 active，陈旧与 closed 分别拒绝。
# Require ticket/binding/boot agreement and optionally active phase, refusing stale or closed runs distinctly.
def check_run(value, run, boot, require_active=True):
    if any(run[key] != value[key] for key in ('registryId', 'projectId', 'identityId', 'revision')) or run['bootId'] != boot:
        refuse('RUN_STALE')
    if require_active and run['phase'] != 'active':
        refuse('RUN_CLOSED')


# 解析当前进程精确 cgroup，仅允许已注册任务/主进程/服务域或已证明的项目 SSH 域。
# Parse exact current membership, allowing registered task/main/service domains or proven project SSH groups.
def current_cgroup(inherited_name=None):
    with open('/proc/self/cgroup', 'r') as stream:
        membership = stream.read(4097)
    if inherited_name is not None:
        if not re.fullmatch(r'(openrc\.sakura-ssh-(default|[a-f0-9]{16})|system\.slice/sakura-ssh-(default|[a-f0-9]{16})\.service)', inherited_name) or \
           membership != '0::/' + inherited_name + '\n':
            refuse('CGROUP_MEMBERSHIP')
        return inherited_name
    if not re.fullmatch('0::/(sakura-(task|main|service)-' + UUID.pattern + r')\n', membership):
        refuse('INHERITED_CGROUP_UNREGISTERED')
    return membership[4:].strip()


# 在身份 EX 锁下读取并校验目录迁移 latch，重复键、替代目录或半完成状态不能绕开运行门禁。
# Read/validate directory-migration latches under identity EX; duplicate keys/replacements/partial state cannot bypass execution gates.
def migration_latch(value):
    """Read the migration latch while holding the shared identity EX lock.

    A failed/partial permission migration cannot create or retry a run. Repair
    and inspection remain possible, and the latch is released only after the
    migration helper records the complete current binding under this lock.
    """
    parent = directory_fd(os.path.dirname(MIGRATIONS))
    descriptors = [parent]
    try:
        for part in (os.path.basename(MIGRATIONS), value['projectId']):
            try:
                descriptor = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                                     dir_fd=descriptors[-1])
            except FileNotFoundError:
                return
            descriptors.append(descriptor)
            trusted(os.fstat(descriptor), True, 0o700)
        try:
            descriptor = os.open('latch.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                                 dir_fd=descriptors[-1])
        except FileNotFoundError:
            return
        with os.fdopen(descriptor, 'rb') as stream:
            info = os.fstat(stream.fileno())
            trusted(info, mode=0o600)
            if info.st_size > 262144:
                refuse('DIRECTORY_MIGRATION_INVALID')
            raw = stream.read(262145)
            if len(raw) > 262144:
                refuse('DIRECTORY_MIGRATION_INVALID')
    except OSError:
        refuse('DIRECTORY_MIGRATION_INVALID')
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)

    # 解析迁移 JSON 时拒绝重复键，保留唯一身份与阶段语义。
    # Reject duplicate migration JSON keys to preserve unique identity/phase semantics.
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                refuse('DIRECTORY_MIGRATION_INVALID')
            result[key] = item
        return result
    try:
        latch = json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError):
        refuse('DIRECTORY_MIGRATION_INVALID')
    keys = {'version', 'projectId', 'planId', 'sha256', 'phase', 'identity'}
    if not isinstance(latch, dict) or set(latch) != keys or type(latch['version']) is not int or latch['version'] != 1:
        refuse('DIRECTORY_MIGRATION_INVALID')
    if latch['projectId'] != value['projectId'] or not isinstance(latch['planId'], str) or not UUID.fullmatch(latch['planId']) or \
       not isinstance(latch['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', latch['sha256']) or \
       latch['phase'] not in ('applying', 'failed', 'directory-applied', 'applied'):
        refuse('DIRECTORY_MIGRATION_INVALID')
    prior = latch['identity']
    if not isinstance(prior, dict) or set(prior) != set(value):
        refuse('DIRECTORY_MIGRATION_IDENTITY')
    if type(prior['version']) is not int or prior['version'] != 1 or prior['phase'] not in ('intent', 'active') or \
       type(prior['revision']) is not int or not 1 <= prior['revision'] <= 9007199254740991 or \
       type(prior['uid']) is not int or not 20000 <= prior['uid'] <= 59999 or \
       type(prior['gid']) is not int or prior['gid'] != prior['uid']:
        refuse('DIRECTORY_MIGRATION_IDENTITY')
    for key in ('registryId', 'identityId'):
        if not isinstance(prior[key], str) or not UUID.fullmatch(prior[key]):
            refuse('DIRECTORY_MIGRATION_IDENTITY')
    for key in ('directoryDevice', 'directoryInode', 'homeDevice', 'homeInode'):
        if not isinstance(prior[key], str) or not re.fullmatch('0|[1-9][0-9]*', prior[key]):
            refuse('DIRECTORY_MIGRATION_IDENTITY')
    path = prior['directory']
    if not isinstance(path, str) or not path.startswith('/') or len(path.encode()) > 1023 or \
       re.search('[\x00-\x1f\x7f]', path) or (path != '/' and any(not p or p in ('.', '..') for p in path.split('/')[1:])) or \
       prior['directoryInode'] == '0' or (prior['phase'] == 'active' and prior['homeInode'] == '0') or \
       prior['networkIsolation'] not in ('host', 'private'):
        refuse('DIRECTORY_MIGRATION_IDENTITY')
    # Repair may advance the phase/revision or directory fingerprint while the
    # latch remains blocking. Its reserved account and private home cannot move.
    fixed = ('registryId', 'projectId', 'identityId', 'account', 'uid', 'gid', 'home', 'homeDevice', 'homeInode')
    if any(prior[key] != value[key] for key in fixed):
        refuse('DIRECTORY_MIGRATION_IDENTITY')
    return latch


# 要求存在的迁移 latch 已 applied 且记录当前完整绑定，否则拒绝新运行。
# Require any migration latch to be applied and match the full current binding before new execution.
def migration_ready(value):
    latch = migration_latch(value)
    if latch is None:
        return
    if latch['phase'] != 'applied':
        refuse('DIRECTORY_MIGRATION_PENDING')
    if latch['identity'] != value:
        refuse('DIRECTORY_MIGRATION_IDENTITY')


# 仅在精确已确认旧绑定下持久移除 applied latch，未完成迁移继续保持门禁。
# Durably retire only the applied latch for the exact confirmed old binding; incomplete migrations keep their gate.
def migration_retire_applied(value):
    latch = migration_latch(value)
    if latch is None or latch['phase'] != 'applied':
        return
    if latch['identity'] != value:
        refuse('DIRECTORY_MIGRATION_IDENTITY')
    # Rebind has already validated the new directory as this exact account.
    # Retire only the confirmed old gate before the new binding is committed;
    # unfinished migrations retain their gate through repair and confirmation.
    durable_unlink(MIGRATIONS + '/' + value['projectId'] + '/latch.json')


# 票据绑定 boot、构建、修订、网络和 cgroup；旧构建仍有活动运行时，先拒绝新票据而非复用旧权限。
# 在迁移、网络与构建检查后固定运行 cgroup 并发布票据；SSH 扩展只接受内部已证明守护进程域，外部不能任意继承。
# After migration/network/build checks, pin the run cgroup and publish a ticket; SSH inheritance requires an internally proven daemon domain.
def prepare(value, request, boot, build, inherit=False, inherited_name=None, inherited_info=None, before_publish=None):
    # Only ssh-prepare supplies this internal extension after proving the root
    # daemon. exec-current still requires its own exact UUID owner domain.
    if inherited_name is not None and (not inherit or inherited_name not in
            ('openrc.sakura-ssh-' + value['projectId'], 'system.slice/sakura-ssh-' + value['projectId'] + '.service') or inherited_info is None):
        refuse('INHERITED_CGROUP_UNREGISTERED')
    migration_ready(value)
    network_ready(value, boot)
    # One bounded, validated snapshot under the same registry EX lock. Every
    # retired original is still opened and checked again by run_archive.
    records = [run_read(entry[:-4]) for entry in run_entries()]
    history = runs_for(value, records)
    # Historical privileged binaries can still consume their own active
    # tickets. An upgrade must close those exact runs before issuing a ticket
    # for the protected transport; stop remains reachable through this build.
    for run in history:
        if run['bootId'] != boot or run['build'] == build:
            continue
        if run['phase'] == 'active':
            refuse('UPGRADE_RUNS_MUST_STOP')
        descriptor = cgroup_fd(run)
        try:
            # stop publishes closed before kill/confirmation; an inherited
            # ticket also closes while its upper domain can remain populated.
            if descriptor is not None and populated(descriptor):
                refuse('UPGRADE_RUNS_MUST_STOP')
        finally:
            if descriptor is not None:
                os.close(descriptor)
    cgroup_available(True)
    requested = request.get('runId')
    if requested is not None:
        identifier(requested, UUID, 'RUN_ID')
        if run_archive_read(requested) is not None:
            refuse('RUN_ARCHIVED')
        existing = read(run_path(requested), 1024, True)
        if existing is not None:
            run = run_read(requested)
            check_run(value, run, boot)
            if run['build'] != build or run['mode'] != ('inherit-current' if inherit else 'independent'):
                refuse('RUN_STALE')
            if inherit and (inherited_name if inherited_name is not None else current_cgroup()) != run['cgroupName']:
                refuse('CGROUP_MEMBERSHIP')
            descriptor = cgroup_fd(run)
            if descriptor is None:
                refuse('CGROUP_ABSENT')
            try:
                if inherited_info is not None and (os.fstat(descriptor).st_dev, os.fstat(descriptor).st_ino) != (inherited_info.st_dev, inherited_info.st_ino):
                    refuse('CGROUP_REPLACED')
            finally:
                os.close(descriptor)
            fd, info, namespace = network_fd(value, boot)
            os.close(fd)
            if not same(info, run, 'network') or namespace != run['namespace']:
                refuse('NETWORK_REPLACED')
            return run
    if len(run_entries()) >= RUN_LIMIT:
        compact_runs(boot, records)
    if sum(item['phase'] == 'active' for item in history) >= 32 or len(run_entries()) >= RUN_LIMIT:
        refuse('RUN_LIMIT')
    run_id = requested or str(uuid.uuid4())
    if requested is None and (read(run_path(run_id), RUN.size, True) is not None or run_archive_read(run_id) is not None):
        refuse('RUN_ID_COLLISION')
    network, network_info, namespace = network_fd(value, boot)
    try:
        name = (inherited_name if inherited_name is not None else current_cgroup()) if inherit else 'sakura-identity-' + run_id
        if not inherit:
            parent = directory_fd(CGROUP)
            try:
                try:
                    os.mkdir(name, 0o755, dir_fd=parent)
                except FileExistsError:
                    # No ticket authorizes adoption of an existing namespace.
                    refuse('CGROUP_ALREADY_EXISTS')
            finally:
                os.close(parent)
        descriptor = cgroup_name_fd(name)
        try:
            info = os.fstat(descriptor)
            trusted(info, True)
            if inherited_info is not None and (info.st_dev, info.st_ino) != (inherited_info.st_dev, inherited_info.st_ino):
                refuse('CGROUP_REPLACED')
            # Independent cancellation must include detached descendants.
            if not inherit:
                kill = os.open('cgroup.kill', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
                os.close(kill)
            run = {'version': 1, 'phase': 'active', 'mode': 'inherit-current' if inherit else 'independent',
                   'registryId': value['registryId'], 'identityId': value['identityId'], 'projectId': value['projectId'],
                   'runId': run_id, 'revision': value['revision'], 'bootId': boot, 'build': build,
                   'networkDevice': str(network_info.st_dev), 'networkInode': str(network_info.st_ino),
                   'cgroupDevice': str(info.st_dev), 'cgroupInode': str(info.st_ino), 'cgroupName': name,
                   'namespace': namespace}
            if before_publish is not None:
                before_publish(run)
            run_write(run)
            return run
        finally:
            os.close(descriptor)
    finally:
        os.close(network)


# 核实原票据：独立模式先写 closed 再杀/等空/删原 cgroup；继承模式只关票据。SSH 先证明原组消失并退役收据；closed 不证明清理完成。
# Validate receipt: standalone writes closed before kill/wait/rmdir; inherited closes only the ticket. SSH proves group absence/retires receipt first; closed does not prove cleanup.
def stop(value, run, boot, partial_ssh=False):
    check_run(value, run, boot, False)
    ssh = run['mode'] == 'inherit-current' and run['cgroupName'] in \
        ('openrc.sakura-ssh-' + value['projectId'], 'system.slice/sakura-ssh-' + value['projectId'] + '.service')
    if partial_ssh and not ssh:
        refuse('SSH_RECEIPT_STALE')
    if ssh:
        # A missing receipt can result from an interrupted ticket publication;
        # cleanup remains reachable, but can never authorize a session.
        ssh_receipt_read(run['runId'], run, missing=True, closed=True)
        descriptor = cgroup_fd(run)
        if descriptor is not None:
            os.close(descriptor)
            # The host owns the complete service domain. A native closed
            # phase must never be published while that original group exists.
            refuse('PROJECT_IDENTITY_CLEANUP_FAILED')
        if partial_ssh:
            # Preserve the full original proof before retiring a receipt that
            # was published before an interrupted native ticket write. This
            # cannot launch: its original group is absent, and the EX lock is
            # held through receipt retirement and the final closed phase.
            ssh_cleanup_materialize(run)
        # Receipt retirement is confirmed first. Failure leaves the active
        # native ticket/host intent blocking recovery; sessions fail closed.
        ssh_receipt_retire(run['runId'])
    run['phase'] = 'closed'
    run_write(run)
    if run['mode'] == 'inherit-current':
        # The upper owner is responsible for its domain. Closing this ticket
        # never kills a neighbouring task/service/main process.
        return run
    descriptor = cgroup_fd(run)
    if descriptor is None:
        return run
    try:
        kill = os.open('cgroup.kill', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
        try:
            os.write(kill, b'1\n')
        finally:
            os.close(kill)
        deadline = time.monotonic() + 5
        while populated(descriptor):
            if time.monotonic() >= deadline:
                refuse('PROJECT_IDENTITY_CLEANUP_FAILED')
            time.sleep(.02)
        while True:
            # Recheck the name before removing it; the pinned FD only authorizes
            # this cgroup, not a later directory placed at the same pathname.
            info = os.stat(CGROUP + '/' + run['cgroupName'], follow_symlinks=False)
            if not same(info, run, 'cgroup'):
                refuse('CGROUP_REPLACED')
            try:
                os.rmdir(CGROUP + '/' + run['cgroupName'])
                break
            except OSError as error:
                if error.errno not in (errno.EBUSY, errno.ENOTEMPTY) or time.monotonic() >= deadline:
                    refuse('PROJECT_IDENTITY_CLEANUP_FAILED')
                time.sleep(.02)
    except OSError:
        refuse('PROJECT_IDENTITY_CLEANUP_FAILED')
    finally:
        os.close(descriptor)
    return run


# 要求预期身份且所有当前运行已停，验证新目录访问后递增绑定；活动后代或迁移/网络冲突拒绝。
# Require expected identity and stopped runs, verify new-directory access and advance binding; live descendants/conflicts refuse.
def rebind(value, request, boot):
    if request.get('expected') is None:
        refuse('EXPECTED_IDENTITY_REQUIRED')
    network_ready(value, boot)
    for run in runs_for(value):
        if run['bootId'] != boot:
            continue
        descriptor = cgroup_fd(run)
        try:
            if run['phase'] == 'active' or (descriptor is not None and populated(descriptor)):
                refuse('RUNS_MUST_STOP')
        finally:
            if descriptor is not None:
                os.close(descriptor)
    directory = request['directory']
    info = project_directory(directory)
    network = request['networkIsolation']
    if network not in ('host', 'private'):
        refuse('NETWORK_MODE')
    candidate = dict(value, directory=directory, directoryDevice=str(info.st_dev), directoryInode=str(info.st_ino),
                     networkIsolation=network, revision=value['revision'] + 1)
    probe(candidate)
    egress_prepare(candidate, transition=True)
    if candidate['networkIsolation'] == 'private':
        egress_nnp_check(candidate)
    migration_retire_applied(value)
    binding_write(candidate)
    egress_commit(candidate)
    for suffix in ('.json', '.generation.json', '.release.bin', '.tool.json'):
        durable_unlink(network_path(value['projectId'], suffix))
    return candidate


# 核实控制器位于固定摘要构建目录，校验清单及全部源/启动器摘要，拒绝源码替换。
# Validate the controller’s digest build directory, manifest and all source/launcher hashes, refusing replacement.
def sources():
    folder = os.path.dirname(os.path.realpath(__file__))
    build = os.path.basename(folder)
    if folder != BUILDS + '/' + build or not re.fullmatch('[a-f0-9]{64}', build):
        refuse('CONTROLLER_IMAGE')
    descriptor = directory_fd(folder)
    os.close(descriptor)
    manifest = json_read(folder + '/manifest.json')
    if not isinstance(manifest, dict) or set(manifest) != {'version', 'build', 'files'} or manifest['version'] != 1 or manifest['build'] != build or not isinstance(manifest['files'], list) or len(manifest['files']) != 3:
        refuse('SOURCE_MANIFEST')
    aggregate = hashlib.sha256()
    for name, entry in zip(NAMES, manifest['files']):
        if not isinstance(entry, dict) or set(entry) != {'name', 'size', 'sha256'} or entry['name'] != name:
            refuse('SOURCE_MANIFEST')
        data = read(folder + '/' + name)
        if entry['size'] != len(data) or entry['sha256'] != hashlib.sha256(data).hexdigest():
            refuse('SOURCE_DIGEST')
        aggregate.update(name.encode())
        aggregate.update(data)
    if aggregate.hexdigest() != build:
        refuse('SOURCE_DIGEST')
    executable = os.lstat(folder + '/launch')
    trusted(executable)
    if stat.S_IMODE(executable.st_mode) != 0o4755:
        refuse('LAUNCHER_PERMISSIONS')
    return build


# 创建并核实固定持久/运行目录，取得有界 EX 注册锁，避免并发账号与票据发布。
# Create/verify fixed persistent/runtime directories and acquire a bounded EX registry lock for serialized publication.
def initialize():
    for path, mode in (('/var/lib/sakura', 0o711), (BASE, 0o700), (BASE + '/projects', 0o700),
                       (BASE + '/uids', 0o700), (EGRESS, 0o700), (HOMES, 0o711), (RUNTIME, 0o700),
                       (RUNTIME + '/runs', 0o700), (RUNTIME + '/archives', 0o700),
                       (RUNTIME + '/networks', 0o700), (RUNTIME + '/terminals', 0o700),
                       (RUNTIME + '/terminal-locks', 0o700), (RUNTIME + '/ssh', 0o700),
                       (TERMINALS, 0o711)):
        if path == '/var/lib/sakura' and os.path.exists(path):
            fd = directory_fd(path)
            os.close(fd)
        else:
            make_directory(path, mode)
    lock = os.open(BASE + '/lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    trusted(os.fstat(lock), mode=0o600)
    deadline = time.monotonic() + 10
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return lock
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(lock)
                refuse('REGISTRY_BUSY')
            time.sleep(.01)


# 不创建状态地固定已有锁并取得有界 SH 锁，失败关闭 FD。
# Pin an existing lock without creating state and acquire bounded SH access, closing the FD on failure.
def initialize_readonly():
    descriptor = directory_fd(BASE)
    try:
        trusted(os.fstat(descriptor), True, 0o700)
        lock = os.open('lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
    finally:
        os.close(descriptor)
    try:
        trusted(os.fstat(lock), mode=0o600)
        deadline = time.monotonic() + 10
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
                return lock
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    refuse('REGISTRY_BUSY')
                time.sleep(.01)
    except BaseException:
        os.close(lock)
        raise


# 只把固定身份与负载摘要放入启动器参数；命令/环境保留在认证输入通道，root 不解析或记录。
# Place only fixed identity/payload digest in launcher argv; commands/environment stay on the authenticated input channel.
def launch_argv(value, run, request, build):
    digest = request.get('payloadSha256')
    if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest):
        refuse('PAYLOAD_DIGEST')
    # The body stays on the authenticated channel. The root controller never
    # parses, interprets or records any project command/environment.
    return [BUILDS + '/' + build + '/launch', '--project', value['projectId'], value['identityId'],
            str(value['revision']), run['runId'], '--payload', digest]


# 严格 UTF-8 解码 JSON 并拒绝所有重复键，避免快照身份被覆盖。
# Decode strict UTF-8 JSON and reject all duplicate keys to protect snapshot identity.
def ssh_json(raw):
    # 重建唯一键对象，重复 SSH 记录字段立即拒绝。
    # Rebuild unique-key objects, refusing duplicate SSH record fields immediately.
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                refuse('SSH_RECORD_INVALID')
            result[key] = item
        return result
    try:
        return json.loads(raw.decode('utf-8', 'strict'), object_pairs_hook=pairs)
    except (ValueError, UnicodeError):
        refuse('SSH_RECORD_INVALID')


# 验证快照摘要为小写 64 位十六进制字符串并返回。
# Validate/return a lowercase 64-character hexadecimal snapshot digest.
def ssh_digest(value):
    return identifier(value, re.compile('[a-f0-9]{64}'), 'SSH_SNAPSHOT_DIGEST')


# 校验预期注册表/身份 UUID 与安全整数修订，只接受固定字段集合。
# Validate expected registry/identity UUIDs and safe revision using the exact field set.
def ssh_identity(value):
    if not isinstance(value, dict) or set(value) != {'registryId', 'identityId', 'revision'} or \
       type(value['revision']) is not int or not 1 <= value['revision'] <= 9007199254740991:
        refuse('EXPECTED_IDENTITY')
    for key in ('registryId', 'identityId'):
        identifier(value[key], UUID, 'EXPECTED_IDENTITY')
    return value


# 按 SSH 动作限定请求字段并核对运行 UUID、摘要和预期身份，禁止额外授权参数。
# Restrict fields by SSH action and validate run UUID/digest/expected identity, excluding extra authority parameters.
def ssh_request(request):
    keys = {'action', 'projectId', 'expected', 'runId', 'snapshotSha256'}
    if request['action'] == 'ssh-prepare':
        keys.add('daemon')
    if set(request) != keys:
        refuse('REQUEST_SCHEMA')
    ssh_identity(request['expected'])
    identifier(request['runId'], UUID, 'RUN_ID')
    ssh_digest(request['snapshotSha256'])


# 验证文本不含 NUL 并严格 UTF-8 编码，失败用调用方指定拒绝码。
# Validate NUL-free text and encode strict UTF-8, refusing with the caller’s designated code.
def ssh_text(value, code):
    if not isinstance(value, str) or '\0' in value:
        refuse(code)
    try:
        return value.encode('utf-8', 'strict')
    except UnicodeError:
        refuse(code)


# 限制环境数量、键名与字节预算，禁止 HOME/USER/LOGNAME 覆盖项目身份。
# Bound environment count/names/bytes and forbid HOME/USER/LOGNAME identity overrides.
def ssh_environment(environment):
    if not isinstance(environment, dict) or len(environment) > SSH_ENV_LIMIT:
        refuse('SSH_ENVIRONMENT_BOUND')
    total = 0
    for key, value in environment.items():
        if not isinstance(key, str) or not re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,127}', key):
            refuse('SSH_ENVIRONMENT_NAME')
        if key in ('HOME', 'USER', 'LOGNAME'):
            refuse('SSH_ENVIRONMENT_IDENTITY')
        size = len(key.encode('ascii')) + 1 + len(ssh_text(value, 'SSH_ENVIRONMENT_VALUE'))
        if size > SSH_ENTRY_LIMIT:
            refuse('SSH_ENVIRONMENT_BOUND')
        total += size
        if total > SSH_TEXT_LIMIT:
            refuse('SSH_ENVIRONMENT_BOUND')
    return total


# 校验项目 ID 并构造固定 SSH 会话快照路径。
# Validate project ID and build its fixed SSH session-snapshot path.
def ssh_snapshot_path(project):
    return SSH_CONFIG + '/' + identifier(project, PROJECT, 'PROJECT_ID') + '/session.json'


# 校验运行 UUID 并构造固定 SSH 授权收据路径。
# Validate run UUID and build its fixed SSH authorization-receipt path.
def ssh_receipt_path(run_id):
    return RUNTIME + '/ssh/' + identifier(run_id, UUID, 'RUN_ID') + '.json'


# 相对固定父目录移除收据并同步，即使已缺失也同步，以完成可能中断的删除事务。
# Remove the receipt relative to a pinned parent and fsync even on absence to complete interrupted deletion.
def ssh_receipt_retire(run_id):
    path = ssh_receipt_path(run_id)
    authority = directory_fd(os.path.dirname(path))
    try:
        parent = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=authority)
    finally:
        os.close(authority)
    try:
        try:
            os.unlink(os.path.basename(path), dir_fd=parent)
        except FileNotFoundError:
            pass
        # Even absence must be fsynced: a previous unlink may have succeeded
        # while its directory fsync failed before the closed phase was saved.
        os.fsync(parent)
    finally:
        os.close(parent)


# 全过程持有已逐级验证父 FD，以独占临时文件写入/同步/替换收据并同步父目录。
# Retain the verified parent FD through exclusive temporary write/fsync/replace and parent fsync.
def ssh_atomic(path, data):
    # Retain the fully walked root-owned parent through publication/fsync.
    parent_path = os.path.dirname(path)
    authority = directory_fd(parent_path)
    try:
        parent = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=authority)
    finally:
        os.close(authority)
    temporary = '.record-' + str(uuid.uuid4())
    created = False
    try:
        try:
            trusted(os.stat(os.path.basename(path), dir_fd=parent, follow_symlinks=False), mode=0o600)
        except FileNotFoundError:
            pass
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                             0o600, dir_fd=parent)
        created = True
        try:
            os.fchmod(descriptor, 0o600)
            trusted(os.fstat(descriptor), mode=0o600)
            view = memoryview(data)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    refuse('SSH_RECORD_WRITE_FAILED')
                view = view[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.replace(temporary, os.path.basename(path), src_dir_fd=parent, dst_dir_fd=parent)
        created = False
        os.fsync(parent)
    finally:
        try:
            if created:
                os.unlink(temporary, dir_fd=parent)
        finally:
            os.close(parent)


# 核对快照预算、可选摘要、固定 schema 及身份/运行绑定，返回受限环境快照。
# Validate snapshot bounds, optional digest, exact schema and identity/run binding before returning bounded environment data.
def ssh_snapshot_decode(raw, value=None, run_id=None, digest=None):
    if len(raw) > SSH_SNAPSHOT_LIMIT:
        refuse('SSH_SNAPSHOT_BOUND')
    if digest is not None and hashlib.sha256(raw).hexdigest() != digest:
        refuse('SSH_SNAPSHOT_DIGEST')
    record = ssh_json(raw)
    if not isinstance(record, dict) or set(record) != {'version', 'projectId', 'runId', 'identity', 'environment'} or \
       type(record['version']) is not int or record['version'] != 1:
        refuse('SSH_SNAPSHOT_INVALID')
    identifier(record['projectId'], PROJECT, 'SSH_SNAPSHOT_INVALID')
    identifier(record['runId'], UUID, 'SSH_SNAPSHOT_INVALID')
    ssh_identity(record['identity'])
    ssh_environment(record['environment'])
    if value is not None and (record['projectId'] != value['projectId'] or any(
            record['identity'][key] != value[key] for key in ('registryId', 'identityId', 'revision'))):
        refuse('SSH_SNAPSHOT_STALE')
    if run_id is not None and record['runId'] != run_id:
        refuse('SSH_SNAPSHOT_STALE')
    return record


# 以非阻塞 stdin 有界读到真实 EOF，统一单调截止并恢复 flags，适配管道与普通文件。
# Read nonblocking stdin to real EOF under byte/deadline bounds and restore flags, supporting pipes and regular files.
def ssh_snapshot_input():
    descriptor = 0
    flags = fcntl.fcntl(descriptor, fcntl.F_GETFL)
    if flags & os.O_ACCMODE == os.O_WRONLY:
        refuse('SSH_SNAPSHOT_INPUT')
    fcntl.fcntl(descriptor, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    result = bytearray()
    deadline = time.monotonic() + SSH_INPUT_TIMEOUT
    try:
        # select also accepts regular input files; epoll would reject them.
        with selectors.SelectSelector() as poller:
            poller.register(descriptor, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not poller.select(remaining):
                    refuse('SSH_SNAPSHOT_TIMEOUT')
                try:
                    data = os.read(descriptor, min(4096, SSH_SNAPSHOT_LIMIT + 1 - len(result)))
                except (BlockingIOError, InterruptedError):
                    continue
                if not data:
                    return bytes(result)
                result.extend(data)
                if len(result) > SSH_SNAPSHOT_LIMIT:
                    refuse('SSH_SNAPSHOT_BOUND')
    finally:
        fcntl.fcntl(descriptor, fcntl.F_SETFL, flags)


# 用字面 shell 引用构造会话命令与固定项目环境，核对 TERM 和原生命令帧总预算。
# Quote the literal session command, add fixed project environment and validate TERM/native-frame budgets.
def ssh_payload(value, environment, original, term):
    import shlex
    command = ssh_text(original, 'SSH_COMMAND_BOUND')
    if len(command) > SSH_TEXT_LIMIT:
        refuse('SSH_COMMAND_BOUND')
    term = 'xterm-256color' if term is None else term
    if not isinstance(term, str) or not re.fullmatch('[\x20-\x7e]{1,128}', term):
        refuse('SSH_TERM_BOUND')
    script = ('exec /bin/sh -c ' + shlex.quote(original)) if original else 'exec /bin/sh -l'
    script_bytes = ssh_text(script, 'SSH_COMMAND_BOUND')
    environment = dict(environment)
    environment['VSCODE_AGENT_FOLDER'] = value['home'] + '/.vscode-server'
    environment['TERM'] = term
    total = ssh_environment(environment) + len(script_bytes)
    if total > SSH_TEXT_LIMIT:
        refuse('SSH_PAYLOAD_BOUND')
    body = bytearray(script_bytes)
    for key, content in sorted(environment.items()):
        key_bytes, content_bytes = key.encode('ascii'), ssh_text(content, 'SSH_ENVIRONMENT_VALUE')
        body.extend(struct.pack('<II', len(key_bytes), len(content_bytes)))
        body.extend(key_bytes)
        body.extend(content_bytes)
    payload = struct.pack('<8sIIIIII', b'SKIDP001', 1, 2, len(body), len(environment), len(script_bytes), 0) + body
    if len(payload) > SSH_SNAPSHOT_LIMIT:
        refuse('SSH_PAYLOAD_BOUND')
    return payload


# 验证守护进程 PID、创建 ticks、boot 和仅支持的项目服务 cgroup，返回精确证明。
# Validate daemon PID/birth ticks/boot and only supported project-service cgroups as exact proof.
def ssh_daemon_record(daemon, project):
    if not isinstance(daemon, dict) or set(daemon) != {'pid', 'startTicks', 'bootId', 'cgroupName'} or \
       type(daemon['pid']) is not int or not 1 <= daemon['pid'] <= 2147483647:
        refuse('SSH_DAEMON_INVALID')
    identifier(daemon['bootId'], UUID, 'SSH_DAEMON_INVALID')
    if not isinstance(daemon['startTicks'], str) or not re.fullmatch('[1-9][0-9]{0,19}', daemon['startTicks']) or \
       int(daemon['startTicks']) > 18446744073709551615:
        refuse('SSH_DAEMON_INVALID')
    if daemon['cgroupName'] not in ('openrc.sakura-ssh-' + project, 'system.slice/sakura-ssh-' + project + '.service'):
        refuse('SSH_DAEMON_SCOPE')
    return daemon


# 读取并校验收据、守护进程和快照摘要，按参数核对运行票据与允许的 closed 恢复状态。
# Validate receipt/daemon/snapshot digest against the run and explicitly allowed closed recovery state.
def ssh_receipt_read(run_id, run=None, missing=False, closed=False):
    raw = read(ssh_receipt_path(run_id), 8192, missing)
    if raw is None:
        return None
    receipt = ssh_json(raw)
    if not isinstance(receipt, dict) or set(receipt) != {'version', 'run', 'daemon', 'snapshotSha256'} or \
       type(receipt['version']) is not int or receipt['version'] != 1:
        refuse('SSH_RECEIPT_INVALID')
    recorded = receipt['run']
    keys = {'version', 'phase', 'mode', 'registryId', 'identityId', 'projectId', 'runId', 'revision', 'bootId',
            'build', 'networkDevice', 'networkInode', 'cgroupDevice', 'cgroupInode', 'cgroupName', 'namespace'}
    if not isinstance(recorded, dict) or set(recorded) != keys or any(
            type(item) is not (int if key in ('version', 'revision') else str) for key, item in recorded.items()) or \
       not 1 <= recorded['revision'] <= 9007199254740991:
        refuse('SSH_RECEIPT_INVALID')
    for key in ('networkDevice', 'networkInode', 'cgroupDevice', 'cgroupInode'):
        if not re.fullmatch('0|[1-9][0-9]{0,19}', recorded[key]) or int(recorded[key]) > 18446744073709551615:
            refuse('SSH_RECEIPT_INVALID')
    if recorded != run_decode(run_id, run_bytes(recorded)) or recorded['phase'] != 'active' or \
       recorded['mode'] != 'inherit-current' or recorded['networkInode'] == '0' or recorded['cgroupInode'] == '0':
        refuse('SSH_RECEIPT_INVALID')
    daemon = ssh_daemon_record(receipt['daemon'], recorded['projectId'])
    if daemon['bootId'] != recorded['bootId'] or daemon['cgroupName'] != recorded['cgroupName']:
        refuse('SSH_RECEIPT_INVALID')
    ssh_digest(receipt['snapshotSha256'])
    if run is not None and recorded != (dict(run, phase='active') if closed else run):
        refuse('SSH_RECEIPT_STALE')
    return receipt


# 从精确 SSH 收据取得可清理运行，核对当前绑定/boot 与固定继承服务域。
# Obtain cleanup authority from an exact SSH receipt matching binding/boot and fixed inherited service domain.
def ssh_cleanup_receipt(value, run_id, boot):
    receipt = ssh_receipt_read(run_id, missing=True)
    if receipt is None:
        refuse('RECORD_ABSENT')
    run = receipt['run']
    check_run(value, run, boot)
    if run['mode'] != 'inherit-current' or run['cgroupName'] not in (
            'openrc.sakura-ssh-' + value['projectId'], 'system.slice/sakura-ssh-' + value['projectId'] + '.service'):
        refuse('SSH_RECEIPT_STALE')
    return run


# 仅在外层已证明原组消失且持 EX 锁时补写清理票据，不替换热票据或复活归档 UUID。
# Materialize cleanup tickets only after proven group absence under EX, never replacing hot tickets or reviving archived UUIDs.
def ssh_cleanup_materialize(run):
    # The caller has proved the original group absent while holding EX. Never
    # replace a hot ticket or revive an archived UUID, including on retries.
    run_id = run['runId']
    ssh_receipt_read(run_id, run)
    if run_archive_read(run_id) is not None:
        refuse('RUN_ARCHIVED')
    if read(run_path(run_id), RUN.size, True) is not None:
        refuse('RUN_ID_COLLISION')
    if len(run_entries()) >= RUN_LIMIT:
        refuse('RUN_LIMIT')
    authority = directory_fd(RUNTIME + '/runs')
    try:
        parent = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=authority)
    finally:
        os.close(authority)
    temporary = '.record-' + str(uuid.uuid4())
    created = published = False
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                             0o600, dir_fd=parent)
        created = True
        try:
            os.fchmod(descriptor, 0o600)
            trusted(os.fstat(descriptor), mode=0o600)
            view = memoryview(run_bytes(run))
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    refuse('SSH_RECORD_WRITE_FAILED')
                view = view[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        if run_archive_read(run_id) is not None:
            refuse('RUN_ARCHIVED')
        run_archive_publish(parent, temporary, run_id + '.bin')
        published = True
        os.fsync(parent)
    finally:
        try:
            if created and not published:
                try:
                    os.unlink(temporary, dir_fd=parent)
                except FileNotFoundError:
                    pass
        finally:
            os.close(parent)


# 只接受固定 sshd argv 或其标准监听者标题形式，拒绝自定义配置和畸形字节。
# Accept only fixed sshd argv or its standard listener-title form, refusing custom configs/malformed bytes.
def ssh_daemon_arguments(raw, project):
    fixed = SSH_CONFIG + '/' + project + '/sshd_config'
    if not raw or not raw.endswith(b'\0'):
        refuse('SSH_DAEMON_COMMAND')
    try:
        arguments = raw.rstrip(b'\0').decode('utf-8', 'strict').split('\0')
    except UnicodeError:
        refuse('SSH_DAEMON_COMMAND')
    if arguments == ['/usr/sbin/sshd', '-D', '-e', '-f', fixed]:
        return
    # OpenSSH's listener title retains its complete original argv. Only that
    # fixed command and the known listener counters can replace NUL argv.
    title = 'sshd: /usr/sbin/sshd -D -e -f ' + fixed + ' [listener] '
    if len(arguments) != 1 or not re.fullmatch(re.escape(title) + '[0-9]{1,10} of [0-9]{1,10}-[0-9]{1,10} startups', arguments[0]):
        refuse('SSH_DAEMON_COMMAND')


# 固定进程目录与 cgroup，前后核对创建 ticks、root 身份、映像及命令，替代或退出守护进程拒绝。
# Pin proc/cgroup and bracket birth checks around root identity/image/command validation; changed/dead daemons refuse.
def ssh_daemon_check(value, daemon, boot, run=None):
    ssh_daemon_record(daemon, value['projectId'])
    if daemon['bootId'] != boot:
        refuse('SSH_DAEMON_BOOT')
    cgroup_available(False)
    scope = cgroup_name_fd(daemon['cgroupName'])
    try:
        scope_info = os.fstat(scope)
        if run is not None and (run['cgroupName'] != daemon['cgroupName'] or not same(scope_info, run, 'cgroup')):
            refuse('CGROUP_REPLACED')
        parent = directory_fd('/proc')
        try:
            process = os.open(str(daemon['pid']), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        finally:
            os.close(parent)
        try:
            trusted(os.fstat(process), True)
            # 相对固定进程目录非阻塞、有界读取字段，超限拒绝并关闭 FD。
            # Read proc fields nonblockingly relative to the pinned directory with strict limits and FD cleanup.
            def proc_read(name, limit):
                descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, dir_fd=process)
                try:
                    result = bytearray()
                    while len(result) <= limit:
                        data = os.read(descriptor, min(4096, limit + 1 - len(result)))
                        if not data:
                            return bytes(result)
                        result.extend(data)
                    refuse('SSH_DAEMON_PROCESS_BOUND')
                finally:
                    os.close(descriptor)
            # 核对进程非僵尸且创建 ticks 等于收据，防止 PID 重用。
            # Require a nonzombie process whose birth ticks match the receipt, preventing PID reuse.
            def process_ticks():
                raw = proc_read('stat', 4096).decode('ascii', 'strict')
                fields = raw[raw.rindex(')') + 2:].split()
                if len(fields) < 20 or fields[0] in ('Z', 'X', 'x') or fields[19] != daemon['startTicks']:
                    refuse('SSH_DAEMON_CHANGED')
                return fields[19]
            process_ticks()
            if not re.search(rb'^Uid:\s+0\s+0\s+0\s+0$', proc_read('status', 65536), re.M) or \
               os.readlink('exe', dir_fd=process) != '/usr/sbin/sshd':
                refuse('SSH_DAEMON_IDENTITY')
            ssh_daemon_arguments(proc_read('cmdline', 8192), value['projectId'])
            if proc_read('cgroup', 4096) != ('0::/' + daemon['cgroupName'] + '\n').encode('ascii'):
                refuse('SSH_DAEMON_SCOPE')
            if run is not None:
                namespace_parent = os.open('ns', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=process)
                try:
                    namespace = os.open('net', os.O_RDONLY | os.O_CLOEXEC, dir_fd=namespace_parent)
                finally:
                    os.close(namespace_parent)
                try:
                    info = os.fstat(namespace)
                    if info.st_uid != 0 or fcntl.ioctl(namespace, 0xb703) != 0x40000000 or not same(info, run, 'network'):
                        refuse('SSH_DAEMON_NETWORK')
                finally:
                    os.close(namespace)
            process_ticks()
            if os.readlink('exe', dir_fd=process) != '/usr/sbin/sshd':
                refuse('SSH_DAEMON_CHANGED')
        finally:
            os.close(process)
        # Reopening through the protected name detects a substituted group.
        current = cgroup_name_fd(daemon['cgroupName'])
        try:
            now = os.fstat(current)
            if (now.st_dev, now.st_ino) != (scope_info.st_dev, scope_info.st_ino):
                refuse('CGROUP_REPLACED')
        finally:
            os.close(current)
        return scope_info
    finally:
        os.close(scope)


# 校验快照身份与总负载预算，固定运行 UUID 的配置与收据关系，旧归档或不同快照重试拒绝。
# Validate snapshot identity/frame budget and pin its run/config/receipt relationship; archived IDs or changed retries refuse.
def ssh_snapshot(value, request, raw, boot, build):
    digest, run_id = request['snapshotSha256'], request['runId']
    record = ssh_snapshot_decode(raw, value, run_id, digest)
    migration_ready(value)
    # Reserve enough entries/bytes for fixed identity-local editor storage and
    # a TERM, and prove that even an empty login command fits the native frame.
    ssh_payload(value, record['environment'], '', None)
    if run_archive_read(run_id) is not None:
        refuse('RUN_ARCHIVED')
    receipt = ssh_receipt_read(run_id, missing=True)
    if receipt is not None:
        check_run(value, receipt['run'], boot)
        if receipt['snapshotSha256'] != digest or receipt['run']['build'] != build:
            refuse('SSH_SNAPSHOT_STALE')
    for run in runs_for(value):
        if run['runId'] == run_id:
            check_run(value, run, boot)
            if receipt is None or receipt['run'] != run or run['build'] != build:
                refuse('SSH_RECEIPT_STALE')
        elif run['phase'] == 'active' and run['cgroupName'] in (
                'openrc.sakura-ssh-' + value['projectId'], 'system.slice/sakura-ssh-' + value['projectId'] + '.service'):
            refuse('SSH_RUNS_MUST_STOP')
    for path in ('/etc/sakura', SSH_CONFIG, SSH_CONFIG + '/' + value['projectId']):
        parent = directory_fd(os.path.dirname(path))
        try:
            try:
                os.mkdir(os.path.basename(path), 0o700, dir_fd=parent)
            except FileExistsError:
                pass
        finally:
            os.close(parent)
        descriptor = directory_fd(path)
        os.close(descriptor)
    prior = read(ssh_snapshot_path(value['projectId']), SSH_SNAPSHOT_LIMIT, True)
    if prior is not None:
        old = ssh_snapshot_decode(prior)
        if old['runId'] == run_id and prior != raw:
            refuse('SSH_SNAPSHOT_CHANGED')
    if prior != raw:
        ssh_atomic(ssh_snapshot_path(value['projectId']), raw)
    return {'version': 1, 'projectId': value['projectId'], 'runId': run_id, 'snapshotSha256': digest}


# 核实快照、root SSH 守护进程和既有收据后准备继承域票据，重试只允许同一精确证明。
# Prepare an inherited-domain ticket after snapshot/root-daemon/receipt checks; retries require identical proof.
def ssh_prepare(value, request, boot, build):
    snapshot = read(ssh_snapshot_path(value['projectId']), SSH_SNAPSHOT_LIMIT)
    ssh_snapshot_decode(snapshot, value, request['runId'], request['snapshotSha256'])
    daemon = ssh_daemon_record(request['daemon'], value['projectId'])
    info = ssh_daemon_check(value, daemon, boot)
    prior = ssh_receipt_read(request['runId'], missing=True)
    if prior is not None and (prior['daemon'] != daemon or prior['snapshotSha256'] != request['snapshotSha256']):
        refuse('SSH_RECEIPT_STALE')
    if prior is None and read(run_path(request['runId']), RUN.size, True) is not None:
        refuse('SSH_RECEIPT_ABSENT')
    # 先持久固定原守护进程收据，再使对应票据可启动，崩溃恢复只能复用相同收据。
    # Persist the exact daemon receipt before making its ticket launchable; crash recovery can reuse only identical proof.
    def publish(run):
        ssh_daemon_check(value, daemon, boot, run)
        receipt = {'version': 1, 'run': run, 'daemon': daemon, 'snapshotSha256': request['snapshotSha256']}
        if prior is not None:
            if prior != receipt:
                refuse('SSH_RECEIPT_STALE')
        else:
            # Pin the original daemon before making its ticket launchable. A
            # crash between these writes can retry only the identical proof.
            ssh_atomic(ssh_receipt_path(run['runId']),
                       (json.dumps(receipt, separators=(',', ':'), sort_keys=True) + '\n').encode('utf-8'))
    run = prepare(value, request, boot, build, True, daemon['cgroupName'], info, publish)
    receipt = ssh_receipt_read(run['runId'], run)
    if receipt['daemon'] != daemon or receipt['snapshotSha256'] != request['snapshotSha256']:
        refuse('SSH_RECEIPT_STALE')
    ssh_daemon_check(value, daemon, boot, run)
    return run


# 核对票据、构建、收据、守护进程、迁移与网络身份，返回匹配的快照环境。
# Validate ticket/build/receipt/daemon/migration/network identity before returning the matching environment snapshot.
def ssh_checked_run(value, run, boot, build, snapshot_sha256=None):
    check_run(value, run, boot)
    if run['mode'] != 'inherit-current' or run['build'] != build:
        refuse('SSH_RUN_STALE')
    receipt = ssh_receipt_read(run['runId'], run)
    if snapshot_sha256 is not None and receipt['snapshotSha256'] != snapshot_sha256:
        refuse('SSH_SNAPSHOT_STALE')
    ssh_daemon_check(value, receipt['daemon'], boot, run)
    migration_ready(value)
    descriptor, info, namespace = network_fd(value, boot, readonly=True)
    try:
        if not same(info, run, 'network') or namespace != run['namespace']:
            refuse('NETWORK_REPLACED')
    finally:
        os.close(descriptor)
    record = ssh_snapshot_decode(read(ssh_snapshot_path(value['projectId']), SSH_SNAPSHOT_LIMIT),
                                 value, run['runId'], receipt['snapshotSha256'])
    return record


# 要求当前进程属于该 SSH cgroup，再取得已核实运行与当前字面命令的原生负载。
# Require current SSH cgroup membership and return the verified run with the current literal-command payload.
def ssh_session(value, request, boot, build, original, term):
    run = run_read(request['runId'])
    current_cgroup(run['cgroupName'])
    record = ssh_checked_run(value, run, boot, build, request['snapshotSha256'])
    return run, ssh_payload(value, record['environment'], original, term)


# 核实继承 socket 的实际 SO_DOMAIN 为 AF_UNIX，拒绝网络 socket 逃逸到启动后的项目身份。
# Check inherited sockets’ actual SO_DOMAIN is AF_UNIX, excluding network authority from project execution.
def local_transport(descriptor, code):
    info = os.fstat(descriptor)
    if stat.S_ISSOCK(info.st_mode):
        # An inherited socket still belongs to its creating network and UID.
        # Only local socketpairs are valid SSH/command transport; inspecting
        # SO_DOMAIN checks the actual descriptor, independent of Python hints.
        with socket.fromfd(descriptor, socket.AF_UNIX, socket.SOCK_STREAM) as channel:
            if channel.getsockopt(socket.SOL_SOCKET, socket.SO_DOMAIN) != socket.AF_UNIX:
                refuse(code)
    return info


# 原 SSH 输入固定为 fd 3，负载另走 stdin 管道；不得把已有网络 socket 带入项目命名空间。
# 把已核实本地会话 FD 与负载管道分开传给启动器，封闭其他 FD；取消转发到自有子进程。
# Pass verified local session FD separately from the payload pipe and close other FDs; cancellation targets the owned child.
def ssh_launch(value, run, build, payload):
    info = local_transport(0, 'SSH_SESSION_NETWORK_CHANNEL')
    flags = fcntl.fcntl(0, fcntl.F_GETFL)
    if flags & os.O_ACCMODE == os.O_WRONLY or not (stat.S_ISFIFO(info.st_mode) or stat.S_ISSOCK(info.st_mode) or
                                                  (stat.S_ISCHR(info.st_mode) and os.isatty(0))):
        refuse('SSH_SESSION_INPUT')
    arguments = launch_argv(value, run, {'payloadSha256': hashlib.sha256(payload).hexdigest()}, build)
    # main has closed every metadata/authority descriptor. fd 3 is exclusively
    # the untouched SSH input channel; the frame gets a separate stdin pipe.
    os.dup2(0, 3)
    try:
        child = subprocess.Popen(arguments, stdin=subprocess.PIPE, stdout=None, stderr=None,
                                 env=CLEAN_ENV, close_fds=True, pass_fds=(3,))
    finally:
        os.close(3)
    prior_signals = {signum: signal.getsignal(signum) for signum in (signal.SIGINT, signal.SIGQUIT, signal.SIGHUP, signal.SIGTERM)}
    # 仅向尚存活的本次启动子进程转发信号，然后拒绝控制操作。
    # Forward cancellation only to this live launch child, then refuse the control operation.
    def cancelled(signum, _frame):
        if child.poll() is None:
            child.send_signal(signum)
        refuse('CONTROL_CANCELLED')
    try:
        for signum in (signal.SIGINT, signal.SIGQUIT):
            signal.signal(signum, signal.SIG_IGN)
        for signum in (signal.SIGHUP, signal.SIGTERM):
            signal.signal(signum, cancelled)
        os.set_blocking(child.stdin.fileno(), False)
        deadline = time.monotonic() + SSH_INPUT_TIMEOUT
        with selectors.DefaultSelector() as poller:
            poller.register(child.stdin, selectors.EVENT_WRITE)
            view = memoryview(payload)
            while view:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not poller.select(remaining):
                    refuse('SSH_PAYLOAD_TIMEOUT')
                try:
                    written = os.write(child.stdin.fileno(), view)
                except (BlockingIOError, InterruptedError):
                    continue
                if written <= 0:
                    refuse('SSH_PAYLOAD_INPUT')
                view = view[written:]
        child.stdin.close()
        code = child.wait()
        return code if code >= 0 else 128 - code
    finally:
        for signum, handler in prior_signals.items():
            signal.signal(signum, handler)
        if not child.stdin.closed:
            child.stdin.close()
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    refuse('SSH_SESSION_CLEANUP_FAILED')


# 校验运行 UUID 并构造本运行终端状态路径。
# Validate run UUID and build its terminal-state path.
def terminal_path(run_id):
    return RUNTIME + '/terminals/' + identifier(run_id, UUID, 'RUN_ID') + '.json'


# 无跟随打开或按需创建本运行 0600 锁，核实可信文件；不创建模式下缺失返回 None。
# Open/create the run’s trusted 0600 lock without links; noncreating absence returns None.
def terminal_lock(run_id, create=False):
    parent = directory_fd(RUNTIME + '/terminal-locks')
    try:
        try:
            descriptor = os.open(identifier(run_id, UUID, 'RUN_ID'),
                                 os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | (os.O_CREAT if create else 0),
                                 0o600, dir_fd=parent)
        except FileNotFoundError:
            if create:
                raise
            return None
        try:
            trusted(os.fstat(descriptor), mode=0o600)
            return descriptor
        except BaseException:
            os.close(descriptor)
            raise
    finally:
        os.close(parent)


# 用非阻塞 flock 在 20 秒内取得 SH/EX 终端锁，超时报告忙状态。
# Acquire a nonblocking SH/EX terminal lock within twenty seconds or report busy.
def terminal_acquire(descriptor, readonly):
    if descriptor is None:
        return
    deadline = time.monotonic() + 20
    while True:
        try:
            fcntl.flock(descriptor, (fcntl.LOCK_SH if readonly else fcntl.LOCK_EX) | fcntl.LOCK_NB)
            return
        except BlockingIOError:
            if time.monotonic() >= deadline:
                refuse('TERMINAL_CONTROL_BUSY')
            time.sleep(.02)


# 只编码控制器固定脚本与 TERM 的原生负载帧，交互 PTY 与负载输入保持分离。
# Encode only controller-generated script/TERM into the native frame, keeping interactive PTY separate from payload input.
def terminal_payload(script, interactive=False):
    # Fixed controller-generated commands only. A PTY never carries the frame:
    # the launcher reads a separate pipe, then duplicates the existing PTY.
    body = script.encode()
    term = b'xterm-256color'
    body += struct.pack('<II', 4, len(term)) + b'TERM' + term
    return struct.pack('<8sIIIIII', b'SKIDP001', 1, int(interactive), len(body), 1,
                       len(script.encode()), 0) + body


# 经固定启动器执行终端脚本，以管道传负载，交互和采集模式分开；失败清理本次进程/管道。
# Execute terminal scripts through the pinned launcher using a payload pipe, separating interactive/captured modes and cleaning failures.
def terminal_launch(value, run, build, script, interactive=False, started=None):
    payload = terminal_payload(script, interactive)
    request = {'payloadSha256': hashlib.sha256(payload).hexdigest()}
    child = subprocess.Popen(launch_argv(value, run, request, build), stdin=subprocess.PIPE,
                             stdout=None if interactive else subprocess.PIPE,
                             stderr=None if interactive else subprocess.PIPE, env=CLEAN_ENV,
                             close_fds=True)
    try:
        if interactive:
            child.stdin.write(payload)
            child.stdin.close()
            if started is not None:
                started()
            # tmux owns terminal input and terminal signals. This root waiter
            # never reads user input, interprets it, or inherits an authority FD.
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            return child.wait(), '', ''
        child.stdin.write(payload)
        child.stdin.close()
        output, errors = bytearray(), bytearray()
        deadline = time.monotonic() + 15
        with selectors.DefaultSelector() as poller:
            for stream, target in ((child.stdout, output), (child.stderr, errors)):
                os.set_blocking(stream.fileno(), False)
                poller.register(stream, selectors.EVENT_READ, target)
            while poller.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    refuse('TERMINAL_CONTROL_TIMEOUT')
                for key, _event in poller.select(remaining):
                    data = os.read(key.fileobj.fileno(), 4096)
                    if not data:
                        poller.unregister(key.fileobj)
                        key.fileobj.close()
                    else:
                        key.data.extend(data)
                        if len(output) + len(errors) > 65536:
                            refuse('TERMINAL_OUTPUT_BOUND')
        child.wait(timeout=max(.01, deadline - time.monotonic()))
        return child.returncode, output.decode('utf-8', 'strict'), errors.decode('utf-8', 'strict')
    except subprocess.TimeoutExpired:
        refuse('TERMINAL_CONTROL_TIMEOUT')
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


# 只接受固定系统位置的可信可执行 tmux，拒绝可写或 setuid/setgid 映像。
# Accept trusted executable tmux only from fixed locations, refusing writable or setuid/setgid images.
def terminal_binary():
    for path in ('/usr/bin/tmux', '/bin/tmux'):
        if not os.path.exists(path):
            continue
        path = os.path.realpath(path)
        fd = directory_fd(os.path.dirname(path))
        os.close(fd)
        info = os.lstat(path)
        trusted(info)
        if not info.st_mode & 0o111 or info.st_mode & 0o6000:
            refuse('TERMINAL_BINARY_CHANGED')
        return path
    refuse('TERMINAL_BINARY_MISSING')


# 读取并核对终端阶段、运行、账号、socket 和服务器创建身份，缺失只在明确允许时返回。
# Validate terminal phase/run/account/socket/server-birth identity, allowing absence only explicitly.
def terminal_state(value, run, name=None, missing=False):
    record = json_read(terminal_path(run['runId']), missing)
    if record is None:
        return None
    fields = {'version', 'phase', 'run', 'name', 'uid', 'gid', 'directoryDevice', 'directoryInode',
              'socketDevice', 'socketInode', 'serverPid', 'serverTicks', 'sessionId'}
    if not isinstance(record, dict) or set(record) != fields or record['version'] != 1 or \
       record['phase'] not in ('creating', 'active') or record['run'] != dict(run, phase='active') or \
       record['uid'] != value['uid'] or record['gid'] != value['gid'] or \
       not isinstance(record['name'], str) or not re.fullmatch('[a-z0-9-]{1,96}', record['name']) or \
       (name is not None and record['name'] != name):
        refuse('TERMINAL_RECORD_CHANGED')
    for key in ('directoryDevice', 'directoryInode'):
        if not isinstance(record[key], str) or not re.fullmatch('[1-9][0-9]*', record[key]):
            refuse('TERMINAL_RECORD_CHANGED')
    if record['phase'] == 'active' and (not isinstance(record['serverPid'], int) or record['serverPid'] < 1 or
       not isinstance(record['serverTicks'], str) or not re.fullmatch('[1-9][0-9]*', record['serverTicks']) or
       not isinstance(record['sessionId'], str) or not re.fullmatch(r'\$[0-9]+', record['sessionId']) or
       any(not isinstance(record[key], str) or not re.fullmatch('[1-9][0-9]*', record[key])
           for key in ('socketDevice', 'socketInode'))):
        refuse('TERMINAL_RECORD_CHANGED')
    return record


# 检查终端进程四类 UID/GID、创建 ticks 和 cgroup，返回精确进程身份。
# Check terminal process UID/GID slots, birth ticks and cgroup before returning exact identity.
def terminal_process(pid, value, run):
    if not isinstance(pid, int) or pid < 1:
        refuse('TERMINAL_PROCESS_CHANGED')
    raw = open('/proc/' + str(pid) + '/stat').read()
    ticks = raw[raw.rindex(')') + 2:].split()[19]
    status = open('/proc/' + str(pid) + '/status').read().splitlines()
    for label, expected_id in (('Uid:', value['uid']), ('Gid:', value['gid'])):
        entry = next((line.split()[1:] for line in status if line.startswith(label)), None)
        if entry != [str(expected_id)] * 4:
            refuse('TERMINAL_PROCESS_IDENTITY')
    membership = open('/proc/' + str(pid) + '/cgroup').read().strip()
    if membership != '0::/' + run['cgroupName']:
        refuse('TERMINAL_PROCESS_SCOPE')
    if not same(os.stat('/proc/' + str(pid) + '/ns/net'), run, 'network'):
        refuse('TERMINAL_PROCESS_NETWORK')
    # Detect exit/PID reuse across the independent reads above.
    raw = open('/proc/' + str(pid) + '/stat').read()
    if raw[raw.rindex(')') + 2:].split()[19] != ticks:
        refuse('TERMINAL_PROCESS_CHANGED')
    return ticks


# 核对 root 控制目录及项目 socket 的设备/inode、权限和服务器进程证明。
# Verify root-controlled directory/project socket device/inode, modes and server-process proof.
def terminal_socket(record, value, run):
    folder = TERMINALS + '/' + run['runId']
    descriptor = directory_fd(folder)
    try:
        info = os.fstat(descriptor)
        if info.st_uid != 0 or info.st_gid != value['gid'] or stat.S_IMODE(info.st_mode) != 0o710 or \
           str(info.st_dev) != record['directoryDevice'] or str(info.st_ino) != record['directoryInode']:
            refuse('TERMINAL_DIRECTORY_CHANGED')
        info = os.stat('socket', dir_fd=descriptor, follow_symlinks=False)
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != value['uid'] or info.st_gid != value['gid'] or \
           info.st_nlink != 1 or stat.S_IMODE(info.st_mode) & 0o007:
            refuse('TERMINAL_SOCKET_CHANGED')
        if record['phase'] == 'active' and (str(info.st_dev) != record['socketDevice'] or
                                          str(info.st_ino) != record['socketInode']):
            refuse('TERMINAL_SOCKET_CHANGED')
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as peer:
            peer.settimeout(3)
            peer.connect(folder + '/socket')
            pid, uid, gid = struct.unpack('3i', peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != value['uid'] or gid != value['gid']:
            refuse('TERMINAL_SERVER_IDENTITY')
        ticks = terminal_process(pid, value, run)
        if record['phase'] == 'active' and (pid != record['serverPid'] or ticks != record['serverTicks']):
            refuse('TERMINAL_SERVER_CHANGED')
        current = os.stat('socket', dir_fd=descriptor, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            refuse('TERMINAL_SOCKET_CHANGED')
        return {'socketDevice': str(info.st_dev), 'socketInode': str(info.st_ino),
                'serverPid': pid, 'serverTicks': ticks}
    finally:
        os.close(descriptor)


# 经项目启动器调用固定 tmux socket 与禁用配置文件的命令，非零退出拒绝。
# Call tmux through the project launcher using the fixed socket and disabled config, refusing nonzero exits.
def terminal_tmux(value, run, build, arguments):
    import shlex
    args = [terminal_binary(), '-f', '/dev/null', '-S', TERMINALS + '/' + run['runId'] + '/socket']
    code, output, _errors = terminal_launch(value, run, build, 'exec ' + shlex.join(args + arguments))
    if code != 0:
        refuse('TERMINAL_TMUX_REFUSED')
    return output.strip()


# 要求 active 收据、精确 socket 和唯一预期 tmux 会话，并验证各 pane 进程归属。
# Require active receipt/exact socket/sole expected tmux session and verify pane-process ownership.
def terminal_check(value, run, build, record):
    if record['phase'] != 'active':
        refuse('TERMINAL_START_UNCONFIRMED')
    terminal_socket(record, value, run)
    sessions = terminal_tmux(value, run, build, ['list-sessions', '-F', '#{session_id} #{session_name}']).splitlines()
    if sessions != [record['sessionId'] + ' ' + record['name']]:
        refuse('TERMINAL_SESSION_CHANGED')
    panes = terminal_tmux(value, run, build, ['list-panes', '-s', '-t', record['sessionId'], '-F', '#{pane_pid}']).splitlines()
    if not panes or len(panes) > 256 or any(not re.fullmatch('[1-9][0-9]*', pid) for pid in panes):
        refuse('TERMINAL_PANES_CHANGED')
    for pid in panes:
        terminal_process(int(pid), value, run)
    terminal_socket(record, value, run)
    return {'version': 1, 'terminalId': run['runId'], 'run': run, 'name': record['name'],
            'serverPid': record['serverPid'], 'serverTicks': record['serverTicks'], 'sessionId': record['sessionId']}


# 先发布 creating 预留，再经项目身份启动并固定 tmux socket/服务器/session；完整证明后发布 active。
# Publish creating reservation before project-identity startup, then pin tmux socket/server/session and publish active only after full proof.
def terminal_create(value, run, build, name):
    if terminal_state(value, run, missing=True) is not None:
        refuse('TERMINAL_ALREADY_RESERVED')
    folder = TERMINALS + '/' + run['runId']
    os.mkdir(folder, 0o700)
    descriptor = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        os.fchown(descriptor, value['uid'], value['gid'])
        info = os.fstat(descriptor)
        record = {'version': 1, 'phase': 'creating', 'run': run, 'name': name,
                  'uid': value['uid'], 'gid': value['gid'], 'directoryDevice': str(info.st_dev),
                  'directoryInode': str(info.st_ino), 'socketDevice': None, 'socketInode': None,
                  'serverPid': None, 'serverTicks': None, 'sessionId': None}
        json_write(terminal_path(run['runId']), record)
        # No project shell/configuration before the socket directory is sealed.
        terminal_tmux(value, run, build, ['new-session', '-d', '-s', name, '/bin/sleep 2147483647'])
        if set(os.listdir(descriptor)) != {'socket'}:
            refuse('TERMINAL_DIRECTORY_CHANGED')
        os.fchown(descriptor, 0, value['gid'])
        os.fchmod(descriptor, 0o710)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    record.update(terminal_socket(record, value, run))
    session_id = terminal_tmux(value, run, build, ['list-sessions', '-F', '#{session_id}']).strip()
    if not re.fullmatch(r'\$[0-9]+', session_id):
        refuse('TERMINAL_SESSION_CHANGED')
    record.update(phase='active', sessionId=session_id)
    json_write(terminal_path(run['runId']), record)
    terminal_tmux(value, run, build, ['set-option', '-t', session_id, 'default-shell', '/bin/sh'])
    terminal_tmux(value, run, build, ['set-option', '-t', session_id, 'default-command', '/bin/sh -l'])
    terminal_tmux(value, run, build, ['respawn-pane', '-k', '-t', session_id, '/bin/sh -l'])
    return terminal_check(value, run, build, record)


# 要求运行 closed 且原 cgroup 已消失，才清理精确终端目录与状态；未知替代目录拒绝。
# Retire terminal state/directory only after closed run and original cgroup absence, refusing replacement directories.
def terminal_retire(value, run):
    descriptor = cgroup_fd(run)
    if descriptor is not None:
        os.close(descriptor)
    if run['phase'] != 'closed' or descriptor is not None:
        refuse('PROJECT_IDENTITY_CLEANUP_FAILED')
    record = terminal_state(value, run, missing=True)
    folder = TERMINALS + '/' + run['runId']
    if record is None:
        if os.path.lexists(folder):
            refuse('TERMINAL_DIRECTORY_CHANGED')
        return {'version': 1, 'terminalId': run['runId'], 'retired': True}
    parent = directory_fd(TERMINALS)
    readable_parent = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
    os.close(parent)
    parent = readable_parent
    try:
        try:
            descriptor = os.open(run['runId'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            descriptor = None
        if descriptor is not None:
            try:
                info = os.fstat(descriptor)
                if str(info.st_dev) != record['directoryDevice'] or str(info.st_ino) != record['directoryInode'] or \
                   info.st_uid not in (0, value['uid']) or info.st_gid != value['gid'] or \
                   stat.S_IMODE(info.st_mode) not in (0o700, 0o710):
                    refuse('TERMINAL_DIRECTORY_CHANGED')
                if not set(os.listdir(descriptor)).issubset({'socket'}):
                    refuse('TERMINAL_DIRECTORY_CHANGED')
                try:
                    info = os.stat('socket', dir_fd=descriptor, follow_symlinks=False)
                    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != value['uid'] or info.st_nlink != 1 or \
                       (record['phase'] == 'active' and (str(info.st_dev) != record['socketDevice'] or
                                                       str(info.st_ino) != record['socketInode'])):
                        refuse('TERMINAL_SOCKET_CHANGED')
                    os.unlink('socket', dir_fd=descriptor)
                except FileNotFoundError:
                    pass
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            os.rmdir(run['runId'], dir_fd=parent)
        os.fsync(parent)
    finally:
        os.close(parent)
    durable_unlink(terminal_path(run['runId']))
    return {'version': 1, 'terminalId': run['runId'], 'retired': True}


# 严格解析有界请求、清理 root 环境并核实源码，再按动作取得注册/终端锁并协调身份事务；只允许已校验会话值进入 SSH 负载。
# Parse bounded requests, clean root environment and verify sources before locked identity transactions; only validated session values enter SSH payloads.
def main():
    global SSH_SESSION_ERRORS
    SSH_SESSION_ERRORS = False
    # Only these two SSH values can affect a session. Capture before clearing
    # the root environment; snapshot keys never select the client command.
    original, term = os.environ.get('SSH_ORIGINAL_COMMAND', ''), os.environ.get('TERM')
    if len(sys.argv) != 2 or len(sys.argv[1]) > 131072:
        refuse('REQUEST_BOUND')
    try:
        raw = base64.b64decode(sys.argv[1], validate=True)
        if len(raw) > 98304:
            refuse('REQUEST_BOUND')
        request = json.loads(raw)
    except (ValueError, UnicodeError):
        refuse('REQUEST_JSON')
    # Interactive stdout is protocol only. All refusals stay on stderr.
    SSH_SESSION_ERRORS = isinstance(request, dict) and request.get('action') in ('ssh-session', 'exec-current-session')
    os.environ.clear()
    os.environ.update(CLEAN_ENV)
    if os.getuid() != 0 or os.geteuid() != 0:
        refuse('ROOT_CONTROL_REQUIRED')
    # 把终止信号转为稳定取消拒绝，交由入口清理所持权威资源。
    # Turn termination into a stable cancellation refusal handled by entry-point resource cleanup.
    def interrupted(_signum, _frame):
        refuse('CONTROL_CANCELLED')
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, interrupted)
    if not isinstance(request, dict) or not isinstance(request.get('action'), str):
        refuse('REQUEST_SCHEMA')
    action = request['action']
    allowed = {'install': set(), 'restore-egress': set(), 'ensure': {'projectId', 'directory', 'networkIsolation', 'expected'},
               'inspect': {'projectId'}, 'prepare': {'projectId', 'expected', 'runId'},
               'status': {'projectId', 'expected', 'runId'}, 'stop': {'projectId', 'expected', 'runId'},
               'run': {'projectId', 'expected', 'runId'},
               'run-readonly': {'projectId', 'expected', 'runId'},
               'network': {'projectId', 'expected'},
               'network-readonly': {'projectId', 'expected'},
               'begin-network-release': {'projectId', 'expected', 'releaseId', 'bootId'},
               'release-network': {'projectId', 'expected', 'releaseId', 'network'},
               'rebind': {'projectId', 'expected', 'directory', 'networkIsolation'},
               'exec-current': {'projectId', 'expected', 'runId', 'payloadSha256'},
               'exec-current-session': {'projectId', 'expected', 'runId', 'payloadSha256'},
               'ssh-snapshot': {'projectId', 'expected', 'runId', 'snapshotSha256'},
               'ssh-prepare': {'projectId', 'expected', 'runId', 'snapshotSha256', 'daemon'},
               'ssh-session': {'projectId', 'expected', 'runId', 'snapshotSha256'},
               'terminal-create': {'projectId', 'expected', 'runId', 'name'},
               'terminal-probe': {'projectId', 'expected', 'runId', 'name'},
               'terminal-attach': {'projectId', 'expected', 'runId', 'name', 'readOnly'},
               'terminal-retire': {'projectId', 'expected', 'runId'}}
    if action not in allowed or not set(request).issubset(allowed[action] | {'action'}):
        refuse('REQUEST_SCHEMA')
    if action not in ('install', 'restore-egress'):
        identifier(request.get('projectId'), PROJECT, 'PROJECT_ID')
    if action in ('ssh-snapshot', 'ssh-prepare', 'ssh-session'):
        ssh_request(request)
    build = sources()
    boot = open('/proc/sys/kernel/random/boot_id').read().strip()
    identifier(boot, UUID, 'BOOT_ID')
    snapshot_input = ssh_snapshot_input() if action == 'ssh-snapshot' else None
    readonly = action in ('run-readonly', 'network-readonly', 'terminal-probe', 'terminal-attach', 'ssh-session')
    lock = initialize_readonly() if readonly else initialize()
    args = None
    terminal = None
    ssh = None
    try:
        store = registry(readonly)
        if action == 'install':
            result = {'version': 1, 'build': build, 'registryId': store['registryId'], 'bootId': boot}
        elif action == 'restore-egress':
            result = egress_restore(store)
        elif action == 'ensure':
            if request.get('networkIsolation') == 'private':
                egress_bootstrap(build)
            result = ensure(request, store)
        elif action == 'inspect':
            result = binding_read(request['projectId'], True)
            if result is not None:
                reservation_check(result, store)
                if result['phase'] == 'active':
                    # Discovery may expose a committed binding after a lost
                    # policy ACK. Execution admission still requires the exact
                    # applied egress proof; explicit ensure finishes recovery.
                    result = active(request['projectId'], request, store, False)
        elif action == 'network-readonly':
            if request.get('expected') is None:
                refuse('EXPECTED_IDENTITY_REQUIRED')
            # active verifies the exact account, directory, UID egress table
            # and actual NNP service/process state without applying policy.
            result = network_inspect(active(request['projectId'], request, store), boot)
        elif action in ('prepare', 'exec-current', 'exec-current-session'):
            value = active(request['projectId'], request, store)
            if action in ('exec-current', 'exec-current-session'):
                # Reject metadata before publishing an inherited ticket.
                launch_argv(value, {'runId': identifier(request.get('runId'), UUID, 'RUN_ID')}, request, build)
            result = prepare(value, request, boot, build, action != 'prepare')
            if action in ('exec-current', 'exec-current-session'):
                args = launch_argv(value, result, request, build)
        elif action in ('ssh-snapshot', 'ssh-prepare', 'ssh-session'):
            value = active(request['projectId'], request, store)
            if action == 'ssh-snapshot':
                result = ssh_snapshot(value, request, snapshot_input, boot, build)
            elif action == 'ssh-prepare':
                result = ssh_prepare(value, request, boot, build)
            else:
                run, payload = ssh_session(value, request, boot, build, original, term)
                ssh = (value, run, payload)
        elif action.startswith('terminal-'):
            value = binding_read(request['projectId'])
            reservation_check(value, store)
            expected(value, request)
            run = run_read(identifier(request.get('runId'), UUID, 'RUN_ID'))
            check_run(value, run, boot, action != 'terminal-retire')
            if run['mode'] != 'independent' or (action != 'terminal-retire' and run['build'] != build):
                refuse('TERMINAL_RUN_CHANGED')
            name = None
            if action != 'terminal-retire':
                name = request.get('name')
                if not isinstance(name, str) or not re.fullmatch(
                        'sakura-terminal-' + value['projectId'] + '-[a-z0-9-]{1,48}', name):
                    refuse('TERMINAL_NAME')
            if action == 'terminal-attach' and not isinstance(request.get('readOnly'), bool):
                refuse('REQUEST_SCHEMA')
            # Open/create under the registry lock so retirement cannot miss a
            # preparation which passed admission. Wait outside that lock:
            # native children acquire it independently before dropping UID.
            terminal = (value, run, name, terminal_lock(run['runId'], action == 'terminal-create'))
        elif action in ('status', 'stop', 'run', 'run-readonly'):
            value = binding_read(request['projectId'])
            reservation_check(value, store)
            expected(value, request)
            run_id = identifier(request.get('runId'), UUID, 'RUN_ID')
            partial_ssh = False
            try:
                run = run_read(run_id)
            except Refusal as error:
                if action not in ('run', 'stop') or error.code != 'RECORD_ABSENT':
                    raise
                # Cleanup reads may recover an original pre-ticket receipt.
                # Readonly probes and sessions always require a native ticket.
                run = ssh_cleanup_receipt(value, run_id, boot)
                partial_ssh = True
            check_run(value, run, boot, False)
            if action in ('run', 'run-readonly'):
                if action == 'run-readonly' and run['phase'] == 'active' and run['mode'] == 'inherit-current' and run['cgroupName'] in (
                        'openrc.sakura-ssh-' + value['projectId'], 'system.slice/sakura-ssh-' + value['projectId'] + '.service'):
                    value = active(request['projectId'], request, store)
                    ssh_checked_run(value, run, boot, build)
                result = run
            elif action == 'stop':
                result = stop(value, run, boot, partial_ssh)
            else:
                descriptor = cgroup_fd(run)
                try:
                    result = {'run': run, 'populated': populated(descriptor) if descriptor is not None else False}
                finally:
                    if descriptor is not None:
                        os.close(descriptor)
        elif action == 'rebind':
            value = binding_read(request['projectId'])
            reservation_check(value, store)
            expected(value, request)
            account_check(value)
            home_check(value)
            if request.get('networkIsolation') == 'private':
                egress_bootstrap(build)
            result = rebind(value, request, boot)
        elif action in ('network', 'begin-network-release', 'release-network'):
            value = binding_read(request['projectId'])
            reservation_check(value, store)
            expected(value, request)
            if request.get('expected') is None:
                refuse('EXPECTED_IDENTITY_REQUIRED')
            # Cleanup also covers a reserved account whose directory migration
            # never completed. No project code or account creation happens here.
            if action == 'network':
                result = network_capture(value, boot)
            elif action == 'begin-network-release':
                result = begin_network_release(value, request, boot)
            else:
                result = release_network(value, request, boot, lock)
    finally:
        os.close(lock)
    if args is not None:
        os.execve(args[0], args, CLEAN_ENV)
    if ssh is not None:
        value, run, payload = ssh
        raise SystemExit(ssh_launch(value, run, build, payload))
    if terminal is not None:
        # Launcher entry must not inherit or wait behind our registry lock.
        value, run, name, terminal_descriptor = terminal
        # 幂等关闭本次持有的终端锁 FD，并清空引用防止重复关闭。
        # Idempotently close this terminal-lock FD and clear the reference to avoid double close.
        def release_terminal():
            nonlocal terminal_descriptor
            if terminal_descriptor is not None:
                os.close(terminal_descriptor)
                terminal_descriptor = None
        try:
            terminal_acquire(terminal_descriptor, action in ('terminal-probe', 'terminal-attach'))
            if action == 'terminal-create':
                result = terminal_create(value, run, build, name)
            elif action == 'terminal-retire':
                result = terminal_retire(value, run)
            else:
                if terminal_descriptor is None:
                    refuse('TERMINAL_RECORD_ABSENT')
                record = terminal_state(value, run, name)
                result = terminal_check(value, run, build, record)
                if action == 'terminal-attach':
                    import shlex
                    arguments = [terminal_binary(), '-f', '/dev/null', '-S', TERMINALS + '/' + run['runId'] + '/socket',
                                 'attach-session'] + (['-r'] if request['readOnly'] else []) + ['-t', record['sessionId']]
                    code, _, _ = terminal_launch(value, run, build, 'exec ' + shlex.join(arguments), True, release_terminal)
                    raise SystemExit(code)
        finally:
            release_terminal()
    print(json.dumps({'ok': True, 'result': result}, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Refusal as error:
        print(json.dumps({'ok': False, 'code': error.code, 'detail': error.detail}, separators=(',', ':')),
              file=sys.stderr if SSH_SESSION_ERRORS else sys.stdout)
        sys.exit(1)
    except (OSError, ValueError, KeyError, TypeError, struct.error):
        print('{"ok":false,"code":"CONTROL_STATE_INVALID","detail":null}',
              file=sys.stderr if SSH_SESSION_ERRORS else sys.stdout)
        sys.exit(1)
