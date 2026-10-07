/**
 * 模块职责：回归验证模块，围绕 `ssh-files` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ssh-files`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: SSH permissions protect actual files with quoted Unicode paths and reject links.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { secureSshPaths } from '../server/ssh-files.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH permissions protect actual files with quoted Unicode paths and reject links
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.equal(protectedRules, 'True')`; `assert.deepEqual(new Set(principals), new Set([owner, 'S-1-5-18', 'S-1-5-32-544']))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('SSH permissions protect actual files with quoted Unicode paths and reject links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-ssh-files-'));
  const folder = join(root, "中文 it's $(quoted)"),
    file = join(folder, 'identity');
  await mkdir(folder);
  await writeFile(file, 'fixture identity');
  const run = promisify(execFile);
  try {
    await secureSshPaths([folder, file]);
    if (process.platform === 'win32') {
      const script =
        `$owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().User\n` +
        `$acl=[System.IO.File]::GetAccessControl('${file.replaceAll("'", "''")}')\n` +
        `[Console]::WriteLine($owner.Value); [Console]::WriteLine($acl.AreAccessRulesProtected)\n` +
        `foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) { [Console]::WriteLine($rule.IdentityReference.Value) }`;
      const { stdout } = await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { windowsHide: true, timeout: 15_000 },
      );
      const [owner, protectedRules, ...principals] = stdout.trim().split(/\r?\n/);
      assert.equal(protectedRules, 'True');
      assert.deepEqual(new Set(principals), new Set([owner, 'S-1-5-18', 'S-1-5-32-544']));
    } else {
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.equal((await stat(folder)).mode & 0o777, 0o700);
    }
    const alias = join(root, 'linked-folder');
    await symlink(folder, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(secureSshPaths([alias]), /链接|联接/);
    await assert.rejects(secureSshPaths([join(alias, 'identity')]), /链接|联接/);
  } finally {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.match(root, /sakura-ssh-files-/);
    await rm(root, { recursive: true, force: true });
  }
});
