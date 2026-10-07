# 模块职责：X11 运行清理回归，核对 cgroup 成员、原运行证据以及终止和释放顺序。
# Module: X11-run cleanup regressions checking cgroup membership, original-run evidence and termination/release ordering.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
import errno
import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location(
    "sakura_x11_controller",
    Path(__file__).resolve().parents[1] / "native/linux-clipboard/controller.py",
)
controller = importlib.util.module_from_spec(spec)
platform_modules = {name: types.ModuleType(name) for name in ("pwd", "fcntl")} if os.name == "nt" else {}
with patch.dict(sys.modules, platform_modules):
    spec.loader.exec_module(controller)


class CgroupCleanupTests(unittest.TestCase):
    # 中文功能：准备本用例的独立目录与状态，使用例之间的输入和失败注入相互隔离。
    # English: Prepare a private directory and state for this case so inputs and injected failures are isolated between cases.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.elapsed`, `self.members`, `self.events`, `self.group`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Mock`, `types.SimpleNamespace`, `getattr`, `iter`.
    def setUp(self):
        self.elapsed = 0
        self.members = b""
        self.events = [b"populated 0\n"]
        self.group = Mock(name="original-domain")
        self.group.name = "sakura-clipboard-original"
        self.group.rmdir.side_effect = [None]
        self.value = {"bootId": "original-boot", "cgroup": {"device": "29", "inode": "999"}}
        self.descriptors = {}
        self.next_fd = 100
        self.platform_os = types.SimpleNamespace(
            O_RDONLY=os.O_RDONLY, O_WRONLY=os.O_WRONLY,
            O_NOFOLLOW=getattr(os, "O_NOFOLLOW", 0), O_CLOEXEC=getattr(os, "O_CLOEXEC", 0),
            open=Mock(side_effect=self.open), read=Mock(side_effect=self.read), write=Mock(), close=Mock(),
        )
        domains = iter([42, *range(1000, 1300)])
        self.domain = Mock(side_effect=lambda *_args: next(domains))
        for target, replacement in (
            ("os", self.platform_os), ("application_group", self.domain),
            ("process", Mock(return_value={"uid": 1000, "network": "net:[100]", "created": "77"})),
        ):
            override = patch.object(controller, target, replacement)
            override.start()
            self.addCleanup(override.stop)
        for target, replacement in (("monotonic", lambda: self.elapsed), ("sleep", self.advance)):
            override = patch.object(controller.time, target, replacement)
            override.start()
            self.addCleanup(override.stop)

    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: self, name, flags, dir_fd。
    # 结果：返回分支计算值（`self.next_fd`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.next_fd`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.next_fd`, `self.descriptors[self.next_fd]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.assertEqual`.
    def open(self, name, flags, *, dir_fd):
        self.assertEqual(dir_fd, 42, "reads and kill must use the original pinned domain")
        self.next_fd += 1
        self.descriptors[self.next_fd] = name
        return self.next_fd

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, fd, _maximum。
    # 结果：返回分支计算值（`self.members / self.events.pop(0) if len(self.events) > 1 else self.events[0]`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.members / self.events.pop(0) if len(self.events) > 1 else self.events[0]`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.assertEqual`, `len`, `self.events.pop`.
    def read(self, fd, _maximum):
        name = self.descriptors[fd]
        if name == "cgroup.procs":
            return self.members
        self.assertEqual(name, "cgroup.events")
        return self.events.pop(0) if len(self.events) > 1 else self.events[0]

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, seconds。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.elapsed`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def advance(self, seconds):
        self.elapsed += seconds

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `controller.application_retire`.
    def retire(self):
        controller.application_retire(self.group, self.value, 1000, "net:[100]")

    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.assertEqual`, `self.platform_os.close.call_args_list.count`, `call`.
    def assert_original_closed(self):
        from unittest.mock import call
        self.assertEqual(self.platform_os.close.call_args_list.count(call(42)), 1)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.group.rmdir.side_effect`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `OSError`, `self.retire`, `self.assertEqual`, `self.assertAlmostEqual`.
    def test_retries_busy_and_not_empty_after_kernel_domain_is_empty(self):
        self.group.rmdir.side_effect = [OSError(errno.EBUSY, "busy"), OSError(errno.ENOTEMPTY, "not empty"), None]
        self.retire()
        self.assertEqual(self.group.rmdir.call_count, 3)
        self.assertAlmostEqual(self.elapsed, .1)
        self.platform_os.write.assert_not_called()
        self.assert_original_closed()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.events`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.retire`, `self.group.rmdir.assert_called_once_with`, `self.assertAlmostEqual`, `self.assertEqual`.
    def test_descendants_keep_the_domain_until_kernel_reports_empty(self):
        self.events = [b"populated 1\n", b"populated 1\n", b"populated 1\n", b"populated 0\n"]
        self.retire()
        self.group.rmdir.assert_called_once_with()
        self.assertAlmostEqual(self.elapsed, .1)
        self.assertEqual(self.platform_os.write.call_count, 1)
        fd, raw = self.platform_os.write.call_args.args
        self.assertEqual(self.descriptors[fd], "cgroup.kill")
        self.assertEqual(raw, b"1")
        self.assert_original_closed()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.group.rmdir.side_effect`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `OSError`, `self.assertRaisesRegex`, `self.retire`, `self.assertGreaterEqual`.
    def test_busy_cleanup_has_bounded_timeout(self):
        self.group.rmdir.side_effect = OSError(errno.EBUSY, "busy")
        with self.assertRaisesRegex(RuntimeError, "未能退休"):
            self.retire()
        self.assertGreaterEqual(self.elapsed, 5)
        self.assertLess(self.elapsed, 5.1)
        self.assert_original_closed()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.events`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.assertRaisesRegex`, `self.retire`, `self.group.rmdir.assert_not_called`, `self.assertGreaterEqual`.
    def test_descendant_cleanup_timeout_preserves_the_original_ticket(self):
        self.events = [b"populated 1\n"]
        with self.assertRaisesRegex(RuntimeError, "仍有后代"):
            self.retire()
        self.group.rmdir.assert_not_called()
        self.assertGreaterEqual(self.elapsed, 5)
        self.assertEqual(self.value["cgroup"], {"device": "29", "inode": "999"})
        self.assert_original_closed()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.group.rmdir.side_effect`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `PermissionError`, `self.assertRaises`, `self.retire`, `self.group.rmdir.assert_called_once_with`.
    def test_permission_failure_is_not_retried(self):
        self.group.rmdir.side_effect = PermissionError(errno.EACCES, "denied")
        with self.assertRaises(PermissionError):
            self.retire()
        self.group.rmdir.assert_called_once_with()
        self.assertEqual(self.elapsed, 0)
        self.assert_original_closed()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.domain.side_effect`, `self.domain.return_value`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.retire`, `self.group.rmdir.assert_not_called`, `self.platform_os.open.assert_not_called`, `self.platform_os.close.assert_not_called`.
    def test_already_removed_original_group_is_successful(self):
        self.domain.side_effect = None
        self.domain.return_value = None
        self.retire()
        self.group.rmdir.assert_not_called()
        self.platform_os.open.assert_not_called()
        self.platform_os.close.assert_not_called()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.platform_os.read.side_effect`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `FileNotFoundError`, `self.assertRaises`, `self.retire`, `self.group.rmdir.assert_not_called`.
    def test_missing_kernel_state_of_a_pinned_group_is_not_hidden(self):
        self.platform_os.read.side_effect = FileNotFoundError("original kernel state vanished")
        with self.assertRaises(FileNotFoundError):
            self.retire()
        self.group.rmdir.assert_not_called()
        self.platform_os.write.assert_not_called()
        self.assert_original_closed()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.events`, `self.domain.side_effect`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `RuntimeError`, `self.assertRaisesRegex`, `self.retire`, `self.platform_os.write.assert_not_called`.
    def test_replacement_domain_before_kill_is_never_signalled(self):
        self.events = [b"populated 1\n"]
        self.domain.side_effect = [42, RuntimeError("原 cgroup inode 已变化")]
        with self.assertRaisesRegex(RuntimeError, "inode 已变化"):
            self.retire()
        self.platform_os.write.assert_not_called()
        self.group.rmdir.assert_not_called()
        self.assert_original_closed()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.domain.side_effect`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.retire`, `self.group.rmdir.assert_not_called`, `self.platform_os.write.assert_not_called`, `self.assert_original_closed`.
    def test_original_domain_disappearing_after_empty_state_does_not_remove_a_path(self):
        self.domain.side_effect = [42, None]
        self.retire()
        self.group.rmdir.assert_not_called()
        self.platform_os.write.assert_not_called()
        self.assert_original_closed()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `patch.object`, `self.assertEqual`, `controller.stop`, `Path`.
    def test_stop_uses_the_saved_uid_network_and_full_domain_ticket(self):
        value = {"id": "owned", "uid": 1000, "network": "net:[100]", **self.value}
        with patch.object(controller, "metadata", return_value=value), \
             patch.object(controller, "cgroup_path", return_value=self.group):
            self.assertEqual(controller.stop(Path("/owned"), "owner"), {"stopped": True})
        self.domain.assert_called_with(self.group, value, "cgroup")
        self.group.rmdir.assert_called_once_with()
        self.assert_original_closed()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.members`, `controller.process.return_value`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.assertRaisesRegex`, `self.retire`, `self.platform_os.write.assert_not_called`, `self.group.rmdir.assert_not_called`.
    def test_stop_rejects_another_users_process_before_kill(self):
        self.members = b"12\n"
        controller.process.return_value = {"uid": 1001, "network": "net:[100]", "created": "77"}
        with self.assertRaisesRegex(RuntimeError, "原执行 UID"):
            self.retire()
        self.platform_os.write.assert_not_called()
        self.group.rmdir.assert_not_called()
        self.assert_original_closed()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.members`, `controller.process.side_effect`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `patch.object`, `self.assertRaisesRegex`, `self.retire`, `self.platform_os.write.assert_not_called`.
    def test_pid_reuse_before_kill_preserves_the_domain(self):
        self.members = b"12\n"
        controller.process.side_effect = [
            {"uid": 1000, "network": "net:[100]", "created": "77"},
            {"uid": 1000, "network": "net:[100]", "created": "78"},
        ]
        with patch.object(Path, "read_text", return_value="0::/" + self.group.name + "\n"):
            with self.assertRaisesRegex(RuntimeError, "PID 证明已改变"):
                self.retire()
        self.platform_os.write.assert_not_called()
        self.group.rmdir.assert_not_called()
        self.assert_original_closed()


if __name__ == "__main__":
    unittest.main()
