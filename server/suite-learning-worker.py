"""Fixed lesson I/O and loopback demo. Each invocation owns a fresh private VM workspace."""
import datetime
import hashlib
import http.client
import http.server
import json
import os
import pathlib
import re
import stat
import sys
import threading
import time

MAX_FILE = 64 * 1024
MAX_SNAPSHOT = 2 * 1024 * 1024


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def run():
    raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024 or os.getuid() != 65534:
        raise ValueError('LEARNING_CONTEXT')
    envelope = json.loads(raw)
    data = envelope['input']
    if data.get('protocol') != 'sakura-learning-tool/1':
        raise ValueError('LEARNING_PROTOCOL')
    expires = datetime.datetime.fromisoformat(envelope['deadline'].replace('Z', '+00:00')).timestamp()
    if not 0 < expires - time.time() <= 900:
        raise ValueError('LEARNING_DEADLINE')
    end = time.monotonic() + expires - time.time() - 0.25
    root = pathlib.Path.cwd() / 'lesson'
    root.mkdir(mode=0o700)
    demo = data['demo']
    if not isinstance(demo['running'], bool) or len(encoded(demo['data'])) > MAX_FILE:
        raise ValueError('LEARNING_DEMO')
    demo = dict(demo)

    def deadline():
        if time.monotonic() >= end:
            raise TimeoutError('LEARNING_DEADLINE')

    def path(value):
        deadline()
        if not isinstance(value, str) or len(value) > 180 or len(value.split('/')) > 8 or not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*', value):
            raise ValueError('LEARNING_PATH')
        target = root
        for part in value.split('/'):
            if part in ('.', '..'):
                raise ValueError('LEARNING_PATH')
            target = target / part
            if target.exists() or target.is_symlink():
                info = target.lstat()
                if stat.S_ISLNK(info.st_mode) or info.st_uid != 65534:
                    raise ValueError('LEARNING_FILE_IDENTITY')
        return target

    def read(name):
        target = path(name)
        fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != 65534 or info.st_size > MAX_FILE:
                raise ValueError('LEARNING_FILE_IDENTITY')
            value = source.read(MAX_FILE + 1)
        if len(value) > MAX_FILE:
            raise ValueError('LEARNING_FILE_LIMIT')
        return value.decode('utf-8')

    def snapshot():
        files = []
        for folder, dirs, names in os.walk(root, followlinks=False):
            deadline()
            for name in dirs:
                info = (pathlib.Path(folder) / name).lstat()
                if not stat.S_ISDIR(info.st_mode) or info.st_uid != 65534:
                    raise ValueError('LEARNING_FILE_IDENTITY')
            for name in names:
                name = (pathlib.Path(folder) / name).relative_to(root).as_posix()
                value = read(name)
                value_bytes = value.encode('utf-8')
                files.append({'path': name, 'content': value, 'digest': digest(value_bytes), 'bytes': len(value_bytes)})
                if len(files) > 100 or sum(file['bytes'] for file in files) > MAX_SNAPSHOT:
                    raise ValueError('LEARNING_SNAPSHOT_LIMIT')
        return sorted(files, key=lambda file: file['path'])

    def write(name, text):
        value = text.encode('utf-8')
        if len(value) > MAX_FILE:
            raise ValueError('LEARNING_FILE_LIMIT')
        target = path(name)
        current = snapshot()
        original = next((file for file in current if file['path'] == name), None)
        if len(current) + (0 if original else 1) > 100 or sum(file['bytes'] for file in current) - (original['bytes'] if original else 0) + len(value) > MAX_SNAPSHOT:
            raise ValueError('LEARNING_SNAPSHOT_LIMIT')
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(target, os.O_WRONLY | os.O_NOFOLLOW | (0 if original else os.O_CREAT | os.O_EXCL), 0o600)
        with os.fdopen(fd, 'wb') as dest:
            info = os.fstat(dest.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != 65534:
                raise ValueError('LEARNING_FILE_IDENTITY')
            dest.truncate(0)
            dest.write(value)
            dest.flush()
            os.fsync(dest.fileno())
        if read(name) != text:
            raise ValueError('LEARNING_READBACK')

    def request(method, route, body=None):
        deadline()
        if method not in ('GET', 'POST') or route not in ('/state', '/echo'):
            raise ValueError('LEARNING_REQUEST')
        payload = encoded(body) if body is not None else b''
        if len(payload) > MAX_FILE:
            raise ValueError('LEARNING_REQUEST_LIMIT')

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def execute(self):
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 <= length <= MAX_FILE:
                    self.send_error(413)
                    return
                request_data = self.rfile.read(length)
                value = json.loads(request_data) if request_data else None
                if not demo['running']:
                    status, answer = 503, {'error': 'DEMO_STOPPED'}
                elif self.path == '/state':
                    if self.command == 'POST':
                        demo['data'] = value
                    status, answer = 200, demo['data']
                else:
                    status, answer = 200, {'method': self.command, 'body': value}
                output = encoded(answer)
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(output)))
                self.end_headers()
                self.wfile.write(output)

            do_GET = execute
            do_POST = execute

        # This fixed service is created for one request and always joined/closed here.
        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        server.timeout = 2
        thread = threading.Thread(target=server.handle_request, daemon=False)
        thread.start()
        connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=min(2, max(0.05, end - time.monotonic())))
        try:
            connection.request(method, route, body=payload, headers={'Content-Type': 'application/json'})
            response = connection.getresponse()
            raw_body = response.read(MAX_FILE + 1024)
            if len(raw_body) > MAX_FILE + 512:
                raise ValueError('LEARNING_RESPONSE_LIMIT')
            return {'kind': 'request', 'method': method, 'path': route, 'status': response.status,
                    'body': json.loads(raw_body), 'bodyDigest': digest(raw_body), 'bytes': len(raw_body)}
        finally:
            connection.close()
            thread.join(timeout=3)
            server.server_close()
            if thread.is_alive():
                raise RuntimeError('LEARNING_SERVICE_CLEANUP')

    observation = None
    checks = []
    error = None
    completed = False
    try:
        incoming = data['snapshot']
        if len(incoming) > 100 or len({file['path'] for file in incoming}) != len(incoming):
            raise ValueError('LEARNING_SNAPSHOT_LIMIT')
        for file in incoming:
            write(file['path'], file['content'])
        action = data['action']
        kind = action['kind']
        if kind == 'list':
            observation = {'kind': kind, 'files': [{key: file[key] for key in ('path', 'bytes', 'digest')} for file in snapshot()]}
        elif kind == 'read':
            value = read(action['path'])
            observation = {'kind': kind, 'path': action['path'], 'content': value, 'digest': digest(value.encode('utf-8'))}
        elif kind == 'write':
            write(action['path'], action['content'])
            value = read(action['path'])
            observation = {'kind': kind, 'path': action['path'], 'digest': digest(value.encode('utf-8')), 'bytes': len(value.encode('utf-8'))}
        elif kind in ('demo-start', 'demo-stop'):
            demo['running'] = kind == 'demo-start'
            observation = request('GET', '/state')
        elif kind == 'request':
            observation = request(action['method'], action['path'], action.get('body'))
        elif kind == 'check':
            observation = {'kind': kind}
        else:
            raise ValueError('LEARNING_ACTION')
        if len(data['checks']) > 30 or len({check['id'] for check in data['checks']}) != len(data['checks']):
            raise ValueError('LEARNING_CHECKS')
        for check in data['checks']:
            actual, passed, problem = None, False, None
            try:
                if check['kind'] == 'exists':
                    target = path(check['path'])
                    actual = target.is_file()
                    if actual:
                        read(check['path'])
                    passed = actual is check['expected']
                elif check['kind'] == 'text':
                    actual = read(check['path'])
                    passed = actual == check['expected'] if check['mode'] == 'equals' else check['expected'] in actual
                elif check['kind'] == 'json':
                    actual = json.loads(read(check['path']))
                    passed = encoded(actual) == encoded(check['expected'])
                elif check['kind'] == 'status':
                    actual = request('GET', '/state')['status']
                    passed = actual == check['expected']
                else:
                    raise ValueError('LEARNING_CHECK_KIND')
            except Exception as issue:
                problem = 'FILE_NOT_FOUND' if isinstance(issue, FileNotFoundError) else 'CHECK_UNAVAILABLE'
            checks.append({'id': check['id'], 'kind': check['kind'], 'passed': passed, 'actual': actual, 'error': problem})
        completed = True
    except Exception as issue:
        code = 'FILE_NOT_FOUND' if isinstance(issue, FileNotFoundError) else 'DEADLINE' if isinstance(issue, TimeoutError) else str(issue) if str(issue).startswith('LEARNING_') else 'ACTION_FAILED'
        error = {'code': code[:100], 'message': {'FILE_NOT_FOUND': '课内文件不存在', 'DEADLINE': '本步执行期限已到'}.get(code, '固定课内操作未完成')}
    files = snapshot()
    output = {'protocol': 'sakura-learning-result/1', 'sessionId': envelope['sessionId'], 'inputDigest': envelope['inputDigest'],
              'completed': completed, 'outcome': 'passed' if completed and all(check['passed'] for check in checks) else 'failed' if completed or (error and error['code'] == 'FILE_NOT_FOUND') else 'inconclusive',
              'snapshot': files, 'snapshotDigest': digest(encoded([{'path': file['path'], 'content': file['content']} for file in files])),
              'observation': observation, 'checks': checks, 'demo': demo, 'error': error}
    result = encoded(output)
    if len(result) > 8 * 1024 * 1024 - 8192:
        raise ValueError('LEARNING_OUTPUT_LIMIT')
    sys.stdout.buffer.write(result)


if __name__ == '__main__':
    run()
