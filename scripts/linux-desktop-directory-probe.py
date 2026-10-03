"""Owned Wayland smoke application, launched by the real public controller.

The project task copies Python to its own 0700 ELF; the public controller
pins that private application image through the mapped directory view.
This file is uploaded as a Root-owned fixture; it never runs as Root.
"""
import errno
import json
import os
from pathlib import Path
import socket
import stat
import struct
import sys
import time


directory, marker, compositor, sibling = map(Path, sys.argv[1:5])
result = {"uid": os.getuid(), "gid": os.getgid(), "cwd": os.getcwd(), "passed": False}
connection = None
try:
    assert 1000 <= os.getuid() < 20000 and os.getgid() == os.getuid()
    assert directory.is_absolute() and marker.parent == directory
    assert os.getcwd() == str(directory)
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines())
    assert status['NoNewPrivs'].strip() == '1'
    assert all(int(status[key].strip(), 16) == 0 for key in ('CapInh', 'CapPrm', 'CapEff', 'CapAmb'))
    assert all(int(value) == os.getuid() for value in status['Uid'].split())
    assert all(int(value) == os.getgid() for value in status['Gid'].split())
    assert not status['Groups'].strip()
    result['status'] = {key: status[key].strip() for key in ('Uid', 'Gid', 'Groups', 'NoNewPrivs', 'CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb')}
    result['mountNamespace'] = str(os.stat('/proc/self/ns/mnt').st_ino)
    result['cgroup'] = Path('/proc/self/cgroup').read_text()
    original = directory / 'private.txt'
    info = original.stat()
    assert info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600
    assert original.read_bytes() == b'owned-alpha'
    original.write_bytes(b'mapped-alpha')
    os.umask(0o077)
    Path('created-relative.txt').write_bytes(b'owned-relative')
    (directory / 'created-absolute.txt').write_bytes(b'owned-absolute')
    assert Path('private.txt').read_bytes() == b'mapped-alpha'
    assert not sibling.exists(), 'private ancestor exposed its sibling in application view'
    result['absoluteAndRelativeReadWrite'] = True
    result['privateAncestorSiblingHidden'] = True
    direct = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    direct.settimeout(3)
    try:
        direct.connect(str(compositor))
        raise AssertionError('independent application UID reached the real compositor')
    except PermissionError as error:
        assert error.errno == errno.EACCES
        result['directCompositorDenied'] = True
    finally:
        direct.close()
    runtime = Path(os.environ['XDG_RUNTIME_DIR'])
    endpoint = runtime / os.environ['WAYLAND_DISPLAY']
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(5)
    connection.connect(str(endpoint))
    # Genuine wl_display.sync (new callback object 2), through the product
    # proxy. Keep that connection alive so controller inventory sees the app.
    connection.sendall(struct.pack('<III', 1, 12 << 16, 2))
    buffer = bytearray()
    deadline = time.monotonic() + 5
    acknowledged = False
    while time.monotonic() < deadline and not acknowledged:
        data = connection.recv(4096)
        assert data
        buffer.extend(data)
        while len(buffer) >= 8:
            sender, header = struct.unpack_from('<II', buffer)
            size, opcode = header >> 16, header & 0xffff
            assert 8 <= size <= 4096 and size % 4 == 0
            if len(buffer) < size:
                break
            if sender == 2 and opcode == 0 and size == 12:
                acknowledged = True
            del buffer[:size]
    assert acknowledged, 'real compositor sync did not acknowledge through product proxy'
    result['productProxySyncAcknowledged'] = True
    result['proxyEndpoint'] = str(endpoint)
    result['mappedDirectory'] = {'dev': str(directory.stat().st_dev), 'ino': str(directory.stat().st_ino),
                                 'uid': directory.stat().st_uid, 'gid': directory.stat().st_gid,
                                 'mode': stat.S_IMODE(directory.stat().st_mode)}
    result['passed'] = True
except BaseException as error:
    result['error'] = type(error).__name__ + ': ' + str(error)
finally:
    marker.write_text(json.dumps(result))

# Public controller must observe and then stop this exact app scope. Neither
# an early process exit nor a model namespace is accepted as a product pass.
try:
    while True:
        time.sleep(1)
finally:
    if connection is not None:
        connection.close()
