#!/usr/bin/env python3
"""固定客户机演练执行器。 Fixed guest adapter; no caller-provided commands or paths."""
import datetime
import contextlib
import fcntl
import hashlib
import http.server
import json
import os
import pathlib
import signal
import socket
import stat
import shutil
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = pathlib.Path('/var/lib/sakura-drills')
SCRIPT = '/usr/local/lib/sakura/drill-guest.py'

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')

def digest(data):
    return hashlib.sha256(data).hexdigest()

def run(*args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10).stdout

def atomic(path, value):
    temporary = path.with_suffix(path.suffix + '.' + str(uuid.uuid4()) + '.next')
    with open(temporary, 'w') as handle:
        json.dump(value, handle, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)

def load(path):
    with open(path) as handle:
        return json.load(handle)

@contextlib.contextmanager
def action_lock(base):
    with open(base / 'action.lock', 'a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)

def prepare_clone_boot():
    # 仅为本体核验拥有的 Alpine 副本重新启用现有克隆初始化；不安装工具或下载内容。
    # Re-enable existing clone provisioning only in the core-owned Alpine replica, with no install or download.
    cloud = run('sh', '-c', 'command -v tiny-cloud').strip()
    if cloud not in ['/sbin/tiny-cloud', '/usr/sbin/tiny-cloud']:
        raise RuntimeError('unsupported-alpine-clone-tool-location')
    for name in ['/etc/alpine-release', cloud]:
        info = pathlib.Path(name).lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError('unsupported-or-untrusted-alpine-clone-tool')
    for service, level in [('tiny-cloud-boot', 'boot'), ('tiny-cloud-early', 'default'), ('tiny-cloud-main', 'default'), ('tiny-cloud-final', 'default')]:
        info = pathlib.Path('/etc/init.d/' + service).lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError('untrusted-clone-boot-hook')
        run('rc-update', 'add', service, level)
    directory = pathlib.Path('/var/lib/cloud')
    if directory.is_symlink() or directory.stat().st_uid != 0:
        raise RuntimeError('clone-state-boundary-invalid')
    for name in ['.bootstrap-complete', '.nocloud_loaded', '.autodetect', 'user-data', 'meta-data', 'vendor-data', 'network-config']:
        path = directory / name
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1:
            raise RuntimeError('clone-state-file-invalid')
        path.unlink()
    os.sync()

def process_identity(pid):
    text = pathlib.Path('/proc/%d/stat' % pid).read_text()
    fields = text[text.rfind(')') + 2:].split()
    return {'pid': pid, 'start': fields[19], 'group': int(fields[2])}

def original(process):
    try:
        text = pathlib.Path('/proc/%d/stat' % process['pid']).read_text()
        return not text[text.rfind(')') + 2:].startswith('Z') and process_identity(process['pid']) == process
    except (FileNotFoundError, ProcessLookupError):
        return False

def stop(process):
    if original(process):
        os.kill(process['pid'], signal.SIGKILL)
        for _ in range(100):
            try:
                # A zombie is no longer executing; the original parent reaps it.
                text = pathlib.Path('/proc/%d/stat' % process['pid']).read_text()
                if text[text.rfind(')') + 2:].startswith('Z'):
                    return
            except FileNotFoundError:
                return
            time.sleep(.01)
        raise RuntimeError('original-process-exit-unconfirmed')

def paths(run_id):
    if str(uuid.UUID(run_id)) != run_id:
        raise ValueError('noncanonical-run-id')
    base = ROOT / run_id
    for parent in [ROOT, base]:
        if parent.is_symlink():
            raise ValueError('symlink-boundary')
    return base

def assert_owner(base, state):
    if state['boot'] != pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip():
        raise RuntimeError('boot-identity-stale')
    if os.stat('/var/run/netns/' + state['namespace']).st_ino != state['namespaceInode']:
        raise RuntimeError('namespace-identity-stale')
    if os.stat(base / 'volume').st_dev != state['volumeDevice']:
        raise RuntimeError('volume-identity-stale')

def launch_service(base, state):
    # 普通账户只运行固定合成业务；测试网络和管理连接分离。
    # The ordinary account runs only the fixed synthetic service, off the management interface.
    with open(base / 'worker.stderr', 'ab', buffering=0) as log:
        child = subprocess.Popen(['ip', 'netns', 'exec', state['namespace'], 'python3', SCRIPT, 'serve', str(base)],
                                 stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                 start_new_session=True)
    state['service'] = process_identity(child.pid)
    atomic(base / 'state.json', state)
    ready_by = time.monotonic() + 10
    while time.monotonic() < ready_by:
        if not original(state['service']):
            raise RuntimeError('fixed-worker-exited:' + (base / 'worker.stderr').read_text()[-500:])
        try:
            with socket.create_connection(('198.18.0.2', 18761), timeout=.25):
                return child
        except OSError:
            time.sleep(.1)
    raise RuntimeError('fixed-worker-not-ready:' + (base / 'worker.stderr').read_text()[-500:])

def prepare(base, request):
    for binary in ['python3', 'ip', 'tc', 'mount', 'umount']:
        run('sh', '-c', 'command -v ' + binary)  # Fixed allowlist, never caller text.
    if not pathlib.Path('/sys/fs/cgroup/cgroup.controllers').exists():
        raise RuntimeError('cgroup-v2-missing')
    prepare_clone_boot()
    ROOT.mkdir(mode=0o700, exist_ok=True)
    base.mkdir(mode=0o755)
    os.chmod(ROOT, 0o755)
    run_id = base.name
    suffix = run_id.replace('-', '')[:10]
    namespace, interface, peer = 'sdr-' + suffix, 'sd' + suffix, 'sp' + suffix
    # Persist partial ownership before each side effect; failures never erase this ledger.
    state = {'runId': run_id, 'boot': pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
             'namespace': namespace, 'interface': interface, 'peer': peer, 'prepared': False, 'fault': None,
             'parameters': None, 'pressure': None, 'service': None, 'deadline': None, 'sampleDigest': request['sampleDigest']}
    atomic(base / 'state.json', state)
    run('ip', 'netns', 'add', namespace)
    state['namespaceInode'] = os.stat('/var/run/netns/' + namespace).st_ino
    atomic(base / 'state.json', state)
    run('ip', 'link', 'add', interface, 'type', 'veth', 'peer', 'name', peer)
    run('ip', 'link', 'set', peer, 'netns', namespace)
    run('ip', 'addr', 'add', '198.18.0.1/30', 'dev', interface)
    run('ip', 'link', 'set', interface, 'up')
    run('ip', '-n', namespace, 'addr', 'add', '198.18.0.2/30', 'dev', peer)
    run('ip', '-n', namespace, 'link', 'set', peer, 'up')
    run('ip', '-n', namespace, 'link', 'set', 'lo', 'up')
    if json.loads(run('ip', '-n', namespace, '-j', 'route', 'show', 'default')):
        raise RuntimeError('test-namespace-has-default-route')
    (base / 'volume').mkdir()
    run('mount', '-t', 'tmpfs', '-o', 'size=128m,nosuid,nodev,noexec,mode=0770', 'sakura-drill-' + suffix, str(base / 'volume'))
    state['volumeDevice'] = os.stat(base / 'volume').st_dev
    if state['volumeDevice'] == os.stat(base).st_dev:
        raise RuntimeError('dedicated-volume-missing')
    stats = os.statvfs(base / 'volume')
    if stats.f_blocks * stats.f_frsize > 128 * 1024 * 1024:
        raise RuntimeError('volume-hard-cap-missing')
    os.chown(base / 'volume', 65534, 65534)
    (base / 'data').mkdir(mode=0o700)
    os.chown(base / 'data', 65534, 65534)
    (base / 'data' / 'acks').mkdir(mode=0o700)
    os.chown(base / 'data' / 'acks', 65534, 65534)
    values = [{'id': 'item-%04d' % i, 'value': digest(('sakura-drill:%d' % i).encode())} for i in range(request['count'])]
    content = json.dumps(values, separators=(',', ':')).encode()
    if digest(content) != request['sampleDigest']:
        raise RuntimeError('synthetic-sample-digest-mismatch')
    if request.get('restoreFrom'):
        source = paths(request['restoreFrom']['runId']) / 'data'
        expected = request['restoreFrom']['confirmedIds']
        if not expected or len(set(expected)) != len(expected) or source.is_symlink() or (source / 'acks').is_symlink():
            raise RuntimeError('checkpoint-confirmed-set-invalid')
        source_samples = source / 'samples.json'
        if source_samples.is_symlink() or digest(source_samples.read_bytes()) != request['sampleDigest']:
            raise RuntimeError('checkpoint-sample-digest-mismatch')
        recovered = sorted(p.name for p in (source / 'acks').iterdir())
        if recovered != sorted(expected):
            raise RuntimeError('checkpoint-missing-or-unknown-writes')
        for name in recovered:
            if len(name) > 100 or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in name):
                raise RuntimeError('checkpoint-unsafe-request-id')
            source_ack = source / 'acks' / name
            if source_ack.is_symlink() or source_ack.read_text() != request['sampleDigest']:
                raise RuntimeError('checkpoint-acknowledged-data-corrupt')
            shutil.copyfile(source_ack, base / 'data' / 'acks' / name)
            os.chown(base / 'data' / 'acks' / name, 65534, 65534)
        shutil.copyfile(source_samples, base / 'data' / 'samples.json')
        state['restoredRequests'] = recovered
    else:
        (base / 'data' / 'samples.json').write_bytes(content)
    os.chown(base / 'data' / 'samples.json', 65534, 65534)
    cgroup = pathlib.Path('/sys/fs/cgroup') / ('sakura-drill-' + suffix)
    state['cgroup'] = str(cgroup)
    atomic(base / 'state.json', state)
    if 'cpu' not in pathlib.Path('/sys/fs/cgroup/cgroup.controllers').read_text().split():
        raise RuntimeError('cpu-controller-missing')
    pathlib.Path('/sys/fs/cgroup/cgroup.subtree_control').write_text('+cpu +pids')
    cgroup.mkdir()
    (cgroup / 'cpu.max').write_text('50000 100000')
    (cgroup / 'pids.max').write_text('1')
    if (cgroup / 'cpu.max').read_text().strip() != '50000 100000' or (cgroup / 'pids.max').read_text().strip() != '1':
        raise RuntimeError('cpu-hard-cap-missing')
    state['prepared'] = True
    launch_service(base, state)
    return {'ready': True, 'bootId': state['boot'], 'sampleDigest': request['sampleDigest']}

def observe(base, state):
    assert_owner(base, state)
    kind = state['fault']
    if not kind:
        return {'effect': 'absent', 'detail': 'no-owned-fault'}
    if kind == 'network':
        queues = json.loads(run('tc', '-j', 'qdisc', 'show', 'dev', state['interface']))
        matches = [q for q in queues if q.get('handle') == '7a10:' and q.get('kind') == 'netem']
        if not matches:
            return {'effect': 'unknown', 'detail': 'owned-qdisc-drifted'}
        return {'effect': 'observed', 'detail': json.dumps(matches)[:4000]}
    if kind == 'process':
        return {'effect': 'absent' if original(state['service']) else 'observed', 'detail': 'original-worker-identity-checked'}
    if kind == 'cpu':
        group = pathlib.Path(state['cgroup'])
        observed = state['pressure'] and original(state['pressure']) and str(state['pressure']['pid']) in (group / 'cgroup.procs').read_text().split()
        return {'effect': 'observed' if observed else 'unknown', 'detail': (group / 'cpu.max').read_text().strip() + ';' + (group / 'cpu.stat').read_text()}
    if kind == 'volume':
        stats = os.statvfs(base / 'volume')
        return {'effect': 'observed' if stats.f_bavail == 0 else 'unknown', 'detail': 'available-bytes=%d' % (stats.f_bavail * stats.f_frsize)}
    return {'effect': 'unknown', 'detail': 'checkpoint-requires-original-owner-handoff'}

def withdraw(base, state):
    assert_owner(base, state)
    kind = state['fault']
    if kind == 'network':
        if observe(base, state)['effect'] != 'observed':
            raise RuntimeError('qdisc-identity-drift-no-broad-clear')
        run('tc', 'qdisc', 'del', 'dev', state['interface'], 'root', 'handle', '7a10:')
        if any(q.get('handle') == '7a10:' for q in json.loads(run('tc', '-j', 'qdisc', 'show', 'dev', state['interface']))):
            raise RuntimeError('qdisc-remains')
    elif kind == 'cpu' and state['pressure']:
        stop(state['pressure'])
        if pathlib.Path(state['cgroup'], 'cgroup.procs').read_text().strip():
            raise RuntimeError('pressure-cgroup-not-empty')
    elif kind == 'volume':
        filler = base / 'volume' / 'owned-reserve.bin'
        if filler.is_symlink() or os.stat(filler).st_ino != state['fillerInode']:
            raise RuntimeError('reserve-file-identity-stale')
        filler.unlink()
        if os.statvfs(base / 'volume').f_bavail == 0:
            raise RuntimeError('volume-space-not-restored')
    # Stopping a worker is not permission to restart it. Recovery has a separate ticket.
    state['fault'] = None
    atomic(base / 'state.json', state)
    return {'effect': 'absent', 'detail': 'original-fault-withdrawn;business-not-restarted'}

def guardian(base, deadline):
    seconds = datetime.datetime.fromisoformat(deadline.replace('Z', '+00:00')).timestamp() - time.time()
    monotonic_end = time.monotonic() + max(0, seconds)
    atomic(base / 'guardian.json', {'ready': True, 'process': process_identity(os.getpid()), 'deadline': deadline})
    while time.monotonic() < monotonic_end and time.time() < datetime.datetime.fromisoformat(deadline.replace('Z', '+00:00')).timestamp():
        if (base / 'withdrawn.json').exists():
            return
        time.sleep(.025)
    try:
        state = load(base / 'state.json')
        result = withdraw(base, state)
        atomic(base / 'guardian-result.json', {'at': now(), **result})
    except Exception as error:
        atomic(base / 'guardian-result.json', {'at': now(), 'effect': 'unknown', 'detail': str(error)[:500]})

def inject(base, state, parameters):
    assert_owner(base, state)
    if state['fault'] or not state['deadline'] or now() >= state['deadline']:
        raise RuntimeError('fault-lease-expired-or-used')
    guard = load(base / 'guardian.json')
    if not original(guard['process']) or guard['deadline'] != state['deadline']:
        raise RuntimeError('guest-guardian-lost')
    kind = parameters['fault']
    state['fault'] = kind
    atomic(base / 'state.json', state)  # Intent precedes every effect.
    if kind == 'network':
        queues = json.loads(run('tc', '-j', 'qdisc', 'show', 'dev', state['interface']))
        if any(q['kind'] != 'noqueue' for q in queues):
            raise RuntimeError('qdisc-location-not-empty')
        run('tc', 'qdisc', 'add', 'dev', state['interface'], 'root', 'handle', '7a10:', 'netem', 'delay', str(parameters['delayMs']) + 'ms', str(parameters['jitterMs']) + 'ms', 'loss', str(parameters['lossPercent']) + '%')
    elif kind == 'process':
        stop(state['service'])
    elif kind == 'cpu':
        group = pathlib.Path(state['cgroup'])
        (group / 'cpu.max').write_text('%d 100000' % (parameters['cpuPercent'] * 1000))
        def assign():
            (group / 'cgroup.procs').write_text(str(os.getpid()))
            os.setgid(65534)
            os.setuid(65534)
        child = subprocess.Popen(['python3', SCRIPT, 'pressure'], preexec_fn=assign, start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        state['pressure'] = process_identity(child.pid)
    elif kind == 'volume':
        filler = base / 'volume' / 'owned-reserve.bin'
        with open(filler, 'xb', buffering=0) as handle:
            state['fillerInode'] = os.fstat(handle.fileno()).st_ino
            atomic(base / 'state.json', state)
            try:
                for _ in range(129):
                    handle.write(bytes(1024 * 1024))
            except OSError as error:
                if error.errno != 28:
                    raise
    else:
        raise RuntimeError('checkpoint-must-use-fixtures-owned-handoff')
    atomic(base / 'state.json', state)
    return observe(base, state)

def serve(base):
    os.setgid(65534)
    os.setuid(65534)
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            try:
                request_id = self.path[1:]
                if not request_id or len(request_id) > 100 or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in request_id):
                    raise ValueError('invalid-request')
                samples = (base / 'data' / 'samples.json').read_bytes()
                # Unique acknowledgements expose missing/duplicate writes after recovery.
                path = base / 'volume' / request_id
                with open(path, 'xb') as handle:
                    handle.write(digest(samples).encode())
                    handle.flush()
                    os.fsync(handle.fileno())
                if path.read_text() != digest(samples):
                    raise ValueError('readback-mismatch')
                # 响应前先持久化确认记录，恢复必须逐项读回这些已确认写入。
                # Persist acknowledgement before responding; restoration must read every confirmed write.
                with open(base / 'data' / 'acks' / request_id, 'x') as ack:
                    ack.write(digest(samples))
                    ack.flush()
                    os.fsync(ack.fileno())
                self.send_response(200)
                self.end_headers()
                self.wfile.write(digest(samples).encode())
            except Exception:
                self.send_response(503)
                self.end_headers()
        def log_message(self, *args):
            pass
    http.server.HTTPServer(('198.18.0.2', 18761), Handler).serve_forever()

def dispatch(action, request):
    base = paths(request['runId'])
    if action == 'prepare':
        return prepare(base, request)
    state = load(base / 'state.json')
    assert_owner(base, state)
    if action == 'arm':
        if state['deadline']:
            raise RuntimeError('guardian-already-armed')
        state['deadline'] = request['faultDeadline']
        state['parameters'] = request['parameters']
        atomic(base / 'state.json', state)
        subprocess.Popen(['python3', SCRIPT, 'guardian', str(base), state['deadline']], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            if (base / 'guardian.json').exists():
                guard = load(base / 'guardian.json')
                if original(guard['process']):
                    return {'ready': True, 'bootId': state['boot'], 'deadline': state['deadline']}
            time.sleep(.02)
        raise RuntimeError('guest-guardian-not-ready')
    if action == 'inject':
        if state['parameters'] != request['parameters']:
            raise RuntimeError('fault-parameters-changed')
        return inject(base, state, request['parameters'])
    if action == 'observe':
        return observe(base, state)
    if action == 'withdraw':
        result = withdraw(base, state)
        atomic(base / 'withdrawn.json', {'at': now()})
        return result
    if action == 'restart':
        if state['fault'] or original(state['service']):
            raise RuntimeError('restart-not-admissible')
        launch_service(base, state)
        return {'effect': 'observed', 'detail': 'fixed-worker-restarted-with-new-process-identity'}
    if action == 'probe':
        start = time.monotonic()
        result = {'requestId': request['requestId'], 'at': now(), 'elapsedMs': 0, 'ok': False, 'valueDigest': None, 'error': ''}
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open('http://198.18.0.2:18761/' + request['requestId'], timeout=3) as response:
                data = response.read(65537)
            if len(data) > 65536 or data.decode() != state['sampleDigest']:
                raise ValueError('business-assertion-failed')
            result.update(ok=True, valueDigest=data.decode())
        except Exception as error:
            result['error'] = (type(error).__name__ + ':' + str(error))[:256]
        result['elapsedMs'] = (time.monotonic() - start) * 1000
        return result
    if action == 'cleanup':
        withdraw(base, state)
        stop(state['service'])
        run('umount', str(base / 'volume'))
        run('ip', 'netns', 'del', state['namespace'])
        # Delete only this exact empty cgroup; retained data and ownership records remain.
        pathlib.Path(state['cgroup']).rmdir()
        return {'effect': 'absent', 'detail': 'guest-owned-resources-released'}
    raise ValueError('unknown-fixed-action')

if __name__ == '__main__':
    if sys.argv[1] == 'serve':
        serve(pathlib.Path(sys.argv[2]))
    elif sys.argv[1] == 'pressure':
        while True:
            hashlib.sha256(b'sakura-drill-fixed-pressure' * 1024).digest()
    elif sys.argv[1] == 'guardian':
        guardian(pathlib.Path(sys.argv[2]), sys.argv[3])
    else:
        print(json.dumps(dispatch(sys.argv[1], json.load(sys.stdin))))
