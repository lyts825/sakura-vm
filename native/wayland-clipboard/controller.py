"""Root supervisor for explicitly launched native Wayland applications.

The protocol broker is a separate pinned process, not a preload library. A new
Unix account and private session bus keep each application's new connections
on its own broker endpoint. Accounts are deliberately never recycled.
"""
import array
import base64
import ctypes
import errno
import fcntl
import hashlib
import grp
import json
import os
from pathlib import Path
import pwd
import re
import select
import signal
import socket
import stat
import struct
import subprocess
import sys
import time
import uuid

MAGIC = 0x58434C50
BUILD = Path(__file__).resolve().parent.name
PROXY = Path(__file__).resolve().parent / "proxy.py"
BASE = Path("/var/lib/sakura/wayland-clipboard")
# Keep the longest socket path below Linux sockaddr_un.sun_path (108 bytes).
RUNTIME = Path("/run/sakura-wl")
UUID = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")
DIGEST = re.compile(r"^[a-f0-9]{64}$")
PROTECTED = re.compile(r"^(LD_|SAKURA_CLIPBOARD_|HOME$|USER$|LOGNAME$|DISPLAY$|XAUTHORITY$|DBUS_|WAYLAND_|XDG_|SESSION_MANAGER$|PATH$|QT_QPA_PLATFORM$|GDK_BACKEND$|SDL_VIDEODRIVER$)")


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def secure_directory(path, create=False, mode=0o755):
    require(path.is_absolute(), "目录不是绝对路径")
    current = Path("/")
    for part in path.parts[1:]:
        current /= part
        if create and not current.exists():
            current.mkdir(mode=mode)
        info = current.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                "受管目录的身份或权限不符")
    return path


def read_bytes(path, maximum=65536):
    descriptor = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
                and info.st_size <= maximum, "受管文件的身份或大小不符")
        result = os.read(descriptor, maximum + 1)
        require(len(result) == info.st_size, "受管文件正在变化")
        return result
    finally:
        os.close(descriptor)


def atomic(path, value, mode=0o600):
    temporary = path.parent / ("." + uuid.uuid4().hex + ".new")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        temporary.unlink(missing_ok=True)


def digest_fd(descriptor):
    os.lseek(descriptor, 0, os.SEEK_SET)
    before = os.fstat(descriptor)
    require(stat.S_ISREG(before.st_mode) and before.st_size <= 536870912, "应用文件不是普通文件")
    result = hashlib.sha256()
    while True:
        data = os.read(descriptor, 1048576)
        if not data:
            break
        result.update(data)
    after = os.fstat(descriptor)
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), "应用文件正在变化")
    return result.hexdigest()


def digest(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        return digest_fd(descriptor)
    finally:
        os.close(descriptor)


def identify(image):
    require(isinstance(image, str) and image.startswith("/") and len(image) <= 1024
            and not re.search(r"[\x00-\x1f]", image), "需要完整 Linux 应用路径")
    path = Path(image).resolve(strict=True)
    descriptor = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o6000, "不支持提权应用")
        try:
            capabilities = os.getxattr(descriptor, "security.capability")
        except OSError as error:
            if error.errno not in (errno.ENODATA, errno.ENOTSUP):
                raise
            capabilities = b""
        require(not capabilities, "不支持带文件能力的应用")
        header = os.pread(descriptor, 64, 0)
        require(len(header) == 64 and header[:6] == b"\x7fELF\x02\x01", "仅支持 64 位 Linux ELF 应用")
        kind, machine = struct.unpack_from("<HH", header, 16)
        require(kind in (2, 3) and machine == {"x86_64": 62, "aarch64": 183}.get(os.uname().machine),
                "应用架构与当前客户机不符")
        return {"image": str(path), "sha256": digest_fd(descriptor)}
    finally:
        os.close(descriptor)


def proxy_valid():
    secure_directory(PROXY.parent)
    manifest = json.loads(read_bytes(PROXY.parent / "manifest.json", 32768))
    sources = json.loads(read_bytes(PROXY.parent / "sources.json", 32768))
    expected = {"controller.py", "proxy.py", "sources.json", *(item["name"] for item in sources["files"])}
    require(manifest["version"] == sources["version"] == 1 and manifest["build"] == BUILD
            and len(manifest["files"]) == len(expected) and len(expected) <= 35
            and {item["name"] for item in manifest["files"]} == expected, "Wayland 源码清单身份不符")
    aggregate = hashlib.sha256()
    proxy_hash = None
    for item in manifest["files"]:
        require(isinstance(item["name"], str) and re.fullmatch(r"[a-z0-9][a-z0-9_.-]{0,63}", item["name"])
                and DIGEST.fullmatch(item["sha256"]), "Wayland 源码条目无效")
        data = read_bytes(PROXY.parent / item["name"], 262144)
        actual = hashlib.sha256(data).hexdigest()
        require(len(data) == item["size"] and actual == item["sha256"], "Wayland 源码摘要不符")
        aggregate.update(item["name"].encode())
        aggregate.update(data)
        if item["name"] == "proxy.py":
            proxy_hash = actual
    require(aggregate.hexdigest() == BUILD and proxy_hash is not None, "Wayland 源码构建身份不符")
    return proxy_hash


def rule_bytes(rule, build, generation, enabled=True):
    require(isinstance(rule, dict) and set(rule) == {"copy", "paste", "files", "sensitive", "maxTextBytes"}
            and all(type(rule[key]) is bool for key in ("copy", "paste", "files", "sensitive"))
            and type(rule["maxTextBytes"]) is int and 1024 <= rule["maxTextBytes"] <= 1048576
            and DIGEST.fullmatch(build), "剪贴板规则无效")
    flags = int(rule["copy"]) | (int(rule["paste"]) << 1) | (int(rule["files"]) << 2) | \
        (int(rule["sensitive"]) << 3) | (16 if enabled else 0)
    return struct.pack("<IIIIQ65s39x", MAGIC, 1, flags, rule["maxTextBytes"], generation, build.encode())


def process(pid):
    root = Path("/proc") / str(pid)
    raw = (root / "stat").read_text()
    fields = raw[raw.rfind(")") + 2:].split()
    if fields[0] == "Z":
        return None
    return {"pid": pid, "created": fields[19], "parent": int(fields[1]), "uid": root.stat().st_uid,
            "image": os.readlink(root / "exe"), "network": os.readlink(root / "ns/net")}


def cgroup_path(owner, session, broker=False):
    return Path("/sys/fs/cgroup") / (("sakura-wayland-broker-" if broker else "sakura-wayland-app-") +
                                    owner.replace("-", "") + "-" + session.replace("-", ""))


def cgroup_root():
    root = secure_directory(Path("/sys/fs/cgroup"))
    rows = [line.split() for line in Path("/proc/self/mountinfo").read_text().splitlines()]
    require(any(row[4] == str(root) and row[row.index("-") + 1] == "cgroup2" for row in rows)
            and (root / "cgroup.controllers").is_file() and os.access(root, os.W_OK),
            "需要可写的 cgroup v2 以管理应用及其子进程")


def project_network(request):
    project = request["projectId"]
    require(isinstance(project, str) and re.fullmatch(r"default|[a-f0-9]{16}", project), "项目身份无效")
    namespace = request["networkNamespace"]
    require(namespace is None or namespace == "sk-" + project, "应用网络与项目身份不符")
    if namespace is None:
        return os.readlink("/proc/self/ns/net")
    secure_directory(Path("/run/netns"))
    descriptor = os.open("/run/netns/" + namespace, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                "项目网络句柄身份或权限不符")
        libc = ctypes.CDLL(None, use_errno=True)
        libc.setns.argtypes = [ctypes.c_int, ctypes.c_int]
        require(libc.setns(descriptor, 0x40000000) == 0, "无法进入项目网络空间")
        require(os.readlink("/proc/self/ns/net") == "net:[" + str(info.st_ino) + "]", "项目网络空间身份不符")
    finally:
        os.close(descriptor)
    program = "/usr/sbin/ip" if Path("/usr/sbin/ip").exists() else "/sbin/ip"
    def ip(*args):
        result = subprocess.run([program, *args], capture_output=True, timeout=5, check=True)
        require(len(result.stdout) <= 65536, "项目网络信息过大")
        return result.stdout.decode().strip()
    links = ip("-o", "link", "show").splitlines()
    require(len(links) == 1 and re.match(r"[0-9]+: lo:", links[0]) and not ip("-o", "-4", "route", "show")
            and not ip("-o", "-6", "route", "show"), "项目网络已有额外接口或路由")
    return os.readlink("/proc/self/ns/net")


def environment(pid):
    raw = kernel_bytes(Path("/proc") / str(pid) / "environ", 1048576)
    require(len(raw) <= 1048576, "桌面环境过大")
    return dict(item.decode().split("=", 1) for item in raw.split(b"\0") if b"=" in item)


def kernel_bytes(path, maximum):
    with path.open("rb") as source:
        result = source.read(maximum + 1)
    require(len(result) <= maximum, "合成器内核状态超过限额")
    return result


def listening_inode(pid, endpoint):
    raw = kernel_bytes(Path("/proc") / str(pid) / "net/unix", 1048576)
    matches = []
    for line in raw.splitlines()[1:]:
        fields = line.split(None, 7)
        if len(fields) == 8 and fields[3:6] == [b"00010000", b"0001", b"01"] and fields[7] == os.fsencode(endpoint):
            matches.append(int(fields[6]))
    require(len(matches) == 1 and matches[0] > 0, "合成器监听 socket 身份不符")
    return matches[0]


def owns_socket(pid, inode):
    found = False
    with os.scandir(Path("/proc") / str(pid) / "fd") as files:
        for count, path in enumerate(files):
            require(count < 4096, "合成器文件描述符过多")
            try:
                if os.readlink(path.path) == "socket:[" + str(inode) + "]":
                    found = True
            except FileNotFoundError:
                pass
    return found


def compositor_actor(peer, endpoint):
    # KWin's vendor wrapper creates/listens on the socket and passes it to a
    # child. SO_PEERCRED identifies that creator, not the current backend child.
    # Pin both actors and the kernel listening socket; never follow a respawn.
    require(peer["image"] in ("/usr/bin/kwin_wayland", "/usr/bin/weston", "/usr/bin/kwin_wayland_wrapper"),
            "Wayland 合成器进程身份不符")
    inode = listening_inode(peer["pid"], endpoint)
    require(owns_socket(peer["pid"], inode), "合成器未持有已绑定的监听 socket")
    result = {"compositorImage": peer["image"], "compositorKernelInode": inode}
    if peer["image"] != "/usr/bin/kwin_wayland_wrapper":
        return result
    children = kernel_bytes(Path("/proc") / str(peer["pid"]) / "task" / str(peer["pid"]) / "children", 8192)
    require(len(children) <= 8192 and len(children.split()) <= 64, "合成器 wrapper 子进程过多")
    candidates = []
    for item in children.split():
        try:
            child = process(int(item))
            if not child or child["parent"] != peer["pid"] or child["image"] != "/usr/bin/kwin_wayland":
                continue
            require(child["uid"] == peer["uid"] and child["network"] == peer["network"], "合成器子进程身份不符")
            raw = kernel_bytes(Path("/proc") / item.decode() / "cmdline", 65536)
            require(len(raw) <= 65536, "合成器命令参数过多")
            args = raw.rstrip(b"\0").split(b"\0")
            require(args.count(b"--wayland-fd") == args.count(b"--socket") == 1, "合成器子进程未绑定继承 socket")
            descriptor = args[args.index(b"--wayland-fd") + 1]
            require(re.fullmatch(rb"[0-9]{1,6}", descriptor) and
                    args[args.index(b"--socket") + 1] == os.fsencode(endpoint.name), "合成器继承 socket 参数不符")
            fd = int(descriptor)
            require(os.readlink(Path("/proc") / item.decode() / "fd" / str(fd)) == "socket:[" + str(inode) + "]" and
                    listening_inode(child["pid"], endpoint) == inode and process(child["pid"])["created"] == child["created"],
                    "合成器子进程的监听 FD 已变化")
            candidates.append({"compositorChildPid": child["pid"], "compositorChildCreated": child["created"],
                               "compositorChildFd": fd})
        except (FileNotFoundError, ProcessLookupError):
            continue
    require(len(candidates) == 1 and process(peer["pid"])["created"] == peer["created"], "需要唯一已就绪的 KWin wrapper 子进程")
    return {**result, **candidates[0]}


# Shared verbatim by the fixed Desktop adapter and both Linux clipboard controllers.
# This file is a draft generator input, not a guest-installed authority record.

def desktop_wait(condition, reason):
    if not condition: raise RuntimeError('SAKURA_DESKTOP_NOT_READY:' + reason)

def desktop_nested_x11(source, identity, run):
    display, filename = source.get('DISPLAY', ''), source.get('XAUTHORITY', '')
    match = re.fullmatch(r':([0-9]{1,5})(?:\.0)?', display)
    require(match is not None and int(match[1]) != 1, 'Desktop 内层 XWayland display 不符')
    auth = Path(filename)
    require(auth.is_absolute() and str(auth) == str(auth.resolve(strict=True))
            and len(os.fsencode(auth)) <= 1023 and not re.search(r'[\x00-\x1f]', str(auth)),
            'Desktop 内层 XWayland 凭据路径不符')
    descriptor = os.open(auth, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == identity['uid'] and info.st_nlink == 1
                and not info.st_mode & 0o077 and 0 < info.st_size <= 8192, 'Desktop 内层 XWayland 凭据权限不符')
        raw = os.read(descriptor, 8193)
        require(len(raw) == info.st_size, 'Desktop 内层 XWayland 凭据正在变化')
        # Validate the bounded Xauthority structure without exporting its cookie.
        offset, permitted = 0, False
        while offset < len(raw):
            require(offset + 2 <= len(raw), 'Desktop 内层 XWayland 凭据格式不符')
            family = struct.unpack_from('>H', raw, offset)[0]; offset += 2
            fields = []
            for _ in range(4):
                require(offset + 2 <= len(raw), 'Desktop 内层 XWayland 凭据格式不符')
                length = struct.unpack_from('>H', raw, offset)[0]; offset += 2
                require(offset + length <= len(raw), 'Desktop 内层 XWayland 凭据格式不符')
                fields.append(raw[offset:offset+length]); offset += length
            permitted |= family in (256, 65535) and fields[1] == str(int(match[1])).encode() \
                and fields[2] == b'MIT-MAGIC-COOKIE-1' and len(fields[3]) == 16
        require(permitted, 'Desktop 内层 XWayland 缺少准确 display cookie')
        current = auth.lstat()
        require((info.st_dev, info.st_ino, info.st_uid, info.st_mode, info.st_size)
                == (current.st_dev, current.st_ino, current.st_uid, current.st_mode, current.st_size),
                'Desktop 内层 XWayland 凭据身份已变化')
    finally: os.close(descriptor)
    endpoint = Path('/tmp/.X11-unix/X' + str(int(match[1])))
    root = endpoint.parent.lstat(); before = endpoint.lstat()
    require(stat.S_ISDIR(root.st_mode) and root.st_uid == 0 and stat.S_IMODE(root.st_mode) == 0o1777
            and stat.S_ISSOCK(before.st_mode) and before.st_uid == identity['uid'], 'Desktop 内层 X11 socket 身份不符')
    peer = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM | socket.SOCK_CLOEXEC)
    try:
        peer.settimeout(2); peer.connect(str(endpoint))
        pid, uid, gid = struct.unpack('3i', peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        require(uid == identity['uid'] and gid == identity['gid'], 'Desktop 内层 X11 peer 账号不符')
        actor = desktop_process(pid, identity, run)
        require(actor['image'] in ('/usr/bin/Xwayland', '/usr/bin/kwin_wayland', '/usr/bin/kwin_wayland_wrapper'),
                'Desktop 内层 X11 peer 映像不符')
        held = set()
        for item in (Path('/proc') / str(pid) / 'fd').iterdir():
            try: held.add(os.readlink(item))
            except FileNotFoundError: pass
        rows = [line.split() for line in (Path('/proc') / str(pid) / 'net/unix').read_text().splitlines()[1:]]
        listeners = [row[6] for row in rows if len(row) == 8 and row[7] == str(endpoint)
                     and int(row[3], 16) & 0x10000 and row[4] == '0001' and row[5] == '01'
                     and 'socket:[' + row[6] + ']' in held]
        require(len(listeners) == 1 and re.fullmatch('[1-9][0-9]*', listeners[0]), 'Desktop 内层 X11 原监听归属不符')
        after = endpoint.lstat()
        require((before.st_dev, before.st_ino, before.st_uid) == (after.st_dev, after.st_ino, after.st_uid)
                and desktop_process(pid, identity, run) == actor, 'Desktop 内层 X11 原 endpoint 已变化')
        return {'display': display, 'xauthPath': str(auth), 'xauthDevice': str(info.st_dev), 'xauthInode': str(info.st_ino),
                'xauthSha256': hashlib.sha256(raw).hexdigest(), 'socketPath': str(endpoint), 'socketDevice': str(before.st_dev),
                'socketInode': str(before.st_ino), 'kernelInode': listeners[0], 'peerPid': pid,
                'peerCreated': actor['created'], 'peerImage': actor['image']}
    finally: peer.close()
def desktop_native(build):
    require(isinstance(build, str) and re.fullmatch('[a-f0-9]{64}', build), 'Desktop native build 无效')
    folder = Path('/usr/local/lib/sakura-project-identity') / build
    secure_directory(folder)
    def protected(path, maximum=262144):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o600
                    and info.st_nlink == 1 and 0 < info.st_size <= maximum, 'Desktop native source 权限不符')
            raw = os.read(fd, maximum + 1)
            require(len(raw) == info.st_size, 'Desktop native source 正在变化')
            return raw
        finally:
            os.close(fd)
    manifest = json.loads(protected(folder / 'manifest.json'))
    require(isinstance(manifest, dict) and set(manifest) == {'version', 'build', 'files'}
            and manifest['version'] == 1 and manifest['build'] == build and isinstance(manifest['files'], list)
            and len(manifest['files']) == 3, 'Desktop native manifest 不符')
    aggregate, controller = hashlib.sha256(), None
    for name, entry in zip(['protocol.h', 'launcher.c', 'controller.py'], manifest['files']):
        require(isinstance(entry, dict) and set(entry) == {'name', 'size', 'sha256'} and entry['name'] == name,
                'Desktop native manifest 不符')
        raw = protected(folder / name)
        require(len(raw) == entry['size'] and hashlib.sha256(raw).hexdigest() == entry['sha256'],
                'Desktop native source 摘要不符')
        aggregate.update(name.encode()); aggregate.update(raw)
        if name == 'controller.py': controller = raw
    require(aggregate.hexdigest() == build, 'Desktop native build 摘要不符')
    namespace = {'__file__': str(folder / 'controller.py'), '__name__': 'sakura_desktop_native'}
    # Only these root-owned, manifest-bound bytes are evaluated. No project path
    # or environment participates in Python import resolution.
    exec(compile(controller, str(folder / 'controller.py'), 'exec'), namespace)
    require(namespace['sources']() == build, 'Desktop native launcher 不符')
    return namespace

def desktop_process(pid, identity, run):
    require(type(pid) is int and pid > 1, 'Desktop PID 无效')
    root = Path('/proc') / str(pid)
    fields = (root / 'stat').read_text().rsplit(') ', 1)[1].split()
    uid = next(line.split()[1:] for line in (root / 'status').read_text().splitlines() if line.startswith('Uid:'))
    require(fields[0] not in ('Z', 'X') and len(uid) == 4 and all(int(item) == identity['uid'] for item in uid),
            'Desktop 执行 UID 不符')
    membership = (root / 'cgroup').read_text()
    require(membership == '0::/' + run['cgroupName'] + '\n', 'Desktop 进程离开原完整运行域')
    network = (root / 'ns/net').stat()
    require((str(network.st_dev), str(network.st_ino)) == (run['networkDevice'], run['networkInode']),
            'Desktop 进程网络身份不符')
    return {'pid': pid, 'created': fields[19], 'image': os.readlink(root / 'exe')}

def desktop_authority(proof):
    require(isinstance(proof, dict) and set(proof) == {'version', 'identity', 'run', 'record', 'sha256', 'runtime', 'endpoint'}
            and type(proof['version']) is int and proof['version'] == 1, '需要 Desktop 完整会话票据；旧共享账户不能接管')
    identity, run, record = proof['identity'], proof['run'], proof['record']
    require(isinstance(identity, dict) and isinstance(run, dict) and isinstance(record, dict)
            and identity.get('phase') == 'active' and run.get('phase') == 'active' and run.get('mode') == 'inherit-current'
            and record.get('phase') == 'running' and record.get('name') == 'desktop'
            and record.get('session') == 'sakura-desktop-' + identity.get('projectId', '')
            and record.get('scopeName') == 'sakura-service-' + run.get('runId', '')
            and record.get('runId') == run.get('runId') and record.get('bootId') == run.get('bootId')
            and record.get('projectId') == run.get('projectId') == identity.get('projectId')
            and record.get('inode') == run.get('cgroupInode')
            and run.get('cgroupName') == record.get('scopeName')
            and isinstance(proof['sha256'], str) and re.fullmatch('[a-f0-9]{64}', proof['sha256'])
            and proof['runtime'] == '/run/sakura-desktop-uid/' + str(identity.get('uid')) + '/' + run.get('runId', ''),
            'Desktop 项目、UID 与完整运行域不符')
    core = desktop_native(run['build'])
    lock = core['initialize_readonly']()
    directory_fd = -1
    try:
        value = core['active'](identity['projectId'], {'expected': {key: identity[key] for key in ('registryId', 'identityId', 'revision')}},
                               core['registry'](True))
        require(value == identity, 'Desktop 项目账户完整绑定已改变')
        actual = core['run_read'](run['runId'])
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        core['check_run'](value, actual, boot)
        require(actual == run, 'Desktop 原 native ticket 已改变')
        group = core['cgroup_fd'](run)
        require(group is not None, 'Desktop 原 cgroup 已结束')
        os.close(group)
        net, info, name = core['network_fd'](value, boot, True)
        os.close(net)
        require(name == run['namespace'] and core['same'](info, run, 'network'), 'Desktop 原网络票据已改变')
        folder = Path('/run/sakura-project-desktop') / identity['projectId']
        require(core['json_read'](str(folder / 'owner.json')) == record, 'Desktop 原 service receipt 已改变')
        service_lock = os.open(folder / 'lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            core['trusted'](os.fstat(service_lock), mode=0o600)
            fcntl.flock(service_lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
            require(core['json_read'](str(folder / 'owner.json')) == record, 'Desktop 原 service receipt 正在变化')
            raw = core['read'](str(folder / ('input-' + run['runId'] + '.bin')), 135168)
            header_raw, frame = raw.split(b'\n', 1)
            header = json.loads(header_raw)
            require(set(header) == {'version', 'bootId', 'runId', 'scopeName', 'inode', 'binding', 'fileDevice', 'fileInode', 'sha256', 'bytes'}
                    and header['version'] == 1 and 1 <= header['bytes'] <= 131072 and len(frame) == header['bytes']
                    and header['sha256'] == proof['sha256'] == hashlib.sha256(frame).hexdigest()
                    and all(header[key] == record[key] for key in ('bootId', 'runId', 'scopeName', 'inode', 'binding')),
                    'Desktop 原受保护正文已改变')
            pinned = os.lstat(folder / ('input-' + run['runId'] + '.bin'))
            require((str(pinned.st_dev), str(pinned.st_ino)) == (header['fileDevice'], header['fileInode']),
                    'Desktop 原正文 inode 已改变')
        finally:
            os.close(service_lock)
        directory_fd = core['directory_fd'](identity['directory'], False)
        require(core['same'](os.fstat(directory_fd), identity, 'directory'), 'Desktop 原项目目录 inode 已改变')
        require(type(record.get('panePid')) is int and record['panePid'] > 1
                and isinstance(record.get('paneStartTicks'), str) and re.fullmatch('[1-9][0-9]*', record['paneStartTicks'])
                and isinstance(record.get('sessionId'), str) and re.fullmatch(r'\$[0-9]+', record['sessionId'])
                and isinstance(record.get('paneId'), str) and re.fullmatch('%[0-9]+', record['paneId']), 'Desktop 原 pane 票据不完整')
        pane = Path('/proc') / str(record['panePid'])
        fields = (pane / 'stat').read_text().rsplit(') ', 1)[1].split()
        require(fields[0] not in ('Z', 'X') and fields[19] == record['paneStartTicks']
                and (pane / 'cgroup').read_text() == '0::/' + run['cgroupName'] + '\n', 'Desktop 原 pane PID 已退出或复用')
        tmux = subprocess.run([core['tool']('tmux'), 'list-panes', '-t', record['session'], '-F',
                               '#{session_id}\t#{pane_id}\t#{pane_pid}\t#{pane_dead}'],
                              env=core['CLEAN_ENV'], capture_output=True, timeout=5)
        require(tmux.returncode == 0 and len(tmux.stdout) <= 4096 and len(tmux.stderr) <= 4096
                and tmux.stdout.decode().splitlines() == ['\t'.join([record['sessionId'], record['paneId'], str(record['panePid']), '0'])],
                'Desktop 原 tmux session/pane 已改变')
    except BaseException:
        if directory_fd >= 0: os.close(directory_fd)
        raise
    finally:
        os.close(lock)
    try:
        runtime = Path(proof['runtime'])
        secure_directory(runtime.parent)
        info = runtime.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == identity['uid'] and info.st_gid == identity['gid']
                and stat.S_IMODE(info.st_mode) == 0o700, 'Desktop 私有运行目录已变化')
        guard = core['json_read']('/run/sakura-project-desktop-guards/' + run['runId'] + '.json')
        require(guard.get('phase') == 'active' and guard.get('identity') == identity and guard.get('runId') == run['runId']
                and guard.get('bootId') == run['bootId'] and guard.get('scopeName') == run['cgroupName']
                and guard.get('binding') == record['binding'] and guard.get('sha256') == proof['sha256']
                and guard.get('build') == run['build'] and (guard.get('runtimeDevice'), guard.get('runtimeInode')) == (str(info.st_dev), str(info.st_ino))
                and (guard.get('networkDevice'), guard.get('networkInode')) == (run['networkDevice'], run['networkInode']),
                'Desktop 固定 adapter 原 runtime/网络证明已变化')
        def credential(name, limit):
            try: fd = os.open(runtime / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            except FileNotFoundError:
                if proof['endpoint'] is None: desktop_wait(False, 'credential')
                raise
            try:
                info = os.fstat(fd)
                require(stat.S_ISREG(info.st_mode) and info.st_uid == identity['uid'] and info.st_nlink == 1
                        and not info.st_mode & 0o077 and info.st_size <= limit, 'Desktop 凭据权限或大小不符')
                raw = os.read(fd, limit + 1)
                require(len(raw) == info.st_size, 'Desktop 凭据正在变化')
                return info, raw
            finally: os.close(fd)
        auth_info, auth = credential('Xauthority', 8192)
        require(auth, 'Desktop X11 cookie 不存在')
        ready_info, _ = credential('ready', 128)
        candidates, servers = [], []
        for item in Path('/proc').iterdir():
            if not item.name.isdigit(): continue
            try:
                image = os.readlink(item / 'exe')
                if image not in ('/usr/bin/plasmashell', '/usr/bin/Xvnc', '/usr/bin/Xtigervnc'): continue
                if (item / 'cgroup').read_text() != '0::/' + run['cgroupName'] + '\n': continue
                row = desktop_process(int(item.name), identity, run)
                if image == '/usr/bin/plasmashell': candidates.append(row)
                else:
                    arguments = (item / 'cmdline').read_bytes().split(b'\0')
                    if b':1' in arguments and b'-rfbport' in arguments and arguments[arguments.index(b'-rfbport') + 1] == b'5901':
                        require(b'-auth' in arguments and arguments[arguments.index(b'-auth') + 1] == os.fsencode(runtime / 'Xauthority'),
                                'Desktop Xvnc cookie 路径不符')
                        servers.append(row)
            except (FileNotFoundError, ProcessLookupError, PermissionError): pass
        if proof['endpoint'] is None: desktop_wait(candidates and servers, 'process')
        require(len(candidates) == 1 and len(servers) == 1, '需要原完整域中唯一就绪的 Plasma/Xvnc')
        plasma, vnc = candidates[0], servers[0]
        raw = (Path('/proc') / str(plasma['pid']) / 'environ').read_bytes()
        require(len(raw) <= 1048576, 'Desktop 环境过大')
        source = dict(entry.decode().split('=', 1) for entry in raw.split(b'\0') if b'=' in entry)
        require(source.get('HOME') == identity['home'] and source.get('USER') == identity['account']
                and source.get('XDG_RUNTIME_DIR') == str(runtime), 'Desktop 原 UID/environment authority 不符')
        nested = None
        if source.get('XDG_SESSION_TYPE') == 'wayland':
            try: nested = desktop_nested_x11(source, identity, run)
            except (FileNotFoundError, ConnectionRefusedError):
                if proof['endpoint'] is None: desktop_wait(False, 'nested-x11')
                raise
        else:
            require(source.get('DISPLAY') == ':1' and source.get('XAUTHORITY') == str(runtime / 'Xauthority'),
                    'Desktop 原 X11 display/cookie authority 不符')
        fd_sockets = set()
        for item in (Path('/proc') / str(vnc['pid']) / 'fd').iterdir():
            try: fd_sockets.add(os.readlink(item))
            except FileNotFoundError: pass
        listeners = [line.split() for line in (Path('/proc') / str(vnc['pid']) / 'net/tcp').read_text().splitlines()[1:]]
        require(any(len(row) > 9 and row[1] == '0100007F:170D' and row[3] == '0A'
                    and 'socket:[' + row[9] + ']' in fd_sockets for row in listeners), 'Desktop VNC 原监听进程不符')
        endpoint = {'plasmaPid': plasma['pid'], 'plasmaCreated': plasma['created'], 'vncPid': vnc['pid'], 'vncCreated': vnc['created'],
                    'runtimeDevice': str(runtime.stat().st_dev), 'runtimeInode': str(runtime.stat().st_ino),
                    'xauthDevice': str(auth_info.st_dev), 'xauthInode': str(auth_info.st_ino), 'xauthSha256': hashlib.sha256(auth).hexdigest(),
                    'readyDevice': str(ready_info.st_dev), 'readyInode': str(ready_info.st_ino)}
        if nested is not None: endpoint['nestedX11'] = nested
        require(proof['endpoint'] is None or proof['endpoint'] == endpoint, 'Desktop 原 Plasma/VNC/cookie 已被替换')
        require(desktop_process(plasma['pid'], identity, run) == plasma and desktop_process(vnc['pid'], identity, run) == vnc,
                'Desktop 原进程正在变化')
        return {'identity': identity, 'run': run, 'runtime': runtime, 'source': source, 'plasma': plasma, 'vnc': vnc,
                'endpoint': endpoint, 'directoryFd': directory_fd, 'user': pwd.getpwnam(identity['account'])}
    except BaseException:
        if directory_fd >= 0: os.close(directory_fd)
        raise


# Pin the actual sandbox domain; a project ticket describes its Desktop owner,
# never a substitute UID for an independent Wayland application.
def application_group(group, value, field='cgroup'):
    proof = value[field]
    if proof is None:
        secure_directory(group.parent)
        require(not group.exists() and not group.is_symlink(), '应用未登记原 inode；残留域只供审阅')
        return None
    require(isinstance(proof, dict) and set(proof) == {'device', 'inode'}
            and all(isinstance(item, str) and re.fullmatch('[1-9][0-9]*', item) for item in proof.values()), '应用缺少原完整 cgroup 票据')
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    try:
        secure_directory(group)
        fd = os.open(group, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except FileNotFoundError: return None
    try:
        info = os.fstat(fd)
        require(boot == value['bootId'] and (str(info.st_dev), str(info.st_ino)) == (proof['device'], proof['inode']),
                '应用原 boot/cgroup inode 已变化，拒绝接管或清理替换域')
        return fd
    except BaseException:
        os.close(fd); raise

def group_proof(group):
    secure_directory(group)
    fd = os.open(group, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        return {'device': str(info.st_dev), 'inode': str(info.st_ino)}
    finally: os.close(fd)

def application_join(domain):
    fd = os.open('cgroup.procs', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=domain)
    try: os.write(fd, str(os.getpid()).encode())
    finally: os.close(fd); os.close(domain)

def application_retire(group, value, uid, network, field='cgroup'):
    domain = application_group(group, value, field)
    if domain is None: return
    def content(name, maximum=65536):
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=domain)
        try:
            raw = os.read(fd, maximum + 1)
            require(len(raw) <= maximum, '应用原运行域内容过大')
            return raw.decode()
        finally: os.close(fd)
    try:
        members = content('cgroup.procs').split()
        require(len(members) <= 1024, '应用原运行域进程过多')
        for item in members:
            try:
                row = process(int(item))
                require(not row or row['uid'] == uid and row['network'] == network
                        and (Path('/proc') / item / 'cgroup').read_text() == '0::/' + group.name + '\n'
                        and process(int(item))['created'] == row['created'], '应用原执行 UID、网络或 PID 证明已改变')
                if row and field == 'applicationProof' and value.get('directoryView') is not None:
                    directory_view_member(int(item), value['directoryView'])
                    require(process(int(item))['created'] == row['created'], '应用原目录 namespace 的 PID 已变化')
            except (FileNotFoundError, ProcessLookupError): pass
        # This FD remains the original pinned domain even if its pathname is
        # replaced. Never reopen a replacement cgroup to deliver the kill.
        if members or 'populated 1' in content('cgroup.events', 4096).splitlines():
            current = application_group(group, value, field)
            require(current is not None, '应用原域在终止前消失')
            os.close(current)
            fd = os.open('cgroup.kill', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=domain)
            try: os.write(fd, b'1')
            finally: os.close(fd)
        deadline = time.monotonic() + 5
        while True:
            if 'populated 0' not in content('cgroup.events', 4096).splitlines():
                require(time.monotonic() < deadline, '应用原完整域仍有后代，保留原票据')
                time.sleep(.05); continue
            current = application_group(group, value, field)
            if current is None: return
            os.close(current)
            try: group.rmdir(); return
            except FileNotFoundError: return
            except OSError as error:
                if error.errno not in (errno.EBUSY, errno.ENOTEMPTY): raise
            require(time.monotonic() < deadline, '应用原完整域未能退休，保留原票据')
            time.sleep(.05)
    finally: os.close(domain)

def retire_desktop(base, owner, proof):
    require(isinstance(proof, dict) and set(proof) == {'version','identity','run','record','sha256','runtime','endpoint'}
            and proof['version'] == 1 and isinstance(proof['run'], dict) and UUID.fullmatch(proof['run']['runId'])
            and proof['run']['projectId'] == proof['identity']['projectId'], 'Desktop 停止需要原完整 native owner')
    rows = list(base.iterdir())
    require(len(rows) <= 130, 'Desktop 应用记录超过清理上限')
    stopped, known = [], set()
    for directory in rows:
        if not UUID.fullmatch(directory.name): continue
        secure_directory(directory)
        value = json.loads(read_bytes(directory / 'session.json'))
        if value.get('version') != 2: continue
        known.add(cgroup_path(owner, directory.name).name)
        try: known.add(cgroup_path(owner, directory.name, True).name)
        except TypeError: pass
        source = value.get('desktop')
        if not isinstance(source, dict) or not isinstance(source.get('run'), dict) or source['run'].get('runId') != proof['run']['runId']: continue
        expected = dict(proof); expected['record'] = dict(proof['record']); expected['record']['phase'] = 'running'
        require(source == expected, 'Desktop 所属应用的原完整 owner 已改变，拒绝模糊清理')
        stop(directory, owner); stopped.append(directory.name)
    root = secure_directory(Path('/sys/fs/cgroup'))
    prefixes = [cgroup_path(owner, '00000000-0000-0000-0000-000000000000').name[:-32]]
    try: prefixes.append(cgroup_path(owner, '00000000-0000-0000-0000-000000000000', True).name[:-32])
    except TypeError: pass
    # Missing session records cannot make an extant original owner domain
    # disappear. They are reviewed, never adopted or killed by prefix.
    require(not any(any(row.name.startswith(prefix) for prefix in prefixes) and row.name not in known
                    for row in root.iterdir()), 'Desktop 存在缺少完整记录的应用域，拒绝模糊清理')
    return {'stopped': True, 'sessions': stopped}

def compositor_context(request, network):
    checked = desktop_authority(request.get('desktop'))
    try:
        user = checked['user']
        require(request['directory'] == checked['identity']['directory'] and request['projectId'] == checked['identity']['projectId'], '应用项目与原 Desktop 完整票据不符')
        # Internal, already root-authorized fixture contexts are never exposed by
        # the public application action. Production discovers the desktop itself.
        pinned = request.get("compositor")
        if pinned is not None:
            require(isinstance(pinned, dict) and set(pinned) == {"socket", "pid", "created", "uid"}, "合成器身份无效")
            require(type(pinned["pid"]) is int and pinned["pid"] > 0 and pinned["uid"] == user.pw_uid,
                    "合成器用户不符")
            row = process(pinned["pid"])
            desktop_process(pinned["pid"], checked["identity"], checked["run"])
            require(row and row["created"] == pinned["created"] and row["uid"] == user.pw_uid and row["network"] == network,
                    "合成器进程已变化")
            source = environment(row["pid"])
            endpoint = Path(pinned["socket"])
        else:
            source = checked['source']
            require(source.get('XDG_SESSION_TYPE') == 'wayland' and source.get('WAYLAND_DISPLAY'), '原项目 Desktop 尚无原生 Wayland compositor')
            name = source["WAYLAND_DISPLAY"]
            endpoint = Path(name) if name.startswith("/") else Path(source.get("XDG_RUNTIME_DIR", "")) / name
        require(endpoint.is_absolute() and str(endpoint) == str(endpoint.resolve(strict=True))
                and len(os.fsencode(endpoint)) < 108 and not re.search(r"[\x00-\x1f]", str(endpoint)), "Wayland socket 路径不符")
        parent = endpoint.parent.lstat()
        info = endpoint.lstat()
        require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == user.pw_uid and not parent.st_mode & 0o077
                and stat.S_ISSOCK(info.st_mode) and info.st_uid == user.pw_uid, "Wayland socket 或私有运行目录身份不符")
        probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM | socket.SOCK_CLOEXEC)
        try:
            probe.settimeout(2)
            probe.connect(str(endpoint))
            pid, uid, _ = struct.unpack("3i", probe.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            row = process(pid)
            require(row and uid == user.pw_uid and row["uid"] == uid and row["network"] == network, "Wayland 合成器进程身份不符")
            desktop_process(pid, checked['identity'], checked['run'])
            actor = compositor_actor(row, endpoint)
            if actor.get('compositorChildPid'): desktop_process(actor['compositorChildPid'], checked['identity'], checked['run'])
            if pinned:
                require(pid == pinned["pid"] and row["created"] == pinned["created"], "Wayland socket 指向其他合成器")
            after = endpoint.lstat()
            require((info.st_dev, info.st_ino) == (after.st_dev, after.st_ino), "Wayland socket 正在替换")
        finally:
            probe.close()
        expected = request["environment"]
        require(isinstance(expected, dict) and len(expected) <= 256, "项目环境摘要无效")
        values = {}
        for key, value in expected.items():
            require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", key) and DIGEST.fullmatch(value) and not PROTECTED.match(key),
                    "项目环境包含受保护的运行设置")
            require(key in source and hashlib.sha256(source[key].encode()).hexdigest() == value, "项目环境或私密配置已变化")
            values[key] = source[key]
        for key in ("LANG", "LC_ALL", "LC_CTYPE", "XDG_DATA_DIRS"):
            if key in source:
                values[key] = source[key]
        return {"compositorSocket": str(endpoint), "compositorPid": row["pid"], "compositorCreated": row["created"],
                "compositorUid": row["uid"], "compositorDevice": info.st_dev, "compositorInode": info.st_ino, **actor}, values, checked


    except BaseException:
        os.close(checked["directoryFd"]); raise

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


def create_account(session):
    name = "skwl" + session.replace("-", "")[:24]
    home = Path("/home") / name
    require(not home.exists() and not home.is_symlink(), "应用账户路径已存在")
    try:
        pwd.getpwnam(name)
    except KeyError:
        pass
    else:
        raise RuntimeError("应用账户已存在，拒绝复用")
    # Independent window UIDs use a disjoint range from native project UIDs.
    taken = {row.pw_uid for row in pwd.getpwall()} | {row.gr_gid for row in grp.getgrall()}
    uid = next((item for item in range(1000, 20000) if item not in taken), None)
    require(uid is not None, '独立应用 UID 已达上限，不复用旧账户')
    alpine = Path('/etc/alpine-release').exists()
    commands = [["/usr/sbin/addgroup", "-g", str(uid), name],
                ["/usr/sbin/adduser", "-D", "-u", str(uid), "-G", name, "-h", str(home), "-s", "/bin/sh", name]] if alpine else \
               [["/usr/sbin/groupadd", "-g", str(uid), name],
                ["/usr/sbin/useradd", "-m", "-u", str(uid), "-g", name, "-d", str(home), "-s", "/bin/sh", name]]
    for command in commands:
        subprocess.run(command, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.PIPE, timeout=15, env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/','LANG':'C','LC_ALL':'C'})
    user = pwd.getpwnam(name)
    require(user.pw_uid == uid and user.pw_gid == uid and user.pw_dir == str(home), '应用账户身份不符')
    home.chmod(0o700)
    return user


def metadata(directory, owner, check_account=True):
    secure_directory(directory)
    value = json.loads(read_bytes(directory / "session.json"))
    require(value["version"] == 2 and isinstance(value.get("desktop"), dict) and value["owner"] == owner and value["id"] == directory.name and UUID.fullmatch(value["id"])
            and DIGEST.fullmatch(value["build"]) and DIGEST.fullmatch(value["sha256"]) and DIGEST.fullmatch(value["proxySha256"])
            and value["proxy"] == "/usr/local/lib/sakura-wayland-clipboard/" + value["build"] + "/proxy.py"
            and value["applicationCgroup"] == str(cgroup_path(owner, value["id"]))
            and value["brokerCgroup"] == str(cgroup_path(owner, value["id"], True))
            and value["runtime"] == str(RUNTIME / owner.replace("-", "") / value["id"].replace("-", "") / "runtime")
            and value["socket"] == value["runtime"] + "/wayland-sakura"
            and value["user"] == "skwl" + value["id"].replace("-", "")[:24]
            and value["home"] == "/home/" + value["user"]
            and type(value["uid"]) is int and value["uid"] >= 1000, "应用会话身份不符")
    if check_account:
        user = pwd.getpwnam(value["user"])
        require(user.pw_uid == value["uid"] and user.pw_gid == value["gid"] and user.pw_dir == value["home"], "应用账户已变化")
    require(value['desktop']['identity']['uid'] != value['uid'] and value['desktop']['identity']['projectId'] == value['projectId']
            and value['desktop']['run']['bootId'] == value['bootId'], '应用独立 sandbox UID 与 Desktop owner 关系不符')
    directory_view_proof(value)
    return value


def group_rows(path, uid, network, directory_view=None):
    result = []
    if not path.exists():
        return result
    secure_directory(path)
    for item in (path / "cgroup.procs").read_text().split():
        try:
            row = process(int(item))
            if row:
                require(row["uid"] == uid and row["network"] == network, "会话进程用户或网络空间不符")
                require("0::/" + path.name in (Path("/proc") / item / "cgroup").read_text().splitlines()
                        and process(int(item))["created"] == row["created"], "应用进程身份或 cgroup 已变化")
                if directory_view is not None:
                    directory_view_member(int(item), directory_view)
                    require(process(int(item))['created'] == row['created'], '应用目录 namespace 的 PID 已变化')
                result.append(row)
        except (FileNotFoundError, ProcessLookupError):
            pass
    require(len(result) <= 1024, "应用进程过多")
    return result


def status(directory, value):
    data = json.loads(read_bytes(directory / "status", 131072))
    require(data["version"] == 1 and data["build"] == value["build"] and type(data["pid"]) is int
            and type(data.get("ready")) is bool and isinstance(data.get("clients", []), list)
            and len(data.get("clients", [])) <= 1024
            and all(type(data.get(key, 0)) is int and 0 <= data.get(key, 0) < 2**53
                    for key in ("connections", "pending", "blockedCopy", "blockedPaste")), "代理统计身份或大小不符")
    return data


def view(directory, owner):
    value = metadata(directory, owner)
    raw = read_bytes(directory / "policy", 128)
    magic, version, flags, maximum, generation, build = struct.unpack("<IIIIQ65s39x", raw)
    require(magic == MAGIC and version == 1 and flags <= 31 and 1024 <= maximum <= 1048576
            and 1 <= generation < 2**53 and build.rstrip(b"\0").decode() == value["build"], "策略文件身份不符")
    data = status(directory, value)
    for path, field in [(Path(value['applicationCgroup']), 'applicationProof'), (Path(value['brokerCgroup']), 'brokerProof')]:
        domain = application_group(path, value, field)
        if domain is not None: os.close(domain)
    rows = group_rows(Path(value["applicationCgroup"]), value["uid"], value["network"], value.get('directoryView'))
    brokers = group_rows(Path(value["brokerCgroup"]), 0, value["network"])
    broker = next((row for row in brokers if row["pid"] == data["pid"] and row["created"] == data.get("created")), None)
    if broker:
        arguments = (Path("/proc") / str(broker["pid"]) / "cmdline").read_bytes().split(b"\0")
        require(arguments[:5] == [b"/usr/bin/python3", b"-I", b"-S", value["proxy"].encode(), str(directory).encode()],
                "代理进程命令身份不符")
    clients = {(item["pid"], item["created"]) for item in data.get("clients", []) if item.get("uid") == value["uid"]}
    processes = [{"pid": row["pid"], "created": row["created"], "image": row["image"],
                  "loaded": bool(broker and (row["pid"], row["created"]) in clients)} for row in rows]
    running = bool(broker and data["ready"] and any(row["loaded"] for row in processes))
    return {"id": value["id"], "image": value["image"], "sha256": value["sha256"], "projectId": value["projectId"],
            "directory": value["directory"], "startedAt": value["startedAt"], "processes": processes,
            "state": "running" if running else "error" if rows else "stopped", "compatible": value["build"] == BUILD,
            "active": bool(flags & 16), "generation": generation,
            "rule": {"copy": bool(flags & 1), "paste": bool(flags & 2), "files": bool(flags & 4),
                     "sensitive": bool(flags & 8), "maxTextBytes": maximum},
            "desktopOwner": {"projectId": value['projectId'], "uid": value['desktop']['identity']['uid'], "runId": value['desktop']['run']['runId']},
            "applicationOwner": {"uid": value['uid'], "kind": 'window-sandbox'},
            "blockedCopy": data.get("blockedCopy", 0), "blockedPaste": data.get("blockedPaste", 0),
            **({"error": "原生 Wayland 代理不可用，请停止并重新启动应用"} if rows and not running else {})}


def kill_group(path, uid, network, value, field):
    application_retire(path, value, uid, network, field)


def stop(directory, owner):
    value = metadata(directory, owner, False)
    # Stop forwarding before terminating writers/readers. Killing the exact
    # broker cgroup avoids inherited/socket FD shutdown races and PID reuse.
    raw = read_bytes(directory / "policy", 128)
    _, _, _, _, generation, _ = struct.unpack("<IIIIQ65s39x", raw)
    publish_policy(directory, rule_bytes({"copy": False, "paste": False, "files": False,
                   "sensitive": True, "maxTextBytes": 1024}, value["build"], generation))
    kill_group(Path(value["brokerCgroup"]), 0, value["network"], value, "brokerProof")
    kill_group(Path(value["applicationCgroup"]), value["uid"], value["network"], value, "applicationProof")
    # Only unlink a known socket. Private home/runtime contents are never
    # recursively deleted or reassigned to later application accounts.
    endpoint = Path(value["socket"])
    try:
        info = endpoint.lstat()
        require(stat.S_ISSOCK(info.st_mode) and info.st_uid in (0, value["uid"]), "代理 endpoint 身份已变化")
        endpoint.unlink()
    except FileNotFoundError:
        pass
    return {"stopped": True}


APPLICATION_EXEC_SOURCE = r"""import errno,hashlib,os,stat,sys
source=int(sys.argv[1]); selected=-1
try:
    assert os.execve in os.supports_fd, 'Pinned executable FD execution is unavailable'
    selected=os.open(sys.argv[3],os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    pinned,before=os.fstat(source),os.fstat(selected)
    fields=('st_dev','st_ino','st_mode','st_size','st_mtime_ns','st_ctime_ns')
    assert all(getattr(pinned,key)==getattr(before,key) for key in fields), 'Mapped application image changed'
    assert stat.S_ISREG(before.st_mode) and not before.st_mode&0o6000 and before.st_size<=536870912, 'Mapped application image is unsupported'
    try: capabilities=os.getxattr(selected,'security.capability')
    except OSError as error:
        if error.errno not in (errno.ENODATA,errno.ENOTSUP): raise
        capabilities=b''
    assert not capabilities, 'Mapped application file capabilities are unsupported'
    digest=hashlib.sha256(); total=0
    while True:
        data=os.read(selected,1048576)
        if not data: break
        total+=len(data)
        assert total<=before.st_size, 'Mapped application image grew during validation'
        digest.update(data)
    assert total==before.st_size and digest.hexdigest()==sys.argv[2], 'Mapped application image digest changed'
    after=os.fstat(selected)
    assert all(getattr(before,key)==getattr(after,key) for key in fields), 'Mapped application image changed during validation'
    original_after=os.fstat(source)
    assert all(getattr(pinned,key)==getattr(original_after,key) for key in fields), 'Original application image changed during validation'
    os.close(source); source=-1
    os.set_inheritable(selected,False)
    os.execve(selected,sys.argv[3:],os.environ)
finally:
    if source>=0: os.close(source)
    if selected>=0: os.close(selected)
"""


def launch(base, owner, request):
    proxy_hash = proxy_valid()
    app = identify(request["image"])
    require(app["image"] == request["image"] and app["sha256"] == request["sha256"], "应用路径或摘要已变化")
    require(isinstance(request["args"], list) and len(request["args"]) <= 32
            and all(isinstance(arg, str) and len(arg) <= 1024 and not re.search(r"[\x00-\x1f]", arg) for arg in request["args"]),
            "应用参数无效")
    cgroup_root()
    network = project_network(request)
    compositor, values, checked = compositor_context(request, network)
    try:
        return launch_with_directory(base, owner, request, proxy_hash, app, network, compositor, values, checked)
    finally:
        os.close(checked['directoryFd'])


def launch_with_directory(base, owner, request, proxy_hash, app, network, compositor, values, checked):
    session = request["id"]
    require(UUID.fullmatch(session) and sum(bool(UUID.fullmatch(item.name)) for item in base.iterdir()) < 128,
            "应用会话身份无效或过多，请先清理已停止的会话")
    policy = rule_bytes(request["rule"], BUILD, request["generation"])
    user = create_account(session)
    directory = base / session
    directory.mkdir(mode=0o700)
    app_group, broker_group = cgroup_path(owner, session), cgroup_path(owner, session, True)
    runtime_parent = secure_directory(RUNTIME / owner.replace("-", "") / session.replace("-", ""), create=True, mode=0o711)
    # SSH commonly supplies umask 077. These exact, controller-owned parents
    # need traverse permission; each leaf remains 0700 owned by its unique UID.
    for path in (RUNTIME, RUNTIME / owner.replace("-", ""), runtime_parent):
        path.chmod(0o711)
    runtime = runtime_parent / "runtime"
    require(len(os.fsencode(runtime / "wayland-sakura")) < 108, "应用 Wayland socket 路径过长")
    runtime.mkdir(mode=0o700)
    os.chown(runtime, user.pw_uid, user.pw_gid)
    value = {"version": 2, "owner": owner, "id": session, **app, "uid": user.pw_uid, "gid": user.pw_gid,
             "user": user.pw_name, "home": user.pw_dir, "build": BUILD, "proxy": str(PROXY), "proxySha256": proxy_hash,
             "directory": request["directory"], "projectId": request["projectId"], "network": network,
             "runtime": str(runtime), "socket": str(runtime / "wayland-sakura"), "applicationCgroup": str(app_group),
             "brokerCgroup": str(broker_group), "desktop": request["desktop"], "bootId": request["desktop"]["run"]["bootId"], "directoryView": None, "applicationProof": None, "brokerProof": None, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **compositor}
    atomic(directory / "session.json", json.dumps(value).encode())
    atomic(directory / "policy", policy)
    atomic(directory / "policy-lock", b"")
    atomic(directory / "status", json.dumps({"version": 1, "build": BUILD, "pid": 0, "created": "0", "ready": False,
           "connections": 0, "pending": 0, "blockedCopy": 0, "blockedPaste": 0, "clients": []}).encode())
    environment_values = {**values, "HOME": user.pw_dir, "USER": user.pw_name, "LOGNAME": user.pw_name,
                          "PATH": "/usr/local/bin:/usr/bin:/bin", "SHELL": "/bin/sh", "XDG_RUNTIME_DIR": str(runtime),
                          "WAYLAND_DISPLAY": str(runtime / "wayland-sakura"), "XDG_SESSION_TYPE": "wayland",
                          "QT_QPA_PLATFORM": "wayland", "GDK_BACKEND": "wayland", "SDL_VIDEODRIVER": "wayland"}
    libc = ctypes.CDLL(None, use_errno=True)
    def child():
        application_join(app_descriptor)
        mapped = directory_view_enter(namespace, value['directoryView'], value['directory'])
        os.close(checked['directoryFd'])
        require(libc.prctl(38, 1, 0, 0, 0) == 0, "无法禁用提权")
        os.setgroups([])
        os.setgid(user.pw_gid)
        os.setuid(user.pw_uid)
        try:
            os.fchdir(mapped)
        finally:
            os.close(mapped)
    def broker_child():
        application_join(broker_descriptor)
    app_descriptor = broker_descriptor = -1
    descriptor = namespace = -1
    try:
        app_group.mkdir(mode=0o755)
        broker_group.mkdir(mode=0o755)
        value['applicationProof'], value['brokerProof'] = group_proof(app_group), group_proof(broker_group)
        app_descriptor = application_group(app_group, value, 'applicationProof')
        broker_descriptor = application_group(broker_group, value, 'brokerProof')
        atomic(directory / 'session.json', json.dumps(value).encode())
        require((app_group / "cgroup.kill").exists() and (broker_group / "cgroup.kill").exists(), "需要支持 cgroup.kill 的内核")
        namespace, value['directoryView'] = directory_view_create(checked, user)
        directory_view_proof(value)
        atomic(directory / 'session.json', json.dumps(value).encode())
        proxy = subprocess.Popen(["/usr/bin/python3", "-I", "-S", str(PROXY), str(directory)],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                 env={"PATH": "/usr/local/bin:/usr/bin:/bin"}, preexec_fn=broker_child, start_new_session=True, pass_fds=[broker_descriptor])
        try:
            for _ in range(100):
                if proxy.poll() is not None:
                    # No application exists yet: this diagnostic is bounded
                    # startup metadata, never a clipboard body or client log.
                    diagnostic = os.read(proxy.stderr.fileno(), 4096).decode(errors="replace").strip().splitlines()
                    raise RuntimeError("原生 Wayland 代理未启动: " + (diagnostic[-1][:180] if diagnostic else "unknown"))
                data = status(directory, value)
                if data["ready"] and data["pid"] == proxy.pid and data["created"] == process(proxy.pid)["created"]:
                    break
                time.sleep(.05)
            else:
                raise RuntimeError("原生 Wayland 代理 endpoint 未就绪")
        finally:
            proxy.stderr.close()
        # Probe the idmapped view as the exact new UID. The original ownership,
        # permissions and ACLs were not rewritten to grant that access.
        access = subprocess.run(["/usr/bin/python3", "-I", "-S", "-c",
                                 "import os,sys;sys.exit(0 if os.access('.',os.R_OK|os.W_OK|os.X_OK) else 1)"],
                                cwd=None, env=environment_values, preexec_fn=child,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, pass_fds=[checked["directoryFd"], app_descriptor, namespace])
        require(access.returncode == 0, "项目目录映射后的准确应用 UID 仍无读写或访问权限")
        bus = subprocess.Popen(["/usr/bin/dbus-daemon", "--session", "--nofork", "--nopidfile", "--print-address=1"],
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               env=environment_values, cwd=None, preexec_fn=child, start_new_session=True, pass_fds=[checked["directoryFd"], app_descriptor, namespace])
        try:
            readable, _, _ = select.select([bus.stdout], [], [], 5)
            require(readable, "应用私有 D-Bus 未就绪")
            address = bus.stdout.readline(4096).strip().decode()
            require(address.startswith("unix:") and len(address) < 4095 and not re.search(r"[\x00-\x1f]", address), "应用私有 D-Bus 地址无效")
        finally:
            bus.stdout.close()
        environment_values["DBUS_SESSION_BUS_ADDRESS"] = address
        descriptor = os.open(app["image"], os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        require(digest_fd(descriptor) == app["sha256"] and digest(PROXY) == proxy_hash, "应用或协议代理在启动前已变化")
        # The original FD belongs to the original mount tree. Owner-only ELF
        # permissions must be evaluated on the application's idmapped view.
        # After the UID drop, reopen that view and check the original inode and
        # digest before fexecve; close the Root-opened FD before application code.
        subprocess.Popen(["/usr/bin/python3", "-I", "-S", "-c", APPLICATION_EXEC_SOURCE, str(descriptor), app["sha256"], app["image"], *request["args"]],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         env=environment_values, cwd=None, preexec_fn=child, start_new_session=True,
                         pass_fds=[descriptor, checked["directoryFd"], app_descriptor, namespace])
        for _ in range(100):
            result = view(directory, owner)
            if result["state"] == "running" and any(row["loaded"] for row in result["processes"]):
                return result
            time.sleep(.05)
        diagnostic = status(directory, value).get("lastFailure")
        raise RuntimeError("应用未建立受管原生 Wayland 连接，已停止本次会话" +
                           (": " + json.dumps(diagnostic, separators=(",", ":"))[:140] if diagnostic else ""))
    except Exception:
        stop(directory, owner)
        raise
    finally:
        if namespace >= 0: os.close(namespace)
        if app_descriptor >= 0: os.close(app_descriptor)
        if broker_descriptor >= 0: os.close(broker_descriptor)
        if descriptor >= 0:
            os.close(descriptor)


def readiness():
    try:
        cgroup_root()
        proxy_valid()
        return {"ready": True, "build": BUILD}
    except Exception as error:
        return {"ready": False, "build": BUILD, "error": str(error)[:256]}


def publish_policy(directory, raw):
    descriptor = os.open(directory / "policy-lock", os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077, "策略发布锁身份不符")
        deadline = time.monotonic() + 2
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                require(time.monotonic() < deadline, "策略发布锁等待超时")
                time.sleep(.01)
        atomic(directory / "policy", raw)
    finally:
        os.close(descriptor)


def observed_policy(directory, value, raw, generation):
    expected = hashlib.sha256(raw).hexdigest()
    deadline = time.monotonic() + 2
    while True:
        data = status(directory, value)
        brokers = group_rows(Path(value["brokerCgroup"]), 0, value["network"])
        if not any(row["pid"] == data["pid"] and row["created"] == data.get("created") for row in brokers):
            return
        if data.get("generation") == generation and data.get("policySha256") == expected:
            return
        require(time.monotonic() < deadline, "代理尚未确认最新规则，更新已保留，请刷新状态")
        time.sleep(.025)


def main(request):
    require(os.geteuid() == 0 and DIGEST.fullmatch(BUILD), "需要已校验的客户机 Wayland 控制器")
    require(isinstance(request, dict) and UUID.fullmatch(request["owner"]), "控制服务身份无效")
    owner = request["owner"]
    readonly = request["action"] == "list"
    try:
        secure_directory(BASE, create=not readonly)
        base = secure_directory(BASE / owner, create=not readonly)
    except FileNotFoundError:
        if readonly:
            return {**readiness(), "sessions": []}
        raise
    lock = os.open(base / "lock", (os.O_RDONLY if readonly else os.O_CREAT | os.O_RDWR) | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077, "会话锁身份或权限不符")
        fcntl.flock(lock, fcntl.LOCK_SH if readonly else fcntl.LOCK_EX)
        action = request["action"]
        if action == "identify":
            return identify(request["image"])
        if action == "list":
            rows = []
            for directory in sorted(base.iterdir()):
                if UUID.fullmatch(directory.name):
                    try:
                        rows.append(view(directory, owner))
                    except Exception as error:
                        rows.append({"id": directory.name, "state": "error", "error": str(error)[:256]})
            return {**readiness(), "sessions": rows[-128:]}
        if action == "stop-desktop":
            return retire_desktop(base, owner, request["desktop"])
        if action == "launch":
            require(type(request["generation"]) is int and 1 <= request["generation"] < 2**53, "策略版本无效")
            return launch(base, owner, request)
        require(action in ("configure", "stop", "forget") and UUID.fullmatch(request["id"]), "应用操作无效")
        directory = base / request["id"]
        if action in ("stop", "forget") and not directory.exists():
            require(not cgroup_path(owner, request["id"]).exists() and not cgroup_path(owner, request["id"], True).exists(), "缺少原记录但应用域仍存在，拒绝清理或确认")
            return {"stopped": True}
        if action == "stop":
            return stop(directory, owner)
        value = metadata(directory, owner)
        if action == "forget":
            stop(directory, owner)
            require(all(item.name in ("session.json", "policy", "status", "policy-lock") for item in directory.iterdir()),
                    "会话目录包含未知文件，拒绝清理")
            for item in directory.iterdir():
                read_bytes(item, 131072)
                item.unlink()
            directory.rmdir()
            return {"removed": True}
        require(type(request["enabled"]) is bool and type(request["generation"]) is int
                and 1 <= request["generation"] < 2**53, "策略版本无效")
        require(not request["enabled"] or value["build"] == BUILD, "协议代理版本已变化，请停止并重新启动")
        _, _, _, _, current, _ = struct.unpack("<IIIIQ65s39x", read_bytes(directory / "policy", 128))
        require(request["generation"] >= current, "过期策略版本，拒绝覆盖最新规则")
        raw = rule_bytes(request["rule"], value["build"], request["generation"], request["enabled"])
        publish_policy(directory, raw)
        observed_policy(directory, value, raw, request["generation"])
        return view(directory, owner)
    finally:
        os.close(lock)


if __name__ == "__main__":
    try:
        require(len(sys.argv) == 2 and len(sys.argv[1]) <= 65536, "Wayland 请求过大")
        print(json.dumps(main(json.loads(base64.b64decode(sys.argv[1], validate=True))), ensure_ascii=False, separators=(",", ":")))
    except Exception as error:
        print(json.dumps({"error": str(error)[:256]}, ensure_ascii=False))
        sys.exit(1)
