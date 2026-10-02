"""Portable SSH authority/transport checks against production definitions.

Linux process, account, filesystem and descriptor authority is simulated here;
this does not attest a live sshd, cgroup, setuid launcher or PTY on this host.
"""
import ast
import base64
import contextlib
import copy
import ctypes
import errno
import hashlib
import io
import json
import os
from pathlib import Path
import re
import selectors
import shlex
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
import types
import uuid


source = Path(sys.argv[1]).read_bytes()
tree = ast.parse(source)
definitions = ast.Module(body=[node for node in tree.body if isinstance(node, (ast.Assign, ast.FunctionDef, ast.ClassDef))], type_ignores=[])
guard = ast.Module(body=[tree.body[-1]], type_ignores=[])


def fixture():
    ns = dict(base64=base64, ctypes=ctypes, errno=errno, hashlib=hashlib, json=json, os=os, re=re,
              selectors=selectors, signal=signal, stat=stat, struct=struct, subprocess=subprocess,
              sys=sys, tempfile=tempfile, time=time, uuid=uuid)
    exec(compile(definitions, 'production-controller-definitions', 'exec'), ns)
    value = dict(version=1, phase='active', registryId=str(uuid.uuid4()), projectId='default',
                 identityId=str(uuid.uuid4()), revision=1, uid=20000, gid=20000,
                 directory='/workspace', directoryDevice='11', directoryInode='101',
                 homeDevice='11', homeInode='102', networkIsolation='host')
    value['account'] = 'skp' + value['identityId'].replace('-', '')[:24]
    value['home'] = ns['HOMES'] + '/' + value['identityId']
    boot, build, run_id = str(uuid.uuid4()), 'b' * 64, str(uuid.uuid4())
    run = dict(version=1, phase='active', mode='inherit-current', registryId=value['registryId'],
               identityId=value['identityId'], projectId='default', runId=run_id, revision=1,
               bootId=boot, build=build, networkDevice='11', networkInode='200',
               cgroupDevice='11', cgroupInode='300', cgroupName='system.slice/sakura-ssh-default.service', namespace='')
    daemon = dict(pid=1001, startTicks='2001', bootId=boot, cgroupName=run['cgroupName'])
    identity = {key: value[key] for key in ('registryId', 'identityId', 'revision')}
    snapshot = dict(version=1, projectId='default', runId=run_id, identity=identity,
                    environment={'TOKEN': 'project snapshot marker', 'SSH_ORIGINAL_COMMAND': 'snapshot command marker'})
    raw = json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    digest = hashlib.sha256(raw).hexdigest()
    request = dict(action='ssh-session', projectId='default', expected=identity, runId=run_id, snapshotSha256=digest)
    receipt = dict(version=1, run=copy.deepcopy(run), daemon=copy.deepcopy(daemon), snapshotSha256=digest)
    records = {ns['ssh_snapshot_path']('default'): raw,
               ns['ssh_receipt_path'](run_id): json.dumps(receipt).encode('utf-8')}
    def read(path, limit=262144, missing=False):
        if path not in records:
            if missing:
                return None
            ns['refuse']('RECORD_ABSENT')
        data = records[path]
        if len(data) > limit:
            ns['refuse']('RECORD_BOUND')
        return data
    ns['read'] = read
    return ns, value, run, daemon, snapshot, raw, request, receipt, records


def refuses(ns, call, expected=None):
    try:
        call()
    except ns['Refusal'] as error:
        if expected is not None:
            assert error.code == expected, (expected, error.code)
        return error.code
    raise AssertionError('expected authority refusal')


checks = []


def snapshot_and_environment_bounds():
    ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
    assert ns['ssh_snapshot_decode'](raw, value, run['runId'], request['snapshotSha256']) == snapshot
    refuses(ns, lambda: ns['ssh_snapshot_decode'](raw + b' ', value, run['runId'], request['snapshotSha256']), 'SSH_SNAPSHOT_DIGEST')
    duplicate = raw.replace(b'"version":1', b'"version":1,"version":1', 1)
    refuses(ns, lambda: ns['ssh_snapshot_decode'](duplicate), 'SSH_RECORD_INVALID')
    for change in ({'version': True}, {'version': 1.0}, {'extra': 'no'}, {'runId': str(uuid.uuid4())}):
        altered = dict(snapshot, **change)
        refuses(ns, lambda: ns['ssh_snapshot_decode'](json.dumps(altered).encode(), value, run['runId']))
    altered = dict(snapshot, identity=dict(snapshot['identity'], revision=True))
    refuses(ns, lambda: ns['ssh_snapshot_decode'](json.dumps(altered).encode()), 'EXPECTED_IDENTITY')
    for environment in ({'HOME': '/root'}, {'USER': 'root'}, {'LOGNAME': 'root'}, {'LD_X': '\0'},
                        {'BROKEN': '\ud800'}, {'0_BAD': 'value'}, {'KEY': 3}, {'X' * 129: 'value'},
                        {'X': 'a' * 8191}, {str(i): 'value' for i in range(129)}):
        refuses(ns, lambda: ns['ssh_environment'](environment))
    huge = {'KEY_' + str(i): 'a' * 8180 for i in range(9)}
    refuses(ns, lambda: ns['ssh_environment'](huge), 'SSH_ENVIRONMENT_BOUND')
    reserved = {'KEY_' + str(i): '' for i in range(128)}
    assert ns['ssh_environment'](reserved) > 0
    refuses(ns, lambda: ns['ssh_payload'](value, reserved, '', None), 'SSH_ENVIRONMENT_BOUND')
    reserved = {'KEY_' + str(i): '' for i in range(126)} | {'TERM': 'old', 'VSCODE_AGENT_FOLDER': '/root/old'}
    assert struct.unpack('<8sIIIIII', ns['ssh_payload'](value, reserved, '', None)[:32])[4] == 128
    refuses(ns, lambda: ns['ssh_snapshot_decode'](b'x' * 131073), 'SSH_SNAPSHOT_BOUND')
    refuses(ns, lambda: ns['ssh_request'](dict(request, expected=None)), 'EXPECTED_IDENTITY')
    refuses(ns, lambda: ns['ssh_request'](dict(request, command='root command')), 'REQUEST_SCHEMA')


def command_frame_and_identity_environment():
    ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
    command = "printf '%s\\n' '客户端' ; printf 'binary input stays on fd0'"
    environment = snapshot['environment'] | {'VSCODE_AGENT_FOLDER': '/root/escape', 'TERM': 'untrusted snapshot term'}
    payload = ns['ssh_payload'](value, environment, command, 'screen-256color')
    magic, version, flags, body_size, count, script_size, reserved = struct.unpack('<8sIIIIII', payload[:32])
    assert (magic, version, flags, reserved) == (b'SKIDP001', 1, 2, 0)
    assert body_size == len(payload) - 32
    script = payload[32:32 + script_size].decode('utf-8')
    assert script == 'exec /bin/sh -c ' + shlex.quote(command)
    offset, decoded, total = 32 + script_size, {}, script_size
    for _ in range(count):
        key_size, value_size = struct.unpack('<II', payload[offset:offset + 8])
        offset += 8
        key = payload[offset:offset + key_size].decode()
        content = payload[offset + key_size:offset + key_size + value_size].decode()
        offset += key_size + value_size
        total += key_size + 1 + value_size
        decoded[key] = content
    assert offset == len(payload) and total <= 65536
    assert decoded['VSCODE_AGENT_FOLDER'] == value['home'] + '/.vscode-server'
    assert decoded['TERM'] == 'screen-256color'
    assert decoded['SSH_ORIGINAL_COMMAND'] == 'snapshot command marker'
    assert 'snapshot command marker' not in script
    arguments = ns['launch_argv'](value, run, {'payloadSha256': hashlib.sha256(payload).hexdigest()}, run['build'])
    assert command not in ' '.join(arguments) and 'project snapshot marker' not in ' '.join(arguments)
    login = ns['ssh_payload'](value, {}, '', None)
    size = struct.unpack('<8sIIIIII', login[:32])[5]
    assert login[32:32 + size] == b'exec /bin/sh -l'
    for term in ('x\n', '', 'a' * 129, '終端'):
        refuses(ns, lambda: ns['ssh_payload'](value, {}, '', term), 'SSH_TERM_BOUND')
    for command in ('bad\0command', '\ud800', 'a' * 65537):
        refuses(ns, lambda: ns['ssh_payload'](value, {}, command, None), 'SSH_COMMAND_BOUND')
    refuses(ns, lambda: ns['ssh_payload'](value, {}, "'" * 20000, None), 'SSH_PAYLOAD_BOUND')


def service_cgroups_and_daemon_arguments():
    ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
    for name in ('openrc.sakura-ssh-default', 'system.slice/sakura-ssh-default.service'):
        ticket = dict(run, cgroupName=name)
        assert ns['run_decode'](run['runId'], ns['run_bytes'](ticket)) == ticket
        ns['open'] = lambda _path, *args: io.StringIO('0::/' + name + '\n')
        refuses(ns, ns['current_cgroup'], 'INHERITED_CGROUP_UNREGISTERED')
        assert ns['current_cgroup'](name) == name
    for name in ('system.slice/sakura-ssh-1111111111111111.service', 'openrc.sakura-ssh-1111111111111111',
                 'system.slice/../sakura-ssh-default.service', 'sakura-service-not-a-uuid'):
        refuses(ns, lambda: ns['run_decode'](run['runId'], ns['run_bytes'](dict(run, cgroupName=name))), 'CGROUP_IDENTITY')
        refuses(ns, lambda: ns['ssh_daemon_record'](dict(daemon, cgroupName=name), 'default'), 'SSH_DAEMON_SCOPE')
    fixed = '/etc/sakura/ssh/default/sshd_config'
    direct = ['/usr/sbin/sshd', '-D', '-e', '-f', fixed]
    ns['ssh_daemon_arguments'](('\0'.join(direct) + '\0').encode(), 'default')
    ns['ssh_daemon_arguments'](('sshd: ' + ' '.join(direct) + ' [listener] 0 of 10-100 startups\0\0').encode(), 'default')
    for args in (direct + ['-o', 'ForceCommand=/bin/sh'], direct + ['-f', '/etc/sshd_config'],
                 direct[:-1] + [fixed + '.replacement'], ['/bin/sh', '-c', ' '.join(direct)],
                 ['sshd: ' + ' '.join(direct) + ' [listener] 0 of 10-100 startups ; rootcommand']):
        refuses(ns, lambda: ns['ssh_daemon_arguments'](('\0'.join(args) + '\0').encode(), 'default'), 'SSH_DAEMON_COMMAND')
    refuses(ns, lambda: ns['ssh_daemon_record'](dict(daemon, pid=True), 'default'), 'SSH_DAEMON_INVALID')
    refuses(ns, lambda: ns['ssh_daemon_record'](dict(daemon, startTicks='02001'), 'default'), 'SSH_DAEMON_INVALID')


class AuthorityFilesystem:
    def __init__(self, ns, run, daemon):
        self.nodes, self.fds, self.events, self.next_fd = {}, {}, [], 100
        self.after_read = None
        constants = {name: getattr(os, name, 1 << (20 + index)) for index, name in enumerate(
            ('O_PATH', 'O_DIRECTORY', 'O_NOFOLLOW', 'O_CLOEXEC', 'O_NONBLOCK', 'O_RDONLY', 'O_WRONLY', 'O_CREAT', 'O_EXCL'))}
        self.os = types.SimpleNamespace(**constants, path=os.path, open=self.open, close=self.close,
            fstat=self.fstat, stat=self.stat, read=self.read, readlink=self.readlink, write=self.write,
            fchmod=self.fchmod, fsync=lambda fd: self.events.append(('fsync', self.fds[fd][0])),
            replace=self.replace, unlink=self.unlink, mkdir=self.mkdir)
        for path in ('/', '/sys', '/sys/fs', ns['CGROUP'], ns['CGROUP'] + '/system.slice',
                     ns['CGROUP'] + '/' + run['cgroupName'], '/proc', '/proc/1001', '/proc/1001/ns',
                     '/etc', '/etc/sakura', ns['SSH_CONFIG'], ns['SSH_CONFIG'] + '/default',
                     '/run', ns['RUNTIME'], ns['RUNTIME'] + '/ssh', ns['RUNTIME'] + '/runs'):
            self.add(path, directory=True)
        self.nodes[ns['CGROUP'] + '/' + run['cgroupName']]['inode'] = 300
        fields = ['S'] + ['0'] * 18 + [daemon['startTicks']] + ['0'] * 3
        self.add('/proc/1001/stat', ('1001 (sshd) ' + ' '.join(fields) + '\n').encode())
        self.add('/proc/1001/status', b'Name:\tsshd\nUid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\n')
        self.add('/proc/1001/cgroup', ('0::/' + run['cgroupName'] + '\n').encode())
        self.add('/proc/1001/cmdline', b'/usr/sbin/sshd\0-D\0-e\0-f\0/etc/sakura/ssh/default/sshd_config\0')
        self.add('/proc/1001/ns/net')
        self.nodes['/proc/1001/ns/net']['inode'] = 200
        self.exe = '/usr/sbin/sshd'
        ns['os'], ns['fcntl'] = self.os, types.SimpleNamespace(ioctl=lambda fd, command: 0x40000000)
        ns['cgroup_available'] = lambda *_args: None

    def add(self, path, data=b'', directory=False, mode=None):
        self.nodes[path] = dict(data=bytes(data), mode=(stat.S_IFDIR if directory else stat.S_IFREG) |
            (mode if mode is not None else (0o700 if directory else 0o600)),
            uid=0, gid=0, inode=400 + len(self.nodes), links=1)

    def path(self, path, parent=None):
        if path.startswith('/'):
            return path
        assert parent in self.fds and '/' not in path
        if path == '.':
            return self.fds[parent][0]
        return self.fds[parent][0].rstrip('/') + '/' + path

    def open(self, path, flags, mode=None, dir_fd=None):
        path = self.path(path, dir_fd)
        if flags & self.os.O_CREAT:
            if path in self.nodes and flags & self.os.O_EXCL:
                raise FileExistsError(path)
            if path not in self.nodes:
                self.add(path, mode=mode)
        if path not in self.nodes:
            raise FileNotFoundError(path)
        node = self.nodes[path]
        if flags & self.os.O_NOFOLLOW and stat.S_ISLNK(node['mode']):
            raise OSError(errno.ELOOP, 'modeled symlink')
        if flags & self.os.O_DIRECTORY and not stat.S_ISDIR(node['mode']):
            raise NotADirectoryError(path)
        self.next_fd += 1
        self.fds[self.next_fd] = [path, 0, node]
        self.events.append(('open', path))
        return self.next_fd

    def close(self, fd):
        assert fd in self.fds, ('unknown descriptor', fd)
        del self.fds[fd]

    def info(self, node):
        return types.SimpleNamespace(st_dev=11, st_ino=node['inode'], st_mode=node['mode'],
            st_uid=node['uid'], st_gid=node['gid'], st_nlink=node['links'], st_size=len(node['data']))

    def fstat(self, fd): return self.info(self.fds[fd][2])

    def stat(self, path, dir_fd=None, follow_symlinks=False):
        assert not follow_symlinks
        path = self.path(path, dir_fd)
        if path not in self.nodes:
            raise FileNotFoundError(path)
        return self.info(self.nodes[path])

    def read(self, fd, count):
        path, position, node = self.fds[fd]
        data = node['data'][position:position + count]
        self.fds[fd][1] += len(data)
        if data and self.after_read:
            self.after_read(path)
        return data

    def readlink(self, path, dir_fd=None):
        assert self.path(path, dir_fd) == '/proc/1001/exe'
        return self.exe

    def write(self, fd, data):
        node = self.fds[fd][2]
        node['data'] += bytes(data)
        return len(data)

    def fchmod(self, fd, mode):
        node = self.fds[fd][2]
        node['mode'] = stat.S_IFMT(node['mode']) | mode

    def replace(self, old, new, src_dir_fd=None, dst_dir_fd=None):
        assert src_dir_fd == dst_dir_fd and stat.S_ISDIR(self.fstat(src_dir_fd).st_mode)
        old_path, new_path = self.path(old, src_dir_fd), self.path(new, dst_dir_fd)
        self.nodes[new_path] = self.nodes.pop(old_path)
        self.events.append(('atomic-replace', new_path))

    def unlink(self, path, dir_fd=None):
        path = self.path(path, dir_fd)
        if path not in self.nodes:
            raise FileNotFoundError(path)
        del self.nodes[path]

    def mkdir(self, path, mode, dir_fd=None):
        path = self.path(path, dir_fd)
        if path in self.nodes:
            raise FileExistsError(path)
        self.add(path, directory=True, mode=mode)


def daemon_process_and_protected_atomic_paths():
    def setup():
        ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
        fs = AuthorityFilesystem(ns, run, daemon)
        return ns, value, run, daemon, raw, fs
    ns, value, run, daemon, raw, fs = setup()
    assert ns['ssh_daemon_check'](value, daemon, run['bootId'], run).st_ino == 300
    assert not fs.fds
    for modification, expected in (
            (lambda fs: fs.nodes['/proc/1001/status'].update(data=b'Uid:\t0\t1\t0\t0\n'), 'SSH_DAEMON_IDENTITY'),
            (lambda fs: setattr(fs, 'exe', '/usr/sbin/sshd (deleted)'), 'SSH_DAEMON_IDENTITY'),
            (lambda fs: fs.nodes['/proc/1001/cgroup'].update(data=b'0::/system.slice/other.service\n'), 'SSH_DAEMON_SCOPE'),
            (lambda fs: fs.nodes['/proc/1001/ns/net'].update(inode=201), 'SSH_DAEMON_NETWORK'),
            (lambda fs: fs.nodes['/sys/fs/cgroup/system.slice'].update(uid=20000), 'UNTRUSTED_RECORD')):
        ns, value, run, daemon, raw, fs = setup()
        modification(fs)
        refuses(ns, lambda: ns['ssh_daemon_check'](value, daemon, run['bootId'], run), expected)
        assert not fs.fds
    ns, value, run, daemon, raw, fs = setup()
    def reuse(path):
        if path.endswith('/cmdline'):
            node = fs.nodes['/proc/1001/stat']
            node['data'] = node['data'].replace(b'2001', b'2002')
    fs.after_read = reuse
    refuses(ns, lambda: ns['ssh_daemon_check'](value, daemon, run['bootId'], run), 'SSH_DAEMON_CHANGED')
    assert not fs.fds
    ns, value, run, daemon, raw, fs = setup()
    fs.after_read = lambda path: fs.nodes['/sys/fs/cgroup/system.slice/sakura-ssh-default.service'].update(inode=301) if path.endswith('/cmdline') else None
    refuses(ns, lambda: ns['ssh_daemon_check'](value, daemon, run['bootId'], run), 'CGROUP_REPLACED')
    assert not fs.fds
    ns, value, run, daemon, raw, fs = setup()
    path = ns['ssh_snapshot_path']('default')
    ns['ssh_atomic'](path, raw)
    assert fs.nodes[path]['data'] == raw and stat.S_IMODE(fs.nodes[path]['mode']) == 0o600
    assert fs.events[-2:] == [('atomic-replace', path), ('fsync', '/etc/sakura/ssh/default')]
    assert not fs.fds and all('.record-' not in name for name in fs.nodes)
    for mode, uid, links, expected in ((stat.S_IFLNK | 0o600, 0, 1, 'UNTRUSTED_RECORD'),
                                     (stat.S_IFREG | 0o644, 0, 1, 'RECORD_PERMISSIONS'),
                                     (stat.S_IFREG | 0o600, 20000, 1, 'UNTRUSTED_RECORD'),
                                     (stat.S_IFREG | 0o600, 0, 2, 'RECORD_LINKS')):
        ns, value, run, daemon, raw, fs = setup()
        fs.add(path, b'original')
        fs.nodes[path].update(mode=mode, uid=uid, links=links)
        refuses(ns, lambda: ns['ssh_atomic'](path, raw), expected)
        assert fs.nodes[path]['data'] == b'original' and not fs.fds
    ns, value, run, daemon, raw, fs = setup()
    fs.nodes['/etc/sakura/ssh'].update(mode=stat.S_IFDIR | 0o777)
    refuses(ns, lambda: ns['ssh_atomic'](path, raw), 'UNTRUSTED_RECORD')
    assert path not in fs.nodes and not fs.fds


def receipts_and_interrupted_prepare():
    ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
    assert ns['ssh_receipt_read'](run['runId'], run) == receipt
    refuses(ns, lambda: ns['ssh_receipt_read'](run['runId'], dict(run, cgroupInode='301')), 'SSH_RECEIPT_STALE')
    assert ns['ssh_receipt_read'](run['runId'], dict(run, phase='closed'), closed=True) == receipt
    invalid = copy.deepcopy(receipt)
    invalid['run']['revision'] = True
    records[ns['ssh_receipt_path'](run['runId'])] = json.dumps(invalid).encode()
    refuses(ns, lambda: ns['ssh_receipt_read'](run['runId']), 'SSH_RECEIPT_INVALID')
    del records[ns['ssh_receipt_path'](run['runId'])]
    events, interrupt = [], [True]
    info = types.SimpleNamespace(st_dev=11, st_ino=300)
    def daemon_check(_value, actual, boot, ticket=None):
        assert actual == daemon and boot == run['bootId']
        if ticket is not None:
            assert ticket == run
        events.append('daemon-proof')
        return info
    ns['ssh_daemon_check'] = daemon_check
    def atomic(path, data):
        assert path == ns['ssh_receipt_path'](run['runId'])
        events.append('receipt-publish')
        records[path] = bytes(data)
    ns['ssh_atomic'] = atomic
    def prepare(_value, _request, boot, build, inherit, name, scope_info, publish):
        assert inherit and name == daemon['cgroupName'] and scope_info is info
        publish(copy.deepcopy(run))
        assert 'receipt-publish' in events
        if interrupt[0]:
            interrupt[0] = False
            raise OSError('modeled ticket publication failure')
        events.append('ticket-publish')
        records[ns['run_path'](run['runId'])] = ns['run_bytes'](run)
        return copy.deepcopy(run)
    ns['prepare'] = prepare
    options = dict(request, action='ssh-prepare', daemon=copy.deepcopy(daemon))
    try:
        ns['ssh_prepare'](value, options, run['bootId'], run['build'])
    except OSError:
        pass
    else:
        raise AssertionError('modeled interruption did not happen')
    assert ns['ssh_receipt_read'](run['runId']) == receipt
    assert ns['run_path'](run['runId']) not in records
    # Changing daemon proof after the receipt exists cannot repin the ticket.
    ns['ssh_daemon_check'] = lambda *args: info
    refuses(ns, lambda: ns['ssh_prepare'](value, dict(options, daemon=dict(daemon, startTicks='2002')),
                                        run['bootId'], run['build']), 'SSH_RECEIPT_STALE')
    ns['ssh_daemon_check'] = daemon_check
    assert ns['ssh_prepare'](value, options, run['bootId'], run['build']) == run
    assert events.count('receipt-publish') == 1
    assert events.index('receipt-publish') < events.index('ticket-publish')
    del records[ns['ssh_receipt_path'](run['runId'])]
    refuses(ns, lambda: ns['ssh_prepare'](value, options, run['bootId'], run['build']), 'SSH_RECEIPT_ABSENT')


def snapshot_stdin_deadline_and_eof():
    for content, eof, expected in ((b'{}', True, None), (b'x' * 131073, True, 'SSH_SNAPSHOT_BOUND'),
                                    (b'{}', False, 'SSH_SNAPSHOT_TIMEOUT')):
        ns = fixture()[0]
        pending, flag_events = bytearray(content), []
        ns['fcntl'] = types.SimpleNamespace(F_GETFL=3, F_SETFL=4,
            fcntl=lambda fd, op, *args: flag_events.append((fd, op, args)) or 0)
        def read(fd, count):
            assert fd == 0 and count > 0
            data = bytes(pending[:count])
            del pending[:count]
            return data
        ns['os'] = types.SimpleNamespace(O_ACCMODE=3, O_WRONLY=1, O_NONBLOCK=2048, read=read)
        class Selector:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def register(self, fd, event): assert fd == 0
            def select(self, remaining):
                assert 0 < remaining <= 8
                return [(None, None)] if pending or eof else []
        ns['selectors'] = types.SimpleNamespace(SelectSelector=Selector, EVENT_READ=1)
        if expected:
            refuses(ns, ns['ssh_snapshot_input'], expected)
        else:
            assert ns['ssh_snapshot_input']() == content
        assert flag_events[-1] == (0, 4, (0,)), 'input flags must be restored on every exit'


def session_fixture(action='ssh-session', original="printf 'client command marker'", term='screen'):
    ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
    if action != 'ssh-session':
        request.pop('snapshotSha256')
    request['action'] = action
    events, authority, written, handlers = [], set(), bytearray(), {}
    stdin = types.SimpleNamespace(closed=False, fileno=lambda: 40)
    def close_stdin():
        stdin.closed = True
        events.append('frame-eof')
    stdin.close = close_stdin
    class Child:
        def __init__(self): self.stdin, self.returncode = stdin, None
        def wait(self, timeout=None):
            assert stdin.closed
            assert handlers[2] == 1 and handlers[3] == 1
            assert callable(handlers[1]) and callable(handlers[15])
            events.append('wait')
            self.returncode = 0
            return 0
        def poll(self): return self.returncode
        def send_signal(self, signum): events.append(('child-signal', signum))
        def terminate(self): events.append('child-terminate'); self.returncode = -15
        def kill(self): events.append('child-kill'); self.returncode = -9
    child = Child()
    def spawn(arguments, **options):
        assert not authority, 'metadata/registry authority must be closed before Popen'
        assert handlers[2] != 1 and handlers.get(3, 0) != 1, 'child must not inherit parent SIGINT/SIGQUIT ignores'
        assert options == dict(stdin=subprocess.PIPE, stdout=None, stderr=None,
                               env=ns['CLEAN_ENV'], close_fds=True, pass_fds=(3,))
        assert original not in ' '.join(arguments) and 'project snapshot marker' not in ' '.join(arguments)
        events.append(('spawn', arguments))
        return child
    ns['subprocess'] = types.SimpleNamespace(Popen=spawn, PIPE=subprocess.PIPE, TimeoutExpired=subprocess.TimeoutExpired)
    def close(fd):
        events.append(('close', fd))
        authority.discard(fd)
    def dup(source_fd, target_fd):
        assert (source_fd, target_fd) == (0, 3) and not authority
        events.append('client-fd3')
    def write(fd, data):
        assert fd == 40, 'root only writes the payload pipe'
        written.extend(data)
        return len(data)
    def client_read(*_args): raise AssertionError('root must never read client session stdin')
    ns['os'] = types.SimpleNamespace(environ={'SSH_ORIGINAL_COMMAND': original, 'TERM': term, 'IGNORED_CLIENT_ENV': 'injection'},
        getuid=lambda: 0, geteuid=lambda: 0, path=os.path, close=close, dup2=dup, read=client_read,
        write=write, fstat=lambda fd: types.SimpleNamespace(st_mode=stat.S_IFIFO), O_ACCMODE=3, O_WRONLY=1,
        isatty=lambda fd: False, set_blocking=lambda fd, blocking: events.append(('blocking', fd, blocking)))
    ns['fcntl'] = types.SimpleNamespace(F_GETFL=3, fcntl=lambda *_args: 0)
    def set_signal(signum, handler):
        old = handlers.get(signum, 0)
        handlers[signum] = handler
        return old
    ns['signal'] = types.SimpleNamespace(SIGINT=2, SIGQUIT=3, SIGHUP=1, SIGTERM=15, SIG_IGN=1,
                                       signal=set_signal, getsignal=lambda signum: handlers.get(signum, 0))
    class Selector:
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def register(self, stream, event): assert stream is stdin and event == 2
        def select(self, remaining): assert remaining > 0; return [(None, None)]
    ns['selectors'] = types.SimpleNamespace(DefaultSelector=Selector, EVENT_WRITE=2)
    def readonly():
        events.append('registry-shared')
        authority.add(90)
        return 90
    def exclusive(): raise AssertionError('SSH session must not initialize or take an EX lock')
    def registry(readonly):
        assert readonly is True
        return {'registryId': value['registryId'], 'reserved': {str(value['uid']):
            {'projectId': value['projectId'], 'identityId': value['identityId']}}}
    def network(_value, boot, readonly=False):
        assert readonly is True and boot == run['bootId']
        authority.add(91)
        return 91, types.SimpleNamespace(st_dev=11, st_ino=200), ''
    ns.update(sources=lambda: run['build'], initialize_readonly=readonly, initialize=exclusive,
        registry=registry, active=lambda *_args: copy.deepcopy(value), binding_read=lambda *_args: copy.deepcopy(value),
        run_read=lambda *_args: copy.deepcopy(run), migration_ready=lambda *_args: None,
        network_fd=network, ssh_daemon_check=lambda *_args: events.append('daemon-proof'))
    ns['open'] = lambda path, *args: io.StringIO(run['bootId'] if path.endswith('/boot_id') else '0::/' + run['cgroupName'] + '\n')
    ns['sys'] = types.SimpleNamespace(argv=['controller.py', base64.b64encode(json.dumps(request).encode()).decode()],
        stdout=io.StringIO(), stderr=io.StringIO(), exit=lambda code: (_ for _ in ()).throw(SystemExit(code)))
    return ns, value, run, daemon, records, events, written


def session_descriptor_order_and_stdout():
    ns, value, run, daemon, records, events, written = session_fixture()
    with contextlib.redirect_stdout(io.StringIO()) as output:
        try:
            ns['main']()
        except SystemExit as result:
            assert result.code == 0
        else:
            raise AssertionError('session must exit with child status')
    assert not output.getvalue(), 'successful session must never emit controller JSON on binary stdout'
    assert events.index(('close', 90)) < events.index('client-fd3')
    assert events.index(('close', 91)) < events.index('client-fd3')
    assert events.index(('close', 3)) < events.index('frame-eof')
    assert events.index('frame-eof') < events.index('wait')
    arguments = next(item[1] for item in events if isinstance(item, tuple) and item[0] == 'spawn')
    assert arguments[-1] == hashlib.sha256(written).hexdigest()
    size = struct.unpack('<8sIIIIII', written[:32])[5]
    assert b'client command marker' in written[32:32 + size]
    assert b'snapshot command marker' not in written[32:32 + size]
    assert b'IGNORED_CLIENT_ENV' not in written
    assert ns['os'].environ == ns['CLEAN_ENV']
    # Execute the actual production error guard with an invalid client TERM.
    ns, value, run, daemon, records, events, written = session_fixture(term='invalid\nterm')
    ns['__name__'] = '__main__'
    with contextlib.redirect_stdout(io.StringIO()) as output:
        try:
            exec(compile(guard, 'production-controller-error-guard', 'exec'), ns)
        except SystemExit as result:
            assert result.code == 1
    assert not output.getvalue() and not ns['sys'].stdout.getvalue()
    assert json.loads(ns['sys'].stderr.getvalue())['code'] == 'SSH_TERM_BOUND'
    assert 'client command marker' not in ns['sys'].stderr.getvalue() and not written


def readonly_probe_and_stop_authority():
    ns, value, run, daemon, records, events, written = session_fixture('run-readonly')
    with contextlib.redirect_stdout(io.StringIO()) as output:
        ns['main']()
    assert json.loads(output.getvalue())['result'] == run and 'daemon-proof' in events and not written
    ns, value, run, daemon, records, events, written = session_fixture('run-readonly')
    records[ns['ssh_snapshot_path']('default')] += b' '
    refuses(ns, ns['main'], 'SSH_SNAPSHOT_DIGEST')
    assert not written
    ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
    published, removed, closed = [], [], []
    ns['run_write'] = lambda ticket: published.append(copy.deepcopy(ticket))
    ns['ssh_receipt_retire'] = lambda run_id: removed.append(ns['ssh_receipt_path'](run_id))
    ns['os'] = types.SimpleNamespace(close=lambda fd: closed.append(fd))
    ns['cgroup_fd'] = lambda *_args: 99
    refuses(ns, lambda: ns['stop'](value, run, run['bootId']), 'PROJECT_IDENTITY_CLEANUP_FAILED')
    assert run['phase'] == 'active' and not published and not removed and closed == [99]
    ns['cgroup_fd'] = lambda *_args: None
    def failed_retirement(_run_id):
        raise OSError('modeled unlink/directory fsync failure')
    ns['ssh_receipt_retire'] = failed_retirement
    try:
        ns['stop'](value, run, run['bootId'])
    except OSError:
        pass
    else:
        raise AssertionError('receipt retirement failure must propagate')
    assert run['phase'] == 'active' and not published and not removed
    ns['ssh_receipt_retire'] = lambda run_id: removed.append(ns['ssh_receipt_path'](run_id))
    assert ns['stop'](value, run, run['bootId'])['phase'] == 'closed'
    assert published[0]['phase'] == 'closed' and removed == [ns['ssh_receipt_path'](run['runId'])]


def partial_receipt_cleanup_recovery():
    def setup(group_present=False):
        ns, value, run, daemon, snapshot, raw, request, receipt, records = fixture()
        fs = AuthorityFilesystem(ns, run, daemon)
        if not group_present:
            del fs.nodes[ns['CGROUP'] + '/' + run['cgroupName']]
        fs.add(ns['ssh_receipt_path'](run['runId']), json.dumps(receipt).encode())
        archives, writes, actions = {}, [], []
        def read(path, limit=262144, missing=False):
            if path not in fs.nodes:
                if missing:
                    return None
                ns['refuse']('RECORD_ABSENT')
            node = fs.nodes[path]
            ns['trusted'](fs.info(node), mode=0o600)
            if len(node['data']) > limit:
                ns['refuse']('RECORD_BOUND')
            return node['data']
        def publish(parent, temporary, destination):
            old_path, new_path = fs.path(temporary, parent), fs.path(destination, parent)
            if new_path in fs.nodes:
                ns['refuse']('RUN_ARCHIVE_CONFLICT')
            fs.nodes[new_path] = fs.nodes.pop(old_path)
            actions.append(('publish-original', bytes(fs.nodes[new_path]['data'])))
        def atomic(path, data):
            assert path == ns['run_path'](run['runId'])
            writes.append(ns['run_decode'](run['runId'], bytes(data)))
            fs.nodes[path]['data'] = bytes(data)
            actions.append('publish-closed')
        ns.update(read=read, run_archive_read=lambda run_id: archives.get(run_id),
            run_entries=lambda: [path.rsplit('/', 1)[1] for path in fs.nodes
                if path.startswith(ns['RUNTIME'] + '/runs/') and path.endswith('.bin')],
            run_archive_publish=publish, atomic=atomic)
        real_unlink, real_fsync = fs.os.unlink, fs.os.fsync
        def unlink(path, dir_fd=None):
            full = fs.path(path, dir_fd)
            if full == ns['ssh_receipt_path'](run['runId']):
                actions.append('retire-receipt')
            real_unlink(path, dir_fd)
        def fsync(fd):
            actions.append(('sync', fs.fds[fd][0]))
            real_fsync(fd)
        fs.os.unlink, fs.os.fsync = unlink, fsync
        return ns, value, run, daemon, receipt, fs, archives, writes, actions

    def control(ns, value, run, action):
        request = dict(action=action, projectId=value['projectId'],
            expected={key: value[key] for key in ('registryId', 'identityId', 'revision')}, runId=run['runId'])
        if action == 'ssh-session':
            request['snapshotSha256'] = 'b' * 64
        ns['os'].environ = {}
        ns['os'].getuid = ns['os'].geteuid = lambda: 0
        ns['signal'] = types.SimpleNamespace(SIGTERM=15, SIGINT=2, SIGHUP=1, signal=lambda *_args: None)
        ns['sources'] = lambda: run['build']
        ns['open'] = lambda *args: io.StringIO(run['bootId'])
        ns['initialize'] = ns['initialize_readonly'] = lambda: ns['os'].open('/run', ns['os'].O_RDONLY | ns['os'].O_DIRECTORY)
        ns['registry'] = lambda readonly: {'registryId': value['registryId'], 'reserved': {str(value['uid']):
            {'projectId': value['projectId'], 'identityId': value['identityId']}}}
        ns['binding_read'] = ns['active'] = lambda *_args: copy.deepcopy(value)
        ns['sys'] = types.SimpleNamespace(argv=['controller.py', base64.b64encode(json.dumps(request).encode()).decode()])
        with contextlib.redirect_stdout(io.StringIO()) as output:
            ns['main']()
        return json.loads(output.getvalue())['result']

    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    refuses(ns, lambda: ns['run_read'](run['runId']), 'RECORD_ABSENT')
    assert ns['ssh_cleanup_receipt'](value, run['runId'], run['bootId']) == run
    assert control(ns, value, run, 'run') == run and not writes and not actions
    for action in ('run-readonly', 'status', 'ssh-session'):
        refuses(ns, lambda: control(ns, value, run, action), 'RECORD_ABSENT')
        assert not writes and not actions
    assert not fs.fds
    for field, replacement in (('projectId', '1111111111111111'), ('identityId', str(uuid.uuid4())),
                               ('revision', 2), ('registryId', str(uuid.uuid4()))):
        refuses(ns, lambda: ns['ssh_cleanup_receipt'](dict(value, **{field: replacement}), run['runId'], run['bootId']))
    refuses(ns, lambda: ns['ssh_cleanup_receipt'](value, run['runId'], str(uuid.uuid4())), 'RUN_STALE')
    invalid = copy.deepcopy(receipt)
    invalid['daemon']['pid'] = True
    fs.nodes[ns['ssh_receipt_path'](run['runId'])]['data'] = json.dumps(invalid).encode()
    refuses(ns, lambda: ns['ssh_cleanup_receipt'](value, run['runId'], run['bootId']), 'SSH_DAEMON_INVALID')
    assert not writes

    # The original service group must disappear before any materialization.
    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup(True)
    refuses(ns, lambda: ns['stop'](value, copy.deepcopy(run), run['bootId'], True), 'PROJECT_IDENTITY_CLEANUP_FAILED')
    assert not writes and not actions and ns['run_path'](run['runId']) not in fs.nodes
    assert ns['ssh_receipt_path'](run['runId']) in fs.nodes and not fs.fds

    # Complete partial-receipt cleanup publishes the exact active proof first.
    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    assert control(ns, value, run, 'stop') == dict(run, phase='closed')
    assert actions[0][0] == 'sync' and actions[1] == ('publish-original', ns['run_bytes'](run))
    publication = actions.index(('publish-original', ns['run_bytes'](run)))
    retirement = actions.index('retire-receipt')
    closure = actions.index('publish-closed')
    assert publication < retirement < closure
    assert ('sync', ns['RUNTIME'] + '/runs') in actions[publication + 1:retirement]
    assert ('sync', ns['RUNTIME'] + '/ssh') in actions[retirement + 1:closure]
    assert ns['run_read'](run['runId']) == dict(run, phase='closed')
    assert ns['ssh_receipt_path'](run['runId']) not in fs.nodes and not fs.fds

    # Every interrupted write keeps the original authority recoverable.
    for failure in ('file-fsync', 'run-dir-fsync', 'receipt-unlink', 'receipt-dir-fsync', 'closed-write'):
        ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
        good_fsync, good_unlink, good_atomic = fs.os.fsync, fs.os.unlink, ns['atomic']
        def fsync(fd):
            path = fs.fds[fd][0]
            if (failure == 'file-fsync' and '/runs/.record-' in path) or \
               (failure == 'run-dir-fsync' and path == ns['RUNTIME'] + '/runs') or \
               (failure == 'receipt-dir-fsync' and path == ns['RUNTIME'] + '/ssh'):
                raise OSError('modeled durable write failure')
            good_fsync(fd)
        def unlink(path, dir_fd=None):
            if failure == 'receipt-unlink' and fs.path(path, dir_fd) == ns['ssh_receipt_path'](run['runId']):
                raise OSError('modeled receipt unlink failure')
            good_unlink(path, dir_fd)
        def atomic(path, data):
            if failure == 'closed-write':
                raise OSError('modeled closed-phase write failure')
            good_atomic(path, data)
        fs.os.fsync, fs.os.unlink, ns['atomic'] = fsync, unlink, atomic
        try:
            ns['stop'](value, copy.deepcopy(run), run['bootId'], True)
        except OSError:
            pass
        else:
            raise AssertionError('modeled failure did not happen: ' + failure)
        assert not fs.fds and not writes
        if ns['run_path'](run['runId']) in fs.nodes:
            assert ns['run_read'](run['runId']) == run
        else:
            assert ns['ssh_cleanup_receipt'](value, run['runId'], run['bootId']) == run
        assert all('/runs/.record-' not in path for path in fs.nodes)
        fs.os.fsync, fs.os.unlink, ns['atomic'] = good_fsync, good_unlink, good_atomic
        recovered = control(ns, value, run, 'run')
        assert recovered == run
        assert control(ns, value, run, 'stop') == dict(run, phase='closed')
        assert ns['ssh_receipt_path'](run['runId']) not in fs.nodes

    # Archived UUIDs and conflicting hot originals are never overwritten.
    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    archives[run['runId']] = ns['run_bytes'](dict(run, phase='closed'))
    assert control(ns, value, run, 'run') == dict(run, phase='closed')
    refuses(ns, lambda: ns['stop'](value, copy.deepcopy(run), run['bootId'], True), 'RUN_ARCHIVED')
    assert ns['run_path'](run['runId']) not in fs.nodes and not actions and not writes
    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    original_sync = fs.os.fsync
    foreign = ns['run_bytes'](dict(run, identityId=str(uuid.uuid4())))
    def conflict(fd):
        if '/runs/.record-' in fs.fds[fd][0]:
            fs.add(ns['run_path'](run['runId']), foreign)
        original_sync(fd)
    fs.os.fsync = conflict
    refuses(ns, lambda: ns['stop'](value, copy.deepcopy(run), run['bootId'], True), 'RUN_ARCHIVE_CONFLICT')
    assert fs.nodes[ns['run_path'](run['runId'])]['data'] == foreign
    assert ns['ssh_receipt_path'](run['runId']) in fs.nodes and not writes and not fs.fds

    # A malformed native record is an authority error, never absence fallback.
    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    fs.add(ns['run_path'](run['runId']), b'broken-native-record')
    for action in ('run', 'stop'):
        refuses(ns, lambda: control(ns, value, run, action), 'RUN_SIZE')
    assert not writes and not actions and ns['ssh_receipt_path'](run['runId']) in fs.nodes

    # A tombstone published before final commit prevents materialization too.
    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    original_sync = fs.os.fsync
    def archive_during_sync(fd):
        if '/runs/.record-' in fs.fds[fd][0]:
            archives[run['runId']] = ns['run_bytes'](dict(run, phase='closed'))
        original_sync(fd)
    fs.os.fsync = archive_during_sync
    refuses(ns, lambda: ns['stop'](value, copy.deepcopy(run), run['bootId'], True), 'RUN_ARCHIVED')
    assert ns['run_path'](run['runId']) not in fs.nodes and ns['ssh_receipt_path'](run['runId']) in fs.nodes
    assert not writes and not fs.fds and all('/runs/.record-' not in path for path in fs.nodes)

    ns, value, run, daemon, receipt, fs, archives, writes, actions = setup()
    ns['run_entries'] = lambda: ['occupied'] * ns['RUN_LIMIT']
    refuses(ns, lambda: ns['stop'](value, copy.deepcopy(run), run['bootId'], True), 'RUN_LIMIT')
    assert not actions and not writes and ns['ssh_receipt_path'](run['runId']) in fs.nodes


for check in (snapshot_and_environment_bounds, command_frame_and_identity_environment,
              service_cgroups_and_daemon_arguments, daemon_process_and_protected_atomic_paths,
              receipts_and_interrupted_prepare,
              snapshot_stdin_deadline_and_eof, session_descriptor_order_and_stdout,
              readonly_probe_and_stop_authority, partial_receipt_cleanup_recovery):
    check()
    checks.append(check.__name__)

print(json.dumps({'passed': True, 'kind': 'portable-model-only', 'checks': checks,
                  'sourceSha256': hashlib.sha256(source).hexdigest()}, separators=(',', ':')))
