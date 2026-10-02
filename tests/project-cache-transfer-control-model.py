"""Run the exact root helper against a deterministic POSIX fd/filesystem model.

This models kernel paths and failures; it is not a VM or a claim of Linux execution.
"""
import copy
import errno
import hashlib
import json
import os
import stat
import sys
import types
import uuid

SOURCE = sys.stdin.read()
fcntl = types.SimpleNamespace(LOCK_SH=1, LOCK_EX=2, LOCK_NB=4, flock=lambda *_: None)
sys.modules['fcntl'] = fcntl
ENV = {'__name__': 'cache_transfer_model'}
exec(compile(SOURCE, 'project-cache-transfer-control.py', 'exec'), ENV)


class Node:
    def __init__(self, inode, kind='directory', mode=0o755, uid=0, gid=0, content=b'', device=1):
        self.inode, self.kind, self.mode = inode, kind, mode
        self.uid, self.gid, self.content, self.device = uid, gid, content, device
        self.links, self.mtime, self.ctime = 1, 1, 1

    def info(self):
        kind = {'directory': stat.S_IFDIR, 'file': stat.S_IFREG,
                'link': stat.S_IFLNK, 'fifo': stat.S_IFIFO}[self.kind]
        return types.SimpleNamespace(st_ino=self.inode, st_dev=self.device,
                                     st_uid=self.uid, st_gid=self.gid, st_nlink=self.links,
                                     st_mode=kind | self.mode, st_size=len(self.content),
                                     st_mtime_ns=self.mtime, st_ctime_ns=self.ctime)


class Posix:
    O_RDONLY, O_WRONLY, O_RDWR = 0, 1, 2
    O_CREAT, O_EXCL, O_DIRECTORY, O_NOFOLLOW, O_CLOEXEC, O_NONBLOCK = 4, 8, 16, 32, 64, 128

    def __init__(self):
        self.nodes, self.fds, self.next_fd, self.next_inode = {}, {}, 3, 1
        self.writes, self.removed, self.opens = [], [], []
        self.failed_fsync, self.stat_hook = False, None
        self.add('/')

    def add(self, path, **options):
        node = Node(self.next_inode, **options)
        self.next_inode += 1
        self.nodes[path] = node
        return node

    def directory(self, path):
        current = ''
        for part in path.split('/')[1:]:
            current += '/' + part
            if current not in self.nodes:
                self.add(current)

    def path(self, path, dir_fd=None):
        if path.startswith('/'):
            return path.rstrip('/') or '/'
        if dir_fd is None:
            raise AssertionError('Root code must use absolute paths or anchored dir_fd')
        parent = self.fds[dir_fd][0]
        prefix = next((name for name, node in self.nodes.items() if node is parent), None)
        if prefix is None:
            raise FileNotFoundError('unlinked parent fd')
        return prefix.rstrip('/') + '/' + path

    def open(self, path, flags, mode=0o777, dir_fd=None):
        path = self.path(path, dir_fd)
        self.opens.append((path, flags))
        node = self.nodes.get(path)
        if flags & self.O_CREAT:
            if node is not None and flags & self.O_EXCL:
                raise FileExistsError(path)
            if node is None:
                parent = path.rsplit('/', 1)[0] or '/'
                if parent not in self.nodes:
                    raise FileNotFoundError(parent)
                node = self.add(path, kind='file', mode=mode)
        if node is None:
            raise FileNotFoundError(path)
        if node.kind == 'link' and flags & self.O_NOFOLLOW:
            raise OSError(errno.ELOOP, 'nofollow')
        if flags & self.O_DIRECTORY and node.kind != 'directory':
            raise NotADirectoryError(path)
        self.next_fd += 1
        self.fds[self.next_fd] = [node, 0, flags]
        return self.next_fd

    def close(self, fd):
        assert fd in self.fds, 'Authority fd must be closed once'
        del self.fds[fd]

    def fstat(self, fd):
        return self.fds[fd][0].info()

    def stat(self, path, dir_fd=None, follow_symlinks=True):
        path = self.path(path, dir_fd)
        if self.stat_hook:
            self.stat_hook(path)
        if path not in self.nodes:
            raise FileNotFoundError(path)
        return self.nodes[path].info()

    def listdir(self, path):
        if isinstance(path, int):
            node = self.fds[path][0]
            path = next(name for name, value in self.nodes.items() if value is node)
        prefix = path.rstrip('/') + '/'
        return [name[len(prefix):] for name in self.nodes if name.startswith(prefix) and '/' not in name[len(prefix):]]

    def mkdir(self, path, mode=0o777, dir_fd=None):
        path = self.path(path, dir_fd)
        if path in self.nodes:
            raise FileExistsError(path)
        if (path.rsplit('/', 1)[0] or '/') not in self.nodes:
            raise FileNotFoundError(path)
        self.add(path, mode=mode)
        self.writes.append(('mkdir', path))

    def read(self, fd, count):
        node, position, _ = self.fds[fd]
        assert node.kind == 'file', 'No FIFO/device/symlink may be read'
        result = node.content[position:position + count]
        self.fds[fd][1] += len(result)
        return result

    def write(self, fd, content):
        node = self.fds[fd][0]
        assert node.kind == 'file'
        node.content += content
        self.writes.append(('write', node.inode))
        return len(content)

    def rename(self, before, after, src_dir_fd=None, dst_dir_fd=None):
        before, after = self.path(before, src_dir_fd), self.path(after, dst_dir_fd)
        self.nodes[after] = self.nodes.pop(before)
        self.writes.append(('rename', after))

    def fchown(self, fd, uid, gid):
        self.fds[fd][0].uid, self.fds[fd][0].gid = uid, gid
        self.writes.append(('chown', self.fds[fd][0].inode))

    def fsync(self, fd):
        assert fd in self.fds
        if self.failed_fsync:
            raise OSError('fsync failure')

    def unlink(self, path, dir_fd=None):
        path = self.path(path, dir_fd)
        assert self.nodes[path].kind != 'directory'
        del self.nodes[path]
        self.removed.append(path)

    def rmdir(self, path, dir_fd=None):
        path = self.path(path, dir_fd)
        assert not self.listdir(path)
        del self.nodes[path]
        self.removed.append(path)

    def umask(self, value):
        return 0o022

    def getuid(self):
        return 0

    def fsencode(self, value):
        return value.encode('utf-8')


TRUSTED_NATIVE = b'''
import os
class Refusal(Exception):
 def __init__(self,code): self.code=code
def sources(): return os.native_build
def initialize_readonly(): return os.open('/registry/lock',os.O_RDONLY|os.O_NOFOLLOW)
def active(project,request,store):
 expected={k:os.native_identity[k] for k in ('registryId','identityId','revision')}
 if project!=os.native_identity['projectId'] or request!={'expected':expected}: raise Refusal('IDENTITY_MISMATCH')
 return os.native_identity
def registry(readonly):
 if readonly is not True: raise AssertionError('Read-only registry required')
 return {}
def cgroup_available(): return True
def make_directory(path,mode):
 try: os.mkdir(path,mode)
 except FileExistsError: pass
def check_run(identity,run,boot,require_active):
 if any(run[k]!=identity[k] for k in ('registryId','projectId','identityId','revision')) or run['bootId']!=boot: raise Refusal('RUN_STALE')
def run_read(run_id):
 if os.native_run is None: raise Refusal('RECORD_ABSENT')
 if os.native_run['runId']!=run_id: raise Refusal('RUN_STALE')
 return os.native_run
'''


def fixture(manager='npm'):
    fs = Posix()
    fs.native_build = hashlib.sha256(b'protocol.hheader' + b'launcher.clauncher' + b'controller.py' + TRUSTED_NATIVE).hexdigest()
    identity_id, registry_id, boot_id, run_id = [str(uuid.uuid4()) for _ in range(4)]
    identity = {'version': 1, 'phase': 'active', 'registryId': registry_id, 'identityId': identity_id,
                'projectId': '0123456789abcdef', 'revision': 1, 'uid': 20001, 'gid': 20001,
                'account': 'skp' + identity_id.replace('-', '')[:24],
                'home': '/var/lib/sakura-project-homes/' + identity_id, 'directory': '/srv/project',
                'homeDevice': '1', 'homeInode': '10', 'directoryDevice': '1', 'directoryInode': '11',
                'networkIsolation': 'private'}
    owner = {'stageId': str(uuid.uuid4()), 'manager': manager, 'build': fs.native_build,
             'identity': identity, 'owner': {'kind': 'task', 'runId': run_id, 'bootId': boot_id},
             'sha256': 'b' * 64}
    fs.native_identity = identity
    fs.native_ticket = {'version': 1, 'phase': 'closed', 'mode': 'inherit-current', 'registryId': registry_id,
                     'identityId': identity_id, 'projectId': identity['projectId'], 'revision': 1,
                     'runId': run_id, 'bootId': boot_id, 'build': fs.native_build,
                     'networkDevice': '4', 'networkInode': '5', 'cgroupDevice': '1', 'cgroupInode': '300',
                     'cgroupName': 'sakura-task-' + run_id, 'namespace': 'sk-' + identity['projectId']}
    fs.native_run = None
    paths = ['/registry', '/proc/sys/kernel/random', '/proc/self', '/sys/fs/cgroup', '/run',
             '/usr/local/lib/sakura-project-identity/' + fs.native_build,
             '/var/cache/sakura/project-deps/' + identity['projectId'] + '/' + manager]
    for path in paths:
        fs.directory(path)
    fs.add('/registry/lock', kind='file', mode=0o600)
    fs.add('/proc/sys/kernel/random/boot_id', kind='file', mode=0o444, content=boot_id.encode())
    fs.add('/proc/self/mountinfo', kind='file', mode=0o444, content=b'1 0 0:1 / / rw - root root rw\n')
    build_path = '/usr/local/lib/sakura-project-identity/' + fs.native_build
    files = [('protocol.h', b'header'), ('launcher.c', b'launcher'), ('controller.py', TRUSTED_NATIVE)]
    manifest = {'version': 1, 'build': fs.native_build, 'files': []}
    for name, value in files:
        fs.add(build_path + '/' + name, kind='file', mode=0o644, content=value)
        manifest['files'].append({'name': name, 'size': len(value), 'sha256': hashlib.sha256(value).hexdigest()})
    fs.add(build_path + '/manifest.json', kind='file', mode=0o644, content=json.dumps(manifest).encode())
    fs.add(build_path + '/launch', kind='file', mode=0o4755)
    cache = '/var/cache/sakura/project-deps/' + identity['projectId'] + '/' + manager
    fs.add(cache + '/LOCKSUMS', kind='file', mode=0o600, content=b'a' * 64 + b'  package-lock.json\n')
    data = cache + ('/data' if manager == 'npm' else '/wheels')
    fs.add(data, mode=0o700)
    fs.add(data + '/artifact', kind='file', mode=0o600, content=b'cache artifact')
    # Privileged downloader staging and credentials are outside the selected roots.
    fs.add(cache + '/credential-file', kind='file', mode=0o600, content=b'never-copy')
    ENV['os'] = fs
    saved = sys.modules['os']
    sys.modules['os'] = fs
    return fs, owner, cache, saved


def invoke(owner, action='prepare', preparation=None, task=None):
    request = {'action': action, 'owner': owner}
    if preparation is not None:
        request['preparation'] = preparation
    if task is not None:
        request['task'] = task
    return ENV['execute'](request)


def denied(action):
    try:
        action()
    except Exception:
        return
    raise AssertionError('Expected proof refusal')


tests = 0
for manager in ('npm', 'pip'):
    fs, owner, cache, saved = fixture(manager)
    try:
        reply = invoke(owner)
        assert reply['receipt']['phase'] == 'ready'
        root = ENV['BASE'] + '/' + owner['stageId']
        copied = root + '/data'
        assert fs.nodes[copied].uid == owner['identity']['uid']
        assert fs.nodes[copied + '/LOCKSUMS'].uid == owner['identity']['uid']
        assert copied + '/credential-file' not in fs.nodes
        assert fs.nodes[cache + '/LOCKSUMS'].uid == 0
        before = list(fs.writes)
        assert invoke(owner, 'probe')['receipt'] == reply['receipt']
        assert fs.writes == before, 'Probe must be read-only'
        denied(lambda: invoke(owner))
        fs.native_run = copy.deepcopy(fs.native_ticket)
        task = {'run': fs.native_run}
        closed = invoke(owner, 'retire', reply['receipt'], task)
        assert closed['receipt']['phase'] == 'closed'
        assert copied not in fs.nodes
        assert fs.nodes[cache + '/LOCKSUMS'].uid == 0
        removed = list(fs.removed)
        assert invoke(owner, 'retire', reply['receipt'], task) == closed
        assert fs.removed == removed, 'Closed tombstone must not replay deletion'
        assert not fs.fds, 'No root authority fd may survive the helper'
        tests += 1
    finally:
        sys.modules['os'] = saved

for invalid in ('symlink', 'hardlink', 'fifo', 'writable-parent', 'wrong-owner', 'cross-device', 'corrupt-source'):
    fs, owner, cache, saved = fixture()
    try:
        artifact = fs.nodes[cache + '/data/artifact']
        if invalid == 'symlink': artifact.kind = 'link'
        elif invalid == 'hardlink': artifact.links = 2
        elif invalid == 'fifo': artifact.kind = 'fifo'
        elif invalid == 'writable-parent': fs.nodes['/var/cache'].mode = 0o777
        elif invalid == 'wrong-owner': artifact.uid = 20002
        elif invalid == 'cross-device': artifact.device = 99
        elif invalid == 'corrupt-source': fs.nodes['/usr/local/lib/sakura-project-identity/' + owner['build'] + '/controller.py'].content += b'altered'
        denied(lambda: invoke(owner))
        assert not fs.removed
        assert not fs.fds
        tests += 1
    finally:
        sys.modules['os'] = saved

for limit in ('file', 'total', 'nodes', 'depth'):
    fs, owner, cache, saved = fixture()
    original = {key: ENV[key] for key in ('LIMIT_FILE', 'LIMIT_TOTAL', 'LIMIT_NODES', 'LIMIT_DEPTH')}
    try:
        key = {'file': 'LIMIT_FILE', 'total': 'LIMIT_TOTAL', 'nodes': 'LIMIT_NODES', 'depth': 'LIMIT_DEPTH'}[limit]
        ENV[key] = 0
        denied(lambda: invoke(owner))
        assert fs.nodes[cache + '/LOCKSUMS'].uid == 0
        tests += 1
    finally:
        ENV.update(original)
        sys.modules['os'] = saved

for failure in ('stage-inode', 'data-inode', 'group-present', 'fsync', 'native-inode', 'mounted-data'):
    fs, owner, cache, saved = fixture()
    try:
        prepared = invoke(owner)['receipt']
        root = ENV['BASE'] + '/' + owner['stageId']
        fs.native_run = copy.deepcopy(fs.native_ticket)
        task = {'run': copy.deepcopy(fs.native_run)}
        before = list(fs.removed)
        if failure == 'stage-inode': fs.nodes[root].inode += 1000
        elif failure == 'data-inode': fs.nodes[root + '/data'].inode += 1000
        elif failure == 'group-present': fs.add('/sys/fs/cgroup/sakura-task-' + owner['owner']['runId'])
        elif failure == 'fsync': fs.failed_fsync = True
        elif failure == 'native-inode': fs.native_run = {**fs.native_run, 'cgroupInode': '99999'}
        elif failure == 'mounted-data': fs.nodes['/proc/self/mountinfo'].content += ('2 1 0:1 / ' + root + '/data rw - root root rw\n').encode()
        denied(lambda: invoke(owner, 'retire', prepared, task))
        assert fs.removed == before, 'Invalid proof must not delete any object'
        assert root + '/receipt.json' in fs.nodes
        assert not fs.fds
        tests += 1
    finally:
        sys.modules['os'] = saved

for manager in ('npm', 'pip'):
    fs, owner, cache, saved = fixture(manager)
    original_limit = ENV['LIMIT_FILE']
    try:
        ENV['LIMIT_FILE'] = 0
        denied(lambda: invoke(owner))
        root = ENV['BASE'] + '/' + owner['stageId']
        before = list(fs.writes)
        partial = invoke(owner, 'probe')['receipt']
        assert partial['phase'] == 'copying' and partial['manifest'] is None
        assert fs.writes == before, 'A partial/lost-ACK probe cannot publish or replay copy'
        denied(lambda: invoke(owner))
        closed = invoke(owner, 'retire', partial, {'run': None})
        assert closed['receipt']['phase'] == 'closed' and root + '/data' not in fs.nodes
        assert fs.nodes[cache + '/LOCKSUMS'].uid == 0
        assert not fs.fds
        tests += 1
    finally:
        ENV['LIMIT_FILE'] = original_limit
        sys.modules['os'] = saved

fs, owner, cache, saved = fixture()
try:
    fs.native_run = copy.deepcopy(fs.native_ticket)
    before = list(fs.writes)
    denied(lambda: invoke(owner))
    assert fs.writes == before, 'An already issued/archived native UUID cannot prepare a new stage'
    assert ENV['BASE'] + '/' + owner['stageId'] not in fs.nodes
    assert not fs.fds
    tests += 1
finally:
    sys.modules['os'] = saved

print(json.dumps({'tests': tests, 'limits': {'file': ENV['LIMIT_FILE'], 'total': ENV['LIMIT_TOTAL'],
                                          'nodes': ENV['LIMIT_NODES'], 'depth': ENV['LIMIT_DEPTH']}}))
