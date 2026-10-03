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


def functions():
    tree = ast.parse(CONTROLLER.read_text(encoding='utf8'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             or isinstance(node, ast.ClassDef) and node.name == 'DirectoryViewError']
    namespace = {'array': array, 'ctypes': ctypes, 'errno': errno, 'json': json, 'os': os,
                 'Path': PurePosixPath, 're': re, 'signal': SimpleNamespace(SIGKILL=9), 'socket': socket, 'stat': stat,
                 'UUID': re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(CONTROLLER), 'exec'), namespace)
    return namespace


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
    def setUp(self):
        self.ns = functions()
        self.value = record()
        self.user = SimpleNamespace(pw_uid=15000, pw_gid=15001, pw_dir='/home/sandbox')
        self.ns['RUNTIME'] = PurePosixPath('/run/sakura-wl')

    def test_mapping_direction_preserves_disk_project_owner(self):
        contents, writes, closed = {}, [], []
        class Path(PurePosixPath):
            def read_text(self): return contents[str(self)]
        files = {}
        def open_(path, flags):
            descriptor = len(files) + 10
            files[descriptor] = str(path)
            return descriptor
        def write_(fd, raw):
            contents[files[fd]] = raw.decode()
            writes.append((files[fd], raw))
            return len(raw)
        self.ns.update(Path=Path, os=SimpleNamespace(open=open_, write=write_, close=closed.append,
                       O_WRONLY=1, O_NOFOLLOW=2, O_CLOEXEC=4))
        def helper(kind, initialize, parent_initialize):
            self.assertEqual(kind, 0x10000000)
            parent_initialize(777)
            return 55, {}
        self.ns['directory_view_helper'] = helper
        result = self.ns['directory_view_userns'](self.value['desktop']['identity'], self.user)
        self.assertEqual(result, 55)
        self.assertEqual([raw for _, raw in writes], [b'deny', b'20001 15000 1', b'20002 15001 1'])
        self.assertEqual(closed, [10, 11, 12])

    def test_overlap_and_wrong_ranges_never_create_a_namespace(self):
        called = []
        self.ns['directory_view_helper'] = lambda *args: called.append(args)
        for project, app in [(20001, 20001), (1000, 15000), (20001, 20000), (20001, 999)]:
            with self.subTest(project=project, app=app):
                identity = dict(self.value['desktop']['identity'], uid=project)
                with self.assertRaises(RuntimeError):
                    self.ns['directory_view_userns'](identity, SimpleNamespace(pw_uid=app, pw_gid=15001))
        self.assertEqual(called, [])

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

    def test_stopped_receipt_does_not_reopen_an_expired_namespace(self):
        self.ns['directory_view_member'] = lambda *args: self.fail('empty/stopped receipt looked up a PID namespace')
        self.assertEqual(self.ns['directory_view_proof'](self.value), self.value['directoryView'])
        old = copy.deepcopy(self.value)
        del old['directoryView']
        self.assertIsNone(self.ns['directory_view_proof'](old))

    def namespace_kernel(self, kind=0x20000, owner=1):
        closed = []
        self.ns['fcntl'] = SimpleNamespace(ioctl=lambda fd, command: kind if command == 0xb703 else 9)
        self.ns['os'] = SimpleNamespace(fstat=lambda fd: SimpleNamespace(st_dev=4, st_ino=1 if fd == 7 else owner),
                                       close=closed.append)
        return closed

    def test_wrong_namespace_type_is_rejected_before_owner_lookup(self):
        closed = self.namespace_kernel(kind=0x10000000)
        with self.assertRaisesRegex(RuntimeError, '类型'):
            self.ns['directory_view_namespace'](8, 0x20000, 7)
        self.assertEqual(closed, [])

    def test_namespace_foreign_root_owner_is_rejected_and_fd_closed(self):
        closed = self.namespace_kernel(owner=2)
        with self.assertRaisesRegex(RuntimeError, 'Root user namespace'):
            self.ns['directory_view_namespace'](8, 0x20000, 7)
        self.assertEqual(closed, [9])

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

    def test_changed_mount_fd_never_enters_namespace_and_closes_fd(self):
        closed, entered = self.enter_kernel(namespace=9999)
        with self.assertRaisesRegex(RuntimeError, 'FD'):
            self.ns['directory_view_enter'](8, self.value['directoryView'], self.value['directory'])
        self.assertEqual(entered, [])
        self.assertEqual(closed, [8])

    def test_setns_failure_closes_root_namespace_fd(self):
        closed, entered = self.enter_kernel(result=-1)
        with self.assertRaisesRegex(self.ns['DirectoryViewError'], 'setns'):
            self.ns['directory_view_enter'](8, self.value['directoryView'], self.value['directory'])
        self.assertEqual(entered, [(8, 0x20000)])
        self.assertEqual(closed, [8])

    def test_changed_mapped_source_closes_both_fds(self):
        closed, _ = self.enter_kernel(directory=4321)
        with self.assertRaisesRegex(RuntimeError, '映射目录'):
            self.ns['directory_view_enter'](8, self.value['directoryView'], self.value['directory'])
        self.assertEqual(closed, [8, 10])

    def test_valid_view_returns_only_mapped_cwd_fd(self):
        closed, entered = self.enter_kernel()
        self.assertEqual(self.ns['directory_view_enter'](8, self.value['directoryView'], self.value['directory']), 10)
        self.assertEqual(closed, [8])
        self.assertEqual(entered, [(8, 0x20000)])

    def test_mapped_directory_wrong_uid_gid_mode_or_mount_flags_closes_fd(self):
        for fields in ({'uid': 20001}, {'gid': 20002}, {'mode': 0o755}, {'flags': 2}, {'flags': 14}):
            with self.subTest(fields=fields):
                closed, _ = self.enter_kernel(**fields)
                with self.assertRaises(RuntimeError):
                    self.ns['directory_view_enter'](8, self.value['directoryView'], self.value['directory'])
                self.assertEqual(closed, [8, 10])

    def test_private_route_preserves_sandbox_home_and_runtime(self):
        for route in ('/home', '/home/sandbox', '/home/sandbox/subdir', '/run', '/run/sakura-wl', '/run/sakura-wl/subdir'):
            with self.subTest(route=route):
                with self.assertRaisesRegex(self.ns['DirectoryViewError'], 'route-private-account-overlap'):
                    self.ns['directory_view_route_guard'](PurePosixPath(route), self.user)
        self.ns['directory_view_route_guard'](PurePosixPath('/home/project-user'), self.user)
        self.ns['directory_view_route_guard'](PurePosixPath('/root/private'), self.user)

    def test_early_launch_error_always_closes_original_directory_fd(self):
        closed = []
        self.ns.update(proxy_valid=lambda: 'sha', identify=lambda image: {'image': image, 'sha256': 'sha'},
                       cgroup_root=lambda: None, project_network=lambda request: 'net:[50]',
                       compositor_context=lambda *args: ({}, {}, {'directoryFd': 88}),
                       os=SimpleNamespace(close=closed.append))
        for stage in ('rule', 'account', 'session-directory'):
            def early_error(*args):
                raise RuntimeError(stage)
            self.ns['launch_with_directory'] = early_error
            with self.assertRaisesRegex(RuntimeError, stage):
                self.ns['launch'](None, 'owner', {'image': '/bin/app', 'sha256': 'sha', 'args': []})
        self.assertEqual(closed, [88, 88, 88])

    def test_helper_timeout_kills_and_waits_only_its_unreaped_child(self):
        calls = []
        def wait(pid, flags):
            calls.append(('wait', pid, flags))
            return (0, 0) if flags else (777, 9)
        self.ns['os'] = SimpleNamespace(waitpid=wait, WNOHANG=1,
                                       kill=lambda pid, signal_: calls.append(('kill', pid, signal_)))
        self.ns['time'] = SimpleNamespace(monotonic=lambda: 10)
        with self.assertRaisesRegex(self.ns['DirectoryViewError'], 'helper-timeout'):
            self.ns['directory_view_wait'](777, 0)
        self.assertEqual(calls, [('wait', 777, 1), ('kill', 777, 9), ('wait', 777, 0)])

    def packet_kernel(self, descriptors, raw=None, flags=0):
        closed, waited, sent = [], [], []
        data = array.array('i', descriptors).tobytes()
        class Channel:
            def settimeout(self, value): pass
            def close(self): closed.append('socket')
            def recvmsg(self, *args):
                return (raw if raw is not None else json.dumps({'ok': True, 'result': {}, 'device': '4', 'inode': '9876'}).encode(),
                        [(1, 1, data)] if descriptors else [], flags, None)
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

    def test_duplicate_rights_are_all_closed_and_owned_helper_waited(self):
        closed, waited, sent = self.packet_kernel([8, 9])
        with self.assertRaisesRegex(RuntimeError, 'FD 回执'):
            self.ns['directory_view_helper'](0x20000, lambda: {})
        self.assertTrue(6 in closed and 8 in closed and 9 in closed)
        self.assertEqual(waited, [777])
        self.assertEqual(sent, [])

    def test_eof_receipt_still_waits_exact_helper(self):
        closed, waited, _ = self.packet_kernel([], raw=b'')
        with self.assertRaisesRegex(RuntimeError, '为空'):
            self.ns['directory_view_helper'](0x20000, lambda: {})
        self.assertIn(6, closed)
        self.assertEqual(waited, [777])

    def test_cancel_after_rights_closes_namespace_before_waiting(self):
        closed, waited, sent = self.packet_kernel([8])
        def cancelled(pid):
            self.assertEqual(pid, 777)
            raise RuntimeError('cancelled')
        with self.assertRaisesRegex(RuntimeError, 'cancelled'):
            self.ns['directory_view_helper'](0x20000, lambda: {}, cancelled)
        self.assertIn(8, closed)
        self.assertEqual(waited, [777])
        self.assertEqual(sent, [])

    def test_truncated_rights_closes_every_received_fd_and_waits_helper(self):
        closed, waited, sent = self.packet_kernel([8], flags=8)
        with self.assertRaisesRegex(RuntimeError, '不完整'):
            self.ns['directory_view_helper'](0x20000, lambda: {})
        self.assertIn(8, closed)
        self.assertIn(6, closed)
        self.assertEqual(waited, [777])
        self.assertEqual(sent, [])

    def test_post_receipt_timeout_does_not_wait_reaped_pid_twice(self):
        closed, waited, sent = self.packet_kernel([8])
        def timeout(pid, deadline):
            waited.append(pid)
            raise self.ns['DirectoryViewError']('helper-timeout', errno.ETIMEDOUT)
        self.ns['directory_view_wait'] = timeout
        with self.assertRaisesRegex(self.ns['DirectoryViewError'], 'helper-timeout'):
            self.ns['directory_view_helper'](0x20000, lambda: {})
        self.assertEqual(waited, [777])
        self.assertIn(8, closed)
        self.assertEqual(sent, [b'1'])

    def test_proxy_rejects_changed_mount_and_unknown_view_receipt(self):
        tree = ast.parse(PROXY.read_text(encoding='utf8'))
        method = next(node for node in next(node for node in tree.body if isinstance(node, ast.ClassDef)
                      and node.name == 'Broker').body if isinstance(node, ast.FunctionDef) and node.name == 'client_identity')
        current = SimpleNamespace(st_dev=4, st_ino=9876)
        class Path(PurePosixPath):
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

    def retire_kernel(self, populated):
        closed, writes, removed, files = [], [], [], {}
        class Path(PurePosixPath):
            def read_text(self): return '0::/owned-app\n'
            def rmdir(self): removed.append(str(self))
        content = {'cgroup.procs': '444' if populated else '', 'cgroup.events': 'populated 1\n' if populated else 'populated 0\n'}
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

    def test_stop_rejects_live_foreign_mount_before_any_kill(self):
        group, closed, writes, removed = self.retire_kernel(True)
        def changed(pid, proof):
            self.assertEqual(pid, 444)
            raise RuntimeError('foreign namespace')
        self.ns['directory_view_member'] = changed
        with self.assertRaisesRegex(RuntimeError, 'foreign namespace'):
            self.ns['application_retire'](group, self.value, 15000, 'net:[50]', 'applicationProof')
        self.assertEqual(writes, [])
        self.assertEqual(removed, [])
        self.assertIn(10, closed)

    def test_empty_original_cgroup_retires_after_mount_namespace_expired(self):
        group, closed, writes, removed = self.retire_kernel(False)
        self.ns['directory_view_member'] = lambda *args: self.fail('namespace reopened after all original PIDs exited')
        self.ns['application_retire'](group, self.value, 15000, 'net:[50]', 'applicationProof')
        self.assertEqual(writes, [])
        self.assertEqual(removed, ['/sys/fs/cgroup/owned-app'])
        self.assertGreaterEqual(closed.count(10), 2)

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
