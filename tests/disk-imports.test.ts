import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Machines } from '../server/machines.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-disk-imports-'));
process.env.SAKURA_DATA_DIR = root;
const { DiskImports } = await import('../server/disk-imports.ts');
const { Features } = await import('../server/features.ts');
after(() => rm(root, { recursive: true, force: true }));

const GiB = 1024 ** 3;
const qcow = Buffer.alloc(104);
qcow.writeUInt32BE(0x514649fb);
qcow.writeUInt32BE(3, 4);
qcow.writeBigUInt64BE(2n * BigInt(GiB), 24);
const vmdk = Buffer.alloc(1024);
vmdk.write('KDMV');
let adopted = 0;
const machines = {
  engine: {
    run: async (_tool: string, args: string[]) => {
      if (args[0] === 'convert') {
        await writeFile(args.at(-1)!, qcow);
        return '';
      }
      return JSON.stringify(args[2] === 'qcow2'
        ? { format: 'qcow2', 'virtual-size': 2 * GiB }
        : { format: args[2], 'virtual-size': 2 * GiB, 'format-specific': { data: {
          'create-type': 'monolithicSparse', extents: [{ filename: args.at(-1) }],
        } } });
    },
  },
  importDisk: async () => ({ id: `imported-${++adopted}` }),
} as unknown as Machines;
const importer = new DiskImports(machines);
const input = { name: 'other-linux', format: 'raw', distro: 'alpine', memoryMiB: 512, cpus: 1 };

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
const ova = (...entries: [string, Buffer][]) => Buffer.concat([
  ...entries.map(([name, content]) => tarEntry(name, content)), Buffer.alloc(1024),
]);

test('checksum is checked before publication, and converted disk receives independent identity', async () => {
  const raw = Buffer.alloc(2048);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const previous = adopted;
  await assert.rejects(importer.import({ ...input, sha256: '0'.repeat(64) }, Readable.from([raw])), /SHA-256/);
  assert.equal(adopted, previous);
  const result = await importer.import({ ...input, sha256 }, Readable.from([raw]));
  assert.equal(result.vm.id, `imported-${previous + 1}`);
  assert.equal(result.source.sha256, sha256);
  assert.equal(result.source.virtualBytes, 2 * GiB);
  assert.deepEqual(await readdir(join(root, 'transfers')), []);
});

test('OVA imports a single referenced disk and rejects duplicate or unsafe members', async () => {
  const ovf = Buffer.from('<Envelope xmlns="http://schemas.dmtf.org/ovf/envelope/1"><References><File href="disk.vmdk"/></References></Envelope>');
  const valid = ova(['vm.ovf', ovf], ['disk.vmdk', vmdk]);
  const result = await importer.import({ ...input, name: 'ova-linux', format: 'ova' }, Readable.from([valid]));
  assert.equal(result.source.member, 'disk.vmdk');
  const before = adopted;
  await assert.rejects(importer.import({ ...input, format: 'ova' }, Readable.from([ova(['vm.ovf', ovf], ['a.vmdk', vmdk], ['b.vmdk', vmdk])])), /多磁盘/);
  await assert.rejects(importer.import({ ...input, format: 'ova' }, Readable.from([ova(['vm.ovf', ovf], ['../disk.vmdk', vmdk])])), /路径无效/);
  assert.equal(adopted, before);
  assert.deepEqual(await readdir(join(root, 'transfers')), []);
});

test('external dependencies and invalid format headers do not publish an instance', async () => {
  const before = adopted;
  await assert.rejects(importer.import({ ...input, format: 'vmdk' }, Readable.from([Buffer.alloc(1024)])), /单文件稀疏 VMDK/);
  const dependent = {
    engine: { run: async () => JSON.stringify({ format: 'raw', 'virtual-size': 2 * GiB, 'backing-filename': 'parent.raw' }) },
    importDisk: async () => { throw new Error('unexpected publish'); },
  } as unknown as Machines;
  await assert.rejects(new DiskImports(dependent).import(input, Readable.from([Buffer.alloc(1024)])), /外部磁盘/);
  assert.equal(adopted, before);
});

test('a small cloud image is expanded to the distribution minimum before publication', async () => {
  const calls: string[][] = [];
  let published: { config: any; options: any } | undefined;
  const small = {
    engine: { run: async (_tool: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'convert') { await writeFile(args.at(-1)!, qcow); return ''; }
      return JSON.stringify(args[2] === 'qcow2'
        ? { format: 'qcow2', 'virtual-size': 4 * GiB }
        : { format: 'raw', 'virtual-size': 128 * 1024 ** 2 });
    } },
    importDisk: async (config: any, _disk: string, options: any) => {
      published = { config, options };
      return { id: 'expanded' };
    },
  } as unknown as Machines;
  const result = await new DiskImports(small).import({
    ...input, name: 'small-ubuntu', distro: 'ubuntu', memoryMiB: 1024,
  }, Readable.from([Buffer.alloc(1024)]));
  assert.equal(result.source.virtualBytes, 128 * 1024 ** 2);
  assert.ok(calls.some((args) => args[0] === 'resize' && args.at(-1) === '4G'));
  assert.equal(published?.config.diskGiB, 4);
  assert.equal(published?.options.pendingResize, true);
});

test('the images plugin accepts a binary upload and returns its published instance', async () => {
  const features = await Features.create(machines, ['images']);
  const request = Object.assign(Readable.from([Buffer.alloc(2048)]), {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' },
  }) as IncomingMessage;
  const response = Object.assign(new EventEmitter(), {
    writableFinished: false,
    status: 0,
    payload: undefined as any,
    writeHead(status: number) { this.status = status; },
    end(value: string) { this.payload = JSON.parse(value); this.writableFinished = true; },
  }) as unknown as ServerResponse & { status: number; payload: any };
  try {
    const url = new URL('http://localhost/api/image-import?name=via-api&format=raw&distro=alpine&memoryMiB=512&cpus=1');
    assert.equal(await features.route(request, response, url, async () => undefined), true);
    assert.equal(response.status, 201);
    assert.match(response.payload.vm.id, /^imported-/);
    assert.equal(response.payload.source.format, 'raw');
  } finally {
    await features.close();
  }
});
