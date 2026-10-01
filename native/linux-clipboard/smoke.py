"""Run only in the smoke script's owned VM on a separate, authenticated Xvfb."""
import os
import pwd
import select
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

MAGIC = 0x58434C50
library, fixture, build, qt_fixture, fork_fixture = sys.argv[1:6]
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
    args = [fork_fixture if action.startswith("fork-") else fixture, toolkit, action, target, str(file), selection]
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
    # TextIO.readline may prefetch the next complete line. Selecting its raw fd
    # again then reports a false timeout; keep explicit bounded per-process bytes.
    buffered = getattr(process, "sakura_line_buffer", bytearray())
    until = time.monotonic() + 15
    while b"\n" not in buffered:
        ready, _, _ = select.select([process.stdout.fileno()], [], [], max(0, until-time.monotonic()))
        assert ready, ("fixture did not answer", process.args)
        chunk = os.read(process.stdout.fileno(), 4096)
        if not chunk:
            break
        buffered.extend(chunk)
        # Legacy native fixtures print a hexadecimal body, up to the protocol's
        # 16 MiB binary maximum. This bound covers its 2x representation.
        assert len(buffered) <= 32*1024*1024+65536, "fixture output line exceeded its bound"
    answer, _, rest = buffered.partition(b"\n")
    process.sakura_line_buffer = rest
    answer = answer.decode("utf-8").strip()
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

def qt_start(action, data, policy=None, selection="CLIPBOARD"):
    global counter
    counter += 1
    file = directory / (str(counter) + ".qt-data")
    file.write_bytes(data); file.chmod(0o644)
    count = directory / (str(counter) + ".qt-incr-count")
    count.write_text("0"); os.chown(count, user.pw_uid, user.pw_gid); count.chmod(0o600)
    env = dict(environment, QT_QPA_PLATFORM="xcb")
    descriptors = []
    if policy:
        env.update(LD_PRELOAD=library, SAKURA_CLIPBOARD_POLICY=str(policies[policy]))
        status = directory / (str(counter) + ".status")
        status.write_bytes(struct.pack("<IIQQQ65s31x", MAGIC, 1, 0, 0, 0, build.encode())); status.chmod(0o600)
        descriptor = os.open(status, os.O_RDWR); descriptors.append(descriptor)
        env["SAKURA_CLIPBOARD_STATUS_FD"] = str(descriptor)
    process = subprocess.Popen([qt_fixture, action, str(file), str(count), selection], env=env,
                               preexec_fn=credentials, start_new_session=True, pass_fds=descriptors,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.incr_count = count
    children.append(process)
    for descriptor in descriptors:
        os.close(descriptor)
    return process

def qt_headers(process, minimum):
    until = time.monotonic() + 5
    while time.monotonic() < until:
        text = process.incr_count.read_text().strip()
        if text.isdigit() and int(text) >= minimum:
            return int(text)
        time.sleep(.02)
    raise AssertionError("Qt did not emit the expected real INCR headers")

def stalled_broker_authentication():
    # The first connection reaches the real owned Xvfb; later connections accept
    # TCP but never reply to X11 authentication. Only owned protocol bytes pass
    # through this fixture proxy, and no payload is recorded.
    old = environment["DISPLAY"]
    proxy_display = "127.0.0.1:95"
    cookie = subprocess.check_output(["xauth", "-f", str(auth), "list", old], text=True).split()[-1]
    subprocess.run(["xauth", "-f", str(auth), "add", proxy_display, ".", cookie], check=True)
    os.chown(auth, user.pw_uid, user.pw_gid); auth.chmod(0o600)
    listener = socket.socket(); listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 6095)); listener.listen(4); listener.settimeout(.1)
    stopped = threading.Event(); connections = []; relays = []
    def relay(client, upstream):
        while not stopped.is_set():
            try:
                readable, _, _ = select.select([client, upstream], [], [], .1)
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    (upstream if source is client else client).sendall(data)
            except OSError:
                return
    def accept():
        while not stopped.is_set():
            try:
                client, _ = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            connections.append(client)
            if len(connections)==1:
                upstream = socket.socket(socket.AF_UNIX); upstream.connect("/tmp/.X11-unix/X93"); connections.append(upstream)
                worker = threading.Thread(target=relay, args=(client, upstream)); relays.append(worker); worker.start()
    worker = threading.Thread(target=accept); worker.start()
    try:
        environment["DISPLAY"] = proxy_display; rule("sink")
        began = time.monotonic(); receiver = start("xcb", "multiple", policy="sink")
        assert line(receiver)=="DENIED" and receiver.wait(5)==0
        assert time.monotonic()-began < 5
    finally:
        environment["DISPLAY"] = old; stopped.set(); listener.close(); worker.join(2)
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
        for worker in relays:
            worker.join(2)
    print("Broker authentication stall on the original pinned socket refused within its 2s setup bound and process exit joined workers", flush=True)

def fork_after_broker():
    runtime = subprocess.run(["ldd", "--version"], text=True, capture_output=True)
    print("Fork runtime: " + (runtime.stdout or runtime.stderr).splitlines()[0], flush=True)
    child_data = directory / "fork-child.data"
    child_data.write_bytes(b"password=0123456789abcdef\n" * 300)
    child_data.chmod(0o644)
    parent_data = b"owned live parent broker text"
    for toolkit in ["xlib", "xcb", "mixed"]:
        variants = ["fork-live", "fork-nested", "fork-idle-exit", "fork-inherited", "fork-inherited-fd"]
        if toolkit == "xcb":
            variants.append("fork-depth")
        for variant in variants:
            print("Fork case: " + toolkit + " " + variant, flush=True)
            rule("fork", flags=23)
            primary = owner("xcb", data=child_data.read_bytes(), selection="PRIMARY")
            source = owner("xcb", data=parent_data, extra="incr-group-pause:7")
            receiver = start(toolkit, variant, data=parent_data, policy="fork", extra=child_data)
            assert line(receiver) == "STARTED"
            assert line(source) == "CHUNK", "fork did not happen during a live second INCR body"
            receiver.stdin.write("fork\n"); receiver.stdin.flush()
            if variant == "fork-nested":
                assert line(receiver) == "GRANDCHILD-COMPLETE"
                assert line(receiver) == "GRANDCHILD-EXIT-0"
            if variant == "fork-depth":
                assert line(receiver) == "DEPTH-BOUND-DENIED"
            if variant in ["fork-live", "fork-nested"]:
                assert line(receiver) == "CHILD-COMPLETE", receiver.poll()
                rule("fork", flags=31 if variant == "fork-live" else 23,
                     maximum=1048576 if variant == "fork-live" else 1024)
                receiver.stdin.write("tightened\n"); receiver.stdin.flush()
                assert line(receiver) == "CHILD-RECHECK-DENIED"
            expected = "CHILD-REJECTED-126" if "inherited" in variant else "CHILD-EXIT-0"
            assert line(receiver) == expected
            source.stdin.write("resume\n"); source.stdin.flush()
            assert line(receiver) == "PARENT-COMPLETE", "child damaged its parent's live broker socket"
            rule("fork", flags=23)
            receiver.stdin.write("next\n"); receiver.stdin.flush()
            assert line(receiver) == "PARENT-NEXT"
            assert line(source) == "CHUNK"
            source.stdin.write("resume\n"); source.stdin.flush()
            assert line(receiver) == "PARENT-NEXT-COMPLETE"
            assert receiver.wait(5) == 0, receiver.stderr.read()
            source.kill(); source.wait(); primary.kill(); primary.wait()
        print(toolkit + ": live broker fork, fresh child MULTIPLE, policy tightening, normal C++ exit, inherited pointer/fd denial, parent continuation passed", flush=True)

def small_server_qt():
    small = ":94"
    subprocess.run(["xauth", "-f", str(auth), "add", small, ".", os.urandom(16).hex()], check=True)
    os.chown(auth, user.pw_uid, user.pw_gid); auth.chmod(0o600)
    environment["DISPLAY"] = small
    server = subprocess.Popen(["Xvfb", small, "-screen", "0", "320x240x24", "-nolisten", "tcp",
                               "-auth", str(auth), "-maxbigreqsize", "1"], env=environment,
                              preexec_fn=credentials, start_new_session=True,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    children.append(server)
    for _ in range(100):
        assert server.poll() is None, "owned Xvfb could not set its big request limit"
        if Path("/tmp/.X11-unix/X94").exists():
            break
        time.sleep(.1)
    maximum = int(read("xcb", action="maximum"))
    assert 262144 < maximum < 16*1024*1024, maximum
    # This server does not permit disabling BIG-REQUESTS. Its documented
    # -maxbigreqsize option limits the actual server, and Qt must split a body
    # whose payload alone occupies that limit (headers need additional bytes).
    # Xserver stores this option in request words, so Debian's real minimum is
    # about 4MiB. Use MIME binary bodies permitted by Files, within the 16MiB
    # item limit, rather than mislabeling oversized text as an allowed transfer.
    phrase = b"owned official Qt INCR text\n"
    data = (phrase * ((maximum + len(phrase) - 1)//len(phrase)))[:maximum]
    assert len(data) > 256*1024
    expected = ("application/sakura-first:OK;application/sakura-second:OK;TARGETS:OK;TIMESTAMP:OK;SAKURA_UNKNOWN:DENIED;"
                "DELETE:DENIED;INSERT_SELECTION:DENIED;INSERT_PROPERTY:DENIED;MULTIPLE:DENIED;")
    print("Owned Qt server -maxbigreqsize 1: actual maximum request bytes " + str(maximum), flush=True)
    for selection in ["CLIPBOARD", "PRIMARY"]:
        rule("sink"); source = qt_start("owner-binary", data, selection=selection)
        assert line(source) == "READY"
        count = 0
        for receiver in ["xlib", "xcb", "mixed"]:
            assert read(receiver, action="multiple", data=data, policy="sink", selection=selection, extra="qt-binary") == expected
            count = qt_headers(source, count + 2)
        receiver = qt_start("multiple-binary", data, policy="sink", selection=selection)
        assert line(receiver) == "MULTIPLE-COMPLETE" and receiver.wait(15) == 0
        count = qt_headers(source, count + 2)
        print(selection + ": real Qt MULTIPLE emitted " + str(count) + " INCR headers; two complete >256KiB children reached Xlib/XCB/mixed and explicit Qt requester", flush=True)
        source.terminate(); source.wait(15)
        # A managed owner cannot atomically publish these bodies on this server.
        # Keep the explicit per-pair refusal rather than exporting a prefix.
        rule("source"); source = qt_start("owner-binary", data, policy="source", selection=selection)
        assert line(source) == "READY"
        result = read("mixed", action="multiple", data=data, selection=selection, extra="qt-binary")
        assert result == expected.replace("application/sakura-first:OK;application/sakura-second:OK", "application/sakura-first:DENIED;application/sakura-second:DENIED"), result
        qt_headers(source, 2); source.terminate(); source.wait(15)
    print("Real Qt INCR receive completed on the small server; managed copy exceeding its atomic request limit was independently refused", flush=True)


def multiple(toolkit, other):
    data = ("owned MULTIPLE \u754c\u00e9 text\n".encode() * 15000)
    assert len(data) > 256 * 1024
    expected = ("UTF8_STRING:OK;text/plain:OK;TARGETS:OK;TIMESTAMP:OK;SAKURA_UNKNOWN:DENIED;"
                "DELETE:DENIED;INSERT_SELECTION:DENIED;INSERT_PROPERTY:DENIED;MULTIPLE:DENIED;")
    for selection in ["CLIPBOARD", "PRIMARY"]:
        for guarded_source, guarded_sink in [(True, False), (False, True), (True, True)]:
            rule("source"); rule("sink")
            source = owner(toolkit, data=data, policy="source" if guarded_source else None,
                           extra="incr:32767", selection=selection)
            for receiver in [other, "mixed"]:
                assert read(receiver, action="multiple", data=data, policy="sink" if guarded_sink else None,
                            selection=selection) == expected
            assert not select.select([source.stdout], [], [], .1)[0], "side-effect target reached owner"
            source.terminate(); source.wait(15)
    rule("source"); rule("sink")
    source = owner(toolkit, data=b"ordinary text", policy="source")
    assert read(other, action="multiple-wait", data=b"ordinary text", policy="sink") == expected
    assert read(other, action="multiple", data=b"ordinary text", policy="sink", extra="env") == expected
    for variant in ["type", "format", "odd", "many", "no-property"]:
        assert read(other, action="multiple", policy="sink", extra=variant) == "DENIED", variant
    assert read(other, action="multiple", policy="sink", extra="empty") == "EMPTY"
    assert read(other, action="multiple", policy="sink", extra="duplicate") == expected.replace("UTF8_STRING:OK;text/plain:OK", "UTF8_STRING:DENIED;text/plain:DENIED")
    for variant in ["parent", "none"]:
        assert read(other, action="multiple", policy="sink", extra=variant) == expected.replace("UTF8_STRING:OK", "UTF8_STRING:DENIED")
    cached = start("mixed", "multiple-cache", policy="sink")
    assert line(cached) == expected
    rule("sink", 21); cached.stdin.write("recheck\n"); cached.stdin.flush()
    assert line(cached) == "DENIED" and cached.wait(15) == 0
    rule("sink")
    deleting = start(other, "multiple-delete", policy="sink")
    assert line(deleting) == expected
    deleting.stdin.write("recheck\n"); deleting.stdin.flush()
    assert line(deleting) == "DENIED" and deleting.wait(15) == 0
    late = start("mixed", "multiple", policy="sink", extra="late")
    assert line(late) == expected and line(late) == "STALE-DENIED" and late.wait(15) == 0
    source.terminate(); source.wait(15)
    for style in ["multiple-target-none", "multiple-property-none"]:
        source = owner(toolkit, extra=style)
        assert read(other, action="multiple") == expected, style
        source.terminate(); source.wait(15)
    rule("source")
    source = owner(toolkit, data=b"x"*2048, policy="source", extra="incr-group-window:13")
    receiver = start("xcb", "multiple-window-reuse", data=b"x"*2048)
    assert line(source)=="CHUNK"
    receiver.stdin.write("destroy\n"); receiver.stdin.flush(); assert line(receiver)=="REUSED"
    time.sleep(.2); source.stdin.write("continue\n"); source.stdin.flush(); assert line(source)=="LATE"
    receiver.stdin.write("check\n"); receiver.stdin.flush()
    assert line(receiver)=="STALE-DENIED" and receiver.wait(15)==0
    source.terminate(); source.wait(15)
    # New conversions invalidate the whole old group, including both aliases
    # and pending parent/child cookies, even after the policy is disabled.
    for action, flags in [("multiple-reuse", 0), ("multiple-child-reuse", 23)]:
        rule("source"); rule("sink")
        source = owner(toolkit, policy="source")
        receiver = start("mixed", action, policy="sink")
        assert line(receiver) == expected
        source.terminate(); source.wait(15)
        source = owner(toolkit, policy="source", data=b"new complete group body")
        rule("sink", flags); receiver.stdin.write("new complete group body\n"); receiver.stdin.flush()
        assert line(receiver) == (expected if action=="multiple-reuse" else "NEW-COMPLETE")
        assert line(receiver) == "STALE-DENIED" and receiver.wait(15) == 0
        source.terminate(); source.wait(15)
    # Successful siblings remain available when one completed stream is denied.
    for guarded_source in [True, False]:
        for mode in ["multi-secret", "incr-secret:3", "incr-utf8:3"]:
            rule("source", 31); rule("sink", 31)
            source = owner(toolkit, policy="source" if guarded_source else None, extra=mode)
            result = read(other, action="multiple", policy=None if guarded_source else "sink")
            assert result == expected.replace("text/plain:OK", "text/plain:DENIED"), (mode, result)
            source.terminate(); source.wait(15)
    # The first child is ready privately when a second child pauses. Tightening
    # must apply to both, before the parent advertises any usable text property.
    for guarded_source in [True, False]:
        for flags, maximum, data in [(23, 1024, b"x"*2048), (31, 1048576, b"password=0123456789abcdef")]:
            rule("source"); rule("sink")
            source = owner(toolkit, data=data, policy="source" if guarded_source else None, extra="incr-group-pause:13")
            receiver = start(other, "multiple", data=data, policy=None if guarded_source else "sink")
            assert line(source) == "CHUNK"
            rule("source" if guarded_source else "sink", flags, maximum)
            source.stdin.write("continue\n"); source.stdin.flush()
            assert line(receiver) == expected.replace("UTF8_STRING:OK;text/plain:OK", "UTF8_STRING:DENIED;text/plain:DENIED")
            assert receiver.wait(15) == 0
            source.terminate(); source.wait(15)
    rule("source"); rule("sink")
    source = owner(toolkit, policy="source")
    assert read("mixed", action="multiple-groups", policy="sink") == "32/8/32"
    limit = read("mixed", action="multiple", policy="sink", extra="limit")
    assert limit.count(":OK;") == 32 and limit.count(":DENIED;") == 96, limit
    concurrent = start("mixed", "multiple-concurrent", policy="sink")
    assert line(concurrent) == expected and line(concurrent) == "COMPLETE" and concurrent.wait(15) == 0
    source.terminate(); source.wait(15)
    if toolkit == "xlib":
        rule("sink")
        began = time.monotonic()
        blocked_self = read("xlib", action="multiple-self-block", policy="sink")
        assert blocked_self == expected.replace(":OK;", ":DENIED;") and time.monotonic()-began < 15
    for guarded_source in [True, False]:
        rule("source", 31); rule("sink", 31)
        source = owner(toolkit, data=b"password=0123456789abcdef", policy="source" if guarded_source else None, extra="incr:3")
        result = read(other, action="multiple", data=b"password=0123456789abcdef", policy=None if guarded_source else "sink")
        assert result == expected.replace("UTF8_STRING:OK;text/plain:OK", "UTF8_STRING:DENIED;text/plain:DENIED"), result
        source.terminate(); source.wait(15)
    print(toolkit + ": MULTIPLE two INCR children, independent failures, live tightening, group/pair/buffer quotas, concurrent aliases, one parent notify, blocking waits, pinned authentication, malformed lists, cache/delete and stale cookies passed", flush=True)


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
        assert formats == "UTF8_STRING;TARGETS;TIMESTAMP;MULTIPLE;", formats
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
    if os.environ.get("SAKURA_X11_FORK_ONLY") == "1":
        fork_after_broker()
        print("Dedicated fork diagnostics passed", flush=True)
        sys.exit(0)
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
        assert "image/png" not in formats and "MULTIPLE" in formats
        assert "TARGETS" in formats and "TIMESTAMP" in formats
        rule("sink")
        source.terminate(); source.wait(15)

        multiple(toolkit, other)
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
    fork_after_broker()
    stalled_broker_authentication()
    small_server_qt()
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
