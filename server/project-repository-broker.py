"""Fetch object data from one smart-HTTP repository; never enter a worktree.

The system Git process sees only a nonce loopback URL. Authorization stays in
this process, and checkout/submodules/filters are not part of this downloader.
Protocol: https://git-scm.com/docs/http-protocol
Bundle handoff: https://git-scm.com/docs/git-bundle
"""
import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_INDEX = 8 * 1024 * 1024
MAX_REQUEST = 1024 * 1024
MAX_PACK = 512 * 1024 * 1024
MAX_TOTAL = 1024 * 1024 * 1024
MAX_REQUESTS = 64
TIMEOUT = 480


def checked_repository(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 2048 or re.search(r"[\s\x00-\x1f\x7f\\]", value):
        raise ValueError("invalid repository URL")
    parsed = urllib.parse.urlsplit(value)
    if not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment:
        raise ValueError("invalid repository URL")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "::1", "localhost")):
        raise ValueError("insecure repository URL")
    if re.search(r"%(?:25|2f|5c|00|0a|0d)", parsed.path, re.I):
        raise ValueError("ambiguous repository path")
    decoded = urllib.parse.unquote(parsed.path, errors="strict")
    if re.search(r"[\x00-\x1f\x7f\\;]", decoded) or any(part in (".", "..") for part in decoded.split("/")) or "//" in decoded:
        raise ValueError("ambiguous repository path")
    origin = (parsed.scheme, parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == "https" else 80))
    return parsed, origin


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        # A repository move needs an explicit saved URL; never send its credential
        # or an upload-pack request to a server-selected repository.
        raise ValueError("repository endpoint redirected")


class RepositoryMirror:
    def __init__(self, repository, authentication, stage):
        parsed, origin = checked_repository(repository)
        self.repository = repository.rstrip("/")
        self.authorization = None
        if authentication is not None:
            if set(authentication) != {"endpoint", "authorization"}:
                raise ValueError("invalid authentication envelope")
            scope, scope_origin = checked_repository(authentication["endpoint"])
            path = scope.path.rstrip("/")
            if origin != scope_origin or not (parsed.path == path or parsed.path.startswith(path + "/")):
                raise ValueError("repository left authorization scope")
            authorization = authentication["authorization"]
            if not isinstance(authorization, str) or not re.fullmatch(r"(?:Bearer|Basic) [\x21-\x7e]+", authorization):
                raise ValueError("invalid authorization")
            self.authorization = authorization
        self.stage = stage
        self.nonce = secrets.token_hex(32)
        self.client_token = secrets.token_hex(32)
        self.base = ""
        self.lock = threading.Lock()
        self.total = self.requests = 0
        self.failed = False
        self.deadline = time.monotonic() + TIMEOUT
        # Only the already validated instance proxy environment is available.
        self.opener = urllib.request.build_opener(NoRedirect())

    def target(self, method, path):
        allowed = {
            ("GET", "/" + self.nonce + "/info/refs?service=git-upload-pack"): "/info/refs?service=git-upload-pack",
            ("POST", "/" + self.nonce + "/git-upload-pack"): "/git-upload-pack",
        }
        suffix = allowed.get((method, path))
        if suffix is None:
            raise ValueError("unapproved Git request")
        with self.lock:
            self.requests += 1
            if self.requests > MAX_REQUESTS or time.monotonic() >= self.deadline:
                raise ValueError("Git request budget exceeded")
        return self.repository + suffix

    def charge(self, count):
        with self.lock:
            self.total += count
            if self.total > MAX_TOTAL or time.monotonic() >= self.deadline:
                raise ValueError("Git download budget exceeded")

    def open(self, method, path, body=None):
        target = self.target(method, path)
        headers = {"User-Agent": "Sakura-repository-prefetch/1", "Accept-Encoding": "identity",
                   "Git-Protocol": "version=2"}
        if method == "POST":
            headers["Content-Type"] = "application/x-git-upload-pack-request"
        if self.authorization is not None:
            headers["Authorization"] = self.authorization
        return self.opener.open(urllib.request.Request(target, data=body, headers=headers, method=method), timeout=30)


class BoundedServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def __init__(self, mirror):
        self.mirror = mirror
        self.slots = threading.BoundedSemaphore(4)
        super().__init__(("127.0.0.1", 0), Handler)
        mirror.base = "http://127.0.0.1:" + str(self.server_port) + "/" + mirror.nonce

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def handle_error(self, request, address):
        pass


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.forward("GET")

    def do_POST(self):
        self.forward("POST")

    def forward(self, method):
        sent = False
        mirror = self.server.mirror
        tokens = self.headers.get_all("X-Sakura-Repository-Token", [])
        if len(tokens) != 1 or not hmac.compare_digest(tokens[0], mirror.client_token):
            # Linux exposes root argv via /proc to other UIDs. The public nonce
            # URL therefore is not authentication. This independent token lives
            # only in the clean root Git environment, never its argv or URL.
            self.send_error(403, "Repository client is not authorized")
            self.close_connection = True
            return
        try:
            self.connection.settimeout(35)
            # Reject chunked/compressed/request-selected credentials and URL tricks.
            if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Encoding") or self.headers.get("Authorization"):
                raise ValueError("invalid Git client headers")
            body = None
            if method == "POST":
                length = self.headers.get("Content-Length", "")
                if not length.isdigit() or not 1 <= int(length) <= MAX_REQUEST or self.headers.get_content_type() != "application/x-git-upload-pack-request":
                    raise ValueError("invalid upload-pack body")
                body = self.rfile.read(int(length))
                if len(body) != int(length):
                    raise ValueError("incomplete Git request")
            elif self.headers.get("Content-Length") not in (None, "0"):
                raise ValueError("unexpected GET body")
            expected_type = "application/x-git-upload-pack-" + ("advertisement" if method == "GET" else "result")
            with mirror.open(method, self.path, body) as response:
                if response.status != 200 or response.headers.get_content_type() != expected_type or response.headers.get("Content-Encoding", "identity").lower() != "identity":
                    raise ValueError("not a smart-HTTP Git response")
                limit = MAX_INDEX if method == "GET" else MAX_PACK
                length = response.headers.get("Content-Length")
                if length is not None and (not length.isdigit() or int(length) > limit):
                    raise ValueError("Git response too large")
                with tempfile.TemporaryFile(dir=mirror.stage) as data:
                    count = 0
                    while True:
                        chunk = response.read(65536)
                        if not chunk:
                            break
                        count += len(chunk)
                        if count > limit:
                            raise ValueError("Git response too large")
                        mirror.charge(len(chunk))
                        data.write(chunk)
                    if length is not None and count != int(length):
                        raise ValueError("incomplete Git response")
                    data.seek(0)
                    self.send_response(200)
                    self.send_header("Content-Type", expected_type)
                    self.send_header("Content-Length", str(count))
                    self.end_headers()
                    sent = True
                    while True:
                        chunk = data.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
        except Exception:
            mirror.failed = True
            if not sent:
                # Neither response bodies, Location, cookies nor a traceback
                # containing a reflected authorization value reach Git/logs.
                self.send_error(502, "Repository download rejected")
        finally:
            self.close_connection = True


def git_environment(stage):
    return {"PATH": "/usr/bin:/bin", "HOME": os.path.join(stage, "home"), "LANG": "C", "LC_ALL": "C",
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_SYSTEM": os.devnull, "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "/bin/false", "SSH_ASKPASS": "/bin/false"}


def fetch_repository(stage, repository, authentication, git="/usr/bin/git"):
    for name in ("home", "empty"):
        os.mkdir(os.path.join(stage, name), 0o700)
    environment = git_environment(stage)
    mirror = RepositoryMirror(repository, authentication, stage)
    environment["SAKURA_REPOSITORY_CLIENT_HEADER"] = "X-Sakura-Repository-Token: " + mirror.client_token
    prefix = [git, "--no-pager", "-c", "core.hooksPath=" + os.devnull, "-c", "core.fsmonitor=false",
              "-c", "credential.helper=", "-c", "http.extraHeader=", "-c", "http.proxy=", "-c", "http.followRedirects=false",
              "-c", "protocol.allow=never", "-c", "protocol.http.allow=always", "-c", "protocol.version=2",
              "-c", "fetch.fsckObjects=true", "-c", "transfer.fsckObjects=true", "-c", "maintenance.auto=false",
              "-c", "gc.auto=0", "-c", "init.defaultBranch=main"]
    # --config-env avoids putting the loopback token in /proc/.../cmdline.
    # The upstream Bearer/Basic credential never enters the Git environment.
    prefix.append("--config-env=http.extraHeader=SAKURA_REPOSITORY_CLIENT_HEADER")
    deadline = time.monotonic() + TIMEOUT

    def run(arguments, cwd=stage, optional=False):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ValueError("Git command deadline expired")
        result = subprocess.run(prefix + arguments, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=remaining)
        if len(result.stdout) > MAX_INDEX or (result.returncode != 0 and not optional):
            raise ValueError("Git object operation failed")
        return result

    server = BoundedServer(mirror)
    worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .1}, daemon=True)
    worker.start()
    bare = os.path.join(stage, "repository.git")
    try:
        run(["clone", "--mirror", "--no-local", "--no-hardlinks", "--reject-shallow", "--template=" + os.path.join(stage, "empty"),
             "--", mirror.base, bare])
        if mirror.failed:
            raise ValueError("Git mirror rejected a request")
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)
    # No worktree exists, no project configuration is read, no executable data
    # from the repository is invoked by any command in this block.
    run(["fsck", "--strict", "--no-reflogs"], bare)
    head_result = run(["symbolic-ref", "-q", "HEAD"], bare, True)
    head = head_result.stdout.decode("utf-8").strip() if head_result.returncode == 0 else None
    if head is not None and (not head.startswith("refs/heads/") or len(head) > 1024 or re.search(r"[\x00-\x20\x7f]", head)):
        raise ValueError("invalid default branch")
    commit_result = run(["rev-parse", "--verify", "HEAD"], bare, True)
    commit = commit_result.stdout.decode("ascii").strip() if commit_result.returncode == 0 else None
    if commit is not None and not re.fullmatch(r"[a-f0-9]{40}|[a-f0-9]{64}", commit):
        raise ValueError("invalid Git object ID")
    refs = run(["for-each-ref", "--format=%(refname)"], bare).stdout
    if len(refs.splitlines()) > 8192:
        raise ValueError("too many repository refs")
    if commit is None and refs:
        raise ValueError("remote HEAD is absent")
    bundle = os.path.join(stage, "repository.bundle")
    digest = None
    size = 0
    if commit is not None:
        run(["bundle", "create", bundle, "--all", "HEAD"], bare)
        run(["bundle", "verify", bundle], bare)
        size = os.lstat(bundle).st_size
        if not 0 < size <= MAX_PACK:
            raise ValueError("Git bundle exceeds handoff budget")
        checksum = hashlib.sha256()
        with open(bundle, "rb") as source:
            while True:
                chunk = source.read(65536)
                if not chunk:
                    break
                checksum.update(chunk)
        digest = checksum.hexdigest()
    return {"version": 1, "head": head, "commit": commit, "bundleSha256": digest, "bundleBytes": size}


def main():
    stage = sys.argv[1]
    if not re.fullmatch(r"/run/sakura-repository-download\.[a-f0-9]{32}", stage):
        raise ValueError("invalid download stage")
    info = os.lstat(stage)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError("unprotected download stage")
    path = os.path.join(stage, "request.json")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        entry = os.fstat(descriptor)
        if not stat.S_ISREG(entry.st_mode) or entry.st_uid != 0 or entry.st_gid != 0 or stat.S_IMODE(entry.st_mode) != 0o600 or entry.st_size > 16384:
            raise ValueError("unprotected download envelope")
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as source:
            request = json.load(source)
    finally:
        os.close(descriptor)
    os.unlink(path)
    if set(request) != {"repository", "authentication", "gid"} or type(request["gid"]) is not int or not 20000 <= request["gid"] <= 59999:
        raise ValueError("invalid repository request")
    # Bound files created by Git as well as the HTTP stream. The outer task's
    # cgroup owns all descendants and verifies their exit before handoff.
    import resource
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_PACK, MAX_PACK))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    result = fetch_repository(stage, request["repository"], request["authentication"])
    gid = request["gid"]
    if result["bundleSha256"] is not None:
        os.chown(os.path.join(stage, "repository.bundle"), 0, gid)
        os.chmod(os.path.join(stage, "repository.bundle"), 0o440)
    os.chown(os.path.join(stage, "empty"), 0, gid)
    os.chmod(os.path.join(stage, "empty"), 0o550)
    os.chown(stage, 0, gid)
    os.chmod(stage, 0o710)
    result.update({"device": str(info.st_dev), "inode": str(info.st_ino)})
    print(json.dumps(result), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("Repository prefetch failed; check the fixed smart-HTTP URL, credential and download limits", file=sys.stderr)
        sys.exit(73)
