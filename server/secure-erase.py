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


def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(2)


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
