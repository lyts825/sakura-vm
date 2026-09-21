import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import type { SFTPWrapper } from 'ssh2';
import { Machines } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';

const path = '/workspace/notes.txt';
const original = Buffer.from('原始内容\n');
function fixture(
  options: {
    failWrite?: boolean;
    failClose?: boolean;
    failMetadata?: boolean;
    failRename?: boolean;
    collide?: boolean;
  } = {},
) {
  const files = new Map<string, Buffer>([[path, original]]);
  const modes = new Map<string, number>([[path, 0o100660]]);
  const owners = new Map([[path, { uid: 1000, gid: 1000 }]]);
  const missing = () => Object.assign(new Error('No such file'), { code: 2 });
  const rename = (from: string, to: string, replace: boolean, cb: (error?: Error) => void) => {
    if (options.collide) files.set(to, original);
    if (options.failRename) return cb(new Error('rename failed'));
    if (!replace && files.has(to)) return cb(new Error('target exists'));
    if (!files.has(from)) return cb(missing());
    files.set(to, files.get(from)!);
    modes.set(to, modes.get(from)!);
    owners.set(to, owners.get(from)!);
    files.delete(from);
    modes.delete(from);
    owners.delete(from);
    cb();
  };
  const ftp = {
    lstat(target: string, cb: (error: Error | undefined, attrs?: unknown) => void) {
      const bytes = files.get(target);
      cb(bytes ? undefined : missing(), {
        size: bytes?.length,
        mode: modes.get(target),
        ...owners.get(target),
        isFile: () => true,
      });
    },
    createWriteStream(target: string, settings?: { flags?: string; mode?: number }) {
      if (settings?.flags === 'wx') assert.equal(files.has(target), false);
      files.set(target, Buffer.alloc(0));
      modes.set(target, (settings?.mode ?? modes.get(target) ?? 0o100644) & ~0o022);
      owners.set(target, { uid: 0, gid: 0 });
      return new Writable({
        autoDestroy: false,
        emitClose: false,
        write(chunk: Buffer, _encoding, cb) {
          files.set(target, Buffer.concat([files.get(target)!, chunk]));
          cb(options.failWrite ? new Error('connection lost during write') : undefined);
        },
        final(cb) {
          this.destroy();
          cb();
        },
        destroy(error, cb) {
          setImmediate(() => {
            const failure = error || (options.failClose ? new Error('write handle close failed') : null);
            cb(failure);
            if (!failure) this.emit('close');
          });
        },
      });
    },
    chown(target: string, uid: number, gid: number, cb: (error?: Error) => void) {
      if (options.failMetadata) return cb(new Error('metadata update failed'));
      owners.set(target, { uid, gid });
      cb();
    },
    chmod(target: string, mode: number, cb: () => void) {
      modes.set(target, 0o100000 | mode);
      cb();
    },
    createReadStream(target: string) {
      const bytes = files.get(target)!;
      // Include boundaries inside a UTF-8 character and before an incomplete suffix.
      return Readable.from([bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)]);
    },
    rename(from: string, to: string, cb: (error?: Error) => void) {
      rename(from, to, false, cb);
    },
    ext_openssh_rename(from: string, to: string, cb: (error?: Error) => void) {
      rename(from, to, true, cb);
    },
    unlink(target: string, cb: () => void) {
      files.delete(target);
      modes.delete(target);
      owners.delete(target);
      cb();
    },
  } as unknown as SFTPWrapper;
  const machines = new Machines({} as Engine);
  machines.sftp = async (_id, work) => work(ftp);
  return { machines, files, modes, owners };
}

test('creating a text file never overwrites an existing file', async () => {
  const { machines, files } = fixture();
  await assert.rejects(machines.writeGuestFile('vm', path, 'replacement', false), /已存在/);
  assert.deepEqual(files.get(path), original);
  assert.equal(files.size, 1);
});

test('a text file created by another writer during save is preserved', async () => {
  const { machines, files } = fixture({ collide: true });
  files.delete(path);
  await assert.rejects(machines.writeGuestFile('vm', path, 'replacement', false), /exists/);
  assert.deepEqual(files.get(path), original);
  assert.equal(files.size, 1);
});

for (const failure of ['failWrite', 'failClose', 'failMetadata', 'failRename'] as const) {
  test(`a failed text save preserves the original and removes partial files (${failure})`, async () => {
    const { machines, files } = fixture({ [failure]: true });
    await assert.rejects(machines.writeGuestFile('vm', path, 'replacement'), /lost|failed/);
    assert.deepEqual(files.get(path), original);
    assert.equal(files.size, 1);
  });
}

test('successful text saves preserve ownership and permissions and support new empty files', async () => {
  const { machines, files, modes, owners } = fixture();
  await machines.writeGuestFile('vm', path, '新内容\n');
  assert.equal(files.get(path)?.toString(), '新内容\n');
  assert.equal(modes.get(path), 0o100660);
  assert.deepEqual(owners.get(path), { uid: 1000, gid: 1000 });
  await machines.writeGuestFile('vm', '/workspace/empty.txt', '', false);
  assert.equal(files.get('/workspace/empty.txt')?.length, 0);
  assert.equal(files.size, 2);
});

test('text save limits use UTF-8 bytes and reject oversized content before modifying files', async () => {
  const { machines, files } = fixture();
  const content = '中'.repeat(Math.ceil(1024 ** 2 / 3));
  assert.ok(content.length < 1024 ** 2);
  await assert.rejects(machines.writeGuestFile('vm', path, content), /1 MiB/);
  assert.deepEqual(files.get(path), original);
  assert.equal(files.size, 1);
  const limit = 'a'.repeat(1024 ** 2);
  await machines.writeGuestFile('vm', path, limit);
  assert.equal(await machines.readGuestFile('vm', path), limit);
});

test('text previews reject invalid and incomplete UTF-8 instead of silently replacing bytes', async () => {
  const { machines, files } = fixture();
  for (const bytes of [Buffer.from([0xff, 0xfe, 0x41]), Buffer.from([0xe4, 0xb8])]) {
    files.set(path, bytes);
    await assert.rejects(machines.readGuestFile('vm', path), /UTF-8/);
    assert.deepEqual(files.get(path), bytes);
  }
});

test('text previews preserve split UTF-8, a BOM and actual replacement characters', async () => {
  const { machines, files } = fixture();
  for (const content of ['', '中文 🌸\n', '\uFEFF中文\r\n', 'a\uFFFDb']) {
    files.set(path, Buffer.from(content));
    assert.equal(await machines.readGuestFile('vm', path), content);
  }
  files.set(path, Buffer.from([0, 1, 2]));
  await assert.rejects(machines.readGuestFile('vm', path), /二进制/);
  files.set(path, Buffer.alloc(1024 ** 2 + 1, 65));
  await assert.rejects(machines.readGuestFile('vm', path), /1 MiB/);
});

test('text previews wait for SFTP handle closure and report delayed close failures', async () => {
  const { machines } = fixture();
  machines.sftp = async (_id, work) => {
    const stream = new Readable({
      autoDestroy: false,
      emitClose: false,
      read() {
        this.push(original);
        this.push(null);
      },
      destroy(_error, cb) {
        setImmediate(() => cb(new Error('read handle close failed')));
      },
    });
    stream.on('end', () => stream.destroy());
    return work({ createReadStream: () => stream } as unknown as SFTPWrapper);
  };
  await assert.rejects(machines.readGuestFile('vm', path), /read handle close failed/);
});
