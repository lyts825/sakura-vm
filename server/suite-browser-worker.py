"""Fixed Chromium/CDP browser checks inside a dedicated, network-isolated VM."""
import base64
import datetime
import hashlib
import http.server
import json
import os
import pathlib
import platform
import secrets
import select
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request


LIMIT = 8 * 1024 * 1024


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def digest(value):
    return hashlib.sha256(value).hexdigest()


class CDP:
    def __init__(self, url, deadline, origin):
        parsed = urllib.parse.urlsplit(url)
        if parsed.hostname not in ("127.0.0.1", "localhost"):
            raise RuntimeError("CDP_LOCAL_ONLY")
        self.deadline, self.origin = deadline, origin
        self.socket = socket.create_connection(("127.0.0.1", parsed.port), timeout=5)
        self.socket.settimeout(2)
        self.sequence, self.waiting, self.blocked = 0, {}, []
        nonce = base64.b64encode(secrets.token_bytes(16)).decode()
        request = (f"GET {parsed.path} HTTP/1.1\r\nHost: 127.0.0.1:{parsed.port}\r\n"
                   f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {nonce}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.socket.sendall(request.encode())
        header = bytearray()
        while not header.endswith(b"\r\n\r\n"):
            header.extend(self.socket.recv(1))
            if len(header) > 16384:
                raise RuntimeError("CDP_HANDSHAKE_LIMIT")
        if not bytes(header).startswith(b"HTTP/1.1 101"):
            raise RuntimeError("CDP_HANDSHAKE_FAILED")
        expected = base64.b64encode(hashlib.sha1((nonce + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        if expected.lower() not in bytes(header).lower():
            raise RuntimeError("CDP_HANDSHAKE_IDENTITY")

    def read_exact(self, length):
        if length > LIMIT:
            raise RuntimeError("CDP_FRAME_LIMIT")
        data = bytearray()
        while len(data) < length:
            if time.time() >= self.deadline:
                raise TimeoutError("BROWSER_DEADLINE")
            try:
                part = self.socket.recv(length - len(data))
            except socket.timeout:
                continue
            if not part:
                raise RuntimeError("BROWSER_DISCONNECTED")
            data.extend(part)
        return bytes(data)

    def send(self, payload, opcode=1):
        data = json.dumps(payload, separators=(",", ":")).encode() if not isinstance(payload, bytes) else payload
        if len(data) > LIMIT:
            raise RuntimeError("CDP_INPUT_LIMIT")
        mask = secrets.token_bytes(4)
        head = bytes((0x80 | opcode,))
        if len(data) < 126:
            head += bytes((0x80 | len(data),))
        elif len(data) < 65536:
            head += bytes((0x80 | 126,)) + struct.pack("!H", len(data))
        else:
            head += bytes((0x80 | 127,)) + struct.pack("!Q", len(data))
        self.socket.sendall(head + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(data)))

    def message(self):
        parts = bytearray()
        while True:
            first, second = self.read_exact(2)
            length = second & 127
            if length == 126:
                length = struct.unpack("!H", self.read_exact(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self.read_exact(8))[0]
            mask = self.read_exact(4) if second & 128 else None
            data = self.read_exact(length)
            if mask:
                data = bytes(value ^ mask[index % 4] for index, value in enumerate(data))
            opcode = first & 15
            if opcode == 8:
                raise RuntimeError("BROWSER_DISCONNECTED")
            if opcode == 9:
                self.send(data, 10)
                continue
            if opcode not in (0, 1):
                continue
            parts.extend(data)
            if len(parts) > LIMIT:
                raise RuntimeError("CDP_MESSAGE_LIMIT")
            if first & 128:
                return json.loads(parts)

    def dispatch(self, method, params=None):
        self.sequence += 1
        self.send({"id": self.sequence, "method": method, "params": params or {}})
        return self.sequence

    def call(self, method, params=None):
        request = self.dispatch(method, params)
        while request not in self.waiting:
            message = self.message()
            if "id" in message:
                self.waiting[message["id"]] = message
            elif message.get("method") == "Fetch.requestPaused":
                event = message["params"]
                url = event["request"]["url"]
                parsed = urllib.parse.urlsplit(url)
                permitted = f"{parsed.scheme}://{parsed.netloc}" == self.origin and parsed.scheme == "http"
                if permitted:
                    self.dispatch("Fetch.continueRequest", {"requestId": event["requestId"]})
                else:
                    if len(self.blocked) < 100:
                        self.blocked.append(url[:2048])
                    self.dispatch("Fetch.failRequest", {"requestId": event["requestId"], "errorReason": "BlockedByClient"})
            if len(self.waiting) > 1000:
                raise RuntimeError("CDP_PENDING_LIMIT")
        result = self.waiting.pop(request)
        if "error" in result:
            raise RuntimeError("CDP_" + str(result["error"].get("code", "FAILED")))
        return result.get("result", {})

    def evaluate(self, expression):
        result = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True, "timeout": 10000})
        if "exceptionDetails" in result:
            raise RuntimeError("BROWSER_EVALUATION_FAILED")
        return result.get("result", {}).get("value")

    def close(self):
        self.socket.close()


def font_digest():
    result, count, size = hashlib.sha256(), 0, 0
    for directory, dirs, files in os.walk("/usr/share/fonts", followlinks=False):
        dirs.sort()
        for name in sorted(files):
            path = pathlib.Path(directory, name)
            if path.is_symlink() or not path.is_file():
                continue
            size += path.stat().st_size
            count += 1
            if count > 512 or size > 64 * 1024 * 1024:
                raise RuntimeError("FONT_BUDGET")
            result.update(str(path).encode())
            result.update(path.read_bytes())
    if not count:
        raise RuntimeError("FONTS_NOT_PREPARED")
    return result.hexdigest()


def run(envelope):
    deadline = min(datetime.datetime.fromisoformat(envelope["deadline"].replace("Z", "+00:00")).timestamp(), time.time() + 900)
    manifest = envelope["input"]
    if manifest.get("protocol") != "sakura-browser-tool/1":
        raise RuntimeError("BROWSER_PROTOCOL")
    chromium = shutil.which("chromium-browser") or shutil.which("chromium")
    if not chromium:
        raise RuntimeError("CHROMIUM_NOT_PREPARED")
    version = subprocess.check_output([chromium, "--version"], timeout=10).decode().strip()[:100]
    result = {"protocol": "sakura-browser-tool/1", "browserVersion": version, "fontDigest": font_digest(),
              "platform": platform.system() + "/" + platform.machine(), "observations": [], "screenshots": [],
              "accessibility": [], "accessibilityTruncated": False, "blockedRequests": [], "completed": False, "error": None}
    site = manifest["site"]
    content, total = {}, 0
    for item in site["files"]:
        path = item["path"]
        parts = pathlib.PurePosixPath(path).parts
        if path.startswith("/") or ".." in parts or "\\" in path or "\x00" in path or path in content:
            raise RuntimeError("SITE_PATH")
        data = item["data"].encode() if item["encoding"] == "utf8" else base64.b64decode(item["data"], validate=True)
        total += len(data)
        if total > 8 * 1024 * 1024 or len(content) >= 100:
            raise RuntimeError("SITE_BUDGET")
        content[path] = data
    if site["entry"] not in content:
        raise RuntimeError("SITE_ENTRY")

    class SiteHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).lstrip("/") or site["entry"]
            value = content.get(path)
            if value is None:
                self.send_error(404)
                return
            extension = path.rsplit(".", 1)[-1].lower()
            mime = {"html": "text/html", "htm": "text/html", "css": "text/css", "js": "text/javascript", "json": "application/json", "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "woff": "font/woff", "woff2": "font/woff2"}.get(extension, "text/plain")
            self.send_response(200)
            self.send_header("Content-Type", mime + ("; charset=utf-8" if mime.startswith("text/") else ""))
            self.send_header("Content-Length", str(len(value)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                self.wfile.write(value)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SiteHandler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    # Chromium uses Unix sockets below TMPDIR; the guardian workspace path can exceed sun_path.
    temporary = tempfile.TemporaryDirectory(prefix="sb-", dir="/tmp")
    process, cdp = None, None
    try:
        viewport = manifest["journey"]["viewport"]
        args = [chromium, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--disable-breakpad", "--block-new-web-contents", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--user-data-dir=" + temporary.name, "--window-size=" + str(viewport["width"]) + "," + str(viewport["height"]), "about:blank"]
        environment = dict(os.environ, HOME=temporary.name, TMPDIR=temporary.name)
        diagnostics = bytearray()
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=True, env=environment)
        def drain_diagnostics():
            while True:
                block = process.stderr.read(4096)
                if not block:
                    break
                if len(diagnostics) < 65536:
                    diagnostics.extend(block[:65536-len(diagnostics)])
        threading.Thread(target=drain_diagnostics, daemon=True).start()
        port_file = pathlib.Path(temporary.name, "DevToolsActivePort")
        startup = min(deadline, time.time() + 20)
        while not port_file.exists():
            if process.poll() is not None or time.time() > startup:
                raise RuntimeError("BROWSER_START_FAILED: " + diagnostics.decode("utf-8", errors="replace")[-800:])
            time.sleep(0.05)
        port = int(port_file.read_text().splitlines()[0])
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{port}/json/list", timeout=5) as response:
            pages = json.loads(response.read(65536))
        page = next(item for item in pages if item["type"] == "page")
        cdp = CDP(page["webSocketDebuggerUrl"], deadline, origin)
        cdp.call("Page.enable")
        cdp.call("Network.enable")
        cdp.call("Network.setBypassServiceWorker", {"bypass": True})
        cdp.call("Fetch.enable", {"patterns": [{"urlPattern": "*"}]})
        cdp.call("Emulation.setDeviceMetricsOverride", {"width": viewport["width"], "height": viewport["height"], "deviceScaleFactor": 1, "mobile": False})
        cdp.call("Emulation.setTimezoneOverride", {"timezoneId": manifest["journey"]["timezone"]})
        for cookie in manifest["fixture"]["cookies"]:
            cdp.call("Network.setCookie", {**cookie, "url": origin, "sameSite": "Strict"})
        storage = json.dumps(manifest["fixture"]["localStorage"])
        # This source is fixed tool code; user values are JSON string literals.
        cdp.call("Page.addScriptToEvaluateOnNewDocument", {"source": "if(location.origin===" + json.dumps(origin) + "){for(const [k,v] of Object.entries(" + storage + "))localStorage.setItem(k,v);}"})
        cdp.call("Page.navigate", {"url": origin + "/" + site["entry"]})
        page_ready = min(deadline, time.time() + 10)
        while cdp.evaluate("document.readyState") not in ("interactive", "complete"):
            if time.time() >= page_ready:
                raise TimeoutError("SITE_LOAD_TIMEOUT")
            time.sleep(0.05)
        journal = pathlib.Path(temporary.name, "intents.jsonl")
        def screenshot(index):
            if len(result["screenshots"]) >= 10 or any(shot["step"] == index for shot in result["screenshots"]):
                return
            shot = cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})["data"]
            raw = base64.b64decode(shot, validate=True)
            if len(raw) > 4 * 1024 * 1024 or len(raw) < 24 or raw[:8] != b"\x89PNG\r\n\x1a\n":
                raise RuntimeError("SCREENSHOT_BUDGET")
            width, height = struct.unpack("!II", raw[16:24])
            if width != viewport["width"] or height != viewport["height"]:
                raise RuntimeError("SCREENSHOT_DIMENSIONS")
            if len(canonical(result).encode()) + len(shot) > LIMIT - 512 * 1024:
                raise RuntimeError("OUTPUT_BUDGET")
            result["screenshots"].append({"step": index, "data": shot, "digest": digest(raw), "width": width, "height": height})
        for index, step in enumerate(manifest["journey"]["steps"]):
            if time.time() >= deadline:
                raise TimeoutError("BROWSER_DEADLINE")
            start = time.monotonic()
            observation = {"sequence": index, "name": step["name"], "action": step["action"], "status": "completed", "elapsedMs": 0, "url": "", "domDigest": digest(b""), "error": None, "assertions": []}
            try:
                if "when" in step:
                    condition = step["when"]
                    exists = cdp.evaluate("!!document.querySelector(" + json.dumps(condition["selector"]) + ")")
                    if exists != condition["exists"]:
                        observation["status"] = "skipped"
                if observation["status"] != "skipped":
                    with journal.open("a", encoding="utf-8") as log:
                        log.write(canonical({"sessionId": envelope["sessionId"], "sequence": index, "action": step["action"], "phase": "intent"}) + "\n")
                        log.flush()
                        os.fsync(log.fileno())
                    action = step["action"]
                    selector = json.dumps(step.get("selector", ""))
                    element = "document.querySelector(" + selector + ")"
                    if action == "navigate":
                        if step["path"] not in content:
                            raise RuntimeError("SITE_PATH_NOT_FOUND")
                        cdp.call("Page.navigate", {"url": origin + "/" + step["path"]})
                    elif action == "click":
                        rectangle = cdp.evaluate("(()=>{const e=" + element + ";if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()")
                        if not rectangle or rectangle["w"] <= 0 or rectangle["h"] <= 0:
                            raise RuntimeError("ELEMENT_NOT_VISIBLE")
                        for kind in ("mousePressed", "mouseReleased"):
                            cdp.call("Input.dispatchMouseEvent", {"type": kind, "x": rectangle["x"], "y": rectangle["y"], "button": "left", "clickCount": 1})
                    elif action in ("fill", "select"):
                        value = step["value"]
                        for key, substitution in manifest["fixture"]["fields"].items():
                            value = value.replace("{{" + key + "}}", substitution)
                        if not cdp.evaluate("(()=>{const e=" + element + ";if(!e)return false;e.focus();const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e," + json.dumps(value) + ");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()"):
                            raise RuntimeError("ELEMENT_NOT_FOUND")
                    elif action == "wait":
                        until = min(deadline, time.time() + step["timeoutMs"] / 1000)
                        while not cdp.evaluate("!!" + element):
                            if time.time() >= until:
                                raise TimeoutError("ELEMENT_WAIT_TIMEOUT")
                            time.sleep(0.05)
                    elif action == "screenshot":
                        screenshot(index)
                    else:
                        raise RuntimeError("UNKNOWN_BROWSER_ACTION")
                    for rule_index, rule in enumerate(manifest["journey"]["assertions"]):
                        if rule["step"] != index:
                            continue
                        node = "document.querySelector(" + json.dumps(rule.get("selector", "")) + ")"
                        expression = {"url": "location.pathname+location.search+location.hash", "element": "!!" + node,
                                      "text": "(" + node + ")?.textContent??''", "value": "(" + node + ")?.value??''"}[rule["kind"]]
                        actual = cdp.evaluate(expression)
                        actual = ("true" if actual else "false") if isinstance(actual, bool) else str(actual or "")
                        if len(actual) > 4000:
                            raise RuntimeError("ASSERTION_OUTPUT_LIMIT")
                        compare, expected = rule["comparison"], rule["expected"]
                        passed = actual == expected if compare == "equals" else expected in actual if compare == "contains" else actual in ("", "false")
                        observation["assertions"].append({"index": rule_index, "actual": actual, "passed": passed})
                location = cdp.evaluate("location.pathname+location.search+location.hash")
                dom = cdp.evaluate("document.documentElement.outerHTML")
                if len(dom.encode()) > 1024 * 1024:
                    raise RuntimeError("DOM_BUDGET")
                observation["url"], observation["domDigest"] = location[:2048], digest(dom.encode())
            except Exception as error:
                observation["status"], observation["error"] = "failed", str(error)[:1000]
                try:
                    screenshot(index)
                except Exception as capture_error:
                    observation["error"] = (observation["error"] + "; screenshot: " + str(capture_error))[:1000]
            observation["elapsedMs"] = (time.monotonic() - start) * 1000
            result["observations"].append(observation)
            if observation["status"] == "failed":
                break
        # Fixed DOM rules expose their limited coverage and leave a separate human review.
        findings = cdp.evaluate("""(()=>{const r=[];if(!document.title.trim())r.push({rule:'document-title',node:'document',message:'文档标题为空'});for(const e of document.querySelectorAll('img'))if(!e.getAttribute('alt')?.trim()&&!e.getAttribute('aria-label')?.trim())r.push({rule:'image-name',node:e.id||'img',message:'图片缺少文本替代'});for(const e of document.querySelectorAll('button,input,select,textarea'))if(e.type!=='hidden'&&!e.getAttribute('aria-label')?.trim()&&!e.textContent?.trim()&&!e.labels?.length&&!e.getAttribute('title')?.trim())r.push({rule:'control-name',node:e.id||e.tagName,message:'控件缺少可核对的名称'});let p=0;for(const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6')){const n=Number(e.tagName[1]);if(n>p+1)r.push({rule:'heading-order',node:e.id||e.tagName,message:'标题层级跳跃'});p=n;}return {items:r.slice(0,1000),truncated:r.length>1000}})()""")
        chosen = manifest["journey"]["accessibility"]
        result["accessibility"] = [{**finding, "node": finding["node"][:300]} for finding in findings["items"] if finding["rule"] in chosen]
        result["accessibilityTruncated"] = findings["truncated"]
        result["completed"] = len(result["observations"]) == len(manifest["journey"]["steps"]) and all(item["status"] in ("completed", "skipped") for item in result["observations"])
    except Exception as error:
        result["error"] = str(error)[:1000]
    finally:
        if cdp:
            result["blockedRequests"] = cdp.blocked
            cdp.close()
        if process:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
        server.shutdown()
        server.server_close()
        temporary.cleanup()
    return result


if __name__ == "__main__":
    raw = sys.stdin.buffer.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise RuntimeError("BROWSER_INPUT_LIMIT")
    output = canonical(run(json.loads(raw))).encode()
    if len(output) > LIMIT:
        raise RuntimeError("BROWSER_OUTPUT_LIMIT")
    sys.stdout.buffer.write(output)
    sys.stdout.buffer.flush()
