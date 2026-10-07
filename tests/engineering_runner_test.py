# 模块职责：工程执行器回归：隔离任务输入、工具调用与异常，核对生产执行器定义。
# Module: Engineering-runner regression: isolate task inputs, tool calls and failures while checking production runner definitions.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
import sys
sys.dont_write_bytecode = True
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("engineering", Path(__file__).resolve().parents[1] / "server/engineering-runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class Engineering(unittest.TestCase):
    # 中文功能：准备本用例的独立目录与状态，使用例之间的输入和失败注入相互隔离。
    # English: Prepare a private directory and state for this case so inputs and injected failures are isolated between cases.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `self.directory`, `self.root`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `tempfile.TemporaryDirectory`, `Path`.
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="sakura-engineering-test-")
        self.root = Path(self.directory.name)

    # 中文功能：执行测试或夹具中的关闭、释放、删除或终止步骤；实际对象及拒绝条件以函数体为准。
    # English: Perform closing, release, removal or termination within the test/model; the body defines the affected objects and rejection conditions.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.directory.cleanup`.
    def tearDown(self):
        self.directory.cleanup()

    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, name, content。
    # 结果：返回分支计算值（`path`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`path`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `path.parent.mkdir`, `path.write_text`.
    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self, *args。
    # 结果：返回分支计算值（`runner.run(['git', *args], self.root)['stdout'].strip()`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`runner.run(['git', *args], self.root)['stdout'].strip()`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `runner.run(['git', *args], self.root)['stdout'].strip`, `runner.run`.
    def git(self, *args):
        return runner.run(["git", *args], self.root)["stdout"].strip()

    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.git`, `self.commit`.
    def repository(self):
        self.git("init", "-b", "codex/test")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.commit("base.txt", "base", "feat: base")

    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: self, name, content, message。
    # 结果：返回分支计算值（`self.git('rev-parse', 'HEAD')`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`self.git('rev-parse', 'HEAD')`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `self.write`, `self.git`.
    def commit(self, name, content, message):
        self.write(name, content)
        self.git("add", name)
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: self, op, **p。
    # 结果：返回分支计算值（`runner.execute(self.root, op, p)`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`runner.execute(self.root, op, p)`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `runner.execute`.
    def execute(self, op, **p):
        return runner.execute(self.root, op, p)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.write`, `self.execute`, `self.assertEqual`, `len`.
    def test_manifest_size_hash_mtime_output_and_limits(self):
        self.write("src/a.txt", "hello")
        result = self.execute("hash-manifest", path="src", output="manifest.json")
        self.assertEqual(result["entries"][0]["size"], 5)
        self.assertEqual(len(result["entries"][0]["sha256"]), 64)
        self.assertIn("mtime", result["entries"][0])
        self.assertEqual(json.loads((self.root / "manifest.json").read_text()), result)
        with patch.object(runner, "MAX_BYTES", 4):
            with self.assertRaises(runner.Failure):
                self.execute("hash-manifest", path="src")

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `patch.object`, `runner.capability_execute`, `self.assertEqual`, `json.dumps`.
    def test_packet_capture_returns_only_anonymous_metadata_and_bounds_its_command(self):
        captured = {"code": 124, "stdout": (
            "1780000000.100 IP 192.0.2.10.50123 > 198.51.100.20.443: tcp 0\n"
            "1780000001.200 IP 192.0.2.10.50123 > 198.51.100.20.443: tcp 22 secret-query.example\n"
            "1780000001.300 IP 198.51.100.20.443 > 192.0.2.10.50123: tcp 0\n"
        ), "stderr": "listening on eth0"}
        with patch.object(runner.shutil, 'which', return_value='/usr/bin/tcpdump'), \
                patch.object(runner, 'run', return_value=captured) as invoke:
            result = runner.capability_execute(self.root, 'packet-capture', {
                'interface': 'eth0', 'durationSeconds': 2, 'maxPackets': 3,
                'protocol': 'tcp', 'port': 443,
            })
        args = invoke.call_args.args[0]
        self.assertEqual(args[:3], ['tcpdump', '-i', 'eth0'])
        self.assertEqual(args[-4:], ['tcp', 'and', 'port', '443'])
        self.assertEqual(invoke.call_args.kwargs['timeout'], 2)
        self.assertEqual(result['capturedPackets'], 3)
        self.assertEqual(result['protocolCounts'], {'tcp': 3})
        self.assertEqual(result['packetsBySecond'], [
            {'second': 0, 'packets': 1}, {'second': 1, 'packets': 2},
        ])
        self.assertEqual(result['stopReason'], 'duration')
        self.assertEqual(result['flows'][0]['source'], 'peer-1')
        report = json.dumps(result)
        for secret in ('192.0.2.10', '198.51.100.20', 'secret-query.example', '50123'):
            self.assertNotIn(secret, report)
        self.assertFalse(result['payloadIncluded'])
        with self.assertRaises(runner.Failure):
            runner.packet_capture(self.root, {'interface': '../eth0'})
        with self.assertRaises(runner.Failure):
            runner.packet_capture(self.root, {'protocol': 'icmp', 'port': 80})

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.write`, `self.execute`, `self.assertEqual`, `(self.root / 'src/escape').symlink_to`.
    @unittest.skipIf(os.name == "nt", "Linux filename and symlink semantics are verified in the guest")
    def test_windows_conflicts_and_symlinks_are_reported_or_rejected(self):
        self.write("src/Readme", "one")
        self.write("src/README", "two")
        self.write("src/CON.txt", "reserved")
        self.write("src/bad:name", "invalid")
        self.write("src/trailing.", "invalid")
        result = self.execute("case-conflict-report", path="src")
        self.assertEqual(result["code"], 1)
        self.assertEqual({v["rule"] for v in result["issues"]}, {"case-collision", "reserved-windows-name", "invalid-windows-name"})
        (self.root / "src/escape").symlink_to(self.root.parent, target_is_directory=True)
        with self.assertRaises(runner.Failure):
            self.execute("hash-manifest", path="src")

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.write`, `self.execute`, `self.assertEqual`, `len`.
    def test_archive_round_trip_and_no_overwrite(self):
        self.write("src/hello.txt", "hello")
        self.execute("archive", mode="create", path="src", target="archive.tar.gz")
        self.assertEqual(len(self.execute("archive", mode="list", path="archive.tar.gz")["members"]), 1)
        self.execute("archive", mode="extract", path="archive.tar.gz", target="expanded")
        self.assertEqual((self.root / "expanded/src/hello.txt").read_text(), "hello")
        with self.assertRaises(runner.Failure):
            self.execute("archive", mode="extract", path="archive.tar.gz", target="expanded")

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `busy.winerror`, `platform_os.name`, `platform_os.rename.side_effect`, `permanent.winerror`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `stage.mkdir`, `(stage / 'content').write_text`, `PermissionError`, `patch.object`.
    def test_directory_publication_retries_windows_sharing_without_overwriting_a_new_target(self):
        stage, target = self.root / "stage", self.root / "published"
        stage.mkdir()
        (stage / "content").write_text("owned", encoding="utf-8")
        busy = PermissionError("scanner sharing")
        busy.winerror = 32
        with patch.object(runner, "os", wraps=os) as platform_os, \
             patch.object(runner.time, "sleep") as sleep:
            platform_os.name = "nt"
            platform_os.rename.side_effect = [busy, None]
            runner.publish_new_directory(stage, target)
            self.assertEqual(platform_os.rename.call_count, 2)
            sleep.assert_called_once_with(.025)
        self.assertTrue(stage.exists())
        with patch.object(runner, "os", wraps=os) as platform_os, \
             patch.object(runner.time, "sleep", side_effect=lambda _seconds: target.mkdir()):
            platform_os.name = "nt"
            platform_os.rename.side_effect = busy
            with self.assertRaisesRegex(runner.Failure, "拒绝覆盖"):
                runner.publish_new_directory(stage, target)
            platform_os.rename.assert_called_once_with(stage, target)
        self.assertTrue(stage.exists())
        self.assertTrue(target.is_dir())
        permanent = PermissionError("denied")
        permanent.winerror = 1314
        with patch.object(runner, "os", wraps=os) as platform_os:
            platform_os.name = "nt"
            platform_os.rename.side_effect = permanent
            with self.assertRaises(PermissionError):
                runner.publish_new_directory(stage, self.root / "other")
            platform_os.rename.assert_called_once()

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `good.size`, `bad.size`, `link.type`, `link.linkname`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `enumerate`, `str`, `tarfile.open`, `tarfile.TarInfo`.
    def test_archive_rejects_all_members_before_writing(self):
        for index, name in enumerate(("../escape", "/outside", "a/../../escape", "C:/outside", "a\\b")):
            archive_path = self.root / ("malicious" + str(index) + ".tar")
            with tarfile.open(archive_path, "w") as archive:
                good = tarfile.TarInfo("good.txt"); good.size = 2
                archive.addfile(good, io.BytesIO(b"ok"))
                bad = tarfile.TarInfo(name); bad.size = 3
                archive.addfile(bad, io.BytesIO(b"bad"))
            with self.assertRaises(runner.Failure):
                self.execute("archive", mode="extract", path=archive_path.name, target="destination")
            self.assertFalse((self.root / "destination").exists())
        with tarfile.open(self.root / "link.tar", "w") as archive:
            link = tarfile.TarInfo("link"); link.type = tarfile.SYMTYPE; link.linkname = "../escape"
            archive.addfile(link)
        with self.assertRaises(runner.Failure):
            self.execute("archive", mode="extract", path="link.tar", target="destination")

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.write`, `self.execute`, `tarfile.open`, `self.assertEqual`.
    def test_template_excludes_private_data_and_detects_disguised_key(self):
        self.write("src/app.txt", "app")
        self.write(".env", "SECRET=hidden")
        self.write("id_rsa", "private")
        self.execute("project-template-pack", target="template.tar.gz", excludes=[])
        with tarfile.open(self.root / "template.tar.gz") as archive:
            self.assertEqual(archive.getnames(), ["src/app.txt"])
        self.write("key-disguised.txt", "-----BEGIN PRIVATE KEY-----")
        with self.assertRaises(runner.Failure):
            self.execute("project-template-pack", target="second.tar.gz", excludes=[])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `patch.dict`, `self.execute`, `self.assertEqual`, `len`.
    def test_environment_validation_never_returns_values(self):
        with patch.dict(os.environ, {"FLAG": "maybe", "NUM": "1-2", "MODE": "prod", "URL": "ftp://bad"}):
            result = self.execute("env-schema", rules={"FLAG": {"type": "boolean"}, "NUM": {"type": "integer"},
                "MODE": {"type": "string", "choices": ["dev"]}, "URL": {"type": "url"}, "UNDEFINED_SAKURA": {"required": True}})
        self.assertEqual(len(result["issues"]), 5)
        self.assertEqual(result["code"], 1)
        self.assertNotIn("maybe", json.dumps(result))
        with patch.dict(os.environ, {"FLAG": "false", "NUM": "-12", "MODE": "dev", "URL": "https://example.invalid"}):
            self.assertEqual(self.execute("env-schema", rules={"FLAG": {"type": "boolean"}, "NUM": {"type": "integer"},
                "MODE": {"choices": ["dev"]}, "URL": {"type": "url"}})["code"], 0)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.write`, `json.dumps`, `self.assertEqual`, `len`.
    def test_task_import_and_onboarding(self):
        self.write("package.json", json.dumps({"scripts": {"test": "test runner", "build": "builder"}}))
        self.write("Makefile", "test:\n\ttrue\n")
        self.write("Justfile", "hello:\n    true\n")
        self.write("Taskfile.yml", "version: '3'\ntasks:\n  demo:\n    cmds: [true]\n")
        self.write("package-lock.json", "{}")
        self.write("README.md", "- [ ] Configure database\n")
        self.assertEqual(len(self.execute("task-import")["tasks"]), 5)
        steps = self.execute("project-onboarding")["steps"]
        self.assertTrue(any(v.get("command") == "npm ci" for v in steps))
        self.assertTrue(any(v["title"] == "Configure database" for v in steps))

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.assertTrue`, `runner.satisfies`, `self.assertFalse`, `self.assertIsNone`.
    def test_version_constraints_and_missing_tools(self):
        self.assertTrue(runner.satisfies("v22.12.0", ">=22.0.0 <23"))
        self.assertFalse(runner.satisfies("v23.0.0", "^22.12.0"))
        self.assertFalse(runner.satisfies("v0.3.0", "^0.2.0"))
        self.assertIsNone(runner.satisfies("v22.1.0", "latest"))
        self.write("package.json", json.dumps({"engines": {"nonexistent-sakura-tool": ">=1"}}))
        self.assertEqual(self.execute("toolchain-check")["code"], 1)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.execute`, `self.assertEqual`, `self.assertFalse`, `target.exists`.
    def test_bootstrap_checks_do_not_execute_command(self):
        target = self.root / "marker"
        result = self.execute("bootstrap-dry-run", command="touch marker")
        self.assertEqual(result["code"], 0)
        self.assertFalse(target.exists())
        self.assertEqual(self.execute("bootstrap-dry-run", command="sakura-missing-tool --version")["code"], 1)
        self.assertNotEqual(self.execute("bootstrap-dry-run", command="echo $(touch marker)")["code"], 0)
        self.assertFalse(target.exists())

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.repository`, `self.git`, `self.commit`, `self.write`.
    def test_git_stash_reflog_cherry_pick_and_bisect(self):
        self.repository()
        base = self.git("rev-parse", "HEAD")
        second = self.commit("second.txt", "second", "feat: second")
        self.write("untracked.txt", "stash")
        self.execute("git-stash", mode="save", message="saved")
        self.assertFalse((self.root / "untracked.txt").exists())
        self.execute("git-stash", mode="apply", ref="stash@{0}")
        self.assertEqual((self.root / "untracked.txt").read_text(), "stash")
        self.execute("git-stash", mode="drop", ref="stash@{0}")
        (self.root / "untracked.txt").unlink()
        self.execute("git-cherry-pick", mode="revert", commit=second)
        self.assertFalse((self.root / "second.txt").exists())
        self.execute("git-cherry-pick", mode="pick", commit=second)
        self.assertTrue((self.root / "second.txt").exists())
        self.execute("git-bisect", mode="start", bad=second, good=base)
        self.assertIn("git bisect start", self.execute("git-bisect", mode="log")["stdout"])
        self.execute("git-bisect", mode="reset")
        self.execute("git-reflog", mode="recover", commit=base, branch="codex/recovered")
        self.assertEqual(self.git("branch", "--show-current"), "codex/recovered")
        self.assertEqual(self.git("rev-parse", "HEAD"), base)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.repository`, `self.git`, `self.commit`, `self.execute`.
    def test_rebase_plan_is_read_only_and_apply_reorders_and_rewords(self):
        self.repository()
        base = self.git("rev-parse", "HEAD")
        first = self.commit("first.txt", "first", "feat: first")
        second = self.commit("second.txt", "second", "feat: second")
        plan = self.execute("git-rebase", mode="plan", base=base)
        self.assertEqual(self.git("rev-parse", "HEAD"), second)
        self.assertFalse((self.root / ".git/rebase-merge").exists())
        with self.assertRaises(runner.Failure):
            self.execute("git-rebase", mode="apply", base=base, todo=[{"action": "pick", "commit": first}])
        self.execute("git-rebase", mode="apply", base=base, todo=[
            {"action": "pick", "commit": second}, {"action": "reword", "commit": first, "message": "fix: renamed"}])
        self.assertEqual(self.git("log", "-1", "--format=%s"), "fix: renamed")
        self.assertTrue((self.root / "second.txt").exists())
        self.assertEqual(len(plan["todo"]), 2)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.repository`, `self.git`, `self.commit`, `self.execute`.
    def test_rebase_conflict_continues_with_messages_and_abort_restores_head(self):
        self.repository()
        base = self.git("rev-parse", "HEAD")
        first = self.commit("base.txt", "first", "feat: first")
        second = self.commit("base.txt", "second", "feat: second")
        result = self.execute("git-rebase", mode="apply", base=base, todo=[
            {"action": "pick", "commit": second}, {"action": "reword", "commit": first, "message": "fix: preserved after conflict"}])
        self.assertNotEqual(result["code"], 0)
        self.write("base.txt", "resolved")
        self.git("add", "base.txt")
        result = self.execute("git-rebase", mode="continue")
        if result["code"]:
            self.write("base.txt", "resolved again")
            self.git("add", "base.txt")
            result = self.execute("git-rebase", mode="continue")
        self.assertEqual(result["code"], 0, result)
        self.assertEqual(self.git("log", "-1", "--format=%s"), "fix: preserved after conflict")
        self.assertFalse((self.root / ".git/sakura-engineering-rebase").exists())
        # Create a fresh conflict and exercise explicit abort.
        self.git("reset", "--hard", second)
        result = self.execute("git-rebase", mode="apply", base=base, todo=[
            {"action": "pick", "commit": second}, {"action": "pick", "commit": first}])
        self.assertNotEqual(result["code"], 0)
        self.assertEqual(self.execute("git-rebase", mode="abort")["code"], 0)
        self.assertEqual(self.git("rev-parse", "HEAD"), second)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.repository`, `self.assertEqual`, `self.execute`, `self.write`.
    def test_policy_secrets_and_ownership_return_real_diagnostics(self):
        self.repository()
        self.assertEqual(self.execute("git-policy", branchPrefixes=["codex/"], commitTypes=["feat"], message="feat: test")["code"], 0)
        self.assertEqual(self.execute("git-policy", branchPrefixes=["fix/"], commitTypes=["fix"], message="other")["code"], 1)
        value = "AKIA" + "A" * 16
        self.write("credentials.txt", value)
        self.git("add", "credentials.txt")
        result = self.execute("precommit-secrets")
        self.assertEqual(result["code"], 1)
        self.assertEqual(result["findings"][0]["path"], "credentials.txt")
        self.assertNotIn(value, json.dumps(result))
        self.write(".github/CODEOWNERS", "* @all\n/src/** @dev\n/src/private/ @security\n")
        mapped = self.execute("code-ownership", paths=["src/app.ts", "src/private/auth.ts", "README.md"])["paths"]
        self.assertEqual([m["owners"] for m in mapped], [["@dev"], ["@security"], ["@all"]])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.write`, `json.dumps`, `self.assertEqual`, `self.execute`.
    def test_coverage_formats_and_history_delta(self):
        self.write("summary.json", json.dumps({"total": {"lines": {"total": 10, "covered": 5, "pct": 50}}}))
        self.assertEqual(self.execute("coverage-history", path="summary.json")["delta"], {})
        self.write("summary.json", json.dumps({"total": {"lines": {"total": 10, "covered": 8, "pct": 80}}}))
        self.assertEqual(self.execute("coverage-history", path="summary.json")["delta"]["lines"], 30)
        self.write("lcov.info", "LF:10\nLH:7\nBRF:4\nBRH:2\nend_of_record\n")
        self.assertEqual(self.execute("coverage-history", path="lcov.info")["metrics"]["lines"]["pct"], 70)
        self.write("python.json", json.dumps({"totals": {"num_statements": 10, "covered_lines": 9, "percent_covered": 90}}))
        self.assertEqual(self.execute("coverage-history", path="python.json")["metrics"]["lines"]["pct"], 90)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.write`, `json.dumps`, `self.execute`, `self.assertEqual`.
    def test_sbom_and_license_classification(self):
        self.write("package-lock.json", json.dumps({"name": "test", "version": "1.0.0", "lockfileVersion": 3, "packages": {
            "": {"name": "test"}, "node_modules/a": {"version": "1.2.3", "license": "MIT"},
            "node_modules/b": {"version": "2.0.0", "license": "MIT OR GPL-3.0"}}}))
        result = self.execute("sbom")["bom"]
        self.assertEqual(result["bomFormat"], "CycloneDX")
        self.assertEqual(result["components"][0]["version"], "1.2.3")
        report = self.execute("license-report", allowed=["MIT"])
        self.assertEqual(report["code"], 1)
        self.assertEqual([p["status"] for p in report["packages"]], ["allowed", "review"])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.execute`, `self.assertEqual`, `self.assertTrue`, `self.assertFalse`.
    def test_failure_propagation_and_conditional_macros(self):
        result = self.execute("release-gates", checks=[{"name": "fail", "command": "exit 7", "timeout": 2},
            {"name": "never", "command": "touch should-not-exist", "timeout": 2}], artifacts=[])
        self.assertEqual(result["code"], 1)
        self.assertTrue(result["results"][1]["skipped"])
        self.assertFalse((self.root / "should-not-exist").exists())
        result = self.execute("command-macros", steps=[
            {"name": "fail", "argv": ["sh", "-c", "exit 3"], "timeout": 2},
            {"name": "recover", "argv": ["sh", "-c", "printf recovered"], "when": "failure", "timeout": 2}])
        self.assertEqual(result["code"], 1)
        self.assertIn("recovered", result["results"][1]["stdout"])

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.assertEqual`, `self.execute`.
    def test_repeated_tests_and_benchmarks_classify_failure(self):
        self.assertEqual(self.execute("flaky-tests", command="true", repeats=2, timeout=2)["classification"], "stable-pass")
        self.assertEqual(self.execute("flaky-tests", command="false", repeats=2, timeout=2)["classification"], "stable-fail")
        self.assertEqual(self.execute("flaky-tests", command="if test -f marker; then exit 1; else touch marker; fi", repeats=2, timeout=2)["classification"], "flaky")
        self.assertEqual(self.execute("benchmark-regression", command="sleep 0.1", repeats=2, timeout=2, baselineMs=1, thresholdPercent=20)["code"], 1)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `self.repository`, `self.write`, `self.execute`, `self.assertTrue`.
    def test_reproducible_build_uses_commit_and_compares_artifacts(self):
        self.repository()
        self.write("base.txt", "uncommitted")
        result = self.execute("reproducible-build", command="mkdir dist; cp base.txt dist/file", artifact="dist", timeout=5)
        self.assertTrue(result["equal"])
        self.assertEqual(result["manifests"][0]["dist/file"]["size"], 4)
        result = self.execute("reproducible-build", command="mkdir dist; pwd > dist/file", artifact="dist", timeout=5)
        self.assertFalse(result["equal"])
        self.assertEqual(result["code"], 1)

    # 中文功能：安排该边界情景的输入并执行断言，验证生产辅助流程或受控模型的对应行为。
    # English: Arrange inputs and assertions for this boundary case, verifying the corresponding production-helper or controlled-model behavior.
    # 输入 / Inputs: self。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `called.return_value`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `self.assertRaises`, `self.execute`, `patch.object`, `self.assertEqual`.
    def test_static_routes_and_missing_acl_are_not_success(self):
        with self.assertRaises(runner.Failure):
            self.execute("static-routes", mode="add", destination="0.0.0.0/0")
        with patch.object(runner, "run") as called:
            called.return_value = {"code": 0}
            self.execute("static-routes", mode="add", destination="10.0.0.0/24", gateway="10.0.1.1")
            self.assertEqual(called.call_args.args[0], ["ip", "-4", "route", "add", "10.0.0.0/24", "via", "10.0.1.1"])
            self.execute("guest-clock-policy", mode="sync", _hostEpochMs=1800000000000)
            self.assertEqual(called.call_args.args[0], ["date", "-u", "-s", "@1800000000"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
