import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';

test('architecture gate rejects cycles and indirect browser dependencies while allowing type edges', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-architecture-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  });
  for (const name of ['server', 'src', 'shared', 'plugins/example'])
    await mkdir(join(root, name), { recursive: true });
  const check = () => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'),
    resolve('scripts/check-architecture.ts')], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const write = (name: string, code: string) => writeFile(join(root, name), code);
  await write('server/a.ts', "import type { B } from './b.ts'; export type A = { b: B };");
  await write('server/b.ts', "import type { A } from './a.ts'; export type B = { a: A };");
  let result = check();
  assert.equal(result.status, 0, result.stderr);
  await write('server/a.ts', "import './b.ts';");
  await write('server/b.ts', "import './a.ts';");
  result = check();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Circular value dependencies/);
  await write('server/b.ts', 'export const value = 1;');
  await write('plugins/example/client.tsx', "import './helper.ts';");
  await write('plugins/example/helper.ts', "import '../../server/b.ts';");
  result = check();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /browser runtime dependency on server\/b.ts/);
  await write('plugins/example/helper.ts', "import 'node:fs';");
  result = check();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /browser dependency on node:fs/);
});
