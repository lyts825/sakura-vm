/** 纯 Node 镜像工坊 CLI，使用发行包受管网络及有界流式文件。 */
import { createHash, randomUUID } from 'node:crypto';
import { open, lstat, link, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
const args = process.argv.slice(2),
  command = args.shift(),
  flags = new Map();
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--') || flags.has(args[i])) throw new Error('重复或无效选项');
  flags.set(args[i], args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true);
}
const allowedFlags = new Set([
  '--workspace',
  '--section',
  '--file',
  '--task',
  '--id',
  '--plan',
  '--out',
  '--token',
  '--url',
  '--reviewed',
]);
for (const flag of flags.keys()) if (!allowedFlags.has(flag)) throw new Error('未知选项：' + flag);
const required = (name) => {
  const v = flags.get('--' + name);
  if (typeof v !== 'string') throw new Error('缺少 --' + name);
  return v;
};
const optional = (name) => (typeof flags.get('--' + name) === 'string' ? flags.get('--' + name) : undefined);
const sections = new Set([
  'sources',
  'blueprints',
  'depot',
  'builders',
  'sanitizers',
  'checks',
  'catalog',
  'exchange',
  'workbench',
]);
const magic = Buffer.from('SAKURA-IMAGE-1\n');
const help = `镜像工坊 CLI（应用运行时必须已构建）
node scripts/foundry.mjs view --section <阶段> [--workspace local]
node scripts/foundry.mjs act --section <阶段> --file <action.json>
node scripts/foundry.mjs plan --section <阶段> --task <任务> --id <记录ID> --reviewed
node scripts/foundry.mjs execute --section <阶段> --plan <令牌> --reviewed
node scripts/foundry.mjs export --section catalog --id <镜像记录ID> --out <文件.sakura-image>
node scripts/foundry.mjs import --file <文件.sakura-image>
认证：SAKURA_TOKEN 或 --token；地址：--url http://127.0.0.1:7337
view 不执行内容；import 只保存隔离记录，仍需接收、清理与本机验收。
`;
async function jsonFile(path) {
  const f = await open(resolve(path), 'r');
  try {
    const s = await f.stat();
    if (!s.isFile() || s.size > 1024 ** 2) throw new Error('JSON 输入须为 1 MiB 以内普通文件');
    return JSON.parse(await f.readFile('utf8'));
  } finally {
    await f.close();
  }
}
async function writeAll(file, bytes) {
  let p = 0;
  while (p < bytes.length) {
    const r = await file.write(bytes, p, bytes.length - p);
    if (!r.bytesWritten) throw new Error('文件写入中断');
    p += r.bytesWritten;
  }
}
async function main() {
  if (!command || command === 'help' || command === '--help') {
    console.log(help);
    return;
  }
  const base = new URL(optional('url') || 'http://127.0.0.1:7337');
  if (
    base.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('仅接受本机 HTTP 根地址');
  const token = optional('token') || process.env.SAKURA_TOKEN;
  if (!token) throw new Error('缺少认证令牌');
  const workspace = optional('workspace') || 'local',
    section = optional('section') || 'workbench';
  if (!sections.has(section)) throw new Error('未知阶段');
  const { networkFor, networkRuntime } = await import('../.sakura-server/network-entry.js');
  const network = networkFor('tool:foundry-cli');
  const call = async (part, input) => {
    const url = new URL('/api/foundry-' + part, base);
    url.searchParams.set('workspaceId', workspace);
    const r = await network.fetch(url, {
      method: input ? 'POST' : 'GET',
      redirect: 'error',
      headers: { 'x-sakura-token': token, ...(input ? { 'content-type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    if (!r.body) throw new Error('响应缺少正文');
    const reader = r.body.getReader(),
      chunks = [];
    let total = 0;
    try {
      for (;;) {
        const x = await reader.read();
        if (x.done) break;
        total += x.value.byteLength;
        if (total > 16 * 1024 ** 2) {
          await reader.cancel();
          throw new Error('响应超过限额');
        }
        chunks.push(Buffer.from(x.value));
      }
    } finally {
      reader.releaseLock();
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!r.ok) throw new Error(value.message || value.error || 'HTTP ' + r.status);
    return value;
  };
  try {
    let result;
    if (command === 'view') result = await call(section);
    else if (command === 'act') result = await call(section, await jsonFile(required('file')));
    else if (command === 'plan') {
      if (flags.get('--reviewed') !== true) throw new Error('需要 --reviewed');
      result = await call(section, {
        action: 'plan',
        input: { task: required('task'), id: required('id'), name: '', reviewed: true },
      });
    } else if (command === 'execute') {
      if (flags.get('--reviewed') !== true) throw new Error('需要 --reviewed');
      result = await call(section, { action: 'execute', token: required('plan') });
    } else if (command === 'export') {
      const view = await call(section),
        row = view.rows?.find((x) => x.id === required('id'));
      if (!row?.image || !['published', 'succeeded'].includes(row.state) || row.cleanup !== 'confirmed')
        throw new Error('只能导出已完成且已确认清理的镜像');
      const target = resolve(required('out'));
      try {
        await lstat(target);
        throw new Error('目标文件已存在');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      const part = target + '.' + randomUUID() + '.part',
        file = await open(part, 'wx', 0o600);
      let lease;
      try {
        lease = await call(section, { action: 'open-read', id: row.id });
        if (
          !/^[a-f0-9-]{36}$/.test(lease.token) ||
          !Number.isFinite(Date.parse(lease.expiresAt)) ||
          Date.parse(lease.expiresAt) <= Date.now()
        )
          throw new Error('读取租约无效');
        const header = Buffer.from(
          JSON.stringify({
            format: 'sakura-image-v1',
            image: row.image,
            blueprint: row.blueprint,
            revisionDigest: row.digest,
            signature: null,
          }),
        );
        if (header.length > 1024 ** 2) throw new Error('交接头超过限额');
        const len = Buffer.alloc(4);
        len.writeUInt32BE(header.length);
        const envelope = Buffer.concat([magic, len, header]);
        await writeAll(file, envelope);
        const packageHash = createHash('sha256').update(envelope);
        const hash = createHash('sha256');
        let offset = 0;
        while (offset < row.image.bytes) {
          const length = Math.min(524288, row.image.bytes - offset),
            r = await call(section, {
              action: 'read',
              imageRef: lease.imageRef,
              token: lease.token,
              offset,
              length,
            }),
            bytes = Buffer.from(r.data, 'base64');
          if (
            bytes.length !== length ||
            r.offset !== offset + length ||
            r.eof !== (r.offset === row.image.bytes)
          )
            throw new Error('镜像分块响应无效');
          hash.update(bytes);
          packageHash.update(bytes);
          await writeAll(file, bytes);
          offset = r.offset;
        }
        if (hash.digest('hex') !== row.image.digest) throw new Error('导出摘要不匹配');
        await writeAll(file, packageHash.digest());
        await file.sync();
        await file.close();
        await link(part, target);
        await unlink(part);
        result = { path: target, digest: row.image.digest, bytes: row.image.bytes };
      } catch (e) {
        await file.close().catch(() => {});
        throw e;
      } finally {
        if (lease) await call(section, { action: 'close-read', token: lease.token });
      }
    } else if (command === 'import') {
      const file = await open(resolve(required('file')), 'r');
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 32 * 1024 ** 3 + 1024 ** 2 + magic.length + 4 + 32)
          throw new Error('交接文件超过限额或不是普通文件');
        const prefix = Buffer.alloc(magic.length + 4);
        if (
          (await file.read(prefix, 0, prefix.length, 0)).bytesRead !== prefix.length ||
          !prefix.subarray(0, magic.length).equals(magic)
        )
          throw new Error('不是镜像工坊交接格式');
        const size = prefix.readUInt32BE(magic.length);
        if (size > 1024 ** 2) throw new Error('交接头超限');
        const bytes = Buffer.alloc(size);
        if ((await file.read(bytes, 0, size, prefix.length)).bytesRead !== size)
          throw new Error('交接头截断');
        const meta = JSON.parse(bytes.toString('utf8'));
        if (
          meta.format !== 'sakura-image-v1' ||
          meta.signature !== null ||
          !meta.image ||
          !/^[a-f0-9]{64}$/.test(meta.image.digest) ||
          meta.image.id !== meta.image.digest ||
          !Number.isSafeInteger(meta.image.bytes) ||
          meta.image.bytes < 1 ||
          meta.image.bytes > 32 * 1024 ** 3 ||
          stat.size !== prefix.length + size + meta.image.bytes + 32
        )
          throw new Error('交接元数据或长度无效；本CLI只接受明确未签名内容');
        const upload = await call('exchange', {
          action: 'begin-import',
          input: {
            digest: meta.image.digest,
            bytes: meta.image.bytes,
            distro: meta.image.distro,
            architecture: meta.image.architecture,
            source: 'sakura-image-v1',
          },
          ...(meta.blueprint ? { blueprint: meta.blueprint } : {}),
        });
        const hash = createHash('sha256'),
          packageHash = createHash('sha256').update(prefix).update(bytes);
        for (let offset = 0; offset < meta.image.bytes;) {
          const length = Math.min(524288, meta.image.bytes - offset),
            chunk = Buffer.alloc(length);
          if ((await file.read(chunk, 0, length, prefix.length + size + offset)).bytesRead !== length)
            throw new Error('磁盘段截断');
          hash.update(chunk);
          packageHash.update(chunk);
          const r = await call('exchange', {
            action: 'append-import',
            id: upload.id,
            offset,
            data: chunk.toString('base64'),
          });
          if (r.offset !== offset + length) throw new Error('上传偏移不符');
          offset += length;
        }
        if (hash.digest('hex') !== meta.image.digest) throw new Error('导入磁盘摘要错误');
        const trailer = Buffer.alloc(32);
        if (
          (await file.read(trailer, 0, 32, prefix.length + size + meta.image.bytes)).bytesRead !== 32 ||
          !trailer.equals(packageHash.digest())
        )
          throw new Error('交接包整体摘要错误');
        result = await call('exchange', { action: 'finish-import', id: upload.id });
      } finally {
        await file.close();
      }
    } else throw new Error('未知命令');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await network.close();
    await networkRuntime.close();
  }
}
main().catch((e) => {
  console.error(e.message || String(e));
  process.exitCode = 1;
});
