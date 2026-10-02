"""Disposable VM-only smart-HTTP Git server with separately supplied fixture token."""
import json
import os
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

root = sys.argv[1]
with open(root + '/token.json', encoding='utf-8') as source:
    token = json.load(source)['token']
os.unlink(root + '/token.json')
environment = {'PATH': '/usr/bin:/bin', 'HOME': root, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
               'LANG': 'C', 'LC_ALL': 'C'}


def git(*args):
    result = subprocess.run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', *args], env=environment,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30)
    assert result.returncode == 0
    return result.stdout.decode().strip()


working = root + '/working'
git('init', '--initial-branch=main', working)
for name, text in {'hello.txt': 'owned repository source\n', '.gitattributes': '*.txt filter=owned\n',
                   '.gitmodules': '[submodule "unused"]\n path=unused\n url=https://foreign.invalid/repo.git\n'}.items():
    with open(working + '/' + name, 'w', encoding='utf-8') as target:
        target.write(text)
git('-C', working, 'add', '--all')
git('-C', working, '-c', 'user.name=Owned', '-c', 'user.email=owned@example.invalid', 'commit', '-m', 'fixture')
git('-C', working, 'branch', 'master')
commit = git('-C', working, 'rev-parse', 'HEAD')
for name in ('private.git', 'slow.git', 'public.git'):
    git('clone', '--bare', '--no-hardlinks', working, root + '/' + name)
git('init', '--bare', '--initial-branch=main', root + '/empty.git')
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.respond('GET')

    def do_POST(self):
        self.respond('POST')

    def respond(self, method):
        parsed = urllib.parse.urlsplit(self.path)
        authorized = self.headers.get('Authorization') == 'Bearer ' + token
        with lock:
            with open(root + '/requests.jsonl', 'a', encoding='utf-8') as target:
                target.write(json.dumps({'method': method, 'path': parsed.path, 'authorized': authorized}) + '\n')
                target.flush()
        if parsed.path.startswith('/redirect.git/'):
            self.send_response(302)
            self.send_header('Location', 'http://127.0.0.1:' + str(self.server.server_port) + '/foreign.git/info/refs?service=git-upload-pack')
            self.end_headers()
            return
        if parsed.path.startswith('/error.git/') or (not authorized and not parsed.path.startswith('/public.git/')):
            self.send_response(403)
            self.end_headers()
            self.wfile.write(('Bearer ' + token).encode())
            return
        if parsed.path.startswith('/slow.git/'):
            # Keep the real socket active while the slow TCG test admits its
            # observer. The product's 30-second socket timeout and 480-second
            # total download deadline remain unchanged. No complete response
            # is delivered: the test must cancel this in-flight download.
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-git-upload-pack-advertisement')
            self.send_header('Content-Length', '360')
            self.end_headers()
            for _ in range(360):
                try:
                    self.wfile.write(b'0')
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    break
                time.sleep(1)
            return
        assert parsed.path.split('/')[1] in ('private.git', 'slow.git', 'public.git', 'empty.git')
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        result = subprocess.run(['/usr/bin/git', 'http-backend'], input=body, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=30, env={**environment, 'GIT_PROJECT_ROOT': root,
                                'GIT_HTTP_EXPORT_ALL': '1', 'REMOTE_USER': 'owned-reader', 'REQUEST_METHOD': method,
                                'PATH_INFO': parsed.path, 'QUERY_STRING': parsed.query, 'CONTENT_LENGTH': str(len(body)),
                                'CONTENT_TYPE': self.headers.get('Content-Type', ''), 'HTTP_GIT_PROTOCOL': self.headers.get('Git-Protocol', '')})
        if result.returncode != 0:
            with lock:
                with open(root + '/requests.jsonl', 'a', encoding='utf-8') as target:
                    target.write(json.dumps({'fixtureBackendExit': result.returncode, 'phase': 'http-backend'}) + '\n')
            self.send_error(500, 'Owned Git fixture backend failed')
            return
        headers, content = result.stdout.split(b'\r\n\r\n', 1)
        values = dict(line.decode().split(':', 1) for line in headers.splitlines())
        self.send_response(int(values.get('Status', '200').strip().split()[0]))
        self.send_header('Content-Type', values.get('Content-Type', 'application/octet-stream').strip())
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        try:
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
server.daemon_threads = True
with open(root + '/ready.json', 'x', encoding='utf-8') as target:
    json.dump({'port': server.server_port, 'commit': commit, 'pid': os.getpid()}, target)
server.serve_forever()
