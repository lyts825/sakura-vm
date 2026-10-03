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

    def open(self, name, flags, *, dir_fd):
        self.assertEqual(dir_fd, 42, "reads and kill must use the original pinned domain")
        self.next_fd += 1
        self.descriptors[self.next_fd] = name
        return self.next_fd

    def read(self, fd, _maximum):
        name = self.descriptors[fd]
        if name == "cgroup.procs":
            return self.members
        self.assertEqual(name, "cgroup.events")
        return self.events.pop(0) if len(self.events) > 1 else self.events[0]

    def advance(self, seconds):
        self.elapsed += seconds

    def retire(self):
        controller.application_retire(self.group, self.value, 1000, "net:[100]")

    def assert_original_closed(self):
        from unittest.mock import call
        self.assertEqual(self.platform_os.close.call_args_list.count(call(42)), 1)

    def test_retries_busy_and_not_empty_after_kernel_domain_is_empty(self):
        self.group.rmdir.side_effect = [OSError(errno.EBUSY, "busy"), OSError(errno.ENOTEMPTY, "not empty"), None]
        self.retire()
        self.assertEqual(self.group.rmdir.call_count, 3)
        self.assertAlmostEqual(self.elapsed, .1)
        self.platform_os.write.assert_not_called()
        self.assert_original_closed()

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

    def test_busy_cleanup_has_bounded_timeout(self):
        self.group.rmdir.side_effect = OSError(errno.EBUSY, "busy")
        with self.assertRaisesRegex(RuntimeError, "未能退休"):
            self.retire()
        self.assertGreaterEqual(self.elapsed, 5)
        self.assertLess(self.elapsed, 5.1)
        self.assert_original_closed()

    def test_descendant_cleanup_timeout_preserves_the_original_ticket(self):
        self.events = [b"populated 1\n"]
        with self.assertRaisesRegex(RuntimeError, "仍有后代"):
            self.retire()
        self.group.rmdir.assert_not_called()
        self.assertGreaterEqual(self.elapsed, 5)
        self.assertEqual(self.value["cgroup"], {"device": "29", "inode": "999"})
        self.assert_original_closed()

    def test_permission_failure_is_not_retried(self):
        self.group.rmdir.side_effect = PermissionError(errno.EACCES, "denied")
        with self.assertRaises(PermissionError):
            self.retire()
        self.group.rmdir.assert_called_once_with()
        self.assertEqual(self.elapsed, 0)
        self.assert_original_closed()

    def test_already_removed_original_group_is_successful(self):
        self.domain.side_effect = None
        self.domain.return_value = None
        self.retire()
        self.group.rmdir.assert_not_called()
        self.platform_os.open.assert_not_called()
        self.platform_os.close.assert_not_called()

    def test_missing_kernel_state_of_a_pinned_group_is_not_hidden(self):
        self.platform_os.read.side_effect = FileNotFoundError("original kernel state vanished")
        with self.assertRaises(FileNotFoundError):
            self.retire()
        self.group.rmdir.assert_not_called()
        self.platform_os.write.assert_not_called()
        self.assert_original_closed()

    def test_replacement_domain_before_kill_is_never_signalled(self):
        self.events = [b"populated 1\n"]
        self.domain.side_effect = [42, RuntimeError("原 cgroup inode 已变化")]
        with self.assertRaisesRegex(RuntimeError, "inode 已变化"):
            self.retire()
        self.platform_os.write.assert_not_called()
        self.group.rmdir.assert_not_called()
        self.assert_original_closed()

    def test_original_domain_disappearing_after_empty_state_does_not_remove_a_path(self):
        self.domain.side_effect = [42, None]
        self.retire()
        self.group.rmdir.assert_not_called()
        self.platform_os.write.assert_not_called()
        self.assert_original_closed()

    def test_stop_uses_the_saved_uid_network_and_full_domain_ticket(self):
        value = {"id": "owned", "uid": 1000, "network": "net:[100]", **self.value}
        with patch.object(controller, "metadata", return_value=value), \
             patch.object(controller, "cgroup_path", return_value=self.group):
            self.assertEqual(controller.stop(Path("/owned"), "owner"), {"stopped": True})
        self.domain.assert_called_with(self.group, value, "cgroup")
        self.group.rmdir.assert_called_once_with()
        self.assert_original_closed()

    def test_stop_rejects_another_users_process_before_kill(self):
        self.members = b"12\n"
        controller.process.return_value = {"uid": 1001, "network": "net:[100]", "created": "77"}
        with self.assertRaisesRegex(RuntimeError, "原执行 UID"):
            self.retire()
        self.platform_os.write.assert_not_called()
        self.group.rmdir.assert_not_called()
        self.assert_original_closed()

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
