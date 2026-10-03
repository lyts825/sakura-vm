"""Fixed Root preparation and permanent UID launcher for a single GUI window.

Application arguments and environment are JSON data, never Root shell text.
The complete independent native run owns every VNC, WM and application child.
"""
import base64
import ctypes
import errno
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import select
import shlex
import signal
import socket
import stat
import struct
import subprocess
import sys
import time
import uuid

BUILD = Path(__file__).resolve().parent.name
BASE = Path('/var/lib/sakura/single-app-uid')
RUNTIME = Path('/run/sakura-single-app-uid')
CLEAN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/', 'LANG': 'C', 'LC_ALL': 'C'}
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
DIGEST = re.compile(r'^[a-f0-9]{64}$')


class Failure(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def require(condition, message):
    if not condition:
        raise Failure(message)


def secure_directory(path, create=False, mode=0o700):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'SINGLE_APP_PATH_INVALID')
    current = Path('/')
    for part in path.parts[1:]:
        current /= part
        if create:
            try:
                current.mkdir(mode=mode if current == path else 0o755)
            except FileExistsError:
                pass
        info = current.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                'SINGLE_APP_ROOT_DIRECTORY_CHANGED')
    return path


def protected(path, maximum=262144):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
                and info.st_nlink == 1 and 0 < info.st_size <= maximum, 'SINGLE_APP_ROOT_FILE_CHANGED')
        raw = os.read(descriptor, maximum + 1)
        require(len(raw) == info.st_size, 'SINGLE_APP_ROOT_FILE_CHANGED')
        return raw
    finally:
        os.close(descriptor)


def atomic(path, value):
    temporary = path.parent / ('.' + uuid.uuid4().hex + '.new')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(json.dumps(value, separators=(',', ':')).encode())
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        temporary.unlink(missing_ok=True)


def load_package():
    folder = secure_directory(Path(__file__).resolve().parent)
    require(DIGEST.fullmatch(BUILD) and str(folder) == '/usr/local/lib/sakura-single-app/' + BUILD,
            'SINGLE_APP_SOURCE_PATH_CHANGED')
    manifest = json.loads(protected(folder / 'manifest.json'))
    names = ['controller.py', 'directory-view.py', 'sources.json']
    require(set(manifest) == {'version', 'build', 'files'} and manifest['version'] == 1 and manifest['build'] == BUILD
            and len(manifest['files']) == len(names), 'SINGLE_APP_SOURCE_CHANGED')
    aggregate, sources = hashlib.sha256(), {}
    for name, entry in zip(names, manifest['files']):
        require(set(entry) == {'name', 'size', 'sha256'} and entry['name'] == name, 'SINGLE_APP_SOURCE_CHANGED')
        raw = protected(folder / name)
        require(len(raw) == entry['size'] and hashlib.sha256(raw).hexdigest() == entry['sha256'], 'SINGLE_APP_SOURCE_CHANGED')
        aggregate.update(name.encode())
        aggregate.update(raw)
        sources[name] = raw
    require(aggregate.hexdigest() == BUILD, 'SINGLE_APP_SOURCE_CHANGED')
    namespace = {'__file__': str(folder / 'directory-view.py'), '__name__': 'sakura_single_app_directory'}
    exec(compile(sources['directory-view.py'], namespace['__file__'], 'exec'), namespace)
    return namespace


def native(build):
    require(isinstance(build, str) and DIGEST.fullmatch(build), 'SINGLE_APP_NATIVE_CHANGED')
    folder = secure_directory(Path('/usr/local/lib/sakura-project-identity') / build)
    manifest = json.loads(protected(folder / 'manifest.json'))
    require(set(manifest) == {'version', 'build', 'files'} and manifest['version'] == 1 and manifest['build'] == build
            and len(manifest['files']) == 3, 'SINGLE_APP_NATIVE_CHANGED')
    aggregate, controller = hashlib.sha256(), None
    for name, entry in zip(['protocol.h', 'launcher.c', 'controller.py'], manifest['files']):
        require(set(entry) == {'name', 'size', 'sha256'} and entry['name'] == name, 'SINGLE_APP_NATIVE_CHANGED')
        raw = protected(folder / name)
        require(len(raw) == entry['size'] and hashlib.sha256(raw).hexdigest() == entry['sha256'], 'SINGLE_APP_NATIVE_CHANGED')
        aggregate.update(name.encode())
        aggregate.update(raw)
        if name == 'controller.py':
            controller = raw
    require(aggregate.hexdigest() == build, 'SINGLE_APP_NATIVE_CHANGED')
    namespace = {'__file__': str(folder / 'controller.py'), '__name__': 'sakura_single_app_native'}
    exec(compile(controller, namespace['__file__'], 'exec'), namespace)
    require(namespace['sources']() == build, 'SINGLE_APP_NATIVE_CHANGED')
    return namespace


def same_run(left, right):
    return set(left) == set(right) and all(left[key] == right[key] for key in left if key != 'phase')


def context(value, active=True, exclusive=False):
    core = native(value['run']['build'])
    lock = core['initialize']() if exclusive else core['initialize_readonly']()
    try:
        identity = core['binding_read'](value['identity']['projectId'])
        core['reservation_check'](identity, core['registry'](True))
        require(identity == value['identity'], 'SINGLE_APP_PROJECT_CHANGED')
        current = core['run_read'](value['run']['runId'])
        require(same_run(current, value['run']) and current['mode'] == 'independent'
                and current['runId'] == value['id'], 'SINGLE_APP_RUN_CHANGED')
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        if active:
            core['check_run'](identity, current, boot)
            require(core['active'](identity['projectId'], {'expected': {key: identity[key] for key in
                    ('registryId', 'identityId', 'revision')}}, core['registry'](True)) == identity,
                    'SINGLE_APP_PROJECT_CHANGED')
        return core, lock, current, boot
    except BaseException:
        os.close(lock)
        raise


def receipt_path(identifier):
    require(isinstance(identifier, str) and UUID.fullmatch(identifier), 'SINGLE_APP_SESSION_INVALID')
    return BASE / identifier / 'session.json'


def read_receipt(identifier, origin):
    secure_directory(receipt_path(identifier).parent)
    value = json.loads(protected(receipt_path(identifier), 65536))
    require(isinstance(value, dict) and value['version'] == 1 and value['id'] == identifier and value['build'] == BUILD
            and value['origin'] == origin, 'SINGLE_APP_RECEIPT_CHANGED')
    require(set(value) == {'version', 'id', 'build', 'origin', 'identity', 'run', 'state', 'uid', 'gid', 'user', 'home',
            'homeDevice', 'homeInode', 'runtime', 'runtimeDevice', 'runtimeInode', 'password', 'display', 'port',
            'image', 'tools', 'directoryView', 'supervisor', 'endpoint', 'processes', 'retirement', 'firewall'}, 'SINGLE_APP_RECEIPT_CHANGED')
    require(value['identity'] == origin['identity'] and value['run'] == origin['run']
            and value['run']['runId'] == identifier and value['port'] == 5900 + value['display']
            and value['state'] in ('preparing', 'prepared', 'starting', 'running', 'stopping', 'stopped')
            and value['display'] in range(10, 18) and value['user'] == 'skapp' + identifier.replace('-', '')[:24]
            and value['home'] == '/home/' + value['user'] and value['runtime'] == str(RUNTIME / identifier)
            and type(value['uid']) is int and 1000 <= value['uid'] < 20000 and value['gid'] == value['uid'],
            'SINGLE_APP_RECEIPT_CHANGED')
    require(value['firewall'] in ('pending', 'active', 'closed') and
            ((value['homeDevice'] is None) == (value['homeInode'] is None)) and
            ((value['runtimeDevice'] is None) == (value['runtimeInode'] is None)), 'SINGLE_APP_RECEIPT_CHANGED')
    return value


def account(value):
    user = pwd.getpwnam(value['user'])
    info = Path(value['home']).lstat()
    require((user.pw_uid, user.pw_gid, user.pw_dir) == (value['uid'], value['gid'], value['home'])
            and stat.S_ISDIR(info.st_mode) and info.st_uid == value['uid'] and info.st_gid == value['gid']
            and stat.S_IMODE(info.st_mode) == 0o700
            and (str(info.st_dev), str(info.st_ino)) == (value['homeDevice'], value['homeInode']),
            'SINGLE_APP_ACCOUNT_CHANGED')
    return user


def image_descriptor(descriptor, path, privileged=False):
    before = os.fstat(descriptor)
    require(stat.S_ISREG(before.st_mode) and not before.st_mode & 0o6000 and before.st_mode & 0o111
            and 0 < before.st_size <= 536870912, 'SINGLE_APP_IMAGE_INVALID')
    if privileged:
        secure_directory(Path(path).parent)
        require(before.st_uid == 0 and not before.st_mode & 0o022, 'SINGLE_APP_TOOL_CHANGED')
    try:
        capabilities = os.getxattr(descriptor, 'security.capability')
    except OSError as error:
        if error.errno not in (errno.ENODATA, errno.ENOTSUP):
            raise
        capabilities = b''
    require(not capabilities, 'SINGLE_APP_IMAGE_PRIVILEGED')
    digest, offset = hashlib.sha256(), 0
    while True:
        block = os.pread(descriptor, 1048576, offset)
        if not block:
            break
        digest.update(block)
        offset += len(block)
        require(offset <= before.st_size, 'SINGLE_APP_IMAGE_CHANGED')
    after = os.fstat(descriptor)
    require((before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns, before.st_size)
            == (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns, after.st_size)
            and before.st_mode == after.st_mode and not after.st_mode & 0o6000, 'SINGLE_APP_IMAGE_CHANGED')
    return {'path': str(path), 'device': str(before.st_dev), 'inode': str(before.st_ino), 'sha256': digest.hexdigest()}


def image(path, privileged=False):
    path = Path(path).resolve(strict=True)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        return image_descriptor(descriptor, path, privileged)
    finally:
        os.close(descriptor)


def tool(name):
    for parent in ('/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'):
        candidate = Path(parent) / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return {**image(candidate, True), 'command': str(candidate)}
    raise Failure('SINGLE_APP_TOOL_MISSING')


def root_tool(expected, arguments, check=True):
    # Root tools and arguments are fixed controller operations. No application
    # body or environment is given to this path, including account creation.
    return subprocess.run([expected['path'], *arguments], env=CLEAN_ENV, stdin=subprocess.DEVNULL,
                          capture_output=True, timeout=10, check=check,
                          preexec_fn=lambda: pinned_execute(expected, arguments, CLEAN_ENV, True))


def validate_origin(origin, identifier):
    require(isinstance(origin, dict) and set(origin) == {'identity', 'run', 'program', 'args', 'resolution', 'clipboard', 'configVersion'}
            and origin['run']['runId'] == identifier and UUID.fullmatch(identifier)
            and origin['resolution'] in ('800x600', '1024x768', '1280x800')
            and re.fullmatch(r'[A-Za-z][A-Za-z0-9+._-]{0,63}', origin['program'])
            and isinstance(origin['args'], list) and len(origin['args']) <= 12
            and all(isinstance(item, str) and len(item) <= 256 and not re.search(r'[\x00-\x1f]', item) for item in origin['args'])
            and set(origin['clipboard']) == {'copy', 'paste'} and all(type(item) is bool for item in origin['clipboard'].values())
            and DIGEST.fullmatch(origin['configVersion']), 'SINGLE_APP_REQUEST_INVALID')


def validate_environment(environment):
    require(isinstance(environment, dict) and len(environment) <= 64 and all(isinstance(key, str)
            and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key) and isinstance(data, str) and len(data) <= 8192
            and '\0' not in data for key, data in environment.items())
            and len(json.dumps(environment).encode()) <= 32768, 'SINGLE_APP_ENVIRONMENT_INVALID')


def prepare(request):
    origin = request['origin']
    validate_origin(origin, request['id'])
    value = {'id': request['id'], 'identity': origin['identity'], 'run': origin['run']}
    core, lock, run, boot = context(value)
    os.close(lock)
    group = core['cgroup_fd'](run)
    try:
        require(group is not None and not core['populated'](group), 'SINGLE_APP_RUN_IN_USE')
    finally:
        if group is not None:
            os.close(group)
    path = receipt_path(request['id'])
    if path.exists():
        old = read_receipt(request['id'], origin)
        require(old['state'] == 'prepared', 'SINGLE_APP_START_NOT_REPLAYABLE')
        account(old)
        return old
    secure_directory(BASE, True)
    secure_directory(path.parent, True)
    name = 'skapp' + request['id'].replace('-', '')[:24]
    home = '/home/' + name
    require(not os.path.lexists(home), 'SINGLE_APP_ACCOUNT_EXISTS')
    try:
        pwd.getpwnam(name)
    except KeyError:
        pass
    else:
        raise Failure('SINGLE_APP_ACCOUNT_EXISTS')
    previous = [json.loads(protected(entry / 'session.json', 65536)) for entry in BASE.iterdir()
                if UUID.fullmatch(entry.name) and (entry / 'session.json').exists()]
    taken = {row.pw_uid for row in pwd.getpwall()} | {row.gr_gid for row in grp.getgrall()} | {row['uid'] for row in previous}
    uid = next((item for item in range(1000, 20000) if item not in taken), None)
    require(uid is not None, 'SINGLE_APP_ACCOUNT_LIMIT')
    chosen = None
    network, net_info, _ = core['network_fd'](origin['identity'], boot, True)
    try:
        require(core['same'](net_info, run, 'network'), 'SINGLE_APP_NETWORK_CHANGED')
        require(ctypes.CDLL(None, use_errno=True).setns(network, 0x40000000) == 0, 'SINGLE_APP_NETWORK_CHANGED')
    finally:
        os.close(network)
    for display in range(10, 18):
        if any(row['state'] != 'stopped' and row['run']['bootId'] == boot and row['display'] == display for row in previous):
            continue
        if os.path.lexists('/tmp/.X11-unix/X' + str(display)):
            continue
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM | socket.SOCK_CLOEXEC)
        try:
            probe.bind(('127.0.0.1', 5900 + display))
            chosen = display
            break
        except OSError:
            pass
        finally:
            probe.close()
    require(chosen is not None, 'SINGLE_APP_DISPLAY_LIMIT')
    tools = {'group': tool('groupadd'), 'account': tool('useradd'), 'ipv4': tool('iptables'), 'ipv6': tool('ip6tables')}
    for key, alternatives in [('vnc', ['Xvnc', 'Xtigervnc']), ('password', ['vncpasswd', 'tigervncpasswd']),
                              ('wm', ['openbox']), ('probe', ['xdpyinfo'])]:
        for name_ in alternatives:
            try:
                tools[key] = tool(name_)
                break
            except Failure:
                pass
        require(key in tools, 'SINGLE_APP_TOOL_MISSING')
    application = None
    for parent in ('/usr/local/bin', '/usr/bin', '/bin'):
        candidate = Path(parent) / origin['program']
        if candidate.is_file() and os.access(candidate, os.X_OK):
            application = {**image(candidate), 'command': str(candidate)}
            break
    require(application is not None, 'SINGLE_APP_IMAGE_MISSING')
    password = base64.b64encode(os.urandom(6)).decode()
    value = {'version': 1, 'id': request['id'], 'build': BUILD, 'origin': origin, 'identity': origin['identity'],
             'run': origin['run'], 'state': 'preparing', 'uid': uid, 'gid': uid, 'user': name, 'home': home,
             'homeDevice': None, 'homeInode': None, 'runtime': str(RUNTIME / request['id']),
             'runtimeDevice': None, 'runtimeInode': None, 'password': password,
             'display': chosen, 'port': 5900 + chosen, 'image': application, 'tools': tools, 'directoryView': None,
             'supervisor': None, 'endpoint': None, 'processes': None, 'retirement': None, 'firewall': 'pending'}
    # Reserve UID/display and full native proof before the first resource
    # mutation. An interrupted prepare is cleanup-only, never a second launch.
    for entry in BASE.iterdir():
        if UUID.fullmatch(entry.name) and (entry / 'session.json').exists():
            other = json.loads(protected(entry / 'session.json', 65536))
            require(other['uid'] != uid, 'SINGLE_APP_UID_RESERVED')
            if other['state'] != 'stopped' and other['run']['bootId'] == boot:
                require(other['display'] != chosen, 'SINGLE_APP_DISPLAY_RESERVED')
    firewall_validate(value, empty=True)
    atomic(path, value)
    root_tool(tools['group'], ['-g', str(uid), name])
    root_tool(tools['account'], ['-M', '-u', str(uid), '-g', name, '-d', home, '-s', '/bin/false', name])
    user = pwd.getpwnam(name)
    require((user.pw_uid, user.pw_gid, user.pw_dir) == (uid, uid, home), 'SINGLE_APP_ACCOUNT_CHANGED')
    secure_directory(Path(home).parent)
    Path(home).mkdir(mode=0o700)
    home_info = Path(home).lstat()
    value['homeDevice'], value['homeInode'] = str(home_info.st_dev), str(home_info.st_ino)
    atomic(path, value)
    os.chown(home, uid, uid, follow_symlinks=False)
    secure_directory(RUNTIME, True, 0o711)
    os.chmod(RUNTIME, 0o711)
    runtime = Path(value['runtime'])
    runtime.mkdir(mode=0o700)
    runtime_info = runtime.lstat()
    value['runtimeDevice'], value['runtimeInode'] = str(runtime_info.st_dev), str(runtime_info.st_ino)
    atomic(path, value)
    os.chown(runtime, uid, uid, follow_symlinks=False)
    account(value)
    firewall_install(value)
    value['state'] = 'prepared'
    atomic(path, value)
    return value


def firewall_spec(value, family):
    chain = 'SAU_' + value['id'].replace('-', '')[:16]
    comment = 'sakura-single-app:' + value['id']
    destination = '127.0.0.0/8' if family == 'ipv4' else '::1/128'
    jump = ['-d', destination, '-p', 'tcp', '--dport', '5900:5999', '-m', 'owner', '--uid-owner', str(value['uid']),
            '-m', 'comment', '--comment', comment, '-j', chain]
    rules = [['-p', 'tcp', '--dport', str(value['port']), '-j', 'RETURN'],
             ['-m', 'comment', '--comment', comment, '-j', 'REJECT']]
    return chain, jump, rules


def firewall_validate(value, empty=False, partial=False):
    for family in ('ipv4', 'ipv6'):
        chain, jump, rules = firewall_spec(value, family)
        expected = value['tools'][family]
        listed = root_tool(expected, ['-w', '-S', chain], False)
        attached = root_tool(expected, ['-w', '-C', 'OUTPUT', *jump], False).returncode == 0
        if empty:
            require(listed.returncode == 1 and not attached, 'SINGLE_APP_FIREWALL_COLLISION')
            continue
        require(listed.returncode in (0, 1), 'SINGLE_APP_FIREWALL_UNAVAILABLE')
        if listed.returncode == 1:
            require(partial and not attached, 'SINGLE_APP_FIREWALL_CHANGED')
            continue
        lines = [shlex.split(line) for line in listed.stdout.decode().splitlines() if line]
        require(lines and lines[0] == ['-N', chain] and len(lines) <= 3, 'SINGLE_APP_FIREWALL_CHANGED')
        for index in range(len(lines) - 1):
            require(root_tool(expected, ['-w', '-C', chain, *rules[index]], False).returncode == 0,
                    'SINGLE_APP_FIREWALL_CHANGED')
        require(partial or (len(lines) == 3 and attached), 'SINGLE_APP_FIREWALL_CHANGED')
        if attached:
            output = root_tool(expected, ['-w', '-S', 'OUTPUT']).stdout.decode().splitlines()
            matching = [line for line in output if ['-j', chain] == shlex.split(line)[-2:]]
            require(len(matching) == 1, 'SINGLE_APP_FIREWALL_CHANGED')


def firewall_install(value):
    for family in ('ipv4', 'ipv6'):
        chain, jump, rules = firewall_spec(value, family)
        expected = value['tools'][family]
        root_tool(expected, ['-w', '-N', chain])
        for rule in rules:
            root_tool(expected, ['-w', '-A', chain, *rule])
        root_tool(expected, ['-w', '-I', 'OUTPUT', '1', *jump])
    firewall_validate(value)
    value['firewall'] = 'active'
    atomic(receipt_path(value['id']), value)


def firewall_remove(value):
    firewall_validate(value, partial=True)
    for family in ('ipv4', 'ipv6'):
        chain, jump, _ = firewall_spec(value, family)
        expected = value['tools'][family]
        if root_tool(expected, ['-w', '-C', 'OUTPUT', *jump], False).returncode == 0:
            root_tool(expected, ['-w', '-D', 'OUTPUT', *jump])
        if root_tool(expected, ['-w', '-S', chain], False).returncode == 0:
            root_tool(expected, ['-w', '-F', chain])
            root_tool(expected, ['-w', '-X', chain])
    firewall_validate(value, empty=True)
    value['firewall'] = 'closed'
    atomic(receipt_path(value['id']), value)


def process(pid, value, view_module, pending=False):
    root = Path('/proc') / str(pid)
    before = (root / 'stat').read_text()
    fields = before[before.rfind(')') + 2:].split()
    created = fields[19]
    status = dict(line.split(':', 1) for line in (root / 'status').read_text().splitlines() if ':' in line)
    uids = [int(item) for item in status['Uid'].split()]
    gids = [int(item) for item in status['Gid'].split()]
    require((root / 'cgroup').read_text() == '0::/' + value['run']['cgroupName'] + '\n'
            and (str((root / 'ns/net').stat().st_dev), str((root / 'ns/net').stat().st_ino)) ==
                (value['run']['networkDevice'], value['run']['networkInode']), 'SINGLE_APP_PROCESS_CHANGED')
    require(status['NoNewPrivs'].strip() == '1', 'SINGLE_APP_PROCESS_CHANGED')
    root_pending = pending and value['supervisor'] is not None and pid == value['supervisor']['pid']
    if root_pending and uids == [0] * 4:
        executable = (root / 'exe').stat()
        require(gids == [0] * 4, 'SINGLE_APP_PROCESS_CHANGED')
        require(created == value['supervisor']['created']
                and os.readlink(root / 'exe') == value['supervisor']['image']
                and (str(executable.st_dev), str(executable.st_ino)) ==
                    (value['supervisor']['device'], value['supervisor']['inode']),
                'SINGLE_APP_SUPERVISOR_CHANGED')
    else:
        require(uids == [value['uid']] * 4 and gids == [value['gid']] * 4
                and not status['Groups'].split()
                and all(int(status[name].strip(), 16) == 0 for name in ('CapInh', 'CapPrm', 'CapEff', 'CapAmb')),
                'SINGLE_APP_PROCESS_CHANGED')
        view_module['directory_view_member'](pid, value['directoryView'])
    after = (root / 'stat').read_text()
    require(after[after.rfind(')') + 2:].split()[19] == created, 'SINGLE_APP_PROCESS_CHANGED')
    executable = (root / 'exe').stat()
    again = dict(line.split(':', 1) for line in (root / 'status').read_text().splitlines() if ':' in line)
    require(all(status[key] == again[key] for key in ('Uid', 'Gid', 'Groups', 'NoNewPrivs', 'CapInh', 'CapPrm', 'CapEff', 'CapAmb')),
            'SINGLE_APP_PROCESS_CHANGED')
    return {'pid': pid, 'created': created, 'image': os.readlink(root / 'exe'),
            'device': str(executable.st_dev), 'inode': str(executable.st_ino)}


def members(group, value, core, view_module, pending=False):
    rows = []
    descriptor = os.open('cgroup.procs', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=group)
    try:
        raw = os.read(descriptor, 65537)
        require(len(raw) <= 65536, 'SINGLE_APP_PROCESS_LIMIT')
        for item in raw.split():
            require(item.isdigit(), 'SINGLE_APP_PROCESS_CHANGED')
            try:
                rows.append(process(int(item), value, view_module, pending))
            except (FileNotFoundError, ProcessLookupError):
                continue
        return rows
    finally:
        os.close(descriptor)


def view_receipt(value, view_module):
    return view_module['directory_view_proof']({'desktop': {'identity': value['identity'], 'run': value['run']},
                'bootId': value['run']['bootId'], 'directory': value['identity']['directory'],
                'uid': value['uid'], 'gid': value['gid'], 'directoryView': value['directoryView']})


def tcp_listener(row, value):
    root = Path('/proc') / str(row['pid'])
    held = set()
    for item in (root / 'fd').iterdir():
        try:
            held.add(os.readlink(item))
        except FileNotFoundError:
            pass
    matches = []
    for line in (root / 'net/tcp').read_text().splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 10 and fields[1] == '0100007F:' + format(value['port'], '04X') and fields[3] == '0A':
            require(int(fields[7]) == value['uid'], 'SINGLE_APP_LISTENER_CHANGED')
            if 'socket:[' + fields[9] + ']' in held:
                matches.append(fields[9])
    if not matches and value['state'] == 'starting' and value['endpoint'] is None:
        return None
    require(len(matches) == 1, 'SINGLE_APP_LISTENER_CHANGED')
    return matches[0]


def endpoint(value, rows):
    candidates = [row for row in rows if row['image'] == value['tools']['vnc']['path']]
    if not candidates:
        return None
    require(len(candidates) == 1, 'SINGLE_APP_LISTENER_CHANGED')
    row = candidates[0]
    require((row['device'], row['inode']) == (value['tools']['vnc']['device'], value['tools']['vnc']['inode']),
            'SINGLE_APP_LISTENER_CHANGED')
    arguments = (Path('/proc') / str(row['pid']) / 'cmdline').read_bytes().split(b'\0')
    require(arguments == [os.fsencode(value['tools']['vnc']['command']), *[os.fsencode(item) for item in vnc_arguments(value)], b''],
            'SINGLE_APP_LISTENER_CHANGED')
    inode = tcp_listener(row, value)
    return {**row, 'kernelInode': inode} if inode is not None else None


def runtime_check(value):
    secure_directory(RUNTIME)
    info = Path(value['runtime']).lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == value['uid'] and info.st_gid == value['gid']
            and stat.S_IMODE(info.st_mode) == 0o700
            and (str(info.st_dev), str(info.st_ino)) == (value['runtimeDevice'], value['runtimeInode']),
            'SINGLE_APP_RUNTIME_CHANGED')


def inspect(value, view_module):
    view_receipt(value, view_module)
    core, lock, run, boot = context(value, False)
    try:
        if boot != value['run']['bootId']:
            require(not os.path.lexists('/sys/fs/cgroup/' + run['cgroupName'])
                    and not os.path.lexists(value['runtime']), 'SINGLE_APP_OLD_BOOT_UNCONFIRMED')
            return {'state': 'stopped', 'receipt': value, 'endpoint': None, 'bootId': boot}
        group = core['cgroup_fd'](run)
        try:
            if group is None:
                require(run['phase'] == 'closed', 'SINGLE_APP_RUN_CHANGED')
                return {'state': 'stopped', 'receipt': value, 'endpoint': None, 'bootId': boot}
            if not core['populated'](group):
                return {'state': 'exited' if value['state'] != 'stopped' else 'stopped', 'receipt': value, 'endpoint': None, 'bootId': boot}
            require(run['phase'] == 'active' and value['directoryView'] is not None, 'SINGLE_APP_RUN_CHANGED')
            core['check_run'](value['identity'], run, boot)
            require(core['active'](value['identity']['projectId'], {'expected': {key: value['identity'][key] for key in
                    ('registryId', 'identityId', 'revision')}}, core['registry'](True)) == value['identity'],
                    'SINGLE_APP_PROJECT_CHANGED')
            account(value)
            runtime_check(value)
            require(value['firewall'] == 'active', 'SINGLE_APP_FIREWALL_CHANGED')
            network, info, _ = core['network_fd'](value['identity'], boot, True)
            try:
                require(core['same'](info, run, 'network'), 'SINGLE_APP_NETWORK_CHANGED')
                require(ctypes.CDLL(None, use_errno=True).setns(network, 0x40000000) == 0, 'SINGLE_APP_NETWORK_CHANGED')
            finally:
                os.close(network)
            firewall_validate(value)
            rows = members(group, value, core, view_module, value['state'] == 'starting')
            current = endpoint(value, rows)
            if value['endpoint'] is not None and current is not None:
                require(current == value['endpoint'], 'SINGLE_APP_LISTENER_CHANGED')
            ready = value['processes'] is not None and all(expected in rows for expected in value['processes'].values())
            return {'state': 'running' if current is not None and ready else ('exited' if value['endpoint'] is not None else 'starting'),
                    'receipt': value, 'endpoint': current, 'bootId': boot}
        finally:
            if group is not None:
                os.close(group)
    finally:
        os.close(lock)


def start(value, environment, view_module):
    require(value['state'] == 'prepared' and value['directoryView'] is None and value['supervisor'] is None,
            'SINGLE_APP_START_NOT_REPLAYABLE')
    validate_environment(environment)
    core, lock, run, boot = context(value)
    os.close(lock)
    user = account(value)
    source = view_module['directory_view_open'](value['identity']['directory'])
    network = group = namespace = reader = writer = ready_reader = ready_writer = -1
    child, committed = None, False
    try:
        info = os.fstat(source)
        require((str(info.st_dev), str(info.st_ino)) == (value['identity']['directoryDevice'], value['identity']['directoryInode']),
                'SINGLE_APP_DIRECTORY_CHANGED')
        network, net_info, _ = core['network_fd'](value['identity'], boot, True)
        require((str(net_info.st_dev), str(net_info.st_ino)) == (run['networkDevice'], run['networkInode']), 'SINGLE_APP_NETWORK_CHANGED')
        group = core['cgroup_fd'](run)
        require(group is not None and not core['populated'](group), 'SINGLE_APP_RUN_IN_USE')
        namespace, value['directoryView'] = view_module['directory_view_create'](
                {'identity': value['identity'], 'run': run, 'directoryFd': source}, user)
        view_receipt(value, view_module)
        value['state'] = 'starting'
        atomic(receipt_path(value['id']), value)
        reader, writer = os.pipe2(os.O_CLOEXEC)
        ready_reader, ready_writer = os.pipe2(os.O_CLOEXEC)
        # This is one fixed Root program. It reads the Root receipt before the
        # permanent UID drop; only the UID process evaluates application data.
        child = subprocess.Popen(['/usr/bin/python3', '-I', '-S', str(Path(__file__).resolve()), 'supervise', value['id'],
                                  str(reader), str(source), str(group), str(namespace), str(network), str(ready_writer)],
                                  env=CLEAN_ENV, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  start_new_session=True, pass_fds=[reader, source, group, namespace, network, ready_writer])
        os.close(ready_writer)
        ready_writer = -1
        state = Path('/proc/' + str(child.pid) + '/stat').read_text()
        executable = os.stat('/proc/' + str(child.pid) + '/exe')
        value['supervisor'] = {'pid': child.pid, 'created': state[state.rfind(')') + 2:].split()[19],
                               'image': os.readlink('/proc/' + str(child.pid) + '/exe'),
                               'device': str(executable.st_dev), 'inode': str(executable.st_ino)}
        atomic(receipt_path(value['id']), value)
        # The exact supervisor receives only validated JSON via private stdin.
        child.stdin.write(json.dumps(environment).encode())
        child.stdin.close()
        os.write(writer, b'1')
        os.close(writer)
        writer = -1
        ready = json.loads(private_input(ready_reader, 4096, 15))
        require(isinstance(ready, dict) and set(ready) == {'application', 'wm'}
                and all(isinstance(item, dict) and set(item) == {'pid', 'created'} and type(item['pid']) is int
                        and item['pid'] > 0 and re.fullmatch(r'[0-9]+', item['created']) for item in ready.values()),
                'SINGLE_APP_APPLICATION_NOT_READY')
        value['processes'] = {}
        for name, expected in ready.items():
            current = process(expected['pid'], value, view_module)
            require(current['created'] == expected['created'], 'SINGLE_APP_APPLICATION_CHANGED')
            fields = Path('/proc/' + str(expected['pid']) + '/stat').read_text().rsplit(')', 1)[1].split()
            require(int(fields[1]) == child.pid, 'SINGLE_APP_APPLICATION_CHANGED')
            value['processes'][name] = current
        require(value['processes']['wm']['image'] == value['tools']['wm']['path']
                and (value['processes']['wm']['device'], value['processes']['wm']['inode']) ==
                    (value['tools']['wm']['device'], value['tools']['wm']['inode']), 'SINGLE_APP_APPLICATION_CHANGED')
        atomic(receipt_path(value['id']), value)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try:
                current = inspect(value, view_module)
            except Failure as error:
                # A measured UID/GID transition is never admitted. The exact
                # private bootstrap may finish, then all guards run again.
                if error.code != 'SINGLE_APP_PROCESS_CHANGED':
                    raise
                require(child.poll() is None, 'SINGLE_APP_START_FAILED')
                time.sleep(.05)
                continue
            if current['state'] == 'running':
                value['endpoint'] = current['endpoint']
                value['state'] = 'running'
                atomic(receipt_path(value['id']), value)
                committed = True
                return value
            require(child.poll() is None, 'SINGLE_APP_START_FAILED')
            time.sleep(.1)
        raise Failure('SINGLE_APP_READY_TIMEOUT')
    finally:
        for descriptor in (source, network, group, namespace, reader, writer, ready_reader, ready_writer):
            if descriptor >= 0:
                os.close(descriptor)
        if child is not None:
            if child.stdin is not None and not child.stdin.closed:
                child.stdin.close()
            if not committed:
                # Popen still owns this unreaped exact child; no PID search or
                # reused identifier is used for a failed Root bootstrap.
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
                else:
                    child.wait()


def pinned_execute(expected, arguments, environment, privileged=False):
    # Reopen after the UID/namespace transition, so kernel exec permission uses
    # the mapped view too. An FD from the old project mount retains old IDs.
    descriptor = os.open(expected['path'], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        require(image_descriptor(descriptor, expected['path'], privileged) == {key: item for key, item in expected.items() if key != 'command'},
                'SINGLE_APP_IMAGE_CHANGED')
        header = os.pread(descriptor, 4, 0)
        # A script interpreter needs the ordinary code FD until it has read the
        # script. It conveys no Root authority and was opened as the sandbox UID.
        os.set_inheritable(descriptor, header.startswith(b'#!'))
        os.execve(descriptor, [expected.get('command', expected['path']), *arguments], environment)
    finally:
        os.close(descriptor)


def private_input(descriptor, maximum, timeout=10):
    deadline, result = time.monotonic() + timeout, bytearray()
    while True:
        remaining = deadline - time.monotonic()
        require(remaining > 0 and select.select([descriptor], [], [], remaining)[0], 'SINGLE_APP_START_CANCELLED')
        block = os.read(descriptor, min(4096, maximum + 1 - len(result)))
        if not block:
            return bytes(result)
        result.extend(block)
        require(len(result) <= maximum, 'SINGLE_APP_REQUEST_TOO_LARGE')


def drop_account(user):
    libc = ctypes.CDLL(None, use_errno=True)
    require(libc.prctl(38, 1, 0, 0, 0) == 0, 'SINGLE_APP_NNP_FAILED')
    os.setgroups([])
    os.setresgid(user.pw_gid, user.pw_gid, user.pw_gid)
    os.setresuid(user.pw_uid, user.pw_uid, user.pw_uid)
    header = (ctypes.c_uint32 * 2)(0x20080522, 0)
    data = (ctypes.c_uint32 * 6)()
    require(libc.capset(ctypes.byref(header), ctypes.byref(data)) == 0
            and libc.prctl(47, 4, 0, 0, 0) == 0, 'SINGLE_APP_CAPABILITY_FAILED')
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    require([int(item) for item in status['Uid'].split()] == [user.pw_uid] * 4
            and [int(item) for item in status['Gid'].split()] == [user.pw_gid] * 4
            and status['NoNewPrivs'].strip() == '1' and not status['Groups'].split()
            and all(int(status[name].strip(), 16) == 0 for name in ('CapInh', 'CapPrm', 'CapEff', 'CapAmb')),
            'SINGLE_APP_CAPABILITY_FAILED')


def vnc_arguments(value):
    clipboard = value['origin']['clipboard']
    return [':' + str(value['display']), '-geometry', value['origin']['resolution'], '-depth', '24',
            '-rfbport', str(value['port']), '-interface', '127.0.0.1', '-localhost', '-SecurityTypes', 'VncAuth',
            '-PasswordFile', str(Path(value['runtime']) / 'vnc-password'), '-AlwaysShared', '-nolisten', 'tcp',
            '-auth', str(Path(value['runtime']) / 'Xauthority'), '-AllowOverride=desktop',
            '-SendCutText=' + str(int(clipboard['copy'])), '-SendPrimary=' + str(int(clipboard['copy'])),
            '-AcceptCutText=' + str(int(clipboard['paste'])), '-SetPrimary=' + str(int(clipboard['paste']))]


def seal_descriptors(descriptors):
    require(len(descriptors) == 6 and all(type(descriptor) is int and descriptor > 2 for descriptor in descriptors)
            and len(set(descriptors)) == 6, 'SINGLE_APP_SUPERVISOR_FDS_INVALID')
    # pass_fds cleared CLOEXEC for the fixed supervisor's own exec. Its
    # preexec_fn children exec before Popen performs its later close_fds pass.
    # Reseal every authorized management FD before any application exec.
    for descriptor in descriptors:
        os.set_inheritable(descriptor, False)


def supervise(identifier, descriptors, view_module):
    # No project environment is applied while this fixed process is Root.
    seal_descriptors(descriptors)
    reader, source, group, namespace, network, ready_writer = descriptors
    value = json.loads(protected(receipt_path(identifier), 65536))
    require(value['state'] == 'starting', 'SINGLE_APP_SUPERVISOR_CHANGED')
    value = read_receipt(identifier, value['origin'])
    core, lock, run, boot = context(value)
    os.close(lock)
    require(core['same'](os.fstat(group), run, 'cgroup') and core['same'](os.fstat(network), run, 'network'),
            'SINGLE_APP_RUN_CHANGED')
    parent = os.getppid()
    libc = ctypes.CDLL(None, use_errno=True)
    require(libc.prctl(1, signal.SIGKILL, 0, 0, 0) == 0 and os.getppid() == parent
            and libc.prctl(38, 1, 0, 0, 0) == 0, 'SINGLE_APP_START_CANCELLED')
    # Before waiting on host ACK, bind the short Root bootstrap to the exact
    # original run. Losing the preparation parent kills it; stop kills the run.
    require(libc.setns(network, 0x40000000) == 0, 'SINGLE_APP_NETWORK_CHANGED')
    os.close(network)
    descriptor = os.open('cgroup.procs', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=group)
    try:
        os.write(descriptor, (str(os.getpid()) + '\n').encode())
    finally:
        os.close(descriptor)
        os.close(group)
    environment = json.loads(private_input(0, 32768))
    validate_environment(environment)
    require(private_input(reader, 1) == b'1' and os.getppid() == parent, 'SINGLE_APP_START_CANCELLED')
    os.close(reader)
    value = read_receipt(identifier, value['origin'])
    require(value['supervisor']['pid'] == os.getpid(), 'SINGLE_APP_SUPERVISOR_CHANGED')
    mapped = view_module['directory_view_enter'](namespace, value['directoryView'], value['identity']['directory'])
    os.close(source)
    user = account(value)
    drop_account(user)
    # setresuid clears the bootstrap death signal. The permanent unprivileged
    # supervisor can survive its short SSH preparation connection.
    require(libc.prctl(1, 0, 0, 0, 0) == 0 and libc.prctl(4, 0, 0, 0, 0) == 0,
            'SINGLE_APP_SUPERVISOR_CHANGED')
    try:
        os.fchdir(mapped)
    finally:
        os.close(mapped)
    require(os.access('.', os.R_OK | os.W_OK | os.X_OK), 'SINGLE_APP_DIRECTORY_DENIED')
    os.umask(0o077)
    fixed = {'HOME': value['home'], 'USER': value['user'], 'LOGNAME': value['user'],
                   'PATH': '/usr/local/bin:/usr/bin:/bin', 'SHELL': '/bin/sh', 'DISPLAY': ':' + str(value['display']),
                   'XAUTHORITY': str(Path(value['runtime']) / 'Xauthority'), 'XDG_RUNTIME_DIR': value['runtime'],
             'LANG': 'C', 'QT_QPA_PLATFORM': 'xcb', 'GDK_BACKEND': 'x11', 'SDL_VIDEODRIVER': 'x11'}
    environment = {**environment, **fixed}
    environment.pop('WAYLAND_DISPLAY', None)
    environment.pop('DBUS_SESSION_BUS_ADDRESS', None)
    environment.pop('SSH_AUTH_SOCK', None)
    environment.pop('SSH_AGENT_PID', None)
    cookie = os.urandom(16)
    fields = [b'', str(value['display']).encode(), b'MIT-MAGIC-COOKIE-1', cookie]
    auth = struct.pack('>H', 65535) + b''.join(struct.pack('>H', len(item)) + item for item in fields)
    for name, raw in [('Xauthority', auth)]:
        fd = os.open(Path(value['runtime']) / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            os.write(fd, raw)
        finally:
            os.close(fd)
    password = subprocess.run([value['tools']['password']['path'], '-f'], input=(value['password'] + '\n').encode(),
                              capture_output=True, env=fixed, timeout=5,
                              preexec_fn=lambda: pinned_execute(value['tools']['password'], ['-f'], fixed))
    require(password.returncode == 0 and len(password.stdout) == 8, 'SINGLE_APP_PASSWORD_FAILED')
    password_path = Path(value['runtime']) / 'vnc-password'
    password_path.write_bytes(password.stdout)
    def spawn(expected, arguments, child_environment):
        return subprocess.Popen([expected['path'], *arguments], env=child_environment, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                preexec_fn=lambda: pinned_execute(expected, arguments, child_environment))
    vnc = spawn(value['tools']['vnc'], vnc_arguments(value), fixed)
    wm = app = None
    try:
        for attempt in range(40):
            require(vnc.poll() is None, 'SINGLE_APP_VNC_FAILED')
            probe_args = ['-display', fixed['DISPLAY']]
            probe = subprocess.run([value['tools']['probe']['path'], *probe_args], env=fixed,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2,
                                   preexec_fn=lambda: pinned_execute(value['tools']['probe'], probe_args, fixed))
            if probe.returncode == 0:
                break
            time.sleep(.25)
        else:
            raise Failure('SINGLE_APP_VNC_FAILED')
        wm = spawn(value['tools']['wm'], [], fixed)
        app = spawn(value['image'], value['origin']['args'], environment)
        ready = {}
        for name, child in [('application', app), ('wm', wm)]:
            require(child.poll() is None, 'SINGLE_APP_APPLICATION_EXITED')
            fields = Path('/proc/' + str(child.pid) + '/stat').read_text().rsplit(')', 1)[1].split()
            ready[name] = {'pid': child.pid, 'created': fields[19]}
        # Popen's exec error pipe has closed successfully for both children.
        # This private descriptor is CLOEXEC and never passed to their execs.
        os.write(ready_writer, json.dumps(ready, separators=(',', ':')).encode())
        os.close(ready_writer)
        ready_writer = -1
        app.wait(timeout=14400)
    finally:
        if ready_writer >= 0:
            os.close(ready_writer)
        for child in (app, wm, vnc):
            if child is not None and child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()


def runtime_remove(value):
    runtime = Path(value['runtime'])
    if not os.path.lexists(runtime):
        return
    require(value['runtimeDevice'] is not None, 'SINGLE_APP_RUNTIME_CLEANUP_UNCONFIRMED')
    parent = os.open(secure_directory(RUNTIME), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    descriptor = -1
    try:
        descriptor = os.open(value['id'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        original = os.fstat(descriptor)
        require((str(original.st_dev), str(original.st_ino)) == (value['runtimeDevice'], value['runtimeInode'])
                and original.st_uid in (0, value['uid']), 'SINGLE_APP_RUNTIME_CHANGED')
        remaining = [4096]
        def clear(folder, depth):
            require(depth < 32, 'SINGLE_APP_RUNTIME_CLEANUP_LIMIT')
            for name in os.listdir(folder):
                remaining[0] -= 1
                require(remaining[0] >= 0, 'SINGLE_APP_RUNTIME_CLEANUP_LIMIT')
                before = os.stat(name, dir_fd=folder, follow_symlinks=False)
                if stat.S_ISDIR(before.st_mode):
                    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=folder)
                    try:
                        current = os.fstat(child)
                        require((current.st_dev, current.st_ino) == (before.st_dev, before.st_ino)
                                and current.st_dev == original.st_dev, 'SINGLE_APP_RUNTIME_CHANGED')
                        clear(child, depth + 1)
                    finally:
                        os.close(child)
                    require(os.stat(name, dir_fd=folder, follow_symlinks=False).st_ino == before.st_ino,
                            'SINGLE_APP_RUNTIME_CHANGED')
                    os.rmdir(name, dir_fd=folder)
                else:
                    os.unlink(name, dir_fd=folder)
        clear(descriptor, 0)
        info = os.stat(value['id'], dir_fd=parent, follow_symlinks=False)
        require((info.st_dev, info.st_ino) == (original.st_dev, original.st_ino), 'SINGLE_APP_RUNTIME_CHANGED')
        os.rmdir(value['id'], dir_fd=parent)
        os.fsync(parent)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        os.close(parent)


def stop(value, view_module):
    view_receipt(value, view_module)
    value['state'] = 'stopping'
    atomic(receipt_path(value['id']), value)
    core, lock, run, boot = context(value, False, True)
    try:
        if boot != run['bootId']:
            require(not os.path.lexists('/sys/fs/cgroup/' + run['cgroupName'])
                    and not os.path.lexists(value['runtime']), 'SINGLE_APP_OLD_BOOT_UNCONFIRMED')
            value['retirement'] = {'reason': 'guest-reboot', 'bootId': boot}
        else:
            group = core['cgroup_fd'](run)
            try:
                if group is not None and core['populated'](group):
                    members(group, value, core, view_module, True)
            finally:
                if group is not None:
                    os.close(group)
            closed = core['stop'](value['identity'], run, boot)
            require(closed['phase'] == 'closed' and same_run(closed, value['run']), 'SINGLE_APP_CLEANUP_UNCONFIRMED')
            # Killing the complete original group also releases its mapped
            # namespace. Cleanup validates the receipt itself, without opening
            # a dead process's namespace or adopting a replacement namespace.
            network, info, _ = core['network_fd'](value['identity'], boot, True)
            try:
                require(core['same'](info, run, 'network')
                        and ctypes.CDLL(None, use_errno=True).setns(network, 0x40000000) == 0,
                        'SINGLE_APP_NETWORK_CHANGED')
            finally:
                os.close(network)
            firewall_remove(value)
            runtime_remove(value)
        value['state'] = 'stopped'
        atomic(receipt_path(value['id']), value)
        return value
    finally:
        os.close(lock)


def stop_missing(request):
    # A guest prepare never mutates an account/runtime/firewall before its
    # receipt. Missing receipt therefore authorizes only native-run retirement.
    require(not os.path.lexists(receipt_path(request['id']))
            and not os.path.lexists(RUNTIME / request['id']), 'SINGLE_APP_CLEANUP_UNCONFIRMED')
    if os.path.lexists(BASE / request['id']):
        require(not list(secure_directory(BASE / request['id']).iterdir()), 'SINGLE_APP_CLEANUP_UNCONFIRMED')
    value = {'id': request['id'], 'identity': request['origin']['identity'], 'run': request['origin']['run']}
    core, lock, run, boot = context(value, False, True)
    try:
        if boot != run['bootId']:
            require(not os.path.lexists('/sys/fs/cgroup/' + run['cgroupName'])
                    and not os.path.lexists(RUNTIME / request['id']), 'SINGLE_APP_OLD_BOOT_UNCONFIRMED')
            return {'receipt': None, 'run': run, 'retirement': {'reason': 'guest-reboot', 'bootId': boot}}
        group = core['cgroup_fd'](run)
        try:
            require(group is None or not core['populated'](group), 'SINGLE_APP_CLEANUP_UNCONFIRMED')
        finally:
            if group is not None:
                os.close(group)
        closed = core['stop'](value['identity'], run, boot)
        return {'receipt': None, 'run': closed, 'retirement': None}
    finally:
        os.close(lock)


def prepare_native(request):
    require(set(request) == {'id', 'identity', 'bootId', 'nativeBuild'} and UUID.fullmatch(request['id'])
            and UUID.fullmatch(request['bootId']) and DIGEST.fullmatch(request['nativeBuild']), 'SINGLE_APP_REQUEST_INVALID')
    core = native(request['nativeBuild'])
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    require(boot == request['bootId'], 'SINGLE_APP_BOOT_CHANGED')
    lock = core['initialize']()
    try:
        identity = core['active'](request['identity']['projectId'], {'expected': {key: request['identity'][key] for key in
                    ('registryId', 'identityId', 'revision')}}, core['registry'](True))
        require(identity == request['identity'], 'SINGLE_APP_PROJECT_CHANGED')
        return core['prepare'](identity, {'runId': request['id']}, boot, request['nativeBuild'])
    finally:
        os.close(lock)


def recover_intent(request):
    require(set(request) == {'id', 'identity', 'bootId', 'nativeBuild'} and UUID.fullmatch(request['id'])
            and UUID.fullmatch(request['bootId']) and DIGEST.fullmatch(request['nativeBuild']), 'SINGLE_APP_REQUEST_INVALID')
    core = native(request['nativeBuild'])
    if os.path.lexists(BASE):
        secure_directory(BASE)
    lock = core['initialize_readonly']()
    try:
        identity = core['binding_read'](request['identity']['projectId'])
        core['reservation_check'](identity, core['registry'](True))
        require(identity == request['identity'], 'SINGLE_APP_PROJECT_CHANGED')
        try:
            run = core['run_read'](request['id'])
        except core['Refusal'] as error:
            require(error.code == 'RECORD_ABSENT', 'SINGLE_APP_RUN_CHANGED')
            # No ticket means no cgroup ownership proof. Never create/adopt a
            # replacement run for cleanup. The original name must be absent,
            # together with both guest resources and both native ticket stores.
            require(core['read'](core['run_path'](request['id']), core['RUN'].size, True) is None
                    and core['run_archive_read'](request['id']) is None
                    and not os.path.lexists('/sys/fs/cgroup/sakura-identity-' + request['id'])
                    and not os.path.lexists(receipt_path(request['id']))
                    and not os.path.lexists(RUNTIME / request['id']), 'SINGLE_APP_INTENT_CLEANUP_UNCONFIRMED')
            if os.path.lexists(BASE / request['id']):
                require(not list(secure_directory(BASE / request['id']).iterdir()), 'SINGLE_APP_INTENT_CLEANUP_UNCONFIRMED')
            current_boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
            return {'run': None, 'absence': {'version': 1, 'id': request['id'], 'bootId': request['bootId'],
                    'nativeBuild': request['nativeBuild'], 'currentBootId': current_boot,
                    'ticketAbsent': True, 'cgroupAbsent': True, 'guestReceiptAbsent': True, 'runtimeAbsent': True}}
        core['check_run'](identity, run, request['bootId'], False)
        require(run['runId'] == request['id'] and run['build'] == request['nativeBuild'] and run['mode'] == 'independent'
                and run['cgroupName'] == 'sakura-identity-' + request['id'], 'SINGLE_APP_RUN_CHANGED')
        group = core['cgroup_fd'](run)
        if group is not None:
            os.close(group)
        return {'run': run, 'absence': None}
    finally:
        os.close(lock)


def stream(value, view_module):
    before = inspect(value, view_module)
    require(value['state'] == before['state'] == 'running' and before['endpoint'] == value['endpoint'],
            'SINGLE_APP_STREAM_STALE')
    core, lock, run, boot = context(value)
    try:
        network, info, _ = core['network_fd'](value['identity'], boot, True)
    finally:
        os.close(lock)
    try:
        require(core['same'](info, run, 'network') and ctypes.CDLL(None, use_errno=True).setns(network, 0x40000000) == 0,
                'SINGLE_APP_NETWORK_CHANGED')
    finally:
        os.close(network)
    peer = socket.create_connection(('127.0.0.1', value['port']), timeout=3)
    try:
        require(inspect(value, view_module)['endpoint'] == value['endpoint'], 'SINGLE_APP_LISTENER_CHANGED')
        peer.setblocking(False)
        os.set_blocking(0, False)
        os.set_blocking(1, False)
        upstream, downstream = bytearray(), bytearray()
        input_open = peer_open = True
        next_check = time.monotonic() + 2
        while peer_open or downstream:
            reads = ([peer] if peer_open and len(downstream) < 262144 else []) + ([0] if input_open and len(upstream) < 262144 else [])
            writes = ([peer] if upstream else []) + ([1] if downstream else [])
            ready, writable, _ = select.select(reads, writes, [], 1)
            if time.monotonic() >= next_check:
                require(inspect(value, view_module)['endpoint'] == value['endpoint'], 'SINGLE_APP_LISTENER_CHANGED')
                next_check = time.monotonic() + 2
            for item in ready:
                data = peer.recv(65536) if item == peer else os.read(0, 65536)
                if not data:
                    if item == peer:
                        peer_open = input_open = False
                        upstream.clear()
                    else:
                        input_open = False
                elif item == peer:
                    downstream.extend(data)
                else:
                    upstream.extend(data)
            for item in writable:
                if item == peer:
                    try:
                        del upstream[:peer.send(upstream)]
                    except BrokenPipeError:
                        upstream.clear()
                        input_open = False
                else:
                    del downstream[:os.write(1, downstream)]
            if not input_open and not upstream and peer_open:
                try:
                    peer.shutdown(socket.SHUT_WR)
                except OSError:
                    pass
    finally:
        peer.close()


def main():
    os.environ.clear()
    require(os.getuid() == 0, 'SINGLE_APP_ROOT_REQUIRED')
    view_module = load_package()
    if len(sys.argv) == 9 and sys.argv[1] == 'supervise':
        supervise(sys.argv[2], [int(item) for item in sys.argv[3:]], view_module)
        return
    require(len(sys.argv) >= 2 and sys.argv[1] in ('prepare', 'start', 'status', 'stop', 'stream', 'recover', 'prepare-run'), 'SINGLE_APP_REQUEST_INVALID')
    action = sys.argv[1]
    if action == 'stream':
        require(len(sys.argv) == 4 and UUID.fullmatch(sys.argv[2]) and DIGEST.fullmatch(sys.argv[3]), 'SINGLE_APP_REQUEST_INVALID')
        secure_directory(receipt_path(sys.argv[2]).parent)
        value = json.loads(protected(receipt_path(sys.argv[2]), 65536))
        digest = hashlib.sha256(json.dumps(value['origin'], sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()
        require(digest == sys.argv[3], 'SINGLE_APP_STREAM_STALE')
        value = read_receipt(sys.argv[2], value['origin'])
        stream(value, view_module)
        return
    else:
        require(len(sys.argv) == 2, 'SINGLE_APP_REQUEST_INVALID')
        raw = sys.stdin.buffer.read(65537)
    require(len(raw) <= 65536, 'SINGLE_APP_REQUEST_TOO_LARGE')
    request = json.loads(raw)
    if action in ('recover', 'prepare-run'):
        # Both bind the captured immutable native build. Recovery uses the
        # existing SH registry and creates nothing; prepare-run uses the core
        # EX transaction, after boot/account checks and host durable intent.
        result = recover_intent(request) if action == 'recover' else prepare_native(request)
        print(json.dumps({'ok': True, 'result': result}, separators=(',', ':')))
        return
    require(set(request) == ({'id', 'origin', 'environment'} if action == 'start' else {'id', 'origin'}), 'SINGLE_APP_REQUEST_INVALID')
    validate_origin(request['origin'], request['id'])
    secure_directory(BASE, action != 'status')
    guard = os.open(BASE / 'controller.lock', (os.O_RDONLY if action == 'status' else os.O_WRONLY | os.O_CREAT)
                    | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        info = os.fstat(guard)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077 and info.st_nlink == 1,
                'SINGLE_APP_LOCK_CHANGED')
        fcntl.flock(guard, fcntl.LOCK_SH if action == 'status' else fcntl.LOCK_EX)
        if action == 'prepare':
            result = prepare(request)
        elif action == 'stop' and not receipt_path(request['id']).exists():
            result = stop_missing(request)
        else:
            value = read_receipt(request['id'], request['origin'])
            if action == 'start':
                result = start(value, request['environment'], view_module)
            elif action == 'status':
                result = inspect(value, view_module)
            else:
                stopped = stop(value, view_module)
                result = {'receipt': stopped, 'run': {**stopped['run'], 'phase': 'closed'} if stopped['retirement'] is None else stopped['run'],
                          'retirement': stopped['retirement']}
    finally:
        os.close(guard)
    print(json.dumps({'ok': True, 'result': result}, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        code = getattr(error, 'code', 'SINGLE_APP_CONTROL_FAILED')
        if not str(code).startswith(('SINGLE_APP_', 'PROJECT_IDENTITY_')):
            code = 'PROJECT_IDENTITY_' + str(code)
        if getattr(error, 'stage', None) is not None:
            code = 'SINGLE_APP_DIRECTORY_VIEW_UNAVAILABLE'
        if len(sys.argv) >= 2 and sys.argv[1] == 'stream':
            print('SAKURA_SINGLE_APP_STREAM_REFUSED', file=sys.stderr)
        elif len(sys.argv) >= 2 and sys.argv[1] != 'supervise':
            print(json.dumps({'ok': False, 'code': code, 'stage': getattr(error, 'stage', None),
                              'errno': getattr(error, 'errno', None)}, separators=(',', ':')))
        raise SystemExit(73)
