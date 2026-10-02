"""Portable transaction models; filesystem/process authority is simulated.

The production Python definitions run unchanged against an in-memory adapter.
These results do not attest a Linux cgroup, root account, or renameat2 syscall.
"""
import ast
import base64
import ctypes
import errno
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
import types
import uuid


class Node:
    next_inode = 10

    def __init__(self, path, directory=False, data=b'', mode=None):
        Node.next_inode += 1
        self.path, self.directory, self.data = path, directory, data
        self.mode = (stat.S_IFDIR if directory else stat.S_IFREG) | (mode if mode is not None else (0o700 if directory else 0o600))
        self.inode, self.uid, self.gid, self.links = Node.next_inode, 0, 0, 1
        self.mtime = self.ctime = 1

    def info(self):
        return types.SimpleNamespace(st_dev=11, st_ino=self.inode, st_mode=self.mode,
            st_uid=self.uid, st_gid=self.gid, st_nlink=self.links, st_size=len(self.data),
            st_mtime_ns=self.mtime, st_ctime_ns=self.ctime)


class Iterator:
    def __init__(self, names): self.names = names
    def __enter__(self): return iter(types.SimpleNamespace(name=name) for name in self.names)
    def __exit__(self, *_): pass


class Reader:
    def __init__(self, fs, descriptor):
        self.fs, self.descriptor = fs, descriptor
    def __enter__(self): return self
    def __exit__(self, *_): self.fs.close(self.descriptor)
    def fileno(self): return self.descriptor
    def read(self, count): return self.fs.read(self.descriptor, count)


class Function:
    def __init__(self, fs): self.fs = fs
    def __call__(self, old_parent, old, new_parent, new, flags):
        assert flags == 1 and old_parent == new_parent
        old_path = self.fs.path(old.decode(), old_parent)
        new_path = self.fs.path(new.decode(), new_parent)
        if self.fs.publish_error:
            self.fs.error = self.fs.publish_error
            return -1
        if new_path in self.fs.nodes:
            self.fs.error = errno.EEXIST
            return -1
        self.fs.events.append(('publish', old_path, new_path))
        node = self.fs.nodes.pop(old_path)
        node.path = new_path
        self.fs.nodes[new_path] = node
        if self.fs.after_publish: self.fs.after_publish()
        return 0


class SyscallFunction:
    def __init__(self, fs): self.fs = fs
    def __call__(self, number, old_parent, old, new_parent, new, flags):
        assert isinstance(number, ctypes.c_long)
        expected = 316 if self.fs.machine == 'x86_64' else 276
        assert number.value == expected
        assert isinstance(old_parent, ctypes.c_int) and isinstance(new_parent, ctypes.c_int)
        assert isinstance(old, ctypes.c_char_p) and isinstance(new, ctypes.c_char_p)
        assert isinstance(flags, ctypes.c_uint) and flags.value == 1
        self.fs.syscall_calls.append(number.value)
        return self.fs.rename(old_parent.value, old.value, new_parent.value, new.value, flags.value)


class Filesystem:
    def __init__(self):
        self.nodes, self.fds, self.events = {}, {}, []
        self.next_fd, self.error, self.publish_error = 100, 0, 0
        self.after_publish = self.fsync_failure = None
        self.busy = self.changed_group = False
        self.cgroup_calls = 0
        self.closed_then_busy = False
        self.machine, self.pointer_size, self.long_size = 'x86_64', 8, 8
        self.wrapper_available, self.syscall_available, self.syscall_calls = True, True, []
        constants = {name: getattr(os, name) for name in ('O_RDONLY', 'O_WRONLY', 'O_CREAT', 'O_EXCL', 'SEEK_SET')}
        constants.update({name: getattr(os, name, 1 << (20 + index)) for index, name in enumerate(('O_DIRECTORY', 'O_NOFOLLOW', 'O_CLOEXEC'))})
        self.os = types.SimpleNamespace(**constants, open=self.open, close=self.close, fstat=self.fstat,
            stat=self.stat, mkdir=self.mkdir, read=self.read, write=self.write, lseek=self.lseek,
            fsync=self.fsync, unlink=self.unlink, scandir=self.scandir, fdopen=lambda fd, _mode: Reader(self, fd),
            uname=lambda: types.SimpleNamespace(machine=self.machine))
        self.rename = Function(self)
        self.syscall = SyscallFunction(self)
        def library(*_args, **_kwargs):
            return types.SimpleNamespace(**({'renameat2':self.rename} if self.wrapper_available else {}),
                **({'syscall':self.syscall} if self.syscall_available else {}))
        self.ctypes = types.SimpleNamespace(CDLL=library,
            get_errno=lambda: self.error, c_int=ctypes.c_int, c_uint=ctypes.c_uint, c_char_p=ctypes.c_char_p,
            c_long=ctypes.c_long, c_void_p=ctypes.c_void_p,
            sizeof=lambda kind: self.pointer_size if kind is ctypes.c_void_p else self.long_size)

    def path(self, path, parent=None):
        if path == '.' and parent is not None: return self.fds[parent][0].path
        if path.startswith('/'): return path
        assert parent is not None and '/' not in path and path not in ('', '..')
        return self.fds[parent][0].path + '/' + path

    def add(self, path, directory=False, data=b'', mode=None):
        node = Node(path, directory, data, mode)
        self.nodes[path] = node
        return node

    def directory_fd(self, path):
        assert path in self.nodes and self.nodes[path].directory
        return self.open(path, self.os.O_RDONLY | self.os.O_DIRECTORY | self.os.O_NOFOLLOW)

    def open(self, path, flags, mode=None, dir_fd=None):
        path = self.path(path, dir_fd)
        if flags & self.os.O_CREAT:
            if path in self.nodes and flags & self.os.O_EXCL: raise FileExistsError(path)
            if path not in self.nodes: self.add(path, mode=mode)
        if path not in self.nodes: raise FileNotFoundError(path)
        node = self.nodes[path]
        if flags & self.os.O_DIRECTORY and not node.directory: raise NotADirectoryError(path)
        if flags & self.os.O_NOFOLLOW and stat.S_ISLNK(node.mode): raise OSError(errno.ELOOP, 'modeled link')
        self.next_fd += 1
        self.fds[self.next_fd] = [node, 0]
        return self.next_fd

    def close(self, descriptor):
        assert descriptor in self.fds, ('double/unknown close', descriptor)
        del self.fds[descriptor]
    def fstat(self, descriptor): return self.fds[descriptor][0].info()
    def stat(self, path, dir_fd=None, follow_symlinks=False):
        assert not follow_symlinks
        path = self.path(path, dir_fd)
        if path not in self.nodes: raise FileNotFoundError(path)
        return self.nodes[path].info()
    def mkdir(self, path, mode, dir_fd):
        path = self.path(path, dir_fd)
        if path in self.nodes: raise FileExistsError(path)
        self.add(path, True, mode=mode)
        self.events.append(('mkdir', path))
        if path.startswith('/sys/fs/cgroup/'):
            for name in ('cgroup.kill', 'cgroup.events'):
                self.add(path + '/' + name)
    def read(self, descriptor, size):
        node, position = self.fds[descriptor]
        data = node.data[position:position + size]
        self.fds[descriptor][1] += len(data)
        return data
    def write(self, descriptor, data):
        node, position = self.fds[descriptor]
        data = bytes(data)
        node.data = node.data[:position] + data + node.data[position + len(data):]
        self.fds[descriptor][1] += len(data)
        node.mtime += 1; node.ctime += 1
        self.events.append(('write', node.path, len(data)))
        return len(data)
    def lseek(self, descriptor, offset, whence):
        assert whence == os.SEEK_SET
        self.fds[descriptor][1] = offset
        return offset
    def fsync(self, descriptor):
        path = self.fds[descriptor][0].path
        self.events.append(('fsync', path))
        if self.fsync_failure and self.fsync_failure(path): raise OSError(errno.EIO, 'modeled sync failure')
    def unlink(self, path, dir_fd):
        path = self.path(path, dir_fd)
        if path not in self.nodes: raise FileNotFoundError(path)
        self.events.append(('unlink', path))
        del self.nodes[path]
    def scandir(self, descriptor):
        path = self.fds[descriptor][0].path + '/'
        return Iterator([name[len(path):] for name in self.nodes if name.startswith(path) and '/' not in name[len(path):]])


source = Path(sys.argv[1]).read_bytes()
tree = ast.parse(source)
definitions = ast.Module(body=[node for node in tree.body if isinstance(node, (ast.Assign, ast.FunctionDef, ast.ClassDef))], type_ignores=[])


def fixture():
    ns = dict(base64=base64, ctypes=ctypes, errno=errno, hashlib=hashlib, io=io, json=json, os=os, re=re,
        signal=signal, stat=stat, struct=struct, subprocess=subprocess, sys=sys, tempfile=tempfile,
        time=time, uuid=uuid)
    exec(compile(definitions, 'production-controller-definitions', 'exec'), ns)
    fs = Filesystem()
    ns['os'], ns['ctypes'], ns['directory_fd'] = fs.os, fs.ctypes, fs.directory_fd
    for path in (ns['RUNTIME'], ns['RUNTIME'] + '/runs', ns['CGROUP']): fs.add(path, True)
    boot = str(uuid.uuid4())
    value = dict(version=1, phase='closed', mode='independent', registryId=str(uuid.uuid4()),
        identityId=str(uuid.uuid4()), projectId='default', runId=str(uuid.uuid4()), revision=1, bootId=boot,
        build='b' * 64, networkDevice='11', networkInode='200', cgroupDevice='11', cgroupInode='201', namespace='sk-default')
    value['cgroupName'] = 'sakura-identity-' + value['runId']
    fs.add(ns['run_path'](value['runId']), data=ns['run_bytes'](value))
    def read(path, limit=262144, missing=False):
        if path not in fs.nodes:
            if missing: return None
            ns['refuse']('RECORD_ABSENT')
        node = fs.nodes[path]
        ns['trusted'](node.info(), mode=0o600)
        if len(node.data) > limit: ns['refuse']('RECORD_BOUND')
        return node.data
    def group(_value):
        fs.cgroup_calls += 1
        if fs.changed_group: ns['refuse']('CGROUP_REPLACED')
        if fs.busy or fs.closed_then_busy:
            path = ns['CGROUP'] + '/modeled-upper'
            if path not in fs.nodes: fs.add(path, True)
            return fs.directory_fd(path)
        return None
    ns.update(read=read, cgroup_fd=group, populated=lambda _fd: fs.busy or fs.cgroup_calls > 1,
        migration_ready=lambda _value: None, network_ready=lambda _value, _boot: None,
        cgroup_available=lambda *_args: None)
    return ns, fs, value, boot


def refusal(ns, code, operation):
    try: operation()
    except ns['Refusal'] as error: assert error.code == code, (error.code, code)
    else: raise AssertionError('expected ' + code)


def archived_path(ns, value):
    return ns['RUNTIME'] + '/archives/' + value['runId'][:2] + '/' + value['runId'] + '.bin'


def successful_archive():
    ns, fs, value, boot = fixture()
    original = ns['run_bytes'](value)
    assert ns['run_archive'](value, boot) is True
    assert ns['run_path'](value['runId']) not in fs.nodes
    assert fs.nodes[archived_path(ns, value)].data == original
    assert ns['run_read'](value['runId']) == value
    before = list(fs.events)
    ns['run_write'](value)
    assert ns['stop'](value, value, boot) == value
    assert fs.events == before and ns['run_path'](value['runId']) not in fs.nodes
    publish = next(index for index, event in enumerate(fs.events) if event[0] == 'publish')
    unlink = next(index for index, event in enumerate(fs.events) if event == ('unlink', ns['run_path'](value['runId'])))
    assert publish < unlink and any(event[0] == 'fsync' and '/archives/' in event[1] for event in fs.events[publish:unlink])
    assert not fs.fds


def capacity_and_replay():
    ns, fs, value, boot = fixture()
    values = [value]
    for _index in range(ns['RUN_LIMIT'] - 1):
        copy = dict(value, runId=str(uuid.uuid4()))
        copy['cgroupName'] = 'sakura-identity-' + copy['runId']
        fs.add(ns['run_path'](copy['runId']), data=ns['run_bytes'](copy)); values.append(copy)
    assert ns['compact_runs'](boot) == 512
    assert len(ns['run_entries']()) == 512
    archived = [item for item in values if ns['run_path'](item['runId']) not in fs.nodes]
    assert len(archived) == 512
    for item in archived: assert ns['run_read'](item['runId']) == item
    for project in ('default', '1111111111111111'):
        identity = dict(value, projectId=project)
        refusal(ns, 'RUN_ARCHIVED', lambda: ns['prepare'](identity, {'runId': archived[0]['runId']}, boot, value['build']))
    refusal(ns, 'RUN_ARCHIVED', lambda: ns['run_write'](dict(archived[0], phase='active')))
    assert not fs.fds


def automatic_admission_and_random_collision():
    ns, fs, value, boot = fixture()
    for _index in range(ns['RUN_LIMIT'] - 1):
        copy = dict(value, runId=str(uuid.uuid4()))
        copy['cgroupName'] = 'sakura-identity-' + copy['runId']
        fs.add(ns['run_path'](copy['runId']), data=ns['run_bytes'](copy))
    network = '/modeled-network'; fs.add(network)
    ns['network_fd'] = lambda _value, _boot: (fs.open(network, fs.os.O_RDONLY),
        types.SimpleNamespace(st_dev=11, st_ino=200), 'sk-default')
    def atomic(path, data):
        fs.add(path, data=data); fs.events.append(('atomic', path))
    ns['atomic'] = atomic
    admitted = ns['prepare'](value, {}, boot, value['build'])
    assert admitted['phase'] == 'active' and len(ns['run_entries']()) == 513
    assert ns['run_read'](admitted['runId']) == admitted and not fs.fds
    archived = next(node for path, node in fs.nodes.items() if '/archives/' in path and path.endswith('.bin'))
    run_id = archived.path.rsplit('/', 1)[1][:-4]
    ns['uuid'] = types.SimpleNamespace(uuid4=lambda: run_id)
    before = list(fs.events)
    refusal(ns, 'RUN_ID_COLLISION', lambda: ns['prepare'](value, {}, boot, value['build']))
    assert fs.events == before and not fs.fds


def busy_and_active_preserved():
    ns, fs, value, boot = fixture(); fs.busy = True
    before = fs.nodes[ns['run_path'](value['runId'])]
    assert ns['compact_runs'](boot) == 0
    assert fs.nodes[ns['run_path'](value['runId'])] is before
    assert not any(event[0] == 'publish' for event in fs.events)
    fs.busy = False
    before.data = ns['run_bytes'](dict(value, phase='active'))
    assert ns['compact_runs'](boot) == 0 and not fs.fds


def source_replacement_preserved():
    for parent_changed in (False, True):
        ns, fs, value, boot = fixture()
        source_path = ns['run_path'](value['runId'])
        original = fs.nodes[source_path].data
        def replace():
            if parent_changed: fs.add(ns['RUNTIME'] + '/runs', True)
            else: fs.add(source_path, data=b'unknown-later-object')
        fs.after_publish = replace
        refusal(ns, 'RUN_ARCHIVE_SOURCE_CHANGED', lambda: ns['run_archive'](value, boot))
        assert fs.nodes[source_path].data == (original if parent_changed else b'unknown-later-object')
        assert fs.nodes[archived_path(ns, value)].data == original and not fs.fds


def conflicting_archive_preserved():
    ns, fs, value, boot = fixture()
    fd = ns['run_archive_fd'](value['runId'], True); fs.close(fd)
    foreign = dict(value, networkInode='777')
    fs.add(archived_path(ns, value), data=ns['run_bytes'](foreign))
    original = fs.nodes[ns['run_path'](value['runId'])]
    refusal(ns, 'RUN_ARCHIVE_CONFLICT', lambda: ns['run_archive'](value, boot))
    assert fs.nodes[ns['run_path'](value['runId'])] is original
    assert fs.nodes[archived_path(ns, value)].data == ns['run_bytes'](foreign) and not fs.fds


def lost_destination_sync_recovers():
    ns, fs, value, boot = fixture()
    path = archived_path(ns, value)
    fs.fsync_failure = lambda name: name == path.rsplit('/', 1)[0]
    try: ns['run_archive'](value, boot)
    except OSError as error: assert error.errno == errno.EIO
    else: raise AssertionError('expected sync failure')
    assert ns['run_path'](value['runId']) in fs.nodes and path in fs.nodes and not fs.fds
    before = list(fs.events); assert ns['run_read'](value['runId']) == value
    assert fs.events == before
    fs.fsync_failure = None
    assert ns['run_archive'](value, boot) is True
    assert ns['run_path'](value['runId']) not in fs.nodes and not fs.fds


def publication_refusals_keep_source():
    for error, code in ((errno.EEXIST, 'RUN_ARCHIVE_CONFLICT'), (errno.ENOSYS, 'RUN_ARCHIVE_ATOMIC_UNAVAILABLE'),
                        (errno.EIO, 'RUN_ARCHIVE_PUBLISH_FAILED')):
        ns, fs, value, boot = fixture(); fs.publish_error = error
        original = fs.nodes[ns['run_path'](value['runId'])]
        refusal(ns, code, lambda: ns['run_archive'](value, boot))
        assert fs.nodes[ns['run_path'](value['runId'])] is original
        assert archived_path(ns, value) not in fs.nodes
        assert not any('/.record-' in path for path in fs.nodes) and not fs.fds


def raw_syscall_publication_and_abi_refusals():
    for machine in ('x86_64', 'aarch64'):
        ns, fs, value, boot = fixture(); fs.wrapper_available = False; fs.machine = machine
        assert ns['run_archive'](value, boot) is True
        assert ns['run_read'](value['runId']) == value
        assert len(fs.syscall_calls) == 1 and not fs.fds
        for error, code in ((errno.EEXIST,'RUN_ARCHIVE_CONFLICT'), (errno.ENOSYS,'RUN_ARCHIVE_ATOMIC_UNAVAILABLE')):
            ns, fs, value, boot = fixture(); fs.wrapper_available = False; fs.machine = machine; fs.publish_error = error
            original = fs.nodes[ns['run_path'](value['runId'])]
            refusal(ns, code, lambda: ns['run_archive'](value, boot))
            assert fs.nodes[ns['run_path'](value['runId'])] is original
            assert archived_path(ns, value) not in fs.nodes and not fs.fds
    for setting, replacement in (('machine','unknown'), ('pointer_size',4), ('long_size',4), ('syscall_available',False)):
        ns, fs, value, boot = fixture(); fs.wrapper_available = False; setattr(fs,setting,replacement)
        original = fs.nodes[ns['run_path'](value['runId'])]
        refusal(ns,'RUN_ARCHIVE_ATOMIC_UNAVAILABLE',lambda: ns['run_archive'](value, boot))
        assert fs.nodes[ns['run_path'](value['runId'])] is original and not fs.syscall_calls and not fs.fds


def readonly_and_bad_archive():
    ns, fs, value, boot = fixture()
    before = list(fs.events); assert ns['run_read'](value['runId']) == value
    assert fs.events == before
    ns['run_archive'](value, boot); path = archived_path(ns, value)
    for data, code in ((b'incomplete', 'RUN_ARCHIVE_SIZE'), (ns['run_bytes'](dict(value, phase='active')), 'RUN_ARCHIVE_ACTIVE')):
        fs.nodes[path].data = data
        refusal(ns, code, lambda: ns['run_read'](value['runId']))
        assert fs.nodes[path].data == data and not fs.fds


def authority_refusals():
    for attribute, replacement, code in (('uid', 20001, 'UNTRUSTED_RECORD'), ('links', 2, 'RECORD_LINKS'),
                                         ('mode', stat.S_IFREG | 0o644, 'RECORD_PERMISSIONS')):
        ns, fs, value, boot = fixture()
        node = fs.nodes[ns['run_path'](value['runId'])]; setattr(node, attribute, replacement)
        refusal(ns, code, lambda: ns['run_archive'](value, boot))
        assert fs.nodes[ns['run_path'](value['runId'])] is node and not fs.fds


def later_busy_and_changed_group():
    ns, fs, value, boot = fixture(); fs.closed_then_busy = True
    refusal(ns, 'RUN_ARCHIVE_SCOPE_BUSY', lambda: ns['run_archive'](value, boot))
    assert ns['run_path'](value['runId']) in fs.nodes and not fs.fds
    ns, fs, value, boot = fixture(); fs.changed_group = True
    refusal(ns, 'CGROUP_REPLACED', lambda: ns['run_archive'](value, boot))
    assert not any(event[0] == 'publish' for event in fs.events) and not fs.fds


def bounded_archive_and_old_boot():
    ns, fs, value, boot = fixture()
    fd = ns['run_archive_fd'](value['runId'], True); fs.close(fd)
    ns['RUN_ARCHIVE_BUCKET_LIMIT'] = 2
    parent = archived_path(ns, value).rsplit('/', 1)[0]
    for name in ('neighbor-one', 'neighbor-two'): fs.add(parent + '/' + name, data=b'untouched')
    refusal(ns, 'RUN_ARCHIVE_LIMIT', lambda: ns['run_archive'](value, boot))
    assert ns['run_path'](value['runId']) in fs.nodes and not fs.fds
    ns, fs, value, boot = fixture()
    refusal(ns, 'RUN_ARCHIVE_STALE', lambda: ns['compact_runs'](str(uuid.uuid4())))
    assert not fs.events and not fs.fds


def bounded_hot_records_and_unknown_files():
    ns, fs, value, boot = fixture(); fs.add(ns['RUNTIME'] + '/runs/unknown', data=b'untouched')
    refusal(ns, 'RUN_UNKNOWN_FILE', lambda: ns['compact_runs'](boot))
    assert not fs.events and not fs.fds
    ns, fs, value, boot = fixture(); ns['RUN_LIMIT'] = 1
    fs.add(ns['run_path'](str(uuid.uuid4())), data=ns['run_bytes'](value))
    refusal(ns, 'RUN_LIMIT', lambda: ns['run_entries']())
    assert not fs.events and not fs.fds


checks = [successful_archive, capacity_and_replay, automatic_admission_and_random_collision,
    busy_and_active_preserved, source_replacement_preserved,
    conflicting_archive_preserved, lost_destination_sync_recovers, publication_refusals_keep_source,
    raw_syscall_publication_and_abi_refusals,
    readonly_and_bad_archive, authority_refusals, later_busy_and_changed_group,
    bounded_archive_and_old_boot, bounded_hot_records_and_unknown_files]
for check in checks: check()
print(json.dumps({'passed': True, 'kind': 'portable-model-only', 'checks': [check.__name__ for check in checks],
    'sourceSha256': hashlib.sha256(source).hexdigest()}))
