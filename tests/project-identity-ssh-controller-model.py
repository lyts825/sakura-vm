# 模块职责：项目 SSH 权威及传输模型，执行生产定义并模拟进程、账户、文件系统与描述符证据。
# Module: Project SSH authority and transport models that execute production definitions with simulated process, account, filesystem and descriptor evidence.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
# 可移植边界模型：通过受控适配器验证生产流程；真实系统权限与进程隔离需另行运行 Linux 验证。
"""Portable SSH authority/transport checks against production definitions.

Linux process, account, filesystem and descriptor authority is simulated here;
this does not attest a live sshd, cgroup, setuid launcher or PTY on this host.
"""
import ast
import base64
import contextlib
import copy
import ctypes
import errno
import hashlib
import io
import json
import os
from pathlib import Path
import re
import selectors
import shlex
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
import types
import uuid


source = Path(sys.argv[1]).read_bytes()
tree = ast.parse(source)
definitions = ast.Module(body=[node for node in tree.body if isinstance(node, (ast.Assign, ast.FunctionDef, ast.ClassDef))], type_ignores=[])
guard = ast.Module(body=[tree.body[-1]], type_ignores=[])


# 中文功能：构造本组边界验证所需的模型对象或输入材料。
# English: Construct model objects or input material required by this boundary-verification group.
# 输入 / Inputs: 无 / none。
# 结果：返回分支计算值（`(ns, value, run, daemon, snapshot, raw, request, receipt, records)`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`(ns, value, run, daemon, snapshot, raw, request, receipt, records)`); its implementation and call sites define the actual type.
# 状态影响 / State effects: `value['account']`, `value['home']`, `ns['read']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `dict`, `exec`, `compile`, `str`.
def fixture():
    ns = dict(base64=base64, ctypes=ctypes, errno=errno, hashlib=hashlib, json=json, os=os, re=re,
              selectors=selectors, signal=signal, stat=stat, struct=struct, subprocess=subprocess,
              sys=sys, tempfile=tempfile, time=time, uuid=uuid)
    exec(compile(definitions, 'production-controller-definitions', 'exec'), ns)
    value = dict(version=1, phase='active', registryId=str(uuid.uuid4()), projectId='default',
                 identityId=str(uuid.uuid4()), revision=1, uid=20000, gid=20000,
                 directory='/workspace', directoryDevice='11', directoryInode='101',
                 homeDevice='11', homeInode='102', networkIsolation='host')
    value['account'] = 'skp' + value['identityId'].replace('-', '')[:24]
    value['home'] = ns['HOMES'] + '/' + value['identityId']
    boot, build, run_id = str(uuid.uuid4()), 'b' * 64, str(uuid.uuid4())
    run = dict(version=1, phase='active', mode='inherit-current', registryId=value['registryId'],
               identityId=value['identityId'], projectId='default', runId=run_id, revision=1,
               bootId=boot, build=build, networkDevice='11', networkInode='200',
               cgroupDevice='11', cgroupInode='300', cgroupName='system.slice/sakura-ssh-default.service', namespace='')
    daemon = dict(pid=1001, startTicks='2001', bootId=boot, cgroupName=run['cgroupName'])
    identity = {key: value[key] for key in ('registryId', 'identityId', 'revision')}
    snapshot = dict(version=1, projectId='default', runId=run_id, identity=identity,
                    environment={'TOKEN': 'project snapshot marker', 'SSH_ORIGINAL_COMMAND': 'snapshot command marker'})
    raw = json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    digest = hashlib.sha256(raw).hexdigest()
    request = dict(action='ssh-session', projectId='default', expected=identity, runId=run_id, snapshotSha256=digest)
    receipt = dict(version=1, run=copy.deepcopy(run), daemon=copy.deepcopy(daemon), snapshotSha256=digest)
    records = {ns['ssh_snapshot_path']('default'): raw,
               ns['ssh_receipt_path'](run_id): json.dumps(receipt).encode('utf-8')}
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: path, limit = 262144, missing = False。
    # 结果：返回分支计算值（`None / data`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`None / data`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `ns['refuse']`, `len`.
    def read(path, limit=262144, missing=False):
        if path not in records:
            if missing:
                return None
            ns['refuse']('RECORD_ABSENT')
        data = records[path]
        if len(data) > limit:
            ns['refuse']('RECORD_BOUND')
        return data
    ns['read'] = read
    return ns, value, run, daemon, snapshot, raw, request, receipt, records


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: ns, call, expected = None。
# 结果：返回分支计算值（`error.code`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`error.code`); its implementation and call sites define the actual type.
# 失败 / Failure: `AssertionError('expected authority refusal')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `call`, `AssertionError`.
# 检查边界 / Checked boundaries: `error.code == expected`.
def refuses(ns, call, expected=None):
    try:
        call()
    except ns['Refusal'] as error:
        if expected is not None:
            assert error.code == expected, (expected, error.code)
        return error.code
    raise AssertionError('expected authority refusal')


checks = []


# 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
# English: Read or resolve observable model data for adapted production-definition calls or assertions.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 协作入口 / Collaborators: `fixture`, `ns['ssh_snapshot_decode']`, `refuses`, `raw.replace`.
# 检查边界 / Checked boundaries: `ns['ssh_snapshot_decode'](raw, value, run['runId'], request['snapshotSha256']) == snapshot`; `ns['ssh_environment'](reserved) > 0`.
def snapshot_and_environment_bounds():
    ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
    assert ns['ssh_snapshot_decode'](raw, value, run['runId'], request['snapshotSha256']) == snapshot
    refuses(ns, lambda: ns['ssh_snapshot_decode'](raw + b' ', value, run['runId'], request['snapshotSha256']), 'SSH_SNAPSHOT_DIGEST')
    duplicate = raw.replace(b'"version":1', b'"version":1,"version":1', 1)
    refuses(ns, lambda: ns['ssh_snapshot_decode'](duplicate), 'SSH_RECORD_INVALID')
    for change in ({'version': True}, {'version': 1.0}, {'extra': 'no'}, {'runId': str(uuid.uuid4())}):
        altered = dict(snapshot, **change)
        refuses(ns, lambda: ns['ssh_snapshot_decode'](json.dumps(altered).encode(), value, run['runId']))
    altered = dict(snapshot, identity=dict(snapshot['identity'], revision=True))
    refuses(ns, lambda: ns['ssh_snapshot_decode'](json.dumps(altered).encode()), 'EXPECTED_IDENTITY')
    for environment in ({'HOME': '/root'}, {'USER': 'root'}, {'LOGNAME': 'root'}, {'LD_X': '\0'},
                        {'BROKEN': '\ud800'}, {'0_BAD': 'value'}, {'KEY': 3}, {'X' * 129: 'value'},
                        {'X': 'a' * 8191}, {str(i): 'value' for i in range(129)}):
        refuses(ns, lambda: ns['ssh_environment'](environment))
    huge = {'KEY_' + str(i): 'a' * 8180 for i in range(9)}
    refuses(ns, lambda: ns['ssh_environment'](huge), 'SSH_ENVIRONMENT_BOUND')
    reserved = {'KEY_' + str(i): '' for i in range(128)}
    assert ns['ssh_environment'](reserved) > 0
    refuses(ns, lambda: ns['ssh_payload'](value, reserved, '', None), 'SSH_ENVIRONMENT_BOUND')
    reserved = {'KEY_' + str(i): '' for i in range(126)} | {'TERM': 'old', 'VSCODE_AGENT_FOLDER': '/root/old'}
    assert struct.unpack('<8sIIIIII', ns['ssh_payload'](value, reserved, '', None)[:32])[4] == 128
    refuses(ns, lambda: ns['ssh_snapshot_decode'](b'x' * 131073), 'SSH_SNAPSHOT_BOUND')
    refuses(ns, lambda: ns['ssh_request'](dict(request, expected=None)), 'EXPECTED_IDENTITY')
    refuses(ns, lambda: ns['ssh_request'](dict(request, command='root command')), 'REQUEST_SCHEMA')


# 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
# English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `decoded[key]`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `ns['ssh_payload']`, `struct.unpack`, `len`.
# 检查边界 / Checked boundaries: `(magic, version, flags, reserved) == (b'SKIDP001', 1, 2, 0)`; `body_size == len(payload) - 32`.
def command_frame_and_identity_environment():
    ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
    command = "printf '%s\\n' '客户端' ; printf 'binary input stays on fd0'"
    environment = snapshot['environment'] | {'VSCODE_AGENT_FOLDER': '/root/escape', 'TERM': 'untrusted snapshot term'}
    payload = ns['ssh_payload'](value, environment, command, 'screen-256color')
    magic, version, flags, body_size, count, script_size, reserved = struct.unpack('<8sIIIIII', payload[:32])
    assert (magic, version, flags, reserved) == (b'SKIDP001', 1, 2, 0)
    assert body_size == len(payload) - 32
    script = payload[32:32 + script_size].decode('utf-8')
    assert script == 'exec /bin/sh -c ' + shlex.quote(command)
    offset, decoded, total = 32 + script_size, {}, script_size
    for _ in range(count):
        key_size, value_size = struct.unpack('<II', payload[offset:offset + 8])
        offset += 8
        key = payload[offset:offset + key_size].decode()
        content = payload[offset + key_size:offset + key_size + value_size].decode()
        offset += key_size + value_size
        total += key_size + 1 + value_size
        decoded[key] = content
    assert offset == len(payload) and total <= 65536
    assert decoded['VSCODE_AGENT_FOLDER'] == value['home'] + '/.vscode-server'
    assert decoded['TERM'] == 'screen-256color'
    assert decoded['SSH_ORIGINAL_COMMAND'] == 'snapshot command marker'
    assert 'snapshot command marker' not in script
    arguments = ns['launch_argv'](value, run, {'payloadSha256': hashlib.sha256(payload).hexdigest()}, run['build'])
    assert command not in ' '.join(arguments) and 'project snapshot marker' not in ' '.join(arguments)
    login = ns['ssh_payload'](value, {}, '', None)
    size = struct.unpack('<8sIIIIII', login[:32])[5]
    assert login[32:32 + size] == b'exec /bin/sh -l'
    for term in ('x\n', '', 'a' * 129, '終端'):
        refuses(ns, lambda: ns['ssh_payload'](value, {}, '', term), 'SSH_TERM_BOUND')
    for command in ('bad\0command', '\ud800', 'a' * 65537):
        refuses(ns, lambda: ns['ssh_payload'](value, {}, command, None), 'SSH_COMMAND_BOUND')
    refuses(ns, lambda: ns['ssh_payload'](value, {}, "'" * 20000, None), 'SSH_PAYLOAD_BOUND')


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['open']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `dict`, `ns['run_decode']`, `ns['run_bytes']`.
# 检查边界 / Checked boundaries: `ns['run_decode'](run['runId'], ns['run_bytes'](ticket)) == ticket`; `ns['current_cgroup'](name) == name`.
def service_cgroups_and_daemon_arguments():
    ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
    for name in ('openrc.sakura-ssh-default', 'system.slice/sakura-ssh-default.service'):
        ticket = dict(run, cgroupName=name)
        assert ns['run_decode'](run['runId'], ns['run_bytes'](ticket)) == ticket
        ns['open'] = lambda _path, *args: io.StringIO('0::/' + name + '\n')
        refuses(ns, ns['current_cgroup'], 'INHERITED_CGROUP_UNREGISTERED')
        assert ns['current_cgroup'](name) == name
    for name in ('system.slice/sakura-ssh-1111111111111111.service', 'openrc.sakura-ssh-1111111111111111',
                 'system.slice/../sakura-ssh-default.service', 'sakura-service-not-a-uuid'):
        refuses(ns, lambda: ns['run_decode'](run['runId'], ns['run_bytes'](dict(run, cgroupName=name))), 'CGROUP_IDENTITY')
        refuses(ns, lambda: ns['ssh_daemon_record'](dict(daemon, cgroupName=name), 'default'), 'SSH_DAEMON_SCOPE')
    fixed = '/etc/sakura/ssh/default/sshd_config'
    direct = ['/usr/sbin/sshd', '-D', '-e', '-f', fixed]
    ns['ssh_daemon_arguments'](('\0'.join(direct) + '\0').encode(), 'default')
    ns['ssh_daemon_arguments'](('sshd: ' + ' '.join(direct) + ' [listener] 0 of 10-100 startups\0\0').encode(), 'default')
    for args in (direct + ['-o', 'ForceCommand=/bin/sh'], direct + ['-f', '/etc/sshd_config'],
                 direct[:-1] + [fixed + '.replacement'], ['/bin/sh', '-c', ' '.join(direct)],
                 ['sshd: ' + ' '.join(direct) + ' [listener] 0 of 10-100 startups ; rootcommand']):
        refuses(ns, lambda: ns['ssh_daemon_arguments'](('\0'.join(args) + '\0').encode(), 'default'), 'SSH_DAEMON_COMMAND')
    refuses(ns, lambda: ns['ssh_daemon_record'](dict(daemon, pid=True), 'default'), 'SSH_DAEMON_INVALID')
    refuses(ns, lambda: ns['ssh_daemon_record'](dict(daemon, startTicks='02001'), 'default'), 'SSH_DAEMON_INVALID')


class AuthorityFilesystem:
    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self, ns, run, daemon。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.after_read`, `self.os`, `self.nodes[ns['CGROUP'] + '/' + run['cgroupName']]['inode']`, `self.nodes['/proc/1001/ns/net']['inode']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `getattr`, `enumerate`, `types.SimpleNamespace`, `self.add`.
    def __init__(self, ns, run, daemon):
        self.nodes, self.fds, self.events, self.next_fd = {}, {}, [], 100
        self.after_read = None
        constants = {name: getattr(os, name, 1 << (20 + index)) for index, name in enumerate(
            ('O_PATH', 'O_DIRECTORY', 'O_NOFOLLOW', 'O_CLOEXEC', 'O_NONBLOCK', 'O_RDONLY', 'O_WRONLY', 'O_CREAT', 'O_EXCL'))}
        self.os = types.SimpleNamespace(**constants, path=os.path, open=self.open, close=self.close,
            fstat=self.fstat, stat=self.stat, read=self.read, readlink=self.readlink, write=self.write,
            fchmod=self.fchmod, fsync=lambda fd: self.events.append(('fsync', self.fds[fd][0])),
            replace=self.replace, unlink=self.unlink, mkdir=self.mkdir)
        for path in ('/', '/sys', '/sys/fs', ns['CGROUP'], ns['CGROUP'] + '/system.slice',
                     ns['CGROUP'] + '/' + run['cgroupName'], '/proc', '/proc/1001', '/proc/1001/ns',
                     '/etc', '/etc/sakura', ns['SSH_CONFIG'], ns['SSH_CONFIG'] + '/default',
                     '/run', ns['RUNTIME'], ns['RUNTIME'] + '/ssh', ns['RUNTIME'] + '/runs'):
            self.add(path, directory=True)
        self.nodes[ns['CGROUP'] + '/' + run['cgroupName']]['inode'] = 300
        fields = ['S'] + ['0'] * 18 + [daemon['startTicks']] + ['0'] * 3
        self.add('/proc/1001/stat', ('1001 (sshd) ' + ' '.join(fields) + '\n').encode())
        self.add('/proc/1001/status', b'Name:\tsshd\nUid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\n')
        self.add('/proc/1001/cgroup', ('0::/' + run['cgroupName'] + '\n').encode())
        self.add('/proc/1001/cmdline', b'/usr/sbin/sshd\0-D\0-e\0-f\0/etc/sakura/ssh/default/sshd_config\0')
        self.add('/proc/1001/ns/net')
        self.nodes['/proc/1001/ns/net']['inode'] = 200
        self.exe = '/usr/sbin/sshd'
        ns['os'], ns['fcntl'] = self.os, types.SimpleNamespace(ioctl=lambda fd, command: 0x40000000)
        ns['cgroup_available'] = lambda *_args: None

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, path, data = b'', directory = False, mode = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.nodes[path]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `dict`, `bytes`, `len`.
    def add(self, path, data=b'', directory=False, mode=None):
        self.nodes[path] = dict(data=bytes(data), mode=(stat.S_IFDIR if directory else stat.S_IFREG) |
            (mode if mode is not None else (0o700 if directory else 0o600)),
            uid=0, gid=0, inode=400 + len(self.nodes), links=1)

    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: self, path, parent = None。
    # 结果：返回分支计算值（`path / self.fds[parent][0]`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`path / self.fds[parent][0]`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `path.startswith`, `self.fds[parent][0].rstrip`.
    # 检查边界 / Checked boundaries: `parent in self.fds and '/' not in path`.
    def path(self, path, parent=None):
        if path.startswith('/'):
            return path
        assert parent in self.fds and '/' not in path
        if path == '.':
            return self.fds[parent][0]
        return self.fds[parent][0].rstrip('/') + '/' + path

    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: self, path, flags, mode = None, dir_fd = None。
    # 结果：返回分支计算值（`self.next_fd`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.next_fd`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.next_fd`, `self.fds[self.next_fd]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 失败 / Failure: `FileExistsError(path)`; `FileNotFoundError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.path`, `FileExistsError`, `self.add`, `FileNotFoundError`.
    def open(self, path, flags, mode=None, dir_fd=None):
        path = self.path(path, dir_fd)
        if flags & self.os.O_CREAT:
            if path in self.nodes and flags & self.os.O_EXCL:
                raise FileExistsError(path)
            if path not in self.nodes:
                self.add(path, mode=mode)
        if path not in self.nodes:
            raise FileNotFoundError(path)
        node = self.nodes[path]
        if flags & self.os.O_NOFOLLOW and stat.S_ISLNK(node['mode']):
            raise OSError(errno.ELOOP, 'modeled symlink')
        if flags & self.os.O_DIRECTORY and not stat.S_ISDIR(node['mode']):
            raise NotADirectoryError(path)
        self.next_fd += 1
        self.fds[self.next_fd] = [path, 0, node]
        self.events.append(('open', path))
        return self.next_fd

    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self, fd。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 检查边界 / Checked boundaries: `fd in self.fds`.
    def close(self, fd):
        assert fd in self.fds, ('unknown descriptor', fd)
        del self.fds[fd]

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, node。
    # 结果：返回分支计算值（`types.SimpleNamespace(st_dev=11, st_ino=node['inode'], st_mode=node['mode'], st_uid=node['uid'], st_…`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`types.SimpleNamespace(st_dev=11, st_ino=node['inode'], st_mode=node['mode'], st_uid=node['uid'], st_…`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `types.SimpleNamespace`, `len`.
    def info(self, node):
        return types.SimpleNamespace(st_dev=11, st_ino=node['inode'], st_mode=node['mode'],
            st_uid=node['uid'], st_gid=node['gid'], st_nlink=node['links'], st_size=len(node['data']))

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, fd。
    # 结果：返回分支计算值（`self.info(self.fds[fd][2])`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.info(self.fds[fd][2])`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.info`.
    def fstat(self, fd): return self.info(self.fds[fd][2])

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, path, dir_fd = None, follow_symlinks = False。
    # 结果：返回分支计算值（`self.info(self.nodes[path])`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.info(self.nodes[path])`); its implementation and call sites define the actual type.
    # 失败 / Failure: `FileNotFoundError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.path`, `FileNotFoundError`, `self.info`.
    # 检查边界 / Checked boundaries: `not follow_symlinks`.
    def stat(self, path, dir_fd=None, follow_symlinks=False):
        assert not follow_symlinks
        path = self.path(path, dir_fd)
        if path not in self.nodes:
            raise FileNotFoundError(path)
        return self.info(self.nodes[path])

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, fd, count。
    # 结果：返回分支计算值（`data`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`data`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.fds[fd][1]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `len`, `self.after_read`.
    def read(self, fd, count):
        path, position, node = self.fds[fd]
        data = node['data'][position:position + count]
        self.fds[fd][1] += len(data)
        if data and self.after_read:
            self.after_read(path)
        return data

    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, path, dir_fd = None。
    # 结果：返回分支计算值（`self.exe`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.exe`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.path`.
    # 检查边界 / Checked boundaries: `self.path(path, dir_fd) == '/proc/1001/exe'`.
    def readlink(self, path, dir_fd=None):
        assert self.path(path, dir_fd) == '/proc/1001/exe'
        return self.exe

    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, fd, data。
    # 结果：返回分支计算值（`len(data)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`len(data)`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `node['data']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `bytes`, `len`.
    def write(self, fd, data):
        node = self.fds[fd][2]
        node['data'] += bytes(data)
        return len(data)

    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, fd, mode。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `node['mode']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `stat.S_IFMT`.
    def fchmod(self, fd, mode):
        node = self.fds[fd][2]
        node['mode'] = stat.S_IFMT(node['mode']) | mode

    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, old, new, src_dir_fd = None, dst_dir_fd = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.nodes[new_path]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `stat.S_ISDIR`, `self.fstat`, `self.path`, `self.nodes.pop`.
    # 检查边界 / Checked boundaries: `src_dir_fd == dst_dir_fd and stat.S_ISDIR(self.fstat(src_dir_fd).st_mode)`.
    def replace(self, old, new, src_dir_fd=None, dst_dir_fd=None):
        assert src_dir_fd == dst_dir_fd and stat.S_ISDIR(self.fstat(src_dir_fd).st_mode)
        old_path, new_path = self.path(old, src_dir_fd), self.path(new, dst_dir_fd)
        self.nodes[new_path] = self.nodes.pop(old_path)
        self.events.append(('atomic-replace', new_path))

    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self, path, dir_fd = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `FileNotFoundError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.path`, `FileNotFoundError`.
    def unlink(self, path, dir_fd=None):
        path = self.path(path, dir_fd)
        if path not in self.nodes:
            raise FileNotFoundError(path)
        del self.nodes[path]

    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, path, mode, dir_fd = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `FileExistsError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.path`, `FileExistsError`, `self.add`.
    def mkdir(self, path, mode, dir_fd=None):
        path = self.path(path, dir_fd)
        if path in self.nodes:
            raise FileExistsError(path)
        self.add(path, directory=True, mode=mode)


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `fs.after_read`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `setup`, `ns['ssh_daemon_check']`, `modification`, `refuses`.
# 检查边界 / Checked boundaries: `ns['ssh_daemon_check'](value, daemon, run['bootId'], run).st_ino == 300`; `not fs.fds`.
# 设计思路：用显式模型状态和受控适配调用排列边界情景，测试只依据其断言证明相应模型行为，不能外推真实系统权限。
# Design: Arrange boundary cases with explicit model state and controlled adapters. Assertions establish the corresponding model behavior without attesting real system privileges.
def daemon_process_and_protected_atomic_paths():
    # 中文功能：准备本用例的独立目录与状态，使用例之间的输入和失败注入相互隔离。
    # English: Prepare a private directory and state for this case so inputs and injected failures are isolated between cases.
    # 输入 / Inputs: 无 / none。
    # 结果：返回分支计算值（`(ns, value, run, daemon, raw, fs)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`(ns, value, run, daemon, raw, fs)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `fixture`, `AuthorityFilesystem`.
    def setup():
        ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
        fs = AuthorityFilesystem(ns, run, daemon)
        return ns, value, run, daemon, raw, fs
    ns, value, run, daemon, raw, fs = setup()
    assert ns['ssh_daemon_check'](value, daemon, run['bootId'], run).st_ino == 300
    assert not fs.fds
    for modification, expected in (
            (lambda fs: fs.nodes['/proc/1001/status'].update(data=b'Uid:\t0\t1\t0\t0\n'), 'SSH_DAEMON_IDENTITY'),
            (lambda fs: setattr(fs, 'exe', '/usr/sbin/sshd (deleted)'), 'SSH_DAEMON_IDENTITY'),
            (lambda fs: fs.nodes['/proc/1001/cgroup'].update(data=b'0::/system.slice/other.service\n'), 'SSH_DAEMON_SCOPE'),
            (lambda fs: fs.nodes['/proc/1001/ns/net'].update(inode=201), 'SSH_DAEMON_NETWORK'),
            (lambda fs: fs.nodes['/sys/fs/cgroup/system.slice'].update(uid=20000), 'UNTRUSTED_RECORD')):
        ns, value, run, daemon, raw, fs = setup()
        modification(fs)
        refuses(ns, lambda: ns['ssh_daemon_check'](value, daemon, run['bootId'], run), expected)
        assert not fs.fds
    ns, value, run, daemon, raw, fs = setup()
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: path。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `node['data']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `path.endswith`, `node['data'].replace`.
    def reuse(path):
        if path.endswith('/cmdline'):
            node = fs.nodes['/proc/1001/stat']
            node['data'] = node['data'].replace(b'2001', b'2002')
    fs.after_read = reuse
    refuses(ns, lambda: ns['ssh_daemon_check'](value, daemon, run['bootId'], run), 'SSH_DAEMON_CHANGED')
    assert not fs.fds
    ns, value, run, daemon, raw, fs = setup()
    fs.after_read = lambda path: fs.nodes['/sys/fs/cgroup/system.slice/sakura-ssh-default.service'].update(inode=301) if path.endswith('/cmdline') else None
    refuses(ns, lambda: ns['ssh_daemon_check'](value, daemon, run['bootId'], run), 'CGROUP_REPLACED')
    assert not fs.fds
    ns, value, run, daemon, raw, fs = setup()
    path = ns['ssh_snapshot_path']('default')
    ns['ssh_atomic'](path, raw)
    assert fs.nodes[path]['data'] == raw and stat.S_IMODE(fs.nodes[path]['mode']) == 0o600
    assert fs.events[-2:] == [('atomic-replace', path), ('fsync', '/etc/sakura/ssh/default')]
    assert not fs.fds and all('.record-' not in name for name in fs.nodes)
    for mode, uid, links, expected in ((stat.S_IFLNK | 0o600, 0, 1, 'UNTRUSTED_RECORD'),
                                     (stat.S_IFREG | 0o644, 0, 1, 'RECORD_PERMISSIONS'),
                                     (stat.S_IFREG | 0o600, 20000, 1, 'UNTRUSTED_RECORD'),
                                     (stat.S_IFREG | 0o600, 0, 2, 'RECORD_LINKS')):
        ns, value, run, daemon, raw, fs = setup()
        fs.add(path, b'original')
        fs.nodes[path].update(mode=mode, uid=uid, links=links)
        refuses(ns, lambda: ns['ssh_atomic'](path, raw), expected)
        assert fs.nodes[path]['data'] == b'original' and not fs.fds
    ns, value, run, daemon, raw, fs = setup()
    fs.nodes['/etc/sakura/ssh'].update(mode=stat.S_IFDIR | 0o777)
    refuses(ns, lambda: ns['ssh_atomic'](path, raw), 'UNTRUSTED_RECORD')
    assert path not in fs.nodes and not fs.fds


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `invalid['run']['revision']`, `records[ns['ssh_receipt_path'](run['runId'])]`, `ns['ssh_daemon_check']`, `ns['ssh_atomic']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('modeled interruption did not happen')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `fixture`, `ns['ssh_receipt_read']`, `refuses`, `dict`.
# 检查边界 / Checked boundaries: `ns['ssh_receipt_read'](run['runId'], run) == receipt`; `ns['ssh_receipt_read'](run['runId'], dict(run, phase='closed'), closed=True) == receipt`.
# 设计思路：用显式模型状态和受控适配调用排列边界情景，测试只依据其断言证明相应模型行为，不能外推真实系统权限。
# Design: Arrange boundary cases with explicit model state and controlled adapters. Assertions establish the corresponding model behavior without attesting real system privileges.
def receipts_and_interrupted_prepare():
    ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
    assert ns['ssh_receipt_read'](run['runId'], run) == receipt
    refuses(ns, lambda: ns['ssh_receipt_read'](run['runId'], dict(run, cgroupInode='301')), 'SSH_RECEIPT_STALE')
    assert ns['ssh_receipt_read'](run['runId'], dict(run, phase='closed'), closed=True) == receipt
    invalid = copy.deepcopy(receipt)
    invalid['run']['revision'] = True
    records[ns['ssh_receipt_path'](run['runId'])] = json.dumps(invalid).encode()
    refuses(ns, lambda: ns['ssh_receipt_read'](run['runId']), 'SSH_RECEIPT_INVALID')
    del records[ns['ssh_receipt_path'](run['runId'])]
    events, interrupt = [], [True]
    info = types.SimpleNamespace(st_dev=11, st_ino=300)
    # 中文功能：核对模型证据或测试条件，按实现返回判定或拒绝不符合要求的输入。
    # English: Check model evidence or test conditions, returning a decision or rejecting inputs as specified by the implementation.
    # 输入 / Inputs: _value, actual, boot, ticket = None。
    # 结果：返回分支计算值（`info`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`info`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `events.append`.
    # 检查边界 / Checked boundaries: `actual == daemon and boot == run['bootId']`; `ticket == run`.
    def daemon_check(_value, actual, boot, ticket=None):
        assert actual == daemon and boot == run['bootId']
        if ticket is not None:
            assert ticket == run
        events.append('daemon-proof')
        return info
    ns['ssh_daemon_check'] = daemon_check
    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: path, data。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `records[path]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `ns['ssh_receipt_path']`, `events.append`, `bytes`.
    # 检查边界 / Checked boundaries: `path == ns['ssh_receipt_path'](run['runId'])`.
    def atomic(path, data):
        assert path == ns['ssh_receipt_path'](run['runId'])
        events.append('receipt-publish')
        records[path] = bytes(data)
    ns['ssh_atomic'] = atomic
    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: _value, _request, boot, build, inherit, name, scope_info, publish。
    # 结果：返回分支计算值（`copy.deepcopy(run)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`copy.deepcopy(run)`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `interrupt[0]`, `records[ns['run_path'](run['runId'])]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 失败 / Failure: `OSError('modeled ticket publication failure')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `publish`, `copy.deepcopy`, `OSError`, `events.append`.
    # 检查边界 / Checked boundaries: `inherit and name == daemon['cgroupName'] and (scope_info is info)`; `'receipt-publish' in events`.
    def prepare(_value, _request, boot, build, inherit, name, scope_info, publish):
        assert inherit and name == daemon['cgroupName'] and scope_info is info
        publish(copy.deepcopy(run))
        assert 'receipt-publish' in events
        if interrupt[0]:
            interrupt[0] = False
            raise OSError('modeled ticket publication failure')
        events.append('ticket-publish')
        records[ns['run_path'](run['runId'])] = ns['run_bytes'](run)
        return copy.deepcopy(run)
    ns['prepare'] = prepare
    options = dict(request, action='ssh-prepare', daemon=copy.deepcopy(daemon))
    try:
        ns['ssh_prepare'](value, options, run['bootId'], run['build'])
    except OSError:
        pass
    else:
        raise AssertionError('modeled interruption did not happen')
    assert ns['ssh_receipt_read'](run['runId']) == receipt
    assert ns['run_path'](run['runId']) not in records
    # Changing daemon proof after the receipt exists cannot repin the ticket.
    ns['ssh_daemon_check'] = lambda *args: info
    refuses(ns, lambda: ns['ssh_prepare'](value, dict(options, daemon=dict(daemon, startTicks='2002')),
                                        run['bootId'], run['build']), 'SSH_RECEIPT_STALE')
    ns['ssh_daemon_check'] = daemon_check
    assert ns['ssh_prepare'](value, options, run['bootId'], run['build']) == run
    assert events.count('receipt-publish') == 1
    assert events.index('receipt-publish') < events.index('ticket-publish')
    del records[ns['ssh_receipt_path'](run['runId'])]
    refuses(ns, lambda: ns['ssh_prepare'](value, options, run['bootId'], run['build']), 'SSH_RECEIPT_ABSENT')


# 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
# English: Read or resolve observable model data for adapted production-definition calls or assertions.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['fcntl']`, `ns['os']`, `ns['selectors']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `bytearray`, `types.SimpleNamespace`, `refuses`.
# 检查边界 / Checked boundaries: `ns['ssh_snapshot_input']() == content`; `flag_events[-1] == (0, 4, (0,))`.
def snapshot_stdin_deadline_and_eof():
    for content, eof, expected in ((b'{}', True, None), (b'x' * 131073, True, 'SSH_SNAPSHOT_BOUND'),
                                    (b'{}', False, 'SSH_SNAPSHOT_TIMEOUT')):
        ns = fixture()[0]
        pending, flag_events = bytearray(content), []
        ns['fcntl'] = types.SimpleNamespace(F_GETFL=3, F_SETFL=4,
            fcntl=lambda fd, op, *args: flag_events.append((fd, op, args)) or 0)
        # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
        # English: Read or resolve observable model data for adapted production-definition calls or assertions.
        # 输入 / Inputs: fd, count。
        # 结果：返回分支计算值（`data`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`data`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `bytes`.
        # 检查边界 / Checked boundaries: `fd == 0 and count > 0`.
        def read(fd, count):
            assert fd == 0 and count > 0
            data = bytes(pending[:count])
            del pending[:count]
            return data
        ns['os'] = types.SimpleNamespace(O_ACCMODE=3, O_WRONLY=1, O_NONBLOCK=2048, read=read)
        class Selector:
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: self。
            # 结果：返回分支计算值（`self`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`self`); its implementation and call sites define the actual type.
            def __enter__(self): return self
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: self, *_。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            def __exit__(self, *_): pass
            # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
            # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
            # 输入 / Inputs: self, fd, event。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 检查边界 / Checked boundaries: `fd == 0`.
            def register(self, fd, event): assert fd == 0
            # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
            # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
            # 输入 / Inputs: self, remaining。
            # 结果：返回分支计算值（`[(None, None)] if pending or eof else []`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`[(None, None)] if pending or eof else []`); its implementation and call sites define the actual type.
            # 检查边界 / Checked boundaries: `0 < remaining <= 8`.
            def select(self, remaining):
                assert 0 < remaining <= 8
                return [(None, None)] if pending or eof else []
        ns['selectors'] = types.SimpleNamespace(SelectSelector=Selector, EVENT_READ=1)
        if expected:
            refuses(ns, ns['ssh_snapshot_input'], expected)
        else:
            assert ns['ssh_snapshot_input']() == content
        assert flag_events[-1] == (0, 4, (0,)), 'input flags must be restored on every exit'


# 中文功能：构造本组边界验证所需的模型对象或输入材料。
# English: Construct model objects or input material required by this boundary-verification group.
# 输入 / Inputs: action = 'ssh-session', original = "printf 'client command marker'", term = 'screen'。
# 结果：返回分支计算值（`(ns, value, run, daemon, records, events, written)`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`(ns, value, run, daemon, records, events, written)`); its implementation and call sites define the actual type.
# 状态影响 / State effects: `request['action']`, `stdin.close`, `ns['subprocess']`, `ns['os']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `request.pop`, `set`, `bytearray`.
# 设计思路：记录元数据权威 FD、载荷管道、客户机 FD3 与信号状态；启动断言要求权威先关闭且孩子不继承父进程忽略策略，原命令与快照不进入 argv。
# Design: Track metadata-authority descriptors, the payload pipe, client FD3 and signal state. Spawn assertions require authority closure first and prevent inherited parent signal-ignore policy; the original command and snapshot stay out of argv.
def session_fixture(action='ssh-session', original="printf 'client command marker'", term='screen'):
    ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
    if action != 'ssh-session':
        request.pop('snapshotSha256')
    request['action'] = action
    events, authority, written, handlers = [], set(), bytearray(), {}
    stdin = types.SimpleNamespace(closed=False, fileno=lambda: 40)
    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: 无 / none。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `stdin.closed`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `events.append`.
    def close_stdin():
        stdin.closed = True
        events.append('frame-eof')
    stdin.close = close_stdin
    class Child:
        # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
        # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
        # 输入 / Inputs: self。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        def __init__(self): self.stdin, self.returncode = stdin, None
        # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
        # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
        # 输入 / Inputs: self, timeout = None。
        # 结果：返回分支计算值（`0`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`0`); its implementation and call sites define the actual type.
        # 状态影响 / State effects: `self.returncode`. Follow the actual model assignments / 以模型中的实际赋值为准。
        # 协作入口 / Collaborators: `callable`, `events.append`.
        # 检查边界 / Checked boundaries: `stdin.closed`; `handlers[2] == 1 and handlers[3] == 1`.
        def wait(self, timeout=None):
            assert stdin.closed
            assert handlers[2] == 1 and handlers[3] == 1
            assert callable(handlers[1]) and callable(handlers[15])
            events.append('wait')
            self.returncode = 0
            return 0
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: self。
        # 结果：返回分支计算值（`self.returncode`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`self.returncode`); its implementation and call sites define the actual type.
        def poll(self): return self.returncode
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: self, signum。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 协作入口 / Collaborators: `events.append`.
        def send_signal(self, signum): events.append(('child-signal', signum))
        # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
        # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
        # 输入 / Inputs: self。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 状态影响 / State effects: `self.returncode`. Follow the actual model assignments / 以模型中的实际赋值为准。
        # 协作入口 / Collaborators: `events.append`.
        def terminate(self): events.append('child-terminate'); self.returncode = -15
        # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
        # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
        # 输入 / Inputs: self。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 状态影响 / State effects: `self.returncode`. Follow the actual model assignments / 以模型中的实际赋值为准。
        # 协作入口 / Collaborators: `events.append`.
        def kill(self): events.append('child-kill'); self.returncode = -9
    child = Child()
    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: arguments, **options。
    # 结果：返回分支计算值（`child`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`child`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `handlers.get`, `dict`, `' '.join`, `events.append`.
    # 检查边界 / Checked boundaries: `not authority`; `handlers[2] != 1 and handlers.get(3, 0) != 1`.
    def spawn(arguments, **options):
        assert not authority, 'metadata/registry authority must be closed before Popen'
        assert handlers[2] != 1 and handlers.get(3, 0) != 1, 'child must not inherit parent SIGINT/SIGQUIT ignores'
        assert options == dict(stdin=subprocess.PIPE, stdout=None, stderr=None,
                               env=ns['CLEAN_ENV'], close_fds=True, pass_fds=(3,))
        assert original not in ' '.join(arguments) and 'project snapshot marker' not in ' '.join(arguments)
        events.append(('spawn', arguments))
        return child
    ns['subprocess'] = types.SimpleNamespace(Popen=spawn, PIPE=subprocess.PIPE, TimeoutExpired=subprocess.TimeoutExpired)
    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: fd。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `events.append`, `authority.discard`.
    def close(fd):
        events.append(('close', fd))
        authority.discard(fd)
    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: source_fd, target_fd。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `events.append`.
    # 检查边界 / Checked boundaries: `(source_fd, target_fd) == (0, 3) and (not authority)`.
    def dup(source_fd, target_fd):
        assert (source_fd, target_fd) == (0, 3) and not authority
        events.append('client-fd3')
    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: fd, data。
    # 结果：返回分支计算值（`len(data)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`len(data)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `written.extend`, `len`.
    # 检查边界 / Checked boundaries: `fd == 40`.
    def write(fd, data):
        assert fd == 40, 'root only writes the payload pipe'
        written.extend(data)
        return len(data)
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: *_args。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `AssertionError('root must never read client session stdin')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `AssertionError`.
    def client_read(*_args): raise AssertionError('root must never read client session stdin')
    ns['os'] = types.SimpleNamespace(environ={'SSH_ORIGINAL_COMMAND': original, 'TERM': term, 'IGNORED_CLIENT_ENV': 'injection'},
        getuid=lambda: 0, geteuid=lambda: 0, path=os.path, close=close, dup2=dup, read=client_read,
        write=write, fstat=lambda fd: types.SimpleNamespace(st_mode=stat.S_IFIFO), O_ACCMODE=3, O_WRONLY=1,
        isatty=lambda fd: False, set_blocking=lambda fd, blocking: events.append(('blocking', fd, blocking)))
    ns['fcntl'] = types.SimpleNamespace(F_GETFL=3, fcntl=lambda *_args: 0)
    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: signum, handler。
    # 结果：返回分支计算值（`old`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`old`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `handlers[signum]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `handlers.get`.
    def set_signal(signum, handler):
        old = handlers.get(signum, 0)
        handlers[signum] = handler
        return old
    ns['signal'] = types.SimpleNamespace(SIGINT=2, SIGQUIT=3, SIGHUP=1, SIGTERM=15, SIG_IGN=1,
                                       signal=set_signal, getsignal=lambda signum: handlers.get(signum, 0))
    class Selector:
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: self。
        # 结果：返回分支计算值（`self`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`self`); its implementation and call sites define the actual type.
        def __enter__(self): return self
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: self, *_。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        def __exit__(self, *_): pass
        # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
        # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
        # 输入 / Inputs: self, stream, event。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 检查边界 / Checked boundaries: `stream is stdin and event == 2`.
        def register(self, stream, event): assert stream is stdin and event == 2
        # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
        # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
        # 输入 / Inputs: self, remaining。
        # 结果：返回分支计算值（`[(None, None)]`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`[(None, None)]`); its implementation and call sites define the actual type.
        # 检查边界 / Checked boundaries: `remaining > 0`.
        def select(self, remaining): assert remaining > 0; return [(None, None)]
    ns['selectors'] = types.SimpleNamespace(DefaultSelector=Selector, EVENT_WRITE=2)
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: 无 / none。
    # 结果：返回分支计算值（`90`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`90`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `events.append`, `authority.add`.
    def readonly():
        events.append('registry-shared')
        authority.add(90)
        return 90
    # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
    # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
    # 输入 / Inputs: 无 / none。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `AssertionError('SSH session must not initialize or take an EX lock')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `AssertionError`.
    def exclusive(): raise AssertionError('SSH session must not initialize or take an EX lock')
    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: readonly。
    # 结果：返回分支计算值（`{'registryId': value['registryId'], 'reserved': {str(value['uid']): {'projectId': value['projectId']…`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`{'registryId': value['registryId'], 'reserved': {str(value['uid']): {'projectId': value['projectId']…`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `str`.
    # 检查边界 / Checked boundaries: `readonly is True`.
    def registry(readonly):
        assert readonly is True
        return {'registryId': value['registryId'], 'reserved': {str(value['uid']):
            {'projectId': value['projectId'], 'identityId': value['identityId']}}}
    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: _value, boot, readonly = False。
    # 结果：返回分支计算值（`(91, types.SimpleNamespace(st_dev=11, st_ino=200), '')`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`(91, types.SimpleNamespace(st_dev=11, st_ino=200), '')`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `authority.add`, `types.SimpleNamespace`.
    # 检查边界 / Checked boundaries: `readonly is True and boot == run['bootId']`.
    def network(_value, boot, readonly=False):
        assert readonly is True and boot == run['bootId']
        authority.add(91)
        return 91, types.SimpleNamespace(st_dev=11, st_ino=200), ''
    ns.update(sources=lambda: run['build'], initialize_readonly=readonly, initialize=exclusive,
        registry=registry, active=lambda *_args: copy.deepcopy(value), binding_read=lambda *_args: copy.deepcopy(value),
        run_read=lambda *_args: copy.deepcopy(run), migration_ready=lambda *_args: None,
        network_fd=network, ssh_daemon_check=lambda *_args: events.append('daemon-proof'))
    ns['open'] = lambda path, *args: io.StringIO(run['bootId'] if path.endswith('/boot_id') else '0::/' + run['cgroupName'] + '\n')
    ns['sys'] = types.SimpleNamespace(argv=['controller.py', base64.b64encode(json.dumps(request).encode()).decode()],
        stdout=io.StringIO(), stderr=io.StringIO(), exit=lambda code: (_ for _ in ()).throw(SystemExit(code)))
    return ns, value, run, daemon, records, events, written


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['__name__']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('session must exit with child status')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `session_fixture`, `contextlib.redirect_stdout`, `io.StringIO`, `ns['main']`.
# 检查边界 / Checked boundaries: `result.code == 0`; `not output.getvalue()`.
def session_descriptor_order_and_stdout():
    ns, value, run, daemon, records, events, written = session_fixture()
    with contextlib.redirect_stdout(io.StringIO()) as output:
        try:
            ns['main']()
        except SystemExit as result:
            assert result.code == 0
        else:
            raise AssertionError('session must exit with child status')
    assert not output.getvalue(), 'successful session must never emit controller JSON on binary stdout'
    assert events.index(('close', 90)) < events.index('client-fd3')
    assert events.index(('close', 91)) < events.index('client-fd3')
    assert events.index(('close', 3)) < events.index('frame-eof')
    assert events.index('frame-eof') < events.index('wait')
    arguments = next(item[1] for item in events if isinstance(item, tuple) and item[0] == 'spawn')
    assert arguments[-1] == hashlib.sha256(written).hexdigest()
    size = struct.unpack('<8sIIIIII', written[:32])[5]
    assert b'client command marker' in written[32:32 + size]
    assert b'snapshot command marker' not in written[32:32 + size]
    assert b'IGNORED_CLIENT_ENV' not in written
    assert ns['os'].environ == ns['CLEAN_ENV']
    # Execute the actual production error guard with an invalid client TERM.
    ns, value, run, daemon, records, events, written = session_fixture(term='invalid\nterm')
    ns['__name__'] = '__main__'
    with contextlib.redirect_stdout(io.StringIO()) as output:
        try:
            exec(compile(guard, 'production-controller-error-guard', 'exec'), ns)
        except SystemExit as result:
            assert result.code == 1
    assert not output.getvalue() and not ns['sys'].stdout.getvalue()
    assert json.loads(ns['sys'].stderr.getvalue())['code'] == 'SSH_TERM_BOUND'
    assert 'client command marker' not in ns['sys'].stderr.getvalue() and not written


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['os'].fstat`, `ns['socket']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `session_fixture`, `types.SimpleNamespace`, `ns['signal'].signal`, `ns['ssh_launch']`.
# 检查边界 / Checked boundaries: `ns['ssh_launch'](value, run, run['build'], b'frame') == 0`; `written == b'frame' and 'client-fd3' in events`.
def session_network_descriptors_are_rejected():
    # Model the authoritative Linux SO_DOMAIN query, including network families
    # other than IP. Python's fromfd family hint must never authorize a socket.
    for family in (1, 2, 10, 16, 17, 40):
        ns, value, run, daemon, records, events, written = session_fixture()
        ns['os'].fstat = lambda fd: types.SimpleNamespace(st_mode=stat.S_IFSOCK | 0o600)
        class Channel:
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: self。
            # 结果：返回分支计算值（`self`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`self`); its implementation and call sites define the actual type.
            def __enter__(self): return self
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: self, *_。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 协作入口 / Collaborators: `events.append`.
            def __exit__(self, *_): events.append('channel-copy-closed')
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: self, level, option。
            # 结果：返回分支计算值（`family`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`family`); its implementation and call sites define the actual type.
            # 检查边界 / Checked boundaries: `(level, option) == (1, 39)`.
            def getsockopt(self, level, option):
                assert (level, option) == (1, 39)
                return family
        # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
        # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
        # 输入 / Inputs: fd, hint, kind。
        # 结果：返回分支计算值（`Channel()`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`Channel()`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `events.append`, `Channel`.
        # 检查边界 / Checked boundaries: `(fd, hint, kind) == (0, 1, 1)`.
        def fromfd(fd, hint, kind):
            assert (fd, hint, kind) == (0, 1, 1)
            events.append('channel-copy-opened')
            return Channel()
        ns['socket'] = types.SimpleNamespace(AF_UNIX=1, SOCK_STREAM=1, SOL_SOCKET=1,
                                           SO_DOMAIN=39, fromfd=fromfd)
        ns['signal'].signal(2, 0)
        ns['signal'].signal(3, 0)
        if family == 1:
            assert ns['ssh_launch'](value, run, run['build'], b'frame') == 0
            assert written == b'frame' and 'client-fd3' in events
        else:
            refuses(ns, lambda: ns['ssh_launch'](value, run, run['build'], b'frame'), 'SSH_SESSION_NETWORK_CHANNEL')
            assert not written and 'client-fd3' not in events
            assert not any(isinstance(item, tuple) and item[0] == 'spawn' for item in events)
        assert events.index('channel-copy-opened') < events.index('channel-copy-closed')


# 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
# English: Read or resolve observable model data for adapted production-definition calls or assertions.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `records[ns['ssh_snapshot_path']('default')]`, `ns['run_write']`, `ns['ssh_receipt_retire']`, `ns['os']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('receipt retirement failure must propagate')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `session_fixture`, `contextlib.redirect_stdout`, `io.StringIO`, `ns['main']`.
# 检查边界 / Checked boundaries: `json.loads(output.getvalue())['result'] == run and 'daemon-proof' in events and (not written)`; `not written`.
def readonly_probe_and_stop_authority():
    ns, value, run, daemon, records, events, written = session_fixture('run-readonly')
    with contextlib.redirect_stdout(io.StringIO()) as output:
        ns['main']()
    assert json.loads(output.getvalue())['result'] == run and 'daemon-proof' in events and not written
    ns, value, run, daemon, records, events, written = session_fixture('run-readonly')
    records[ns['ssh_snapshot_path']('default')] += b' '
    refuses(ns, ns['main'], 'SSH_SNAPSHOT_DIGEST')
    assert not written
    ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
    published, removed, closed = [], [], []
    ns['run_write'] = lambda ticket: published.append(copy.deepcopy(ticket))
    ns['ssh_receipt_retire'] = lambda run_id: removed.append(ns['ssh_receipt_path'](run_id))
    ns['os'] = types.SimpleNamespace(close=lambda fd: closed.append(fd))
    ns['cgroup_fd'] = lambda *_args: 99
    refuses(ns, lambda: ns['stop'](value, run, run['bootId']), 'PROJECT_IDENTITY_CLEANUP_FAILED')
    assert run['phase'] == 'active' and not published and not removed and closed == [99]
    ns['cgroup_fd'] = lambda *_args: None
    # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
    # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
    # 输入 / Inputs: _run_id。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `OSError('modeled unlink/directory fsync failure')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `OSError`.
    def failed_retirement(_run_id):
        raise OSError('modeled unlink/directory fsync failure')
    ns['ssh_receipt_retire'] = failed_retirement
    try:
        ns['stop'](value, run, run['bootId'])
    except OSError:
        pass
    else:
        raise AssertionError('receipt retirement failure must propagate')
    assert run['phase'] == 'active' and not published and not removed
    ns['ssh_receipt_retire'] = lambda run_id: removed.append(ns['ssh_receipt_path'](run_id))
    assert ns['stop'](value, run, run['bootId'])['phase'] == 'closed'
    assert published[0]['phase'] == 'closed' and removed == [ns['ssh_receipt_path'](run['runId'])]


# 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
# English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `invalid['daemon']['pid']`, `fs.nodes[ns['ssh_receipt_path'](run['runId'])]['data']`, `archives[run['runId']]`, `fs.os.fsync`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('modeled failure did not happen: ' + failure)`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `setup`, `refuses`, `ns['ssh_cleanup_receipt']`, `control`.
# 检查边界 / Checked boundaries: `ns['ssh_cleanup_receipt'](value, run['runId'], run['bootId']) == run`; `control(ns, value, run, 'run') == run and (not writes) and (not actions)`.
# 设计思路：按同步原证明、发布原记录、退役部分回执、发布 closed 状态的提交顺序逐点注入故障；每次中断后检查原权威可恢复，并验证归档墓碑与冲突记录阻止覆盖。
# Design: Inject faults at each commit stage: sync the original proof, publish its record, retire the partial receipt, then publish closed state. After interruption, assert recoverable original authority and verify that archive tombstones or conflicting records prevent overwrites.
def partial_receipt_cleanup_recovery():
    # 中文功能：准备本用例的独立目录与状态，使用例之间的输入和失败注入相互隔离。
    # English: Prepare a private directory and state for this case so inputs and injected failures are isolated between cases.
    # 输入 / Inputs: group_present = False。
    # 结果：返回分支计算值（`(ns, value, run, daemon, receipt, fs, archives, writes, actions)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`(ns, value, run, daemon, receipt, fs, archives, writes, actions)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `fixture`, `AuthorityFilesystem`, `fs.add`, `ns['ssh_receipt_path']`.
    # 设计思路：用显式模型状态和受控适配调用排列边界情景，测试只依据其断言证明相应模型行为，不能外推真实系统权限。
    # Design: Arrange boundary cases with explicit model state and controlled adapters. Assertions establish the corresponding model behavior without attesting real system privileges.
    def setup(group_present=False):
        ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
        fs = AuthorityFilesystem(ns, run, daemon)
        if not group_present:
            del fs.nodes[ns['CGROUP'] + '/' + run['cgroupName']]
        fs.add(ns['ssh_receipt_path'](run['runId']), json.dumps(receipt).encode())
        archives, writes, actions = {}, [], []
        # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
        # English: Read or resolve observable model data for adapted production-definition calls or assertions.
        # 输入 / Inputs: path, limit = 262144, missing = False。
        # 结果：返回分支计算值（`None / node['data']`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`None / node['data']`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `ns['refuse']`, `ns['trusted']`, `fs.info`, `len`.
        def read(path, limit=262144, missing=False):
            if path not in fs.nodes:
                if missing:
                    return None
                ns['refuse']('RECORD_ABSENT')
            node = fs.nodes[path]
            ns['trusted'](fs.info(node), mode=0o600)
            if len(node['data']) > limit:
                ns['refuse']('RECORD_BOUND')
            return node['data']
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: parent, temporary, destination。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 状态影响 / State effects: `fs.nodes[new_path]`. Follow the actual model assignments / 以模型中的实际赋值为准。
        # 协作入口 / Collaborators: `fs.path`, `ns['refuse']`, `fs.nodes.pop`, `actions.append`.
        def publish(parent, temporary, destination):
            old_path, new_path = fs.path(temporary, parent), fs.path(destination, parent)
            if new_path in fs.nodes:
                ns['refuse']('RUN_ARCHIVE_CONFLICT')
            fs.nodes[new_path] = fs.nodes.pop(old_path)
            actions.append(('publish-original', bytes(fs.nodes[new_path]['data'])))
        # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
        # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
        # 输入 / Inputs: path, data。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 状态影响 / State effects: `fs.nodes[path]['data']`. Follow the actual model assignments / 以模型中的实际赋值为准。
        # 协作入口 / Collaborators: `ns['run_path']`, `writes.append`, `ns['run_decode']`, `bytes`.
        # 检查边界 / Checked boundaries: `path == ns['run_path'](run['runId'])`.
        def atomic(path, data):
            assert path == ns['run_path'](run['runId'])
            writes.append(ns['run_decode'](run['runId'], bytes(data)))
            fs.nodes[path]['data'] = bytes(data)
            actions.append('publish-closed')
        ns.update(read=read, run_archive_read=lambda run_id: archives.get(run_id),
            run_entries=lambda: [path.rsplit('/', 1)[1] for path in fs.nodes
                if path.startswith(ns['RUNTIME'] + '/runs/') and path.endswith('.bin')],
            run_archive_publish=publish, atomic=atomic)
        real_unlink, real_fsync = fs.os.unlink, fs.os.fsync
        # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
        # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
        # 输入 / Inputs: path, dir_fd = None。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 协作入口 / Collaborators: `fs.path`, `ns['ssh_receipt_path']`, `actions.append`, `real_unlink`.
        def unlink(path, dir_fd=None):
            full = fs.path(path, dir_fd)
            if full == ns['ssh_receipt_path'](run['runId']):
                actions.append('retire-receipt')
            real_unlink(path, dir_fd)
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: fd。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 协作入口 / Collaborators: `actions.append`, `real_fsync`.
        def fsync(fd):
            actions.append(('sync', fs.fds[fd][0]))
            real_fsync(fd)
        fs.os.unlink, fs.os.fsync = unlink, fsync
        return ns, value, run, daemon, receipt, fs, archives, writes, actions

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: ns, value, run, action。
    # 结果：返回分支计算值（`json.loads(output.getvalue())['result']`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`json.loads(output.getvalue())['result']`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `request['snapshotSha256']`, `ns['os'].environ`, `ns['os'].getuid`, `ns['os'].geteuid`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `dict`, `types.SimpleNamespace`, `base64.b64encode(json.dumps(request).encode()).decode`, `base64.b64encode`.
    def control(ns, value, run, action):
        request = dict(action=action, projectId=value['projectId'],
            expected={key: value[key] for key in ('registryId', 'identityId', 'revision')}, runId=run['runId'])
        if action == 'ssh-session':
            request['snapshotSha256'] = 'b' * 64
        ns['os'].environ = {}
        ns['os'].getuid = ns['os'].geteuid = lambda: 0
        ns['signal'] = types.SimpleNamespace(SIGTERM=15, SIGINT=2, SIGHUP=1, signal=lambda *_args: None)
        ns['sources'] = lambda: run['build']
        ns['open'] = lambda *args: io.StringIO(run['bootId'])
        ns['initialize'] = ns['initialize_readonly'] = lambda: ns['os'].open('/run', ns['os'].O_RDONLY | ns['os'].O_DIRECTORY)
        ns['registry'] = lambda readonly: {'registryId': value['registryId'], 'reserved': {str(value['uid']):
            {'projectId': value['projectId'], 'identityId': value['identityId']}}}
        ns['binding_read'] = ns['active'] = lambda *_args: copy.deepcopy(value)
        ns['sys'] = types.SimpleNamespace(argv=['controller.py', base64.b64encode(json.dumps(request).encode()).decode()])
        with contextlib.redirect_stdout(io.StringIO()) as output:
            ns['main']()
        return json.loads(output.getvalue())['result']

    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    refuses(ns, lambda: ns['run_read'](run['runId']), 'RECORD_ABSENT')
    assert ns['ssh_cleanup_receipt'](value, run['runId'], run['bootId']) == run
    assert control(ns, value, run, 'run') == run and not writes and not actions
    for action in ('run-readonly', 'status', 'ssh-session'):
        refuses(ns, lambda: control(ns, value, run, action), 'RECORD_ABSENT')
        assert not writes and not actions
    assert not fs.fds
    for field, replacement in (('projectId', '1111111111111111'), ('identityId', str(uuid.uuid4())),
                               ('revision', 2), ('registryId', str(uuid.uuid4()))):
        refuses(ns, lambda: ns['ssh_cleanup_receipt'](dict(value, **{field: replacement}), run['runId'], run['bootId']))
    refuses(ns, lambda: ns['ssh_cleanup_receipt'](value, run['runId'], str(uuid.uuid4())), 'RUN_STALE')
    invalid = copy.deepcopy(receipt)
    invalid['daemon']['pid'] = True
    fs.nodes[ns['ssh_receipt_path'](run['runId'])]['data'] = json.dumps(invalid).encode()
    refuses(ns, lambda: ns['ssh_cleanup_receipt'](value, run['runId'], run['bootId']), 'SSH_DAEMON_INVALID')
    assert not writes

    # The original service group must disappear before any materialization.
    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup(True)
    refuses(ns, lambda: ns['stop'](value, copy.deepcopy(run), run['bootId'], True), 'PROJECT_IDENTITY_CLEANUP_FAILED')
    assert not writes and not actions and ns['run_path'](run['runId']) not in fs.nodes
    assert ns['ssh_receipt_path'](run['runId']) in fs.nodes and not fs.fds

    # Complete partial-receipt cleanup publishes the exact active proof first.
    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    assert control(ns, value, run, 'stop') == dict(run, phase='closed')
    assert actions[0][0] == 'sync' and actions[1] == ('publish-original', ns['run_bytes'](run))
    publication = actions.index(('publish-original', ns['run_bytes'](run)))
    retirement = actions.index('retire-receipt')
    closure = actions.index('publish-closed')
    assert publication < retirement < closure
    assert ('sync', ns['RUNTIME'] + '/runs') in actions[publication + 1:retirement]
    assert ('sync', ns['RUNTIME'] + '/ssh') in actions[retirement + 1:closure]
    assert ns['run_read'](run['runId']) == dict(run, phase='closed')
    assert ns['ssh_receipt_path'](run['runId']) not in fs.nodes and not fs.fds

    # Every interrupted write keeps the original authority recoverable.
    for failure in ('file-fsync', 'run-dir-fsync', 'receipt-unlink', 'receipt-dir-fsync', 'closed-write'):
        ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
        good_fsync, good_unlink, good_atomic = fs.os.fsync, fs.os.unlink, ns['atomic']
        # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
        # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
        # 输入 / Inputs: fd。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 失败 / Failure: `OSError('modeled durable write failure')`；由调用者或用例断言观察 / Observed by callers or case assertions.
        # 协作入口 / Collaborators: `OSError`, `good_fsync`.
        def fsync(fd):
            path = fs.fds[fd][0]
            if (failure == 'file-fsync' and '/runs/.record-' in path) or \
               (failure == 'run-dir-fsync' and path == ns['RUNTIME'] + '/runs') or \
               (failure == 'receipt-dir-fsync' and path == ns['RUNTIME'] + '/ssh'):
                raise OSError('modeled durable write failure')
            good_fsync(fd)
        # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
        # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
        # 输入 / Inputs: path, dir_fd = None。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 失败 / Failure: `OSError('modeled receipt unlink failure')`；由调用者或用例断言观察 / Observed by callers or case assertions.
        # 协作入口 / Collaborators: `fs.path`, `ns['ssh_receipt_path']`, `OSError`, `good_unlink`.
        def unlink(path, dir_fd=None):
            if failure == 'receipt-unlink' and fs.path(path, dir_fd) == ns['ssh_receipt_path'](run['runId']):
                raise OSError('modeled receipt unlink failure')
            good_unlink(path, dir_fd)
        # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
        # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
        # 输入 / Inputs: path, data。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 失败 / Failure: `OSError('modeled closed-phase write failure')`；由调用者或用例断言观察 / Observed by callers or case assertions.
        # 协作入口 / Collaborators: `OSError`, `good_atomic`.
        def atomic(path, data):
            if failure == 'closed-write':
                raise OSError('modeled closed-phase write failure')
            good_atomic(path, data)
        fs.os.fsync, fs.os.unlink, ns['atomic'] = fsync, unlink, atomic
        try:
            ns['stop'](value, copy.deepcopy(run), run['bootId'], True)
        except OSError:
            pass
        else:
            raise AssertionError('modeled failure did not happen: ' + failure)
        assert not fs.fds and not writes
        if ns['run_path'](run['runId']) in fs.nodes:
            assert ns['run_read'](run['runId']) == run
        else:
            assert ns['ssh_cleanup_receipt'](value, run['runId'], run['bootId']) == run
        assert all('/runs/.record-' not in path for path in fs.nodes)
        fs.os.fsync, fs.os.unlink, ns['atomic'] = good_fsync, good_unlink, good_atomic
        recovered = control(ns, value, run, 'run')
        assert recovered == run
        assert control(ns, value, run, 'stop') == dict(run, phase='closed')
        assert ns['ssh_receipt_path'](run['runId']) not in fs.nodes

    # Archived UUIDs and conflicting hot originals are never overwritten.
    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    archives[run['runId']] = ns['run_bytes'](dict(run, phase='closed'))
    assert control(ns, value, run, 'run') == dict(run, phase='closed')
    refuses(ns, lambda: ns['stop'](value, copy.deepcopy(run), run['bootId'], True), 'RUN_ARCHIVED')
    assert ns['run_path'](run['runId']) not in fs.nodes and not actions and not writes
    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    original_sync = fs.os.fsync
    foreign = ns['run_bytes'](dict(run, identityId=str(uuid.uuid4())))
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: fd。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `fs.add`, `ns['run_path']`, `original_sync`.
    def conflict(fd):
        if '/runs/.record-' in fs.fds[fd][0]:
            fs.add(ns['run_path'](run['runId']), foreign)
        original_sync(fd)
    fs.os.fsync = conflict
    refuses(ns, lambda: ns['stop'](value, copy.deepcopy(run), run['bootId'], True), 'RUN_ARCHIVE_CONFLICT')
    assert fs.nodes[ns['run_path'](run['runId'])]['data'] == foreign
    assert ns['ssh_receipt_path'](run['runId']) in fs.nodes and not writes and not fs.fds

    # A malformed native record is an authority error, never absence fallback.
    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    fs.add(ns['run_path'](run['runId']), b'broken-native-record')
    for action in ('run', 'stop'):
        refuses(ns, lambda: control(ns, value, run, action), 'RUN_SIZE')
    assert not writes and not actions and ns['ssh_receipt_path'](run['runId']) in fs.nodes

    # A tombstone published before final commit prevents materialization too.
    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    original_sync = fs.os.fsync
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: fd。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `archives[run['runId']]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `ns['run_bytes']`, `dict`, `original_sync`.
    def archive_during_sync(fd):
        if '/runs/.record-' in fs.fds[fd][0]:
            archives[run['runId']] = ns['run_bytes'](dict(run, phase='closed'))
        original_sync(fd)
    fs.os.fsync = archive_during_sync
    refuses(ns, lambda: ns['stop'](value, copy.deepcopy(run), run['bootId'], True), 'RUN_ARCHIVED')
    assert ns['run_path'](run['runId']) not in fs.nodes and ns['ssh_receipt_path'](run['runId']) in fs.nodes
    assert not writes and not fs.fds and all('/runs/.record-' not in path for path in fs.nodes)

    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    ns['run_entries'] = lambda: ['occupied'] * ns['RUN_LIMIT']
    refuses(ns, lambda: ns['stop'](value, copy.deepcopy(run), run['bootId'], True), 'RUN_LIMIT')
    assert not actions and not writes and ns['ssh_receipt_path'](run['runId']) in fs.nodes


for check in (snapshot_and_environment_bounds, command_frame_and_identity_environment,
              service_cgroups_and_daemon_arguments, daemon_process_and_protected_atomic_paths,
              receipts_and_interrupted_prepare,
              snapshot_stdin_deadline_and_eof, session_descriptor_order_and_stdout, session_network_descriptors_are_rejected,
              readonly_probe_and_stop_authority, partial_receipt_cleanup_recovery):
    check()
    checks.append(check.__name__)

print(json.dumps({'passed': True, 'kind': 'portable-model-only', 'checks': checks,
                  'sourceSha256': hashlib.sha256(source).hexdigest()}, separators=(',', ':')))
