# 模块职责：在受限下载端点内代理认证依赖预取，校验 URL 与重定向范围并限制服务并发。
# Module purpose: Proxies authenticated dependency prefetch within approved endpoints, checking URL/redirect scope and bounding concurrency.
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


# 入口 / Entry: checked_url.
# 功能：统一验证依赖下载 URL、HTTPS/loopback 例外和编码路径，返回解析值及准确 origin。
# Purpose: Validates dependency URLs, HTTPS/loopback exceptions and encoded paths, returning the parsed URL and exact origin.
# 输入 / Inputs: value
# 输出 / Returns: `(parsed, (parsed.scheme, parsed.hostname.lower(), port))`
# 拒绝 / Refusals: `ValueError('invalid download URL')`; `ValueError('insecure download URL')`; `ValueError('ambiguous download path')`.
def checked_url(value):
    if not isinstance(value, str) or len(value) > 8192 or re.search(r"[\s\x00-\x1f\\]", value):
        raise ValueError("invalid download URL")
    parsed = urllib.parse.urlsplit(value)
    if parsed.username or parsed.password or not parsed.hostname:
        raise ValueError("invalid download URL")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and
                                         parsed.hostname in ("127.0.0.1", "::1", "localhost")):
        raise ValueError("insecure download URL")
    # 禁止二次解码产生新的分隔符或点路径，确保校验方与下载端看到同一范围。
    if re.search(r"%(?:25|5c|00|0a|0d)", parsed.path, re.I):
        raise ValueError("ambiguous download path")
    if re.search(r"%2f", parsed.path, re.I):
        # npm scoped 包只在末尾 @scope/name 中允许一个编码斜线，其他路径段不享有此例外。
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
    # 入口 / Entry: AuthorizationScope.__init__.
    # 功能：固定单独保存的认证 origin、路径边界及 Bearer/Basic 头，不从项目配置取得凭证。
    # Purpose: Pins separately saved authorization origin/path boundaries and Bearer/Basic header without taking credentials from project configuration.
    # 输入 / Inputs: endpoint; authorization
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 更新 / updates `self.endpoint`, `self.path`, `self.authorization`.
    # 拒绝 / Refusals: `ValueError('invalid download credentials')`.
    def __init__(self, endpoint, authorization):
        parsed, self.origin = checked_url(endpoint)
        if parsed.query or parsed.fragment or re.search(r"%2f", parsed.path, re.I) or \
           not re.fullmatch(r"(?:Bearer|Basic) [^\x00-\x20\x7f]+", authorization):
            raise ValueError("invalid download credentials")
        self.endpoint = endpoint.rstrip("/") + "/"
        self.path = parsed.path.rstrip("/") + "/"
        self.authorization = authorization

    # 凭证范围同时包含准确 origin 和路径边界，不能以相同主机但不同仓库替代。
    # 入口 / Entry: AuthorizationScope.contains.
    # 功能：同时比对准确 origin 和路径边界，判断目标能否接收当前下载凭证。
    # Purpose: Compares exact origin and path boundaries to decide whether a target may receive current download credentials.
    # 输入 / Inputs: url
    # 输出 / Returns: `origin == self.origin and (parsed.path == self.path[:-1] or parsed.path.startswith(self.path))`
    def contains(self, url):
        parsed, origin = checked_url(url)
        return origin == self.origin and (parsed.path == self.path[:-1] or parsed.path.startswith(self.path))


class ScopedRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 5
    max_repeats = 2

    # 入口 / Entry: ScopedRedirect.__init__.
    # 功能：绑定重定向处理器使用的已核定认证范围。
    # Purpose: Binds the approved authorization scope used by the redirect handler.
    # 输入 / Inputs: scope
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 更新 / updates `self.scope`.
    def __init__(self, scope):
        self.scope = scope

    # 入口 / Entry: ScopedRedirect.redirect_request.
    # 功能：验证重定向目标，拒绝认证请求越界并去掉继承头后按目标范围重建认证。
    # Purpose: Validates redirects, rejects authenticated scope escape and rebuilds authorization by target scope after removing inherited headers.
    # 输入 / Inputs: request; response; code; message; headers; newurl
    # 输出 / Returns: `redirected`
    # 副作用 / Effects: 调用 / calls `redirected.add_unredirected_header`.
    # 拒绝 / Refusals: `ValueError('authenticated redirect left its approved scope')`.
    def redirect_request(self, request, response, code, message, headers, newurl):
        checked_url(newurl)
        authenticated = self.scope.contains(request.full_url)
        if authenticated and not self.scope.contains(newurl):
            raise ValueError("authenticated redirect left its approved scope")
        # 重定向后去掉继承的认证头，再仅为核定范围内的目标重新附加。
        redirected = super().redirect_request(request, response, code, message, headers, newurl)
        if redirected is not None:
            redirected.remove_header("Authorization")
            if self.scope.contains(newurl):
                redirected.add_unredirected_header("Authorization", self.scope.authorization)
        return redirected


class Mirror:
    # 入口 / Entry: Mirror.__init__.
    # 功能：初始化临时 loopback 镜像、随机入口和并发字节/目标计数，使用受控代理配置创建上游 opener。
    # Purpose: Initializes the ephemeral loopback mirror, nonce entry and synchronized byte/target counters, creating an upstream opener with controlled proxy configuration.
    # 输入 / Inputs: scope; manager; stage=None
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `threading.Lock`, `urllib.request.build_opener`; 更新 / updates `self.stage`, `self.lock`, `self.total`, `self.rejected`.
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

    # 入口 / Entry: Mirror.charge.
    # 功能：在互斥锁内累加下载字节，超过总会话预算立即拒绝。
    # Purpose: Accumulates downloaded bytes under the mutex and rejects immediately beyond the total session budget.
    # 输入 / Inputs: count
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 更新 / updates `self.total`.
    # 拒绝 / Refusals: `ValueError('download budget exceeded')`.
    def charge(self, count):
        with self.lock:
            self.total += count
            if self.total > MAX_TOTAL:
                raise ValueError("download budget exceeded")

    # 入口 / Entry: Mirror.link.
    # 功能：把核验过的上游 URL 登记成随机入口下的受限本地文件链接，保留片段校验信息。
    # Purpose: Registers a checked upstream URL as a bounded local file link under the nonce entry, preserving fragment verification metadata.
    # 输入 / Inputs: url
    # 输出 / Returns: `self.base + 'file/' + key + '/' + filename + ('#' + fragment if fragment else '')`
    # 副作用 / Effects: 调用 / calls `parsed._replace`; 更新 / updates `self.targets[key]`, `self.reverse[url]`.
    # 拒绝 / Refusals: `ValueError('too many download targets')`.
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

    # 入口 / Entry: Mirror.request_url.
    # 功能：把本地随机路径映射回已登记下载目标或认证 registry，拒绝路径、查询及文件名错配。
    # Purpose: Maps local nonce paths back to registered download targets or the approved registry, refusing path/query/filename mismatches.
    # 输入 / Inputs: path
    # 输出 / Returns: `url`; `urllib.parse.urlunsplit(parsed._replace(path=parsed.path + '.metadata'))`
    # 副作用 / Effects: 调用 / calls `parsed._replace`.
    # 拒绝 / Refusals: `ValueError('unknown mirror request')`; `ValueError('registry request left its approved scope')`.
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

    # 入口 / Entry: Mirror.open.
    # 功能：以固定请求头打开已核验 URL，仅在准确认证范围内附加授权头。
    # Purpose: Opens a checked URL with fixed headers, adding authorization only within the exact approved scope.
    # 输入 / Inputs: url
    # 输出 / Returns: `self.opener.open(request, timeout=30)`
    # 副作用 / Effects: 调用 / calls `request.add_unredirected_header`, `self.opener.open`.
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

    # 入口 / Entry: Mirror.npm_metadata.
    # 功能：递归把 npm 元数据中的 tarball 链接改写到受控镜像并返回 UTF-8 JSON。
    # Purpose: Recursively rewrites tarball links in npm metadata to the controlled mirror and returns UTF-8 JSON.
    # 输入 / Inputs: data; current
    # 输出 / Returns: `json.dumps(obj, ensure_ascii=False).encode('utf-8')`
    # 副作用 / Effects: 调用 / calls `rewrite`.
    def npm_metadata(self, data, current):
        obj = json.loads(data)
        # 入口 / Entry: Mirror.npm_metadata.rewrite.
        # 功能：递归访问当前 JSON 字典和列表，按所属元数据或锁文件流程改写下载链接。
        # Purpose: Recursively visits the current JSON dictionaries/lists to rewrite download links for the enclosing metadata or lockfile flow.
        # 输入 / Inputs: value
        # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
        # 副作用 / Effects: 调用 / calls `rewrite`; 更新 / updates `value[key]`.
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

    # 入口 / Entry: Mirror.rewrite_lock.
    # 功能：只对 npm v2/v3 锁文件改写 resolved 下载目标，官方 registry 地址按已配置 registry 映射。
    # Purpose: Rewrites resolved download targets only in npm v2/v3 lockfiles, mapping official-registry addresses to the configured registry.
    # 输入 / Inputs: stage
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `open`, `lock.get`, `rewrite`.
    # 拒绝 / Refusals: `ValueError('authenticated npm prefetch requires lockfile version 2 or 3')`.
    def rewrite_lock(self, stage):
        filename = "npm-shrinkwrap.json" if os.path.isfile(os.path.join(stage, "npm-shrinkwrap.json")) else "package-lock.json"
        path = os.path.join(stage, filename)
        with open(path, encoding="utf-8") as source:
            lock = json.load(source)
        # Legacy locks require additional registry metadata that cannot be relied on offline.
        if lock.get("lockfileVersion") not in (2, 3):
            raise ValueError("authenticated npm prefetch requires lockfile version 2 or 3")
        # 入口 / Entry: Mirror.rewrite_lock.rewrite.
        # 功能：递归访问当前 JSON 字典和列表，按所属元数据或锁文件流程改写下载链接。
        # Purpose: Recursively visits the current JSON dictionaries/lists to rewrite download links for the enclosing metadata or lockfile flow.
        # 输入 / Inputs: value
        # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
        # 副作用 / Effects: 调用 / calls `rewrite`; 更新 / updates `value[key]`.
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
    # 入口 / Entry: SimpleIndex.__init__.
    # 功能：绑定 pip HTML 索引来源和镜像，保留原始实体以逐项重建内容。
    # Purpose: Binds pip HTML index provenance and mirror, retaining raw entities for incremental reconstruction.
    # 输入 / Inputs: mirror; url
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    def __init__(self, mirror, url):
        super().__init__(convert_charrefs=False)
        self.mirror, self.url, self.parts = mirror, url, []

    # 入口 / Entry: SimpleIndex.handle_starttag.
    # 功能：忽略可改变来源的 base 元素，并把 href 改写为镜像地址后转义输出属性。
    # Purpose: Ignores source-changing base elements and escapes output attributes after rewriting href to the mirror.
    # 输入 / Inputs: tag; attributes
    # 输出 / Returns: `None`
    # 副作用 / Effects: 调用 / calls `out.append`, `self.parts.append`.
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

    # 入口 / Entry: SimpleIndex.handle_startendtag.
    # 功能：复用起始标签的受控属性重写逻辑处理自闭合输入标签。
    # Purpose: Uses the controlled start-tag attribute rewriting for self-closing input tags.
    # 输入 / Inputs: tag; attributes
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    def handle_startendtag(self, tag, attributes):
        self.handle_starttag(tag, attributes)

    # 入口 / Entry: SimpleIndex.handle_endtag.
    # 功能：把 HTML 结束标签追加到重建索引片段。
    # Purpose: Appends an HTML closing tag to reconstructed index fragments.
    # 输入 / Inputs: tag
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `self.parts.append`.
    def handle_endtag(self, tag):
        self.parts.append("</" + tag + ">")

    # 入口 / Entry: SimpleIndex.handle_data.
    # 功能：保留 HTML 文本数据并追加到重建索引。
    # Purpose: Retains HTML text data in the reconstructed index.
    # 输入 / Inputs: data
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `self.parts.append`.
    def handle_data(self, data):
        self.parts.append(data)

    # 入口 / Entry: SimpleIndex.handle_entityref.
    # 功能：保留原始命名 HTML 实体而不让解析器提前解码。
    # Purpose: Retains an original named HTML entity without premature parser decoding.
    # 输入 / Inputs: name
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `self.parts.append`.
    def handle_entityref(self, name):
        self.parts.append("&" + name + ";")

    # 入口 / Entry: SimpleIndex.handle_charref.
    # 功能：保留原始数字 HTML 实体用于索引重建。
    # Purpose: Retains an original numeric HTML entity for index reconstruction.
    # 输入 / Inputs: name
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `self.parts.append`.
    def handle_charref(self, name):
        self.parts.append("&#" + name + ";")

    # 入口 / Entry: SimpleIndex.handle_decl.
    # 功能：保留 HTML 声明片段用于重建索引。
    # Purpose: Retains an HTML declaration fragment for index reconstruction.
    # 输入 / Inputs: declaration
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `self.parts.append`.
    def handle_decl(self, declaration):
        self.parts.append("<!" + declaration + ">")


class BoundedServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    # 入口 / Entry: BoundedServer.__init__.
    # 功能：创建最多八路请求的 loopback 服务，并把实际端口及随机入口发布给镜像。
    # Purpose: Creates a loopback server bounded to eight concurrent requests and publishes its actual port/nonce entry to the mirror.
    # 输入 / Inputs: mirror
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `threading.BoundedSemaphore`; 更新 / updates `self.slots`, `self.mirror`, `mirror.base`.
    def __init__(self, mirror):
        self.slots = threading.BoundedSemaphore(8)
        self.mirror = mirror
        super().__init__(("127.0.0.1", 0), Handler)
        mirror.base = "http://127.0.0.1:" + str(self.server_port) + "/" + mirror.nonce + "/"

    # 入口 / Entry: BoundedServer.process_request.
    # 功能：非阻塞取得请求槽位，满额直接关闭新请求，线程建立失败交还槽位。
    # Purpose: Nonblockingly acquires a request slot, closes excess requests and returns the slot if thread creation fails.
    # 输入 / Inputs: request; address
    # 输出 / Returns: `None`
    # 拒绝 / Refusals: `re-raise`.
    def process_request(self, request, address):
        if not self.slots.acquire(False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    # 入口 / Entry: BoundedServer.process_request_thread.
    # 功能：运行已准入请求线程，并在任何结束路径交还并发槽位。
    # Purpose: Runs an admitted request thread and returns its concurrency slot on every exit.
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
    # 功能：抑制携带上游 URL、响应正文或凭证的默认错误日志。
    # Purpose: Suppresses default error logs that could carry upstream URLs, response bodies or credentials.
    # 输入 / Inputs: request; address
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    def handle_error(self, request, address):
        pass  # No upstream URL, response body or credential-bearing traceback in logs.


class Handler(http.server.BaseHTTPRequestHandler):
    # 入口 / Entry: Handler.log_message.
    # 功能：抑制默认访问日志，避免本地请求路径和敏感上游上下文被记录。
    # Purpose: Suppresses default access logging to avoid recording local request paths and sensitive upstream context.
    # 输入 / Inputs: *args
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    def log_message(self, *args):
        pass

    # 入口 / Entry: Handler.do_GET.
    # 功能：有界读取并重写依赖索引，或完整校验暂存归档后才向包管理器发送正文。
    # Purpose: Reads/rewrites bounded dependency indexes or fully validates a staged archive before sending its body to the package manager.
    # 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
    # 输出 / Returns: 无显式结果，正常完成返回 None / no explicit result; successful completion returns None.
    # 副作用 / Effects: 调用 / calls `self.connection.settimeout`, `mirror.open`, `response.read`, `self.send_response`, `self.send_header`, `self.wfile.write`; 更新 / updates `self.server.mirror.rejected`, `self.close_connection`.
    # 拒绝 / Refusals: `ValueError('response too large')`; `ValueError('index too large')`; `ValueError('package index must support the HTML simple API')`.
    # 收尾 / Finalization: `self.close_connection = True`.
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


# 入口 / Entry: load_credentials.
# 功能：校验 root 私有凭证文件及父目录，读取后删除原文件并构造准确认证范围。
# Purpose: Checks a root-private credential file/parent, deletes the original after reading and constructs its exact authorization scope.
# 输入 / Inputs: path
# 输出 / Returns: `AuthorizationScope(value['endpoint'], value['authorization'])`
# 副作用 / Effects: 调用 / calls `open`, `os.unlink`.
# 拒绝 / Refusals: `ValueError('unprotected credential file')`.
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


# 入口 / Entry: main.
# 功能：建立临时认证镜像，运行无脚本 npm 预取或仅二进制 pip 下载，并汇总拒绝状态。
# Purpose: Starts the ephemeral authenticated mirror, runs script-free npm prefetch or binary-only pip download and incorporates mirror refusals into exit status.
# 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
# 输出 / Returns: `result if result != 0 else 2 if mirror.rejected else 0`
# 副作用 / Effects: 调用 / calls `threading.Thread`, `mirror.rewrite_lock`, `server.server_close`.
# 拒绝 / Refusals: `ValueError('unknown dependency manager')`.
# 收尾 / Finalization: `server.shutdown()`; `server.server_close()`; `worker.join(timeout=2)`.
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
