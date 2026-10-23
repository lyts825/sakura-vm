/** 应用运行 CLI；使用随运行包分发的受管网络，不要求 TypeScript 解释器。 */
import { createHash } from 'node:crypto';
import { open, lstat, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const args = process.argv.slice(2),
  command = args.shift(),
  flags = new Map();
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!key.startsWith('--') || flags.has(key)) throw new Error('重复或无效选项 ' + key);
  flags.set(key, args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true);
}
const optional = (k) => (typeof flags.get('--' + k) === 'string' ? flags.get('--' + k) : undefined);
const required = (k) => {
  const value = optional(k);
  if (!value) throw new Error('缺少 --' + k);
  return value;
};
const help = `Sakura 应用运行 CLI
node scripts/app-runtime.mjs <command> --app <UUID> [选项]
认证：SAKURA_TOKEN 或 --token；地址：--url http://127.0.0.1:7337
view      [--section workbench|targets|packages|config|data|observe|routes|recovery|deploy]
act       --section <领域> --file <action.json>
upload    --directory <本地目录> --file <startup.json> --name <名称> --reviewed
preview   --file <plan-input.json>
approve   --id <计划ID> --digest <SHA256> --reviewed
apply     --id <计划ID>
status    [--id <操作ID>]
cancel    --id <操作ID>
上传目录以自身为根；静态包必须含 startup.directory/index.html。
所有输出为 JSON；预览、批准、执行分别操作。act 覆盖网络、数据和冷备恢复等公开动作。`;
async function jsonFile(path) {
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > 1024 ** 2)
    throw new Error('JSON 必须为 1 MiB 以内普通文件');
  const h = await open(path, 'r');
  try {
    return JSON.parse(await h.readFile('utf8'));
  } finally {
    await h.close();
  }
}
async function inventory(root) {
  const out = [];
  let bytes = 0;
  async function walk(path, relative = '') {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name),
        name = relative ? relative + '/' + entry.name : entry.name,
        s = await lstat(full);
      if (s.isSymbolicLink() || s.nlink > 1 || /[\\:\x00-\x1f]/.test(entry.name))
        throw new Error('制品拒绝链接或非法名称：' + name);
      if (s.isDirectory()) await walk(full, name);
      else if (s.isFile()) {
        bytes += s.size;
        if (bytes > 1024 ** 3 || out.length >= 10000) throw new Error('制品超过 1 GiB 或 10000 个文件');
        out.push({ full, path: name, bytes: s.size, mode: s.mode & 0o111 ? 0o755 : 0o644 });
      } else throw new Error('制品含特殊文件：' + name);
    }
  }
  const s = await lstat(root);
  if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('制品根目录必须为普通目录');
  await walk(root);
  return out;
}
async function main() {
  if (!command || command === 'help' || command === '--help') {
    console.log(help);
    return;
  }
  const known = new Set([
    '--app',
    '--section',
    '--token',
    '--url',
    '--file',
    '--directory',
    '--name',
    '--reviewed',
    '--id',
    '--digest',
  ]);
  for (const [k, v] of flags) {
    if (!known.has(k)) throw new Error('未知选项 ' + k);
    if (k === '--reviewed' && v !== true) throw new Error('--reviewed 仅接受显式开关');
  }
  const url = new URL(optional('url') || 'http://127.0.0.1:7337');
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('仅允许本机 HTTP 根地址');
  const appId = required('app');
  if (!/^[a-f0-9-]{36}$/i.test(appId)) throw new Error('应用标识应为 UUID');
  const token = optional('token') || process.env.SAKURA_TOKEN;
  if (!token) throw new Error('缺少 SAKURA_TOKEN');
  const { networkFor, networkRuntime } = await import('../.sakura-server/network-entry.js').catch(() => {
      throw new Error('请先构建项目，或使用含受管网络入口的运行包');
    }),
    network = networkFor('tool:app-runtime-cli');
  try {
    const call = async (section, body) => {
      if (
        ![
          'workbench',
          'targets',
          'packages',
          'config',
          'data',
          'observe',
          'routes',
          'recovery',
          'deploy',
        ].includes(section)
      )
        throw new Error('未知领域');
      const target = new URL('/api/app-' + section, url);
      target.searchParams.set('appId', appId);
      const response = await network.fetch(target, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        headers: { 'x-sakura-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.body) throw new Error('响应缺少内容');
      const reader = response.body.getReader(),
        chunks = [];
      let size = 0;
      try {
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          size += r.value.byteLength;
          if (size > 16 * 1024 ** 2) {
            await reader.cancel();
            throw new Error('响应超过 16 MiB');
          }
          chunks.push(r.value);
        }
      } finally {
        reader.releaseLock();
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!response.ok)
        throw new Error('HTTP ' + response.status + ' ' + (value.error || value.message || '操作失败'));
      return value;
    };
    let result;
    if (command === 'view' || command === 'status') {
      result = await call(optional('section') || 'workbench');
      if (command === 'status' && optional('id'))
        result = result.operations.find((r) => r.id === optional('id')) || null;
    } else if (command === 'act') result = await call(required('section'), await jsonFile(required('file')));
    else if (command === 'preview')
      result = await call('deploy', { ...(await jsonFile(required('file'))), action: 'preview' });
    else if (command === 'approve') {
      if (!flags.has('--reviewed')) throw new Error('批准要求 --reviewed');
      result = await call('deploy', {
        action: 'approve',
        id: required('id'),
        digest: required('digest'),
        reviewed: true,
      });
    } else if (['apply', 'cancel'].includes(command))
      result = await call('deploy', { action: command, id: required('id') });
    else if (command === 'upload') {
      if (!flags.has('--reviewed')) throw new Error('封存要求 --reviewed');
      const startup = await jsonFile(required('file')),
        files = await inventory(resolve(required('directory'))),
        manifest = [];
      for (const f of files) {
        const h = await open(f.full, 'r');
        try {
          const initial = await h.stat();
          if (!initial.isFile() || initial.nlink !== 1 || initial.size !== f.bytes)
            throw new Error('制品身份变化');
          const buf = Buffer.alloc(512 * 1024),
            digest = createHash('sha256');
          for (let offset = 0; offset < f.bytes;) {
            const r = await h.read(buf, 0, Math.min(buf.length, f.bytes - offset), offset);
            if (!r.bytesRead) throw new Error('文件提前结束');
            digest.update(buf.subarray(0, r.bytesRead));
            offset += r.bytesRead;
          }
          const sha256 = digest.digest('hex'),
            upload = (await call('packages', { action: 'begin', sha256, bytes: f.bytes })).uploads[0],
            second = createHash('sha256');
          for (let offset = 0; offset < f.bytes;) {
            const r = await h.read(buf, 0, Math.min(buf.length, f.bytes - offset), offset);
            if (!r.bytesRead) throw new Error('文件提前结束');
            const part = buf.subarray(0, r.bytesRead);
            second.update(part);
            const reply = await call('packages', {
              action: 'chunk',
              id: upload.id,
              offset,
              data: part.toString('base64'),
            });
            offset += r.bytesRead;
            if (reply.transfer?.offset !== offset) throw new Error('上传偏移不符');
          }
          const after = await h.stat();
          if (
            second.digest('hex') !== sha256 ||
            after.ino !== initial.ino ||
            after.mtimeMs !== initial.mtimeMs ||
            after.size !== initial.size
          )
            throw new Error('上传期间制品变化');
          const blob = (await call('packages', { action: 'complete', id: upload.id })).blobs[0];
          manifest.push({ path: f.path, mode: f.mode, ...blob });
        } finally {
          await h.close();
        }
      }
      result = await call('packages', {
        action: 'seal',
        name: required('name'),
        startup,
        files: manifest,
        reviewed: true,
      });
    } else throw new Error('未知命令 ' + command);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await network.close();
    await networkRuntime.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
