"""Owned smoke-test registry; no external service or user credential is used."""
import base64
import hashlib
import io
import json
import os
import tarfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(ROOT, "tokens.json"), encoding="utf-8") as source:
    tokens = json.load(source)
requests = []
lock = threading.Lock()


def npm(version):
    output = io.BytesIO()
    files = {
        "package/package.json": json.dumps({"name": "@sakura-owned/auth-probe", "version": version,
            "scripts": {"preinstall": "touch /workspace/npm-auth/lifecycle-hook"}}).encode(),
        "package/index.js": b"module.exports = 'owned authenticated package';\n",
    }
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size, entry.mtime = len(data), 0
            archive.addfile(entry, io.BytesIO(data))
    data = output.getvalue()
    return data, "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()


def wheel(name, dependency=None):
    output = io.BytesIO()
    prefix = name + "-1.0.0.dist-info/"
    metadata = "Metadata-Version: 2.1\nName: " + name.replace("_", "-") + "\nVersion: 1.0.0\n"
    if dependency:
        metadata += "Requires-Dist: " + dependency + "==1.0.0\n"
    files = {name + "/__init__.py": b"VALUE = 'owned wheel'\n",
             prefix + "METADATA": (metadata + "\n").encode(),
             prefix + "WHEEL": b"Wheel-Version: 1.0\nGenerator: Sakura owned smoke\nRoot-Is-Purelib: true\nTag: py3-none-any\n"}
    record = ""
    for path, data in files.items():
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("=")
        record += path + ",sha256=" + digest + "," + str(len(data)) + "\n"
    record += prefix + "RECORD,,\n"
    files[prefix + "RECORD"] = record.encode()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, data in files.items():
            archive.writestr(path, data)
    return output.getvalue()


npm1, integrity1 = npm("1.0.0")
npm2, integrity2 = npm("2.0.0")
npm4, integrity4 = npm("4.0.0")
private_wheel = wheel("owned_auth_probe", "owned-public-probe")
public_wheel = wheel("owned_public_probe")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        scope = "npm" if self.path.startswith("/npm/") else "pip" if self.path.startswith("/python/simple/") else "public"
        expected = "Bearer " + tokens["npm"] if scope == "npm" else "Basic " + base64.b64encode(
            ("reader:" + tokens["pip"]).encode()).decode() if scope == "pip" else None
        authorized = self.headers.get("Authorization") == expected
        with lock:
            requests.append({"path": self.path, "scope": scope, "authorized": authorized,
                             "hadAuthorization": self.headers.get("Authorization") is not None})
            with open(os.path.join(ROOT, "requests.json"), "w", encoding="utf-8") as target:
                json.dump(requests, target)
        if not authorized:
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="owned smoke"')
            self.end_headers()
            self.wfile.write(b"owned authentication required")
            return
        if self.path == "/npm/-/escape.tgz":
            self.send_response(302)
            self.send_header("Location", self.server.foreign + "/redirect-target")
            self.end_headers()
            return
        if self.path == "/npm/-/slow.tgz":
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(npm4)))
            self.end_headers()
            try:
                for offset in range(0, len(npm4), 16):
                    self.wfile.write(npm4[offset:offset + 16])
                    self.wfile.flush()
                    time.sleep(.5)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        files = {"/npm/-/auth-probe-1.0.0.tgz": npm1, "/npm/-/auth-probe-2.0.0.tgz": npm2,
                 "/python/simple/owned-auth-probe/owned_auth_probe-1.0.0-py3-none-any.whl": private_wheel,
                 "/public/owned_public_probe-1.0.0-py3-none-any.whl": public_wheel}
        body = files.get(self.path)
        content_type = "application/octet-stream"
        if self.path == "/python/simple/owned-auth-probe/":
            filename = "owned_auth_probe-1.0.0-py3-none-any.whl"
            body = ('<a href="' + filename + '#sha256=' + hashlib.sha256(private_wheel).hexdigest() + '">' + filename + '</a>').encode()
            content_type = "text/html"
        if self.path == "/python/simple/owned-public-probe/":
            filename = "owned_public_probe-1.0.0-py3-none-any.whl"
            body = ('<a href="' + self.server.foreign + '/public/' + filename + '#sha256=' +
                    hashlib.sha256(public_wheel).hexdigest() + '">' + filename + '</a>').encode()
            content_type = "text/html"
        self.send_response(200 if body is not None else 404)
        self.send_header("Content-Type", content_type)
        if body is not None:
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body is not None:
            self.wfile.write(body)


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
foreign = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
server.foreign = foreign.foreign = "http://127.0.0.1:" + str(foreign.server_port)
threading.Thread(target=foreign.serve_forever, daemon=True).start()
with open(os.path.join(ROOT, "ready.json"), "w", encoding="utf-8") as target:
    json.dump({"port": server.server_port, "foreignPort": foreign.server_port,
               "integrity1": integrity1, "integrity2": integrity2, "integrity4": integrity4}, target)
server.serve_forever()
