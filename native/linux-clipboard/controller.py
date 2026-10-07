# X11 应用的 root 控制面：校验源摘要、桌面来源和项目网络，发布策略并管理本次应用的 cgroup 生命周期。
# Root control plane for X11 applications: verify source hashes/desktop provenance/project networks, publish policy and manage the exact application cgroup lifecycle.
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

# 条件失败立即报告控制错误，阻止后续授权或资源变更。
# Raise the control error immediately when a condition fails, preventing further authorization/resource mutation.
def require(condition, message):
    if not condition:
        raise RuntimeError(message)

# 逐级检查绝对目录的 root 所有权与不可写权限；仅明确 create 模式创建目录，拒绝链接替代。
# Check root ownership/nonwritable permissions component by component; create only when explicitly requested and reject link replacements.
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

# 无跟随有界读取 root 控制普通文件，核对实际长度，变化或权限不符拒绝。
# Read a bounded root-controlled regular file without links, checking actual length and refusing changes/unsafe permissions.
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

# 独占创建临时文件，写入并同步后替换目标，再同步父目录；失败仅清理本次临时文件。
# Exclusively create a temporary, write/fsync it, replace the target and sync the parent; failures clean only this temporary.
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

# 从固定 FD 计算有界 SHA-256，前后检查 inode、大小与修改时间，拒绝读取期间变化。
# Hash bounded bytes from a pinned FD and bracket reads with inode/size/mtime checks to reject changes.
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

# 无跟随打开文件并计算固定 FD 摘要，总是关闭描述符。
# Open the file without following links, hash its pinned FD and always close the descriptor.
def digest(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        return digest_fd(descriptor)
    finally:
        os.close(descriptor)

# 规范绝对应用路径，拒绝 setuid/setgid 与文件能力，固定文件并返回映像摘要和物理身份。
# Canonicalize the absolute image, reject setuid/setgid/file capabilities and return pinned image hash/physical identity.
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

# 核对固定原生库清单、构建和 DLL 摘要，返回可发布的库 SHA-256。
# Verify the pinned library manifest/build/hash and return its publishable SHA-256.
def library_valid():
    secure_directory(LIBRARY.parent)
    manifest = json.loads(read_bytes(LIBRARY.parent / "library.json"))
    require(manifest["build"] == BUILD and manifest["version"] == 1 and DIGEST.fullmatch(manifest["sha256"])
            and digest(LIBRARY) == manifest["sha256"], "原生剪贴板代理摘要不符")
    return manifest["sha256"]

# 严格校验方向/格式布尔值和文本预算，再编码含构建与代次的固定策略 ABI。
# Validate direction/format booleans and text budgets, then encode the fixed policy ABI with build/generation.
def rule_bytes(rule, build, generation, enabled=True):
    require(set(rule) == {"copy", "paste", "files", "sensitive", "maxTextBytes"}
            and all(type(rule[key]) is bool for key in ["copy", "paste", "files", "sensitive"])
            and type(rule["maxTextBytes"]) is int and 1024 <= rule["maxTextBytes"] <= 1048576
            and DIGEST.fullmatch(build), "剪贴板规则无效")
    flags = (int(rule["copy"]) | int(rule["paste"]) << 1 | int(rule["files"]) << 2 |
             int(rule["sensitive"]) << 3 | (16 if enabled else 0))
    return struct.pack("<IIIIQ65s39x", MAGIC, 1, flags, rule["maxTextBytes"], generation, build.encode())

# 读取内核创建 ticks、UID、映像与网络身份，退出进程返回 None，供精确归属检查。
# Read kernel birth ticks, UID, image and network identity; exited processes return None for ownership checks.
def process(pid):
    root = Path("/proc") / str(pid)
    raw = (root / "stat").read_text()
    fields = raw[raw.rfind(")") + 2:].split()
    if fields[0] == "Z":
        return None
    return {"pid": pid, "created": fields[19], "uid": root.stat().st_uid,
            "image": os.readlink(root / "exe"), "network": os.readlink(root / "ns/net")}

# 将服务 owner 和会话 UUID 编入固定应用 cgroup 名称，隔离不同启动的运行域。
# Derive a fixed application cgroup from service owner/session UUID to isolate launch domains.
def cgroup_path(owner, session):
    return Path("/sys/fs/cgroup") / ("sakura-clipboard-" + owner.replace("-", "") + "-" + session.replace("-", ""))

# 核实可信、可写的 cgroup v2 根挂载，缺少真实挂载或控制器支持拒绝运行。
# Verify the trusted writable cgroup-v2 root; absent real mount/controller support refuses execution.
def cgroup_root():
    root = secure_directory(Path("/sys/fs/cgroup"))
    mounts = [line.split() for line in Path("/proc/self/mountinfo").read_text().splitlines()]
    require(any(row[4] == str(root) and row[row.index("-") + 1] == "cgroup2" for row in mounts)
            and (root / "cgroup.controllers").is_file(), "需要可写的 cgroup v2 以管理应用及其子进程")
    require(os.access(root, os.W_OK), "客户机 cgroup v2 挂载不可写")
    return root

# 核对项目 ID 与固定 netns 名称，检查内核命名空间及路由后返回应用网络身份。
# Validate project ID/fixed netns name and kernel namespace/routes before returning application network identity.
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
    # 执行固定系统 ip 工具并限制时间与输出，返回已核实网络诊断文本。
    # Run the fixed system ip tool with time/output bounds and return verified network diagnostic text.
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

# 读取可信会话收据，核对 owner、会话 UUID、构建/源摘要和原桌面证明，拒绝其他会话或替代资源。
# Read a trusted receipt and validate owner/session/build/source hashes and original desktop proof, refusing other sessions/replacements.
def metadata(directory, owner):
    secure_directory(directory)
    value = json.loads(read_bytes(directory / "session.json"))
    require(value["version"] == 2 and isinstance(value.get("desktop"), dict) and value["owner"] == owner and value["id"] == directory.name
            and UUID.fullmatch(value["id"]) and DIGEST.fullmatch(value["build"])
            and DIGEST.fullmatch(value["sha256"]) and DIGEST.fullmatch(value["librarySha256"])
            and value["library"] == "/usr/local/lib/sakura-x11-clipboard/" + value["build"] + "/libSakuraClipboard.so"
            and type(value["uid"]) is int and value["uid"] >= 1000,
            "应用会话身份不符")
    require(value['desktop']['identity']['uid'] == value['uid'] and value['desktop']['identity']['projectId'] == value['projectId']
            and value['desktop']['run']['bootId'] == value['bootId'], '应用实际 UID 与原 Desktop owner 不符')
    return value

# 读取原会话及精确 cgroup 中进程，返回策略/身份观察和有界错误，不收养未知进程。
# Observe the original session/exact-cgroup processes and return policy/identity/errors without adopting unknown processes.
def view(directory, owner):
    value = metadata(directory, owner)
    group = cgroup_path(owner, value["id"])
    rows, errors = [], []
    domain = application_group(group, value)
    if domain is not None:
        os.close(domain)
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
            "desktopOwner": {"projectId": value['projectId'], "uid": value['desktop']['identity']['uid'], "runId": value['desktop']['run']['runId']},
            "applicationOwner": {"uid": value['uid'], "kind": 'project-desktop'},
            "blockedCopy": status[3], "blockedPaste": status[4],
            **({"error": "; ".join(errors) or "应用已退出或剪贴板代理未加载，请停止并重新启动"} if errors or (rows and not controlled) else {})}

# 根据原会话收据退休精确应用 cgroup，成功返回 stopped。
# Retire the exact application cgroup from its original receipt and return stopped on success.
def stop(directory, owner):
    value = metadata(directory, owner)
    application_retire(cgroup_path(owner, value['id']), value, value['uid'], value['network'])
    return {'stopped': True}

# Shared verbatim by the fixed Desktop adapter and both Linux clipboard controllers.
# This file is a draft generator input, not a guest-installed authority record.

# 将暂未就绪条件转换为带固定前缀的可重试桌面错误。
# Convert an unready condition into a retryable desktop error with a fixed prefix.
def desktop_wait(condition, reason):
    if not condition: raise RuntimeError('SAKURA_DESKTOP_NOT_READY:' + reason)

# 核实原项目桌面的内层 XWayland display 与私有 Xauthority，拒绝宿主共享 display 或替代凭据。
# Validate the original project desktop’s nested XWayland display/private Xauthority, excluding shared displays/replaced credentials.
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
# 加载固定摘要目录的原生身份实现，逐项核实源文件及聚合摘要后提供校验函数。
# Load native identity code from its fixed digest directory only after source/aggregate hash validation.
def desktop_native(build):
    require(isinstance(build, str) and re.fullmatch('[a-f0-9]{64}', build), 'Desktop native build 无效')
    folder = Path('/usr/local/lib/sakura-project-identity') / build
    secure_directory(folder)
    # 无跟随读取单链接 0600 root 文件并限制大小，读取长度变化拒绝。
    # Read a bounded single-link 0600 root file without links and refuse changed read length.
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

# 核实活动桌面进程的真实 UID 槽、创建 ticks、cgroup 及网络归属。
# Verify a live desktop process’s UID slots, birth ticks, cgroup and network ownership.
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

# 交叉核实完整桌面票据、绑定/运行记录、Plasma 进程和私有运行目录；返回持有目录 FD 的可信上下文。
# Cross-check complete desktop receipts, binding/run records, Plasma process and private runtime, returning a trusted context with pinned directory FD.
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
        # 读取项目桌面私有凭据，核实 UID、单链接、权限和字节上限，真实未就绪按桌面状态报告。
        # Read private desktop credentials with UID/link/mode/size checks, reporting genuine unready state through desktop errors.
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
# 按收据的原设备/inode 与 boot 打开应用 cgroup，缺少原证明仅允许真正不存在，替代域不接管。
# Open the application cgroup by recorded device/inode/boot; missing proof allows only actual absence, never replacement adoption.
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

# 固定可信 cgroup 并返回其设备/inode 收据，总是关闭观察 FD。
# Pin a trusted cgroup and return its device/inode receipt, always closing the observation FD.
def group_proof(group):
    secure_directory(group)
    fd = os.open(group, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        return {'device': str(info.st_dev), 'inode': str(info.st_ino)}
    finally: os.close(fd)

# 将当前子进程加入已固定 cgroup，随后关闭管理 FD，避免泄露给应用。
# Join the pinned cgroup in the child, then close management FDs before application execution.
def application_join(domain):
    fd = os.open('cgroup.procs', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=domain)
    try: os.write(fd, str(os.getpid()).encode())
    finally: os.close(fd); os.close(domain)

# 核对原运行域及全部成员的 UID/网络，结束精确 cgroup 并等待空域；未知成员或 inode 变化拒绝。
# Verify the original domain and all member UID/network identities, terminate the exact cgroup and await emptiness; unknown members/replacements refuse.
def application_retire(group, value, uid, network, field='cgroup'):
    domain = application_group(group, value, field)
    if domain is None: return
    # 相对原 cgroup FD 有界读取控制字段，拒绝超限并关闭读 FD。
    # Read bounded control fields relative to the original cgroup FD, refusing excess and closing the read FD.
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

# 用原完整桌面票据筛选并停止所属应用会话，有界遍历且不按项目名称接管其他运行。
# Select/stop application sessions using the original complete desktop receipt with bounded traversal, never adopting by project name.
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

# 由完整桌面证明构建受限环境，固定原网络、私有凭据和项目目录，不使用任意 root 环境。
# Build bounded environment from complete desktop proof, pinning network/private credentials/project directory rather than arbitrary root environment.
def desktop_environment(network, expected, proof):
    checked = desktop_authority(proof)
    try:
        user, runtime, source = checked['user'], checked['runtime'], checked['source']
        require(os.readlink('/proc/'+str(checked['plasma']['pid'])+'/ns/net') == network, 'Desktop 与应用项目的原网络空间不符')
        authority = source['XAUTHORITY']
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
                      "PATH": "/usr/local/bin:/usr/bin:/bin", "SHELL": "/bin/sh", "DISPLAY": source['DISPLAY'],
                      "XAUTHORITY": authority, "QT_QPA_PLATFORM": "xcb", "GDK_BACKEND": "x11",
                      "SDL_VIDEODRIVER": "x11", "XDG_SESSION_TYPE": "x11"}, checked

    except BaseException:
        os.close(checked["directoryFd"]); raise

# 启动仅接受明确选择且核实过的应用/桌面，在自身运行域注入策略，不接管已有连接。
# 重核应用/库摘要、参数、原桌面与网络；先发布会话/cgroup 身份再以项目 UID 启动，失败停止本次域。
# Revalidate image/library/args/desktop/network, publish session/cgroup identity before project-UID launch and stop the owned domain on failure.
def launch(base, owner, request):
    library_hash = library_valid()
    application = identify(request["image"])
    require(application["image"] == request["image"] and application["sha256"] == request["sha256"], "应用路径或摘要已变化")
    require(isinstance(request["args"], list) and len(request["args"]) <= 32 and
            all(isinstance(value, str) and len(value) <= 1024 and not re.search(r"[\x00-\x1f]", value) for value in request["args"]), "应用参数无效")
    cgroup_root()
    network = project_network(request)
    user, environment, checked = desktop_environment(network, request["environment"], request.get("desktop"))
    require(request['directory'] == checked['identity']['directory'] and request['projectId'] == checked['identity']['projectId'], '应用项目目录与原 Desktop 票据不符')
    policy = rule_bytes(request["rule"], BUILD, request["generation"])
    require(sum(bool(UUID.fullmatch(path.name)) for path in base.iterdir()) < 128,
            "请先清理已停止的应用会话")
    session = request["id"]
    require(UUID.fullmatch(session), "应用会话标识无效")
    directory = base / session
    directory.mkdir(mode=0o755)
    group = cgroup_path(owner, session)
    value = {"version": 2, "owner": owner, "id": session, "image": application["image"], "sha256": application["sha256"],
             "uid": user.pw_uid, "build": BUILD, "library": str(LIBRARY), "librarySha256": library_hash,
             "directory": request["directory"], "projectId": request["projectId"], "network": network,
             "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "desktop": request['desktop'],
             "bootId": request['desktop']['run']['bootId'], "cgroup": None}
    atomic(directory / "session.json", json.dumps(value).encode())
    atomic(directory / "policy", policy, 0o644)
    atomic(directory / "status", struct.pack("<IIQQQ65s31x", MAGIC, 1, 0, 0, 0, BUILD.encode()))
    descriptor = os.open(directory / "status", os.O_RDWR | os.O_NOFOLLOW)
    environment.update(LD_PRELOAD=str(LIBRARY), SAKURA_CLIPBOARD_POLICY=str(directory / "policy"),
                       SAKURA_CLIPBOARD_STATUS_FD=str(descriptor))
    # A private bus prevents forwarding to an uninstrumented, existing app.
    # 加入原应用域，设置 NNP、清空补充组并降为项目账号，再进入已固定项目目录。
    # Join the original application domain, set NNP, clear groups/drop to the project account and enter the pinned directory.
    def child():
        application_join(group_descriptor)
        require(ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0) == 0, "无法禁用提权")
        os.setgroups([])
        os.setgid(user.pw_gid)
        os.setuid(user.pw_uid)
        os.fchdir(checked["directoryFd"])
        os.close(checked["directoryFd"])
    group_descriptor = -1
    application_descriptor = -1
    try:
        group.mkdir(mode=0o755)
        value['cgroup'] = group_proof(group)
        group_descriptor = application_group(group, value)
        atomic(directory / 'session.json', json.dumps(value).encode())
        require((group / "cgroup.kill").exists(), "需要支持 cgroup.kill 的 Linux 内核")
        bus = subprocess.Popen(["/usr/bin/dbus-daemon", "--session", "--nofork", "--nopidfile", "--print-address=1"],
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               env=environment, cwd=None, preexec_fn=child,
                               start_new_session=True, pass_fds=[descriptor, checked["directoryFd"], group_descriptor])
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
                         env=environment, cwd=None, preexec_fn=child, start_new_session=True,
                         pass_fds=[descriptor, application_descriptor, checked["directoryFd"], group_descriptor])
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
        if group_descriptor >= 0: os.close(group_descriptor)
        if application_descriptor >= 0:
            os.close(application_descriptor)
        os.close(descriptor)
        os.close(checked["directoryFd"])

# 检查 cgroup 与已校验原生资产，返回 ready/build 或有界错误详情，能力观察不等于启动成功。
# Check cgroup/validated native assets and return ready/build or bounded errors; capability observation is not launch success.
def readiness():
    try:
        cgroup_root()
        return {"ready": bool(LIBRARY.exists()) and bool(library_valid()), "build": BUILD}
    except Exception as error:
        return {"ready": False, "build": BUILD, "error": str(error)[:256]}

# 核实 root/构建与 owner，按只读或写入动作取得会话锁并路由准入、策略、列举和停止。
# Validate root/build/owner, acquire the action-appropriate session lock and route admission/policy/list/stop operations.
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
        if action == "stop-desktop":
            return retire_desktop(base, owner, request["desktop"])
        if action == "launch":
            require(type(request["generation"]) is int and 1 <= request["generation"] < 2**53, "策略版本无效")
            return launch(base, owner, request)
        require(action in ["configure", "stop", "forget"] and UUID.fullmatch(request["id"]), "应用操作无效")
        directory = base / request["id"]
        if action in ["stop", "forget"]:
            try:
                directory.lstat()
            except FileNotFoundError:
                require(not cgroup_path(owner, request["id"]).exists(), "缺少原记录但应用域仍存在，拒绝清理或确认")
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
