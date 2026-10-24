/** 构建固定监管资产并记录摘要。 Build the fixed watchdog and record its digest. */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = resolve(process.argv[2] || join(root, '.tools', 'resilience'));
if (process.platform !== 'win32') throw new Error('Windows watchdog build requires Windows');
await mkdir(out, { recursive: true });
const source = join(root, 'server', 'drill-watchdog.cs'),
  exe = join(out, 'drill-watchdog.exe');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceDigest = digest(await readFile(source));
let reusable = false;
try {
  const existing = JSON.parse(await readFile(join(out, 'drill-watchdog.json'), 'utf8'));
  reusable =
    existing?.version === 1 &&
    existing.sourceDigest === sourceDigest &&
    existing.digest === digest(await readFile(exe));
} catch (error) {
  if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
}
if (reusable) {
  console.log(exe);
} else {
  const compiler = join(
    process.env.SystemRoot || 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  );
  const result = spawnSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/out:' + exe, source], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.error?.message || result.stdout + result.stderr);
  await writeFile(
    join(out, 'drill-watchdog.json'),
    JSON.stringify({ version: 1, sourceDigest, digest: digest(await readFile(exe)) }, null, 2),
  );
  console.log(exe);
}
