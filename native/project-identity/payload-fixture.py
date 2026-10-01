#!/usr/bin/python3
"""Disposable-root guest fixture; not one of the three production assets."""
import base64
import fcntl
import json
import os
import re
import signal
import subprocess
import sys
import time

assert os.getuid() == 0
mode = sys.argv[1]
raw = sys.stdin.buffer.read(131073)
assert len(raw) <= 131072


def drop(uid, gid):
    def apply():
        os.setgroups([])
        os.setresgid(gid, gid, gid)
        os.setresuid(uid, uid, uid)
    return apply


if mode == 'self':
    uid, gid = int(sys.argv[2]), int(sys.argv[3])
    assert 20000 <= uid <= 59999 and gid == uid
    command = base64.b64decode(sys.argv[4], validate=True).decode()
    reply = subprocess.run(['/bin/sh', '-c', command], input=raw, preexec_fn=drop(uid, gid), capture_output=True, timeout=12)
    print(json.dumps({'code': reply.returncode, 'stdout': reply.stdout.decode(), 'stderr': reply.stderr.decode()}))
elif mode == 'inherit':
    name = sys.argv[2]
    assert re.fullmatch(r'sakura-task-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', name)
    command = base64.b64decode(sys.argv[3], validate=True).decode()
    pid_path = sys.argv[4]
    assert pid_path.startswith('/srv/sakura-identity-fixture/alpha/')
    path = '/sys/fs/cgroup/' + name
    os.mkdir(path)
    # Deliberately carry the root anchor's authority through the same shell and
    # controller chain as production. The C entry must close all three before
    # dropping IDs; subprocess's normal close_fds would not test that boundary.
    inherited_paths = [path + '/cgroup.kill', '/var/lib/sakura/project-identities/lock', __file__]
    inherited = [os.open(inherited_paths[0], os.O_WRONLY | os.O_CLOEXEC)]
    inherited.extend(os.open(p, os.O_RDONLY | os.O_CLOEXEC) for p in inherited_paths[1:])
    def enter():
        with open(path + '/cgroup.procs', 'w') as stream:
            stream.write(str(os.getpid()))
    try:
        reply = subprocess.run(['/bin/sh', '-c', command], input=raw, preexec_fn=enter,
                               pass_fds=tuple(inherited), capture_output=True, timeout=12)
    finally:
        for descriptor in inherited:
            os.close(descriptor)
    assert reply.returncode == 0, reply.stderr.decode()
    for _ in range(100):
        try:
            pid = int(open(pid_path).read())
            break
        except (OSError, ValueError):
            time.sleep(.02)
    links = [os.readlink('/proc/' + str(pid) + '/fd/' + entry) for entry in os.listdir('/proc/' + str(pid) + '/fd')]
    print(json.dumps({'pid': pid, 'cgroup': open('/proc/' + str(pid) + '/cgroup').read().strip(),
                      'inheritedAuthorityDescriptors': len(inherited_paths),
                      'authorityDescriptorLeaked': any(p in links for p in inherited_paths)}))
elif mode == 'inspect':
    uid, gid, pid = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    assert 20000 <= uid <= 59999 and gid == uid and pid > 1
    markers = json.loads(raw)
    assert isinstance(markers, list) and 1 <= len(markers) <= 4 and all(isinstance(v, str) and len(v) < 200 for v in markers)
    markers = [v.encode() for v in markers]
    os.setgroups([])
    os.setresgid(gid, gid, gid)
    os.setresuid(uid, uid, uid)
    result = {'argvContainsBody': False, 'environmentReadable': False, 'environmentContainsBody': False,
              'descriptorReadable': False, 'descriptorContainsBody': False, 'seals': None, 'fdMode': None, 'fdUid': None}
    data = open('/proc/' + str(pid) + '/cmdline', 'rb').read(131073)
    result['argvContainsBody'] = any(v in data for v in markers)
    try:
        data = open('/proc/' + str(pid) + '/environ', 'rb').read(131073)
        result['environmentReadable'] = True
        result['environmentContainsBody'] = any(v in data for v in markers)
    except PermissionError:
        pass
    try:
        descriptor = os.open('/proc/' + str(pid) + '/fd/3', os.O_RDONLY)
        try:
            info = os.fstat(descriptor)
            data = os.read(descriptor, 131073)
            result.update(descriptorReadable=True, descriptorContainsBody=any(v in data for v in markers),
                          seals=fcntl.fcntl(descriptor, fcntl.F_GET_SEALS), fdMode=info.st_mode & 0o777, fdUid=info.st_uid)
        finally:
            os.close(descriptor)
    except PermissionError:
        pass
    print(json.dumps(result))
elif mode in ('no-eof', 'extra', 'pending'):
    command = base64.b64decode(sys.argv[2], validate=True).decode()
    process = subprocess.Popen(['/bin/sh', '-c', command], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt
    for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(signum, interrupted)
    started = time.monotonic()
    try:
        if mode == 'extra':
            try:
                process.stdin.write(raw + b'x' * 131073)
                process.stdin.flush()
            except BrokenPipeError:
                pass
            try:
                process.stdin.close()
            except BrokenPipeError:
                pass
        elif mode == 'pending':
            process.stdin.write(raw[:32])
            process.stdin.flush()
            print('OWNED_PENDING', flush=True)
        else:
            process.stdin.write(raw)
            process.stdin.flush()
        process.wait(timeout=10)
        print(json.dumps({'code': process.returncode, 'stdout': process.stdout.read().decode(),
                          'stderr': process.stderr.read().decode(), 'elapsedMs': round((time.monotonic() - started) * 1000)}))
    finally:
        try:
            process.stdin.close()
        except BrokenPipeError:
            pass
        if process.poll() is None:
            process.kill()
            process.wait(timeout=3)
else:
    raise AssertionError('unknown fixture mode')
