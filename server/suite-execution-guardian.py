"""Own one fixed non-root worker and terminate its group when its short lease expires."""
import datetime
import hashlib
import json
import os
import pathlib
import selectors
import signal
import stat
import subprocess
import sys
import time

MAX_INPUT = 8 * 1024 * 1024
MAX_OUTPUT = 8 * 1024 * 1024 - 8192


def regular(path):
    value = path.lstat()
    if not stat.S_ISREG(value.st_mode) or value.st_uid != 0 or value.st_nlink != 1 or value.st_mode & 0o022:
        raise RuntimeError('GUARD_FILE_IDENTITY')
    return value


def run():
    if os.getuid() != 0 or len(sys.argv) != 3:
        raise RuntimeError('GUARD_CONTEXT')
    root = pathlib.Path(sys.argv[1])
    session = sys.argv[2]
    if root != pathlib.Path('/var/lib/sakura-suite') / session or len(session) != 36:
        raise RuntimeError('GUARD_PATH')
    worker, permit = root / 'worker.py', root / 'permit.json'
    regular(worker)
    regular(permit)
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise RuntimeError('GUARD_INPUT_LIMIT')
    value = json.loads(raw)
    if value['sessionId'] != session:
        raise RuntimeError('GUARD_SESSION')
    expires = datetime.datetime.fromisoformat(value['deadline'].replace('Z', '+00:00')).timestamp()
    if not 0 < expires - time.time() <= 1900:
        raise RuntimeError('GUARD_DEADLINE')
    directory = root / 'work'
    directory.mkdir(mode=0o700)
    os.chown(directory, 65534, 65534)
    start = time.monotonic()

    def drop():
        os.setgroups([])
        os.setgid(65534)
        os.setuid(65534)
        os.umask(0o077)

    child = subprocess.Popen([sys.executable, '-I', '-S', str(worker)], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=str(directory),
                             env={'PATH': '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
                                  'HOME': str(directory), 'TMPDIR': str(directory), 'LANG': 'C.UTF-8'},
                             start_new_session=True, preexec_fn=drop)
    identity = pathlib.Path('/proc') / str(child.pid) / 'stat'
    ticks = identity.read_text().rsplit(') ', 1)[1].split()[19]
    # stdin is bounded. The worker consumes it before performing any domain action.
    selector = selectors.DefaultSelector()
    os.set_blocking(child.stdin.fileno(), False)
    selector.register(child.stdin, selectors.EVENT_WRITE, 'stdin')
    written = 0
    selector.register(child.stdout, selectors.EVENT_READ, 'stdout')
    selector.register(child.stderr, selectors.EVENT_READ, 'stderr')
    output = bytearray()
    error_bytes = 0
    reason = 'returned'
    try:
        while selector.get_map():
            try:
                regular(permit)
                grant = json.loads(permit.read_text())
                alive = grant['sessionId'] == session and time.monotonic() < grant['until']
            except Exception:
                alive = False
            if not alive or time.time() >= expires:
                reason = 'authorization-expired' if not alive else 'deadline'
                break
            for key, _ in selector.select(0.05):
                if key.data == 'stdin':
                    try:
                        written += os.write(key.fileobj.fileno(), raw[written:written + 65536])
                    except BrokenPipeError:
                        written = len(raw)
                    if written == len(raw):
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
                    continue
                part = os.read(key.fileobj.fileno(), 65536)
                if not part:
                    selector.unregister(key.fileobj)
                elif key.data == 'stdout':
                    output.extend(part)
                    if len(output) > MAX_OUTPUT:
                        reason = 'output-limit'
                        break
                else:
                    error_bytes += len(part)
                    if error_bytes > 256 * 1024:
                        reason = 'stderr-limit'
                        break
            if reason != 'returned':
                break
    finally:
        if reason == 'returned':
            try:
                child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                reason = 'incomplete-exit'
        # This process group belongs solely to this newly created worker in its private VM.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait(timeout=5)
        selector.close()
    parsed = None
    if reason == 'returned' and child.returncode == 0:
        try:
            parsed = json.loads(output.decode('utf-8'))
        except Exception:
            reason = 'invalid-output'
    result = {'format': 'sakura-suite-guardian/1', 'sessionId': session, 'uid': 65534, 'gid': 65534,
              'pid': child.pid, 'startTicks': ticks, 'exitCode': child.returncode,
              'reason': reason, 'elapsedMs': (time.monotonic() - start) * 1000, 'worker': parsed}
    encoded = json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(encoded) > 8 * 1024 * 1024:
        raise RuntimeError('GUARD_OUTPUT_LIMIT')
    output_file = root / 'output.json'
    fd = os.open(output_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    with os.fdopen(fd, 'wb') as target:
        target.write(encoded)
        target.flush()
        os.fsync(target.fileno())
        written = os.fstat(target.fileno())
    sys.stdout.write(json.dumps({'format': 'sakura-suite-transport/1', 'bytes': len(encoded),
                                'digest': hashlib.sha256(encoded).hexdigest(), 'inode': str(written.st_ino),
                                'mtimeNs': str(written.st_mtime_ns)}, separators=(',', ':')))


if __name__ == '__main__':
    run()
