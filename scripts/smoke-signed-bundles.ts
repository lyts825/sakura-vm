import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, basename, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-signed-vm-'));
assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
process.env.SAKURA_DATA_DIR = directory;
await mkdir(join(directory, 'images'));
await copyFile(resolve('.data/images/alpine-3.23.qcow2'), join(directory, 'images/alpine-3.23.qcow2'));
process.env.SAKURA_IMAGE_PATH = join(directory, 'images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Features } = await import('../server/features.ts');
const { SignedBundles } = await import('../server/signed-bundles.ts');
const { vmDir } = await import('../server/model.ts');
const engine = await createRuntime();
const machines = new Machines(engine);
await machines.init();
const features = await Features.create(machines, ['snapshots']);
const policy = features.serviceValue('signedBundles') as InstanceType<typeof SignedBundles>;
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
  const source = await machines.create({ name: 'signed-source', diskGiB: 2, cpus: 1, memoryMiB: 512 });
  record('Booting isolated source VM');
  await boot(source.id);
  const written = await machines.exec(source.id, 'printf signed-proof > /workspace/signed-marker && sync');
  assert.equal(written.code, 0, written.stderr);
  await machines.stop(source.id);
  const sourceKey = await readFile(join(vmDir(source.id), 'id_rsa'), 'utf8');
  const legacy = join(directory, 'legacy.sakura');
  await features.bundles.export(source.id, createWriteStream(legacy), () => {});
  await policy.action({ action: 'configure', revision: 0, requireTrustedOnImport: true });
  const signed = join(directory, 'signed.sakura');
  await features.bundles.export(source.id, createWriteStream(signed), () => {});
  const bundle = await readFile(signed);
  const manifestLength = bundle.readUInt32BE(8);
  const manifest = JSON.parse(bundle.subarray(12, 12 + manifestLength).toString('utf8'));
  assert.equal(manifest.signature.algorithm, 'Ed25519');
  await assert.rejects(
    features.bundles.importExternal('unsigned-rejected', createReadStream(legacy)),
    /受信任签名/,
  );
  const copy = await features.bundles.importExternal('signed-copy', createReadStream(signed));
  record('Signed package imported; unsigned external package rejected');
  await boot(copy.id);
  const marker = await machines.exec(copy.id, 'cat /workspace/signed-marker');
  assert.equal(marker.code, 0, marker.stderr);
  assert.equal(marker.stdout, 'signed-proof');
  assert.notEqual(await readFile(join(vmDir(copy.id), 'id_rsa'), 'utf8'), sourceKey);
  await machines.stop(copy.id);
  record('Imported VM booted, disk marker survived, and controller identity rotated');
} finally {
  await features.close();
  await machines.close();
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/signed-bundles-smoke.log', output.join('\n') + '\n');
  assert.ok(
    resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
      basename(directory).startsWith('sakura-signed-vm-'),
  );
  await rm(directory, { recursive: true, force: true });
}
