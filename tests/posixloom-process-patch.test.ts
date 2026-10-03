import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import ts from 'typescript';

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
