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

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.respond("GET")

    def do_POST(self):
        self.respond("POST")

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

    @classmethod
    def git(cls, *args):
        result = subprocess.run([GIT, "-c", "core.hooksPath=" + os.devnull] + list(args), stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}, timeout=20)
        if result.returncode:
            raise AssertionError(result.stderr.decode(errors="replace"))
        return result.stdout.decode().strip()

    @classmethod
    def tearDownClass(cls):
        for server, thread in zip(cls.servers, cls.threads):
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        cls.temporary.cleanup()

    def setUp(self):
        Fixture.events.clear()
        self.stage = tempfile.mkdtemp(prefix="owned-stage-", dir=self.root)

    def auth(self, authorization=TOKEN):
        return {"endpoint": self.base + "/", "authorization": authorization}

    def fetch(self, name="private.git", authentication=None):
        return broker.fetch_repository(self.stage, self.base + "/" + name, authentication, GIT)

    def mirror(self, repository="private.git", authentication=None):
        mirror = broker.RepositoryMirror(self.base + "/" + repository, authentication, self.stage)
        server = broker.BoundedServer(mirror)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .05}, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(), thread.join(timeout=2)))
        return mirror

    def request(self, mirror, suffix, body=None, headers=None):
        return urllib.request.urlopen(urllib.request.Request(mirror.base + suffix, data=body,
            headers={"X-Sakura-Repository-Token": mirror.client_token, **(headers or {})}), timeout=5)

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

    def test_basic_and_public_downloads_use_only_selected_authorization(self):
        result = self.fetch(authentication=self.auth("Basic cmVhZGVyOnNlY3JldA=="))
        self.assertEqual(result["commit"], self.commit)
        self.assertTrue(all(auth == "Basic cmVhZGVyOnNlY3JldA==" for _, _, auth in Fixture.events))
        Fixture.events.clear()
        self.stage = tempfile.mkdtemp(prefix="owned-public-", dir=self.root)
        self.fetch("public.git")
        self.assertTrue(all(auth is None for _, _, auth in Fixture.events))

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

    def test_empty_repository_and_missing_remote_head_are_distinct(self):
        empty = self.fetch("empty.git")
        self.assertEqual(empty["head"], "refs/heads/main")
        self.assertIsNone(empty["commit"])
        self.assertIsNone(empty["bundleSha256"])
        self.assertEqual(empty["bundleBytes"], 0)
        self.stage = tempfile.mkdtemp(prefix="owned-invalid-head-", dir=self.root)
        with self.assertRaises(ValueError):
            self.fetch("missing-head.git")

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

    def test_only_nonce_discovery_and_read_only_upload_pack_can_be_forwarded(self):
        mirror = self.mirror(authentication=self.auth())
        for suffix in ("/info/refs?service=git-receive-pack", "/git-receive-pack", "/objects/aa/bb", "/../private.git/info/refs", "/info/refs?service=git-upload-pack&other=1"):
            with self.assertRaises(urllib.error.HTTPError):
                self.request(mirror, suffix)
        for headers in ({"Authorization": TOKEN}, {"Content-Encoding": "gzip"}):
            with self.assertRaises(urllib.error.HTTPError):
                self.request(mirror, "/info/refs?service=git-upload-pack", headers=headers)
        with self.assertRaises(urllib.error.HTTPError):
            self.request(mirror, "/git-upload-pack", b"owned", {"Content-Type": "text/plain"})
        self.assertEqual(Fixture.events, [])

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
