"""An ephemeral loopback mirror. Upstream authorization never reaches npm/pip.

Only the separately saved endpoint receives authorization; authenticated redirects
must stay inside that exact origin and path. This runs under isolated system Python.
"""
import base64
import html
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
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

MAX_INDEX = 8 * 1024 * 1024
MAX_ARCHIVE = 256 * 1024 * 1024
MAX_TOTAL = 2 * 1024 * 1024 * 1024
MAX_TARGETS = 8192


def checked_url(value):
    if not isinstance(value, str) or len(value) > 8192 or re.search(r"[\s\x00-\x1f\\]", value):
        raise ValueError("invalid download URL")
    parsed = urllib.parse.urlsplit(value)
    if parsed.username or parsed.password or not parsed.hostname:
        raise ValueError("invalid download URL")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and
                                         parsed.hostname in ("127.0.0.1", "::1", "localhost")):
        raise ValueError("insecure download URL")
    # Never allow a second decoder to discover a new separator or dot segment.
    if re.search(r"%(?:25|5c|00|0a|0d)", parsed.path, re.I):
        raise ValueError("ambiguous download path")
    if re.search(r"%2f", parsed.path, re.I):
        # npm packuments encode the slash in a final, strictly named @scope/name.
        # Preserve that wire URL; no prefix or other path segment gets this exception.
        if len(re.findall(r"%2f", parsed.path, re.I)) != 1 or not re.fullmatch(
                r".*/@[a-z0-9][a-z0-9._-]*%2f[a-z0-9][a-z0-9._-]*", parsed.path, re.I):
            raise ValueError("ambiguous download path")
    decoded = urllib.parse.unquote(parsed.path, errors="strict")
    if re.search(r"[\x00-\x1f\x7f\\;]", decoded):
        raise ValueError("ambiguous download path")
    parts = decoded.split("/")
    if any(part in (".", "..") for part in parts):
        raise ValueError("ambiguous download path")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return parsed, (parsed.scheme, parsed.hostname.lower(), port)


class AuthorizationScope:
    def __init__(self, endpoint, authorization):
        parsed, self.origin = checked_url(endpoint)
        if parsed.query or parsed.fragment or re.search(r"%2f", parsed.path, re.I) or \
           not re.fullmatch(r"(?:Bearer|Basic) [^\x00-\x20\x7f]+", authorization):
            raise ValueError("invalid download credentials")
        self.endpoint = endpoint.rstrip("/") + "/"
        self.path = parsed.path.rstrip("/") + "/"
        self.authorization = authorization

    def contains(self, url):
        parsed, origin = checked_url(url)
        return origin == self.origin and (parsed.path == self.path[:-1] or parsed.path.startswith(self.path))


class ScopedRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 5
    max_repeats = 2

    def __init__(self, scope):
        self.scope = scope

    def redirect_request(self, request, response, code, message, headers, newurl):
        checked_url(newurl)
        authenticated = self.scope.contains(request.full_url)
        if authenticated and not self.scope.contains(newurl):
            raise ValueError("authenticated redirect left its approved scope")
        redirected = super().redirect_request(request, response, code, message, headers, newurl)
        if redirected is not None:
            redirected.remove_header("Authorization")
            if self.scope.contains(newurl):
                redirected.add_unredirected_header("Authorization", self.scope.authorization)
        return redirected


class Mirror:
    def __init__(self, scope, manager, stage=None):
        self.scope, self.manager = scope, manager
        self.stage = stage
        self.lock = threading.Lock()
        self.targets, self.reverse = {}, {}
        self.total = 0
        self.rejected = False
        self.nonce = secrets.token_hex(24)
        self.base = ""
        # Proxy settings are the separately validated instance profile, never project env.
        self.opener = urllib.request.build_opener(ScopedRedirect(scope))

    def charge(self, count):
        with self.lock:
            self.total += count
            if self.total > MAX_TOTAL:
                raise ValueError("download budget exceeded")

    def link(self, url):
        parsed, _ = checked_url(url)
        fragment = parsed.fragment
        url = urllib.parse.urlunsplit(parsed._replace(fragment=""))
        with self.lock:
            key = self.reverse.get(url)
            if key is None:
                if len(self.targets) >= MAX_TARGETS:
                    raise ValueError("too many download targets")
                key = str(len(self.targets) + 1)
                self.targets[key] = url
                self.reverse[url] = key
        filename = urllib.parse.quote(urllib.parse.unquote(parsed.path.rsplit("/", 1)[-1]) or "index", safe="")
        return self.base + "file/" + key + "/" + filename + ("#" + fragment if fragment else "")

    def request_url(self, path):
        incoming = urllib.parse.urlsplit(path)
        prefix = "/" + self.nonce + "/"
        if not incoming.path.startswith(prefix):
            raise ValueError("unknown mirror request")
        relative = incoming.path[len(prefix):]
        if relative.startswith("registry/"):
            url = self.scope.endpoint + relative[len("registry/"):]
            if incoming.query:
                url += "?" + incoming.query
            if not self.scope.contains(url):
                raise ValueError("registry request left its approved scope")
            return url
        match = re.fullmatch(r"file/([0-9]+)/([^/]+)", relative)
        if not match or incoming.query:
            raise ValueError("unknown mirror request")
        with self.lock:
            url = self.targets.get(match[1])
        if not url:
            raise ValueError("unknown mirror request")
        parsed, _ = checked_url(url)
        filename = urllib.parse.quote(urllib.parse.unquote(parsed.path.rsplit("/", 1)[-1]) or "index", safe="")
        # PEP 658 clients derive the metadata sidecar from the wheel URL.
        if match[2] == filename + ".metadata":
            return urllib.parse.urlunsplit(parsed._replace(path=parsed.path + ".metadata"))
        if match[2] != filename:
            raise ValueError("unknown mirror request")
        return url

    def open(self, url):
        checked_url(url)
        request = urllib.request.Request(url, headers={
            "User-Agent": "Sakura-dependency-prefetch/1",
            "Accept": "text/html" if self.manager == "pip" else "application/json, */*",
            "Accept-Encoding": "identity",
        })
        if self.scope.contains(url):
            request.add_unredirected_header("Authorization", self.scope.authorization)
        return self.opener.open(request, timeout=30)

    def npm_metadata(self, data, current):
        obj = json.loads(data)
        def rewrite(value):
            if isinstance(value, dict):
                for key, entry in list(value.items()):
                    if key == "tarball" and isinstance(entry, str):
                        value[key] = self.link(urllib.parse.urljoin(current, entry))
                    else:
                        rewrite(entry)
            elif isinstance(value, list):
                for entry in value:
                    rewrite(entry)
        rewrite(obj)
        return json.dumps(obj, ensure_ascii=False).encode("utf-8")

    def rewrite_lock(self, stage):
        filename = "npm-shrinkwrap.json" if os.path.isfile(os.path.join(stage, "npm-shrinkwrap.json")) else "package-lock.json"
        path = os.path.join(stage, filename)
        with open(path, encoding="utf-8") as source:
            lock = json.load(source)
        # Legacy locks require additional registry metadata that cannot be relied on offline.
        if lock.get("lockfileVersion") not in (2, 3):
            raise ValueError("authenticated npm prefetch requires lockfile version 2 or 3")
        def rewrite(value):
            if isinstance(value, dict):
                for key, entry in list(value.items()):
                    if key == "resolved" and isinstance(entry, str):
                        parsed, origin = checked_url(entry)
                        # npm's official default-registry lock URLs mean the configured registry.
                        if origin == ("https", "registry.npmjs.org", 443):
                            entry = self.scope.endpoint + parsed.path.lstrip("/")
                        value[key] = self.link(entry)
                    else:
                        rewrite(entry)
            elif isinstance(value, list):
                for entry in value:
                    rewrite(entry)
        rewrite(lock)
        with open(path, "w", encoding="utf-8") as target:
            json.dump(lock, target)


class SimpleIndex(HTMLParser):
    def __init__(self, mirror, url):
        super().__init__(convert_charrefs=False)
        self.mirror, self.url, self.parts = mirror, url, []

    def handle_starttag(self, tag, attributes):
        # A base element must not move pip outside the controlled mirror.
        if tag.lower() == "base":
            return
        out = []
        for key, value in attributes:
            if key.lower() == "href" and value is not None:
                value = self.mirror.link(urllib.parse.urljoin(self.url, value))
            out.append(" " + key + ("=\"" + html.escape(value, quote=True) + "\"" if value is not None else ""))
        self.parts.append("<" + tag + "".join(out) + ">")

    def handle_startendtag(self, tag, attributes):
        self.handle_starttag(tag, attributes)

    def handle_endtag(self, tag):
        self.parts.append("</" + tag + ">")

    def handle_data(self, data):
        self.parts.append(data)

    def handle_entityref(self, name):
        self.parts.append("&" + name + ";")

    def handle_charref(self, name):
        self.parts.append("&#" + name + ";")

    def handle_decl(self, declaration):
        self.parts.append("<!" + declaration + ">")


class BoundedServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, mirror):
        self.slots = threading.BoundedSemaphore(8)
        self.mirror = mirror
        super().__init__(("127.0.0.1", 0), Handler)
        mirror.base = "http://127.0.0.1:" + str(self.server_port) + "/" + mirror.nonce + "/"

    def process_request(self, request, address):
        if not self.slots.acquire(False):
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
        pass  # No upstream URL, response body or credential-bearing traceback in logs.


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        sent = False
        try:
            self.connection.settimeout(35)
            mirror = self.server.mirror
            url = mirror.request_url(self.path)
            with mirror.open(url) as response:
                content_type = response.headers.get_content_type()
                index = content_type in ("text/html", "application/json") or content_type.endswith("+json")
                limit = MAX_INDEX if index else MAX_ARCHIVE
                length = response.headers.get("Content-Length")
                if length is not None and (not length.isdigit() or int(length) > limit):
                    raise ValueError("response too large")
                if index:
                    data = response.read(limit + 1)
                    if len(data) > limit:
                        raise ValueError("index too large")
                    mirror.charge(len(data))
                    current = response.geturl()
                    if mirror.manager == "pip":
                        if content_type != "text/html":
                            raise ValueError("package index must support the HTML simple API")
                        parser = SimpleIndex(mirror, current)
                        parser.feed(data.decode("utf-8"))
                        data = "".join(parser.parts).encode("utf-8")
                    else:
                        data = mirror.npm_metadata(data, current)
                    if len(data) > MAX_INDEX:
                        raise ValueError("rewritten index too large")
                    self.send_response(200)
                    self.send_header("Content-Type", content_type + "; charset=utf-8")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    sent = True
                    self.wfile.write(data)
                else:
                    # Complete and check an unknown-length archive before exposing any
                    # prefix to the package manager or its persistent cache.
                    with tempfile.TemporaryFile(dir=mirror.stage) as archive:
                        count = 0
                        while True:
                            chunk = response.read(65536)
                            if not chunk:
                                break
                            count += len(chunk)
                            if count > limit:
                                raise ValueError("archive too large")
                            mirror.charge(len(chunk))
                            archive.write(chunk)
                        if length is not None and count != int(length):
                            raise ValueError("incomplete archive")
                        archive.seek(0)
                        self.send_response(200)
                        self.send_header("Content-Type", "application/octet-stream")
                        self.send_header("Content-Length", str(count))
                        self.end_headers()
                        sent = True
                        while True:
                            chunk = archive.read(65536)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
        except urllib.error.HTTPError as error:
            if error.code not in (404, 410):
                self.server.mirror.rejected = True
            if not sent:
                self.send_error(error.code, "Dependency mirror upstream request failed")
        except Exception:
            self.server.mirror.rejected = True
            if not sent:
                # Do not forward an error body's reflected credentials, cookies or Location.
                self.send_error(502, "Dependency mirror rejected the upstream response")
        finally:
            self.close_connection = True


def load_credentials(path):
    parent = os.lstat(os.path.dirname(path))
    info = os.lstat(path)
    if not stat.S_ISDIR(parent.st_mode) or parent.st_mode & 0o077 or parent.st_uid != 0 or \
       not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != 0 or info.st_size > 16384:
        raise ValueError("unprotected credential file")
    with open(path, encoding="utf-8") as source:
        value = json.load(source)
    os.unlink(path)
    return AuthorizationScope(value["endpoint"], value["authorization"])


def main():
    credential, manager, stage, cache = sys.argv[1:]
    scope = load_credentials(credential)
    if manager not in ("npm", "pip"):
        raise ValueError("unknown dependency manager")
    mirror = Mirror(scope, manager, stage)
    server = BoundedServer(mirror)
    worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
    worker.start()
    try:
        environment = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                       "HOME": os.path.join(stage, "home"), "PIP_CONFIG_FILE": "/dev/null"}
        if manager == "npm":
            mirror.rewrite_lock(stage)
            command = ["npm", "ci", "--ignore-scripts", "--cache", cache, "--prefer-online",
                       "--no-audit", "--no-fund", "--logs-max=0", "--registry", mirror.base + "registry/",
                       "--userconfig", os.path.join(stage, "user.npmrc"),
                       "--globalconfig", os.path.join(stage, "global.npmrc")]
        else:
            command = [sys.executable, "-I", "-m", "pip", "--isolated", "download", "--no-input",
                       "--no-cache-dir", "--disable-pip-version-check", "--only-binary=:all:",
                       "--index-url", mirror.base + "registry/", "-r", os.path.join(stage, "requirements.txt"),
                       "-d", cache]
        result = subprocess.call(command, cwd=stage, env=environment)
        return result if result != 0 else (2 if mirror.rejected else 0)
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("认证依赖预取失败；请核对下载端点、凭证、锁文件版本和二进制包支持", file=sys.stderr)
        sys.exit(2)
