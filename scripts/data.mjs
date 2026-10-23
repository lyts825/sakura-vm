/** 数据工作台 CLI；在线动作先预览，离线 verify 只读取本地 Study。 */
import { open, link, unlink, lstat } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const args = process.argv.slice(2),
  command = args.shift(),
  flags = new Map();
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!key.startsWith('--') || flags.has(key) || !args[i + 1] || args[i + 1].startsWith('--'))
    throw new Error('选项缺少值或重复：' + key);
  flags.set(key, args[++i]);
}
const option = (name, fallback) => flags.get('--' + name) ?? fallback;
const required = (name) => {
  const value = option(name);
  if (!value) throw new Error('缺少 --' + name);
  return value;
};
const sections = new Set([
  'runtime',
  'sources',
  'datasets',
  'transforms',
  'quality',
  'notebooks',
  'experiments',
  'lineage',
  'exchange',
  'workbench',
]);
const CHUNK = 512 * 1024;
async function main() {
  if (!command || ['help', '--help'].includes(command)) {
    console.log(`Sakura 数据工作台 CLI
在线：node scripts/data.mjs <command> --vm <id> --project <id> [选项]
离线：node scripts/data.mjs verify --file <data-study.zip>
认证：SAKURA_TOKEN 或 --token；本机地址：--url http://127.0.0.1:7337
view      [--section workbench]
preview   --file <action.json> [--section workbench]
commit    --plan <token> [--section workbench]
upload    --file <CSV|JSONL|Parquet|data-study.zip>
download  --manifest <id> --out <path>
verify    --file <data-study.zip>（离线，无需 VM、账户、token 或构建）

preview 不执行动作；commit 消费对应插件/项目的一次性 token。
动作完整契约见 docs/data-lab.md。上传仅封存制品，随后用 capture-upload 或 import-preview 登记。
`);
    return;
  }
  if (command === 'verify') {
    for (const key of flags.keys()) if (key !== '--file') throw new Error('离线 verify 仅接受 --file');
    const { verifyStudy } = await import('./study-verify.mjs');
    const abort = new AbortController(),
      cancel = () => abort.abort();
    process.on('SIGINT', cancel);
    try {
      console.log(JSON.stringify(await verifyStudy(required('file'), { signal: abort.signal }), null, 2));
    } finally {
      process.off('SIGINT', cancel);
    }
    return;
  }
  for (const key of flags.keys())
    if (
      ![
        '--vm',
        '--project',
        '--url',
        '--token',
        '--section',
        '--file',
        '--plan',
        '--manifest',
        '--out',
      ].includes(key)
    )
      throw new Error('未知选项 ' + key);
  if (!['view', 'preview', 'commit', 'upload', 'download'].includes(command)) throw new Error('未知命令');
  const vmId = required('vm'),
    projectId = required('project'),
    token = option('token', process.env.SAKURA_TOKEN);
  if (!token) throw new Error('缺少认证 token');
  const url = new URL(option('url', 'http://127.0.0.1:7337'));
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('仅允许本机 HTTP 根地址');
  const section = option('section', 'workbench');
  if (!sections.has(section)) throw new Error('未知数据分区');
  const { networkFor, networkRuntime } = await import('../.sakura-server/network-entry.js').catch(() => {
    throw new Error('请先 npm run build 生成受管网络入口');
  });
  const network = networkFor('tool:data-cli'),
    abort = new AbortController();
  const cancel = () => abort.abort();
  process.on('SIGINT', cancel);
  const call = async (path, body, signal = abort.signal) => {
    const target = new URL(path, url);
    target.search = new URLSearchParams({ vmId, projectId }).toString();
    const response = await network.fetch(target, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-sakura-token': token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
      redirect: 'error',
    });
    const chunks = [];
    let bytes = 0;
    for await (const part of response.body ?? []) {
      bytes += part.length;
      if (bytes > 32 * 1024 ** 2) throw new Error('响应超过 32 MiB');
      chunks.push(Buffer.from(part));
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!response.ok) throw new Error(result.error || result.message || 'HTTP ' + response.status);
    return result;
  };
  try {
    let result;
    if (command === 'view') result = await call('/api/data-' + section);
    if (command === 'preview') {
      const file = await open(resolve(required('file')), 'r');
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 12 * 1024 ** 2)
          throw new Error('动作 JSON 必须是 12 MiB 以内普通文件');
        const input = JSON.parse(await file.readFile('utf8'));
        result = await call('/api/data-' + section, { phase: 'preview', input });
      } finally {
        await file.close();
      }
    }
    if (command === 'commit')
      result = await call('/api/data-' + section, { phase: 'commit', token: required('plan') });
    if (command === 'upload') {
      const path = resolve(required('file'));
      if ((await lstat(path)).isSymbolicLink()) throw new Error('上传路径不能是符号链接');
      const file = await open(path, 'r');
      try {
        const before = await file.stat();
        if (!before.isFile() || before.size > 1024 ** 3) throw new Error('上传必须是 1 GiB 以内普通文件');
        const hash = createHash('sha256');
        for (let offset = 0; offset < before.size;) {
          const bytes = Buffer.alloc(Math.min(CHUNK, before.size - offset));
          const read = await file.read(bytes, 0, bytes.length, offset);
          if (read.bytesRead !== bytes.length) throw new Error('文件读取截断');
          hash.update(bytes);
          offset += bytes.length;
        }
        const sha256 = hash.digest('hex'),
          session = await call('/api/delivery-artifacts', { action: 'begin', sha256, bytes: before.size }),
          second = createHash('sha256');
        for (let offset = 0; offset < before.size;) {
          const bytes = Buffer.alloc(Math.min(CHUNK, before.size - offset));
          const read = await file.read(bytes, 0, bytes.length, offset);
          if (read.bytesRead !== bytes.length) throw new Error('上传过程中内容改变');
          second.update(bytes);
          await call('/api/delivery-artifacts', {
            action: 'chunk',
            id: session.id,
            offset,
            data: bytes.toString('base64'),
          });
          offset += bytes.length;
        }
        const after = await file.stat();
        if (
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          second.digest('hex') !== sha256
        )
          throw new Error('上传过程中源文件改变');
        const blob = await call('/api/delivery-artifacts', { action: 'complete', id: session.id });
        result = await call('/api/delivery-artifacts', {
          action: 'seal',
          kind: 'source',
          label: basename(path),
          files: [{ path: basename(path), ...blob, mode: 256 }],
        });
      } finally {
        await file.close();
      }
    }
    if (command === 'download') {
      const id = required('manifest'),
        manifests = await call('/api/delivery-artifacts'),
        manifest = manifests.find((m) => m.id === id);
      if (!manifest || manifest.files.length !== 1) throw new Error('清单不存在或不是单文件');
      const entry = manifest.files[0],
        lease = await call('/api/delivery-artifacts', { action: 'open-read', id }),
        out = resolve(required('out')),
        temp = out + '.partial-' + randomUUID();
      let handle;
      try {
        handle = await open(temp, 'wx', 0o600);
        const hash = createHash('sha256');
        for (let offset = 0; offset < entry.bytes;) {
          const part = await call('/api/delivery-artifacts', {
              action: 'read',
              blobId: entry.blobId,
              offset,
              length: Math.min(CHUNK, entry.bytes - offset),
            }),
            bytes = Buffer.from(part.data, 'base64');
          if (bytes.length !== Math.min(CHUNK, entry.bytes - offset)) throw new Error('下载截断');
          hash.update(bytes);
          for (let written = 0; written < bytes.length;) {
            const part = await handle.write(bytes, written, bytes.length - written);
            if (!part.bytesWritten) throw new Error('下载写入没有进展');
            written += part.bytesWritten;
          }
          offset += bytes.length;
        }
        if (hash.digest('hex') !== entry.sha256) throw new Error('下载摘要不符');
        await handle.sync();
        await handle.close();
        handle = undefined;
        await link(temp, out);
        result = { path: out, sha256: entry.sha256, bytes: entry.bytes };
      } finally {
        await handle?.close();
        await unlink(temp).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
        await call(
          '/api/delivery-artifacts',
          { action: 'close-read', token: lease.token },
          AbortSignal.timeout(10000),
        );
      }
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    process.off('SIGINT', cancel);
    try {
      await network.close();
    } finally {
      await networkRuntime.close();
    }
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
