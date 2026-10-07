/**
 * 模块职责：回归验证模块，围绕 `single-app-assets` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `single-app-assets`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: SingleApp immutable three-file bundle rejects changed, missing and reordered source authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { singleAppAssetNames, singleAppSources } from '../server/single-app-assets.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SingleApp immutable three-file bundle rejects changed, missing and reordered source authority
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `createHash`.
 * 检查边界 / Checked boundaries: `assert.equal(accepted.directory, '/usr/local/lib/sakura-single-app/' + manifest.build)`; `assert.deepEqual([...accepted.files.keys()], [...singleAppAssetNames])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('SingleApp immutable three-file bundle rejects changed, missing and reordered source authority', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-single-app-assets-'));
  try {
    const digest = createHash('sha256'), files = [];
    for (const name of singleAppAssetNames) {
      const raw = await readFile(resolve('native/single-app', name)); digest.update(name).update(raw);
      files.push({ name, size: raw.length, sha256: createHash('sha256').update(raw).digest('hex') });
      await writeFile(join(directory, name), raw);
    }
    const manifest = { version: 1, build: digest.digest('hex'), files };
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    const accepted = await singleAppSources(directory);
    assert.equal(accepted.directory, '/usr/local/lib/sakura-single-app/' + manifest.build);
    assert.deepEqual([...accepted.files.keys()], [...singleAppAssetNames]);
    await writeFile(join(directory, 'controller.py'), 'changed source');
    await assert.rejects(singleAppSources(directory), (error: unknown) => (error as { code: string }).code === 'SINGLE_APP_SOURCE_CHANGED');
    await writeFile(join(directory, 'controller.py'), accepted.files.get('controller.py')!);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, build: '0'.repeat(64) }));
    await assert.rejects(singleAppSources(directory), /固定源码版本不符/);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, files: [...manifest.files].reverse() }));
    await assert.rejects(singleAppSources(directory));
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await rm(join(directory, 'directory-view.py'));
    await assert.rejects(singleAppSources(directory), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
  } finally {
    const path = await realpath(directory);
    assert.equal(dirname(path), resolve(tmpdir())); assert.ok(basename(path).startsWith('sakura-single-app-assets-'));
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
