/**
 * 模块职责：回归验证模块，围绕 `gpu-profiles` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `gpu-profiles`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: GPU profiles preview a real hardware change and preserve applied provenance; GPU preview rejects an unavailable 3D backend and insufficient instance memory.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'sakura-gpu-profile-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const { GpuProfiles } = await import('../server/gpu-profiles.ts');
after(() => rm(root, { recursive: true, force: true }));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPU profiles preview a real hardware change and preserve applied provenance
 * 协作入口 / Collaborators: `machines.init`, `t.after`, `randomUUID`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.equal(profile.revision, 1)`; `assert.equal(preview.ready, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('GPU profiles preview a real hardware change and preserve applied provenance', async (t) => {
  const machines = new Machines({ whpxAvailable: false,
    runtime: { /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: GPU profiles preview a real hardware change and preserve applied provenance
     */
    close: async () => {} } } as any, fakeVmNetwork);
  await machines.init();
  t.after(() => machines.close());
  const vmId = randomUUID();
  await mkdir(vmDir(vmId));
  machines.records.set(vmId, { ...createSchema.parse({ name: 'gpu-profile', memoryMiB: 1024 }),
    id: vmId, createdAt: new Date().toISOString(), snapshots: [] });
  const file = join(root, 'profiles.json');
  const gpu = new GpuProfiles(machines, file, undefined, undefined,
    async (_machines, graphics) => graphics === 'virgl'
      ? { available: false, reason: 'EGL backend unavailable' } : { available: true });
  await gpu.init();
  try {
    const profile = await gpu.action({ operation: 'save', profile: {
      name: 'Two displays', graphics: 'virtio-gpu', outputs: 2, width: 1920,
      height: 1080, hostMemoryMiB: 384, minVmMemoryMiB: 768,
    } }) as { id: string; revision: number };
    assert.equal(profile.revision, 1);
    const preview = await gpu.action({ operation: 'preview', id: profile.id, vmId }) as {
      ready: boolean; previewToken: string; qemuDeviceArguments: string[] };
    assert.equal(preview.ready, true);
    assert.match(preview.qemuDeviceArguments[1], /max_outputs=2,xres=1920,yres=1080,max_hostmem=384M/);
    assert.equal(machines.get(vmId).hardware, undefined);
    await assert.rejects(gpu.action({ operation: 'apply', id: profile.id, vmId,
      previewToken: '0'.repeat(64) }), /预览已过期/);
    await gpu.action({ operation: 'apply', id: profile.id, vmId,
      previewToken: preview.previewToken });
    assert.equal(machines.get(vmId).hardware?.devices?.graphics, 'virtio-gpu');
    assert.equal(machines.get(vmId).hardware?.devices?.graphicsOutputs, 2);
    assert.equal((await gpu.view()).assignments[0].drifted, false);
    await machines.configureHardware(vmId, {});
    assert.equal((await gpu.view()).assignments[0].drifted, true);
    await assert.rejects(gpu.action({ operation: 'save', id: profile.id, revision: 2,
      profile: { name: 'Two displays', graphics: 'virtio-gpu', outputs: 2, width: 1920,
        height: 1080, hostMemoryMiB: 384, minVmMemoryMiB: 768 } }), /已变化/);
  } finally { await gpu.close(); }
  const resumed = new GpuProfiles(machines, file, undefined, undefined,
    async () => ({ available: true }));
  await resumed.init();
  try {
    assert.equal((await resumed.view()).profiles.length, 1);
    assert.equal((await resumed.view()).assignments[0].drifted, true);
  } finally { await resumed.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPU preview rejects an unavailable 3D backend and insufficient instance memory
 * 协作入口 / Collaborators: `machines.init`, `t.after`, `randomUUID`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.equal(preview.ready, false)`; `assert.match(preview.reasons.join('；'), /内存低于|EGL unavailable/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('GPU preview rejects an unavailable 3D backend and insufficient instance memory', async (t) => {
  const machines = new Machines({ whpxAvailable: false,
    runtime: { /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: GPU preview rejects an unavailable 3D backend and insufficient instance memory
     */
    close: async () => {} } } as any, fakeVmNetwork);
  await machines.init();
  t.after(() => machines.close());
  const vmId = randomUUID();
  await mkdir(vmDir(vmId));
  machines.records.set(vmId, { ...createSchema.parse({ name: 'gpu-small', memoryMiB: 512 }),
    id: vmId, createdAt: new Date().toISOString(), snapshots: [] });
  const gpu = new GpuProfiles(machines, join(root, 'profiles-small.json'), undefined, undefined,
    async (_machines, graphics) => graphics === 'virgl'
      ? { available: false, reason: 'EGL unavailable' } : { available: true });
  await gpu.init();
  try {
    const profile = await gpu.action({ operation: 'save', profile: {
      name: '3D', graphics: 'virgl', outputs: 1, width: 1280,
      height: 800, hostMemoryMiB: 256, minVmMemoryMiB: 1024,
    } }) as { id: string; revision: number };
    const preview = await gpu.action({ operation: 'preview', id: profile.id, vmId }) as {
      ready: boolean; reasons: string[]; previewToken: string };
    assert.equal(preview.ready, false);
    assert.match(preview.reasons.join('；'), /内存低于|EGL unavailable/);
    await assert.rejects(gpu.action({ operation: 'apply', id: profile.id, vmId,
      previewToken: preview.previewToken }), /内存低于/);
    assert.equal(machines.get(vmId).hardware, undefined);
  } finally { await gpu.close(); }
});
