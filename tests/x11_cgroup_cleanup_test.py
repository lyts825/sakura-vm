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


class Group:
    def __init__(self, processes="", removal_errors=()):
        self.procs = Mock()
        if isinstance(processes, list):
            self.procs.read_text.side_effect = processes
        else:
            self.procs.read_text.return_value = processes
        self.kill = Mock()
        self.kill.exists.return_value = True
        self.rmdir = Mock(side_effect=[*removal_errors, None])
        self.exists = Mock(return_value=True)

    def __truediv__(self, name):
        return {"cgroup.procs": self.procs, "cgroup.kill": self.kill}[name]


class CgroupCleanupTests(unittest.TestCase):
    def setUp(self):
        self.elapsed = 0
        self.monotonic = patch.object(controller.time, "monotonic", lambda: self.elapsed)
        self.sleep = patch.object(controller.time, "sleep", self.advance)
        self.monotonic.start()
        self.sleep.start()
        self.addCleanup(self.monotonic.stop)
        self.addCleanup(self.sleep.stop)

    def advance(self, seconds):
        self.elapsed += seconds

    def test_retries_busy_and_not_empty_after_processes_exit(self):
        group = Group(removal_errors=[OSError(errno.EBUSY, "busy"), OSError(errno.ENOTEMPTY, "not empty")])
        controller.remove_stopped_cgroup(group)
        self.assertEqual(group.rmdir.call_count, 3)
        self.assertAlmostEqual(self.elapsed, .1)

    def test_waits_for_processes_without_attempting_removal(self):
        group = Group(processes=["12\n", "12\n", ""])
        controller.remove_stopped_cgroup(group)
        group.rmdir.assert_called_once_with()
        self.assertEqual(group.procs.read_text.call_count, 3)

    def test_busy_cleanup_has_bounded_timeout(self):
        group = Group()
        group.rmdir.side_effect = OSError(errno.EBUSY, "busy")
        with self.assertRaisesRegex(RuntimeError, "未能清理"):
            controller.remove_stopped_cgroup(group)
        self.assertGreaterEqual(self.elapsed, 5)
        self.assertLess(self.elapsed, 5.1)

    def test_permission_failure_is_not_retried(self):
        group = Group(removal_errors=[PermissionError(errno.EACCES, "denied")])
        with self.assertRaises(PermissionError):
            controller.remove_stopped_cgroup(group)
        group.rmdir.assert_called_once_with()
        self.assertEqual(self.elapsed, 0)

    def test_already_removed_group_is_successful(self):
        group = Group()
        group.procs.read_text.side_effect = FileNotFoundError()
        group.exists.return_value = False
        controller.remove_stopped_cgroup(group)
        group.rmdir.assert_not_called()

    def test_missing_procs_of_existing_group_is_not_hidden(self):
        group = Group()
        group.procs.read_text.side_effect = FileNotFoundError()
        with self.assertRaises(FileNotFoundError):
            controller.remove_stopped_cgroup(group)

    def test_stop_of_empty_group_waits_for_kernel_release(self):
        group = Group(removal_errors=[OSError(errno.EBUSY, "busy")])
        with patch.object(controller, "metadata", return_value={"id": "owned", "uid": 1000}), \
             patch.object(controller, "cgroup_path", return_value=group), \
             patch.object(controller, "secure_directory"):
            self.assertEqual(controller.stop(Path("/owned"), "owner"), {"stopped": True})
        group.kill.write_text.assert_not_called()
        self.assertEqual(group.rmdir.call_count, 2)

    def test_stop_rejects_another_users_process_before_kill(self):
        group = Group(processes="12\n")
        with patch.object(controller, "metadata", return_value={"id": "owned", "uid": 1000}), \
             patch.object(controller, "cgroup_path", return_value=group), \
             patch.object(controller, "secure_directory"), \
             patch.object(controller, "process", return_value={"uid": 1001}):
            with self.assertRaisesRegex(RuntimeError, "其他用户"):
                controller.stop(Path("/owned"), "owner")
        group.kill.write_text.assert_not_called()
        group.rmdir.assert_not_called()


if __name__ == "__main__":
    unittest.main()
