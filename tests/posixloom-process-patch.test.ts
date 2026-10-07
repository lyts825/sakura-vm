/**
 * 模块职责：回归验证模块，围绕 `posixloom-process-patch` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `posixloom-process-patch`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: the pinned process patch verifies both artifacts, is repeatable, and refuses changed inputs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import ts from 'typescript';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the pinned process patch verifies both artifacts, is repeatable, and refuses changed inputs
 * 协作入口 / Collaborators: `import`, `JSON.parse`, `readFile`, `execFileSync('git', ['show', `${patch.commit}:src/core/process/native.ts`],…`.
 * 检查边界 / Checked boundaries: `assert.equal(result.sourceSha256, patch.patched)`; `assert.equal(createHash('sha256').update(changed).digest('hex'), patch.patched)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('the pinned process patch verifies both artifacts, is repeatable, and refuses changed inputs', async () => {
  const { patchPosixLoomProcess } = await import(
    new URL('../scripts/patch-posixloom-process.mjs', import.meta.url).href
  );
  const patch = JSON.parse(await readFile('scripts/patches/posixloom-process.json', 'utf8'));
  const original = execFileSync('git', ['show', `${patch.commit}:src/core/process/native.ts`], {
    cwd: '.vendor/posixloom',
    encoding: 'utf8',
    windowsHide: true,
  }).replaceAll('\r\n', '\n');
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: source: string。
   * 结果：返回分支计算值（`ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, …`）。
   * Result: Return the branch-computed value (`ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, …`).
   * 验证场景 / Scenario: the pinned process patch verifies both artifacts, is repeatable, and refuses changed inputs
   * 协作入口 / Collaborators: `ts.transpileModule`.
   */
  const compile = (source: string) =>
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText;
  const root = await mkdtemp(join(tmpdir(), 'sakura-process-patch-'));
  const source = join(root, 'src/core/process/native.ts'),
    output = join(root, 'dist/src/core/process/native.js');
  try {
    await mkdir(dirname(source), { recursive: true });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(source, original);
    await writeFile(output, compile(original) + '//# sourceMappingURL=native.js.map\n');
    const result = await patchPosixLoomProcess(root);
    assert.equal(result.sourceSha256, patch.patched);
    const changed = await readFile(source, 'utf8'),
      generated = await readFile(output, 'utf8');
    assert.equal(createHash('sha256').update(changed).digest('hex'), patch.patched);
    assert.equal(generated, compile(changed));
    assert.deepEqual(await patchPosixLoomProcess(root), result);
    await writeFile(output, generated + '\n// unexpected local change\n');
    await assert.rejects(patchPosixLoomProcess(root), /distribution changed/);
    assert.equal(await readFile(source, 'utf8'), changed);
    await writeFile(output, generated);
    await writeFile(source, changed + '\n// unexpected local change\n');
    await assert.rejects(patchPosixLoomProcess(root), /source changed/);
    assert.equal(await readFile(output, 'utf8'), generated);
    await writeFile(source, original);
    await patchPosixLoomProcess(root, { distribution: false });
    await writeFile(output, compile(await readFile(source, 'utf8')) + '//# sourceMappingURL=native.js.map\n');
    await patchPosixLoomProcess(root);
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
