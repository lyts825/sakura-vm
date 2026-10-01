#!/usr/bin/python3
"""Signal fixture for an owned disposable guest; never a production asset."""
import base64
import importlib.util
import json
import os
import re
import signal
import stat
import subprocess
import sys
import time

build, project, signum = sys.argv[1], sys.argv[2], int(sys.argv[3])
assert os.getuid() == 0 and re.fullmatch('[a-f0-9]{64}', build) and re.fullmatch('[a-f0-9]{16}', project)
assert signum in (signal.SIGTERM, signal.SIGKILL)
folder = '/usr/local/lib/sakura-project-identity/' + build
root = '/srv/sakura-identity-fixture'
target = root + '/interrupted-' + project
marker = root + '/tool-' + project + '.pid'
shim = '/usr/sbin/openssl'
assert not os.path.lexists(shim), 'fixture refuses to replace any existing tool'
os.mkdir(target, 0o700)
descriptor = os.open(shim, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o755)
with os.fdopen(descriptor, 'w') as stream:
    stream.write('#!/bin/sh\nprintf "%s\\n" "$$" > ' + marker + '\nexec /bin/sleep 300\n')
    stream.flush()
    os.fsync(stream.fileno())
shim_inode = os.lstat(shim).st_ino
request = {'action': 'ensure', 'projectId': project, 'directory': target, 'networkIsolation': 'host'}
environment = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/', 'LANG': 'C', 'LC_ALL': 'C'}
process = subprocess.Popen(['/usr/bin/python3', '-I', '-S', folder + '/controller.py',
                            base64.b64encode(json.dumps(request).encode()).decode()],
                           env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
controller_fd = os.pidfd_open(process.pid)
tool_fd = None
try:
    deadline = time.monotonic() + 10
    while not os.path.exists(marker):
        assert process.poll() is None, 'controller exited before the interrupted allocation'
        assert time.monotonic() < deadline
        time.sleep(.02)
    tool_pid = int(open(marker).read().strip())
    tool_fd = os.pidfd_open(tool_pid)
    fields = open('/proc/' + str(tool_pid) + '/stat').read().rsplit(') ', 1)[1].split()
    assert int(fields[1]) == process.pid
    actual = os.stat('/proc/' + str(tool_pid) + '/exe')
    expected = os.stat('/bin/sleep')
    assert (actual.st_dev, actual.st_ino) == (expected.st_dev, expected.st_ino)
    spec = importlib.util.spec_from_file_location('owned_identity', folder + '/controller.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    pending = module.binding_read(project)
    assert pending['phase'] == 'intent' and pending['homeInode'] == '0'
    assert not os.path.exists(module.BASE + '/uids/' + str(pending['uid']) + '.bin')
    signal.pidfd_send_signal(controller_fd, signum)
    process.wait(timeout=5)
    try:
        signal.pidfd_send_signal(tool_fd, 0)
        alive = True
    except ProcessLookupError:
        alive = False
    if signum == signal.SIGTERM:
        assert not alive, 'controlled TERM must stop its pending system tool'
    # SIGKILL cannot execute a cleanup handler. This owned harness reaps only
    # the tool pinned before the kill; it never scans or signals other processes.
    if alive:
        signal.pidfd_send_signal(tool_fd, signal.SIGKILL)
    after = module.binding_read(project)
    assert after['identityId'] == pending['identityId'] and after['uid'] == pending['uid'] and after['phase'] == 'intent'
    print(json.dumps({'identity': after, 'signal': signum, 'toolStoppedByController': not alive}))
finally:
    if process.poll() is None:
        signal.pidfd_send_signal(controller_fd, signal.SIGKILL)
        process.wait(timeout=5)
    os.close(controller_fd)
    if tool_fd is not None:
        try:
            signal.pidfd_send_signal(tool_fd, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.close(tool_fd)
    info = os.lstat(shim)
    assert info.st_uid == 0 and stat.S_ISREG(info.st_mode) and info.st_ino == shim_inode
    os.unlink(shim)
    os.unlink(marker)
    directory = os.open('/usr/sbin', os.O_DIRECTORY)
    os.fsync(directory)
    os.close(directory)
