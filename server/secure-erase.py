# 模块职责：对经核验的项目普通文件执行覆写与删除，检测读取长度变化和路径越界。
# Module purpose: Overwrites/removes verified project regular files, checking read lengths, original identity and path boundaries.
"""Guest-side logical overwrite. It does not prove physical media erasure."""

import base64
import fcntl
import hashlib
import json
import os
import stat
import sys
from datetime import datetime, timezone


CHUNK = 1024 * 1024
MAX_BYTES = 128 * 1024 * 1024


# 入口 / Entry: fail.
# 功能：向 stderr 输出拒绝原因并以退出码 2 结束逻辑擦除操作。
# Purpose: Reports a refusal reason to stderr and exits the logical-erasure operation with status 2.
# 输入 / Inputs: message
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 拒绝 / Refusals: `SystemExit(2)`.
def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(2)


# 逐级使用目录 FD 和 O_NOFOLLOW 打开，后续操作保留同一父目录与文件句柄，不重新解析链接路径。
# 入口 / Entry: open_file.
# 功能：逐级固定父目录 FD 并以 O_NOFOLLOW 打开原文件，返回供后续身份核验和删除使用的句柄。
# Purpose: Pins parent-directory FDs component by component and opens the original file with O_NOFOLLOW, returning handles for identity checks/removal.
# 输入 / Inputs: path; write
# 输出 / Returns: `(directory, name, file_descriptor)`
# 副作用 / Effects: 调用 / calls `os.open`, `os.close`.
# 拒绝 / Refusals: `'无效的项目文件路径'`; `re-raise`.
def open_file(path, write):
    parts = path.split("/")
    if not path.startswith("/") or any(part in ("", ".", "..") for part in parts[1:]):
        fail("无效的项目文件路径")
    directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in parts[1:-1]:
            next_directory = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                     dir_fd=directory)
            os.close(directory)
            directory = next_directory
        name = parts[-1]
        flags = (os.O_RDWR if write else os.O_RDONLY) | os.O_NOFOLLOW
        file_descriptor = os.open(name, flags, dir_fd=directory)
        return directory, name, file_descriptor
    except BaseException:
        os.close(directory)
        raise


# 入口 / Entry: hash_file.
# 功能：精确读取预期字节数并计算 SHA-256，提前 EOF 表示文件变化而拒绝。
# Purpose: Reads the exact expected byte count and computes SHA-256, refusing premature EOF as file change.
# 输入 / Inputs: fd; size
# 输出 / Returns: `digest.hexdigest()`
# 副作用 / Effects: 调用 / calls `os.read`.
# 拒绝 / Refusals: `'读取期间文件长度发生变化'`.
def hash_file(fd, size):
    digest = hashlib.sha256()
    os.lseek(fd, 0, os.SEEK_SET)
    remaining = size
    while remaining:
        chunk = os.read(fd, min(CHUNK, remaining))
        if not chunk:
            fail("读取期间文件长度发生变化")
        digest.update(chunk)
        remaining -= len(chunk)
    return digest.hexdigest()


# 入口 / Entry: overwrite.
# 功能：对固定文件 FD 写入随机或零字节，处理短写并 fsync 确认逻辑覆写落盘。
# Purpose: Writes random/zero bytes to the pinned file FD, handling short writes and fsyncing logical overwrite persistence.
# 输入 / Inputs: fd; size; randomize
# 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
# 副作用 / Effects: 调用 / calls `os.write`, `os.fsync`.
# 拒绝 / Refusals: `'覆盖写入未完成'`.
def overwrite(fd, size, randomize):
    os.lseek(fd, 0, os.SEEK_SET)
    remaining = size
    while remaining:
        count = min(CHUNK, remaining)
        data = os.urandom(count) if randomize else bytes(count)
        written = 0
        while written < count:
            amount = os.write(fd, data[written:])
            if amount <= 0:
                fail("覆盖写入未完成")
            written += amount
        remaining -= count
    os.fsync(fd)


# 入口 / Entry: main.
# 功能：核验预览 token、原文件身份和单链接限制，三轮覆写校验后才解除原目录项。
# Purpose: Checks preview token, original file identity and the single-link restriction, unlinking the original directory entry only after three verified overwrite passes.
# 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
# 输出 / Returns: `None`
# 副作用 / Effects: 调用 / calls `open_file`, `fcntl.flock`, `overwrite`, `os.unlink`, `os.fsync`, `os.close`.
# 拒绝 / Refusals: `'仅允许单链接的普通文件'`; `'文件超过 128 MiB 上限'`; `'预览已过期：文件内容或身份发生变化'`.
# 设计：预览摘要绑定设备、inode、大小、时间与内容；零字节校验和最终目录项身份核对后才 unlink。结果仅确认逻辑覆写，不能证明物理介质擦除。
# Design: Preview digest binds device, inode, size, timestamps and contents; unlink follows zero-byte verification and final directory-entry identity checks. The result confirms logical overwrite, not physical-media erasure.
# 收尾 / Finalization: `os.close(fd)`; `os.close(directory)`.
def main():
    request = json.loads(base64.b64decode(sys.argv[1], validate=True))
    path = request["path"]
    erase = request["action"] == "erase"
    directory, name, fd = open_file(path, erase)
    try:
        if erase:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            fail("仅允许单链接的普通文件")
        if info.st_size > MAX_BYTES:
            fail("文件超过 128 MiB 上限")
        before = hash_file(fd, info.st_size)
        identity = {"path": path, "device": info.st_dev, "inode": info.st_ino,
                    "size": info.st_size, "mtimeNs": info.st_mtime_ns,
                    "ctimeNs": info.st_ctime_ns, "sha256": before}
        token = hashlib.sha256(json.dumps(identity, sort_keys=True,
                                           separators=(",", ":")).encode()).hexdigest()
        if not erase:
            print(json.dumps({"previewToken": token, "bytes": info.st_size,
                              "sha256Before": before, "path": path}))
            return
        # 删除必须匹配预览时的物理身份及内容摘要；路径相同也不能替代旧预览证明。
        if request.get("previewToken") != token:
            fail("预览已过期：文件内容或身份发生变化")
        for randomize in (True, True, False):
            overwrite(fd, info.st_size, randomize)
        zero_hash = hash_file(fd, info.st_size)
        expected = hashlib.sha256()
        remaining = info.st_size
        while remaining:
            count = min(CHUNK, remaining)
            expected.update(bytes(count))
            remaining -= count
        if zero_hash != expected.hexdigest():
            fail("覆盖后的逻辑内容校验失败，文件未删除")
        current = os.stat(name, dir_fd=directory, follow_symlinks=False)
        last = os.fstat(fd)
        if (current.st_dev, current.st_ino, current.st_size, current.st_nlink) != (
                info.st_dev, info.st_ino, info.st_size, 1) or last.st_nlink != 1:
            fail("文件身份发生变化，未执行删除")
        # 覆写校验及最终路径身份都通过后才解除目录项；结果仅确认逻辑内容，不证明介质擦除。
        os.unlink(name, dir_fd=directory)
        os.fsync(directory)
        try:
            os.stat(name, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            fail("删除后路径仍存在")
        print(json.dumps({"bytes": info.st_size, "sha256Before": before,
                          "sha256After": zero_hash, "passes": 3, "removed": True,
                          "path": path, "recordedAt": datetime.now(timezone.utc).isoformat()}))
    finally:
        os.close(fd)
        os.close(directory)


try:
    main()
except SystemExit:
    raise
except Exception as error:
    fail(f"逻辑擦除失败：{error}")
