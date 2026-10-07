# 烟雾验收：验证目录 IDMAP 视图的描述符封闭、映射账户和源所有权拒绝。
# Smoke acceptance for IDMAP-view FD closure, mapped accounts and source-ownership refusal.
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


# 加载明确目录的控制器并返回实际源码 SHA-256，报告与被测实现绑定。
# Load the explicit controller directory and return actual source SHA-256 to bind evidence to the tested implementation.
def load(folder):
    path = Path(folder).resolve(strict=True) / 'controller.py'
    spec = importlib.util.spec_from_file_location('sakura_owned_directory_view', path)
    controller = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(controller)
    return controller, hashlib.sha256(path.read_bytes()).hexdigest()


# 采集给定源目录/文件的设备/inode、账号、模式与 ACL，供映射前后不变比较。
# Capture supplied source device/inode/account/mode/ACL for pre/post mapping invariance.
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


# 读取夹具当前直接子进程列表，用于 helper 清理核对。
# Read the fixture’s direct-child list for helper-cleanup checks.
def direct_children():
    return (Path('/proc/self/task') / str(os.getpid()) / 'children').read_text().split()


# 在自有子进程进入映射视图、封闭管理 FD 并降权，验证项目 I/O 与私有 socket，返回有界 JSON 证据。
# Enter the mapped view in an owned child, close management FDs/drop privileges and verify project I/O/private socket through bounded JSON evidence.
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


# 分别在原树和映射树下固定执行对象，验证真实 UID 执行权限与摘要一致，父进程回收本次子进程。
# Compare original/mapped-tree executable pins and real-UID permissions/hash identity, reaping the owned child.
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


# 构建开放/私有祖先的自有项目，用真实 IDMAP helper 验证访问、运行和源身份/ACL 保持。
# Build owned projects under public/private ancestors and verify access/exec/source identity-ACL preservation through real IDMAP helpers.
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


# 构造 Home/runtime 重叠路由并要求生产 guard 拒绝，核对源元数据、子进程和 FD 不变。
# Construct Home/runtime-overlap routes and require production rejection with unchanged source metadata/children/FDs.
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


# 覆盖父取消、子 EOF 和延迟回执，要求 helper 有界清理且不遗留子进程/FD。
# Cover parent cancellation, child EOF and delayed acknowledgement, requiring bounded cleanup without child/FD leaks.
def rejected_helper(controller, kind):
    children, count = direct_children(), len(os.listdir('/proc/self/fd'))
    # 在 helper 确认前注入自有取消异常，验证父侧失败清理。
    # Inject owned cancellation before helper acknowledgement to check parent-side failure cleanup.
    def cancelled(_):
        raise RuntimeError('owned cancellation before namespace acknowledgement')
    # 直接退出且不发送 namespace 回执，驱动真实 EOF 拒绝路径。
    # Exit without namespace acknowledgement to exercise the real EOF refusal path.
    def no_receipt():
        os._exit(23)
    # 故意延迟超过 helper 期限，驱动有界超时和精确子进程回收。
    # Delay beyond the helper deadline to exercise bounded timeout/exact-child reaping.
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


# 用新建自有 UID 进程的 procfs 目录测试真实 IDMAP 不支持拒绝，先经过源账号验证。
# Use a fresh owned-UID process’s procfs directory to test real unsupported-IDMAP refusal after source-account validation.
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


# 仅在 Linux root 运行，选择不冲突自有 UID/源并执行映射与拒绝场景，清理本轮资源并输出源码绑定证据。
# Run only as Linux root with nonconflicting owned UIDs/sources, execute mapping/refusal cases and clean owned resources with source-bound evidence.
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
