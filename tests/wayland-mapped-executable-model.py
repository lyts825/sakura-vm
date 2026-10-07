# 模块职责：使用两个不同挂载视图验证随包应用引导中的可执行文件映射，控制路径与描述符证据。
# Module: Use two distinct mount views to exercise packaged application bootstrap executable mappings with controlled path and descriptor evidence.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
# 可移植边界模型：通过受控适配器验证生产流程；真实系统权限与进程隔离需另行运行 Linux 验证。
# 覆盖：test_owner_only_elf_uses_mapped_fd_and_closes_original_before_application
# 覆盖：test_different_device_or_inode_cannot_replace_pinned_image
# 覆盖：test_digest_mismatch_closes_both_fds_without_execution
"""Exercise the packaged application bootstrap with two distinct mount views."""
import ast
import copy
import errno
import hashlib
import os
from pathlib import Path
import stat
import sys
import types
import unittest
from unittest.mock import patch


CONTROLLER = Path(__file__).resolve().parents[1] / 'native/wayland-clipboard/controller.py'
TREE = ast.parse(CONTROLLER.read_text(encoding='utf-8'))
SOURCE = ast.literal_eval(next(node.value for node in TREE.body if isinstance(node, ast.Assign)
                              and any(isinstance(target, ast.Name) and target.id == 'APPLICATION_EXEC_SOURCE'
                                      for target in node.targets)))


class Executed(BaseException):
    pass


class Kernel:
    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.content`, `self.info`, `self.actual`, `self.actual.st_uid`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `types.SimpleNamespace`, `len`, `copy.copy`, `types.ModuleType`.
    def __init__(self):
        self.original, self.mapped = 31, 37
        self.content = b'\x7fELF owned executable bytes'
        self.info = types.SimpleNamespace(st_dev=7, st_ino=501, st_mode=stat.S_IFREG | 0o700,
                                         st_size=len(self.content), st_mtime_ns=1234, st_ctime_ns=1234,
                                         st_uid=20001, st_gid=20001)
        self.actual = copy.copy(self.info)
        self.actual.st_uid = self.actual.st_gid = 15000
        self.source_after, self.mapped_after = None, None
        self.offset, self.reading = 0, False
        self.closed, self.executions, self.inheritable = [], [], {}
        self.open_error, self.capabilities = None, b''
        self.api = types.ModuleType('os')
        self.api.__dict__.update(os.__dict__)
        # This model also runs on Windows; these are Linux open(2) flag values.
        self.api.O_NOFOLLOW = getattr(os, 'O_NOFOLLOW', 0x20000)
        self.api.O_CLOEXEC = getattr(os, 'O_CLOEXEC', 0x80000)
        for name in ('open', 'fstat', 'read', 'close', 'set_inheritable', 'execve', 'getxattr'):
            setattr(self.api, name, getattr(self, name))
        self.api.supports_fd = {self.api.execve}
        self.api.environ = {'HOME': '/home/owned-sandbox', 'EXACT_VALUE': 'literal $(not code)'}

    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: self, path, flags。
    # 结果：返回分支计算值（`self.mapped`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.mapped`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.opened`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 失败 / Failure: `self.open_error`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 检查边界 / Checked boundaries: `path == '/private/project/program'`; `flags == self.api.O_RDONLY | self.api.O_NOFOLLOW | self.api.O_CLOEXEC`.
    def open(self, path, flags):
        self.opened = (path, flags)
        if self.open_error is not None:
            raise self.open_error
        assert path == '/private/project/program'
        assert flags == self.api.O_RDONLY | self.api.O_NOFOLLOW | self.api.O_CLOEXEC
        return self.mapped

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, descriptor。
    # 结果：返回分支计算值（`self.source_after if self.reading and self.source_after is not None else self.info / self.mapped_after if self.reading and self.mapped_after is not None else self.actual`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.source_after if self.reading and self.source_after is not None else self.info / self.mapped_after if self.reading and self.mapped_after is not None else self.actual`); its implementation and call sites define the actual type.
    # 检查边界 / Checked boundaries: `descriptor not in self.closed`; `descriptor == self.mapped`.
    def fstat(self, descriptor):
        assert descriptor not in self.closed
        if descriptor == self.original:
            return self.source_after if self.reading and self.source_after is not None else self.info
        assert descriptor == self.mapped
        return self.mapped_after if self.reading and self.mapped_after is not None else self.actual

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, descriptor, size。
    # 结果：返回分支计算值（`data`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`data`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.reading`, `self.offset`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `len`.
    # 检查边界 / Checked boundaries: `descriptor == self.mapped and descriptor not in self.closed`.
    def read(self, descriptor, size):
        assert descriptor == self.mapped and descriptor not in self.closed
        self.reading = True
        data = self.content[self.offset:self.offset+size]
        self.offset += len(data)
        return data

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, descriptor, name。
    # 结果：返回分支计算值（`self.capabilities`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.capabilities`); its implementation and call sites define the actual type.
    # 检查边界 / Checked boundaries: `descriptor == self.mapped and name == 'security.capability'`.
    def getxattr(self, descriptor, name):
        assert descriptor == self.mapped and name == 'security.capability'
        return self.capabilities

    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self, descriptor。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.closed.append`.
    # 检查边界 / Checked boundaries: `descriptor in (self.original, self.mapped) and descriptor not in self.closed`.
    def close(self, descriptor):
        assert descriptor in (self.original, self.mapped) and descriptor not in self.closed
        self.closed.append(descriptor)

    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, descriptor, value。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.inheritable[descriptor]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 检查边界 / Checked boundaries: `descriptor == self.mapped and value is False`.
    def set_inheritable(self, descriptor, value):
        assert descriptor == self.mapped and value is False
        self.inheritable[descriptor] = value

    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: self, descriptor, args, environment。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `Executed()`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.executions.append`, `Executed`.
    # 检查边界 / Checked boundaries: `self.original in self.closed and descriptor == self.mapped and (descriptor not in self.closed)`; `self.inheritable[descriptor] is False`.
    def execve(self, descriptor, args, environment):
        assert self.original in self.closed and descriptor == self.mapped and descriptor not in self.closed
        assert self.inheritable[descriptor] is False
        self.executions.append((descriptor, args, environment))
        raise Executed()

    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: self, expected = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `str`, `hashlib.sha256(self.content).hexdigest`, `hashlib.sha256`, `patch.dict`.
    def run(self, expected=None):
        argv = ['fixed-bootstrap', str(self.original), expected or hashlib.sha256(self.content).hexdigest(),
                '/private/project/program', 'literal value', '雪', '$(not code)']
        with patch.dict(sys.modules, {'os': self.api}), patch.object(sys, 'argv', argv):
            exec(compile(SOURCE, '<packaged mapped ELF bootstrap>', 'exec'), {})


class Tests(unittest.TestCase):
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, kernel。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.assertRaises`, `kernel.run`, `self.assertFalse`, `self.assertIn`.
    def refusal(self, kernel):
        with self.assertRaises((AssertionError, OSError)):
            kernel.run()
        self.assertFalse(kernel.executions)
        self.assertIn(kernel.original, kernel.closed)
        if kernel.open_error is None:
            self.assertIn(kernel.mapped, kernel.closed)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `Kernel`, `self.assertRaises`, `k.run`, `self.assertEqual`.
    def test_owner_only_elf_uses_mapped_fd_and_closes_original_before_application(self):
        k = Kernel()
        with self.assertRaises(Executed):
            k.run()
        self.assertEqual(k.executions, [(k.mapped, ['/private/project/program', 'literal value', '雪', '$(not code)'],
                                        k.api.environ)])
        self.assertEqual(k.closed, [k.original, k.mapped])
        self.assertNotEqual(k.info.st_uid, k.actual.st_uid)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `Kernel`, `setattr`, `getattr`, `self.subTest`.
    def test_different_device_or_inode_cannot_replace_pinned_image(self):
        for field in ('st_dev', 'st_ino'):
            k = Kernel(); setattr(k.actual, field, getattr(k.actual, field) + 1)
            with self.subTest(field=field): self.refusal(k)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `Kernel`, `self.assertRaises`, `k.run`, `self.assertFalse`.
    def test_digest_mismatch_closes_both_fds_without_execution(self):
        k = Kernel()
        with self.assertRaises(AssertionError): k.run('0' * 64)
        self.assertFalse(k.executions); self.assertEqual(k.closed, [k.original, k.mapped])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `Kernel`, `setattr`, `getattr`, `self.subTest`.
    def test_mode_and_content_metadata_must_match_original_mount_view(self):
        for field in ('st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns'):
            k = Kernel(); setattr(k.actual, field, getattr(k.actual, field) + 1)
            with self.subTest(field=field): self.refusal(k)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `Kernel`, `copy.copy`, `setattr`, `getattr`.
    def test_changed_mapped_or_original_inode_during_hashing_refuses(self):
        for field in ('st_dev', 'st_ino', 'st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns'):
            for mount in ('source_after', 'mapped_after'):
                k = Kernel(); changed = copy.copy(k.info if mount == 'source_after' else k.actual)
                setattr(changed, field, getattr(changed, field) + 1); setattr(k, mount, changed)
                with self.subTest(field=field, mount=mount): self.refusal(k)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `k.content`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `self.refusal`, `self.assertLessEqual`.
    def test_growth_is_bounded_by_original_file_size(self):
        k = Kernel(); k.content += b'changed after open'
        self.refusal(k); self.assertLessEqual(k.offset, 1048576)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `k.info.st_mode`, `k.actual.st_mode`, `k.capabilities`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `self.subTest`, `self.refusal`.
    def test_setid_capabilities_and_nonregular_images_are_refused(self):
        for mode in (stat.S_IFREG | 0o4700, stat.S_IFREG | 0o2700, stat.S_IFDIR | 0o700):
            k = Kernel(); k.info.st_mode = k.actual.st_mode = mode
            with self.subTest(mode=mode): self.refusal(k)
        k = Kernel(); k.capabilities = b'file capabilities'
        self.refusal(k)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `k.open_error`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `PermissionError`, `self.refusal`, `self.assertEqual`.
    def test_permission_refusal_closes_the_original_root_opened_fd(self):
        k = Kernel(); k.open_error = PermissionError(errno.EACCES, 'mapped image not accessible')
        self.refusal(k); self.assertEqual(k.closed, [k.original])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `k.api.supports_fd`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Kernel`, `set`, `self.assertRaises`, `k.run`.
    def test_unsupported_fd_execution_never_falls_back_to_path_execution(self):
        k = Kernel(); k.api.supports_fd = set()
        with self.assertRaises(AssertionError): k.run()
        self.assertFalse(k.executions); self.assertEqual(k.closed, [k.original])


if __name__ == '__main__':
    unittest.main()
