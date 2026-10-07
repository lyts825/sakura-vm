# 模块职责：GPG 代理的便携权威模型；文件和进程证据模拟，协议用例使用自有本地 socketpair。
# Module: Portable authority models for the GPG broker; filesystem/process evidence is simulated, while protocol cases use self-owned local socketpairs.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
# 可移植边界模型：通过受控适配器验证生产流程；真实系统权限与进程隔离需另行运行 Linux 验证。
"""Portable models of the production broker, never a Linux/Agent proof.

All process/filesystem authority below is explicitly simulated. Protocol tests
use self-owned local socketpairs with fixed, non-secret bytes.
"""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import stat
import sys
import threading
import time
import types
import uuid

if os.name == 'nt':
    sys.modules['fcntl'] = types.SimpleNamespace(LOCK_EX=2, LOCK_UN=8, flock=lambda *args: None)
for index, name in enumerate(['O_NOFOLLOW', 'O_CLOEXEC', 'O_NONBLOCK', 'O_DIRECTORY']):
    if not hasattr(os, name): setattr(os, name, 1 << (20 + index))
for name, value in [('SCM_RIGHTS', 1), ('MSG_CTRUNC', 8)]:
    if not hasattr(socket, name): setattr(socket, name, value)
if not hasattr(socket, 'CMSG_SPACE'): socket.CMSG_SPACE = lambda size: size + 32
ns = {'__name__': 'gpg_model'}
source = Path(sys.argv[2]).read_bytes()
exec(compile(source, sys.argv[2], 'exec'), ns)


# 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
# English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
# 输入 / Inputs: 无 / none。
# 结果：返回分支计算值（`{'resource': {'version': 1, 'kind': 'gpg-agent', 'leaseId': str(uuid.uuid4()), 'brokerSha256': hashl…`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`{'resource': {'version': 1, 'kind': 'gpg-agent', 'leaseId': str(uuid.uuid4()), 'brokerSha256': hashl…`); its implementation and call sites define the actual type.
# 协作入口 / Collaborators: `str`, `uuid.uuid4`, `hashlib.sha256(source).hexdigest`, `hashlib.sha256`.
def context():
    identity_id = str(uuid.uuid4())
    return {'resource': {'version': 1, 'kind': 'gpg-agent', 'leaseId': str(uuid.uuid4()),
        'brokerSha256': hashlib.sha256(source).hexdigest(), 'timeoutSeconds': 60,
        'hostSourceSha256': 'b' * 64, 'hostHelperSha256': 'c' * 64},
        'identity': {'version': 1, 'phase': 'active', 'registryId': str(uuid.uuid4()), 'projectId': 'default',
            'identityId': identity_id, 'revision': 1, 'account': 'skp' + identity_id.replace('-', '')[:24],
            'uid': 20000, 'gid': 20000, 'home': '/var/lib/sakura-project-homes/' + identity_id,
            'directory': '/workspace/owned', 'directoryDevice': '1', 'directoryInode': '2',
            'homeDevice': '1', 'homeInode': '3', 'networkIsolation': 'private'},
        'owner': {'kind': 'task', 'runId': str(uuid.uuid4()), 'bootId': str(uuid.uuid4())}, 'sha256': 'a' * 64}


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: code, operation。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 失败 / Failure: `AssertionError('accepted ' + code)`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `operation`, `str`, `AssertionError`.
# 检查边界 / Checked boundaries: `str(error) == code`.
def refused(code, operation):
    try: operation()
    except ns['Refused'] as error: assert str(error) == code, (str(error), code)
    else: raise AssertionError('accepted ' + code)


# 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
# English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
# 输入 / Inputs: inode, uid = 0, gid = 0, mode = 448, kind = stat.S_IFDIR。
# 结果：返回分支计算值（`{'device': '1', 'inode': str(inode), 'uid': uid, 'gid': gid, 'mode': mode, 'type': kind}`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`{'device': '1', 'inode': str(inode), 'uid': uid, 'gid': gid, 'mode': mode, 'type': kind}`); its implementation and call sites define the actual type.
# 协作入口 / Collaborators: `str`.
def meta(inode, uid=0, gid=0, mode=0o700, kind=stat.S_IFDIR):
    return {'device': '1', 'inode': str(inode), 'uid': uid, 'gid': gid, 'mode': mode, 'type': kind}


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `bad['resource'][field]`, `bad['resource']['sourcePath']`, `value['phase']`, `value['sourceDirectory']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `context`, `ns['context_checked']`, `copy.deepcopy`, `refused`.
# 检查边界 / Checked boundaries: `ns['context_checked'](ctx) == ctx`.
def strict_context():
    ctx = context(); assert ns['context_checked'](ctx) == ctx
    for field, value in [('kind', 'ssh-agent'), ('hostHelperSha256', 'BAD'), ('version', True), ('timeoutSeconds', 0)]:
        bad = copy.deepcopy(ctx); bad['resource'][field] = value
        refused('CONTEXT_INVALID', lambda: ns['context_checked'](bad))
    bad = copy.deepcopy(ctx); bad['resource']['sourcePath'] = '/tmp/foreign'
    refused('CONTEXT_INVALID', lambda: ns['context_checked'](bad))
    value = ns['initial_record'](ctx); ns['record_checked'](value, ctx)
    value['phase'] = 'prepared'; value['sourceDirectory'] = meta(4)
    ns['record_checked'](value, ctx)
    value['scope'] = {'device': '1', 'inode': '5', 'controlToken': str(uuid.uuid4())}
    refused('RECORD_INVALID', lambda: ns['record_checked'](value, ctx))
    value['phase'] = 'ready'
    refused('RECORD_INVALID', lambda: ns['record_checked'](value, ctx))


# 中文功能：构造本组边界验证所需的模型对象或输入材料。
# English: Construct model objects or input material required by this boundary-verification group.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `peer.alive`, `peer.read`, `ns['boot']`, `ns['directory']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `context`, `str`, `uuid.uuid4`, `ctx['owner']['runId'].encode`.
def peer_identity():
    ctx = context(); scope = {'device': '1', 'inode': '6', 'controlToken': str(uuid.uuid4())}
    expected = b'0::/sakura-task-' + ctx['owner']['runId'].encode()
    fields = {b'Uid': b'20000 20000 20000 20000', b'Gid': b'20000 20000 20000 20000',
        b'Groups': b'', b'NoNewPrivs': b'1', b'CapInh': b'0', b'CapPrm': b'0', b'CapEff': b'0', b'CapBnd': b'0', b'CapAmb': b'0'}
    cgroup = expected; kernel = meta(6); boot = ctx['owner']['bootId']
    peer = ns['Process'].__new__(ns['Process']); peer.alive = lambda: None
    peer.read = lambda name, limit: (b'\n'.join(key + b':' + value for key, value in fields.items()) if name == 'status' else cgroup)
    ns['boot'] = lambda: boot; ns['directory'] = lambda *args, **kwargs: 71
    ns['os'] = types.SimpleNamespace(fstat=lambda fd: types.SimpleNamespace(st_dev=int(kernel['device']), st_ino=int(kernel['inode'])), close=lambda fd: None)
    peer.task(ctx, scope)
    for key in [b'Uid', b'Gid', b'Groups', b'NoNewPrivs', b'CapInh', b'CapPrm', b'CapEff', b'CapBnd', b'CapAmb']:
        prior = fields[key]; fields[key] = b'20000 20000 20001 20000' if key in [b'Uid', b'Gid'] else b'2'
        refused('PEER_ACCOUNT' if key in [b'Uid', b'Gid'] else 'PEER_PRIVILEGES', lambda: peer.task(ctx, scope))
        fields[key] = prior
    for changed in [expected + b'-neighbor', expected + b'/child', expected + b'\n1:name=x:/']:
        cgroup = changed; refused('PEER_SCOPE', lambda: peer.task(ctx, scope))
    cgroup = expected; kernel['inode'] = '999'; refused('CGROUP_CHANGED', lambda: peer.task(ctx, scope)); kernel['inode'] = '6'
    boot = str(uuid.uuid4()); refused('BOOT_CHANGED', lambda: peer.task(ctx, scope))


class PairSocket:
    """Windows has socketpair but no recvmsg; no ancillary exists in this fixture."""
    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self, stream。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.stream`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def __init__(self, stream): self.stream = stream
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self。
    # 结果：返回分支计算值（`self.stream.fileno()`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.stream.fileno()`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.stream.fileno`.
    def fileno(self): return self.stream.fileno()
    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, value。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.stream.setblocking`.
    def setblocking(self, value): self.stream.setblocking(value)
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, data。
    # 结果：返回分支计算值（`self.stream.send(data)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.stream.send(data)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.stream.send`.
    def send(self, data): return self.stream.send(data)
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, size, ancillary_size, flags。
    # 结果：返回分支计算值（`(self.stream.recv(size), [], 0, None)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`(self.stream.recv(size), [], 0, None)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.stream.recv`.
    def recvmsg(self, size, ancillary_size, flags): return self.stream.recv(size), [], 0, None


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: stream。
# 结果：返回分支计算值（`bytes(data)`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`bytes(data)`); its implementation and call sites define the actual type.
# 协作入口 / Collaborators: `bytearray`, `data.endswith`, `stream.recv`, `data.extend`.
# 检查边界 / Checked boundaries: `piece`.
def line(stream):
    data = bytearray()
    while not data.endswith(b'\n'):
        piece = stream.recv(1)
        assert piece, 'unexpected fixture EOF'
        data.extend(piece)
    return bytes(data)


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 协作入口 / Collaborators: `socket.socketpair`, `stream.settimeout`, `threading.Thread`, `runner.start`.
# 检查边界 / Checked boundaries: `line(project) == b'# self-owned fixture\n'`; `line(project) == b'OK hello\n'`.
# 设计思路：将主体计算与 finally 收尾分开，使返回和异常路径经过相同收尾步骤。
# Design: Separate body computation from finally-based finalization so return and exception paths share the same finalization step.
def transparent_protocol():
    local, project = socket.socketpair(); remote, agent = socket.socketpair()
    for stream in [project, agent]: stream.settimeout(5)
    errors = []; requests = []; checks = [0]
    # 中文功能：核对模型证据或测试条件，按实现返回判定或拒绝不符合要求的输入。
    # English: Check model evidence or test conditions, returning a decision or rejecting inputs as specified by the implementation.
    # 输入 / Inputs: 无 / none。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `checks[0]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def check(): checks[0] += 1
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: 无 / none。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `ns['relay']`, `PairSocket`, `time.monotonic`, `errors.append`.
    def relay():
        try: ns['relay'](PairSocket(local), PairSocket(remote), time.monotonic() + 5, check)
        except BaseException as error: errors.append(error)
    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: 无 / none。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `agent.sendall`, `requests.append`, `line`, `requests.extend`.
    # 检查边界 / Checked boundaries: `requests[-1] == b'GETINFO version\n'`; `requests[-1] == b'PKSIGN\n'`.
    def host():
        try:
            agent.sendall(b'# self-owned fixture\nOK hello\n')
            requests.append(line(agent)); assert requests[-1] == b'GETINFO version\n'
            for part in [b'D 2.', b'4.9-test\n', b'OK\n']: agent.sendall(part)
            requests.append(line(agent)); assert requests[-1] == b'PKSIGN\n'
            agent.sendall(b'INQUIRE HASH\nS WAIT\n')
            requests.extend([line(agent), line(agent)])
            assert requests[-2:] == [b'D raw\x00%25%0D%0A\n', b'END\n']
            agent.sendall(b'D signature\x00bytes\nINQUIRE MORE\n')
            requests.append(line(agent)); assert requests[-1] == b'CAN\n'
            agent.sendall(b'ERR 99 fixture canceled\n')
            requests.append(line(agent)); assert requests[-1] == b'BYE\n'
            agent.sendall(b'OK bye\n')
        except BaseException as error: errors.append(error)
    runner = threading.Thread(target=relay); upstream = threading.Thread(target=host)
    try:
        runner.start(); upstream.start()
        assert line(project) == b'# self-owned fixture\n'; assert line(project) == b'OK hello\n'
        project.sendall(b'GETINFO version\nPKSIGN\n')
        assert line(project) == b'D 2.4.9-test\n'; assert line(project) == b'OK\n'
        assert line(project) == b'INQUIRE HASH\n'; assert line(project) == b'S WAIT\n'
        project.sendall(b'D raw\x00%25%0D%0A\nEND\n')
        assert line(project) == b'D signature\x00bytes\n'; assert line(project) == b'INQUIRE MORE\n'
        project.sendall(b'CAN\n'); assert line(project) == b'ERR 99 fixture canceled\n'
        project.sendall(b'BYE\n'); assert line(project) == b'OK bye\n'
        runner.join(5); upstream.join(5)
        assert not runner.is_alive() and not upstream.is_alive() and not errors, errors
        assert checks[0] > 30
    finally:
        for stream in [local, project, remote, agent]: stream.close()


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['os']`, `ns['socket'].SCM_RIGHTS`, `ns['socket'].MSG_CTRUNC`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `ns['Lines']`, `reader.pending.extend`, `reader.take`, `refused`.
# 检查边界 / Checked boundaries: `actual == wire`; `emitted == []`.
def frames_and_revocation():
    reader = ns['Lines'](None)
    for wire in [b'D \x00%25\n', b'OK\r\n', b'D ' + b'x' * 998 + b'\r\n']:
        reader.pending.extend(wire); actual, content = reader.take(); assert actual == wire
    reader.pending.extend(b'D ' + b'x' * 999 + b'\n')
    refused('PROTOCOL_SIZE', reader.take)
    emitted = []
    spy = types.SimpleNamespace(send=lambda data: emitted.append(data) or len(data))
    refused('PEER_SCOPE', lambda: ns['exact_send'](spy, b'PKSIGN\n', time.monotonic() + 5,
        lambda: ns['require'](False, 'PEER_SCOPE')))
    assert emitted == [], 'revocation must precede any buffered release'
    descriptor = os.open(os.devnull, os.O_RDONLY); real_close = os.close; closed = []
    ns['os'] = types.SimpleNamespace(close=lambda fd: (closed.append(fd), real_close(fd)))
    ns['socket'].SCM_RIGHTS = getattr(socket, 'SCM_RIGHTS', 1)
    ns['socket'].MSG_CTRUNC = getattr(socket, 'MSG_CTRUNC', 8)
    incoming = types.SimpleNamespace(recvmsg=lambda *args: (b'# fd\n', [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
        ns['struct'].pack('i', descriptor))], 0, None))
    refused('PROTOCOL_ANCILLARY', lambda: ns['Lines'](incoming).receive()); assert closed == [descriptor]


class Filesystem:
    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.nodes`, `self.fds`, `self.next_fd`, `self.operations`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def __init__(self): self.nodes = {}; self.fds = {}; self.next_fd = 70; self.operations = []
    # 中文功能：构造本组边界验证所需的模型对象或输入材料。
    # English: Construct model objects or input material required by this boundary-verification group.
    # 输入 / Inputs: self, path, metadata, body = b''。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.nodes[path]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def node(self, path, metadata, body=b''): self.nodes[path] = {'meta': metadata, 'body': body}
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, path, mode = None, gid = 0, **kwargs。
    # 结果：返回分支计算值（`self.open(path, 0)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.open(path, 0)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `ns['require']`, `kwargs.get`, `self.mkdir`, `self.open`.
    def directory(self, path, mode=None, gid=0, **kwargs):
        if path not in self.nodes:
            ns['require'](kwargs.get('create', False), 'DIRECTORY_ABSENT')
            self.mkdir(path, 0o700 if mode is None else mode)
        node = self.nodes[path]['meta']
        ns['require'](node['type'] == stat.S_IFDIR and node['uid'] == 0 and node['gid'] == gid and
            (mode is None or node['mode'] == mode), 'DIRECTORY_OWNER')
        return self.open(path, 0)
    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, path, mode, dir_fd = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `FileExistsError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `FileExistsError`, `path.rsplit`, `self.operations.append`, `self.node`.
    # 检查边界 / Checked boundaries: `path.rsplit('/', 1)[0] in self.nodes`.
    def mkdir(self, path, mode, dir_fd=None):
        if dir_fd is not None: path = self.fds[dir_fd][0] + '/' + path
        if path in self.nodes: raise FileExistsError(path)
        assert path.rsplit('/', 1)[0] in self.nodes
        self.operations.append(('mkdir', path)); self.node(path, meta(1000 + len(self.nodes), mode=mode))
    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: self, path, flags, mode = 0, dir_fd = None。
    # 结果：返回分支计算值（`self.next_fd`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.next_fd`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.next_fd`, `self.fds[self.next_fd]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 失败 / Failure: `FileNotFoundError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `FileNotFoundError`.
    # 检查边界 / Checked boundaries: `self.nodes[path]['meta']['type'] != stat.S_IFLNK`.
    def open(self, path, flags, mode=0, dir_fd=None):
        if dir_fd is not None: path = self.fds[dir_fd][0] + '/' + path
        if path not in self.nodes: raise FileNotFoundError(path)
        assert self.nodes[path]['meta']['type'] != stat.S_IFLNK, 'production must never open a data symlink'
        self.next_fd += 1; self.fds[self.next_fd] = [path, 0]; return self.next_fd
    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self, fd。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.fds.pop`.
    def close(self, fd): self.fds.pop(fd)
    # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
    # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
    # 输入 / Inputs: self, path。
    # 结果：返回分支计算值（`types.SimpleNamespace(st_dev=int(value['device']), st_ino=int(value['inode']), st_uid=value['uid'], …`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`types.SimpleNamespace(st_dev=int(value['device']), st_ino=int(value['inode']), st_uid=value['uid'], …`); its implementation and call sites define the actual type.
    # 失败 / Failure: `FileNotFoundError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `FileNotFoundError`, `types.SimpleNamespace`, `int`, `len`.
    def object(self, path):
        if path not in self.nodes: raise FileNotFoundError(path)
        value = self.nodes[path]['meta']
        return types.SimpleNamespace(st_dev=int(value['device']), st_ino=int(value['inode']), st_uid=value['uid'],
            st_gid=value['gid'], st_mode=value['type'] | value['mode'], st_nlink=1, st_size=len(self.nodes[path]['body']))
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, fd。
    # 结果：返回分支计算值（`self.object(self.fds[fd][0])`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.object(self.fds[fd][0])`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.object`.
    def fstat(self, fd): return self.object(self.fds[fd][0])
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, path, dir_fd = None, follow_symlinks = False。
    # 结果：返回分支计算值（`self.object(path)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.object(path)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.object`.
    # 检查边界 / Checked boundaries: `follow_symlinks is False`.
    def stat(self, path, dir_fd=None, follow_symlinks=False):
        assert follow_symlinks is False
        if dir_fd is not None: path = self.fds[dir_fd][0] + '/' + path
        return self.object(path)
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, fd。
    # 结果：返回分支计算值（`[name[len(path) + 1:] for name in self.nodes if name.startswith(path + '/') and '/' not in name[len(…`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`[name[len(path) + 1:] for name in self.nodes if name.startswith(path + '/') and '/' not in name[len(…`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `isinstance`, `len`, `name.startswith`.
    def children(self, fd):
        path = self.fds[fd][0] if isinstance(fd, int) else fd
        return [name[len(path) + 1:] for name in self.nodes if name.startswith(path + '/') and '/' not in name[len(path) + 1:]]
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, fd。
    # 结果：返回分支计算值（`Entries()`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`Entries()`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `Entries`.
    def scandir(self, fd):
        class Entries:
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: inner。
            # 结果：返回分支计算值（`(types.SimpleNamespace(name=name) for name in self.children(fd))`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`(types.SimpleNamespace(name=name) for name in self.children(fd))`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `types.SimpleNamespace`, `self.children`.
            def __enter__(inner): return (types.SimpleNamespace(name=name) for name in self.children(fd))
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: inner, *args。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            def __exit__(inner, *args): pass
        return Entries()
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, fd, size。
    # 结果：返回分支计算值（`value`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`value`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.fds[fd][1]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `len`.
    def read(self, fd, size):
        path, offset = self.fds[fd]; value = self.nodes[path]['body'][offset:offset + size]
        self.fds[fd][1] += len(value); return value
    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, fd, uid, gid。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.operations.append`, `self.nodes[path]['meta'].update`.
    def fchown(self, fd, uid, gid):
        path = self.fds[fd][0]; self.operations.append(('freeze', path))
        self.nodes[path]['meta'].update(uid=uid, gid=gid)
    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, fd, mode。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.nodes[self.fds[fd][0]]['meta']['mode']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def fchmod(self, fd, mode): self.nodes[self.fds[fd][0]]['meta']['mode'] = mode
    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self, name, dir_fd。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.operations.append`.
    def unlink(self, name, dir_fd):
        path = self.fds[dir_fd][0] + '/' + name; self.operations.append(('unlink', path)); del self.nodes[path]
    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self, name, dir_fd。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.children`, `self.operations.append`.
    # 检查边界 / Checked boundaries: `not self.children(path)`.
    def rmdir(self, name, dir_fd):
        path = self.fds[dir_fd][0] + '/' + name; assert not self.children(path)
        self.operations.append(('rmdir', path)); del self.nodes[path]
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self。
    # 结果：返回分支计算值（`value`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`value`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `value.path`, `value.listdir`, `value.fsync`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `types.SimpleNamespace`, `getattr`, `setattr`.
    def module(self):
        value = types.SimpleNamespace(**{name: getattr(os, name) for name in ['O_RDONLY', 'O_DIRECTORY', 'O_NOFOLLOW', 'O_CLOEXEC', 'O_NONBLOCK']})
        value.path = types.SimpleNamespace(lexists=lambda path: path in self.nodes)
        for name in ['open', 'close', 'fstat', 'stat', 'scandir', 'read', 'fchown', 'fchmod', 'unlink', 'rmdir', 'mkdir']: setattr(value, name, getattr(self, name))
        value.listdir = self.children; value.fsync = lambda fd: None
        return value


# 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
# English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
# 输入 / Inputs: 无 / none。
# 结果：返回分支计算值（`(ctx, value, fs, saved)`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`(ctx, value, fs, saved)`); its implementation and call sites define the actual type.
# 状态影响 / State effects: `value['phase']`, `value['failure']`, `value['homeDirectory']`, `value['home']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `context`, `ns['initial_record']`, `Filesystem`, `ns['home_path'](ctx).rsplit`.
def cleanup_fixture():
    ctx = context(); value = ns['initial_record'](ctx); value['phase'] = 'failed'; value['failure'] = 'OWN_FIXTURE'
    fs = Filesystem(); parent = ns['home_path'](ctx).rsplit('/', 1)[0]; home = ns['home_path'](ctx)
    fs.node(ns['HOMES'], meta(1, mode=0o755)); fs.node(parent, meta(2, gid=20000, mode=0o710))
    fs.node(home, meta(3, uid=20000, gid=20000)); fs.node(home + '/S.gpg-agent', meta(4, gid=20000, mode=0o440, kind=stat.S_IFREG), ns['redirect_bytes'](ctx))
    fs.node(home + '/pubring.kbx', meta(5, uid=20000, gid=20000, mode=0o600, kind=stat.S_IFREG))
    fs.node(home + '/data', meta(6, uid=20000, gid=20000)); fs.node(home + '/data/trustdb.lock', meta(7, uid=20000, gid=20000, mode=0o600, kind=stat.S_IFREG))
    fs.node(home + '/link', meta(8, uid=20000, gid=20000, mode=0o777, kind=stat.S_IFLNK))
    fs.node('/workspace/foreign', meta(9, uid=20000, gid=20000, mode=0o600, kind=stat.S_IFREG), b'must survive')
    value['homeDirectory'] = copy.deepcopy(fs.nodes[parent]['meta']); value['home'] = copy.deepcopy(fs.nodes[home]['meta'])
    value['redirect'] = {'object': copy.deepcopy(fs.nodes[home + '/S.gpg-agent']['meta']), 'sha256': hashlib.sha256(ns['redirect_bytes'](ctx)).hexdigest()}
    saved = []; ns['save_record'] = lambda record: (ns['record_checked'](record, ctx), saved.append(copy.deepcopy(record)))
    ns['directory'] = fs.directory; ns['os'] = fs.module(); ns['stopped'] = lambda context: context['owner']['bootId']; ns['no_home_mounts'] = lambda context: None
    return ctx, value, fs, saved


# 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
# English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 协作入口 / Collaborators: `cleanup_fixture`, `copy.deepcopy`, `ns['clean_home']`, `ns['home_path'](ctx).rsplit`.
# 检查边界 / Checked boundaries: `value['home'] == original and value['homeCleanup']['phase'] == 'removed'`; `value['homeCleanup']['frozenHome'] == {**original, 'uid': 0, 'gid': 0, 'mode': 448}`.
def frozen_cleanup():
    ctx, value, fs, saved = cleanup_fixture(); original = copy.deepcopy(value['home'])
    ns['clean_home'](value)
    assert value['home'] == original and value['homeCleanup']['phase'] == 'removed'
    assert value['homeCleanup']['frozenHome'] == {**original, 'uid': 0, 'gid': 0, 'mode': 0o700}
    assert ns['home_path'](ctx).rsplit('/', 1)[0] not in fs.nodes and fs.nodes['/workspace/foreign']['body'] == b'must survive'
    assert saved[0]['homeCleanup']['phase'] == 'freeze-intent'
    assert value['homeCleanup']['directories'][0]['phase'] == 'removed' and not fs.fds
    assert fs.operations.index(('freeze', ns['home_path'](ctx))) < fs.operations.index(('unlink', ns['home_path'](ctx) + '/pubring.kbx'))


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['save_record']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('crash was not injected')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `cleanup_fixture`, `ns['clean_home']`, `AssertionError`, `copy.deepcopy`.
# 检查边界 / Checked boundaries: `recovered['homeCleanup']['directories'][0]['phase'] == 'freeze-intent'`; `fs.nodes[ns['home_path'](ctx) + '/data']['meta']['uid'] == 0`.
def freeze_crash_retry():
    ctx, value, fs, saved = cleanup_fixture(); durable = ns['save_record']
    # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
    # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
    # 输入 / Inputs: record。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `OSError('own simulated crash after fchown')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `OSError`, `durable`.
    def crash(record):
        if record['homeCleanup'] and record['homeCleanup']['directories'] and record['homeCleanup']['directories'][0]['phase'] == 'frozen':
            raise OSError('own simulated crash after fchown')
        durable(record)
    ns['save_record'] = crash
    try: ns['clean_home'](value)
    except OSError: pass
    else: raise AssertionError('crash was not injected')
    recovered = copy.deepcopy(saved[-1]); assert recovered['homeCleanup']['directories'][0]['phase'] == 'freeze-intent'
    assert fs.nodes[ns['home_path'](ctx) + '/data']['meta']['uid'] == 0
    ns['save_record'] = durable; ns['clean_home'](recovered)
    assert recovered['homeCleanup']['phase'] == 'removed' and not fs.fds


# 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
# English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `fs.nodes[ns['home_path'](ctx) + '/data']['meta']['uid']`, `fs.nodes[ns['home_path'](ctx)]['meta']['inode']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `cleanup_fixture`, `ns['home_path']`, `refused`.
# 检查边界 / Checked boundaries: `ns['home_path'](ctx) in fs.nodes and '/workspace/foreign' in fs.nodes and (not fs.fds)`; `not fs.operations and (not fs.fds)`.
def foreign_cleanup():
    ctx, value, fs, saved = cleanup_fixture(); fs.nodes[ns['home_path'](ctx) + '/data']['meta']['uid'] = 0
    refused('HOME_DIRECTORY_OWNER', lambda: ns['clean_home'](value))
    assert ns['home_path'](ctx) in fs.nodes and '/workspace/foreign' in fs.nodes and not fs.fds
    ctx, value, fs, saved = cleanup_fixture(); fs.nodes[ns['home_path'](ctx)]['meta']['inode'] = '999'
    refused('HOME_REPLACED', lambda: ns['clean_home'](value))
    assert not fs.operations and not fs.fds


# 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
# English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['os'].open`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `ns['valid_data_name']`, `cleanup_fixture`, `ns['home_path']`, `fs.node`.
# 检查边界 / Checked boundaries: `ns['valid_data_name'](name)`; `not ns['valid_data_name'](name)`.
def backup_cleanup():
    for name in ['pubring.kbx~', 'backup~', '.#lk0x123.host.456', 'trustdb.gpg.lock']:
        assert ns['valid_data_name'](name)
    for name in ['.', '..', '../pubring.kbx~', 'backup~/foreign', 'backup~\\foreign', 'x' * 256]:
        assert not ns['valid_data_name'](name)
    ctx, value, fs, saved = cleanup_fixture(); home = ns['home_path'](ctx)
    fs.node(home + '/pubring.kbx~', meta(20, uid=20000, gid=20000, mode=0o600, kind=stat.S_IFREG))
    fs.node(home + '/backup~', meta(21, uid=20000, gid=20000))
    fs.node(home + '/backup~/trustdb.gpg~', meta(22, uid=20000, gid=20000, mode=0o600, kind=stat.S_IFREG))
    original = copy.deepcopy(value['home']); ns['clean_home'](value)
    assert home not in fs.nodes and value['home'] == original and not fs.fds
    child = next(child for child in value['homeCleanup']['directories'] if child['path'] == ['backup~'])
    assert child['phase'] == 'removed' and child['original']['inode'] == child['frozen']['inode'] == '21'
    assert fs.operations.index(('freeze', home + '/backup~')) < fs.operations.index(('unlink', home + '/backup~/trustdb.gpg~'))
    assert fs.nodes['/workspace/foreign']['body'] == b'must survive'

    ctx, value, fs, saved = cleanup_fixture(); home = ns['home_path'](ctx)
    fs.node(home + '/pubring.kbx~', meta(20, uid=20001, gid=20000, mode=0o600, kind=stat.S_IFREG))
    refused('HOME_DATA_OWNER', lambda: ns['clean_home'](value))
    assert fs.nodes[home + '/pubring.kbx~']['meta']['uid'] == 20001 and not fs.fds
    assert ('unlink', home + '/pubring.kbx~') not in fs.operations
    assert fs.nodes['/workspace/foreign']['body'] == b'must survive'

    ctx, value, fs, saved = cleanup_fixture(); home = ns['home_path'](ctx)
    fs.node(home + '/backup~', meta(21, uid=20000, gid=20000))
    original_open = ns['os'].open
    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: name, flags, dir_fd = None。
    # 结果：返回分支计算值（`original_open(name, flags, dir_fd=dir_fd)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`original_open(name, flags, dir_fd=dir_fd)`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `fs.nodes[home + '/backup~']['meta']['inode']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `original_open`.
    def replaced_open(name, flags, dir_fd=None):
        if name == 'backup~': fs.nodes[home + '/backup~']['meta']['inode'] = '999'
        return original_open(name, flags, dir_fd=dir_fd)
    ns['os'].open = replaced_open
    refused('HOME_DIRECTORY_REPLACED', lambda: ns['clean_home'](value))
    assert fs.nodes[home + '/backup~']['meta']['uid'] == 20000 and not fs.fds
    assert ('freeze', home + '/backup~') not in fs.operations and ('rmdir', home + '/backup~') not in fs.operations
    assert fs.nodes['/workspace/foreign']['body'] == b'must survive'


# 中文功能：构造本组边界验证所需的模型对象或输入材料。
# English: Construct model objects or input material required by this boundary-verification group.
# 输入 / Inputs: 无 / none。
# 结果：返回分支计算值（`(ctx, fs, durable, saved)`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`(ctx, fs, durable, saved)`); its implementation and call sites define the actual type.
# 状态影响 / State effects: `ns['os']`, `ns['directory']`, `ns['boot']`, `ns['locked']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `context`, `Filesystem`, `enumerate`, `fs.node`.
def lifecycle_fixture():
    ctx = context(); fs = Filesystem(); saved = []; durable = [None]
    for index, path in enumerate(['/run', ns['ROOT'], ns['RECORDS']]): fs.node(path, meta(100 + index, mode=0o755 if path == '/run' else 0o700))
    lock = ns['ROOT'] + '/resources.lock'; fs.node(lock, meta(110, mode=0o600, kind=stat.S_IFREG))
    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: value。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `durable[0]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `ns['record_checked']`, `copy.deepcopy`, `saved.append`.
    def save(value):
        ns['record_checked'](value, ctx); durable[0] = copy.deepcopy(value); saved.append(copy.deepcopy(value))
    ns['os'] = fs.module(); ns['directory'] = fs.directory
    ns['boot'] = lambda: ctx['owner']['bootId']; ns['locked'] = lambda create=False: fs.open(lock, 0)
    ns['read_record'] = lambda context: copy.deepcopy(durable[0]); ns['save_record'] = save
    ns['no_home_mounts'] = lambda context: None
    return ctx, fs, durable, saved


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `fs.nodes[ns['source_path'](ctx).rsplit('/', 1)[0]]['meta']['inode']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `lifecycle_fixture`, `ns['prepare']`, `copy.deepcopy`, `ns['source_path']`.
# 检查边界 / Checked boundaries: `reply['phase'] == 'prepared' and reply['record']['scope'] is None and (reply['record']['broker'] is …`; `reply['sourcePath'] == ns['source_path'](ctx)`.
def prepared_admission():
    ctx, fs, durable, saved = lifecycle_fixture()
    reply = ns['prepare'](ctx); original = copy.deepcopy(durable[0])
    assert reply['phase'] == 'prepared' and reply['record']['scope'] is None and reply['record']['broker'] is None
    assert reply['sourcePath'] == ns['source_path'](ctx)
    assert [entry['phase'] for entry in saved] == ['preparing', 'prepared']
    assert saved[0]['sourceDirectory'] is None and durable[0]['sourceDirectory'] is not None
    assert not fs.fds and not any(path.startswith(ns['HOMES']) or path.startswith(ns['SOCKETS']) for path in fs.nodes)
    assert ns['prepare'](ctx)['record'] == original and len(saved) == 2 and not fs.fds
    fs.node(ns['source_path'](ctx), meta(120, mode=0o755, kind=stat.S_IFSOCK))
    refused('SOURCE_REPLACED', lambda: ns['prepare'](ctx)); assert durable[0] == original
    scope = {'device': '1', 'inode': '121', 'controlToken': str(uuid.uuid4())}
    adopted = ns['adopt_task_scope'](ctx, scope)
    assert adopted['scope'] == scope and adopted['phase'] == 'preparing' and not fs.fds
    refused('RESOURCE_NOT_PREPARED', lambda: ns['adopt_task_scope'](ctx, scope))
    refused('RESOURCE_NOT_PREPARED', lambda: ns['adopt_task_scope'](ctx, {**scope, 'inode': '122'}))
    assert durable[0] == adopted and len(saved) == 3
    ctx, fs, durable, saved = lifecycle_fixture(); ns['prepare'](ctx); original = copy.deepcopy(durable[0])
    fs.nodes[ns['source_path'](ctx).rsplit('/', 1)[0]]['meta']['inode'] = '999'
    refused('SOURCE_REPLACED', lambda: ns['adopt_task_scope'](ctx, scope))
    assert durable[0] == original and not fs.fds


# 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
# English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 协作入口 / Collaborators: `lifecycle_fixture`, `ns['cleanup']`, `ns['prepare']`, `copy.deepcopy`.
# 检查边界 / Checked boundaries: `ns['cleanup'](ctx) == {'phase': 'closed', 'context': ctx, 'record': None}`; `not fs.operations and (not fs.fds)`.
def absent_and_prepared_cleanup():
    ctx, fs, durable, saved = lifecycle_fixture()
    assert ns['cleanup'](ctx) == {'phase': 'closed', 'context': ctx, 'record': None}
    assert not fs.operations and not fs.fds
    ns['prepare'](ctx); original = copy.deepcopy(durable[0])
    fs.node(ns['source_path'](ctx), meta(120, mode=0o755, kind=stat.S_IFSOCK))
    operations = copy.deepcopy(fs.operations)
    refused('SOURCE_CLOSE_UNCONFIRMED', lambda: ns['cleanup'](ctx))
    assert durable[0] == original and fs.operations == operations and not fs.fds
    del fs.nodes[ns['source_path'](ctx)]
    closed = ns['cleanup'](ctx); assert closed['record']['phase'] == 'closed' and closed['record']['scope'] is None
    assert ns['source_path'](ctx).rsplit('/', 1)[0] not in fs.nodes and not fs.fds
    assert ns['cleanup'](ctx) == closed
    fs.node(ns['source_path'](ctx).rsplit('/', 1)[0], meta(121))
    refused('CLOSED_SOURCE_PRESENT', lambda: ns['cleanup'](ctx)); assert durable[0] == closed['record'] and not fs.fds
    ctx, fs, durable, saved = lifecycle_fixture(); fs.node(ns['SOURCES'], meta(130))
    fs.node(ns['source_path'](ctx).rsplit('/', 1)[0], meta(131))
    refused('RESOURCE_UNCONFIRMED', lambda: ns['cleanup'](ctx))
    assert not fs.operations and not fs.fds
    del fs.nodes[ns['RECORDS']]
    refused('RESOURCE_UNCONFIRMED', lambda: ns['cleanup'](ctx))
    assert not fs.operations and not fs.fds
    fs.node(ns['scope_path'](ctx), meta(140)); refused('SCOPE_ACTIVE', lambda: ns['cleanup'](ctx))
    assert not fs.operations and not fs.fds


# 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
# English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `value['redirect']`, `value['home']`, `ns['save_record']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('post-rmdir crash was not injected')`; `AssertionError('removing journal failure was not injected')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `cleanup_fixture`, `ns['home_path']`, `ns['clean_home']`, `copy.deepcopy`.
# 检查边界 / Checked boundaries: `value['homeCleanup']['phase'] == 'removed' and (not fs.fds)`; `'/workspace/foreign' in fs.nodes`.
def partial_home_cleanup():
    ctx, value, fs, saved = cleanup_fixture(); home = ns['home_path'](ctx)
    del fs.nodes[home + '/S.gpg-agent']; value['redirect'] = None
    ns['clean_home'](value); assert value['homeCleanup']['phase'] == 'removed' and not fs.fds
    assert '/workspace/foreign' in fs.nodes
    ctx, value, fs, saved = cleanup_fixture(); del fs.nodes[ns['home_path'](ctx) + '/S.gpg-agent']
    ns['clean_home'](value); assert value['homeCleanup']['phase'] == 'removed' and not fs.fds
    ctx, value, fs, saved = cleanup_fixture(); value['redirect'] = None
    operations = copy.deepcopy(fs.operations)
    refused('REDIRECT_UNCONFIRMED', lambda: ns['clean_home'](value))
    assert fs.operations == operations and not fs.fds and value['homeCleanup'] is None
    ctx, value, fs, saved = cleanup_fixture(); value['home'] = None
    refused('HOME_UNCONFIRMED', lambda: ns['clean_home'](value))
    assert not fs.operations and not fs.fds
    # A durable removing phase can be retried after unlink/rmdir, without
    # inventing a replacement inode for either the absent home or its parent.
    ctx, value, fs, saved = cleanup_fixture(); durable = ns['save_record']
    # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
    # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
    # 输入 / Inputs: record。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `OSError('own post-rmdir crash')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `OSError`, `durable`.
    def crash(record):
        if record['homeCleanup'] and record['homeCleanup']['phase'] == 'removed': raise OSError('own post-rmdir crash')
        durable(record)
    ns['save_record'] = crash
    try: ns['clean_home'](value)
    except OSError: pass
    else: raise AssertionError('post-rmdir crash was not injected')
    recovered = saved[-1]; assert recovered['homeCleanup']['phase'] == 'removing' and ns['home_path'](ctx) not in fs.nodes
    ns['save_record'] = durable; ns['clean_home'](recovered)
    assert recovered['homeCleanup']['phase'] == 'removed' and not fs.fds
    # Journal write errors after obtaining the frozen top fd must close it.
    ctx, value, fs, saved = cleanup_fixture(); durable = ns['save_record']
    # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
    # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
    # 输入 / Inputs: record。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `OSError('own journal write failure')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `OSError`, `durable`.
    def fail_removing(record):
        if record['homeCleanup'] and record['homeCleanup']['phase'] == 'removing': raise OSError('own journal write failure')
        durable(record)
    ns['save_record'] = fail_removing
    try: ns['clean_home'](value)
    except OSError: pass
    else: raise AssertionError('removing journal failure was not injected')
    assert not fs.fds and fs.nodes[ns['home_path'](ctx)]['meta']['uid'] == 0


# 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
# English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `fs.nodes[child]['meta']['mode']`, `ns['os'].fchown`, `ns['os'].fchmod`, `value['homeCleanup']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('chown/chmod crash was not injected')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `cleanup_fixture`, `ns['home_path']`, `copy.deepcopy`, `ns['clean_home']`.
# 检查边界 / Checked boundaries: `transition['original'] == original and transition['frozen'] == {**original, 'uid': 0, 'gid': 0, 'mod…`; `transition['phase'] == 'removed' and (not fs.fds)`.
def directory_modes_and_chown_retry():
    for mode in [0, 0o755, 0o777, 0o1700, 0o2700, 0o4755]:
        ctx, value, fs, saved = cleanup_fixture(); child = ns['home_path'](ctx) + '/data'
        fs.nodes[child]['meta']['mode'] = mode
        original = copy.deepcopy(fs.nodes[child]['meta'])
        ns['clean_home'](value)
        transition = value['homeCleanup']['directories'][0]
        assert transition['original'] == original and transition['frozen'] == {**original, 'uid': 0, 'gid': 0, 'mode': 0o700}
        assert transition['phase'] == 'removed' and not fs.fds
        for cleared in [False, True]:
            ctx, value, fs, saved = cleanup_fixture(); child = ns['home_path'](ctx) + '/data'
            fs.nodes[child]['meta']['mode'] = mode; durable = ns['save_record']
            real_chown, real_chmod = fs.fchown, fs.fchmod; interrupted = [False]
            # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
            # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
            # 输入 / Inputs: fd, uid, gid。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 状态影响 / State effects: `fs.nodes[child]['meta']['mode']`. Follow the actual model assignments / 以模型中的实际赋值为准。
            # 协作入口 / Collaborators: `real_chown`.
            def chown(fd, uid, gid):
                real_chown(fd, uid, gid)
                if fs.fds[fd][0] == child and cleared: fs.nodes[child]['meta']['mode'] &= ~0o6000
            # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
            # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
            # 输入 / Inputs: fd, new_mode。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 状态影响 / State effects: `interrupted[0]`. Follow the actual model assignments / 以模型中的实际赋值为准。
            # 失败 / Failure: `OSError('own simulated crash between chown and chmod')`；由调用者或用例断言观察 / Observed by callers or case assertions.
            # 协作入口 / Collaborators: `OSError`, `real_chmod`.
            def chmod(fd, new_mode):
                if fs.fds[fd][0] == child and not interrupted[0]:
                    interrupted[0] = True; raise OSError('own simulated crash between chown and chmod')
                real_chmod(fd, new_mode)
            ns['os'].fchown = chown; ns['os'].fchmod = chmod
            try: ns['clean_home'](value)
            except OSError: pass
            else: raise AssertionError('chown/chmod crash was not injected')
            recovered = copy.deepcopy(saved[-1]); entry = recovered['homeCleanup']['directories'][0]
            assert entry['phase'] == 'freeze-intent' and fs.nodes[child]['meta']['uid'] == 0 and not fs.fds
            ns['os'].fchown = real_chown; ns['os'].fchmod = real_chmod
            ns['clean_home'](recovered); assert recovered['homeCleanup']['phase'] == 'removed' and not fs.fds
    ctx, value, fs, saved = cleanup_fixture(); child = ns['home_path'](ctx) + '/data'
    value['homeCleanup'] = {'phase': 'freeze-intent', 'frozenHome': None, 'directories': [
        {'path': ['data'], 'phase': 'freeze-intent', 'original': copy.deepcopy(fs.nodes[child]['meta']),
         'frozen': {**fs.nodes[child]['meta'], 'uid': 0, 'gid': 0, 'mode': 0o700}}]}
    fs.nodes[child]['meta'].update(uid=0, gid=0, mode=0o755)
    refused('HOME_DIRECTORY_REPLACED', lambda: ns['clean_home'](value)); assert not fs.fds


# 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
# English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `value['home']`, `value['homeCleanup']`, `ns['directory']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `cleanup_fixture`, `ns['home_path']`, `range`, `fs.node`.
# 检查边界 / Checked boundaries: `ns['MAX_HOME_ENTRIES'] == 4096 and ns['MAX_HOME_DIRECTORIES'] == 128 and (ns['MAX_HOME_DEPTH'] == 16…`; `ns['MAX_RECORD_BYTES'] == 262144`.
def cleanup_budgets():
    assert ns['MAX_HOME_ENTRIES'] == 4096 and ns['MAX_HOME_DIRECTORIES'] == 128 and ns['MAX_HOME_DEPTH'] == 16
    assert ns['MAX_RECORD_BYTES'] == 262144
    ctx, value, fs, saved = cleanup_fixture(); home = ns['home_path'](ctx)
    for index in range(4097): fs.node(home + '/entry-' + str(index), meta(200 + index, uid=20000, gid=20000, mode=0o600, kind=stat.S_IFREG))
    refused('HOME_ENTRY_BUDGET', lambda: ns['clean_home'](value)); assert not fs.fds and home in fs.nodes
    ctx, value, fs, saved = cleanup_fixture(); home = ns['home_path'](ctx)
    for index in range(129): fs.node(home + '/dir-' + str(index), meta(200 + index, uid=20000, gid=20000))
    refused('HOME_DIRECTORY_BUDGET', lambda: ns['clean_home'](value))
    assert len(value['homeCleanup']['directories']) == 128 and not fs.fds
    ctx, value, fs, saved = cleanup_fixture(); path = ns['home_path'](ctx)
    for index in range(17): path += '/depth-' + str(index); fs.node(path, meta(200 + index, uid=20000, gid=20000))
    refused('HOME_DEPTH_BUDGET', lambda: ns['clean_home'](value))
    assert len(value['homeCleanup']['directories']) == 17 and not fs.fds
    # Save uses the production serializer; an oversized, otherwise well-typed
    # journal must fail before opening a file or publishing any replacement.
    value = ns['initial_record'](context()); value['home'] = meta(10, uid=20000, gid=20000)
    original = meta(20, uid=20000, gid=20000)
    value['homeCleanup'] = {'phase': 'removing', 'frozenHome': {**value['home'], 'uid': 0, 'gid': 0}, 'directories': [
        {'path': ['a' * 250 + str(index)] + ['b' * 255] * 15, 'phase': 'freeze-intent',
         'original': original, 'frozen': {**original, 'uid': 0, 'gid': 0}} for index in range(128)]}
    ns['directory'] = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('budget must precede open'))
    refused('RECORD_BUDGET', lambda: production_save(value))


# 中文功能：核对模型证据或测试条件，按实现返回判定或拒绝不符合要求的输入。
# English: Check model evidence or test conditions, returning a decision or rejecting inputs as specified by the implementation.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['directory']`, `ns['os']`, `process.pid`, `process.start`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `Filesystem`, `context`, `ns['source_path'](ctx).rsplit`, `ns['source_path']`.
# 检查边界 / Checked boundaries: `fs.nodes[ns['source_path'](ctx)]['meta']['mode'] == mode and (not fs.operations)`; `not fs.fds and all((stream.closed for stream in streams))`.
# 设计思路：将主体计算与 finally 收尾分开，使返回和异常路径经过相同收尾步骤。
# Design: Separate body computation from finally-based finalization so return and exception paths share the same finalization step.
def source_and_birth_checks():
    fs = Filesystem(); ctx = context(); parent = ns['source_path'](ctx).rsplit('/', 1)[0]
    fs.node(parent, meta(1)); fs.node(ns['source_path'](ctx), meta(2, mode=0o755, kind=stat.S_IFSOCK))
    ns['directory'] = fs.directory; ns['os'] = fs.module()
    process = ns['Process'].__new__(ns['Process']); process.pid = 55; process.start = '123'; process.pidfd = 72; process.directory = 73
    kernel = {'ticks': '123', 'state': 'S', 'exited': False, 'uid': b'0 0 0 0', 'gid': b'0 0 0 0'}
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: name, limit。
    # 结果：返回分支计算值（`('55 (own fixture) ' + kernel['state'] + ' ' + ' '.join(['0'] * 18) + ' ' + kernel['ticks']).encode(… / b'Uid:' + kernel['uid'] + b'\nGid:' + kernel['gid']`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`('55 (own fixture) ' + kernel['state'] + ' ' + ' '.join(['0'] * 18) + ' ' + kernel['ticks']).encode(… / b'Uid:' + kernel['uid'] + b'\nGid:' + kernel['gid']`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `('55 (own fixture) ' + kernel['state'] + ' ' + ' '.join(['0'] * 18) + ' ' + kernel['ticks']).encode`, `' '.join`.
    def read(name, limit):
        if name == 'stat': return ('55 (own fixture) ' + kernel['state'] + ' ' + ' '.join(['0'] * 18) + ' ' + kernel['ticks']).encode()
        return b'Uid:' + kernel['uid'] + b'\nGid:' + kernel['gid']
    process.read = read; ns['select'] = types.SimpleNamespace(select=lambda *args: ([72] if kernel['exited'] else [], [], []))
    ns['Process'] = lambda pid: process; process.close = lambda: None
    ns['credentials'] = lambda stream: (55, 0, 0)
    streams = []; original_connect = ns['Source'].connect_raw
    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: source。
    # 结果：返回分支计算值（`stream`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`stream`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `stream.close`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `types.SimpleNamespace`, `streams.append`.
    def connect_raw(source):
        stream = types.SimpleNamespace(closed=False)
        stream.close = lambda: setattr(stream, 'closed', True); streams.append(stream); return stream
    ns['Source'].connect_raw = connect_raw
    try:
        for mode in [0o755, 0o777]:
            fs.nodes[ns['source_path'](ctx)]['meta']['mode'] = mode
            source = ns['Source'](ns['source_path'](ctx)); source.check()
            upstream = source.connect(); upstream.close(); source.close()
            assert fs.nodes[ns['source_path'](ctx)]['meta']['mode'] == mode and not fs.operations
        source = ns['Source'](ns['source_path'](ctx)); leaf = fs.nodes[ns['source_path'](ctx)]['meta']
        leaf['mode'] = 0o755; refused('SOURCE_REPLACED', source.check); leaf['mode'] = 0o777
        kernel['uid'] = b'0 0 1 0'; refused('SOURCE_PEER_ACCOUNT', source.check); kernel['uid'] = b'0 0 0 0'
        kernel['gid'] = b'0 1 0 0'; refused('SOURCE_PEER_ACCOUNT', source.check); kernel['gid'] = b'0 0 0 0'
        kernel['ticks'] = '124'; refused('PROCESS_CHANGED', source.check); kernel['ticks'] = '123'
        kernel['state'] = 'Z'; refused('PROCESS_CHANGED', source.check); kernel['state'] = 'S'
        kernel['exited'] = True; refused('PROCESS_EXITED', source.check); kernel['exited'] = False
        for mode in [0o750, 0o755, 0o770, 0o777]:
            fs.nodes[parent]['meta']['mode'] = mode; refused('DIRECTORY_OWNER', source.check)
        fs.nodes[parent]['meta']['mode'] = 0o700
        ns['credentials'] = lambda stream: (56, 0, 0); refused('SOURCE_PEER_CHANGED', source.connect)
        source.close(); assert not fs.fds and all(stream.closed for stream in streams)
    finally: ns['Source'].connect_raw = original_connect


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `other['phase']`, `other['sourceDirectory']`, `other['source']`, `fs.nodes[filename]['body']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `lifecycle_fixture`, `context`, `ns['initial_record']`, `meta`.
# 检查边界 / Checked boundaries: `not fs.fds`; `not fs.fds`.
def source_exclusivity():
    ctx, fs, durable, saved = lifecycle_fixture(); other_ctx = context()
    other = ns['initial_record'](other_ctx); other['phase'] = 'prepared'; other['sourceDirectory'] = meta(150)
    filename = ns['RECORDS'] + '/' + ns['record_name'](other_ctx)
    fs.node(filename, meta(151, mode=0o600, kind=stat.S_IFREG), json.dumps(other).encode())
    fixed_source = {'path': ns['source_path'](ctx), 'parent': meta(152),
        'socket': meta(153, mode=0o755, kind=stat.S_IFSOCK), 'peer': {'pid': 50, 'startTicks': '60'}}
    ns['source_exclusive'](ctx, fixed_source); assert not fs.fds
    other['phase'] = 'failed'; other['source'] = {**fixed_source, 'path': ns['source_path'](other_ctx), 'parent': other['sourceDirectory']}
    fs.nodes[filename]['body'] = json.dumps(other).encode()
    refused('SOURCE_SHARED', lambda: ns['source_exclusive'](ctx, other['source'])); assert not fs.fds
    other['phase'] = 'closed'; fs.nodes[filename]['body'] = json.dumps(other).encode()
    ns['source_exclusive'](ctx, other['source']); assert not fs.fds
    fs.nodes[filename]['body'] = json.dumps({**other, 'foreign': 'entry'}).encode()
    refused('RECORD_INVALID', lambda: ns['source_exclusive'](ctx, fixed_source)); assert not fs.fds


# 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
# English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['source_peer_ended']`, `ns['source_listener_absent']`, `fs.nodes[source['path']]['meta'][field]`, `fs.nodes[parent]['meta']['inode']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `copy.deepcopy`, `cleanup`, `refused`.
# 检查边界 / Checked boundaries: `source['path'] not in fs.nodes and fs.nodes[neighbor] == before`; `fs.operations == [('unlink', source['path'])] and (not fs.fds)`.
def source_closed_listener_cleanup():
    # 中文功能：构造本组边界验证所需的模型对象或输入材料。
    # English: Construct model objects or input material required by this boundary-verification group.
    # 输入 / Inputs: 无 / none。
    # 结果：返回分支计算值（`(fs, source, parent, neighbor)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`(fs, source, parent, neighbor)`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `ns['os']`, `ns['directory']`, `ns['time']`, `ns['source_peer_ended']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `context`, `ns['source_path']`, `path.rsplit`, `Filesystem`.
    def fixture():
        ctx = context(); path = ns['source_path'](ctx); parent = path.rsplit('/', 1)[0]
        fs = Filesystem(); fs.node(parent, meta(701)); fs.node(path, meta(702, mode=0o600, kind=stat.S_IFSOCK))
        neighbor = parent + '/unrelated'; fs.node(neighbor, meta(703, mode=0o600, kind=stat.S_IFSOCK))
        ns['os'] = fs.module(); ns['directory'] = fs.directory
        source = {'path': path, 'parent': copy.deepcopy(fs.nodes[parent]['meta']),
                  'socket': copy.deepcopy(fs.nodes[path]['meta']), 'peer': {'pid': 55, 'startTicks': '123'}}
        clock = [0]; ns['time'] = types.SimpleNamespace(monotonic=lambda: clock[0], sleep=lambda delay: clock.__setitem__(0, clock[0] + 4))
        ns['source_peer_ended'] = lambda peer: True; ns['source_listener_absent'] = lambda path: True
        return fs, source, parent, neighbor
    cleanup = ns['source_absent']
    fs, source, parent, neighbor = fixture(); before = copy.deepcopy(fs.nodes[neighbor])
    cleanup(source); assert source['path'] not in fs.nodes and fs.nodes[neighbor] == before
    assert fs.operations == [('unlink', source['path'])] and not fs.fds
    cleanup(source); assert fs.operations == [('unlink', source['path'])] and not fs.fds
    for peer_ended, listener_absent in [(False, True), (True, False), (False, False)]:
        fs, source, parent, neighbor = fixture()
        ns['source_peer_ended'] = lambda peer: peer_ended; ns['source_listener_absent'] = lambda path: listener_absent
        refused('SOURCE_CLOSE_UNCONFIRMED', lambda: cleanup(source)); assert not fs.operations and not fs.fds
    for field in ['inode', 'uid', 'gid', 'mode', 'type']:
        fs, source, parent, neighbor = fixture(); fs.nodes[source['path']]['meta'][field] = 999 if field != 'inode' else '999'
        refused('SOURCE_REPLACED', lambda: cleanup(source)); assert not fs.operations and not fs.fds
    fs, source, parent, neighbor = fixture(); fs.nodes[parent]['meta']['inode'] = '999'
    refused('SOURCE_REPLACED', lambda: cleanup(source)); assert not fs.operations and not fs.fds
    fs, source, parent, neighbor = fixture(); calls = [0]
    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: path。
    # 结果：返回条件的布尔判定。
    # Result: Return a boolean decision for the checked condition.
    # 状态影响 / State effects: `calls[0]`, `fs.nodes[path]['meta']['inode']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def replaced_before_unlink(path):
        calls[0] += 1
        if calls[0] == 2: fs.nodes[path]['meta']['inode'] = '999'
        return True
    ns['source_listener_absent'] = replaced_before_unlink
    refused('SOURCE_REPLACED', lambda: cleanup(source)); assert not fs.operations and not fs.fds
    fs, source, parent, neighbor = fixture(); del fs.nodes[source['path']]
    ns['source_listener_absent'] = lambda path: False
    refused('SOURCE_CLOSE_UNCONFIRMED', lambda: cleanup(source)); assert not fs.operations and not fs.fds


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['os']`, `module.pidfd_open`, `module.close`, `ns['select']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('Permission error became proof of process exit')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `Filesystem`, `fs.node`, `meta`, `status`.
# 检查边界 / Checked boundaries: `ns['source_peer_ended'](peer) is False and closed == [pidfd] and (not fs.fds)`; `ns['source_peer_ended'](peer) is True and (not fs.fds)`.
def source_peer_retirement():
    fs = Filesystem(); fs.node('/proc/55', meta(710, mode=0o755))
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: ticks = '123', state = 'S'。
    # 结果：返回分支计算值（`('55 (own fixture) ' + state + ' ' + ' '.join(['0'] * 18) + ' ' + ticks).encode()`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`('55 (own fixture) ' + state + ' ' + ' '.join(['0'] * 18) + ' ' + ticks).encode()`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `('55 (own fixture) ' + state + ' ' + ' '.join(['0'] * 18) + ' ' + ticks).encode`, `' '.join`.
    def status(ticks='123', state='S'):
        return ('55 (own fixture) ' + state + ' ' + ' '.join(['0'] * 18) + ' ' + ticks).encode()
    fs.node('/proc/55/stat', meta(711, mode=0o444, kind=stat.S_IFREG), status())
    module = fs.module(); ns['os'] = module; pidfd = 990; closed = []
    module.pidfd_open = lambda pid, flags: pidfd
    module.close = lambda fd: closed.append(fd) if fd == pidfd else fs.close(fd)
    exited = [False]; ns['select'] = types.SimpleNamespace(select=lambda *args: ([pidfd] if exited[0] else [], [], []))
    peer = {'pid': 55, 'startTicks': '123'}
    assert ns['source_peer_ended'](peer) is False and closed == [pidfd] and not fs.fds
    for body in [status('124'), status(state='Z'), status(state='X')]:
        fs.nodes['/proc/55/stat']['body'] = body
        assert ns['source_peer_ended'](peer) is True and not fs.fds
    fs.nodes['/proc/55/stat']['body'] = status(); exited[0] = True
    assert ns['source_peer_ended'](peer) is True and not fs.fds
    exited[0] = False; fs.nodes['/proc/55/stat']['body'] = b'invalid kernel response'
    refused('SOURCE_CLOSE_UNCONFIRMED', lambda: ns['source_peer_ended'](peer)); assert not fs.fds
    del fs.nodes['/proc/55/stat']
    refused('SOURCE_CLOSE_UNCONFIRMED', lambda: ns['source_peer_ended'](peer)); assert not fs.fds
    module.pidfd_open = lambda *args: (_ for _ in ()).throw(ProcessLookupError())
    assert ns['source_peer_ended'](peer) is True
    module.pidfd_open = lambda *args: (_ for _ in ()).throw(PermissionError())
    try: ns['source_peer_ended'](peer)
    except PermissionError: pass
    else: raise AssertionError('Permission error became proof of process exit')


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['os']`, `fs.nodes[proc]['body']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `Filesystem`, `fs.module`, `ns['source_path']`, `context`.
# 检查边界 / Checked boundaries: `ns['source_listener_absent'](path) is True and (not fs.fds)`; `ns['source_listener_absent'](path) is False and (not fs.fds)`.
def source_kernel_absence():
    fs = Filesystem(); module = fs.module(); ns['os'] = module
    header = b'Num RefCount Protocol Flags Type St Inode Path\n'
    path = ns['source_path'](context()); proc = '/proc/net/unix'
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: name, flags = '00010000'。
    # 结果：返回分支计算值（`('00000001: 00000002 00000000 ' + flags + ' 0001 01 100 ' + name + '\n').encode()`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`('00000001: 00000002 00000000 ' + flags + ' 0001 01 100 ' + name + '\n').encode()`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `('00000001: 00000002 00000000 ' + flags + ' 0001 01 100 ' + name + '\n').encode`.
    def row(name, flags='00010000'):
        return ('00000001: 00000002 00000000 ' + flags + ' 0001 01 100 ' + name + '\n').encode()
    fs.node(proc, meta(720, mode=0o444, kind=stat.S_IFREG), header + row(path + '-neighbor'))
    assert ns['source_listener_absent'](path) is True and not fs.fds
    for flags in ['00010000', '00000000']:
        fs.nodes[proc]['body'] = header + row(path, flags)
        assert ns['source_listener_absent'](path) is False and not fs.fds
    fs.nodes[proc]['body'] = b'unknown header\n'
    refused('SOURCE_CLOSE_UNCONFIRMED', lambda: ns['source_listener_absent'](path)); assert not fs.fds
    fs.nodes[proc]['body'] = header + b'x' * (4 * 1024 * 1024)
    refused('SOURCE_CLOSE_UNCONFIRMED', lambda: ns['source_listener_absent'](path)); assert not fs.fds


production_save = ns['save_record']
scenarios = {'context': strict_context, 'peer': peer_identity, 'protocol': transparent_protocol,
    'frames': frames_and_revocation, 'cleanup': frozen_cleanup, 'retry': freeze_crash_retry, 'foreign': foreign_cleanup,
    'admission': prepared_admission, 'absence': absent_and_prepared_cleanup, 'partial': partial_home_cleanup,
    'budgets': cleanup_budgets, 'source': source_and_birth_checks, 'exclusive': source_exclusivity,
    'modes': directory_modes_and_chown_retry, 'backups': backup_cleanup,
    'source-close': source_closed_listener_cleanup, 'source-ended': source_peer_retirement, 'source-kernel': source_kernel_absence}
scenarios[sys.argv[1]]()
print(json.dumps({'scenario': sys.argv[1], 'passed': True, 'modelOnly': True}))
