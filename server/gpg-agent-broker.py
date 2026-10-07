# 模块职责：在客户机内核对 GPG 转发的账户、目录及原运行票据，受限代理与清理只作用于原资源。
# Module purpose: Verifies guest GPG forwarding accounts, directories and original run tickets; constrained proxy and cleanup affect original resources only.
"""Fixed root controller; project command bytes never enter this process.

SO_PEERCRED authenticates the connector, not a later recipient of a passed FD.
An authorized application can deliberately relay requests; this is not a
security boundary against cooperation between processes with the same UID.
"""
import base64
import errno
import fcntl
import hashlib
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

ROOT = '/run/sakura-gpg-forwards'
SOCKETS = '/run/sakura-gpg-sockets'
HOMES = '/run/sakura-gpg-data'
SOURCES = ROOT + '/sources'
RECORDS = ROOT + '/records'
MAX_CONNECTIONS = 8
MAX_TOTAL_CONNECTIONS = 32
MAX_REQUESTS = 128
MAX_SESSION_BYTES = 8 * 1024 * 1024
MAX_LINE = 1000
MAX_WIRE_LINE = 1002
MAX_HOME_ENTRIES = 4096
MAX_HOME_DEPTH = 16
MAX_HOME_DIRECTORIES = 128
MAX_RECORD_BYTES = 262144
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


# GPG 票据额外绑定宿主来源和辅助程序摘要，拒绝把其他宿主连接混入同一项目任务。
# 入口 / Entry: context_checked.
# 功能：验证资源租约、项目账户修订、任务 boot 与代理摘要的完整票据。
# Purpose: Validates the full ticket binding resource lease, project-account revision, task boot and broker digest.
# 输入 / Inputs: value
# 输出 / Returns: `value`
# 副作用 / Effects: 调用 / calls `set`, `identity['identityId'].replace`.
# 核验 / Required checks: `set(value) == {'resource', 'identity', 'owner', 'sha256'} -> 'CONTEXT_INVALID'`; `set(resource) == {'version', 'kind', 'leaseId', 'brokerSha256', 'timeoutSeconds', 'hostSourceSha256', 'hostHelperSha256'} -> 'CONTEXT_INVALID'`; `type(resource['version']) is int and resource['version'] == 1 and (resource['kind'] == 'gpg-agent') -> 'CONTEXT_INVALID'`; `set(owner) == {'kind', 'runId', 'bootId'} and owner['kind'] == 'task' -> 'CONTEXT_INVALID'`; `type(resource['timeoutSeconds']) is int and 1 <= resource['timeoutSeconds'] <= 300 -> 'CONTEXT_INVALID'`.
def context_checked(value):
    require(set(value) == {'resource', 'identity', 'owner', 'sha256'}, 'CONTEXT_INVALID')
    resource, identity, owner = value['resource'], value['identity'], value['owner']
    require(set(resource) == {'version', 'kind', 'leaseId', 'brokerSha256', 'timeoutSeconds',
                             'hostSourceSha256', 'hostHelperSha256'}, 'CONTEXT_INVALID')
    require(type(resource['version']) is int and resource['version'] == 1 and resource['kind'] == 'gpg-agent', 'CONTEXT_INVALID')
    identifier(resource['leaseId']); identifier(owner['runId']); identifier(owner['bootId'])
    require(set(owner) == {'kind', 'runId', 'bootId'} and owner['kind'] == 'task', 'CONTEXT_INVALID')
    require(type(resource['timeoutSeconds']) is int and 1 <= resource['timeoutSeconds'] <= 300, 'CONTEXT_INVALID')
    require(re.fullmatch('[a-f0-9]{64}', resource['brokerSha256']) and re.fullmatch('[a-f0-9]{64}', value['sha256']), 'CONTEXT_INVALID')
    for name in ['hostSourceSha256', 'hostHelperSha256']:
        require(isinstance(resource[name], str) and re.fullmatch('[a-f0-9]{64}', resource[name]), 'CONTEXT_INVALID')
    required = {'version', 'phase', 'registryId', 'projectId', 'identityId', 'revision', 'account', 'uid', 'gid',
                'home', 'directory', 'directoryDevice', 'directoryInode', 'homeDevice', 'homeInode', 'networkIsolation'}
    require(set(identity) == required and type(identity['version']) is int and identity['version'] == 1 and identity['phase'] == 'active', 'CONTEXT_INVALID')
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


# 通过逐级目录 FD 固定控制路径；临时来源父目录仅按明确的 sticky 权限例外核验。
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
# 输入 / Inputs: parent; name; size=MAX_RECORD_BYTES
# 输出 / Returns: `data`
# 副作用 / Effects: 调用 / calls `os.open`, `os.read`, `os.close`.
# 核验 / Required checks: `stat.S_ISREG(value.st_mode) and value.st_uid == 0 and (value.st_gid == 0) and (value.st_nlink == 1) and (stat.S_IMODE(value.s… -> 'RECORD_OWNER'`; `len(data) == value.st_size and (not os.read(fd, 1)) and (info(os.fstat(fd)) == info(value)) -> 'RECORD_CHANGED'`.
# 收尾 / Finalization: `os.close(fd)`.
def regular(parent, name, size=MAX_RECORD_BYTES):
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


# 入口 / Entry: source_path.
# 功能：从租约 UUID 派生 root 私有的原 GPG 来源监听路径。
# Purpose: Derives the root-private original GPG source-listener path from the lease UUID.
# 输入 / Inputs: context
# 输出 / Returns: `SOURCES + '/' + context['resource']['leaseId'] + '/agent'`
def source_path(context):
    return SOURCES + '/' + context['resource']['leaseId'] + '/agent'


# 入口 / Entry: endpoint_path.
# 功能：从租约 UUID 派生项目可连接的代理端点目录。
# Purpose: Derives the project-connectable proxy endpoint directory from the lease UUID.
# 输入 / Inputs: context
# 输出 / Returns: `SOCKETS + '/' + context['resource']['leaseId']`
def endpoint_path(context):
    return SOCKETS + '/' + context['resource']['leaseId']


# 入口 / Entry: home_path.
# 功能：从租约 UUID 派生隔离 GPG 数据 home 路径。
# Purpose: Derives the isolated GPG data-home path from the lease UUID.
# 输入 / Inputs: context
# 输出 / Returns: `HOMES + '/' + context['resource']['leaseId'] + '/home'`
def home_path(context):
    return HOMES + '/' + context['resource']['leaseId'] + '/home'


# 入口 / Entry: redirect_bytes.
# 功能：构造指向本租约代理 socket 的固定 Assuan 重定向文件字节。
# Purpose: Builds fixed Assuan redirection-file bytes pointing to this lease's proxy socket.
# 输入 / Inputs: context
# 输出 / Returns: `('%Assuan%\nsocket=' + endpoint_path(context) + '/agent\n').encode('ascii')`
def redirect_bytes(context):
    return ('%Assuan%\nsocket=' + endpoint_path(context) + '/agent\n').encode('ascii')


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
# 副作用 / Effects: 调用 / calls `set`, `paths.add`.
# 核验 / Required checks: `isinstance(value, dict) and set(value) == {'version', 'context', 'phase', 'scope', 'sourceDirectory', 'source', 'endpointDire… -> 'RECORD_INVALID'`; `type(value['version']) is int and value['version'] == 1 and (value['context'] == context) and (value['phase'] in ['prepared',… -> 'RECORD_CHANGED'`; `isinstance(scope, dict) and set(scope) == {'device', 'inode', 'controlToken'} -> 'RECORD_INVALID'`; `isinstance(scope[name], str) and re.fullmatch('0|[1-9][0-9]*', scope[name]) -> 'RECORD_INVALID'`; `isinstance(source, dict) and set(source) == {'path', 'parent', 'socket', 'peer'} and (source['path'] == source_path(context)) -> 'RECORD_INVALID'`.
def record_checked(value, context):
    require(isinstance(value, dict) and set(value) == {'version', 'context', 'phase', 'scope', 'sourceDirectory', 'source',
            'endpointDirectory', 'endpoint', 'homeDirectory', 'home', 'redirect', 'broker', 'homeCleanup', 'failure'}, 'RECORD_INVALID')
    require(type(value['version']) is int and value['version'] == 1 and value['context'] == context and
            value['phase'] in ['prepared', 'preparing', 'ready', 'failed', 'closed'], 'RECORD_CHANGED')
    scope = value['scope']
    if scope is not None:
        require(isinstance(scope, dict) and set(scope) == {'device', 'inode', 'controlToken'}, 'RECORD_INVALID')
        identifier(scope['controlToken'])
        for name in ['device', 'inode']:
            require(isinstance(scope[name], str) and re.fullmatch('0|[1-9][0-9]*', scope[name]), 'RECORD_INVALID')
    source = value['source']
    if source is not None:
        require(isinstance(source, dict) and set(source) == {'path', 'parent', 'socket', 'peer'} and
                source['path'] == source_path(context), 'RECORD_INVALID')
        recorded_object(source['parent']); recorded_object(source['socket']); recorded_process(source['peer'])
        require(source['parent'] == value['sourceDirectory'], 'RECORD_CHANGED')
    for name in ['sourceDirectory', 'endpointDirectory', 'endpoint', 'homeDirectory', 'home']:
        if value[name] is not None: recorded_object(value[name])
    expected_objects = {'sourceDirectory': (0, 0, 0o700, stat.S_IFDIR),
        'endpointDirectory': (0, context['identity']['gid'], 0o710, stat.S_IFDIR),
        'endpoint': (0, context['identity']['gid'], 0o660, stat.S_IFSOCK),
        'homeDirectory': (0, context['identity']['gid'], 0o710, stat.S_IFDIR),
        'home': (context['identity']['uid'], context['identity']['gid'], 0o700, stat.S_IFDIR)}
    for name, expected in expected_objects.items():
        if value[name] is not None:
            require(tuple(value[name][field] for field in ['uid', 'gid', 'mode', 'type']) == expected, 'RECORD_INVALID')
    if source is not None:
        require(source['socket']['uid'] == 0 and source['socket']['gid'] == 0 and source['socket']['type'] == stat.S_IFSOCK, 'RECORD_INVALID')
    if value['redirect'] is not None:
        redirection = value['redirect']
        require(isinstance(redirection, dict) and set(redirection) == {'object', 'sha256'} and
                redirection['sha256'] == hashlib.sha256(redirect_bytes(context)).hexdigest(), 'RECORD_INVALID')
        recorded_object(redirection['object'])
        require(tuple(redirection['object'][field] for field in ['uid', 'gid', 'mode', 'type']) ==
                (0, context['identity']['gid'], 0o440, stat.S_IFREG), 'RECORD_INVALID')
    if value['homeCleanup'] is not None:
        transition = value['homeCleanup']
        require(isinstance(transition, dict) and set(transition) == {'phase', 'frozenHome', 'directories'} and
                transition['phase'] in ['freeze-intent', 'frozen', 'removing', 'removed'] and value['home'] is not None, 'RECORD_INVALID')
        frozen = transition['frozenHome']
        if frozen is not None:
            recorded_object(frozen)
            require(frozen == {**value['home'], 'uid': 0, 'gid': 0, 'mode': 0o700}, 'RECORD_CHANGED')
        require(transition['phase'] == 'freeze-intent' or frozen is not None, 'RECORD_INVALID')
        directories = transition['directories']
        require(isinstance(directories, list) and len(directories) <= MAX_HOME_DIRECTORIES, 'RECORD_INVALID')
        paths = set()
        for child in directories:
            require(isinstance(child, dict) and set(child) == {'path', 'phase', 'original', 'frozen'} and
                    child['phase'] in ['freeze-intent', 'frozen', 'removed'] and isinstance(child['path'], list) and
                    1 <= len(child['path']) <= MAX_HOME_DEPTH and all(valid_data_name(part) for part in child['path']), 'RECORD_INVALID')
            key = tuple(child['path']); require(key not in paths, 'RECORD_INVALID'); paths.add(key)
            recorded_object(child['original']); recorded_object(child['frozen'])
            require(child['original']['uid'] == context['identity']['uid'] and child['original']['gid'] == context['identity']['gid'] and
                    child['original']['type'] == stat.S_IFDIR and
                    child['frozen'] == {**child['original'], 'uid': 0, 'gid': 0, 'mode': 0o700}, 'RECORD_INVALID')
    if value['broker'] is not None: recorded_process(value['broker'])
    require(value['failure'] is None or (isinstance(value['failure'], str) and
            re.fullmatch('[A-Z][A-Z0-9_]{0,79}', value['failure'])), 'RECORD_INVALID')
    require(value['phase'] != 'ready' or (all(value[name] is not None for name in
            ['scope', 'sourceDirectory', 'source', 'endpointDirectory', 'endpoint', 'homeDirectory', 'home', 'redirect', 'broker'])
            and value['failure'] is None), 'RECORD_INVALID')
    require(value['phase'] != 'prepared' or (value['scope'] is None and value['sourceDirectory'] is not None and
            all(value[name] is None for name in ['source', 'endpointDirectory', 'endpoint', 'homeDirectory', 'home',
                                               'redirect', 'broker', 'homeCleanup', 'failure'])), 'RECORD_INVALID')
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
# 核验 / Required checks: `len(raw) <= MAX_RECORD_BYTES -> 'RECORD_BUDGET'`; `prior is None or prior['context'] == value['context'] -> 'RECORD_CHANGED'`.
# 设计：临时文件与目标位于同一已核验目录；落盘后 rename 提交，目录 fsync 记录发布，finally 关闭目录 FD；写入失败不能视作提交成功。
# Design: Temporary and target files share the checked directory; rename commits after file flush, directory fsync records publication and finally closes the directory FD; a write failure is never treated as a successful commit.
# 收尾 / Finalization: `os.close(parent)`.
def save_record(value):
    record_checked(value, value['context'])
    raw = json.dumps(value, separators=(',', ':')).encode('utf-8')
    require(len(raw) <= MAX_RECORD_BYTES, 'RECORD_BUDGET')
    parent = directory(RECORDS, 0o700)
    name = '.write-' + str(uuid.uuid4())
    try:
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | FLAGS, 0o600, dir_fd=parent)
        with os.fdopen(fd, 'wb') as target:
            target.write(raw)
            target.flush(); os.fsync(target.fileno())
        # A root-only directory and the checked existing context prevent an
        # unrelated resource from being replaced by this phase transition.
        record_checked(value, value['context']); prior = read_record(value['context'])
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
    # 核验 / Required checks: `values.get(b'Uid', b'').split() == [str(identity['uid']).encode()] * 4 and values.get(b'Gid', b'').split() == [str(identity['… -> 'PEER_ACCOUNT'`; `values.get(b'NoNewPrivs', b'').strip() == b'1' and (not values.get(b'Groups', b'').split()) and all((int(values.get(name, b'1… -> 'PEER_PRIVILEGES'`; `self.read('cgroup', 4096).splitlines() == [expected] -> 'PEER_SCOPE'`; `boot() == context['owner']['bootId'] -> 'BOOT_CHANGED'`; `str(value.st_dev) == scope['device'] and str(value.st_ino) == scope['inode'] -> 'CGROUP_CHANGED'`.
    # 收尾 / Finalization: `os.close(fd)`.
    def task(self, context, scope):
        self.alive()
        values = dict(line.split(b':', 1) for line in self.read('status', 65536).splitlines() if b':' in line)
        identity = context['identity']
        require(values.get(b'Uid', b'').split() == [str(identity['uid']).encode()] * 4 and
                values.get(b'Gid', b'').split() == [str(identity['gid']).encode()] * 4, 'PEER_ACCOUNT')
        require(values.get(b'NoNewPrivs', b'').strip() == b'1' and not values.get(b'Groups', b'').split() and
                all(int(values.get(name, b'1').strip(), 16) == 0 for name in
                    [b'CapInh', b'CapPrm', b'CapEff', b'CapBnd', b'CapAmb']), 'PEER_PRIVILEGES')
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

    # 入口 / Entry: Process.root.
    # 功能：核对来源连接进程仍属于原 PID 出生且所有 UID/GID 都为 root。
    # Purpose: Checks that the source peer still has its original process birth and all UID/GID entries are root.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `self.read('status', 65536).splitlines`, `self.read`.
    # 核验 / Required checks: `values.get(b'Uid', b'').split() == [b'0'] * 4 and values.get(b'Gid', b'').split() == [b'0'] * 4 -> 'SOURCE_PEER_ACCOUNT'`.
    def root(self):
        self.alive()
        values = dict(line.split(b':', 1) for line in self.read('status', 65536).splitlines() if b':' in line)
        require(values.get(b'Uid', b'').split() == [b'0'] * 4 and
                values.get(b'Gid', b'').split() == [b'0'] * 4, 'SOURCE_PEER_ACCOUNT')
        self.alive()


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
        self.peer.root()

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


class Lines:
    # 入口 / Entry: Lines.__init__.
    # 功能：为一个 Assuan stream 建立有界行缓冲和部分行进度计时。
    # Purpose: Creates bounded line buffering and partial-line progress timing for one Assuan stream.
    # 输入 / Inputs: stream
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 更新 / updates `self.stream`, `self.pending`, `self.partial_since`, `self.received`.
    def __init__(self, stream):
        self.stream = stream
        self.pending = bytearray()
        self.partial_since = None
        self.received = 0

    # 入口 / Entry: Lines.available.
    # 功能：检查缓冲中是否已有完整换行结束的 Assuan 行。
    # Purpose: Checks whether the buffer contains a complete newline-terminated Assuan line.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: `b'\n' in self.pending`
    def available(self):
        return b'\n' in self.pending

    # 入口 / Entry: Lines.take.
    # 功能：取出一条完整原始行和去除 CR/LF 的正文，核对协议行长。
    # Purpose: Extracts one full wire line and its CR/LF-stripped content while checking protocol line length.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: `(wire, content)`
    # 副作用 / Effects: 更新 / updates `self.partial_since`.
    # 核验 / Required checks: `end >= 0 and end + 1 <= MAX_WIRE_LINE -> 'PROTOCOL_SIZE'`; `len(content) <= MAX_LINE -> 'PROTOCOL_SIZE'`.
    def take(self):
        end = self.pending.find(b'\n')
        require(end >= 0 and end + 1 <= MAX_WIRE_LINE, 'PROTOCOL_SIZE')
        wire = bytes(self.pending[:end + 1]); del self.pending[:end + 1]
        content = wire[:-1]
        if content.endswith(b'\r'): content = content[:-1]
        require(len(content) <= MAX_LINE, 'PROTOCOL_SIZE')
        if not self.pending: self.partial_since = None
        return wire, content

    # 入口 / Entry: Lines.receive.
    # 功能：接收有界 Assuan 数据并拒绝 ancillary FD，已接收的 FD 在拒绝前关闭。
    # Purpose: Receives bounded Assuan data and refuses ancillary FDs, closing any received FDs before rejection.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `self.stream.recvmsg`, `os.close`; 更新 / updates `self.partial_since`, `self.received`.
    # 核验 / Required checks: `not ancillary and (not flags & socket.MSG_CTRUNC) -> 'PROTOCOL_ANCILLARY'`; `piece -> 'PROTOCOL_CLOSED'`; `len(self.pending) <= 65536 -> 'PROTOCOL_BUFFER'`; `len(tail) <= MAX_WIRE_LINE - 1 -> 'PROTOCOL_SIZE'`.
    def receive(self):
        # No file descriptor can travel through SSH StreamLocal. Close any
        # locally supplied ancillary FD before refusing, including truncation.
        piece, ancillary, flags, _address = self.stream.recvmsg( min(65536 - len(self.pending), 65536),
            socket.CMSG_SPACE(32), getattr(socket, 'MSG_CMSG_CLOEXEC', 0))
        for level, kind, data in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                size = struct.calcsize('i'); usable = len(data) // size * size
                for fd in struct.unpack('i' * (usable // size), data[:usable]): os.close(fd)
        require(not ancillary and not flags & socket.MSG_CTRUNC, 'PROTOCOL_ANCILLARY')
        require(piece, 'PROTOCOL_CLOSED')
        if not self.pending: self.partial_since = time.monotonic()
        self.pending.extend(piece); self.received += len(piece)
        require(len(self.pending) <= 65536, 'PROTOCOL_BUFFER')
        # Complete coalesced lines are checked separately before each release.
        tail = self.pending.rsplit(b'\n', 1)[-1]
        require(len(tail) <= MAX_WIRE_LINE - 1, 'PROTOCOL_SIZE')

    # 入口 / Entry: Lines.progress.
    # 功能：拒绝长时间没有形成完整行的部分 Assuan 数据，防止慢速连接永久占用代理。
    # Purpose: Refuses partial Assuan data that fails to complete a line in time, preventing slow peers from indefinitely occupying the broker.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 核验 / Required checks: `self.partial_since is not None and time.monotonic() - self.partial_since < 10 -> 'PROTOCOL_TIMEOUT'`.
    def progress(self):
        if self.pending and not self.available():
            require(self.partial_since is not None and time.monotonic() - self.partial_since < 10, 'PROTOCOL_TIMEOUT')


# 入口 / Entry: exact_send.
# 功能：在截止时间和归属检查下发送全部数据，处理短写并拒绝断开连接。
# Purpose: Sends all bytes under deadline and ownership checks, handling short writes and refusing closed connections.
# 输入 / Inputs: stream; data; deadline; check
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `stream.send`.
# 核验 / Required checks: `remaining > 0 -> 'PROTOCOL_TIMEOUT'`; `sent > 0 -> 'PROTOCOL_CLOSED'`.
def exact_send(stream, data, deadline, check):
    offset = 0
    while offset < len(data):
        check()
        remaining = deadline - time.monotonic()
        require(remaining > 0, 'PROTOCOL_TIMEOUT')
        if not select.select([], [stream], [], min(remaining, 1))[1]: continue
        try:
            sent = stream.send(data[offset:offset + 65536])
        except (socket.timeout, BlockingIOError):
            continue
        require(sent > 0, 'PROTOCOL_CLOSED')
        offset += sent
    check()


# 入口 / Entry: relay.
# 功能：按 Assuan 状态机转发行，等待上一命令终结响应后才放行下一命令，并拒绝 FD 传递和非法 inquiry。
# Purpose: Relays lines through an Assuan state machine, releasing the next command only after the previous terminal response and refusing FD passing or invalid inquiry traffic.
# 输入 / Inputs: stream; upstream; deadline; check
# 输出 / Returns: `None`
# 副作用 / Effects: 调用 / calls `stream.setblocking`, `upstream.setblocking`, `reader.take`, `exact_send`.
# 核验 / Required checks: `time.monotonic() < deadline -> 'PROTOCOL_TIMEOUT'`; `client.received + server.received <= MAX_SESSION_BYTES -> 'PROTOCOL_BUDGET'`; `data or comment or status or okay or error or inquire -> 'PROTOCOL_RESPONSE'`; `not (state == 'greeting' and (data or inquire or error)) -> 'PROTOCOL_GREETING'`; `state != 'idle' or comment or status -> 'PROTOCOL_STATE'`.
def relay(stream, upstream, deadline, check):
    client, server = Lines(stream), Lines(upstream)
    stream.setblocking(False); upstream.setblocking(False)
    state = 'greeting'; requests = 0; bye = False
    while True:
        check(); require(time.monotonic() < deadline, 'PROTOCOL_TIMEOUT')
        client.progress(); server.progress()
        require(client.received + server.received <= MAX_SESSION_BYTES, 'PROTOCOL_BUDGET')
        # Never release a buffered next command until the previous terminal
        # reply. While inquiring, both sides may send status/data fragments.
        eligible = [server] + ([client] if state in ['idle', 'inquiry'] else [])
        reader = next((value for value in eligible if value.available()), None)
        if reader is None:
            readable = [value.stream for value in [server, client] if len(value.pending) < 65536]
            ready = select.select(readable, [], [], min(1, max(0, deadline - time.monotonic())))[0]
            for value in [server, client]:
                if value.stream in ready:
                    check()
                    try: value.receive()
                    except BlockingIOError: continue
                    check()
            continue
        check(); wire, content = reader.take(); check()
        data = content == b'D' or content.startswith(b'D ')
        comment = not content or content.startswith(b'#')
        if reader is server:
            status = content.startswith(b'S ')
            okay = content == b'OK' or content.startswith(b'OK ')
            error = content.startswith(b'ERR ') and re.match(br'^ERR [0-9]+(?: |$)', content)
            inquire = content.startswith(b'INQUIRE ') and len(content) > 8
            require(data or comment or status or okay or error or inquire, 'PROTOCOL_RESPONSE')
            require(not (state == 'greeting' and (data or inquire or error)), 'PROTOCOL_GREETING')
            require(state != 'idle' or comment or status, 'PROTOCOL_STATE')
            if not data: require(b'\x00' not in content, 'PROTOCOL_CONTROL')
            if inquire: require(state == 'server', 'PROTOCOL_STATE')
            check(); exact_send(stream, wire, deadline, check)
            if okay or error:
                if bye: return
                state = 'idle'
            elif inquire:
                state = 'inquiry'
        else:
            if comment:
                check(); exact_send(upstream, wire, deadline, check); continue
            if state == 'inquiry':
                require(data or content in [b'END', b'CAN'], 'PROTOCOL_INQUIRY')
                if not data: state = 'server'
            else:
                require(not data and b'\x00' not in content, 'PROTOCOL_COMMAND')
                command = content.split(b' ', 1)[0]
                require(re.fullmatch(br'[A-Z][A-Z0-9_]*', command) and command not in
                        [b'INPUT', b'OUTPUT', b'END', b'CAN'], 'PROTOCOL_COMMAND')
                requests += 1; require(requests <= MAX_REQUESTS, 'PROTOCOL_REQUEST_BUDGET')
                bye = command == b'BYE'; state = 'server'
            check(); exact_send(upstream, wire, deadline, check)


# 入口 / Entry: publish_root.
# 功能：仅对新建 root 控制根目录发布 0755 遍历权限，既有目录必须已符合约定。
# Purpose: Publishes 0755 traversal permission only on a newly created root control directory; existing directories must already satisfy the contract.
# 输入 / Inputs: path
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `os.mkdir`, `os.fchmod`, `os.fsync`, `os.close`.
# 收尾 / Finalization: `os.close(fd)`.
def publish_root(path):
    if not os.path.lexists(path):
        os.mkdir(path, 0o700)
        fd = directory(path, 0o700)
        try: os.fchmod(fd, 0o755); os.fsync(fd)
        finally: os.close(fd)
    os.close(directory(path, 0o755))


# 入口 / Entry: create_lease_parent.
# 功能：独占创建本租约父目录，固定 root 所有者、项目组和 0710 权限，并返回物理身份。
# Purpose: Exclusively creates this lease's parent, pins root ownership/project group/0710 mode and returns its physical identity.
# 输入 / Inputs: path; gid
# 输出 / Returns: `info(os.fstat(fd))`
# 副作用 / Effects: 调用 / calls `os.mkdir`, `os.fchown`, `os.fchmod`, `os.fsync`, `os.close`.
# 核验 / Required checks: `not os.path.lexists(path) -> 'RESOURCE_EXISTS'`.
# 收尾 / Finalization: `os.close(fd)`.
def create_lease_parent(path, gid):
    require(not os.path.lexists(path), 'RESOURCE_EXISTS')
    os.mkdir(path, 0o700)
    fd = directory(path, 0o700)
    try:
        os.fchown(fd, 0, gid); os.fchmod(fd, 0o710); os.fsync(fd)
        return info(os.fstat(fd))
    finally: os.close(fd)


# 入口 / Entry: home_open.
# 功能：打开并核对记录中的原 GPG home，冻结阶段只接受对应 root 私有身份。
# Purpose: Opens/checks the recorded original GPG home, accepting only the corresponding root-private identity during frozen phases.
# 输入 / Inputs: value; frozen=False
# 输出 / Returns: `fd`
# 副作用 / Effects: 调用 / calls `os.open`, `os.close`.
# 核验 / Required checks: `info(os.fstat(parent)) == value['homeDirectory'] -> 'HOME_PARENT_REPLACED'`; `current == expected and info(os.stat('home', dir_fd=parent, follow_symlinks=False)) == current -> 'HOME_REPLACED'`.
# 拒绝 / Refusals: `re-raise`.
# 收尾 / Finalization: `os.close(parent)`.
def home_open(value, frozen=False):
    context = value['context']; parent_path = home_path(context).rsplit('/', 1)[0]
    parent = directory(parent_path, 0o710, context['identity']['gid'])
    try:
        require(info(os.fstat(parent)) == value['homeDirectory'], 'HOME_PARENT_REPLACED')
        fd = os.open('home', os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=parent)
        current = info(os.fstat(fd))
        expected = {**value['home'], 'uid': 0, 'gid': 0, 'mode': 0o700} if frozen else value['home']
        require(current == expected and info(os.stat('home', dir_fd=parent, follow_symlinks=False)) == current, 'HOME_REPLACED')
        return fd
    except BaseException:
        if 'fd' in locals(): os.close(fd)
        raise
    finally: os.close(parent)


# 入口 / Entry: routing_checked.
# 功能：核对原 S.gpg-agent 重定向文件的内容摘要、权限及 inode，拒绝被替换的路由。
# Purpose: Checks content, digest, mode and inode of the original S.gpg-agent redirection file, rejecting replaced routing.
# 输入 / Inputs: value; home
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `os.open`, `os.read`, `os.close`.
# 核验 / Required checks: `expected is not None -> 'REDIRECT_UNCONFIRMED'`; `info(meta) == expected['object'] and stat.S_ISREG(meta.st_mode) and (meta.st_nlink == 1) and (meta.st_uid == 0) and (meta.st_… -> 'REDIRECT_REPLACED'`; `body == redirect_bytes(context) and (not os.read(fd, 1)) and (info(os.fstat(fd)) == expected['object']) -> 'REDIRECT_REPLACED'`; `info(os.stat('S.gpg-agent', dir_fd=home, follow_symlinks=False)) == expected['object'] -> 'REDIRECT_REPLACED'`.
# 收尾 / Finalization: `os.close(fd)`.
def routing_checked(value, home):
    expected = value['redirect']; context = value['context']
    require(expected is not None, 'REDIRECT_UNCONFIRMED')
    fd = os.open('S.gpg-agent', os.O_RDONLY | FLAGS, dir_fd=home)
    try:
        meta = os.fstat(fd)
        require(info(meta) == expected['object'] and stat.S_ISREG(meta.st_mode) and meta.st_nlink == 1 and
                meta.st_uid == 0 and meta.st_gid == context['identity']['gid'] and stat.S_IMODE(meta.st_mode) == 0o440 and
                meta.st_size == len(redirect_bytes(context)), 'REDIRECT_REPLACED')
        body = os.read(fd, 512)
        require(body == redirect_bytes(context) and not os.read(fd, 1) and
                info(os.fstat(fd)) == expected['object'], 'REDIRECT_REPLACED')
        require(info(os.stat('S.gpg-agent', dir_fd=home, follow_symlinks=False)) == expected['object'], 'REDIRECT_REPLACED')
    finally: os.close(fd)


# 入口 / Entry: create_home.
# 功能：逐步建立项目 GPG home 和只读重定向文件，每个物理创建阶段保存可恢复证据。
# Purpose: Builds the project's GPG home and read-only redirection file, persisting recoverable evidence at each physical creation phase.
# 输入 / Inputs: context; value
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `publish_root`, `save_record`, `os.mkdir`, `os.open`, `os.fchown`, `os.fchmod`; 更新 / updates `value['homeDirectory']`, `value['home']`, `value['redirect']`.
# 核验 / Required checks: `len(body) <= 511 -> 'REDIRECT_SIZE'`.
# 收尾 / Finalization: `if home is not None: os.close(home)`; `os.close(parent)`; `os.close(fd)`.
def create_home(context, value):
    publish_root(HOMES)
    parent_path = home_path(context).rsplit('/', 1)[0]
    value['homeDirectory'] = create_lease_parent(parent_path, context['identity']['gid']); save_record(value)
    parent = directory(parent_path, 0o710, context['identity']['gid'])
    home = None
    try:
        os.mkdir('home', 0o700, dir_fd=parent)
        home = os.open('home', os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=parent)
        os.fchown(home, context['identity']['uid'], context['identity']['gid']); os.fchmod(home, 0o700)
        value['home'] = info(os.fstat(home)); os.fsync(parent); save_record(value)
        fd = os.open('S.gpg-agent', os.O_WRONLY | os.O_CREAT | os.O_EXCL | FLAGS, 0o600, dir_fd=home)
        try:
            body = redirect_bytes(context); require(len(body) <= 511, 'REDIRECT_SIZE')
            with os.fdopen(fd, 'wb', closefd=False) as target:
                target.write(body); target.flush()
            os.fchown(fd, 0, context['identity']['gid']); os.fchmod(fd, 0o440); os.fsync(fd)
            value['redirect'] = {'object': info(os.fstat(fd)), 'sha256': hashlib.sha256(body).hexdigest()}
            os.fsync(home); save_record(value)
        finally: os.close(fd)
    finally:
        if home is not None: os.close(home)
        os.close(parent)


# 入口 / Entry: source_exclusive.
# 功能：持全局资源锁扫描其他有效记录，拒绝同一原来源同时属于另一未关闭租约。
# Purpose: Scans other valid records under the global resource lock, refusing one original source shared by another unclosed lease.
# 输入 / Inputs: context; source
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `os.close`.
# 核验 / Required checks: `len(names) <= 1024 -> 'RESOURCE_LIMIT'`; `name == record_name(other_context) -> 'OTHER_RESOURCE_UNCONFIRMED'`; `other['phase'] == 'closed' or other['source'] != source -> 'SOURCE_SHARED'`.
# 收尾 / Finalization: `os.close(records)`.
def source_exclusive(context, source):
    # The caller holds resources.lock while choosing a physical listener.
    records = directory(RECORDS, 0o700)
    try:
        names = os.listdir(records); require(len(names) <= 1024, 'RESOURCE_LIMIT')
        for name in names:
            if not name.endswith('.json') or name == record_name(context):
                continue
            other = json.loads(regular(records, name).decode('utf-8'))
            other_context = context_checked(other['context'])
            require(name == record_name(other_context), 'OTHER_RESOURCE_UNCONFIRMED')
            record_checked(other, other_context)
            require(other['phase'] == 'closed' or other['source'] != source, 'SOURCE_SHARED')
    finally:
        os.close(records)


# 入口 / Entry: broker.
# 功能：创建固定来源的 Unix 代理端点，持久发布 ready 后有界接入并核对每个任务 peer。
# Purpose: Creates a Unix proxy endpoint for the pinned source, durably publishes readiness and admits bounded connections while validating each task peer.
# 输入 / Inputs: context; value; lock
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `threading.Event`, `set`, `threading.Lock`, `process.close`, `save_record`, `publish_root`; 更新 / updates `value['broker']`, `value['source']`, `value['endpointDirectory']`, `value['endpoint']`.
# 核验 / Required checks: `source.parent_info == value['sourceDirectory'] -> 'SOURCE_REPLACED'`; `stat.S_ISSOCK(current.st_mode) -> 'ENDPOINT_INVALID'`.
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
        source = Source(source_path(context))
        require(source.parent_info == value['sourceDirectory'], 'SOURCE_REPLACED')
        value['source'] = source.record(); save_record(value)
        source_exclusive(context, value['source'])
        publish_root(SOCKETS)
        endpoint = endpoint_path(context)
        value['endpointDirectory'] = create_lease_parent(endpoint, context['identity']['gid']); save_record(value)
        endpoint_fd = directory(endpoint, 0o710, context['identity']['gid'])
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind('/proc/self/fd/' + str(endpoint_fd) + '/agent')
        current = os.stat('agent', dir_fd=endpoint_fd, follow_symlinks=False)
        require(stat.S_ISSOCK(current.st_mode), 'ENDPOINT_INVALID')
        os.chown('agent', 0, context['identity']['gid'], dir_fd=endpoint_fd, follow_symlinks=False)
        os.chmod('agent', 0o660, dir_fd=endpoint_fd, follow_symlinks=False)
        value['endpoint'] = info(os.stat('agent', dir_fd=endpoint_fd, follow_symlinks=False))
        create_home(context, value)
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
                # 副作用 / Effects: 调用 / calls `stopped.is_set`, `read_record`, `os.close`, `home_open`.
                # 核验 / Required checks: `not stopped.is_set() and time.monotonic() < deadline -> 'RESOURCE_REVOKED'`; `current == value and current['homeCleanup'] is None -> 'RESOURCE_CHANGED'`; `info(os.fstat(fd)) == value['endpointDirectory'] and info(os.stat('agent', dir_fd=fd, follow_symlinks=False)) == value['endpo… -> 'ENDPOINT_REPLACED'`.
                # 收尾 / Finalization: `os.close(fd)`; `os.close(home)`.
                def check():
                    require(not stopped.is_set() and time.monotonic() < deadline, 'RESOURCE_REVOKED')
                    peer.task(context, value['scope']); source.check()
                    current = read_record(context)
                    require(current == value and current['homeCleanup'] is None, 'RESOURCE_CHANGED')
                    fd = directory(endpoint, 0o710, context['identity']['gid'])
                    try:
                        require(info(os.fstat(fd)) == value['endpointDirectory'] and
                                info(os.stat('agent', dir_fd=fd, follow_symlinks=False)) == value['endpoint'], 'ENDPOINT_REPLACED')
                    finally:
                        os.close(fd)
                    home = home_open(value)
                    try: routing_checked(value, home)
                    finally: os.close(home)
                check(); upstream = source.connect(); check()
                relay(stream, upstream, deadline, check)
            except (Refused, OSError, ValueError, IndexError):
                pass
            finally:
                if upstream is not None: upstream.close()
                if peer is not None: peer.close()
                stream.close()
                with mutex: peers.discard(stream)
        connections = 0
        while not stopped.is_set() and time.monotonic() < deadline:
            source.check()
            try:
                stream, _ = listener.accept()
            except socket.timeout:
                continue
            with mutex:
                connections += 1
                if len(peers) >= MAX_CONNECTIONS or connections > MAX_TOTAL_CONNECTIONS: stream.close(); continue
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


# 入口 / Entry: initial_record.
# 功能：创建尚未接管任务、来源和端点的 preparing 控制记录。
# Purpose: Creates a preparing control record before adopting any task, source or endpoint.
# 输入 / Inputs: context
# 输出 / Returns: `{'version': 1, 'context': context, 'phase': 'preparing', 'scope': None, 'sourceDirectory': None, 'source': None, 'endpointDirectory': None, 'endpoint': Non…`
def initial_record(context):
    return {'version': 1, 'context': context, 'phase': 'preparing', 'scope': None, 'sourceDirectory': None,
            'source': None, 'endpointDirectory': None, 'endpoint': None, 'homeDirectory': None, 'home': None,
            'redirect': None, 'broker': None, 'homeCleanup': None, 'failure': None}


# 入口 / Entry: prepare.
# 功能：在原 boot 且任务尚未运行时建立私有来源目录，持久发布 prepared 供单次任务接管。
# Purpose: Creates a private source directory on the original boot before task activity and durably publishes prepared for one task adoption.
# 输入 / Inputs: context
# 输出 / Returns: `{'phase': 'prepared', 'context': context, 'sourcePath': source_path(context), 'record': prior}`; `{'phase': 'prepared', 'context': context, 'sourcePath': source_path(context), 'record': value}`
# 副作用 / Effects: 调用 / calls `locked`, `read_record`, `os.close`, `save_record`, `os.fsync`; 更新 / updates `value['sourceDirectory']`, `value['phase']`, `value['failure']`.
# 核验 / Required checks: `boot() == context['owner']['bootId'] -> 'BOOT_CHANGED'`; `not os.path.lexists(scope_path(context)) -> 'SCOPE_ACTIVE'`; `prior['phase'] == 'prepared' and prior['scope'] is None and (prior['homeCleanup'] is None) -> 'RESOURCE_EXISTS'`; `info(os.fstat(parent)) == prior['sourceDirectory'] and (not os.listdir(parent)) -> 'SOURCE_REPLACED'`; `not os.path.lexists(path) -> 'RESOURCE_EXISTS'`.
# 拒绝 / Refusals: `re-raise`.
# 收尾 / Finalization: `os.close(lock)`; `os.close(parent)`.
def prepare(context):
    require(boot() == context['owner']['bootId'], 'BOOT_CHANGED')
    require(not os.path.lexists(scope_path(context)), 'SCOPE_ACTIVE')
    lock = locked(create=True)
    value = None
    try:
        prior = read_record(context)
        if prior is not None:
            require(prior['phase'] == 'prepared' and prior['scope'] is None and prior['homeCleanup'] is None, 'RESOURCE_EXISTS')
            parent = directory(source_path(context).rsplit('/', 1)[0], 0o700)
            try:
                require(info(os.fstat(parent)) == prior['sourceDirectory'] and not os.listdir(parent), 'SOURCE_REPLACED')
            finally: os.close(parent)
            return {'phase': 'prepared', 'context': context, 'sourcePath': source_path(context), 'record': prior}
        for path in [source_path(context).rsplit('/', 1)[0], endpoint_path(context), home_path(context).rsplit('/', 1)[0]]:
            require(not os.path.lexists(path), 'RESOURCE_EXISTS')
        value = initial_record(context); save_record(value)
        os.close(directory(SOURCES, 0o700, create=True))
        parent_path = source_path(context).rsplit('/', 1)[0]
        parent = directory(parent_path, 0o700, create=True)
        try: value['sourceDirectory'] = info(os.fstat(parent)); os.fsync(parent)
        finally: os.close(parent)
        require(boot() == context['owner']['bootId'] and not os.path.lexists(scope_path(context)), 'BOOT_CHANGED')
        value['phase'] = 'prepared'; save_record(value)
        return {'phase': 'prepared', 'context': context, 'sourcePath': source_path(context), 'record': value}
    except BaseException as error:
        if value is not None:
            value['phase'] = 'failed'; value['failure'] = str(error) if isinstance(error, Refused) else 'PREPARE_FAILED'
            try: save_record(value)
            except BaseException: pass
        raise
    finally: os.close(lock)


# 入口 / Entry: adopt_task_scope.
# 功能：把 prepared 记录一次性绑定到原任务 cgroup 控制票据并进入 preparing。
# Purpose: Binds a prepared record once to the original task-cgroup control ticket and enters preparing.
# 输入 / Inputs: context; scope
# 输出 / Returns: `value`
# 副作用 / Effects: 调用 / calls `read_record`, `os.close`, `save_record`; 更新 / updates `value['scope']`, `value['phase']`.
# 核验 / Required checks: `value is not None and value['phase'] == 'prepared' and (value['scope'] is None) and (value['homeCleanup'] is None) -> 'RESOURCE_NOT_PREPARED'`; `info(os.fstat(parent)) == value['sourceDirectory'] -> 'SOURCE_REPLACED'`; `not os.path.lexists(endpoint_path(context)) and (not os.path.lexists(home_path(context).rsplit('/', 1)[0])) -> 'RESOURCE_EXISTS'`.
# 收尾 / Finalization: `os.close(parent)`.
def adopt_task_scope(context, scope):
    # One adoption under resources.lock; a later invocation cannot retarget a
    # prepared listener to another control token, inode, run or cgroup.
    value = read_record(context)
    require(value is not None and value['phase'] == 'prepared' and value['scope'] is None and
            value['homeCleanup'] is None, 'RESOURCE_NOT_PREPARED')
    parent = directory(source_path(context).rsplit('/', 1)[0], 0o700)
    try: require(info(os.fstat(parent)) == value['sourceDirectory'], 'SOURCE_REPLACED')
    finally: os.close(parent)
    require(not os.path.lexists(endpoint_path(context)) and not os.path.lexists(home_path(context).rsplit('/', 1)[0]), 'RESOURCE_EXISTS')
    value['scope'] = scope; value['phase'] = 'preparing'
    save_record(value)
    return value


# 入口 / Entry: run.
# 功能：单次接管 prepared 原来源到任务 cgroup，fork 代理后核验 ready，再 exec 固定 launcher。
# Purpose: Adopts the prepared original source into the task cgroup once, forks the broker, validates readiness and then execs the fixed launcher.
# 输入 / Inputs: context; launcher
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `open`, `current.read(4096).splitlines`, `current.read`, `locked`, `os.fork`, `os.open`.
# 核验 / Required checks: `isinstance(launcher, str) and launcher and (len(launcher.encode('utf-8')) <= 65536) and ('\x00' not in launcher) -> 'LAUNCHER_INVALID'`; `current.read(4096).splitlines() == ['0::/sakura-task-' + context['owner']['runId']] -> 'CONTROLLER_SCOPE'`; `value is not None and value['phase'] != 'failed' -> (value or {}).get('failure') or 'BROKER_READY_FAIL…`; `value['broker']['pid'] == pid -> 'BROKER_REPLACED'`; `proof.start == value['broker']['startTicks'] -> 'BROKER_REPLACED'`.
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
    value = adopt_task_scope(context, scope)
    pid = os.fork()
    if pid == 0:
        null = os.open('/dev/null', os.O_RDWR | os.O_CLOEXEC)
        for fd in [0, 1, 2]: os.dup2(null, fd)
        if null > 2: os.close(null)
        for name in os.listdir('/proc/self/fd'):
            if name.isdigit() and int(name) > 2 and int(name) != lock:
                try: os.close(int(name))
                except OSError: pass
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


# 入口 / Entry: source_peer_ended.
# 功能：通过 pidfd 与启动 ticks 观察原来源进程是否退出，不发送信号也不接管重用 PID。
# Purpose: Observes original source-process exit via pidfd/start ticks without signaling it or adopting a reused PID.
# 输入 / Inputs: peer
# 输出 / Returns: `True`; `fields[19].decode('ascii') != peer['startTicks'] or fields[0] in [b'Z', b'X'] or bool(select.select([pidfd], [], [], 0)[0])`
# 副作用 / Effects: 调用 / calls `os.pidfd_open`, `os.open`, `os.read`, `os.close`.
# 核验 / Required checks: `bool(select.select([pidfd], [], [], 0)[0]) -> 'SOURCE_CLOSE_UNCONFIRMED'`; `len(fields) <= 4096 and (not os.read(fd, 1)) -> 'SOURCE_CLOSE_UNCONFIRMED'`; `len(fields) == 2 -> 'SOURCE_CLOSE_UNCONFIRMED'`; `len(fields) >= 20 and fields[19].isdigit() -> 'SOURCE_CLOSE_UNCONFIRMED'`.
# 收尾 / Finalization: `if parent is not None: os.close(parent)`; `os.close(pidfd)`; `os.close(fd)`.
def source_peer_ended(peer):
    """Observe the original birth without signalling or adopting a reused PID."""
    try:
        pidfd = os.pidfd_open(peer['pid'], 0)
    except ProcessLookupError:
        return True
    parent = None
    try:
        if select.select([pidfd], [], [], 0)[0]: return True
        try:
            parent = os.open('/proc/' + str(peer['pid']), os.O_RDONLY | os.O_DIRECTORY | FLAGS)
        except FileNotFoundError:
            require(bool(select.select([pidfd], [], [], 0)[0]), 'SOURCE_CLOSE_UNCONFIRMED')
            return True
        try:
            fd = os.open('stat', os.O_RDONLY | FLAGS, dir_fd=parent)
        except FileNotFoundError:
            require(bool(select.select([pidfd], [], [], 0)[0]), 'SOURCE_CLOSE_UNCONFIRMED')
            return True
        try:
            fields = os.read(fd, 4097)
            require(len(fields) <= 4096 and not os.read(fd, 1), 'SOURCE_CLOSE_UNCONFIRMED')
        finally:
            os.close(fd)
        fields = fields.rsplit(b') ', 1)
        require(len(fields) == 2, 'SOURCE_CLOSE_UNCONFIRMED')
        fields = fields[1].split()
        require(len(fields) >= 20 and fields[19].isdigit(), 'SOURCE_CLOSE_UNCONFIRMED')
        return fields[19].decode('ascii') != peer['startTicks'] or fields[0] in [b'Z', b'X'] or bool(select.select([pidfd], [], [], 0)[0])
    finally:
        if parent is not None: os.close(parent)
        os.close(pidfd)


# 入口 / Entry: source_listener_absent.
# 功能：有界读取当前 root 网络命名空间的 Unix socket 表，确认精确来源路径无内核 socket。
# Purpose: Reads the root network namespace's Unix socket table within a bound to confirm no kernel socket has the exact source path.
# 输入 / Inputs: path
# 输出 / Returns: `False`; `True`
# 副作用 / Effects: 调用 / calls `os.open`, `os.read`, `os.close`.
# 核验 / Required checks: `len(data) <= 4 * 1024 * 1024 -> 'SOURCE_CLOSE_UNCONFIRMED'`; `bool(rows) and rows[0].split() == [b'Num', b'RefCount', b'Protocol', b'Flags', b'Type', b'St', b'Inode', b'Path'] -> 'SOURCE_CLOSE_UNCONFIRMED'`; `len(fields) >= 7 -> 'SOURCE_CLOSE_UNCONFIRMED'`.
# 收尾 / Finalization: `os.close(fd)`.
def source_listener_absent(path):
    # This controller remains in sshd's root network namespace. Any kernel
    # socket with this exact path prevents removal, including accepted sockets.
    fd = os.open('/proc/net/unix', os.O_RDONLY | FLAGS)
    try:
        data = bytearray()
        while True:
            block = os.read(fd, 65536)
            if not block: break
            data.extend(block)
            require(len(data) <= 4 * 1024 * 1024, 'SOURCE_CLOSE_UNCONFIRMED')
    finally:
        os.close(fd)
    rows = bytes(data).splitlines()
    require(bool(rows) and rows[0].split() == [b'Num', b'RefCount', b'Protocol', b'Flags', b'Type', b'St', b'Inode', b'Path'], 'SOURCE_CLOSE_UNCONFIRMED')
    for line in rows[1:]:
        fields = line.split(None, 7)
        require(len(fields) >= 7, 'SOURCE_CLOSE_UNCONFIRMED')
        if len(fields) == 8 and fields[7] == path.encode('ascii'): return False
    return True


# 入口 / Entry: source_absent.
# 功能：确认原来源进程与内核 socket 均消失，只允许移除仍匹配原票据的遗留 socket inode。
# Purpose: Confirms original source-process/kernel-socket absence, permitting removal only of a leftover socket inode still matching the original ticket.
# 输入 / Inputs: source
# 输出 / Returns: `None`
# 副作用 / Effects: 调用 / calls `source_listener_absent`, `os.unlink`, `os.fsync`, `os.close`.
# 核验 / Required checks: `info(os.fstat(parent)) == source['parent'] and info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == source['socket'] -> 'SOURCE_REPLACED'`; `info(os.fstat(current)) == source['parent'] and info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == source['socket'] -> 'SOURCE_REPLACED'`; `source_peer_ended(source['peer']) and source_listener_absent(source['path']) -> 'SOURCE_CLOSE_UNCONFIRMED'`; `info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == source['socket'] -> 'SOURCE_REPLACED'`; `time.monotonic() < deadline -> 'SOURCE_CLOSE_UNCONFIRMED'`.
# 收尾 / Finalization: `os.close(parent)`; `os.close(current)`.
def source_absent(source):
    if source is None: return
    deadline = time.monotonic() + 3
    parent_path, name = source['path'].rsplit('/', 1)
    while True:
        ended = source_peer_ended(source['peer'])
        absent_listener = source_listener_absent(source['path'])
        if os.path.lexists(source['path']):
            parent = directory(parent_path, 0o700, source=True)
            try:
                require(info(os.fstat(parent)) == source['parent'] and
                        info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == source['socket'], 'SOURCE_REPLACED')
                if ended and absent_listener:
                    # OpenSSH may leave its filesystem entry after both the
                    # real unforward ACK and transport close. Remove only the
                    # original inode in its original root-private directory.
                    current = directory(parent_path, 0o700, source=True)
                    try:
                        require(info(os.fstat(current)) == source['parent'] and
                                info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == source['socket'], 'SOURCE_REPLACED')
                        require(source_peer_ended(source['peer']) and source_listener_absent(source['path']), 'SOURCE_CLOSE_UNCONFIRMED')
                        require(info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == source['socket'], 'SOURCE_REPLACED')
                        os.unlink(name, dir_fd=parent); os.fsync(parent)
                    finally:
                        os.close(current)
            finally:
                os.close(parent)
        if ended and absent_listener and not os.path.lexists(source['path']): return
        require(time.monotonic() < deadline, 'SOURCE_CLOSE_UNCONFIRMED')
        time.sleep(0.05)


# 入口 / Entry: absent.
# 功能：核验给定控制根目录中本租约对象确实缺失，存在或证据不明时拒绝。
# Purpose: Checks true absence of this lease object under the given control root, refusing presence or ambiguous evidence.
# 输入 / Inputs: root_path; context; mode; code='RESOURCE_UNCONFIRMED'
# 输出 / Returns: `None`
# 副作用 / Effects: 调用 / calls `os.close`.
# 核验 / Required checks: `not os.path.lexists(root_path + '/' + context['resource']['leaseId']) -> code`.
# 拒绝 / Refusals: `Refused(code)`.
# 收尾 / Finalization: `os.close(parent)`.
def absent(root_path, context, mode, code='RESOURCE_UNCONFIRMED'):
    if os.path.lexists(root_path):
        parent = directory(root_path, mode)
        try:
            try: os.stat(context['resource']['leaseId'], dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError: return
            raise Refused(code)
        finally: os.close(parent)
    require(not os.path.lexists(root_path + '/' + context['resource']['leaseId']), code)


# 入口 / Entry: remove_empty_lease.
# 功能：只删除与原记录身份一致且确实为空的租约目录，不递归清理未知内容。
# Purpose: Removes only a genuinely empty lease directory matching its original record identity, never recursively deleting unknown contents.
# 输入 / Inputs: root_path; context; original; mode; gid=0
# 输出 / Returns: `None`
# 副作用 / Effects: 调用 / calls `os.open`, `os.close`, `os.fsync`.
# 核验 / Required checks: `original is not None and info(current) == original -> 'LEASE_REPLACED'`; `info(os.fstat(fd)) == original and (not os.listdir(fd)) -> 'LEASE_CONTENT_CHANGED'`; `stat.S_IMODE(current.st_mode) == mode and current.st_uid == 0 and (current.st_gid == gid) -> 'LEASE_REPLACED'`; `info(os.stat(lease, dir_fd=parent, follow_symlinks=False)) == original -> 'LEASE_REPLACED'`.
# 收尾 / Finalization: `os.close(parent)`; `os.close(fd)`.
def remove_empty_lease(root_path, context, original, mode, gid=0):
    if not os.path.lexists(root_path):
        absent(root_path, context, 0o700 if root_path == SOURCES else 0o755); return
    parent = directory(root_path, 0o700 if root_path == SOURCES else 0o755)
    lease = context['resource']['leaseId']
    try:
        try: current = os.stat(lease, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError: return
        require(original is not None and info(current) == original, 'LEASE_REPLACED')
        fd = os.open(lease, os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=parent)
        try:
            require(info(os.fstat(fd)) == original and not os.listdir(fd), 'LEASE_CONTENT_CHANGED')
            require(stat.S_IMODE(current.st_mode) == mode and current.st_uid == 0 and current.st_gid == gid, 'LEASE_REPLACED')
        finally: os.close(fd)
        require(info(os.stat(lease, dir_fd=parent, follow_symlinks=False)) == original, 'LEASE_REPLACED')
        os.rmdir(lease, dir_fd=parent); os.fsync(parent)
    finally: os.close(parent)


# 入口 / Entry: valid_data_name.
# 功能：验证允许删除的 GPG 数据成员名，排除点路径、分隔符及异常字符。
# Purpose: Validates removable GPG data-member names, excluding dot paths, separators and abnormal characters.
# 输入 / Inputs: name
# 输出 / Returns: `isinstance(name, str) and re.fullmatch('[A-Za-z0-9._#=+\\-~]{1,255}', name) and (name not in ['.', '..'])`
def valid_data_name(name):
    return isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9._#=+\-~]{1,255}', name) and name not in ['.', '..']


# 入口 / Entry: no_home_mounts.
# 功能：检查 mountinfo，拒绝 GPG home 或其后代包含挂载点。
# Purpose: Checks mountinfo and refuses mounts at or below the GPG home.
# 输入 / Inputs: context
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `open`.
# 核验 / Required checks: `len(fields) > 6 -> 'MOUNTINFO_INVALID'`; `fields[4] != path and (not fields[4].startswith(path + '/')) -> 'HOME_MOUNTED'`.
def no_home_mounts(context):
    path = home_path(context)
    with open('/proc/self/mountinfo', encoding='ascii') as source:
        for line in source:
            fields = line.split()
            require(len(fields) > 6, 'MOUNTINFO_INVALID')
            require(fields[4] != path and not fields[4].startswith(path + '/'), 'HOME_MOUNTED')


# 入口 / Entry: freeze_home.
# 功能：先持久记录冻结意图，再把原 GPG home 变为 root 私有目录并保存冻结回执。
# Purpose: Durably records freeze intent before making the original GPG home root-private and persisting the frozen receipt.
# 输入 / Inputs: value
# 输出 / Returns: `home`
# 副作用 / Effects: 调用 / calls `home_open`, `os.close`, `save_record`, `os.open`, `os.fchown`, `os.fchmod`; 更新 / updates `value['homeCleanup']`, `transition['frozenHome']`, `transition['phase']`.
# 核验 / Required checks: `value['phase'] != 'ready' -> 'REDIRECT_UNCONFIRMED'`; `info(os.fstat(parent)) == value['homeDirectory'] -> 'HOME_PARENT_REPLACED'`; `current == target or (transition['phase'] == 'freeze-intent' and current == value['home']) -> 'HOME_REPLACED'`; `info(os.stat('home', dir_fd=parent, follow_symlinks=False)) == current -> 'HOME_REPLACED'`; `info(os.fstat(home)) == target and info(os.stat('home', dir_fd=parent, follow_symlinks=False)) == target -> 'HOME_REPLACED'`.
# 拒绝 / Refusals: `Refused('REDIRECT_UNCONFIRMED')`; `re-raise`.
# 收尾 / Finalization: `os.close(fd)`; `os.close(parent)`.
def freeze_home(value):
    transition = value['homeCleanup']
    if transition is None:
        fd = home_open(value)
        try:
            if value['redirect'] is not None:
                try: os.stat('S.gpg-agent', dir_fd=fd, follow_symlinks=False)
                except FileNotFoundError: pass
                else: routing_checked(value, fd)
            else:
                # A failed pre-RUN creation may have published the exact home
                # before creating its redirect. Missing metadata authorizes
                # only confirmed absence, never an unknown routing inode.
                require(value['phase'] != 'ready', 'REDIRECT_UNCONFIRMED')
                try: os.stat('S.gpg-agent', dir_fd=fd, follow_symlinks=False)
                except FileNotFoundError: pass
                else: raise Refused('REDIRECT_UNCONFIRMED')
        finally: os.close(fd)
        transition = {'phase': 'freeze-intent', 'frozenHome': None, 'directories': []}
        value['homeCleanup'] = transition; save_record(value)
    context = value['context']; parent_path = home_path(context).rsplit('/', 1)[0]
    parent = directory(parent_path, 0o710, context['identity']['gid'])
    home = None
    try:
        require(info(os.fstat(parent)) == value['homeDirectory'], 'HOME_PARENT_REPLACED')
        home = os.open('home', os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=parent)
        current = info(os.fstat(home)); target = {**value['home'], 'uid': 0, 'gid': 0, 'mode': 0o700}
        require(current == target or (transition['phase'] == 'freeze-intent' and current == value['home']), 'HOME_REPLACED')
        require(info(os.stat('home', dir_fd=parent, follow_symlinks=False)) == current, 'HOME_REPLACED')
        if current != target:
            os.fchown(home, 0, 0); os.fchmod(home, 0o700); os.fsync(home)
        require(info(os.fstat(home)) == target and info(os.stat('home', dir_fd=parent, follow_symlinks=False)) == target, 'HOME_REPLACED')
        transition['frozenHome'] = target
        if transition['phase'] == 'freeze-intent': transition['phase'] = 'frozen'; save_record(value)
        return home
    except BaseException:
        if home is not None: os.close(home)
        raise
    finally: os.close(parent)


# 入口 / Entry: clean_home.
# 功能：在 task 已退出、无挂载及原身份确认后有界移除冻结 GPG home，持久记录每个恢复阶段。
# Purpose: Removes a frozen GPG home within bounds after task exit, mount absence and original-identity confirmation, persisting each recovery phase.
# 输入 / Inputs: value
# 输出 / Returns: `None`
# 副作用 / Effects: 调用 / calls `save_record`, `os.close`, `os.fsync`; 更新 / updates `value['homeCleanup']['phase']`, `transition['phase']`.
# 核验 / Required checks: `value['home'] is None or (value['homeCleanup'] is not None and value['homeCleanup']['phase'] in ['removing', 'removed']) -> 'HOME_UNCONFIRMED'`; `value['home'] is not None and value['homeDirectory'] is not None -> 'HOME_UNCONFIRMED'`; `not os.listdir(home) and info(os.fstat(home)) == transition['frozenHome'] -> 'HOME_DATA_CHANGED'`; `info(os.fstat(parent)) == value['homeDirectory'] and info(os.stat('home', dir_fd=parent, follow_symlinks=False)) == transitio… -> 'HOME_REPLACED'`.
# 设计：先持久记录冻结意图，目录转为 root 私有后才递归处理；限时、成员数、深度和设备核对防止越界。失败保留阶段记录供同一票据重试。
# Design: Persists freeze intent before making directories root-private and recursing; time, entry, depth and device checks bound cleanup. Failure retains phase evidence for retry with the same ticket.
# 收尾 / Finalization: `os.close(home)`; `os.close(parent)`.
def clean_home(value):
    context = value['context']; path = home_path(context)
    if not os.path.lexists(path):
        require(value['home'] is None or (value['homeCleanup'] is not None and
                value['homeCleanup']['phase'] in ['removing', 'removed']), 'HOME_UNCONFIRMED')
        if value['homeCleanup'] is not None:
            value['homeCleanup']['phase'] = 'removed'; save_record(value)
        remove_empty_lease(HOMES, context, value['homeDirectory'], 0o710, context['identity']['gid']); return
    require(value['home'] is not None and value['homeDirectory'] is not None, 'HOME_UNCONFIRMED')
    no_home_mounts(context); home = freeze_home(value)
    transition = value['homeCleanup']
    deadline = time.monotonic() + 5; entries = 0
    # 入口 / Entry: clean_home.check.
    # 功能：在继续 I/O 前重新核验撤销、截止时间及本闭包捕获的资源身份。
    # Purpose: Rechecks revocation, deadline and this closure's captured resource identities before continuing I/O.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 核验 / Required checks: `time.monotonic() < deadline -> 'HOME_CLEANUP_TIMEOUT'`; `stopped(context) == context['owner']['bootId'] -> 'BOOT_CHANGED'`.
    def check():
        require(time.monotonic() < deadline, 'HOME_CLEANUP_TIMEOUT')
        require(stopped(context) == context['owner']['bootId'], 'BOOT_CHANGED')
        no_home_mounts(context)
    # 入口 / Entry: clean_home.clean.
    # 功能：核对原目录中的每个数据成员；子目录先保存冻结意图，按原 inode 冻结后递归删除。
    # Purpose: Checks every member of the original directory; child directories persist freeze intent, are frozen against their original inode and then recursively removed.
    # 输入 / Inputs: parent; relative
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `os.unlink`, `os.fsync`, `transition['directories'].append`, `save_record`, `os.open`, `os.fchown`; 更新 / updates `registered['phase']`.
    # 核验 / Required checks: `len(relative) <= MAX_HOME_DEPTH -> 'HOME_DEPTH_BUDGET'`; `entries <= MAX_HOME_ENTRIES -> 'HOME_ENTRY_BUDGET'`; `valid_data_name(name) -> 'HOME_DATA_NAME'`; `current['device'] == value['home']['device'] -> 'HOME_DEVICE_CHANGED'`; `len(components) <= MAX_HOME_DEPTH -> 'HOME_DEPTH_BUDGET'`.
    # 收尾 / Finalization: `os.close(child)`.
    def clean(parent, relative):
        nonlocal entries
        check(); require(len(relative) <= MAX_HOME_DEPTH, 'HOME_DEPTH_BUDGET')
        with os.scandir(parent) as iterator:
            for entry in iterator:
                check(); entries += 1; require(entries <= MAX_HOME_ENTRIES, 'HOME_ENTRY_BUDGET')
                name = entry.name; require(valid_data_name(name), 'HOME_DATA_NAME')
                current = info(os.stat(name, dir_fd=parent, follow_symlinks=False))
                require(current['device'] == value['home']['device'], 'HOME_DEVICE_CHANGED')
                components = relative + [name]
                if not relative and name == 'S.gpg-agent':
                    routing_checked(value, parent)
                    os.unlink(name, dir_fd=parent); os.fsync(parent); continue
                if current['type'] == stat.S_IFDIR:
                    require(len(components) <= MAX_HOME_DEPTH, 'HOME_DEPTH_BUDGET')
                    registered = next((child for child in transition['directories'] if child['path'] == components), None)
                    if registered is None:
                        require(current['uid'] == context['identity']['uid'] and current['gid'] == context['identity']['gid'], 'HOME_DIRECTORY_OWNER')
                        require(len(transition['directories']) < MAX_HOME_DIRECTORIES, 'HOME_DIRECTORY_BUDGET')
                        registered = {'path': components, 'phase': 'freeze-intent', 'original': current,
                                      'frozen': {**current, 'uid': 0, 'gid': 0, 'mode': 0o700}}
                        transition['directories'].append(registered); save_record(value)
                    # fchown and fchmod are separate syscalls. A crash between
                    # them may retain the old mode or clear its set-id bits.
                    # These exact intermediate tuples are authorized only by
                    # the durable intent for this original device/inode.
                    chowned = {**registered['original'], 'uid': 0, 'gid': 0}
                    cleared = {**chowned, 'mode': chowned['mode'] & ~0o6000}
                    require(registered['phase'] != 'removed' and (current == registered['frozen'] or
                            (registered['phase'] == 'freeze-intent' and
                             current in [registered['original'], chowned, cleared])), 'HOME_DIRECTORY_REPLACED')
                    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=parent)
                    try:
                        require(info(os.fstat(child)) == current and
                                info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == current, 'HOME_DIRECTORY_REPLACED')
                        if current != registered['frozen']:
                            os.fchown(child, 0, 0); os.fchmod(child, 0o700); os.fsync(child)
                        require(info(os.fstat(child)) == registered['frozen'] and
                                info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == registered['frozen'], 'HOME_DIRECTORY_REPLACED')
                        registered['phase'] = 'frozen'; save_record(value)
                        clean(child, components)
                        require(info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == registered['frozen'], 'HOME_DIRECTORY_REPLACED')
                    finally: os.close(child)
                    os.rmdir(name, dir_fd=parent); os.fsync(parent)
                    registered['phase'] = 'removed'; save_record(value)
                else:
                    require(current['type'] in [stat.S_IFREG, stat.S_IFLNK] and current['uid'] == context['identity']['uid'] and
                            current['gid'] == context['identity']['gid'], 'HOME_DATA_OWNER')
                    check(); require(info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == current, 'HOME_DATA_CHANGED')
                    os.unlink(name, dir_fd=parent); os.fsync(parent)
        check()
    try:
        transition['phase'] = 'removing'; save_record(value)
        clean(home, [])
        require(not os.listdir(home) and info(os.fstat(home)) == transition['frozenHome'], 'HOME_DATA_CHANGED')
    finally: os.close(home)
    parent_path = path.rsplit('/', 1)[0]; parent = directory(parent_path, 0o710, context['identity']['gid'])
    try:
        require(info(os.fstat(parent)) == value['homeDirectory'] and
                info(os.stat('home', dir_fd=parent, follow_symlinks=False)) == transition['frozenHome'], 'HOME_REPLACED')
        check(); os.rmdir('home', dir_fd=parent); os.fsync(parent)
    finally: os.close(parent)
    transition['phase'] = 'removed'; save_record(value)
    remove_empty_lease(HOMES, context, value['homeDirectory'], 0o710, context['identity']['gid'])


# 入口 / Entry: cleanup.
# 功能：在任务退出后仅按原持久票据清理代理端点，并最后发布 closed 回执。
# Purpose: Cleans proxy endpoints only against their original durable ticket after task exit, publishing a closed receipt last.
# 输入 / Inputs: context
# 输出 / Returns: `{'phase': 'closed', 'context': context, 'record': None}`; `{'phase': 'closed', 'context': context, 'record': value}`
# 副作用 / Effects: 调用 / calls `locked`, `read_record`, `save_record`, `os.close`, `os.unlink`, `os.fsync`; 更新 / updates `value['phase']`.
# 核验 / Required checks: `stopped(context) == current -> 'BOOT_CHANGED'`; `value['source'] is None or not os.path.lexists(value['source']['path']) -> 'CLOSED_SOURCE_PRESENT'`; `value['source'] is None or not os.path.lexists(value['source']['path']) -> 'OLD_BOOT_RESOURCE_PRESENT'`; `boot() == current and (not os.path.lexists(scope_path(context))) -> 'BOOT_CHANGED'`; `not os.path.lexists(source_path(context)) -> 'SOURCE_CLOSE_UNCONFIRMED'`.
# 设计：任务退出是前置条件；boot 改变时仅接受资源已缺失，不能用旧票据删除新 boot 的对象。closed 回执在全部原资源确认后提交。
# Design: Task exit is required; after boot change only resource absence is accepted, so old tickets cannot delete objects from a new boot. The closed receipt is committed after confirming all original resources.
# 收尾 / Finalization: `os.close(lock)`; `os.close(parent)`; `os.close(root)`.
def cleanup(context):
    current = stopped(context)
    if not os.path.lexists(RECORDS):
        absent(SOURCES, context, 0o700); absent(SOCKETS, context, 0o755); absent(HOMES, context, 0o755)
        require(stopped(context) == current, 'BOOT_CHANGED')
        return {'phase': 'closed', 'context': context, 'record': None}
    lock = locked()
    try:
        value = read_record(context)
        endpoint = endpoint_path(context)
        if value is None:
            absent(SOURCES, context, 0o700); absent(SOCKETS, context, 0o755); absent(HOMES, context, 0o755)
            require(stopped(context) == current, 'BOOT_CHANGED')
            return {'phase': 'closed', 'context': context, 'record': None}
        if value['phase'] == 'closed':
            absent(SOURCES, context, 0o700, 'CLOSED_SOURCE_PRESENT')
            absent(SOCKETS, context, 0o755, 'CLOSED_ENDPOINT_PRESENT'); absent(HOMES, context, 0o755, 'CLOSED_HOME_PRESENT')
            require(value['source'] is None or not os.path.lexists(value['source']['path']), 'CLOSED_SOURCE_PRESENT')
            require(stopped(context) == current, 'BOOT_CHANGED')
            return {'phase': 'closed', 'context': context, 'record': value}
        if current != context['owner']['bootId']:
            absent(SOURCES, context, 0o700, 'OLD_BOOT_RESOURCE_PRESENT')
            absent(SOCKETS, context, 0o755, 'OLD_BOOT_RESOURCE_PRESENT'); absent(HOMES, context, 0o755, 'OLD_BOOT_RESOURCE_PRESENT')
            require(value['source'] is None or not os.path.lexists(value['source']['path']), 'OLD_BOOT_RESOURCE_PRESENT')
            require(boot() == current and not os.path.lexists(scope_path(context)), 'BOOT_CHANGED')
            value['phase'] = 'closed'; save_record(value)
            return {'phase': 'closed', 'context': context, 'record': value}
        source_absent(value['source'])
        require(not os.path.lexists(source_path(context)), 'SOURCE_CLOSE_UNCONFIRMED')
        require(stopped(context) == current, 'BOOT_CHANGED')
        remove_empty_lease(SOURCES, context, value['sourceDirectory'], 0o700)
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
        clean_home(value)
        require(stopped(context) == current, 'BOOT_CHANGED')
        value['phase'] = 'closed'; save_record(value)
        return {'phase': 'closed', 'context': context, 'record': value}
    finally:
        os.close(lock)


# 入口 / Entry: main.
# 功能：仅以 root 控制账户处理严格的 prepare、run、cleanup 和 read 请求，核验完整票据后输出 JSON。
# Purpose: Processes strict prepare/run/cleanup/read requests only as the root controller, validating the full ticket before JSON output.
# 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
# 输出 / Returns: `None`
# 副作用 / Effects: 调用 / calls `set`, `run`, `read_record`.
# 核验 / Required checks: `os.getuid() == 0 and os.geteuid() == 0 and (os.getgid() == 0) -> 'CONTROLLER_OWNER'`; `request['action'] in ['prepare', 'run', 'cleanup', 'read'] and set(request) == ({'action', 'context', 'launcher'} if request[… -> 'REQUEST_INVALID'`; `value is not None -> 'RESOURCE_ABSENT'`.
def main():
    require(os.getuid() == 0 and os.geteuid() == 0 and os.getgid() == 0, 'CONTROLLER_OWNER')
    request = json.loads(base64.b64decode(sys.argv[1], validate=True))
    require(request['action'] in ['prepare', 'run', 'cleanup', 'read'] and
            set(request) == ({'action', 'context', 'launcher'} if request['action'] == 'run' else {'action', 'context'}), 'REQUEST_INVALID')
    context = context_checked(request['context'])
    if request['action'] == 'run':
        run(context, request['launcher'])
        return
    if request['action'] == 'prepare':
        result = prepare(context)
    elif request['action'] == 'cleanup':
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
        print(json.dumps({'ok': False, 'code': 'GPG_AGENT_' + code, 'detail': None}))
        sys.exit(1)
