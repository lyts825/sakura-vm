import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { resourceBoundaryErrors } from '../scripts/resource-boundaries.ts';

const errors = (code: string, file = 'server/example.ts') => resourceBoundaryErrors(file,
  ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true));

test('resource boundary rejects imported and dynamically loaded raw process and worker factories', () => {
  for (const code of ["import { spawn as run } from 'node:child_process';", "import * as c from 'child_process';",
    "export { execFile } from 'node:child_process';", "const c = await import('node:' + 'child_process');",
    "process.getBuiltinModule('child_process');", "import child = require('child_process');",
    "import { Worker as Thread } from 'node:worker_threads';", "const t = require('worker_threads');",
    "import {createRequire as factory} from 'node:module'; const load=factory(import.meta.url); load('child_process');"])
    assert.ok(errors(code).length, code);
  assert.equal(errors("import type { ChildProcess } from 'node:child_process';").length, 0);
  assert.equal(errors("import { type ChildProcess } from 'node:child_process';").length, 0);
  assert.equal(errors("import { spawn } from 'node:child_process';", 'server/host-process.ts').length, 0);
  assert.equal(errors("import { Worker } from 'node:worker_threads';", 'server/compute-runtime.ts').length, 0);
});

test('ordinary periodic loops and aliases require Scheduler while reviewed deadlines remain separate', () => {
  for (const code of ["setInterval(tick, 10);", "const every = setInterval; every(tick, 10);",
    "globalThis['setInterval'](tick, 10);", "global.setInterval(tick, 10);",
    "import { setInterval as every } from 'node:timers';", "import * as timers from 'timers/promises';"])
    assert.ok(errors(code).length, code);
  assert.equal(errors('setInterval(checkLease, 1000);', 'server/ha-host-failover.ts').length, 0);
  assert.equal(errors('setTimeout(timeout, 1000);').length, 0);
});

test('plugin helper files cannot bypass scoped resource capabilities, and JSON writes require reviewed publication', () => {
  for (const code of ["import { readFile } from 'node:fs/promises';",
    "import { hostRuntime } from '../../server/host-runtime/index.ts';",
    "import { storageRuntime } from '../../server/storage-runtime.ts';"])
    assert.ok(errors(code, 'plugins/example/helpers.ts').length, code);
  assert.ok(errors("import { writeFile as publish } from 'node:fs/promises'; publish(path, JSON.stringify(state));").length);
  assert.ok(errors('fs.writeFile(path, JSON.stringify(state));').length);
  assert.ok(errors("import { Upload } from '@aws-sdk/lib-storage';").length);
  assert.equal(errors("import type { StorageRuntime } from '../../server/storage-runtime.ts';", 'plugins/example/helpers.ts').length, 0);
  assert.equal(errors('await writeStore(path, next);').length, 0);
});
