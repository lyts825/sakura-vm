/** 烟雾验收：验证真实项目 UID 下 debugpy DAP 的断点、步进、栈帧、变量和输出。
 * Smoke acceptance for real project-UID debugpy DAP breakpoints, steps, stacks, variables and output. */
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { withOwnedProtocolSmoke, protocolSmokeObserver, protocolDapProbe, protocolDapBreakpoints } from './project-protocol-smoke-support.ts';
if (process.argv.includes('--validate-only')) {
  console.log(JSON.stringify({ kind: 'dap', vmStarted: false, observerBytes: Buffer.byteLength(protocolSmokeObserver),
    uidProbeBytes: Buffer.byteLength(protocolDapProbe), breakpoints: protocolDapBreakpoints,
    migration: 'explicit preview/apply', fixture: 'fresh owned and retained' }));
} else await withOwnedProtocolSmoke('dap', /** 通过真实 debugpy DAP 检查断点、单步、变量、栈和带 NUL/保护环境的输出；每状态有限等待并核验 UID 入场与最终全域关闭。
 * Verify real debugpy DAP breakpoints, stepping, variables, frames and NUL/protected-environment output with bounded state waits, proving UID admission and final whole-domain closure. */ async ({ features, machines, vmId, directory, prove, stopped, frameEnv }) => {
  const distro = machines.get(vmId).distro, isolated = process.env.SAKURA_DAP_PRIVATE === '1';
  if (!(await features.debugger.status(vmId)).installed) await features.debugger.install(vmId);
  assert.equal((await features.debugger.status(vmId)).installed, true);
  const started = await features.debugger.start(vmId,
    { path: directory + '/hello.py', breakpoints: [protocolDapBreakpoints.initial] });
  assert.equal(started.active, true);
  let status: any;
  const pausedDeadline = Date.now() + 30000;
  do {
    status = await features.debugger.status(vmId);
    if (status.state === 'stopped') break;
    assert.ok(Date.now() < pausedDeadline, JSON.stringify(status));
    await delay(200);
  } while (true);
  await prove(status.token, true);
  assert.equal(status.frames[0]?.path, directory + '/hello.py');
  assert.equal(status.frames[0]?.line, protocolDapBreakpoints.initial);
  assert.ok(status.variables.some((item: any) => item.name === 'value' && item.value === '1'), JSON.stringify(status.variables));
  await features.debugger.command(vmId, status.token, 'next');
  const stepped = Date.now() + 30000;
  do {
    status = await features.debugger.status(vmId);
    if (status.state === 'stopped' && status.frames[0]?.line === protocolDapBreakpoints.stepped) break;
    assert.ok(Date.now() < stepped, JSON.stringify(status));
    await delay(200);
  } while (true);
  assert.ok(status.variables.some((item: any) => item.name === 'value' && item.value === '2'), JSON.stringify(status.variables));
  await features.debugger.command(vmId, status.token, 'continue');
  const completed = Date.now() + 30000;
  do {
    status = await features.debugger.status(vmId);
    if (status.state === 'terminated') break;
    assert.ok(Date.now() < completed, JSON.stringify(status));
    await delay(200);
  } while (true);
  assert.match(status.output, /2/);
  assert.ok(status.output.includes('PROTOCOL_UID_OUTPUT\0'));
  assert.ok(status.output.includes(frameEnv));

  await features.debugger.stop(vmId, status.token);
  await stopped(status.token);
  console.log(`Real ${distro}${isolated ? ' private-network' : ''} debugpy DAP breakpoints, stepping, frames, variables and output passed.`);
}, async (machines, vmId, directory) => {
  await machines.writeGuestFile(vmId, directory + '/hello.py', protocolDapProbe, false);
});
