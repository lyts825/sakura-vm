"""Bounded engineering operations. Invoked in the guest with a JSON request on stdin.

No third-party Python modules are needed. Results use one JSON object on stdout;
nonzero exit codes always represent failed checks as well as failed commands.
"""
import base64
import fnmatch
import hashlib
import io
import ipaddress
import itertools
import importlib.metadata
import json
import os
import platform
import posixpath
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import signal
import stat
import statistics
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from urllib.parse import urlparse

MAX_FILES = 20000
MAX_BYTES = 512 * 1024 * 1024
MAX_OUTPUT = 2 * 1024 * 1024


class Failure(Exception):
    def __init__(self, message, code=1, **details):
        super().__init__(message)
        self.code = code
        self.details = details


def run(args, cwd=None, timeout=60, input=None, check=True, env=None):
    """Use argv, retain bounded output, and terminate the entire child group on timeout."""
    if args[0] == "git":
        args = ["git", "--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
                "-c", "color.ui=false", "-c", "rebase.autoStash=false", "-c", "rebase.autoSquash=false",
                "-c", "rebase.updateRefs=false", *args[1:]]
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        try:
            child = subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
                                     stdout=out, stderr=err, start_new_session=(os.name != "nt"))
        except FileNotFoundError:
            raise Failure("缺少客户机工具：" + str(args[0]), 127)
        timed_out, oversized = False, False
        deadline = time.monotonic() + timeout
        pending_input = input.encode() if isinstance(input, str) else input
        try:
            while True:
                try:
                    child.communicate(pending_input, timeout=min(0.1, max(0.001, deadline - time.monotonic())))
                    break
                except subprocess.TimeoutExpired:
                    pending_input = None
                    if os.fstat(out.fileno()).st_size > MAX_OUTPUT or os.fstat(err.fileno()).st_size > MAX_OUTPUT:
                        oversized = True
                        break
                    if time.monotonic() >= deadline:
                        timed_out = True
                        break
        finally:
            # User commands may leave descendants alive after the main process exits.
            if os.name != "nt":
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            elif child.poll() is None:
                child.kill()
            child.wait()
        out.seek(0)
        err.seek(0)
        stdout, stderr = out.read(MAX_OUTPUT + 1), err.read(MAX_OUTPUT + 1)
        result = dict(code=124 if timed_out else child.returncode, stdout=stdout[:MAX_OUTPUT].decode("utf-8", "replace"),
                      stderr=stderr[:MAX_OUTPUT].decode("utf-8", "replace"))
        if oversized or len(stdout) > MAX_OUTPUT or len(stderr) > MAX_OUTPUT:
            raise Failure("命令输出超过 2 MiB，拒绝返回不完整结果", code=1)
        if check and result["code"]:
            raise Failure("命令执行超时" if timed_out else "命令执行失败", **result)
        return result


def safe_path(root, value, exists=False):
    """Reject traversal and every symlink component, even links remaining inside root."""
    value = str(value)
    parts = PurePosixPath(value).parts
    if not value or value.startswith(("/", "\\")) or "\\" in value or ":" in value or ".." in parts or re.search(r"[\x00-\x1f]", value):
        raise Failure("需要项目内的相对路径：" + value)
    target = root
    for part in parts:
        target = target / part
        if target.is_symlink():
            raise Failure("路径不能包含符号链接：" + value)
    if exists and not target.exists():
        raise Failure("路径不存在：" + value)
    return target


def read_text(root, value, limit=MAX_OUTPUT):
    target = safe_path(root, value, True)
    if not target.is_file() or target.stat().st_size > limit:
        raise Failure("文件类型或大小不受支持：" + value)
    return target.read_text(encoding="utf-8")


def files_under(root, value=".", excludes=()):
    source = safe_path(root, value, True)
    found, total = [], 0
    items = [source] if source.is_file() else source.rglob("*")
    for item in items:
        relative = item.relative_to(root).as_posix()
        if any(fnmatch.fnmatchcase(relative, rule) or any(fnmatch.fnmatchcase(part, rule) for part in item.relative_to(root).parts)
               for rule in excludes):
            continue
        safe_path(root, relative, True)
        if item.is_dir():
            continue
        if not stat.S_ISREG(item.stat().st_mode):
            raise Failure("只支持普通文件：" + relative)
        total += item.stat().st_size
        found.append((relative, item))
        if len(found) > MAX_FILES or total > MAX_BYTES:
            raise Failure("扫描超过 20,000 个文件或 512 MiB")
    return sorted(found)


def manifest(root, value=".", excludes=()):
    result, total = [], 0
    for name, file in files_under(root, value, excludes):
        before = file.stat()
        digest = hashlib.sha256()
        with file.open("rb") as stream:
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise Failure("文件读取超过 512 MiB")
                digest.update(chunk)
        after = file.stat()
        if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
            raise Failure("扫描期间文件发生变更：" + name)
        result.append(dict(path=name, sha256=digest.hexdigest(), size=before.st_size, mtime=before.st_mtime))
    return result


def atomic_json(root, relative, data):
    file = safe_path(root, relative)
    file.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".sakura-write-", dir=file.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
        os.replace(temporary, file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def history(root, operation, value):
    relative = ".sakura/engineering/" + operation + ".json"
    file = safe_path(root, relative)
    previous = json.loads(read_text(root, relative)) if file.exists() else []
    if not isinstance(previous, list):
        raise Failure("历史文件格式无效")
    record = dict(sampledAt=time.time(), **value)
    atomic_json(root, relative, (previous + [record])[-120:])
    return previous[-1] if previous else None


def archive_members(archive):
    entries, names, size = [], set(), 0
    for member in archive:
        name = member.name
        if name in ("", ".", "./") and member.isdir():
            continue
        pieces = PurePosixPath(name).parts
        if (not name or name.startswith(("/", "\\")) or "\\" in name or ":" in name or ".." in pieces
                or re.search(r"[\x00-\x1f]", name) or not (member.isfile() or member.isdir())):
            raise Failure("归档包含非法成员或链接：" + name)
        normalized = PurePosixPath(name).as_posix()
        if normalized in names:
            raise Failure("归档包含重复成员：" + name)
        names.add(normalized)
        size += member.size
        entries.append(member)
        if len(entries) > MAX_FILES or size > MAX_BYTES:
            raise Failure("归档超过 20,000 个成员或 512 MiB")
    directories = {PurePosixPath(member.name).as_posix() for member in entries if member.isdir()}
    for member in entries:
        for parent in PurePosixPath(member.name).parents:
            if parent.as_posix() in names and parent.as_posix() not in directories:
                raise Failure("归档文件与目录冲突")
    return entries


def archive_operation(root, p, template=False):
    target = safe_path(root, p.get("target", "sakura-archive.tar.gz"))
    mode = "create" if template else p["mode"]
    if mode == "create":
        if target.exists():
            raise Failure("目标已存在，拒绝覆盖：" + target.name)
        excludes = list(p.get("excludes", []))
        if template:
            excludes += [".git", "node_modules", ".venv", "venv", "__pycache__", "target", ".env", ".env.*",
                         ".sakura", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "id_ed25519*", "id_ecdsa*"]
        items = files_under(root, "." if template else p["path"], excludes)
        # Reject private key contents even when the filename looks harmless.
        if template:
            for name, file in items:
                with file.open("rb") as stream:
                    if re.search(rb"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----", stream.read(16384)):
                        raise Failure("模板含私钥文件：" + name)
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=target.parent, prefix=".sakura-archive-")
        os.close(fd)
        try:
            with tarfile.open(temporary, "w:gz", format=tarfile.PAX_FORMAT, dereference=False) as archive:
                for name, file in items:
                    safe_path(root, name, True)
                    archive.add(file, arcname=name, recursive=False)
            with tarfile.open(temporary, "r:gz") as archive:
                archive_members(archive)
            # Hard link gives no-overwrite publication on the project filesystem.
            os.link(temporary, target)
        finally:
            os.unlink(temporary)
        return dict(target=target.relative_to(root).as_posix(), files=len(items))
    source = safe_path(root, p["path"], True)
    if source.stat().st_size > MAX_BYTES:
        raise Failure("归档文件超过 512 MiB")
    with tarfile.open(source, "r:*") as archive:
        entries = archive_members(archive)
        listing = [dict(path=m.name, size=m.size, directory=m.isdir()) for m in entries]
        if mode == "list":
            return dict(members=listing)
        if target.exists():
            raise Failure("解压目标必须是新的目录，避免覆盖现有文件")
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=target.parent, prefix=".sakura-extract-") as staging:
            stage = Path(staging)
            for member in entries:
                destination = safe_path(stage, member.name)
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(member) as stream, destination.open("xb") as output:
                        shutil.copyfileobj(stream, output)
                    destination.chmod(member.mode & 0o777 & ~0o022)
            os.rename(stage, target)
    return dict(target=target.relative_to(root).as_posix(), members=listing)


def task_import(root):
    tasks = []
    def add(tool, names):
        for name in sorted(set(names)):
            if re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.:/-]{0,79}", name):
                args = [tool, "run", name] if tool == "npm" else [tool, name]
                tasks.append(dict(name=tool + ":" + name, command=shlex.join(args)))
    if safe_path(root, "package.json").exists():
        add("npm", json.loads(read_text(root, "package.json")).get("scripts", {}).keys())
    for filename, tool, pattern in [("Makefile", "make", r"^([A-Za-z0-9_.-]+)\s*:(?!=)"),
                                     ("Justfile", "just", r"^([A-Za-z0-9_.-]+)(?:\s+[^:\n]+)?\s*:"),
                                     ("justfile", "just", r"^([A-Za-z0-9_.-]+)(?:\s+[^:\n]+)?\s*:"),
                                     ("Taskfile.yml", "task", r"^  ([A-Za-z0-9_.:-]+):"),
                                     ("Taskfile.yaml", "task", r"^  ([A-Za-z0-9_.:-]+):")]:
        if safe_path(root, filename).exists():
            add(tool, re.findall(pattern, read_text(root, filename), re.M))
    return list({(task["name"], task["command"]): task for task in tasks}.values())


def env_check(rules):
    issues, present = [], []
    for name, rule in rules.items():
        value = os.environ.get(name)
        if value is None:
            if rule.get("required", True):
                issues.append(dict(name=name, rule="required"))
            continue
        present.append(name)
        kind = rule.get("type", "string")
        valid = (kind == "string" or (kind == "integer" and re.fullmatch(r"[+-]?\d+", value))
                 or (kind == "boolean" and value.lower() in ("true", "false", "0", "1"))
                 or (kind == "url" and urlparse(value).scheme in ("http", "https") and bool(urlparse(value).hostname)))
        if not valid:
            issues.append(dict(name=name, rule=kind))
        if rule.get("choices") and value not in rule["choices"]:
            issues.append(dict(name=name, rule="choices"))
    return dict(code=1 if issues else 0, present=present, issues=issues)


def coverage(root, path):
    text = read_text(root, path)
    if text.lstrip().startswith("{"):
        data = json.loads(text)
        if "total" in data:  # Istanbul
            metrics = {k: dict(total=v["total"], covered=v["covered"], pct=v["pct"])
                       for k, v in data["total"].items() if isinstance(v, dict) and "covered" in v}
        elif "totals" in data:  # coverage.py
            v = data["totals"]
            metrics = dict(lines=dict(total=v["num_statements"], covered=v["covered_lines"], pct=v["percent_covered"]))
        else:
            raise Failure("不支持的覆盖率 JSON 格式")
    else:
        totals = {key: 0 for key in ("LF", "LH", "BRF", "BRH", "FNF", "FNH")}
        seen = False
        for line in text.splitlines():
            if ":" in line and line.split(":")[0] in totals:
                key, val = line.split(":", 1)
                totals[key] += int(val)
                seen = True
        if not seen:
            raise Failure("未识别到 LCOV 统计数据")
        metrics = {name: dict(total=totals[full], covered=totals[hit], pct=100 * totals[hit] / totals[full] if totals[full] else 100)
                   for name, full, hit in [("lines", "LF", "LH"), ("branches", "BRF", "BRH"), ("functions", "FNF", "FNH")]}
    if not metrics:
        raise Failure("覆盖率报告没有统计项")
    previous = history(root, "coverage-history", dict(path=path, metrics=metrics))
    delta = {k: v["pct"] - previous["metrics"][k]["pct"] for k, v in metrics.items() if previous and k in previous["metrics"]}
    return dict(metrics=metrics, delta=delta, previousSampledAt=previous and previous["sampledAt"])


def npm_packages(root):
    lock = json.loads(read_text(root, "package-lock.json"))
    if lock.get("lockfileVersion") not in (2, 3) or not isinstance(lock.get("packages"), dict):
        raise Failure("需要 npm package-lock v2/v3")
    packages = []
    for path, info in sorted(lock["packages"].items()):
        if not path:
            continue
        if info.get("link"):
            continue
        name = info.get("name") or path.rsplit("node_modules/", 1)[-1]
        packages.append(dict(path=path, name=name, **{k: info.get(k) for k in ("version", "integrity", "license", "resolved")}))
    return lock, packages


def sbom(root):
    lock, packages = npm_packages(root)
    components = []
    for item in packages:
        component = {"type": "library", "bom-ref": item["path"], "name": item["name"], "version": item["version"] or "unknown"}
        hashes = []
        for integrity in (item["integrity"] or "").split():
            try:
                algorithm, encoded = integrity.split("-", 1)
                if algorithm in ("sha256", "sha384", "sha512"):
                    raw = base64.b64decode(encoded, validate=True)
                    if len(raw) != int(algorithm[3:]) // 8:
                        raise ValueError("invalid integrity length")
                    hashes.append({"alg": "SHA-" + algorithm[3:], "content": raw.hex()})
            except ValueError:
                raise Failure("锁文件完整性信息无效：" + item["path"])
        if hashes:
            component["hashes"] = hashes
        component["properties"] = [{"name": "sakura:lock-path", "value": item["path"]}]
        components.append(component)
    return dict(bomFormat="CycloneDX", specVersion="1.5", version=1,
                metadata={"component": {"type": "application", "name": lock.get("name", root.name),
                                          "version": lock.get("version", "unknown")}}, components=components)


def license_report(root, allowed):
    _, packages = npm_packages(root)
    report = []
    for package in packages:
        license_id = package["license"]
        file = safe_path(root, package["path"] + "/package.json")
        if not license_id and file.exists():
            license_id = json.loads(read_text(root, package["path"] + "/package.json")).get("license")
        status = "allowed" if isinstance(license_id, str) and license_id in allowed else "review"
        report.append(dict(name=package["name"], version=package["version"], license=license_id, status=status))
    return dict(code=1 if any(p["status"] == "review" for p in report) else 0, packages=report)


def secret_scan(root):
    names = run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], root)["stdout"].split("\0")
    findings = []
    rules = [("private-key", re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----")),
             ("aws-access-key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
             ("github-token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b")),
             ("credential-assignment", re.compile(r"""(?i)\b(?:password|api[_-]?key|secret[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{12,}"""))]
    for name in filter(None, names):
        content = run(["git", "show", ":" + name], root)["stdout"]
        for number, line in enumerate(content.splitlines(), 1):
            for rule, pattern in rules:
                if pattern.search(line):
                    findings.append(dict(path=name, line=number, rule=rule))
    return dict(code=1 if findings else 0, findings=findings)


def owners(root, paths):
    filename = next((v for v in (".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS") if safe_path(root, v).exists()), None)
    if not filename:
        raise Failure("CODEOWNERS 不存在")
    rules = []
    for number, line in enumerate(read_text(root, filename).splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        pattern = parts[0]
        if pattern.startswith("!") or "[" in pattern or "\\" in pattern:
            raise Failure("不支持的 CODEOWNERS 规则", line=number)
        anchored = pattern.startswith("/") or "/" in pattern.rstrip("/")
        pattern = pattern.lstrip("/")
        directory = pattern.endswith("/")
        pattern = pattern.rstrip("/")
        expr = ""
        index = 0
        while index < len(pattern):
            ch = pattern[index]
            if ch == "*" and pattern[index:index + 2] == "**":
                if pattern[index:index + 3] == "**/":
                    expr += "(?:.*/)?"
                    index += 3
                else:
                    expr += ".*"
                    index += 2
                continue
            expr += "[^/]*" if ch == "*" else "[^/]" if ch == "?" else re.escape(ch)
            index += 1
        regex = re.compile(("^" if anchored else "(?:^|/)") + expr + ("/.*$" if directory else "(?:/.*)?$"))
        rules.append((number, regex, [p for p in parts[1:] if p.startswith("@") or "@" in p]))
    mapped = []
    for path in paths:
        safe_path(root, path)
        matched = [rule for rule in rules if rule[1].search(path)]
        mapped.append(dict(path=path, owners=matched[-1][2] if matched else [], ruleLine=matched[-1][0] if matched else None))
    return dict(source=filename, paths=mapped)


def git_operation(root, operation, p):
    mode = p.get("mode", "list")
    git = lambda *args, **kwargs: run(["git", *args], root, **kwargs)
    def clean():
        if git("status", "--porcelain")["stdout"].strip():
            raise Failure("需要干净的 Git 工作区")
    if operation == "git-stash":
        args = ["stash", mode]
        if mode == "save":
            args = ["stash", "push", "-u", "-m", p.get("message", "Sakura stash")]
        elif mode in ("apply", "drop"):
            args += [p.get("ref", "stash@{0}")]
        return git(*args)
    if operation == "git-reflog":
        if mode == "list":
            return git("reflog", "-100")
        clean()
        git("check-ref-format", "--branch", p["branch"])
        git("rev-parse", "--verify", p["commit"] + "^{commit}")
        return git("switch", "-c", p["branch"], p["commit"])
    if operation == "git-cherry-pick":
        if mode in ("pick", "revert"):
            clean()
            return git("revert" if mode == "revert" else "cherry-pick", "--no-edit", p["commit"])
        return git(p.get("sequence", "cherry-pick"), "--" + mode, env={**os.environ, "GIT_EDITOR": "true"})
    if operation == "git-bisect":
        if mode == "start":
            clean()
            git("rev-parse", "--verify", p["bad"] + "^{commit}")
            git("rev-parse", "--verify", p["good"] + "^{commit}")
            return git("bisect", "start", p["bad"], p["good"])
        args = ["bisect", mode]
        if mode in ("good", "bad") and p.get(mode):
            args += [p[mode]]
        return git(*args)
    if operation == "git-rebase":
        directory = Path(git("rev-parse", "--git-path", "sakura-engineering-rebase")["stdout"].strip())
        if not directory.is_absolute():
            directory = root / directory
        if directory.is_symlink():
            raise Failure("Rebase 状态不能是符号链接")
        def cleanup():
            if not directory.exists():
                return
            if (directory / "marker").read_text() != "sakura-rebase-v1":
                raise Failure("无法识别 Rebase 状态目录")
            for name in ("todo", "messages.json", "sequence.py", "editor.py", "marker"):
                (directory / name).unlink(missing_ok=True)
            directory.rmdir()
        if mode in ("continue", "abort"):
            editor = shlex.join([sys.executable, str(directory / "editor.py")]) if (directory / "editor.py").exists() else "true"
            result = git("rebase", "--" + mode, env={**os.environ, "GIT_EDITOR": editor}, check=False)
            if result["code"] == 0:
                cleanup()
            return result
        base = p["base"]
        git("rev-parse", "--verify", base + "^{commit}")
        if git("rev-list", "--merges", base + "..HEAD")["stdout"].strip():
            raise Failure("此交互式计划只支持线性历史；请先处理合并提交")
        lines = git("log", "--reverse", "--format=%H%x09%s", base + "..HEAD")["stdout"].splitlines()
        commits = [dict(commit=line.split("\t", 1)[0], message=line.split("\t", 1)[1]) for line in lines]
        head = git("rev-parse", "HEAD")["stdout"].strip()
        if mode == "plan":
            return dict(head=head, base=base, todo=[dict(action="pick", **c) for c in commits])
        clean()
        if p.get("head") and p["head"] != head:
            raise Failure("计划生成后 HEAD 已变更，请重新生成计划")
        todo = []
        allowed = {c["commit"] for c in commits}
        for item in p["todo"]:
            commit = git("rev-parse", "--verify", item["commit"] + "^{commit}")["stdout"].strip()
            if commit not in allowed or any(v["commit"] == commit for v in todo):
                raise Failure("计划含重复或未纳入范围的提交")
            todo.append(dict(item, commit=commit))
        if {c["commit"] for c in todo} != allowed:
            raise Failure("计划必须包含全部提交；丢弃提交请显式使用 drop")
        kept = False
        for item in todo:
            if item["action"] in ("squash", "fixup") and not kept:
                raise Failure("squash/fixup 前必须有保留的提交")
            if item["action"] != "drop":
                kept = True
        directory.mkdir(exist_ok=False)
        (directory / "marker").write_text("sakura-rebase-v1")
        (directory / "todo").write_text("".join(v["action"] + " " + v["commit"] + "\n" for v in todo), encoding="utf-8")
        (directory / "messages.json").write_text(json.dumps({v["commit"]: v["message"] for v in todo if v.get("message")}), encoding="utf-8")
        (directory / "sequence.py").write_text(
            "import sys,shutil\nshutil.copyfile(" + repr(str(directory / "todo")) + ",sys.argv[1])\n", encoding="utf-8")
        (directory / "editor.py").write_text(
            "import json,pathlib,subprocess,sys\n"
            "done=pathlib.Path(subprocess.check_output(['git','rev-parse','--git-path','rebase-merge/done'],text=True).strip())\n"
            "lines=[v.split() for v in done.read_text().splitlines() if v and not v.startswith('#')]\n"
            "commit=lines[-1][1] if lines else ''\n"
            "messages=json.loads(pathlib.Path(" + repr(str(directory / "messages.json")) + ").read_text())\n"
            "message=next((v for k,v in messages.items() if k.startswith(commit)),None)\n"
            "if message is not None: pathlib.Path(sys.argv[1]).write_text(message+'\\n')\n", encoding="utf-8")
        env = {**os.environ, "GIT_SEQUENCE_EDITOR": shlex.join([sys.executable, str(directory / "sequence.py")]),
               "GIT_EDITOR": shlex.join([sys.executable, str(directory / "editor.py")])}
        result = git("rebase", "--interactive", base, env=env, check=False)
        if result["code"] == 0:
            cleanup()
        return result
    raise Failure("Git 操作不存在")


def version_tuple(value):
    match = re.search(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?", value)
    return tuple(int(v or 0) for v in match.groups()) if match else None


def satisfies(version, constraint):
    """Small explicit range subset. Unknown syntax is never called compatible."""
    value = version_tuple(version)
    if not value:
        return None
    results = []
    for alternative in constraint.split("||"):
        constraints = re.findall(r"(>=|<=|>|<|=|\^|~)?\s*v?(\d+(?:\.(?:\d+|x|\*)){0,2})", alternative)
        residue = re.sub(r"(>=|<=|>|<|=|\^|~)?\s*v?\d+(?:\.(?:\d+|x|\*)){0,2}", "", alternative).strip(" ,")
        if residue or not constraints:
            return None
        passes = True
        for operator, raw in constraints:
            numbers = raw.split(".")
            concrete = [int(v) for v in numbers if v.isdigit()]
            wanted = tuple((concrete + [0, 0, 0])[:3])
            if operator in (">=", "<=", ">", "<", "="):
                passes &= {">=": value >= wanted, "<=": value <= wanted, ">": value > wanted,
                           "<": value < wanted, "=": value == wanted}[operator]
            elif operator in ("^", "~"):
                if operator == "~":
                    upper = (wanted[0] + 1, 0, 0) if len(concrete) == 1 else (wanted[0], wanted[1] + 1, 0)
                elif wanted[0] or len(concrete) == 1:
                    upper = (wanted[0] + 1, 0, 0)
                elif wanted[1] or len(concrete) == 2:
                    upper = (0, wanted[1] + 1, 0)
                else:
                    upper = (0, 0, wanted[2] + 1)
                passes &= wanted <= value < upper
            else:
                passes &= value[:len(concrete)] == wanted[:len(concrete)]
        results.append(passes)
    return any(results)


def toolchain(root):
    constraints = {}
    if safe_path(root, "package.json").exists():
        constraints.update(json.loads(read_text(root, "package.json")).get("engines", {}))
    for file, tool in [(".nvmrc", "node"), (".node-version", "node"), (".python-version", "python")]:
        if safe_path(root, file).exists():
            constraints[tool] = read_text(root, file).strip()
    if safe_path(root, "go.mod").exists():
        match = re.search(r"^go\s+(\S+)", read_text(root, "go.mod"), re.M)
        if match:
            constraints["go"] = ">=" + match[1]
    for filename in ("pyproject.toml", "Cargo.toml"):
        if safe_path(root, filename).exists():
            try:
                import tomllib
                data = tomllib.loads(read_text(root, filename))
                if filename == "pyproject.toml" and data.get("project", {}).get("requires-python"):
                    constraints["python"] = data["project"]["requires-python"]
                if filename == "Cargo.toml" and data.get("package", {}).get("rust-version"):
                    constraints["rust"] = ">=" + data["package"]["rust-version"]
            except ImportError:
                constraints["python" if filename == "pyproject.toml" else "rust"] = "manual: TOML requires Python 3.11"
    commands = dict(node=["node", "--version"], python=["python3", "--version"], rust=["rustc", "--version"],
                    go=["go", "version"], git=["git", "--version"], npm=["npm", "--version"],
                    yarn=["yarn", "--version"], pnpm=["pnpm", "--version"])
    report = []
    for tool in sorted(set(constraints) | {"node", "python", "rust", "git"}):
        args = commands.get(tool)
        version = None
        if args and shutil.which(args[0]):
            result = run(args, root, check=False)
            if not result["code"]:
                version = (result["stdout"] + result["stderr"]).strip()
        constraint = constraints.get(tool)
        compatible = satisfies(version, constraint) if version and constraint else None
        status = ("missing" if not version else "manual-review" if compatible is None else "compatible" if compatible else "incompatible") if constraint else ("detected" if version else "optional-missing")
        report.append(dict(tool=tool, version=version, constraint=constraint, status=status))
    return dict(code=1 if any(v["status"] in ("missing", "incompatible", "manual-review") for v in report) else 0, tools=report)


def bootstrap(root, command):
    syntax = run(["sh", "-n"], root, input=command, check=False)
    if syntax["code"]:
        return dict(code=syntax["code"], syntax=False, stderr=syntax["stderr"])
    # Parse simple commands only; never eval expansions, substitutions or sourced code.
    if re.search(r"[\x60$]|<<|[(){}]", command):
        return dict(code=2, syntax=True, manualReview=["动态 Shell 语法需要人工检查"])
    lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|<>")
    lexer.whitespace_split = True
    tokens = list(lexer)
    tools, paths, unknown = [], [], []
    expect_command, redirect = True, False
    for token in tokens:
        if token in (";", "&&", "||", "|", "&"):
            expect_command = True
            continue
        if token in ("<", ">", ">>", "2>"):
            redirect = True
            continue
        if redirect:
            target = safe_path(root, token)
            paths.append(dict(path=token, parentExists=target.parent.is_dir()))
            redirect = False
            continue
        if expect_command:
            if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", token):
                continue
            expect_command = False
            if token in ("if", "then", "fi", "for", "do", "done", "while", "case", "source", "."):
                unknown.append(token)
            elif token not in ("cd", "echo", "printf", "test", "true", "false", "export", "set", "pwd"):
                tools.append(dict(tool=token, found=bool(shutil.which(token)) if "/" not in token else safe_path(root, token).is_file()))
    for match in re.finditer(r"(?:^|[;&|]\s*)cd\s+([A-Za-z0-9_./-]+)", command):
        paths.append(dict(path=match[1], exists=safe_path(root, match[1]).is_dir()))
    if re.search(r"\bnpm\s+ci\b", command):
        paths.append(dict(path="package-lock.json", exists=safe_path(root, "package-lock.json").is_file()))
    failed = unknown or any(not t["found"] for t in tools) or any(not p.get("exists", p.get("parentExists")) for p in paths)
    return dict(code=1 if failed else 0, syntax=True, tools=tools, paths=paths, manualReview=unknown)


def onboarding(root):
    tasks = task_import(root)
    steps = []
    for file, command, title in [("package-lock.json", "npm ci", "安装锁定的 npm 依赖"),
                                 ("requirements.txt", "python3 -m pip install -r requirements.txt", "安装 Python 依赖"),
                                 ("Cargo.lock", "cargo fetch --locked", "获取锁定的 Rust 依赖"),
                                 ("go.sum", "go mod download", "获取 Go 依赖")]:
        if safe_path(root, file).is_file():
            steps.append(dict(title=title, command=command, source=file))
    for task in tasks:
        if task["name"].split(":")[-1] in ("test", "build", "dev", "lint"):
            steps.append(dict(title=task["name"], command=task["command"], source="project task"))
    readme = next((v for v in ("README.md", "readme.md", "README") if safe_path(root, v).is_file()), None)
    if readme:
        for line in read_text(root, readme).splitlines():
            match = re.match(r"\s*[-*]\s+\[ \]\s+(.+)", line)
            if match:
                steps.append(dict(title=match[1], source=readme, manual=True))
    return dict(steps=steps, tasks=tasks, executed=False)


def resource_sample(operation):
    if not Path("/proc").is_dir():
        raise Failure("此操作需要 Linux /proc")
    if operation == "process-history":
        rows = []
        page = os.sysconf("SC_PAGE_SIZE")
        ticks = os.sysconf("SC_CLK_TCK")
        boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        for directory in Path("/proc").iterdir():
            if not directory.name.isdigit():
                continue
            try:
                text = (directory / "stat").read_text()
                end = text.rfind(")")
                values = text[end + 2:].split()
                rows.append(dict(pid=int(directory.name), name=text[text.find("(") + 1:end], startTicks=int(values[19]),
                                 identity=boot + ":" + directory.name + ":" + values[19],
                                 cpuSeconds=(int(values[11]) + int(values[12])) / ticks, rssBytes=int(values[21]) * page))
            except (FileNotFoundError, PermissionError, ProcessLookupError):
                continue
        return dict(processes=rows)
    def counters():
        rows = {}
        path = "/proc/diskstats" if operation == "disk-io-metrics" else "/proc/net/dev"
        for line in Path(path).read_text().splitlines():
            if operation == "disk-io-metrics":
                v = line.split()
                if len(v) >= 14:
                    rows[v[2]] = dict(zip(("reads", "mergedReads", "readSectors", "readMs", "writes", "mergedWrites",
                                          "writeSectors", "writeMs", "inFlight", "busyMs", "weightedMs"), map(int, v[3:14])))
            elif ":" in line:
                name, raw = line.split(":", 1)
                v = list(map(int, raw.split()))
                rows[name.strip()] = dict(zip(("rxBytes", "rxPackets", "rxErrors", "rxDropped", "txBytes", "txPackets", "txErrors", "txDropped"), v[:4] + v[8:12]))
        return rows
    start, first = time.monotonic(), counters()
    time.sleep(1)
    second, seconds = counters(), time.monotonic() - start
    rows = []
    for name in sorted(first.keys() & second.keys()):
        delta = {k: max(0, v - first[name][k]) for k, v in second[name].items()}
        if operation == "disk-io-metrics":
            count = delta["reads"] + delta["writes"]
            rows.append(dict(device=name, readBytesPerSecond=delta["readSectors"] * 512 / seconds,
                             writeBytesPerSecond=delta["writeSectors"] * 512 / seconds,
                             averageLatencyMs=(delta["readMs"] + delta["writeMs"]) / count if count else 0,
                             inFlight=second[name]["inFlight"], averageQueueDepth=delta["weightedMs"] / (seconds * 1000)))
        else:
            rows.append(dict(interface=name, delta=delta, perSecond={k: v / seconds for k, v in delta.items()}))
    return dict(intervalSeconds=seconds, samples=rows)


def execute(root, operation, p):
    if operation in ("archive", "project-template-pack"):
        return archive_operation(root, p, operation == "project-template-pack")
    if operation == "hash-manifest":
        entries = manifest(root, p.get("path", "."), [p["output"]] if p.get("output") else [])
        result = dict(entries=entries)
        if p.get("output"):
            atomic_json(root, p["output"], result)
        return result
    if operation == "case-conflict-report":
        source = safe_path(root, p.get("path", "."), True)
        paths = itertools.chain([source], source.rglob("*")) if source.is_dir() else [source]
        issues, names = [], {}
        for count, path in enumerate(paths, 1):
            if count > MAX_FILES:
                raise Failure("超过 20,000 条路径")
            relative = path.relative_to(root).as_posix()
            folded = relative.casefold()
            if folded in names:
                issues.append(dict(path=relative, rule="case-collision", other=names[folded]))
            names[folded] = relative
            for part in PurePosixPath(relative).parts:
                if re.search(r'[<>:"\\|?*\x00-\x1f]', part) or part.endswith((" ", ".")):
                    issues.append(dict(path=relative, rule="invalid-windows-name"))
                if re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part):
                    issues.append(dict(path=relative, rule="reserved-windows-name"))
        return dict(code=1 if issues else 0, issues=issues)
    if operation == "task-import":
        return dict(tasks=task_import(root))
    if operation == "project-onboarding":
        return onboarding(root)
    if operation == "env-schema":
        return env_check(p["rules"])
    if operation == "toolchain-check":
        return toolchain(root)
    if operation == "bootstrap-dry-run":
        return bootstrap(root, p["command"])
    if operation == "shell-profiles":
        file = safe_path(root, ".sakura/profile.sh")
        if p["mode"] == "save":
            run(["sh", "-n"], root, input=p["content"])
            file.parent.mkdir(parents=True, exist_ok=True)
            with file.open("w", encoding="utf-8") as stream:
                stream.write(p["content"] + "\n")
            file.chmod(0o600)
            return dict(saved=True, path=".sakura/profile.sh")
        if p["mode"] == "read":
            return dict(content=read_text(root, ".sakura/profile.sh"))
        safe_path(root, ".sakura/profile.sh", True)
        return run(["sh", "-c", "set -e\n. ./.sakura/profile.sh\n" + p["command"]], root)
    if operation in ("git-stash", "git-reflog", "git-bisect", "git-cherry-pick", "git-rebase"):
        return git_operation(root, operation, p)
    if operation == "git-policy":
        branch = run(["git", "branch", "--show-current"], root)["stdout"].strip()
        subject = p.get("message") or run(["git", "log", "-1", "--format=%s"], root)["stdout"].strip()
        issues = []
        if not branch or not any(branch.startswith(prefix) for prefix in p["branchPrefixes"]):
            issues.append("branch-prefix")
        types = "|".join(re.escape(t) for t in p["commitTypes"])
        if not re.match(r"^(?:" + types + r")(?:\([^)]+\))?!?:\s+\S", subject):
            issues.append("commit-type")
        return dict(code=1 if issues else 0, branch=branch, issues=issues)
    if operation == "precommit-secrets":
        return secret_scan(root)
    if operation == "code-ownership":
        return owners(root, p["paths"])
    if operation in ("flaky-tests", "benchmark-regression"):
        runs = []
        for index in range(p["repeats"]):
            start = time.monotonic()
            result = run(["sh", "-c", p["command"]], root, timeout=p["timeout"], check=False)
            runs.append(dict(index=index + 1, durationMs=(time.monotonic() - start) * 1000, **result))
        failures = sum(v["code"] != 0 for v in runs)
        if operation == "flaky-tests":
            return dict(code=1 if failures else 0, classification="flaky" if 0 < failures < len(runs) else "stable-fail" if failures else "stable-pass", runs=runs)
        median = statistics.median(v["durationMs"] for v in runs)
        baseline = p.get("baselineMs")
        regression = 100 * (median - baseline) / baseline if baseline else None
        return dict(code=1 if failures or regression is not None and regression > p["thresholdPercent"] else 0,
                    medianMs=median, baselineMs=baseline, regressionPercent=regression, runs=runs)
    if operation == "coverage-history":
        return coverage(root, p["path"])
    if operation == "sbom":
        return dict(bom=sbom(root))
    if operation == "license-report":
        return license_report(root, p["allowed"])
    if operation in ("release-gates", "runbooks", "command-macros"):
        results, previous, failed = [], 0, False
        for step in p.get("checks", p.get("steps", [])):
            when = step.get("when", "success")
            skip = ((when == "success" and previous != 0) or (when == "failure" and previous == 0))
            if skip:
                results.append(dict(name=step["name"], skipped=True))
                continue
            args = step["argv"] if operation == "command-macros" else ["sh", "-c", step["command"]]
            result = run(args, root, timeout=step["timeout"], check=False)
            results.append(dict(name=step["name"], **result))
            previous = result["code"]
            failed |= previous != 0
        missing = [path for path in p.get("artifacts", []) if not safe_path(root, path).exists()]
        return dict(code=1 if failed or missing else 0, results=results, missingArtifacts=missing)
    if operation == "artifact-provenance":
        return dict(commit=run(["git", "rev-parse", "HEAD"], root)["stdout"].strip(),
                    dirty=bool(run(["git", "status", "--porcelain"], root)["stdout"].strip()),
                    entries=manifest(root, p["path"]), tools=toolchain(root)["tools"])
    if operation == "changelog":
        target = p["to"] if not p.get("from") else p["from"] + ".." + p["to"]
        return run(["git", "log", "--no-merges", "--format=* %h %s (%an)", target, "--"], root)
    if operation == "reproducible-build":
        commit = run(["git", "rev-parse", "HEAD"], root)["stdout"].strip()
        with tempfile.TemporaryDirectory(prefix="sakura-repro-") as temporary:
            base = Path(temporary)
            archive_path = base / "source.tar"
            run(["git", "archive", "--format=tar", "--output=" + str(archive_path), commit], root)
            manifests, builds = [], []
            with tarfile.open(archive_path) as archive:
                entries = archive_members(archive)
                for index in range(2):
                    project = base / str(index)
                    project.mkdir()
                    for member in entries:
                        target = safe_path(project, member.name)
                        if member.isdir():
                            target.mkdir(parents=True, exist_ok=True)
                        else:
                            target.parent.mkdir(parents=True, exist_ok=True)
                            with archive.extractfile(member) as source, target.open("xb") as destination:
                                shutil.copyfileobj(source, destination)
                            target.chmod(member.mode & 0o777)
                    result = run(["sh", "-c", p["command"]], project, timeout=p["timeout"], check=False)
                    builds.append(result)
                    if result["code"]:
                        return dict(code=result["code"], commit=commit, builds=builds)
                    manifests.append({e["path"]: dict(sha256=e["sha256"], size=e["size"]) for e in manifest(project, p["artifact"])})
            if not manifests[0] or not manifests[1]:
                raise Failure("构建产物为空")
            changed = [path for path in sorted(manifests[0].keys() | manifests[1].keys()) if manifests[0].get(path) != manifests[1].get(path)]
            return dict(code=1 if changed else 0, commit=commit, equal=not changed, differences=changed, manifests=manifests, builds=builds)
    if operation == "posix-acl":
        path = safe_path(root, p["path"], True)
        if p["mode"] == "read":
            return run(["getfacl", "-p", "--", str(path)], root)
        entry = p["entry"]
        if p["mode"] == "remove":
            entry = ":".join(entry.split(":")[:2])
        return run(["setfacl", "-m" if p["mode"] == "set" else "-x", entry, "--", str(path)], root)
    if operation == "guest-clock-policy":
        host = p["_hostEpochMs"] / 1000
        before = time.time()
        if p["mode"] == "sync":
            run(["date", "-u", "-s", "@" + str(int(host))])
        return dict(hostEpoch=host, beforeOffsetSeconds=before - host, afterOffsetSeconds=time.time() - host,
                    transportDelayIncluded=True)
    if operation == "static-routes":
        if p["mode"] == "list":
            return run(["ip", "-j", "route", "show"])
        network = ipaddress.ip_network(p["destination"], strict=False)
        if network.prefixlen == 0:
            raise Failure("禁止修改默认路由")
        gateway = ipaddress.ip_address(p["gateway"]) if p.get("gateway") else None
        if gateway and gateway.version != network.version:
            raise Failure("网关与目标地址协议不一致")
        args = ["ip", "-6" if network.version == 6 else "-4", "route", "add" if p["mode"] == "add" else "del", str(network)]
        if gateway:
            args += ["via", str(gateway)]
        return run(args)
    if operation in ("process-history", "disk-io-metrics", "network-metrics"):
        sample = resource_sample(operation)
        history(root, operation, sample)
        return sample
    if operation == "command-risk":
        rules = [(r"\brm\s+-rf\b|\bmkfs\b|\bdd\s+if=", "删除或覆盖磁盘"),
                 (r"\bsudo\b|\bsu\s", "提权"), (r"\bcurl\b|\bwget\b|Invoke-WebRequest", "网络下载"),
                 (r"\|\s*(sh|bash)\b|\beval\b", "下载后执行或动态执行"),
                 (r"\bscp\b|\brsync\b|\bcurl\b.*(?:--upload-file|-T|--data)", "外部传输")]
        return dict(risk=[message for pattern, message in rules if re.search(pattern, p["command"], re.I)])
    raise Failure("没有此操作的执行器：" + operation)


CAPABILITY_OPERATIONS = {
    "test-sharding", "directory-history", "disk-analyzer", "review-comments", "command-forms",
    "capability-command", "environment-fingerprint", "network-topology", "code-search-index",
    "language-server-catalog", "pii-classification",
    "patch-bundle", "environment-recreate", "format-lint",
    "build-cache", "branch-preview", "onboarding-checklist", "review-threads",
    "workspace-search", "git-worktrees",
    "dependency-report", "runtime-matrix", "reproducible-env", "network-diagnostics",
    "packet-capture",
}

# Each probe runs in a killable process: the OS resolver and TLS/header reads can
# otherwise exceed a socket timeout. No shell, credentials, body or redirects.
NETWORK_PROBE = r'''
import http.client, json, socket, ssl, sys, time
p = json.loads(sys.argv[1])
start = time.monotonic()
try:
    if p['probe'] == 'dns':
        addresses = list(dict.fromkeys(item[4][0] for item in socket.getaddrinfo(p['target'], p['port'], type=socket.SOCK_STREAM)))
        if not addresses:
            raise OSError('解析器未返回地址')
        result = dict(addresses=addresses[:32])
    elif p['probe'] == 'tcp':
        with socket.create_connection((p['target'], p['port']), timeout=p['timeout']) as connection:
            result = dict(peer=connection.getpeername()[0], port=p['port'])
    else:
        connection = http.client.HTTPSConnection(p['target'], p['port'], timeout=p['timeout'], context=ssl.create_default_context())
        try:
            connection.request('HEAD', '/', headers={'User-Agent': 'Sakura-Network-Diagnostics', 'Connection': 'close'})
            response = connection.getresponse()
            result = dict(status=response.status, certificateVerified=True)
            if response.status >= 400:
                result.update(code=1, error='HTTPS 返回 HTTP ' + str(response.status))
        finally:
            connection.close()
    result.setdefault('code', 0)
except Exception as error:
    result = dict(code=1, error=str(error)[:1000])
result['durationMs'] = round((time.monotonic() - start) * 1000)
print(json.dumps(result))
'''


def network_diagnostics(root, p):
    target, port = p.get('target', 'example.com'), p.get('port', 443)
    probes, timeout = p.get('probes', ['dns', 'tcp', 'https', 'route']), p.get('timeout', 10)
    if (not isinstance(target, str) or not re.fullmatch(r'[A-Za-z0-9:][A-Za-z0-9.:-]{0,252}', target)
            or not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535
            or not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 30
            or not isinstance(probes, list) or not 1 <= len(probes) <= 4
            or any(probe not in ['dns', 'tcp', 'https', 'route'] for probe in probes) or len(set(probes)) != len(probes)):
        raise Failure('网络诊断参数无效')
    results = []

    def probe(kind):
        command = run([sys.executable, '-c', NETWORK_PROBE, json.dumps(dict(
            probe=kind, target=target, port=port, timeout=timeout))], root, timeout=timeout, check=False)
        if command['code']:
            raise Failure(command['stderr'].strip() or '检查进程未成功完成')
        return json.loads(command['stdout'])

    dns = None
    for kind in probes:
        started = time.monotonic()
        try:
            if kind != 'route':
                result = probe(kind)
                if kind == 'dns':
                    dns = result
            else:
                if dns is None:
                    dns = probe('dns')
                if dns['code']:
                    raise Failure('路由检查无法解析目标：' + dns.get('error', 'DNS 失败'))
                routes = []
                deadline = started + timeout
                for address in dns['addresses'][:8]:
                    version = ipaddress.ip_address(address).version
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise Failure('路由检查超时')
                    command = run(['ip', '-' + str(version), 'route', 'get', address], root,
                                  timeout=remaining, check=False)
                    routes.append(dict(address=address, code=command['code'], output=(command['stdout'] + command['stderr']).strip()[:2000]))
                # An unreachable IPv6 route does not invalidate a usable IPv4 route.
                result = dict(code=0 if any(route['code'] == 0 for route in routes) else 1, routes=routes)
                if result['code']:
                    result['error'] = '所有已解析地址均无可用路由'
        except Exception as error:
            result = dict(code=1, error=str(error)[:1000])
        results.append(dict(probe=kind, **result, elapsedMs=round((time.monotonic() - started) * 1000)))
    return dict(code=0 if all(item['code'] == 0 for item in results) else 1,
                target=target, port=port, results=results)

RUNTIME_TOOLS = {
    'go': ['go', 'version'], 'java': ['java', '-version'], 'dotnet': ['dotnet', '--list-sdks'], 'php': ['php', '--version'],
    'node': ['node', '--version'], 'npm': ['npm', '--version'], 'python': ['python3', '--version'], 'rust': ['rustc', '--version'],
}
LOCK_COMMANDS = [('package-lock.json', ['npm', 'ci', '--ignore-scripts']),
                 ('npm-shrinkwrap.json', ['npm', 'ci', '--ignore-scripts']),
                 ('pnpm-lock.yaml', ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts']),
                 ('yarn.lock', ['yarn', 'install', '--frozen-lockfile', '--ignore-scripts']),
                 ('uv.lock', ['uv', 'sync', '--frozen']), ('poetry.lock', ['poetry', 'install', '--sync']),
                 ('Cargo.lock', ['cargo', 'fetch', '--locked']), ('go.sum', ['go', 'mod', 'download'])]


def runtime_versions(root):
    result = {}
    for name, args in RUNTIME_TOOLS.items():
        if shutil.which(args[0]):
            command = run(args, root, timeout=10, check=False)
            result[name] = dict(path=shutil.which(args[0]), version=(command['stdout'] or command['stderr']).strip()[:2000], code=command['code'])
        else:
            result[name] = None
    return result


def system_packages(root):
    if shutil.which('apk'):
        records = run(['apk', 'info', '-v'], root)['stdout'].splitlines()
        packages = {}
        for line in records:
            match = re.fullmatch(r'(.+)-(\d[^/ ]*)', line)
            if match:
                packages[match[1]] = match[2]
        return 'apk', packages
    if shutil.which('dpkg-query'):
        records = run(['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\t${db:Status-Status}\n'], root)['stdout'].splitlines()
        return 'apt', {parts[0]: parts[1] for line in records if len(parts := line.split('\t')) == 3 and parts[2] == 'installed'}
    raise Failure('环境锁定需要 apk 或 apt/dpkg')


def environment_snapshot(root):
    manager, packages = system_packages(root)
    os_info = {}
    for line in Path('/etc/os-release').read_text().splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            if key in ('ID', 'VERSION_ID'):
                os_info[key] = value.strip('"')
    locks = {}
    for name in ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', *[name for name, _ in LOCK_COMMANDS]]:
        file = safe_path(root, name)
        if file.exists():
            if not file.is_file() or file.stat().st_size > 16 * 1024 * 1024:
                raise Failure('依赖文件类型或大小不受支持：' + name)
            locks[name] = hashlib.sha256(file.read_bytes()).hexdigest()
    tools = {name: value['version'] if value else None for name, value in runtime_versions(root).items()}
    return dict(version=1, system=dict(os_info, architecture=platform.machine(), manager=manager), packages=packages, tools=tools, locks=locks)


def dependency_report(root, p):
    manager = p.get('manager', 'auto')
    if manager == 'auto':
        manager = 'npm' if safe_path(root, 'package.json').is_file() else 'python'
    nodes, edges, updates = [], [], []
    if manager == 'npm':
        lockfile = 'npm-shrinkwrap.json' if safe_path(root, 'npm-shrinkwrap.json').is_file() else 'package-lock.json'
        data = json.loads(read_text(root, lockfile, 16 * 1024 * 1024))
        packages = data.get('packages')
        if not isinstance(packages, dict):
            raise Failure('需要 npm lockfileVersion 2 或 3 的锁文件')
        if len(packages) > MAX_FILES:
            raise Failure('依赖图超过 20,000 个节点')
        for key, item in packages.items():
            if not isinstance(item, dict):
                raise Failure('依赖锁文件格式错误')
            name = item.get('name') or key.rsplit('node_modules/', 1)[-1] or data.get('name', 'project')
            nodes.append(dict(id=key or '.', name=name, version=item.get('version'), dev=bool(item.get('dev')), link=bool(item.get('link'))))
            for kind in ('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'):
                if key and kind == 'devDependencies':
                    continue
                for dependency, wanted in item.get(kind, {}).items():
                    context, target = key, None
                    while True:
                        candidate = posixpath.join(context, 'node_modules', dependency)
                        if candidate in packages:
                            target = candidate
                            break
                        if not context:
                            break
                        context = posixpath.dirname(context)
                    edges.append(dict(source=key or '.', target=target, name=dependency, requested=wanted, kind=kind))
                    if len(edges) > 100000:
                        raise Failure('依赖图超过 100,000 条边')
        if p.get('updates'):
            result = run(['npm', 'outdated', '--json', '--ignore-scripts'], root, timeout=p.get('timeout', 60), check=False)
            if result['code'] not in (0, 1):
                raise Failure('npm 更新查询失败', **result)
            outdated = json.loads(result['stdout'] or '{}')
            if 'error' in outdated:
                raise Failure('npm 更新查询失败', details=outdated['error'])
            updates = [dict(name=name, **value) for name, value in outdated.items()]
    else:
        for distribution in importlib.metadata.distributions():
            name = distribution.metadata.get('Name', '')
            if not name:
                continue
            key = re.sub(r'[-_.]+', '-', name).lower()
            nodes.append(dict(id=key, name=name, version=distribution.version))
            for requirement in distribution.requires or []:
                match = re.match(r'([A-Za-z0-9_.-]+)', requirement)
                if match:
                    edges.append(dict(source=key, target=re.sub(r'[-_.]+', '-', match[1]).lower(), requirement=requirement))
        if p.get('updates'):
            updates = json.loads(run(['python3', '-m', 'pip', 'list', '--outdated', '--format=json'], root, timeout=p.get('timeout', 60))['stdout'])
    return dict(manager=manager, nodes=nodes, edges=edges, updates=updates, updatesChecked=bool(p.get('updates')), generatedAt=time.time())


def runtime_matrix(root, p):
    if p['mode'] == 'list':
        return dict(runtimes={name: value for name, value in runtime_versions(root).items() if name in ('go', 'java', 'dotnet', 'php')})
    runtime = p['runtime']
    manager = 'apk' if shutil.which('apk') else 'apt' if shutil.which('apt-cache') else None
    if not manager:
        raise Failure('运行时安装需要 apk 或 apt')
    patterns = {'go': r'(go|golang(?:-[a-z0-9.+]+)*)', 'java': r'(openjdk[0-9]+(?:-jdk)?|openjdk-[0-9]+-jdk(?:-headless)?|default-jdk(?:-headless)?)',
                'dotnet': r'(dotnet[0-9]+-sdk|dotnet-sdk-[0-9.]+)', 'php': r'(php[0-9]*(?:-cli)?|php[0-9.]+-cli)'}
    package = p.get('package') or {'apk': {'go': 'go', 'java': 'openjdk17-jdk', 'dotnet': 'dotnet8-sdk', 'php': 'php84'},
                                 'apt': {'go': 'golang-go', 'java': 'openjdk-17-jdk', 'dotnet': 'dotnet-sdk-8.0', 'php': 'php-cli'}}[manager][runtime]
    if not re.fullmatch(patterns[runtime], package):
        raise Failure('包名称不属于所选运行时')
    if p['mode'] == 'versions':
        args = ['apk', 'policy', package] if manager == 'apk' else ['apt-cache', 'madison', package]
        return dict(manager=manager, package=package, **run(args, root))
    version = p.get('version', '')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.+:~_-]{0,100}', version) or not p.get('package'):
        raise Failure('安装需要明确的 package 和 version，请先查询可用版本')
    pin = package + '=' + version
    simulation = run(['apk', 'add', '--simulate', pin] if manager == 'apk' else ['apt-get', '-s', 'install', pin], root, timeout=60)
    result = run(['apk', 'add', pin] if manager == 'apk' else ['apt-get', '-y', '--no-remove', 'install', pin], root,
                 timeout=p.get('timeout', 600), env=dict(os.environ, DEBIAN_FRONTEND='noninteractive'), check=False)
    return dict(manager=manager, package=package, version=version, simulation=compact_command(simulation),
                runtime=runtime_versions(root)[runtime], **compact_command(result))


def reproducible_environment(root, p):
    relative = '.sakura/environment.lock.json'
    actual = environment_snapshot(root)
    if p['mode'] == 'capture':
        atomic_json(root, relative, actual)
        return dict(lockfile=relative, fingerprint=hashlib.sha256(json.dumps(actual, sort_keys=True).encode()).hexdigest(),
                    packages=len(actual['packages']), tools=actual['tools'], locks=actual['locks'])
    expected = json.loads(read_text(root, relative, 4 * 1024 * 1024))
    if expected.get('version') != 1 or any(not isinstance(expected.get(key), dict) for key in ('system', 'packages', 'tools', 'locks')):
        raise Failure('环境锁文件格式错误')
    if expected['system'] != actual['system']:
        raise Failure('发行版、版本、架构或包管理器与锁文件不匹配', expected=expected['system'], actual=actual['system'])
    packages = expected['packages']
    if len(packages) > 5000 or any(not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9+._:-]{0,120}', name) or
                                  not isinstance(version, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.+:~_-]{0,120}', version)
                                  for name, version in packages.items()):
        raise Failure('环境锁文件包含非法系统包版本')
    drift = lambda before, after: [dict(name=name, expected=value, actual=after.get(name)) for name, value in before.items() if after.get(name) != value]
    lock_drift = drift(expected['locks'], actual['locks'])
    package_drift, tool_drift = drift(packages, actual['packages']), drift(expected['tools'], actual['tools'])
    if p['mode'] == 'verify':
        return dict(code=1 if lock_drift or package_drift or tool_drift else 0, lockfile=relative,
                    differences=dict(locks=lock_drift, packages=package_drift, tools=tool_drift), verifiedAt=time.time())
    if lock_drift:
        raise Failure('依赖文件已改变，拒绝按旧锁文件安装', differences=lock_drift)
    if package_drift and not p.get('installSystem'):
        raise Failure('系统包版本不匹配，请使用对应环境或显式 installSystem', differences=package_drift)
    installs = []
    if package_drift:
        pins = [item['name'] + '=' + item['expected'] for item in package_drift]
        args = ['apk', 'add', *pins] if actual['system']['manager'] == 'apk' else ['apt-get', '-y', '--no-remove', 'install', *pins]
        installs.append(compact_command(run(args, root, timeout=p.get('timeout', 600), env=dict(os.environ, DEBIAN_FRONTEND='noninteractive'))))
    installed_families = set()
    for name, args in LOCK_COMMANDS:
        family = 'node' if args[0] in ('npm', 'pnpm', 'yarn') else 'python' if args[0] in ('uv', 'poetry') else args[0]
        if name in expected['locks'] and family not in installed_families:
            installs.append(dict(lockfile=name, **compact_command(run(args, root, timeout=p.get('timeout', 600)))))
            installed_families.add(family)
    refreshed = environment_snapshot(root)
    remaining = dict(packages=drift(packages, refreshed['packages']), tools=drift(expected['tools'], refreshed['tools']), locks=drift(expected['locks'], refreshed['locks']))
    return dict(code=1 if any(remaining.values()) else 0, installs=installs, differences=remaining, verifiedAt=time.time())


def compact_command(result):
    """Bound each command's displayed output; preserve its exit status and truncation flag."""
    return dict(result, stdout=result.get("stdout", "")[-16000:], stderr=result.get("stderr", "")[-16000:],
                outputTruncated=any(len(result.get(key, "")) > 16000 for key in ("stdout", "stderr")))


def text_inventory(root):
    ignored = {".git", ".sakura", "node_modules", ".venv", "venv", "target", "__pycache__", "dist", "build"}
    entries, size, visited = [], 0, 0
    for directory, folders, files in os.walk(root, followlinks=False):
        folders[:] = sorted(name for name in folders if name not in ignored and not (Path(directory) / name).is_symlink())
        for name in sorted(files):
            visited += 1
            if visited > MAX_FILES:
                raise Failure("索引超过 20,000 个文件")
            file = Path(directory) / name
            if file.is_symlink() or not file.is_file():
                continue
            before = file.stat()
            if before.st_size > 1024 * 1024:
                continue
            raw = file.read_bytes()
            if b"\x00" in raw:
                continue
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                continue
            after = file.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise Failure("扫描期间文件发生变化：" + str(file))
            size += len(raw)
            if size > 32 * 1024 * 1024:
                raise Failure("文本索引超过 32 MiB")
            entries.append(dict(path=file.relative_to(root).as_posix(), size=before.st_size,
                                mtime=before.st_mtime_ns, sha256=hashlib.sha256(raw).hexdigest(), text=text))
    return entries


def directory_revision(root, p):
    base = safe_path(root, ".sakura/directory-history")
    mode = p["mode"]
    if mode == "list":
        records = []
        if base.exists():
            for file in sorted(base.glob("*/manifest.json")):
                safe_path(root, file.relative_to(root).as_posix(), True)
                data = json.loads(file.read_text("utf-8"))
                if data["path"] == p["path"]:
                    records.append({key: data[key] for key in ("revision", "path", "label", "createdAt", "bytes", "files")})
        return dict(revisions=records)
    if mode == "snapshot":
        source = safe_path(root, p["path"], True)
        if not source.is_dir() or ".sakura" in source.relative_to(root).parts:
            raise Failure("请选择项目内的普通目录，不能备份内部状态目录")
        if base.exists() and len(list(base.iterdir())) >= 100:
            raise Failure("最多保存 100 个目录版本")
        entries = manifest(root, p["path"], (".sakura",))
        directories = []
        for directory, folders, _ in os.walk(source, followlinks=False):
            folders[:] = sorted(name for name in folders if name != ".sakura")
            for name in folders:
                child = Path(directory) / name
                safe_path(root, child.relative_to(root).as_posix(), True)
                directories.append(child.relative_to(source).as_posix())
                if len(directories) > MAX_FILES:
                    raise Failure("目录数量超过上限")
        revision = uuid.uuid4().hex
        folder = safe_path(root, ".sakura/directory-history/" + revision)
        folder.mkdir(parents=True)
        stored = []
        try:
            for entry in entries:
                file = safe_path(root, entry["path"], True)
                relative = file.relative_to(source).as_posix()
                destination = folder / "files" / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(file, destination)
                if hashlib.sha256(destination.read_bytes()).hexdigest() != entry["sha256"]:
                    raise Failure("保存时源文件内容发生变化：" + relative)
                stored.append(dict(path=relative, sha256=entry["sha256"], size=entry["size"], mode=file.stat().st_mode & 0o777))
            result = dict(revision=revision, path=p["path"], label=p["label"], createdAt=time.time(),
                          bytes=sum(item["size"] for item in stored), files=len(stored), entries=stored, directories=directories)
            atomic_json(root, ".sakura/directory-history/" + revision + "/manifest.json", result)
            return {key: value for key, value in result.items() if key not in ("entries", "directories")}
        except BaseException:
            shutil.rmtree(folder)
            raise
    revision = p.get("revision", "")
    if not re.fullmatch(r"[a-f0-9]{32}", revision):
        raise Failure("请选择目录版本 revision")
    relative = ".sakura/directory-history/" + revision
    data = json.loads(read_text(root, relative + "/manifest.json"))
    if data["path"] != p["path"]:
        raise Failure("版本不属于所选目录")
    if mode == "diff":
        current = {Path(item["path"]).relative_to(Path(p["path"])).as_posix(): item for item in manifest(root, p["path"], (".sakura",))}
        previous = {item["path"]: item for item in data["entries"]}
        added = sorted(current.keys() - previous.keys())
        removed = sorted(previous.keys() - current.keys())
        changed = sorted(name for name in current.keys() & previous.keys() if current[name]["sha256"] != previous[name]["sha256"])
        return dict(revision=revision, added=added, removed=removed, changed=changed, equal=not (added or removed or changed))
    if not p.get("target"):
        raise Failure("恢复需要新的目标目录 target")
    target = safe_path(root, p["target"])
    if target.exists() or ".sakura" in target.relative_to(root).parts:
        raise Failure("恢复目标必须是新的项目目录")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".sakura-restore-", dir=target.parent) as temporary:
        stage = Path(temporary)
        for name in data["directories"]:
            safe_path(stage, name).mkdir(parents=True, exist_ok=True)
        for entry in data["entries"]:
            source = safe_path(root, relative + "/files/" + entry["path"], True)
            destination = safe_path(stage, entry["path"])
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            if hashlib.sha256(destination.read_bytes()).hexdigest() != entry["sha256"]:
                raise Failure("版本文件校验失败：" + entry["path"])
            destination.chmod(entry["mode"] & 0o777)
        if target.exists():
            raise Failure("目标目录已存在")
        os.rename(stage, target)
    return dict(revision=revision, target=p["target"], files=len(data["entries"]))


def packet_capture(root, p):
    interface = p.get('interface', 'eth0')
    protocol = p.get('protocol', 'any')
    duration = p.get('durationSeconds', 5)
    limit = p.get('maxPackets', 100)
    port = p.get('port')
    if not re.fullmatch(r'(?:any|[A-Za-z][A-Za-z0-9_.-]{0,14})', interface):
        raise Failure('网卡名称无效')
    if protocol not in ('any', 'tcp', 'udp', 'icmp') or not isinstance(duration, int) or not 1 <= duration <= 20 \
            or not isinstance(limit, int) or not 1 <= limit <= 200:
        raise Failure('抓包参数超出限制')
    if port is not None and (not isinstance(port, int) or not 1 <= port <= 65535 or protocol == 'icmp'):
        raise Failure('端口过滤参数无效')
    if not shutil.which('tcpdump'):
        raise Failure('客户机缺少 tcpdump', 127)
    command = ['tcpdump', '-i', interface, '-p', '-nn', '-tt', '-l', '-q', '-s', '96', '-c', str(limit)]
    if protocol != 'any':
        command.append(protocol)
    if port is not None:
        if protocol != 'any':
            command.append('and')
        command.extend(['port', str(port)])
    started = time.monotonic()
    capture = run(command, root, timeout=duration, check=False)
    elapsed_ms = round((time.monotonic() - started) * 1000)
    if capture['code'] not in (0, 124):
        raise Failure('抓包失败，请检查网卡名称与 tcpdump 权限')
    peers, flows, buckets, protocols = {}, {}, {}, {}
    first_second = None
    for line in capture['stdout'].splitlines():
        match = re.match(r'^(\d{9,}(?:\.\d+)?)\s+(IP6?|ARP)\s+(.+)$', line)
        if not match:
            continue
        second = int(float(match.group(1)))
        if first_second is None:
            first_second = second
        offset = max(0, second - first_second)
        buckets[offset] = buckets.get(offset, 0) + 1
        body = match.group(3)
        if match.group(2) == 'ARP':
            kind = 'arp'
        elif re.search(r'\bICMP6?\b', body):
            kind = 'icmp'
        elif re.search(r'\bUDP\b', body):
            kind = 'udp'
        elif re.search(r'\b(?:tcp|Flags)\b', body):
            kind = 'tcp'
        else:
            kind = 'other'
        protocols[kind] = protocols.get(kind, 0) + 1
        if match.group(2) == 'ARP' or ' > ' not in body:
            continue
        source, tail = body.split(' > ', 1)
        if ': ' not in tail:
            continue
        destination = tail.split(': ', 1)[0]
        if not source or not destination:
            continue
        for endpoint in (source, destination):
            if endpoint not in peers:
                peers[endpoint] = 'peer-' + str(len(peers) + 1)
        key = (peers[source], peers[destination], kind)
        flows[key] = flows.get(key, 0) + 1
    return dict(code=0, interface=interface, filter=dict(protocol=protocol, port=port),
                elapsedMs=elapsed_ms, stopReason='packet-limit' if capture['code'] == 0 else 'duration',
                capturedPackets=sum(protocols.values()), protocolCounts=protocols,
                packetsBySecond=[dict(second=second, packets=count) for second, count in sorted(buckets.items())],
                flows=[dict(source=source, destination=destination, protocol=kind, packets=count)
                       for (source, destination, kind), count in sorted(flows.items(), key=lambda item: -item[1])[:20]],
                redacted=True, payloadIncluded=False, addressesIncluded=False)


def capability_execute(root, operation, p):
    if operation == 'packet-capture':
        return packet_capture(root, p)
    if operation == 'network-diagnostics':
        return network_diagnostics(root, p)
    if operation == 'dependency-report':
        return dependency_report(root, p)
    if operation == 'runtime-matrix':
        return runtime_matrix(root, p)
    if operation == 'reproducible-env':
        return reproducible_environment(root, p)
    if operation == 'git-worktrees':
        def worktrees():
            output = run(['git', 'worktree', 'list', '--porcelain', '-z'], root)['stdout']
            records = []
            for block in output.split('\0\0'):
                entry = {}
                for line in block.split('\0'):
                    if not line:
                        continue
                    key, _, value = line.partition(' ')
                    entry[key] = value or True
                if entry.get('worktree'):
                    entry['directory'] = str(Path(entry.pop('worktree')))
                    entry['current'] = Path(entry['directory']) == root
                    records.append(entry)
            return records
        mode = p['mode']
        records = worktrees()
        if mode == 'list':
            return dict(worktrees=records)
        if mode == 'create':
            if not p.get('path') or '.git' in PurePosixPath(p['path']).parts or '.sakura' in PurePosixPath(p['path']).parts:
                raise Failure('需要普通项目子目录 path')
            destination = safe_path(root, p['path'])
            if destination.exists() or len(records) >= 20:
                raise Failure('目标必须不存在，每个仓库最多管理 20 个工作树')
            commit = run(['git', 'rev-parse', '--verify', p.get('ref', 'HEAD') + '^{commit}'], root)['stdout'].strip()
            arguments = ['git', 'worktree', 'add']
            if p.get('branch'):
                run(['git', 'check-ref-format', '--branch', p['branch']], root)
                arguments += ['-b', p['branch']]
            else:
                arguments += ['--detach']
            destination.parent.mkdir(parents=True, exist_ok=True)
            run([*arguments, str(destination), commit], root)
            return dict(directory=str(destination), worktrees=worktrees())
        entry = next((item for item in records if item['directory'] == p.get('directory')), None)
        if not entry:
            raise Failure('请选择 Git 已登记的工作树目录')
        target = Path(entry['directory'])
        if not target.is_dir() or any(part.is_symlink() for part in [target, *target.parents]):
            raise Failure('工作树目录必须存在且不经过符号链接')
        expected = Path(run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], root)['stdout'].strip()).resolve()
        actual = Path(run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], target)['stdout'].strip()).resolve()
        if expected != actual:
            raise Failure('目标工作树所属仓库不匹配')
        if mode == 'remove':
            if target == root:
                raise Failure('不能删除当前工作树')
            run(['git', 'worktree', 'remove', str(target)], root)
            return dict(removed=str(target), worktrees=worktrees())
        return dict(directory=str(target), worktrees=records)
    if operation == 'workspace-search':
        query = p['query'] if p['caseSensitive'] else p['query'].casefold()
        matches, total = [], 0
        entries = text_inventory(root)
        for entry in entries:
            for number, line in enumerate(entry['text'].splitlines(), 1):
                if query in (line if p['caseSensitive'] else line.casefold()):
                    total += 1
                    if len(matches) < p['limit']:
                        matches.append(dict(path=entry['path'], line=number, text=line[:1000]))
        return dict(matches=matches, totalMatches=total, files=len(entries))
    if operation == 'review-threads':
        return capability_execute(root, 'review-comments', p)
    if operation == 'build-cache':
        inputs = []
        for name in sorted(set(p['inputs'])):
            file = safe_path(root, name, True)
            if not file.is_file():
                raise Failure('缓存输入必须是普通文件：' + name)
            inputs.extend(manifest(root, name))
        fingerprint = dict(namespace=p['namespace'], path=p['path'],
                           inputs=[dict(path=item['path'], sha256=item['sha256']) for item in inputs])
        key = hashlib.sha256(json.dumps(fingerprint, sort_keys=True).encode()).hexdigest()
        relative = '.sakura/build-cache/' + key + '.json'
        index = safe_path(root, relative)
        record = json.loads(read_text(root, relative)) if index.exists() else None
        if p['mode'] == 'inspect':
            return dict(key=key, hit=record is not None, record=record)
        if p['mode'] == 'save':
            if record:
                return dict(key=key, hit=True, record=record, saved=False)
            snapshot = directory_revision(root, dict(mode='snapshot', path=p['path'], label='构建缓存 ' + key[:12]))
            record = dict(key=key, fingerprint=fingerprint, **snapshot)
            atomic_json(root, relative, record)
            return dict(key=key, hit=False, saved=True, record=record)
        if not record:
            raise Failure('没有匹配输入指纹的构建缓存')
        if not p.get('target'):
            raise Failure('恢复缓存需要新的 target 目录')
        result = directory_revision(root, dict(mode='restore', path=p['path'], revision=record['revision'], target=p['target']))
        return dict(key=key, hit=True, **result)
    if operation == 'onboarding-checklist':
        relative = '.sakura/onboarding.json'
        file = safe_path(root, relative)
        data = json.loads(read_text(root, relative)) if file.exists() else dict(steps=[])
        mode, member = p['mode'], p['member']
        if mode == 'add':
            if not p.get('title') or len(data['steps']) >= 300:
                raise Failure('需要步骤标题，且最多保存 300 个步骤')
            data['steps'].append(dict(id=str(uuid.uuid4()), title=p['title'], createdAt=time.time(), completed={}))
        elif mode != 'list':
            step = next((item for item in data['steps'] if item['id'] == p.get('stepId')), None)
            if step is None:
                raise Failure('入门步骤不存在')
            if mode == 'remove':
                data['steps'].remove(step)
            elif mode == 'complete':
                if member not in step['completed'] and len(step['completed']) >= 200:
                    raise Failure('每个步骤最多记录 200 位成员')
                step['completed'][member] = time.time()
            elif mode == 'reopen':
                step['completed'].pop(member, None)
        if mode != 'list':
            atomic_json(root, relative, data)
        steps = [dict(item, done=member in item['completed']) for item in data['steps']]
        return dict(member=member, steps=steps, completed=sum(item['done'] for item in steps), total=len(steps))
    if operation == 'branch-preview':
        relative = '.sakura/branch-previews.json'
        file = safe_path(root, relative)
        records = json.loads(read_text(root, relative)) if file.exists() else []
        if p['mode'] == 'create':
            if len(records) >= 30:
                raise Failure('最多保留 30 个分支预览')
            commit = run(['git', 'rev-parse', '--verify', p['ref'] + '^{commit}'], root)['stdout'].strip()
            identifier = str(uuid.uuid4())
            path = '.sakura/previews/' + identifier
            target = safe_path(root, path)
            target.parent.mkdir(parents=True, exist_ok=True)
            run(['git', 'worktree', 'add', '--detach', str(target), commit], root)
            record = dict(id=identifier, ref=p['ref'], commit=commit, path=path, createdAt=time.time())
            records.append(record)
            try:
                atomic_json(root, relative, records)
            except BaseException:
                run(['git', 'worktree', 'remove', str(target)], root, check=False)
                raise
            return dict(preview=record, directory=str(target))
        if p['mode'] == 'remove':
            record = next((item for item in records if item['id'] == p.get('previewId')), None)
            if not record:
                raise Failure('分支预览不存在')
            target = safe_path(root, record['path'], True)
            # Git itself rejects untracked/dirty worktrees. Never force removal.
            run(['git', 'worktree', 'remove', str(target)], root)
            records.remove(record)
            atomic_json(root, relative, records)
        return dict(previews=[dict(item, exists=safe_path(root, item['path']).is_dir()) for item in records])
    if operation == "patch-bundle":
        if p["mode"] == "keygen":
            private = safe_path(root, p["target"])
            public = safe_path(root, p.get("publicKey") or p["target"] + '.pub')
            if private.exists() or public.exists() or private == public:
                raise Failure("密钥目标必须是两个不存在的文件")
            private.parent.mkdir(parents=True, exist_ok=True)
            public.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix=".sakura-key-", dir=private.parent) as temporary:
                key = Path(temporary) / "private.pem"
                pub = Path(temporary) / "public.pem"
                run(["openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(key)])
                key.chmod(0o600)
                run(["openssl", "pkey", "-in", str(key), "-pubout", "-out", str(pub)])
                with os.fdopen(os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
                    stream.write(key.read_bytes())
                private.chmod(0o600)
                try:
                    with public.open('xb') as stream:
                        stream.write(pub.read_bytes())
                except BaseException:
                    private.unlink()
                    raise
            return dict(privateKey=p["target"], publicKey=public.relative_to(root).as_posix())
        if p["mode"] == "create":
            if not p.get("from") or not p.get("privateKey"):
                raise Failure("导出需要 from 和 privateKey")
            destination = safe_path(root, p["target"])
            if destination.exists():
                raise Failure("补丁包目标已存在")
            key = safe_path(root, p["privateKey"], True)
            start = run(["git", "rev-parse", "--verify", p["from"] + "^{commit}"], root)["stdout"].strip()
            end = run(["git", "rev-parse", "--verify", p["to"] + "^{commit}"], root)["stdout"].strip()
            patch = run(["git", "format-patch", "--stdout", start + ".." + end, "--"], root)["stdout"].encode()
            if not patch:
                raise Failure("提交区间没有可导出的补丁")
            envelope = dict(format="sakura-signed-patch-v1", algorithm="Ed25519", start=start, end=end,
                            sha256=hashlib.sha256(patch).hexdigest(), patch=base64.b64encode(patch).decode())
            payload = json.dumps(envelope, sort_keys=True, separators=(',', ':')).encode()
            with tempfile.TemporaryDirectory(prefix="sakura-patch-") as temporary:
                message, signature = Path(temporary) / "payload", Path(temporary) / "signature"
                public_der = Path(temporary) / 'public.der'
                run(['openssl', 'pkey', '-in', str(key), '-pubout', '-outform', 'DER', '-out', str(public_der)])
                raw_public = public_der.read_bytes()
                if len(raw_public) != 44 or not raw_public.startswith(bytes.fromhex('302a300506032b6570032100')):
                    raise Failure('补丁签名只接受 Ed25519 密钥')
                message.write_bytes(payload)
                run(["openssl", "pkeyutl", "-sign", "-rawin", "-inkey", str(key), "-in", str(message), "-out", str(signature)])
                envelope["signature"] = base64.b64encode(signature.read_bytes()).decode()
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('x', encoding='utf-8') as output:
                json.dump(envelope, output, ensure_ascii=False)
            return dict(target=p["target"], sha256=envelope["sha256"], start=start, end=end, bytes=len(patch))
        if not p.get("publicKey"):
            raise Failure("验证必须指定独立受信任的 publicKey")
        envelope = json.loads(read_text(root, p["target"]))
        if set(envelope) != {"format", "algorithm", "start", "end", "sha256", "patch", "signature"} or envelope["format"] != 'sakura-signed-patch-v1' or envelope["algorithm"] != 'Ed25519':
            raise Failure("补丁包格式无效")
        signature = base64.b64decode(envelope.pop("signature"), validate=True)
        patch = base64.b64decode(envelope["patch"], validate=True)
        if hashlib.sha256(patch).hexdigest() != envelope["sha256"]:
            raise Failure("补丁校验和不一致")
        key = safe_path(root, p["publicKey"], True)
        with tempfile.TemporaryDirectory(prefix='sakura-patch-verify-') as temporary:
            message, signature_file = Path(temporary) / 'payload', Path(temporary) / 'signature'
            public_der = Path(temporary) / 'public.der'
            run(['openssl', 'pkey', '-pubin', '-in', str(key), '-pubout', '-outform', 'DER', '-out', str(public_der)])
            raw_public = public_der.read_bytes()
            if len(raw_public) != 44 or not raw_public.startswith(bytes.fromhex('302a300506032b6570032100')):
                raise Failure('补丁验签只接受 Ed25519 公钥')
            message.write_bytes(json.dumps(envelope, sort_keys=True, separators=(',', ':')).encode())
            signature_file.write_bytes(signature)
            run(["openssl", "pkeyutl", "-verify", "-rawin", "-pubin", "-inkey", str(key), "-in", str(message), "-sigfile", str(signature_file)])
        return dict(verified=True, sha256=envelope['sha256'], start=envelope['start'], end=envelope['end'])
    if operation == "format-lint":
        tool = p["tool"]
        if tool == 'auto':
            tool = 'npm' if safe_path(root, 'package.json').exists() else 'cargo' if safe_path(root, 'Cargo.toml').exists() else 'go' if safe_path(root, 'go.mod').exists() else 'ruff'
        mode = p['mode']
        if tool == 'npm':
            package = json.loads(read_text(root, 'package.json'))
            script = 'format' if mode == 'format' else 'lint:fix' if mode == 'fix' and 'lint:fix' in package.get('scripts', {}) else 'lint'
            if script not in package.get('scripts', {}):
                raise Failure('package.json 缺少脚本：' + script)
            args = ['npm', 'run', script] + (['--', '--fix'] if mode == 'fix' and script == 'lint' else [])
        elif tool == 'ruff':
            args = ['ruff', 'format', '.'] if mode == 'format' else ['ruff', 'check', '.'] + (['--fix'] if mode == 'fix' else [])
        elif tool == 'cargo':
            args = ['cargo', 'fmt', '--all'] if mode == 'format' else ['cargo', 'clippy', '--all-targets'] + (['--fix', '--allow-dirty', '--allow-staged'] if mode == 'fix' else ['--', '-D', 'warnings'])
        else:
            if mode == 'lint':
                args = ['go', 'vet', './...']
            else:
                files = [name for name, _ in files_under(root, '.', ('vendor', '.git', '.sakura')) if name.endswith('.go')]
                if not files:
                    raise Failure('项目没有 Go 源文件')
                args = ['gofmt', '-w', *files]
        return dict(tool=tool, mode=mode, **compact_command(run(args, root, timeout=p['timeout'], check=False)))
    if operation == "environment-recreate":
        target = safe_path(root, p['target'])
        if target.exists() or '.sakura' in target.relative_to(root).parts:
            raise Failure('重建目标必须是新的项目目录')
        commit = run(['git', 'rev-parse', 'HEAD'], root)['stdout'].strip()
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='sakura-environment-') as temporary:
            archive_path = Path(temporary) / 'source.tar'
            run(['git', 'archive', '--format=tar', '--output=' + str(archive_path), commit], root)
            with tarfile.open(archive_path) as archive:
                entries = archive_members(archive)
                target.mkdir()
                for member in entries:
                    destination = safe_path(target, member.name)
                    if member.isdir():
                        destination.mkdir(parents=True, exist_ok=True)
                    else:
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        with archive.extractfile(member) as source, destination.open('xb') as output:
                            shutil.copyfileobj(source, output)
                        destination.chmod(member.mode & 0o777)
        candidates = [('package-lock.json', ['npm', 'ci']), ('pnpm-lock.yaml', ['pnpm', 'install', '--frozen-lockfile']),
                      ('yarn.lock', ['yarn', 'install', '--frozen-lockfile']), ('uv.lock', ['uv', 'sync', '--frozen']),
                      ('poetry.lock', ['poetry', 'install', '--sync']), ('Cargo.lock', ['cargo', 'fetch', '--locked']),
                      ('go.sum', ['go', 'mod', 'download'])]
        selected = next(((name, args) for name, args in candidates if (target / name).is_file()), None)
        if selected is None:
            raise Failure('新目录已创建，但没有支持的锁文件；原项目未修改', target=p['target'], commit=commit)
        name, args = selected
        result = run(args, target, timeout=p['timeout'], check=False)
        return dict(target=p['target'], commit=commit, lockfile=name, **compact_command(result))
    if operation == "capability-command":
        started = time.monotonic()
        result = run(p["argv"], root, timeout=p["timeout"], check=False)
        return dict(compact_command(result), durationMs=(time.monotonic() - started) * 1000)
    if operation == "test-sharding":
        if len(set(p["files"])) != len(p["files"]):
            raise Failure("测试文件不能重复")
        buckets = [[] for _ in range(p["shards"])]
        for value in sorted(p["files"]):
            file = safe_path(root, value, True)
            if not file.is_file():
                raise Failure("测试目标不是文件：" + value)
            index = int(hashlib.sha256(value.encode()).hexdigest(), 16) % p["shards"]
            buckets[index].append(value)
        plan = [dict(index=index, files=files) for index, files in enumerate(buckets)]
        if p["mode"] == "plan":
            return dict(shards=plan, totalFiles=len(p["files"]))
        if not p.get("argv") or "{files}" not in p["argv"]:
            raise Failure("run 的 argv 必须包含独立的 {files} 参数")
        results = []
        for shard in plan:
            if not shard["files"]:
                results.append(dict(shard, skipped=True, code=0))
                continue
            args = [part for arg in p["argv"] for part in (shard["files"] if arg == "{files}" else [arg])]
            started = time.monotonic()
            environment = dict(os.environ, SAKURA_SHARD_INDEX=str(shard["index"]), SAKURA_SHARD_TOTAL=str(p["shards"]))
            result = run(args, root, timeout=p["timeout"], env=environment, check=False)
            results.append(dict(shard, durationMs=(time.monotonic() - started) * 1000, **compact_command(result)))
        value = dict(code=1 if any(item["code"] for item in results) else 0, shards=results, totalFiles=len(p["files"]))
        history(root, operation, value)
        return value
    if operation == "directory-history":
        return directory_revision(root, p)
    if operation == "disk-analyzer":
        source = safe_path(root, p["path"], True)
        entries = files_under(root, p["path"], (".sakura",))
        types, directories, largest, total = {}, {}, [], 0
        for name, file in entries:
            size = file.stat().st_size
            extension = file.suffix.lower() or "(无扩展名)"
            item = types.setdefault(extension, dict(type=extension, bytes=0, files=0))
            item["bytes"] += size
            item["files"] += 1
            total += size
            largest.append(dict(path=name, bytes=size))
            relative = file.relative_to(source) if source.is_dir() else Path(file.name)
            for depth in range(min(len(relative.parts), p["depth"] + 1)):
                key = "/".join(relative.parts[:depth]) or "."
                directories[key] = directories.get(key, 0) + size
        return dict(path=p["path"], totalBytes=total, files=len(entries),
                    types=sorted(types.values(), key=lambda item: (-item["bytes"], item["type"])),
                    directories=[dict(path=name, bytes=size) for name, size in sorted(directories.items())],
                    largest=sorted(largest, key=lambda item: -item["bytes"])[:30])
    if operation == "review-comments":
        relative = ".sakura/review-threads.json"
        file = safe_path(root, relative)
        threads = json.loads(read_text(root, relative)) if file.exists() else []
        if p["mode"] == "list":
            return dict(threads=[item for item in threads if not p.get("path") or item["path"] == p["path"]])
        if p["mode"] == "comment":
            if not p.get("path") or not p.get("line") or not p.get("body"):
                raise Failure("新评论需要 path、line 和 body")
            if len(threads) >= 1000:
                raise Failure("当前项目最多保存 1000 个评审线程")
            text = read_text(root, p["path"])
            if p["line"] > max(1, len(text.splitlines())):
                raise Failure("评论行号超出文件范围")
            commit = run(["git", "rev-parse", "HEAD"], root, check=False)["stdout"].strip() if shutil.which("git") else ""
            thread = dict(id=str(uuid.uuid4()), path=p["path"], line=p["line"], resolved=False, createdAt=time.time(),
                          commit=commit, fileSha256=hashlib.sha256(text.encode()).hexdigest(), comments=[])
            threads.append(thread)
        else:
            thread = next((item for item in threads if item["id"] == p.get("threadId")), None)
            if thread is None:
                raise Failure("评审线程不存在")
        if p["mode"] in ("comment", "reply"):
            if not p.get("body"):
                raise Failure("评论内容不能为空")
            if len(thread["comments"]) >= 100:
                raise Failure("每个线程最多 100 条回复")
            thread["comments"].append(dict(id=str(uuid.uuid4()), body=p["body"], author=p["author"], createdAt=time.time()))
        elif p["mode"] in ("resolve", "reopen"):
            thread["resolved"] = p["mode"] == "resolve"
        thread["updatedAt"] = time.time()
        if len(json.dumps(threads).encode()) > MAX_OUTPUT:
            raise Failure("评审记录超过 2 MiB")
        atomic_json(root, relative, threads)
        return dict(thread=thread)
    if operation == "command-forms":
        fields = {field["name"]: field for field in p["fields"]}
        if len(fields) != len(p["fields"]) or set(p["values"]) - fields.keys():
            raise Failure("字段重复或包含未声明的参数")
        values = {}
        for name, field in fields.items():
            value = p["values"].get(name)
            if value is None or value == "":
                if field["required"]:
                    raise Failure("必填参数缺失：" + name)
                values[name] = ""
                continue
            kind = field["type"]
            if kind == "integer" and (isinstance(value, bool) or not isinstance(value, int)):
                raise Failure("参数必须是整数：" + name)
            if kind == "boolean" and not isinstance(value, bool):
                raise Failure("参数必须是布尔值：" + name)
            if kind in ("string", "choice") and not isinstance(value, str):
                raise Failure("参数必须是文本：" + name)
            if kind == "choice" and value not in field.get("choices", []):
                raise Failure("参数不在可选值中：" + name)
            values[name] = str(value).lower() if isinstance(value, bool) else str(value)
        def substitute(match):
            if match[1] not in values:
                raise Failure("命令引用未声明参数：" + match[1])
            return values[match[1]]
        args = [re.sub(r"\$\{([A-Z_][A-Z0-9_]*)\}", substitute, value) for value in p["argv"]]
        if not args[0] or "\x00" in "".join(args):
            raise Failure("命令参数无效")
        if p["mode"] == "preview":
            return dict(argv=args, display=shlex.join(args), fields=p["fields"])
        return dict(argv=args, **compact_command(run(args, root, timeout=p["timeout"], check=False)))
    if operation == "environment-fingerprint":
        tools = {}
        for tool, args in (("node", ["node", "--version"]), ("python", ["python3", "--version"]),
                           ("rust", ["rustc", "--version"]), ("go", ["go", "version"]), ("git", ["git", "--version"])):
            tools[tool] = run(args, root, check=False)["stdout"].strip() if shutil.which(args[0]) else None
        locks = {}
        for name in ("package-lock.json", "pnpm-lock.yaml", "yarn.lock", "uv.lock", "poetry.lock", "requirements.txt", "Cargo.lock", "go.sum"):
            file = safe_path(root, name)
            if file.exists():
                if file.stat().st_size > 16 * 1024 * 1024:
                    raise Failure("锁文件过大：" + name)
                locks[name] = hashlib.sha256(file.read_bytes()).hexdigest()
        system = Path("/etc/os-release").read_text() if Path("/etc/os-release").exists() else sys.platform
        return dict(fingerprint=dict(system=system, tools=tools, locks=locks))
    if operation == "network-topology":
        interfaces = json.loads(run(["ip", "-j", "address", "show"])["stdout"])
        routes = json.loads(run(["ip", "-j", "route", "show", "table", "all"])["stdout"])
        sockets = run(["ss", "-H", "-lntu"])["stdout"].splitlines()
        return dict(interfaces=interfaces, routes=routes, listeners=sockets)
    if operation == "language-server-catalog":
        servers = []
        for name, command in (("TypeScript", "typescript-language-server"), ("Python", "pyright-langserver"),
                              ("Python Ruff", "ruff"), ("Rust", "rust-analyzer"), ("Go", "gopls"), ("C/C++", "clangd")):
            executable = shutil.which(command)
            result = run([executable, "--version"], root, timeout=5, check=False) if executable else None
            servers.append(dict(name=name, command=command, path=executable, installed=bool(executable),
                                version=((result["stdout"] or result["stderr"]).strip()[:1000] if result else None),
                                versionExitCode=result["code"] if result else None))
        return dict(servers=servers, installed=sum(item["installed"] for item in servers))
    if operation == "code-search-index":
        relative = ".sakura/code-index.json"
        if p["mode"] == "build":
            entries = text_inventory(root)
            value = dict(createdAt=time.time(), entries=entries)
            atomic_json(root, relative, value)
            return dict(createdAt=value["createdAt"], files=len(entries), bytes=sum(item["size"] for item in entries))
        if not p.get("query"):
            raise Failure("搜索需要 query")
        index_file = safe_path(root, relative, True)
        if index_file.stat().st_size > 256 * 1024 * 1024:
            raise Failure("索引文件超出上限")
        data = json.loads(index_file.read_text("utf-8"))
        query = p["query"] if p["caseSensitive"] else p["query"].casefold()
        matches, stale, count = [], [], 0
        for entry in data["entries"]:
            file = safe_path(root, entry["path"])
            if not file.is_file() or (file.stat().st_size, file.stat().st_mtime_ns) != (entry["size"], entry["mtime"]):
                stale.append(entry["path"])
            for number, line in enumerate(entry["text"].splitlines(), 1):
                candidate = line if p["caseSensitive"] else line.casefold()
                if query in candidate:
                    count += 1
                    if len(matches) < p["limit"]:
                        matches.append(dict(path=entry["path"], line=number, text=line[:1000]))
        return dict(matches=matches, totalMatches=count, stale=stale, createdAt=data["createdAt"],
                    message="搜索使用索引快照；新增文件需重建索引。")
    if operation == "pii-classification":
        rules = [("email", r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}"),
                 ("phone", r"(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)"),
                 ("identity-number", r"(?<!\d)\d{17}[\dXx](?!\d)"),
                 ("ipv4", r"(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)"),
                 ("private-key", r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----"),
                 ("credential", r"(?i)(?:api[_-]?key|password|secret|token)\s*[:=]\s*['\"]?[^\s'\"]{8,}")]
        findings = []
        for name in p["paths"]:
            text = read_text(root, name)
            for number, line in enumerate(text.splitlines(), 1):
                for kind, pattern in rules:
                    if re.search(pattern, line):
                        findings.append(dict(path=name, line=number, type=kind))
                        if len(findings) > 5000:
                            raise Failure("敏感数据匹配超过 5000 项")
        return dict(findings=findings, files=len(p["paths"]), classification="sensitive" if findings else "no-rule-match")
    raise Failure("没有此能力的执行器：" + operation)


def main():
    request = json.load(sys.stdin)
    root = Path(request["directory"]).resolve(strict=True)
    if not root.is_dir():
        raise Failure("项目目录不存在")
    os.environ.update(request.get("environment", {}))
    executor = capability_execute if request["operation"] in CAPABILITY_OPERATIONS else execute
    result = executor(root, request["operation"], request.get("parameters", {}))
    result.setdefault("code", 0)
    result["operation"] = request["operation"]
    return result


if __name__ == "__main__":
    # guestTask cancels our process group; unwind run() to kill its child group too.
    if os.name != "nt":
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
        signal.signal(signal.SIGHUP, lambda *_: sys.exit(129))
    try:
        response = main()
    except Failure as error:
        response = dict(code=error.code, error=str(error), **error.details)
    except Exception as error:
        response = dict(code=1, error=type(error).__name__ + ": " + str(error))
    print(json.dumps(response, ensure_ascii=False, allow_nan=False))
    sys.exit(0 if response.get("code", 0) == 0 else 1)
