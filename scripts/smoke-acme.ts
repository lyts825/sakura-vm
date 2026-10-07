/** 烟雾验收：验证受控 Certbot 工具下的来宾证书签发/续订编排及 dry-run 参数。
 * Smoke acceptance for controlled Certbot guest certificate issuance/renewal orchestration and dry-run arguments. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Workspaces } from '../server/workspaces.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-acme-smoke-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.match(basename(directory), /^sakura-acme-smoke-/);
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { NextFeatures } = await import('../server/next-features.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = {
  projects: { /** 为此单项目验收提供稳定的 default 项目上下文，不读取或切换用户项目。
 * Provide the stable default project context for this single-project check without reading/switching user projects. */ current: () => 'default', /** 为单项目夹具返回原实例标识作为配置键；不增加生产多项目键空间。
 * Use the original VM identifier as the configuration key for this single-project fixture without introducing production multi-project key space. */ key: (id: string) => id },
} as unknown as Workspaces;
const features = new NextFeatures(machines, workspaces, { /** 只向 ACME 验收提供 capabilityChecks 依赖，其他可选服务返回 undefined，维持最小夹具能力。
 * Provide only capabilityChecks to the ACME check and return undefined for other optional services, keeping fixture authority minimal. */ optional: id => (id === 'capabilityChecks' ? { /** 本 ACME 成功路径夹具明确允许证书操作，返回 true，不执行真实权限变更。
 * Explicitly allow certificate operations in this ACME success fixture by returning true without changing real permissions. */ acmeAllowed: () => true, /** 该夹具无需额外记录能力变更，保留无副作用回调以满足能力检查接口。
 * Supply a side-effect-free mutation callback because this fixture needs no extra capability-mutation bookkeeping. */ mutation: () => {} } : undefined) as never });
await features.init();

try {
  const vm = await machines.create({ name: 'acme-smoke', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 270_000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(200);
  }
  const setup = await machines.exec(vm.id, `set -eu
mkdir -p /etc/letsencrypt/renewal /usr/local/bin
printf '[renewalparams]\\n' > /etc/letsencrypt/renewal/smoke.conf
cat > /usr/local/bin/certbot <<'SH'
#!/bin/sh
printf '%s\\n' "$*" >> /tmp/sakura-acme-invocations
exit 0
SH
chmod 755 /usr/local/bin/certbot`);
  assert.equal(setup.code, 0, setup.stderr);
  const checked = await features.action(vm.id,
    { action: 'check', featureId: 'acme-renewal' }) as { ready: boolean };
  assert.equal(checked.ready, true);
  const dryJob = await features.action(vm.id,
    { action: 'run', featureId: 'acme-renewal', options: { mode: 'dry-run' } }) as { id: string };
  await features.jobs.wait(`${vm.id}:acme-renewal`);
  assert.equal(features.jobs.get(dryJob.id)?.status, 'done', features.jobs.get(dryJob.id)?.error);
  const dryResult = await features.jobs.result(dryJob.id) as { ready: boolean; exitCode: number };
  assert.equal(dryResult.ready, true);
  assert.equal(dryResult.exitCode, 0);
  const savedJob = await features.action(vm.id,
    { action: 'run', featureId: 'acme-renewal',
      options: { mode: 'save', enabled: true, intervalHours: 12 } }) as { id: string };
  await features.jobs.wait(`${vm.id}:acme-renewal`);
  assert.equal(features.jobs.get(savedJob.id)?.status, 'done', features.jobs.get(savedJob.id)?.error);
  const renewDeadline = Date.now() + 30_000;
  while (!features.acmeRenewal.view(vm.id).attempts.some((item) => item.mode === 'scheduled')) {
    assert.ok(Date.now() < renewDeadline, '自动续期未执行');
    await delay(100);
  }
  const invocation = await machines.exec(vm.id, 'cat /tmp/sakura-acme-invocations');
  assert.equal(invocation.code, 0, invocation.stderr);
  assert.match(invocation.stdout, /renew --non-interactive --quiet --dry-run/);
  assert.match(invocation.stdout, /renew --non-interactive --quiet\n/);
  console.log('Real guest ACME orchestration passed with a controlled Certbot shim.');
} finally {
  await features.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
