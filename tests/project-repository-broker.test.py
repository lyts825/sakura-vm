# 模块职责：仓库代理真实 Git smart-HTTP 与 bundle 回归；客户机 UID/cgroup 验证属于独立 VM smoke。
# Module: Real Git smart-HTTP and bundle regressions for the repository broker; guest UID/cgroup checks belong to separate VM smoke tests.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
"""Real Git smart-HTTP and bundle tests; guest UID/cgroup tests live in the VM smoke."""
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("repository_broker", sys.argv.pop(1))
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)
GIT = shutil.which("git")
TOKEN = "Bearer owned-repository-test-secret"


# 中文功能：沿用生产 Git 的隔离环境，仅在 Windows 补入启动系统程序必需的系统路径和临时目录变量。
# English: Retain the production isolated Git environment and add only Windows system-path and temporary-directory variables needed to launch system programs.
# 输入 / Inputs: stage。
# 结果：返回分支计算值（`value`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`value`); its implementation and call sites define the actual type.
# 协作入口 / Collaborators: `broker_original_environment`, `value.update`.
def portable_environment(stage):
    value = broker_original_environment(stage)
    if os.name == "nt":
        value.update({key: os.environ[key] for key in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP") if key in os.environ})
    return value


broker_original_environment = broker.git_environment
broker.git_environment = portable_environment


class Fixture(BaseHTTPRequestHandler):
    events = []
    root = ""
    foreign = ""

    # 中文功能：关闭夹具 HTTP 服务器的常规日志，测试依据事件列表而不是控制台输出观察请求。
    # English: Suppress routine HTTP-fixture logging; tests observe requests through the event list instead of console output.
    # 输入 / Inputs: self, *args。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    def log_message(self, *args):
        pass

    # 中文功能：将 GET 请求转交共同的 smart-HTTP 响应器。
    # English: Dispatch GET requests to the shared smart-HTTP responder.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.respond`.
    def do_GET(self):
        self.respond("GET")

    # 中文功能：将 POST 请求转交共同的 smart-HTTP 响应器。
    # English: Dispatch POST requests to the shared smart-HTTP responder.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.respond`.
    def do_POST(self):
        self.respond("POST")

    # 中文功能：记录请求与授权，提供重定向、认证拒绝、超大响应等故障路由，正常路由执行真实 git http-backend。
    # English: Record requests and authorization, serve redirect/authentication/oversize fault routes, and execute real git http-backend for normal routes.
    # 输入 / Inputs: self, method。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `values[key.lower()]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Fixture.events.append`, `self.headers.get`, `urllib.parse.urlsplit`, `path.path.startswith`.
    # 设计思路：先处理故障路由，再把正常请求转换为 CGI 环境交给真实 Git；将请求授权和反射错误记录为可观察输入，核对代理不会泄露凭据或跨入口转发。
    # Design: Handle fault routes first, then translate normal requests into CGI input for real Git. Record authorization and reflected errors as observable inputs so the broker can be checked for credential leakage and cross-endpoint forwarding.
    def respond(self, method):
        Fixture.events.append((method, self.path, self.headers.get("Authorization")))
        path = urllib.parse.urlsplit(self.path)
        if path.path.startswith("/redirect.git/"):
            self.send_response(302)
            self.send_header("Location", self.foreign + "/foreign.git/info/refs?service=git-upload-pack")
            self.end_headers()
            return
        if path.path.startswith("/error.git/"):
            self.send_response(403)
            self.end_headers()
            self.wfile.write(TOKEN.encode())
            return
        if path.path.startswith("/oversized.git/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/x-git-upload-pack-advertisement")
            self.end_headers()
            self.wfile.write(b"x" * 4096)
            return
        if path.path.startswith("/private.git/") and self.headers.get("Authorization") not in (TOKEN, "Basic cmVhZGVyOnNlY3JldA=="):
            self.send_response(403)
            self.end_headers()
            self.wfile.write(TOKEN.encode())
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        environment = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                       "GIT_PROJECT_ROOT": self.root, "GIT_HTTP_EXPORT_ALL": "1", "REMOTE_USER": "owned-reader",
                       "REQUEST_METHOD": method, "PATH_INFO": path.path, "QUERY_STRING": path.query,
                       "CONTENT_TYPE": self.headers.get("Content-Type", ""), "CONTENT_LENGTH": str(len(body)),
                       "HTTP_GIT_PROTOCOL": self.headers.get("Git-Protocol", "")}
        result = subprocess.run([GIT, "http-backend"], input=body, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, env=environment, timeout=15)
        if result.returncode != 0:
            self.send_error(500)
            return
        headers, content = result.stdout.split(b"\r\n\r\n", 1)
        values = {}
        for line in headers.decode().splitlines():
            key, value = line.split(":", 1)
            values[key.lower()] = value.strip()
        self.send_response(int(values.get("status", "200").split()[0]))
        self.send_header("Content-Type", values.get("content-type", "application/octet-stream"))
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


class RepositoryTests(unittest.TestCase):
    # 中文功能：建立两个本地 HTTP 服务及真实 Git 仓库，准备明确默认分支、缺失 HEAD 和空仓库情景。
    # English: Create two local HTTP services and real Git repositories with explicit default-branch, missing-HEAD and empty-repository scenarios.
    # 输入 / Inputs: cls。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `cls.temporary`, `cls.root`, `Fixture.root`, `cls.servers`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `tempfile.TemporaryDirectory`, `os.environ.get`, `ThreadingHTTPServer`, `range`.
    # 检查边界 / Checked boundaries: `GIT`.
    @classmethod
    def setUpClass(cls):
        assert GIT
        # Keep actual Git pack paths below Win32 MAX_PATH even when the full
        # suite supplies an isolated TEMP directory with a UUID in its name.
        cls.temporary = tempfile.TemporaryDirectory(prefix="git-", dir=os.environ.get("SAKURA_BROKER_TEST_ROOT"))
        cls.root = cls.temporary.name
        Fixture.root = cls.root
        cls.servers = [ThreadingHTTPServer(("127.0.0.1", 0), Fixture) for _ in range(2)]
        cls.base = "http://127.0.0.1:" + str(cls.servers[0].server_port)
        Fixture.foreign = "http://127.0.0.1:" + str(cls.servers[1].server_port)
        cls.threads = []
        for server in cls.servers:
            thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .05}, daemon=True)
            thread.start()
            cls.threads.append(thread)
        working = os.path.join(cls.root, "working")
        cls.git("init", "--initial-branch=main", working)
        for name, text in {"hello.txt": "owned source\n", ".gitattributes": "*.txt filter=owned\n",
                           ".gitmodules": '[submodule "unused"]\n path=unused\n url=https://foreign.invalid/private.git\n'}.items():
            with open(os.path.join(working, name), "w", encoding="utf-8") as target:
                target.write(text)
        cls.git("-C", working, "add", "--all")
        cls.git("-C", working, "-c", "user.name=Owned", "-c", "user.email=owned@example.invalid", "commit", "-m", "owned")
        # Both branches point at the same commit: bundle HEAD inference alone
        # must not override the server's explicit main default branch.
        cls.git("-C", working, "branch", "master")
        cls.commit = cls.git("-C", working, "rev-parse", "HEAD").strip()
        for name in ("private.git", "public.git", "missing-head.git"):
            cls.git("clone", "--bare", "--no-hardlinks", working, os.path.join(cls.root, name))
        cls.git("-C", os.path.join(cls.root, "missing-head.git"), "symbolic-ref", "HEAD", "refs/heads/absent")
        cls.git("init", "--bare", "--initial-branch=main", os.path.join(cls.root, "empty.git"))

    # 中文功能：以隔离 Git 配置和禁用 hooks 的方式执行真实 Git 命令，返回标准输出，失败时将 stderr 转为断言错误。
    # English: Execute real Git with isolated configuration and disabled hooks, returning stdout and turning failed-command stderr into an assertion error.
    # 输入 / Inputs: cls, *args。
    # 结果：返回分支计算值（`result.stdout.decode().strip()`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`result.stdout.decode().strip()`); its implementation and call sites define the actual type.
    # 失败 / Failure: `AssertionError(result.stderr.decode(errors='replace'))`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `subprocess.run`, `list`, `AssertionError`, `result.stderr.decode`.
    @classmethod
    def git(cls, *args):
        result = subprocess.run([GIT, "-c", "core.hooksPath=" + os.devnull] + list(args), stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}, timeout=20)
        if result.returncode:
            raise AssertionError(result.stderr.decode(errors="replace"))
        return result.stdout.decode().strip()

    # 中文功能：关闭两个本地服务器、等待工作线程并回收本组仓库临时目录。
    # English: Shut down both local servers, join worker threads and release the suite temporary repository directory.
    # 输入 / Inputs: cls。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `zip`, `server.shutdown`, `server.server_close`, `thread.join`.
    @classmethod
    def tearDownClass(cls):
        for server, thread in zip(cls.servers, cls.threads):
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        cls.temporary.cleanup()

    # 中文功能：清空上个用例的 HTTP 事件并为本用例建立独立 staging 目录。
    # English: Clear previous HTTP events and create a private staging directory for this case.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.stage`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `Fixture.events.clear`, `tempfile.mkdtemp`.
    def setUp(self):
        Fixture.events.clear()
        self.stage = tempfile.mkdtemp(prefix="owned-stage-", dir=self.root)

    # 中文功能：构造本地仓库入口绑定的授权记录，供下载用例选择对应凭据。
    # English: Build an authorization record bound to the local repository endpoint for download cases to select credentials.
    # 输入 / Inputs: self, authorization = TOKEN。
    # 结果：返回分支计算值（`{'endpoint': self.base + '/', 'authorization': authorization}`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`{'endpoint': self.base + '/', 'authorization': authorization}`); its implementation and call sites define the actual type.
    def auth(self, authorization=TOKEN):
        return {"endpoint": self.base + "/", "authorization": authorization}

    # 中文功能：通过生产 fetch_repository 下载指定本地仓库并传入所选授权。
    # English: Download the selected local repository through production fetch_repository using the selected authorization.
    # 输入 / Inputs: self, name = 'private.git', authentication = None。
    # 结果：返回分支计算值（`broker.fetch_repository(self.stage, self.base + '/' + name, authentication, GIT)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`broker.fetch_repository(self.stage, self.base + '/' + name, authentication, GIT)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `broker.fetch_repository`.
    def fetch(self, name="private.git", authentication=None):
        return broker.fetch_repository(self.stage, self.base + "/" + name, authentication, GIT)

    # 中文功能：创建生产 RepositoryMirror 及有界本地服务，注册服务和线程清理后返回镜像对象。
    # English: Create a production RepositoryMirror and bounded local server, register server/thread cleanup, and return the mirror object.
    # 输入 / Inputs: self, repository = 'private.git', authentication = None。
    # 结果：返回分支计算值（`mirror`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`mirror`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `broker.RepositoryMirror`, `broker.BoundedServer`, `threading.Thread`, `thread.start`.
    def mirror(self, repository="private.git", authentication=None):
        mirror = broker.RepositoryMirror(self.base + "/" + repository, authentication, self.stage)
        server = broker.BoundedServer(mirror)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .05}, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(), thread.join(timeout=2)))
        return mirror

    # 中文功能：向生产代理转发镜像相对请求、正文和头，返回响应供协议和授权断言观察。
    # English: Forward a mirror-relative request, body and headers through the production broker and return its response for protocol/authorization assertions.
    # 输入 / Inputs: self, mirror, suffix, body = None, headers = None。
    # 结果：返回分支计算值（`urllib.request.urlopen(urllib.request.Request(mirror.base + suffix, data=body, headers={'X-Sakura-Re…`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`urllib.request.urlopen(urllib.request.Request(mirror.base + suffix, data=body, headers={'X-Sakura-Re…`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `urllib.request.urlopen`, `urllib.request.Request`.
    def request(self, mirror, suffix, body=None, headers=None):
        return urllib.request.urlopen(urllib.request.Request(mirror.base + suffix, data=body,
            headers={"X-Sakura-Repository-Token": mirror.client_token, **(headers or {})}), timeout=5)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.fetch`, `self.auth`, `self.assertEqual`, `os.path.join`.
    def test_authenticated_real_git_preserves_default_branch_and_bundle_objects(self):
        result = self.fetch(authentication=self.auth())
        self.assertEqual(result["head"], "refs/heads/main")
        self.assertEqual(result["commit"], self.commit)
        bundle = os.path.join(self.stage, "repository.bundle")
        with open(bundle, "rb") as source:
            self.assertEqual(hashlib.sha256(source.read()).hexdigest(), result["bundleSha256"])
        checkout = os.path.join(self.root, "checkout")
        self.git("clone", "--branch=main", "--no-hardlinks", "--template=" + os.path.join(self.stage, "empty"), bundle, checkout)
        self.assertEqual(self.git("-C", checkout, "symbolic-ref", "HEAD"), "refs/heads/main")
        self.assertEqual(self.git("-C", checkout, "rev-parse", "refs/remotes/origin/master"), self.commit)
        with open(os.path.join(checkout, "hello.txt"), encoding="utf-8") as source:
            self.assertEqual(source.read(), "owned source\n")
        self.assertTrue(Fixture.events)
        self.assertTrue(all(auth == TOKEN for _, _, auth in Fixture.events))
        self.assertTrue(all(path.startswith("/private.git/") and "receive-pack" not in path for _, path, _ in Fixture.events))

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.stage`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.fetch`, `self.auth`, `self.assertEqual`, `self.assertTrue`.
    def test_basic_and_public_downloads_use_only_selected_authorization(self):
        result = self.fetch(authentication=self.auth("Basic cmVhZGVyOnNlY3JldA=="))
        self.assertEqual(result["commit"], self.commit)
        self.assertTrue(all(auth == "Basic cmVhZGVyOnNlY3JldA==" for _, _, auth in Fixture.events))
        Fixture.events.clear()
        self.stage = tempfile.mkdtemp(prefix="owned-public-", dir=self.root)
        self.fetch("public.git")
        self.assertTrue(all(auth is None for _, _, auth in Fixture.events))

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `os.environ.copy`, `os.environ.update`, `broker.git_environment`, `self.assertNotIn`.
    # 设计思路：将主体计算与 finally 收尾分开，使返回和异常路径经过相同收尾步骤。
    # Design: Separate body computation from finally-based finalization so return and exception paths share the same finalization step.
    def test_git_environment_never_inherits_project_execution_configuration(self):
        saved = os.environ.copy()
        try:
            os.environ.update({"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.hooksPath", "GIT_CONFIG_VALUE_0": self.root,
                               "GIT_DIR": self.root, "GIT_WORK_TREE": self.root, "GIT_ASKPASS": "hostile-askpass",
                               "GIT_CONFIG_GLOBAL": "hostile-global", "PYTHONPATH": "hostile-python", "TOKEN": TOKEN})
            child = broker.git_environment(self.stage)
            for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "PYTHONPATH", "TOKEN"):
                self.assertNotIn(key, child)
            self.assertEqual(child["GIT_CONFIG_GLOBAL"], os.devnull)
            self.fetch(authentication=self.auth())
        finally:
            os.environ.clear()
            os.environ.update(saved)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.stage`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.fetch`, `self.assertEqual`, `self.assertIsNone`, `tempfile.mkdtemp`.
    def test_empty_repository_and_missing_remote_head_are_distinct(self):
        empty = self.fetch("empty.git")
        self.assertEqual(empty["head"], "refs/heads/main")
        self.assertIsNone(empty["commit"])
        self.assertIsNone(empty["bundleSha256"])
        self.assertEqual(empty["bundleBytes"], 0)
        self.stage = tempfile.mkdtemp(prefix="owned-invalid-head-", dir=self.root)
        with self.assertRaises(ValueError):
            self.fetch("missing-head.git")

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.assertRaises`, `broker.checked_repository`, `broker.RepositoryMirror`, `self.assertEqual`.
    def test_url_and_authorization_scope_reject_escape_before_network(self):
        for path in ("/../secret", "/%2e%2e/secret", "/%2fsecret", "/%252e/secret", "/a//b", "/a;secret", "/%01secret"):
            with self.assertRaises(ValueError):
                broker.checked_repository(self.base + path)
        for url in ("http://example.invalid/repo.git", "https://user:secret@example.invalid/repo.git", self.base + "/repo.git?secret=1", self.base + "/repo.git#secret"):
            with self.assertRaises(ValueError):
                broker.checked_repository(url)
        for endpoint in (Fixture.foreign + "/", self.base + "/private", self.base + "/elsewhere/"):
            with self.assertRaises(ValueError):
                broker.RepositoryMirror(self.base + "/private.git", {"endpoint": endpoint, "authorization": TOKEN}, self.stage)
        self.assertEqual(Fixture.events, [])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `Fixture.events.clear`, `self.mirror`, `self.auth`, `self.assertRaises`.
    def test_redirect_and_reflected_credential_never_reach_client_or_foreign_host(self):
        for repository in ("redirect.git", "error.git"):
            Fixture.events.clear()
            mirror = self.mirror(repository, self.auth())
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.request(mirror, "/info/refs?service=git-upload-pack")
            body = caught.exception.read()
            self.assertEqual(caught.exception.code, 502)
            self.assertNotIn(TOKEN.encode(), body)
            self.assertNotIn(b"Location", body)
            self.assertEqual(len(Fixture.events), 1)
            self.assertTrue(mirror.failed)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.mirror`, `self.auth`, `self.assertRaises`, `self.request`.
    # 设计思路：用显式模型状态和受控适配调用排列边界情景，测试只依据其断言证明相应模型行为，不能外推真实系统权限。
    # Design: Arrange boundary cases with explicit model state and controlled adapters. Assertions establish the corresponding model behavior without attesting real system privileges.
    def test_only_nonce_discovery_and_read_only_upload_pack_can_be_forwarded(self):
        mirror = self.mirror(authentication=self.auth())
        for suffix in ("/info/refs?service=git-receive-pack", "/git-receive-pack", "/objects/aa/bb", "/../private.git/info/refs", "/info/refs?service=git-upload-pack&other=1"):
            with self.assertRaises(urllib.error.HTTPError):
                self.request(mirror, suffix)
        for headers in ({"Authorization": TOKEN}, {"Content-Encoding": "gzip"}):
            with self.assertRaises(urllib.error.HTTPError):
                self.request(mirror, "/info/refs?service=git-upload-pack", headers=headers)
        self.assertEqual(Fixture.events, [])

        # Use a fresh mirror so a previous rejection cannot supply this proof.
        body_mirror = self.mirror(authentication=self.auth())
        self.assertFalse(body_mirror.failed)
        try:
            response = self.request(body_mirror, "/git-upload-pack", b"owned", {"Content-Type": "text/plain"})
        except urllib.error.HTTPError as error:
            self.assertEqual(error.code, 502)
            error.close()
        except ConnectionAbortedError as error:
            # The handler rejects these headers before reading the POST body.
            # Windows may abort that unread-body connection before urllib can
            # parse the 502 status. Only this exact transport outcome is allowed;
            # the server-side rejection and lack of forwarding are still required.
            if os.name != "nt" or getattr(error, "winerror", None) != 10053:
                raise
        else:
            response.close()
            self.fail("invalid upload-pack content type was accepted")
        self.assertTrue(body_mirror.failed)
        self.assertEqual(body_mirror.requests, 0)
        self.assertEqual(body_mirror.total, 0)
        self.assertEqual(Fixture.events, [])

        # Rejection must leave the same listener alive and its independent
        # client authentication intact, without forwarding unauthorized requests.
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request(body_mirror, "/info/refs?service=git-upload-pack",
                         headers={"X-Sakura-Repository-Token": "wrong-local-token"})
        self.assertEqual(caught.exception.code, 403)
        caught.exception.close()
        self.assertEqual(body_mirror.requests, 0)
        self.assertEqual(Fixture.events, [])
        with self.request(body_mirror, "/info/refs?service=git-upload-pack") as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "application/x-git-upload-pack-advertisement")
            self.assertTrue(response.read())
        self.assertEqual(body_mirror.requests, 1)
        self.assertEqual(Fixture.events, [("GET", "/private.git/info/refs?service=git-upload-pack", TOKEN)])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `broker.MAX_INDEX`, `mirror.requests`, `mirror.total`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.mirror`, `self.assertRaises`, `self.request`, `self.assertEqual`.
    # 设计思路：将主体计算与 finally 收尾分开，使返回和异常路径经过相同收尾步骤。
    # Design: Separate body computation from finally-based finalization so return and exception paths share the same finalization step.
    def test_unknown_length_response_and_request_counts_are_bounded(self):
        mirror = self.mirror("oversized.git")
        original = broker.MAX_INDEX
        try:
            broker.MAX_INDEX = 128
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.request(mirror, "/info/refs?service=git-upload-pack")
            self.assertEqual(caught.exception.code, 502)
        finally:
            broker.MAX_INDEX = original
        mirror.requests = broker.MAX_REQUESTS
        with self.assertRaises(ValueError):
            mirror.target("GET", "/" + mirror.nonce + "/info/refs?service=git-upload-pack")
        mirror.total = broker.MAX_TOTAL
        with self.assertRaises(ValueError):
            mirror.charge(1)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.mirror`, `self.auth`, `self.assertRaises`, `urllib.request.urlopen`.
    def test_public_nonce_url_cannot_authorize_other_clients(self):
        mirror = self.mirror(authentication=self.auth())
        for token in (None, mirror.nonce, "wrong-local-token"):
            headers = {} if token is None else {"X-Sakura-Repository-Token": token}
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(urllib.request.Request(mirror.base + "/info/refs?service=git-upload-pack", headers=headers), timeout=5)
            self.assertEqual(caught.exception.code, 403)
        self.assertEqual(Fixture.events, [])
        self.assertFalse(mirror.failed)
        with self.request(mirror, "/info/refs?service=git-upload-pack") as response:
            self.assertEqual(response.status, 200)


if __name__ == "__main__":
    unittest.main()
