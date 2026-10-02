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
    require(value["version"] == 2 and isinstance(value.get("desktop"), dict) and value["owner"] == owner and value["id"] == directory.name
            and UUID.fullmatch(value["id"]) and DIGEST.fullmatch(value["build"])
            and DIGEST.fullmatch(value["sha256"]) and DIGEST.fullmatch(value["librarySha256"])
            and value["library"] == "/usr/local/lib/sakura-x11-clipboard/" + value["build"] + "/libSakuraClipboard.so"
            and type(value["uid"]) is int and value["uid"] >= 1000,
            "应用会话身份不符")
    require(value['desktop']['identity']['uid'] == value['uid'] and value['desktop']['identity']['projectId'] == value['projectId']
            and value['desktop']['run']['bootId'] == value['bootId'], '应用实际 UID 与原 Desktop owner 不符')
    return value

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

def stop(directory, owner):
    value = metadata(directory, owner)
    application_retire(cgroup_path(owner, value['id']), value, value['uid'], value['network'])
    return {'stopped': True}

# Shared verbatim by the fixed Desktop adapter and both Linux clipboard controllers.
# This file is a draft generator input, not a guest-installed authority record.
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
            fd = os.open(runtime / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
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
        require(len(candidates) == 1 and len(servers) == 1, '需要原完整域中唯一就绪的 Plasma/Xvnc')
        plasma, vnc = candidates[0], servers[0]
        raw = (Path('/proc') / str(plasma['pid']) / 'environ').read_bytes()
        require(len(raw) <= 1048576, 'Desktop 环境过大')
        source = dict(entry.decode().split('=', 1) for entry in raw.split(b'\0') if b'=' in entry)
        require(source.get('HOME') == identity['home'] and source.get('USER') == identity['account']
                and source.get('DISPLAY') == ':1' and source.get('XDG_RUNTIME_DIR') == str(runtime)
                and source.get('XAUTHORITY') == str(runtime / 'Xauthority'), 'Desktop 原 UID/environment authority 不符')
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

def desktop_environment(network, expected, proof):
    checked = desktop_authority(proof)
    try:
        user, runtime, source = checked['user'], checked['runtime'], checked['source']
        require(os.readlink('/proc/'+str(checked['plasma']['pid'])+'/ns/net') == network, 'Desktop 与应用项目的原网络空间不符')
        authority = runtime / 'Xauthority'
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
                      "SDL_VIDEODRIVER": "x11", "XDG_SESSION_TYPE": "x11"}, checked

    except BaseException:
        os.close(checked["directoryFd"]); raise

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
