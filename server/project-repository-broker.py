# 模块职责：在核定仓库与认证范围内下载 Git 对象，禁止重定向并提供受限本地对象镜像。
# Module purpose: Downloads Git objects within approved repository/authentication scope, refusing redirects and serving a bounded local object mirror.
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


# 下载和认证范围共用同一 URL 规范，编码分隔符或点路径不能绕过目录前缀核对。
# 入口 / Entry: checked_repository.
# 功能：统一核验仓库 URL 和编码路径，返回准确 origin，拒绝隐含凭证及不安全外部 HTTP。
# Purpose: Validates repository URL/encoded paths, returning the exact origin and rejecting embedded credentials or insecure external HTTP.
# 输入 / Inputs: value
# 输出 / Returns: `(parsed, origin)`
# 拒绝 / Refusals: `ValueError('invalid repository URL')`; `ValueError('insecure repository URL')`; `ValueError('ambiguous repository path')`.
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
    # 入口 / Entry: NoRedirect.redirect_request.
    # 功能：拒绝所有仓库重定向，防止将认证头或 upload-pack 正文交给未批准仓库。
    # Purpose: Refuses all repository redirects so authorization or upload-pack content cannot reach an unapproved repository.
    # 输入 / Inputs: request; response; code; message; headers; newurl
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 拒绝 / Refusals: `ValueError('repository endpoint redirected')`.
    def redirect_request(self, request, response, code, message, headers, newurl):
        # 仓库迁移需显式保存新地址；不把凭证或 upload-pack 正文发送到服务端指定的新仓库。
        raise ValueError("repository endpoint redirected")


class RepositoryMirror:
    # 入口 / Entry: RepositoryMirror.__init__.
    # 功能：固定唯一仓库、认证范围和客户端独立 token，并初始化有界会话预算。
    # Purpose: Pins one repository, its authorization scope and an independent client token, initializing bounded session budgets.
    # 输入 / Inputs: repository; authentication; stage
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `set`, `threading.Lock`, `urllib.request.build_opener`; 更新 / updates `self.repository`, `self.authorization`, `self.stage`, `self.nonce`.
    # 拒绝 / Refusals: `ValueError('invalid authentication envelope')`; `ValueError('repository left authorization scope')`; `ValueError('invalid authorization')`.
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

    # 本地随机入口仅映射两种 Git 对象协议请求，不能把客户端路径直接拼接到上游仓库。
    # 入口 / Entry: RepositoryMirror.target.
    # 功能：仅允许准确随机入口下的 info/refs GET 与 upload-pack POST，并计入请求与期限预算。
    # Purpose: Allows only exact nonce-entry info/refs GET and upload-pack POST requests, charging request/deadline budgets.
    # 输入 / Inputs: method; path
    # 输出 / Returns: `self.repository + suffix`
    # 副作用 / Effects: 更新 / updates `self.requests`.
    # 拒绝 / Refusals: `ValueError('unapproved Git request')`; `ValueError('Git request budget exceeded')`.
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

    # 入口 / Entry: RepositoryMirror.charge.
    # 功能：在互斥锁内累加 Git 下载字节并核对总预算和会话截止时间。
    # Purpose: Accumulates Git download bytes under the mutex and checks total budget/session deadline.
    # 输入 / Inputs: count
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 更新 / updates `self.total`.
    # 拒绝 / Refusals: `ValueError('Git download budget exceeded')`.
    def charge(self, count):
        with self.lock:
            self.total += count
            if self.total > MAX_TOTAL or time.monotonic() >= self.deadline:
                raise ValueError("Git download budget exceeded")

    # 入口 / Entry: RepositoryMirror.open.
    # 功能：按核定 smart-HTTP 操作建立上游请求，附加固定协议头及单独保存的认证。
    # Purpose: Builds an upstream request for the approved smart-HTTP operation with fixed protocol headers and separately retained authorization.
    # 输入 / Inputs: method; path; body=None
    # 输出 / Returns: `self.opener.open(urllib.request.Request(target, data=body, headers=headers, method=method), timeout=30)`
    # 副作用 / Effects: 调用 / calls `self.opener.open`; 更新 / updates `headers['Content-Type']`, `headers['Authorization']`.
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

    # 入口 / Entry: BoundedServer.__init__.
    # 功能：建立最多四路并发的 loopback 仓库镜像，并发布端口和随机路径。
    # Purpose: Creates a repository loopback mirror bounded to four concurrent requests and publishes its port/nonce path.
    # 输入 / Inputs: mirror
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `threading.BoundedSemaphore`; 更新 / updates `self.mirror`, `self.slots`, `mirror.base`.
    def __init__(self, mirror):
        self.mirror = mirror
        self.slots = threading.BoundedSemaphore(4)
        super().__init__(("127.0.0.1", 0), Handler)
        mirror.base = "http://127.0.0.1:" + str(self.server_port) + "/" + mirror.nonce

    # 入口 / Entry: BoundedServer.process_request.
    # 功能：非阻塞取得 Git 请求槽位，满额关闭新请求，线程创建失败释放槽位。
    # Purpose: Acquires a Git request slot nonblockingly, closing excess requests and releasing slots on thread-creation failure.
    # 输入 / Inputs: request; address
    # 输出 / Returns: `None`
    # 拒绝 / Refusals: `re-raise`.
    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    # 入口 / Entry: BoundedServer.process_request_thread.
    # 功能：运行一条已准入 Git 请求，并始终交还其并发槽位。
    # Purpose: Runs one admitted Git request and always returns its concurrency slot.
    # 输入 / Inputs: request; address
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `super().process_request_thread`.
    # 收尾 / Finalization: `self.slots.release()`.
    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    # 入口 / Entry: BoundedServer.handle_error.
    # 功能：抑制默认异常日志，不在服务日志暴露仓库认证或上游响应。
    # Purpose: Suppresses default exception logging to avoid exposing repository authorization or upstream responses.
    # 输入 / Inputs: request; address
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    def handle_error(self, request, address):
        pass


class Handler(http.server.BaseHTTPRequestHandler):
    # 入口 / Entry: Handler.log_message.
    # 功能：抑制默认 HTTP 请求日志以减少仓库和随机入口信息泄露。
    # Purpose: Suppresses default HTTP request logs to reduce repository/nonce-entry information exposure.
    # 输入 / Inputs: *args
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    def log_message(self, *args):
        pass

    # 入口 / Entry: Handler.do_GET.
    # 功能：将 GET 请求交给经过客户端 token 和协议验证的对象转发流程。
    # Purpose: Delegates GET to object forwarding guarded by client-token and protocol validation.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    def do_GET(self):
        self.forward("GET")

    # 入口 / Entry: Handler.do_POST.
    # 功能：将 POST 请求交给经过客户端 token、长度和内容类型验证的对象转发流程。
    # Purpose: Delegates POST to object forwarding guarded by client-token, length and content-type validation.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    def do_POST(self):
        self.forward("POST")

    # 入口 / Entry: Handler.forward.
    # 功能：核验独立客户端 token 与 smart-HTTP 请求/响应，完整有界暂存后才发送 Git 对象。
    # Purpose: Validates the independent client token and smart-HTTP request/response, fully staging bounded Git objects before transmission.
    # 输入 / Inputs: method
    # 输出 / Returns: `None`
    # 副作用 / Effects: 调用 / calls `self.send_error`, `self.connection.settimeout`, `self.rfile.read`, `mirror.open`, `response.read`, `data.write`; 更新 / updates `self.close_connection`, `mirror.failed`.
    # 拒绝 / Refusals: `ValueError('invalid Git client headers')`; `ValueError('invalid upload-pack body')`; `ValueError('incomplete Git request')`.
    # 收尾 / Finalization: `self.close_connection = True`.
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


# 入口 / Entry: git_environment.
# 功能：建立禁用系统和用户 Git 配置、认证交互的固定下载环境，客户端 token 在后续单独加入。
# Purpose: Builds a fixed download environment disabling system/user Git configuration and interactive authentication; the client token is added separately afterward.
# 输入 / Inputs: stage
# 输出 / Returns: `{'PATH': '/usr/bin:/bin', 'HOME': os.path.join(stage, 'home'), 'LANG': 'C', 'LC_ALL': 'C', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_SYSTEM': os.devnull, 'GI…`
def git_environment(stage):
    return {"PATH": "/usr/bin:/bin", "HOME": os.path.join(stage, "home"), "LANG": "C", "LC_ALL": "C",
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_SYSTEM": os.devnull, "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "/bin/false", "SSH_ASKPASS": "/bin/false"}


# 入口 / Entry: fetch_repository.
# 功能：在临时裸仓库中只下载对象并导出 bundle，不执行 checkout、子模块或过滤器。
# Purpose: Downloads objects into a temporary bare repository and exports a bundle without checkout, submodules or filters.
# 输入 / Inputs: stage; repository; authentication; git='/usr/bin/git'
# 输出 / Returns: `{'version': 1, 'head': head, 'commit': commit, 'bundleSha256': digest, 'bundleBytes': size}`
# 副作用 / Effects: 调用 / calls `os.mkdir`, `prefix.append`, `threading.Thread`, `run`, `server.server_close`, `open`; 更新 / updates `environment['SAKURA_REPOSITORY_CLIENT_HEADER']`.
# 拒绝 / Refusals: `ValueError('Git mirror rejected a request')`; `ValueError('invalid default branch')`; `ValueError('invalid Git object ID')`.
# 收尾 / Finalization: `server.shutdown()`; `server.server_close()`; `worker.join(timeout=2)`.
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

    # 入口 / Entry: fetch_repository.run.
    # 功能：执行当前下载流程的受限子命令，核对超时、退出码及有限输出。
    # Purpose: Runs a restricted child command for the current download flow, checking timeout, exit status and bounded output.
    # 输入 / Inputs: arguments; cwd=stage; optional=False
    # 输出 / Returns: `result`
    # 副作用 / Effects: 调用 / calls `subprocess.run`.
    # 拒绝 / Refusals: `ValueError('Git command deadline expired')`; `ValueError('Git object operation failed')`.
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


# 入口 / Entry: main.
# 功能：读取并核验下载请求，建立受控镜像后把完整仓库对象作为 bundle 交付。
# Purpose: Reads/checks a download request and starts a controlled mirror before delivering complete repository objects as a bundle.
# 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
# 输出 / Returns: `0`
# 副作用 / Effects: 调用 / calls `os.open`, `os.fdopen`, `os.close`, `os.unlink`, `set`, `resource.setrlimit`.
# 拒绝 / Refusals: `ValueError('invalid download stage')`; `ValueError('unprotected download stage')`; `ValueError('unprotected download envelope')`.
# 收尾 / Finalization: `os.close(descriptor)`.
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
