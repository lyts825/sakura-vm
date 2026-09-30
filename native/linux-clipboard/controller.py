"""Root controller for explicitly launched X11 apps in the managed desktop.

No ptrace, compositor modification, system-wide preload or clipboard contents.
The caller verifies these script bytes before every execution.
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
import signal
import stat
import struct
import subprocess
import sys
import time
import uuid

MAGIC = 0x58434C50
BUILD = Path(__file__).resolve().parent.name
LIBRARY = Path(__file__).parent / "libSakuraClipboard.so"
BASE = Path("/var/lib/sakura/x11-clipboard")
UUID = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")
DIGEST = re.compile(r"^[a-f0-9]{64}$")

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
    temporary = path.parent / ("." + str(uuid.uuid4()) + ".new")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)

def digest_fd(descriptor):
    os.lseek(descriptor, 0, os.SEEK_SET)
    before = os.fstat(descriptor)
    require(stat.S_ISREG(before.st_mode) and before.st_size <= 536870912, "应用文件不是普通文件")
    value = hashlib.sha256()
    while True:
        data = os.read(descriptor, 1048576)
        if not data:
            break
        value.update(data)
    after = os.fstat(descriptor)
    require((before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_ino, after.st_size, after.st_mtime_ns), "应用文件正在变化")
    return value.hexdigest()

def digest(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        return digest_fd(descriptor)
    finally:
        os.close(descriptor)

def identify(image):
    require(isinstance(image, str) and image.startswith("/") and len(image) <= 1024
            and not re.search(r"[\x00-\x1f]", image), "需要完整 Linux 应用路径")
    resolved = Path(image).resolve(strict=True)
    descriptor = os.open(resolved, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o6000, "不支持提权应用")
        try:
            capabilities = os.getxattr(descriptor, "security.capability")
        except OSError as error:
            if error.errno not in [errno.ENODATA, errno.ENOTSUP]:
                raise
            capabilities = b""
        require(not capabilities, "不支持带文件能力的应用")
        header = os.pread(descriptor, 64, 0)
        require(len(header) == 64 and header[:6] == b"\x7fELF\x02\x01", "仅支持动态链接的 64 位 Linux ELF 应用")
        kind, machine = struct.unpack_from("<HH", header, 16)
        require(kind in (2, 3) and machine == {"x86_64": 62, "aarch64": 183}.get(os.uname().machine),
                "应用架构与当前客户机不符")
        offset = struct.unpack_from("<Q", header, 32)[0]
        size, count = struct.unpack_from("<HH", header, 54)
        require(size == 56 and count <= 1024 and offset + size * count <= info.st_size, "ELF 程序头无效")
        headers = os.pread(descriptor, size * count, offset)
        require(len(headers) == size * count and any(struct.unpack_from("<I", headers, i * size)[0] == 3
                                                    for i in range(count)), "静态应用不能加载剪贴板代理")
    finally:
        os.close(descriptor)
    return {"image": str(resolved), "sha256": digest(resolved)}

def library_valid():
    secure_directory(LIBRARY.parent)
    manifest = json.loads(read_bytes(LIBRARY.parent / "library.json"))
    require(manifest["build"] == BUILD and manifest["version"] == 1 and DIGEST.fullmatch(manifest["sha256"])
            and digest(LIBRARY) == manifest["sha256"], "原生剪贴板代理摘要不符")
    return manifest["sha256"]

def rule_bytes(rule, build, generation, enabled=True):
    require(set(rule) == {"copy", "paste", "files", "sensitive", "maxTextBytes"}
            and all(type(rule[key]) is bool for key in ["copy", "paste", "files", "sensitive"])
            and type(rule["maxTextBytes"]) is int and 1024 <= rule["maxTextBytes"] <= 1048576
            and DIGEST.fullmatch(build), "剪贴板规则无效")
    flags = (int(rule["copy"]) | int(rule["paste"]) << 1 | int(rule["files"]) << 2 |
             int(rule["sensitive"]) << 3 | (16 if enabled else 0))
    return struct.pack("<IIIIQ65s39x", MAGIC, 1, flags, rule["maxTextBytes"], generation, build.encode())

def process(pid):
    root = Path("/proc") / str(pid)
    raw = (root / "stat").read_text()
    fields = raw[raw.rfind(")") + 2:].split()
    if fields[0] == "Z":
        return None
    return {"pid": pid, "created": fields[19], "uid": root.stat().st_uid,
            "image": os.readlink(root / "exe"), "network": os.readlink(root / "ns/net")}

def cgroup_path(owner, session):
    return Path("/sys/fs/cgroup") / ("sakura-clipboard-" + owner.replace("-", "") + "-" + session.replace("-", ""))

def cgroup_root():
    root = secure_directory(Path("/sys/fs/cgroup"))
    mounts = [line.split() for line in Path("/proc/self/mountinfo").read_text().splitlines()]
    require(any(row[4] == str(root) and row[row.index("-") + 1] == "cgroup2" for row in mounts)
            and (root / "cgroup.controllers").is_file(), "需要可写的 cgroup v2 以管理应用及其子进程")
    require(os.access(root, os.W_OK), "客户机 cgroup v2 挂载不可写")
    return root

def project_network(request):
    project = request["projectId"]
    require(re.fullmatch(r"default|[a-f0-9]{16}", project), "项目身份无效")
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
        # A bind-mounted netns FD displays its mount path in /proc/self/fd.
        # setns validates the namespace type; its inode pins the actual object.
        expected = "net:[" + str(info.st_ino) + "]"
        libc = ctypes.CDLL(None, use_errno=True)
        libc.setns.argtypes = [ctypes.c_int, ctypes.c_int]
        require(libc.setns(descriptor, 0x40000000) == 0, "无法进入项目网络空间")
        require(os.readlink("/proc/self/ns/net") == expected, "项目网络空间身份不符")
    finally:
        os.close(descriptor)
    # Check the namespace we actually joined, without a second mount switch.
    def ip(*args):
        program = "/usr/sbin/ip" if Path("/usr/sbin/ip").is_file() else "/sbin/ip"
        result = subprocess.run([program, *args], capture_output=True, timeout=5, check=True)
        require(len(result.stdout) <= 65536, "项目网络信息过大")
        return result.stdout.decode().strip()
    links = ip("-o", "link", "show").splitlines()
    require(len(links) == 1 and re.match(r"[0-9]+: lo:", links[0])
            and not ip("-o", "-4", "route", "show") and not ip("-o", "-6", "route", "show"),
            "项目网络已有额外接口或路由，拒绝启动应用")
    return expected

def metadata(directory, owner):
    secure_directory(directory)
    value = json.loads(read_bytes(directory / "session.json"))
    require(value["version"] == 1 and value["owner"] == owner and value["id"] == directory.name
            and UUID.fullmatch(value["id"]) and DIGEST.fullmatch(value["build"])
            and DIGEST.fullmatch(value["sha256"]) and DIGEST.fullmatch(value["librarySha256"])
            and value["library"] == "/usr/local/lib/sakura-x11-clipboard/" + value["build"] + "/libSakuraClipboard.so"
            and type(value["uid"]) is int and value["uid"] >= 1000,
            "应用会话身份不符")
    return value

def view(directory, owner):
    value = metadata(directory, owner)
    group = cgroup_path(owner, value["id"])
    rows, errors = [], []
    if group.exists():
        secure_directory(group)
        for item in (group / "cgroup.procs").read_text().split():
            try:
                row = process(int(item))
                if not row:
                    continue
                require(row["uid"] == value["uid"] and row["network"] == value["network"], "应用进程用户或网络空间不符")
                maps = (Path("/proc") / item / "maps").read_text()
                membership = (Path("/proc") / item / "cgroup").read_text().splitlines()
                require("0::/" + group.name in membership and process(int(item))["created"] == row["created"],
                        "应用进程身份或 cgroup 已变化")
                row["loaded"] = any(line.split(maxsplit=5)[-1] in [value["library"], value["library"] + " (deleted)"]
                                    for line in maps.splitlines())
                del row["uid"]
                del row["network"]
                rows.append(row)
            except (FileNotFoundError, ProcessLookupError):
                continue
            except Exception as error:
                errors.append(str(error))
    raw = read_bytes(directory / "policy", 128)
    magic, version, flags, maximum, generation, build = struct.unpack("<IIIIQ65s39x", raw)
    status = struct.unpack("<IIQQQ65s31x", read_bytes(directory / "status", 128))
    require(magic == MAGIC and version == 1 and flags <= 31 and 1024 <= maximum <= 1048576
            and 1 <= generation < 2**53 and build.rstrip(b"\0").decode() == value["build"]
            and status[0] == MAGIC and status[1] == 1 and status[5].rstrip(b"\0").decode() == value["build"], "策略或统计文件身份不符")
    controlled = status[2] > 0 and any(row["loaded"] and row["image"] == value["image"] for row in rows)
    if any(not row["loaded"] for row in rows):
        errors.append("部分进程未加载原生剪贴板代理，请停止并重新启动应用")
    return {"id": value["id"], "image": value["image"], "sha256": value["sha256"], "projectId": value["projectId"],
            "directory": value["directory"], "startedAt": value["startedAt"], "processes": rows,
            "state": "error" if errors or (rows and not controlled) else "running" if controlled else "stopped",
            "compatible": value["build"] == BUILD, "active": bool(flags & 16), "generation": generation,
            "rule": {"copy": bool(flags & 1), "paste": bool(flags & 2), "files": bool(flags & 4),
                     "sensitive": bool(flags & 8), "maxTextBytes": maximum},
            "blockedCopy": status[3], "blockedPaste": status[4],
            **({"error": "; ".join(errors) or "应用已退出或剪贴板代理未加载，请停止并重新启动"} if errors or (rows and not controlled) else {})}

def stop(directory, owner):
    value = metadata(directory, owner)
    group = cgroup_path(owner, value["id"])
    if not group.exists():
        return {"stopped": True}
    secure_directory(group)
    if not (group / "cgroup.procs").read_text().strip():
        group.rmdir()
        return {"stopped": True}
    for pid in (group / "cgroup.procs").read_text().split():
        try:
            row = process(int(pid))
            require(not row or row["uid"] == value["uid"], "会话包含其他用户的进程，拒绝清理")
        except (FileNotFoundError, ProcessLookupError):
            pass
    require((group / "cgroup.kill").exists(), "内核不能可靠清理应用进程组")
    (group / "cgroup.kill").write_text("1")
    for _ in range(100):
        if not (group / "cgroup.procs").read_text().strip():
            group.rmdir()
            return {"stopped": True}
        time.sleep(.05)
    raise RuntimeError("应用进程组仍未停止")

def desktop_environment(network, expected, launcher):
    require(DIGEST.fullmatch(launcher) and digest(Path("/usr/local/libexec/sakura-desktop-launcher")) == launcher,
            "桌面项目启动绑定已变化")
    user = pwd.getpwnam("sakura-desktop")
    require(user.pw_uid >= 1000 and user.pw_gid >= 1000 and user.pw_dir == "/home/sakura-desktop", "桌面账户身份不符")
    runtime = Path("/run/sakura-desktop")
    info = runtime.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == user.pw_uid and not info.st_mode & 0o077,
            "桌面运行目录身份不符")
    authority = runtime / "Xauthority"
    info = authority.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == user.pw_uid and not info.st_mode & 0o077
            and (runtime / "ready").is_file(), "桌面 X11 凭据未就绪")
    candidates = []
    for root in Path("/proc").iterdir():
        if not root.name.isdigit():
            continue
        try:
            row = process(int(root.name))
            if row and row["uid"] == user.pw_uid and row["image"] == "/usr/bin/plasmashell":
                require(row["network"] == network, "桌面与应用项目的网络空间不符")
                candidates.append(root)
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    require(len(candidates) == 1, "桌面会话不是唯一的已就绪 Plasma 会话")
    raw = (candidates[0] / "environ").read_bytes()
    require(len(raw) <= 1048576, "桌面环境过大")
    source = dict(entry.decode().split("=", 1) for entry in raw.split(b"\0") if b"=" in entry)
    require(isinstance(expected, dict) and len(expected) <= 256, "项目环境摘要无效")
    values = {}
    for key, value in expected.items():
        require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", key) and DIGEST.fullmatch(value)
                and not re.match(r"^(LD_|SAKURA_CLIPBOARD_|HOME$|USER$|LOGNAME$|DISPLAY$|XAUTHORITY$|DBUS_|WAYLAND_|XDG_|SESSION_MANAGER$|PATH$)", key),
                "项目环境包含受保护的运行设置")
        require(key in source and hashlib.sha256(source[key].encode()).hexdigest() == value,
                "项目环境或私密配置已变化，请停止并重新启动桌面")
        values[key] = source[key]
    for key in ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "XDG_DATA_DIRS", "XDG_CONFIG_HOME"]:
        if key in source:
            values[key] = source[key]
    runtime_path = source.get("XDG_RUNTIME_DIR")
    if runtime_path:
        info = Path(runtime_path).lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == user.pw_uid and not info.st_mode & 0o077,
                "桌面用户运行目录身份不符")
        values["XDG_RUNTIME_DIR"] = runtime_path
    return user, {**values, "HOME": user.pw_dir, "USER": user.pw_name, "LOGNAME": user.pw_name,
                  "PATH": "/usr/local/bin:/usr/bin:/bin", "SHELL": "/bin/sh", "DISPLAY": ":1",
                  "XAUTHORITY": str(authority), "QT_QPA_PLATFORM": "xcb", "GDK_BACKEND": "x11",
                  "SDL_VIDEODRIVER": "x11", "XDG_SESSION_TYPE": "x11"}

def launch(base, owner, request):
    library_hash = library_valid()
    application = identify(request["image"])
    require(application["image"] == request["image"] and application["sha256"] == request["sha256"], "应用路径或摘要已变化")
    require(isinstance(request["args"], list) and len(request["args"]) <= 32 and
            all(isinstance(value, str) and len(value) <= 1024 and not re.search(r"[\x00-\x1f]", value) for value in request["args"]), "应用参数无效")
    cgroup_root()
    network = project_network(request)
    user, environment = desktop_environment(network, request["environment"], request["launcherSha256"])
    require(isinstance(request["directory"], str) and Path(request["directory"]).is_absolute()
            and Path(request["directory"]).resolve(strict=True).is_dir(), "项目目录不可用")
    policy = rule_bytes(request["rule"], BUILD, request["generation"])
    require(sum(bool(UUID.fullmatch(path.name)) for path in base.iterdir()) < 128,
            "请先清理已停止的应用会话")
    session = request["id"]
    require(UUID.fullmatch(session), "应用会话标识无效")
    directory = base / session
    directory.mkdir(mode=0o755)
    group = cgroup_path(owner, session)
    value = {"version": 1, "owner": owner, "id": session, "image": application["image"], "sha256": application["sha256"],
             "uid": user.pw_uid, "build": BUILD, "library": str(LIBRARY), "librarySha256": library_hash,
             "directory": request["directory"], "projectId": request["projectId"], "network": network,
             "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    atomic(directory / "session.json", json.dumps(value).encode())
    atomic(directory / "policy", policy, 0o644)
    atomic(directory / "status", struct.pack("<IIQQQ65s31x", MAGIC, 1, 0, 0, 0, BUILD.encode()))
    descriptor = os.open(directory / "status", os.O_RDWR | os.O_NOFOLLOW)
    environment.update(LD_PRELOAD=str(LIBRARY), SAKURA_CLIPBOARD_POLICY=str(directory / "policy"),
                       SAKURA_CLIPBOARD_STATUS_FD=str(descriptor))
    # A private bus prevents forwarding to an uninstrumented, existing app.
    def child():
        (group / "cgroup.procs").write_text(str(os.getpid()))
        require(ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0) == 0, "无法禁用提权")
        os.setgroups([])
        os.setgid(user.pw_gid)
        os.setuid(user.pw_uid)
    application_descriptor = -1
    try:
        group.mkdir(mode=0o755)
        require((group / "cgroup.kill").exists(), "需要支持 cgroup.kill 的 Linux 内核")
        bus = subprocess.Popen(["/usr/bin/dbus-daemon", "--session", "--nofork", "--nopidfile", "--print-address=1"],
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               env=environment, cwd=request["directory"], preexec_fn=child,
                               start_new_session=True, pass_fds=[descriptor])
        try:
            readable, _, _ = select.select([bus.stdout], [], [], 5)
            require(readable, "应用私有 D-Bus 未就绪")
            address = bus.stdout.readline(4096).strip().decode()
            require(address.startswith("unix:") and len(address) < 4095 and not re.search(r"[\x00-\x1f]", address), "应用私有 D-Bus 地址无效")
        finally:
            bus.stdout.close()
        environment["DBUS_SESSION_BUS_ADDRESS"] = address
        application_descriptor = os.open(application["image"], os.O_RDONLY | os.O_NOFOLLOW)
        require(digest_fd(application_descriptor) == application["sha256"], "应用在启动前已变化")
        subprocess.Popen([application["image"], *request["args"]], executable="/proc/self/fd/" + str(application_descriptor),
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         env=environment, cwd=request["directory"], preexec_fn=child, start_new_session=True,
                         pass_fds=[descriptor, application_descriptor])
        for _ in range(100):
            result = view(directory, owner)
            if result["state"] == "running":
                return result
            time.sleep(.05)
        stop(directory, owner)
        raise RuntimeError("应用未成功加载剪贴板代理，已停止本次进程组")
    except Exception:
        stop(directory, owner)
        raise
    finally:
        if application_descriptor >= 0:
            os.close(application_descriptor)
        os.close(descriptor)

def readiness():
    try:
        cgroup_root()
        return {"ready": bool(LIBRARY.exists()) and bool(library_valid()), "build": BUILD}
    except Exception as error:
        return {"ready": False, "build": BUILD, "error": str(error)[:256]}

def main(request):
    require(os.geteuid() == 0 and DIGEST.fullmatch(BUILD), "需要已校验的客户机原生控制器")
    require(UUID.fullmatch(request["owner"]), "控制服务身份无效")
    owner = request["owner"]
    readonly = request["action"] == "list"
    try:
        secure_directory(BASE, create=not readonly)
        base = secure_directory(BASE / owner, create=not readonly)
    except FileNotFoundError:
        if readonly:
            return {**readiness(), "sessions": []}
        raise
    descriptor = os.open(base / "lock", (os.O_RDONLY if readonly else os.O_CREAT | os.O_RDWR) | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077, "会话锁身份或权限不符")
        fcntl.flock(descriptor, fcntl.LOCK_SH if readonly else fcntl.LOCK_EX)
        action = request["action"]
        if action == "identify":
            return identify(request["image"])
        if action == "list":
            sessions = []
            for directory in sorted(base.iterdir()):
                if not UUID.fullmatch(directory.name):
                    continue
                try:
                    sessions.append(view(directory, owner))
                except Exception as error:
                    sessions.append({"id": directory.name, "state": "error", "error": str(error)[:256]})
            return {**readiness(), "sessions": sessions[-128:]}
        if action == "launch":
            require(type(request["generation"]) is int and 1 <= request["generation"] < 2**53, "策略版本无效")
            return launch(base, owner, request)
        require(action in ["configure", "stop", "forget"] and UUID.fullmatch(request["id"]), "应用操作无效")
        directory = base / request["id"]
        if action in ["stop", "forget"]:
            try:
                directory.lstat()
            except FileNotFoundError:
                return {"stopped": True}
        value = metadata(directory, owner)
        if action == "stop":
            return stop(directory, owner)
        if action == "forget":
            stop(directory, owner)
            require(all(path.name in ["session.json", "policy", "status"] for path in directory.iterdir()),
                    "会话目录包含未知文件，拒绝清理")
            for path in directory.iterdir():
                read_bytes(path)
                path.unlink()
            directory.rmdir()
            return {"removed": True}
        require(type(request["enabled"]) is bool and type(request["generation"]) is int
                and 1 <= request["generation"] < 2**53, "策略版本无效")
        require(not request["enabled"] or value["build"] == BUILD, "原生代理版本已变化，请停止并重新启动应用")
        atomic(directory / "policy", rule_bytes(request["rule"], value["build"], request["generation"], request["enabled"]), 0o644)
        return view(directory, owner)
    finally:
        os.close(descriptor)

if __name__ == "__main__":
    try:
        require(len(sys.argv) == 2 and len(sys.argv[1]) <= 65536, "原生请求过大")
        request = json.loads(base64.b64decode(sys.argv[1], validate=True))
        result = main(request)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    except Exception as error:
        print(json.dumps({"error": str(error)[:256]}, ensure_ascii=False))
        sys.exit(1)
