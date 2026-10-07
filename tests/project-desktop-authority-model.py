# 模块职责：在受保护虚拟文件系统上执行桌面生产控制器定义，验证拒绝顺序、只读行为和描述符归属。
# Module: Execute production desktop-controller definitions against a protected virtual filesystem to check rejection order, readonly behavior and descriptor ownership.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
# 可移植边界模型：通过受控适配器验证生产流程；真实系统权限与进程隔离需另行运行 Linux 验证。
# 覆盖：test_fixed_adapter_reports_actual_check_lines_without_changing_full_authority
# 覆盖：test_fixed_adapter_classifies_unknown_exceptions_and_keeps_stream_stdout_binary
# 覆盖：test_fixed_adapter_oserror_uses_only_bounded_trusted_source_frames
"""Source-level authority model; Linux kernel paths are explicitly simulated.

No guest is started. Actual controller functions execute against a protected
virtual filesystem so rejection order, readonly behavior and FD ownership can
be asserted independently of host orchestration mocks.
"""
import ast
import builtins
import copy
import errno
import hashlib
import json
import os as real_os
from pathlib import Path as RealPath, PurePosixPath
import re
import stat
import struct
import sys
from types import SimpleNamespace
import unittest

ROOT = RealPath(__file__).resolve().parents[1]
X11 = ROOT / 'native/linux-clipboard/controller.py'
WAYLAND = ROOT / 'native/wayland-clipboard/controller.py'
ADAPTER = sys.stdin.read()


# 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
# English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
# 输入 / Inputs: path。
# 结果：返回分支计算值（`ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef)], type_ignores=[])`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef)], type_ignores=[])`); its implementation and call sites define the actual type.
# 协作入口 / Collaborators: `ast.parse`, `path.read_text`, `ast.Module`, `isinstance`.
def definitions(path):
    tree = ast.parse(ADAPTER if path == 'adapter' else path.read_text(encoding='utf-8'))
    return ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef)], type_ignores=[])


class Kernel:
    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.before_read`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.add`.
    def __init__(self):
        self.nodes, self.fds, self.next_fd, self.writes, self.removed = {}, {}, 20, [], []
        self.now, self.before_open, self.opens = 0, None, []
        self.before_read = None
        self.add('/', mode=stat.S_IFDIR | 0o755)

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, path, raw = b'', mode = stat.S_IFREG | 384, uid = 0, gid = 0, inode = None, device = 12, link = None。
    # 结果：返回分支计算值（`path`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`path`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.nodes[path]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `str`, `PurePosixPath`, `self.add`, `SimpleNamespace`.
    def add(self, path, raw=b'', mode=stat.S_IFREG | 0o600, uid=0, gid=0, inode=None, device=12, link=None):
        path = str(path)
        if path != '/' and str(PurePosixPath(path).parent) not in self.nodes:
            self.add(str(PurePosixPath(path).parent), mode=stat.S_IFDIR | 0o755)
        self.nodes[path] = SimpleNamespace(raw=raw, link=link, info=SimpleNamespace(
            st_mode=mode, st_uid=uid, st_gid=gid, st_nlink=1, st_dev=device,
            st_ino=inode if inode is not None else len(self.nodes) + 100, st_size=len(raw)))
        return path

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self。
    # 结果：返回分支计算值（`Path`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`Path`); its implementation and call sites define the actual type.
    def path_class(self):
        kernel = self
        class Path(PurePosixPath):
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: self。
            # 结果：返回分支计算值（`kernel.nodes[str(self)].info`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`kernel.nodes[str(self)].info`); its implementation and call sites define the actual type.
            # 失败 / Failure: `FileNotFoundError(str(self))`；由调用者或用例断言观察 / Observed by callers or case assertions.
            # 协作入口 / Collaborators: `str`, `FileNotFoundError`.
            def lstat(self):
                if str(self) not in kernel.nodes: raise FileNotFoundError(str(self))
                return kernel.nodes[str(self)].info
            stat = lstat
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: self。
            # 结果：返回分支计算值（`kernel.nodes[str(self)].raw`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`kernel.nodes[str(self)].raw`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `kernel.before_read`, `str`.
            def read_bytes(self):
                if kernel.before_read: kernel.before_read(str(self))
                return kernel.nodes[str(self)].raw
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: self。
            # 结果：返回分支计算值（`self.read_bytes().decode()`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`self.read_bytes().decode()`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `self.read_bytes().decode`, `self.read_bytes`.
            def read_text(self): return self.read_bytes().decode()
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: self, strict = False。
            # 结果：返回分支计算值（`self`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`self`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `self.lstat`.
            def resolve(self, strict=False):
                if strict: self.lstat()
                return self
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: self。
            # 结果：返回分支计算值（`str(self) in kernel.nodes`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`str(self) in kernel.nodes`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `str`.
            def exists(self): return str(self) in kernel.nodes
            # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
            # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
            # 输入 / Inputs: self。
            # 结果：返回分支计算值（`self.exists() and stat.S_ISLNK(self.lstat().st_mode)`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`self.exists() and stat.S_ISLNK(self.lstat().st_mode)`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `self.exists`, `stat.S_ISLNK`, `self.lstat`.
            def is_symlink(self): return self.exists() and stat.S_ISLNK(self.lstat().st_mode)
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: self。
            # 结果：返回分支计算值（`iter([Path(key) for key in list(kernel.nodes) if key != str(self) and PurePosixPath(key).parent == s…`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`iter([Path(key) for key in list(kernel.nodes) if key != str(self) and PurePosixPath(key).parent == s…`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `iter`, `Path`, `list`, `str`.
            def iterdir(self):
                return iter([Path(key) for key in list(kernel.nodes) if key != str(self) and PurePosixPath(key).parent == self])
            # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
            # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
            # 输入 / Inputs: self。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 失败 / Failure: `FileNotFoundError(str(self))`；由调用者或用例断言观察 / Observed by callers or case assertions.
            # 协作入口 / Collaborators: `str`, `FileNotFoundError`, `kernel.removed.append`.
            def rmdir(self):
                if str(self) not in kernel.nodes: raise FileNotFoundError(str(self))
                kernel.removed.append(str(self)); del kernel.nodes[str(self)]
        return Path

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self。
    # 结果：返回分支计算值（`OS`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`OS`); its implementation and call sites define the actual type.
    # 设计思路：用显式模型状态和受控适配调用排列边界情景，测试只依据其断言证明相应模型行为，不能外推真实系统权限。
    # Design: Arrange boundary cases with explicit model state and controlled adapters. Assertions establish the corresponding model behavior without attesting real system privileges.
    def fake_os(self):
        kernel = self
        class OS:
            O_RDONLY, O_WRONLY, O_DIRECTORY, O_NOFOLLOW, O_CLOEXEC = 0, 1, 65536, 131072, 524288
            # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
            # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
            # 输入 / Inputs: path, flags, dir_fd = None, *args。
            # 结果：返回分支计算值（`fd`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`fd`); its implementation and call sites define the actual type.
            # 状态影响 / State effects: `kernel.next_fd`, `kernel.fds[fd]`. Follow the actual model assignments / 以模型中的实际赋值为准。
            # 失败 / Failure: `FileNotFoundError(path)`; `OSError(errno.ELOOP, path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
            # 协作入口 / Collaborators: `str`, `PurePosixPath`, `kernel.before_open`, `FileNotFoundError`.
            @staticmethod
            def open(path, flags, *args, dir_fd=None):
                path = str(path) if dir_fd is None else str(PurePosixPath(kernel.fds[dir_fd][0]) / path)
                if kernel.before_open: kernel.before_open(path, flags)
                if path not in kernel.nodes: raise FileNotFoundError(path)
                node = kernel.nodes[path]
                if flags & OS.O_NOFOLLOW and stat.S_ISLNK(node.info.st_mode): raise OSError(errno.ELOOP, path)
                kernel.opens.append((path, flags))
                fd = kernel.next_fd; kernel.next_fd += 1; kernel.fds[fd] = [path, node, 0]; return fd
            # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
            # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
            # 输入 / Inputs: fd。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 失败 / Failure: `OSError(errno.EBADF, str(fd))`；由调用者或用例断言观察 / Observed by callers or case assertions.
            # 协作入口 / Collaborators: `OSError`, `str`.
            @staticmethod
            def close(fd):
                if fd not in kernel.fds: raise OSError(errno.EBADF, str(fd))
                del kernel.fds[fd]
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: fd。
            # 结果：返回分支计算值（`kernel.fds[fd][1].info`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`kernel.fds[fd][1].info`); its implementation and call sites define the actual type.
            @staticmethod
            def fstat(fd): return kernel.fds[fd][1].info
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: fd, size。
            # 结果：返回分支计算值（`value`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`value`); its implementation and call sites define the actual type.
            # 状态影响 / State effects: `row[2]`. Follow the actual model assignments / 以模型中的实际赋值为准。
            # 协作入口 / Collaborators: `len`.
            @staticmethod
            def read(fd, size):
                row = kernel.fds[fd]; value = row[1].raw[row[2]:row[2]+size]; row[2] += len(value); return value
            # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
            # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
            # 输入 / Inputs: fd, value。
            # 结果：返回分支计算值（`len(value)`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`len(value)`); its implementation and call sites define the actual type.
            # 状态影响 / State effects: `kernel.nodes[parent + '/cgroup.procs'].raw`, `kernel.nodes[parent + '/cgroup.events'].raw`. Follow the actual model assignments / 以模型中的实际赋值为准。
            # 协作入口 / Collaborators: `kernel.writes.append`, `row[0].endswith`, `str`, `PurePosixPath`.
            @staticmethod
            def write(fd, value):
                row = kernel.fds[fd]; kernel.writes.append((row[0], value))
                if row[0].endswith('/cgroup.kill'):
                    parent = str(PurePosixPath(row[0]).parent)
                    kernel.nodes[parent + '/cgroup.procs'].raw = b''
                    kernel.nodes[parent + '/cgroup.events'].raw = b'populated 0\nfrozen 0\n'
                return len(value)
            # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
            # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
            # 输入 / Inputs: path。
            # 结果：返回分支计算值（`row.link`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`row.link`); its implementation and call sites define the actual type.
            # 失败 / Failure: `FileNotFoundError(str(path))`; `OSError(errno.EINVAL, str(path))`；由调用者或用例断言观察 / Observed by callers or case assertions.
            # 协作入口 / Collaborators: `str`, `FileNotFoundError`, `OSError`.
            @staticmethod
            def readlink(path):
                if str(path) not in kernel.nodes: raise FileNotFoundError(str(path))
                row = kernel.nodes[str(path)]
                if row.link is None: raise OSError(errno.EINVAL, str(path))
                return row.link
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: path。
            # 结果：返回分支计算值（`str(path).encode()`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`str(path).encode()`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `str(path).encode`, `str`.
            @staticmethod
            def fsencode(path): return str(path).encode()
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: path。
            # 结果：返回分支计算值（`kernel.nodes[str(path)].info`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`kernel.nodes[str(path)].info`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `str`.
            @staticmethod
            def lstat(path): return kernel.nodes[str(path)].info
        return OS

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, source = X11。
    # 结果：返回分支计算值（`namespace`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`namespace`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.path_class`, `self.fake_os`, `dict`, `re.compile`.
    def module(self, source=X11):
        Path, OS = self.path_class(), self.fake_os()
        namespace = dict(Path=Path, os=OS, stat=stat, json=json, hashlib=hashlib, re=re, errno=errno, sys=sys,
            struct=struct, UUID=re.compile(r'^[a-f0-9-]{36}$'), DIGEST=re.compile(r'^[a-f0-9]{64}$'),
            fcntl=SimpleNamespace(LOCK_SH=1, LOCK_NB=4, flock=lambda *args: None),
            time=SimpleNamespace(monotonic=lambda: self.now, sleep=lambda seconds: setattr(self, 'now', self.now + seconds)))
        exec(compile(definitions(source), '<string>' if source == 'adapter' else str(source), 'exec'), namespace)
        return namespace

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, pid, uid, group, image, ticks = '777', environment = None, args = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `str`, `self.add`, `(str(pid) + ' (kernel model process) ' + ' '.join(fields)).encode`, `' '.join`.
    def process(self, pid, uid, group, image, ticks='777', environment=None, args=None):
        root = '/proc/' + str(pid)
        fields = ['S'] + ['0'] * 18 + [ticks] + ['0'] * 5
        self.add(root + '/stat', (str(pid) + ' (kernel model process) ' + ' '.join(fields)).encode())
        self.add(root + '/status', ('Uid:\t' + '\t'.join([str(uid)] * 4) + '\n').encode())
        self.add(root + '/cgroup', ('0::/' + group + '\n').encode())
        self.add(root + '/ns/net', inode=54321, device=4, link='net:[54321]')
        self.add(root + '/exe', link=image)
        self.add(root + '/environ', b'\0'.join((key + '=' + value).encode() for key, value in (environment or {}).items()))
        self.add(root + '/cmdline', b'\0'.join(item.encode() for item in (args or [])) + b'\0')

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, source = X11。
    # 结果：返回分支计算值（`SimpleNamespace(ns=ns, proof=proof, identity=identity, run=run, record=record, guard=guard, runtime=…`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`SimpleNamespace(ns=ns, proof=proof, identity=identity, run=run, record=record, guard=guard, runtime=…`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `ns['desktop_native']`, `ns['pwd']`, `ns['subprocess']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.module`, `dict`, `identity_id.replace`, `self.add`.
    # 设计思路：身份、运行票据、桌面记录和入口进程分别建模，并加入使用同样程序的邻居；失败集合只撤销选定证据，使断言能够区分完整归属与程序名或端口相似。
    # Design: Model identity, run tickets, desktop records and endpoint processes separately, including a neighbor using the same programs. The failure set revokes selected evidence so assertions distinguish complete ownership from matching program names or ports.
    def authority(self, source=X11):
        ns = self.module(source); Path, OS = ns['Path'], ns['os']
        identity_id = '11111111-1111-4111-8111-111111111111'
        run_id, boot = '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'
        identity = dict(version=1, phase='active', projectId='abcdefabcdefabcd', registryId=boot, identityId=identity_id,
            revision=3, account='skp' + identity_id.replace('-', '')[:24], uid=20001, gid=20001,
            home='/var/lib/sakura-project-homes/' + identity_id, homeDevice='12', homeInode='701',
            directory='/workspace/project', directoryDevice='12', directoryInode='702', networkIsolation='private')
        group = 'sakura-service-' + run_id
        run = dict(version=1, phase='active', mode='inherit-current', projectId=identity['projectId'], registryId=boot,
            identityId=identity_id, revision=3, runId=run_id, bootId=boot, build='a'*64,
            networkDevice='4', networkInode='54321', cgroupDevice='29', cgroupInode='703', cgroupName=group,
            namespace='sk-' + identity['projectId'])
        record = dict(version=1, projectId=identity['projectId'], name='desktop', session='sakura-desktop-' + identity['projectId'],
            runId=run_id, bootId=boot, scopeName=group, inode='703', binding='b'*64, phase='running',
            sessionId='$1', paneId='%1', panePid=900, paneStartTicks='777')
        runtime = '/run/sakura-desktop-uid/20001/' + run_id
        self.add('/proc/sys/kernel/random/boot_id', boot.encode())
        self.add('/readonly-native-lock')
        self.add('/readonly-network', inode=54321, device=4)
        self.add('/sys/fs/cgroup/' + group, mode=stat.S_IFDIR | 0o755, inode=703, device=29)
        self.add(identity['directory'], mode=stat.S_IFDIR | 0o700, uid=20001, gid=20001, inode=702)
        self.add(runtime, mode=stat.S_IFDIR | 0o700, uid=20001, gid=20001, inode=704)
        self.add(runtime + '/Xauthority', b'private-cookie-body', uid=20001, gid=20001, inode=705)
        self.add(runtime + '/ready', b'yes', uid=20001, gid=20001, inode=706)
        folder = '/run/sakura-project-desktop/' + identity['projectId']
        self.add(folder + '/lock')
        frame = struct.pack('<8s6I', b'SKIDP001', 1, 0, 12, 0, 12, 0) + b'exec /bin/sh'
        sha = hashlib.sha256(frame).hexdigest()
        input_path = folder + '/input-' + run_id + '.bin'
        header = dict(version=1, **{key:record[key] for key in ('bootId','runId','scopeName','inode','binding')},
                      fileDevice='12', fileInode='707', sha256=sha, bytes=len(frame))
        self.add(input_path, json.dumps(header).encode() + b'\n' + frame, inode=707)
        guard = dict(version=1, phase='active', identity=copy.deepcopy(identity), runId=run_id, bootId=boot,
            scopeName=group, binding=record['binding'], sha256=sha, build=run['build'],
            runtimeDevice='12', runtimeInode='704', networkDevice='4', networkInode='54321')
        user = SimpleNamespace(pw_uid=20001, pw_gid=20001, pw_name=identity['account'], pw_dir=identity['home'])
        environment = dict(HOME=identity['home'], USER=identity['account'], DISPLAY=':1', XDG_RUNTIME_DIR=runtime,
            XAUTHORITY=runtime + '/Xauthority', TOKEN='private-environment-body', PATH='/project/bin:/usr/bin')
        self.process(900, 0, group, '/usr/bin/python3')
        self.process(901, 20001, group, '/usr/bin/plasmashell', environment=environment)
        self.process(902, 20001, group, '/usr/bin/Xvnc',
                     args=['/usr/bin/Xvnc', ':1', '-rfbport', '5901', '-auth', runtime + '/Xauthority'])
        self.add('/proc/902/fd/7', link='socket:[999]')
        self.add('/proc/902/net/tcp', b'header\n0: 0100007F:170D 00000000:0000 0A 0 0 0 0 0 999\n')
        # A neighbor with the same programs is unrelated to this exact ticket.
        self.process(903, 20002, 'sakura-service-neighbor', '/usr/bin/plasmashell')
        readonly, failures = [], set()
        # 中文功能：核对模型证据或测试条件，按实现返回判定或拒绝不符合要求的输入。
        # English: Check model evidence or test conditions, returning a decision or rejecting inputs as specified by the implementation.
        # 输入 / Inputs: condition, message。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 失败 / Failure: `RuntimeError(message)`；由调用者或用例断言观察 / Observed by callers or case assertions.
        # 协作入口 / Collaborators: `RuntimeError`.
        def check(condition, message):
            if not condition: raise RuntimeError(message)
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: project, request, registry。
        # 结果：返回分支计算值（`copy.deepcopy(identity)`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`copy.deepcopy(identity)`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `readonly.append`, `check`, `copy.deepcopy`.
        def active(project, request, registry):
            readonly.append(('active', project, request))
            check(not failures & {'account','home','directory','uidmap'}, 'actual native account proof rejected')
            return copy.deepcopy(identity)
        # 中文功能：核对模型证据或测试条件，按实现返回判定或拒绝不符合要求的输入。
        # English: Check model evidence or test conditions, returning a decision or rejecting inputs as specified by the implementation.
        # 输入 / Inputs: value, actual, current_boot。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 协作入口 / Collaborators: `check`.
        def check_run(value, actual, current_boot):
            check(not failures & {'run','build'} and actual['phase']=='active' and actual['bootId']==current_boot, 'native ticket rejected')
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: value。
        # 结果：返回分支计算值（`OS.open('/sys/fs/cgroup/' + group, OS.O_RDONLY)`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`OS.open('/sys/fs/cgroup/' + group, OS.O_RDONLY)`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `check`, `str`, `OS.open`.
        def cgroup_fd(value):
            row = self.nodes['/sys/fs/cgroup/' + group].info
            check((str(row.st_dev), str(row.st_ino)) == (value['cgroupDevice'],value['cgroupInode']), 'original native cgroup replaced')
            return OS.open('/sys/fs/cgroup/' + group, OS.O_RDONLY)
        # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
        # English: Read or resolve observable model data for adapted production-definition calls or assertions.
        # 输入 / Inputs: path, limit。
        # 结果：返回分支计算值（`row.raw`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`row.raw`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `ns['secure_directory']`, `Path`, `check`, `stat.S_ISREG`.
        def read(path, limit):
            row = self.nodes[path]; ns['secure_directory'](Path(path).parent)
            check(stat.S_ISREG(row.info.st_mode) and row.info.st_uid==0 and stat.S_IMODE(row.info.st_mode)==0o600
                  and row.info.st_nlink==1 and len(row.raw)<=limit, 'protected original frame rejected')
            return row.raw
        core = dict(initialize_readonly=lambda: OS.open('/readonly-native-lock',0),
            registry=lambda readonly: ({'readonly':readonly} if readonly else check(False,'write registry')),
            active=active, run_read=lambda value: copy.deepcopy(run), check_run=check_run, cgroup_fd=cgroup_fd,
            network_fd=lambda value, current_boot, readonly: (OS.open('/readonly-network',0),self.nodes['/readonly-network'].info,run['namespace']),
            same=lambda info, value, prefix: (str(info.st_dev), str(info.st_ino))==(value[prefix+'Device'],value[prefix+'Inode']),
            json_read=lambda path: copy.deepcopy(guard if 'desktop-guards' in path else record),
            trusted=lambda info, mode: check(info.st_uid==0 and stat.S_IMODE(info.st_mode)==mode,'root lock rejected'),
            read=read, directory_fd=lambda path, *args: OS.open(path,OS.O_RDONLY),
            tool=lambda name: '/usr/bin/'+name, CLEAN_ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/'})
        ns['desktop_native'] = lambda build: core if build==run['build'] else check(False,'source build changed')
        ns['pwd'] = SimpleNamespace(getpwnam=lambda name: user if name==identity['account'] else check(False,'wrong account'))
        ns['subprocess'] = SimpleNamespace(run=lambda argv, **kwargs: SimpleNamespace(returncode=0, stderr=b'', stdout=b'$1\t%1\t900\t0\n'))
        proof = dict(version=1, identity=copy.deepcopy(identity), run=copy.deepcopy(run), record=copy.deepcopy(record),
                     sha256=sha, runtime=runtime, endpoint=None)
        return SimpleNamespace(ns=ns, proof=proof, identity=identity, run=run, record=record,
                               guard=guard, runtime=runtime, frame=input_path, failures=failures, core=core)


class AuthorityTests(unittest.TestCase):
    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `header['extra']`, `k.nodes[f.frame].raw`, `k.nodes['/proc/900/stat'].raw`, `k.nodes[f.runtime].info.st_uid`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `k.authority`, `f.ns['desktop_authority']`, `f.ns['os'].close`.
    def test_fixed_adapter_reports_actual_check_lines_without_changing_full_authority(self):
        k = Kernel(); f = k.authority('adapter'); value = f.ns['desktop_authority'](f.proof)
        f.ns['os'].close(value['directoryFd']); self.assertFalse(k.fds); self.assertFalse(k.writes)
        for mutation in ('frame','pane','runtime','guard','credential','environment','listener'):
            k = Kernel(); f = k.authority('adapter')
            if mutation == 'frame':
                header, frame = k.nodes[f.frame].raw.split(b'\n', 1)
                header = json.loads(header); header['extra'] = 'private-cookie-path'
                k.nodes[f.frame].raw = json.dumps(header).encode() + b'\n' + frame
            elif mutation == 'pane': k.nodes['/proc/900/stat'].raw = k.nodes['/proc/900/stat'].raw.replace(b'777', b'888')
            elif mutation == 'runtime': k.nodes[f.runtime].info.st_uid = 20002
            elif mutation == 'guard': f.guard['networkInode'] = 'unknown-original-object'
            elif mutation == 'credential': k.nodes[f.runtime + '/Xauthority'].info.st_mode |= 0o040
            elif mutation == 'environment': k.nodes['/proc/901/environ'].raw = b'HOME=/private-cookie-path\0USER=foreign\0'
            elif mutation == 'listener': k.nodes['/proc/902/fd/7'].link = 'socket:[replaced]'
            with self.subTest(mutation=mutation):
                try: f.ns['desktop_authority'](f.proof)
                except Exception as error: refusal = f.ns['desktop_adapter_refusal'](error, 'AUTHORITY')
                else: self.fail('Changed full authority was accepted')
                self.assertEqual(refusal['code'], 'DESKTOP_SCOPE_CHANGED'); self.assertEqual(refusal['reason'], 'CHECK_REJECTED')
                self.assertGreater(refusal['checkLine'], 0)
                self.assertIn('require(', ADAPTER.splitlines()[refusal['checkLine'] - 1])
                self.assertNotIn('private-cookie-path', json.dumps(refusal))
                self.assertFalse(k.fds); self.assertFalse(k.writes)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `sys.argv`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `k.module`, `RuntimeError`, `PermissionError`.
    # 设计思路：将主体计算与 finally 收尾分开，使返回和异常路径经过相同收尾步骤。
    # Design: Separate body computation from finally-based finalization so return and exception paths share the same finalization step.
    def test_fixed_adapter_classifies_unknown_exceptions_and_keeps_stream_stdout_binary(self):
        import base64, contextlib, io
        k = Kernel(); ns = k.module('adapter')
        for error, reason in [(RuntimeError('private-cookie-path'), 'VALIDATION_REJECTED'),
                              (PermissionError(errno.EACCES, 'private-cookie-path'), 'PERMISSION_DENIED'),
                              (ValueError('private-cookie-path'), 'DATA_INVALID')]:
            reply = ns['desktop_adapter_refusal'](error, 'AUTHORITY')
            self.assertEqual(reply['reason'], reason); self.assertEqual(reply['checkLine'], 0)
            self.assertNotIn('private-cookie-path', json.dumps(reply))
        entry = ast.parse(ADAPTER).body[-1]; self.assertIsInstance(entry, ast.Try)
        for op in ('guard','stream'):
            ns = k.module('adapter'); ns.update(base64=base64, adapter_stage='REQUEST', os=SimpleNamespace(environ={}))
            exec(compile("def guard(proof,op):\n global adapter_stage\n adapter_stage='GUARD_NETWORK'\n require(False,'private-cookie-path')\n", '<fixed-test-guard>', 'exec'), ns)
            out, err, original = io.StringIO(), io.StringIO(), sys.argv
            sys.argv = ['adapter', base64.b64encode(json.dumps({'op':op,'proof':{'run':{}}}).encode()).decode()]
            try:
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as raised:
                    exec(compile(ast.Module(body=[entry], type_ignores=[]), '<fixed-adapter-entry>', 'exec'), ns)
                self.assertEqual(raised.exception.code, 73)
            finally: sys.argv = original
            self.assertNotIn('private-cookie-path', out.getvalue() + err.getvalue())
            self.assertIn('GUARD_NETWORK:CHECK_REJECTED:', err.getvalue())
            if op == 'stream': self.assertEqual(out.getvalue(), '')
            else:
                reply = json.loads(out.getvalue()); self.assertEqual(reply['stage'], 'GUARD_NETWORK')
                self.assertEqual(reply['reason'], 'CHECK_REJECTED'); self.assertGreater(reply['checkLine'], 0)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `f.core['read']`, `error.desktop_check_line`, `ns['descend']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `k.authority`, `getattr`, `setattr`.
    # 设计思路：用显式模型状态和受控适配调用排列边界情景，测试只依据其断言证明相应模型行为，不能外推真实系统权限。
    # Design: Arrange boundary cases with explicit model state and controlled adapters. Assertions establish the corresponding model behavior without attesting real system privileges.
    def test_fixed_adapter_oserror_uses_only_bounded_trusted_source_frames(self):
        class Missing(FileNotFoundError):
            # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
            # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
            # 输入 / Inputs: self。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 失败 / Failure: `AssertionError('OSError text must not be inspected')`；由调用者或用例断言观察 / Observed by callers or case assertions.
            # 协作入口 / Collaborators: `AssertionError`.
            def __str__(self): raise AssertionError('OSError text must not be inspected')
        for mutation in ('pane', 'frame', 'runtime'):
            k = Kernel(); f = k.authority('adapter'); Path = f.ns['Path']
            target, statement = {'pane': ('/proc/900/stat', "fields = (pane / 'stat').read_text().rsplit(') ', 1)[1].split()"),
                                 'frame': (f.frame, "raw = core['read'](str(folder / ('input-' + run['runId'] + '.bin')), 135168)"),
                                 'runtime': (f.runtime, 'info = runtime.lstat()')}[mutation]
            del k.nodes[target]
            if mutation == 'frame':
                original = f.core['read']
                # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
                # English: Read or resolve observable model data for adapted production-definition calls or assertions.
                # 输入 / Inputs: path, limit。
                # 结果：返回分支计算值（`original(path, limit)`），实际类型由实现及使用处约定。
                # Result: Return the branch-computed value (`original(path, limit)`); its implementation and call sites define the actual type.
                # 失败 / Failure: `Missing(errno.ENOENT, 'private-cookie-path', target)`；由调用者或用例断言观察 / Observed by callers or case assertions.
                # 协作入口 / Collaborators: `str`, `Missing`, `original`.
                def read(path, limit):
                    if str(path) == target: raise Missing(errno.ENOENT, 'private-cookie-path', target)
                    return original(path, limit)
                f.core['read'] = read
            else:
                method = 'read_bytes' if mutation == 'pane' else 'lstat'; original = getattr(Path, method)
                # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
                # English: Read or resolve observable model data for adapted production-definition calls or assertions.
                # 输入 / Inputs: path。
                # 结果：返回分支计算值（`original(path)`），实际类型由实现及使用处约定。
                # Result: Return the branch-computed value (`original(path)`); its implementation and call sites define the actual type.
                # 失败 / Failure: `Missing(errno.ENOENT, 'private-cookie-path', target)`；由调用者或用例断言观察 / Observed by callers or case assertions.
                # 协作入口 / Collaborators: `str`, `Missing`, `original`.
                def read(path):
                    if str(path) == target: raise Missing(errno.ENOENT, 'private-cookie-path', target)
                    return original(path)
                setattr(Path, method, read)
            try: f.ns['desktop_authority'](f.proof)
            except OSError as error: reply = f.ns['desktop_adapter_refusal'](error, 'AUTHORITY')
            else: self.fail('Missing original authority object was accepted')
            self.assertEqual(reply['code'], 'DESKTOP_SCOPE_CHANGED'); self.assertEqual(reply['reason'], 'OBJECT_ABSENT')
            self.assertEqual(reply['checkLine'], next(line for line, text in enumerate(ADAPTER.splitlines(), 1) if statement in text))
            self.assertNotIn('private-cookie-path', json.dumps(reply)); self.assertNotIn(target, json.dumps(reply))
            self.assertFalse(k.fds); self.assertFalse(k.writes)
        ns = Kernel().module('adapter')
        for filename, name, offset in [('<foreign>', 'desktop_authority', 0), ('<string>', 'unknown_function', 0),
                                       ('<string>', 'desktop_authority', 8192)]:
            tree = ast.parse('def ' + name + '():\n raise FileNotFoundError(errno.ENOENT, "private-cookie-path")\n')
            ast.increment_lineno(tree, offset); exec(compile(tree, filename, 'exec'), ns)
            try: ns[name]()
            except OSError as error:
                error.desktop_check_line = 42
                reply = ns['desktop_adapter_refusal'](error, 'AUTHORITY')
            else: self.fail('Injected OSError did not execute')
            self.assertEqual(reply['checkLine'], 0); self.assertEqual(reply['reason'], 'OBJECT_ABSENT')
        # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
        # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
        # 输入 / Inputs: remaining。
        # 结果：返回分支计算值（`descend(remaining - 1)`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`descend(remaining - 1)`); its implementation and call sites define the actual type.
        # 失败 / Failure: `Missing(errno.ENOENT, 'private-cookie-path')`；由调用者或用例断言观察 / Observed by callers or case assertions.
        # 协作入口 / Collaborators: `descend`, `Missing`.
        def descend(remaining):
            if remaining: return descend(remaining - 1)
            raise Missing(errno.ENOENT, 'private-cookie-path')
        ns['descend'] = descend
        exec(compile('def desktop_authority():\n descend(70)\n', '<string>', 'exec'), ns)
        try: ns['desktop_authority']()
        except OSError as error: reply = ns['desktop_adapter_refusal'](error, 'AUTHORITY')
        else: self.fail('Long traceback did not execute')
        self.assertEqual(reply['checkLine'], 0); self.assertEqual(reply['reason'], 'OBJECT_ABSENT')

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, source = X11, mutation = None。
    # 结果：返回分支计算值（`(k, f, closed)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`(k, f, closed)`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `f.ns['socket']`, `k.nodes['/tmp/xauth_owned'].info.st_mode`, `k.nodes['/tmp/xauth_owned'].info.st_uid`, `k.nodes['/tmp/xauth_owned'].raw`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `k.authority`, `dict`, `k.process`.
    def nested(self, source=X11, mutation=None):
        k = Kernel(); f = k.authority(source)
        environment = dict(HOME=f.identity['home'], USER=f.identity['account'], DISPLAY=':2',
            XDG_RUNTIME_DIR=f.runtime, XAUTHORITY='/tmp/xauth_owned', XDG_SESSION_TYPE='wayland', WAYLAND_DISPLAY='wayland-0')
        k.process(901, 20001, f.run['cgroupName'], '/usr/bin/plasmashell', environment=environment)
        k.process(904, 20001, f.run['cgroupName'], '/usr/bin/kwin_wayland_wrapper', ticks='888')
        k.add('/tmp/.X11-unix', mode=stat.S_IFDIR | 0o1777)
        k.add('/tmp/.X11-unix/X2', mode=stat.S_IFSOCK | 0o777, uid=20001, gid=20001, inode=708)
        parts=[b'owned-host', b'2', b'MIT-MAGIC-COOKIE-1', bytes(range(16))]
        cookie=struct.pack('>H',256)+b''.join(struct.pack('>H',len(item))+item for item in parts)
        k.add('/tmp/xauth_owned', cookie, uid=20001, gid=20001, inode=709)
        k.add('/proc/904/fd/9',link='socket:[987]')
        k.add('/proc/904/net/unix',b'header\n0: 00000002 00000000 00010000 0001 01 987 /tmp/.X11-unix/X2\n')
        closed=[]
        class Peer:
            # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
            # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
            # 输入 / Inputs: self, value。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            def settimeout(self,value): pass
            # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
            # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
            # 输入 / Inputs: self, path。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 状态影响 / State effects: `self.path`. Follow the actual model assignments / 以模型中的实际赋值为准。
            def connect(self,path): self.path=path
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: self, *args。
            # 结果：返回分支计算值（`struct.pack('3i', 904, 20002 if mutation == 'peer-uid' else 20001, 20001)`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`struct.pack('3i', 904, 20002 if mutation == 'peer-uid' else 20001, 20001)`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `struct.pack`.
            def getsockopt(self,*args): return struct.pack('3i',904,20002 if mutation=='peer-uid' else 20001,20001)
            # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
            # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
            # 输入 / Inputs: self。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 协作入口 / Collaborators: `closed.append`.
            def close(self): closed.append(True)
        f.ns['socket']=SimpleNamespace(socket=lambda *args:Peer(), AF_UNIX=1,SOCK_STREAM=1,SOCK_CLOEXEC=524288,SOL_SOCKET=1,SO_PEERCRED=17)
        if mutation=='credential-mode': k.nodes['/tmp/xauth_owned'].info.st_mode |= 0o040
        elif mutation=='credential-owner': k.nodes['/tmp/xauth_owned'].info.st_uid=20002
        elif mutation=='cookie-display': k.nodes['/tmp/xauth_owned'].raw=cookie.replace(b'\0\x012',b'\0\x013')
        elif mutation=='cookie-short': k.nodes['/tmp/xauth_owned'].raw=cookie[:-1]; k.nodes['/tmp/xauth_owned'].info.st_size-=1
        elif mutation=='socket-owner': k.nodes['/tmp/.X11-unix/X2'].info.st_uid=20002
        elif mutation=='socket-parent': k.nodes['/tmp/.X11-unix'].info.st_mode=stat.S_IFDIR|0o777
        elif mutation=='listener': k.nodes['/proc/904/fd/9'].link='socket:[988]'
        elif mutation=='peer-group': k.nodes['/proc/904/cgroup'].raw=b'0::/unrelated-domain\n'
        elif mutation=='peer-image': k.nodes['/proc/904/exe'].link='/usr/bin/python3'
        elif mutation=='peer-reuse':
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: path。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 状态影响 / State effects: `k.nodes['/proc/904/stat'].raw`. Follow the actual model assignments / 以模型中的实际赋值为准。
            # 协作入口 / Collaborators: `k.nodes['/proc/904/stat'].raw.replace`.
            def reuse(path):
                if path=='/proc/904/net/unix': k.nodes['/proc/904/stat'].raw=k.nodes['/proc/904/stat'].raw.replace(b'888',b'889')
            k.before_read=reuse
        elif mutation=='socket-replace':
            # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
            # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
            # 输入 / Inputs: path。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 状态影响 / State effects: `k.nodes['/tmp/.X11-unix/X2'].info`, `k.nodes['/tmp/.X11-unix/X2'].info.st_ino`. Follow the actual model assignments / 以模型中的实际赋值为准。
            # 协作入口 / Collaborators: `copy.copy`.
            def replace(path):
                if path=='/proc/904/net/unix':
                    k.nodes['/tmp/.X11-unix/X2'].info=copy.copy(k.nodes['/tmp/.X11-unix/X2'].info)
                    k.nodes['/tmp/.X11-unix/X2'].info.st_ino=710
            k.before_read=replace
        return k,f,closed

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.nested`, `f.ns['desktop_authority']`, `self.assertEqual`, `self.assertNotIn`.
    def test_nested_wayland_retains_outer_vnc_and_authenticates_actual_inner_display(self):
        for source in (X11,WAYLAND):
            k,f,closed=self.nested(source)
            value=f.ns['desktop_authority'](f.proof)
            endpoint=value['endpoint']; nested=endpoint['nestedX11']
            self.assertEqual(endpoint['vncPid'],902); self.assertEqual(endpoint['xauthInode'],'705')
            self.assertEqual(nested['display'],':2'); self.assertEqual(nested['xauthInode'],'709')
            self.assertEqual(nested['peerPid'],904); self.assertEqual(nested['kernelInode'],'987')
            self.assertNotIn('private-cookie-body',json.dumps(endpoint)); self.assertNotIn('owned-host',json.dumps(endpoint))
            self.assertEqual(value['source']['XAUTHORITY'],'/tmp/xauth_owned')
            f.ns['os'].close(value['directoryFd']); self.assertEqual(closed,[True]); self.assertFalse(k.fds)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.nested`, `self.subTest`, `self.assertRaises`, `f.ns['desktop_authority']`.
    def test_nested_credentials_peer_listener_and_identity_changes_are_rejected(self):
        for source in (X11,WAYLAND):
            for mutation in ('credential-mode','credential-owner','cookie-display','cookie-short','socket-owner',
                             'socket-parent','peer-uid','listener','peer-group','peer-image','peer-reuse','socket-replace'):
                k,f,closed=self.nested(source,mutation)
                with self.subTest(source=source,mutation=mutation),self.assertRaises(Exception):
                    f.ns['desktop_authority'](f.proof)
                self.assertFalse(k.fds)
                self.assertLessEqual(len(closed),1)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `f.proof['endpoint']`, `f.ns['os'].readlink`, `f.proof['endpoint']['nestedX11']['peerCreated']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.nested`, `f.ns['desktop_authority']`, `f.ns['os'].close`, `copy.deepcopy`.
    def test_nested_endpoint_is_bound_and_x11_launcher_uses_checked_inner_credentials(self):
        k,f,_=self.nested()
        value=f.ns['desktop_authority'](f.proof); f.ns['os'].close(value['directoryFd'])
        f.proof['endpoint']=copy.deepcopy(value['endpoint'])
        f.ns['os'].readlink=lambda path: 'net:[54321]' if str(path)=='/proc/901/ns/net' else k.nodes[str(path)].link
        user,environment,checked=f.ns['desktop_environment']('net:[54321]',{},f.proof)
        self.assertEqual(user.pw_uid,20001); self.assertEqual(environment['DISPLAY'],':2')
        self.assertEqual(environment['XAUTHORITY'],'/tmp/xauth_owned'); f.ns['os'].close(checked['directoryFd'])
        f.proof['endpoint']['nestedX11']['peerCreated']='889'
        with self.assertRaises(Exception): f.ns['desktop_authority'](f.proof)
        self.assertFalse(k.fds)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `f.proof['endpoint']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `k.authority`, `self.assertRaisesRegex`, `f.ns['desktop_authority']`.
    def test_only_uncommitted_initial_endpoint_absence_is_retryable(self):
        for name in ('Xauthority','ready'):
            k=Kernel(); f=k.authority(); del k.nodes[f.runtime+'/'+name]
            with self.assertRaisesRegex(RuntimeError,'^SAKURA_DESKTOP_NOT_READY:credential$'):
                f.ns['desktop_authority'](f.proof)
            f.proof['endpoint']={'committed':True}
            with self.assertRaises(FileNotFoundError): f.ns['desktop_authority'](f.proof)
            self.assertFalse(k.fds)
        k=Kernel(); f=k.authority(); del k.nodes['/proc/901/exe']
        with self.assertRaisesRegex(RuntimeError,'^SAKURA_DESKTOP_NOT_READY:process$'):
            f.ns['desktop_authority'](f.proof)
        self.assertFalse(k.fds)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `Kernel`, `k.authority`, `f.ns['desktop_authority']`, `self.assertEqual`.
    def test_full_readonly_authority_closes_every_root_fd_and_ignores_neighbors(self):
        for source in (X11, WAYLAND):
            k = Kernel(); f = k.authority(source); value = f.ns['desktop_authority'](f.proof)
            self.assertEqual(value['plasma']['pid'],901); self.assertEqual(value['vnc']['pid'],902)
            self.assertEqual(value['user'].pw_uid,20001)
            self.assertEqual(list(k.fds),[value['directoryFd']]); f.ns['os'].close(value['directoryFd'])
            self.assertFalse(k.fds); self.assertFalse(k.writes)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `f.proof['launcherSha256']`, `f.proof`, `k.nodes['/proc/sys/kernel/random/boot_id'].raw`, `k.nodes['/sys/fs/cgroup/' + f.run['cgroupName']].info.st_ino`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `k.authority`, `f.failures.add`, `self.subTest`.
    def test_bad_proof_account_build_boot_run_and_exact_cgroup_are_rejected_without_writes(self):
        for mutation in ('extra','old','account','home','uidmap','run','build','boot','cgroup','directory','network'):
            k = Kernel(); f = k.authority()
            if mutation=='extra': f.proof['launcherSha256']='c'*64
            elif mutation=='old': f.proof={'launcherSha256':'c'*64}
            elif mutation in ('account','home','uidmap','run','build'): f.failures.add(mutation)
            elif mutation=='boot': k.nodes['/proc/sys/kernel/random/boot_id'].raw=b'new-boot'
            elif mutation=='cgroup': k.nodes['/sys/fs/cgroup/'+f.run['cgroupName']].info.st_ino+=1
            elif mutation=='directory': k.nodes[f.identity['directory']].info.st_ino+=1
            elif mutation=='network': k.nodes['/readonly-network'].info.st_ino+=1
            with self.subTest(mutation=mutation), self.assertRaises(Exception): f.ns['desktop_authority'](f.proof)
            self.assertFalse(k.fds,mutation); self.assertFalse(k.writes,mutation)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `f.proof['endpoint']`, `k.nodes[f.frame].raw`, `k.nodes[f.frame].info.st_uid`, `k.nodes[f.frame].info.st_nlink`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `k.authority`, `f.ns['desktop_authority']`, `f.ns['os'].close`.
    def test_frame_runtime_cookie_pane_pid_and_actual_uid_replacements_are_rejected(self):
        for mutation in ('frame','frame-owner','frame-link','runtime','cookie','pane','pane-membership','plasma-uid','plasma-net','vnc-auth','listener'):
            k = Kernel(); f = k.authority(); initial=f.ns['desktop_authority'](f.proof)
            f.proof['endpoint']=initial['endpoint']; f.ns['os'].close(initial['directoryFd'])
            if mutation=='frame': k.nodes[f.frame].raw+=b'tampered'
            elif mutation=='frame-owner': k.nodes[f.frame].info.st_uid=20001
            elif mutation=='frame-link': k.nodes[f.frame].info.st_nlink=2
            elif mutation=='runtime': k.nodes[f.runtime].info.st_ino+=1
            elif mutation=='cookie': k.nodes[f.runtime+'/Xauthority'].raw=b'another-cookie'
            elif mutation=='pane': k.nodes['/proc/900/stat'].raw=k.nodes['/proc/900/stat'].raw.replace(b'777',b'888')
            elif mutation=='pane-membership': k.nodes['/proc/900/cgroup'].raw=b'0::/another-domain\n'
            elif mutation=='plasma-uid': k.nodes['/proc/901/status'].raw=b'Uid:\t0\t0\t0\t0\n'
            elif mutation=='plasma-net': k.nodes['/proc/901/ns/net'].info.st_ino+=1
            elif mutation=='vnc-auth': k.nodes['/proc/902/cmdline'].raw=b'Xvnc\0:1\0-rfbport\05901\0-auth\0/tmp/unknown\0'
            elif mutation=='listener': k.nodes['/proc/902/fd/7'].link='socket:[replaced]'
            with self.subTest(mutation=mutation),self.assertRaises(Exception): f.ns['desktop_authority'](f.proof)
            self.assertFalse(k.fds,mutation); self.assertFalse(k.writes,mutation)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `k.nodes[folder + '/launcher.c'].raw`, `k.nodes[folder + '/controller.py'].info.st_mode`, `k.nodes[folder + '/controller.py'].info.st_uid`, `k.nodes[folder].info.st_uid`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `k.module`, `hashlib.sha256`, `files.items`.
    def test_source_manifest_hashes_all_root_bytes_before_evaluating_controller(self):
        for mutation in (None,'digest','source-mode','source-owner','source-symlink','directory-owner','aggregate'):
            k=Kernel(); ns=k.module(); files={'protocol.h':b'fixed abi', 'launcher.c':b'fixed launcher',
                'controller.py':b"import builtins\nbuiltins._desktop_model_executed+=1\ndef sources(): return __file__.split('/')[-2]\n"}
            aggregate=hashlib.sha256()
            for name,raw in files.items(): aggregate.update(name.encode()); aggregate.update(raw)
            build=aggregate.hexdigest(); folder='/usr/local/lib/sakura-project-identity/'+build
            manifest=dict(version=1,build=build,files=[dict(name=name,size=len(raw),sha256=hashlib.sha256(raw).hexdigest()) for name,raw in files.items()])
            for name,raw in files.items(): k.add(folder+'/'+name,raw)
            if mutation=='digest': k.nodes[folder+'/launcher.c'].raw+=b'x'
            elif mutation=='source-mode': k.nodes[folder+'/controller.py'].info.st_mode=stat.S_IFREG|0o644
            elif mutation=='source-owner': k.nodes[folder+'/controller.py'].info.st_uid=20001
            elif mutation=='source-symlink': k.nodes[folder+'/controller.py'].info.st_mode=stat.S_IFLNK|0o777
            elif mutation=='directory-owner': k.nodes[folder].info.st_uid=20001
            elif mutation=='aggregate': manifest['files'][0]['sha256']='a'*64
            k.add(folder+'/manifest.json',json.dumps(manifest).encode()); builtins._desktop_model_executed=0
            if mutation:
                with self.assertRaises(Exception): ns['desktop_native'](build)
                self.assertEqual(builtins._desktop_model_executed,0)
            else:
                self.assertEqual(ns['desktop_native'](build)['sources'](),build); self.assertEqual(builtins._desktop_model_executed,1)
            self.assertFalse(k.fds); self.assertFalse(k.writes)
        del builtins._desktop_model_executed

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `Kernel`, `k.authority`, `hashlib.sha256(b'private-environment-body').hexdigest`, `hashlib.sha256`.
    def test_x11_environment_comes_only_from_verified_original_plasma(self):
        k=Kernel(); f=k.authority()
        expected={'TOKEN':hashlib.sha256(b'private-environment-body').hexdigest()}
        user,environment,checked=f.ns['desktop_environment']('net:[54321]',expected,f.proof)
        self.assertEqual(user.pw_uid,20001); self.assertEqual(environment['TOKEN'],'private-environment-body')
        self.assertEqual(environment['PATH'],'/usr/local/bin:/usr/bin:/bin')
        self.assertEqual(environment['HOME'],f.identity['home']); f.ns['os'].close(checked['directoryFd'])
        self.assertFalse(k.writes)
        for key in ('HOME','LD_PRELOAD','DISPLAY'):
            with self.assertRaises(Exception): f.ns['desktop_environment']('net:[54321]',{key:'a'*64},f.proof)
            self.assertFalse(k.fds)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `k.nodes[path].info.st_ino`, `k.nodes['/proc/sys/kernel/random/boot_id'].raw`, `k.nodes[path].info.st_mode`, `k.nodes[path].info.st_uid`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `k.module`, `k.add`, `self.subTest`.
    def test_own_sandbox_groups_reject_inode_boot_and_symlink_replacements(self):
        for source in (X11,WAYLAND):
            for mutation in ('inode','boot','symlink','owner','missing-proof'):
                k=Kernel(); ns=k.module(source); path='/sys/fs/cgroup/sakura-clipboard-owned'
                k.add('/proc/sys/kernel/random/boot_id',b'original-boot'); k.add(path,mode=stat.S_IFDIR|0o755,inode=999,device=29)
                value={'bootId':'original-boot','cgroup':{'device':'29','inode':'999'}}
                if mutation=='inode': k.nodes[path].info.st_ino=1000
                elif mutation=='boot': k.nodes['/proc/sys/kernel/random/boot_id'].raw=b'new-boot'
                elif mutation=='symlink': k.nodes[path].info.st_mode=stat.S_IFLNK|0o777
                elif mutation=='owner': k.nodes[path].info.st_uid=20001
                else: value['cgroup']=None
                with self.subTest(source=source,mutation=mutation),self.assertRaises(Exception): ns['application_group'](ns['Path'](path),value)
                self.assertFalse(k.fds); self.assertFalse(k.writes)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `ns['process']`, `k.before_open`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `k.module`, `k.add`, `k.process`.
    def test_exact_full_sandbox_kill_preserves_neighbor_and_rechecks_before_path_retirement(self):
        for replace_before_kill in (False,True):
            k=Kernel(); ns=k.module(); path='/sys/fs/cgroup/sakura-clipboard-owned'
            k.add('/proc/sys/kernel/random/boot_id',b'original-boot')
            k.add(path,mode=stat.S_IFDIR|0o755,inode=999,device=29)
            k.add(path+'/cgroup.procs',b'1001\n'); k.add(path+'/cgroup.events',b'populated 1\n'); k.add(path+'/cgroup.kill')
            k.process(1001,20001,PurePosixPath(path).name,'/usr/bin/editor')
            k.add('/sys/fs/cgroup/neighbor',mode=stat.S_IFDIR|0o755,inode=1000,device=29)
            ns['process']=lambda pid: dict(pid=pid,uid=20001,network='net:[54321]',created='777')
            value={'bootId':'original-boot','cgroup':{'device':'29','inode':'999'}}
            count=[0]
            # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
            # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
            # 输入 / Inputs: target, flags。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 状态影响 / State effects: `count[0]`, `k.nodes[path].info`, `k.nodes[path].info.st_ino`. Follow the actual model assignments / 以模型中的实际赋值为准。
            # 协作入口 / Collaborators: `copy.copy`.
            def opened(target,flags):
                if target==path:
                    count[0]+=1
                    if replace_before_kill and count[0]==2: k.nodes[path].info=copy.copy(k.nodes[path].info); k.nodes[path].info.st_ino=1002
            k.before_open=opened
            if replace_before_kill:
                with self.assertRaises(Exception): ns['application_retire'](ns['Path'](path),value,20001,'net:[54321]')
                self.assertFalse(k.writes); self.assertFalse(k.removed)
            else:
                ns['application_retire'](ns['Path'](path),value,20001,'net:[54321]')
                self.assertEqual(k.writes,[(path+'/cgroup.kill',b'1')]); self.assertEqual(k.removed,[path])
            self.assertIn('/sys/fs/cgroup/neighbor',k.nodes); self.assertFalse(k.fds)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `ast.parse`, `WAYLAND.read_text`, `ast.unparse`, `next`.
    def test_wayland_uid_allocation_is_disjoint_and_never_reuses_project_account(self):
        tree=ast.parse(WAYLAND.read_text(encoding='utf-8'))
        account=ast.unparse(next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='create_account'))
        self.assertIn('range(1000, 20000)',account); self.assertIn('user.pw_uid == uid',account)
        self.assertIn('user.pw_gid == uid',account)
        child=ast.unparse(next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='launch_with_directory'))
        self.assertLess(child.index('os.setuid'),child.index('os.fchdir'))
        self.assertIn('cwd=None',child); self.assertNotIn('cwd=request',child)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `neighbor['desktop']['run']['runId']`, `ns['stop']`, `proof['record']['phase']`, `proof['identity']['uid']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `k.authority`, `ns['Path']`, `k.add`.
    def test_desktop_application_retirement_matches_every_original_owner_field_and_refuses_unknown_domains(self):
        for source in (X11, WAYLAND):
            for mutation in (None, 'same-run-wrong-owner', 'orphan'):
                k=Kernel(); f=k.authority(source); ns=f.ns
                owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                own='44444444-4444-4444-8444-444444444444'
                other='55555555-5555-4555-8555-555555555555'
                base=ns['Path']('/run/clipboard-model/'+owner)
                k.add(str(base),mode=stat.S_IFDIR|0o700)
                value=dict(version=2,desktop=copy.deepcopy(f.proof))
                neighbor=copy.deepcopy(value); neighbor['desktop']['run']['runId']=other
                for identifier,row in [(own,value),(other,neighbor)]:
                    k.add(str(base/identifier/'session.json'),json.dumps(row).encode())
                retired=[]; ns['stop']=lambda directory, actual_owner: retired.append((directory.name,actual_owner))
                proof=copy.deepcopy(f.proof); proof['record']['phase']='stopped'
                if mutation=='same-run-wrong-owner': proof['identity']['uid']+=1
                elif mutation=='orphan':
                    k.add(str(ns['cgroup_path'](owner,'66666666-6666-4666-8666-666666666666')),mode=stat.S_IFDIR|0o755)
                if mutation:
                    with self.subTest(source=source,mutation=mutation),self.assertRaises(Exception): ns['retire_desktop'](base,owner,proof)
                    if mutation=='same-run-wrong-owner': self.assertFalse(retired)
                else:
                    reply=ns['retire_desktop'](base,owner,proof)
                    self.assertEqual(reply,{'stopped':True,'sessions':[own]})
                self.assertNotIn((other,owner),retired); self.assertFalse(k.writes); self.assertFalse(k.fds)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `OS.listdir`, `OS.stat`, `OS.rmdir`, `OS.fsync`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `ast.parse`, `next`, `isinstance`, `ast.unparse`.
    def test_runtime_retirement_rechecks_exact_inode_and_closes_fds_before_receipt_can_retire(self):
        tree=ast.parse(ADAPTER)
        node=next(row for row in tree.body if isinstance(row,ast.FunctionDef) and row.name=='retire_runtime')
        body=ast.unparse(node)
        self.assertLess(body.index('os.setresuid'),body.index('os.fchmod'))
        self.assertIn('depth <= 32',body); self.assertIn('remaining = [4096]',body)
        self.assertIn('time.monotonic() + 10',body)
        for mutation in (None,'inode','before-rmdir','nonempty','fsync'):
            k=Kernel(); ns=k.module(); path='/run/sakura-desktop-uid/20001/original-runtime'
            k.add(path,mode=stat.S_IFDIR|0o700,inode=999)
            if mutation=='nonempty': k.add(path+'/unknown',b'owned-but-unpublished')
            proof={'identity':{'uid':20001,'gid':20001},'runtime':path}
            receipt={'phase':'creating','runtimeDevice':'12','runtimeInode':'999'}
            OS=ns['os']; synced=[]
            OS.listdir=lambda fd: [PurePosixPath(row).name for row in k.nodes if row!=path and PurePosixPath(row).parent==PurePosixPath(k.fds[fd][0])]
            # 中文功能：核对模型证据或测试条件，按实现返回判定或拒绝不符合要求的输入。
            # English: Check model evidence or test conditions, returning a decision or rejecting inputs as specified by the implementation.
            # 输入 / Inputs: name, dir_fd = None, follow_symlinks = False。
            # 结果：返回分支计算值（`k.nodes[target].info`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`k.nodes[target].info`); its implementation and call sites define the actual type.
            # 状态影响 / State effects: `k.nodes[target].info`, `k.nodes[target].info.st_ino`. Follow the actual model assignments / 以模型中的实际赋值为准。
            # 协作入口 / Collaborators: `str`, `PurePosixPath`, `copy.copy`.
            def checked_stat(name,dir_fd=None,follow_symlinks=False):
                target=str(PurePosixPath(k.fds[dir_fd][0])/name)
                if mutation=='before-rmdir': k.nodes[target].info=copy.copy(k.nodes[target].info); k.nodes[target].info.st_ino+=1
                return k.nodes[target].info
            OS.stat=checked_stat
            OS.rmdir=lambda name,dir_fd=None: ns['Path'](str(PurePosixPath(k.fds[dir_fd][0])/name)).rmdir()
            # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
            # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
            # 输入 / Inputs: fd。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 失败 / Failure: `OSError('model fsync failed; receipt must remain')`；由调用者或用例断言观察 / Observed by callers or case assertions.
            # 协作入口 / Collaborators: `synced.append`, `OSError`.
            def synced_parent(fd):
                synced.append(k.fds[fd][0])
                if mutation=='fsync': raise OSError('model fsync failed; receipt must remain')
            OS.fsync=synced_parent
            exec(compile(ast.Module(body=[node],type_ignores=[]),'<fixed Desktop runtime cleanup>','exec'),ns)
            if mutation=='inode': k.nodes[path].info.st_ino+=1
            if mutation:
                with self.subTest(mutation=mutation),self.assertRaises(Exception): ns['retire_runtime'](proof,receipt)
                if mutation!='fsync': self.assertFalse(k.removed)
            else:
                ns['retire_runtime'](proof,receipt); self.assertEqual(k.removed,[path]); self.assertEqual(synced,[str(PurePosixPath(path).parent)])
            self.assertFalse(k.fds); self.assertFalse(k.writes)


if __name__=='__main__':
    unittest.main()
