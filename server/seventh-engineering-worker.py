"""Four fixed engineering tools inside an owned, unprivileged private VM."""
import base64
import hashlib
import http.client
import http.server
import json
import os
import pathlib
import socket
import struct
import subprocess
import sys
import threading
import time
from datetime import datetime


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def require(condition, code):
    if not condition:
        raise ValueError(code)


def schedule(data, end):
    interval = data['intervalMs'] / 1000
    count = data['count']
    duration = data.get('durationMs', 0) / 1000
    overlap = data.get('overlap', 'queue')
    require(0.01 <= interval <= 10 and 1 <= count <= 100 and 0 <= duration <= 10, 'SCHEDULE_RANGE')
    require(overlap in ('queue', 'skip', 'parallel'), 'SCHEDULE_OVERLAP')
    concurrency = data.get('concurrency', 2) if overlap == 'parallel' else 1
    require(isinstance(concurrency, int) and 1 <= concurrency <= 4, 'SCHEDULE_CONCURRENCY')
    begin_mono, begin_wall = time.monotonic(), time.time()
    lock, active, observations = threading.Lock(), [], []

    def task(index, planned):
        actual = time.monotonic()
        record = {'trigger': index, 'plannedMonotonicMs': round((planned-begin_mono)*1000, 3), 'actualMonotonicMs': round((actual-begin_mono)*1000, 3), 'wallTime': datetime.now().astimezone().isoformat(), 'state': 'running'}
        with lock:
            observations.append(record)
        if time.monotonic() + duration >= end:
            raise TimeoutError('SCHEDULE_DEADLINE')
        time.sleep(duration)
        record.update(state='completed', endedMonotonicMs=round((time.monotonic()-begin_mono)*1000, 3))

    for index in range(count):
        planned = begin_mono + index * interval
        remaining = planned-time.monotonic()
        if remaining > 0:
            require(time.monotonic()+remaining < end, 'SCHEDULE_DEADLINE')
            time.sleep(remaining)
        active = [thread for thread in active if thread.is_alive()]
        if len(active) >= concurrency:
            if overlap == 'skip':
                observations.append({'trigger': index, 'state': 'skipped', 'reason': 'overlap', 'plannedMonotonicMs': round(index*interval*1000, 3)})
                continue
            active[0].join(max(0, end-time.monotonic()))
            require(not active[0].is_alive(), 'SCHEDULE_DEADLINE')
            active = [thread for thread in active if thread.is_alive()]
        thread = threading.Thread(target=task, args=(index, planned), daemon=False)
        active.append(thread)
        thread.start()
    for thread in active:
        thread.join(max(0, end-time.monotonic()))
        require(not thread.is_alive(), 'SCHEDULE_DEADLINE')
    observations.sort(key=lambda row: row['trigger'])
    return {'outcome': 'passed' if all(row['state'] in ('completed', 'skipped') for row in observations) else 'failed', 'source': 'actual-vm-clock', 'observations': observations, 'clock': {'monotonic': time.get_clock_info('monotonic').implementation, 'wallOrigin': begin_wall}, 'processId': os.getpid()}


def extension(data, end):
    source = data['source']
    require(isinstance(source, str) and 0 < len(source.encode()) <= 262144, 'EXTENSION_SOURCE_LIMIT')
    # Fixed compiler flags and filenames; input has no command, linker flag, path or environment slot.
    folder = pathlib.Path.cwd() / 'extension-build'
    folder.mkdir(mode=0o700)
    path = folder / 'main.c'
    path.write_text(source, encoding='utf-8')
    output = folder / 'extension.wasm'
    command = ['clang', '--target=wasm32', '-nostdlib', '-fno-builtin', '-O2', '-Wl,--no-entry', '-Wl,--export=alloc', '-Wl,--export=run', '-Wl,--export-memory', '-Wl,--initial-memory=131072', '-Wl,--max-memory=16777216', str(path), '-o', str(output)]
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={'PATH': '/usr/bin:/bin', 'HOME': str(folder), 'TMPDIR': str(folder)})
    try:
        stdout, stderr = process.communicate(timeout=max(0.1, min(120, end-time.monotonic())))
    except BaseException:
        process.kill()
        process.wait(timeout=5)
        raise
    diagnostics = (stdout+stderr)[:4*1024*1024].decode('utf-8', errors='replace')
    if process.returncode:
        return {'outcome': 'failed', 'source': 'actual-vm-compiler', 'exitCode': process.returncode, 'diagnostics': diagnostics, 'diagnosticsTruncated': len(stdout)+len(stderr) > 4*1024*1024}
    raw = output.read_bytes()
    require(8 <= len(raw) <= 512*1024 and raw[:8] == b'\0asm\x01\0\0\0', 'EXTENSION_WASM_OUTPUT')
    return {'outcome': 'passed', 'source': 'actual-vm-compiler', 'exitCode': process.returncode, 'wasmBase64': base64.b64encode(raw).decode(), 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'diagnostics': diagnostics, 'processId': process.pid, 'compiler': subprocess.check_output(['clang', '--version'], text=True, timeout=5).splitlines()[0]}


def protocol(data, end):
    messages = data['messages']
    require(isinstance(messages, list) and 1 <= len(messages) <= 1000, 'PROTOCOL_MESSAGES')
    replies = data.get('replies', [])
    require(isinstance(replies, list) and len(replies) == len(messages), 'PROTOCOL_REPLIES')
    fragments = data.get('fragmentBytes', 0)
    require(isinstance(fragments, int) and 0 <= fragments <= 65536, 'PROTOCOL_FRAGMENT')
    sent, received, failures = [], [], []
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(('127.0.0.1', 0))
    listener.listen(1)
    listener.settimeout(max(.1, min(10, end-time.monotonic())))

    def read_exact(connection, length):
        result = bytearray()
        while len(result) < length:
            require(time.monotonic() < end, 'PROTOCOL_DEADLINE')
            block = connection.recv(min(65536, length-len(result)))
            require(bool(block), 'PROTOCOL_EARLY_CLOSE')
            result.extend(block)
        return bytes(result)

    def target():
        try:
            connection, _ = listener.accept()
            with connection:
                connection.settimeout(max(.1, min(10, end-time.monotonic())))
                for index, item in enumerate(messages):
                    expected = base64.b64decode(item, validate=True)
                    actual = read_exact(connection, len(expected))
                    sent.append({'index': index, 'bytesBase64': base64.b64encode(actual).decode(), 'monotonic': time.monotonic(), 'matches': actual == expected})
                    response = base64.b64decode(replies[index], validate=True)
                    require(len(response) <= 65536, 'PROTOCOL_REPLY_LIMIT')
                    connection.sendall(response)
        except BaseException as error:
            failures.append(str(error))

    program = None
    program_identity = None
    if data.get('target'):
        artifact = base64.b64decode(data['target']['artifactBase64'], validate=True)
        require(64 <= len(artifact) <= 512*1024 and artifact[:6] == b'\x7fELF\x02\x01' and struct.unpack_from('<H', artifact, 18)[0] == 62, 'PROTOCOL_TARGET_ELF')
        require(hashlib.sha256(artifact).hexdigest() == data['target']['sha256'], 'PROTOCOL_TARGET_DIGEST')
        port = listener.getsockname()[1]
        listener.close()
        folder = pathlib.Path.cwd() / 'protocol-target'
        folder.mkdir(mode=0o700)
        executable = folder / 'target'
        executable.write_bytes(artifact)
        executable.chmod(0o500)
        program = subprocess.Popen([str(executable)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=str(folder), env={'PATH': '/usr/bin:/bin', 'HOME': str(folder), 'SAKURA_LISTEN_ADDRESS': '127.0.0.1', 'SAKURA_LISTEN_PORT': str(port)})
        program_identity = {'pid': program.pid, 'startTicks': pathlib.Path('/proc/{}/stat'.format(program.pid)).read_text().rsplit(') ', 1)[1].split()[19], 'artifactDigest': data['target']['sha256']}
        thread = None
    else:
        port = listener.getsockname()[1]
        thread = threading.Thread(target=target, daemon=False)
        thread.start()
    try:
        client = None
        ready_end = min(end, time.monotonic()+10)
        while time.monotonic() < ready_end:
            if program is not None and program.poll() is not None:
                raise RuntimeError('PROTOCOL_TARGET_EXITED')
            try:
                client = socket.create_connection(('127.0.0.1', port), timeout=max(.1, min(1, end-time.monotonic())))
                break
            except ConnectionRefusedError:
                time.sleep(.02)
        require(client is not None, 'PROTOCOL_TARGET_NOT_READY')
        with client:
            for index, item in enumerate(messages):
                raw = base64.b64decode(item, validate=True)
                expected = base64.b64decode(replies[index], validate=True)
                require(0 < len(raw) <= 65536 and 0 < len(expected) <= 65536, 'PROTOCOL_MESSAGE_LIMIT')
                size = fragments or len(raw)
                for offset in range(0, len(raw), size):
                    client.sendall(raw[offset:offset+size])
                response = read_exact(client, len(expected))
                received.append({'index': index, 'bytesBase64': base64.b64encode(response).decode(), 'matches': response == expected, 'monotonic': time.monotonic()})
    finally:
        listener.close()
        if thread is not None:
            thread.join(max(0, min(10, end-time.monotonic())))
            require(not thread.is_alive(), 'PROTOCOL_TARGET_CLEANUP')
        if program is not None:
            program.terminate()
            try:
                program.wait(timeout=2)
            except subprocess.TimeoutExpired:
                program.kill()
                program.wait(timeout=2)
    return {'outcome': 'passed' if not failures and all(row['matches'] for row in sent+received) else 'failed', 'source': 'actual-vm-tcp', 'target': 'provided-linux-executable' if program else 'fixed-binary-peer', 'targetIdentity': program_identity, 'targetStopped': program is None or program.poll() is not None, 'sent': sent, 'received': received, 'failures': failures, 'listenerClosed': True, 'threadStopped': thread is None or not thread.is_alive(), 'processId': os.getpid()}


def virtualization(data, end):
    services = data['services']
    require(isinstance(services, list) and 1 <= len(services) <= 20, 'VIRTUAL_SERVICES')
    definitions = {service['id']: service for service in services}
    require(len(definitions) == len(services), 'VIRTUAL_SERVICE_ID')
    states = {service['id']: json.loads(json.dumps(service.get('initialState', {}))) for service in services}
    snapshot = data.get('snapshot')
    if snapshot:
        states = json.loads(json.dumps(snapshot['states']))
    traffic, servers, threads, ports, failures = [], [], [], {}, []
    lock = threading.RLock()
    counts = {'calls': 0, 'inFlight': 0}

    def dispatch(service_id, method, path, body, depth=0, parent=None):
        require(time.monotonic() < end and depth <= 16, 'VIRTUAL_DEADLINE_OR_HOPS')
        with lock:
            counts['calls'] += 1
            require(counts['calls'] <= 10000, 'VIRTUAL_CALL_LIMIT')
            sequence = counts['calls']
            rules = sorted(definitions[service_id].get('rules', []), key=lambda rule: rule.get('priority', 0))
            rule = next((rule for rule in rules if rule.get('method', 'GET') == method and rule['path'] == path and all(states[service_id].get(key) == value for key, value in rule.get('whenState', {}).items())), None)
            if not rule:
                traffic.append({'sequence': sequence, 'parent': parent, 'service': service_id, 'method': method, 'path': path, 'matched': False})
                return 404, {'error': 'unmatched-mock-request'}, False
            states[service_id].update(rule.get('set', {}))
            response = rule.get('response', {'status': 200, 'body': None})
            traffic.append({'sequence': sequence, 'parent': parent, 'service': service_id, 'method': method, 'path': path, 'requestBody': body, 'rule': rule.get('id'), 'response': response, 'matched': True})
        delay = rule.get('delayMs', 0)/1000
        require(0 <= delay <= 30 and time.monotonic()+delay < end, 'VIRTUAL_DELAY')
        if delay:
            time.sleep(delay)
        for call in rule.get('calls', []):
            require(call['service'] in definitions and call['path'].startswith('/') and '://' not in call['path'], 'VIRTUAL_INTERNAL_TARGET')
            require(depth < 16, 'VIRTUAL_HOP_LIMIT')
            client = http.client.HTTPConnection('127.0.0.1', ports[call['service']], timeout=max(.1, min(30, end-time.monotonic())))
            try:
                payload = encoded(call['body']) if call.get('body') is not None else None
                client.request(call.get('method', 'GET'), call['path'], body=payload, headers={'Content-Type': 'application/json', 'X-Sakura-Hop': str(depth+1), 'X-Sakura-Parent': str(sequence)})
                reply = client.getresponse()
                require(len(reply.read(262145)) <= 262144, 'VIRTUAL_INTERNAL_RESPONSE_LIMIT')
            finally:
                client.close()
        return response.get('status', 200), response.get('body'), rule.get('disconnect', False)

    def handler_for(service_id):
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def execute(self):
                counts['inFlight'] += 1
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    require(0 <= length <= 262144, 'VIRTUAL_BODY_LIMIT')
                    raw = self.rfile.read(length)
                    body = json.loads(raw) if raw else None
                    depth = int(self.headers.get('X-Sakura-Hop', '0'))
                    parent_text = self.headers.get('X-Sakura-Parent')
                    parent = int(parent_text) if parent_text is not None else None
                    status, response, disconnect = dispatch(service_id, self.command, self.path, body, depth, parent)
                    if disconnect:
                        self.close_connection = True
                        return
                    output = encoded(response)
                    require(len(output) <= 262144, 'VIRTUAL_RESPONSE_LIMIT')
                    self.send_response(status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(output)))
                    self.end_headers()
                    self.wfile.write(output)
                except BaseException as error:
                    failures.append(type(error).__name__+':'+str(error)[:200])
                    self.close_connection = True
                finally:
                    counts['inFlight'] -= 1

            do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = execute
        return Handler

    responses = []
    try:
        for service_id in definitions:
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler_for(service_id))
            server.daemon_threads = False
            thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .01}, daemon=False)
            thread.start()
            servers.append(server)
            threads.append(thread)
            ports[service_id] = server.server_port
        requests = data.get('requests', [])
        require(isinstance(requests, list) and len(requests) <= 1000, 'VIRTUAL_REQUEST_LIMIT')
        for request in requests:
            service_id = request['service']
            require(service_id in ports and request['path'].startswith('/') and '://' not in request['path'], 'VIRTUAL_REQUEST_TARGET')
            client = http.client.HTTPConnection('127.0.0.1', ports[service_id], timeout=max(.1, min(30, end-time.monotonic())))
            try:
                body = encoded(request['body']) if request.get('body') is not None else None
                client.request(request.get('method', 'GET'), request['path'], body=body, headers={'Content-Type': 'application/json'})
                response = client.getresponse()
                raw = response.read(262145)
                require(len(raw) <= 262144, 'VIRTUAL_RESPONSE_LIMIT')
                responses.append({'status': response.status, 'body': json.loads(raw) if raw else None, 'disconnected': False})
            except http.client.RemoteDisconnected:
                responses.append({'status': None, 'body': None, 'disconnected': True})
            finally:
                client.close()
        # A response can arrive before its handler's finally block decrements inFlight.
        # Stop admission, then wait for the actual handlers before freezing joint state.
        for server in servers:
            server.shutdown()
        while counts['inFlight'] and time.monotonic() < end:
            time.sleep(.001)
        require(counts['inFlight'] == 0, 'VIRTUAL_NOT_QUIESCENT')
        checkpoint_value = {'schemaVersion': 1, 'states': json.loads(json.dumps(states)), 'requestCursor': len(responses), 'seed': data.get('seed', 1), 'modelDigest': hashlib.sha256(encoded(services)).hexdigest()}
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()
        for thread in threads:
            thread.join(max(0, min(5, end-time.monotonic())))
            require(not thread.is_alive(), 'VIRTUAL_LISTENER_CLEANUP')
    return {'outcome': 'passed' if not failures and all(item['matched'] for item in traffic) else 'failed', 'source': 'actual-vm-http', 'states': states, 'responses': responses, 'traffic': traffic, 'checkpoint': checkpoint_value, 'listenersClosed': True, 'inFlight': counts['inFlight'], 'failures': failures, 'processId': os.getpid()}


def run():
    raw = sys.stdin.buffer.read(8*1024*1024+1)
    require(len(raw) <= 8*1024*1024 and os.getuid() == 65534, 'ENGINEERING_CONTEXT')
    envelope = json.loads(raw)
    data = envelope['input']
    deadline = datetime.fromisoformat(envelope['deadline'].replace('Z', '+00:00')).timestamp()
    require(0 < deadline-time.time() <= 1800, 'ENGINEERING_DEADLINE')
    end = time.monotonic()+deadline-time.time()-.2
    functions = {'sakura-seventh-schedule/1': schedule, 'sakura-seventh-extension/1': extension, 'sakura-seventh-protocol/1': protocol, 'sakura-seventh-virtualization/1': virtualization}
    require(data.get('protocol') in functions, 'ENGINEERING_PROTOCOL')
    value = functions[data['protocol']](data, end)
    require(len(encoded(value)) <= 8*1024*1024, 'ENGINEERING_OUTPUT_LIMIT')
    print(encoded(value).decode('utf-8'), flush=True)


if __name__ == '__main__':
    try:
        run()
    except BaseException as error:
        print(encoded({'outcome': 'failed', 'error': type(error).__name__+':'+str(error)[:500]}).decode('utf-8'), flush=True)
        # A complete structured tool failure remains inspectable; the outcome is still failed.
        sys.exit(0)
