import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-image-import-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-image-import-'));
process.env.SAKURA_DATA_DIR = directory;
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { DiskImports } = await import('../server/disk-imports.ts');
const engine = await createRuntime();
const machines = new Machines(engine);
await machines.init();
const importer = new DiskImports(machines);
const stock = resolve('.data/images/alpine-3.23.qcow2');
const log: string[] = [];
const record = (message: string) => { console.log(message); log.push(message); };

function tarEntry(name: string, payload: Buffer) {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(payload.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.fill(32, 148, 156);
  header.write('0', 156);
  header.write('ustar\0', 257);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, payload, Buffer.alloc((512 - payload.length % 512) % 512)]);
}

async function boot(id: string, format: string) {
  await machines.start(id);
  const deadline = Date.now() + 270000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(id)))
      throw new Error(`${format}: ${machines.logs.get(id)}`);
    await delay(250);
  }
  const result = await machines.exec(id, 'cat /etc/alpine-release; test -d /workspace && echo imported-ready');
  assert.equal(result.code, 0, `${format}: ${result.stderr}`);
  assert.match(result.stdout, /imported-ready/);
  await machines.stop(id);
  record(`${format} conversion and guest boot passed`);
}

try {
  const files: Record<'raw' | 'vmdk' | 'vhdx' | 'ova', string> = {
    raw: join(directory, 'source.raw'),
    vmdk: join(directory, 'source.vmdk'),
    vhdx: join(directory, 'source.vhdx'),
    ova: join(directory, 'source.ova'),
  };
  const expanded = join(directory, 'expanded.qcow2');
  await engine.run('sakura-img', ['convert', '-f', 'qcow2', '-O', 'qcow2', stock, expanded], { timeoutMs: 600000 });
  await engine.run('sakura-img', ['resize', '-f', 'qcow2', expanded, '2G']);
  for (const format of ['vmdk', 'vhdx', 'raw'] as const) {
    const options = format === 'vmdk' ? ['-o', 'subformat=monolithicSparse'] : [];
    await engine.run('sakura-img', ['convert', '-f', 'qcow2', '-O', format, ...options, expanded, files[format]], { timeoutMs: 600000 });
    const info = JSON.parse(await engine.run('sakura-img', ['info', '-f', format, '--output=json', files[format]]));
    record(`${format} source: ${JSON.stringify({ bytes: (await stat(files[format])).size, formatSpecific: info['format-specific'] })}`);
  }
  const ovaVmdk = join(directory, 'ova-stream.vmdk');
  await engine.run('sakura-img', [
    'convert', '-f', 'qcow2', '-O', 'vmdk', '-o', 'subformat=streamOptimized', expanded, ovaVmdk,
  ], { timeoutMs: 600000 });
  const ovaInfo = JSON.parse(await engine.run('sakura-img', ['info', '-f', 'vmdk', '--output=json', ovaVmdk]));
  record(`ova VMDK source: ${JSON.stringify(ovaInfo['format-specific'])}`);
  const ovf = Buffer.from('<Envelope xmlns="http://schemas.dmtf.org/ovf/envelope/1"><References><File href="disk.vmdk"/></References></Envelope>');
  const payload = Buffer.concat([
    tarEntry('appliance.ovf', ovf),
    tarEntry('disk.vmdk', await readFile(ovaVmdk)),
    Buffer.alloc(1024),
  ]);
  await writeFile(files.ova, payload);
  for (const format of ['vmdk', 'vhdx', 'ova', 'raw'] as const) {
    const result = await importer.import({
      name: `imported-${format}`, format, distro: 'alpine', memoryMiB: 512, cpus: 1,
    }, createReadStream(files[format]));
    assert.equal(result.source.format, format);
    await boot(result.vm.id, format);
  }
  const smallVmdk = join(directory, 'small-source.vmdk');
  await engine.run('sakura-img', ['convert', '-f', 'qcow2', '-O', 'vmdk', '-o', 'subformat=monolithicSparse', stock, smallVmdk]);
  const smallImported = await importer.import({
    name: 'imported-small', format: 'vmdk', distro: 'alpine', memoryMiB: 512, cpus: 1,
  }, createReadStream(smallVmdk));
  assert.equal(smallImported.vm.diskGiB, 2);
  assert.equal(smallImported.vm.pendingResize, true);
  await boot(smallImported.vm.id, 'small VMDK expanded to 2 GiB');
  assert.equal((await machines.list()).length, 5);
  record('All four image formats and a small cloud image imported into isolated, bootable QEMU instances');
} finally {
  await machines.close();
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/image-import-smoke.log', log.join('\n') + '\n');
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  assert.ok(basename(directory).startsWith('sakura-image-import-'));
  await rm(directory, { recursive: true, force: true });
}
