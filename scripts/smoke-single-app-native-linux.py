"""Exercise fixed SingleApp launch primitives in new owned Linux namespaces.

No VM, account, service, shared mount, project or original image is modified.
This supplements, and does not replace, public Xvnc/RFB integration tests.
"""
import argparse
import errno
import grp
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import select
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import uuid


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def footprint():
    return {'mount': os.readlink('/proc/self/ns/mnt'), 'network': os.readlink('/proc/self/ns/net'),
            'cgroup': Path('/proc/self/cgroup').read_text(), 'children': Path('/proc/self/task/' + str(os.getpid()) + '/children').read_text(),
            'fds': len(os.listdir('/proc/self/fd'))}


def metadata(path):
    value = path.stat()
    try: acl = os.getxattr(path, 'system.posix_acl_access').hex()
    except OSError as error:
        if error.errno not in (errno.ENODATA, errno.ENOTSUP): raise
        acl = ''
    return [value.st_dev, value.st_ino, value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), acl]


def run_child(view, operation):
    reader, writer = os.pipe2(os.O_CLOEXEC)
    child = os.fork()
    if child == 0:
        os.close(reader)
        os.dup2(writer, 1)
        os.close(writer)
        try:
            operation()
        except BaseException as error:
            print(json.dumps({'error': type(error).__name__, 'detail': str(error)}), flush=True)
            os._exit(1)
        os._exit(0)
    os.close(writer)
    reaped = False
    try:
        assert select.select([reader], [], [], 10)[0], 'owned application did not reply'
        chunks = bytearray()
        deadline = time.monotonic() + 10
        while select.select([reader], [], [], max(0, deadline - time.monotonic()))[0]:
            block = os.read(reader, 4096)
            if not block: break
            chunks.extend(block)
            assert len(chunks) <= 16384
        else:
            raise AssertionError('owned application output did not close')
        try: status = view.directory_view_wait(child, deadline)
        except view.DirectoryViewError:
            reaped = True
            raise
        reaped = True
        reply = json.loads(chunks)
        assert status == 0, reply
        return {**reply, 'actualChildWait': True, 'childStatus': status}
    finally:
        os.close(reader)
        if not reaped:
            try: view.directory_view_wait(child, time.monotonic() + 2)
            except view.DirectoryViewError: pass


def mapped_case(core, view, stem, project_uid, sandbox_uid, private, stale=False):
    parent = stem / ('private' if private else 'public')
    parent.mkdir(mode=0o700 if private else 0o711)
    os.chown(parent, project_uid if private else 0, project_uid if private else 0)
    (parent / 'sibling').write_text('hidden sibling')
    directory = parent / 'current'
    directory.mkdir(mode=0o700)
    os.chown(directory, project_uid, project_uid)
    original = directory / 'original'
    original.write_text('original')
    original.chmod(0o600)
    os.chown(original, project_uid, project_uid)
    executable = directory / 'python3'
    shutil.copyfile(sys.executable, executable)
    executable.chmod(0o700)
    os.chown(executable, project_uid, project_uid)
    user = SimpleNamespace(pw_uid=sandbox_uid, pw_gid=sandbox_uid, pw_dir=str(stem / 'account'))
    identity = {'uid': project_uid, 'gid': project_uid, 'directory': str(directory)}
    run = {'runId': str(uuid.uuid4()), 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
    before = [metadata(path) for path in (parent, directory, original, executable)]
    expected = {**core.image(executable), 'command': str(executable)}
    original_fd = os.open(executable, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        def old_mount():
            core.drop_account(user)
            try: os.execve(original_fd, [str(executable), '-V'], {})
            except OSError as error:
                assert error.errno == errno.EACCES
                print(json.dumps({'oldMountExecErrno': error.errno}), flush=True)
        baseline = run_child(view, old_mount)
    finally: os.close(original_fd)
    source = view.directory_view_open(directory)
    namespace = -1
    try:
        namespace, proof = view.directory_view_create({'identity': identity, 'run': run, 'directoryFd': source}, user)
        assert (proof['route'] is not None) == private
        if stale: expected['sha256'] = '0' * 64
        def execute():
            mapped = view.directory_view_enter(namespace, proof, directory)
            os.close(source)
            core.drop_account(user)
            os.fchdir(mapped)
            os.close(mapped)
            assert os.access(directory, os.R_OK | os.W_OK | os.X_OK)
            if stale:
                try: core.pinned_execute(expected, ['-V'], {'PATH': '/usr/bin:/bin'})
                except core.Failure as error:
                    assert error.code == 'SINGLE_APP_IMAGE_CHANGED'
                    print(json.dumps({'staleExecutableDenied': True}), flush=True)
                return
            script = """import json,os,pathlib
s=dict(line.split(':',1) for line in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in line)
assert all([int(x) for x in s[k].split()]==[os.getuid()]*4 for k in ['Uid','Gid'])
assert not s['Groups'].split() and s['NoNewPrivs'].strip()=='1'
assert all(int(s[k].strip(),16)==0 for k in ['CapInh','CapPrm','CapEff','CapAmb'])
assert pathlib.Path('original').read_text()=='original'
pathlib.Path('original').write_text('changed')
pathlib.Path('created').write_text('created')
route=json.loads(__import__('sys').argv[1])
if route is not None: assert not pathlib.Path(route,'sibling').exists()
fds=[]
for x in os.listdir('/proc/self/fd'):
 try: os.fstat(int(x))
 except OSError: continue
 if int(x)>2: fds.append(x)
assert not fds
print(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'groups':os.getgroups(),'nnp':1,'allCapabilitiesZero':True,'managementFdsClosed':True,'privateAncestorSiblingHidden':route is not None}),flush=True)
"""
            arguments = ['-I', '-S', '-c', script, json.dumps(proof['route'])]
            environment = {'PATH': '/usr/bin:/bin', 'HOME': user.pw_dir}
            child = subprocess.Popen([expected['path'], *arguments], stdin=subprocess.DEVNULL,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment,
                                     preexec_fn=lambda: core.pinned_execute(expected, arguments, environment))
            try:
                output, errors = child.communicate(timeout=5)
                assert child.returncode == 0 and not errors and len(output) <= 16384, errors.decode(errors='replace')
                assert child.stdout.closed and child.stderr.closed, 'owned application streams remained open'
                result = json.loads(output)
                print(json.dumps({**result, 'popenExecErrorPipeAcknowledged': True, 'applicationActualWait': True,
                                  'applicationStreamsClosed': child.stdout.closed and child.stderr.closed}), flush=True)
            finally:
                if child.poll() is None:
                    child.terminate()
                    try: child.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
                if not child.stdout.closed: child.stdout.close()
                if not child.stderr.closed: child.stderr.close()
        actual = run_child(view, execute)
        assert [metadata(path) for path in (parent, directory, original, executable)] == before
        if not stale:
            assert core.image(executable)['sha256'] == expected['sha256']
            assert (directory / 'created').stat().st_uid == project_uid
            assert (directory / 'created').stat().st_gid == project_uid
            assert original.read_text() == 'changed'
        return {**baseline, **actual, 'physicalOwnerModeAclInodeUnchanged': True,
                'projectUid': project_uid, 'sandboxUid': sandbox_uid, 'route': proof['route'], 'directoryView': proof}
    finally:
        if namespace >= 0: os.close(namespace)
        os.close(source)


def pipe_case(core, kind):
    reader, writer = os.pipe2(os.O_CLOEXEC)
    try:
        if kind == 'eof':
            os.close(writer); writer = -1
            assert core.private_input(reader, 1, .1) == b''
        else:
            if kind == 'oversize': os.write(writer, b'12')
            try: core.private_input(reader, 1, .05)
            except core.Failure as error:
                assert error.code == ('SINGLE_APP_REQUEST_TOO_LARGE' if kind == 'oversize' else 'SINGLE_APP_START_CANCELLED')
            else: raise AssertionError('private pipe was accepted')
        return {'privatePipe': kind, 'eofOversizeTimeoutNotAcceptedAsReady': True}
    finally:
        os.close(reader)
        if writer >= 0: os.close(writer)


def passed_fd_case(core, source, sandbox_uid):
    outcomes = []
    for reseal in (False, True):
        reader, writer = os.pipe2(os.O_CLOEXEC)
        descriptors = [os.open('/dev/null', os.O_RDWR | os.O_CLOEXEC) for _ in range(5)] + [writer]
        script = """import ctypes,importlib.util,json,os,pathlib,signal,subprocess,sys
from types import SimpleNamespace
source,fds,uid,reseal=sys.argv[1:]; fds=json.loads(fds); uid=int(uid); reseal=reseal=='1'
spec=importlib.util.spec_from_file_location('owned_single_app',pathlib.Path(source)/'controller.py')
core=importlib.util.module_from_spec(spec); spec.loader.exec_module(core)
assert all(os.get_inheritable(fd) for fd in fds)
if reseal: core.seal_descriptors(fds)
image=core.image(pathlib.Path(sys.executable).resolve())
core.drop_account(SimpleNamespace(pw_uid=uid,pw_gid=uid))
libc=ctypes.CDLL(None,use_errno=True)
parent=os.getppid()
assert libc.prctl(1,signal.SIGKILL,0,0,0)==0 and os.getppid()==parent
probe='''import json,os,pathlib,sys
fds=json.loads(sys.argv[1]); held=[]
for fd in fds:
 try: os.fstat(fd)
 except OSError: continue
 held.append(fd)
s=dict(line.split(':',1) for line in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in line)
assert s['NoNewPrivs'].strip()=='1' and not s['Groups'].split()
assert all(int(s[k].strip(),16)==0 for k in ['CapInh','CapPrm','CapEff','CapAmb'])
created=pathlib.Path('/proc/self/stat').read_text().rsplit(')',1)[1].split()[19]
print(json.dumps({'role':sys.argv[2],'pid':os.getpid(),'created':created,'managementFds':held,'nnp':1,'capabilitiesZero':True}),flush=True)
assert os.read(0,1)==b'1'
'''
def execute(args):
 parent=os.getppid()
 assert libc.prctl(1,signal.SIGKILL,0,0,0)==0 and os.getppid()==parent
 core.pinned_execute(image,args,{'PATH':'/usr/bin:/bin'})
children=[]; observations=[]
try:
 for role in ['vnc','wm','application']:
  args=['-I','-S','-c',probe,json.dumps(fds),role]
  child=subprocess.Popen([image['path'],*args],env={'PATH':'/usr/bin:/bin'},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                         preexec_fn=lambda args=args:execute(args))
  children.append(child); observations.append(json.loads(child.stdout.readline()))
 assert all(child.poll() is None for child in children)
 os.write(fds[-1],b'1'); os.close(fds[-1])
 print(json.dumps({'resealed':reseal,'children':observations,'childrenAliveBeforeEof':True}),flush=True)
 assert os.read(0,1)==b'1'
 for child in children:
  output,errors=child.communicate(b'1',timeout=5)
  assert child.returncode==0 and not output and not errors and child.stdout.closed and child.stderr.closed
finally:
 for child in children:
  if child.poll() is None:
   child.terminate()
   try: child.wait(timeout=2)
   except subprocess.TimeoutExpired: child.kill(); child.wait()
  for stream in [child.stdin,child.stdout,child.stderr]:
   if stream is not None and not stream.closed: stream.close()
 for fd in fds[:-1]: os.close(fd)
"""
        supervisor = None
        try:
            supervisor = subprocess.Popen([sys.executable, '-I', '-S', '-c', script, str(source), json.dumps(descriptors), str(sandbox_uid), str(int(reseal))],
                                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                          pass_fds=descriptors, env={'PATH': '/usr/bin:/bin'})
            os.close(writer); writer = -1
            assert select.select([supervisor.stdout], [], [], 10)[0]
            observed = json.loads(supervisor.stdout.readline())
            assert supervisor.poll() is None
            for child in observed['children']:
                assert child['managementFds'] == ([] if reseal else descriptors)
            try:
                frame = core.private_input(reader, 1, .2)
            except core.Failure as error:
                assert not reseal and error.code == 'SINGLE_APP_START_CANCELLED'
                eof_while_alive = False
            else:
                assert reseal and frame == b'1'
                eof_while_alive = True
            output, errors = supervisor.communicate(b'1', timeout=10)
            assert supervisor.returncode == 0 and not output and not errors
            assert supervisor.stdout.closed and supervisor.stderr.closed
            assert core.private_input(reader, 1, .2) == b''
            for child in observed['children']:
                try: created = Path('/proc/' + str(child['pid']) + '/stat').read_text().rsplit(')', 1)[1].split()[19]
                except FileNotFoundError: continue
                assert created != child['created'], 'exact owned application birth remained after its actual wait'
            outcomes.append({**observed, 'readyEofWhileChildrenAlive': eof_while_alive, 'readyEofAfterActualSupervisorExit': True,
                             'supervisorActualWait': True, 'allApplicationWaitsAndStreamsClosed': True, 'allExactApplicationBirthsAbsent': True})
        finally:
            if supervisor is not None:
                if supervisor.poll() is None:
                    supervisor.terminate()
                    try: supervisor.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        supervisor.kill(); supervisor.wait()
                for stream in (supervisor.stdin, supervisor.stdout, supervisor.stderr):
                    if stream is not None and not stream.closed: stream.close()
            for descriptor in descriptors[:-1]: os.close(descriptor)
            os.close(reader)
            if writer >= 0: os.close(writer)
    return {'baselineInheritanceObserved': True, 'resealedManagementFdsClosed': True,
            'scope': 'three production Popen/preexec paths with controlled ELF substitutes', 'outcomes': outcomes}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    assert os.getuid() == 0
    source = Path(args.source).resolve(strict=True)
    names = ['controller.py', 'directory-view.py', 'sources.json']
    hashes = {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in names}
    own_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    core = load(source / 'controller.py', 'sakura_owned_single_app')
    view = load(source / 'directory-view.py', 'sakura_owned_single_app_view')
    before = footprint()
    used = {row.pw_uid for row in pwd.getpwall()} | {row.gr_gid for row in grp.getgrall()}
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit(): continue
        try:
            for line in (proc / 'status').read_text().splitlines():
                if line.startswith(('Uid:', 'Gid:')): used.update(map(int, line.split()[1:]))
        except (FileNotFoundError, PermissionError, ProcessLookupError): pass
    project_uid = next(uid for uid in range(20000, 60000) if uid not in used)
    sandbox_uid = next(uid for uid in range(1000, 20000) if uid not in used)
    stem = Path(tempfile.mkdtemp(prefix='sakura-owned-single-app-'))
    stem.chmod(0o711)
    original_stem = stem.stat()
    cases, cleanup = [], False
    try:
        for name, operation in [
            ('mapped-project-0700', lambda: mapped_case(core, view, stem, project_uid, sandbox_uid, False)),
            ('mapped-private-ancestor', lambda: mapped_case(core, view, stem, project_uid, sandbox_uid, True)),
            ('changed-executable-refused', lambda: mapped_case(core, view, stem, project_uid, sandbox_uid, False, True)),
            *[(kind, lambda kind=kind: pipe_case(core, kind)) for kind in ('eof', 'oversize', 'timeout')],
            ('passed-fds-resealed', lambda: passed_fd_case(core, source, sandbox_uid)),
        ]:
            case_dir = stem / name
            case_dir.mkdir(mode=0o711)
            if name.startswith(('mapped-', 'changed-')):
                operation = lambda private=name == 'mapped-private-ancestor', stale=name == 'changed-executable-refused', directory=case_dir: mapped_case(core, view, directory, project_uid, sandbox_uid, private, stale)
            try: cases.append({'name': name, 'passed': True, 'result': operation()})
            except BaseException as error:
                cases.append({'name': name, 'passed': False, 'error': type(error).__name__ + ': ' + str(error),
                              'stage': getattr(error, 'stage', None), 'errno': getattr(error, 'errno', None)})
    finally:
        assert footprint() == before, 'parent namespace, children or FD ownership changed'
        current = stem.stat()
        assert (current.st_dev, current.st_ino, current.st_uid) == (original_stem.st_dev, original_stem.st_ino, 0)
        assert stem.parent == Path(tempfile.gettempdir()).resolve() and stem.name.startswith('sakura-owned-single-app-')
        shutil.rmtree(stem)
        cleanup = True
    unchanged = hashes == {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in names} and own_hash == hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    passed = len(cases) == 7 and all(case['passed'] for case in cases) and unchanged and cleanup
    proof = {'version': 1, 'scope': 'owned-linux-launch-primitives-only', 'passed': passed, 'sources': hashes,
             'smokeSha256': own_hash, 'sourceUnchanged': unchanged, 'parentFootprintUnchanged': footprint() == before,
             'ownedTemporaryDirectoryRemoved': cleanup, 'kernel': os.uname().release, 'cases': cases}
    output = Path(args.output)
    with output.open('x', encoding='utf8') as stream: json.dump(proof, stream, indent=2)
    print(json.dumps({'passed': passed, 'cases': len(cases), 'output': str(output)}))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
