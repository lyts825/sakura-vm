# 模块职责：在内核路径与描述符模型上执行生产目录视图守卫，不启动应用或替代 Linux smoke。
# Module: Execute production directory-view guards against kernel-path and descriptor models without launching an application or replacing Linux smoke checks.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
# 可移植边界模型：通过受控适配器验证生产流程；真实系统权限与进程隔离需另行运行 Linux 验证。
# 覆盖：test_mapping_direction_preserves_disk_project_owner
# 覆盖：test_overlap_and_wrong_ranges_never_create_a_namespace
# 覆盖：test_receipt_rejects_unknown_fields_uid_run_and_source_changes
"""Execute production directory-view guards against explicit kernel/FD models.

These portable models supplement, and do not replace, the actual Linux helper
smoke. They never import or execute application code.
"""
import array
import ast
import copy
import ctypes
import errno
import json
import os
from pathlib import Path as RealPath, PurePosixPath
import re
import signal
import socket
import stat
import struct
from types import SimpleNamespace
import unittest

ROOT = RealPath(__file__).resolve().parents[1]
CONTROLLER = ROOT / 'native/wayland-clipboard/controller.py'
PROXY = ROOT / 'native/wayland-clipboard/proxy.py'
RUN = '11111111-1111-4111-8111-111111111111'
BOOT = '22222222-2222-4222-8222-222222222222'


# 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
# English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
# 输入 / Inputs: 无 / none。
# 结果：返回分支计算值（`namespace`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`namespace`); its implementation and call sites define the actual type.
# 协作入口 / Collaborators: `ast.parse`, `CONTROLLER.read_text`, `isinstance`, `SimpleNamespace`.
def functions():
    tree = ast.parse(CONTROLLER.read_text(encoding='utf8'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             or isinstance(node, ast.ClassDef) and node.name == 'DirectoryViewError']
    namespace = {'array': array, 'ctypes': ctypes, 'errno': errno, 'json': json, 'os': os,
                 'Path': PurePosixPath, 're': re, 'signal': SimpleNamespace(SIGKILL=9), 'socket': socket, 'stat': stat,
                 'UUID': re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(CONTROLLER), 'exec'), namespace)
    return namespace


# 中文功能：构造本组边界验证所需的模型对象或输入材料。
# English: Construct model objects or input material required by this boundary-verification group.
# 输入 / Inputs: 无 / none。
# 结果：返回分支计算值（`{'desktop': {'identity': identity, 'run': {'runId': RUN, 'bootId': BOOT}}, 'directory': identity['di…`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`{'desktop': {'identity': identity, 'run': {'runId': RUN, 'bootId': BOOT}}, 'directory': identity['di…`); its implementation and call sites define the actual type.
def record():
    identity = {'uid': 20001, 'gid': 20002, 'directory': '/home/private/project',
                'directoryDevice': '12', 'directoryInode': '1234', 'projectId': 'a' * 16}
    proof = {'version': 1, 'device': '4', 'inode': '9876', 'directoryDevice': '12', 'directoryInode': '1234',
             'directoryMode': 0o700, 'mountFlags': 6,
             'projectUid': 20001, 'projectGid': 20002, 'uid': 15000, 'gid': 15001,
             'desktopRunId': RUN, 'bootId': BOOT, 'route': '/home/private'}
    return {'desktop': {'identity': identity, 'run': {'runId': RUN, 'bootId': BOOT}},
            'directory': identity['directory'], 'bootId': BOOT, 'uid': 15000, 'gid': 15001, 'directoryView': proof}


class Models(unittest.TestCase):
    # 中文功能：准备本用例的独立目录与状态，使用例之间的输入和失败注入相互隔离。
    # English: Prepare a private directory and state for this case so inputs and injected failures are isolated between cases.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns`, `self.value`, `self.user`, `self.ns['RUNTIME']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `functions`, `record`, `SimpleNamespace`, `PurePosixPath`.
    def setUp(self):
        self.ns = functions()
        self.value = record()
        self.user = SimpleNamespace(pw_uid=15000, pw_gid=15001, pw_dir='/home/sandbox')
        self.ns['RUNTIME'] = PurePosixPath('/run/sakura-wl')

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['directory_view_helper']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.ns.update`, `SimpleNamespace`, `self.ns['directory_view_userns']`, `self.assertEqual`.
    def test_mapping_direction_preserves_disk_project_owner(self):
        contents, writes, closed = {}, [], []
        class Path(PurePosixPath):
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: self。
            # 结果：返回分支计算值（`contents[str(self)]`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`contents[str(self)]`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `str`.
            def read_text(self): return contents[str(self)]
        files = {}
        # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
        # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
        # 输入 / Inputs: path, flags。
        # 结果：返回分支计算值（`descriptor`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`descriptor`); its implementation and call sites define the actual type.
        # 状态影响 / State effects: `files[descriptor]`. Follow the actual model assignments / 以模型中的实际赋值为准。
        # 协作入口 / Collaborators: `len`, `str`.
        def open_(path, flags):
            descriptor = len(files) + 10
            files[descriptor] = str(path)
            return descriptor
        # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
        # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
        # 输入 / Inputs: fd, raw。
        # 结果：返回分支计算值（`len(raw)`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`len(raw)`); its implementation and call sites define the actual type.
        # 状态影响 / State effects: `contents[files[fd]]`. Follow the actual model assignments / 以模型中的实际赋值为准。
        # 协作入口 / Collaborators: `raw.decode`, `writes.append`, `len`.
        def write_(fd, raw):
            contents[files[fd]] = raw.decode()
            writes.append((files[fd], raw))
            return len(raw)
        self.ns.update(Path=Path, os=SimpleNamespace(open=open_, write=write_, close=closed.append,
                       O_WRONLY=1, O_NOFOLLOW=2, O_CLOEXEC=4))
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: kind, initialize, parent_initialize。
        # 结果：返回分支计算值（`(55, {})`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`(55, {})`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `self.assertEqual`, `parent_initialize`.
        def helper(kind, initialize, parent_initialize):
            self.assertEqual(kind, 0x10000000)
            parent_initialize(777)
            return 55, {}
        self.ns['directory_view_helper'] = helper
        result = self.ns['directory_view_userns'](self.value['desktop']['identity'], self.user)
        self.assertEqual(result, 55)
        self.assertEqual([raw for _, raw in writes], [b'deny', b'20001 15000 1', b'20002 15001 1'])
        self.assertEqual(closed, [10, 11, 12])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['directory_view_helper']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.subTest`, `dict`, `self.assertRaises`, `self.ns['directory_view_userns']`.
    def test_overlap_and_wrong_ranges_never_create_a_namespace(self):
        called = []
        self.ns['directory_view_helper'] = lambda *args: called.append(args)
        for project, app in [(20001, 20001), (1000, 15000), (20001, 20000), (20001, 999)]:
            with self.subTest(project=project, app=app):
                identity = dict(self.value['desktop']['identity'], uid=project)
                with self.assertRaises(RuntimeError):
                    self.ns['directory_view_userns'](identity, SimpleNamespace(pw_uid=app, pw_gid=15001))
        self.assertEqual(called, [])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `record_['directoryView'][key]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.subTest`, `copy.deepcopy`, `self.assertRaises`, `self.ns['directory_view_proof']`.
    def test_receipt_rejects_unknown_fields_uid_run_and_source_changes(self):
        changes = [('extra', True), ('uid', 15001), ('gid', 15000), ('projectUid', 20003),
                   ('directoryInode', '4321'), ('desktopRunId', BOOT), ('bootId', RUN),
                   ('inode', '0'), ('device', '-1'), ('route', '/'), ('route', '/other/private'),
                   ('directoryMode', True), ('directoryMode', 0o10000), ('mountFlags', 2), ('mountFlags', -1)]
        for key, value in changes:
            with self.subTest(field=key):
                record_ = copy.deepcopy(self.value)
                record_['directoryView'][key] = value
                with self.assertRaises(RuntimeError):
                    self.ns['directory_view_proof'](record_)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['directory_view_member']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.assertEqual`, `self.ns['directory_view_proof']`, `copy.deepcopy`, `self.assertIsNone`.
    def test_stopped_receipt_does_not_reopen_an_expired_namespace(self):
        self.ns['directory_view_member'] = lambda *args: self.fail('empty/stopped receipt looked up a PID namespace')
        self.assertEqual(self.ns['directory_view_proof'](self.value), self.value['directoryView'])
        old = copy.deepcopy(self.value)
        del old['directoryView']
        self.assertIsNone(self.ns['directory_view_proof'](old))

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, kind = 131072, owner = 1。
    # 结果：返回分支计算值（`closed`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`closed`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.ns['fcntl']`, `self.ns['os']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `SimpleNamespace`.
    def namespace_kernel(self, kind=0x20000, owner=1):
        closed = []
        self.ns['fcntl'] = SimpleNamespace(ioctl=lambda fd, command: kind if command == 0xb703 else 9)
        self.ns['os'] = SimpleNamespace(fstat=lambda fd: SimpleNamespace(st_dev=4, st_ino=1 if fd == 7 else owner),
                                       close=closed.append)
        return closed

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.namespace_kernel`, `self.assertRaisesRegex`, `self.ns['directory_view_namespace']`, `self.assertEqual`.
    def test_wrong_namespace_type_is_rejected_before_owner_lookup(self):
        closed = self.namespace_kernel(kind=0x10000000)
        with self.assertRaisesRegex(RuntimeError, '类型'):
            self.ns['directory_view_namespace'](8, 0x20000, 7)
        self.assertEqual(closed, [])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.namespace_kernel`, `self.assertRaisesRegex`, `self.ns['directory_view_namespace']`, `self.assertEqual`.
    def test_namespace_foreign_root_owner_is_rejected_and_fd_closed(self):
        closed = self.namespace_kernel(owner=2)
        with self.assertRaisesRegex(RuntimeError, 'Root user namespace'):
            self.ns['directory_view_namespace'](8, 0x20000, 7)
        self.assertEqual(closed, [9])

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, namespace = 9876, directory = 1234, result = 0, uid = 15000, gid = 15001, mode = 448, flags = 6。
    # 结果：返回分支计算值（`(closed, entered)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`(closed, entered)`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.ns['os']`, `self.ns['ctypes']`, `self.ns['directory_view_open']`, `self.ns['directory_view_member']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `SimpleNamespace`.
    def enter_kernel(self, namespace=9876, directory=1234, result=0, uid=15000, gid=15001, mode=0o700, flags=6):
        closed, entered = [], []
        self.ns['os'] = SimpleNamespace(fstat=lambda fd: SimpleNamespace(st_dev=4 if fd == 8 else 12,
                                       st_ino=namespace if fd == 8 else directory, st_uid=uid, st_gid=gid,
                                       st_mode=stat.S_IFDIR | mode), close=closed.append, getpid=lambda: 444,
                                       fstatvfs=lambda fd: SimpleNamespace(f_flag=flags))
        self.ns['ctypes'] = SimpleNamespace(CDLL=lambda *args, **kwargs: SimpleNamespace(
                            setns=lambda fd, kind: (entered.append((fd, kind)), result)[1]), get_errno=lambda: errno.EPERM)
        self.ns['directory_view_open'] = lambda path: 10
        self.ns['directory_view_member'] = lambda pid, proof: None
        return closed, entered

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.enter_kernel`, `self.assertRaisesRegex`, `self.ns['directory_view_enter']`, `self.assertEqual`.
    def test_changed_mount_fd_never_enters_namespace_and_closes_fd(self):
        closed, entered = self.enter_kernel(namespace=9999)
        with self.assertRaisesRegex(RuntimeError, 'FD'):
            self.ns['directory_view_enter'](8, self.value['directoryView'], self.value['directory'])
        self.assertEqual(entered, [])
        self.assertEqual(closed, [8])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.enter_kernel`, `self.assertRaisesRegex`, `self.ns['directory_view_enter']`, `self.assertEqual`.
    def test_setns_failure_closes_root_namespace_fd(self):
        closed, entered = self.enter_kernel(result=-1)
        with self.assertRaisesRegex(self.ns['DirectoryViewError'], 'setns'):
            self.ns['directory_view_enter'](8, self.value['directoryView'], self.value['directory'])
        self.assertEqual(entered, [(8, 0x20000)])
        self.assertEqual(closed, [8])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.enter_kernel`, `self.assertRaisesRegex`, `self.ns['directory_view_enter']`, `self.assertEqual`.
    def test_changed_mapped_source_closes_both_fds(self):
        closed, _ = self.enter_kernel(directory=4321)
        with self.assertRaisesRegex(RuntimeError, '映射目录'):
            self.ns['directory_view_enter'](8, self.value['directoryView'], self.value['directory'])
        self.assertEqual(closed, [8, 10])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.enter_kernel`, `self.assertEqual`, `self.ns['directory_view_enter']`.
    def test_valid_view_returns_only_mapped_cwd_fd(self):
        closed, entered = self.enter_kernel()
        self.assertEqual(self.ns['directory_view_enter'](8, self.value['directoryView'], self.value['directory']), 10)
        self.assertEqual(closed, [8])
        self.assertEqual(entered, [(8, 0x20000)])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.subTest`, `self.enter_kernel`, `self.assertRaises`, `self.ns['directory_view_enter']`.
    def test_mapped_directory_wrong_uid_gid_mode_or_mount_flags_closes_fd(self):
        for fields in ({'uid': 20001}, {'gid': 20002}, {'mode': 0o755}, {'flags': 2}, {'flags': 14}):
            with self.subTest(fields=fields):
                closed, _ = self.enter_kernel(**fields)
                with self.assertRaises(RuntimeError):
                    self.ns['directory_view_enter'](8, self.value['directoryView'], self.value['directory'])
                self.assertEqual(closed, [8, 10])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.subTest`, `self.assertRaisesRegex`, `self.ns['directory_view_route_guard']`, `PurePosixPath`.
    def test_private_route_preserves_sandbox_home_and_runtime(self):
        for route in ('/home', '/home/sandbox', '/home/sandbox/subdir', '/run', '/run/sakura-wl', '/run/sakura-wl/subdir'):
            with self.subTest(route=route):
                with self.assertRaisesRegex(self.ns['DirectoryViewError'], 'route-private-account-overlap'):
                    self.ns['directory_view_route_guard'](PurePosixPath(route), self.user)
        self.ns['directory_view_route_guard'](PurePosixPath('/home/project-user'), self.user)
        self.ns['directory_view_route_guard'](PurePosixPath('/root/private'), self.user)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['launch_with_directory']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.ns.update`, `SimpleNamespace`, `self.assertRaisesRegex`, `self.ns['launch']`.
    def test_early_launch_error_always_closes_original_directory_fd(self):
        closed = []
        self.ns.update(proxy_valid=lambda: 'sha', identify=lambda image: {'image': image, 'sha256': 'sha'},
                       cgroup_root=lambda: None, project_network=lambda request: 'net:[50]',
                       compositor_context=lambda *args: ({}, {}, {'directoryFd': 88}),
                       os=SimpleNamespace(close=closed.append))
        for stage in ('rule', 'account', 'session-directory'):
            # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
            # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
            # 输入 / Inputs: *args。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 失败 / Failure: `RuntimeError(stage)`；由调用者或用例断言观察 / Observed by callers or case assertions.
            # 协作入口 / Collaborators: `RuntimeError`.
            def early_error(*args):
                raise RuntimeError(stage)
            self.ns['launch_with_directory'] = early_error
            with self.assertRaisesRegex(RuntimeError, stage):
                self.ns['launch'](None, 'owner', {'image': '/bin/app', 'sha256': 'sha', 'args': []})
        self.assertEqual(closed, [88, 88, 88])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['os']`, `self.ns['time']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `SimpleNamespace`, `self.assertRaisesRegex`, `self.ns['directory_view_wait']`, `self.assertEqual`.
    def test_helper_timeout_kills_and_waits_only_its_unreaped_child(self):
        calls = []
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: pid, flags。
        # 结果：返回分支计算值（`(0, 0) if flags else (777, 9)`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`(0, 0) if flags else (777, 9)`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `calls.append`.
        def wait(pid, flags):
            calls.append(('wait', pid, flags))
            return (0, 0) if flags else (777, 9)
        self.ns['os'] = SimpleNamespace(waitpid=wait, WNOHANG=1,
                                       kill=lambda pid, signal_: calls.append(('kill', pid, signal_)))
        self.ns['time'] = SimpleNamespace(monotonic=lambda: 10)
        with self.assertRaisesRegex(self.ns['DirectoryViewError'], 'helper-timeout'):
            self.ns['directory_view_wait'](777, 0)
        self.assertEqual(calls, [('wait', 777, 1), ('kill', 777, 9), ('wait', 777, 0)])

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, descriptors, raw = None, flags = 0。
    # 结果：返回分支计算值（`(closed, waited, sent)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`(closed, waited, sent)`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.ns['socket']`, `self.ns['os']`, `self.ns['time']`, `self.ns['directory_view_namespace']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `array.array('i', descriptors).tobytes`, `array.array`, `SimpleNamespace`, `dict`.
    def packet_kernel(self, descriptors, raw=None, flags=0):
        closed, waited, sent = [], [], []
        data = array.array('i', descriptors).tobytes()
        class Channel:
            # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
            # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
            # 输入 / Inputs: self, value。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            def settimeout(self, value): pass
            # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
            # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
            # 输入 / Inputs: self。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 协作入口 / Collaborators: `closed.append`.
            def close(self): closed.append('socket')
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: self, *args。
            # 结果：返回分支计算值（`(raw if raw is not None else json.dumps({'ok': True, 'result': {}, 'device': '4', 'inode': '9876'}).…`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`(raw if raw is not None else json.dumps({'ok': True, 'result': {}, 'device': '4', 'inode': '9876'}).…`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `json.dumps({'ok': True, 'result': {}, 'device': '4', 'inode': '9876'}).encode`, `json.dumps`.
            def recvmsg(self, *args):
                return (raw if raw is not None else json.dumps({'ok': True, 'result': {}, 'device': '4', 'inode': '9876'}).encode(),
                        [(1, 1, data)] if descriptors else [], flags, None)
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: self, value。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 协作入口 / Collaborators: `sent.append`.
            def sendall(self, value): sent.append(value)
        self.ns['socket'] = SimpleNamespace(**dict(
            [('AF_UNIX', 1), ('SOCK_SEQPACKET', 5), ('SOCK_CLOEXEC', 0x80000), ('SOL_SOCKET', 1),
             ('SCM_RIGHTS', 1), ('MSG_CMSG_CLOEXEC', 0x40000000), ('MSG_TRUNC', 32), ('MSG_CTRUNC', 8)]),
            socketpair=lambda *args: (Channel(), Channel()), CMSG_SPACE=lambda size: 24, timeout=TimeoutError)
        self.ns['os'] = SimpleNamespace(getpid=lambda: 1, fork=lambda: 777, open=lambda *args: 6,
             fstat=lambda fd: SimpleNamespace(st_dev=4, st_ino=9876), set_inheritable=lambda *args: None,
             close=closed.append, stat=lambda path: SimpleNamespace(st_dev=4, st_ino=9876),
             O_RDONLY=0, O_CLOEXEC=1)
        self.ns['time'] = SimpleNamespace(monotonic=lambda: 0)
        self.ns['directory_view_namespace'] = lambda *args: None
        self.ns['directory_view_wait'] = lambda pid, deadline: (waited.append(pid), 0)[1]
        return closed, waited, sent

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.packet_kernel`, `self.assertRaisesRegex`, `self.ns['directory_view_helper']`, `self.assertTrue`.
    def test_duplicate_rights_are_all_closed_and_owned_helper_waited(self):
        closed, waited, sent = self.packet_kernel([8, 9])
        with self.assertRaisesRegex(RuntimeError, 'FD 回执'):
            self.ns['directory_view_helper'](0x20000, lambda: {})
        self.assertTrue(6 in closed and 8 in closed and 9 in closed)
        self.assertEqual(waited, [777])
        self.assertEqual(sent, [])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.packet_kernel`, `self.assertRaisesRegex`, `self.ns['directory_view_helper']`, `self.assertIn`.
    def test_eof_receipt_still_waits_exact_helper(self):
        closed, waited, _ = self.packet_kernel([], raw=b'')
        with self.assertRaisesRegex(RuntimeError, '为空'):
            self.ns['directory_view_helper'](0x20000, lambda: {})
        self.assertIn(6, closed)
        self.assertEqual(waited, [777])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.packet_kernel`, `self.assertRaisesRegex`, `self.ns['directory_view_helper']`, `self.assertIn`.
    def test_cancel_after_rights_closes_namespace_before_waiting(self):
        closed, waited, sent = self.packet_kernel([8])
        # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
        # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
        # 输入 / Inputs: pid。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 失败 / Failure: `RuntimeError('cancelled')`；由调用者或用例断言观察 / Observed by callers or case assertions.
        # 协作入口 / Collaborators: `self.assertEqual`, `RuntimeError`.
        def cancelled(pid):
            self.assertEqual(pid, 777)
            raise RuntimeError('cancelled')
        with self.assertRaisesRegex(RuntimeError, 'cancelled'):
            self.ns['directory_view_helper'](0x20000, lambda: {}, cancelled)
        self.assertIn(8, closed)
        self.assertEqual(waited, [777])
        self.assertEqual(sent, [])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.packet_kernel`, `self.assertRaisesRegex`, `self.ns['directory_view_helper']`, `self.assertIn`.
    def test_truncated_rights_closes_every_received_fd_and_waits_helper(self):
        closed, waited, sent = self.packet_kernel([8], flags=8)
        with self.assertRaisesRegex(RuntimeError, '不完整'):
            self.ns['directory_view_helper'](0x20000, lambda: {})
        self.assertIn(8, closed)
        self.assertIn(6, closed)
        self.assertEqual(waited, [777])
        self.assertEqual(sent, [])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['directory_view_wait']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.packet_kernel`, `self.assertRaisesRegex`, `self.ns['directory_view_helper']`, `self.assertEqual`.
    def test_post_receipt_timeout_does_not_wait_reaped_pid_twice(self):
        closed, waited, sent = self.packet_kernel([8])
        # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
        # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
        # 输入 / Inputs: pid, deadline。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 失败 / Failure: `self.ns['DirectoryViewError']('helper-timeout', errno.ETIMEDOUT)`；由调用者或用例断言观察 / Observed by callers or case assertions.
        # 协作入口 / Collaborators: `waited.append`, `self.ns['DirectoryViewError']`.
        def timeout(pid, deadline):
            waited.append(pid)
            raise self.ns['DirectoryViewError']('helper-timeout', errno.ETIMEDOUT)
        self.ns['directory_view_wait'] = timeout
        with self.assertRaisesRegex(self.ns['DirectoryViewError'], 'helper-timeout'):
            self.ns['directory_view_helper'](0x20000, lambda: {})
        self.assertEqual(waited, [777])
        self.assertIn(8, closed)
        self.assertEqual(sent, [b'1'])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `current.st_ino`, `session['directoryView']['unknown']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `ast.parse`, `PROXY.read_text`, `next`, `isinstance`.
    def test_proxy_rejects_changed_mount_and_unknown_view_receipt(self):
        tree = ast.parse(PROXY.read_text(encoding='utf8'))
        method = next(node for node in next(node for node in tree.body if isinstance(node, ast.ClassDef)
                      and node.name == 'Broker').body if isinstance(node, ast.FunctionDef) and node.name == 'client_identity')
        current = SimpleNamespace(st_dev=4, st_ino=9876)
        class Path(PurePosixPath):
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: self。
            # 结果：返回分支计算值（`current`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`current`); its implementation and call sites define the actual type.
            def stat(self): return current
        identity = {'pid': 444, 'uid': 15000, 'created': '100', 'network': 'net:[50]', 'cgroup': ['0::/owned-app']}
        namespace = {'Path': Path, 'socket': SimpleNamespace(SOL_SOCKET=1, SO_PEERCRED=17), 'struct': struct, 'process_identity': lambda pid: identity,
                     'require': self.ns['require']}
        exec(compile(ast.Module(body=[method], type_ignores=[]), str(PROXY), 'exec'), namespace)
        session = dict(self.value, network='net:[50]', applicationCgroup='/sys/fs/cgroup/owned-app')
        broker = SimpleNamespace(session=session)
        channel = SimpleNamespace(getsockopt=lambda *args: struct.pack('=3i', 444, 15000, 15001))
        self.assertEqual(namespace['client_identity'](broker, channel), identity)
        current.st_ino = 9999
        with self.assertRaisesRegex(RuntimeError, 'namespace changed'):
            namespace['client_identity'](broker, channel)
        current.st_ino = 9876
        session['directoryView']['unknown'] = True
        with self.assertRaisesRegex(RuntimeError, 'receipt changed'):
            namespace['client_identity'](broker, channel)

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, populated。
    # 结果：返回分支计算值（`(Path('/sys/fs/cgroup/owned-app'), closed, writes, removed)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`(Path('/sys/fs/cgroup/owned-app'), closed, writes, removed)`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.ns['application_group']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.ns.update`, `SimpleNamespace`, `Path`.
    def retire_kernel(self, populated):
        closed, writes, removed, files = [], [], [], {}
        class Path(PurePosixPath):
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: self。
            # 结果：返回分支计算值（`'0::/owned-app\n'`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`'0::/owned-app\n'`); its implementation and call sites define the actual type.
            def read_text(self): return '0::/owned-app\n'
            # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
            # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
            # 输入 / Inputs: self。
            # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
            # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
            # 协作入口 / Collaborators: `removed.append`, `str`.
            def rmdir(self): removed.append(str(self))
        content = {'cgroup.procs': '444' if populated else '', 'cgroup.events': 'populated 1\n' if populated else 'populated 0\n'}
        # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
        # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
        # 输入 / Inputs: name, flags, dir_fd = None。
        # 结果：返回分支计算值（`descriptor`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`descriptor`); its implementation and call sites define the actual type.
        # 状态影响 / State effects: `files[descriptor]`. Follow the actual model assignments / 以模型中的实际赋值为准。
        # 协作入口 / Collaborators: `len`.
        def open_(name, flags, dir_fd=None):
            descriptor = 30 + len(files)
            files[descriptor] = name
            return descriptor
        self.ns.update(Path=Path, os=SimpleNamespace(open=open_, read=lambda fd, maximum: content[files[fd]].encode(),
                       write=lambda fd, raw: writes.append((files[fd], raw)), close=closed.append,
                       O_RDONLY=0, O_WRONLY=1, O_NOFOLLOW=2, O_CLOEXEC=4),
                       process=lambda pid: {'uid': 15000, 'network': 'net:[50]', 'created': '100'},
                       time=SimpleNamespace(monotonic=lambda: 0))
        self.ns['application_group'] = lambda *args: 10
        return Path('/sys/fs/cgroup/owned-app'), closed, writes, removed

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['directory_view_member']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.retire_kernel`, `self.assertRaisesRegex`, `self.ns['application_retire']`, `self.assertEqual`.
    def test_stop_rejects_live_foreign_mount_before_any_kill(self):
        group, closed, writes, removed = self.retire_kernel(True)
        # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
        # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
        # 输入 / Inputs: pid, proof。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 失败 / Failure: `RuntimeError('foreign namespace')`；由调用者或用例断言观察 / Observed by callers or case assertions.
        # 协作入口 / Collaborators: `self.assertEqual`, `RuntimeError`.
        def changed(pid, proof):
            self.assertEqual(pid, 444)
            raise RuntimeError('foreign namespace')
        self.ns['directory_view_member'] = changed
        with self.assertRaisesRegex(RuntimeError, 'foreign namespace'):
            self.ns['application_retire'](group, self.value, 15000, 'net:[50]', 'applicationProof')
        self.assertEqual(writes, [])
        self.assertEqual(removed, [])
        self.assertIn(10, closed)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['directory_view_member']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.retire_kernel`, `self.ns['application_retire']`, `self.assertEqual`, `self.assertGreaterEqual`.
    def test_empty_original_cgroup_retires_after_mount_namespace_expired(self):
        group, closed, writes, removed = self.retire_kernel(False)
        self.ns['directory_view_member'] = lambda *args: self.fail('namespace reopened after all original PIDs exited')
        self.ns['application_retire'](group, self.value, 15000, 'net:[50]', 'applicationProof')
        self.assertEqual(writes, [])
        self.assertEqual(removed, ['/sys/fs/cgroup/owned-app'])
        self.assertGreaterEqual(closed.count(10), 2)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `ast.parse`, `CONTROLLER.read_text`, `isinstance`, `node.name.startswith`.
    def test_source_failure_never_changes_mode_owner_acl(self):
        # Every ownership/permission operation in this implementation must be
        # confined to UID map files or newly created private tmpfs route nodes.
        tree = ast.parse(CONTROLLER.read_text(encoding='utf8'))
        directory_functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                               and node.name.startswith('directory_view_')]
        forbidden = {'chmod', 'chown', 'fchmod', 'fchown', 'setxattr', 'removexattr'}
        self.assertFalse(any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                             and node.func.attr in forbidden for function in directory_functions for node in ast.walk(function)))


if __name__ == '__main__':
    unittest.main()
