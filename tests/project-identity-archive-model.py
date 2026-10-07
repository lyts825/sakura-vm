# 模块职责：在内存适配器执行生产身份归档定义，核对原票据、墓碑及持久化中断恢复。
# Module: Execute production identity-archive definitions through in-memory adapters to check original tickets, tombstones and recovery from interrupted persistence.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
# 项目身份归档事务的可移植模型；生产定义使用内存适配器，不能据此证明真实 Linux 权限或系统调用。
"""Portable transaction models; filesystem/process authority is simulated.

The production Python definitions run unchanged against an in-memory adapter.
These results do not attest a Linux cgroup, root account, or renameat2 syscall.
"""
import ast
import base64
import ctypes
import errno
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
import types
import uuid


class Node:
    next_inode = 10

    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self, path, directory = False, data = b'', mode = None。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `Node.next_inode`, `self.mode`, `self.mtime`, `self.ctime`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def __init__(self, path, directory=False, data=b'', mode=None):
        Node.next_inode += 1
        self.path, self.directory, self.data = path, directory, data
        self.mode = (stat.S_IFDIR if directory else stat.S_IFREG) | (mode if mode is not None else (0o700 if directory else 0o600))
        self.inode, self.uid, self.gid, self.links = Node.next_inode, 0, 0, 1
        self.mtime = self.ctime = 1

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self。
    # 结果：返回分支计算值（`types.SimpleNamespace(st_dev=11, st_ino=self.inode, st_mode=self.mode, st_uid=self.uid, st_gid=self.…`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`types.SimpleNamespace(st_dev=11, st_ino=self.inode, st_mode=self.mode, st_uid=self.uid, st_gid=self.…`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `types.SimpleNamespace`, `len`.
    def info(self):
        return types.SimpleNamespace(st_dev=11, st_ino=self.inode, st_mode=self.mode,
            st_uid=self.uid, st_gid=self.gid, st_nlink=self.links, st_size=len(self.data),
            st_mtime_ns=self.mtime, st_ctime_ns=self.ctime)


class Iterator:
    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self, names。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.names`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def __init__(self, names): self.names = names
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self。
    # 结果：返回分支计算值（`iter((types.SimpleNamespace(name=name) for name in self.names))`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`iter((types.SimpleNamespace(name=name) for name in self.names))`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `iter`, `types.SimpleNamespace`.
    def __enter__(self): return iter(types.SimpleNamespace(name=name) for name in self.names)
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, *_。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    def __exit__(self, *_): pass


class Reader:
    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self, fs, descriptor。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    def __init__(self, fs, descriptor):
        self.fs, self.descriptor = fs, descriptor
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self。
    # 结果：返回分支计算值（`self`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self`); its implementation and call sites define the actual type.
    def __enter__(self): return self
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, *_。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.fs.close`.
    def __exit__(self, *_): self.fs.close(self.descriptor)
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self。
    # 结果：返回分支计算值（`self.descriptor`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.descriptor`); its implementation and call sites define the actual type.
    def fileno(self): return self.descriptor
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, count。
    # 结果：返回分支计算值（`self.fs.read(self.descriptor, count)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.fs.read(self.descriptor, count)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.fs.read`.
    def read(self, count): return self.fs.read(self.descriptor, count)


class Function:
    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self, fs。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.fs`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def __init__(self, fs): self.fs = fs
    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: self, old_parent, old, new_parent, new, flags。
    # 结果：返回分支计算值（`-1`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`-1`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.fs.error`, `node.path`, `self.fs.nodes[new_path]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.fs.path`, `old.decode`, `new.decode`, `self.fs.events.append`.
    # 检查边界 / Checked boundaries: `flags == 1 and old_parent == new_parent`.
    def __call__(self, old_parent, old, new_parent, new, flags):
        assert flags == 1 and old_parent == new_parent
        old_path = self.fs.path(old.decode(), old_parent)
        new_path = self.fs.path(new.decode(), new_parent)
        if self.fs.publish_error:
            self.fs.error = self.fs.publish_error
            return -1
        if new_path in self.fs.nodes:
            self.fs.error = errno.EEXIST
            return -1
        self.fs.events.append(('publish', old_path, new_path))
        node = self.fs.nodes.pop(old_path)
        node.path = new_path
        self.fs.nodes[new_path] = node
        if self.fs.after_publish: self.fs.after_publish()
        return 0


class SyscallFunction:
    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self, fs。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.fs`. Follow the actual model assignments / 以模型中的实际赋值为准。
    def __init__(self, fs): self.fs = fs
    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: self, number, old_parent, old, new_parent, new, flags。
    # 结果：返回分支计算值（`self.fs.rename(old_parent.value, old.value, new_parent.value, new.value, flags.value)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.fs.rename(old_parent.value, old.value, new_parent.value, new.value, flags.value)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `isinstance`, `self.fs.syscall_calls.append`, `self.fs.rename`.
    # 检查边界 / Checked boundaries: `isinstance(number, ctypes.c_long)`; `number.value == expected`.
    def __call__(self, number, old_parent, old, new_parent, new, flags):
        assert isinstance(number, ctypes.c_long)
        expected = 316 if self.fs.machine == 'x86_64' else 276
        assert number.value == expected
        assert isinstance(old_parent, ctypes.c_int) and isinstance(new_parent, ctypes.c_int)
        assert isinstance(old, ctypes.c_char_p) and isinstance(new, ctypes.c_char_p)
        assert isinstance(flags, ctypes.c_uint) and flags.value == 1
        self.fs.syscall_calls.append(number.value)
        return self.fs.rename(old_parent.value, old.value, new_parent.value, new.value, flags.value)


class Filesystem:
    # 中文功能：初始化测试夹具实例并保存构造输入，供后续方法复用其状态。
    # English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.after_publish`, `self.fsync_failure`, `self.busy`, `self.changed_group`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `getattr`, `constants.update`, `enumerate`, `types.SimpleNamespace`.
    def __init__(self):
        self.nodes, self.fds, self.events = {}, {}, []
        self.next_fd, self.error, self.publish_error = 100, 0, 0
        self.after_publish = self.fsync_failure = None
        self.busy = self.changed_group = False
        self.cgroup_calls = 0
        self.closed_then_busy = False
        self.machine, self.pointer_size, self.long_size = 'x86_64', 8, 8
        self.wrapper_available, self.syscall_available, self.syscall_calls = True, True, []
        constants = {name: getattr(os, name) for name in ('O_RDONLY', 'O_WRONLY', 'O_CREAT', 'O_EXCL', 'SEEK_SET')}
        constants.update({name: getattr(os, name, 1 << (20 + index)) for index, name in enumerate(('O_DIRECTORY', 'O_NOFOLLOW', 'O_CLOEXEC'))})
        self.os = types.SimpleNamespace(**constants, open=self.open, close=self.close, fstat=self.fstat,
            stat=self.stat, mkdir=self.mkdir, read=self.read, write=self.write, lseek=self.lseek,
            fsync=self.fsync, unlink=self.unlink, scandir=self.scandir, fdopen=lambda fd, _mode: Reader(self, fd),
            uname=lambda: types.SimpleNamespace(machine=self.machine))
        self.rename = Function(self)
        self.syscall = SyscallFunction(self)
        # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
        # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
        # 输入 / Inputs: *_args, **_kwargs。
        # 结果：返回分支计算值（`types.SimpleNamespace(**{'renameat2': self.rename} if self.wrapper_available else {}, **{'syscall': …`），实际类型由实现及使用处约定。
        # Result: Return the branch-computed value (`types.SimpleNamespace(**{'renameat2': self.rename} if self.wrapper_available else {}, **{'syscall': …`); its implementation and call sites define the actual type.
        # 协作入口 / Collaborators: `types.SimpleNamespace`.
        def library(*_args, **_kwargs):
            return types.SimpleNamespace(**({'renameat2':self.rename} if self.wrapper_available else {}),
                **({'syscall':self.syscall} if self.syscall_available else {}))
        self.ctypes = types.SimpleNamespace(CDLL=library,
            get_errno=lambda: self.error, c_int=ctypes.c_int, c_uint=ctypes.c_uint, c_char_p=ctypes.c_char_p,
            c_long=ctypes.c_long, c_void_p=ctypes.c_void_p,
            sizeof=lambda kind: self.pointer_size if kind is ctypes.c_void_p else self.long_size)

    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: self, path, parent = None。
    # 结果：返回分支计算值（`self.fds[parent][0].path / path`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.fds[parent][0].path / path`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `path.startswith`.
    # 检查边界 / Checked boundaries: `parent is not None and '/' not in path and (path not in ('', '..'))`.
    def path(self, path, parent=None):
        if path == '.' and parent is not None: return self.fds[parent][0].path
        if path.startswith('/'): return path
        assert parent is not None and '/' not in path and path not in ('', '..')
        return self.fds[parent][0].path + '/' + path

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, path, directory = False, data = b'', mode = None。
    # 结果：返回分支计算值（`node`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`node`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.nodes[path]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Node`.
    def add(self, path, directory=False, data=b'', mode=None):
        node = Node(path, directory, data, mode)
        self.nodes[path] = node
        return node

    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: self, path。
    # 结果：返回分支计算值（`self.open(path, self.os.O_RDONLY | self.os.O_DIRECTORY | self.os.O_NOFOLLOW)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.open(path, self.os.O_RDONLY | self.os.O_DIRECTORY | self.os.O_NOFOLLOW)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.open`.
    # 检查边界 / Checked boundaries: `path in self.nodes and self.nodes[path].directory`.
    def directory_fd(self, path):
        assert path in self.nodes and self.nodes[path].directory
        return self.open(path, self.os.O_RDONLY | self.os.O_DIRECTORY | self.os.O_NOFOLLOW)

    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: self, path, flags, mode = None, dir_fd = None。
    # 结果：返回分支计算值（`self.next_fd`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.next_fd`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.next_fd`, `self.fds[self.next_fd]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 失败 / Failure: `FileExistsError(path)`; `FileNotFoundError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.path`, `FileExistsError`, `self.add`, `FileNotFoundError`.
    def open(self, path, flags, mode=None, dir_fd=None):
        path = self.path(path, dir_fd)
        if flags & self.os.O_CREAT:
            if path in self.nodes and flags & self.os.O_EXCL: raise FileExistsError(path)
            if path not in self.nodes: self.add(path, mode=mode)
        if path not in self.nodes: raise FileNotFoundError(path)
        node = self.nodes[path]
        if flags & self.os.O_DIRECTORY and not node.directory: raise NotADirectoryError(path)
        if flags & self.os.O_NOFOLLOW and stat.S_ISLNK(node.mode): raise OSError(errno.ELOOP, 'modeled link')
        self.next_fd += 1
        self.fds[self.next_fd] = [node, 0]
        return self.next_fd

    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self, descriptor。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 检查边界 / Checked boundaries: `descriptor in self.fds`.
    def close(self, descriptor):
        assert descriptor in self.fds, ('double/unknown close', descriptor)
        del self.fds[descriptor]
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, descriptor。
    # 结果：返回分支计算值（`self.fds[descriptor][0].info()`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.fds[descriptor][0].info()`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.fds[descriptor][0].info`.
    def fstat(self, descriptor): return self.fds[descriptor][0].info()
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, path, dir_fd = None, follow_symlinks = False。
    # 结果：返回分支计算值（`self.nodes[path].info()`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.nodes[path].info()`); its implementation and call sites define the actual type.
    # 失败 / Failure: `FileNotFoundError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.path`, `FileNotFoundError`, `self.nodes[path].info`.
    # 检查边界 / Checked boundaries: `not follow_symlinks`.
    def stat(self, path, dir_fd=None, follow_symlinks=False):
        assert not follow_symlinks
        path = self.path(path, dir_fd)
        if path not in self.nodes: raise FileNotFoundError(path)
        return self.nodes[path].info()
    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, path, mode, dir_fd。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `FileExistsError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.path`, `FileExistsError`, `self.add`, `self.events.append`.
    def mkdir(self, path, mode, dir_fd):
        path = self.path(path, dir_fd)
        if path in self.nodes: raise FileExistsError(path)
        self.add(path, True, mode=mode)
        self.events.append(('mkdir', path))
        if path.startswith('/sys/fs/cgroup/'):
            for name in ('cgroup.kill', 'cgroup.events'):
                self.add(path + '/' + name)
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: self, descriptor, size。
    # 结果：返回分支计算值（`data`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`data`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.fds[descriptor][1]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `len`.
    def read(self, descriptor, size):
        node, position = self.fds[descriptor]
        data = node.data[position:position + size]
        self.fds[descriptor][1] += len(data)
        return data
    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, descriptor, data。
    # 结果：返回分支计算值（`len(data)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`len(data)`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `node.data`, `self.fds[descriptor][1]`, `node.mtime`, `node.ctime`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `bytes`, `len`, `self.events.append`.
    def write(self, descriptor, data):
        node, position = self.fds[descriptor]
        data = bytes(data)
        node.data = node.data[:position] + data + node.data[position + len(data):]
        self.fds[descriptor][1] += len(data)
        node.mtime += 1; node.ctime += 1
        self.events.append(('write', node.path, len(data)))
        return len(data)
    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: self, descriptor, offset, whence。
    # 结果：返回分支计算值（`offset`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`offset`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `self.fds[descriptor][1]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 检查边界 / Checked boundaries: `whence == os.SEEK_SET`.
    def lseek(self, descriptor, offset, whence):
        assert whence == os.SEEK_SET
        self.fds[descriptor][1] = offset
        return offset
    # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
    # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
    # 输入 / Inputs: self, descriptor。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `OSError(errno.EIO, 'modeled sync failure')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.events.append`, `self.fsync_failure`, `OSError`.
    def fsync(self, descriptor):
        path = self.fds[descriptor][0].path
        self.events.append(('fsync', path))
        if self.fsync_failure and self.fsync_failure(path): raise OSError(errno.EIO, 'modeled sync failure')
    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self, path, dir_fd。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 失败 / Failure: `FileNotFoundError(path)`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `self.path`, `FileNotFoundError`, `self.events.append`.
    def unlink(self, path, dir_fd):
        path = self.path(path, dir_fd)
        if path not in self.nodes: raise FileNotFoundError(path)
        self.events.append(('unlink', path))
        del self.nodes[path]
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, descriptor。
    # 结果：返回分支计算值（`Iterator([name[len(path):] for name in self.nodes if name.startswith(path) and '/' not in name[len(p…`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`Iterator([name[len(path):] for name in self.nodes if name.startswith(path) and '/' not in name[len(p…`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `Iterator`, `len`, `name.startswith`.
    def scandir(self, descriptor):
        path = self.fds[descriptor][0].path + '/'
        return Iterator([name[len(path):] for name in self.nodes if name.startswith(path) and '/' not in name[len(path):]])


source = Path(sys.argv[1]).read_bytes()
tree = ast.parse(source)
definitions = ast.Module(body=[node for node in tree.body if isinstance(node, (ast.Assign, ast.FunctionDef, ast.ClassDef))], type_ignores=[])


# 中文功能：构造本组边界验证所需的模型对象或输入材料。
# English: Construct model objects or input material required by this boundary-verification group.
# 输入 / Inputs: 无 / none。
# 结果：返回分支计算值（`(ns, fs, value, boot)`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`(ns, fs, value, boot)`); its implementation and call sites define the actual type.
# 状态影响 / State effects: `value['cgroupName']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `dict`, `exec`, `compile`, `Filesystem`.
def fixture():
    ns = dict(base64=base64, ctypes=ctypes, errno=errno, hashlib=hashlib, io=io, json=json, os=os, re=re,
        signal=signal, stat=stat, struct=struct, subprocess=subprocess, sys=sys, tempfile=tempfile,
        time=time, uuid=uuid)
    exec(compile(definitions, 'production-controller-definitions', 'exec'), ns)
    fs = Filesystem()
    ns['os'], ns['ctypes'], ns['directory_fd'] = fs.os, fs.ctypes, fs.directory_fd
    for path in (ns['RUNTIME'], ns['RUNTIME'] + '/runs', ns['CGROUP']): fs.add(path, True)
    boot = str(uuid.uuid4())
    value = dict(version=1, phase='closed', mode='independent', registryId=str(uuid.uuid4()),
        identityId=str(uuid.uuid4()), projectId='default', runId=str(uuid.uuid4()), revision=1, bootId=boot,
        build='b' * 64, networkDevice='11', networkInode='200', cgroupDevice='11', cgroupInode='201', namespace='sk-default')
    value['cgroupName'] = 'sakura-identity-' + value['runId']
    fs.add(ns['run_path'](value['runId']), data=ns['run_bytes'](value))
    # 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
    # English: Read or resolve observable model data for adapted production-definition calls or assertions.
    # 输入 / Inputs: path, limit = 262144, missing = False。
    # 结果：返回分支计算值（`None / node.data`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`None / node.data`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `ns['refuse']`, `ns['trusted']`, `node.info`, `len`.
    def read(path, limit=262144, missing=False):
        if path not in fs.nodes:
            if missing: return None
            ns['refuse']('RECORD_ABSENT')
        node = fs.nodes[path]
        ns['trusted'](node.info(), mode=0o600)
        if len(node.data) > limit: ns['refuse']('RECORD_BOUND')
        return node.data
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: _value。
    # 结果：返回分支计算值（`fs.directory_fd(path) / None`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`fs.directory_fd(path) / None`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `fs.cgroup_calls`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `ns['refuse']`, `fs.add`, `fs.directory_fd`.
    def group(_value):
        fs.cgroup_calls += 1
        if fs.changed_group: ns['refuse']('CGROUP_REPLACED')
        if fs.busy or fs.closed_then_busy:
            path = ns['CGROUP'] + '/modeled-upper'
            if path not in fs.nodes: fs.add(path, True)
            return fs.directory_fd(path)
        return None
    ns.update(read=read, cgroup_fd=group, populated=lambda _fd: fs.busy or fs.cgroup_calls > 1,
        migration_ready=lambda _value: None, network_ready=lambda _value, _boot: None,
        cgroup_available=lambda *_args: None)
    return ns, fs, value, boot


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: ns, code, operation。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 失败 / Failure: `AssertionError('expected ' + code)`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `operation`, `AssertionError`.
# 检查边界 / Checked boundaries: `error.code == code`.
def refusal(ns, code, operation):
    try: operation()
    except ns['Refusal'] as error: assert error.code == code, (error.code, code)
    else: raise AssertionError('expected ' + code)


# 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
# English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
# 输入 / Inputs: ns, value。
# 结果：返回分支计算值（`ns['RUNTIME'] + '/archives/' + value['runId'][:2] + '/' + value['runId'] + '.bin'`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`ns['RUNTIME'] + '/archives/' + value['runId'][:2] + '/' + value['runId'] + '.bin'`); its implementation and call sites define the actual type.
def archived_path(ns, value):
    return ns['RUNTIME'] + '/archives/' + value['runId'][:2] + '/' + value['runId'] + '.bin'


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 协作入口 / Collaborators: `fixture`, `ns['run_bytes']`, `ns['run_archive']`, `ns['run_path']`.
# 检查边界 / Checked boundaries: `ns['run_archive'](value, boot) is True`; `ns['run_path'](value['runId']) not in fs.nodes`.
def successful_archive():
    ns, fs, value, boot = fixture()
    original = ns['run_bytes'](value)
    assert ns['run_archive'](value, boot) is True
    assert ns['run_path'](value['runId']) not in fs.nodes
    assert fs.nodes[archived_path(ns, value)].data == original
    assert ns['run_read'](value['runId']) == value
    before = list(fs.events)
    ns['run_write'](value)
    assert ns['stop'](value, value, boot) == value
    assert fs.events == before and ns['run_path'](value['runId']) not in fs.nodes
    publish = next(index for index, event in enumerate(fs.events) if event[0] == 'publish')
    unlink = next(index for index, event in enumerate(fs.events) if event == ('unlink', ns['run_path'](value['runId'])))
    assert publish < unlink and any(event[0] == 'fsync' and '/archives/' in event[1] for event in fs.events[publish:unlink])
    assert not fs.fds


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `copy['cgroupName']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `range`, `dict`, `str`.
# 检查边界 / Checked boundaries: `ns['compact_runs'](boot) == 512`; `len(ns['run_entries']()) == 512`.
def capacity_and_replay():
    ns, fs, value, boot = fixture()
    values = [value]
    for _index in range(ns['RUN_LIMIT'] - 1):
        copy = dict(value, runId=str(uuid.uuid4()))
        copy['cgroupName'] = 'sakura-identity-' + copy['runId']
        fs.add(ns['run_path'](copy['runId']), data=ns['run_bytes'](copy)); values.append(copy)
    assert ns['compact_runs'](boot) == 512
    assert len(ns['run_entries']()) == 512
    archived = [item for item in values if ns['run_path'](item['runId']) not in fs.nodes]
    assert len(archived) == 512
    for item in archived: assert ns['run_read'](item['runId']) == item
    for project in ('default', '1111111111111111'):
        identity = dict(value, projectId=project)
        refusal(ns, 'RUN_ARCHIVED', lambda: ns['prepare'](identity, {'runId': archived[0]['runId']}, boot, value['build']))
    refusal(ns, 'RUN_ARCHIVED', lambda: ns['run_write'](dict(archived[0], phase='active')))
    assert not fs.fds


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `copy['cgroupName']`, `ns['network_fd']`, `ns['atomic']`, `ns['uuid']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `range`, `dict`, `str`.
# 检查边界 / Checked boundaries: `admitted['phase'] == 'active' and len(ns['run_entries']()) == 513`; `ns['run_read'](admitted['runId']) == admitted and (not fs.fds)`.
def automatic_admission_and_random_collision():
    ns, fs, value, boot = fixture()
    for _index in range(ns['RUN_LIMIT'] - 1):
        copy = dict(value, runId=str(uuid.uuid4()))
        copy['cgroupName'] = 'sakura-identity-' + copy['runId']
        fs.add(ns['run_path'](copy['runId']), data=ns['run_bytes'](copy))
    network = '/modeled-network'; fs.add(network)
    ns['network_fd'] = lambda _value, _boot: (fs.open(network, fs.os.O_RDONLY),
        types.SimpleNamespace(st_dev=11, st_ino=200), 'sk-default')
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: path, data。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `fs.add`, `fs.events.append`.
    def atomic(path, data):
        fs.add(path, data=data); fs.events.append(('atomic', path))
    ns['atomic'] = atomic
    admitted = ns['prepare'](value, {}, boot, value['build'])
    assert admitted['phase'] == 'active' and len(ns['run_entries']()) == 513
    assert ns['run_read'](admitted['runId']) == admitted and not fs.fds
    archived = next(node for path, node in fs.nodes.items() if '/archives/' in path and path.endswith('.bin'))
    run_id = archived.path.rsplit('/', 1)[1][:-4]
    ns['uuid'] = types.SimpleNamespace(uuid4=lambda: run_id)
    before = list(fs.events)
    refusal(ns, 'RUN_ID_COLLISION', lambda: ns['prepare'](value, {}, boot, value['build']))
    assert fs.events == before and not fs.fds


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `fs.busy`, `before.data`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `ns['run_path']`, `ns['compact_runs']`, `any`.
# 检查边界 / Checked boundaries: `ns['compact_runs'](boot) == 0`; `fs.nodes[ns['run_path'](value['runId'])] is before`.
def busy_and_active_preserved():
    ns, fs, value, boot = fixture(); fs.busy = True
    before = fs.nodes[ns['run_path'](value['runId'])]
    assert ns['compact_runs'](boot) == 0
    assert fs.nodes[ns['run_path'](value['runId'])] is before
    assert not any(event[0] == 'publish' for event in fs.events)
    fs.busy = False
    before.data = ns['run_bytes'](dict(value, phase='active'))
    assert ns['compact_runs'](boot) == 0 and not fs.fds


# 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
# English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `fs.after_publish`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `ns['run_path']`, `refusal`, `archived_path`.
# 检查边界 / Checked boundaries: `fs.nodes[source_path].data == (original if parent_changed else b'unknown-later-object')`; `fs.nodes[archived_path(ns, value)].data == original and (not fs.fds)`.
def source_replacement_preserved():
    for parent_changed in (False, True):
        ns, fs, value, boot = fixture()
        source_path = ns['run_path'](value['runId'])
        original = fs.nodes[source_path].data
        # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
        # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
        # 输入 / Inputs: 无 / none。
        # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
        # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
        # 协作入口 / Collaborators: `fs.add`.
        def replace():
            if parent_changed: fs.add(ns['RUNTIME'] + '/runs', True)
            else: fs.add(source_path, data=b'unknown-later-object')
        fs.after_publish = replace
        refusal(ns, 'RUN_ARCHIVE_SOURCE_CHANGED', lambda: ns['run_archive'](value, boot))
        assert fs.nodes[source_path].data == (original if parent_changed else b'unknown-later-object')
        assert fs.nodes[archived_path(ns, value)].data == original and not fs.fds


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 协作入口 / Collaborators: `fixture`, `ns['run_archive_fd']`, `fs.close`, `dict`.
# 检查边界 / Checked boundaries: `fs.nodes[ns['run_path'](value['runId'])] is original`; `fs.nodes[archived_path(ns, value)].data == ns['run_bytes'](foreign) and (not fs.fds)`.
def conflicting_archive_preserved():
    ns, fs, value, boot = fixture()
    fd = ns['run_archive_fd'](value['runId'], True); fs.close(fd)
    foreign = dict(value, networkInode='777')
    fs.add(archived_path(ns, value), data=ns['run_bytes'](foreign))
    original = fs.nodes[ns['run_path'](value['runId'])]
    refusal(ns, 'RUN_ARCHIVE_CONFLICT', lambda: ns['run_archive'](value, boot))
    assert fs.nodes[ns['run_path'](value['runId'])] is original
    assert fs.nodes[archived_path(ns, value)].data == ns['run_bytes'](foreign) and not fs.fds


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `fs.fsync_failure`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('expected sync failure')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `fixture`, `archived_path`, `ns['run_archive']`, `AssertionError`.
# 检查边界 / Checked boundaries: `error.errno == errno.EIO`; `ns['run_path'](value['runId']) in fs.nodes and path in fs.nodes and (not fs.fds)`.
def lost_destination_sync_recovers():
    ns, fs, value, boot = fixture()
    path = archived_path(ns, value)
    fs.fsync_failure = lambda name: name == path.rsplit('/', 1)[0]
    try: ns['run_archive'](value, boot)
    except OSError as error: assert error.errno == errno.EIO
    else: raise AssertionError('expected sync failure')
    assert ns['run_path'](value['runId']) in fs.nodes and path in fs.nodes and not fs.fds
    before = list(fs.events); assert ns['run_read'](value['runId']) == value
    assert fs.events == before
    fs.fsync_failure = None
    assert ns['run_archive'](value, boot) is True
    assert ns['run_path'](value['runId']) not in fs.nodes and not fs.fds


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `fs.publish_error`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `ns['run_path']`, `refusal`, `archived_path`.
# 检查边界 / Checked boundaries: `fs.nodes[ns['run_path'](value['runId'])] is original`; `archived_path(ns, value) not in fs.nodes`.
def publication_refusals_keep_source():
    for error, code in ((errno.EEXIST, 'RUN_ARCHIVE_CONFLICT'), (errno.ENOSYS, 'RUN_ARCHIVE_ATOMIC_UNAVAILABLE'),
                        (errno.EIO, 'RUN_ARCHIVE_PUBLISH_FAILED')):
        ns, fs, value, boot = fixture(); fs.publish_error = error
        original = fs.nodes[ns['run_path'](value['runId'])]
        refusal(ns, code, lambda: ns['run_archive'](value, boot))
        assert fs.nodes[ns['run_path'](value['runId'])] is original
        assert archived_path(ns, value) not in fs.nodes
        assert not any('/.record-' in path for path in fs.nodes) and not fs.fds


# 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
# English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `fs.wrapper_available`, `fs.machine`, `fs.publish_error`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `ns['run_archive']`, `ns['run_read']`, `len`.
# 检查边界 / Checked boundaries: `ns['run_archive'](value, boot) is True`; `ns['run_read'](value['runId']) == value`.
def raw_syscall_publication_and_abi_refusals():
    for machine in ('x86_64', 'aarch64'):
        ns, fs, value, boot = fixture(); fs.wrapper_available = False; fs.machine = machine
        assert ns['run_archive'](value, boot) is True
        assert ns['run_read'](value['runId']) == value
        assert len(fs.syscall_calls) == 1 and not fs.fds
        for error, code in ((errno.EEXIST,'RUN_ARCHIVE_CONFLICT'), (errno.ENOSYS,'RUN_ARCHIVE_ATOMIC_UNAVAILABLE')):
            ns, fs, value, boot = fixture(); fs.wrapper_available = False; fs.machine = machine; fs.publish_error = error
            original = fs.nodes[ns['run_path'](value['runId'])]
            refusal(ns, code, lambda: ns['run_archive'](value, boot))
            assert fs.nodes[ns['run_path'](value['runId'])] is original
            assert archived_path(ns, value) not in fs.nodes and not fs.fds
    for setting, replacement in (('machine','unknown'), ('pointer_size',4), ('long_size',4), ('syscall_available',False)):
        ns, fs, value, boot = fixture(); fs.wrapper_available = False; setattr(fs,setting,replacement)
        original = fs.nodes[ns['run_path'](value['runId'])]
        refusal(ns,'RUN_ARCHIVE_ATOMIC_UNAVAILABLE',lambda: ns['run_archive'](value, boot))
        assert fs.nodes[ns['run_path'](value['runId'])] is original and not fs.syscall_calls and not fs.fds


# 中文功能：读取或解析测试夹具的可观察数据，供生产定义的适配调用或断言使用。
# English: Read or resolve observable model data for adapted production-definition calls or assertions.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `fs.nodes[path].data`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `list`, `ns['run_read']`, `ns['run_archive']`.
# 检查边界 / Checked boundaries: `ns['run_read'](value['runId']) == value`; `fs.events == before`.
def readonly_and_bad_archive():
    ns, fs, value, boot = fixture()
    before = list(fs.events); assert ns['run_read'](value['runId']) == value
    assert fs.events == before
    ns['run_archive'](value, boot); path = archived_path(ns, value)
    for data, code in ((b'incomplete', 'RUN_ARCHIVE_SIZE'), (ns['run_bytes'](dict(value, phase='active')), 'RUN_ARCHIVE_ACTIVE')):
        fs.nodes[path].data = data
        refusal(ns, code, lambda: ns['run_read'](value['runId']))
        assert fs.nodes[path].data == data and not fs.fds


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 协作入口 / Collaborators: `fixture`, `ns['run_path']`, `setattr`, `refusal`.
# 检查边界 / Checked boundaries: `fs.nodes[ns['run_path'](value['runId'])] is node and (not fs.fds)`.
def authority_refusals():
    for attribute, replacement, code in (('uid', 20001, 'UNTRUSTED_RECORD'), ('links', 2, 'RECORD_LINKS'),
                                         ('mode', stat.S_IFREG | 0o644, 'RECORD_PERMISSIONS')):
        ns, fs, value, boot = fixture()
        node = fs.nodes[ns['run_path'](value['runId'])]; setattr(node, attribute, replacement)
        refusal(ns, code, lambda: ns['run_archive'](value, boot))
        assert fs.nodes[ns['run_path'](value['runId'])] is node and not fs.fds


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `fs.closed_then_busy`, `fs.changed_group`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `refusal`, `ns['run_path']`, `any`.
# 检查边界 / Checked boundaries: `ns['run_path'](value['runId']) in fs.nodes and (not fs.fds)`; `not any((event[0] == 'publish' for event in fs.events)) and (not fs.fds)`.
def later_busy_and_changed_group():
    ns, fs, value, boot = fixture(); fs.closed_then_busy = True
    refusal(ns, 'RUN_ARCHIVE_SCOPE_BUSY', lambda: ns['run_archive'](value, boot))
    assert ns['run_path'](value['runId']) in fs.nodes and not fs.fds
    ns, fs, value, boot = fixture(); fs.changed_group = True
    refusal(ns, 'CGROUP_REPLACED', lambda: ns['run_archive'](value, boot))
    assert not any(event[0] == 'publish' for event in fs.events) and not fs.fds


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['RUN_ARCHIVE_BUCKET_LIMIT']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `ns['run_archive_fd']`, `fs.close`, `archived_path(ns, value).rsplit`.
# 检查边界 / Checked boundaries: `ns['run_path'](value['runId']) in fs.nodes and (not fs.fds)`; `not fs.events and (not fs.fds)`.
def bounded_archive_and_old_boot():
    ns, fs, value, boot = fixture()
    fd = ns['run_archive_fd'](value['runId'], True); fs.close(fd)
    ns['RUN_ARCHIVE_BUCKET_LIMIT'] = 2
    parent = archived_path(ns, value).rsplit('/', 1)[0]
    for name in ('neighbor-one', 'neighbor-two'): fs.add(parent + '/' + name, data=b'untouched')
    refusal(ns, 'RUN_ARCHIVE_LIMIT', lambda: ns['run_archive'](value, boot))
    assert ns['run_path'](value['runId']) in fs.nodes and not fs.fds
    ns, fs, value, boot = fixture()
    refusal(ns, 'RUN_ARCHIVE_STALE', lambda: ns['compact_runs'](str(uuid.uuid4())))
    assert not fs.events and not fs.fds


# 中文功能：构造本组边界验证所需的模型对象或输入材料。
# English: Construct model objects or input material required by this boundary-verification group.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `ns['RUN_LIMIT']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `fs.add`, `refusal`, `ns['run_path']`.
# 检查边界 / Checked boundaries: `not fs.events and (not fs.fds)`; `not fs.events and (not fs.fds)`.
def bounded_hot_records_and_unknown_files():
    ns, fs, value, boot = fixture(); fs.add(ns['RUNTIME'] + '/runs/unknown', data=b'untouched')
    refusal(ns, 'RUN_UNKNOWN_FILE', lambda: ns['compact_runs'](boot))
    assert not fs.events and not fs.fds
    ns, fs, value, boot = fixture(); ns['RUN_LIMIT'] = 1
    fs.add(ns['run_path'](str(uuid.uuid4())), data=ns['run_bytes'](value))
    refusal(ns, 'RUN_LIMIT', lambda: ns['run_entries']())
    assert not fs.events and not fs.fds


checks = [successful_archive, capacity_and_replay, automatic_admission_and_random_collision,
    busy_and_active_preserved, source_replacement_preserved,
    conflicting_archive_preserved, lost_destination_sync_recovers, publication_refusals_keep_source,
    raw_syscall_publication_and_abi_refusals,
    readonly_and_bad_archive, authority_refusals, later_busy_and_changed_group,
    bounded_archive_and_old_boot, bounded_hot_records_and_unknown_files]
for check in checks: check()
print(json.dumps({'passed': True, 'kind': 'portable-model-only', 'checks': [check.__name__ for check in checks],
    'sourceSha256': hashlib.sha256(source).hexdigest()}))
