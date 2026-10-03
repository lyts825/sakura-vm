#!/usr/bin/python3
"""Production descriptor/drop/payload checks on a caller-owned Linux fixture.

The caller owns the guest or PID/mount/network namespace. This script compiles
the exact launcher source, calls its production static functions and checks
the controller against real kernel descriptors. It is not account, cgroup,
sshd, cron or boot evidence and never changes an account or a firewall.
"""
import argparse
import ast
import contextlib
import ctypes
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import shlex
import socket
import stat
import struct
import subprocess
import tempfile
import termios
import time
import tty


parser = argparse.ArgumentParser()
parser.add_argument('source_directory')
parser.add_argument('proof')
parser.add_argument('--launcher', help='Optional installed production launcher for early-main refusal checks')
options = parser.parse_args()
assert os.name == 'posix' and os.getuid() == 0, 'requires root in a caller-owned Linux fixture'
source_directory = Path(options.source_directory).resolve(strict=True)
sources = {name: (source_directory / name).read_bytes() for name in ('protocol.h', 'launcher.c', 'controller.py')}
proof = dict(version=1, kind='linux-kernel-descriptor-and-payload-only', passed=False,
             kernel=os.uname().release, networkNamespace=os.readlink('/proc/self/ns/net'),
             sources={name: hashlib.sha256(data).hexdigest() for name, data in sources.items()},
             checks=[], unavailableFamilies=[])
tree = ast.parse(sources['controller.py'])
definitions = ast.Module(body=[node for node in tree.body if isinstance(node, (ast.Assign, ast.FunctionDef, ast.ClassDef))],
                         type_ignores=[])
production = dict(ctypes=ctypes, errno=errno, fcntl=fcntl, hashlib=hashlib, json=json, os=os,
                  re=re, socket=socket, stat=stat, struct=struct, subprocess=subprocess, time=time)
exec(compile(definitions, 'production-controller-descriptors', 'exec'), production)
sample = b'\x00\xff\nSakura stdin\x80\r\n'


@contextlib.contextmanager
def session_fd(channel):
    # Match the actual controller's fd3 publication; preserve this harness's
    # original fd3 without relying on subprocess close_fds/preexec ordering.
    try:
        previous = fcntl.fcntl(3, fcntl.F_DUPFD_CLOEXEC, 4)
    except OSError as error:
        if error.errno != errno.EBADF:
            raise
        previous = None
    duplicate = fcntl.fcntl(channel, fcntl.F_DUPFD_CLOEXEC, 4)
    try:
        os.dup2(duplicate, 3)
        yield
    finally:
        os.close(duplicate)
        if previous is None:
            os.close(3)
        else:
            os.dup2(previous, 3)
            os.close(previous)


def invoke(binary, arguments, target=None, channel=None, frame=None):
    if target is not None and (type(target) is not int or target not in range(4)):
        raise ValueError('descriptor target must be fd0, fd1, fd2 or fd3')
    if (target is None) != (channel is None) or \
       (channel is not None and (type(channel) is not int or channel < 0)):
        raise ValueError('descriptor target and nonnegative channel must be supplied together')
    if frame is not None and not isinstance(frame, bytes):
        raise TypeError('payload frame must be bytes')
    if frame is not None and target == 0:
        raise ValueError('payload frame and descriptor channel cannot both occupy stdin')
    kwargs = dict(stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=production['CLEAN_ENV'])
    # run(input=...) creates its stdin pipe itself. An explicit stdin alongside
    # a frame is forbidden; fd3 remains a separate binary session/EOF channel.
    if frame is None:
        kwargs['stdin'] = subprocess.PIPE
    else:
        kwargs['input'] = frame
    if target in (0, 1, 2):
        kwargs[('stdin', 'stdout', 'stderr')[target]] = channel
    if target == 3:
        with session_fd(channel):
            result = subprocess.run([str(binary)] + arguments, pass_fds=(3,),
                                    capture_output=False, timeout=10, **kwargs)
    else:
        result = subprocess.run([str(binary)] + arguments, capture_output=False, timeout=10, **kwargs)
    return result


def frame(script, flags=0):
    body = script.encode()
    return struct.pack('<8sIIIIII', b'SKIDP001', 1, flags, len(body), 0, len(body), 0) + body


def assert_local(binary, descriptor, session=False):
    before = os.fstat(descriptor)
    after = production['local_transport'](descriptor, 'FIXTURE_NETWORK_CHANNEL')
    assert (after.st_dev, after.st_ino) == (before.st_dev, before.st_ino)
    for target in range(4):
        result = invoke(binary, ['check', str(target)], target, descriptor)
        assert result.returncode == 0, (target, result.stderr)
    if session:
        result = invoke(binary, ['session'], 3, descriptor)
        assert result.returncode == 0 and result.stdout == b'valid\n', result.stderr


def assert_network(binary, descriptor, family):
    try:
        production['local_transport'](descriptor, 'FIXTURE_NETWORK_CHANNEL')
    except production['Refusal'] as error:
        assert error.code == 'FIXTURE_NETWORK_CHANNEL'
    else:
        raise AssertionError('controller accepted network descriptor ' + str(family))
    for target in range(4):
        result = invoke(binary, ['check', str(target)], target, descriptor)
        assert result.returncode == 126, (family, target, result.returncode, result.stderr)
        if target != 2:
            assert b'SAKURA_PROJECT_IDENTITY:NETWORK_CHANNEL' in result.stderr
        if options.launcher:
            result = invoke(options.launcher, [], target, descriptor)
            assert result.returncode == 126, (family, target, result.returncode)
            if target != 2:
                assert b'SAKURA_PROJECT_IDENTITY:NETWORK_CHANNEL' in result.stderr, result.stderr


try:
    with tempfile.TemporaryDirectory(prefix='sakura-identity-fds-') as temporary:
        folder = Path(temporary)
        for name in ('protocol.h', 'launcher.c'):
            (folder / name).write_bytes(sources[name])
        # Renaming main exposes the exact production static functions without
        # adding a testing switch or changing any production authority checks.
        harness = r'''#define PROJECT_BUILD "0000000000000000000000000000000000000000000000000000000000000000"
#define main sakura_production_main
#include "launcher.c"
#undef main
int main(int argc, char **argv) {
    if (argc == 3 && !strcmp(argv[1], "check")) {
        local_transport(atoi(argv[2]));
        return 0;
    }
    for (int fd = 0; fd <= 3; ++fd) local_transport(fd);
    if (argc == 2 && !strcmp(argv[1], "session")) {
        if (!session_input_valid()) return 1;
        puts("valid"); return 0;
    }
    if (argc != 3 || strcmp(argv[1], "frame")) return 2;
    bool session = session_input_valid();
    if (clearenv() || setenv("PATH", "/usr/bin:/bin", 1)) return 3;
    capabilities_drop(20000, 20000);
    struct payload body = payload_read(argv[2], session);
    payload_exec(&body);
    return 4;
}
'''
        (folder / 'harness.c').write_text(harness)
        binary = folder / 'harness'
        compile_result = subprocess.run(['gcc', '-O2', '-Wall', '-Wextra', '-Werror',
                                         str(folder / 'harness.c'), '-o', str(binary)],
                                        capture_output=True, text=True, timeout=30)
        assert compile_result.returncode == 0, compile_result.stderr
        proof['compiler'] = subprocess.check_output(['gcc', '--version'], text=True).splitlines()[0]
        for family, kind in ((socket.AF_INET, socket.SOCK_DGRAM), (socket.AF_INET6, socket.SOCK_DGRAM),
                             (getattr(socket, 'AF_PACKET', 17), socket.SOCK_RAW),
                             (getattr(socket, 'AF_NETLINK', 16), socket.SOCK_RAW),
                             (getattr(socket, 'AF_VSOCK', 40), socket.SOCK_STREAM)):
            try:
                network = socket.socket(family, kind)
            except OSError as error:
                if family in (socket.AF_INET, socket.AF_INET6):
                    raise
                proof['unavailableFamilies'].append(dict(family=family, errno=error.errno))
                continue
            with network:
                assert_network(binary, network.fileno(), family)
            proof['checks'].append('network_family_' + str(family) + '_rejected_on_fd0_fd1_fd2_fd3')
        with tempfile.TemporaryFile() as output:
            assert_local(binary, output.fileno())
        read_fd, write_fd = os.pipe()
        try:
            assert_local(binary, read_fd, True)
        finally:
            os.close(read_fd)
            os.close(write_fd)
        with contextlib.ExitStack() as stack:
            left, right = socket.socketpair()
            stack.enter_context(left)
            stack.enter_context(right)
            assert_local(binary, left.fileno(), True)
        master, slave = pty.openpty()
        try:
            assert_local(binary, slave, True)
        finally:
            os.close(master)
            os.close(slave)
        proof['checks'].append('regular_output_pipe_unix_socketpair_pty_preserved')

        reader = ('import hashlib,json,os,sys\n'
                  'data=sys.stdin.buffer.read()\n'
                  'status=dict(line.split(":",1) for line in open("/proc/self/status") if ":" in line)\n'
                  'print(json.dumps(dict(uid=os.getuid(),gid=os.getgid(),nnp=status["NoNewPrivs"].strip(),'
                  'caps=status["CapEff"].strip(),sha256=hashlib.sha256(data).hexdigest())),flush=True)')
        payload = frame('exec /usr/bin/python3 -I -S -c ' + shlex.quote(reader), 2)
        for kind in ('pipe', 'unix'):
            with contextlib.ExitStack() as stack:
                if kind == 'pipe':
                    input_fd, writer = os.pipe()
                    stack.callback(os.close, input_fd)
                    os.write(writer, sample)
                    os.close(writer)
                else:
                    left, right = socket.socketpair()
                    stack.enter_context(left)
                    stack.enter_context(right)
                    right.sendall(sample)
                    right.shutdown(socket.SHUT_WR)
                    input_fd = left.fileno()
                result = invoke(binary, ['frame', hashlib.sha256(payload).hexdigest()], 3, input_fd, payload)
                assert result.returncode == 0, result.stderr
                actual = json.loads(result.stdout)
                assert actual == dict(uid=20000, gid=20000, nnp='1', caps='0000000000000000',
                                      sha256=hashlib.sha256(sample).hexdigest()), actual
            proof['checks'].append('binary_' + kind + '_session_eof_and_no_privileges_preserved')

        master, slave = pty.openpty()
        try:
            tty.setraw(slave)
            payload = frame('test -t 0 && test -t 1 && test -t 2 && printf PTY-preserved', 1)
            process = subprocess.Popen([str(binary), 'frame', hashlib.sha256(payload).hexdigest()],
                                       stdin=subprocess.PIPE, stdout=slave, stderr=slave,
                                       env=production['CLEAN_ENV'])
            try:
                process.communicate(payload, timeout=10)
                assert process.returncode == 0
                ready, _, _ = select.select([master], [], [], 2)
                assert ready and os.read(master, 65536) == b'PTY-preserved'
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
        finally:
            os.close(master)
            os.close(slave)
        proof['checks'].append('terminal_frame_preserves_all_three_pty_descriptors')
        proof['passed'] = True
except BaseException as error:
    proof['error'] = repr(error)
    raise
finally:
    Path(options.proof).write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps(proof, separators=(',', ':')), flush=True)
