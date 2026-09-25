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
import json
import os
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


def main():
    request = json.load(sys.stdin)
    root = Path(request["directory"]).resolve(strict=True)
    if not root.is_dir():
        raise Failure("项目目录不存在")
    os.environ.update(request.get("environment", {}))
    result = execute(root, request["operation"], request.get("parameters", {}))
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
