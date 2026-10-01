import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const distro = process.argv[2] || 'alpine';
const images: Record<string, string> = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' };
assert.ok(images[distro], 'unsupported smoke distro');
const directory = await mkdtemp(join(tmpdir(), 'sakura-build-farm-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images', images[distro]);
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { BuildFarm } = await import('../server/build-farm.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { ProjectTerminals } = await import('../server/project-terminals.ts');
const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
const { Secrets } = await import('../server/secrets.ts');
const engine = await createRuntime();
let machines: InstanceType<typeof Machines> | undefined;
let farm: InstanceType<typeof BuildFarm> | undefined;
let workspaces: InstanceType<typeof Workspaces> | undefined;
let terminals: InstanceType<typeof ProjectTerminals> | undefined;
let vmId = '';
const secret = 'sakura-farm-secret-' + randomUUID();

async function settled(id: string, expected = 'done') {
  const deadline = Date.now() + 100000;
  while (true) {
    const task = farm!.view().tasks.find((item) => item.id === id)!;
    if (task.status === expected) return task;
    assert.ok(!['done', 'error', 'cancelled', 'interrupted'].includes(task.status),
      task.error || task.job?.error || task.status);
    assert.ok(Date.now() < deadline, `build deadline: ${task.status}`);
    await delay(100);
  }
}
async function submit(name: string, command: string, extra: Record<string, unknown> = {}) {
  return await farm!.action({ operation: 'submit', build: {
    name, command, labels: [distro], timeoutSeconds: 60, ...extra } }) as { id: string };
}
try {
  machines = new Machines(engine);
  await machines.init();
  const vm = await machines.create({ name: `build-farm-${distro}`, distro, memoryMiB: distro === 'alpine' ? 768 : 1024,
    cpus: 2, diskGiB: 8, accelerator: 'auto', forwards: [] });
  vmId = vm.id;
  await machines.start(vmId);
  const bootDeadline = Date.now() + 300_000;
  while (machines.state(vmId) === 'starting' && Date.now() < bootDeadline)
    await delay(100);
  assert.equal(machines.state(vmId), 'running');
  const secrets = process.platform === 'win32' ? new Secrets(machines) : undefined;
  if (secrets) await secrets.save(vmId, { name: 'farm-key', value: secret });
  workspaces = new Workspaces(machines, { secrets });
  if (distro === 'alpine') {
    const cgroups = await machines.exec(vmId,
      'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /sbin/rc-service cgroups start', 30000);
    assert.equal(cgroups.code, 0, cgroups.stderr);
  }
  const migrations = new ProjectDirectoryMigrations(machines, workspaces);
  // This script created this VM above. Review only its two new fixture roots;
  // never reuse or change an existing project directory implicitly.
  const prepareDirectory = async (projectId: string, path: '/workspace/private' | '/workspace/other') => {
    const created = await machines!.exec(vmId, `set -eu\ntest ! -e ${path}\nmkdir -m 0700 ${path}`, 10000);
    assert.equal(created.code, 0, created.stderr);
    await workspaces!.projects.inScope(vmId, projectId, async () => {
      const preview = await migrations.preview(vmId);
      assert.ok(preview.plan);
      await migrations.apply(vmId, { action: 'apply', version: 1, reviewed: true,
        planId: preview.plan.proposal.planId, sha256: preview.plan.sha256 });
    });
  };
  await workspaces.save(vmId, { directory: '/workspace/shared' });
  const alpha = (await workspaces.projects.create(vmId, 'Private builder', async () => {
    await workspaces!.save(vmId, { directory: '/workspace/private', networkIsolation: 'private',
      environment: { BUILD_SCOPE: 'alpha' }, ...(secrets ? { secrets: { TOKEN: 'farm-key' } } : {}) });
  })).active;
  await prepareDirectory(alpha, '/workspace/private');
  terminals = new ProjectTerminals(machines, workspaces);
  const create = () => new BuildFarm(machines!, undefined, undefined, undefined, undefined, terminals);
  farm = create();
  await farm.init();
  await farm.action({ operation: 'save-node', node: {
    vmId, slots: 2, labels: [distro], enabled: true } });
  const beta = (await workspaces.projects.create(vmId, 'Other builder', async () => {
    await workspaces!.save(vmId, { directory: '/workspace/other' });
  })).active;
  await prepareDirectory(beta, '/workspace/other');
  await farm.close(); farm = create(); await farm.init();
  assert.equal(farm.view().nodes[0].projectId, alpha, 'changing the active project or controller cannot retarget a node');
  const first = await submit('Project environment', `set -eu
test "$BUILD_SCOPE" = alpha
test "$(ip -o -4 route show | wc -l)" -eq 0
test "$(ip -o -6 route show | wc -l)" -eq 0
printf '%s\\n' "$(readlink /proc/self/ns/net)" "$BUILD_SCOPE" "$(pwd)" > farm-result.txt
mkdir -p subdir
printf '%s\\n' "\${TOKEN-}"`);
  const completed = await settled(first.id);
  assert.equal(completed.projectId, alpha);
  assert.equal(completed.directory, '/workspace/private');
  assert.equal(completed.networkIsolation, 'private');
  const result = await machines.exec(vmId, `set -eu
expected=$(ip netns exec sk-${alpha} readlink /proc/self/ns/net)
test "$expected" != "$(readlink /proc/self/ns/net)"
cat /workspace/private/farm-result.txt
printf '%s\\n' "$expected"`, 10000);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines[0], lines[3]);
  assert.equal(lines[1], 'alpha');
  assert.equal(lines[2], '/workspace/private');
  if (secrets) {
    const output = await farm.jobs.result(completed.jobId!);
    assert.match(output.stdout, /私密配置已隐藏/);
    assert.ok(!JSON.stringify({ completed, output }).includes(secret));
  }
  const nested = await submit('Project subdirectory', 'pwd > nested-result.txt', { cwd: '/workspace/private/subdir' });
  await settled(nested.id);
  assert.equal((await machines.exec(vmId, 'cat /workspace/private/subdir/nested-result.txt', 10000)).stdout.trim(),
    '/workspace/private/subdir');
  const outside = await submit('Reject outside project', 'touch /workspace/farm-escape', { cwd: '/workspace' });
  const refused = await settled(outside.id, 'error');
  assert.match(refused.error || '', /项目目录内/);
  assert.equal((await machines.exec(vmId, '! test -e /workspace/farm-escape', 10000)).code, 0);

  const a = await submit('Concurrent A', 'sleep 600 & echo $! > /workspace/private/child-a; wait');
  const b = await submit('Concurrent B', 'sleep 600 & echo $! > /workspace/private/child-b; wait');
  const children = await machines.exec(vmId, `set -eu
for attempt in $(seq 1 200); do
  test -s /workspace/private/child-a && test -s /workspace/private/child-b && break
  sleep 0.2
done
cat /workspace/private/child-a /workspace/private/child-b`, 60000);
  assert.equal(children.code, 0, children.stderr);
  const pids = children.stdout.trim().split('\n').map(Number);
  assert.equal(pids.length, 2);
  assert.ok(pids.every((pid) => Number.isInteger(pid) && pid > 1));
  assert.equal(farm.view().nodes[0].busy, 2);
  const namespace = await machines.exec(vmId, `set -eu
expected=$(ip netns exec sk-${alpha} readlink /proc/self/ns/net)
for pid in ${pids.join(' ')}; do test "$(readlink /proc/$pid/ns/net)" = "$expected"; done`, 10000);
  assert.equal(namespace.code, 0, namespace.stderr);
  const project = await workspaces.projects.with(vmId, alpha, () => workspaces!.config(vmId));
  await workspaces.projects.with(vmId, alpha, async () => {
    await assert.rejects(workspaces!.save(vmId, { ...project, networkIsolation: 'host' }), /终端或命令/);
  });
  await assert.rejects(farm.action({ operation: 'save-node', node: {
    vmId, projectId: beta, slots: 2, labels: [distro], enabled: true } }), /执行构建/);
  await farm.action({ operation: 'cancel', id: a.id }); await settled(a.id, 'cancelled');
  assert.equal(farm.view().tasks.find((task) => task.id === b.id)?.status, 'running');
  const aliveB = await machines.exec(vmId, `kill -0 ${pids[1]}`, 10000);
  assert.equal(aliveB.code, 0, 'cancelling one process group must preserve the other build');
  await farm.action({ operation: 'cancel', id: b.id }); await settled(b.id, 'cancelled');
  const cleaned = await machines.exec(vmId, `set -eu
for attempt in $(seq 1 50); do
  if ! kill -0 ${pids[0]} 2>/dev/null && ! kill -0 ${pids[1]} 2>/dev/null; then exit 0; fi
  sleep 0.2
done
exit 1`, 20000);
  assert.equal(cleaned.code, 0, 'background build children survived cancellation');
  await workspaces.projects.with(vmId, alpha, async () => {
    await workspaces!.save(vmId, { ...project, networkIsolation: 'host' });
  });
  console.log(`${distro}: real project namespace, directory/environment${secrets ? ', secret redaction' : ''}, restart binding, subdirectory, rejection, two concurrent slots and cancellation passed.`);
} finally {
  if (farm) await farm.close();
  await terminals?.close();
  await workspaces?.close();
  if (machines) {
    if (vmId && machines.live.has(vmId)) await machines.stop(vmId, true).catch(() => {});
    await machines.close();
  } else await engine.runtime.close();
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith('sakura-build-farm-'));
  await rm(target, { recursive: true, force: true });
}
