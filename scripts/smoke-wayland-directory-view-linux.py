"""Actual production idmapped-view helpers in owned Linux namespaces only.

Run as Root against a source folder. No account, VM, existing project, global
mount or service is modified. The temporary fixture is created by this run.
"""
import argparse
import ctypes
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
import socket
import stat
import struct
import sys
import tempfile
import uuid
from types import SimpleNamespace


def load(folder):
    path = Path(folder).resolve(strict=True) / 'controller.py'
    spec = importlib.util.spec_from_file_location('sakura_owned_directory_view', path)
    controller = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(controller)
    return controller, hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot(paths):
    result = []
    for path in paths:
        value = path.stat()
        try:
            acl = os.getxattr(path, 'system.posix_acl_access')
        except OSError:
            acl = b''
        result.append((value.st_dev, value.st_ino, value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), acl.hex()))
    return result


def direct_children():
    return (Path('/proc/self/task') / str(os.getpid()) / 'children').read_text().split()


def application(controller, namespace, proof, path, source, user, runtime_socket, listener):
    reader, writer = os.pipe2(os.O_CLOEXEC)
    child = os.fork()
    if child == 0:
        os.close(reader)
        listener.close()
        code = 1
        try:
            mapped = controller.directory_view_enter(namespace, proof, path)
            os.close(source)
            libc = ctypes.CDLL(None, use_errno=True)
            assert libc.prctl(38, 1, 0, 0, 0) == 0
            os.setgroups([])
            os.setgid(user.pw_gid)
            os.setuid(user.pw_uid)
            os.fchdir(mapped)
            os.close(mapped)
            for descriptor in (namespace, source, mapped):
                try:
                    os.fstat(descriptor)
                except OSError as error:
                    assert error.errno == 9
                else:
                    raise AssertionError('Root namespace/source FD survived')
            assert Path(path, 'original').read_bytes() == b'original'
            Path('original').write_bytes(b'changed')
            Path(path, 'created').write_bytes(b'created')
            assert Path(path).stat().st_uid == user.pw_uid
            connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                try:
                    connection.connect(str(runtime_socket))
                except PermissionError:
                    pass
                else:
                    raise AssertionError('Unproxied compositor socket was reachable')
            finally:
                connection.close()
            if proof['route'] is not None:
                assert not Path(proof['route'], 'sibling').exists()
            status = Path('/proc/self/status').read_text()
            assert 'NoNewPrivs:\t1' in status and 'CapEff:\t0000000000000000' in status
            os.write(writer, json.dumps({'uid': os.getuid(), 'gid': os.getgid(), 'mount': os.readlink('/proc/self/ns/mnt'),
                                         'nnp': 1, 'directCompositorDenied': True, 'rootFdsClosed': True,
                                         'privateAncestorSiblingHidden': proof['route'] is not None}).encode())
            code = 0
        except BaseException as error:
            os.write(writer, json.dumps({'error': type(error).__name__ + ': ' + str(error)}).encode())
        finally:
            os.close(writer)
            os._exit(code)
    os.close(writer)
    reaped = False
    try:
        assert select.select([reader], [], [], 10)[0]
        raw = os.read(reader, 16384)
        try:
            status = controller.directory_view_wait(child, controller.time.monotonic() + 10)
        except controller.DirectoryViewError:
            reaped = True
            raise
        reaped = True
        result = json.loads(raw)
        assert status == 0, result
        return {**result, 'actualChildWait': True, 'childStatus': status}
    finally:
        os.close(reader)
        if not reaped:
            try:
                controller.directory_view_wait(child, controller.time.monotonic() + 2)
            except controller.DirectoryViewError:
                pass


def mapped_executable(controller, namespace, proof, path, user, listener, image, original, expected, mapped):
    reader, writer = os.pipe2(os.O_CLOEXEC)
    try:
        child = os.fork()
    except BaseException:
        os.close(reader); os.close(writer)
        raise
    if child == 0:
        os.close(reader)
        listener.close()
        code = 1
        try:
            directory = controller.directory_view_enter(namespace, proof, path)
            os.fchdir(directory)
            os.close(directory)
            for value in os.listdir('/proc/self/fd'):
                descriptor = int(value)
                if descriptor > 2 and descriptor not in (writer, original):
                    try: os.close(descriptor)
                    except OSError as error:
                        assert error.errno == errno.EBADF
            libc = ctypes.CDLL(None, use_errno=True)
            assert libc.prctl(38, 1, 0, 0, 0) == 0
            os.setgroups([])
            os.setresgid(user.pw_gid, user.pw_gid, user.pw_gid)
            os.setresuid(user.pw_uid, user.pw_uid, user.pw_uid)
            os.environ.clear()
            os.environ.update({'HOME': user.pw_dir, 'PATH': '/usr/bin:/bin'})
            if not mapped:
                try:
                    os.execve(original, [str(image), '-I', '-S', '-c', 'raise SystemExit(91)'], os.environ)
                except PermissionError as error:
                    assert error.errno == errno.EACCES
                    os.write(writer, json.dumps({'errno': error.errno, 'uid': os.getuid(),
                                                'originalMountFdExecutionDenied': True}).encode())
                    code = 0
                else:
                    raise AssertionError('Original-mount owner-only ELF unexpectedly executed')
            else:
                # The actual ELF checks descriptor closure after exec, then
                # reads the owner-only data through its mapped mount view.
                marker = """import errno,json,os,sys
assert os.getuid()==os.geteuid()==int(sys.argv[2])
assert os.getgid()==os.getegid()==int(sys.argv[2])
remaining=[]
for value in os.listdir('/proc/self/fd'):
    descriptor=int(value)
    if descriptor<=2: continue
    try: os.fstat(descriptor)
    except OSError as error: assert error.errno==errno.EBADF
    else: remaining.append(descriptor)
assert not remaining,remaining
with open(sys.argv[1],'rb') as stream: data=stream.read()
with open('/proc/self/status') as stream: status=stream.read()
assert 'NoNewPrivs:\\t1' in status and 'CapEff:\\t0000000000000000' in status
print(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'dataHex':data.hex(),
                 'rootFdsClosedAfterExec':True,'noNewPrivs':True,'effectiveCapabilitiesEmpty':True}))
"""
                os.dup2(writer, 1)
                os.dup2(writer, 2)
                os.close(writer)
                sys.argv = ['owned-fixed-bootstrap', str(original), expected, str(image),
                            '-I', '-S', '-c', marker, str(path / 'original'), str(user.pw_uid)]
                exec(compile(controller.APPLICATION_EXEC_SOURCE, '<production mapped ELF bootstrap>', 'exec'), {})
                raise AssertionError('Production mapped ELF bootstrap returned')
        except BaseException as error:
            message = json.dumps({'error': type(error).__name__ + ': ' + str(error)}).encode()
            try: os.write(1 if mapped else writer, message)
            except OSError: pass
        finally:
            os._exit(code)
    os.close(writer)
    reaped = False
    try:
        assert select.select([reader], [], [], 10)[0], 'Owned ELF produced no actual output'
        raw = os.read(reader, 65536)
        try:
            status = controller.directory_view_wait(child, controller.time.monotonic() + 10)
        except controller.DirectoryViewError:
            reaped = True
            raise
        reaped = True
        raw += os.read(reader, 65536)
        result = json.loads(raw)
        assert status == 0, {'status': status, 'result': result}
        assert result['uid'] == user.pw_uid
        if mapped:
            assert result['dataHex'] == b'changed'.hex() and result['rootFdsClosedAfterExec'] is True
        else:
            assert result['errno'] == errno.EACCES and result['originalMountFdExecutionDenied'] is True
        return {**result, 'actualChildWait': True, 'childStatus': status,
                'productionMappedFdBootstrapExecuted': mapped}
    finally:
        os.close(reader)
        if not reaped:
            try: controller.directory_view_wait(child, controller.time.monotonic() + 2)
            except controller.DirectoryViewError: pass


def run_case(controller, root, project, user, nested):
    home = root / ('private-home' if nested else 'open-home')
    home.mkdir(mode=0o700 if nested else 0o755)
    home.chmod(0o700 if nested else 0o755)
    os.chown(home, project, project)
    sibling = home / 'sibling'
    sibling.write_bytes(b'private sibling')
    os.chown(sibling, project, project)
    sibling.chmod(0o600)
    path = home / 'project'
    path.mkdir(mode=0o700)
    os.chown(path, project, project)
    original = path / 'original'
    original.write_bytes(b'original')
    os.chown(original, project, project)
    original.chmod(0o600)
    acl = struct.pack('<I', 2) + b''.join(struct.pack('<HHI', tag, permissions, ident) for tag, permissions, ident in
          [(1, 6, 0xffffffff), (2, 0, project + 100000), (4, 0, 0xffffffff), (16, 0, 0xffffffff), (32, 0, 0xffffffff)])
    os.setxattr(original, 'system.posix_acl_access', acl)
    image = path / 'private-program'
    executable_bytes = Path(sys.executable).resolve(strict=True).read_bytes()
    assert executable_bytes.startswith(b'\x7fELF'), 'Fixture Python must be an actual ELF'
    image.write_bytes(executable_bytes)
    os.chown(image, project, project)
    image.chmod(0o700)
    executable_sha256 = hashlib.sha256(executable_bytes).hexdigest()
    private = root / ('compositor-private-' + str(nested))
    private.mkdir(mode=0o700)
    os.chown(private, project, project)
    endpoint = private / 'wayland-owned'
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM | socket.SOCK_CLOEXEC)
    listener.bind(str(endpoint))
    listener.listen(1)
    os.chown(endpoint, project, project)
    source = os.open(path, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    before = snapshot([home, path, original, private, image])
    namespace, executable = -1, -1
    try:
        identity = {'directory': str(path), 'uid': project, 'gid': project}
        run = {'runId': str(uuid.uuid4()), 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}
        namespace, proof = controller.directory_view_create({'identity': identity, 'run': run, 'directoryFd': source}, user)
        assert bool(proof['route']) == nested, proof
        assert not os.get_inheritable(namespace)
        result = application(controller, namespace, proof, path, source, user, endpoint, listener)
        executable = os.open(image, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        rejected = mapped_executable(controller, namespace, proof, path, user, listener, image,
                                     executable, executable_sha256, False)
        executed = mapped_executable(controller, namespace, proof, path, user, listener, image,
                                     executable, executable_sha256, True)
        assert snapshot([home, path, original, private, image]) == before
        assert hashlib.sha256(image.read_bytes()).hexdigest() == executable_sha256
        assert original.read_bytes() == b'changed'
        assert (path / 'created').stat().st_uid == (path / 'created').stat().st_gid == project
        assert sibling.read_bytes() == b'private sibling'
        return {'case': 'private-ancestor-route' if nested else 'private-leaf', 'passed': True, 'proof': proof,
                'application': result, 'executable': {'sha256': executable_sha256,
                'originalMountRefusal': rejected, 'mappedMountExecution': executed},
                'originalOwnerModeAclUnchanged': True, 'createdDiskOwner': project}
    finally:
        if executable >= 0:
            os.close(executable)
        if namespace >= 0:
            os.close(namespace)
        os.close(source)
        listener.close()


def rejected_route(controller, root, project, user, protected):
    home = root / ('guard-' + protected)
    home.mkdir(mode=0o700)
    os.chown(home, project, project)
    path = home / 'project'
    path.mkdir(mode=0o700)
    os.chown(path, project, project)
    source = os.open(path, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    before, children, count = snapshot([home, path]), direct_children(), len(os.listdir('/proc/self/fd'))
    saved_runtime = controller.RUNTIME
    target_user = user
    if protected == 'home':
        target_user = SimpleNamespace(pw_uid=user.pw_uid, pw_gid=user.pw_gid, pw_dir=str(home / 'sandbox-home'))
    else:
        # An owned substitute for the production runtime path exercises the
        # identical guard without touching the actual /run/sakura-wl tree.
        controller.RUNTIME = home / 'sandbox-runtime'
    try:
        checked = {'identity': {'directory': str(path), 'uid': project, 'gid': project}, 'directoryFd': source,
                   'run': {'runId': str(uuid.uuid4()), 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}}
        try:
            namespace, _ = controller.directory_view_create(checked, target_user)
        except controller.DirectoryViewError as error:
            assert error.stage == 'route-private-account-overlap' and error.errno == 18, str(error)
        else:
            os.close(namespace)
            raise AssertionError('Overlapping private path was replaced')
        assert snapshot([home, path]) == before
        assert direct_children() == children and len(os.listdir('/proc/self/fd')) == count
        return {'case': 'protected-' + protected + '-route-refused', 'passed': True, 'errno': 18,
                'originalOwnerModeAclUnchanged': True, 'actualChildWait': True, 'rootFdCountUnchanged': True}
    finally:
        controller.RUNTIME = saved_runtime
        os.close(source)


def rejected_helper(controller, kind):
    children, count = direct_children(), len(os.listdir('/proc/self/fd'))
    def cancelled(_):
        raise RuntimeError('owned cancellation before namespace acknowledgement')
    def no_receipt():
        os._exit(23)
    def delayed_receipt():
        controller.time.sleep(60)
        return {}
    try:
        if kind == 'cancelled':
            descriptor, _ = controller.directory_view_helper(0x20000, lambda: {}, cancelled)
        elif kind == 'eof':
            descriptor, _ = controller.directory_view_helper(0x20000, no_receipt)
        elif kind == 'timeout':
            descriptor, _ = controller.directory_view_helper(0x20000, delayed_receipt)
        else:
            raise AssertionError('Unknown owned helper case')
    except RuntimeError as error:
        if kind == 'cancelled':
            assert str(error) == 'owned cancellation before namespace acknowledgement'
        elif kind == 'eof':
            assert '回执为空' in str(error)
        else:
            assert isinstance(error, controller.DirectoryViewError)
            assert error.stage == 'helper-receipt-timeout' and error.errno == 110, str(error)
    else:
        os.close(descriptor)
        raise AssertionError('Failed helper returned a namespace FD')
    assert direct_children() == children and len(os.listdir('/proc/self/fd')) == count
    return {'case': kind + '-helper', 'passed': True, 'actualChildWait': True, 'rootFdCountUnchanged': True}


def unsupported_filesystem(controller, project, user):
    # The proc directory belongs to a fresh, owned UID process, so production's
    # source-ownership guard is exercised before procfs rejects IDMAP itself.
    children, count = direct_children(), len(os.listdir('/proc/self/fd'))
    reader, writer = os.pipe2(os.O_CLOEXEC)
    release_reader, release_writer = os.pipe2(os.O_CLOEXEC)
    original_parent = os.getpid()
    try:
        child = os.fork()
    except BaseException:
        for descriptor in (reader, writer, release_reader, release_writer):
            os.close(descriptor)
        raise
    if child == 0:
        os.close(reader)
        os.close(release_writer)
        code = 1
        try:
            libc = ctypes.CDLL(None, use_errno=True)
            assert libc.prctl(1, 9, 0, 0, 0) == libc.prctl(38, 1, 0, 0, 0) == 0
            assert os.getppid() == original_parent
            os.setgroups([])
            os.setgid(project)
            os.setuid(project)
            assert libc.prctl(1, 9, 0, 0, 0) == 0 and os.getppid() == original_parent
            os.write(writer, b'1')
            os.read(release_reader, 1)
            code = 0
        finally:
            os.close(writer)
            os.close(release_reader)
            os._exit(code)
    os.close(writer)
    os.close(release_reader)
    source, reaped = -1, False
    try:
        assert select.select([reader], [], [], 5)[0] and os.read(reader, 2) == b'1'
        path = Path('/proc') / str(child)
        source = os.open(path, os.O_PATH | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW)
        before = snapshot([path])
        checked = {'identity': {'directory': str(path), 'uid': project, 'gid': project}, 'directoryFd': source,
                   'run': {'runId': str(uuid.uuid4()), 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}}
        try:
            descriptor, _ = controller.directory_view_create(checked, user)
        except controller.DirectoryViewError as error:
            assert error.stage == 'mount-idmap' and error.errno in (22, 95), str(error)
            failure = {'stage': error.stage, 'errno': error.errno}
        else:
            os.close(descriptor)
            raise AssertionError('Unsupported procfs returned a mapped view')
        assert snapshot([path]) == before
    finally:
        if source >= 0:
            os.close(source)
        os.close(reader)
        os.close(release_writer)
        try:
            status = controller.directory_view_wait(child, controller.time.monotonic() + 2)
        except controller.DirectoryViewError:
            reaped = True
            raise
        reaped = True
        assert status == 0, status
    assert reaped and direct_children() == children and len(os.listdir('/proc/self/fd')) == count
    return {'case': 'unsupported-filesystem-refused', 'passed': True, 'filesystem': 'proc', **failure,
            'actualChildWait': True, 'rootFdCountUnchanged': True, 'originalOwnerModeAclUnchanged': True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    args = parser.parse_args()
    assert os.getuid() == 0 and sys.platform == 'linux', 'Run only as Linux Root'
    controller, source_hash = load(args.source)
    smoke_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    taken = {row.pw_uid for row in pwd.getpwall()} | {row.gr_gid for row in grp.getgrall()}
    project = next(item for item in range(20001, 40000) if item not in taken)
    uid = next(item for item in range(15000, 20000) if item not in taken)
    user = SimpleNamespace(pw_uid=uid, pw_gid=uid, pw_dir='/home/owned-directory-app-' + str(uid))
    initial_namespace, initial_children = os.readlink('/proc/self/ns/mnt'), direct_children()
    initial_fds = len(os.listdir('/proc/self/fd'))
    root = Path(tempfile.mkdtemp(prefix='sakura-owned-wayland-directory-'))
    root.chmod(0o755)
    cases, error = [], None
    try:
        for nested in (False, True):
            cases.append(run_case(controller, root, project, user, nested))
        for protected in ('home', 'runtime'):
            cases.append(rejected_route(controller, root, project, user, protected))
        cases.append(unsupported_filesystem(controller, project, user))
        for helper in ('cancelled', 'eof', 'timeout'):
            cases.append(rejected_helper(controller, helper))
    except BaseException as failure:
        error = type(failure).__name__ + ': ' + str(failure)
    finally:
        assert root.is_absolute() and root.parent == Path('/tmp') and root.name.startswith('sakura-owned-wayland-directory-')
        shutil.rmtree(root)
    same_source = (hashlib.sha256((Path(args.source) / 'controller.py').read_bytes()).hexdigest() == source_hash
                   and hashlib.sha256(Path(__file__).read_bytes()).hexdigest() == smoke_hash)
    proof = {'version': 1, 'passed': error is None and same_source and len(cases) == 8,
             'controllerSha256': source_hash, 'smokeSha256': smoke_hash, 'sourceUnchanged': same_source, 'kernel': os.uname().release,
             'cases': cases, 'error': error, 'parentNamespaceUnchanged': os.readlink('/proc/self/ns/mnt') == initial_namespace,
             'allOwnedHelpersReaped': direct_children() == initial_children, 'rootFdCountUnchanged':
             len(os.listdir('/proc/self/fd')) == initial_fds, 'ownedFixtureRemoved': not root.exists()}
    proof['passed'] &= all(proof[key] for key in ('parentNamespaceUnchanged', 'allOwnedHelpersReaped', 'rootFdCountUnchanged', 'ownedFixtureRemoved'))
    print(json.dumps(proof, indent=2))
    return 0 if proof['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
