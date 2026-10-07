# Wayland 消息和 FD 代理：仅暴露已固定的协议，核实会话对端，并在 EOF 与完整内容检查后释放有预算限制的剪贴板数据。
# Proxy only pinned Wayland protocols/FDs, verify session peers and release clipboard bytes only after EOF/full-body checks under explicit budgets and commit locks.
"""Wayland wire/FD proxy for one explicitly owned application session.

Clipboard bytes stay in bounded private memory until EOF and a complete check.
Only pinned, understood protocols are exposed; this is not a compositor, a
portal service, or a way to attach an existing Wayland connection.
"""
import array
from collections import deque
from dataclasses import dataclass, field
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import socket
import stat
import struct
import sys
import time
import uuid
import xml.etree.ElementTree as ET

if os.name == "posix":
    import fcntl
else:
    fcntl = None  # Pure wire/policy tests also run on the Windows development host.

MAGIC = 0x58434C50
POLICY = struct.Struct("<IIIIQ65s39x")
BUILD = Path(__file__).resolve().parent.name
MAX_CONNECTIONS = 32
MAX_OBJECTS = 8192
MAX_GLOBALS = 4096
MAX_WIRE_BYTES = 524288
MAX_FDS = 128
MAX_TRANSFERS = 32
MAX_BODY = 8388608
MAX_BUDGET = 33554432
COLLECT_SECONDS = .75
RELEASE_SECONDS = 1.0
WIRE_SECONDS = 5.0
ALLOWED_GLOBALS = frozenset([
    "wl_compositor", "wl_subcompositor", "wl_shm", "wl_seat", "wl_output",
    "wl_data_device_manager", "wl_shell", "wl_fixes", "xdg_wm_base",
    "wp_viewporter", "wp_presentation", "wp_fractional_scale_manager_v1",
    "wp_cursor_shape_manager_v1", "xdg_activation_v1",
    "zxdg_decoration_manager_v1", "zxdg_output_manager_v1",
    "zwp_primary_selection_device_manager_v1", "zwp_relative_pointer_manager_v1",
    "zwp_pointer_constraints_v1", "zwp_pointer_gestures_v1",
    "zwp_text_input_manager_v3", "zwp_linux_dmabuf_v1", "zwp_tablet_manager_v2",
])
DATA_OFFERS = frozenset(["wl_data_offer", "zwp_primary_selection_offer_v1"])
DATA_SOURCES = frozenset(["wl_data_source", "zwp_primary_selection_source_v1"])
DATA_DEVICES = frozenset(["wl_data_device", "zwp_primary_selection_device_v1"])
SECRET_PATTERNS = tuple(re.compile(value, re.I) for value in [
    r"-----BEGIN (?:[A-Z0-9]{1,32} )?PRIVATE KEY-----|PuTTY-User-Key-File-[0-9]{1,8}:",
    r"\b(?:gh[pousr]_[A-Za-z0-9_]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|"
    r"sk-(?:proj-)?[A-Za-z0-9_-]{20,255}|xox[baprs]-[A-Za-z0-9-]{10,255})\b",
    r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    r"\beyJ[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{5,4096}\b",
    r"\b[a-z][a-z0-9+.-]{0,31}://[^\s/@:]{1,256}:[^\s/@]{1,256}@",
    r"\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key)"
    r"[\"']?\s{0,128}[:=]\s{0,128}[\"']?[^\s\"'`]{12}",
])


# 条件失败终止当前 wire/授权处理，避免继续转发不完整证明。
# Abort wire/authorization processing on failed conditions rather than forwarding incomplete proof.
def require(condition, message):
    if not condition:
        raise RuntimeError(message)


# 尽力关闭已持有 FD，清理阶段容忍已经关闭的描述符。
# Best-effort close held FDs, tolerating already-closed descriptors during cleanup.
def close_fd(fd):
    try:
        os.close(fd)
    except OSError:
        pass


# 逐级无跟随核实绝对目录 root 所有权与不可写权限。
# Validate absolute directories componentwise without links for root ownership/nonwritable modes.
def secure_directory(path):
    path = Path(path)
    require(path.is_absolute(), "Directory must be absolute")
    current = Path("/")
    for part in path.parts[1:]:
        current /= part
        info = current.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                "Controller directory identity changed")
    return path


# 固定 root 普通文件并有界读取，前后核对大小/身份/修改信息，拒绝策略读取期间替换。
# Pin/read bounded root regular files with bracketed identity/size/mtime checks to reject policy changes during reading.
def protected_bytes(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and not before.st_mode & 0o022
                and before.st_size <= maximum, "Protected file identity changed")
        result = bytearray()
        while len(result) <= maximum:
            part = os.read(fd, min(65536, maximum + 1 - len(result)))
            if not part:
                break
            result.extend(part)
        after = os.fstat(fd)
        require(len(result) == before.st_size and (before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_ino, after.st_size, after.st_mtime_ns), "Protected file changed during read")
        return bytes(result)
    finally:
        close_fd(fd)


# 读取活动进程的内核创建、父 PID、UID、映像、网络和 cgroup，退出进程拒绝。
# Read a live process’s kernel birth/parent/UID/image/network/cgroup, refusing exited processes.
def process_identity(pid):
    directory = Path("/proc") / str(pid)
    raw = (directory / "stat").read_bytes()
    fields = raw[raw.rfind(b")") + 2:].split()
    require(len(fields) >= 20 and fields[0] not in (b"Z", b"X"), "Process has exited")
    return {"pid": pid, "created": fields[19].decode("ascii"), "parent": int(fields[1]),
            "image": os.readlink(directory / "exe"), "uid": directory.stat().st_uid,
            "network": os.readlink(directory / "ns/net"),
            "cgroup": (directory / "cgroup").read_text().splitlines()}


# 有界解析 UNIX socket 表，要求目标路径恰有一个活动 listener inode。
# Boundedly parse UNIX sockets and require exactly one live listener inode for the endpoint.
def listening_inode(pid, endpoint):
    raw = (Path("/proc") / str(pid) / "net/unix").read_bytes()
    require(len(raw) <= 1048576, "Compositor socket table exceeded")
    matches = []
    for line in raw.splitlines()[1:]:
        fields = line.split(None, 7)
        if len(fields) == 8 and fields[3:6] == [b"00010000", b"0001", b"01"] and fields[7] == os.fsencode(endpoint):
            matches.append(int(fields[6]))
    require(len(matches) == 1 and matches[0] > 0, "Compositor listener identity changed")
    return matches[0]


# 有界枚举真实 FD，确认进程持有目标 socket inode，正常消失可略过。
# Boundedly enumerate actual FDs to prove socket-inode ownership, tolerating normal disappearance.
def owns_socket(pid, inode):
    files = list((Path("/proc") / str(pid) / "fd").iterdir())
    require(len(files) <= 4096, "Compositor descriptor budget exceeded")
    for path in files:
        try:
            if os.readlink(path) == "socket:[" + str(inode) + "]":
                return True
        except FileNotFoundError:
            pass
    return False


@dataclass(frozen=True)
class Rule:
    copy: bool
    paste: bool
    files: bool
    sensitive: bool
    maximum: int
    generation: int

    # 核对策略 ABI、构建、预算和代次，禁用策略按明确开放规则解释，畸形策略拒绝。
    # Validate policy ABI/build/budget/generation, interpret disabled policy as explicit permissive rules and refuse malformed data.
    @classmethod
    def parse(cls, raw, build):
        require(len(raw) == POLICY.size, "Policy length changed")
        magic, version, flags, maximum, generation, actual = POLICY.unpack(raw)
        require(magic == MAGIC and version == 1 and flags <= 31 and 1024 <= maximum <= 1048576
                and 1 <= generation < 2**53 and actual == build.encode() + b"\0",
                "Policy identity changed")
        if not flags & 16:
            return cls(True, True, True, False, MAX_BODY, generation)
        return cls(bool(flags & 1), bool(flags & 2), bool(flags & 4), bool(flags & 8), maximum, generation)

    # 未提交传输仅能收紧，后续放宽策略不能重新授权已经开始收集的受限内容。
    # 合并等待中的策略只收紧：方向/文件取 AND、敏感过滤取 OR、字节上限取更小值。
    # Merge pending policies monotonically: AND permissions, OR sensitive filtering and minimum byte limit.
    def tightened(self, other):
        return Rule(self.copy and other.copy, self.paste and other.paste, self.files and other.files,
                    self.sensitive or other.sensitive, min(self.maximum, other.maximum), other.generation)

    # 按方向、MIME/编码、内容大小与敏感模式决定完整传输是否可放行，portal 文件票据始终拒绝。
    # Decide transfer permission from direction/MIME/encoding/body size/sensitive patterns, always refusing portal file-transfer tickets.
    def permits(self, direction, mime, body=None):
        if not getattr(self, direction):
            return False
        encoding = text_encoding(mime)
        if mime.lower().split(";", 1)[0].strip() == "application/vnd.portal.filetransfer":
            return False
        if encoding is None:
            if mime.lower().split(";", 1)[0].strip() == "text/plain":
                return False
            return self.files and not self.sensitive and (body is None or len(body) <= MAX_BODY)
        if body is None:
            return True
        try:
            text = body.decode(encoding, errors="strict")
        except UnicodeError:
            return False
        return ("\0" not in text and len(text.encode("utf-8")) <= self.maximum and
                (not self.sensitive or not any(pattern.search(text) for pattern in SECRET_PATTERNS)))


# 验证有界 MIME 并解析支持的文本 charset，未知格式或重复/非法参数返回 None。
# Validate bounded MIME and supported text charset, returning None for unknown formats or duplicate/invalid parameters.
def text_encoding(mime):
    if not isinstance(mime, str) or not 1 <= len(mime) <= 256 or re.search(r"[\x00-\x1f\x7f]", mime):
        return None
    name = mime.lower().strip()
    if name in ("utf8_string", "text"):
        return "utf-8"
    if name == "string":
        return "latin-1"
    pieces = name.split(";")
    if pieces[0].strip() != "text/plain":
        return None
    if len(pieces) == 1:
        return "utf-8"
    charset = "utf-8"
    seen = set()
    for piece in pieces[1:]:
        match = re.fullmatch(r'\s*([a-z0-9-]+)\s*=\s*(?:"([a-z0-9-]+)"|([a-z0-9-]+))\s*', piece)
        if not match or match[1] in seen:
            return None
        seen.add(match[1])
        if match[1] == "charset":
            charset = match[2] or match[3]
    return {"utf-8": "utf-8", "utf8": "utf-8", "us-ascii": "ascii", "ascii": "ascii",
            "iso-8859-1": "latin-1"}.get(charset)


@dataclass
class Message:
    name: str
    arguments: tuple
    since: int
    destructor: bool


@dataclass
class Interface:
    version: int
    requests: tuple
    events: tuple


class Protocols:
    # 解析固定 XML 协议，禁止实体/DOCTYPE 与重复接口，并保存请求、事件和版本声明。
    # Parse fixed protocol XML without entities/DOCTYPE or duplicate interfaces, recording request/event/version declarations.
    def __init__(self, documents):
        self.interfaces = {}
        for raw in documents:
            require(len(raw) <= 262144 and b"<!DOCTYPE" not in raw and b"<!ENTITY" not in raw,
                    "Protocol XML is invalid")
            for interface in ET.fromstring(raw).findall("interface"):
                name = interface.attrib["name"]
                require(name not in self.interfaces, "Duplicate protocol interface")
                methods = []
                for kind in ("request", "event"):
                    methods.append(tuple(Message(node.attrib["name"], tuple(dict(arg.attrib) for arg in node.findall("arg")),
                                                 int(node.attrib.get("since", "1")), node.attrib.get("type") == "destructor")
                                         for node in interface.findall(kind)))
                self.interfaces[name] = Interface(int(interface.attrib["version"]), *methods)
        require("wl_display" in self.interfaces and "wl_data_offer" in self.interfaces
                and "zwp_primary_selection_offer_v1" in self.interfaces, "Required protocols are missing")

    # 读取可信源清单并逐一校验固定 XML 文件名、大小和摘要，才构建 wire schema。
    # Verify trusted protocol inventory and each fixed XML name/size/hash before constructing wire schemas.
    @classmethod
    def installed(cls, folder):
        sources = json.loads(protected_bytes(folder / "sources.json", 32768))
        require(sources.get("version") == 1 and 1 <= len(sources["files"]) <= 32, "Protocol manifest invalid")
        documents = []
        names = set()
        for item in sources["files"]:
            name = item["name"]
            require(re.fullmatch(r"[a-z0-9-]+\.xml", name) and name not in names, "Protocol name invalid")
            names.add(name)
            raw = protected_bytes(folder / name, 262144)
            require(len(raw) == item["size"] and hashlib.sha256(raw).hexdigest() == item["sha256"],
                    "Protocol digest changed")
            documents.append(raw)
        return cls(documents)


@dataclass
class Object:
    interface: str
    version: int
    alive: bool = True
    mimes: set = field(default_factory=set)


class Wire:
    # 建立连接独立对象表，以固定 wl_display 对象 1 为起点，隔离客户端对象编号状态。
    # Initialize per-connection object state from fixed wl_display object 1, isolating client object IDs.
    def __init__(self, protocols):
        self.protocols = protocols
        self.objects = {1: Object("wl_display", 1)}
        self.globals = {}

    # 按原对象接口/版本解析对齐 wire 参数，核对长度、对象引用和新对象声明，返回未提交解析结果。
    # Decode aligned wire arguments using object interface/version, validate lengths/references/new objects and return uncommitted results.
    def decode(self, raw, server):
        ident, header = struct.unpack_from("=II", raw)
        require(header >> 16 == len(raw) and len(raw) >= 8 and len(raw) % 4 == 0, "Invalid wire header")
        obj = self.objects.get(ident)
        require(obj is not None, "Unknown Wayland object")
        interface = self.protocols.interfaces[obj.interface]
        messages = interface.events if server else interface.requests
        opcode = header & 65535
        require(opcode < len(messages), "Unknown Wayland method")
        message = messages[opcode]
        require(message.since <= obj.version, "Wayland method exceeds object version")
        values, news, count, offset = [], [], 0, 8

        # 从当前解析偏移读取一个完整 32 位数并推进偏移，截断拒绝。
        # Read one complete 32-bit value at the current offset and advance, refusing truncation.
        def number():
            nonlocal offset
            require(offset + 4 <= len(raw), "Truncated Wayland number")
            value = struct.unpack_from("=I", raw, offset)[0]
            offset += 4
            return value

        # 读取带对齐长度的数组或严格 UTF-8 NUL 终止字符串，按 nullable 处理零长度。
        # Read a padded array or strict UTF-8 NUL-terminated string, applying nullable rules to zero length.
        def blob(string=False, nullable=False):
            nonlocal offset
            length = number()
            require(offset + ((length + 3) & ~3) <= len(raw), "Truncated Wayland string/array")
            value = raw[offset:offset + length]
            offset += (length + 3) & ~3
            if not string:
                return value
            if length == 0:
                require(nullable, "Unexpected null string")
                return None
            require(value[-1] == 0 and b"\0" not in value[:-1], "Invalid Wayland string")
            return value[:-1].decode("utf-8", errors="strict")

        for argument in message.arguments:
            kind = argument["type"]
            nullable = argument.get("allow-null") == "true"
            if kind == "fd":
                values.append(count)
                count += 1
            elif kind == "string":
                values.append(blob(True, nullable))
            elif kind == "array":
                values.append(blob())
            elif kind == "new_id":
                name = argument.get("interface")
                if name:
                    version = min(obj.version, self.protocols.interfaces[name].version)
                else:
                    name, version = blob(True), number()
                value = number()
                require(name in self.protocols.interfaces and 1 <= version <= self.protocols.interfaces[name].version,
                        "Unknown or invalid new object interface/version")
                require((0xFF000000 <= value <= 0xFFFFFFFF) if server else (2 <= value < 0xFF000000),
                        "Invalid new object ID")
                require(value not in self.objects or not self.objects[value].alive, "Duplicate new object ID")
                values.append((name, version, value) if "interface" not in argument else value)
                news.append((value, name, version))
            elif kind in ("uint", "int", "fixed", "object"):
                value = number()
                if kind == "object":
                    require((value == 0 and nullable) or value in self.objects, "Unknown object argument")
                    if value and "interface" in argument:
                        require(self.objects[value].interface == argument["interface"], "Object argument type changed")
                values.append(value)
            else:
                raise RuntimeError("Unknown protocol argument type")
        require(offset == len(raw), "Trailing Wayland arguments")
        require(len(self.objects) + len(news) <= MAX_OBJECTS, "Object budget exceeded")
        return obj, message, values, news, count

    # 仅在消息被接受后更新对象生命周期、registry globals 与选择归属，维护 delete_id 回收边界。
    # Update object lifetimes/registry globals/selection ownership only after acceptance, preserving delete_id reclamation boundaries.
    def commit(self, raw, server, decoded):
        obj, message, values, news, _ = decoded
        for value, name, version in news:
            self.objects[value] = Object(name, version)
        if message.destructor:
            obj.alive = False
        if obj.interface == "wl_display" and server and message.name == "delete_id":
            value = values[0]
            require(2 <= value < 0xFF000000, "Invalid object deletion ID")
            self.objects.pop(value, None)
        if obj.interface == "wl_registry":
            if server and message.name == "global":
                name, interface, version = values
                require(len(self.globals) < MAX_GLOBALS and 1 <= len(interface) <= 128 and version > 0,
                        "Global registry budget/version invalid")
                self.globals[name] = (interface, version)
                if interface not in ALLOWED_GLOBALS or interface not in self.protocols.interfaces:
                    return False
                supported = min(version, self.protocols.interfaces[interface].version)
                if supported != version:
                    return raw[:-4] + struct.pack("=I", supported)
            elif server and message.name == "global_remove":
                old = self.globals.pop(values[0], None)
                return bool(old and old[0] in ALLOWED_GLOBALS and old[0] in self.protocols.interfaces)
            elif not server and message.name == "bind":
                name, (interface, version, _) = values
                require(name in self.globals and interface in ALLOWED_GLOBALS and
                        self.globals[name][0] == interface and version <= self.globals[name][1],
                        "Unadvertised or restricted global bind")
        return True


@dataclass
class Packet:
    data: bytes
    fds: list
    offset: int = 0
    started: float = field(default_factory=time.monotonic)


class Endpoint:
    # 将单侧 socket 设为非阻塞并注册读取，建立有界 wire、FD 与待发队列状态。
    # Make one socket nonblocking/register reads and initialize bounded wire/FD/outgoing state.
    def __init__(self, connection, channel, server):
        self.connection, self.channel, self.server = connection, channel, server
        self.channel.setblocking(False)
        self.buffer = bytearray()
        self.fds = deque()
        self.outgoing = deque()
        self.incomplete_since = None
        connection.broker.selector.register(channel, selectors.EVENT_READ, self)

    # 仅在有待发数据时增加可写监听，持续保持读取监听，避免空队列忙循环。
    # Watch writes only while data is queued while retaining reads, avoiding empty-queue busy loops.
    def events(self):
        self.connection.broker.selector.modify(self.channel, selectors.EVENT_READ |
                                               (selectors.EVENT_WRITE if self.outgoing else 0), self)

    # 接收 CLOEXEC SCM_RIGHTS 与字节，拒绝截断/未知 ancillary 和预算超量，失败关闭本次取得 FD。
    # Receive CLOEXEC SCM_RIGHTS/bytes, refusing truncation/unknown ancillary/excess budgets and closing newly received FDs on failure.
    def receive(self):
        data, ancillary, flags, _ = self.channel.recvmsg(65536, socket.CMSG_SPACE(MAX_FDS * 4), socket.MSG_CMSG_CLOEXEC)
        received = []
        try:
            for level, kind, payload in ancillary:
                require(level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS and len(payload) % 4 == 0,
                        "Unexpected ancillary data")
                descriptors = array.array("i")
                descriptors.frombytes(payload)
                received.extend(descriptors)
            require(not flags & (socket.MSG_CTRUNC | socket.MSG_TRUNC), "Truncated FD transfer")
            require(data, "Wayland connection closed")
            require(len(self.fds) + len(received) <= MAX_FDS and len(self.buffer) + len(data) <= MAX_WIRE_BYTES,
                    "Wayland receive budget exceeded")
            self.fds.extend(received)
            received = []
            self.buffer.extend(data)
            if self.incomplete_since is None:
                self.incomplete_since = time.monotonic()
            self.pump()
        finally:
            for fd in received:
                close_fd(fd)

    # 每轮最多处理 128 条完整消息，按 schema 所需 FD 绑定并拦截，再提交对象状态；不完整消息留待下轮。
    # Process at most 128 complete messages per turn, bind schema-required FDs/intercept/commit state and defer incomplete messages.
    def pump(self):
        for _ in range(128):
            if len(self.buffer) < 8:
                return
            _, header = struct.unpack_from("=II", self.buffer)
            size = header >> 16
            require(8 <= size <= 65532 and size % 4 == 0, "Invalid Wayland message size")
            if len(self.buffer) < size:
                return
            raw = bytes(self.buffer[:size])
            try:
                decoded = self.connection.wire.decode(raw, self.server)
            except Exception as error:
                ident, header = struct.unpack_from("=II", raw)
                obj = self.connection.wire.objects.get(ident)
                self.connection.broker.failure("decode", error, self.server,
                                               obj.interface if obj else "unknown", header & 65535)
                raise
            if len(self.fds) < decoded[4]:
                return
            descriptors = [self.fds.popleft() for _ in range(decoded[4])]
            del self.buffer[:size]
            self.incomplete_since = time.monotonic() if self.buffer or self.fds else None
            try:
                try:
                    decision = self.connection.wire.commit(raw, self.server, decoded)
                except Exception as error:
                    self.connection.broker.failure("commit", error, self.server, decoded[0].interface,
                                                   struct.unpack_from("=I", raw, 4)[0] & 65535)
                    raise
                if decision is False:
                    continue
                if isinstance(decision, bytes):
                    raw = decision
                raw, descriptors = self.connection.intercept(raw, self.server, decoded, descriptors)
                if raw is not None:
                    (self.connection.client if self.server else self.connection.upstream).queue(raw, descriptors)
                    descriptors = []
            finally:
                for fd in descriptors:
                    close_fd(fd)

    # 在 wire/FD 总预算内排队消息并启用可写监听，超限拒绝而不无限缓冲。
    # Queue messages within aggregate wire/FD bounds and enable writes, refusing excess rather than buffering indefinitely.
    def queue(self, raw, descriptors):
        require(sum(len(packet.data) - packet.offset for packet in self.outgoing) + len(raw) <= MAX_WIRE_BYTES
                and sum(len(packet.fds) for packet in self.outgoing) + len(descriptors) <= MAX_FDS,
                "Wayland send budget exceeded")
        self.outgoing.append(Packet(raw, descriptors))
        self.events()

    # 有界发送处理部分写入，SCM_RIGHTS 成功发送后立即关闭本端副本且不重复附加，空队列撤销写监听。
    # Boundedly handle partial sends, close local SCM_RIGHTS copies after successful transmission without reattaching, and disable empty-queue writes.
    def send(self):
        for _ in range(128):
            if not self.outgoing:
                self.events()
                return
            packet = self.outgoing[0]
            control = [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", packet.fds))] if packet.fds else []
            count = self.channel.sendmsg([memoryview(packet.data)[packet.offset:]], control, socket.MSG_NOSIGNAL)
            require(count > 0, "Wayland write closed")
            for fd in packet.fds:
                close_fd(fd)
            packet.fds = []
            packet.offset += count
            if packet.offset == len(packet.data):
                self.outgoing.popleft()
        self.events()

    # 注销 socket 并关闭所有未消费/未发送 FD，清空队列，避免描述符重用后的陈旧监听。
    # Unregister/close the socket and all unused/unsent FDs, clearing queues before descriptor reuse.
    def close(self):
        try:
            self.connection.broker.selector.unregister(self.channel)
        except (KeyError, ValueError):
            pass
        self.channel.close()
        for fd in self.fds:
            close_fd(fd)
        self.fds.clear()
        for packet in self.outgoing:
            for fd in packet.fds:
                close_fd(fd)
        self.outgoing.clear()


class Transfer:
    # 把原接收 FD 替换为私有采集管道，保存策略快照与截止时间；内容 EOF 前不向原接收方写入。
    # Replace the original receiver FD with a private collection pipe and snapshot/deadline; write nothing to the receiver before EOF.
    def __init__(self, connection, direction, mime, original):
        self.connection, self.direction, self.mime, self.original = connection, direction, mime, original
        self.broker = connection.broker
        self.rule = self.broker.rule
        self.buffer = bytearray()
        self.offset = 0
        self.collecting = True
        self.committed = False
        self.closed = False
        self.deadline = time.monotonic() + COLLECT_SECONDS
        self.read_fd, self.write_fd = os.pipe2(os.O_CLOEXEC)
        try:
            os.set_blocking(self.read_fd, False)
            os.set_blocking(original, False)
            self.broker.selector.register(self.read_fd, selectors.EVENT_READ, self)
        except Exception:
            close_fd(self.read_fd)
            close_fd(self.write_fd)
            raise
        self.broker.transfers.add(self)
        self.broker.dirty = True

    # 尚未提交时将新策略单调收紧，若格式/方向已被拒绝则立即关闭传输。
    # Tighten policies before commit and close immediately when MIME/direction is newly forbidden.
    def update(self, rule):
        if self.committed or self.closed:
            return
        self.rule = self.rule.tightened(rule)
        if not self.rule.permits(self.direction, self.mime):
            self.close(True)

    # 有界读完整内容至 EOF，维护单传输和总预算；EOF 后完整检查并转释放阶段，超时/超限关闭。
    # Collect bounded complete content to EOF under per-transfer/aggregate limits, then validate before release; timeout/excess closes.
    def receive(self):
        for _ in range(32):
            try:
                data = os.read(self.read_fd, 65536)
            except BlockingIOError:
                return
            if not data:
                self.broker.selector.unregister(self.read_fd)
                close_fd(self.read_fd)
                self.read_fd = -1
                # EOF 前不向原接收 FD 写字节，随后以完整缓冲做内容检查再进入释放阶段。
                self.collecting = False
                require(self.broker.rule is not None, "Policy is unavailable")
                self.update(self.broker.rule)
                if self.closed:
                    return
                if not self.rule.permits(self.direction, self.mime, self.buffer):
                    self.close(True)
                    return
                self.deadline = time.monotonic() + RELEASE_SECONDS
                self.broker.selector.register(self.original, selectors.EVENT_WRITE, self)
                self.release()
                return
            if len(self.buffer) + len(data) > MAX_BODY or self.broker.budget + len(data) > MAX_BUDGET:
                self.close(True)
                return
            self.buffer.extend(data)
            self.broker.budget += len(data)
            if text_encoding(self.mime) is not None and len(self.buffer) > self.rule.maximum:
                self.close(True)
                return

    # 第一笔写入是提交点；持共享锁重读策略后才能提交，后续写入仅完成这份已验证缓冲。
    # 首字节前取得策略 SH 锁重读并检查完整缓冲，与发布 EX 锁确定提交边界；已提交传输只完成原缓冲，处理背压与截止。
    # Before the first byte, reread/check the full body under SH against publication EX; committed transfers finish that buffer with backpressure/deadlines.
    def release(self):
        if self.closed or self.collecting:
            return
        if not self.committed:
            try:
                fcntl.flock(self.broker.policy_lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            try:
                current = self.broker.read_policy()
                self.rule = self.rule.tightened(current)
                if not self.rule.permits(self.direction, self.mime, self.buffer):
                    self.close(True)
                    return
                if not self.buffer:
                    self.close(False)
                    return
                try:
                    count = os.write(self.original, memoryview(self.buffer)[:65536])
                except BlockingIOError:
                    return
                require(count > 0, "Clipboard output closed")
                self.offset = count
                self.committed = True
            finally:
                fcntl.flock(self.broker.policy_lock, fcntl.LOCK_UN)
        for _ in range(8):
            if self.offset == len(self.buffer):
                self.close(False)
                return
            try:
                count = os.write(self.original, memoryview(self.buffer)[self.offset:self.offset + 65536])
            except BlockingIOError:
                return
            require(count > 0, "Clipboard output closed")
            self.offset += count

    # 幂等注销并关闭自有 FD、释放总缓冲预算和集合记录，按 blocked 更新统计。
    # Idempotently unregister/close owned FDs, release aggregate buffer budget/membership and count blocked transfers.
    def close(self, blocked):
        if self.closed:
            return
        self.closed = True
        for fd in (self.read_fd, self.original):
            if fd >= 0:
                try:
                    self.broker.selector.unregister(fd)
                except (KeyError, ValueError):
                    pass
                close_fd(fd)
        self.broker.budget -= len(self.buffer)
        self.buffer.clear()
        self.broker.transfers.discard(self)
        if blocked:
            self.broker.block(self.direction)
        self.broker.dirty = True


class Connection:
    # 建立客户端和上游独立 Endpoint 及 wire 状态，第二侧失败先注销第一侧再让外层关 socket。
    # Create client/upstream endpoints and wire state, unregistering the first endpoint if second-side construction fails.
    def __init__(self, broker, client, upstream, identity):
        self.broker, self.identity = broker, identity
        self.wire = Wire(broker.protocols)
        self.closed = False
        self.client = Endpoint(self, client, False)
        try:
            self.upstream = Endpoint(self, upstream, True)
        except Exception:
            # accept() closes both sockets on failure. Remove the first
            # endpoint's selector entry too, before its descriptor is reused.
            try:
                self.client.close()
            except Exception:
                pass  # Preserve the construction failure for accept().
            raise

    # 跟踪 MIME/选择对象，并把复制或粘贴 FD 换成受检查 Transfer；禁止未固定接口与超量 offer。
    # Track MIME/selection objects and replace copy/paste FDs with inspected transfers, excluding unpinned interfaces/excess offers.
    def intercept(self, raw, server, decoded, descriptors):
        obj, message, values, _, _ = decoded
        if obj.interface in DATA_SOURCES and not server and message.name == "offer":
            require(len(obj.mimes) < 64 and 1 <= len(values[0]) <= 256, "MIME offer budget exceeded")
            obj.mimes.add(values[0])
        elif obj.interface in DATA_OFFERS and server and message.name == "offer":
            require(len(obj.mimes) < 64 and 1 <= len(values[0]) <= 256, "MIME offer budget exceeded")
            obj.mimes.add(values[0])
        elif obj.interface in DATA_DEVICES and not server and message.name in ("set_selection", "start_drag"):
            if values[0] and (self.broker.rule is None or not self.broker.rule.copy):
                self.broker.block("copy")
                return None, descriptors
        direction = ("copy" if obj.interface in DATA_SOURCES and server and message.name == "send" else
                     "paste" if obj.interface in DATA_OFFERS and not server and message.name == "receive" else None)
        if direction is None:
            return raw, descriptors
        require(len(descriptors) == 1 and len(values) == 2, "Invalid clipboard descriptor signature")
        mime = values[0]
        original = descriptors[0]
        permitted = (self.broker.rule is not None and mime in obj.mimes and
                     self.broker.rule.permits(direction, mime) and len(self.broker.transfers) < MAX_TRANSFERS)
        info = os.fstat(original)
        # O_NONBLOCK does not bound regular-file IO (including remote files).
        # Clipboard payloads use writable pipes; graphics/shared-memory FDs
        # are still handled by their separate declared protocol signatures.
        permitted = permitted and stat.S_ISFIFO(info.st_mode)
        permitted = permitted and (fcntl.fcntl(original, fcntl.F_GETFL) & os.O_ACCMODE) in (os.O_WRONLY, os.O_RDWR)
        if not permitted:
            self.broker.block(direction)
            return None, descriptors
        transfer = Transfer(self, direction, mime, original)
        return raw, [transfer.write_fd]

    # 幂等关闭两侧及本连接所有待传内容，从 broker 集合移除并标记状态需写入。
    # Idempotently close both sides/all pending transfers, remove broker membership and mark status dirty.
    def close(self):
        if self.closed:
            return
        self.closed = True
        self.client.close()
        self.upstream.close()
        for transfer in tuple(self.broker.transfers):
            if transfer.connection is self:
                transfer.close(True)
        self.broker.connections.discard(self)
        self.broker.dirty = True


class Broker:
    # 读取可信会话/协议、固定策略锁和私有 listener，初始化连接/传输预算及自身创建身份。
    # Load trusted session/protocols, pin the policy lock/private listener and initialize budgets/self birth identity.
    def __init__(self, directory):
        self.directory = secure_directory(Path(directory))
        self.session = json.loads(protected_bytes(self.directory / "session.json", 65536))
        require(self.session["build"] == BUILD and re.fullmatch(r"[a-f0-9]{64}", BUILD)
                and type(self.session["uid"]) is int and self.session["uid"] >= 1000,
                "Session identity changed")
        self.protocols = Protocols.installed(secure_directory(Path(__file__).resolve().parent))
        self.selector = selectors.DefaultSelector()
        self.connections, self.transfers = set(), set()
        self.budget = self.blocked_copy = self.blocked_paste = 0
        self.rule = None
        self.error = None
        self.last_failure = None
        self.running = self.dirty = True
        self.generation = 0
        self.policy_sha = ""
        self.policy_lock = os.open(self.directory / "policy-lock", os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW)
        lock = os.fstat(self.policy_lock)
        require(stat.S_ISREG(lock.st_mode) and lock.st_uid == 0 and not lock.st_mode & 0o077,
                "Policy lock identity changed")
        self.self_identity = process_identity(os.getpid())
        require(self.self_identity["network"] == self.session["network"], "Broker network changed")
        runtime = Path(self.session["runtime"])
        info = runtime.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == self.session["uid"] and not info.st_mode & 0o077
                and str(runtime / "wayland-sakura") == self.session["socket"], "Application runtime changed")
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM | socket.SOCK_CLOEXEC)
        self.listener.bind(self.session["socket"])
        os.chown(self.session["socket"], self.session["uid"], self.session["gid"])
        os.chmod(self.session["socket"], 0o600)
        self.listener.setblocking(False)
        self.listener.listen(MAX_CONNECTIONS)
        self.socket_identity = os.lstat(self.session["socket"])
        self.selector.register(self.listener, selectors.EVENT_READ, self)
        self.tick_policy()
        require(self.rule is not None, "Initial clipboard policy unavailable")

    # 有界读取固定策略文件并校验当前构建 ABI，返回有效 Rule，否则拒绝。
    # Read the fixed bounded policy and validate current-build ABI, returning a valid Rule or refusing.
    def read_policy(self):
        return Rule.parse(protected_bytes(self.directory / "policy", POLICY.size), BUILD)

    # 按复制/粘贴方向递增阻断计数，并标记状态需要发布。
    # Increment copy/paste denial counters and mark status for publication.
    def block(self, direction):
        if direction == "copy":
            self.blocked_copy += 1
        else:
            self.blocked_paste += 1
        self.dirty = True

    # 将内部固定错误映射为阶段诊断，绝不序列化异常文本、MIME 或剪贴板正文，避免敏感内容进入状态。
    # Map fixed internal failures to stage diagnostics without serializing exception text/MIME/bodies into status.
    def failure(self, phase, error, server=None, interface=None, opcode=None):
        # Never serialize exception strings, untrusted wire strings, MIME values
        # or bodies. The fixed codes and XML-declared interface identify a stage.
        codes = {
            "Unknown Wayland object": "unknown-object",
            "Unknown Wayland method": "unknown-method",
            "Wayland method exceeds object version": "method-version",
            "Unknown object argument": "object-argument",
            "Object argument type changed": "object-type",
            "Unknown or invalid new object interface/version": "new-interface",
            "Invalid new object ID": "new-id",
            "Duplicate new object ID": "duplicate-id",
            "Trailing Wayland arguments": "trailing-arguments",
            "Unadvertised or restricted global bind": "restricted-global",
            "Unowned client UID": "client-uid",
            "Unowned client process": "client-process",
            "Connected compositor identity changed": "compositor-peer",
            "Wayland connection closed": "peer-closed",
            "Unexpected null string": "null-string",
        }
        code = codes.get(str(error), "invalid-message") if isinstance(error, RuntimeError) else (
            "io-" + str(error.errno) if isinstance(error, OSError) else "invalid-message")
        self.last_failure = {"phase": phase, "code": code}
        if server is not None:
            self.last_failure["server"] = server
        if interface in self.protocols.interfaces:
            self.last_failure["interface"] = interface
        if opcode is not None:
            self.last_failure["opcode"] = opcode
        self.dirty = True

    # 定期核实策略与摘要，更新未提交传输；策略不可用时关闭等待内容并报告错误，保持 fail-closed。
    # Refresh validated policy/hash and pending transfers; unavailable policy closes waiting content and reports error, failing closed.
    def tick_policy(self):
        try:
            raw = protected_bytes(self.directory / "policy", POLICY.size)
            current = Rule.parse(raw, BUILD)
            policy_sha = hashlib.sha256(raw).hexdigest()
            if current != self.rule or policy_sha != self.policy_sha:
                self.rule = current
                self.policy_sha = policy_sha
                self.generation = current.generation
                for transfer in tuple(self.transfers):
                    transfer.update(current)
                self.dirty = True
            self.error = None
        except Exception:
            self.rule = None
            self.error = "Clipboard policy is unavailable; transfers are refused"
            for transfer in tuple(self.transfers):
                transfer.close(True)
            self.dirty = True

    # 用 SO_PEERCRED 与内核进程证明核对独立 UID、原网络/cgroup 及可选挂载视图，拒绝外部客户端。
    # Combine SO_PEERCRED/kernel proof to require session UID/original network/cgroup/optional mount view, refusing external clients.
    def client_identity(self, channel):
        pid, uid, _ = struct.unpack("=3i", channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        require(uid == self.session["uid"], "Unowned client UID")
        identity = process_identity(pid)
        group = Path(self.session["applicationCgroup"])
        require(group.parent == Path("/sys/fs/cgroup") and
                identity["uid"] == uid and identity["network"] == self.session["network"] and
                "0::/" + group.name in identity["cgroup"], "Unowned client process")
        view = self.session.get('directoryView')
        if view is not None:
            source = self.session['desktop']['identity']
            require(isinstance(view, dict) and set(view) == {'version', 'device', 'inode', 'directoryDevice',
                    'directoryInode', 'directoryMode', 'mountFlags', 'projectUid', 'projectGid', 'uid', 'gid', 'desktopRunId', 'bootId', 'route'}
                    and type(view['version']) is int and view['version'] == 1
                    and type(view['directoryMode']) is int and 0 <= view['directoryMode'] <= 0o7777
                    and type(view['mountFlags']) is int and 0 <= view['mountFlags'] < 2**32 and view['mountFlags'] & 6 == 6
                    and view['projectUid'] == source['uid'] and view['projectGid'] == source['gid']
                    and view['uid'] == uid and view['gid'] == self.session['gid']
                    and view['desktopRunId'] == self.session['desktop']['run']['runId']
                    and view['bootId'] == self.session['bootId'] == self.session['desktop']['run']['bootId']
                    and (view['directoryDevice'], view['directoryInode']) == (source['directoryDevice'], source['directoryInode']),
                    'Application directory view receipt changed')
            namespace = (Path('/proc') / str(pid) / 'ns/mnt').stat()
            require((str(namespace.st_dev), str(namespace.st_ino)) == (view['device'], view['inode'])
                    and process_identity(pid)['created'] == identity['created'], 'Application directory namespace changed')
        return identity

    # 重核 compositor 创建、UID、已知映像、网络及唯一 socket 的物理/持有身份。
    # Revalidate compositor birth/UID/known image/network and sole socket physical/holder identity.
    def compositor_identity(self):
        identity = process_identity(self.session["compositorPid"])
        require(identity["created"] == self.session["compositorCreated"] and
                identity["uid"] == self.session["compositorUid"] and identity["network"] == self.session["network"] and
                identity["image"] == self.session["compositorImage"] and
                identity["image"] in ("/usr/bin/kwin_wayland", "/usr/bin/weston", "/usr/bin/kwin_wayland_wrapper"),
                "Compositor process identity changed")
        path = Path(self.session["compositorSocket"])
        parent, info = path.parent.lstat(), path.lstat()
        require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == identity["uid"] and not parent.st_mode & 0o077
                and stat.S_ISSOCK(info.st_mode) and info.st_uid == identity["uid"] and
                (info.st_dev, info.st_ino) == (self.session["compositorDevice"], self.session["compositorInode"]),
                "Compositor socket changed")
        inode = self.session["compositorKernelInode"]
        require(type(inode) is int and inode > 0 and listening_inode(identity["pid"], path) == inode and
                owns_socket(identity["pid"], inode), "Compositor listener identity changed")
        child_keys = {"compositorChildPid", "compositorChildCreated", "compositorChildFd"}
        if identity["image"] == "/usr/bin/kwin_wayland_wrapper":
            require(child_keys.issubset(self.session), "Compositor child identity missing")
            child_pid, child_fd = self.session["compositorChildPid"], self.session["compositorChildFd"]
            require(type(child_pid) is int and child_pid > 0 and type(child_fd) is int and 0 <= child_fd < 1000000,
                    "Compositor child identity changed")
            child = process_identity(child_pid)
            require(child["created"] == self.session["compositorChildCreated"] and child["parent"] == identity["pid"] and
                    child["image"] == "/usr/bin/kwin_wayland" and child["uid"] == identity["uid"] and
                    child["network"] == identity["network"], "Compositor child identity changed")
            directory = Path("/proc") / str(child_pid)
            raw = (directory / "cmdline").read_bytes()
            require(len(raw) <= 65536, "Compositor child argument budget exceeded")
            args = raw.rstrip(b"\0").split(b"\0")
            require(args.count(b"--wayland-fd") == args.count(b"--socket") == 1 and
                    args.index(b"--wayland-fd") + 1 < len(args) and args.index(b"--socket") + 1 < len(args) and
                    args[args.index(b"--wayland-fd") + 1] == str(child_fd).encode() and
                    args[args.index(b"--socket") + 1] == os.fsencode(path.name) and
                    os.readlink(directory / "fd" / str(child_fd)) == "socket:[" + str(inode) + "]" and
                    listening_inode(child_pid, path) == inode,
                    "Compositor child listener identity changed")
            require(process_identity(child_pid)["created"] == child["created"], "Compositor child identity changed")
        else:
            require(not child_keys.intersection(self.session), "Compositor child identity unexpected")
        require(process_identity(identity["pid"])["created"] == identity["created"], "Compositor process identity changed")
        return identity

    # 在连接预算内先核对客户端和 compositor，再连接固定上游并重核 peercred；失败关闭双方和登记。
    # Validate client/compositor under the connection budget, connect fixed upstream/recheck peercred and close both sides on failure.
    def accept(self):
        client, _ = self.listener.accept()
        upstream = None
        try:
            require(len(self.connections) < MAX_CONNECTIONS, "Connection budget exceeded")
            identity = self.client_identity(client)
            self.compositor_identity()
            upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM | socket.SOCK_CLOEXEC)
            upstream.settimeout(.5)
            upstream.connect(self.session["compositorSocket"])
            pid, uid, _ = struct.unpack("=3i", upstream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            require(pid == self.session["compositorPid"] and uid == self.session["compositorUid"],
                    "Connected compositor identity changed")
            self.compositor_identity()
            self.connections.add(Connection(self, client, upstream, identity))
            self.dirty = True
        except Exception as error:
            self.failure("accept", error)
            client.close()
            if upstream is not None:
                upstream.close()

    # 只发布计数、代次、摘要与精确客户端身份，使用私有临时文件替换状态，正文不记录。
    # Publish only counters/generation/hash/exact client identities through private replacement, never clipboard bodies.
    def status(self, ready=True):
        value = {"version": 1, "build": BUILD, "pid": os.getpid(), "created": self.self_identity["created"],
                 "ready": ready, "generation": self.generation, "policySha256": self.policy_sha,
                 "connections": len(self.connections),
                 "pending": len(self.transfers), "blockedCopy": self.blocked_copy, "blockedPaste": self.blocked_paste,
                 "clients": [{key: connection.identity[key] for key in ("pid", "created", "uid")}
                             for connection in self.connections]}
        if self.error:
            value["error"] = self.error
        if self.last_failure:
            value["lastFailure"] = self.last_failure
        temporary = self.directory / ("." + str(uuid.uuid4()) + ".status")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                json.dump(value, output, separators=(",", ":"))
            os.replace(temporary, self.directory / "status")
        finally:
            temporary.unlink(missing_ok=True)
        self.dirty = False

    # 事件循环定期重核策略和双端身份，限制每轮 wire/内容工作并清理超时，退出关闭全部连接/传输与状态。
    # Periodically revalidate policy/peer identity, bound per-turn wire/body work and expire transfers; shutdown releases all connections/transfers/status.
    def run(self):
        previous_policy = previous_status = previous_identity = 0
        try:
            self.compositor_identity()
            self.status()
            while self.running:
                now = time.monotonic()
                if now - previous_policy >= .05:
                    self.tick_policy()
                    previous_policy = now
                if now - previous_identity >= .25:
                    self.compositor_identity()
                    for connection in tuple(self.connections):
                        try:
                            identity = self.client_identity(connection.client.channel)
                            require(identity["created"] == connection.identity["created"], "Client identity changed")
                        except Exception:
                            connection.close()
                    previous_identity = now
                for key, events in self.selector.select(.02):
                    target = key.data
                    try:
                        if target is self:
                            self.accept()
                        elif isinstance(target, Endpoint):
                            if events & selectors.EVENT_READ:
                                target.receive()
                            if events & selectors.EVENT_WRITE and not target.connection.closed:
                                target.send()
                        elif target.collecting:
                            target.receive()
                        else:
                            target.release()
                    except BlockingIOError:
                        pass
                    except Exception as error:
                        if isinstance(target, Endpoint):
                            if self.last_failure is None or self.last_failure["phase"] not in ("decode", "commit"):
                                self.failure("transport", error, target.server)
                            target.connection.close()
                        elif isinstance(target, Transfer):
                            target.close(True)
                for connection in tuple(self.connections):
                    try:
                        for endpoint in (connection.client, connection.upstream):
                            endpoint.pump()
                            require(endpoint.incomplete_since is None or now - endpoint.incomplete_since < WIRE_SECONDS,
                                    "Incomplete protocol message timed out")
                            require(not endpoint.outgoing or now - endpoint.outgoing[0].started < WIRE_SECONDS,
                                    "Blocked protocol message timed out")
                    except Exception:
                        connection.close()
                for transfer in tuple(self.transfers):
                    if time.monotonic() >= transfer.deadline:
                        transfer.close(not transfer.committed)
                    elif not transfer.collecting:
                        try:
                            transfer.release()
                        except Exception:
                            transfer.close(True)
                if self.dirty or now - previous_status >= .25:
                    self.status()
                    previous_status = now
        finally:
            for connection in tuple(self.connections):
                connection.close()
            for transfer in tuple(self.transfers):
                transfer.close(not transfer.committed)
            self.selector.close()
            self.listener.close()
            try:
                current = os.lstat(self.session["socket"])
                if (current.st_dev, current.st_ino) == (self.socket_identity.st_dev, self.socket_identity.st_ino):
                    os.unlink(self.session["socket"])
            except FileNotFoundError:
                pass
            self.status(False)
            close_fd(self.policy_lock)


# 仅允许 root 固定会话入口，安装终止信号以停止事件循环并走统一资源清理。
# Allow only root fixed-session startup and install termination handlers that stop the loop for common cleanup.
def main():
    require(os.geteuid() == 0 and len(sys.argv) == 2, "Requires an owned root controller session")
    broker = Broker(sys.argv[1])
    # 信号处理仅清除运行标志，让主循环安全退出并执行自身清理。
    # Only clear the running flag in the handler so the loop exits through its own cleanup.
    def stop(_signum, _frame):
        broker.running = False
    for name in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(name, stop)
    broker.run()


if __name__ == "__main__":
    main()
