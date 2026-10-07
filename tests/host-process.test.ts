/**
 * 回归范围（完整情景见下方用例与断言）：
 * - DPAPI transports input through the owned stdin pipe and confirms both finite invocations
 * - finite Windows tools normalize restricted environments and resolve fixed PATH executables
 * - a missing executable or invalid arguments fail before Native Host gets an execution request
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostExecFile, hostProcess } from '../server/host-process.ts';
import { hostRuntime } from '../server/host-runtime/index.ts';
import { dpapi } from '../server/secrets.ts';

const windows = { skip: process.platform !== 'win32' };
const processResources = () =>
  hostRuntime.snapshot().resources.filter((value) => value.kind.startsWith('process.'));

test(
  'DPAPI transports input through the owned stdin pipe and confirms both finite invocations',
  windows,
  async () => {
    const input = Buffer.from('managed-process-fixture-' + randomUUID()).toString('base64');
    const ciphertext = await dpapi('protect', input);
    assert.notEqual(ciphertext, input);
    assert.equal(await dpapi('unprotect', ciphertext), input);
    assert.deepEqual(processResources(), []);
  },
);

test(
  'finite Windows tools normalize restricted environments and resolve fixed PATH executables',
  windows,
  async () => {
    const env = { ...process.env, Path: process.env.PATH, PATH: process.env.PATH };
    const result = await hostExecFile(
      'windows-probe',
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '[Console]::Out.Write("ok")'],
      { env },
    );
    assert.equal(result.stdout, 'ok');
    assert.deepEqual(processResources(), []);
  },
);

test(
  'a missing executable or invalid arguments fail before Native Host gets an execution request',
  windows,
  async () => {
    await assert.rejects(
      hostProcess('trusted-boot-probe', join(tmpdir(), randomUUID() + '.exe'), ['--version']),
      { code: 'HOST_PROCESS_FAILED' },
    );
    await assert.rejects(hostProcess('windows-probe', process.execPath, ['\0']), {
      code: 'HOST_PROCESS_FAILED',
    });
    await assert.rejects(
      hostProcess('windows-probe', process.execPath, ['--version'], { env: { BAD: '\0' } }),
      { code: 'HOST_PROCESS_FAILED' },
    );
    assert.deepEqual(processResources(), []);
  },
);

test(
  'normal Native Host exit confirms detached descendants ended before returning process quota',
  windows,
  async () => {
    const script = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); child.unref(); process.stdout.write(String(child.pid));`;
    const result = await hostExecFile('windows-probe', process.execPath, ['-e', script]);
    const pid = Number(result.stdout);
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.deepEqual(processResources(), []);
  },
);
