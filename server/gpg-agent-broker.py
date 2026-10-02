"""Fixed root controller; project command bytes never enter this process.

SO_PEERCRED authenticates the connector, not a later recipient of a passed FD.
An authorized application can deliberately relay requests; this is not a
security boundary against cooperation between processes with the same UID.
"""
import base64
import errno
import fcntl
import hashlib
import json
import os
import re
import select
import signal
import socket
import stat
import struct
import sys
import threading
import time
import uuid

ROOT = '/run/sakura-gpg-forwards'
SOCKETS = '/run/sakura-gpg-sockets'
HOMES = '/run/sakura-gpg-data'
SOURCES = ROOT + '/sources'
RECORDS = ROOT + '/records'
MAX_CONNECTIONS = 8
MAX_TOTAL_CONNECTIONS = 32
MAX_REQUESTS = 128
MAX_SESSION_BYTES = 8 * 1024 * 1024
MAX_LINE = 1000
MAX_WIRE_LINE = 1002
MAX_HOME_ENTRIES = 4096
MAX_HOME_DEPTH = 16
MAX_HOME_DIRECTORIES = 128
MAX_RECORD_BYTES = 262144
FLAGS = os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK


class Refused(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def identifier(value):
    require(isinstance(value, str) and str(uuid.UUID(value)) == value, 'CONTEXT_INVALID')


def context_checked(value):
    require(set(value) == {'resource', 'identity', 'owner', 'sha256'}, 'CONTEXT_INVALID')
    resource, identity, owner = value['resource'], value['identity'], value['owner']
    require(set(resource) == {'version', 'kind', 'leaseId', 'brokerSha256', 'timeoutSeconds',
                             'hostSourceSha256', 'hostHelperSha256'}, 'CONTEXT_INVALID')
    require(type(resource['version']) is int and resource['version'] == 1 and resource['kind'] == 'gpg-agent', 'CONTEXT_INVALID')
    identifier(resource['leaseId']); identifier(owner['runId']); identifier(owner['bootId'])
    require(set(owner) == {'kind', 'runId', 'bootId'} and owner['kind'] == 'task', 'CONTEXT_INVALID')
    require(type(resource['timeoutSeconds']) is int and 1 <= resource['timeoutSeconds'] <= 300, 'CONTEXT_INVALID')
    require(re.fullmatch('[a-f0-9]{64}', resource['brokerSha256']) and re.fullmatch('[a-f0-9]{64}', value['sha256']), 'CONTEXT_INVALID')
    for name in ['hostSourceSha256', 'hostHelperSha256']:
        require(isinstance(resource[name], str) and re.fullmatch('[a-f0-9]{64}', resource[name]), 'CONTEXT_INVALID')
    required = {'version', 'phase', 'registryId', 'projectId', 'identityId', 'revision', 'account', 'uid', 'gid',
                'home', 'directory', 'directoryDevice', 'directoryInode', 'homeDevice', 'homeInode', 'networkIsolation'}
    require(set(identity) == required and type(identity['version']) is int and identity['version'] == 1 and identity['phase'] == 'active', 'CONTEXT_INVALID')
    identifier(identity['registryId']); identifier(identity['identityId'])
    require(identity['projectId'] == 'default' or re.fullmatch('[a-f0-9]{16}', identity['projectId']), 'CONTEXT_INVALID')
    require(type(identity['uid']) is int and 20000 <= identity['uid'] <= 59999 and identity['gid'] == identity['uid'], 'CONTEXT_INVALID')
    require(identity['account'] == 'skp' + identity['identityId'].replace('-', '')[:24] and
            identity['home'] == '/var/lib/sakura-project-homes/' + identity['identityId'], 'CONTEXT_INVALID')
    require(type(identity['revision']) is int and identity['revision'] > 0 and identity['networkIsolation'] in ['host', 'private'], 'CONTEXT_INVALID')
    for key in ['directoryDevice', 'directoryInode', 'homeDevice', 'homeInode']:
        require(isinstance(identity[key], str) and re.fullmatch('0|[1-9][0-9]*', identity[key]), 'CONTEXT_INVALID')
    return value


def boot():
    with open('/proc/sys/kernel/random/boot_id', encoding='ascii') as source:
        value = source.read(64).strip()
    identifier(value)
    return value


def info(value):
    return {'device': str(value.st_dev), 'inode': str(value.st_ino), 'uid': value.st_uid,
            'gid': value.st_gid, 'mode': stat.S_IMODE(value.st_mode), 'type': stat.S_IFMT(value.st_mode)}


def directory(path, mode=None, gid=0, create=False, source=False):
    require(path.startswith('/') and all(part not in ['', '.', '..'] for part in path.split('/')[1:]), 'PATH_INVALID')
    current = os.open('/', os.O_RDONLY | os.O_DIRECTORY | FLAGS)
    try:
        prefix = ''
        for part in path.split('/')[1:]:
            prefix += '/' + part
            try:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=current)
            except FileNotFoundError:
                require(create and prefix == path, 'DIRECTORY_ABSENT')
                os.mkdir(part, 0o700 if mode is None else mode, dir_fd=current)
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=current)
                os.fsync(current)
            os.close(current); current = child
            value = os.fstat(current)
            require(stat.S_ISDIR(value.st_mode) and value.st_uid == 0, 'DIRECTORY_OWNER')
            if source and prefix in ['/tmp', '/var/tmp']:
                require(value.st_gid == 0 and stat.S_IMODE(value.st_mode) == 0o1777, 'SOURCE_PARENT')
            elif prefix == path and mode is not None:
                require(value.st_gid == gid and stat.S_IMODE(value.st_mode) == mode, 'DIRECTORY_OWNER')
            else:
                require(value.st_gid == 0 and not stat.S_IMODE(value.st_mode) & 0o022, 'DIRECTORY_OWNER')
        return current
    except BaseException:
        os.close(current)
        raise


def regular(parent, name, size=MAX_RECORD_BYTES):
    fd = os.open(name, os.O_RDONLY | FLAGS, dir_fd=parent)
    try:
        value = os.fstat(fd)
        require(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and value.st_gid == 0 and
                value.st_nlink == 1 and stat.S_IMODE(value.st_mode) == 0o600 and value.st_size <= size, 'RECORD_OWNER')
        data = os.read(fd, size + 1)
        require(len(data) == value.st_size and not os.read(fd, 1) and info(os.fstat(fd)) == info(value), 'RECORD_CHANGED')
        return data
    finally:
        os.close(fd)


def record_name(context):
    return context['resource']['leaseId'] + '.json'


def source_path(context):
    return SOURCES + '/' + context['resource']['leaseId'] + '/agent'


def endpoint_path(context):
    return SOCKETS + '/' + context['resource']['leaseId']


def home_path(context):
    return HOMES + '/' + context['resource']['leaseId'] + '/home'


def redirect_bytes(context):
    return ('%Assuan%\nsocket=' + endpoint_path(context) + '/agent\n').encode('ascii')


def recorded_object(value):
    require(isinstance(value, dict) and set(value) == {'device', 'inode', 'uid', 'gid', 'mode', 'type'}, 'RECORD_INVALID')
    for name in ['device', 'inode']:
        require(isinstance(value[name], str) and re.fullmatch('0|[1-9][0-9]*', value[name]), 'RECORD_INVALID')
    require(all(type(value[name]) is int for name in ['uid', 'gid', 'mode', 'type']) and
            min(value['uid'], value['gid']) >= 0 and 0 <= value['mode'] <= 0o7777, 'RECORD_INVALID')


def recorded_process(value):
    require(isinstance(value, dict) and set(value) == {'pid', 'startTicks'} and
            type(value['pid']) is int and value['pid'] > 1 and isinstance(value['startTicks'], str) and
            re.fullmatch('0|[1-9][0-9]*', value['startTicks']), 'RECORD_INVALID')


def record_checked(value, context):
    require(isinstance(value, dict) and set(value) == {'version', 'context', 'phase', 'scope', 'sourceDirectory', 'source',
            'endpointDirectory', 'endpoint', 'homeDirectory', 'home', 'redirect', 'broker', 'homeCleanup', 'failure'}, 'RECORD_INVALID')
    require(type(value['version']) is int and value['version'] == 1 and value['context'] == context and
            value['phase'] in ['prepared', 'preparing', 'ready', 'failed', 'closed'], 'RECORD_CHANGED')
    scope = value['scope']
    if scope is not None:
        require(isinstance(scope, dict) and set(scope) == {'device', 'inode', 'controlToken'}, 'RECORD_INVALID')
        identifier(scope['controlToken'])
        for name in ['device', 'inode']:
            require(isinstance(scope[name], str) and re.fullmatch('0|[1-9][0-9]*', scope[name]), 'RECORD_INVALID')
    source = value['source']
    if source is not None:
        require(isinstance(source, dict) and set(source) == {'path', 'parent', 'socket', 'peer'} and
                source['path'] == source_path(context), 'RECORD_INVALID')
        recorded_object(source['parent']); recorded_object(source['socket']); recorded_process(source['peer'])
        require(source['parent'] == value['sourceDirectory'], 'RECORD_CHANGED')
    for name in ['sourceDirectory', 'endpointDirectory', 'endpoint', 'homeDirectory', 'home']:
        if value[name] is not None: recorded_object(value[name])
    expected_objects = {'sourceDirectory': (0, 0, 0o700, stat.S_IFDIR),
        'endpointDirectory': (0, context['identity']['gid'], 0o710, stat.S_IFDIR),
        'endpoint': (0, context['identity']['gid'], 0o660, stat.S_IFSOCK),
        'homeDirectory': (0, context['identity']['gid'], 0o710, stat.S_IFDIR),
        'home': (context['identity']['uid'], context['identity']['gid'], 0o700, stat.S_IFDIR)}
    for name, expected in expected_objects.items():
        if value[name] is not None:
            require(tuple(value[name][field] for field in ['uid', 'gid', 'mode', 'type']) == expected, 'RECORD_INVALID')
    if source is not None:
        require(source['socket']['uid'] == 0 and source['socket']['gid'] == 0 and source['socket']['type'] == stat.S_IFSOCK, 'RECORD_INVALID')
    if value['redirect'] is not None:
        redirection = value['redirect']
        require(isinstance(redirection, dict) and set(redirection) == {'object', 'sha256'} and
                redirection['sha256'] == hashlib.sha256(redirect_bytes(context)).hexdigest(), 'RECORD_INVALID')
        recorded_object(redirection['object'])
        require(tuple(redirection['object'][field] for field in ['uid', 'gid', 'mode', 'type']) ==
                (0, context['identity']['gid'], 0o440, stat.S_IFREG), 'RECORD_INVALID')
    if value['homeCleanup'] is not None:
        transition = value['homeCleanup']
        require(isinstance(transition, dict) and set(transition) == {'phase', 'frozenHome', 'directories'} and
                transition['phase'] in ['freeze-intent', 'frozen', 'removing', 'removed'] and value['home'] is not None, 'RECORD_INVALID')
        frozen = transition['frozenHome']
        if frozen is not None:
            recorded_object(frozen)
            require(frozen == {**value['home'], 'uid': 0, 'gid': 0, 'mode': 0o700}, 'RECORD_CHANGED')
        require(transition['phase'] == 'freeze-intent' or frozen is not None, 'RECORD_INVALID')
        directories = transition['directories']
        require(isinstance(directories, list) and len(directories) <= MAX_HOME_DIRECTORIES, 'RECORD_INVALID')
        paths = set()
        for child in directories:
            require(isinstance(child, dict) and set(child) == {'path', 'phase', 'original', 'frozen'} and
                    child['phase'] in ['freeze-intent', 'frozen', 'removed'] and isinstance(child['path'], list) and
                    1 <= len(child['path']) <= MAX_HOME_DEPTH and all(valid_data_name(part) for part in child['path']), 'RECORD_INVALID')
            key = tuple(child['path']); require(key not in paths, 'RECORD_INVALID'); paths.add(key)
            recorded_object(child['original']); recorded_object(child['frozen'])
            require(child['original']['uid'] == context['identity']['uid'] and child['original']['gid'] == context['identity']['gid'] and
                    child['original']['type'] == stat.S_IFDIR and
                    child['frozen'] == {**child['original'], 'uid': 0, 'gid': 0, 'mode': 0o700}, 'RECORD_INVALID')
    if value['broker'] is not None: recorded_process(value['broker'])
    require(value['failure'] is None or (isinstance(value['failure'], str) and
            re.fullmatch('[A-Z][A-Z0-9_]{0,79}', value['failure'])), 'RECORD_INVALID')
    require(value['phase'] != 'ready' or (all(value[name] is not None for name in
            ['scope', 'sourceDirectory', 'source', 'endpointDirectory', 'endpoint', 'homeDirectory', 'home', 'redirect', 'broker'])
            and value['failure'] is None), 'RECORD_INVALID')
    require(value['phase'] != 'prepared' or (value['scope'] is None and value['sourceDirectory'] is not None and
            all(value[name] is None for name in ['source', 'endpointDirectory', 'endpoint', 'homeDirectory', 'home',
                                               'redirect', 'broker', 'homeCleanup', 'failure'])), 'RECORD_INVALID')
    return value


def read_record(context):
    if not os.path.lexists(RECORDS):
        return None
    parent = directory(RECORDS, 0o700)
    try:
        try:
            value = json.loads(regular(parent, record_name(context)).decode('utf-8'))
        except FileNotFoundError:
            return None
        return record_checked(value, context)
    finally:
        os.close(parent)


def save_record(value):
    record_checked(value, value['context'])
    raw = json.dumps(value, separators=(',', ':')).encode('utf-8')
    require(len(raw) <= MAX_RECORD_BYTES, 'RECORD_BUDGET')
    parent = directory(RECORDS, 0o700)
    name = '.write-' + str(uuid.uuid4())
    try:
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | FLAGS, 0o600, dir_fd=parent)
        with os.fdopen(fd, 'wb') as target:
            target.write(raw)
            target.flush(); os.fsync(target.fileno())
        # A root-only directory and the checked existing context prevent an
        # unrelated resource from being replaced by this phase transition.
        record_checked(value, value['context']); prior = read_record(value['context'])
        require(prior is None or prior['context'] == value['context'], 'RECORD_CHANGED')
        os.rename(name, record_name(value['context']), src_dir_fd=parent, dst_dir_fd=parent)
        os.fsync(parent)
    finally:
        os.close(parent)


def locked(create=False):
    os.close(directory('/run'))
    os.close(directory(ROOT, 0o700, create=create))
    os.close(directory(RECORDS, 0o700, create=create))
    parent = directory(ROOT, 0o700)
    try:
        fd = os.open('resources.lock', os.O_RDWR | (os.O_CREAT if create else 0) | FLAGS, 0o600, dir_fd=parent)
        value = os.fstat(fd)
        require(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and value.st_gid == 0 and
                value.st_nlink == 1 and stat.S_IMODE(value.st_mode) == 0o600, 'LOCK_OWNER')
        fcntl.flock(fd, fcntl.LOCK_EX)
        return fd
    finally:
        os.close(parent)


def scope_path(context):
    return '/sys/fs/cgroup/sakura-task-' + context['owner']['runId']


def task_scope(context):
    require(boot() == context['owner']['bootId'], 'BOOT_CHANGED')
    with open('/proc/self/mountinfo', encoding='ascii') as mounts:
        require(any(line.split()[4] == '/sys/fs/cgroup' and ' - cgroup2 ' in line for line in mounts), 'CGROUP_UNAVAILABLE')
    parent = directory('/run/sakura-guest-tasks', 0o700)
    os.close(parent)
    parent = directory('/run/sakura-guest-tasks/' + context['owner']['runId'], 0o700)
    try:
        ownership = regular(parent, '.sakura-job-' + context['owner']['runId'] + '.pid.scope', 256).decode('ascii').split()
        owner = regular(parent, 'owner', 256).decode('ascii').split()
        require(len(ownership) == 4 and ownership[:3] == ['2', context['owner']['bootId'], 'sakura-task-' + context['owner']['runId']], 'TASK_OWNER')
        require(len(owner) == 3 and owner[0] == '1' and owner[2] == context['owner']['bootId'], 'TASK_OWNER')
        identifier(owner[1])
    finally:
        os.close(parent)
    fd = directory(scope_path(context))
    value = os.fstat(fd)
    require(str(value.st_ino) == ownership[3], 'CGROUP_CHANGED')
    return fd, {'device': str(value.st_dev), 'inode': str(value.st_ino), 'controlToken': owner[1]}


class Process:
    def __init__(self, pid):
        self.pid = pid
        self.pidfd = None; self.directory = None
        try:
            self.pidfd = os.pidfd_open(pid, 0)
            self.directory = os.open('/proc/' + str(pid), os.O_RDONLY | os.O_DIRECTORY | FLAGS)
            fields = self.read('stat', 4096).rsplit(b') ', 1)[1].split()
            require(len(fields) >= 20 and fields[19].isdigit(), 'PROCESS_INVALID')
            self.start = fields[19].decode('ascii')
            self.alive()
        except BaseException:
            self.close()
            raise

    def close(self):
        for name in ['directory', 'pidfd']:
            value = getattr(self, name, None)
            if value is not None:
                setattr(self, name, None); os.close(value)

    def read(self, name, limit):
        fd = os.open(name, os.O_RDONLY | FLAGS, dir_fd=self.directory)
        try:
            value = os.read(fd, limit + 1)
            require(len(value) <= limit, 'PROCESS_INVALID')
            return value
        finally:
            os.close(fd)

    def alive(self):
        require(not select.select([self.pidfd], [], [], 0)[0], 'PROCESS_EXITED')
        fields = self.read('stat', 4096).rsplit(b') ', 1)[1].split()
        require(len(fields) >= 20 and fields[0] != b'Z' and fields[19].decode('ascii') == self.start, 'PROCESS_CHANGED')

    def task(self, context, scope):
        self.alive()
        values = dict(line.split(b':', 1) for line in self.read('status', 65536).splitlines() if b':' in line)
        identity = context['identity']
        require(values.get(b'Uid', b'').split() == [str(identity['uid']).encode()] * 4 and
                values.get(b'Gid', b'').split() == [str(identity['gid']).encode()] * 4, 'PEER_ACCOUNT')
        require(values.get(b'NoNewPrivs', b'').strip() == b'1' and not values.get(b'Groups', b'').split() and
                all(int(values.get(name, b'1').strip(), 16) == 0 for name in
                    [b'CapInh', b'CapPrm', b'CapEff', b'CapBnd', b'CapAmb']), 'PEER_PRIVILEGES')
        expected = ('0::/sakura-task-' + context['owner']['runId']).encode()
        require(self.read('cgroup', 4096).splitlines() == [expected], 'PEER_SCOPE')
        self.alive()
        require(boot() == context['owner']['bootId'], 'BOOT_CHANGED')
        fd = directory(scope_path(context))
        try:
            value = os.fstat(fd)
            require(str(value.st_dev) == scope['device'] and str(value.st_ino) == scope['inode'], 'CGROUP_CHANGED')
        finally:
            os.close(fd)

    def root(self):
        self.alive()
        values = dict(line.split(b':', 1) for line in self.read('status', 65536).splitlines() if b':' in line)
        require(values.get(b'Uid', b'').split() == [b'0'] * 4 and
                values.get(b'Gid', b'').split() == [b'0'] * 4, 'SOURCE_PEER_ACCOUNT')
        self.alive()


def credentials(stream):
    return struct.unpack('3i', stream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))


class Source:
    def __init__(self, path):
        require(isinstance(path, str) and 0 < len(path.encode()) < 108 and not re.search('[\x00-\x20\x7f]', path), 'SOURCE_INVALID')
        self.path = path
        self.parent_path, self.name = path.rsplit('/', 1)
        self.parent = None; self.peer = None
        try:
            self.parent = directory(self.parent_path, 0o700, source=True)
            self.parent_info = info(os.fstat(self.parent))
            self.socket_info = self.current()
            # Older sshd creates this listener with its inherited umask. The
            # root0700 parent controls access; never chmod sshd's socket. Pin
            # its complete metadata, including mode, for every later check.
            require(self.socket_info['type'] == stat.S_IFSOCK and self.socket_info['uid'] == 0 and
                    self.socket_info['gid'] == 0, 'SOURCE_OWNER')
            probe = self.connect_raw()
            try:
                pid, uid, gid = credentials(probe)
                require(pid > 1 and uid == 0 and gid == 0, 'SOURCE_PEER')
                self.peer = Process(pid)
            finally:
                probe.close()
            self.check()
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.parent is not None: os.close(self.parent); self.parent = None
        if self.peer is not None: self.peer.close(); self.peer = None

    def current(self):
        return info(os.stat(self.name, dir_fd=self.parent, follow_symlinks=False))

    def check(self):
        fd = directory(self.parent_path, 0o700, source=True)
        try:
            require(info(os.fstat(fd)) == self.parent_info and self.current() == self.socket_info, 'SOURCE_REPLACED')
        finally:
            os.close(fd)
        self.peer.root()

    def connect_raw(self):
        stream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        stream.settimeout(3)
        try:
            stream.connect('/proc/self/fd/' + str(self.parent) + '/' + self.name)
            return stream
        except BaseException:
            stream.close()
            raise

    def connect(self):
        self.check()
        stream = self.connect_raw()
        try:
            require(credentials(stream) == (self.peer.pid, 0, 0), 'SOURCE_PEER_CHANGED')
            self.check()
            return stream
        except BaseException:
            stream.close()
            raise

    def record(self):
        return {'path': self.path, 'parent': self.parent_info, 'socket': self.socket_info,
                'peer': {'pid': self.peer.pid, 'startTicks': self.peer.start}}


class Lines:
    def __init__(self, stream):
        self.stream = stream
        self.pending = bytearray()
        self.partial_since = None
        self.received = 0

    def available(self):
        return b'\n' in self.pending

    def take(self):
        end = self.pending.find(b'\n')
        require(end >= 0 and end + 1 <= MAX_WIRE_LINE, 'PROTOCOL_SIZE')
        wire = bytes(self.pending[:end + 1]); del self.pending[:end + 1]
        content = wire[:-1]
        if content.endswith(b'\r'): content = content[:-1]
        require(len(content) <= MAX_LINE, 'PROTOCOL_SIZE')
        if not self.pending: self.partial_since = None
        return wire, content

    def receive(self):
        # No file descriptor can travel through SSH StreamLocal. Close any
        # locally supplied ancillary FD before refusing, including truncation.
        piece, ancillary, flags, _address = self.stream.recvmsg( min(65536 - len(self.pending), 65536),
            socket.CMSG_SPACE(32), getattr(socket, 'MSG_CMSG_CLOEXEC', 0))
        for level, kind, data in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                size = struct.calcsize('i'); usable = len(data) // size * size
                for fd in struct.unpack('i' * (usable // size), data[:usable]): os.close(fd)
        require(not ancillary and not flags & socket.MSG_CTRUNC, 'PROTOCOL_ANCILLARY')
        require(piece, 'PROTOCOL_CLOSED')
        if not self.pending: self.partial_since = time.monotonic()
        self.pending.extend(piece); self.received += len(piece)
        require(len(self.pending) <= 65536, 'PROTOCOL_BUFFER')
        # Complete coalesced lines are checked separately before each release.
        tail = self.pending.rsplit(b'\n', 1)[-1]
        require(len(tail) <= MAX_WIRE_LINE - 1, 'PROTOCOL_SIZE')

    def progress(self):
        if self.pending and not self.available():
            require(self.partial_since is not None and time.monotonic() - self.partial_since < 10, 'PROTOCOL_TIMEOUT')


def exact_send(stream, data, deadline, check):
    offset = 0
    while offset < len(data):
        check()
        remaining = deadline - time.monotonic()
        require(remaining > 0, 'PROTOCOL_TIMEOUT')
        if not select.select([], [stream], [], min(remaining, 1))[1]: continue
        try:
            sent = stream.send(data[offset:offset + 65536])
        except (socket.timeout, BlockingIOError):
            continue
        require(sent > 0, 'PROTOCOL_CLOSED')
        offset += sent
    check()


def relay(stream, upstream, deadline, check):
    client, server = Lines(stream), Lines(upstream)
    stream.setblocking(False); upstream.setblocking(False)
    state = 'greeting'; requests = 0; bye = False
    while True:
        check(); require(time.monotonic() < deadline, 'PROTOCOL_TIMEOUT')
        client.progress(); server.progress()
        require(client.received + server.received <= MAX_SESSION_BYTES, 'PROTOCOL_BUDGET')
        # Never release a buffered next command until the previous terminal
        # reply. While inquiring, both sides may send status/data fragments.
        eligible = [server] + ([client] if state in ['idle', 'inquiry'] else [])
        reader = next((value for value in eligible if value.available()), None)
        if reader is None:
            readable = [value.stream for value in [server, client] if len(value.pending) < 65536]
            ready = select.select(readable, [], [], min(1, max(0, deadline - time.monotonic())))[0]
            for value in [server, client]:
                if value.stream in ready:
                    check()
                    try: value.receive()
                    except BlockingIOError: continue
                    check()
            continue
        check(); wire, content = reader.take(); check()
        data = content == b'D' or content.startswith(b'D ')
        comment = not content or content.startswith(b'#')
        if reader is server:
            status = content.startswith(b'S ')
            okay = content == b'OK' or content.startswith(b'OK ')
            error = content.startswith(b'ERR ') and re.match(br'^ERR [0-9]+(?: |$)', content)
            inquire = content.startswith(b'INQUIRE ') and len(content) > 8
            require(data or comment or status or okay or error or inquire, 'PROTOCOL_RESPONSE')
            require(not (state == 'greeting' and (data or inquire or error)), 'PROTOCOL_GREETING')
            require(state != 'idle' or comment or status, 'PROTOCOL_STATE')
            if not data: require(b'\x00' not in content, 'PROTOCOL_CONTROL')
            if inquire: require(state == 'server', 'PROTOCOL_STATE')
            check(); exact_send(stream, wire, deadline, check)
            if okay or error:
                if bye: return
                state = 'idle'
            elif inquire:
                state = 'inquiry'
        else:
            if comment:
                check(); exact_send(upstream, wire, deadline, check); continue
            if state == 'inquiry':
                require(data or content in [b'END', b'CAN'], 'PROTOCOL_INQUIRY')
                if not data: state = 'server'
            else:
                require(not data and b'\x00' not in content, 'PROTOCOL_COMMAND')
                command = content.split(b' ', 1)[0]
                require(re.fullmatch(br'[A-Z][A-Z0-9_]*', command) and command not in
                        [b'INPUT', b'OUTPUT', b'END', b'CAN'], 'PROTOCOL_COMMAND')
                requests += 1; require(requests <= MAX_REQUESTS, 'PROTOCOL_REQUEST_BUDGET')
                bye = command == b'BYE'; state = 'server'
            check(); exact_send(upstream, wire, deadline, check)


def publish_root(path):
    if not os.path.lexists(path):
        os.mkdir(path, 0o700)
        fd = directory(path, 0o700)
        try: os.fchmod(fd, 0o755); os.fsync(fd)
        finally: os.close(fd)
    os.close(directory(path, 0o755))


def create_lease_parent(path, gid):
    require(not os.path.lexists(path), 'RESOURCE_EXISTS')
    os.mkdir(path, 0o700)
    fd = directory(path, 0o700)
    try:
        os.fchown(fd, 0, gid); os.fchmod(fd, 0o710); os.fsync(fd)
        return info(os.fstat(fd))
    finally: os.close(fd)


def home_open(value, frozen=False):
    context = value['context']; parent_path = home_path(context).rsplit('/', 1)[0]
    parent = directory(parent_path, 0o710, context['identity']['gid'])
    try:
        require(info(os.fstat(parent)) == value['homeDirectory'], 'HOME_PARENT_REPLACED')
        fd = os.open('home', os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=parent)
        current = info(os.fstat(fd))
        expected = {**value['home'], 'uid': 0, 'gid': 0, 'mode': 0o700} if frozen else value['home']
        require(current == expected and info(os.stat('home', dir_fd=parent, follow_symlinks=False)) == current, 'HOME_REPLACED')
        return fd
    except BaseException:
        if 'fd' in locals(): os.close(fd)
        raise
    finally: os.close(parent)


def routing_checked(value, home):
    expected = value['redirect']; context = value['context']
    require(expected is not None, 'REDIRECT_UNCONFIRMED')
    fd = os.open('S.gpg-agent', os.O_RDONLY | FLAGS, dir_fd=home)
    try:
        meta = os.fstat(fd)
        require(info(meta) == expected['object'] and stat.S_ISREG(meta.st_mode) and meta.st_nlink == 1 and
                meta.st_uid == 0 and meta.st_gid == context['identity']['gid'] and stat.S_IMODE(meta.st_mode) == 0o440 and
                meta.st_size == len(redirect_bytes(context)), 'REDIRECT_REPLACED')
        body = os.read(fd, 512)
        require(body == redirect_bytes(context) and not os.read(fd, 1) and
                info(os.fstat(fd)) == expected['object'], 'REDIRECT_REPLACED')
        require(info(os.stat('S.gpg-agent', dir_fd=home, follow_symlinks=False)) == expected['object'], 'REDIRECT_REPLACED')
    finally: os.close(fd)


def create_home(context, value):
    publish_root(HOMES)
    parent_path = home_path(context).rsplit('/', 1)[0]
    value['homeDirectory'] = create_lease_parent(parent_path, context['identity']['gid']); save_record(value)
    parent = directory(parent_path, 0o710, context['identity']['gid'])
    home = None
    try:
        os.mkdir('home', 0o700, dir_fd=parent)
        home = os.open('home', os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=parent)
        os.fchown(home, context['identity']['uid'], context['identity']['gid']); os.fchmod(home, 0o700)
        value['home'] = info(os.fstat(home)); os.fsync(parent); save_record(value)
        fd = os.open('S.gpg-agent', os.O_WRONLY | os.O_CREAT | os.O_EXCL | FLAGS, 0o600, dir_fd=home)
        try:
            body = redirect_bytes(context); require(len(body) <= 511, 'REDIRECT_SIZE')
            with os.fdopen(fd, 'wb', closefd=False) as target:
                target.write(body); target.flush()
            os.fchown(fd, 0, context['identity']['gid']); os.fchmod(fd, 0o440); os.fsync(fd)
            value['redirect'] = {'object': info(os.fstat(fd)), 'sha256': hashlib.sha256(body).hexdigest()}
            os.fsync(home); save_record(value)
        finally: os.close(fd)
    finally:
        if home is not None: os.close(home)
        os.close(parent)


def source_exclusive(context, source):
    # The caller holds resources.lock while choosing a physical listener.
    records = directory(RECORDS, 0o700)
    try:
        names = os.listdir(records); require(len(names) <= 1024, 'RESOURCE_LIMIT')
        for name in names:
            if not name.endswith('.json') or name == record_name(context):
                continue
            other = json.loads(regular(records, name).decode('utf-8'))
            other_context = context_checked(other['context'])
            require(name == record_name(other_context), 'OTHER_RESOURCE_UNCONFIRMED')
            record_checked(other, other_context)
            require(other['phase'] == 'closed' or other['source'] != source, 'SOURCE_SHARED')
    finally:
        os.close(records)


def broker(context, value, lock):
    source = None; listener = None; endpoint_fd = None
    stopped = threading.Event(); peers = set(); mutex = threading.Lock()
    def stop(_signal, _frame):
        stopped.set()
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGHUP, stop); signal.signal(signal.SIGINT, stop)
    try:
        process = Process(os.getpid())
        value['broker'] = {'pid': process.pid, 'startTicks': process.start}; process.close(); save_record(value)
        source = Source(source_path(context))
        require(source.parent_info == value['sourceDirectory'], 'SOURCE_REPLACED')
        value['source'] = source.record(); save_record(value)
        source_exclusive(context, value['source'])
        publish_root(SOCKETS)
        endpoint = endpoint_path(context)
        value['endpointDirectory'] = create_lease_parent(endpoint, context['identity']['gid']); save_record(value)
        endpoint_fd = directory(endpoint, 0o710, context['identity']['gid'])
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind('/proc/self/fd/' + str(endpoint_fd) + '/agent')
        current = os.stat('agent', dir_fd=endpoint_fd, follow_symlinks=False)
        require(stat.S_ISSOCK(current.st_mode), 'ENDPOINT_INVALID')
        os.chown('agent', 0, context['identity']['gid'], dir_fd=endpoint_fd, follow_symlinks=False)
        os.chmod('agent', 0o660, dir_fd=endpoint_fd, follow_symlinks=False)
        value['endpoint'] = info(os.stat('agent', dir_fd=endpoint_fd, follow_symlinks=False))
        create_home(context, value)
        listener.listen(MAX_CONNECTIONS); listener.settimeout(0.25)
        source.check(); value['phase'] = 'ready'; save_record(value)
        fcntl.flock(lock, fcntl.LOCK_UN); os.close(lock); lock = None
        deadline = time.monotonic() + context['resource']['timeoutSeconds'] + 15
        def serve(stream):
            peer = None; upstream = None
            try:
                pid, uid, gid = credentials(stream)
                require(uid == context['identity']['uid'] and gid == context['identity']['gid'], 'PEER_ACCOUNT')
                peer = Process(pid)
                def check():
                    require(not stopped.is_set() and time.monotonic() < deadline, 'RESOURCE_REVOKED')
                    peer.task(context, value['scope']); source.check()
                    current = read_record(context)
                    require(current == value and current['homeCleanup'] is None, 'RESOURCE_CHANGED')
                    fd = directory(endpoint, 0o710, context['identity']['gid'])
                    try:
                        require(info(os.fstat(fd)) == value['endpointDirectory'] and
                                info(os.stat('agent', dir_fd=fd, follow_symlinks=False)) == value['endpoint'], 'ENDPOINT_REPLACED')
                    finally:
                        os.close(fd)
                    home = home_open(value)
                    try: routing_checked(value, home)
                    finally: os.close(home)
                check(); upstream = source.connect(); check()
                relay(stream, upstream, deadline, check)
            except (Refused, OSError, ValueError, IndexError):
                pass
            finally:
                if upstream is not None: upstream.close()
                if peer is not None: peer.close()
                stream.close()
                with mutex: peers.discard(stream)
        connections = 0
        while not stopped.is_set() and time.monotonic() < deadline:
            source.check()
            try:
                stream, _ = listener.accept()
            except socket.timeout:
                continue
            with mutex:
                connections += 1
                if len(peers) >= MAX_CONNECTIONS or connections > MAX_TOTAL_CONNECTIONS: stream.close(); continue
                peers.add(stream)
            threading.Thread(target=serve, args=(stream,), daemon=True).start()
    except BaseException as error:
        value['phase'] = 'failed'; value['failure'] = str(error) if isinstance(error, Refused) else 'BROKER_FAILED'
        try: save_record(value)
        except BaseException: pass
    finally:
        stopped.set()
        with mutex:
            for stream in peers: stream.close()
        if listener is not None: listener.close()
        if endpoint_fd is not None: os.close(endpoint_fd)
        if source is not None: source.close()
        if lock is not None: os.close(lock)


def initial_record(context):
    return {'version': 1, 'context': context, 'phase': 'preparing', 'scope': None, 'sourceDirectory': None,
            'source': None, 'endpointDirectory': None, 'endpoint': None, 'homeDirectory': None, 'home': None,
            'redirect': None, 'broker': None, 'homeCleanup': None, 'failure': None}


def prepare(context):
    require(boot() == context['owner']['bootId'], 'BOOT_CHANGED')
    require(not os.path.lexists(scope_path(context)), 'SCOPE_ACTIVE')
    lock = locked(create=True)
    value = None
    try:
        prior = read_record(context)
        if prior is not None:
            require(prior['phase'] == 'prepared' and prior['scope'] is None and prior['homeCleanup'] is None, 'RESOURCE_EXISTS')
            parent = directory(source_path(context).rsplit('/', 1)[0], 0o700)
            try:
                require(info(os.fstat(parent)) == prior['sourceDirectory'] and not os.listdir(parent), 'SOURCE_REPLACED')
            finally: os.close(parent)
            return {'phase': 'prepared', 'context': context, 'sourcePath': source_path(context), 'record': prior}
        for path in [source_path(context).rsplit('/', 1)[0], endpoint_path(context), home_path(context).rsplit('/', 1)[0]]:
            require(not os.path.lexists(path), 'RESOURCE_EXISTS')
        value = initial_record(context); save_record(value)
        os.close(directory(SOURCES, 0o700, create=True))
        parent_path = source_path(context).rsplit('/', 1)[0]
        parent = directory(parent_path, 0o700, create=True)
        try: value['sourceDirectory'] = info(os.fstat(parent)); os.fsync(parent)
        finally: os.close(parent)
        require(boot() == context['owner']['bootId'] and not os.path.lexists(scope_path(context)), 'BOOT_CHANGED')
        value['phase'] = 'prepared'; save_record(value)
        return {'phase': 'prepared', 'context': context, 'sourcePath': source_path(context), 'record': value}
    except BaseException as error:
        if value is not None:
            value['phase'] = 'failed'; value['failure'] = str(error) if isinstance(error, Refused) else 'PREPARE_FAILED'
            try: save_record(value)
            except BaseException: pass
        raise
    finally: os.close(lock)


def adopt_task_scope(context, scope):
    # One adoption under resources.lock; a later invocation cannot retarget a
    # prepared listener to another control token, inode, run or cgroup.
    value = read_record(context)
    require(value is not None and value['phase'] == 'prepared' and value['scope'] is None and
            value['homeCleanup'] is None, 'RESOURCE_NOT_PREPARED')
    parent = directory(source_path(context).rsplit('/', 1)[0], 0o700)
    try: require(info(os.fstat(parent)) == value['sourceDirectory'], 'SOURCE_REPLACED')
    finally: os.close(parent)
    require(not os.path.lexists(endpoint_path(context)) and not os.path.lexists(home_path(context).rsplit('/', 1)[0]), 'RESOURCE_EXISTS')
    value['scope'] = scope; value['phase'] = 'preparing'
    save_record(value)
    return value


def run(context, launcher):
    require(isinstance(launcher, str) and launcher and len(launcher.encode('utf-8')) <= 65536 and '\x00' not in launcher, 'LAUNCHER_INVALID')
    scope_fd, scope = task_scope(context)
    with open('/proc/self/cgroup', encoding='ascii') as current:
        require(current.read(4096).splitlines() == ['0::/sakura-task-' + context['owner']['runId']], 'CONTROLLER_SCOPE')
    lock = locked(create=True)
    value = adopt_task_scope(context, scope)
    pid = os.fork()
    if pid == 0:
        null = os.open('/dev/null', os.O_RDWR | os.O_CLOEXEC)
        for fd in [0, 1, 2]: os.dup2(null, fd)
        if null > 2: os.close(null)
        for name in os.listdir('/proc/self/fd'):
            if name.isdigit() and int(name) > 2 and int(name) != lock:
                try: os.close(int(name))
                except OSError: pass
        broker(context, value, lock)
        os._exit(0)
    os.close(lock); os.close(scope_fd)
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        value = read_record(context)
        require(value is not None and value['phase'] != 'failed', (value or {}).get('failure') or 'BROKER_READY_FAILED')
        if value['phase'] == 'ready':
            require(value['broker']['pid'] == pid, 'BROKER_REPLACED')
            proof = Process(pid)
            try:
                require(proof.start == value['broker']['startTicks'], 'BROKER_REPLACED')
                fd, expected = task_scope(context); os.close(fd); require(expected == value['scope'], 'CGROUP_CHANGED')
            finally:
                proof.close()
            # Only the fixed launcher metadata is an argv. It receives the
            # untouched FIFO/socket frame and drops identity/capabilities.
            for name in os.listdir('/proc/self/fd'):
                if name.isdigit() and int(name) > 2:
                    try: os.close(int(name))
                    except OSError: pass
            os.execve('/bin/sh', ['sh', '-c', launcher], {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/', 'LANG': 'C', 'LC_ALL': 'C'})
        time.sleep(0.05)
    raise Refused('BROKER_READY_TIMEOUT')


def stopped(context):
    current = boot()
    require(not os.path.lexists(scope_path(context)), 'SCOPE_ACTIVE')
    return current


def source_peer_ended(peer):
    """Observe the original birth without signalling or adopting a reused PID."""
    try:
        pidfd = os.pidfd_open(peer['pid'], 0)
    except ProcessLookupError:
        return True
    parent = None
    try:
        if select.select([pidfd], [], [], 0)[0]: return True
        try:
            parent = os.open('/proc/' + str(peer['pid']), os.O_RDONLY | os.O_DIRECTORY | FLAGS)
        except FileNotFoundError:
            require(bool(select.select([pidfd], [], [], 0)[0]), 'SOURCE_CLOSE_UNCONFIRMED')
            return True
        try:
            fd = os.open('stat', os.O_RDONLY | FLAGS, dir_fd=parent)
        except FileNotFoundError:
            require(bool(select.select([pidfd], [], [], 0)[0]), 'SOURCE_CLOSE_UNCONFIRMED')
            return True
        try:
            fields = os.read(fd, 4097)
            require(len(fields) <= 4096 and not os.read(fd, 1), 'SOURCE_CLOSE_UNCONFIRMED')
        finally:
            os.close(fd)
        fields = fields.rsplit(b') ', 1)
        require(len(fields) == 2, 'SOURCE_CLOSE_UNCONFIRMED')
        fields = fields[1].split()
        require(len(fields) >= 20 and fields[19].isdigit(), 'SOURCE_CLOSE_UNCONFIRMED')
        return fields[19].decode('ascii') != peer['startTicks'] or fields[0] in [b'Z', b'X'] or bool(select.select([pidfd], [], [], 0)[0])
    finally:
        if parent is not None: os.close(parent)
        os.close(pidfd)


def source_listener_absent(path):
    # This controller remains in sshd's root network namespace. Any kernel
    # socket with this exact path prevents removal, including accepted sockets.
    fd = os.open('/proc/net/unix', os.O_RDONLY | FLAGS)
    try:
        data = bytearray()
        while True:
            block = os.read(fd, 65536)
            if not block: break
            data.extend(block)
            require(len(data) <= 4 * 1024 * 1024, 'SOURCE_CLOSE_UNCONFIRMED')
    finally:
        os.close(fd)
    rows = bytes(data).splitlines()
    require(bool(rows) and rows[0].split() == [b'Num', b'RefCount', b'Protocol', b'Flags', b'Type', b'St', b'Inode', b'Path'], 'SOURCE_CLOSE_UNCONFIRMED')
    for line in rows[1:]:
        fields = line.split(None, 7)
        require(len(fields) >= 7, 'SOURCE_CLOSE_UNCONFIRMED')
        if len(fields) == 8 and fields[7] == path.encode('ascii'): return False
    return True


def source_absent(source):
    if source is None: return
    deadline = time.monotonic() + 3
    parent_path, name = source['path'].rsplit('/', 1)
    while True:
        ended = source_peer_ended(source['peer'])
        absent_listener = source_listener_absent(source['path'])
        if os.path.lexists(source['path']):
            parent = directory(parent_path, 0o700, source=True)
            try:
                require(info(os.fstat(parent)) == source['parent'] and
                        info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == source['socket'], 'SOURCE_REPLACED')
                if ended and absent_listener:
                    # OpenSSH may leave its filesystem entry after both the
                    # real unforward ACK and transport close. Remove only the
                    # original inode in its original root-private directory.
                    current = directory(parent_path, 0o700, source=True)
                    try:
                        require(info(os.fstat(current)) == source['parent'] and
                                info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == source['socket'], 'SOURCE_REPLACED')
                        require(source_peer_ended(source['peer']) and source_listener_absent(source['path']), 'SOURCE_CLOSE_UNCONFIRMED')
                        require(info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == source['socket'], 'SOURCE_REPLACED')
                        os.unlink(name, dir_fd=parent); os.fsync(parent)
                    finally:
                        os.close(current)
            finally:
                os.close(parent)
        if ended and absent_listener and not os.path.lexists(source['path']): return
        require(time.monotonic() < deadline, 'SOURCE_CLOSE_UNCONFIRMED')
        time.sleep(0.05)


def absent(root_path, context, mode, code='RESOURCE_UNCONFIRMED'):
    if os.path.lexists(root_path):
        parent = directory(root_path, mode)
        try:
            try: os.stat(context['resource']['leaseId'], dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError: return
            raise Refused(code)
        finally: os.close(parent)
    require(not os.path.lexists(root_path + '/' + context['resource']['leaseId']), code)


def remove_empty_lease(root_path, context, original, mode, gid=0):
    if not os.path.lexists(root_path):
        absent(root_path, context, 0o700 if root_path == SOURCES else 0o755); return
    parent = directory(root_path, 0o700 if root_path == SOURCES else 0o755)
    lease = context['resource']['leaseId']
    try:
        try: current = os.stat(lease, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError: return
        require(original is not None and info(current) == original, 'LEASE_REPLACED')
        fd = os.open(lease, os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=parent)
        try:
            require(info(os.fstat(fd)) == original and not os.listdir(fd), 'LEASE_CONTENT_CHANGED')
            require(stat.S_IMODE(current.st_mode) == mode and current.st_uid == 0 and current.st_gid == gid, 'LEASE_REPLACED')
        finally: os.close(fd)
        require(info(os.stat(lease, dir_fd=parent, follow_symlinks=False)) == original, 'LEASE_REPLACED')
        os.rmdir(lease, dir_fd=parent); os.fsync(parent)
    finally: os.close(parent)


def valid_data_name(name):
    return isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9._#=+\-~]{1,255}', name) and name not in ['.', '..']


def no_home_mounts(context):
    path = home_path(context)
    with open('/proc/self/mountinfo', encoding='ascii') as source:
        for line in source:
            fields = line.split()
            require(len(fields) > 6, 'MOUNTINFO_INVALID')
            require(fields[4] != path and not fields[4].startswith(path + '/'), 'HOME_MOUNTED')


def freeze_home(value):
    transition = value['homeCleanup']
    if transition is None:
        fd = home_open(value)
        try:
            if value['redirect'] is not None:
                try: os.stat('S.gpg-agent', dir_fd=fd, follow_symlinks=False)
                except FileNotFoundError: pass
                else: routing_checked(value, fd)
            else:
                # A failed pre-RUN creation may have published the exact home
                # before creating its redirect. Missing metadata authorizes
                # only confirmed absence, never an unknown routing inode.
                require(value['phase'] != 'ready', 'REDIRECT_UNCONFIRMED')
                try: os.stat('S.gpg-agent', dir_fd=fd, follow_symlinks=False)
                except FileNotFoundError: pass
                else: raise Refused('REDIRECT_UNCONFIRMED')
        finally: os.close(fd)
        transition = {'phase': 'freeze-intent', 'frozenHome': None, 'directories': []}
        value['homeCleanup'] = transition; save_record(value)
    context = value['context']; parent_path = home_path(context).rsplit('/', 1)[0]
    parent = directory(parent_path, 0o710, context['identity']['gid'])
    home = None
    try:
        require(info(os.fstat(parent)) == value['homeDirectory'], 'HOME_PARENT_REPLACED')
        home = os.open('home', os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=parent)
        current = info(os.fstat(home)); target = {**value['home'], 'uid': 0, 'gid': 0, 'mode': 0o700}
        require(current == target or (transition['phase'] == 'freeze-intent' and current == value['home']), 'HOME_REPLACED')
        require(info(os.stat('home', dir_fd=parent, follow_symlinks=False)) == current, 'HOME_REPLACED')
        if current != target:
            os.fchown(home, 0, 0); os.fchmod(home, 0o700); os.fsync(home)
        require(info(os.fstat(home)) == target and info(os.stat('home', dir_fd=parent, follow_symlinks=False)) == target, 'HOME_REPLACED')
        transition['frozenHome'] = target
        if transition['phase'] == 'freeze-intent': transition['phase'] = 'frozen'; save_record(value)
        return home
    except BaseException:
        if home is not None: os.close(home)
        raise
    finally: os.close(parent)


def clean_home(value):
    context = value['context']; path = home_path(context)
    if not os.path.lexists(path):
        require(value['home'] is None or (value['homeCleanup'] is not None and
                value['homeCleanup']['phase'] in ['removing', 'removed']), 'HOME_UNCONFIRMED')
        if value['homeCleanup'] is not None:
            value['homeCleanup']['phase'] = 'removed'; save_record(value)
        remove_empty_lease(HOMES, context, value['homeDirectory'], 0o710, context['identity']['gid']); return
    require(value['home'] is not None and value['homeDirectory'] is not None, 'HOME_UNCONFIRMED')
    no_home_mounts(context); home = freeze_home(value)
    transition = value['homeCleanup']
    deadline = time.monotonic() + 5; entries = 0
    def check():
        require(time.monotonic() < deadline, 'HOME_CLEANUP_TIMEOUT')
        require(stopped(context) == context['owner']['bootId'], 'BOOT_CHANGED')
        no_home_mounts(context)
    def clean(parent, relative):
        nonlocal entries
        check(); require(len(relative) <= MAX_HOME_DEPTH, 'HOME_DEPTH_BUDGET')
        with os.scandir(parent) as iterator:
            for entry in iterator:
                check(); entries += 1; require(entries <= MAX_HOME_ENTRIES, 'HOME_ENTRY_BUDGET')
                name = entry.name; require(valid_data_name(name), 'HOME_DATA_NAME')
                current = info(os.stat(name, dir_fd=parent, follow_symlinks=False))
                require(current['device'] == value['home']['device'], 'HOME_DEVICE_CHANGED')
                components = relative + [name]
                if not relative and name == 'S.gpg-agent':
                    routing_checked(value, parent)
                    os.unlink(name, dir_fd=parent); os.fsync(parent); continue
                if current['type'] == stat.S_IFDIR:
                    require(len(components) <= MAX_HOME_DEPTH, 'HOME_DEPTH_BUDGET')
                    registered = next((child for child in transition['directories'] if child['path'] == components), None)
                    if registered is None:
                        require(current['uid'] == context['identity']['uid'] and current['gid'] == context['identity']['gid'], 'HOME_DIRECTORY_OWNER')
                        require(len(transition['directories']) < MAX_HOME_DIRECTORIES, 'HOME_DIRECTORY_BUDGET')
                        registered = {'path': components, 'phase': 'freeze-intent', 'original': current,
                                      'frozen': {**current, 'uid': 0, 'gid': 0, 'mode': 0o700}}
                        transition['directories'].append(registered); save_record(value)
                    # fchown and fchmod are separate syscalls. A crash between
                    # them may retain the old mode or clear its set-id bits.
                    # These exact intermediate tuples are authorized only by
                    # the durable intent for this original device/inode.
                    chowned = {**registered['original'], 'uid': 0, 'gid': 0}
                    cleared = {**chowned, 'mode': chowned['mode'] & ~0o6000}
                    require(registered['phase'] != 'removed' and (current == registered['frozen'] or
                            (registered['phase'] == 'freeze-intent' and
                             current in [registered['original'], chowned, cleared])), 'HOME_DIRECTORY_REPLACED')
                    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=parent)
                    try:
                        require(info(os.fstat(child)) == current and
                                info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == current, 'HOME_DIRECTORY_REPLACED')
                        if current != registered['frozen']:
                            os.fchown(child, 0, 0); os.fchmod(child, 0o700); os.fsync(child)
                        require(info(os.fstat(child)) == registered['frozen'] and
                                info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == registered['frozen'], 'HOME_DIRECTORY_REPLACED')
                        registered['phase'] = 'frozen'; save_record(value)
                        clean(child, components)
                        require(info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == registered['frozen'], 'HOME_DIRECTORY_REPLACED')
                    finally: os.close(child)
                    os.rmdir(name, dir_fd=parent); os.fsync(parent)
                    registered['phase'] = 'removed'; save_record(value)
                else:
                    require(current['type'] in [stat.S_IFREG, stat.S_IFLNK] and current['uid'] == context['identity']['uid'] and
                            current['gid'] == context['identity']['gid'], 'HOME_DATA_OWNER')
                    check(); require(info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == current, 'HOME_DATA_CHANGED')
                    os.unlink(name, dir_fd=parent); os.fsync(parent)
        check()
    try:
        transition['phase'] = 'removing'; save_record(value)
        clean(home, [])
        require(not os.listdir(home) and info(os.fstat(home)) == transition['frozenHome'], 'HOME_DATA_CHANGED')
    finally: os.close(home)
    parent_path = path.rsplit('/', 1)[0]; parent = directory(parent_path, 0o710, context['identity']['gid'])
    try:
        require(info(os.fstat(parent)) == value['homeDirectory'] and
                info(os.stat('home', dir_fd=parent, follow_symlinks=False)) == transition['frozenHome'], 'HOME_REPLACED')
        check(); os.rmdir('home', dir_fd=parent); os.fsync(parent)
    finally: os.close(parent)
    transition['phase'] = 'removed'; save_record(value)
    remove_empty_lease(HOMES, context, value['homeDirectory'], 0o710, context['identity']['gid'])


def cleanup(context):
    current = stopped(context)
    if not os.path.lexists(RECORDS):
        absent(SOURCES, context, 0o700); absent(SOCKETS, context, 0o755); absent(HOMES, context, 0o755)
        require(stopped(context) == current, 'BOOT_CHANGED')
        return {'phase': 'closed', 'context': context, 'record': None}
    lock = locked()
    try:
        value = read_record(context)
        endpoint = endpoint_path(context)
        if value is None:
            absent(SOURCES, context, 0o700); absent(SOCKETS, context, 0o755); absent(HOMES, context, 0o755)
            require(stopped(context) == current, 'BOOT_CHANGED')
            return {'phase': 'closed', 'context': context, 'record': None}
        if value['phase'] == 'closed':
            absent(SOURCES, context, 0o700, 'CLOSED_SOURCE_PRESENT')
            absent(SOCKETS, context, 0o755, 'CLOSED_ENDPOINT_PRESENT'); absent(HOMES, context, 0o755, 'CLOSED_HOME_PRESENT')
            require(value['source'] is None or not os.path.lexists(value['source']['path']), 'CLOSED_SOURCE_PRESENT')
            require(stopped(context) == current, 'BOOT_CHANGED')
            return {'phase': 'closed', 'context': context, 'record': value}
        if current != context['owner']['bootId']:
            absent(SOURCES, context, 0o700, 'OLD_BOOT_RESOURCE_PRESENT')
            absent(SOCKETS, context, 0o755, 'OLD_BOOT_RESOURCE_PRESENT'); absent(HOMES, context, 0o755, 'OLD_BOOT_RESOURCE_PRESENT')
            require(value['source'] is None or not os.path.lexists(value['source']['path']), 'OLD_BOOT_RESOURCE_PRESENT')
            require(boot() == current and not os.path.lexists(scope_path(context)), 'BOOT_CHANGED')
            value['phase'] = 'closed'; save_record(value)
            return {'phase': 'closed', 'context': context, 'record': value}
        source_absent(value['source'])
        require(not os.path.lexists(source_path(context)), 'SOURCE_CLOSE_UNCONFIRMED')
        require(stopped(context) == current, 'BOOT_CHANGED')
        remove_empty_lease(SOURCES, context, value['sourceDirectory'], 0o700)
        if os.path.lexists(SOCKETS): os.close(directory(SOCKETS, 0o755))
        if os.path.lexists(endpoint):
            require(value['endpointDirectory'] is not None, 'ENDPOINT_UNCONFIRMED')
            parent = directory(endpoint, 0o710, context['identity']['gid'])
            try:
                require(info(os.fstat(parent)) == value['endpointDirectory'], 'ENDPOINT_REPLACED')
                children = os.listdir(parent)
                require(children in [[], ['agent']], 'ENDPOINT_CONTENT_CHANGED')
                if children:
                    require(value['endpoint'] is not None and
                            info(os.stat('agent', dir_fd=parent, follow_symlinks=False)) == value['endpoint'], 'ENDPOINT_REPLACED')
                    os.unlink('agent', dir_fd=parent); os.fsync(parent)
            finally:
                os.close(parent)
            root = directory(SOCKETS, 0o755)
            try:
                require(info(os.stat(context['resource']['leaseId'], dir_fd=root, follow_symlinks=False)) == value['endpointDirectory'], 'ENDPOINT_REPLACED')
                os.rmdir(context['resource']['leaseId'], dir_fd=root); os.fsync(root)
            finally:
                os.close(root)
        require(stopped(context) == current, 'BOOT_CHANGED')
        clean_home(value)
        require(stopped(context) == current, 'BOOT_CHANGED')
        value['phase'] = 'closed'; save_record(value)
        return {'phase': 'closed', 'context': context, 'record': value}
    finally:
        os.close(lock)


def main():
    require(os.getuid() == 0 and os.geteuid() == 0 and os.getgid() == 0, 'CONTROLLER_OWNER')
    request = json.loads(base64.b64decode(sys.argv[1], validate=True))
    require(request['action'] in ['prepare', 'run', 'cleanup', 'read'] and
            set(request) == ({'action', 'context', 'launcher'} if request['action'] == 'run' else {'action', 'context'}), 'REQUEST_INVALID')
    context = context_checked(request['context'])
    if request['action'] == 'run':
        run(context, request['launcher'])
        return
    if request['action'] == 'prepare':
        result = prepare(context)
    elif request['action'] == 'cleanup':
        result = cleanup(context)
    else:
        value = read_record(context)
        require(value is not None, 'RESOURCE_ABSENT')
        result = {'phase': value['phase'], 'context': context, 'record': value}
    print(json.dumps({'version': 1, 'ok': True, 'result': result}))


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        code = str(error) if isinstance(error, Refused) else 'AGENT_CONTROL_FAILED'
        print(json.dumps({'ok': False, 'code': 'GPG_AGENT_' + code, 'detail': None}))
        sys.exit(1)
