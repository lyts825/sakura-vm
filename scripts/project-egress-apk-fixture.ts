/** 自有 Alpine APK 包源夹具，按清单提供受控依赖文件，支持项目出站网络规则的真实安装验证。
 * Serve pinned Alpine package fixtures through a controlled HTTP endpoint for real project-egress verification. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join } from 'node:path';
import type { Socket } from 'node:net';
import { z } from 'zod';

const fileSchema = z.object({
  repo: z.enum(['main', 'community']),
  name: z.string().regex(/^(?:APKINDEX\.tar\.gz|[A-Za-z0-9][A-Za-z0-9._+-]*\.apk)$/),
  size: z.number().int().positive().max(128 * 1048576),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  url: z.string(),
}).strict();
const manifestSchema = z.object({
  version: z.literal(1), kind: z.literal('official-alpine-apk-fixture'),
  distro: z.literal('v3.23'), arch: z.literal('x86_64'),
  files: z.array(fileSchema).min(3).max(256),
}).strict();
/** 对传入内容计算 SHA-256 十六进制摘要，供夹具完整性和前后状态比较；不修改输入。
 * Compute a hexadecimal SHA-256 digest of the input for fixture integrity/before-and-after comparison without mutating it. */
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

// This server serves a frozen, official package fixture to a new test guest.
// The production installer and Alpine's installed signature keys stay intact.
/** 验证绝对物理 manifest、大小和官方 Alpine URL/本地摘要后，在回环提供固定只读 APK 内容；限制缓存总量，保留请求与连接证据而不访问外网补包。
 * Verify physical absolute manifest/budget/official Alpine URLs/local hashes, then serve fixed read-only APKs on loopback; bound total cached bytes and retain request/connection evidence without fetching missing packages. */
export async function startAlpineApkFixture(manifestFile: string) {
  assert.ok(isAbsolute(manifestFile), 'APK fixture manifest must be absolute');
  assert.equal(await realpath(manifestFile), manifestFile);
  const manifestInfo = await lstat(manifestFile);
  assert.ok(manifestInfo.isFile() && !manifestInfo.isSymbolicLink());
  assert.ok(manifestInfo.size <= 131072);
  const raw = await readFile(manifestFile);
  const manifest = manifestSchema.parse(JSON.parse(raw.toString('utf8')));
  const root = dirname(manifestFile);
  const files = new Map<string, { bytes: Buffer; path: string; sha256: string; size: number; url: string }>();
  let total = 0;
  for (const entry of manifest.files) {
    const suffix = entry.repo + '/x86_64/' + entry.name;
    assert.equal(entry.url, 'https://dl-cdn.alpinelinux.org/alpine/v3.23/' + suffix);
    assert.ok(!files.has('/' + suffix), 'duplicate APK fixture file');
    total += entry.size;
    assert.ok(total <= 512 * 1048576, 'APK fixture exceeds total byte budget');
    const path = join(root, entry.repo, 'x86_64', entry.name);
    assert.equal(await realpath(path), path);
    const before = await lstat(path);
    assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1);
    assert.equal(before.size, entry.size);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const info = await handle.stat();
      assert.equal(info.ino, before.ino);
      assert.equal(info.dev, before.dev);
      bytes = await handle.readFile();
      const after = await handle.stat();
      assert.equal(after.size, before.size);
      assert.equal(after.mtimeMs, before.mtimeMs);
    } finally { await handle.close(); }
    assert.equal(bytes.length, entry.size);
    assert.equal(digest(bytes), entry.sha256, 'APK fixture digest mismatch');
    files.set('/' + suffix, { bytes, path, sha256: entry.sha256, size: entry.size, url: entry.url });
  }
  for (const repo of ['main', 'community'])
    assert.ok(files.has('/' + repo + '/x86_64/APKINDEX.tar.gz'), 'both signed official indexes are required');
  const requests: Array<{ method: string; path: string; status: number; size: number; sha256?: string;
    startedAt: string; finishedAt?: string; closedAt?: string }> = [];
  const sockets = new Map<Socket, Promise<void>>();
  const proof = {
    mode: 'local-official-signed-package-fixture',
    manifest: { path: manifestFile, size: raw.length, sha256: digest(raw) },
    files: [...files].map(([path, entry]) => ({ path, sourcePath: entry.path,
      url: entry.url, size: entry.size, sha256: entry.sha256 })),
    requests, listeningAt: '', closedAt: '', actualServerClosed: false,
    cacheUnchanged: false, changed: [] as string[], activeSockets: -1,
    productionInstallCommandUnchanged: true, defaultPublicRepositoryPerformanceValidated: false,
  };
  const server = createServer(/** 仅从已冻结且校验哈希的 APK 映射提供 GET/HEAD；未知路径和方法分别拒绝，并记录开始、finish 与 close 证据，固定长度不从请求路径读磁盘。
 * Serve GET/HEAD only from the frozen hash-verified APK map, rejecting unknown paths/methods and recording start/finish/close evidence; fixed lengths never trigger request-path disk reads. */ (request, response) => {
    const path = request.url || '';
    const method = request.method || '';
    const file = files.get(path);
    const status = method !== 'GET' && method !== 'HEAD' ? 405 : !file ? 404 : 200;
    const record = { method, path, status, size: status === 200 ? file!.size : 0,
      ...(status === 200 ? { sha256: file!.sha256 } : {}), startedAt: new Date().toISOString(),
      finishedAt: undefined as string | undefined, closedAt: undefined as string | undefined };
    requests.push(record);
    response.once('finish', () => { record.finishedAt = new Date().toISOString(); });
    response.once('close', () => { record.closedAt = new Date().toISOString(); });
    response.writeHead(status, { 'Content-Type': 'application/octet-stream',
      'Content-Length': record.size, 'Connection': 'close' });
    response.end(status === 200 && method === 'GET' ? file!.bytes : undefined);
  });
  server.maxConnections = 32;
  server.requestTimeout = 15000;
  server.headersTimeout = 5000;
  server.on('connection', socket => {
    const closed = new Promise<void>(done => socket.once('close', () => { sockets.delete(socket); done(); }));
    sockets.set(socket, closed);
  });
  server.once('close', () => {
    proof.actualServerClosed = true;
    proof.closedAt = new Date().toISOString();
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); done(); });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string' && address.address === '127.0.0.1');
  proof.listeningAt = new Date().toISOString();
  let closing: Promise<void> | undefined;
  return {
    proof, hostPort: address.port,
    repositories: ['main', 'community'].map(repo => 'http://10.0.2.2:' + address.port + '/' + repo).join('\n') + '\n',
    /** 复用关闭 Promise，停止监听并关闭所有夹具连接后等待实际 socket close；再次核对 manifest/包摘要，记录缓存变化并释放内存。
     * Reuse one close promise, stop listening/close fixture connections and await actual socket closure; recheck manifest/package hashes, record cache changes and release memory. */
    close() {
      if (!closing) closing = (/** 关闭监听器并等待本次所有 socket 关闭后，重验每个资源的物理路径与哈希和 manifest 哈希；记录变化并释放内存映射，不修改源缓存。
 * Close the listener and await every owned socket before rechecking each resource’s physical path/hash and the manifest hash; record changes and release the memory map without modifying the source cache. */ async () => {
        const socketClosures = [...sockets.values()];
        await new Promise<void>((done, reject) => {
          server.close(error => error ? reject(error) : done());
          server.closeAllConnections();
        });
        await Promise.all(socketClosures);
        proof.activeSockets = sockets.size;
        for (const entry of files.values()) {
          try {
            if (await realpath(entry.path) !== entry.path || digest(await readFile(entry.path)) !== entry.sha256)
              proof.changed.push(entry.path);
          } catch { proof.changed.push(entry.path); }
        }
        if (digest(await readFile(manifestFile)) !== proof.manifest.sha256) proof.changed.push(manifestFile);
        proof.cacheUnchanged = proof.changed.length === 0;
        files.clear();
      })();
      return closing;
    },
  };
}
