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

    def open(self, path, flags):
        self.opened = (path, flags)
        if self.open_error is not None:
            raise self.open_error
        assert path == '/private/project/program'
        assert flags == self.api.O_RDONLY | self.api.O_NOFOLLOW | self.api.O_CLOEXEC
        return self.mapped

    def fstat(self, descriptor):
        assert descriptor not in self.closed
        if descriptor == self.original:
            return self.source_after if self.reading and self.source_after is not None else self.info
        assert descriptor == self.mapped
        return self.mapped_after if self.reading and self.mapped_after is not None else self.actual

    def read(self, descriptor, size):
        assert descriptor == self.mapped and descriptor not in self.closed
        self.reading = True
        data = self.content[self.offset:self.offset+size]
        self.offset += len(data)
        return data

    def getxattr(self, descriptor, name):
        assert descriptor == self.mapped and name == 'security.capability'
        return self.capabilities

    def close(self, descriptor):
        assert descriptor in (self.original, self.mapped) and descriptor not in self.closed
        self.closed.append(descriptor)

    def set_inheritable(self, descriptor, value):
        assert descriptor == self.mapped and value is False
        self.inheritable[descriptor] = value

    def execve(self, descriptor, args, environment):
        assert self.original in self.closed and descriptor == self.mapped and descriptor not in self.closed
        assert self.inheritable[descriptor] is False
        self.executions.append((descriptor, args, environment))
        raise Executed()

    def run(self, expected=None):
        argv = ['fixed-bootstrap', str(self.original), expected or hashlib.sha256(self.content).hexdigest(),
                '/private/project/program', 'literal value', '雪', '$(not code)']
        with patch.dict(sys.modules, {'os': self.api}), patch.object(sys, 'argv', argv):
            exec(compile(SOURCE, '<packaged mapped ELF bootstrap>', 'exec'), {})


class Tests(unittest.TestCase):
    def refusal(self, kernel):
        with self.assertRaises((AssertionError, OSError)):
            kernel.run()
        self.assertFalse(kernel.executions)
        self.assertIn(kernel.original, kernel.closed)
        if kernel.open_error is None:
            self.assertIn(kernel.mapped, kernel.closed)

    def test_owner_only_elf_uses_mapped_fd_and_closes_original_before_application(self):
        k = Kernel()
        with self.assertRaises(Executed):
            k.run()
        self.assertEqual(k.executions, [(k.mapped, ['/private/project/program', 'literal value', '雪', '$(not code)'],
                                        k.api.environ)])
        self.assertEqual(k.closed, [k.original, k.mapped])
        self.assertNotEqual(k.info.st_uid, k.actual.st_uid)

    def test_different_device_or_inode_cannot_replace_pinned_image(self):
        for field in ('st_dev', 'st_ino'):
            k = Kernel(); setattr(k.actual, field, getattr(k.actual, field) + 1)
            with self.subTest(field=field): self.refusal(k)

    def test_digest_mismatch_closes_both_fds_without_execution(self):
        k = Kernel()
        with self.assertRaises(AssertionError): k.run('0' * 64)
        self.assertFalse(k.executions); self.assertEqual(k.closed, [k.original, k.mapped])

    def test_mode_and_content_metadata_must_match_original_mount_view(self):
        for field in ('st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns'):
            k = Kernel(); setattr(k.actual, field, getattr(k.actual, field) + 1)
            with self.subTest(field=field): self.refusal(k)

    def test_changed_mapped_or_original_inode_during_hashing_refuses(self):
        for field in ('st_dev', 'st_ino', 'st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns'):
            for mount in ('source_after', 'mapped_after'):
                k = Kernel(); changed = copy.copy(k.info if mount == 'source_after' else k.actual)
                setattr(changed, field, getattr(changed, field) + 1); setattr(k, mount, changed)
                with self.subTest(field=field, mount=mount): self.refusal(k)

    def test_growth_is_bounded_by_original_file_size(self):
        k = Kernel(); k.content += b'changed after open'
        self.refusal(k); self.assertLessEqual(k.offset, 1048576)

    def test_setid_capabilities_and_nonregular_images_are_refused(self):
        for mode in (stat.S_IFREG | 0o4700, stat.S_IFREG | 0o2700, stat.S_IFDIR | 0o700):
            k = Kernel(); k.info.st_mode = k.actual.st_mode = mode
            with self.subTest(mode=mode): self.refusal(k)
        k = Kernel(); k.capabilities = b'file capabilities'
        self.refusal(k)

    def test_permission_refusal_closes_the_original_root_opened_fd(self):
        k = Kernel(); k.open_error = PermissionError(errno.EACCES, 'mapped image not accessible')
        self.refusal(k); self.assertEqual(k.closed, [k.original])

    def test_unsupported_fd_execution_never_falls_back_to_path_execution(self):
        k = Kernel(); k.api.supports_fd = set()
        with self.assertRaises(AssertionError): k.run()
        self.assertFalse(k.executions); self.assertEqual(k.closed, [k.original])


if __name__ == '__main__':
    unittest.main()
