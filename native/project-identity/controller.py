#!/usr/bin/python3
"""Root control plane for persistent project accounts; commands never run here.

The C entry point consumes only fixed-size records under the same flock. A
reservation survives an interrupted account creation. Neither an incomplete
reservation nor an old boot/revision can authorize an execution.
"""
import base64
import ctypes
import errno
import fcntl
import grp
import hashlib
import json
import os
import pwd
import re
import selectors
import signal
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time
import uuid

BASE = '/var/lib/sakura/project-identities'
HOMES = '/var/lib/sakura-project-homes'
RUNTIME = '/run/sakura-project-identities'
BUILDS = '/usr/local/lib/sakura-project-identity'
MIGRATIONS = '/var/lib/sakura/project-directory-migrations'
CGROUP = '/sys/fs/cgroup'
NAMES = ['protocol.h', 'launcher.c', 'controller.py']
BINDING = struct.Struct('<8sIIIIQQQQQ37s17s32s37s256s1024sI577s')
RUN = struct.Struct('<8sIIIIQQQQQ37s37s17s37s37s65s64s32s634s')
UID_MAP = struct.Struct('<8sII37s17s37s149s')
REGISTRY = struct.Struct('<8sI37s207s')
NETWORK_GUARD = struct.Struct('<8sIIQQQ37s37s17s37s37s37s14s')
UUID = re.compile('[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}')
PROJECT = re.compile('default|[a-f0-9]{16}')
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/', 'LANG': 'C', 'LC_ALL': 'C'}
RUN_LIMIT = 1024
RUN_ARCHIVE_BATCH = 512
RUN_ARCHIVE_BUCKET_LIMIT = 4096
TERMINALS = '/run/sakura-project-terminals'


class Refusal(Exception):
    def __init__(self, code, detail=None):
        self.code = code
        self.detail = detail


def refuse(code, detail=None):
    raise Refusal(code, detail)


def identifier(value, pattern, code):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        refuse(code)
    return value


def trusted(info, directory=False, mode=None):
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        refuse('UNTRUSTED_RECORD')
    if info.st_uid != 0 or info.st_mode & 0o022:
        refuse('UNTRUSTED_RECORD')
    if mode is not None and stat.S_IMODE(info.st_mode) != mode:
        refuse('RECORD_PERMISSIONS')
    if not directory and info.st_nlink != 1:
        refuse('RECORD_LINKS')


def directory_fd(path, root_owned=True):
    if not isinstance(path, str) or not path.startswith('/') or len(path.encode()) > 1023:
        refuse('DIRECTORY_PATH')
    parts = path.split('/')[1:]
    if any(not part or part in ('.', '..') for part in parts) and path != '/':
        refuse('DIRECTORY_PATH')
    descriptor = os.open('/', os.O_PATH | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in parts if path != '/' else []:
            next_fd = os.open(part, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_fd
            info = os.fstat(descriptor)
            if not stat.S_ISDIR(info.st_mode):
                refuse('DIRECTORY_REPLACED')
            if root_owned:
                trusted(info, True)
        return descriptor
    except OSError:
        os.close(descriptor)
        refuse('UNTRUSTED_DIRECTORY' if root_owned else 'DIRECTORY_MIGRATION_REQUIRED')
    except BaseException:
        os.close(descriptor)
        raise


def make_directory(path, mode=0o700):
    parent = directory_fd(os.path.dirname(path))
    try:
        try:
            os.mkdir(os.path.basename(path), mode, dir_fd=parent)
        except FileExistsError:
            pass
        descriptor = os.open(os.path.basename(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                             dir_fd=parent)
        try:
            trusted(os.fstat(descriptor), True, mode)
        finally:
            os.close(descriptor)
    finally:
        os.close(parent)


def read(path, limit=262144, missing=False):
    parent = directory_fd(os.path.dirname(path))
    try:
        try:
            descriptor = os.open(os.path.basename(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            if missing:
                return None
            refuse('RECORD_ABSENT')
    finally:
        os.close(parent)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        trusted(info, mode=0o600)
        if info.st_size > limit:
            refuse('RECORD_BOUND')
        data = stream.read(limit + 1)
        if len(data) > limit:
            refuse('RECORD_BOUND')
        return data


def atomic(path, data):
    parent_path = os.path.dirname(path)
    parent = directory_fd(parent_path)
    os.close(parent)
    descriptor, temporary = tempfile.mkstemp(prefix='.record-', dir=parent_path)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        descriptor = os.open(parent_path, os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def json_read(path, missing=False, limit=262144):
    raw = read(path, limit, missing)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError):
        refuse('RECORD_JSON')


def json_write(path, value):
    atomic(path, (json.dumps(value, separators=(',', ':'), sort_keys=True) + '\n').encode())


def text(value, size):
    if not isinstance(value, str) or '\0' in value or len(value.encode()) >= size:
        refuse('RECORD_STRING')
    return value.encode().ljust(size, b'\0')


def decoded(value):
    end = value.find(b'\0')
    if end < 0 or any(value[end:]):
        refuse('RECORD_STRING')
    try:
        return value[:end].decode()
    except UnicodeError:
        refuse('RECORD_STRING')


def binding_path(project):
    return BASE + '/projects/' + project + '.bin'


def binding_write(value):
    atomic(binding_path(value['projectId']), BINDING.pack(
        b'SKIDB001', 1, 2 if value['phase'] == 'active' else 1, value['uid'], value['gid'], value['revision'],
        int(value['directoryDevice']), int(value['directoryInode']), int(value['homeDevice']), int(value['homeInode']),
        text(value['registryId'], 37), text(value['projectId'], 17), text(value['account'], 32),
        text(value['identityId'], 37), text(value['home'], 256), text(value['directory'], 1024),
        1 if value['networkIsolation'] == 'private' else 0, b'\0' * 577))


def binding_read(project, missing=False):
    data = read(binding_path(project), 2048, missing)
    if data is None:
        return None
    if len(data) != 2048:
        refuse('BINDING_SIZE')
    fields = BINDING.unpack(data)
    if fields[0] != b'SKIDB001' or fields[1] != 1 or fields[2] not in (1, 2) or fields[16] not in (0, 1) or any(fields[17]):
        refuse('BINDING_INVALID')
    registry, project_id, account, identity, home, directory = [decoded(value) for value in fields[10:16]]
    identifier(registry, UUID, 'REGISTRY_ID')
    identifier(identity, UUID, 'IDENTITY_ID')
    if project_id != project or not PROJECT.fullmatch(project_id) or fields[3] < 20000 or fields[3] > 59999 or fields[4] != fields[3] or not fields[5]:
        refuse('BINDING_IDENTITY')
    if account != 'skp' + identity.replace('-', '')[:24] or home != HOMES + '/' + identity:
        refuse('ACCOUNT_BINDING')
    return {'version': 1, 'phase': 'active' if fields[2] == 2 else 'intent', 'registryId': registry,
            'projectId': project_id, 'account': account, 'uid': fields[3], 'gid': fields[4],
            'identityId': identity, 'revision': fields[5], 'home': home, 'directory': directory,
            'directoryDevice': str(fields[6]), 'directoryInode': str(fields[7]),
            'homeDevice': str(fields[8]), 'homeInode': str(fields[9]),
            'networkIsolation': 'private' if fields[16] else 'host'}


def run_path(run):
    identifier(run, UUID, 'RUN_ID')
    return RUNTIME + '/runs/' + run + '.bin'


def run_bytes(value):
    return RUN.pack(
        b'SKIDR001', 1, 1 if value['phase'] == 'active' else 2, 2 if value['mode'] == 'inherit-current' else 1, 0,
        value['revision'], int(value['networkDevice']), int(value['networkInode']),
        int(value['cgroupDevice']), int(value['cgroupInode']), text(value['registryId'], 37),
        text(value['identityId'], 37), text(value['projectId'], 17), text(value['runId'], 37),
        text(value['bootId'], 37), text(value['build'], 65), text(value['cgroupName'], 64),
        text(value['namespace'], 32), b'\0' * 634)


def run_decode(run, data):
    if len(data) != 1024:
        refuse('RUN_SIZE')
    f = RUN.unpack(data)
    if f[0] != b'SKIDR001' or f[1] != 1 or f[2] not in (1, 2) or f[3] not in (1, 2) or f[4] or any(f[18]):
        refuse('RUN_INVALID')
    registry, identity, project, run_id, boot, build, cgroup, namespace = [decoded(value) for value in f[10:18]]
    for value in (registry, identity, run_id, boot):
        identifier(value, UUID, 'RUN_IDENTITY')
    if run_id != run or not PROJECT.fullmatch(project) or not re.fullmatch('[a-f0-9]{64}', build):
        refuse('RUN_IDENTITY')
    mode = 'inherit-current' if f[3] == 2 else 'independent'
    if mode == 'independent':
        if cgroup != 'sakura-identity-' + run:
            refuse('CGROUP_IDENTITY')
    elif not re.fullmatch('sakura-(task|main|service)-' + UUID.pattern, cgroup):
        refuse('CGROUP_IDENTITY')
    if namespace and namespace != 'sk-' + project:
        refuse('NETWORK_BINDING')
    return {'version': 1, 'phase': 'active' if f[2] == 1 else 'closed', 'mode': mode,
            'registryId': registry, 'identityId': identity, 'projectId': project, 'runId': run,
            'revision': f[5], 'networkDevice': str(f[6]), 'networkInode': str(f[7]),
            'cgroupDevice': str(f[8]), 'cgroupInode': str(f[9]), 'bootId': boot,
            'build': build, 'cgroupName': cgroup, 'namespace': namespace}


def run_archive_fd(run, create=False):
    identifier(run, UUID, 'RUN_ID')
    parent = directory_fd(RUNTIME)
    descriptors = [parent]
    try:
        for name in ('archives', run[:2]):
            if create:
                try:
                    os.mkdir(name, 0o700, dir_fd=descriptors[-1])
                    sync = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                                   dir_fd=descriptors[-1])
                    try:
                        os.fsync(sync)
                    finally:
                        os.close(sync)
                except FileExistsError:
                    pass
            try:
                descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                                     dir_fd=descriptors[-1])
            except FileNotFoundError:
                if not create:
                    return None
                raise
            descriptors.append(descriptor)
            trusted(os.fstat(descriptor), True, 0o700)
        return descriptors.pop()
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def run_archive_read(run):
    parent = run_archive_fd(run)
    if parent is None:
        return None
    try:
        try:
            descriptor = os.open(run + '.bin', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            return None
        with os.fdopen(descriptor, 'rb') as stream:
            info = os.fstat(stream.fileno())
            trusted(info, mode=0o600)
            if info.st_size != RUN.size:
                refuse('RUN_ARCHIVE_SIZE')
            data = stream.read(RUN.size + 1)
        if run_decode(run, data)['phase'] != 'closed':
            refuse('RUN_ARCHIVE_ACTIVE')
        return data
    finally:
        os.close(parent)


def run_read(run):
    data = read(run_path(run), RUN.size, True)
    archived = run_archive_read(run)
    if data is None:
        if archived is None:
            refuse('RECORD_ABSENT')
        return run_decode(run, archived)
    if archived is not None and archived != data:
        refuse('RUN_ARCHIVE_CONFLICT')
    return run_decode(run, data)


def run_write(value):
    data = run_bytes(value)
    archived = run_archive_read(value['runId'])
    if archived is not None:
        if value['phase'] != 'closed' or archived != data:
            refuse('RUN_ARCHIVED')
        # A repeated stop/read must not put the retired ticket back in the hot
        # directory. A crash may leave an identical original alongside it.
        return
    atomic(run_path(value['runId']), data)


def same(info, value, prefix):
    return str(info.st_dev) == value[prefix + 'Device'] and str(info.st_ino) == value[prefix + 'Inode']


def tool(name):
    for parent in ('/usr/sbin', '/usr/bin', '/sbin', '/bin'):
        candidate = parent + '/' + name
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    refuse('REQUIRED_TOOL', name)


def execute(argv, data=None, timeout=15, pass_fds=(), preexec_fn=None):
    try:
        result = subprocess.run(argv, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=CLEAN_ENV, timeout=timeout, check=False,
                                pass_fds=pass_fds, preexec_fn=preexec_fn)
    except (OSError, subprocess.SubprocessError):
        refuse('SYSTEM_TOOL_FAILED')
    if result.returncode or len(result.stdout) > 65536 or len(result.stderr) > 65536:
        refuse('SYSTEM_TOOL_FAILED', {'tool': os.path.basename(argv[0]), 'exit': result.returncode})
    return result.stdout


def account_check(value):
    try:
        account = pwd.getpwnam(value['account'])
        by_uid = pwd.getpwuid(value['uid'])
        group = grp.getgrnam(value['account'])
        by_gid = grp.getgrgid(value['gid'])
    except KeyError:
        refuse('ACCOUNT_ABSENT')
    if (account.pw_uid, account.pw_gid, account.pw_dir, account.pw_shell) != (value['uid'], value['gid'], value['home'], '/bin/sh') or by_uid.pw_name != value['account']:
        refuse('ACCOUNT_REPLACED')
    if group.gr_gid != value['gid'] or by_gid.gr_name != value['account'] or group.gr_mem not in ([], [value['account']]):
        refuse('GROUP_REPLACED')
    # No inherited supplementary memberships are accepted, even though the
    # launcher would clear them. This prevents silently adopting another account.
    if any(item.gr_gid != value['gid'] and value['account'] in item.gr_mem for item in grp.getgrall()):
        refuse('SUPPLEMENTARY_GROUP_CHANGED')


def home_check(value):
    parent = directory_fd(HOMES)
    try:
        descriptor = os.open(value['identityId'], os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
    except OSError:
        refuse('HOME_REPLACED')
    finally:
        os.close(parent)
    try:
        info = os.fstat(descriptor)
        if not same(info, value, 'home') or info.st_uid != value['uid'] or info.st_gid != value['gid'] or stat.S_IMODE(info.st_mode) != 0o700:
            refuse('HOME_REPLACED')
    finally:
        os.close(descriptor)


def project_directory(path):
    if not isinstance(path, str) or '\0' in path or any(ord(c) < 32 or ord(c) == 127 for c in path):
        refuse('DIRECTORY_PATH')
    descriptor = directory_fd(path, False)
    try:
        return os.fstat(descriptor)
    finally:
        os.close(descriptor)


def probe(value):
    info = project_directory(value['directory'])
    if not same(info, value, 'directory'):
        refuse('DIRECTORY_REPLACED')
    child = os.fork()
    if child == 0:
        try:
            # A permissions probe must not keep the parent's authority lock
            # alive if the controller is interrupted or killed.
            os.closerange(3, min(os.sysconf('SC_OPEN_MAX'), 1048576))
            os.setgroups([])
            os.setresgid(value['gid'], value['gid'], value['gid'])
            os.setresuid(value['uid'], value['uid'], value['uid'])
            descriptor = directory_fd(value['directory'], False)
            try:
                now = os.fstat(descriptor)
                allowed = same(now, value, 'directory') and os.access(value['directory'], os.R_OK | os.W_OK | os.X_OK)
                os.fchdir(descriptor)
                allowed = allowed and os.access('.', os.R_OK | os.W_OK | os.X_OK)
            finally:
                os.close(descriptor)
            os._exit(0 if allowed else 1)
        except BaseException:
            os._exit(1)
    reaped = False
    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            found, status = os.waitpid(child, os.WNOHANG)
            if found:
                reaped = True
                if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
                    refuse('DIRECTORY_MIGRATION_REQUIRED', {'uid': value['uid'], 'gid': value['gid'], 'account': value['account']})
                return
            time.sleep(.01)
        refuse('DIRECTORY_PROBE_TIMEOUT')
    finally:
        if not reaped:
            try:
                os.kill(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(child, 0)


def registry(readonly=False):
    value = json_read(BASE + '/registry.json', True, 1048576)
    anchor = read(BASE + '/registry.bin', 256, True)
    if value is None:
        if readonly:
            refuse('REGISTRY_INCOMPLETE')
        if anchor is not None or os.listdir(BASE + '/projects') or os.listdir(BASE + '/uids'):
            refuse('REGISTRY_INCOMPLETE')
        value = {'version': 1, 'registryId': str(uuid.uuid4()), 'reserved': {}}
        json_write(BASE + '/registry.json', value)
    if not isinstance(value, dict) or set(value) != {'version', 'registryId', 'reserved'} or value['version'] != 1:
        refuse('REGISTRY_INVALID')
    identifier(value['registryId'], UUID, 'REGISTRY_ID')
    expected_anchor = REGISTRY.pack(b'SKIDG001', 1, text(value['registryId'], 37), b'\0' * 207)
    if anchor is not None and anchor != expected_anchor:
        refuse('REGISTRY_REPLACED')
    if anchor is None:
        if readonly:
            refuse('REGISTRY_INCOMPLETE')
        atomic(BASE + '/registry.bin', expected_anchor)
    if not isinstance(value['reserved'], dict) or len(value['reserved']) > 4096:
        refuse('REGISTRY_BOUND')
    projects = set()
    for uid, reservation in value['reserved'].items():
        if not re.fullmatch('[0-9]{5}', uid) or not 20000 <= int(uid) <= 59999 or not isinstance(reservation, dict) or set(reservation) != {'projectId', 'identityId'}:
            refuse('REGISTRY_RESERVATION')
        identifier(reservation['projectId'], PROJECT, 'PROJECT_ID')
        identifier(reservation['identityId'], UUID, 'IDENTITY_ID')
        if reservation['projectId'] in projects:
            refuse('REGISTRY_DUPLICATE')
        projects.add(reservation['projectId'])
    return value


def reservation_check(value, store):
    expected = {'projectId': value['projectId'], 'identityId': value['identityId']}
    if value['registryId'] != store['registryId'] or store['reserved'].get(str(value['uid'])) != expected:
        refuse('REGISTRY_BINDING')


def expected(value, request):
    prior = request.get('expected')
    if prior is None:
        return
    if not isinstance(prior, dict) or set(prior) != {'registryId', 'identityId', 'revision'}:
        refuse('EXPECTED_IDENTITY')
    if any(value[key] != prior[key] for key in ('registryId', 'identityId', 'revision')):
        refuse('IDENTITY_STALE')


def ensure(request, store):
    project = request['projectId']
    directory = request['directory']
    network = request['networkIsolation']
    if network not in ('host', 'private'):
        refuse('NETWORK_MODE')
    info = project_directory(directory)
    value = binding_read(project, True)
    if value is None:
        if request.get('expected') is not None:
            refuse('IDENTITY_ABSENT')
        reserved = next(((int(uid), item) for uid, item in store['reserved'].items() if item['projectId'] == project), None)
        if reserved:
            uid, item = reserved
            identity = item['identityId']
        else:
            if len(store['reserved']) >= 4096:
                refuse('ACCOUNT_LIMIT')
            taken = {account.pw_uid for account in pwd.getpwall()} | {group.gr_gid for group in grp.getgrall()} | {int(uid) for uid in store['reserved']}
            uid = next((candidate for candidate in range(20000, 60000) if candidate not in taken), None)
            if uid is None:
                refuse('UID_EXHAUSTED')
            identity = str(uuid.uuid4())
            store['reserved'][str(uid)] = {'projectId': project, 'identityId': identity}
            json_write(BASE + '/registry.json', store)
        value = {'version': 1, 'phase': 'intent', 'registryId': store['registryId'], 'projectId': project,
                 'account': 'skp' + identity.replace('-', '')[:24], 'uid': uid, 'gid': uid,
                 'identityId': identity, 'revision': 1, 'home': HOMES + '/' + identity,
                 'directory': directory, 'directoryDevice': str(info.st_dev), 'directoryInode': str(info.st_ino),
                 'homeDevice': '0', 'homeInode': '0', 'networkIsolation': network}
        binding_write(value)
    reservation_check(value, store)
    expected(value, request)
    if value['directory'] != directory or value['networkIsolation'] != network:
        refuse('BINDING_CHANGE_REQUIRES_REBIND')
    if not same(info, value, 'directory'):
        refuse('DIRECTORY_REPLACED')
    if value['phase'] == 'intent':
        try:
            group = grp.getgrnam(value['account'])
        except KeyError:
            group = None
        try:
            account = pwd.getpwnam(value['account'])
        except KeyError:
            account = None
        if group is None:
            if any(item.gr_gid == value['gid'] for item in grp.getgrall()):
                refuse('GID_REPLACED')
            execute([tool('groupadd'), '-g', str(value['gid']), value['account']])
        elif group.gr_gid != value['gid'] or group.gr_mem not in ([], [value['account']]):
            refuse('GROUP_REPLACED')
        if account is None:
            if any(item.pw_uid == value['uid'] for item in pwd.getpwall()):
                refuse('UID_REPLACED')
            # A random unknown password keeps key-based SSH possible with
            # UsePAM=no. The plaintext and hash never enter binding/run records.
            password = uuid.uuid4().hex + uuid.uuid4().hex
            hashed = execute([tool('openssl'), 'passwd', '-6', '-stdin'], (password + '\n').encode()).decode().strip()
            if not hashed.startswith('$6$') or '\n' in hashed:
                refuse('ACCOUNT_PASSWORD')
            # System-account mode avoids mail spools, subordinate-ID grants and
            # account log initialization. The reserved UID/GID remain explicit;
            # no distribution's system-account allocator selects either ID.
            execute([tool('useradd'), '-r', '-M', '-l', '-G', '', '-u', str(value['uid']), '-g', str(value['gid']),
                     '-d', value['home'], '-s', '/bin/sh', '-p', hashed, value['account']])
        else:
            # Resume only the exact reserved account, before making any
            # password change. It is not launchable until the whole intent is
            # completed. Shadow utilities use their system account file locks.
            account_check(value)
            password = uuid.uuid4().hex + uuid.uuid4().hex
            hashed = execute([tool('openssl'), 'passwd', '-6', '-stdin'], (password + '\n').encode()).decode().strip()
            if not hashed.startswith('$6$') or '\n' in hashed:
                refuse('ACCOUNT_PASSWORD')
            execute([tool('chpasswd'), '-e'], (value['account'] + ':' + hashed + '\n').encode())
        account_check(value)
        if value['homeInode'] == '0':
            try:
                os.mkdir(value['home'], 0o700)
            except FileExistsError:
                info = os.lstat(value['home'])
                if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700 or os.listdir(value['home']):
                    refuse('HOME_REPLACED')
            info = os.lstat(value['home'])
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
                refuse('HOME_REPLACED')
            value['homeDevice'], value['homeInode'] = str(info.st_dev), str(info.st_ino)
            binding_write(value)
        info = os.lstat(value['home'])
        if not same(info, value, 'home') or not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, value['uid']):
            refuse('HOME_REPLACED')
        if info.st_uid == 0:
            if os.listdir(value['home']) or stat.S_IMODE(info.st_mode) != 0o700:
                refuse('HOME_REPLACED')
            os.chown(value['home'], value['uid'], value['gid'], follow_symlinks=False)
    account_check(value)
    home_check(value)
    probe(value)
    durable_account(value)
    value['phase'] = 'active'
    binding_write(value)
    uid_path = BASE + '/uids/' + str(value['uid']) + '.bin'
    mapping = UID_MAP.pack(b'SKIDU001', 1, value['uid'], text(value['registryId'], 37),
                           text(project, 17), text(value['identityId'], 37), b'\0' * 149)
    prior_mapping = read(uid_path, 256, True)
    if prior_mapping is not None and prior_mapping != mapping:
        refuse('UID_MAPPING_REPLACED')
    atomic(uid_path, mapping)
    return value


def active(project, request, store):
    value = binding_read(project)
    reservation_check(value, store)
    expected(value, request)
    if value['phase'] != 'active':
        refuse('IDENTITY_INCOMPLETE')
    account_check(value)
    home_check(value)
    mapping = UID_MAP.pack(b'SKIDU001', 1, value['uid'], text(value['registryId'], 37),
                           text(project, 17), text(value['identityId'], 37), b'\0' * 149)
    if read(BASE + '/uids/' + str(value['uid']) + '.bin', 256) != mapping:
        refuse('UID_MAPPING_REPLACED')
    probe(value)
    return value


def durable_account(value):
    # Account tools differ in their fsync behaviour. Complete these exact
    # system account files and the new home before publishing an active UID.
    for name in ('passwd', 'group', 'shadow', 'gshadow'):
        try:
            descriptor = os.open('/etc/' + name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        except FileNotFoundError:
            if name == 'gshadow':
                continue
            refuse('ACCOUNT_ABSENT')
        try:
            info = os.fstat(descriptor)
            # System account tools can retain a root-owned hard-link backup.
            # The inode's owner/mode protect every link; the stricter one-link
            # rule still applies to all Sakura authority records.
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                refuse('ACCOUNT_DATABASE_PERMISSIONS')
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    for path in ('/etc', value['home'], HOMES):
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def network_path(project, suffix='.json'):
    return RUNTIME + '/networks/' + project + suffix


def network_record(value):
    keys = {'version', 'registryId', 'identityId', 'projectId', 'revision', 'bootId',
            'namespace', 'networkDevice', 'networkInode', 'generation'}
    if not isinstance(value, dict) or set(value) != keys or type(value['version']) is not int or value['version'] != 1 or \
       type(value['revision']) is not int or not 1 <= value['revision'] <= 9007199254740991:
        refuse('NETWORK_RECORD_INVALID')
    for key in ('registryId', 'identityId', 'bootId', 'generation'):
        identifier(value[key], UUID, 'NETWORK_RECORD_INVALID')
    identifier(value['projectId'], PROJECT, 'NETWORK_RECORD_INVALID')
    if value['namespace'] != 'sk-' + value['projectId']:
        refuse('NETWORK_RECORD_INVALID')
    for key in ('networkDevice', 'networkInode'):
        if not isinstance(value[key], str) or not re.fullmatch('0|[1-9][0-9]*', value[key]) or int(value[key]) > 18446744073709551615:
            refuse('NETWORK_RECORD_INVALID')
    if value['networkInode'] == '0':
        refuse('NETWORK_RECORD_INVALID')
    return value


def network_matches(value, network):
    if value['networkIsolation'] != 'private' or any(network[key] != value[key] for key in ('registryId', 'identityId', 'projectId', 'revision')):
        refuse('NETWORK_STALE')


def network_plain(network):
    return {key: item for key, item in network.items() if key not in ('projectId', 'generation')}


def network_pin(project):
    pin = json_read(network_path(project), True)
    if pin is None:
        return None
    if not isinstance(pin, dict) or set(pin) != {'version', 'registryId', 'identityId', 'revision', 'bootId', 'namespace', 'networkDevice', 'networkInode'} or \
       type(pin['version']) is not int or pin['version'] != 1 or type(pin['revision']) is not int or not 1 <= pin['revision'] <= 9007199254740991:
        refuse('NETWORK_RECORD_INVALID')
    for key in ('registryId', 'identityId', 'bootId'):
        identifier(pin[key], UUID, 'NETWORK_RECORD_INVALID')
    if pin['namespace'] not in ('', 'sk-' + project):
        refuse('NETWORK_RECORD_INVALID')
    for key in ('networkDevice', 'networkInode'):
        if not isinstance(pin[key], str) or not re.fullmatch('0|[1-9][0-9]*', pin[key]) or int(pin[key]) > 18446744073709551615:
            refuse('NETWORK_RECORD_INVALID')
    if pin['networkInode'] == '0':
        refuse('NETWORK_RECORD_INVALID')
    return pin


def namespace_stat(namespace):
    try:
        parent = directory_fd('/run/netns')
    except Refusal:
        if not os.path.lexists('/run/netns'):
            return None
        raise
    try:
        try:
            return os.stat(namespace, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            return None
    finally:
        os.close(parent)


def network_guard(project):
    raw = read(network_path(project, '.release.bin'), 256, True)
    if raw is None:
        return None
    if len(raw) != 256:
        refuse('NETWORK_GUARD_INVALID')
    fields = NETWORK_GUARD.unpack(raw)
    if fields[0] != b'SKIDN001' or fields[1] != 1 or fields[2] not in (1, 2, 3) or any(fields[12]):
        refuse('NETWORK_GUARD_INVALID')
    registry, identity, project_id, boot, generation, release = [decoded(item) for item in fields[6:12]]
    network = network_record({'version': 1, 'registryId': registry, 'identityId': identity, 'projectId': project_id,
                              'revision': fields[3], 'bootId': boot, 'namespace': 'sk-' + project_id,
                              'networkDevice': str(fields[4]), 'networkInode': str(fields[5]), 'generation': generation})
    if project_id != project:
        refuse('NETWORK_GUARD_INVALID')
    identifier(release, UUID, 'NETWORK_GUARD_INVALID')
    return {'phase': ('pending', 'deleting', 'released')[fields[2] - 1], 'releaseId': release, 'network': network}


def network_guard_write(project, phase, release_id, network):
    network_record(network)
    if network['projectId'] != project:
        refuse('NETWORK_GUARD_INVALID')
    identifier(release_id, UUID, 'NETWORK_RELEASE_ID')
    atomic(network_path(project, '.release.bin'), NETWORK_GUARD.pack(
        b'SKIDN001', 1, {'pending': 1, 'deleting': 2, 'released': 3}[phase], network['revision'],
        int(network['networkDevice']), int(network['networkInode']), text(network['registryId'], 37),
        text(network['identityId'], 37), text(project, 17), text(network['bootId'], 37),
        text(network['generation'], 37), text(release_id, 37), b'\0' * 14))


def network_generation(project):
    epoch = json_read(network_path(project, '.generation.json'), True)
    if epoch is not None:
        if not isinstance(epoch, dict) or set(epoch) != {'version', 'phase', 'network'} or type(epoch['version']) is not int or epoch['version'] != 1 or epoch['phase'] not in ('active', 'retired'):
            refuse('NETWORK_GENERATION_INVALID')
        network_record(epoch['network'])
        if epoch['network']['projectId'] != project:
            refuse('NETWORK_GENERATION_INVALID')
    return epoch


def network_ready(value, boot):
    guard = network_guard(value['projectId'])
    owned_tool = network_tool(value['projectId'])
    if owned_tool is not None:
        network_matches(value, owned_tool['network'])
        if guard is None or guard['phase'] != 'deleting' or guard['releaseId'] != owned_tool['releaseId'] or guard['network'] != owned_tool['network']:
            refuse('NETWORK_TOOL_UNCONFIRMED')
    if guard is not None:
        network_matches(value, guard['network'])
        if guard['phase'] != 'released':
            if guard['network']['bootId'] != boot:
                refuse('NETWORK_STALE')
            refuse('NETWORK_RETIREMENT_PENDING')


def network_fd(value, boot):
    network_ready(value, boot)
    namespace = 'sk-' + value['projectId'] if value['networkIsolation'] == 'private' else ''
    try:
        if namespace:
            parent = directory_fd('/run/netns')
            try:
                descriptor = os.open(namespace, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW, dir_fd=parent)
            finally:
                os.close(parent)
        else:
            descriptor = os.open('/proc/1/ns/net', os.O_RDONLY | os.O_CLOEXEC)
    except OSError:
        refuse('NETWORK_ABSENT')
    try:
        info = os.fstat(descriptor)
        # /proc/self/fd of a bind-mounted namespace displays its mount path,
        # not necessarily "net:[inode]". Ask nsfs for the actual namespace type.
        if info.st_uid != 0 or fcntl.ioctl(descriptor, 0xb703) != 0x40000000:
            refuse('NETWORK_IDENTITY')
        if namespace:
            ip = tool('ip')
            links = execute([ip, '-n', namespace, '-o', 'link', 'show']).decode().strip().splitlines()
            if len(links) != 1 or not re.match(r'[0-9]+: lo:', links[0]):
                refuse('NETWORK_INTERFACES')
            if execute([ip, '-n', namespace, '-o', '-4', 'route', 'show']).strip() or execute([ip, '-n', namespace, '-o', '-6', 'route', 'show']).strip():
                refuse('NETWORK_ROUTES')
            now = os.stat('/run/netns/' + namespace, follow_symlinks=False)
            if (now.st_dev, now.st_ino) != (info.st_dev, info.st_ino):
                refuse('NETWORK_REPLACED')
        pinned = {'version': 1, 'registryId': value['registryId'], 'identityId': value['identityId'],
                  'revision': value['revision'], 'bootId': boot, 'namespace': namespace,
                  'networkDevice': str(info.st_dev), 'networkInode': str(info.st_ino)}
        pin_path = network_path(value['projectId'])
        prior = network_pin(value['projectId'])
        if prior is not None and prior != pinned:
            refuse('NETWORK_REPLACED')
        epoch = network_generation(value['projectId']) if namespace else None
        if epoch is not None:
            network_matches(value, epoch['network'])
        if epoch is not None and epoch['phase'] == 'active' and (prior is None or network_plain(epoch['network']) != pinned):
            refuse('NETWORK_REPLACED')
        if prior is None:
            json_write(pin_path, pinned)
        if namespace and (epoch is None or epoch['phase'] == 'retired'):
            network = dict(pinned, projectId=value['projectId'], generation=str(uuid.uuid4()))
            json_write(network_path(value['projectId'], '.generation.json'), {'version': 1, 'phase': 'active', 'network': network})
        return descriptor, info, namespace
    except BaseException:
        os.close(descriptor)
        raise


def network_capture(value, boot):
    network_ready(value, boot)
    if value['networkIsolation'] == 'host':
        return None
    info = namespace_stat('sk-' + value['projectId'])
    if info is None:
        pin = network_pin(value['projectId'])
        epoch = network_generation(value['projectId'])
        if pin is not None or (epoch is not None and epoch['phase'] == 'active'):
            refuse('NETWORK_ABSENT')
        if epoch is not None:
            network_matches(value, epoch['network'])
        return None
    descriptor, actual, _namespace = network_fd(value, boot)
    try:
        if (actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino):
            refuse('NETWORK_REPLACED')
        epoch = network_generation(value['projectId'])
        if epoch is None or epoch['phase'] != 'active':
            refuse('NETWORK_GENERATION_INVALID')
        network_matches(value, epoch['network'])
        return epoch['network']
    finally:
        os.close(descriptor)


def begin_network_release(value, request, boot):
    # The host persists this boot/nonce before asynchronous stop begins. A
    # receipt lost across reboot must never select a newly created namespace.
    requested_boot = identifier(request.get('bootId'), UUID, 'BOOT_ID')
    if requested_boot != boot:
        refuse('BOOT_CHANGED')
    release_id = identifier(request.get('releaseId'), UUID, 'NETWORK_RELEASE_ID')
    guard = network_guard(value['projectId'])
    if guard is not None:
        network_matches(value, guard['network'])
        if guard['releaseId'] == release_id:
            if guard['network']['bootId'] != boot:
                refuse('NETWORK_STALE')
            return {'version': 1, 'phase': 'pending', 'releaseId': release_id, 'network': guard['network']}
        if guard['phase'] != 'released':
            refuse('NETWORK_RETIREMENT_PENDING')
    network = network_capture(value, boot)
    if network is None:
        return None
    network_guard_write(value['projectId'], 'pending', release_id, network)
    return {'version': 1, 'phase': 'pending', 'releaseId': release_id, 'network': network}


def network_idle(value, boot):
    # Closed inherited tickets may still have a populated upper domain. Closed
    # is not proof that detached descendants have stopped.
    for run in runs_for(value):
        if run['bootId'] != boot:
            continue
        descriptor = cgroup_fd(run)
        try:
            if run['phase'] != 'closed' or (descriptor is not None and populated(descriptor)):
                refuse('NETWORK_RUNS_MUST_STOP')
        finally:
            if descriptor is not None:
                os.close(descriptor)


def network_namespace_fd(network):
    try:
        parent = directory_fd('/run/netns')
    except Refusal as error:
        # Missing parents are allowed only for the caller's explicit recovery
        # checks below; symlinks/permission substitutions are never absence.
        if not os.path.lexists('/run/netns'):
            return None
        raise error
    try:
        try:
            descriptor = os.open(network['namespace'], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            return None
    finally:
        os.close(parent)
    try:
        info = os.fstat(descriptor)
        if info.st_uid != 0 or fcntl.ioctl(descriptor, 0xb703) != 0x40000000 or not same(info, network, 'network'):
            refuse('NETWORK_REPLACED')
        now = os.stat('/run/netns/' + network['namespace'], follow_symlinks=False)
        if (now.st_dev, now.st_ino) != (info.st_dev, info.st_ino):
            refuse('NETWORK_REPLACED')
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def durable_unlink(path):
    parent = directory_fd(os.path.dirname(path))
    try:
        try:
            os.unlink(os.path.basename(path), dir_fd=parent)
        except FileNotFoundError:
            return
        # O_PATH cannot fsync. Reopen only the same verified parent.
        descriptor = os.open('.', os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        os.close(parent)


def network_tool(project):
    raw = read(network_path(project, '.tool.json'), 4096, True)
    if raw is None:
        return None
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                refuse('NETWORK_TOOL_INVALID')
            result[key] = item
        return result
    try:
        record = json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError):
        refuse('NETWORK_TOOL_INVALID')
    keys = {'version', 'phase', 'releaseId', 'network', 'build', 'cgroupName', 'cgroupDevice', 'cgroupInode'}
    if not isinstance(record, dict) or set(record) != keys or type(record['version']) is not int or record['version'] != 1 or record['phase'] not in ('creating', 'running'):
        refuse('NETWORK_TOOL_INVALID')
    network_record(record['network'])
    if record['network']['projectId'] != project:
        refuse('NETWORK_TOOL_INVALID')
    identifier(record['releaseId'], UUID, 'NETWORK_TOOL_INVALID')
    if record['cgroupName'] != 'sakura-network-release-' + record['releaseId'] or not isinstance(record['build'], str) or not re.fullmatch('[a-f0-9]{64}', record['build']):
        refuse('NETWORK_TOOL_INVALID')
    for key in ('cgroupDevice', 'cgroupInode'):
        if not isinstance(record[key], str) or not re.fullmatch('0|[1-9][0-9]*', record[key]) or int(record[key]) > 18446744073709551615:
            refuse('NETWORK_TOOL_INVALID')
    if (record['phase'] == 'creating' and (record['cgroupDevice'], record['cgroupInode']) != ('0', '0')) or \
       (record['phase'] == 'running' and record['cgroupInode'] == '0'):
        refuse('NETWORK_TOOL_INVALID')
    return record


def network_tool_clear(project, owned_tool):
    """Do not retire a namespace while an interrupted delete can still run.

    The inherited lock normally serializes recovery through exec/exit. A
    separately pinned cgroup remains authoritative even if a root utility
    closes inherited descriptors. No new namespace is selected during this
    bounded wait, and an unknown replacement is never adopted.
    """
    cgroup_available(False)
    parent = directory_fd(CGROUP)
    descriptor = None
    try:
        try:
            descriptor = os.open(owned_tool['cgroupName'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            # An interrupted cleanup may have removed the empty domain before
            # removing its receipt. A nonexistent cgroup cannot contain a tool.
            durable_unlink(network_path(project, '.tool.json'))
            return
        info = os.fstat(descriptor)
        trusted(info, True)
        if owned_tool['phase'] == 'running' and not same(info, owned_tool, 'cgroup'):
            refuse('NETWORK_TOOL_REPLACED')
        if owned_tool['phase'] == 'creating' and populated(descriptor):
            # A creating receipt cannot have launched any process yet.
            refuse('NETWORK_TOOL_REPLACED')
        deadline = time.monotonic() + 15
        while populated(descriptor):
            if time.monotonic() >= deadline:
                refuse('NETWORK_TOOL_RUNNING')
            time.sleep(.02)
        deadline = time.monotonic() + 5
        while True:
            now = os.stat(owned_tool['cgroupName'], dir_fd=parent, follow_symlinks=False)
            if (now.st_dev, now.st_ino) != (info.st_dev, info.st_ino):
                refuse('NETWORK_TOOL_REPLACED')
            try:
                os.rmdir(owned_tool['cgroupName'], dir_fd=parent)
                break
            except OSError as error:
                if error.errno not in (errno.EBUSY, errno.ENOTEMPTY) or time.monotonic() >= deadline:
                    refuse('NETWORK_TOOL_CLEANUP_FAILED')
                time.sleep(.02)
        durable_unlink(network_path(project, '.tool.json'))
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent)


def network_delete(project, network, release_id, control_lock):
    # This is the controller's already-held EX descriptor, never a caller path.
    info = os.fstat(control_lock)
    trusted(info, mode=0o600)
    actual = os.stat(BASE + '/lock', follow_symlinks=False)
    if (actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino):
        refuse('REGISTRY_LOCK_REPLACED')
    fcntl.flock(control_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    cgroup_available(True)
    record = {'version': 1, 'phase': 'creating', 'releaseId': release_id, 'network': network,
              'build': sources(), 'cgroupName': 'sakura-network-release-' + release_id,
              'cgroupDevice': '0', 'cgroupInode': '0'}
    if network_tool(project) is not None:
        refuse('NETWORK_TOOL_UNCONFIRMED')
    parent = directory_fd(CGROUP)
    descriptor = None
    try:
        # The intent precedes mkdir. Before the running receipt is committed,
        # no child can enter this name; a crash leaves only a known empty domain.
        try:
            os.stat(record['cgroupName'], dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            refuse('NETWORK_TOOL_REPLACED')
        json_write(network_path(project, '.tool.json'), record)
        os.mkdir(record['cgroupName'], 0o755, dir_fd=parent)
        descriptor = os.open(record['cgroupName'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        info = os.fstat(descriptor)
        trusted(info, True)
        if populated(descriptor):
            refuse('NETWORK_TOOL_REPLACED')
        record.update(phase='running', cgroupDevice=str(info.st_dev), cgroupInode=str(info.st_ino))
        json_write(network_path(project, '.tool.json'), record)
        def enter():
            target = os.open('cgroup.procs', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
            try:
                os.write(target, str(os.getpid()).encode())
            finally:
                os.close(target)
                os.close(descriptor)
        execute([tool('ip'), 'netns', 'delete', network['namespace']],
                pass_fds=(control_lock, descriptor), preexec_fn=enter)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent)
    network_tool_clear(project, record)


def release_network(value, request, boot, control_lock):
    network = network_record(request.get('network'))
    network_matches(value, network)
    release_id = identifier(request.get('releaseId'), UUID, 'NETWORK_RELEASE_ID')
    project = value['projectId']
    guard = network_guard(project)
    owned_tool = network_tool(project)
    if guard is not None:
        network_matches(value, guard['network'])
        if guard['releaseId'] != release_id or guard['network'] != network:
            refuse('NETWORK_RELEASE_STALE')
        if guard['phase'] == 'released':
            # This exact acknowledgement remains valid even after a fresh
            # namespace/generation exists. Do not inspect or delete the latter.
            if owned_tool is not None:
                refuse('NETWORK_TOOL_UNCONFIRMED')
            return {'version': 1, 'phase': 'released', 'releaseId': release_id, 'network': network}
    network_idle(value, boot)
    if owned_tool is not None:
        if owned_tool['releaseId'] != release_id or owned_tool['network'] != network or network['bootId'] != boot or guard is None or guard['phase'] != 'deleting':
            refuse('NETWORK_TOOL_UNCONFIRMED')
        network_tool_clear(project, owned_tool)
    pin = network_pin(project)
    epoch = network_generation(project)
    if network['bootId'] != boot:
        # /run authority and namespaces disappear on reboot. Complete only
        # the fixed old lease, without ip deletion or adoption of current state.
        if guard is not None or pin is not None or epoch is not None or namespace_stat(network['namespace']) is not None:
            refuse('NETWORK_RELEASE_STALE')
        network_guard_write(project, 'released', release_id, network)
        return {'version': 1, 'phase': 'released', 'releaseId': release_id, 'network': network}
    if guard is None:
        refuse('NETWORK_RELEASE_REQUIRED')
    if pin is not None and pin != network_plain(network):
        refuse('NETWORK_REPLACED')
    if epoch is None or epoch['network'] != network or (epoch['phase'] == 'retired' and guard['phase'] != 'deleting'):
        refuse('NETWORK_REPLACED')
    if pin is None and guard['phase'] != 'deleting':
        refuse('NETWORK_ABSENT')
    descriptor = network_namespace_fd(network)
    try:
        if descriptor is None and guard['phase'] != 'deleting':
            refuse('NETWORK_ABSENT')
        if descriptor is not None:
            ip = tool('ip')
            if execute([ip, 'netns', 'pids', network['namespace']]).strip():
                refuse('NETWORK_PROCESSES_REMAIN')
            # Persist permission to resume an interrupted delete before invoking
            # the fixed root tool. All new launchers remain blocked throughout.
            network_guard_write(project, 'deleting', release_id, network)
            now = os.stat('/run/netns/' + network['namespace'], follow_symlinks=False)
            if not same(now, network, 'network'):
                refuse('NETWORK_REPLACED')
            network_delete(project, network, release_id, control_lock)
            if namespace_stat(network['namespace']) is not None:
                refuse('NETWORK_REPLACED')
        if pin is not None:
            durable_unlink(network_path(project))
        json_write(network_path(project, '.generation.json'), {'version': 1, 'phase': 'retired', 'network': network})
        network_guard_write(project, 'released', release_id, network)
        return {'version': 1, 'phase': 'released', 'releaseId': release_id, 'network': network}
    finally:
        if descriptor is not None:
            os.close(descriptor)


def cgroup_fd(value):
    cgroup_available(False)
    parent = directory_fd(CGROUP)
    try:
        try:
            descriptor = os.open(value['cgroupName'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            return None
    finally:
        os.close(parent)
    info = os.fstat(descriptor)
    trusted(info, True)
    if not same(info, value, 'cgroup'):
        os.close(descriptor)
        refuse('CGROUP_REPLACED')
    return descriptor


def cgroup_available(start=False):
    def mounted():
        for line in open('/proc/self/mountinfo'):
            fields = line.split()
            if len(fields) > 9 and fields[4] == CGROUP and '-' in fields and fields[fields.index('-') + 1] == 'cgroup2':
                return True
        return False
    if not mounted() and start and os.path.isfile('/sbin/rc-service'):
        execute(['/sbin/rc-service', 'cgroups', 'start'], timeout=30)
    if not mounted():
        refuse('CGROUP_UNAVAILABLE')
    descriptor = directory_fd(CGROUP)
    os.close(descriptor)


def populated(descriptor):
    fd = os.open('cgroup.events', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
    with os.fdopen(fd, 'rb') as stream:
        content = stream.read(4096)
    if not re.search(rb'^populated [01]$', content, re.M):
        refuse('CGROUP_EVENTS')
    return b'populated 1\n' in content


def run_entries():
    parent = directory_fd(RUNTIME + '/runs')
    try:
        descriptor = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
    finally:
        os.close(parent)
    try:
        entries = []
        with os.scandir(descriptor) as iterator:
            for entry in iterator:
                if len(entries) >= RUN_LIMIT:
                    refuse('RUN_LIMIT')
                if not entry.name.endswith('.bin') or not UUID.fullmatch(entry.name[:-4]):
                    refuse('RUN_UNKNOWN_FILE')
                entries.append(entry.name)
        return sorted(entries)
    finally:
        os.close(descriptor)


def runs_for(value, records=None):
    result = []
    for run in records if records is not None else [run_read(entry[:-4]) for entry in run_entries()]:
        if run['registryId'] == value['registryId'] and run['identityId'] == value['identityId']:
            result.append(run)
    return result


def run_archive_publish(parent, temporary, destination):
    # Publish a complete, fsynced file without replacing an existing tombstone.
    # Linux guests already require pidfd/cgroup v2. An unavailable atomic
    # no-replace primitive refuses archival and retains the original ticket.
    libc = ctypes.CDLL(None, use_errno=True)
    try:
        rename = libc.renameat2
    except AttributeError:
        # Older musl has the kernel primitive without a libc wrapper. Use the
        # same atomic operation only on known native 64-bit Linux ABIs.
        number = {'x86_64': 316, 'aarch64': 276}.get(os.uname().machine)
        if number is None or ctypes.sizeof(ctypes.c_void_p) != 8 or ctypes.sizeof(ctypes.c_long) != 8:
            refuse('RUN_ARCHIVE_ATOMIC_UNAVAILABLE')
        try:
            syscall = libc.syscall
        except AttributeError:
            refuse('RUN_ARCHIVE_ATOMIC_UNAVAILABLE')
        syscall.argtypes = (ctypes.c_long,)
        syscall.restype = ctypes.c_long
        result = syscall(ctypes.c_long(number), ctypes.c_int(parent), ctypes.c_char_p(temporary.encode()),
                         ctypes.c_int(parent), ctypes.c_char_p(destination.encode()), ctypes.c_uint(1))
    else:
        rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
        rename.restype = ctypes.c_int
        result = rename(parent, temporary.encode(), parent, destination.encode(), 1)
    if result:
        error = ctypes.get_errno()
        if error == errno.EEXIST:
            refuse('RUN_ARCHIVE_CONFLICT')
        if error in (errno.ENOSYS, errno.EINVAL, errno.EOPNOTSUPP):
            refuse('RUN_ARCHIVE_ATOMIC_UNAVAILABLE')
        refuse('RUN_ARCHIVE_PUBLISH_FAILED')


def run_archive(value, boot):
    if value['phase'] != 'closed' or value['bootId'] != boot:
        refuse('RUN_ARCHIVE_STALE')
    run = value['runId']
    data = run_bytes(value)
    source_parent = directory_fd(RUNTIME + '/runs')
    source = destination = None
    temporary = temporary_info = None
    published = False
    try:
        source = os.open(run + '.bin', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=source_parent)
        info = os.fstat(source)
        trusted(info, mode=0o600)
        if info.st_size != RUN.size or os.read(source, RUN.size + 1) != data:
            refuse('RUN_ARCHIVE_CONFLICT')
        descriptor = cgroup_fd(value)
        try:
            if descriptor is not None and populated(descriptor):
                return False
        finally:
            if descriptor is not None:
                os.close(descriptor)
        destination = run_archive_fd(run, True)
        archived = run_archive_read(run)
        if archived is not None and archived != data:
            refuse('RUN_ARCHIVE_CONFLICT')
        if archived is None:
            with os.scandir(destination) as iterator:
                for index, _entry in enumerate(iterator, 1):
                    if index >= RUN_ARCHIVE_BUCKET_LIMIT:
                        refuse('RUN_ARCHIVE_LIMIT')
            temporary = '.record-' + str(uuid.uuid4())
            output = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                             0o600, dir_fd=destination)
            try:
                temporary_info = os.fstat(output)
                trusted(temporary_info, mode=0o600)
                view = memoryview(data)
                while view:
                    written = os.write(output, view)
                    if written <= 0:
                        refuse('RUN_ARCHIVE_WRITE_FAILED')
                    view = view[written:]
                os.fsync(output)
                run_archive_publish(destination, temporary, run + '.bin')
                published = True
            finally:
                os.close(output)
        os.fsync(destination)
        if run_archive_read(run) != data:
            refuse('RUN_ARCHIVE_CONFLICT')
        # A retained descriptor alone does not authorize removal through a new
        # parent or a replaced leaf. The registry EX lock excludes launchers.
        current_parent = directory_fd(RUNTIME + '/runs')
        try:
            old_parent = os.fstat(source_parent)
            new_parent = os.fstat(current_parent)
            if (old_parent.st_dev, old_parent.st_ino) != (new_parent.st_dev, new_parent.st_ino):
                refuse('RUN_ARCHIVE_SOURCE_CHANGED')
        finally:
            os.close(current_parent)
        current = os.stat(run + '.bin', dir_fd=source_parent, follow_symlinks=False)
        trusted(current, mode=0o600)
        fields = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        if any(getattr(current, field) != getattr(info, field) for field in fields):
            refuse('RUN_ARCHIVE_SOURCE_CHANGED')
        os.lseek(source, 0, os.SEEK_SET)
        if os.read(source, RUN.size + 1) != data:
            refuse('RUN_ARCHIVE_SOURCE_CHANGED')
        descriptor = cgroup_fd(value)
        try:
            if descriptor is not None and populated(descriptor):
                refuse('RUN_ARCHIVE_SCOPE_BUSY')
        finally:
            if descriptor is not None:
                os.close(descriptor)
        os.unlink(run + '.bin', dir_fd=source_parent)
        sync = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=source_parent)
        try:
            os.fsync(sync)
        finally:
            os.close(sync)
        return True
    finally:
        try:
            if temporary is not None and not published and destination is not None and temporary_info is not None:
                try:
                    current = os.stat(temporary, dir_fd=destination, follow_symlinks=False)
                    if (current.st_dev, current.st_ino) == (temporary_info.st_dev, temporary_info.st_ino):
                        os.unlink(temporary, dir_fd=destination)
                        os.fsync(destination)
                except FileNotFoundError:
                    pass
        finally:
            for descriptor in (source, destination, source_parent):
                if descriptor is not None:
                    os.close(descriptor)


def compact_runs(boot, records=None):
    # Never retire active tickets, old boots, changed groups or a closed ticket
    # whose upper task/service domain still has live descendants.
    candidates = []
    for value in records if records is not None else [run_read(entry[:-4]) for entry in run_entries()]:
        if value['phase'] == 'closed':
            if value['bootId'] != boot:
                refuse('RUN_ARCHIVE_STALE')
            candidates.append(value)
    retired = 0
    for value in candidates:
        if run_archive(value, boot):
            retired += 1
            if retired == RUN_ARCHIVE_BATCH:
                break
    return retired


def check_run(value, run, boot, require_active=True):
    if any(run[key] != value[key] for key in ('registryId', 'projectId', 'identityId', 'revision')) or run['bootId'] != boot:
        refuse('RUN_STALE')
    if require_active and run['phase'] != 'active':
        refuse('RUN_CLOSED')


def current_cgroup():
    with open('/proc/self/cgroup', 'r') as stream:
        membership = stream.read(4097)
    if not re.fullmatch('0::/(sakura-(task|main|service)-' + UUID.pattern + r')\n', membership):
        refuse('INHERITED_CGROUP_UNREGISTERED')
    return membership[4:].strip()


def migration_latch(value):
    """Read the migration latch while holding the shared identity EX lock.

    A failed/partial permission migration cannot create or retry a run. Repair
    and inspection remain possible, and the latch is released only after the
    migration helper records the complete current binding under this lock.
    """
    parent = directory_fd(os.path.dirname(MIGRATIONS))
    descriptors = [parent]
    try:
        for part in (os.path.basename(MIGRATIONS), value['projectId']):
            try:
                descriptor = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                                     dir_fd=descriptors[-1])
            except FileNotFoundError:
                return
            descriptors.append(descriptor)
            trusted(os.fstat(descriptor), True, 0o700)
        try:
            descriptor = os.open('latch.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                                 dir_fd=descriptors[-1])
        except FileNotFoundError:
            return
        with os.fdopen(descriptor, 'rb') as stream:
            info = os.fstat(stream.fileno())
            trusted(info, mode=0o600)
            if info.st_size > 262144:
                refuse('DIRECTORY_MIGRATION_INVALID')
            raw = stream.read(262145)
            if len(raw) > 262144:
                refuse('DIRECTORY_MIGRATION_INVALID')
    except OSError:
        refuse('DIRECTORY_MIGRATION_INVALID')
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)

    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                refuse('DIRECTORY_MIGRATION_INVALID')
            result[key] = item
        return result
    try:
        latch = json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError):
        refuse('DIRECTORY_MIGRATION_INVALID')
    keys = {'version', 'projectId', 'planId', 'sha256', 'phase', 'identity'}
    if not isinstance(latch, dict) or set(latch) != keys or type(latch['version']) is not int or latch['version'] != 1:
        refuse('DIRECTORY_MIGRATION_INVALID')
    if latch['projectId'] != value['projectId'] or not isinstance(latch['planId'], str) or not UUID.fullmatch(latch['planId']) or \
       not isinstance(latch['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', latch['sha256']) or \
       latch['phase'] not in ('applying', 'failed', 'directory-applied', 'applied'):
        refuse('DIRECTORY_MIGRATION_INVALID')
    prior = latch['identity']
    if not isinstance(prior, dict) or set(prior) != set(value):
        refuse('DIRECTORY_MIGRATION_IDENTITY')
    if type(prior['version']) is not int or prior['version'] != 1 or prior['phase'] not in ('intent', 'active') or \
       type(prior['revision']) is not int or not 1 <= prior['revision'] <= 9007199254740991 or \
       type(prior['uid']) is not int or not 20000 <= prior['uid'] <= 59999 or \
       type(prior['gid']) is not int or prior['gid'] != prior['uid']:
        refuse('DIRECTORY_MIGRATION_IDENTITY')
    for key in ('registryId', 'identityId'):
        if not isinstance(prior[key], str) or not UUID.fullmatch(prior[key]):
            refuse('DIRECTORY_MIGRATION_IDENTITY')
    for key in ('directoryDevice', 'directoryInode', 'homeDevice', 'homeInode'):
        if not isinstance(prior[key], str) or not re.fullmatch('0|[1-9][0-9]*', prior[key]):
            refuse('DIRECTORY_MIGRATION_IDENTITY')
    path = prior['directory']
    if not isinstance(path, str) or not path.startswith('/') or len(path.encode()) > 1023 or \
       re.search('[\x00-\x1f\x7f]', path) or (path != '/' and any(not p or p in ('.', '..') for p in path.split('/')[1:])) or \
       prior['directoryInode'] == '0' or (prior['phase'] == 'active' and prior['homeInode'] == '0') or \
       prior['networkIsolation'] not in ('host', 'private'):
        refuse('DIRECTORY_MIGRATION_IDENTITY')
    # Repair may advance the phase/revision or directory fingerprint while the
    # latch remains blocking. Its reserved account and private home cannot move.
    fixed = ('registryId', 'projectId', 'identityId', 'account', 'uid', 'gid', 'home', 'homeDevice', 'homeInode')
    if any(prior[key] != value[key] for key in fixed):
        refuse('DIRECTORY_MIGRATION_IDENTITY')
    return latch


def migration_ready(value):
    latch = migration_latch(value)
    if latch is None:
        return
    if latch['phase'] != 'applied':
        refuse('DIRECTORY_MIGRATION_PENDING')
    if latch['identity'] != value:
        refuse('DIRECTORY_MIGRATION_IDENTITY')


def migration_retire_applied(value):
    latch = migration_latch(value)
    if latch is None or latch['phase'] != 'applied':
        return
    if latch['identity'] != value:
        refuse('DIRECTORY_MIGRATION_IDENTITY')
    # Rebind has already validated the new directory as this exact account.
    # Retire only the confirmed old gate before the new binding is committed;
    # unfinished migrations retain their gate through repair and confirmation.
    durable_unlink(MIGRATIONS + '/' + value['projectId'] + '/latch.json')


def prepare(value, request, boot, build, inherit=False):
    migration_ready(value)
    network_ready(value, boot)
    # One bounded, validated snapshot under the same registry EX lock. Every
    # retired original is still opened and checked again by run_archive.
    records = [run_read(entry[:-4]) for entry in run_entries()]
    history = runs_for(value, records)
    # Historical privileged binaries can still consume their own active
    # tickets. An upgrade must close those exact runs before issuing a ticket
    # for the protected transport; stop remains reachable through this build.
    for run in history:
        if run['bootId'] != boot or run['build'] == build:
            continue
        if run['phase'] == 'active':
            refuse('UPGRADE_RUNS_MUST_STOP')
        descriptor = cgroup_fd(run)
        try:
            # stop publishes closed before kill/confirmation; an inherited
            # ticket also closes while its upper domain can remain populated.
            if descriptor is not None and populated(descriptor):
                refuse('UPGRADE_RUNS_MUST_STOP')
        finally:
            if descriptor is not None:
                os.close(descriptor)
    cgroup_available(True)
    requested = request.get('runId')
    if requested is not None:
        identifier(requested, UUID, 'RUN_ID')
        if run_archive_read(requested) is not None:
            refuse('RUN_ARCHIVED')
        existing = read(run_path(requested), 1024, True)
        if existing is not None:
            run = run_read(requested)
            check_run(value, run, boot)
            if run['build'] != build or run['mode'] != ('inherit-current' if inherit else 'independent'):
                refuse('RUN_STALE')
            if inherit and current_cgroup() != run['cgroupName']:
                refuse('CGROUP_MEMBERSHIP')
            descriptor = cgroup_fd(run)
            if descriptor is None:
                refuse('CGROUP_ABSENT')
            os.close(descriptor)
            fd, info, namespace = network_fd(value, boot)
            os.close(fd)
            if not same(info, run, 'network') or namespace != run['namespace']:
                refuse('NETWORK_REPLACED')
            return run
    if len(run_entries()) >= RUN_LIMIT:
        compact_runs(boot, records)
    if sum(item['phase'] == 'active' for item in history) >= 32 or len(run_entries()) >= RUN_LIMIT:
        refuse('RUN_LIMIT')
    run_id = requested or str(uuid.uuid4())
    if requested is None and (read(run_path(run_id), RUN.size, True) is not None or run_archive_read(run_id) is not None):
        refuse('RUN_ID_COLLISION')
    network, network_info, namespace = network_fd(value, boot)
    try:
        name = current_cgroup() if inherit else 'sakura-identity-' + run_id
        parent = directory_fd(CGROUP)
        try:
            if not inherit:
                try:
                    os.mkdir(name, 0o755, dir_fd=parent)
                except FileExistsError:
                    # No ticket authorizes adoption of an existing namespace.
                    refuse('CGROUP_ALREADY_EXISTS')
            descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        finally:
            os.close(parent)
        try:
            info = os.fstat(descriptor)
            trusted(info, True)
            # Independent cancellation must include detached descendants.
            if not inherit:
                kill = os.open('cgroup.kill', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
                os.close(kill)
            run = {'version': 1, 'phase': 'active', 'mode': 'inherit-current' if inherit else 'independent',
                   'registryId': value['registryId'], 'identityId': value['identityId'], 'projectId': value['projectId'],
                   'runId': run_id, 'revision': value['revision'], 'bootId': boot, 'build': build,
                   'networkDevice': str(network_info.st_dev), 'networkInode': str(network_info.st_ino),
                   'cgroupDevice': str(info.st_dev), 'cgroupInode': str(info.st_ino), 'cgroupName': name,
                   'namespace': namespace}
            run_write(run)
            return run
        finally:
            os.close(descriptor)
    finally:
        os.close(network)


def stop(value, run, boot):
    check_run(value, run, boot, False)
    run['phase'] = 'closed'
    run_write(run)
    if run['mode'] == 'inherit-current':
        # The upper owner is responsible for its domain. Closing this ticket
        # never kills a neighbouring task/service/main process.
        return run
    descriptor = cgroup_fd(run)
    if descriptor is None:
        return run
    try:
        kill = os.open('cgroup.kill', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
        try:
            os.write(kill, b'1\n')
        finally:
            os.close(kill)
        deadline = time.monotonic() + 5
        while populated(descriptor):
            if time.monotonic() >= deadline:
                refuse('PROJECT_IDENTITY_CLEANUP_FAILED')
            time.sleep(.02)
        while True:
            # Recheck the name before removing it; the pinned FD only authorizes
            # this cgroup, not a later directory placed at the same pathname.
            info = os.stat(CGROUP + '/' + run['cgroupName'], follow_symlinks=False)
            if not same(info, run, 'cgroup'):
                refuse('CGROUP_REPLACED')
            try:
                os.rmdir(CGROUP + '/' + run['cgroupName'])
                break
            except OSError as error:
                if error.errno not in (errno.EBUSY, errno.ENOTEMPTY) or time.monotonic() >= deadline:
                    refuse('PROJECT_IDENTITY_CLEANUP_FAILED')
                time.sleep(.02)
    except OSError:
        refuse('PROJECT_IDENTITY_CLEANUP_FAILED')
    finally:
        os.close(descriptor)
    return run


def rebind(value, request, boot):
    if request.get('expected') is None:
        refuse('EXPECTED_IDENTITY_REQUIRED')
    network_ready(value, boot)
    for run in runs_for(value):
        if run['bootId'] != boot:
            continue
        descriptor = cgroup_fd(run)
        try:
            if run['phase'] == 'active' or (descriptor is not None and populated(descriptor)):
                refuse('RUNS_MUST_STOP')
        finally:
            if descriptor is not None:
                os.close(descriptor)
    directory = request['directory']
    info = project_directory(directory)
    network = request['networkIsolation']
    if network not in ('host', 'private'):
        refuse('NETWORK_MODE')
    candidate = dict(value, directory=directory, directoryDevice=str(info.st_dev), directoryInode=str(info.st_ino),
                     networkIsolation=network, revision=value['revision'] + 1)
    probe(candidate)
    migration_retire_applied(value)
    binding_write(candidate)
    for suffix in ('.json', '.generation.json', '.release.bin', '.tool.json'):
        durable_unlink(network_path(value['projectId'], suffix))
    return candidate


def sources():
    folder = os.path.dirname(os.path.realpath(__file__))
    build = os.path.basename(folder)
    if folder != BUILDS + '/' + build or not re.fullmatch('[a-f0-9]{64}', build):
        refuse('CONTROLLER_IMAGE')
    descriptor = directory_fd(folder)
    os.close(descriptor)
    manifest = json_read(folder + '/manifest.json')
    if not isinstance(manifest, dict) or set(manifest) != {'version', 'build', 'files'} or manifest['version'] != 1 or manifest['build'] != build or not isinstance(manifest['files'], list) or len(manifest['files']) != 3:
        refuse('SOURCE_MANIFEST')
    aggregate = hashlib.sha256()
    for name, entry in zip(NAMES, manifest['files']):
        if not isinstance(entry, dict) or set(entry) != {'name', 'size', 'sha256'} or entry['name'] != name:
            refuse('SOURCE_MANIFEST')
        data = read(folder + '/' + name)
        if entry['size'] != len(data) or entry['sha256'] != hashlib.sha256(data).hexdigest():
            refuse('SOURCE_DIGEST')
        aggregate.update(name.encode())
        aggregate.update(data)
    if aggregate.hexdigest() != build:
        refuse('SOURCE_DIGEST')
    executable = os.lstat(folder + '/launch')
    trusted(executable)
    if stat.S_IMODE(executable.st_mode) != 0o4755:
        refuse('LAUNCHER_PERMISSIONS')
    return build


def initialize():
    for path, mode in (('/var/lib/sakura', 0o711), (BASE, 0o700), (BASE + '/projects', 0o700),
                       (BASE + '/uids', 0o700), (HOMES, 0o711), (RUNTIME, 0o700),
                       (RUNTIME + '/runs', 0o700), (RUNTIME + '/archives', 0o700),
                       (RUNTIME + '/networks', 0o700), (RUNTIME + '/terminals', 0o700),
                       (RUNTIME + '/terminal-locks', 0o700),
                       (TERMINALS, 0o711)):
        if path == '/var/lib/sakura' and os.path.exists(path):
            fd = directory_fd(path)
            os.close(fd)
        else:
            make_directory(path, mode)
    lock = os.open(BASE + '/lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    trusted(os.fstat(lock), mode=0o600)
    deadline = time.monotonic() + 10
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return lock
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(lock)
                refuse('REGISTRY_BUSY')
            time.sleep(.01)


def initialize_readonly():
    descriptor = directory_fd(BASE)
    try:
        trusted(os.fstat(descriptor), True, 0o700)
        lock = os.open('lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
    finally:
        os.close(descriptor)
    try:
        trusted(os.fstat(lock), mode=0o600)
        deadline = time.monotonic() + 10
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
                return lock
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    refuse('REGISTRY_BUSY')
                time.sleep(.01)
    except BaseException:
        os.close(lock)
        raise


def launch_argv(value, run, request, build):
    digest = request.get('payloadSha256')
    if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest):
        refuse('PAYLOAD_DIGEST')
    # The body stays on the authenticated channel. The root controller never
    # parses, interprets or records any project command/environment.
    return [BUILDS + '/' + build + '/launch', '--project', value['projectId'], value['identityId'],
            str(value['revision']), run['runId'], '--payload', digest]


def terminal_path(run_id):
    return RUNTIME + '/terminals/' + identifier(run_id, UUID, 'RUN_ID') + '.json'


def terminal_lock(run_id, create=False):
    parent = directory_fd(RUNTIME + '/terminal-locks')
    try:
        try:
            descriptor = os.open(identifier(run_id, UUID, 'RUN_ID'),
                                 os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | (os.O_CREAT if create else 0),
                                 0o600, dir_fd=parent)
        except FileNotFoundError:
            if create:
                raise
            return None
        try:
            trusted(os.fstat(descriptor), mode=0o600)
            return descriptor
        except BaseException:
            os.close(descriptor)
            raise
    finally:
        os.close(parent)


def terminal_acquire(descriptor, readonly):
    if descriptor is None:
        return
    deadline = time.monotonic() + 20
    while True:
        try:
            fcntl.flock(descriptor, (fcntl.LOCK_SH if readonly else fcntl.LOCK_EX) | fcntl.LOCK_NB)
            return
        except BlockingIOError:
            if time.monotonic() >= deadline:
                refuse('TERMINAL_CONTROL_BUSY')
            time.sleep(.02)


def terminal_payload(script, interactive=False):
    # Fixed controller-generated commands only. A PTY never carries the frame:
    # the launcher reads a separate pipe, then duplicates the existing PTY.
    body = script.encode()
    term = b'xterm-256color'
    body += struct.pack('<II', 4, len(term)) + b'TERM' + term
    return struct.pack('<8sIIIIII', b'SKIDP001', 1, int(interactive), len(body), 1,
                       len(script.encode()), 0) + body


def terminal_launch(value, run, build, script, interactive=False, started=None):
    payload = terminal_payload(script, interactive)
    request = {'payloadSha256': hashlib.sha256(payload).hexdigest()}
    child = subprocess.Popen(launch_argv(value, run, request, build), stdin=subprocess.PIPE,
                             stdout=None if interactive else subprocess.PIPE,
                             stderr=None if interactive else subprocess.PIPE, env=CLEAN_ENV,
                             close_fds=True)
    try:
        if interactive:
            child.stdin.write(payload)
            child.stdin.close()
            if started is not None:
                started()
            # tmux owns terminal input and terminal signals. This root waiter
            # never reads user input, interprets it, or inherits an authority FD.
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            return child.wait(), '', ''
        child.stdin.write(payload)
        child.stdin.close()
        output, errors = bytearray(), bytearray()
        deadline = time.monotonic() + 15
        with selectors.DefaultSelector() as poller:
            for stream, target in ((child.stdout, output), (child.stderr, errors)):
                os.set_blocking(stream.fileno(), False)
                poller.register(stream, selectors.EVENT_READ, target)
            while poller.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    refuse('TERMINAL_CONTROL_TIMEOUT')
                for key, _event in poller.select(remaining):
                    data = os.read(key.fileobj.fileno(), 4096)
                    if not data:
                        poller.unregister(key.fileobj)
                        key.fileobj.close()
                    else:
                        key.data.extend(data)
                        if len(output) + len(errors) > 65536:
                            refuse('TERMINAL_OUTPUT_BOUND')
        child.wait(timeout=max(.01, deadline - time.monotonic()))
        return child.returncode, output.decode('utf-8', 'strict'), errors.decode('utf-8', 'strict')
    except subprocess.TimeoutExpired:
        refuse('TERMINAL_CONTROL_TIMEOUT')
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


def terminal_binary():
    for path in ('/usr/bin/tmux', '/bin/tmux'):
        if not os.path.exists(path):
            continue
        path = os.path.realpath(path)
        fd = directory_fd(os.path.dirname(path))
        os.close(fd)
        info = os.lstat(path)
        trusted(info)
        if not info.st_mode & 0o111 or info.st_mode & 0o6000:
            refuse('TERMINAL_BINARY_CHANGED')
        return path
    refuse('TERMINAL_BINARY_MISSING')


def terminal_state(value, run, name=None, missing=False):
    record = json_read(terminal_path(run['runId']), missing)
    if record is None:
        return None
    fields = {'version', 'phase', 'run', 'name', 'uid', 'gid', 'directoryDevice', 'directoryInode',
              'socketDevice', 'socketInode', 'serverPid', 'serverTicks', 'sessionId'}
    if not isinstance(record, dict) or set(record) != fields or record['version'] != 1 or \
       record['phase'] not in ('creating', 'active') or record['run'] != dict(run, phase='active') or \
       record['uid'] != value['uid'] or record['gid'] != value['gid'] or \
       not isinstance(record['name'], str) or not re.fullmatch('[a-z0-9-]{1,96}', record['name']) or \
       (name is not None and record['name'] != name):
        refuse('TERMINAL_RECORD_CHANGED')
    for key in ('directoryDevice', 'directoryInode'):
        if not isinstance(record[key], str) or not re.fullmatch('[1-9][0-9]*', record[key]):
            refuse('TERMINAL_RECORD_CHANGED')
    if record['phase'] == 'active' and (not isinstance(record['serverPid'], int) or record['serverPid'] < 1 or
       not isinstance(record['serverTicks'], str) or not re.fullmatch('[1-9][0-9]*', record['serverTicks']) or
       not isinstance(record['sessionId'], str) or not re.fullmatch(r'\$[0-9]+', record['sessionId']) or
       any(not isinstance(record[key], str) or not re.fullmatch('[1-9][0-9]*', record[key])
           for key in ('socketDevice', 'socketInode'))):
        refuse('TERMINAL_RECORD_CHANGED')
    return record


def terminal_process(pid, value, run):
    if not isinstance(pid, int) or pid < 1:
        refuse('TERMINAL_PROCESS_CHANGED')
    raw = open('/proc/' + str(pid) + '/stat').read()
    ticks = raw[raw.rindex(')') + 2:].split()[19]
    status = open('/proc/' + str(pid) + '/status').read().splitlines()
    for label, expected_id in (('Uid:', value['uid']), ('Gid:', value['gid'])):
        entry = next((line.split()[1:] for line in status if line.startswith(label)), None)
        if entry != [str(expected_id)] * 4:
            refuse('TERMINAL_PROCESS_IDENTITY')
    membership = open('/proc/' + str(pid) + '/cgroup').read().strip()
    if membership != '0::/' + run['cgroupName']:
        refuse('TERMINAL_PROCESS_SCOPE')
    if not same(os.stat('/proc/' + str(pid) + '/ns/net'), run, 'network'):
        refuse('TERMINAL_PROCESS_NETWORK')
    # Detect exit/PID reuse across the independent reads above.
    raw = open('/proc/' + str(pid) + '/stat').read()
    if raw[raw.rindex(')') + 2:].split()[19] != ticks:
        refuse('TERMINAL_PROCESS_CHANGED')
    return ticks


def terminal_socket(record, value, run):
    folder = TERMINALS + '/' + run['runId']
    descriptor = directory_fd(folder)
    try:
        info = os.fstat(descriptor)
        if info.st_uid != 0 or info.st_gid != value['gid'] or stat.S_IMODE(info.st_mode) != 0o710 or \
           str(info.st_dev) != record['directoryDevice'] or str(info.st_ino) != record['directoryInode']:
            refuse('TERMINAL_DIRECTORY_CHANGED')
        info = os.stat('socket', dir_fd=descriptor, follow_symlinks=False)
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != value['uid'] or info.st_gid != value['gid'] or \
           info.st_nlink != 1 or stat.S_IMODE(info.st_mode) & 0o007:
            refuse('TERMINAL_SOCKET_CHANGED')
        if record['phase'] == 'active' and (str(info.st_dev) != record['socketDevice'] or
                                          str(info.st_ino) != record['socketInode']):
            refuse('TERMINAL_SOCKET_CHANGED')
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as peer:
            peer.settimeout(3)
            peer.connect(folder + '/socket')
            pid, uid, gid = struct.unpack('3i', peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != value['uid'] or gid != value['gid']:
            refuse('TERMINAL_SERVER_IDENTITY')
        ticks = terminal_process(pid, value, run)
        if record['phase'] == 'active' and (pid != record['serverPid'] or ticks != record['serverTicks']):
            refuse('TERMINAL_SERVER_CHANGED')
        current = os.stat('socket', dir_fd=descriptor, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            refuse('TERMINAL_SOCKET_CHANGED')
        return {'socketDevice': str(info.st_dev), 'socketInode': str(info.st_ino),
                'serverPid': pid, 'serverTicks': ticks}
    finally:
        os.close(descriptor)


def terminal_tmux(value, run, build, arguments):
    import shlex
    args = [terminal_binary(), '-f', '/dev/null', '-S', TERMINALS + '/' + run['runId'] + '/socket']
    code, output, _errors = terminal_launch(value, run, build, 'exec ' + shlex.join(args + arguments))
    if code != 0:
        refuse('TERMINAL_TMUX_REFUSED')
    return output.strip()


def terminal_check(value, run, build, record):
    if record['phase'] != 'active':
        refuse('TERMINAL_START_UNCONFIRMED')
    terminal_socket(record, value, run)
    sessions = terminal_tmux(value, run, build, ['list-sessions', '-F', '#{session_id} #{session_name}']).splitlines()
    if sessions != [record['sessionId'] + ' ' + record['name']]:
        refuse('TERMINAL_SESSION_CHANGED')
    panes = terminal_tmux(value, run, build, ['list-panes', '-s', '-t', record['sessionId'], '-F', '#{pane_pid}']).splitlines()
    if not panes or len(panes) > 256 or any(not re.fullmatch('[1-9][0-9]*', pid) for pid in panes):
        refuse('TERMINAL_PANES_CHANGED')
    for pid in panes:
        terminal_process(int(pid), value, run)
    terminal_socket(record, value, run)
    return {'version': 1, 'terminalId': run['runId'], 'run': run, 'name': record['name'],
            'serverPid': record['serverPid'], 'serverTicks': record['serverTicks'], 'sessionId': record['sessionId']}


def terminal_create(value, run, build, name):
    if terminal_state(value, run, missing=True) is not None:
        refuse('TERMINAL_ALREADY_RESERVED')
    folder = TERMINALS + '/' + run['runId']
    os.mkdir(folder, 0o700)
    descriptor = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        os.fchown(descriptor, value['uid'], value['gid'])
        info = os.fstat(descriptor)
        record = {'version': 1, 'phase': 'creating', 'run': run, 'name': name,
                  'uid': value['uid'], 'gid': value['gid'], 'directoryDevice': str(info.st_dev),
                  'directoryInode': str(info.st_ino), 'socketDevice': None, 'socketInode': None,
                  'serverPid': None, 'serverTicks': None, 'sessionId': None}
        json_write(terminal_path(run['runId']), record)
        # No project shell/configuration before the socket directory is sealed.
        terminal_tmux(value, run, build, ['new-session', '-d', '-s', name, '/bin/sleep 2147483647'])
        if set(os.listdir(descriptor)) != {'socket'}:
            refuse('TERMINAL_DIRECTORY_CHANGED')
        os.fchown(descriptor, 0, value['gid'])
        os.fchmod(descriptor, 0o710)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    record.update(terminal_socket(record, value, run))
    session_id = terminal_tmux(value, run, build, ['list-sessions', '-F', '#{session_id}']).strip()
    if not re.fullmatch(r'\$[0-9]+', session_id):
        refuse('TERMINAL_SESSION_CHANGED')
    record.update(phase='active', sessionId=session_id)
    json_write(terminal_path(run['runId']), record)
    terminal_tmux(value, run, build, ['set-option', '-t', session_id, 'default-shell', '/bin/sh'])
    terminal_tmux(value, run, build, ['set-option', '-t', session_id, 'default-command', '/bin/sh -l'])
    terminal_tmux(value, run, build, ['respawn-pane', '-k', '-t', session_id, '/bin/sh -l'])
    return terminal_check(value, run, build, record)


def terminal_retire(value, run):
    descriptor = cgroup_fd(run)
    if descriptor is not None:
        os.close(descriptor)
    if run['phase'] != 'closed' or descriptor is not None:
        refuse('PROJECT_IDENTITY_CLEANUP_FAILED')
    record = terminal_state(value, run, missing=True)
    folder = TERMINALS + '/' + run['runId']
    if record is None:
        if os.path.lexists(folder):
            refuse('TERMINAL_DIRECTORY_CHANGED')
        return {'version': 1, 'terminalId': run['runId'], 'retired': True}
    parent = directory_fd(TERMINALS)
    readable_parent = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
    os.close(parent)
    parent = readable_parent
    try:
        try:
            descriptor = os.open(run['runId'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        except FileNotFoundError:
            descriptor = None
        if descriptor is not None:
            try:
                info = os.fstat(descriptor)
                if str(info.st_dev) != record['directoryDevice'] or str(info.st_ino) != record['directoryInode'] or \
                   info.st_uid not in (0, value['uid']) or info.st_gid != value['gid'] or \
                   stat.S_IMODE(info.st_mode) not in (0o700, 0o710):
                    refuse('TERMINAL_DIRECTORY_CHANGED')
                if not set(os.listdir(descriptor)).issubset({'socket'}):
                    refuse('TERMINAL_DIRECTORY_CHANGED')
                try:
                    info = os.stat('socket', dir_fd=descriptor, follow_symlinks=False)
                    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != value['uid'] or info.st_nlink != 1 or \
                       (record['phase'] == 'active' and (str(info.st_dev) != record['socketDevice'] or
                                                       str(info.st_ino) != record['socketInode'])):
                        refuse('TERMINAL_SOCKET_CHANGED')
                    os.unlink('socket', dir_fd=descriptor)
                except FileNotFoundError:
                    pass
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            os.rmdir(run['runId'], dir_fd=parent)
        os.fsync(parent)
    finally:
        os.close(parent)
    durable_unlink(terminal_path(run['runId']))
    return {'version': 1, 'terminalId': run['runId'], 'retired': True}


def main():
    if os.getuid() != 0 or os.geteuid() != 0:
        refuse('ROOT_CONTROL_REQUIRED')
    os.environ.clear()
    os.environ.update(CLEAN_ENV)
    def interrupted(_signum, _frame):
        refuse('CONTROL_CANCELLED')
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, interrupted)
    if len(sys.argv) != 2 or len(sys.argv[1]) > 131072:
        refuse('REQUEST_BOUND')
    try:
        raw = base64.b64decode(sys.argv[1], validate=True)
        if len(raw) > 98304:
            refuse('REQUEST_BOUND')
        request = json.loads(raw)
    except (ValueError, UnicodeError):
        refuse('REQUEST_JSON')
    if not isinstance(request, dict) or not isinstance(request.get('action'), str):
        refuse('REQUEST_SCHEMA')
    action = request['action']
    allowed = {'install': set(), 'ensure': {'projectId', 'directory', 'networkIsolation', 'expected'},
               'inspect': {'projectId'}, 'prepare': {'projectId', 'expected', 'runId'},
               'status': {'projectId', 'expected', 'runId'}, 'stop': {'projectId', 'expected', 'runId'},
               'run': {'projectId', 'expected', 'runId'},
               'run-readonly': {'projectId', 'expected', 'runId'},
               'network': {'projectId', 'expected'},
               'begin-network-release': {'projectId', 'expected', 'releaseId', 'bootId'},
               'release-network': {'projectId', 'expected', 'releaseId', 'network'},
               'rebind': {'projectId', 'expected', 'directory', 'networkIsolation'},
               'exec-current': {'projectId', 'expected', 'runId', 'payloadSha256'},
               'terminal-create': {'projectId', 'expected', 'runId', 'name'},
               'terminal-probe': {'projectId', 'expected', 'runId', 'name'},
               'terminal-attach': {'projectId', 'expected', 'runId', 'name', 'readOnly'},
               'terminal-retire': {'projectId', 'expected', 'runId'}}
    if action not in allowed or not set(request).issubset(allowed[action] | {'action'}):
        refuse('REQUEST_SCHEMA')
    if action != 'install':
        identifier(request.get('projectId'), PROJECT, 'PROJECT_ID')
    build = sources()
    boot = open('/proc/sys/kernel/random/boot_id').read().strip()
    identifier(boot, UUID, 'BOOT_ID')
    readonly = action in ('run-readonly', 'terminal-probe', 'terminal-attach')
    lock = initialize_readonly() if readonly else initialize()
    args = None
    terminal = None
    try:
        store = registry(readonly)
        if action == 'install':
            result = {'version': 1, 'build': build, 'registryId': store['registryId'], 'bootId': boot}
        elif action == 'ensure':
            result = ensure(request, store)
        elif action == 'inspect':
            result = binding_read(request['projectId'], True)
            if result is not None:
                reservation_check(result, store)
                if result['phase'] == 'active':
                    result = active(request['projectId'], request, store)
        elif action in ('prepare', 'exec-current'):
            value = active(request['projectId'], request, store)
            if action == 'exec-current':
                # Reject metadata before publishing an inherited ticket.
                launch_argv(value, {'runId': identifier(request.get('runId'), UUID, 'RUN_ID')}, request, build)
            result = prepare(value, request, boot, build, action == 'exec-current')
            if action == 'exec-current':
                args = launch_argv(value, result, request, build)
        elif action.startswith('terminal-'):
            value = binding_read(request['projectId'])
            reservation_check(value, store)
            expected(value, request)
            run = run_read(identifier(request.get('runId'), UUID, 'RUN_ID'))
            check_run(value, run, boot, action != 'terminal-retire')
            if run['mode'] != 'independent' or (action != 'terminal-retire' and run['build'] != build):
                refuse('TERMINAL_RUN_CHANGED')
            name = None
            if action != 'terminal-retire':
                name = request.get('name')
                if not isinstance(name, str) or not re.fullmatch(
                        'sakura-terminal-' + value['projectId'] + '-[a-z0-9-]{1,48}', name):
                    refuse('TERMINAL_NAME')
            if action == 'terminal-attach' and not isinstance(request.get('readOnly'), bool):
                refuse('REQUEST_SCHEMA')
            # Open/create under the registry lock so retirement cannot miss a
            # preparation which passed admission. Wait outside that lock:
            # native children acquire it independently before dropping UID.
            terminal = (value, run, name, terminal_lock(run['runId'], action == 'terminal-create'))
        elif action in ('status', 'stop', 'run', 'run-readonly'):
            value = binding_read(request['projectId'])
            reservation_check(value, store)
            expected(value, request)
            run_id = identifier(request.get('runId'), UUID, 'RUN_ID')
            run = run_read(run_id)
            check_run(value, run, boot, False)
            if action in ('run', 'run-readonly'):
                result = run
            elif action == 'stop':
                result = stop(value, run, boot)
            else:
                descriptor = cgroup_fd(run)
                try:
                    result = {'run': run, 'populated': populated(descriptor) if descriptor is not None else False}
                finally:
                    if descriptor is not None:
                        os.close(descriptor)
        elif action == 'rebind':
            value = binding_read(request['projectId'])
            reservation_check(value, store)
            expected(value, request)
            account_check(value)
            home_check(value)
            result = rebind(value, request, boot)
        elif action in ('network', 'begin-network-release', 'release-network'):
            value = binding_read(request['projectId'])
            reservation_check(value, store)
            expected(value, request)
            if request.get('expected') is None:
                refuse('EXPECTED_IDENTITY_REQUIRED')
            # Cleanup also covers a reserved account whose directory migration
            # never completed. No project code or account creation happens here.
            if action == 'network':
                result = network_capture(value, boot)
            elif action == 'begin-network-release':
                result = begin_network_release(value, request, boot)
            else:
                result = release_network(value, request, boot, lock)
    finally:
        os.close(lock)
    if args is not None:
        os.execve(args[0], args, CLEAN_ENV)
    if terminal is not None:
        # Launcher entry must not inherit or wait behind our registry lock.
        value, run, name, terminal_descriptor = terminal
        def release_terminal():
            nonlocal terminal_descriptor
            if terminal_descriptor is not None:
                os.close(terminal_descriptor)
                terminal_descriptor = None
        try:
            terminal_acquire(terminal_descriptor, action in ('terminal-probe', 'terminal-attach'))
            if action == 'terminal-create':
                result = terminal_create(value, run, build, name)
            elif action == 'terminal-retire':
                result = terminal_retire(value, run)
            else:
                if terminal_descriptor is None:
                    refuse('TERMINAL_RECORD_ABSENT')
                record = terminal_state(value, run, name)
                result = terminal_check(value, run, build, record)
                if action == 'terminal-attach':
                    import shlex
                    arguments = [terminal_binary(), '-f', '/dev/null', '-S', TERMINALS + '/' + run['runId'] + '/socket',
                                 'attach-session'] + (['-r'] if request['readOnly'] else []) + ['-t', record['sessionId']]
                    code, _, _ = terminal_launch(value, run, build, 'exec ' + shlex.join(arguments), True, release_terminal)
                    raise SystemExit(code)
        finally:
            release_terminal()
    print(json.dumps({'ok': True, 'result': result}, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Refusal as error:
        print(json.dumps({'ok': False, 'code': error.code, 'detail': error.detail}, separators=(',', ':')))
        sys.exit(1)
    except (OSError, ValueError, KeyError, TypeError, struct.error):
        print('{"ok":false,"code":"CONTROL_STATE_INVALID","detail":null}')
        sys.exit(1)
