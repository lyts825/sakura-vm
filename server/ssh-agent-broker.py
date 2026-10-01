"""Fixed root controller; project command bytes never enter this process.

SO_PEERCRED authenticates the connector, not a later recipient of a passed FD.
An authorized application can deliberately relay requests; this is not a
security boundary against cooperation between processes with the same UID.
"""
import base64
import errno
import fcntl
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

ROOT = '/run/sakura-agent-forwards'
SOCKETS = '/run/sakura-agent-sockets'
RECORDS = ROOT + '/records'
MAX_FRAME = 262144
MAX_CONNECTIONS = 8
MAX_REQUESTS = 128
MAX_SESSION_BYTES = 8 * 1024 * 1024
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
    require(set(resource) == {'version', 'kind', 'leaseId', 'brokerSha256', 'timeoutSeconds'}, 'CONTEXT_INVALID')
    require(resource['version'] == 1 and resource['kind'] == 'ssh-agent', 'CONTEXT_INVALID')
    identifier(resource['leaseId']); identifier(owner['runId']); identifier(owner['bootId'])
    require(set(owner) == {'kind', 'runId', 'bootId'} and owner['kind'] == 'task', 'CONTEXT_INVALID')
    require(type(resource['timeoutSeconds']) is int and 1 <= resource['timeoutSeconds'] <= 300, 'CONTEXT_INVALID')
    require(re.fullmatch('[a-f0-9]{64}', resource['brokerSha256']) and re.fullmatch('[a-f0-9]{64}', value['sha256']), 'CONTEXT_INVALID')
    required = {'version', 'phase', 'registryId', 'projectId', 'identityId', 'revision', 'account', 'uid', 'gid',
                'home', 'directory', 'directoryDevice', 'directoryInode', 'homeDevice', 'homeInode', 'networkIsolation'}
    require(set(identity) == required and identity['version'] == 1 and identity['phase'] == 'active', 'CONTEXT_INVALID')
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


def regular(parent, name, size=65536):
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
    require(isinstance(value, dict) and set(value) == {'version', 'context', 'phase', 'scope', 'source', 'endpointDirectory', 'endpoint', 'broker', 'failure'}, 'RECORD_INVALID')
    require(value['version'] == 1 and value['context'] == context and
            value['phase'] in ['preparing', 'ready', 'failed', 'closed'], 'RECORD_CHANGED')
    scope = value['scope']
    require(isinstance(scope, dict) and set(scope) == {'device', 'inode', 'controlToken'}, 'RECORD_INVALID')
    identifier(scope['controlToken'])
    for name in ['device', 'inode']:
        require(isinstance(scope[name], str) and re.fullmatch('0|[1-9][0-9]*', scope[name]), 'RECORD_INVALID')
    source = value['source']
    if source is not None:
        require(isinstance(source, dict) and set(source) == {'path', 'parent', 'socket', 'peer'} and
                isinstance(source['path'], str) and source['path'].startswith('/') and
                0 < len(source['path'].encode()) < 108 and not re.search('[\x00-\x20\x7f]', source['path']), 'RECORD_INVALID')
        recorded_object(source['parent']); recorded_object(source['socket']); recorded_process(source['peer'])
    for name in ['endpointDirectory', 'endpoint']:
        if value[name] is not None: recorded_object(value[name])
    if value['broker'] is not None: recorded_process(value['broker'])
    require(value['failure'] is None or (isinstance(value['failure'], str) and
            re.fullmatch('[A-Z][A-Z0-9_]{0,79}', value['failure'])), 'RECORD_INVALID')
    require(value['phase'] != 'ready' or (all(value[name] is not None for name in
            ['source', 'endpointDirectory', 'endpoint', 'broker']) and value['failure'] is None), 'RECORD_INVALID')
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
    parent = directory(RECORDS, 0o700)
    name = '.write-' + str(uuid.uuid4())
    try:
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | FLAGS, 0o600, dir_fd=parent)
        with os.fdopen(fd, 'wb') as target:
            target.write(json.dumps(value, separators=(',', ':')).encode('utf-8'))
            target.flush(); os.fsync(target.fileno())
        # A root-only directory and the checked existing context prevent an
        # unrelated resource from being replaced by this phase transition.
        prior = read_record(value['context'])
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
        require(values.get(b'NoNewPrivs', b'').strip() == b'1' and int(values.get(b'CapEff', b'1').strip(), 16) == 0, 'PEER_PRIVILEGES')
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
        self.peer.alive()

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


def exact_read(stream, size, deadline, check):
    data = bytearray()
    while len(data) < size:
        check()
        remaining = deadline - time.monotonic()
        require(remaining > 0, 'PROTOCOL_TIMEOUT')
        stream.settimeout(min(remaining, 1))
        try:
            piece = stream.recv(min(65536, size - len(data)))
        except socket.timeout:
            continue
        require(piece, 'PROTOCOL_CLOSED')
        data.extend(piece)
    check()
    return bytes(data)


def frame(stream, deadline, check):
    header = exact_read(stream, 4, deadline, check)
    length = struct.unpack('!I', header)[0]
    require(1 <= length <= MAX_FRAME, 'PROTOCOL_SIZE')
    return header + exact_read(stream, length, deadline, check)


def exact_send(stream, data, deadline, check):
    offset = 0
    while offset < len(data):
        check()
        remaining = deadline - time.monotonic()
        require(remaining > 0, 'PROTOCOL_TIMEOUT')
        stream.settimeout(min(remaining, 1))
        try:
            sent = stream.send(data[offset:offset + 65536])
        except socket.timeout:
            continue
        require(sent > 0, 'PROTOCOL_CLOSED')
        offset += sent
    check()


def relay(stream, upstream, deadline, check):
    transferred = 0
    for _request in range(MAX_REQUESTS):
        request_deadline = min(deadline, time.monotonic() + 10)
        request = frame(stream, request_deadline, check)
        transferred += len(request)
        require(transferred <= MAX_SESSION_BYTES, 'PROTOCOL_BUDGET')
        check(); exact_send(upstream, request, request_deadline, check)
        response = frame(upstream, request_deadline, check)
        transferred += len(response)
        require(transferred <= MAX_SESSION_BYTES, 'PROTOCOL_BUDGET')
        check(); exact_send(stream, response, request_deadline, check)


def broker(context, value, lock):
    source = None; listener = None; endpoint_fd = None
    stopped = threading.Event(); peers = set(); mutex = threading.Lock()
    def stop(_signal, _frame):
        stopped.set()
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGHUP, stop); signal.signal(signal.SIGINT, stop)
    try:
        process = Process(os.getpid())
        value['broker'] = {'pid': process.pid, 'startTicks': process.start}; process.close(); save_record(value)
        source = Source(os.environ.get('SAKURA_SSH_AGENT_SOURCE', ''))
        value['source'] = source.record(); save_record(value)
        records = directory(RECORDS, 0o700)
        try:
            names = os.listdir(records); require(len(names) <= 1024, 'RESOURCE_LIMIT')
            for name in names:
                if not name.endswith('.json') or name == record_name(context):
                    continue
                other = json.loads(regular(records, name).decode('utf-8'))
                require(other.get('version') == 1 and other.get('phase') in ['preparing', 'ready', 'failed', 'closed'], 'OTHER_RESOURCE_UNCONFIRMED')
                require(other['phase'] == 'closed' or other.get('source') != value['source'], 'SOURCE_SHARED')
        finally:
            os.close(records)
        if not os.path.lexists(SOCKETS):
            # The controller inherits umask077. Only this newly created object
            # may have its traversal mode published; never repair an unknown root.
            os.mkdir(SOCKETS, 0o700)
            root = directory(SOCKETS, 0o700)
            try: os.fchmod(root, 0o755); os.fsync(root)
            finally: os.close(root)
        os.close(directory(SOCKETS, 0o755))
        endpoint = SOCKETS + '/' + context['resource']['leaseId']
        require(not os.path.lexists(endpoint), 'ENDPOINT_UNKNOWN')
        os.mkdir(endpoint, 0o700)
        endpoint_fd = directory(endpoint, 0o700)
        os.fchown(endpoint_fd, 0, context['identity']['gid']); os.fchmod(endpoint_fd, 0o710)
        value['endpointDirectory'] = info(os.fstat(endpoint_fd)); save_record(value)
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind('/proc/self/fd/' + str(endpoint_fd) + '/agent')
        current = os.stat('agent', dir_fd=endpoint_fd, follow_symlinks=False)
        require(stat.S_ISSOCK(current.st_mode), 'ENDPOINT_INVALID')
        os.chown('agent', context['identity']['uid'], context['identity']['gid'], dir_fd=endpoint_fd, follow_symlinks=False)
        os.chmod('agent', 0o600, dir_fd=endpoint_fd, follow_symlinks=False)
        value['endpoint'] = info(os.stat('agent', dir_fd=endpoint_fd, follow_symlinks=False))
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
                    fd = directory(endpoint, 0o710, context['identity']['gid'])
                    try:
                        require(info(os.fstat(fd)) == value['endpointDirectory'] and
                                info(os.stat('agent', dir_fd=fd, follow_symlinks=False)) == value['endpoint'], 'ENDPOINT_REPLACED')
                    finally:
                        os.close(fd)
                check(); upstream = source.connect(); check()
                relay(stream, upstream, deadline, check)
            except (Refused, OSError, ValueError, IndexError):
                pass
            finally:
                if upstream is not None: upstream.close()
                if peer is not None: peer.close()
                stream.close()
                with mutex: peers.discard(stream)
        while not stopped.is_set() and time.monotonic() < deadline:
            source.check()
            try:
                stream, _ = listener.accept()
            except socket.timeout:
                continue
            with mutex:
                if len(peers) >= MAX_CONNECTIONS: stream.close(); continue
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


def run(context, launcher):
    require(isinstance(launcher, str) and launcher and len(launcher.encode('utf-8')) <= 65536 and '\x00' not in launcher, 'LAUNCHER_INVALID')
    scope_fd, scope = task_scope(context)
    with open('/proc/self/cgroup', encoding='ascii') as current:
        require(current.read(4096).splitlines() == ['0::/sakura-task-' + context['owner']['runId']], 'CONTROLLER_SCOPE')
    lock = locked(create=True)
    require(read_record(context) is None and not os.path.lexists(SOCKETS + '/' + context['resource']['leaseId']), 'RESOURCE_EXISTS')
    value = {'version': 1, 'context': context, 'phase': 'preparing', 'scope': scope,
             'source': None, 'endpointDirectory': None, 'endpoint': None, 'broker': None, 'failure': None}
    save_record(value)
    pid = os.fork()
    if pid == 0:
        null = os.open('/dev/null', os.O_RDWR | os.O_CLOEXEC)
        for fd in [0, 1, 2]: os.dup2(null, fd)
        if null > 2: os.close(null)
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


def source_absent(source):
    if source is None: return
    deadline = time.monotonic() + 3
    while os.path.lexists(source['path']) and time.monotonic() < deadline:
        parent_path, name = source['path'].rsplit('/', 1)
        parent = directory(parent_path, 0o700, source=True)
        try:
            require(info(os.fstat(parent)) == source['parent'] and
                    info(os.stat(name, dir_fd=parent, follow_symlinks=False)) == source['socket'], 'SOURCE_REPLACED')
        finally:
            os.close(parent)
        time.sleep(0.05)
    # sshd owns and removes its original listener. Never unlink it or signal a
    # shared/root SSH process on behalf of a project cleanup.
    require(not os.path.lexists(source['path']), 'SOURCE_CLOSE_UNCONFIRMED')


def endpoint_absent(context, code='ENDPOINT_UNCONFIRMED'):
    if os.path.lexists(SOCKETS):
        root = directory(SOCKETS, 0o755)
        try:
            try: os.stat(context['resource']['leaseId'], dir_fd=root, follow_symlinks=False)
            except FileNotFoundError: return
            raise Refused(code)
        finally:
            os.close(root)
    require(not os.path.lexists(SOCKETS + '/' + context['resource']['leaseId']), code)


def cleanup(context):
    current = stopped(context)
    if not os.path.lexists(RECORDS):
        endpoint_absent(context)
        require(stopped(context) == current, 'BOOT_CHANGED')
        return {'phase': 'closed', 'context': context, 'record': None}
    lock = locked()
    try:
        value = read_record(context)
        endpoint = SOCKETS + '/' + context['resource']['leaseId']
        if value is None:
            endpoint_absent(context)
            require(stopped(context) == current, 'BOOT_CHANGED')
            return {'phase': 'closed', 'context': context, 'record': None}
        if value['phase'] == 'closed':
            endpoint_absent(context, 'CLOSED_ENDPOINT_PRESENT')
            require(value['source'] is None or not os.path.lexists(value['source']['path']), 'CLOSED_SOURCE_PRESENT')
            require(stopped(context) == current, 'BOOT_CHANGED')
            return {'phase': 'closed', 'context': context, 'record': value}
        if current != context['owner']['bootId']:
            endpoint_absent(context, 'OLD_BOOT_RESOURCE_PRESENT')
            require(value['source'] is None or not os.path.lexists(value['source']['path']), 'OLD_BOOT_RESOURCE_PRESENT')
            require(boot() == current and not os.path.lexists(scope_path(context)), 'BOOT_CHANGED')
            value['phase'] = 'closed'; save_record(value)
            return {'phase': 'closed', 'context': context, 'record': value}
        source_absent(value['source'])
        require(stopped(context) == current, 'BOOT_CHANGED')
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
        value['phase'] = 'closed'; save_record(value)
        return {'phase': 'closed', 'context': context, 'record': value}
    finally:
        os.close(lock)


def main():
    require(os.getuid() == 0 and os.geteuid() == 0 and os.getgid() == 0, 'CONTROLLER_OWNER')
    request = json.loads(base64.b64decode(sys.argv[1], validate=True))
    require(request['action'] in ['run', 'cleanup', 'read'] and
            set(request) == ({'action', 'context', 'launcher'} if request['action'] == 'run' else {'action', 'context'}), 'REQUEST_INVALID')
    context = context_checked(request['context'])
    if request['action'] == 'run':
        run(context, request['launcher'])
        return
    if request['action'] == 'cleanup':
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
        print(json.dumps({'ok': False, 'code': 'SSH_AGENT_' + code, 'detail': None}))
        sys.exit(1)
