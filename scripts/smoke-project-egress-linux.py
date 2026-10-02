#!/usr/bin/python3
"""Real nft/UID checks inside a caller-owned PID, mount and network namespace.

This is a Linux kernel/egress test, not proof of a VM boot or SSH/cron daemon.
It must be PID 1 under unshare --pid --net --mount --mount-proc. The caller
supplies an already verified nft binary/library overlay and retains the proof.
"""
import ast
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
import selectors
import signal
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time
import traceback
import uuid

source_path, proof_path, outer_namespace = sys.argv[1:]
assert os.getuid() == 0 and os.getpid() == 1, 'requires a new root PID namespace'
assert os.readlink('/proc/self/ns/net') != outer_namespace, 'must not use the original network namespace'
assert os.readlink('/proc/self/ns/net') == os.readlink('/proc/1/ns/net')
source = Path(source_path).read_bytes()
tree = ast.parse(source)
definitions = ast.Module(body=[node for node in tree.body if isinstance(node, (ast.Assign, ast.FunctionDef, ast.ClassDef))], type_ignores=[])
ns = dict(globals())
exec(compile(definitions, 'production-controller-egress', 'exec'), ns)
subprocess.run(['/usr/sbin/ip', 'link', 'set', 'lo', 'up'], check=True, timeout=10)
# These paths are fresh tmpfs mounts made by the owning launcher, never the
# caller's /var/lib or /run. Real production FD/permission operations remain.
assert not os.path.exists(ns['BASE']) and not os.path.exists(ns['RUNTIME'])
for path in (ns['BASE'], ns['BASE'] + '/projects', ns['EGRESS'], ns['RUNTIME'], ns['RUNTIME'] + '/networks'):
    os.makedirs(path, mode=0o700, exist_ok=True)
value = dict(version=1, phase='active', registryId=str(uuid.uuid4()), identityId=str(uuid.uuid4()), projectId='default',
             uid=20000, gid=20000, revision=1, home='/home/owned-egress-fixture', directory='/workspace/owned-egress-fixture',
             homeDevice='1', homeInode='10', directoryDevice='1', directoryInode='11', networkIsolation='private')
value['account'] = 'skp' + value['identityId'].replace('-', '')[:24]
value['home'] = ns['HOMES'] + '/' + value['identityId']
# Binding bytes and owner files use the actual production formats. No Linux
# account is created: test clients explicitly drop to the reserved numeric UID.
ns['binding_write'](value)
processes, checks = [], []
namespace = 'egress-' + uuid.uuid4().hex[:16]
namespace_added = False
proof = dict(version=1, kind='linux-kernel-egress-only', sourceSha256=hashlib.sha256(source).hexdigest(),
             kernel=os.uname().release, namespace=os.readlink('/proc/self/ns/net'), outerNamespace=outer_namespace,
             nftVersion=subprocess.check_output(['/usr/sbin/nft', '--version'], text=True).strip(),
             checks=checks, passed=False, cleanupErrors=[])

server_code = '''import selectors,socket,sys
sel=selectors.DefaultSelector(); ports=[]
for family,address in [(socket.AF_INET,'127.0.0.1'),(socket.AF_INET6,'::1')]:
 s=socket.socket(family); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
 if family==socket.AF_INET6:s.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1)
 port=int(sys.argv[1]) or (ports[0] if ports else 0)
 s.bind((address,port)); s.listen(16); s.setblocking(False);sel.register(s,selectors.EVENT_READ);ports.append(s.getsockname()[1])
print(ports,flush=True)
while True:
 for key,_ in sel.select(1):
  c,_=key.fileobj.accept();c.settimeout(1)
  try:c.sendall(c.recv(4))
  except OSError:pass
  finally:c.close()
'''
client_code = '''import socket,sys
family=socket.AF_INET if sys.argv[1]=='4' else socket.AF_INET6
s=socket.socket(family);s.settimeout(.7)
try:
 s.connect(('127.0.0.1' if family==socket.AF_INET else '::1',int(sys.argv[2])));s.sendall(b'PING')
 assert s.recv(4)==b'PING';print('connected')
except OSError:print('blocked')
finally:s.close()
'''


def enter_network(fd):
    library = ctypes.CDLL(None, use_errno=True)
    if library.setns(fd, 0x40000000) != 0: raise OSError(ctypes.get_errno(), 'owned network')


def client(uid, family, port, network=None):
    descriptor = os.open('/run/netns/' + network, os.O_RDONLY | os.O_CLOEXEC) if network else None
    try:
        def drop():
            if descriptor is not None: enter_network(descriptor)
            os.setgroups([]);os.setresgid(uid, uid, uid);os.setresuid(uid, uid, uid)
        result = subprocess.run(['/usr/bin/python3', '-I', '-S', '-c', client_code, str(family), str(port)],
                                env=ns['CLEAN_ENV'], capture_output=True, text=True, timeout=5,
                                preexec_fn=drop, pass_fds=() if descriptor is None else (descriptor,))
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()
    finally:
        if descriptor is not None: os.close(descriptor)


def server(port=0, network=None):
    descriptor = os.open('/run/netns/' + network, os.O_RDONLY | os.O_CLOEXEC) if network else None
    try:
        process = subprocess.Popen(['/usr/bin/python3', '-I', '-S', '-u', '-c', server_code, str(port)],
                                   env=ns['CLEAN_ENV'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                   preexec_fn=None if descriptor is None else lambda: enter_network(descriptor),
                                   pass_fds=() if descriptor is None else (descriptor,))
        processes.append(process)
        ready, _, _ = __import__('select').select([process.stdout], [], [], 5)
        assert ready, 'owned listener startup timed out'
        line = process.stdout.readline()
        assert line, process.stderr.read()
        return json.loads(line)[0]
    finally:
        if descriptor is not None: os.close(descriptor)


try:
    port = server()
    for family in (4, 6): assert client(20000, family, port) == 'connected'
    checks.append('unmanaged_uid_baseline_ipv4_ipv6')
    ns['egress_prepare'](value);ns['egress_commit'](value);ns['egress_check'](value)
    proof['owner'] = ns['egress_read'](value)
    for family in (4, 6):
        assert client(20000, family, port) == 'blocked', 'private UID escaped through shared network'
        assert client(20001, family, port) == 'connected', 'neighbor UID was affected'
        assert client(0, family, port) == 'connected', 'root management listener was affected'
    checks += ['unmanaged_uid_blocked_ipv4_ipv6', 'neighbor_uid_and_root_preserved_ipv4_ipv6']
    subprocess.run(['/usr/sbin/ip', 'netns', 'add', namespace], check=True, timeout=10)
    namespace_added = True
    subprocess.run(['/usr/sbin/ip', '-n', namespace, 'link', 'set', 'lo', 'up'], check=True, timeout=10)
    private_port = server(network=namespace)
    for family in (4, 6): assert client(20000, family, private_port, namespace) == 'connected'
    # Validate production lookup while the controller itself is in the private
    # space: nft still inspects PID 1's original shared network using setns.
    private_ns = os.open('/run/netns/' + namespace, os.O_RDONLY | os.O_CLOEXEC)
    try:
        worker = os.fork()
        if worker == 0:
            try:
                enter_network(private_ns)
                ns['egress_check'](value)
                os._exit(0)
            except BaseException:
                traceback.print_exc()
                os._exit(1)
        _pid, status = os.waitpid(worker, 0)
        assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0
    finally:
        os.close(private_ns)
    checks += ['private_namespace_loopback_preserved_ipv4_ipv6', 'controller_in_private_namespace_checks_shared_policy']
    # A changed handle must refuse without deleting the new table.
    owner_path = ns['egress_path'](value)
    original = Path(owner_path).read_bytes()
    changed = ns['egress_read'](value);changed['handle'] += 1000
    ns['json_write'](owner_path, changed)
    try: ns['egress_check'](value)
    except ns['Refusal'] as error: assert error.code == 'EGRESS_TABLE_CHANGED'
    else: raise AssertionError('changed handle was accepted')
    assert ns['egress_table'](value) == proof['owner']['handle']
    ns['atomic'](owner_path, original)
    checks.append('changed_owner_handle_preserves_live_table')
    shared = dict(value, networkIsolation='host', revision=2)
    ns['egress_prepare'](shared, transition=True)
    assert client(20000, 4, port) == 'blocked', 'binding not committed yet'
    ns['binding_write'](shared);ns['egress_commit'](shared)
    for family in (4, 6): assert client(20000, family, port) == 'connected'
    assert ns['egress_table'](shared) is None
    checks.append('host_binding_commit_releases_only_exact_uid_table')
    value = dict(shared, networkIsolation='private', revision=3)
    ns['egress_prepare'](value, transition=True);ns['binding_write'](value);ns['egress_commit'](value)
    for family in (4, 6): assert client(20000, family, port) == 'blocked'
    checks.append('private_mode_reapplies_ipv4_ipv6')
    shared = dict(value, networkIsolation='host', revision=4)
    ns['egress_prepare'](shared, transition=True);ns['binding_write'](shared);ns['egress_commit'](shared)
    proof['finalOwner'] = ns['egress_read'](shared)
    proof['finalTables'] = json.loads(ns['egress_nft'](['list', 'tables']))
    assert not [item for item in proof['finalTables']['nftables'] if 'table' in item]
    proof['passed'] = True
except BaseException as error:
    proof['error'] = repr(error)
    proof['traceback'] = traceback.format_exc()
    raise
finally:
    for process in reversed(processes):
        try:
            process.terminate();process.communicate(timeout=5)
            assert process.poll() is not None
        except BaseException as error: proof['cleanupErrors'].append(repr(error))
    if namespace_added:
        try: subprocess.run(['/usr/sbin/ip', 'netns', 'delete', namespace], check=True, timeout=10)
        except BaseException as error: proof['cleanupErrors'].append(repr(error))
    proof['passed'] = proof['passed'] and not proof['cleanupErrors']
    Path(proof_path).write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({'passed': proof['passed'], 'checks': checks, 'proof': proof_path}), flush=True)
    if not proof['passed']: sys.exit(1)
