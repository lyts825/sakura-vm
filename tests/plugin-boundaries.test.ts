/**
 * 回归范围（完整情景见下方用例与断言）：
 * - plugin gates cover internal domain implementations and host authority import aliases
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { pluginBoundaryErrors } from '../scripts/plugin-boundaries.ts';
const check = (file: string, code: string) =>
  pluginBoundaryErrors(file, ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true));
test('plugin gates cover internal domain implementations and host authority import aliases', () => {
  assert.match(
    check('server/domain.ts', "import type { Machines as VM } from './machines.ts';")[0],
    /VmAccess/,
  );
  assert.equal(
    check('server/domain.ts', "import type { VmAccess as Machines } from './vm-access.ts';").length,
    0,
  );
  assert.match(
    check(
      'plugins/example/server.ts',
      "import { withPluginCleanup as allowed } from '../../server/plugin-authority.ts';",
    )[0],
    /host authority/,
  );
  assert.match(check('server/domain.ts', 'const work = new Jobs();')[0], /instance activation/);
  assert.equal(check('server/domain.ts', 'class Domain { jobs = new Jobs(); }').length, 0);
  assert.match(check('server/domain.ts', 'machines.fileBeforeReplace = work;')[0], /managed interceptor/);
  assert.match(check('server/domain.ts', 'new ProjectTerminals(vm);')[0], /shared provider/);
});
