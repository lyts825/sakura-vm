import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, basename, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-golden-vm-'));
assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
process.env.SAKURA_DATA_DIR = directory;
await mkdir(join(directory, 'images'));
await copyFile(resolve('.data/images/alpine-3.23.qcow2'), join(directory, 'images/alpine-3.23.qcow2'));
process.env.SAKURA_IMAGE_PATH = join(directory, 'images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Features } = await import('../server/features.ts');
const { GoldenImages } = await import('../server/golden-images.ts');
const { vmDir } = await import('../server/model.ts');
const engine = await createRuntime(),
  machines = new Machines(engine);
await machines.init();
const features = await Features.create(machines, ['snapshots']);
const library = features.serviceValue('goldenImages') as InstanceType<typeof GoldenImages>;
const output: string[] = [];
const record = (line: string) => {
  console.log(line);
  output.push(line);
};
async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 300000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id));
    await delay(300);
  }
}
try {
  assert.ok(features.enabled.has('snapshots'), JSON.stringify(features.errors));
  const source = await machines.create({ name: 'golden-source', diskGiB: 2, cpus: 1, memoryMiB: 512 });
  record('Booting isolated golden-image source');
  await boot(source.id);
  const prepared = await machines.exec(
    source.id,
    'set -eu\nprintf golden-proof > /workspace/golden-marker\nsync',
  );
  assert.equal(prepared.code, 0, prepared.stderr);
  const sourceKey = await readFile(join(vmDir(source.id), 'id_rsa'), 'utf8');
  await machines.stop(source.id);
  const saved = await library.action({
    action: 'create',
    vmId: source.id,
    name: 'Alpine proof',
    sourceReviewed: true,
  });
  assert.equal(saved.kind, 'template');
  await machines.delete(source.id);
  record('Independent template saved; source VM deleted');
  assert.equal((await library.action({ action: 'verify', id: saved.id })).kind, 'verified');
  const first = await library.action({ action: 'instantiate', id: saved.id, name: 'golden-first' });
  await boot(first.id);
  const initial = await machines.exec(
    first.id,
    'set -eu\ncat /workspace/golden-marker\nprintf changed > /workspace/golden-marker\nsync',
  );
  assert.equal(initial.code, 0, initial.stderr);
  assert.equal(initial.stdout, 'golden-proof');
  assert.notEqual(await readFile(join(vmDir(first.id), 'id_rsa'), 'utf8'), sourceKey);
  await machines.stop(first.id);
  const second = await library.action({ action: 'instantiate', id: saved.id, name: 'golden-second' });
  await library.action({ action: 'delete', id: saved.id });
  await boot(second.id);
  const fresh = await machines.exec(second.id, 'cat /workspace/golden-marker');
  assert.equal(fresh.code, 0, fresh.stderr);
  assert.equal(fresh.stdout, 'golden-proof');
  assert.notEqual(
    await readFile(join(vmDir(second.id), 'id_rsa'), 'utf8'),
    await readFile(join(vmDir(first.id), 'id_rsa'), 'utf8'),
  );
  assert.equal((await library.view()).templates.length, 0);
  await machines.stop(second.id);
  record(
    'Two derived guests booted with distinct controller keys; edits stayed isolated and template removal preserved both guests',
  );
} finally {
  await features.close();
  await machines.close();
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/golden-images-smoke.log', output.join('\n') + '\n');
  assert.ok(
    resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
      basename(directory).startsWith('sakura-golden-vm-'),
  );
  await rm(directory, { recursive: true, force: true });
}
