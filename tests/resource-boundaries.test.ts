/**
 * 模块职责：回归验证模块，围绕 `resource-boundaries` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `resource-boundaries`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: resource boundary rejects imported and dynamically loaded raw process and worker factories; ordinary periodic loops and aliases require Scheduler while reviewed deadlines remain separate.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { resourceBoundaryErrors } from '../scripts/resource-boundaries.ts';

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: code: string; file = 'server/example.ts'。
 * 结果：返回分支计算值（`resourceBoundaryErrors(file, ts.createSourceFile(file, code, ts.ScriptTarget.Lat…`）。
 * Result: Return the branch-computed value (`resourceBoundaryErrors(file, ts.createSourceFile(file, code, ts.ScriptTarget.Lat…`).
 * 协作入口 / Collaborators: `resourceBoundaryErrors`, `ts.createSourceFile`.
 */
const errors = (code: string, file = 'server/example.ts') => resourceBoundaryErrors(file,
  ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: resource boundary rejects imported and dynamically loaded raw process and worker factories
 * 协作入口 / Collaborators: `assert.ok`, `errors`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.ok(errors(code).length, code)`; `assert.equal(errors("import type { ChildProcess } from 'node:child_process';").length, 0)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: ordinary periodic loops and aliases require Scheduler while reviewed deadlines remain separate
 * 协作入口 / Collaborators: `assert.ok`, `errors`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.ok(errors(code).length, code)`; `assert.equal(errors('setInterval(checkLease, 1000);', 'server/ha-host-failover.ts').length, 0)`.
 */
test('ordinary periodic loops and aliases require Scheduler while reviewed deadlines remain separate', () => {
  for (const code of ["setInterval(tick, 10);", "const every = setInterval; every(tick, 10);",
    "globalThis['setInterval'](tick, 10);", "global.setInterval(tick, 10);",
    "import { setInterval as every } from 'node:timers';", "import * as timers from 'timers/promises';"])
    assert.ok(errors(code).length, code);
  assert.equal(errors('setInterval(checkLease, 1000);', 'server/ha-host-failover.ts').length, 0);
  assert.equal(errors('setTimeout(timeout, 1000);').length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin helper files cannot bypass scoped resource capabilities, and JSON writes require reviewed publication
 * 协作入口 / Collaborators: `assert.ok`, `errors`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.ok(errors(code, 'plugins/example/helpers.ts').length, code)`; `assert.ok(errors("import { writeFile as publish } from 'node:fs/promises'; publish(path, JSON.stringify(state));").length)`.
 */
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
