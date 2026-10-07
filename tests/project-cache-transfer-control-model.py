# 模块职责：在确定性 POSIX 描述符与文件系统模型上执行生产缓存传输辅助定义。
# Module: Execute production cache-transfer helper definitions against deterministic POSIX descriptor and filesystem models.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
# 可移植边界模型：通过受控适配器验证生产流程；真实系统权限与进程隔离需另行运行 Linux 验证。
"""Run the exact root helper against a deterministic POSIX fd/filesystem model.

This models kernel paths and failures; it is not a VM or a claim of Linux execution.
"""
import copy
import errno
import hashlib
import json
import os
import stat
import sys
import types
import uuid

SOURCE = sys.stdin.read()
fcntl = types.SimpleNamespace(LOCK_SH=1, LOCK_EX=2, LOCK_NB=4, flock=lambda *_: None)
sys.modules['fcntl'] = fcntl
ENV = {'__name__': 'cache_transfer_model'}
exec(compile(SOURCE, 'project-cache-transfer-control.py', 'exec'), ENV)


class Node:
    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self, inode, kind = 'directory', mode = 493, uid = 0, gid = 0, content = b'', device = 1。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    def __init__(self, inode, kind='directory', mode=0o755, uid=0, gid=0, content=b'', device=1):
        self.inode, self.kind, self.mode = inode, kind, mode
        self.uid, self.gid, self.content, self.device = uid, gid, content, device
        self.links, self.mtime, self.ctime = 1, 1, 1

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self。
    # 结果：返回分支计算值（`types.SimpleNamespace(st_ino=self.inode, st_dev=self.device, st_uid=self.uid, st_gid=self.gid, st_nl…`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`types.SimpleNamespace(st_ino=self.inode, st_dev=self.device, st_uid=self.uid, st_gid=self.gid, st_nl…`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `types.SimpleNamespace`, `len`.
    def info(self):
        kind = {'directory': stat.S_IFDIR, 'file': stat.S_IFREG,
                'link': stat.S_IFLNK, 'fifo': stat.S_IFIFO}[self.kind]
        return types.SimpleNamespace(st_ino=self.inode, st_dev=self.device,
                                     st_uid=self.uid, st_gid=self.gid, st_nlink=self.links,
                                     st_mode=kind | self.mode, st_size=len(self.content),
                                     st_mtime_ns=self.mtime, st_ctime_ns=self.ctime)


class Posix:
    O_RDONLY, O_WRONLY, O_RDWR = 0, 1, 2
    O_CREAT, O_EXCL, O_DIRECTORY, O_NOFOLLOW, O_CLOEXEC, O_NONBLOCK = 4, 8, 16, 32, 64, 128

    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.add`.
    def __init__(self):
        self.nodes, self.fds, self.next_fd, self.next_inode = {}, {}, 3, 1
        self.writes, self.removed, self.opens = [], [], []
        self.failed_fsync, self.stat_hook = False, None
        self.add('/')

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, path, **options。
    # 结果：返回分支计算值（`node`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`node`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.next_inode`, `self.nodes[path]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Node`.
    def add(self, path, **options):
        node = Node(self.next_inode, **options)
        self.next_inode += 1
        self.nodes[path] = node
        return node

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, path。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `path.split`, `self.add`.
    def directory(self, path):
        current = ''
        for part in path.split('/')[1:]:
            current += '/' + part
            if current not in self.nodes:
                self.add(current)

    # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
    # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
    # 输入 / Inputs: self, path, dir_fd = None。
    # 结果：返回分支计算值（`path.rstrip('/') or '/' / prefix.rstrip('/') + '/' + path`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`path.rstrip('/') or '/' / prefix.rstrip('/') + '/' + path`); its implementation and call sites define the actual type.
    # 失败 / Failure: `AssertionError('Root code must use absolute paths or anchored dir_fd')`; `FileNotFoundError('unlinked parent fd')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `path.startswith`, `path.rstrip`, `AssertionError`, `next`.
    def path(self, path, dir_fd=None):
        if path.startswith('/'):
            return path.rstrip('/') or '/'
        if dir_fd is None:
            raise AssertionError('Root code must use absolute paths or anchored dir_fd')
        parent = self.fds[dir_fd][0]
        prefix = next((name for name, node in self.nodes.items() if node is parent), None)
        if prefix is None:
            raise FileNotFoundError('unlinked parent fd')
        return prefix.rstrip('/') + '/' + path

    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: self, path, flags, mode = 511, dir_fd = None。
    # 结果：返回分支计算值（`self.next_fd`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.next_fd`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.next_fd`, `self.fds[self.next_fd]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 失败 / Failure: `FileExistsError(path)`; `FileNotFoundError(parent)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.path`, `self.opens.append`, `self.nodes.get`, `FileExistsError`.
    def open(self, path, flags, mode=0o777, dir_fd=None):
        path = self.path(path, dir_fd)
        self.opens.append((path, flags))
        node = self.nodes.get(path)
        if flags & self.O_CREAT:
            if node is not None and flags & self.O_EXCL:
                raise FileExistsError(path)
            if node is None:
                parent = path.rsplit('/', 1)[0] or '/'
                if parent not in self.nodes:
                    raise FileNotFoundError(parent)
                node = self.add(path, kind='file', mode=mode)
        if node is None:
            raise FileNotFoundError(path)
        if node.kind == 'link' and flags & self.O_NOFOLLOW:
            raise OSError(errno.ELOOP, 'nofollow')
        if flags & self.O_DIRECTORY and node.kind != 'directory':
            raise NotADirectoryError(path)
        self.next_fd += 1
        self.fds[self.next_fd] = [node, 0, flags]
        return self.next_fd

    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self, fd。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 检查边界 / Checked boundaries: `fd in self.fds`.
    def close(self, fd):
        assert fd in self.fds, 'Authority fd must be closed once'
        del self.fds[fd]

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, fd。
    # 结果：返回分支计算值（`self.fds[fd][0].info()`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.fds[fd][0].info()`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.fds[fd][0].info`.
    def fstat(self, fd):
        return self.fds[fd][0].info()

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, path, dir_fd = None, follow_symlinks = True。
    # 结果：返回分支计算值（`self.nodes[path].info()`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.nodes[path].info()`); its implementation and call sites define the actual type.
    # 失败 / Failure: `FileNotFoundError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.path`, `self.stat_hook`, `FileNotFoundError`, `self.nodes[path].info`.
    def stat(self, path, dir_fd=None, follow_symlinks=True):
        path = self.path(path, dir_fd)
        if self.stat_hook:
            self.stat_hook(path)
        if path not in self.nodes:
            raise FileNotFoundError(path)
        return self.nodes[path].info()

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, path。
    # 结果：返回分支计算值（`[name[len(prefix):] for name in self.nodes if name.startswith(prefix) and '/' not in name[len(prefix…`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`[name[len(prefix):] for name in self.nodes if name.startswith(prefix) and '/' not in name[len(prefix…`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `isinstance`, `next`, `self.nodes.items`, `path.rstrip`.
    def listdir(self, path):
        if isinstance(path, int):
            node = self.fds[path][0]
            path = next(name for name, value in self.nodes.items() if value is node)
        prefix = path.rstrip('/') + '/'
        return [name[len(prefix):] for name in self.nodes if name.startswith(prefix) and '/' not in name[len(prefix):]]

    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, path, mode = 511, dir_fd = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `FileExistsError(path)`; `FileNotFoundError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.path`, `FileExistsError`, `path.rsplit`, `FileNotFoundError`.
    def mkdir(self, path, mode=0o777, dir_fd=None):
        path = self.path(path, dir_fd)
        if path in self.nodes:
            raise FileExistsError(path)
        if (path.rsplit('/', 1)[0] or '/') not in self.nodes:
            raise FileNotFoundError(path)
        self.add(path, mode=mode)
        self.writes.append(('mkdir', path))

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, fd, count。
    # 结果：返回分支计算值（`result`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`result`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.fds[fd][1]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `len`.
    # 检查边界 / Checked boundaries: `node.kind == 'file'`.
    def read(self, fd, count):
        node, position, _ = self.fds[fd]
        assert node.kind == 'file', 'No FIFO/device/symlink may be read'
        result = node.content[position:position + count]
        self.fds[fd][1] += len(result)
        return result

    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, fd, content。
    # 结果：返回分支计算值（`len(content)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`len(content)`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `node.content`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.writes.append`, `len`.
    # 检查边界 / Checked boundaries: `node.kind == 'file'`.
    def write(self, fd, content):
        node = self.fds[fd][0]
        assert node.kind == 'file'
        node.content += content
        self.writes.append(('write', node.inode))
        return len(content)

    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, before, after, src_dir_fd = None, dst_dir_fd = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.nodes[after]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.path`, `self.nodes.pop`, `self.writes.append`.
    def rename(self, before, after, src_dir_fd=None, dst_dir_fd=None):
        before, after = self.path(before, src_dir_fd), self.path(after, dst_dir_fd)
        self.nodes[after] = self.nodes.pop(before)
        self.writes.append(('rename', after))

    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, fd, uid, gid。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.writes.append`.
    def fchown(self, fd, uid, gid):
        self.fds[fd][0].uid, self.fds[fd][0].gid = uid, gid
        self.writes.append(('chown', self.fds[fd][0].inode))

    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: self, fd。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `OSError('fsync failure')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `OSError`.
    # 检查边界 / Checked boundaries: `fd in self.fds`.
    def fsync(self, fd):
        assert fd in self.fds
        if self.failed_fsync:
            raise OSError('fsync failure')

    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self, path, dir_fd = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.path`, `self.removed.append`.
    # 检查边界 / Checked boundaries: `self.nodes[path].kind != 'directory'`.
    def unlink(self, path, dir_fd=None):
        path = self.path(path, dir_fd)
        assert self.nodes[path].kind != 'directory'
        del self.nodes[path]
        self.removed.append(path)

    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self, path, dir_fd = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.path`, `self.listdir`, `self.removed.append`.
    # 检查边界 / Checked boundaries: `not self.listdir(path)`.
    def rmdir(self, path, dir_fd=None):
        path = self.path(path, dir_fd)
        assert not self.listdir(path)
        del self.nodes[path]
        self.removed.append(path)

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, value。
    # 结果：返回分支计算值（`18`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`18`); its implementation and call sites define the actual type.
    def umask(self, value):
        return 0o022

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self。
    # 结果：返回分支计算值（`0`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`0`); its implementation and call sites define the actual type.
    def getuid(self):
        return 0

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, value。
    # 结果：返回分支计算值（`value.encode('utf-8')`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`value.encode('utf-8')`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `value.encode`.
    def fsencode(self, value):
        return value.encode('utf-8')


TRUSTED_NATIVE = b'''
import os
class Refusal(Exception):
 def __init__(self,code): self.code=code
def sources(): return os.native_build
def initialize_readonly(): return os.open('/registry/lock',os.O_RDONLY|os.O_NOFOLLOW)
def active(project,request,store):
 expected={k:os.native_identity[k] for k in ('registryId','identityId','revision')}
 if project!=os.native_identity['projectId'] or request!={'expected':expected}: raise Refusal('IDENTITY_MISMATCH')
 return os.native_identity
def registry(readonly):
 if readonly is not True: raise AssertionError('Read-only registry required')
 return {}
def cgroup_available(): return True
def make_directory(path,mode):
 try: os.mkdir(path,mode)
 except FileExistsError: pass
def check_run(identity,run,boot,require_active):
 if any(run[k]!=identity[k] for k in ('registryId','projectId','identityId','revision')) or run['bootId']!=boot: raise Refusal('RUN_STALE')
def run_read(run_id):
 if os.native_run is None: raise Refusal('RECORD_ABSENT')
 if os.native_run['runId']!=run_id: raise Refusal('RUN_STALE')
 return os.native_run
'''


# 中文功能：构造本组边界验证所需的模型对象或输入材料。
# English: Construct model objects or input material required by this boundary-verification group.
# 输入 / Inputs: manager = 'npm'。
# 结果：返回分支计算值（`(fs, owner, cache, saved)`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`(fs, owner, cache, saved)`); its implementation and call sites define the actual type.
# 状态影响 / State effects: `fs.native_build`, `fs.native_identity`, `fs.native_ticket`, `fs.native_run`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `Posix`, `hashlib.sha256(b'protocol.hheader' + b'launcher.clauncher' + b'controller.py' + TRUSTED_NATIVE).hexd…`, `hashlib.sha256`, `str`.
# 设计思路：用显式模型状态和受控适配调用排列边界情景，测试只依据其断言证明相应模型行为，不能外推真实系统权限。
# Design: Arrange boundary cases with explicit model state and controlled adapters. Assertions establish the corresponding model behavior without attesting real system privileges.
def fixture(manager='npm'):
    fs = Posix()
    fs.native_build = hashlib.sha256(b'protocol.hheader' + b'launcher.clauncher' + b'controller.py' + TRUSTED_NATIVE).hexdigest()
    identity_id, registry_id, boot_id, run_id = [str(uuid.uuid4()) for _ in range(4)]
    identity = {'version': 1, 'phase': 'active', 'registryId': registry_id, 'identityId': identity_id,
                'projectId': '0123456789abcdef', 'revision': 1, 'uid': 20001, 'gid': 20001,
                'account': 'skp' + identity_id.replace('-', '')[:24],
                'home': '/var/lib/sakura-project-homes/' + identity_id, 'directory': '/srv/project',
                'homeDevice': '1', 'homeInode': '10', 'directoryDevice': '1', 'directoryInode': '11',
                'networkIsolation': 'private'}
    owner = {'stageId': str(uuid.uuid4()), 'manager': manager, 'build': fs.native_build,
             'identity': identity, 'owner': {'kind': 'task', 'runId': run_id, 'bootId': boot_id},
             'sha256': 'b' * 64}
    fs.native_identity = identity
    fs.native_ticket = {'version': 1, 'phase': 'closed', 'mode': 'inherit-current', 'registryId': registry_id,
                     'identityId': identity_id, 'projectId': identity['projectId'], 'revision': 1,
                     'runId': run_id, 'bootId': boot_id, 'build': fs.native_build,
                     'networkDevice': '4', 'networkInode': '5', 'cgroupDevice': '1', 'cgroupInode': '300',
                     'cgroupName': 'sakura-task-' + run_id, 'namespace': 'sk-' + identity['projectId']}
    fs.native_run = None
    paths = ['/registry', '/proc/sys/kernel/random', '/proc/self', '/sys/fs/cgroup', '/run',
             '/usr/local/lib/sakura-project-identity/' + fs.native_build,
             '/var/cache/sakura/project-deps/' + identity['projectId'] + '/' + manager]
    for path in paths:
        fs.directory(path)
    fs.add('/registry/lock', kind='file', mode=0o600)
    fs.add('/proc/sys/kernel/random/boot_id', kind='file', mode=0o444, content=boot_id.encode())
    fs.add('/proc/self/mountinfo', kind='file', mode=0o444, content=b'1 0 0:1 / / rw - root root rw\n')
    build_path = '/usr/local/lib/sakura-project-identity/' + fs.native_build
    files = [('protocol.h', b'header'), ('launcher.c', b'launcher'), ('controller.py', TRUSTED_NATIVE)]
    manifest = {'version': 1, 'build': fs.native_build, 'files': []}
    for name, value in files:
        fs.add(build_path + '/' + name, kind='file', mode=0o644, content=value)
        manifest['files'].append({'name': name, 'size': len(value), 'sha256': hashlib.sha256(value).hexdigest()})
    fs.add(build_path + '/manifest.json', kind='file', mode=0o644, content=json.dumps(manifest).encode())
    fs.add(build_path + '/launch', kind='file', mode=0o4755)
    cache = '/var/cache/sakura/project-deps/' + identity['projectId'] + '/' + manager
    fs.add(cache + '/LOCKSUMS', kind='file', mode=0o600, content=b'a' * 64 + b'  package-lock.json\n')
    data = cache + ('/data' if manager == 'npm' else '/wheels')
    fs.add(data, mode=0o700)
    fs.add(data + '/artifact', kind='file', mode=0o600, content=b'cache artifact')
    # Privileged downloader staging and credentials are outside the selected roots.
    fs.add(cache + '/credential-file', kind='file', mode=0o600, content=b'never-copy')
    ENV['os'] = fs
    saved = sys.modules['os']
    sys.modules['os'] = fs
    return fs, owner, cache, saved


# 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
# English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
# 输入 / Inputs: owner, action = 'prepare', preparation = None, task = None。
# 结果：返回分支计算值（`ENV['execute'](request)`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`ENV['execute'](request)`); its implementation and call sites define the actual type.
# 状态影响 / State effects: `request['preparation']`, `request['task']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `ENV['execute']`.
def invoke(owner, action='prepare', preparation=None, task=None):
    request = {'action': action, 'owner': owner}
    if preparation is not None:
        request['preparation'] = preparation
    if task is not None:
        request['task'] = task
    return ENV['execute'](request)


# 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
# English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
# 输入 / Inputs: action。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 失败 / Failure: `AssertionError('Expected proof refusal')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `action`, `AssertionError`.
def denied(action):
    try:
        action()
    except Exception:
        return
    raise AssertionError('Expected proof refusal')


tests = 0
for manager in ('npm', 'pip'):
    fs, owner, cache, saved = fixture(manager)
    try:
        reply = invoke(owner)
        assert reply['receipt']['phase'] == 'ready'
        root = ENV['BASE'] + '/' + owner['stageId']
        copied = root + '/data'
        assert fs.nodes[copied].uid == owner['identity']['uid']
        assert fs.nodes[copied + '/LOCKSUMS'].uid == owner['identity']['uid']
        assert copied + '/credential-file' not in fs.nodes
        assert fs.nodes[cache + '/LOCKSUMS'].uid == 0
        before = list(fs.writes)
        assert invoke(owner, 'probe')['receipt'] == reply['receipt']
        assert fs.writes == before, 'Probe must be read-only'
        denied(lambda: invoke(owner))
        fs.native_run = copy.deepcopy(fs.native_ticket)
        task = {'run': fs.native_run}
        closed = invoke(owner, 'retire', reply['receipt'], task)
        assert closed['receipt']['phase'] == 'closed'
        assert copied not in fs.nodes
        assert fs.nodes[cache + '/LOCKSUMS'].uid == 0
        removed = list(fs.removed)
        assert invoke(owner, 'retire', reply['receipt'], task) == closed
        assert fs.removed == removed, 'Closed tombstone must not replay deletion'
        assert not fs.fds, 'No root authority fd may survive the helper'
        tests += 1
    finally:
        sys.modules['os'] = saved

for invalid in ('symlink', 'hardlink', 'fifo', 'writable-parent', 'wrong-owner', 'cross-device', 'corrupt-source'):
    fs, owner, cache, saved = fixture()
    try:
        artifact = fs.nodes[cache + '/data/artifact']
        if invalid == 'symlink': artifact.kind = 'link'
        elif invalid == 'hardlink': artifact.links = 2
        elif invalid == 'fifo': artifact.kind = 'fifo'
        elif invalid == 'writable-parent': fs.nodes['/var/cache'].mode = 0o777
        elif invalid == 'wrong-owner': artifact.uid = 20002
        elif invalid == 'cross-device': artifact.device = 99
        elif invalid == 'corrupt-source': fs.nodes['/usr/local/lib/sakura-project-identity/' + owner['build'] + '/controller.py'].content += b'altered'
        denied(lambda: invoke(owner))
        assert not fs.removed
        assert not fs.fds
        tests += 1
    finally:
        sys.modules['os'] = saved

for limit in ('file', 'total', 'nodes', 'depth'):
    fs, owner, cache, saved = fixture()
    original = {key: ENV[key] for key in ('LIMIT_FILE', 'LIMIT_TOTAL', 'LIMIT_NODES', 'LIMIT_DEPTH')}
    try:
        key = {'file': 'LIMIT_FILE', 'total': 'LIMIT_TOTAL', 'nodes': 'LIMIT_NODES', 'depth': 'LIMIT_DEPTH'}[limit]
        ENV[key] = 0
        denied(lambda: invoke(owner))
        assert fs.nodes[cache + '/LOCKSUMS'].uid == 0
        tests += 1
    finally:
        ENV.update(original)
        sys.modules['os'] = saved

for failure in ('stage-inode', 'data-inode', 'group-present', 'fsync', 'native-inode', 'mounted-data'):
    fs, owner, cache, saved = fixture()
    try:
        prepared = invoke(owner)['receipt']
        root = ENV['BASE'] + '/' + owner['stageId']
        fs.native_run = copy.deepcopy(fs.native_ticket)
        task = {'run': copy.deepcopy(fs.native_run)}
        before = list(fs.removed)
        if failure == 'stage-inode': fs.nodes[root].inode += 1000
        elif failure == 'data-inode': fs.nodes[root + '/data'].inode += 1000
        elif failure == 'group-present': fs.add('/sys/fs/cgroup/sakura-task-' + owner['owner']['runId'])
        elif failure == 'fsync': fs.failed_fsync = True
        elif failure == 'native-inode': fs.native_run = {**fs.native_run, 'cgroupInode': '99999'}
        elif failure == 'mounted-data': fs.nodes['/proc/self/mountinfo'].content += ('2 1 0:1 / ' + root + '/data rw - root root rw\n').encode()
        denied(lambda: invoke(owner, 'retire', prepared, task))
        assert fs.removed == before, 'Invalid proof must not delete any object'
        assert root + '/receipt.json' in fs.nodes
        assert not fs.fds
        tests += 1
    finally:
        sys.modules['os'] = saved

for manager in ('npm', 'pip'):
    fs, owner, cache, saved = fixture(manager)
    original_limit = ENV['LIMIT_FILE']
    try:
        ENV['LIMIT_FILE'] = 0
        denied(lambda: invoke(owner))
        root = ENV['BASE'] + '/' + owner['stageId']
        before = list(fs.writes)
        partial = invoke(owner, 'probe')['receipt']
        assert partial['phase'] == 'copying' and partial['manifest'] is None
        assert fs.writes == before, 'A partial/lost-ACK probe cannot publish or replay copy'
        denied(lambda: invoke(owner))
        closed = invoke(owner, 'retire', partial, {'run': None})
        assert closed['receipt']['phase'] == 'closed' and root + '/data' not in fs.nodes
        assert fs.nodes[cache + '/LOCKSUMS'].uid == 0
        assert not fs.fds
        tests += 1
    finally:
        ENV['LIMIT_FILE'] = original_limit
        sys.modules['os'] = saved

fs, owner, cache, saved = fixture()
try:
    fs.native_run = copy.deepcopy(fs.native_ticket)
    before = list(fs.writes)
    denied(lambda: invoke(owner))
    assert fs.writes == before, 'An already issued/archived native UUID cannot prepare a new stage'
    assert ENV['BASE'] + '/' + owner['stageId'] not in fs.nodes
    assert not fs.fds
    tests += 1
finally:
    sys.modules['os'] = saved

print(json.dumps({'tests': tests, 'limits': {'file': ENV['LIMIT_FILE'], 'total': ENV['LIMIT_TOTAL'],
                                          'nodes': ENV['LIMIT_NODES'], 'depth': ENV['LIMIT_DEPTH']}}))
