"""Manifest-bound copy of the verified Wayland directory-view functions.

The application never enters the mapper user namespace. Its mount view maps
project-owned filesystem IDs to a separate sandbox UID without changing disk
owner, mode or ACL. A production AST test requires this copy to stay identical.
"""
import array
import ctypes
import errno
import fcntl
import json
import os
from pathlib import Path
import re
import select
import signal
import socket
import stat
import time
RUNTIME = Path('/run/sakura-single-app-uid')
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
def require(condition, message):
    if not condition: raise RuntimeError(message)


class DirectoryViewError(RuntimeError):
    def __init__(self, stage, number=0):
        self.stage, self.errno = stage, number
        super().__init__("WAYLAND_DIRECTORY_VIEW_UNAVAILABLE: " + stage + " (errno " + str(number) + ")")


def directory_view_call(stage, result):
    if result < 0:
        raise DirectoryViewError(stage, ctypes.get_errno())
    return result


def directory_view_open(path):
    # Reopen in the current mount namespace, without following any component.
    # A descriptor from before unshare refers to the old mount tree and cannot
    # be used as the new open_tree(CLONE) source (EINVAL on actual Linux).
    path = Path(path)
    require(path.is_absolute() and str(path) != '/' and len(path.parts) <= 64
            and '..' not in path.parts and '.' not in path.parts, '应用目录视图路径无效')
    descriptor = os.open('/', os.O_PATH | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in path.parts[1:]:
            current = os.open(part, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = current
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def directory_view_namespace(descriptor, kind, owner):
    require(fcntl.ioctl(descriptor, 0xb703) == kind, '应用 namespace FD 类型不符')  # NS_GET_NSTYPE
    parent = fcntl.ioctl(descriptor, 0xb702 if kind == 0x10000000 else 0xb701)
    try:
        expected, actual = os.fstat(owner), os.fstat(parent)
        require((expected.st_dev, expected.st_ino) == (actual.st_dev, actual.st_ino),
                '应用 namespace 不属于原 Root user namespace')
    finally:
        os.close(parent)


def directory_view_wait(pid, deadline):
    while True:
        child, status = os.waitpid(pid, os.WNOHANG)
        if child == pid:
            return status
        if time.monotonic() >= deadline:
            # An unreaped direct child cannot have its PID reused. This exact
            # child is the only process to which a helper timeout delivers kill.
            os.kill(pid, signal.SIGKILL)
            child, status = os.waitpid(pid, 0)
            require(child == pid, '应用目录 helper 未确认实际 wait')
            raise DirectoryViewError('helper-timeout', errno.ETIMEDOUT)
        time.sleep(.01)


def directory_view_helper(kind, initialize, parent_initialize=None):
    # Only manifest-bound Python functions run in these short-lived helpers;
    # they never execute an application or import a project directory.
    parent, channel = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET | socket.SOCK_CLOEXEC)
    parent.settimeout(10)
    channel.settimeout(10)
    original_parent = os.getpid()
    try:
        child = os.fork()
    except BaseException:
        parent.close()
        channel.close()
        raise
    if child == 0:
        parent.close()
        descriptor = -1
        code = 1
        try:
            libc = ctypes.CDLL(None, use_errno=True)
            directory_view_call('helper-parent-death', libc.prctl(1, signal.SIGKILL, 0, 0, 0))
            require(os.getppid() == original_parent, '应用 helper 原父进程已退出')
            directory_view_call('unshare', libc.unshare(kind))
            result = initialize()
            descriptor = os.open('/proc/self/ns/' + ('user' if kind == 0x10000000 else 'mnt'), os.O_RDONLY | os.O_CLOEXEC)
            info = os.fstat(descriptor)
            message = json.dumps({'ok': True, 'result': result, 'device': str(info.st_dev), 'inode': str(info.st_ino)}).encode()
            require(len(message) <= 4096 and channel.sendmsg([message], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                    array.array('i', [descriptor]))]) == len(message), '应用 namespace FD 回执未完成')
            require(channel.recv(1) == b'1', '应用 namespace 接收者已关闭')
            code = 0
        except BaseException as error:
            try:
                message = json.dumps({'ok': False, 'stage': error.stage if isinstance(error, DirectoryViewError)
                                      else 'namespace-setup', 'errno': getattr(error, 'errno', 0) or 0}).encode()
                channel.send(message)
            except BaseException:
                pass
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            channel.close()
            os._exit(code)
    channel.close()
    owner = -1
    received, descriptor, reaped = [], -1, False
    try:
        owner = os.open('/proc/self/ns/user', os.O_RDONLY | os.O_CLOEXEC)
        raw, ancillary, flags, _ = parent.recvmsg(4096, socket.CMSG_SPACE(4), socket.MSG_CMSG_CLOEXEC)
        valid_ancillary = True
        for level, type_, data in ancillary:
            if level == socket.SOL_SOCKET and type_ == socket.SCM_RIGHTS and len(data) % 4 == 0:
                values = array.array('i')
                values.frombytes(data)
                received.extend(values)
            else:
                valid_ancillary = False
        require(valid_ancillary, '应用 namespace FD 回执类型不符')
        require(raw and not flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC), '应用 namespace FD 回执为空或不完整')
        message = json.loads(raw)
        if message.get('ok') is not True:
            raise DirectoryViewError(message.get('stage', 'namespace-setup'), message.get('errno', 0))
        require(set(message) == {'ok', 'result', 'device', 'inode'} and len(received) == 1,
                '应用 namespace FD 回执不符')
        descriptor = received[0]
        os.set_inheritable(descriptor, False)
        info = os.fstat(descriptor)
        require((str(info.st_dev), str(info.st_ino)) == (message['device'], message['inode']),
                '应用 namespace FD inode 不符')
        directory_view_namespace(descriptor, kind, owner)
        current = os.stat('/proc/' + str(child) + '/ns/' + ('user' if kind == 0x10000000 else 'mnt'))
        require((current.st_dev, current.st_ino) == (info.st_dev, info.st_ino), '应用 helper namespace 已改变')
        if parent_initialize is not None:
            parent_initialize(child)
        parent.sendall(b'1')
        try:
            status = directory_view_wait(child, time.monotonic() + 10)
        except DirectoryViewError:
            # directory_view_wait raises only after killing and really waiting
            # this exact helper. Do not issue a second wait for that PID.
            reaped = True
            raise
        reaped = True
        require(status == 0, '应用 namespace helper 未正常结束')
        received.clear()
        return descriptor, message['result']
    except socket.timeout:
        raise DirectoryViewError('helper-receipt-timeout', errno.ETIMEDOUT)
    finally:
        parent.close()
        if owner >= 0:
            os.close(owner)
        for item in received:
            os.close(item)
        if not reaped:
            # Closing the private socket wakes the waiting exact helper with
            # EOF; wait still observes its real exit, including setup failure.
            try:
                directory_view_wait(child, time.monotonic() + 2)
            except DirectoryViewError:
                pass


def directory_view_userns(identity, user):
    require(identity['uid'] != user.pw_uid and identity['gid'] != user.pw_gid
            and identity['uid'] >= 20000 and identity['gid'] >= 20000
            and 1000 <= user.pw_uid < 20000 and 1000 <= user.pw_gid < 20000,
            '应用目录映射需要不同的项目与 sandbox UID/GID')
    def mappings(pid):
        root = Path('/proc') / str(pid)
        for name, content in [('setgroups', 'deny'), ('uid_map', str(identity['uid']) + ' ' + str(user.pw_uid) + ' 1'),
                              ('gid_map', str(identity['gid']) + ' ' + str(user.pw_gid) + ' 1')]:
            fd = os.open(root / name, os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                raw = content.encode()
                require(os.write(fd, raw) == len(raw), '应用 UID/GID map 写入不完整')
            finally:
                os.close(fd)
            require((root / name).read_text().split() == content.split(), '应用 UID/GID map 回读不符')
    descriptor, _ = directory_view_helper(0x10000000, lambda: {}, mappings)
    return descriptor


def directory_view_ancestor(path, user):
    parents = list(reversed(Path(path).parents))
    reader, writer = os.pipe2(os.O_CLOEXEC)
    original_parent = os.getpid()
    try:
        child = os.fork()
    except BaseException:
        os.close(reader)
        os.close(writer)
        raise
    if child == 0:
        os.close(reader)
        try:
            libc = ctypes.CDLL(None, use_errno=True)
            directory_view_call('ancestor-parent-death', libc.prctl(1, signal.SIGKILL, 0, 0, 0))
            require(os.getppid() == original_parent, '应用 ancestor helper 原父进程已退出')
            directory_view_call('ancestor-nnp', libc.prctl(38, 1, 0, 0, 0))
            os.setgroups([])
            os.setgid(user.pw_gid)
            os.setuid(user.pw_uid)
            # setuid clears PDEATHSIG, so re-arm after the real UID transition.
            directory_view_call('ancestor-parent-death', libc.prctl(1, signal.SIGKILL, 0, 0, 0))
            require(os.getppid() == original_parent, '应用 ancestor helper 原父进程已退出')
            index = next((index for index, parent in enumerate(parents) if not os.access(parent, os.X_OK)), 255)
            os.write(writer, bytes([index]))
            os._exit(0)
        except BaseException:
            os._exit(1)
    os.close(writer)
    reaped = False
    try:
        require(select.select([reader], [], [], 5)[0], '应用目录 ancestor 检查未就绪')
        raw = os.read(reader, 2)
        require(len(raw) == 1 and (raw[0] == 255 or raw[0] < len(parents)), '应用目录 ancestor 检查回执无效')
        try:
            status = directory_view_wait(child, time.monotonic() + 5)
        except DirectoryViewError:
            reaped = True
            raise
        reaped = True
        require(status == 0, '应用目录 ancestor helper 未正常结束')
        return None if raw[0] == 255 else parents[raw[0]]
    finally:
        os.close(reader)
        if not reaped:
            try:
                directory_view_wait(child, time.monotonic() + 2)
            except DirectoryViewError:
                pass


def directory_view_route_guard(route, user):
    require(str(route) != '/', '应用目录 ancestor route 不能覆盖根目录')
    for protected in (Path(user.pw_dir), RUNTIME):
        if route == protected or route in protected.parents or protected in route.parents:
            raise DirectoryViewError('route-private-account-overlap', errno.EXDEV)


def directory_view_create(checked, user):
    identity = checked['identity']
    path = Path(identity['directory'])
    require(os.uname().machine in ('x86_64', 'aarch64'), '应用目录映射不支持当前架构')
    require(Path('/proc/self/uid_map').read_text().split() == ['0', '0', '4294967295'],
            '应用目录映射需要原 Root user namespace')
    original = os.fstat(checked['directoryFd'])
    require(stat.S_ISDIR(original.st_mode) and original.st_uid == identity['uid'] and original.st_gid == identity['gid'],
            '应用原项目目录需要准确 project UID/GID ownership')
    mapper = directory_view_userns(identity, user)
    def initialize():
        libc = ctypes.CDLL(None, use_errno=True)
        libc.syscall.restype = ctypes.c_long
        # Only the short-lived Root namespace creator uses this umask. Route
        # directories must remain traversable under a normal SSH umask 077.
        os.umask(0o022)
        directory_view_call('mount-private', libc.mount(None, b'/', None, ctypes.c_ulong(16384 | (1 << 18)), None))
        local = directory_view_open(path)
        tree = target = route_tree = route_target = -1
        route = None
        try:
            current = os.fstat(local)
            require((current.st_dev, current.st_ino) == (original.st_dev, original.st_ino), '应用原目录在新 namespace 中已被替换')
            tree = directory_view_call('open-tree', libc.syscall(428, ctypes.c_int(local), ctypes.c_char_p(b''),
                                         ctypes.c_uint(1 | os.O_CLOEXEC | 0x1000 | 0x8000)))
            # uid_map is filesystem/project ID -> initial-namespace sandbox ID.
            # The application never enters this user namespace itself.
            attributes = (ctypes.c_uint64 * 4)(0x100000 | 2 | 4, 0, 0, mapper)
            directory_view_call('mount-idmap', libc.syscall(442, ctypes.c_int(tree), ctypes.c_char_p(b''),
                                ctypes.c_uint(0x1000 | 0x8000), ctypes.byref(attributes), ctypes.c_size_t(32)))
            route = directory_view_ancestor(path, user)
            if route is not None:
                directory_view_route_guard(route, user)
                route_target = directory_view_open(route)
                filesystem = directory_view_call('route-fsopen', libc.syscall(430, ctypes.c_char_p(b'tmpfs'), ctypes.c_uint(1)))
                try:
                    for key, value in [(b'size', b'1048576'), (b'nr_inodes', b'128'), (b'mode', b'0755'), (b'uid', b'0'), (b'gid', b'0')]:
                        directory_view_call('route-config', libc.syscall(431, ctypes.c_int(filesystem), ctypes.c_uint(1),
                                            ctypes.c_char_p(key), ctypes.c_char_p(value), ctypes.c_int(0)))
                    directory_view_call('route-create', libc.syscall(431, ctypes.c_int(filesystem), ctypes.c_uint(6),
                                        ctypes.c_void_p(), ctypes.c_void_p(), ctypes.c_int(0)))
                    route_tree = directory_view_call('route-fsmount', libc.syscall(432, ctypes.c_int(filesystem),
                                                        ctypes.c_uint(1), ctypes.c_uint(2 | 4 | 8)))
                finally:
                    os.close(filesystem)
                info = os.fstat(route_tree)
                directory_view_call('route-move', libc.syscall(429, ctypes.c_int(route_tree), ctypes.c_char_p(b''),
                                    ctypes.c_int(route_target), ctypes.c_char_p(b''), ctypes.c_uint(0x4 | 0x40)))
                target = directory_view_open(route)
                current = os.fstat(target)
                require((info.st_dev, info.st_ino) == (current.st_dev, current.st_ino)
                        and current.st_uid == current.st_gid == 0 and stat.S_IMODE(current.st_mode) == 0o755,
                        '应用 private ancestor route 身份不符')
                for part in path.relative_to(route).parts:
                    os.mkdir(part, 0o755, dir_fd=target)
                    next_ = os.open(part, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=target)
                    os.close(target)
                    target = next_
            else:
                target = directory_view_open(path)
                current = os.fstat(target)
                require((original.st_dev, original.st_ino) == (current.st_dev, current.st_ino), '应用原目录 mount target 已改变')
            directory_view_call('move-mount', libc.syscall(429, ctypes.c_int(tree), ctypes.c_char_p(b''),
                                ctypes.c_int(target), ctypes.c_char_p(b''), ctypes.c_uint(0x4 | 0x40)))
            mapped = directory_view_open(path)
            try:
                current = os.fstat(mapped)
                require((original.st_dev, original.st_ino) == (current.st_dev, current.st_ino), '应用映射目录 inode 不符')
            finally:
                os.close(mapped)
            return {'route': str(route) if route is not None else None, 'mountFlags': int(os.fstatvfs(tree).f_flag)}
        finally:
            for descriptor in (local, tree, target, route_tree, route_target):
                if descriptor >= 0:
                    os.close(descriptor)
    namespace = -1
    try:
        namespace, result = directory_view_helper(0x20000, initialize)
        info = os.fstat(namespace)
        proof = {'version': 1, 'device': str(info.st_dev), 'inode': str(info.st_ino),
                 'directoryDevice': str(original.st_dev), 'directoryInode': str(original.st_ino),
                 'directoryMode': stat.S_IMODE(original.st_mode), 'mountFlags': result['mountFlags'],
                 'projectUid': identity['uid'], 'projectGid': identity['gid'], 'uid': user.pw_uid, 'gid': user.pw_gid,
                 'desktopRunId': checked['run']['runId'], 'bootId': checked['run']['bootId'], 'route': result['route']}
        return namespace, proof
    except BaseException:
        if namespace >= 0:
            os.close(namespace)
        raise
    finally:
        os.close(mapper)


def directory_view_member(pid, proof):
    info = (Path('/proc') / str(pid) / 'ns/mnt').stat()
    require((str(info.st_dev), str(info.st_ino)) == (proof['device'], proof['inode']),
            '应用进程已离开原目录 namespace')


def directory_view_enter(descriptor, proof, path):
    try:
        info = os.fstat(descriptor)
        require((str(info.st_dev), str(info.st_ino)) == (proof['device'], proof['inode']), '应用原目录 namespace FD 不符')
        libc = ctypes.CDLL(None, use_errno=True)
        directory_view_call('setns', libc.setns(descriptor, 0x20000))
    finally:
        os.close(descriptor)
    directory_view_member(os.getpid(), proof)
    mapped = directory_view_open(path)
    try:
        info = os.fstat(mapped)
        require((str(info.st_dev), str(info.st_ino)) == (proof['directoryDevice'], proof['directoryInode']),
                '应用原映射目录在启动前已改变')
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == proof['uid'] and info.st_gid == proof['gid']
                and stat.S_IMODE(info.st_mode) == proof['directoryMode'], '应用映射目录 UID/GID 或模式不符')
        flags = int(os.fstatvfs(mapped).f_flag)
        require(flags == proof['mountFlags'] and flags & 6 == 6, '应用映射目录 mount flags 不符')
        return mapped
    except BaseException:
        os.close(mapped)
        raise


def directory_view_proof(value):
    proof = value.get('directoryView')
    if proof is None:
        # Older stopped receipts and a new launch before namespace publication
        # have no live view. Their exact cgroup receipts still permit cleanup.
        return None
    identity = value['desktop']['identity']
    require(isinstance(proof, dict) and set(proof) == {'version', 'device', 'inode', 'directoryDevice',
            'directoryInode', 'directoryMode', 'mountFlags', 'projectUid', 'projectGid', 'uid', 'gid', 'desktopRunId', 'bootId', 'route'} and type(proof['version']) is int
            and proof['version'] == 1 and all(isinstance(proof[key], str) and re.fullmatch(r'[0-9]+', proof[key])
            for key in ('device', 'inode', 'directoryDevice', 'directoryInode'))
            and int(proof['inode']) > 0 and int(proof['directoryInode']) > 0
            and type(proof['directoryMode']) is int and 0 <= proof['directoryMode'] <= 0o7777
            and type(proof['mountFlags']) is int and 0 <= proof['mountFlags'] < 2**32 and proof['mountFlags'] & 6 == 6
            and (proof['directoryDevice'], proof['directoryInode']) == (identity['directoryDevice'], identity['directoryInode'])
            and proof['projectUid'] == identity['uid'] and proof['projectGid'] == identity['gid']
            and proof['uid'] == value['uid'] and proof['gid'] == value['gid']
            and isinstance(proof['desktopRunId'], str) and UUID.fullmatch(proof['desktopRunId'])
            and proof['desktopRunId'] == value['desktop']['run']['runId']
            and isinstance(proof['bootId'], str) and UUID.fullmatch(proof['bootId'])
            and proof['bootId'] == value['bootId'] == value['desktop']['run']['bootId']
            and value['directory'] == identity['directory']
            and (proof['route'] is None or isinstance(proof['route'], str) and proof['route'] != '/'
                 and Path(proof['route']) in Path(value['directory']).parents), '应用原目录视图完整票据不符')
    return proof
