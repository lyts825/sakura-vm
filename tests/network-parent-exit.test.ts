/**
 * 模块职责：回归验证模块，围绕 `network-parent-exit` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `network-parent-exit`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: Windows host death reaps original CPU-less backend and worker handles before and after QMP readiness; Linux parent-death exec handoff reaps original CPU-less backend and worker handles.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { ROOT } from '../server/paths.ts';

const binary = join(process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu'), 'qemu-system-x86_64.exe');
const run = promisify(execFile);

// Diskless, CPU-less backend only. A .NET Process handle is opened before killing
// the parent and retained through assertion/finally; never reap by a recycled PID.
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: phase: 'starting' | 'ready'; detached: boolean。
 * 结果：返回分支计算值（`JSON.parse(stdout.trim()) as { backendExited: boolean; workerExited: boolean }`），以 Promise 交付。
 * Result: Return the branch-computed value (`JSON.parse(stdout.trim()) as { backendExited: boolean; workerExited: boolean }`) through a Promise.
 * 协作入口 / Collaborators: `JSON.stringify`, `Buffer.from(probe).toString`, `Buffer.from`, `run`.
 */
async function crashParent(phase: 'starting' | 'ready', detached: boolean) {
  const probe = `
    import { HostNetworkPool } from './server/network/host-pool.ts';
    import { spawn } from 'node:child_process';
    const pool = new HostNetworkPool({maxWorkers:1,connectionsPerWorker:8,scaleAt:1,idleMs:60000,reserveBackend:true},
      ${detached ? `{spawnBackend:(file,args)=>spawn(file,args,{detached:true,windowsHide:true,stdio:['pipe','pipe','pipe']})}` : '{}'});
    const pin=pool.pin();
    const ready=pin.call('qmp',{binary:${JSON.stringify(binary)},execute:'query-version',args:{}});
    void ready.catch(()=>{});
    ${phase === 'ready' ? 'await ready;' : 'while(!pool.snapshot()[0]?.backendPid) await new Promise(setImmediate);'}
    process.stdout.write(JSON.stringify(pool.snapshot()[0])+'\\n');
    setInterval(()=>{},1000);
  `;
  const script = `
    $ErrorActionPreference = 'Stop'
    $probe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(probe).toString('base64')}'))
    $start = [Diagnostics.ProcessStartInfo]::new($env:SAKURA_PROBE_NODE)
    $start.WorkingDirectory = $env:SAKURA_PROBE_ROOT
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($argument in @('--import','tsx','--input-type=module','-e',$probe)) { $start.ArgumentList.Add($argument) }
    $parentProbe = [Diagnostics.Process]::Start($start); $backendProbe = $null; $workerProbe = $null
    try {
      $line = $parentProbe.StandardOutput.ReadLineAsync()
      if (-not $line.Wait(15000)) { throw 'CPU-less backend startup timed out' }
      if (-not $line.Result) { throw $parentProbe.StandardError.ReadToEnd() }
      $record = $line.Result | ConvertFrom-Json
      $backendProbe = [Diagnostics.Process]::GetProcessById($record.backendPid); $null = $backendProbe.Handle
      $workerProbe = [Diagnostics.Process]::GetProcessById($record.pid); $null = $workerProbe.Handle
      $parentProbe.Kill(); $parentProbe.WaitForExit()
      $backendExited = $backendProbe.WaitForExit(2000)
      $workerExited = $workerProbe.WaitForExit(2000)
      [pscustomobject]@{ backendExited=$backendExited; workerExited=$workerExited } | ConvertTo-Json -Compress
    } finally {
      foreach ($owned in @($backendProbe,$workerProbe,$parentProbe)) {
        if ($owned) { if (-not $owned.HasExited) { $owned.Kill(); $owned.WaitForExit() }; $owned.Dispose() }
      }
    }
  `;
  const { stdout } = await run('pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { cwd: ROOT, windowsHide: true, timeout: 25000,
    env: { ...process.env, SAKURA_PROBE_NODE: process.execPath, SAKURA_PROBE_ROOT: ROOT } });
  return JSON.parse(stdout.trim()) as { backendExited: boolean; workerExited: boolean };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Windows host death reaps original CPU-less backend and worker handles before and after QMP readiness
 * 协作入口 / Collaborators: `assert.deepEqual`, `crashParent`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await crashParent(phase, false), { backendExited: true, workerExited: true }, phase)`; `assert.deepEqual(await crashParent('ready', true), { backendExited: false, workerExited: true })`.
 */
test('Windows host death reaps original CPU-less backend and worker handles before and after QMP readiness', {
  skip: process.platform !== 'win32' || !existsSync(binary), timeout: 70000,
}, async () => {
  for (const phase of ['starting', 'ready'] as const) {
    assert.deepEqual(await crashParent(phase, false), { backendExited: true, workerExited: true }, phase);
  }
  // Positive control: the same QEMU with detached=true survives stdin EOF.
  // This proves the normal-path result comes from process ownership, not QMP.
  assert.deepEqual(await crashParent('ready', true), { backendExited: false, workerExited: true });
});

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: phase: 'starting' | 'ready'; unmanaged: boolean。
 * 结果：返回分支计算值（`JSON.parse(stdout.trim())`），以 Promise 交付。
 * Result: Return the branch-computed value (`JSON.parse(stdout.trim())`) through a Promise.
 * 协作入口 / Collaborators: `join`, `JSON.stringify`, `run`, `JSON.parse`.
 */
async function crashLinuxParent(phase: 'starting' | 'ready', unmanaged: boolean) {
  const linuxBinary = join(process.env.SAKURA_QEMU_DIR || '/usr/bin', 'qemu-system-x86_64');
  const probe = `
    import { HostNetworkPool } from './server/network/host-pool.ts';
    import { spawn } from 'node:child_process';
    const pool = new HostNetworkPool({maxWorkers:1,connectionsPerWorker:8,scaleAt:1,idleMs:60000,reserveBackend:true},
      ${unmanaged ? `{spawnBackend:(file,args)=>spawn(file,args,{stdio:['pipe','pipe','pipe']})}` : '{}'});
    const pin=pool.pin();
    const ready=pin.call('qmp',{binary:${JSON.stringify(linuxBinary)},execute:'query-version',args:{}});
    void ready.catch(()=>{});
    ${phase === 'ready' ? 'await ready;' : 'while(!pool.snapshot()[0]?.backendPid) await new Promise(setImmediate);'}
    process.stdout.write(JSON.stringify(pool.snapshot()[0])+'\\n'); setInterval(()=>{},1000);
  `;
  const fixture = `
import json, os, select, signal, subprocess
parent = subprocess.Popen([os.environ['SAKURA_PROBE_NODE'], '--experimental-transform-types', '--input-type=module', '-e', os.environ['SAKURA_PROBE_SCRIPT']], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
handles = []
try:
    if not select.select([parent.stdout], [], [], 15)[0]: raise RuntimeError('backend startup timed out')
    line = parent.stdout.readline()
    if not line: raise RuntimeError(parent.stderr.read())
    record = json.loads(line)
    handles = [os.pidfd_open(record[key]) for key in ['backendPid', 'pid']]
    parent.kill(); parent.wait()
    exited = [bool(select.select([handle], [], [], 2)[0]) for handle in handles]
    print(json.dumps(dict(zip(['backendExited', 'workerExited'], exited))))
finally:
    for handle in handles:
        if not select.select([handle], [], [], 0)[0]: signal.pidfd_send_signal(handle, signal.SIGKILL)
        os.close(handle)
    if parent.poll() is None: parent.kill()
    parent.wait()
  `;
  const { stdout } = await run('python3', ['-I', '-S', '-c', fixture], { cwd: ROOT, timeout: 25000,
    env: { ...process.env, SAKURA_QEMU_DIR: process.env.SAKURA_QEMU_DIR || '/usr/bin',
      SAKURA_PROBE_NODE: process.execPath, SAKURA_PROBE_SCRIPT: probe } });
  return JSON.parse(stdout.trim());
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Linux parent-death exec handoff reaps original CPU-less backend and worker handles
 * 协作入口 / Collaborators: `assert.deepEqual`, `crashLinuxParent`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await crashLinuxParent(phase, false), { backendExited: true, workerExited: true }, phase)`; `assert.deepEqual(await crashLinuxParent('ready', true), { backendExited: false, workerExited: true })`.
 */
test('Linux parent-death exec handoff reaps original CPU-less backend and worker handles', {
  skip: process.platform !== 'linux' || !existsSync(join(process.env.SAKURA_QEMU_DIR || '/usr/bin', 'qemu-system-x86_64')),
  timeout: 70000,
}, async () => {
  for (const phase of ['starting', 'ready'] as const)
    assert.deepEqual(await crashLinuxParent(phase, false), { backendExited: true, workerExited: true }, phase);
  assert.deepEqual(await crashLinuxParent('ready', true), { backendExited: false, workerExited: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Linux parent-death helper refuses a stale parent before executing the program
 * 协作入口 / Collaborators: `assert.rejects`, `run`, `join`.
 * 检查边界 / Checked boundaries: `assert.rejects(run('python3', ['-I', '-S', join(ROOT, 'server/network/parent-exec.py'), '1', '/usr/bin/true']), (error: any) => er…`.
 */
test('Linux parent-death helper refuses a stale parent before executing the program', {
  skip: process.platform !== 'linux',
}, async () => {
  await assert.rejects(run('python3', ['-I', '-S', join(ROOT, 'server/network/parent-exec.py'),
    '1', '/usr/bin/true']), (error: any) => error.code === 125 && /parent/.test(error.stderr));
});
