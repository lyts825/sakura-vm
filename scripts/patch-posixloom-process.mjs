/** 对固定 PosixLoom 进程实现应用已声明补丁，核对原始与目标摘要并支持发行构建检查。 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSIXLOOM_COMMIT } from './versions.mjs';

const patch = JSON.parse(
  await readFile(new URL('./patches/posixloom-process.json', import.meta.url), 'utf8'),
);
const normalize = (text) => text.replaceAll('\r\n', '\n');
const digest = (text) => createHash('sha256').update(normalize(text)).digest('hex');
const compile = (text, ts) =>
  ts.transpileModule(text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
const withoutMap = (text) => normalize(text).replace(/^\/\/# sourceMappingURL=.*\n?/gm, '');

/** Exact source/build verification, safe to rerun; never patches an unknown vendor revision. */
export async function patchPosixLoomProcess(directory, { distribution = true } = {}) {
  if (patch.version !== 1 || patch.commit !== POSIXLOOM_COMMIT)
    throw new Error('PosixLoom process patch does not match scripts/versions.mjs');
  const sourcePath = join(directory, patch.source);
  const source = normalize(await readFile(sourcePath, 'utf8'));
  const currentHash = digest(source);
  if (![patch.original, patch.patched].includes(currentHash))
    throw new Error('PosixLoom native process source changed; update the verified patch explicitly');
  const alreadyPatched = currentHash === patch.patched;
  const lines = source.split('\n');
  if (alreadyPatched) {
    let offset = 0;
    const locations = patch.changes.map((change) => {
      const at = change.start + offset;
      offset += change.replacement.length - change.old.length;
      return { ...change, at };
    });
    for (const change of locations.reverse())
      lines.splice(change.at, change.replacement.length, ...change.old);
  }
  const original = lines.join('\n');
  if (digest(original) !== patch.original) throw new Error('PosixLoom reverse patch verification failed');
  for (const change of [...patch.changes].reverse())
    lines.splice(change.start, change.end - change.start, ...change.replacement);
  const patched = lines.join('\n');
  if (digest(patched) !== patch.patched) throw new Error('PosixLoom process patch verification failed');
  const targetPath = join(directory, 'dist/src/core/process/native.js');
  let generated;
  if (distribution) {
    // Installed releases omit development dependencies. Setup has already installed
    // PosixLoom's compiler; source-only patching does not need a compiler at all.
    const require = createRequire(import.meta.url);
    const ts = require(require.resolve('typescript', {
      paths: [resolve(directory), fileURLToPath(new URL('..', import.meta.url))],
    }));
    generated = compile(patched, ts);
    const actual = withoutMap(await readFile(targetPath, 'utf8'));
    if (actual !== compile(original, ts) && actual !== generated)
      throw new Error('PosixLoom native process distribution changed; refusing an unverified overwrite');
  }
  // Validate both inputs before changing either one.
  if (!alreadyPatched) await writeFile(sourcePath, patched);
  if (distribution) await writeFile(targetPath, generated);
  return { sourceSha256: patch.patched, distribution: distribution ? digest(generated) : null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] || '.vendor/posixloom');
  await patchPosixLoomProcess(directory, { distribution: !process.argv.includes('--source-only') });
  console.log('PosixLoom process retirement patch verified.');
}
