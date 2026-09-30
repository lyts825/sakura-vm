"""Run only in the smoke script's owned VM on a separate, authenticated Xvfb."""
import os
import pwd
import select
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

MAGIC = 0x58434C50
library, fixture, build = sys.argv[1:4]
directory = Path(tempfile.mkdtemp(prefix="sakura-x11-smoke-", dir="/var/tmp"))
directory.chmod(0o755)
try:
    user = pwd.getpwnam("sa-x11-fixture")
except KeyError:
    subprocess.run(["useradd", "-m", "-s", "/bin/sh", "sa-x11-fixture"], check=True)
    user = pwd.getpwnam("sa-x11-fixture")
children = []
policies = {}
counter = 0
generation = 0
display = ":93"
request_maximum = 0
auth = directory / "Xauthority"
subprocess.run(["xauth", "-f", str(auth), "add", display, ".", os.urandom(16).hex()], check=True)
os.chown(auth, user.pw_uid, user.pw_gid)
auth.chmod(0o600)
environment = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": user.pw_dir,
               "DISPLAY": display, "XAUTHORITY": str(auth)}

def credentials():
    os.setgroups([])
    os.setgid(user.pw_gid)
    os.setuid(user.pw_uid)

def rule(name, flags=23, maximum=1048576):
    global generation
    generation += 1
    path = directory / (name + ".policy")
    temporary = path.with_suffix(".new")
    temporary.write_bytes(struct.pack("<IIIIQ65s39x", MAGIC, 1, flags, maximum, generation, build.encode()))
    temporary.chmod(0o644)
    temporary.replace(path)
    policies[name] = path
    return path

def start(toolkit, action, target="UTF8_STRING", data=b"ordinary text", policy=None, extra=None, selection="CLIPBOARD"):
    global counter
    for child in children:
        if child.poll() is not None:
            for stream in [child.stdin, child.stdout, child.stderr]:
                if stream:
                    stream.close()
    counter += 1
    file = directory / (str(counter) + ".data")
    file.write_bytes(data)
    file.chmod(0o644)
    env = dict(environment)
    descriptors = []
    if policy:
        env.update(LD_PRELOAD=library, SAKURA_CLIPBOARD_POLICY=str(policies[policy]))
        status = directory / (str(counter) + ".status")
        status.write_bytes(struct.pack("<IIQQQ65s31x", MAGIC, 1, 0, 0, 0, build.encode()))
        status.chmod(0o600)
        descriptor = os.open(status, os.O_RDWR)
        descriptors.append(descriptor)
        env["SAKURA_CLIPBOARD_STATUS_FD"] = str(descriptor)
    args = [fixture, toolkit, action, target, str(file), selection]
    if extra is not None:
        args.append(str(extra))
    process = subprocess.Popen(args, env=env, preexec_fn=credentials, start_new_session=True,
                               pass_fds=descriptors, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True)
    children.append(process)
    for descriptor in descriptors:
        os.close(descriptor)
    return process

def line(process):
    ready, _, _ = select.select([process.stdout], [], [], 15)
    assert ready, "fixture did not answer"
    answer = process.stdout.readline().strip()
    assert answer, (process.poll(), process.stderr.read() if process.poll() is not None else "fixture ended")
    return answer

def owner(toolkit, **options):
    process = start(toolkit, "owner", **options)
    assert line(process) == "READY", "fixture did not own its private clipboard"
    return process

def read(toolkit, **options):
    process = start(toolkit, options.pop("action", "read"), **options)
    answer = line(process)
    assert process.wait(15) == 0, process.stderr.read()
    return answer


def incremental(toolkit, other):
    """Exercise a real PropertyDelete-driven owner, never just an INCR marker."""
    data = ("ordinary \u754c\u00e9 incremental text\n".encode() * 14000)[:700001]
    # Finish on a UTF-8 boundary while splitting multibyte characters in chunks.
    data = data.decode("utf-8", "ignore").encode()
    rule("source"); rule("sink")
    for guarded_source, guarded_sink in [(True, False), (False, True), (True, True)]:
        source = owner(toolkit, data=data, policy="source" if guarded_source else None,
                       extra="incr:32767")
        assert read(other, policy="sink" if guarded_sink else None) == data.hex()
        assert read("mixed", policy="sink" if guarded_sink else None, action="size") == data.hex()
        if guarded_sink:
            for receiver in ["xlib", "xcb", "mixed"]:
                assert read(receiver, policy="sink", action="concurrent", data=data) == "COMPLETE"
        if guarded_source:
            external = subprocess.run(["xclip", "-selection", "clipboard", "-out", "-target", "UTF8_STRING"],
                                      env=environment, preexec_fn=credentials, capture_output=True, timeout=15)
            assert external.returncode == 0 and external.stdout == data
        source.terminate(); source.wait(15)
    # Tiny chunks straddle a UTF-8 code point and each supported secret pattern.
    for value in ["A\u754c\u00e9Z".encode(), b"prefix password=0123456789abcdef trailing",
                  b"-----BEGIN PRIVATE KEY-----", b"ghp_" + b"a"*35,
                  b"https://user:0123456789abcdef@example.test/path",
                  b"eyJ" + b"a"*20 + b"." + b"b"*20 + b"." + b"c"*20, b"\xc3\x28"]:
        secret = value != "A\u754c\u00e9Z".encode()
        for guarded_source in [True, False]:
            rule("source", 31); rule("sink", 31)
            source = owner(toolkit, data=value, policy="source" if guarded_source else None, extra="incr:3")
            assert read(other, policy=None if guarded_source else "sink") == ("DENIED" if secret else value.hex())
            source.terminate(); source.wait(15)
    rule("source"); rule("sink")
    for guarded_source in [True, False]:
        source = owner(toolkit, data=b"", policy="source" if guarded_source else None, extra="incr:3")
        assert read(other, policy=None if guarded_source else "sink", action="size") == "EMPTY"
        source.terminate(); source.wait(15)
    source = owner(toolkit, data=b"cache after a complete INCR transfer", extra="incr:7")
    cached = start("mixed", "cache", policy="sink")
    assert line(cached) == b"cache after a complete INCR transfer".hex()
    rule("sink", 21); cached.stdin.write("recheck\n"); cached.stdin.flush()
    assert line(cached) == "DENIED" and cached.wait(15) == 0
    rule("sink")
    deleting = start(other, "delete", policy="sink")
    assert line(deleting) == b"cache after a complete INCR transfer".hex()
    deleting.stdin.write("recheck\n"); deleting.stdin.flush()
    assert line(deleting) == "DENIED" and deleting.wait(15) == 0
    assert read(other, policy="sink", action="short") == "DENIED"
    source.terminate(); source.wait(15)
    if other == "xcb":
        source = owner(toolkit, extra="incr:2")
        for action in ["wait", "wait64", "poll", "poll64", "size"]:
            assert read(other, policy="sink", action=action) == b"ordinary text".hex()
        source.terminate(); source.wait(15)
    # Format/type changes, invalid hints, and missing terminators cannot expose a prefix.
    for mode in ["incr-bad-type:4", "incr-bad-format:4", "incr-hint:4", "incr-overhint:4", "incr-bad-header:4"]:
        for guarded_source in [True, False]:
            source = owner(toolkit, policy="source" if guarded_source else None, extra=mode)
            assert read(other, policy=None if guarded_source else "sink") == "DENIED", mode
            source.terminate(); source.wait(15)
    for guarded_source in [True, False]:
        source = owner(toolkit, policy="source" if guarded_source else None, extra="incr-stall:4")
        started = time.monotonic()
        assert read(other, policy=None if guarded_source else "sink") == "DENIED"
        assert time.monotonic() - started < 12
        source.terminate(); source.wait(15)
    for guarded_source in [True, False]:
        rule("source", 23, 1024); rule("sink", 23, 1024)
        source = owner(toolkit, data=b"x"*2048, policy="source" if guarded_source else None, extra="incr-underhint:257")
        assert read(other, policy=None if guarded_source else "sink") == "DENIED"
        source.terminate(); source.wait(15)
    # Atomic policy replacement while the owner is stopped between two chunks.
    for guarded_source in [True, False]:
        for flags, maximum in [(22 if guarded_source else 21, 1048576), (31, 1048576), (23, 1024)]:
            rule("source"); rule("sink")
            source = owner(toolkit, data=b"prefix password=0123456789abcdef " + b"x"*1500,
                           policy="source" if guarded_source else None, extra="incr-pause:13")
            sink = start(other, "read", policy=None if guarded_source else "sink")
            assert line(source) == "CHUNK"
            rule("source" if guarded_source else "sink", flags, maximum)
            source.stdin.write("continue\n"); source.stdin.flush()
            assert line(sink) == "DENIED" and sink.wait(15) == 0
            source.terminate(); source.wait(15)
    rule("source"); rule("sink")
    source = owner(toolkit, data=b"primary incremental", selection="PRIMARY", policy="source", extra="incr:3")
    assert read(other, policy="sink", selection="PRIMARY") == b"primary incremental".hex()
    source.terminate(); source.wait(15)
    # Xlib's 32-bit properties use unsigned-long stride; XCB uses packed CARD32.
    cards = struct.pack("<IIII", 0x12345678, 0, 0xFFFFFFFF, 0x87654321)
    for guarded_source in [True, False]:
        source = owner(toolkit, target="application/sakura-card32", data=cards,
                       policy="source" if guarded_source else None, extra="incr32:8")
        assert read(other, target="application/sakura-card32", policy=None if guarded_source else "sink") == cards.hex()
        source.terminate(); source.wait(15)
    for guarded_source in [True, False]:
        rule("source", 19); rule("sink", 19)
        source = owner(toolkit, policy="source" if guarded_source else None, extra="incr-targets:8")
        formats = read(other, target="TARGETS", policy=None if guarded_source else "sink")
        assert formats == "UTF8_STRING;TARGETS;TIMESTAMP;", formats
        source.terminate(); source.wait(15)
    rule("source"); rule("sink")
    source = owner(toolkit, extra="incr:7")
    assert read(other, policy="sink", action="stress") == "32/16"
    source.terminate(); source.wait(15)
    if toolkit == "xlib" and request_maximum < 16*1024*1024 + 28:
        source = owner(toolkit, target="application/sakura-binary", data=b"x"*(16*1024*1024),
                       policy="source", extra="incr:65536")
        assert read(other, target="application/sakura-binary") == "DENIED"
        source.terminate(); source.wait(15)
        print("Complete binary INCR exceeding the server's atomic request limit was refused", flush=True)
    print(toolkit + ": complete INCR in both directions, UTF8/secret boundaries, cached aliases, delete, generic replies, malformed/timeout/limits, live tightening and CARD32 passed", flush=True)

try:
    server = subprocess.Popen(["Xvfb", display, "-screen", "0", "320x240x24", "-nolisten", "tcp", "-auth", str(auth)],
                              env=environment, preexec_fn=credentials, start_new_session=True,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    children.append(server)
    for _ in range(100):
        if Path("/tmp/.X11-unix/X93").exists():
            break
        assert server.poll() is None
        time.sleep(.1)
    request_maximum = int(read("xcb", action="maximum"))
    print("Owned X11 maximum request bytes: " + str(request_maximum), flush=True)
    for toolkit in ["xlib", "xcb", "mixed"]:
        other = "xcb" if toolkit == "xlib" else "xlib"
        rule("source")
        rule("sink")
        source = owner(toolkit, policy="source")
        assert read("mixed", policy="sink", action="reply-stress") == "DENIED"
        assert read(other, policy="sink") == b"ordinary text".hex()
        assert read(other, policy="sink", action="size") == b"ordinary text".hex()
        assert read("mixed", policy="sink") == b"ordinary text".hex()
        external = subprocess.run(["xclip", "-selection", "clipboard", "-out", "-target", "UTF8_STRING"],
                                  env=environment, preexec_fn=credentials, capture_output=True, timeout=15)
        assert external.returncode == 0 and external.stdout == b"ordinary text"
        rule("sink", 21)
        assert read(other, policy="sink") == "DENIED"
        assert read("mixed", policy="sink") == "DENIED"
        rule("sink")
        rule("source", 22)
        assert read(other) == "DENIED"
        rule("source")
        assert read(other) == b"ordinary text".hex()
        cached = start(other, "cache", policy="sink")
        assert line(cached) == b"ordinary text".hex()
        rule("sink", 21)
        cached.stdin.write("recheck\n"); cached.stdin.flush()
        assert line(cached) == "DENIED"
        assert cached.wait(15) == 0
        rule("sink")
        source.terminate(); source.wait(15)

        source = owner(toolkit, data=b"prefix password=0123456789abcdef trailing", policy="source")
        rule("source", 31)
        assert read(other) == "DENIED"
        rule("source")
        rule("sink", 31)
        assert read(other, policy="sink") == "DENIED"
        assert read(other, policy="sink", action="size") == "DENIED"
        rule("sink")
        assert read(other, policy="sink") != "DENIED"
        source.terminate(); source.wait(15)
        source = owner(toolkit, policy="source", selection="PRIMARY")
        assert read(other, policy="sink", selection="PRIMARY") == b"ordinary text".hex()
        rule("source", 22)
        assert read(other, selection="PRIMARY") == "DENIED"
        rule("source", 0)
        assert read(other, selection="PRIMARY") == b"ordinary text".hex()
        source.terminate(); source.wait(15)
        rule("source")
        for data in [b"x"*2048, "界".encode()*400, b"\xff\xfe"]:
            source = owner(toolkit, data=data)
            rule("sink", 23, 1024)
            assert read(other, policy="sink") == "DENIED"
            source.terminate(); source.wait(15)
        rule("sink")
        source = owner(toolkit, target="text/uri-list", data=b"file:///fixture.txt", policy="source")
        assert read(other, target="text/uri-list", policy="sink") != "DENIED"
        rule("source", 19)
        assert read(other, target="text/uri-list") == "DENIED"
        formats = read(other, target="TARGETS")
        assert "image/png" not in formats and "text/uri-list" not in formats
        rule("source")
        rule("sink", 19)
        assert read(other, target="text/uri-list", policy="sink") == "DENIED"
        formats = read(other, target="TARGETS", policy="sink")
        assert "image/png" not in formats and "MULTIPLE" not in formats
        assert "TARGETS" in formats and "TIMESTAMP" in formats
        rule("sink")
        source.terminate(); source.wait(15)

        incremental(toolkit, other)
        source = owner(toolkit, data=b"first segment subsequent text")
        assert read(other, policy="sink", extra=1) == "DENIED"
        policies["sink"].unlink()
        assert read(other, policy="sink") == "DENIED"
        rule("sink", 0)
        assert read(other, policy="sink") != "DENIED"
        rule("sink")
        if other == "xcb":
            assert read(other, policy="sink", action="wait") != "DENIED"
            assert read(other, policy="sink", action="poll") != "DENIED"
            rule("sink", 31)
            source.terminate(); source.wait(15)
            source = owner(toolkit, data=b"password=0123456789abcdef")
            assert read(other, policy="sink", action="wait") == "DENIED"
            assert read(other, policy="sink", action="poll") == "DENIED"
        source.terminate(); source.wait(15)
        print(toolkit + ": directions, live tightening, cached reads, text limits, formats, secrets and invalid policy passed", flush=True)
    counts = [struct.unpack("<IIQQQ65s31x", path.read_bytes()) for path in directory.glob("*.status")]
    assert sum(value[2] for value in counts) > 10
    assert sum(value[3] for value in counts) > 0 and sum(value[4] for value in counts) > 0
    print("Xlib and XCB clipboard native smoke passed", flush=True)
finally:
    for process in reversed(children):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(5)
        for stream in [process.stdin, process.stdout, process.stderr]:
            if stream:
                stream.close()
    assert directory.parent == Path("/var/tmp") and directory.name.startswith("sakura-x11-smoke-")
    shutil.rmtree(directory)
