import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'sakura-firmware-'));
assert.equal(dirname(root), resolve(tmpdir()));
assert.ok(basename(root).startsWith('sakura-firmware-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_QEMU_DIR = join(root, 'qemu');
const { firmwareSupport, ensureUefiFirmware, requireUefiSupport } = await import('../server/firmware.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

test('UEFI support requires both regular OVMF files and preserves each instance NVRAM', async () => {
  assert.equal((await firmwareSupport()).available, false);
  await assert.rejects(requireUefiSupport(), /OVMF/);
  const share = join(root, 'qemu', 'share');
  await mkdir(share, { recursive: true });
  const code = join(share, 'edk2-x86_64-code.fd');
  const template = join(share, 'edk2-i386-vars.fd');
  await writeFile(code, Buffer.alloc(65536, 1));
  await writeFile(template, Buffer.alloc(65536, 2));
  assert.equal((await firmwareSupport()).available, true);
  const id = randomUUID();
  await mkdir(vmDir(id), { recursive: true });
  const paths = await ensureUefiFirmware(id);
  assert.equal(paths.code, code);
  assert.equal((await readFile(paths.vars))[0], 2);
  const changed = Buffer.alloc(65536, 3);
  await writeFile(paths.vars, changed);
  await ensureUefiFirmware(id);
  assert.deepEqual(await readFile(paths.vars), changed);
  await writeFile(paths.vars, 'invalid');
  await assert.rejects(ensureUefiFirmware(id), /NVRAM 文件无效/);
});

test('VM configuration accepts BIOS or UEFI but rejects unknown firmware', () => {
  assert.equal(createSchema.parse({ name: 'uefi-test', firmware: 'uefi' }).firmware, 'uefi');
  assert.equal(createSchema.parse({ name: 'bios-test' }).firmware, undefined);
  assert.throws(() => createSchema.parse({ name: 'unknown-test', firmware: 'other' }));
});
