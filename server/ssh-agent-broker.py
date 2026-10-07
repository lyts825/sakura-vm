# 模块职责：核验客户机 SSH Agent 转发的账户、socket 和原运行归属，按原票据准备及清理代理。
# Module purpose: Verifies guest SSH Agent account/socket/original run ownership before preparing or cleaning the proxy by original ticket.
"""Fixed root controller; project command bytes never enter this process.

SO_PEERCRED authenticates the connector, not a later recipient of a passed FD.
An authorized application can deliberately relay requests; this is not a
security boundary against cooperation between processes with the same UID.
"""
import base64
import errno
import fcntl
import json
import os
import re
import select
import signal
import socket
import stat
import struct
import sys
import threading
import time
import uuid

ROOT = '/run/sakura-agent-forwards'
SOCKETS = '/run/sakura-agent-sockets'
RECORDS = ROOT + '/records'
MAX_FRAME = 262144
MAX_CONNECTIONS = 8
MAX_REQUESTS = 128
MAX_SESSION_BYTES = 8 * 1024 * 1024
FLAGS = os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK


class Refused(Exception):
    pass


# 入口 / Entry: require.
# 功能：不满足核验条件时抛出指定拒绝码，终止对当前资源的操作。
# Purpose: Raises the requested refusal code when a verification condition fails, ending work on the current resource.
# 输入 / Inputs: condition; code
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 拒绝 / Refusals: `Refused(code)`.
def require(condition, code):
    if not condition:
        raise Refused(code)


# 入口 / Entry: identifier.
# 功能：核验规范 UUID 字符串，拒绝非规范标识和无效类型。
# Purpose: Validates a canonical UUID string, rejecting noncanonical identifiers and invalid types.
# 输入 / Inputs: value
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 核验 / Required checks: `isinstance(value, str) and str(uuid.UUID(value)) == value -> 'CONTEXT_INVALID'`.
def identifier(value):
    require(isinstance(value, str) and str(uuid.UUID(value)) == value, 'CONTEXT_INVALID')


# 同时核对任务、账号修订和代理构建摘要；只知道 socket 路径不足以获得原任务的 Agent 权限。
# 入口 / Entry: context_checked.
# 功能：验证资源租约、项目账户修订、任务 boot 与代理摘要的完整票据。
# Purpose: Validates the full ticket binding resource lease, project-account revision, task boot and broker digest.
# 输入 / Inputs: value
# 输出 / Returns: `value`
# 副作用 / Effects: 调用 / calls `set`, `identity['identityId'].replace`.
# 核验 / Required checks: `set(value) == {'resource', 'identity', 'owner', 'sha256'} -> 'CONTEXT_INVALID'`; `set(resource) == {'version', 'kind', 'leaseId', 'brokerSha256', 'timeoutSeconds'} -> 'CONTEXT_INVALID'`; `resource['version'] == 1 and resource['kind'] == 'ssh-agent' -> 'CONTEXT_INVALID'`; `set(owner) == {'kind', 'runId', 'bootId'} and owner['kind'] == 'task' -> 'CONTEXT_INVALID'`; `type(resource['timeoutSeconds']) is int and 1 <= resource['timeoutSeconds'] <= 300 -> 'CONTEXT_INVALID'`.
def context_checked(value):
    require(set(value) == {'resource', 'identity', 'owner', 'sha256'}, 'CONTEXT_INVALID')
    resource, identity, owner = value['resource'], value['identity'], value['owner']
    require(set(resource) == {'version', 'kind', 'leaseId', 'brokerSha256', 'timeoutSeconds'}, 'CONTEXT_INVALID')
    require(resource['version'] == 1 and resource['kind'] == 'ssh-agent', 'CONTEXT_INVALID')
    identifier(resource['leaseId']); identifier(owner['runId']); identifier(owner['bootId'])
    require(set(owner) == {'kind', 'runId', 'bootId'} and owner['kind'] == 'task', 'CONTEXT_INVALID')
    require(type(resource['timeoutSeconds']) is int and 1 <= resource['timeoutSeconds'] <= 300, 'CONTEXT_INVALID')
    require(re.fullmatch('[a-f0-9]{64}', resource['brokerSha256']) and re.fullmatch('[a-f0-9]{64}', value['sha256']), 'CONTEXT_INVALID')
    required = {'version', 'phase', 'registryId', 'projectId', 'identityId', 'revision', 'account', 'uid', 'gid',
                'home', 'directory', 'directoryDevice', 'directoryInode', 'homeDevice', 'homeInode', 'networkIsolation'}
    require(set(identity) == required and identity['version'] == 1 and identity['phase'] == 'active', 'CONTEXT_INVALID')
    identifier(identity['registryId']); identifier(identity['identityId'])
    require(identity['projectId'] == 'default' or re.fullmatch('[a-f0-9]{16}', identity['projectId']), 'CONTEXT_INVALID')
    require(type(identity['uid']) is int and 20000 <= identity['uid'] <= 59999 and identity['gid'] == identity['uid'], 'CONTEXT_INVALID')
    require(identity['account'] == 'skp' + identity['identityId'].replace('-', '')[:24] and
            identity['home'] == '/var/lib/sakura-project-homes/' + identity['identityId'], 'CONTEXT_INVALID')
    require(type(identity['revision']) is int and identity['revision'] > 0 and identity['networkIsolation'] in ['host', 'private'], 'CONTEXT_INVALID')
    for key in ['directoryDevice', 'directoryInode', 'homeDevice', 'homeInode']:
        require(isinstance(identity[key], str) and re.fullmatch('0|[1-9][0-9]*', identity[key]), 'CONTEXT_INVALID')
    return value


# 入口 / Entry: boot.
# 功能：读取并验证客户机内核 boot_id，供任务归属和跨重启清理核对。
# Purpose: Reads and validates the kernel boot_id for task ownership and cross-reboot cleanup checks.
# 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
# 输出 / Returns: `value`
# 副作用 / Effects: 调用 / calls `open`, `source.read(64).strip`, `source.read`.
def boot():
    with open('/proc/sys/kernel/random/boot_id', encoding='ascii') as source:
        value = source.read(64).strip()
    identifier(value)
    return value


# 入口 / Entry: info.
# 功能：把 stat 结果转为设备、inode、账户、权限及文件类型的可持久身份。
# Purpose: Converts stat metadata into a durable identity containing device, inode, account, mode and file type.
# 输入 / Inputs: value
# 输出 / Returns: `{'device': str(value.st_dev), 'inode': str(value.st_ino), 'uid': value.st_uid, 'gid': value.st_gid, 'mode': stat.S_IMODE(value.st_mode), 'type': stat.S_IFM…`
def info(value):
    return {'device': str(value.st_dev), 'inode': str(value.st_ino), 'uid': value.st_uid,
            'gid': value.st_gid, 'mode': stat.S_IMODE(value.st_mode), 'type': stat.S_IFMT(value.st_mode)}


# root 控制目录逐级固定为目录 FD，并核对所有者及权限，避免项目账户替换中间路径。
# 入口 / Entry: directory.
# 功能：逐级以目录 FD 打开绝对路径并核验 root 归属与权限，可仅创建允许的末级目录。
# Purpose: Opens an absolute path through directory FDs while checking root ownership/modes, optionally creating only its permitted final directory.
# 输入 / Inputs: path; mode=None; gid=0; create=False; source=False
# 输出 / Returns: `current`
# 副作用 / Effects: 调用 / calls `os.open`, `os.mkdir`, `os.fsync`, `os.close`.
# 核验 / Required checks: `path.startswith('/') and all((part not in ['', '.', '..'] for part in path.split('/')[1:])) -> 'PATH_INVALID'`; `create and prefix == path -> 'DIRECTORY_ABSENT'`; `stat.S_ISDIR(value.st_mode) and value.st_uid == 0 -> 'DIRECTORY_OWNER'`; `value.st_gid == 0 and stat.S_IMODE(value.st_mode) == 1023 -> 'SOURCE_PARENT'`; `value.st_gid == gid and stat.S_IMODE(value.st_mode) == mode -> 'DIRECTORY_OWNER'`.
# 拒绝 / Refusals: `re-raise`.
def directory(path, mode=None, gid=0, create=False, source=False):
    require(path.startswith('/') and all(part not in ['', '.', '..'] for part in path.split('/')[1:]), 'PATH_INVALID')
    current = os.open('/', os.O_RDONLY | os.O_DIRECTORY | FLAGS)
    try:
        prefix = ''
        for part in path.split('/')[1:]:
            prefix += '/' + part
            try:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=current)
            except FileNotFoundError:
                require(create and prefix == path, 'DIRECTORY_ABSENT')
                os.mkdir(part, 0o700 if mode is None else mode, dir_fd=current)
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=current)
                os.fsync(current)
            os.close(current); current = child
            value = os.fstat(current)
            require(stat.S_ISDIR(value.st_mode) and value.st_uid == 0, 'DIRECTORY_OWNER')
            if source and prefix in ['/tmp', '/var/tmp']:
                require(value.st_gid == 0 and stat.S_IMODE(value.st_mode) == 0o1777, 'SOURCE_PARENT')
            elif prefix == path and mode is not None:
                require(value.st_gid == gid and stat.S_IMODE(value.st_mode) == mode, 'DIRECTORY_OWNER')
            else:
                require(value.st_gid == 0 and not stat.S_IMODE(value.st_mode) & 0o022, 'DIRECTORY_OWNER')
        return current
    except BaseException:
        os.close(current)
        raise


# 入口 / Entry: regular.
# 功能：读取 root 私有的有界单链接普通记录文件，并核验读取前后的物理身份。
# Purpose: Reads a bounded root-private single-link regular record and checks its physical identity before and after reading.
# 输入 / Inputs: parent; name; size=65536
# 输出 / Returns: `data`
# 副作用 / Effects: 调用 / calls `os.open`, `os.read`, `os.close`.
# 核验 / Required checks: `stat.S_ISREG(value.st_mode) and value.st_uid == 0 and (value.st_gid == 0) and (value.st_nlink == 1) and (stat.S_IMODE(value.s… -> 'RECORD_OWNER'`; `len(data) == value.st_size and (not os.read(fd, 1)) and (info(os.fstat(fd)) == info(value)) -> 'RECORD_CHANGED'`.
# 收尾 / Finalization: `os.close(fd)`.
def regular(parent, name, size=65536):
    fd = os.open(name, os.O_RDONLY | FLAGS, dir_fd=parent)
    try:
        value = os.fstat(fd)
        require(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and value.st_gid == 0 and
                value.st_nlink == 1 and stat.S_IMODE(value.st_mode) == 0o600 and value.st_size <= size, 'RECORD_OWNER')
        data = os.read(fd, size + 1)
        require(len(data) == value.st_size and not os.read(fd, 1) and info(os.fstat(fd)) == info(value), 'RECORD_CHANGED')
        return data
    finally:
        os.close(fd)


# 入口 / Entry: record_name.
# 功能：从租约 UUID 派生控制记录文件名，不使用项目提供的任意路径。
# Purpose: Derives the control-record filename from the lease UUID rather than a project-provided arbitrary path.
# 输入 / Inputs: context
# 输出 / Returns: `context['resource']['leaseId'] + '.json'`
def record_name(context):
    return context['resource']['leaseId'] + '.json'


# 入口 / Entry: recorded_object.
# 功能：验证持久化文件身份字段的完整形状、数值类型和权限范围。
# Purpose: Validates the complete shape, numeric types and mode bounds of a persisted filesystem identity.
# 输入 / Inputs: value
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `set`.
# 核验 / Required checks: `isinstance(value, dict) and set(value) == {'device', 'inode', 'uid', 'gid', 'mode', 'type'} -> 'RECORD_INVALID'`; `isinstance(value[name], str) and re.fullmatch('0|[1-9][0-9]*', value[name]) -> 'RECORD_INVALID'`; `all((type(value[name]) is int for name in ['uid', 'gid', 'mode', 'type'])) and min(value['uid'], value['gid']) >= 0 and (0 <=… -> 'RECORD_INVALID'`.
def recorded_object(value):
    require(isinstance(value, dict) and set(value) == {'device', 'inode', 'uid', 'gid', 'mode', 'type'}, 'RECORD_INVALID')
    for name in ['device', 'inode']:
        require(isinstance(value[name], str) and re.fullmatch('0|[1-9][0-9]*', value[name]), 'RECORD_INVALID')
    require(all(type(value[name]) is int for name in ['uid', 'gid', 'mode', 'type']) and
            min(value['uid'], value['gid']) >= 0 and 0 <= value['mode'] <= 0o7777, 'RECORD_INVALID')


# 入口 / Entry: recorded_process.
# 功能：验证原进程 PID 与启动 ticks，保留区分 PID 重用所需的出生证据。
# Purpose: Validates original PID/start ticks, retaining the birth evidence needed to distinguish PID reuse.
# 输入 / Inputs: value
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `set`.
# 核验 / Required checks: `isinstance(value, dict) and set(value) == {'pid', 'startTicks'} and (type(value['pid']) is int) and (value['pid'] > 1) and is… -> 'RECORD_INVALID'`.
def recorded_process(value):
    require(isinstance(value, dict) and set(value) == {'pid', 'startTicks'} and
            type(value['pid']) is int and value['pid'] > 1 and isinstance(value['startTicks'], str) and
            re.fullmatch('0|[1-9][0-9]*', value['startTicks']), 'RECORD_INVALID')


# 入口 / Entry: record_checked.
# 功能：核对持久记录的票据、阶段及所记录物理对象，拒绝错配或不完整的 ready 证明。
# Purpose: Checks a durable record's ticket, phase and physical objects, rejecting mismatched or incomplete readiness evidence.
# 输入 / Inputs: value; context
# 输出 / Returns: `value`
# 副作用 / Effects: 调用 / calls `set`.
# 核验 / Required checks: `isinstance(value, dict) and set(value) == {'version', 'context', 'phase', 'scope', 'source', 'endpointDirectory', 'endpoint',… -> 'RECORD_INVALID'`; `value['version'] == 1 and value['context'] == context and (value['phase'] in ['preparing', 'ready', 'failed', 'closed']) -> 'RECORD_CHANGED'`; `isinstance(scope, dict) and set(scope) == {'device', 'inode', 'controlToken'} -> 'RECORD_INVALID'`; `isinstance(scope[name], str) and re.fullmatch('0|[1-9][0-9]*', scope[name]) -> 'RECORD_INVALID'`; `isinstance(source, dict) and set(source) == {'path', 'parent', 'socket', 'peer'} and isinstance(source['path'], str) and sour… -> 'RECORD_INVALID'`.
def record_checked(value, context):
    require(isinstance(value, dict) and set(value) == {'version', 'context', 'phase', 'scope', 'source', 'endpointDirectory', 'endpoint', 'broker', 'failure'}, 'RECORD_INVALID')
    require(value['version'] == 1 and value['context'] == context and
            value['phase'] in ['preparing', 'ready', 'failed', 'closed'], 'RECORD_CHANGED')
    scope = value['scope']
    require(isinstance(scope, dict) and set(scope) == {'device', 'inode', 'controlToken'}, 'RECORD_INVALID')
    identifier(scope['controlToken'])
    for name in ['device', 'inode']:
        require(isinstance(scope[name], str) and re.fullmatch('0|[1-9][0-9]*', scope[name]), 'RECORD_INVALID')
    source = value['source']
    if source is not None:
        require(isinstance(source, dict) and set(source) == {'path', 'parent', 'socket', 'peer'} and
                isinstance(source['path'], str) and source['path'].startswith('/') and
                0 < len(source['path'].encode()) < 108 and not re.search('[\x00-\x20\x7f]', source['path']), 'RECORD_INVALID')
        recorded_object(source['parent']); recorded_object(source['socket']); recorded_process(source['peer'])
    for name in ['endpointDirectory', 'endpoint']:
        if value[name] is not None: recorded_object(value[name])
    if value['broker'] is not None: recorded_process(value['broker'])
    require(value['failure'] is None or (isinstance(value['failure'], str) and
            re.fullmatch('[A-Z][A-Z0-9_]{0,79}', value['failure'])), 'RECORD_INVALID')
    require(value['phase'] != 'ready' or (all(value[name] is not None for name in
            ['source', 'endpointDirectory', 'endpoint', 'broker']) and value['failure'] is None), 'RECORD_INVALID')
    return value


# 入口 / Entry: read_record.
# 功能：安全读取本租约控制记录，仅在记录确实缺失时返回 None。
# Purpose: Safely reads this lease's control record, returning None only when the record is genuinely absent.
# 输入 / Inputs: context
# 输出 / Returns: `None`; `record_checked(value, context)`
# 副作用 / Effects: 调用 / calls `os.close`.
# 收尾 / Finalization: `os.close(parent)`.
def read_record(context):
    if not os.path.lexists(RECORDS):
        return None
    parent = directory(RECORDS, 0o700)
    try:
        try:
            value = json.loads(regular(parent, record_name(context)).decode('utf-8'))
        except FileNotFoundError:
            return None
        return record_checked(value, context)
    finally:
        os.close(parent)


# 入口 / Entry: save_record.
# 功能：在 root 控制目录持久发布阶段记录，替换前拒绝不同 context 的原记录。
# Purpose: Durably publishes a phase record in the root control directory, refusing an original record with a different context before replacement.
# 输入 / Inputs: value
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `os.open`, `os.fdopen`, `target.write`, `os.fsync`, `read_record`, `os.rename`.
# 核验 / Required checks: `prior is None or prior['context'] == value['context'] -> 'RECORD_CHANGED'`.
# 设计：临时文件与目标位于同一已核验目录；落盘后 rename 提交，目录 fsync 记录发布，finally 关闭目录 FD；写入失败不能视作提交成功。
# Design: Temporary and target files share the checked directory; rename commits after file flush, directory fsync records publication and finally closes the directory FD; a write failure is never treated as a successful commit.
# 收尾 / Finalization: `os.close(parent)`.
def save_record(value):
    parent = directory(RECORDS, 0o700)
    name = '.write-' + str(uuid.uuid4())
    try:
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | FLAGS, 0o600, dir_fd=parent)
        with os.fdopen(fd, 'wb') as target:
            target.write(json.dumps(value, separators=(',', ':')).encode('utf-8'))
            target.flush(); os.fsync(target.fileno())
        # A root-only directory and the checked existing context prevent an
        # unrelated resource from being replaced by this phase transition.
        prior = read_record(value['context'])
        require(prior is None or prior['context'] == value['context'], 'RECORD_CHANGED')
        os.rename(name, record_name(value['context']), src_dir_fd=parent, dst_dir_fd=parent)
        os.fsync(parent)
    finally:
        os.close(parent)


# 入口 / Entry: locked.
# 功能：核验 root 私有控制目录和锁文件，取得跨进程独占 flock 并返回由调用方关闭的锁 FD。
# Purpose: Checks root-private control directories and lock file, acquires an exclusive cross-process flock and returns the lock FD for caller disposal.
# 输入 / Inputs: create=False
# 输出 / Returns: `fd`
# 副作用 / Effects: 调用 / calls `os.close`, `os.open`, `fcntl.flock`.
# 核验 / Required checks: `stat.S_ISREG(value.st_mode) and value.st_uid == 0 and (value.st_gid == 0) and (value.st_nlink == 1) and (stat.S_IMODE(value.s… -> 'LOCK_OWNER'`.
# 收尾 / Finalization: `os.close(parent)`.
def locked(create=False):
    os.close(directory('/run'))
    os.close(directory(ROOT, 0o700, create=create))
    os.close(directory(RECORDS, 0o700, create=create))
    parent = directory(ROOT, 0o700)
    try:
        fd = os.open('resources.lock', os.O_RDWR | (os.O_CREAT if create else 0) | FLAGS, 0o600, dir_fd=parent)
        value = os.fstat(fd)
        require(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and value.st_gid == 0 and
                value.st_nlink == 1 and stat.S_IMODE(value.st_mode) == 0o600, 'LOCK_OWNER')
        fcntl.flock(fd, fcntl.LOCK_EX)
        return fd
    finally:
        os.close(parent)


# 入口 / Entry: scope_path.
# 功能：从原任务 runId 派生固定 cgroup 路径，作为任务归属核对入口。
# Purpose: Derives the fixed cgroup path from the original task runId for task-ownership checks.
# 输入 / Inputs: context
# 输出 / Returns: `'/sys/fs/cgroup/sakura-task-' + context['owner']['runId']`
def scope_path(context):
    return '/sys/fs/cgroup/sakura-task-' + context['owner']['runId']


# 入口 / Entry: task_scope.
# 功能：核对 boot、cgroup2、任务记录和 cgroup inode，返回目录 FD 及不可替换的控制票据。
# Purpose: Checks boot, cgroup2, task records and cgroup inode, returning a directory FD and a pinned control ticket.
# 输入 / Inputs: context
# 输出 / Returns: `(fd, {'device': str(value.st_dev), 'inode': str(value.st_ino), 'controlToken': owner[1]})`
# 副作用 / Effects: 调用 / calls `open`, `os.close`, `regular(parent, '.sakura-job-' + context['owner']['runId'] + '.pid.scope', 256).decode('ascii').split`, `regular(parent, '.sakura-job-' + context['owner']['runId'] + '.pid.scope', 256).decode`.
# 核验 / Required checks: `boot() == context['owner']['bootId'] -> 'BOOT_CHANGED'`; `any((line.split()[4] == '/sys/fs/cgroup' and ' - cgroup2 ' in line for line in mounts)) -> 'CGROUP_UNAVAILABLE'`; `len(ownership) == 4 and ownership[:3] == ['2', context['owner']['bootId'], 'sakura-task-' + context['owner']['runId']] -> 'TASK_OWNER'`; `len(owner) == 3 and owner[0] == '1' and (owner[2] == context['owner']['bootId']) -> 'TASK_OWNER'`; `str(value.st_ino) == ownership[3] -> 'CGROUP_CHANGED'`.
# 收尾 / Finalization: `os.close(parent)`.
def task_scope(context):
    require(boot() == context['owner']['bootId'], 'BOOT_CHANGED')
    with open('/proc/self/mountinfo', encoding='ascii') as mounts:
        require(any(line.split()[4] == '/sys/fs/cgroup' and ' - cgroup2 ' in line for line in mounts), 'CGROUP_UNAVAILABLE')
    parent = directory('/run/sakura-guest-tasks', 0o700)
    os.close(parent)
    parent = directory('/run/sakura-guest-tasks/' + context['owner']['runId'], 0o700)
    try:
        ownership = regular(parent, '.sakura-job-' + context['owner']['runId'] + '.pid.scope', 256).decode('ascii').split()
        owner = regular(parent, 'owner', 256).decode('ascii').split()
        require(len(ownership) == 4 and ownership[:3] == ['2', context['owner']['bootId'], 'sakura-task-' + context['owner']['runId']], 'TASK_OWNER')
        require(len(owner) == 3 and owner[0] == '1' and owner[2] == context['owner']['bootId'], 'TASK_OWNER')
        identifier(owner[1])
    finally:
        os.close(parent)
    fd = directory(scope_path(context))
    value = os.fstat(fd)
    require(str(value.st_ino) == ownership[3], 'CGROUP_CHANGED')
    return fd, {'device': str(value.st_dev), 'inode': str(value.st_ino), 'controlToken': owner[1]}


class Process:
    # 入口 / Entry: Process.__init__.
    # 功能：固定原进程的 pidfd、proc 目录和启动 ticks，防止后续仅凭 PID 接管新进程。
    # Purpose: Pins the original process pidfd, proc directory and start ticks to prevent later adoption of a replacement process by PID alone.
    # 输入 / Inputs: pid
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `os.pidfd_open`, `os.open`, `self.read('stat', 4096).rsplit(b') ', 1)[1].split`, `self.read('stat', 4096).rsplit`, `self.read`, `self.close`; 更新 / updates `self.pid`, `self.pidfd`, `self.directory`, `self.start`.
    # 核验 / Required checks: `len(fields) >= 20 and fields[19].isdigit() -> 'PROCESS_INVALID'`.
    # 拒绝 / Refusals: `re-raise`.
    def __init__(self, pid):
        self.pid = pid
        self.pidfd = None; self.directory = None
        try:
            self.pidfd = os.pidfd_open(pid, 0)
            self.directory = os.open('/proc/' + str(pid), os.O_RDONLY | os.O_DIRECTORY | FLAGS)
            fields = self.read('stat', 4096).rsplit(b') ', 1)[1].split()
            require(len(fields) >= 20 and fields[19].isdigit(), 'PROCESS_INVALID')
            self.start = fields[19].decode('ascii')
            self.alive()
        except BaseException:
            self.close()
            raise

    # 入口 / Entry: Process.close.
    # 功能：关闭本对象持有的 proc 目录及 pidfd，先清空字段使重复调用安全。
    # Purpose: Closes the owned proc-directory and pidfd handles, clearing fields first so repeated disposal is safe.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `setattr`, `os.close`.
    def close(self):
        for name in ['directory', 'pidfd']:
            value = getattr(self, name, None)
            if value is not None:
                setattr(self, name, None); os.close(value)

    # 入口 / Entry: Process.read.
    # 功能：通过固定 proc 目录读取指定有界条目，并在退出路径关闭临时 FD。
    # Purpose: Reads a bounded proc entry through the pinned directory and closes its temporary FD on every exit.
    # 输入 / Inputs: name; limit
    # 输出 / Returns: `value`
    # 副作用 / Effects: 调用 / calls `os.open`, `os.read`, `os.close`.
    # 核验 / Required checks: `len(value) <= limit -> 'PROCESS_INVALID'`.
    # 收尾 / Finalization: `os.close(fd)`.
    def read(self, name, limit):
        fd = os.open(name, os.O_RDONLY | FLAGS, dir_fd=self.directory)
        try:
            value = os.read(fd, limit + 1)
            require(len(value) <= limit, 'PROCESS_INVALID')
            return value
        finally:
            os.close(fd)

    # 入口 / Entry: Process.alive.
    # 功能：通过 pidfd 与启动 ticks 检查原进程仍活着且未成为僵尸或被 PID 重用替代。
    # Purpose: Checks via pidfd and start ticks that the original process is alive, not a zombie or a PID-reuse replacement.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `self.read('stat', 4096).rsplit(b') ', 1)[1].split`, `self.read('stat', 4096).rsplit`, `self.read`.
    # 核验 / Required checks: `not select.select([self.pidfd], [], [], 0)[0] -> 'PROCESS_EXITED'`; `len(fields) >= 20 and fields[0] != b'Z' and (fields[19].decode('ascii') == self.start) -> 'PROCESS_CHANGED'`.
    def alive(self):
        require(not select.select([self.pidfd], [], [], 0)[0], 'PROCESS_EXITED')
        fields = self.read('stat', 4096).rsplit(b') ', 1)[1].split()
        require(len(fields) >= 20 and fields[0] != b'Z' and fields[19].decode('ascii') == self.start, 'PROCESS_CHANGED')

    # 入口 / Entry: Process.task.
    # 功能：核对连接进程的项目 UID/GID、无特权状态和原任务 cgroup，重查 boot 及 cgroup 物理身份。
    # Purpose: Checks the peer's project UID/GID, unprivileged state and original task cgroup, then rechecks boot and the cgroup's physical identity.
    # 输入 / Inputs: context; scope
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `self.read('status', 65536).splitlines`, `self.read`, `('0::/sakura-task-' + context['owner']['runId']).encode`, `self.read('cgroup', 4096).splitlines`, `os.close`.
    # 核验 / Required checks: `values.get(b'Uid', b'').split() == [str(identity['uid']).encode()] * 4 and values.get(b'Gid', b'').split() == [str(identity['… -> 'PEER_ACCOUNT'`; `values.get(b'NoNewPrivs', b'').strip() == b'1' and int(values.get(b'CapEff', b'1').strip(), 16) == 0 -> 'PEER_PRIVILEGES'`; `self.read('cgroup', 4096).splitlines() == [expected] -> 'PEER_SCOPE'`; `boot() == context['owner']['bootId'] -> 'BOOT_CHANGED'`; `str(value.st_dev) == scope['device'] and str(value.st_ino) == scope['inode'] -> 'CGROUP_CHANGED'`.
    # 收尾 / Finalization: `os.close(fd)`.
    def task(self, context, scope):
        self.alive()
        values = dict(line.split(b':', 1) for line in self.read('status', 65536).splitlines() if b':' in line)
        identity = context['identity']
        require(values.get(b'Uid', b'').split() == [str(identity['uid']).encode()] * 4 and
                values.get(b'Gid', b'').split() == [str(identity['gid']).encode()] * 4, 'PEER_ACCOUNT')
        require(values.get(b'NoNewPrivs', b'').strip() == b'1' and int(values.get(b'CapEff', b'1').strip(), 16) == 0, 'PEER_PRIVILEGES')
        expected = ('0::/sakura-task-' + context['owner']['runId']).encode()
        require(self.read('cgroup', 4096).splitlines() == [expected], 'PEER_SCOPE')
        self.alive()
        require(boot() == context['owner']['bootId'], 'BOOT_CHANGED')
        fd = directory(scope_path(context))
        try:
            value = os.fstat(fd)
            require(str(value.st_dev) == scope['device'] and str(value.st_ino) == scope['inode'], 'CGROUP_CHANGED')
        finally:
            os.close(fd)


# 入口 / Entry: credentials.
# 功能：读取 Unix socket 的 SO_PEERCRED，得到实际连接者 PID、UID 和 GID。
# Purpose: Reads SO_PEERCRED from a Unix socket to obtain the connecting process PID, UID and GID.
# 输入 / Inputs: stream
# 输出 / Returns: `struct.unpack('3i', stream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))`
def credentials(stream):
    return struct.unpack('3i', stream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))


class Source:
    # 入口 / Entry: Source.__init__.
    # 功能：固定原 root 来源 socket、父目录和实际服务进程，所有后续连接沿用这份物理证据。
    # Purpose: Pins the original root source socket, parent directory and serving process so all later connections use that physical evidence.
    # 输入 / Inputs: path
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `self.connect_raw`, `probe.close`, `self.close`; 更新 / updates `self.path`, `self.parent`, `self.peer`, `self.parent_info`.
    # 核验 / Required checks: `isinstance(path, str) and 0 < len(path.encode()) < 108 and (not re.search('[\x00- \x7f]', path)) -> 'SOURCE_INVALID'`; `self.socket_info['type'] == stat.S_IFSOCK and self.socket_info['uid'] == 0 and (self.socket_info['gid'] == 0) -> 'SOURCE_OWNER'`; `pid > 1 and uid == 0 and (gid == 0) -> 'SOURCE_PEER'`.
    # 拒绝 / Refusals: `re-raise`.
    # 收尾 / Finalization: `probe.close()`.
    def __init__(self, path):
        require(isinstance(path, str) and 0 < len(path.encode()) < 108 and not re.search('[\x00-\x20\x7f]', path), 'SOURCE_INVALID')
        self.path = path
        self.parent_path, self.name = path.rsplit('/', 1)
        self.parent = None; self.peer = None
        try:
            self.parent = directory(self.parent_path, 0o700, source=True)
            self.parent_info = info(os.fstat(self.parent))
            self.socket_info = self.current()
            # Older sshd creates this listener with its inherited umask. The
            # root0700 parent controls access; never chmod sshd's socket. Pin
            # its complete metadata, including mode, for every later check.
            require(self.socket_info['type'] == stat.S_IFSOCK and self.socket_info['uid'] == 0 and
                    self.socket_info['gid'] == 0, 'SOURCE_OWNER')
            probe = self.connect_raw()
            try:
                pid, uid, gid = credentials(probe)
                require(pid > 1 and uid == 0 and gid == 0, 'SOURCE_PEER')
                self.peer = Process(pid)
            finally:
                probe.close()
            self.check()
        except BaseException:
            self.close()
            raise

    # 入口 / Entry: Source.close.
    # 功能：关闭来源父目录与原进程句柄，不删除 sshd 所拥有的 socket。
    # Purpose: Closes source-parent and original-process handles without deleting the socket owned by sshd.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `os.close`, `self.peer.close`; 更新 / updates `self.parent`, `self.peer`.
    def close(self):
        if self.parent is not None: os.close(self.parent); self.parent = None
        if self.peer is not None: self.peer.close(); self.peer = None

    # 入口 / Entry: Source.current.
    # 功能：从固定父目录读取来源 socket 的当前非跟随链接元数据。
    # Purpose: Reads current non-following-link metadata of the source socket through its pinned parent.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: `info(os.stat(self.name, dir_fd=self.parent, follow_symlinks=False))`
    def current(self):
        return info(os.stat(self.name, dir_fd=self.parent, follow_symlinks=False))

    # 入口 / Entry: Source.check.
    # 功能：重新打开并核对来源父目录和 socket 身份，再核验原服务进程仍活着。
    # Purpose: Reopens/checks source-parent and socket identities, then verifies that the original serving process is still alive.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `os.close`.
    # 核验 / Required checks: `info(os.fstat(fd)) == self.parent_info and self.current() == self.socket_info -> 'SOURCE_REPLACED'`.
    # 收尾 / Finalization: `os.close(fd)`.
    def check(self):
        fd = directory(self.parent_path, 0o700, source=True)
        try:
            require(info(os.fstat(fd)) == self.parent_info and self.current() == self.socket_info, 'SOURCE_REPLACED')
        finally:
            os.close(fd)
        self.peer.alive()

    # 入口 / Entry: Source.connect_raw.
    # 功能：通过固定目录 FD 的 proc 路径连接原 socket，连接失败立即关闭新 stream。
    # Purpose: Connects to the original socket through the pinned directory's proc path and closes the new stream immediately on failure.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: `stream`
    # 副作用 / Effects: 调用 / calls `stream.settimeout`, `stream.connect`, `stream.close`.
    # 拒绝 / Refusals: `re-raise`.
    def connect_raw(self):
        stream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        stream.settimeout(3)
        try:
            stream.connect('/proc/self/fd/' + str(self.parent) + '/' + self.name)
            return stream
        except BaseException:
            stream.close()
            raise

    # 入口 / Entry: Source.connect.
    # 功能：在连接前后核对来源证据及实际 peer 凭证，只返回仍属于原服务进程的 stream。
    # Purpose: Checks source evidence and actual peer credentials around connection, returning only a stream still owned by the original serving process.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: `stream`
    # 副作用 / Effects: 调用 / calls `self.connect_raw`, `stream.close`.
    # 核验 / Required checks: `credentials(stream) == (self.peer.pid, 0, 0) -> 'SOURCE_PEER_CHANGED'`.
    # 拒绝 / Refusals: `re-raise`.
    def connect(self):
        self.check()
        stream = self.connect_raw()
        try:
            require(credentials(stream) == (self.peer.pid, 0, 0), 'SOURCE_PEER_CHANGED')
            self.check()
            return stream
        except BaseException:
            stream.close()
            raise

    # 入口 / Entry: Source.record.
    # 功能：导出来源路径、父目录、socket 身份和原服务进程启动证明供持久记录使用。
    # Purpose: Exports source path, parent/socket identities and original serving-process birth evidence for durable records.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: `{'path': self.path, 'parent': self.parent_info, 'socket': self.socket_info, 'peer': {'pid': self.peer.pid, 'startTicks': self.peer.start}}`
    def record(self):
        return {'path': self.path, 'parent': self.parent_info, 'socket': self.socket_info,
                'peer': {'pid': self.peer.pid, 'startTicks': self.peer.start}}


# 入口 / Entry: exact_read.
# 功能：在截止时间和反复归属检查下读取精确字节数，EOF 或超时拒绝。
# Purpose: Reads an exact byte count under deadline and repeated ownership checks, refusing EOF or timeout.
# 输入 / Inputs: stream; size; deadline; check
# 输出 / Returns: `bytes(data)`
# 副作用 / Effects: 调用 / calls `stream.settimeout`, `stream.recv`.
# 核验 / Required checks: `remaining > 0 -> 'PROTOCOL_TIMEOUT'`; `piece -> 'PROTOCOL_CLOSED'`.
def exact_read(stream, size, deadline, check):
    data = bytearray()
    while len(data) < size:
        check()
        remaining = deadline - time.monotonic()
        require(remaining > 0, 'PROTOCOL_TIMEOUT')
        stream.settimeout(min(remaining, 1))
        try:
            piece = stream.recv(min(65536, size - len(data)))
        except socket.timeout:
            continue
        require(piece, 'PROTOCOL_CLOSED')
        data.extend(piece)
    check()
    return bytes(data)


# 入口 / Entry: frame.
# 功能：读取并校验 SSH Agent 的四字节长度帧，拒绝空帧和超预算正文。
# Purpose: Reads/checks a four-byte-length SSH Agent frame, rejecting empty frames or oversized payloads.
# 输入 / Inputs: stream; deadline; check
# 输出 / Returns: `header + exact_read(stream, length, deadline, check)`
# 副作用 / Effects: 调用 / calls `exact_read`.
# 核验 / Required checks: `1 <= length <= MAX_FRAME -> 'PROTOCOL_SIZE'`.
def frame(stream, deadline, check):
    header = exact_read(stream, 4, deadline, check)
    length = struct.unpack('!I', header)[0]
    require(1 <= length <= MAX_FRAME, 'PROTOCOL_SIZE')
    return header + exact_read(stream, length, deadline, check)


# 入口 / Entry: exact_send.
# 功能：在截止时间和归属检查下发送全部数据，处理短写并拒绝断开连接。
# Purpose: Sends all bytes under deadline and ownership checks, handling short writes and refusing closed connections.
# 输入 / Inputs: stream; data; deadline; check
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `stream.settimeout`, `stream.send`.
# 核验 / Required checks: `remaining > 0 -> 'PROTOCOL_TIMEOUT'`; `sent > 0 -> 'PROTOCOL_CLOSED'`.
def exact_send(stream, data, deadline, check):
    offset = 0
    while offset < len(data):
        check()
        remaining = deadline - time.monotonic()
        require(remaining > 0, 'PROTOCOL_TIMEOUT')
        stream.settimeout(min(remaining, 1))
        try:
            sent = stream.send(data[offset:offset + 65536])
        except socket.timeout:
            continue
        require(sent > 0, 'PROTOCOL_CLOSED')
        offset += sent
    check()


# 入口 / Entry: relay.
# 功能：逐个转发 SSH Agent 请求及响应帧，限制请求数、累计字节和单请求期限。
# Purpose: Relays SSH Agent request/response frames sequentially, bounding request count, cumulative bytes and per-request deadlines.
# 输入 / Inputs: stream; upstream; deadline; check
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `exact_send`.
# 核验 / Required checks: `transferred <= MAX_SESSION_BYTES -> 'PROTOCOL_BUDGET'`.
def relay(stream, upstream, deadline, check):
    transferred = 0
    for _request in range(MAX_REQUESTS):
        request_deadline = min(deadline, time.monotonic() + 10)
        request = frame(stream, request_deadline, check)
        transferred += len(request)
        require(transferred <= MAX_SESSION_BYTES, 'PROTOCOL_BUDGET')
        check(); exact_send(upstream, request, request_deadline, check)
        response = frame(upstream, request_deadline, check)
        transferred += len(response)
        require(transferred <= MAX_SESSION_BYTES, 'PROTOCOL_BUDGET')
        check(); exact_send(stream, response, request_deadline, check)


# 入口 / Entry: broker.
# 功能：创建固定来源的 Unix 代理端点，持久发布 ready 后有界接入并核对每个任务 peer。
# Purpose: Creates a Unix proxy endpoint for the pinned source, durably publishes readiness and admits bounded connections while validating each task peer.
# 输入 / Inputs: context; value; lock
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `threading.Event`, `set`, `threading.Lock`, `process.close`, `save_record`, `os.close`; 更新 / updates `value['broker']`, `value['source']`, `value['endpointDirectory']`, `value['endpoint']`.
# 核验 / Required checks: `len(names) <= 1024 -> 'RESOURCE_LIMIT'`; `other.get('version') == 1 and other.get('phase') in ['preparing', 'ready', 'failed', 'closed'] -> 'OTHER_RESOURCE_UNCONFIRMED'`; `other['phase'] == 'closed' or other.get('source') != value['source'] -> 'SOURCE_SHARED'`; `not os.path.lexists(endpoint) -> 'ENDPOINT_UNKNOWN'`; `stat.S_ISSOCK(current.st_mode) -> 'ENDPOINT_INVALID'`.
# 设计：持锁建立物理端点并保存原身份；发布 ready 后才释放锁。连接失败只结束该连接，整体失败保留 failed 控制记录供原位核验。
# Design: Creates the physical endpoint under lock and records original identities; releases the lock only after publishing ready. Connection failure ends that peer; broker failure retains failed control evidence for later verification.
# 收尾 / Finalization: `stopped.set()`; `with mutex: for stream in peers: stream.close()`; `if listener is not None: listener.close()`.
def broker(context, value, lock):
    source = None; listener = None; endpoint_fd = None
    stopped = threading.Event(); peers = set(); mutex = threading.Lock()
    # 入口 / Entry: broker.stop.
    # 功能：仅设置停止事件，让代理主循环和连接检查协同退出。
    # Purpose: Only sets the stop event so the broker loop and connection checks exit cooperatively.
    # 输入 / Inputs: _signal; _frame
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `stopped.set`.
    def stop(_signal, _frame):
        stopped.set()
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGHUP, stop); signal.signal(signal.SIGINT, stop)
    try:
        process = Process(os.getpid())
        value['broker'] = {'pid': process.pid, 'startTicks': process.start}; process.close(); save_record(value)
        source = Source(os.environ.get('SAKURA_SSH_AGENT_SOURCE', ''))
        value['source'] = source.record(); save_record(value)
        records = directory(RECORDS, 0o700)
        try:
            names = os.listdir(records); require(len(names) <= 1024, 'RESOURCE_LIMIT')
            for name in names:
                if not name.endswith('.json') or name == record_name(context):
                    continue
                other = json.loads(regular(records, name).decode('utf-8'))
                require(other.get('version') == 1 and other.get('phase') in ['preparing', 'ready', 'failed', 'closed'], 'OTHER_RESOURCE_UNCONFIRMED')
                require(other['phase'] == 'closed' or other.get('source') != value['source'], 'SOURCE_SHARED')
        finally:
            os.close(records)
        if not os.path.lexists(SOCKETS):
            # The controller inherits umask077. Only this newly created object
            # may have its traversal mode published; never repair an unknown root.
            os.mkdir(SOCKETS, 0o700)
            root = directory(SOCKETS, 0o700)
            try: os.fchmod(root, 0o755); os.fsync(root)
            finally: os.close(root)
        os.close(directory(SOCKETS, 0o755))
        endpoint = SOCKETS + '/' + context['resource']['leaseId']
        require(not os.path.lexists(endpoint), 'ENDPOINT_UNKNOWN')
        os.mkdir(endpoint, 0o700)
        endpoint_fd = directory(endpoint, 0o700)
        os.fchown(endpoint_fd, 0, context['identity']['gid']); os.fchmod(endpoint_fd, 0o710)
        value['endpointDirectory'] = info(os.fstat(endpoint_fd)); save_record(value)
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind('/proc/self/fd/' + str(endpoint_fd) + '/agent')
        current = os.stat('agent', dir_fd=endpoint_fd, follow_symlinks=False)
        require(stat.S_ISSOCK(current.st_mode), 'ENDPOINT_INVALID')
        os.chown('agent', context['identity']['uid'], context['identity']['gid'], dir_fd=endpoint_fd, follow_symlinks=False)
        os.chmod('agent', 0o600, dir_fd=endpoint_fd, follow_symlinks=False)
        value['endpoint'] = info(os.stat('agent', dir_fd=endpoint_fd, follow_symlinks=False))
        listener.listen(MAX_CONNECTIONS); listener.settimeout(0.25)
        source.check(); value['phase'] = 'ready'; save_record(value)
        fcntl.flock(lock, fcntl.LOCK_UN); os.close(lock); lock = None
        deadline = time.monotonic() + context['resource']['timeoutSeconds'] + 15
        # 入口 / Entry: broker.serve.
        # 功能：核验一个已接入项目连接及其任务归属，转发到原来源并始终关闭本连接的句柄。
        # Purpose: Validates one admitted project connection and task ownership, relays it to the original source and always closes that connection's handles.
        # 输入 / Inputs: stream
        # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
        # 副作用 / Effects: 调用 / calls `source.connect`, `upstream.close`, `peer.close`, `stream.close`, `peers.discard`.
        # 核验 / Required checks: `uid == context['identity']['uid'] and gid == context['identity']['gid'] -> 'PEER_ACCOUNT'`.
        # 收尾 / Finalization: `if upstream is not None: upstream.close()`; `if peer is not None: peer.close()`; `stream.close()`.
        def serve(stream):
            peer = None; upstream = None
            try:
                pid, uid, gid = credentials(stream)
                require(uid == context['identity']['uid'] and gid == context['identity']['gid'], 'PEER_ACCOUNT')
                peer = Process(pid)
                # 入口 / Entry: broker.serve.check.
                # 功能：在继续 I/O 前重新核验撤销、截止时间及本闭包捕获的资源身份。
                # Purpose: Rechecks revocation, deadline and this closure's captured resource identities before continuing I/O.
                # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
                # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
                # 副作用 / Effects: 调用 / calls `stopped.is_set`, `os.close`.
                # 核验 / Required checks: `not stopped.is_set() and time.monotonic() < deadline -> 'RESOURCE_REVOKED'`; `info(os.fstat(fd)) == value['endpointDirectory'] and info(os.stat('agent', dir_fd=fd, follow_symlinks=False)) == value['endpo… -> 'ENDPOINT_REPLACED'`.
                # 收尾 / Finalization: `os.close(fd)`.
                def check():
                    require(not stopped.is_set() and time.monotonic() < deadline, 'RESOURCE_REVOKED')
                    peer.task(context, value['scope']); source.check()
                    fd = directory(endpoint, 0o710, context['identity']['gid'])
                    try:
                        require(info(os.fstat(fd)) == value['endpointDirectory'] and
                                info(os.stat('agent', dir_fd=fd, follow_symlinks=False)) == value['endpoint'], 'ENDPOINT_REPLACED')
                    finally:
                        os.close(fd)
                check(); upstream = source.connect(); check()
                relay(stream, upstream, deadline, check)
            except (Refused, OSError, ValueError, IndexError):
                pass
            finally:
                if upstream is not None: upstream.close()
                if peer is not None: peer.close()
                stream.close()
                with mutex: peers.discard(stream)
        while not stopped.is_set() and time.monotonic() < deadline:
            source.check()
            try:
                stream, _ = listener.accept()
            except socket.timeout:
                continue
            with mutex:
                if len(peers) >= MAX_CONNECTIONS: stream.close(); continue
                peers.add(stream)
            threading.Thread(target=serve, args=(stream,), daemon=True).start()
    except BaseException as error:
        value['phase'] = 'failed'; value['failure'] = str(error) if isinstance(error, Refused) else 'BROKER_FAILED'
        try: save_record(value)
        except BaseException: pass
    finally:
        stopped.set()
        with mutex:
            for stream in peers: stream.close()
        if listener is not None: listener.close()
        if endpoint_fd is not None: os.close(endpoint_fd)
        if source is not None: source.close()
        if lock is not None: os.close(lock)


# 入口 / Entry: run.
# 功能：核对当前任务 cgroup，创建原租约记录并 fork 代理，确认 ready 及原进程出生后 exec 固定 launcher。
# Purpose: Checks the current task cgroup, creates the original lease record and forks the broker, execing the fixed launcher only after readiness/original-process birth confirmation.
# 输入 / Inputs: context; launcher
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `open`, `current.read(4096).splitlines`, `current.read`, `locked`, `read_record`, `save_record`.
# 核验 / Required checks: `isinstance(launcher, str) and launcher and (len(launcher.encode('utf-8')) <= 65536) and ('\x00' not in launcher) -> 'LAUNCHER_INVALID'`; `current.read(4096).splitlines() == ['0::/sakura-task-' + context['owner']['runId']] -> 'CONTROLLER_SCOPE'`; `read_record(context) is None and (not os.path.lexists(SOCKETS + '/' + context['resource']['leaseId'])) -> 'RESOURCE_EXISTS'`; `value is not None and value['phase'] != 'failed' -> (value or {}).get('failure') or 'BROKER_READY_FAIL…`; `value['broker']['pid'] == pid -> 'BROKER_REPLACED'`.
# 拒绝 / Refusals: `Refused('BROKER_READY_TIMEOUT')`.
# 设计：启动器和代理的 ready 确认先于项目命令交接；固定 launcher 不接收项目命令字节作为本控制器的输入。
# Design: Broker readiness is confirmed before project-command handoff; the fixed launcher does not pass project command bytes into this controller.
# 收尾 / Finalization: `proof.close()`.
def run(context, launcher):
    require(isinstance(launcher, str) and launcher and len(launcher.encode('utf-8')) <= 65536 and '\x00' not in launcher, 'LAUNCHER_INVALID')
    scope_fd, scope = task_scope(context)
    with open('/proc/self/cgroup', encoding='ascii') as current:
        require(current.read(4096).splitlines() == ['0::/sakura-task-' + context['owner']['runId']], 'CONTROLLER_SCOPE')
    lock = locked(create=True)
    require(read_record(context) is None and not os.path.lexists(SOCKETS + '/' + context['resource']['leaseId']), 'RESOURCE_EXISTS')
    value = {'version': 1, 'context': context, 'phase': 'preparing', 'scope': scope,
             'source': None, 'endpointDirectory': None, 'endpoint': None, 'broker': None, 'failure': None}
    save_record(value)
    pid = os.fork()
    if pid == 0:
        null = os.open('/dev/null', os.O_RDWR | os.O_CLOEXEC)
        for fd in [0, 1, 2]: os.dup2(null, fd)
        if null > 2: os.close(null)
        broker(context, value, lock)
        os._exit(0)
    os.close(lock); os.close(scope_fd)
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        value = read_record(context)
        require(value is not None and value['phase'] != 'failed', (value or {}).get('failure') or 'BROKER_READY_FAILED')
        if value['phase'] == 'ready':
            require(value['broker']['pid'] == pid, 'BROKER_REPLACED')
            proof = Process(pid)
            try:
                require(proof.start == value['broker']['startTicks'], 'BROKER_REPLACED')
                fd, expected = task_scope(context); os.close(fd); require(expected == value['scope'], 'CGROUP_CHANGED')
            finally:
                proof.close()
            # Only the fixed launcher metadata is an argv. It receives the
            # untouched FIFO/socket frame and drops identity/capabilities.
            for name in os.listdir('/proc/self/fd'):
                if name.isdigit() and int(name) > 2:
                    try: os.close(int(name))
                    except OSError: pass
            os.execve('/bin/sh', ['sh', '-c', launcher], {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/', 'LANG': 'C', 'LC_ALL': 'C'})
        time.sleep(0.05)
    raise Refused('BROKER_READY_TIMEOUT')


# 入口 / Entry: stopped.
# 功能：要求原任务 cgroup 已消失并返回当前 boot，作为清理前置证明。
# Purpose: Requires the original task cgroup to be absent and returns current boot as cleanup admission evidence.
# 输入 / Inputs: context
# 输出 / Returns: `current`
# 核验 / Required checks: `not os.path.lexists(scope_path(context)) -> 'SCOPE_ACTIVE'`.
def stopped(context):
    current = boot()
    require(not os.path.lexists(scope_path(context)), 'SCOPE_ACTIVE')
    return current


# 入口 / Entry: source_absent.
# 功能：等待 sshd 拆除原来源监听并反复核验 inode，不能代替 sshd 删除其监听或向共享进程发信号。
# Purpose: Waits for sshd to remove its original listener while rechecking inode, without deleting sshd's listener or signaling a shared process.
# 输入 / Inputs: source
# 输出 / Returns: `None`
# 副作用 / Effects: 调用 / calls `os.close`.
# 核验 / Required checks: `info(os.fstat(parent)) == source['parent'] and info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == source['socket'] -> 'SOURCE_REPLACED'`; `not os.path.lexists(source['path']) -> 'SOURCE_CLOSE_UNCONFIRMED'`.
# 收尾 / Finalization: `os.close(parent)`.
def source_absent(source):
    if source is None: return
    deadline = time.monotonic() + 3
    while os.path.lexists(source['path']) and time.monotonic() < deadline:
        parent_path, name = source['path'].rsplit('/', 1)
        parent = directory(parent_path, 0o700, source=True)
        try:
            require(info(os.fstat(parent)) == source['parent'] and
                    info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == source['socket'], 'SOURCE_REPLACED')
        finally:
            os.close(parent)
        time.sleep(0.05)
    # sshd owns and removes its original listener. Never unlink it or signal a
    # shared/root SSH process on behalf of a project cleanup.
    require(not os.path.lexists(source['path']), 'SOURCE_CLOSE_UNCONFIRMED')


# 入口 / Entry: endpoint_absent.
# 功能：核验租约端点确实不存在，未知或仍存在的端点不能视作清理成功。
# Purpose: Checks that the lease endpoint is truly absent; unknown or remaining endpoints cannot count as successful cleanup.
# 输入 / Inputs: context; code='ENDPOINT_UNCONFIRMED'
# 输出 / Returns: `None`
# 副作用 / Effects: 调用 / calls `os.close`.
# 核验 / Required checks: `not os.path.lexists(SOCKETS + '/' + context['resource']['leaseId']) -> code`.
# 拒绝 / Refusals: `Refused(code)`.
# 收尾 / Finalization: `os.close(root)`.
def endpoint_absent(context, code='ENDPOINT_UNCONFIRMED'):
    if os.path.lexists(SOCKETS):
        root = directory(SOCKETS, 0o755)
        try:
            try: os.stat(context['resource']['leaseId'], dir_fd=root, follow_symlinks=False)
            except FileNotFoundError: return
            raise Refused(code)
        finally:
            os.close(root)
    require(not os.path.lexists(SOCKETS + '/' + context['resource']['leaseId']), code)


# 入口 / Entry: cleanup.
# 功能：在任务退出后仅按原持久票据清理代理端点，并最后发布 closed 回执。
# Purpose: Cleans proxy endpoints only against their original durable ticket after task exit, publishing a closed receipt last.
# 输入 / Inputs: context
# 输出 / Returns: `{'phase': 'closed', 'context': context, 'record': None}`; `{'phase': 'closed', 'context': context, 'record': value}`
# 副作用 / Effects: 调用 / calls `locked`, `read_record`, `save_record`, `os.close`, `os.unlink`, `os.fsync`; 更新 / updates `value['phase']`.
# 核验 / Required checks: `stopped(context) == current -> 'BOOT_CHANGED'`; `value['source'] is None or not os.path.lexists(value['source']['path']) -> 'CLOSED_SOURCE_PRESENT'`; `value['source'] is None or not os.path.lexists(value['source']['path']) -> 'OLD_BOOT_RESOURCE_PRESENT'`; `boot() == current and (not os.path.lexists(scope_path(context))) -> 'BOOT_CHANGED'`; `value['endpointDirectory'] is not None -> 'ENDPOINT_UNCONFIRMED'`.
# 设计：任务退出是前置条件；boot 改变时仅接受资源已缺失，不能用旧票据删除新 boot 的对象。closed 回执在全部原资源确认后提交。
# Design: Task exit is required; after boot change only resource absence is accepted, so old tickets cannot delete objects from a new boot. The closed receipt is committed after confirming all original resources.
# 收尾 / Finalization: `os.close(lock)`; `os.close(parent)`; `os.close(root)`.
def cleanup(context):
    current = stopped(context)
    if not os.path.lexists(RECORDS):
        endpoint_absent(context)
        require(stopped(context) == current, 'BOOT_CHANGED')
        return {'phase': 'closed', 'context': context, 'record': None}
    lock = locked()
    try:
        value = read_record(context)
        endpoint = SOCKETS + '/' + context['resource']['leaseId']
        if value is None:
            endpoint_absent(context)
            require(stopped(context) == current, 'BOOT_CHANGED')
            return {'phase': 'closed', 'context': context, 'record': None}
        if value['phase'] == 'closed':
            endpoint_absent(context, 'CLOSED_ENDPOINT_PRESENT')
            require(value['source'] is None or not os.path.lexists(value['source']['path']), 'CLOSED_SOURCE_PRESENT')
            require(stopped(context) == current, 'BOOT_CHANGED')
            return {'phase': 'closed', 'context': context, 'record': value}
        if current != context['owner']['bootId']:
            endpoint_absent(context, 'OLD_BOOT_RESOURCE_PRESENT')
            require(value['source'] is None or not os.path.lexists(value['source']['path']), 'OLD_BOOT_RESOURCE_PRESENT')
            require(boot() == current and not os.path.lexists(scope_path(context)), 'BOOT_CHANGED')
            value['phase'] = 'closed'; save_record(value)
            return {'phase': 'closed', 'context': context, 'record': value}
        source_absent(value['source'])
        require(stopped(context) == current, 'BOOT_CHANGED')
        if os.path.lexists(SOCKETS): os.close(directory(SOCKETS, 0o755))
        if os.path.lexists(endpoint):
            require(value['endpointDirectory'] is not None, 'ENDPOINT_UNCONFIRMED')
            parent = directory(endpoint, 0o710, context['identity']['gid'])
            try:
                require(info(os.fstat(parent)) == value['endpointDirectory'], 'ENDPOINT_REPLACED')
                children = os.listdir(parent)
                require(children in [[], ['agent']], 'ENDPOINT_CONTENT_CHANGED')
                if children:
                    require(value['endpoint'] is not None and
                            info(os.stat('agent', dir_fd=parent, follow_symlinks=False)) == value['endpoint'], 'ENDPOINT_REPLACED')
                    os.unlink('agent', dir_fd=parent); os.fsync(parent)
            finally:
                os.close(parent)
            root = directory(SOCKETS, 0o755)
            try:
                require(info(os.stat(context['resource']['leaseId'], dir_fd=root, follow_symlinks=False)) == value['endpointDirectory'], 'ENDPOINT_REPLACED')
                os.rmdir(context['resource']['leaseId'], dir_fd=root); os.fsync(root)
            finally:
                os.close(root)
        require(stopped(context) == current, 'BOOT_CHANGED')
        value['phase'] = 'closed'; save_record(value)
        return {'phase': 'closed', 'context': context, 'record': value}
    finally:
        os.close(lock)


# 入口 / Entry: main.
# 功能：仅以 root 控制账户处理严格形状的 run、cleanup 或 read 请求，并输出控制协议 JSON。
# Purpose: Processes strictly shaped run/cleanup/read requests only as the root controller and emits control-protocol JSON.
# 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
# 输出 / Returns: `None`
# 副作用 / Effects: 调用 / calls `set`, `run`, `read_record`.
# 核验 / Required checks: `os.getuid() == 0 and os.geteuid() == 0 and (os.getgid() == 0) -> 'CONTROLLER_OWNER'`; `request['action'] in ['run', 'cleanup', 'read'] and set(request) == ({'action', 'context', 'launcher'} if request['action'] =… -> 'REQUEST_INVALID'`; `value is not None -> 'RESOURCE_ABSENT'`.
def main():
    require(os.getuid() == 0 and os.geteuid() == 0 and os.getgid() == 0, 'CONTROLLER_OWNER')
    request = json.loads(base64.b64decode(sys.argv[1], validate=True))
    require(request['action'] in ['run', 'cleanup', 'read'] and
            set(request) == ({'action', 'context', 'launcher'} if request['action'] == 'run' else {'action', 'context'}), 'REQUEST_INVALID')
    context = context_checked(request['context'])
    if request['action'] == 'run':
        run(context, request['launcher'])
        return
    if request['action'] == 'cleanup':
        result = cleanup(context)
    else:
        value = read_record(context)
        require(value is not None, 'RESOURCE_ABSENT')
        result = {'phase': value['phase'], 'context': context, 'record': value}
    print(json.dumps({'version': 1, 'ok': True, 'result': result}))


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        code = str(error) if isinstance(error, Refused) else 'AGENT_CONTROL_FAILED'
        print(json.dumps({'ok': False, 'code': 'SSH_AGENT_' + code, 'detail': None}))
        sys.exit(1)
