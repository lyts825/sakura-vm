"""Ordinary xterm child for the owned current-UID public SingleApp smoke."""
import errno
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import sys
import time


directory, marker = map(Path, sys.argv[1:3])
expected, argument = sys.argv[3:5]
mode = sys.argv[5] if len(sys.argv) == 6 else 'manual'
assert len(sys.argv) in (5, 6) and mode in ('manual', 'natural-exit')
child = None
os.umask(0o077)


def publish(path, value):
    # Readers only see the complete record. A unique link publishes it without
    # replacing any existing project entry, including a symlink.
    payload = json.dumps(value).encode('utf8')
    assert 0 < len(payload) <= 32768
    temporary = path.with_name(path.name + '.pending-' + str(os.getpid()))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        offset = 0
        while offset < len(payload):
            count = os.write(fd, payload[offset:])
            assert count > 0
            offset += count
        owned = os.fstat(fd)
        current = temporary.lstat()
        assert (current.st_dev, current.st_ino) == (owned.st_dev, owned.st_ino)
        os.link(temporary, path, follow_symlinks=False)
    finally:
        owned = os.fstat(fd)
        os.close(fd)
        current = temporary.lstat()
        assert (current.st_dev, current.st_ino) == (owned.st_dev, owned.st_ino)
        temporary.unlink()


def observe():
    pid = os.getpid()
    fields = Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines())
    assert 1000 <= os.getuid() < 20000 and os.getgid() == os.getuid()
    assert all(int(value) == os.getuid() for value in status['Uid'].split())
    assert all(int(value) == os.getgid() for value in status['Gid'].split())
    assert not status['Groups'].strip() and status['NoNewPrivs'].strip() == '1'
    assert all(int(status[key].strip(), 16) == 0 for key in ('CapInh', 'CapPrm', 'CapEff', 'CapAmb'))
    home = Path(os.environ['HOME'])
    home_info = home.lstat()
    assert stat.S_ISDIR(home_info.st_mode) and home_info.st_uid == home_info.st_gid == os.getuid()
    assert stat.S_IMODE(home_info.st_mode) == 0o700
    return {'pid': pid, 'created': fields[19], 'uid': os.getuid(), 'gid': os.getgid(),
            'sid': os.getsid(0), 'cwd': os.getcwd(), 'home': str(home), 'user': os.environ.get('USER'),
            'homeDevice': str(home_info.st_dev), 'homeInode': str(home_info.st_ino),
            'status': {key: status[key].strip() for key in ('Uid', 'Gid', 'Groups', 'NoNewPrivs', 'CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb')},
            'cgroup': Path('/proc/self/cgroup').read_text(),
            'networkDevice': str(os.stat('/proc/self/ns/net').st_dev), 'networkInode': str(os.stat('/proc/self/ns/net').st_ino),
            'mountDevice': str(os.stat('/proc/self/ns/mnt').st_dev), 'mountInode': str(os.stat('/proc/self/ns/mnt').st_ino)}


def request(path, kind, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        except FileNotFoundError:
            time.sleep(.1)
            continue
        try:
            info = os.fstat(fd)
            assert stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == os.getuid()
            assert stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1 and 0 < info.st_size <= 2048
            payload = os.read(fd, 2049)
            assert len(payload) == info.st_size
            value = json.loads(payload)
            assert value['version'] == 1 and value['kind'] == kind and value['marker'] == str(marker)
            return value
        finally:
            os.close(fd)
    raise TimeoutError('owned request missing: ' + str(path))


def network_ports():
    value = request(marker.with_name(marker.name + '.ports.start'), 'owned-single-app-port-check')
    current = observe()
    assert value['uid'] == current['uid'] and value['gid'] == current['gid']
    assert (value['networkDevice'], value['networkInode']) == (current['networkDevice'], current['networkInode'])
    display = re.fullmatch(r':(1[0-7])(?:\.0)?', os.environ['DISPLAY'])
    assert display is not None
    own_port = 5900 + int(display.group(1))
    assert value['ownPort'] == own_port and value['blockedPort'] == 5901
    peer = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    peer.settimeout(3)
    try:
        peer.connect(('127.0.0.1', own_port))
        banner = b''
        while len(banner) < 12:
            data = peer.recv(12 - len(banner))
            assert data
            banner += data
        assert banner == b'RFB 003.008\n'
    finally:
        peer.close()
    other = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    other.settimeout(3)
    try:
        other.connect(('127.0.0.1', 5901))
        raise AssertionError('independent window UID reached the real desktop listener')
    except OSError as error:
        assert error.errno in (errno.ECONNREFUSED, errno.EACCES, errno.EPERM, errno.EHOSTUNREACH), repr(error)
        refusal = error.errno
    finally:
        other.close()
    return {'passed': True, 'ownPort': own_port, 'ownListenerBanner': banner.decode('ascii'),
            'blockedPort': 5901, 'blockedPortErrno': refusal, 'uid': current['uid'], 'gid': current['gid'],
            'networkDevice': current['networkDevice'], 'networkInode': current['networkInode']}


if mode == 'natural-exit':
    # This ordinary same-UID parent observes the worker's actual wait status.
    # It then exits normally, so xterm naturally exits without -hold. The
    # detached descendant remains in the original group for the host watcher.
    worker = os.fork()
    if worker:
        waited, status = os.waitpid(worker, 0)
        passed = waited == worker and os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0
        publish(marker.with_name(marker.name + '.main-exit'), {
            'passed': passed, 'actualWaitPid': waited, 'workerPid': worker, 'rawWaitStatus': status,
            'normalExitCode': os.WEXITSTATUS(status) if os.WIFEXITED(status) else None,
            'supervisor': observe()})
        sys.exit(0 if passed else 71)


result = {'passed': False}
try:
    assert directory.is_absolute() and marker.parent == directory and os.getcwd() == str(directory)
    assert argument == ' retained argument spaces 界 ', repr(argument)
    result = {**observe(), 'passed': False, 'argumentPreserved': argument, 'mode': mode}
    info = (directory / 'private.txt').lstat()
    assert stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600
    assert (directory / 'private.txt').read_text() == expected
    (directory / 'private.txt').write_text('single-app-alpha')
    assert Path('private.txt').read_text() == 'single-app-alpha'
    os.umask(0o077)
    prefix = 'single-app' if mode == 'manual' else 'single-app-natural'
    Path(prefix + '-relative.txt').write_text('owned-relative')
    (directory / (prefix + '-absolute.txt')).write_text('owned-absolute')
    child = os.fork()
    if child == 0:
        child_result = {'passed': False, 'detached': True}
        try:
            os.setsid()
            signal.signal(signal.SIGHUP, signal.SIG_IGN)
            null = os.open('/dev/null', os.O_RDWR | os.O_CLOEXEC)
            for descriptor in range(3):
                os.dup2(null, descriptor)
            if null > 2:
                os.close(null)
            child_result = {**observe(), 'passed': True, 'detached': True}
        except BaseException as error:
            child_result['error'] = type(error).__name__ + ': ' + str(error)
        finally:
            publish(marker.with_name(marker.name + '.detached'), child_result)
        while True:
            time.sleep(1)
    result['detachedPid'] = child
    result['absoluteAndRelativeReadWrite'] = True
    result['passed'] = True
except BaseException as error:
    result['error'] = type(error).__name__ + ': ' + str(error)
finally:
    publish(marker, result)

try:
    ports = network_ports()
except BaseException as error:
    ports = {'passed': False, 'error': type(error).__name__ + ': ' + str(error)}
publish(marker.with_name(marker.name + '.ports.result'), ports)

if mode == 'natural-exit' and result['passed'] and ports['passed']:
    value = request(marker.with_name(marker.name + '.exit.start'), 'owned-single-app-normal-exit')
    current = observe()
    assert value['pid'] == current['pid'] and value['created'] == current['created']
    sys.exit(0)

# Only the real public stop or the start-own host watcher may retire the full
# group. This ordinary test body never kills or adopts another process.
while True:
    time.sleep(1)
