#!/usr/bin/python3
"""Root control plane for persistent project accounts; commands never run here.

The C entry point consumes only fixed-size records under the same flock. A
reservation survives an interrupted account creation. Neither an incomplete
reservation nor an old boot/revision can authorize an execution.
"""
import base64
import errno
import fcntl
import grp
import hashlib
import json
import os
import pwd
import re
import signal
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
CGROUP = '/sys/fs/cgroup'
NAMES = ['protocol.h', 'launcher.c', 'controller.py']
BINDING = struct.Struct('<8sIIIIQQQQQ37s17s32s37s256s1024sI577s')
RUN = struct.Struct('<8sIIIIQQQQQ37s37s17s37s37s65s64s32s634s')
UID_MAP = struct.Struct('<8sII37s17s37s149s')
REGISTRY = struct.Struct('<8sI37s207s')
UUID = re.compile('[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}')
PROJECT = re.compile('default|[a-f0-9]{16}')
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/', 'LANG': 'C', 'LC_ALL': 'C'}


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
    return RUNTIME + '/runs/' + run + '.bin'


def run_write(value):
    atomic(run_path(value['runId']), RUN.pack(
        b'SKIDR001', 1, 1 if value['phase'] == 'active' else 2, 2 if value['mode'] == 'inherit-current' else 1, 0,
        value['revision'], int(value['networkDevice']), int(value['networkInode']),
        int(value['cgroupDevice']), int(value['cgroupInode']), text(value['registryId'], 37),
        text(value['identityId'], 37), text(value['projectId'], 17), text(value['runId'], 37),
        text(value['bootId'], 37), text(value['build'], 65), text(value['cgroupName'], 64),
        text(value['namespace'], 32), b'\0' * 634))


def run_read(run):
    data = read(run_path(run), 1024)
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


def same(info, value, prefix):
    return str(info.st_dev) == value[prefix + 'Device'] and str(info.st_ino) == value[prefix + 'Inode']


def tool(name):
    for parent in ('/usr/sbin', '/usr/bin', '/sbin', '/bin'):
        candidate = parent + '/' + name
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    refuse('REQUIRED_TOOL', name)


def execute(argv, data=None, timeout=15):
    try:
        result = subprocess.run(argv, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=CLEAN_ENV, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
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


def registry():
    value = json_read(BASE + '/registry.json', True, 1048576)
    anchor = read(BASE + '/registry.bin', 256, True)
    if value is None:
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


def network_fd(value, boot):
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
        pin_path = RUNTIME + '/networks/' + value['projectId'] + '.json'
        prior = json_read(pin_path, True)
        if prior is not None and prior != pinned:
            refuse('NETWORK_REPLACED')
        if prior is None:
            json_write(pin_path, pinned)
        return descriptor, info, namespace
    except BaseException:
        os.close(descriptor)
        raise


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


def runs_for(value):
    entries = os.listdir(RUNTIME + '/runs')
    if len(entries) > 1024:
        refuse('RUN_LIMIT')
    result = []
    for entry in entries:
        if not entry.endswith('.bin') or not UUID.fullmatch(entry[:-4]):
            refuse('RUN_UNKNOWN_FILE')
        run = run_read(entry[:-4])
        if run['registryId'] == value['registryId'] and run['identityId'] == value['identityId']:
            result.append(run)
    return result


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


def prepare(value, request, boot, build, inherit=False):
    cgroup_available(True)
    requested = request.get('runId')
    if requested is not None:
        identifier(requested, UUID, 'RUN_ID')
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
    history = runs_for(value)
    if sum(item['phase'] == 'active' for item in history) >= 32 or len(os.listdir(RUNTIME + '/runs')) >= 1024:
        refuse('RUN_LIMIT')
    run_id = requested or str(uuid.uuid4())
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
    binding_write(candidate)
    try:
        os.unlink(RUNTIME + '/networks/' + value['projectId'] + '.json')
    except FileNotFoundError:
        pass
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
                       (RUNTIME + '/runs', 0o700), (RUNTIME + '/networks', 0o700)):
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


def launch_argv(value, run, request, build):
    command = request.get('argv')
    environment = request.get('environment', {})
    if not isinstance(command, list) or not 1 <= len(command) <= 128 or not all(isinstance(arg, str) and '\0' not in arg for arg in command) or not command[0].startswith('/'):
        refuse('COMMAND_BOUND')
    if not isinstance(environment, dict) or len(environment) > 128:
        refuse('ENVIRONMENT_BOUND')
    args = [BUILDS + '/' + build + '/launch', '--project', value['projectId'], value['identityId'], str(value['revision']), run['runId']]
    total = sum(len(arg.encode()) for arg in command)
    for key, content in environment.items():
        if not isinstance(key, str) or not re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,127}', key) or key in ('HOME', 'USER', 'LOGNAME') or not isinstance(content, str) or '\0' in content or len((key + '=' + content).encode()) > 8192:
            refuse('ENVIRONMENT_NAME')
        args += ['--env', key + '=' + content]
        total += len((key + '=' + content).encode())
    if total > 65536:
        refuse('COMMAND_BOUND')
    return args + ['--'] + command


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
               'rebind': {'projectId', 'expected', 'directory', 'networkIsolation'},
               'exec-current': {'projectId', 'expected', 'runId', 'argv', 'environment'}}
    if action not in allowed or not set(request).issubset(allowed[action] | {'action'}):
        refuse('REQUEST_SCHEMA')
    if action != 'install':
        identifier(request.get('projectId'), PROJECT, 'PROJECT_ID')
    build = sources()
    boot = open('/proc/sys/kernel/random/boot_id').read().strip()
    identifier(boot, UUID, 'BOOT_ID')
    lock = initialize()
    args = None
    try:
        store = registry()
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
            result = prepare(value, request, boot, build, action == 'exec-current')
            if action == 'exec-current':
                args = launch_argv(value, result, request, build)
        elif action in ('status', 'stop', 'run'):
            value = binding_read(request['projectId'])
            reservation_check(value, store)
            expected(value, request)
            run_id = identifier(request.get('runId'), UUID, 'RUN_ID')
            run = run_read(run_id)
            check_run(value, run, boot, False)
            if action == 'run':
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
    finally:
        os.close(lock)
    if args is not None:
        os.execve(args[0], args, CLEAN_ENV)
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
