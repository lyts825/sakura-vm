"""Root supervisor for explicitly launched native Wayland applications.

The protocol broker is a separate pinned process, not a preload library. A new
Unix account and private session bus keep each application's new connections
on its own broker endpoint. Accounts are deliberately never recycled.
"""
import base64
import ctypes
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import select
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


def compositor_context(request, network):
    require(DIGEST.fullmatch(request["launcherSha256"])
            and digest(Path("/usr/local/libexec/sakura-desktop-launcher")) == request["launcherSha256"],
            "桌面项目启动绑定已变化")
    user = pwd.getpwnam("sakura-desktop")
    require(user.pw_uid >= 1000 and user.pw_gid >= 1000 and user.pw_dir == "/home/sakura-desktop", "桌面账户身份不符")
    # Internal, already root-authorized fixture contexts are never exposed by
    # the public application action. Production discovers the desktop itself.
    pinned = request.get("compositor")
    if pinned is not None:
        require(isinstance(pinned, dict) and set(pinned) == {"socket", "pid", "created", "uid"}, "合成器身份无效")
        require(type(pinned["pid"]) is int and pinned["pid"] > 0 and pinned["uid"] == user.pw_uid,
                "合成器用户不符")
        row = process(pinned["pid"])
        require(row and row["created"] == pinned["created"] and row["uid"] == user.pw_uid and row["network"] == network,
                "合成器进程已变化")
        source = environment(row["pid"])
        endpoint = Path(pinned["socket"])
    else:
        candidates = []
        for item in Path("/proc").iterdir():
            if not item.name.isdigit():
                continue
            try:
                row = process(int(item.name))
                if row and row["uid"] == user.pw_uid and row["image"] == "/usr/bin/plasmashell" and row["network"] == network:
                    source = environment(row["pid"])
                    if source.get("XDG_SESSION_TYPE") == "wayland" and source.get("WAYLAND_DISPLAY"):
                        candidates.append((row, source))
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue
        require(len(candidates) == 1, "需要唯一已就绪的原生 Wayland Plasma 会话；当前桌面可能仅支持 X11")
        _, source = candidates[0]
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
        actor = compositor_actor(row, endpoint)
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
            "compositorUid": row["uid"], "compositorDevice": info.st_dev, "compositorInode": info.st_ino, **actor}, values


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
    command = ["/usr/sbin/adduser", "-D", "-h", str(home), "-s", "/bin/sh", name] if Path("/etc/alpine-release").exists() \
        else ["/usr/sbin/useradd", "-m", "-d", str(home), "-s", "/bin/sh", name]
    subprocess.run(command, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                   stderr=subprocess.PIPE, timeout=15)
    user = pwd.getpwnam(name)
    require(user.pw_uid >= 1000 and user.pw_gid >= 1000 and user.pw_dir == str(home), "应用账户身份不符")
    home.chmod(0o700)
    return user


def metadata(directory, owner):
    secure_directory(directory)
    value = json.loads(read_bytes(directory / "session.json"))
    require(value["version"] == 1 and value["owner"] == owner and value["id"] == directory.name and UUID.fullmatch(value["id"])
            and DIGEST.fullmatch(value["build"]) and DIGEST.fullmatch(value["sha256"]) and DIGEST.fullmatch(value["proxySha256"])
            and value["proxy"] == "/usr/local/lib/sakura-wayland-clipboard/" + value["build"] + "/proxy.py"
            and value["applicationCgroup"] == str(cgroup_path(owner, value["id"]))
            and value["brokerCgroup"] == str(cgroup_path(owner, value["id"], True))
            and value["runtime"] == str(RUNTIME / owner.replace("-", "") / value["id"].replace("-", "") / "runtime")
            and value["socket"] == value["runtime"] + "/wayland-sakura"
            and value["user"] == "skwl" + value["id"].replace("-", "")[:24]
            and value["home"] == "/home/" + value["user"]
            and type(value["uid"]) is int and value["uid"] >= 1000, "应用会话身份不符")
    user = pwd.getpwnam(value["user"])
    require(user.pw_uid == value["uid"] and user.pw_gid == value["gid"] and user.pw_dir == value["home"], "应用账户已变化")
    return value


def group_rows(path, uid, network):
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
    rows = group_rows(Path(value["applicationCgroup"]), value["uid"], value["network"])
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
            "blockedCopy": data.get("blockedCopy", 0), "blockedPaste": data.get("blockedPaste", 0),
            **({"error": "原生 Wayland 代理不可用，请停止并重新启动应用"} if rows and not running else {})}


def kill_group(path, uid, network):
    if not path.exists():
        return
    group_rows(path, uid, network)
    require((path / "cgroup.kill").exists(), "内核不能可靠清理应用进程组")
    (path / "cgroup.kill").write_text("1")
    deadline = time.monotonic() + 5
    while True:
        try:
            if not (path / "cgroup.procs").read_text().strip():
                try:
                    path.rmdir()
                    return
                except OSError as error:
                    if error.errno not in (errno.EBUSY, errno.ENOTEMPTY):
                        raise
        except FileNotFoundError:
            if not path.exists():
                return
            raise
        require(time.monotonic() < deadline, "会话进程组未停止或未能清理")
        time.sleep(.05)


def stop(directory, owner):
    value = metadata(directory, owner)
    # Stop forwarding before terminating writers/readers. Killing the exact
    # broker cgroup avoids inherited/socket FD shutdown races and PID reuse.
    raw = read_bytes(directory / "policy", 128)
    _, _, _, _, generation, _ = struct.unpack("<IIIIQ65s39x", raw)
    publish_policy(directory, rule_bytes({"copy": False, "paste": False, "files": False,
                   "sensitive": True, "maxTextBytes": 1024}, value["build"], generation))
    kill_group(Path(value["brokerCgroup"]), 0, value["network"])
    kill_group(Path(value["applicationCgroup"]), value["uid"], value["network"])
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


def launch(base, owner, request):
    proxy_hash = proxy_valid()
    app = identify(request["image"])
    require(app["image"] == request["image"] and app["sha256"] == request["sha256"], "应用路径或摘要已变化")
    require(isinstance(request["args"], list) and len(request["args"]) <= 32
            and all(isinstance(arg, str) and len(arg) <= 1024 and not re.search(r"[\x00-\x1f]", arg) for arg in request["args"]),
            "应用参数无效")
    cgroup_root()
    network = project_network(request)
    compositor, values = compositor_context(request, network)
    require(isinstance(request["directory"], str) and Path(request["directory"]).is_absolute()
            and Path(request["directory"]).resolve(strict=True).is_dir(), "项目目录不可用")
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
    value = {"version": 1, "owner": owner, "id": session, **app, "uid": user.pw_uid, "gid": user.pw_gid,
             "user": user.pw_name, "home": user.pw_dir, "build": BUILD, "proxy": str(PROXY), "proxySha256": proxy_hash,
             "directory": request["directory"], "projectId": request["projectId"], "network": network,
             "runtime": str(runtime), "socket": str(runtime / "wayland-sakura"), "applicationCgroup": str(app_group),
             "brokerCgroup": str(broker_group), "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **compositor}
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
        (app_group / "cgroup.procs").write_text(str(os.getpid()))
        require(libc.prctl(38, 1, 0, 0, 0) == 0, "无法禁用提权")
        os.setgroups([])
        os.setgid(user.pw_gid)
        os.setuid(user.pw_uid)
    def broker_child():
        (broker_group / "cgroup.procs").write_text(str(os.getpid()))
    descriptor = -1
    try:
        app_group.mkdir(mode=0o755)
        broker_group.mkdir(mode=0o755)
        require((app_group / "cgroup.kill").exists() and (broker_group / "cgroup.kill").exists(), "需要支持 cgroup.kill 的内核")
        proxy = subprocess.Popen(["/usr/bin/python3", "-I", "-S", str(PROXY), str(directory)],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                 env={"PATH": "/usr/local/bin:/usr/bin:/bin"}, preexec_fn=broker_child, start_new_session=True)
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
        # Probe cwd as the exact new UID; never chmod/chown an arbitrary
        # project or inherit an existing user's private home as a shortcut.
        access = subprocess.run(["/usr/bin/python3", "-I", "-S", "-c",
                                 "import os,sys;sys.exit(0 if os.access(sys.argv[1],os.R_OK|os.W_OK|os.X_OK) else 1)",
                                 request["directory"]],
                                cwd=request["directory"], env=environment_values, preexec_fn=child,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        require(access.returncode == 0, "项目目录不允许独立应用账户读写，请选择已授权的共享项目目录")
        bus = subprocess.Popen(["/usr/bin/dbus-daemon", "--session", "--nofork", "--nopidfile", "--print-address=1"],
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               env=environment_values, cwd=request["directory"], preexec_fn=child, start_new_session=True)
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
        # Execute the pinned ELF through Python's supported fexecve path after
        # the UID transition; no pathname reopen or identity fallback.
        execute_fd = "import os,sys;fd=int(sys.argv[1]);assert os.execve in os.supports_fd;os.set_inheritable(fd,False);os.execve(fd,sys.argv[2:],os.environ)"
        subprocess.Popen(["/usr/bin/python3", "-I", "-S", "-c", execute_fd, str(descriptor), app["image"], *request["args"]],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         env=environment_values, cwd=request["directory"], preexec_fn=child, start_new_session=True,
                         pass_fds=[descriptor])
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
        if action == "launch":
            require(type(request["generation"]) is int and 1 <= request["generation"] < 2**53, "策略版本无效")
            return launch(base, owner, request)
        require(action in ("configure", "stop", "forget") and UUID.fullmatch(request["id"]), "应用操作无效")
        directory = base / request["id"]
        if action in ("stop", "forget") and not directory.exists():
            return {"stopped": True}
        value = metadata(directory, owner)
        if action == "stop":
            return stop(directory, owner)
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
