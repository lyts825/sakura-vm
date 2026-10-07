# 模块职责：在明确的进程、回执与描述符模型上执行生产 SingleApp 守卫，验证原运行边界。
# Module: Execute production SingleApp guards against explicit process, receipt and descriptor models to check original-run boundaries.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
# 可移植边界模型：通过受控适配器验证生产流程；真实系统权限与进程隔离需另行运行 Linux 验证。
# 覆盖：test_directory_copy_has_identical_production_ast_and_provenance
# 覆盖：test_unknown_uid_run_and_receipt_fields_are_rejected
# 覆盖：test_application_members_require_all_ids_nnp_caps_groups_and_original_namespace
"""Execute fixed SingleApp guards against explicit process/receipt/FD models."""
import ast
import copy
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path as RealPath, PurePosixPath
import re
import shlex
import stat
from types import SimpleNamespace
import unittest

ROOT = RealPath(__file__).resolve().parents[1]
SOURCE = ROOT / 'native/single-app/controller.py'
RUN = '11111111-1111-4111-8111-111111111111'
BOOT = '22222222-2222-4222-8222-222222222222'
BUILD = 'a' * 64


# 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
# English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
# 输入 / Inputs: 无 / none。
# 结果：返回分支计算值（`namespace`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`namespace`); its implementation and call sites define the actual type.
# 协作入口 / Collaborators: `ast.parse`, `SOURCE.read_text`, `isinstance`, `dict`.
def production():
    tree = ast.parse(SOURCE.read_text(encoding='utf8'))
    nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))]
    namespace = dict(hashlib=hashlib, json=json, os=os, Path=PurePosixPath, re=re, stat=stat,
                     shlex=shlex, errno=errno, ctypes=ctypes, BUILD=BUILD,
                     BASE=PurePosixPath('/var/lib/sakura/single-app-uid'), RUNTIME=PurePosixPath('/run/sakura-single-app-uid'),
                     UUID=re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
                     DIGEST=re.compile(r'^[a-f0-9]{64}$'))
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), namespace)
    return namespace


# 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
# English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
# 输入 / Inputs: 无 / none。
# 结果：返回分支计算值（`{'version': 1, 'id': RUN, 'build': BUILD, 'origin': origin, 'identity': identity, 'run': run, 'state…`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`{'version': 1, 'id': RUN, 'build': BUILD, 'origin': origin, 'identity': identity, 'run': run, 'state…`); its implementation and call sites define the actual type.
# 协作入口 / Collaborators: `RUN.replace`.
def value():
    identity = {'projectId': 'default', 'registryId': RUN, 'identityId': BOOT, 'revision': 1,
                'uid': 20001, 'gid': 20001, 'directory': '/private/project', 'directoryDevice': '1', 'directoryInode': '2'}
    run = {'runId': RUN, 'bootId': BOOT, 'build': BUILD, 'phase': 'active', 'mode': 'independent',
           'cgroupName': 'sakura-identity-' + RUN, 'networkDevice': '4', 'networkInode': '5',
           'cgroupDevice': '6', 'cgroupInode': '7', 'registryId': RUN, 'identityId': BOOT, 'projectId': 'default', 'revision': 1}
    user = 'skapp' + RUN.replace('-', '')[:24]
    origin = {'identity': identity, 'run': run, 'program': 'xterm', 'args': [], 'resolution': '1024x768',
              'clipboard': {'copy': False, 'paste': True}, 'configVersion': BUILD}
    image = {'path': '/usr/bin/Xvnc', 'device': '8', 'inode': '9', 'sha256': BUILD, 'command': '/usr/bin/Xvnc'}
    return {'version': 1, 'id': RUN, 'build': BUILD, 'origin': origin, 'identity': identity, 'run': run, 'state': 'starting',
            'uid': 15000, 'gid': 15000, 'user': user, 'home': '/home/' + user, 'homeDevice': '10', 'homeInode': '11',
            'runtime': '/run/sakura-single-app-uid/' + RUN, 'runtimeDevice': '12', 'runtimeInode': '13',
            'password': 'Abc/123+', 'display': 10, 'port': 5910, 'image': image, 'tools': {'vnc': image},
            'directoryView': None, 'supervisor': {'pid': 444, 'created': '99', 'image': '/usr/bin/python3', 'device': '8', 'inode': '9'},
            'endpoint': None, 'processes': None, 'retirement': None, 'firewall': 'active'}


class NativeModels(unittest.TestCase):
    # 中文功能：准备本用例的独立目录与状态，使用例之间的输入和失败注入相互隔离。
    # English: Prepare a private directory and state for this case so inputs and injected failures are isolated between cases.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `production`, `value`.
    def setUp(self):
        self.ns, self.value = production(), value()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `json.loads`, `(ROOT / 'native/single-app/sources.json').read_text`, `bodies`, `self.assertEqual`.
    def test_directory_copy_has_identical_production_ast_and_provenance(self):
        metadata = json.loads((ROOT / 'native/single-app/sources.json').read_text(encoding='utf8'))
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: path。
        # 结果：返回分支计算值（`{node.name: ast.dump(node, include_attributes=False) for node in ast.parse(path.read_text(encoding='…`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`{node.name: ast.dump(node, include_attributes=False) for node in ast.parse(path.read_text(encoding='…`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `ast.dump`, `ast.parse`, `path.read_text`, `isinstance`.
        def bodies(path):
            return {node.name: ast.dump(node, include_attributes=False) for node in ast.parse(path.read_text(encoding='utf8')).body
                    if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in metadata['functions']}
        original = bodies(ROOT / metadata['directoryViewOrigin'])
        copied = bodies(ROOT / 'native/single-app/directory-view.py')
        self.assertEqual(set(original), set(metadata['functions']))
        self.assertEqual(original, copied)
        digest = hashlib.sha256('\n'.join(original[name] for name in metadata['functions']).encode()).hexdigest()
        self.assertEqual(digest, metadata['functionAstSha256'])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['secure_directory']`, `self.ns['protected']`, `self.value[field]`, `self.value`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.assertEqual`, `self.ns['read_receipt']`, `copy.deepcopy`, `self.subTest`.
    def test_unknown_uid_run_and_receipt_fields_are_rejected(self):
        self.ns['secure_directory'] = lambda path: path
        self.ns['protected'] = lambda *args: json.dumps(self.value).encode()
        self.assertEqual(self.ns['read_receipt'](RUN, self.value['origin'])['uid'], 15000)
        for field, replacement in [('uid', 20001), ('gid', 15001), ('id', BOOT), ('runtime', '/tmp/foreign'), ('extra', True)]:
            original = copy.deepcopy(self.value)
            self.value[field] = replacement
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.ns['read_receipt'](RUN, self.value['origin'])
            self.value = original

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, uid = 15000, gid = 15000, nnp = 1, groups = '', cap = '0', net = 5, changed = False。
    # 结果：返回分支计算值（`(calls, view)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`(calls, view)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `str`, `''.join`, `self.ns.update`, `SimpleNamespace`.
    def process_kernel(self, uid=15000, gid=15000, nnp=1, groups='', cap='0', net=5, changed=False):
        calls = []
        status = 'Uid:\t' + ('%s ' % uid) * 4 + '\nGid:\t' + ('%s ' % gid) * 4 + '\nGroups:\t' + groups + '\nNoNewPrivs:\t' + str(nnp) + '\n'
        status += ''.join(name + ':\t' + cap + '\n' for name in ('CapInh', 'CapPrm', 'CapEff', 'CapAmb'))
        class Path(PurePosixPath):
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: path。
            # 结果：返回分支计算值（`'444 (python) ' + ' '.join(['S', '1', *['0'] * 17, '99']) / status.replace('NoNewPrivs:\t1', 'NoNewPrivs:\t0') if changed and len(calls) > 1 else status`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`'444 (python) ' + ' '.join(['S', '1', *['0'] * 17, '99']) / status.replace('NoNewPrivs:\t1', 'NoNewPrivs:\t0') if changed and len(calls) > 1 else status`); its implementation and call sites define the actual type.
            # 失败 / Failure: `AssertionError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
            # 协作入口 / Collaborators: `' '.join`, `calls.append`, `len`, `status.replace`.
            def read_text(path):
                if path.name == 'stat':
                    return '444 (python) ' + ' '.join(['S', '1', *['0'] * 17, '99'])
                if path.name == 'status':
                    calls.append('status')
                    return status.replace('NoNewPrivs:\t1', 'NoNewPrivs:\t0') if changed and len(calls) > 1 else status
                if path.name == 'cgroup': return '0::/sakura-identity-' + RUN + '\n'
                raise AssertionError(path)
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: path。
            # 结果：返回分支计算值（`SimpleNamespace(st_dev=4 if path.name == 'net' else 8, st_ino=net if path.name == 'net' else 9)`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`SimpleNamespace(st_dev=4 if path.name == 'net' else 8, st_ino=net if path.name == 'net' else 9)`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `SimpleNamespace`.
            def stat(path): return SimpleNamespace(st_dev=4 if path.name == 'net' else 8, st_ino=net if path.name == 'net' else 9)
        self.ns.update(Path=Path, os=SimpleNamespace(readlink=lambda path: '/usr/bin/python3'))
        view = {'directory_view_member': lambda pid, proof: calls.append(('mapped', pid))}
        return calls, view

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.process_kernel`, `self.assertEqual`, `self.ns['process']`, `self.assertIn`.
    def test_application_members_require_all_ids_nnp_caps_groups_and_original_namespace(self):
        calls, view = self.process_kernel()
        self.assertEqual(self.ns['process'](444, self.value, view)['created'], '99')
        self.assertIn(('mapped', 444), calls)
        for kwargs in [dict(uid=20001), dict(gid=15001), dict(nnp=0), dict(groups='0'), dict(cap='1'), dict(net=6), dict(changed=True)]:
            with self.subTest(kwargs=kwargs):
                _, view = self.process_kernel(**kwargs)
                with self.assertRaises(RuntimeError): self.ns['process'](444, self.value, view)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.value['supervisor'][field]`, `self.value`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.process_kernel`, `self.assertEqual`, `self.ns['process']`, `copy.deepcopy`.
    def test_short_root_bootstrap_requires_exact_pid_birth_image_and_nnp(self):
        _, view = self.process_kernel(uid=0, gid=0)
        self.assertEqual(self.ns['process'](444, self.value, view, True)['pid'], 444)
        for field, replacement in [('pid', 445), ('created', '100'), ('image', '/bin/evil'), ('inode', '99')]:
            original = copy.deepcopy(self.value)
            self.value['supervisor'][field] = replacement
            with self.subTest(field=field), self.assertRaises(RuntimeError): self.ns['process'](444, self.value, view, True)
            self.value = original
        _, view = self.process_kernel(uid=0, gid=0, nnp=0)
        with self.assertRaises(RuntimeError): self.ns['process'](444, self.value, view, True)

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, extant = (), ticket = None, archive = None。
    # 结果：返回分支计算值（`(request, writes, closed)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`(request, writes, closed)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `SimpleNamespace`, `self.ns.update`.
    def recovery_core(self, extant=(), ticket=None, archive=None):
        writes, closed = [], []
        class Refusal(RuntimeError):
            code = 'RECORD_ABSENT'
        # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
        # English: Read or resolve observable model data for adapted production-definition calls or assertions.
        # 输入 / Inputs: identifier。
        # 结果：返回分支计算值（`ticket`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`ticket`); its implementation and call sites define the actual type.
        # 失败 / Failure: `Refusal()`；由调用者或用例断言观察 / Observed by callers or case assertions.
        # 协作入口 / Collaborators: `Refusal`.
        def run_read(identifier):
            if ticket is None: raise Refusal()
            return ticket
        core = {'initialize_readonly': lambda: 10, 'binding_read': lambda project: self.value['identity'],
                'reservation_check': lambda *args: None, 'registry': lambda readonly: {}, 'run_read': run_read,
                'Refusal': Refusal, 'run_path': lambda identifier: '/native/' + identifier,
                'RUN': SimpleNamespace(size=512), 'read': lambda *args: None, 'run_archive_read': lambda identifier: archive,
                'check_run': lambda identity, run, boot, active: self.assertEqual(run['bootId'], boot),
                'cgroup_fd': lambda run: 22, 'prepare': lambda *args: writes.append('forbidden-prepare')}
        class Path(PurePosixPath):
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: path。
            # 结果：返回分支计算值（`BOOT`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`BOOT`); its implementation and call sites define the actual type.
            def read_text(path): return BOOT
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: path。
            # 结果：返回分支计算值（`iter([])`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`iter([])`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `iter`.
            def iterdir(path): return iter([])
        self.ns.update(native=lambda build: core, secure_directory=lambda path: path, Path=Path,
                       os=SimpleNamespace(path=SimpleNamespace(lexists=lambda path: str(path) in set(extant)), close=closed.append))
        request = {'id': RUN, 'identity': self.value['identity'], 'bootId': BOOT, 'nativeBuild': BUILD}
        return request, writes, closed

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.recovery_core`, `self.ns['recover_intent']`, `self.assertIsNone`, `self.assertEqual`.
    def test_intent_without_ticket_retires_only_complete_readonly_absence_proof(self):
        request, writes, closed = self.recovery_core()
        result = self.ns['recover_intent'](request)
        self.assertIsNone(result['run']); self.assertEqual(result['absence']['id'], RUN)
        self.assertTrue(all(result['absence'][key] for key in ('ticketAbsent', 'cgroupAbsent', 'guestReceiptAbsent', 'runtimeAbsent')))
        self.assertEqual(writes, []); self.assertEqual(closed, [10])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.subTest`, `self.recovery_core`, `self.assertRaises`, `self.ns['recover_intent']`.
    def test_any_unknown_group_guest_receipt_runtime_or_archive_keeps_intent(self):
        for path in ['/sys/fs/cgroup/sakura-identity-' + RUN,
                     '/var/lib/sakura/single-app-uid/' + RUN + '/session.json', '/run/sakura-single-app-uid/' + RUN]:
            with self.subTest(path=path):
                request, writes, closed = self.recovery_core([path])
                with self.assertRaises(RuntimeError): self.ns['recover_intent'](request)
                self.assertEqual(writes, []); self.assertEqual(closed, [10])
        request, writes, closed = self.recovery_core(archive=b'unknown')
        with self.assertRaises(RuntimeError): self.ns['recover_intent'](request)
        self.assertEqual(writes, [])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.recovery_core`, `self.assertEqual`, `self.ns['recover_intent']`, `dict`.
    def test_existing_original_ticket_is_recovered_without_reissuing_it(self):
        request, writes, closed = self.recovery_core(ticket=self.value['run'])
        self.assertEqual(self.ns['recover_intent'](request)['run'], self.value['run'])
        self.assertEqual(writes, []); self.assertEqual(closed, [22, 10])
        changed = dict(self.value['run'], cgroupName='sakura-identity-' + BOOT)
        request, _, _ = self.recovery_core(ticket=changed)
        with self.assertRaises(RuntimeError): self.ns['recover_intent'](request)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `identity['uid']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `copy.deepcopy`, `self.ns.update`, `SimpleNamespace`, `self.assertEqual`.
    def test_first_prepare_uses_captured_source_boot_account_and_original_core_ex_lock(self):
        writes, locks, closed = [], [], []
        boot, identity = BOOT, copy.deepcopy(self.value['identity'])
        class Path(PurePosixPath):
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: path。
            # 结果：返回分支计算值（`boot`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`boot`); its implementation and call sites define the actual type.
            def read_text(path): return boot
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: account, request, current_boot, build。
        # 结果：返回分支计算值（`self.value['run']`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`self.value['run']`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `writes.append`.
        def prepare(account, request, current_boot, build):
            writes.append((account, request, current_boot, build))
            return self.value['run']
        core = {'initialize': lambda: (locks.append('EX'), 10)[1], 'registry': lambda readonly: {},
                'active': lambda *args: identity, 'prepare': prepare}
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: build。
        # 结果：返回分支计算值（`core`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`core`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `self.ns['require']`.
        def native(build):
            self.ns['require'](build == BUILD, 'SINGLE_APP_NATIVE_CHANGED')
            return core
        self.ns.update(Path=Path, native=native, os=SimpleNamespace(close=closed.append))
        request = {'id': RUN, 'identity': self.value['identity'], 'bootId': BOOT, 'nativeBuild': BUILD}
        self.assertEqual(self.ns['prepare_native'](request), self.value['run'])
        self.assertEqual(writes, [(identity, {'runId': RUN}, BOOT, BUILD)])
        self.assertEqual(locks, ['EX']); self.assertEqual(closed, [10])
        writes.clear(); locks.clear(); closed.clear()
        boot = RUN
        with self.assertRaises(RuntimeError): self.ns['prepare_native'](request)
        self.assertEqual(writes, []); self.assertEqual(locks, []); self.assertEqual(closed, [])
        boot = BOOT; identity['uid'] += 1
        with self.assertRaises(RuntimeError): self.ns['prepare_native'](request)
        self.assertEqual(writes, []); self.assertEqual(closed, [10])
        locks.clear(); closed.clear()
        with self.assertRaises(RuntimeError): self.ns['prepare_native']({**request, 'nativeBuild': 'b' * 64})
        self.assertEqual(writes, []); self.assertEqual(locks, []); self.assertEqual(closed, [])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.ns.update`, `SimpleNamespace`, `self.assertEqual`, `self.ns['stop']`.
    def test_empty_original_run_cleanup_does_not_lookup_expired_mount_namespace(self):
        writes, closed = [], []
        core = {'cgroup_fd': lambda run: 20, 'populated': lambda fd: False,
                'stop': lambda identity, run, boot: dict(run, phase='closed'),
                'network_fd': lambda *args: (30, SimpleNamespace(), ''), 'same': lambda *args: True}
        self.ns.update(context=lambda *args: (core, 10, self.value['run'], BOOT),
                       atomic=lambda path, item: writes.append(copy.deepcopy(item)), view_receipt=lambda *args: None,
                       members=lambda *args: self.fail('empty domain must not reopen a dead PID namespace'),
                       firewall_remove=lambda value: None, runtime_remove=lambda value: None,
                       ctypes=SimpleNamespace(CDLL=lambda *args, **kwargs: SimpleNamespace(setns=lambda *args: 0)),
                       os=SimpleNamespace(close=closed.append))
        self.assertEqual(self.ns['stop'](self.value, {})['state'], 'stopped')
        self.assertEqual(closed, [20, 30, 10]); self.assertEqual([item['state'] for item in writes], ['stopping', 'stopped'])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `set`, `self.ns.update`, `Path`, `SimpleNamespace`.
    def test_missing_guest_receipt_refuses_any_unknown_runtime_or_remaining_guest_resource(self):
        writes, closed = [], []
        core = {'cgroup_fd': lambda run: None, 'stop': lambda identity, run, boot: (writes.append(run), dict(run, phase='closed'))[1]}
        extant, contents = set(), []
        class Path(PurePosixPath):
            # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
            # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
            # 输入 / Inputs: path。
            # 结果：返回分支计算值（`iter(contents)`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`iter(contents)`); its implementation and call sites define the actual type.
            # 协作入口 / Collaborators: `iter`.
            def iterdir(path): return iter(contents)
        self.ns.update(Path=Path, BASE=Path('/var/lib/sakura/single-app-uid'), RUNTIME=Path('/run/sakura-single-app-uid'),
                       secure_directory=lambda path: path, context=lambda *args: (core, 10, self.value['run'], BOOT),
                       os=SimpleNamespace(path=SimpleNamespace(lexists=lambda path: str(path) in extant), close=closed.append))
        request = {'id': RUN, 'origin': self.value['origin']}
        for path in ['/run/sakura-single-app-uid/' + RUN, '/var/lib/sakura/single-app-uid/' + RUN + '/session.json']:
            extant.add(path)
            with self.subTest(path=path), self.assertRaises(RuntimeError): self.ns['stop_missing'](request)
            extant.clear()
        extant.add('/var/lib/sakura/single-app-uid/' + RUN); contents.append('unknown')
        with self.assertRaises(RuntimeError): self.ns['stop_missing'](request)
        self.assertEqual(writes, []); self.assertEqual(closed, [])
        contents.clear()
        self.assertEqual(self.ns['stop_missing'](request)['run']['phase'], 'closed')
        self.assertEqual(len(writes), 1); self.assertEqual(closed, [10])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.value['runtimeDevice']`, `self.ns['os']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `SimpleNamespace`, `self.assertRaises`, `self.ns['runtime_remove']`, `self.assertEqual`.
    def test_runtime_unknown_inode_is_never_guessed_or_removed(self):
        self.value['runtimeDevice'] = None
        removed = []
        self.ns['os'] = SimpleNamespace(path=SimpleNamespace(lexists=lambda path: True), unlink=lambda *args: removed.append(args))
        with self.assertRaises(RuntimeError): self.ns['runtime_remove'](self.value)
        self.assertEqual(removed, [])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `SimpleNamespace`, `self.ns.update`, `self.ns['runtime_check']`, `getattr`.
    def test_runtime_requires_original_inode_owner_group_and_private_mode(self):
        info = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=15000, st_gid=15000, st_dev=12, st_ino=13)
        class Path(PurePosixPath):
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: path。
            # 结果：返回分支计算值（`info`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`info`); its implementation and call sites define the actual type.
            def lstat(path): return info
        self.ns.update(Path=Path, secure_directory=lambda path: path)
        self.ns['runtime_check'](self.value)
        for field, replacement in [('st_uid', 0), ('st_gid', 20001), ('st_mode', stat.S_IFDIR | 0o755), ('st_ino', 14)]:
            original = getattr(info, field)
            setattr(info, field, replacement)
            with self.subTest(field=field), self.assertRaises(RuntimeError): self.ns['runtime_check'](self.value)
            setattr(info, field, original)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `''.join`, `SimpleNamespace`, `self.ns.update`, `self.ns['drop_account']`.
    def test_permanent_drop_sets_nnp_before_ids_and_checks_all_ids_groups_and_caps(self):
        calls = []
        status = 'Uid:\t15000 15000 15000 15000\nGid:\t15000 15000 15000 15000\nGroups:\t\nNoNewPrivs:\t1\n'
        status += ''.join(name + ':\t0\n' for name in ('CapInh', 'CapPrm', 'CapEff', 'CapAmb'))
        class Path(PurePosixPath):
            # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
            # English: Read or resolve observable model data for adapted production-definition calls or assertions.
            # 输入 / Inputs: path。
            # 结果：返回分支计算值（`status`），实际类型由实现及使用处约定。
            # Result: Return the branch-computed value (`status`); its implementation and call sites define the actual type.
            def read_text(path): return status
        libc = SimpleNamespace(prctl=lambda option, *args: (calls.append(('prctl', option)), 0)[1],
                               capset=lambda *args: (calls.append(('capset',)), 0)[1])
        self.ns.update(Path=Path, ctypes=SimpleNamespace(CDLL=lambda *args, **kwargs: libc,
                       c_uint32=ctypes.c_uint32, byref=ctypes.byref), os=SimpleNamespace(
                       setgroups=lambda groups: calls.append(('groups', groups)),
                       setresgid=lambda *ids: calls.append(('gid', ids)), setresuid=lambda *ids: calls.append(('uid', ids))))
        user = SimpleNamespace(pw_uid=15000, pw_gid=15000)
        self.ns['drop_account'](user)
        self.assertEqual(calls, [('prctl', 38), ('groups', []), ('gid', (15000,) * 3), ('uid', (15000,) * 3), ('capset',), ('prctl', 47)])
        for before, after in [('Uid:\t15000', 'Uid:\t0'), ('Gid:\t15000', 'Gid:\t0'),
                              ('Groups:\t\n', 'Groups:\t0\n'), ('CapAmb:\t0', 'CapAmb:\t1')]:
            original = status; status = status.replace(before, after)
            with self.subTest(field=before), self.assertRaises(RuntimeError): self.ns['drop_account'](user)
            status = original

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['os']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `SimpleNamespace`, `self.ns['seal_descriptors']`, `self.assertEqual`, `range`.
    def test_supervisor_reseals_all_passed_fds_before_root_receipt_or_child_exec(self):
        sealed = []
        self.ns['os'] = SimpleNamespace(set_inheritable=lambda fd, inherited: sealed.append((fd, inherited)))
        self.ns['seal_descriptors']([3, 4, 5, 6, 7, 8])
        self.assertEqual(sealed, [(fd, False) for fd in range(3, 9)])
        for descriptors in [[0, 4, 5, 6, 7, 8], [3, 3, 5, 6, 7, 8], [3, 4, 5, 6, 7], [True, 4, 5, 6, 7, 8]]:
            sealed.clear()
            with self.subTest(descriptors=descriptors), self.assertRaises(RuntimeError): self.ns['seal_descriptors'](descriptors)
            self.assertEqual(sealed, [])
        tree = ast.parse(SOURCE.read_text(encoding='utf8'))
        supervisor = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'supervise')
        self.assertEqual(supervisor.body[0].value.func.id, 'seal_descriptors')

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `json.dumps({'id': RUN, 'origin': self.value['origin']}).encode`, `json.dumps`, `self.ns.update`, `SimpleNamespace`.
    def test_readonly_status_main_opens_existing_lock_without_create_or_mkdir(self):
        flags, creates, closed, output = [], [], [], []
        request = json.dumps({'id': RUN, 'origin': self.value['origin']}).encode()
        self.ns.update(sys=SimpleNamespace(argv=['controller.py', 'status'], stdin=SimpleNamespace(buffer=SimpleNamespace(read=lambda limit: request))),
                       os=SimpleNamespace(environ={}, getuid=lambda: 0, O_RDONLY=1, O_WRONLY=2, O_CREAT=4, O_NOFOLLOW=8, O_CLOEXEC=16,
                          open=lambda path, flag, mode: (flags.append(flag), 10)[1],
                          fstat=lambda fd: SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_nlink=1), close=closed.append),
                       fcntl=SimpleNamespace(flock=lambda *args: None, LOCK_SH=1, LOCK_EX=2),
                       load_package=lambda: {}, secure_directory=lambda path, create: creates.append(create),
                       read_receipt=lambda *args: self.value, inspect=lambda *args: {'state': 'stopped'}, print=output.append)
        self.ns['main']()
        self.assertEqual(flags, [1 | 8 | 16]); self.assertEqual(creates, [False]); self.assertEqual(closed, [10])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['os']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `SimpleNamespace`, `self.assertRaises`, `self.ns['image_descriptor']`, `self.assertEqual`.
    def test_image_growing_during_digest_stops_at_original_size(self):
        info = SimpleNamespace(st_mode=stat.S_IFREG | 0o755, st_size=2, st_dev=1, st_ino=2, st_mtime_ns=3, st_ctime_ns=4)
        reads = []
        self.ns['os'] = SimpleNamespace(fstat=lambda fd: info, getxattr=lambda *args: b'',
            pread=lambda fd, amount, offset: (reads.append(offset), b'x' * 3)[1])
        with self.assertRaises(RuntimeError): self.ns['image_descriptor'](10, '/project/elf')
        self.assertEqual(reads, [0])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['os']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `SimpleNamespace`, `vars`, `iter`, `self.assertRaises`.
    def test_image_mode_setid_change_during_read_is_rejected(self):
        before = SimpleNamespace(st_mode=stat.S_IFREG | 0o755, st_size=1, st_dev=1, st_ino=2, st_mtime_ns=3, st_ctime_ns=4)
        after = SimpleNamespace(**{**vars(before), 'st_mode': stat.S_IFREG | 0o4755})
        states = iter([before, after])
        self.ns['os'] = SimpleNamespace(fstat=lambda fd: next(states), getxattr=lambda *args: b'',
            pread=lambda fd, amount, offset: b'x' if offset == 0 else b'')
        with self.assertRaises(RuntimeError): self.ns['image_descriptor'](10, '/project/elf')

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.ns.update`, `SimpleNamespace`, `self.assertRaises`, `self.ns['pinned_execute']`.
    def test_executable_uses_same_hashed_mapped_fd_and_preserves_multicall_argv0(self):
        expected = self.value['tools']['vnc']; opened, hashed, executed, closed = [], [], [], []
        class Executed(BaseException): pass
        # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
        # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
        # 输入 / Inputs: fd, argv, environment。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 失败 / Failure: `Executed()`；由调用者或用例断言观察 / Observed by callers or case assertions.
        # 协作入口 / Collaborators: `executed.append`, `Executed`.
        def execve(fd, argv, environment): executed.append((fd, argv)); raise Executed()
        self.ns.update(os=SimpleNamespace(O_RDONLY=1, O_NOFOLLOW=2, O_CLOEXEC=4,
          open=lambda path, flags: (opened.append((path, flags)), 10)[1], pread=lambda *args: b'\x7fELF',
          set_inheritable=lambda fd, value: self.assertFalse(value), execve=execve, close=closed.append),
          image_descriptor=lambda fd, path, privileged: (hashed.append(fd), {key: item for key, item in expected.items() if key != 'command'})[1])
        with self.assertRaises(Executed): self.ns['pinned_execute'](expected, ['-version'], {}, True)
        self.assertEqual(hashed, [10]); self.assertEqual(executed, [(10, ['/usr/bin/Xvnc', '-version'])]); self.assertEqual(closed, [10])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.ns['time']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `SimpleNamespace`, `iter`, `self.ns.update`, `self.subTest`.
    def test_private_ready_pipe_rejects_eof_cancel_oversize_and_timeout(self):
        self.ns['time'] = SimpleNamespace(monotonic=lambda: 1)
        for chunks, selected, limit in [([b''], True, 1), ([b'xx'], True, 1), ([b'1'], False, 1)]:
            blocks = iter(chunks)
            self.ns.update(select=SimpleNamespace(select=lambda *args: ([10] if selected else [], [], [])),
                           os=SimpleNamespace(read=lambda *args: next(blocks)))
            with self.subTest(chunks=chunks, selected=selected):
                if chunks == [b''] and selected:
                    self.assertEqual(self.ns['private_input'](10, limit), b'')
                else:
                    with self.assertRaises(RuntimeError): self.ns['private_input'](10, limit)

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, lines, checked = ()。
    # 结果：返回分支计算值（`calls`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`calls`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.ns['root_tool']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.value['tools'].update`.
    def firewall_model(self, lines, checked=()):
        calls = []
        self.value['tools'].update(ipv4={'path': 'ipv4'}, ipv6={'path': 'ipv6'})
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: expected, args, check = True。
        # 结果：返回分支计算值（`SimpleNamespace(returncode=0, stdout=('\n'.join(lines) + '\n').encode()) / SimpleNamespace(returncode=0 if args[2] != 'OUTPUT' or 'attached' in checked else 1)`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`SimpleNamespace(returncode=0, stdout=('\n'.join(lines) + '\n').encode()) / SimpleNamespace(returncode=0 if args[2] != 'OUTPUT' or 'attached' in checked else 1)`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `calls.append`, `SimpleNamespace`, `('\n'.join(lines) + '\n').encode`, `'\n'.join`.
        def tool(expected, args, check=True):
            calls.append(args)
            if args[1] == '-S' and args[2] != 'OUTPUT':
                return SimpleNamespace(returncode=0, stdout=('\n'.join(lines) + '\n').encode())
            if args[1] == '-C': return SimpleNamespace(returncode=0 if args[2] != 'OUTPUT' or 'attached' in checked else 1)
            return SimpleNamespace(returncode=0, stdout=b'')
        self.ns['root_tool'] = tool
        return calls

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.ns['firewall_spec']`, `self.firewall_model`, `self.ns['firewall_validate']`, `self.assertTrue`.
    def test_partial_owned_firewall_allows_cleanup_but_unknown_rules_are_retained(self):
        chain, _, _ = self.ns['firewall_spec'](self.value, 'ipv4')
        calls = self.firewall_model(['-N ' + chain, '-A ' + chain + ' -p tcp --dport 5910 -j RETURN'])
        self.ns['firewall_validate'](self.value, partial=True)
        self.assertTrue(calls)
        self.firewall_model(['-N foreign'])
        with self.assertRaises(RuntimeError): self.ns['firewall_validate'](self.value, partial=True)
        self.firewall_model(['-N ' + chain, '-A unknown', '-A unknown', '-A unexpected'])
        with self.assertRaises(RuntimeError): self.ns['firewall_validate'](self.value, partial=True)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.value['directoryView']`, `self.value['processes']`, `self.value['processes']['application']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.ns.update`, `SimpleNamespace`, `self.assertEqual`, `self.ns['inspect']`.
    def test_vnc_without_successful_application_and_wm_exec_is_not_running(self):
        core = {'cgroup_fd': lambda run: 20, 'populated': lambda fd: True, 'check_run': lambda *args: None,
                'active': lambda *args: self.value['identity'], 'registry': lambda *args: {},
                'network_fd': lambda *args: (30, SimpleNamespace(), ''), 'same': lambda *args: True}
        rows = [{'pid': 10, 'created': '11', 'image': '/usr/bin/xterm', 'device': '8', 'inode': '9'}]
        self.ns.update(context=lambda *args: (core, 10, self.value['run'], BOOT),
          view_receipt=lambda *args: None, account=lambda *args: None, runtime_check=lambda *args: None, firewall_validate=lambda *args: None,
          members=lambda *args: rows, endpoint=lambda *args: {'pid': 20}, os=SimpleNamespace(close=lambda *args: None),
          ctypes=SimpleNamespace(CDLL=lambda *args, **kwargs: SimpleNamespace(setns=lambda *args: 0)))
        self.value['directoryView'] = {}
        self.assertEqual(self.ns['inspect'](self.value, {})['state'], 'starting')
        self.value['processes'] = {'application': rows[0], 'wm': rows[0]}
        self.assertEqual(self.ns['inspect'](self.value, {})['state'], 'running')
        self.value['processes']['application'] = dict(rows[0], created='99')
        self.assertEqual(self.ns['inspect'](self.value, {})['state'], 'starting')


if __name__ == '__main__':
    unittest.main()
