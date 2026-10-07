# 模块职责：Wayland 策略与线格式回归可跨宿主执行，真实 Unix 描述符回归仅在 Linux 执行。
# Module: Wayland policy and wire-format regressions run across hosts; real Unix descriptor regressions run only on Linux.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
"""Policy/wire regressions on every host; real Unix FD regressions on Linux."""
import array
import importlib.util
import os
from pathlib import Path
import selectors
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest

FOLDER = Path(__file__).resolve().parents[1] / "native" / "wayland-clipboard"
if len(sys.argv) >= 3 and sys.argv[1] == "--source":
    FOLDER = Path(sys.argv[2]).resolve(strict=True)
    del sys.argv[1:3]
spec = importlib.util.spec_from_file_location("wayland_proxy", FOLDER / "proxy.py")
proxy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = proxy
spec.loader.exec_module(proxy)
protocols = proxy.Protocols([file.read_bytes() for file in sorted(FOLDER.glob("*.xml"))])
BUILD = "a" * 64


# 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
# English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
# 输入 / Inputs: value。
# 结果：返回分支计算值（`struct.pack('=I', value)`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`struct.pack('=I', value)`); its implementation and call sites define the actual type.
# 协作入口 / Collaborators: `struct.pack`.
def word(value):
    return struct.pack("=I", value)


# 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
# English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
# 输入 / Inputs: value。
# 结果：返回分支计算值（`word(len(raw)) + raw + b'\x00' * (-len(raw) % 4)`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`word(len(raw)) + raw + b'\x00' * (-len(raw) % 4)`); its implementation and call sites define the actual type.
# 协作入口 / Collaborators: `value.encode`, `word`, `len`.
def string(value):
    raw = value.encode("utf-8") + b"\0"
    return word(len(raw)) + raw + b"\0" * (-len(raw) % 4)


# 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
# English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
# 输入 / Inputs: ident, opcode, body = b''。
# 结果：返回分支计算值（`word(ident) + word(8 + len(body) << 16 | opcode) + body`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`word(ident) + word(8 + len(body) << 16 | opcode) + body`); its implementation and call sites define the actual type.
# 协作入口 / Collaborators: `word`, `len`.
def message(ident, opcode, body=b""):
    return word(ident) + word(((8 + len(body)) << 16) | opcode) + body


# 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
# English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
# 输入 / Inputs: wire, raw, server = False。
# 结果：返回分支计算值（`wire.commit(raw, server, decoded)`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`wire.commit(raw, server, decoded)`); its implementation and call sites define the actual type.
# 协作入口 / Collaborators: `wire.decode`, `wire.commit`.
def apply(wire, raw, server=False):
    decoded = wire.decode(raw, server)
    return wire.commit(raw, server, decoded)


class PolicyTests(unittest.TestCase):
    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `proxy.POLICY.pack`, `BUILD.encode`, `proxy.Rule.parse`, `self.assertTrue`.
    def test_identity_and_disabled_operational_bound(self):
        raw = proxy.POLICY.pack(proxy.MAGIC, 1, 31, 1024, 2, BUILD.encode())
        rule = proxy.Rule.parse(raw, BUILD)
        self.assertTrue(rule.sensitive)
        self.assertEqual(rule.maximum, 1024)
        for invalid in (raw[:-1], raw + b"x", raw[:24] + b"b" * 64 + raw[88:]):
            with self.assertRaises(RuntimeError):
                proxy.Rule.parse(invalid, BUILD)
        disabled = proxy.Rule.parse(proxy.POLICY.pack(proxy.MAGIC, 1, 0, 1024, 3, BUILD.encode()), BUILD)
        self.assertTrue(disabled.permits("copy", "text/plain", b"normal"))
        self.assertEqual(disabled.maximum, proxy.MAX_BODY)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `proxy.Rule`, `self.assertFalse`, `rule.permits`, `('prefix\n' + text).encode`.
    def test_full_sensitive_scan_strict_encoding_and_utf8_limit(self):
        rule = proxy.Rule(True, True, True, True, 4096, 1)
        for text in ("-----BEGIN RSA PRIVATE KEY-----", "password = abcdef0123456789", "ghp_" + "a" * 30,
                     "https://alice:secret@registry.example", "eyJhbGciO.eyJzdWIiO.signature123"):
            self.assertFalse(rule.permits("paste", "text/plain;charset=utf-8", ("prefix\n" + text).encode()))
        self.assertTrue(rule.permits("paste", "text/plain; charset=\"UTF-8\"", "普通文本".encode()))
        for body in (b"\xff", b"safe\0secret", "界".encode() * 1400):
            self.assertFalse(rule.permits("copy", "text/plain", body))
        self.assertFalse(rule.permits("copy", "text/plain;charset=utf-16", b"safe"))
        self.assertFalse(rule.permits("copy", "image/png", b"binary"))
        self.assertFalse(proxy.Rule(True, True, True, False, 4096, 1).permits(
            "copy", "application/vnd.portal.filetransfer", b"opaque-token"))
        self.assertFalse(rule.permits("copy", "STRING", b"\xff" * 3000))

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `proxy.Rule`, `first.tightened`, `tightened.tightened`, `self.assertFalse`.
    def test_pending_constraints_do_not_relax_before_release(self):
        first = proxy.Rule(True, True, True, False, 4096, 1)
        tightened = first.tightened(proxy.Rule(False, True, False, True, 1024, 2))
        loosened = tightened.tightened(first)
        self.assertFalse(loosened.copy)
        self.assertFalse(loosened.files)
        self.assertTrue(loosened.sensitive)
        self.assertEqual(loosened.maximum, 1024)


class WireTests(unittest.TestCase):
    # 中文功能：准备本用例的独立目录与状态，使用例之间的输入和失败注入相互隔离。
    # English: Prepare a private directory and state for this case so inputs and injected failures are isolated between cases.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.wire`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `proxy.Wire`, `apply`, `message`, `word`.
    def setUp(self):
        self.wire = proxy.Wire(protocols)
        apply(self.wire, message(1, 1, word(2)))

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, name, interface, version。
    # 结果：返回分支计算值（`apply(self.wire, message(2, 0, word(name) + string(interface) + word(version)), True)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`apply(self.wire, message(2, 0, word(name) + string(interface) + word(version)), True)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `apply`, `message`, `word`, `string`.
    def global_(self, name, interface, version):
        return apply(self.wire, message(2, 0, word(name) + string(interface) + word(version)), True)

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, name, interface, version, ident。
    # 结果：返回分支计算值（`apply(self.wire, message(2, 0, word(name) + string(interface) + word(version) + word(ident)))`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`apply(self.wire, message(2, 0, word(name) + string(interface) + word(version) + word(ident)))`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `apply`, `message`, `word`, `string`.
    def bind(self, name, interface, version, ident):
        return apply(self.wire, message(2, 0, word(name) + string(interface) + word(version) + word(ident)))

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.assertFalse`, `self.global_`, `self.assertRaises`, `self.bind`.
    def test_unknown_and_privileged_globals_hidden_and_bind_refused(self):
        self.assertFalse(self.global_(7, "ext_data_control_manager_v1", 1))
        self.assertFalse(self.global_(8, "zwlr_data_control_manager_v1", 2))
        self.assertFalse(self.global_(9, "org_kde_kwin_clipboard", 1))
        with self.assertRaises(RuntimeError):
            self.bind(7, "ext_data_control_manager_v1", 1, 3)
        with self.assertRaises(RuntimeError):
            self.bind(10, "wl_shm", 1, 4)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.global_`, `self.assertIsInstance`, `self.assertEqual`, `struct.unpack_from`.
    def test_global_version_clamped_and_object_generation_reused_only_after_delete(self):
        clipped = self.global_(7, "wl_compositor", 99)
        self.assertIsInstance(clipped, bytes)
        self.assertEqual(struct.unpack_from("=I", clipped, len(clipped) - 4)[0], protocols.interfaces["wl_compositor"].version)
        self.bind(7, "wl_compositor", 4, 3)
        apply(self.wire, message(3, 0, word(4)))
        self.assertEqual(self.wire.objects[4].interface, "wl_surface")
        with self.assertRaises(RuntimeError):
            apply(self.wire, message(3, 0, word(4)))
        apply(self.wire, message(4, 0))
        apply(self.wire, message(1, 1, word(4)), True)
        apply(self.wire, message(3, 0, word(4)))
        self.assertTrue(self.wire.objects[4].alive)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.global_`, `self.bind`, `apply`, `message`.
    def test_primary_selection_fd_signature_and_server_new_id(self):
        self.global_(7, "zwp_primary_selection_device_manager_v1", 1)
        self.bind(7, "zwp_primary_selection_device_manager_v1", 1, 3)
        self.global_(8, "wl_seat", 7)
        self.bind(8, "wl_seat", 7, 4)
        apply(self.wire, message(3, 1, word(5) + word(4)))
        apply(self.wire, message(5, 0, word(0xFF000001)), True)
        apply(self.wire, message(0xFF000001, 0, string("text/plain")), True)
        decoded = self.wire.decode(message(0xFF000001, 0, string("text/plain")), False)
        self.assertEqual(decoded[4], 1, "FD arguments have no bytes in the message buffer")
        self.assertEqual(decoded[2], ["text/plain", 0])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.global_`, `self.bind`, `message`, `word`.
    def test_malformed_lengths_object_types_and_interface_versions_refused(self):
        self.global_(7, "wl_shm", 1)
        self.bind(7, "wl_shm", 1, 3)
        for raw in (message(999, 0), message(3, 99), message(2, 0, word(1) + word(4096)),
                    message(1, 1, word(2)), message(1, 0, word(5) + word(6))):
            with self.assertRaises((RuntimeError, UnicodeError, struct.error)):
                self.wire.decode(raw, False)
        self.global_(8, "wl_compositor", 1)
        self.bind(8, "wl_compositor", 1, 4)
        apply(self.wire, message(4, 0, word(5)))
        with self.assertRaises(RuntimeError):
            self.wire.decode(message(5, 9, word(0) * 4), False)


class FakeBroker:
    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self, directory。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.protocols`, `self.selector`, `self.rule`, `self.budget`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `selectors.DefaultSelector`, `proxy.Rule`, `set`, `os.open`.
    def __init__(self, directory):
        self.protocols = protocols
        self.selector = selectors.DefaultSelector()
        self.rule = proxy.Rule(True, True, False, True, 1048576, 1)
        self.connections, self.transfers = set(), set()
        self.budget = self.blocked_copy = self.blocked_paste = 0
        self.dirty = False
        self.policy_lock = os.open(Path(directory) / "lock", os.O_CREAT | os.O_RDWR, 0o600)

    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self。
    # 结果：返回分支计算值（`self.rule`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.rule`); its implementation and call sites define the actual type.
    def read_policy(self):
        return self.rule

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, direction。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.blocked_copy`, `self.blocked_paste`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def block(self, direction):
        if direction == "copy":
            self.blocked_copy += 1
        else:
            self.blocked_paste += 1

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, phase, error, server = None, interface = None, opcode = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.last_failure`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def failure(self, phase, error, server=None, interface=None, opcode=None):
        self.last_failure = (phase, server, interface, opcode)

    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `tuple`, `connection.close`, `transfer.close`, `os.close`.
    def close(self):
        for connection in tuple(self.connections):
            connection.close()
        for transfer in tuple(self.transfers):
            transfer.close(True)
        os.close(self.policy_lock)
        self.selector.close()


@unittest.skipUnless(sys.platform == "linux" and hasattr(socket, "SCM_RIGHTS"), "Unix FD transport requires Linux")
class UnixTests(unittest.TestCase):
    # 中文功能：准备本用例的独立目录与状态，使用例之间的输入和失败注入相互隔离。
    # English: Prepare a private directory and state for this case so inputs and injected failures are isolated between cases.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.directory`, `self.broker`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `tempfile.TemporaryDirectory`, `FakeBroker`, `self.addCleanup`.
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="sakura-wayland-peer-")
        self.broker = FakeBroker(self.directory.name)
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(self.broker.close)

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, direction = 'paste'。
    # 结果：返回分支计算值（`(transfer, output_read)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`(transfer, output_read)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `os.pipe2`, `self.addCleanup`, `type('Owned', (), {'broker': self.broker})`, `type`.
    def transfer(self, direction="paste"):
        output_read, output_write = os.pipe2(os.O_CLOEXEC | os.O_NONBLOCK)
        self.addCleanup(proxy.close_fd, output_read)
        connection = type("Owned", (), {"broker": self.broker})()
        transfer = proxy.Transfer(connection, direction, "text/plain;charset=utf-8", output_write)
        return transfer, output_read

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `str`, `Path`, `socket.socket`, `self.addCleanup`.
    def test_listening_socket_kernel_identity_cannot_follow_a_rebound_path(self):
        endpoint = str(Path(self.directory.name) / "compositor")
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(server.close)
        server.bind(endpoint)
        with self.assertRaises(RuntimeError):
            proxy.listening_inode(os.getpid(), endpoint)
        server.listen(1)
        inode = proxy.listening_inode(os.getpid(), endpoint)
        self.assertTrue(proxy.owns_socket(os.getpid(), inode))
        server.close()
        self.assertFalse(proxy.owns_socket(os.getpid(), inode))
        os.unlink(endpoint)
        replacement = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(replacement.close)
        replacement.bind(endpoint)
        replacement.listen(1)
        self.assertNotEqual(proxy.listening_inode(os.getpid(), endpoint), inode)

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, condition, timeout = 2。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `time.monotonic`, `condition`, `self.broker.selector.select`, `isinstance`.
    def drive(self, condition, timeout=2):
        deadline = time.monotonic() + timeout
        while not condition() and time.monotonic() < deadline:
            for key, events in self.broker.selector.select(.01):
                target = key.data
                if isinstance(target, proxy.Endpoint):
                    if events & selectors.EVENT_READ:
                        target.receive()
                    if events & selectors.EVENT_WRITE:
                        target.send()
                elif target.collecting:
                    target.receive()
                else:
                    target.release()
        self.assertTrue(condition(), "FD operation did not complete")

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.transfer`, `os.write`, `self.drive`, `self.assertRaises`.
    def test_partial_body_is_private_until_eof_and_sensitive_tail_never_leaks(self):
        transfer, output = self.transfer()
        os.write(transfer.write_fd, b"safe prefix")
        self.drive(lambda: len(transfer.buffer) == 11)
        with self.assertRaises(BlockingIOError):
            os.read(output, 65536)
        os.write(transfer.write_fd, b"\npassword=0123456789abcdef")
        os.close(transfer.write_fd)
        self.drive(lambda: transfer.closed)
        self.assertEqual(os.read(output, 65536), b"")
        self.assertEqual(self.broker.budget, 0)
        self.assertEqual(self.broker.blocked_paste, 1)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.transfer`, `('中文-data\n' * 14000).encode`, `threading.Thread`, `writer.start`.
    def test_complete_large_text_runs_through_real_pipes_without_prefix_release(self):
        transfer, output = self.transfer("copy")
        body = ("中文-data\n" * 14000).encode("utf-8")
        failures = []
        # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
        # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
        # 输入 / Inputs: 无 / none。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 协作入口 / Collaborators: `len`, `os.write`, `memoryview`, `failures.append`.
        # 设计思路：将主体计算与 finally 收尾分开，使返回和异常路径经过相同收尾步骤。
        # Design: Separate body computation from finally-based finalization so return and exception paths share the same finalization step.
        def write():
            try:
                offset = 0
                while offset < len(body):
                    offset += os.write(transfer.write_fd, memoryview(body)[offset:])
            except Exception as error:
                failures.append(str(error))
            finally:
                os.close(transfer.write_fd)
        writer = threading.Thread(target=write)
        writer.start()
        received = bytearray()
        deadline = time.monotonic() + 2
        while not transfer.closed and time.monotonic() < deadline:
            for key, _ in self.broker.selector.select(.005):
                item = key.data
                item.receive() if item.collecting else item.release()
            try:
                received.extend(os.read(output, 65536))
            except BlockingIOError:
                pass
        writer.join(1)
        self.assertFalse(writer.is_alive())
        self.assertTrue(transfer.closed)
        while True:
            data = os.read(output, 65536)
            if not data:
                break
            received.extend(data)
        self.assertEqual(failures, [])
        self.assertEqual(bytes(received), body)
        self.assertEqual(self.broker.budget, 0)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.broker.budget`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.transfer`, `os.write`, `self.drive`, `first.update`.
    def test_tightening_and_budget_cancel_only_unreleased_owned_transfers(self):
        first, output = self.transfer()
        os.write(first.write_fd, b"waiting source")
        self.drive(lambda: bool(first.buffer))
        first.update(proxy.Rule(True, False, False, True, 1024, 2))
        self.assertTrue(first.closed)
        self.assertEqual(os.read(output, 65536), b"")
        os.close(first.write_fd)
        second, receiver = self.transfer()
        self.broker.budget = proxy.MAX_BUDGET - 1
        os.write(second.write_fd, b"over budget")
        os.close(second.write_fd)
        self.drive(lambda: second.closed)
        self.assertEqual(os.read(receiver, 65536), b"")
        self.broker.budget = 0

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `connection.wire.objects[3]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `socket.socketpair`, `self.addCleanup`, `proxy.Connection`, `self.broker.connections.add`.
    def test_fd_fifo_may_arrive_after_its_whole_header_and_with_later_message_bytes(self):
        peer, incoming = socket.socketpair()
        outgoing, compositor = socket.socketpair()
        self.addCleanup(peer.close)
        self.addCleanup(compositor.close)
        connection = proxy.Connection(self.broker, incoming, outgoing, {})
        self.broker.connections.add(connection)
        connection.wire.objects[3] = proxy.Object("wl_shm", 1)
        raw = message(3, 0, word(4) + word(4096))
        peer.sendall(raw[:5])
        connection.client.receive()
        self.assertEqual(bytes(connection.client.buffer), raw[:5])
        peer.sendall(raw[5:])
        connection.client.receive()
        self.assertEqual(len(connection.upstream.outgoing), 0)
        read_fd, write_fd = os.pipe2(os.O_CLOEXEC)
        self.addCleanup(proxy.close_fd, read_fd)
        self.addCleanup(proxy.close_fd, write_fd)
        later = message(1, 0, word(5))
        peer.sendmsg([later], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [read_fd]))])
        connection.client.receive()
        connection.upstream.send()
        compositor.settimeout(1)
        value = bytearray()
        passed = array.array("i")
        while len(value) < len(raw + later):
            part, control, flags, _ = compositor.recvmsg(4096, socket.CMSG_SPACE(4))
            self.assertTrue(part)
            self.assertFalse(flags & (socket.MSG_CTRUNC | socket.MSG_TRUNC))
            value.extend(part)
            for level, kind, payload in control:
                self.assertEqual((level, kind), (socket.SOL_SOCKET, socket.SCM_RIGHTS))
                passed.frombytes(payload)
        self.assertEqual(bytes(value), raw + later)
        self.assertEqual(len(passed), 1)
        os.write(write_fd, b"real-fd")
        self.assertEqual(os.read(passed[0], 7), b"real-fd")
        os.close(passed[0])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `connection.wire.objects[8]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `socket.socketpair`, `self.addCleanup`, `proxy.Connection`, `self.broker.connections.add`.
    def test_regular_file_clipboard_targets_are_refused_without_writes(self):
        peer, incoming = socket.socketpair()
        outgoing, compositor = socket.socketpair()
        self.addCleanup(peer.close)
        self.addCleanup(compositor.close)
        connection = proxy.Connection(self.broker, incoming, outgoing, {})
        self.broker.connections.add(connection)
        offer = proxy.Object("wl_data_offer", 3)
        offer.mimes.add("text/plain")
        connection.wire.objects[8] = offer
        raw = message(8, 1, string("text/plain"))
        decoded = connection.wire.decode(raw, False)
        path = Path(self.directory.name) / "existing"
        path.write_bytes(b"previous contents")
        target = os.open(path, os.O_WRONLY | os.O_CLOEXEC)
        self.addCleanup(proxy.close_fd, target)
        result, descriptors = connection.intercept(raw, False, decoded, [target])
        self.assertIsNone(result)
        self.assertEqual(descriptors, [target])
        self.assertEqual(path.read_bytes(), b"previous contents")
        self.assertEqual(len(self.broker.transfers), 0)
        self.assertEqual(self.broker.blocked_paste, 1)


if __name__ == "__main__":
    unittest.main()
