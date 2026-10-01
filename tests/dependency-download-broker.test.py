import importlib.util
import json
import os
import posixpath
import sys
import threading
import tempfile
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("dependency_broker", sys.argv.pop(1))
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)


class Fixture(BaseHTTPRequestHandler):
    requests = []
    other = ""

    def log_message(self, *args):
        pass

    def do_GET(self):
        # Model a reverse proxy followed by a second decoding application router.
        routed = posixpath.normpath(urllib.parse.unquote(urllib.parse.unquote(self.path)))
        self.requests.append((routed, self.headers.get("Authorization")))
        if self.path == "/approved/redirect":
            self.send_response(302)
            self.send_header("Location", self.other + "/foreign")
            self.end_headers()
            return
        if self.path == "/approved/escape":
            self.send_response(302)
            self.send_header("Location", "/elsewhere")
            self.end_headers()
            return
        if self.path == "/approved/error":
            self.send_response(403)
            body = b"Bearer owned-secret-must-not-reflect"
        elif self.path == "/approved/@sakura-owned%2fauth-probe":
            self.send_response(200)
            body = json.dumps({"name": "@sakura-owned/auth-probe", "versions": {"1.0.0": {
                "name": "@sakura-owned/auth-probe", "version": "1.0.0", "dist": {
                    "tarball": "/approved/package.tgz"}}}}).encode()
        else:
            self.send_response(200)
            body = b"x" * 8192 if self.path == "/approved/oversized" else b"owned package bytes"
        if self.path != "/approved/oversized":
            self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Type", "application/json" if self.path ==
                         "/approved/@sakura-owned%2fauth-probe" else "application/octet-stream")
        self.end_headers()
        self.wfile.write(body)


class MirrorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        cls.foreign = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        Fixture.other = "http://127.0.0.1:" + str(cls.foreign.server_port)
        cls.endpoint = "http://127.0.0.1:" + str(cls.upstream.server_port) + "/approved/"
        cls.servers = [cls.upstream, cls.foreign]
        cls.threads = []
        for server in cls.servers:
            thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .05})
            thread.start()
            cls.threads.append(thread)

    @classmethod
    def tearDownClass(cls):
        for server, thread in zip(cls.servers, cls.threads):
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def setUp(self):
        Fixture.requests.clear()
        self.scope = broker.AuthorizationScope(self.endpoint, "Bearer owned-secret-must-not-reflect")
        self.mirror = broker.Mirror(self.scope, "pip", os.environ.get("SAKURA_BROKER_TEST_ROOT"))

    def test_scope_pins_scheme_host_port_and_directory(self):
        self.assertTrue(self.scope.contains(self.endpoint + "file.whl"))
        for url in (Fixture.other + "/approved/file.whl", self.endpoint.replace("approved", "approved-other"),
                    self.endpoint.replace("approved/", "elsewhere/")):
            self.assertFalse(self.scope.contains(url))
        for url in ("http://example.invalid/file.whl", self.endpoint + "%2fescape", self.endpoint + "../escape",
                    "https://user:secret@example.invalid/file.whl"):
            with self.assertRaises(ValueError):
                broker.checked_url(url)

    def test_real_requests_authorize_only_the_saved_scope(self):
        with self.mirror.open(self.endpoint + "package.whl") as response:
            self.assertEqual(response.read(), b"owned package bytes")
        with self.mirror.open(Fixture.other + "/public.whl") as response:
            self.assertEqual(response.read(), b"owned package bytes")
        self.assertEqual(Fixture.requests, [("/approved/package.whl", self.scope.authorization), ("/public.whl", None)])

    def test_nested_path_encodings_never_send_auth_to_a_second_decoding_router(self):
        for path in ("%252e%252e/elsewhere/pkg.tgz", "%252felsewhere/pkg.tgz",
                     "%255celsewhere/pkg.tgz", "%25252e%25252e/pkg.tgz",
                     "%01pkg.tgz", "%7fpkg.tgz", "..;/elsewhere/pkg.tgz"):
            with self.assertRaises(ValueError):
                self.mirror.open(self.endpoint + path)
        self.assertEqual(Fixture.requests, [])

    def test_scoped_npm_metadata_preserves_its_one_safe_encoded_name(self):
        self.mirror.manager = "npm"
        proxy = broker.BoundedServer(self.mirror)
        worker = threading.Thread(target=proxy.serve_forever, kwargs={"poll_interval": .05})
        worker.start()
        try:
            url = self.mirror.base + "registry/@sakura-owned%2fauth-probe"
            with urllib.request.urlopen(url) as response:
                metadata = json.load(response)
            self.assertEqual(Fixture.requests, [("/approved/@sakura-owned/auth-probe", self.scope.authorization)])
            self.assertTrue(metadata["versions"]["1.0.0"]["dist"]["tarball"].startswith(
                self.mirror.base + "file/"))
            for path in ("prefix%2f/@sakura-owned%2fauth-probe", "@scope%2f..", "@scope%252fname",
                         "%2f@scope%2fname", "@scope%5cname", "@scope%2f../escape"):
                with self.assertRaises(ValueError):
                    self.mirror.request_url("/" + self.mirror.nonce + "/registry/" + path)
            self.assertEqual(len(Fixture.requests), 1)
        finally:
            proxy.shutdown()
            proxy.server_close()
            worker.join(timeout=2)

    def test_authenticated_redirects_never_reach_another_port_or_path(self):
        for name in ("redirect", "escape"):
            with self.assertRaises(ValueError):
                self.mirror.open(self.endpoint + name)
        self.assertEqual([path for path, _ in Fixture.requests], ["/approved/redirect", "/approved/escape"])

    def test_html_links_hashes_and_metadata_remain_behind_the_mirror(self):
        self.mirror.base = "http://127.0.0.1:1/owned/"
        parser = broker.SimpleIndex(self.mirror, self.endpoint)
        parser.feed('<base href="https://escape.invalid/"><a href="sample-1-py3-none-any.whl#sha256=abc" '
                    'data-requires-python="&gt;=3.8" data-core-metadata="true">wheel</a>')
        result = "".join(parser.parts)
        self.assertNotIn("escape.invalid", result)
        self.assertIn("#sha256=abc", result)
        url = self.mirror.link(self.endpoint + "sample-1-py3-none-any.whl")
        self.mirror.nonce = "owned"
        path = urllib.parse.urlsplit(url).path
        self.assertEqual(self.mirror.request_url(path + ".metadata"), self.endpoint + "sample-1-py3-none-any.whl.metadata")
        with self.assertRaises(ValueError):
            self.mirror.request_url(path.replace("sample-1", "another-1"))

    def test_real_loopback_proxy_omits_upstream_auth_and_error_reflections(self):
        proxy = broker.BoundedServer(self.mirror)
        worker = threading.Thread(target=proxy.serve_forever, kwargs={"poll_interval": .05})
        worker.start()
        try:
            good = self.mirror.link(self.endpoint + "package.whl")
            with urllib.request.urlopen(good) as response:
                self.assertEqual(response.read(), b"owned package bytes")
                self.assertIsNone(response.headers.get("Authorization"))
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(self.mirror.link(self.endpoint + "error"))
            self.assertNotIn(b"owned-secret", caught.exception.read())
            self.assertTrue(self.mirror.rejected)
        finally:
            proxy.shutdown()
            proxy.server_close()
            worker.join(timeout=2)

    def test_cache_metadata_urls_contain_no_credentials(self):
        self.mirror.base = "http://127.0.0.1:1/owned/"
        result = self.mirror.npm_metadata(json.dumps({"versions": {"1": {"dist": {
            "tarball": self.endpoint + "sample.tgz"}}}}).encode(), self.endpoint)
        self.assertNotIn(b"owned-secret", result)
        self.assertIn(b"/owned/file/", result)

    def test_default_registry_locks_use_the_saved_endpoint_and_legacy_locks_refuse_auth(self):
        self.mirror.base = "http://127.0.0.1:1/owned/"
        with tempfile.TemporaryDirectory(dir=os.environ.get("SAKURA_BROKER_TEST_ROOT")) as stage:
            path = os.path.join(stage, "package-lock.json")
            for version in (2, 3):
                with open(path, "w", encoding="utf-8") as target:
                    json.dump({"lockfileVersion": version, "packages": {"node_modules/pkg": {
                        "resolved": "https://registry.npmjs.org/pkg/-/pkg-1.tgz"}}}, target)
                self.mirror.rewrite_lock(stage)
                with open(path, encoding="utf-8") as source:
                    resolved = json.load(source)["packages"]["node_modules/pkg"]["resolved"]
                self.assertTrue(resolved.startswith(self.mirror.base))
                self.assertIn(self.endpoint + "pkg/-/pkg-1.tgz", self.mirror.targets.values())
            with open(path, "w", encoding="utf-8") as target:
                json.dump({"lockfileVersion": 1}, target)
            with self.assertRaises(ValueError):
                self.mirror.rewrite_lock(stage)

    def test_unknown_length_archive_over_budget_exposes_no_partial_body(self):
        previous = broker.MAX_ARCHIVE
        broker.MAX_ARCHIVE = 1024
        proxy = broker.BoundedServer(self.mirror)
        worker = threading.Thread(target=proxy.serve_forever, kwargs={"poll_interval": .05})
        worker.start()
        try:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(self.mirror.link(self.endpoint + "oversized"))
            self.assertEqual(caught.exception.code, 502)
            self.assertNotIn(b"x" * 32, caught.exception.read())
            self.assertTrue(self.mirror.rejected)
        finally:
            proxy.shutdown()
            proxy.server_close()
            worker.join(timeout=2)
            broker.MAX_ARCHIVE = previous


unittest.main()
