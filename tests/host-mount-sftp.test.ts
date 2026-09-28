import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client, type SFTPWrapper } from 'ssh2';
import { test } from 'node:test';
import { hostMountPath, serveHostMount } from '../server/host-mount-sftp.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-host-mount-test-'));
const shared = join(root, 'shared');
await mkdir(shared);
await writeFile(join(shared, 'hello.txt'), 'host-data');

async function connect(port: number, privateKey: string) {
  const client = new Client();
  await new Promise<void>((done, reject) => {
    client.once('ready', done).once('error', reject);
    client.connect({ host: '127.0.0.1', port, username: 'sakura-host', privateKey,
      readyTimeout: 5000 });
  });
  const ftp = await new Promise<SFTPWrapper>((done, reject) =>
    client.sftp((error, result) => error ? reject(error) : done(result)));
  return { client, ftp };
}
const stat = (ftp: SFTPWrapper, path: string) => new Promise<void>((done, reject) =>
  ftp.stat(path, (error) => error ? reject(error) : done()));
const write = (ftp: SFTPWrapper, path: string, content: string) => new Promise<void>((done, reject) => {
  const stream = ftp.createWriteStream(path);
  stream.once('error', reject).once('close', done).end(content);
});
const read = (ftp: SFTPWrapper, path: string) => new Promise<string>((done, reject) => {
  const chunks: Buffer[] = [];
  ftp.createReadStream(path).on('data', (chunk: Buffer) => chunks.push(chunk))
    .once('error', reject).once('close', () => done(Buffer.concat(chunks).toString()));
});

test.after(async () => {
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\') ||
    resolve(root).startsWith(resolve(tmpdir()) + '/'));
  await rm(root, { recursive: true, force: true });
});

test('host share maps only ordinary paths below configured root', () => {
  assert.equal(hostMountPath(shared, '/hello.txt'), join(shared, 'hello.txt'));
  assert.throws(() => hostMountPath(shared, '/../outside.txt'));
  assert.throws(() => hostMountPath(shared, '/sub\\..\\outside.txt'));
  assert.throws(() => hostMountPath(shared, '/file:stream'));
});

test('SFTP share reads and writes files while denying parent paths and links', async () => {
  const server = await serveHostMount(shared, false);
  const { client, ftp } = await connect(server.port, server.clientPrivate);
  try {
    assert.equal(await read(ftp, '/hello.txt'), 'host-data');
    await write(ftp, '/written.txt', 'guest-data');
    assert.equal(await readFile(join(shared, 'written.txt'), 'utf8'), 'guest-data');
    await assert.rejects(stat(ftp, '/../outside.txt'), (error: any) => error.code === 3);
    await assert.rejects(stat(ftp, '/hello.txt/../../outside.txt'), (error: any) =>
      error.code === 3);
    await assert.rejects(new Promise<void>((done, reject) =>
      ftp.rmdir('/', (error) => error ? reject(error) : done())),
    (error: any) => error.code === 3);
    try {
      await symlink(root, join(shared, 'escape'), 'junction');
      await assert.rejects(stat(ftp, '/escape/outside.txt'), (error: any) => error.code === 3);
    } catch (error: any) {
      if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    }
  } finally { client.end(); await server.close(); }
});

test('read-only SFTP share rejects mutations', async () => {
  const server = await serveHostMount(shared, true);
  const { client, ftp } = await connect(server.port, server.clientPrivate);
  try {
    assert.equal(await read(ftp, '/hello.txt'), 'host-data');
    await assert.rejects(write(ftp, '/denied.txt', 'bad'), (error: any) => error.code === 3);
    await assert.rejects(new Promise<void>((done, reject) =>
      ftp.unlink('/hello.txt', (error) => error ? reject(error) : done())),
    (error: any) => error.code === 3);
    assert.equal(await readFile(join(shared, 'hello.txt'), 'utf8'), 'host-data');
  } finally { client.end(); await server.close(); }
});

test('closing the share disconnects an active SFTP client', async () => {
  const server = await serveHostMount(shared, true);
  const { client, ftp } = await connect(server.port, server.clientPrivate);
  try {
    await stat(ftp, '/hello.txt');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([server.close(), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('host share did not close')), 3000);
      })]);
    } finally { clearTimeout(timeout); }
  } finally { client.destroy(); }
});
