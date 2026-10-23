/** 本地交付 CLI；通过编译的受管网络入口调用宿主 HTTP API，交付文件使用有界分块读写。
 * Local delivery CLI using the compiled managed network entry for host HTTP APIs and bounded package transfers. */
import { createHash, randomUUID } from 'node:crypto';
import { open, lstat, link, unlink } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
const help = `Sakura 项目交付 CLI
用法：npm run delivery -- <command> --vm <id> --project <id> [选项]
认证：--token <token> 或 SAKURA_TOKEN；地址：--url http://127.0.0.1:7337

view              [--section workbench|inputs|artifacts|runners|reports|gates|previews|releases]
template-preview  --file <delivery.json>
template-save     --file <delivery.json> [--id <definition-id>] [--revision <n>]
input-preview     --file <delivery.json> [--reviewed-draft]
input-capture     --plan <token>
run               --input <snapshot-id> --reviewed
status            [--run <run-id>]
cancel            --run <run-id>
candidate         --input <snapshot-id> --run <run-id> --manifest <output-id>
gate-policy       --file <policy.json>
gate              --file <evaluation.json>
register          --file <registration.json>
export            --release <id> --out <file.sakura-delivery.zip> [--include-source] [--signing-key <reference>]
import            --file <file.sakura-delivery.zip>
accept            --file <acceptance.json>
act               --section <section> --file <action.json>

JSON 输出可重定向保存。预览不会保存定义或启动运行；必须使用后续显式命令。
import 仅保存隔离导入记录；accept 和 validate-artifact 仍需审阅并单独提交。
act 覆盖恢复、通道、预览和接收端验证等 API 操作；请求体沿用公开线路契约。
`;
const args = process.argv.slice(2),
  command = args.shift();
const flags = new Map();
for (let index = 0; index < args.length; index++) {
  const name = args[index];
  if (!name.startsWith('--') || flags.has(name)) throw new Error('选项格式无效或重复：' + name);
  flags.set(name, args[index + 1] && !args[index + 1].startsWith('--') ? args[++index] : true);
}
/** 返回指定选项的文本值，布尔开关返回 undefined。
 * Return the named text option, leaving boolean flags undefined. */
const optional = (name) => (typeof flags.get('--' + name) === 'string' ? flags.get('--' + name) : undefined);
/** 读取必填选项；缺失时在发送请求前报错。
 * Read a required option, failing before any request when absent. */
const required = (name) => {
  const value = optional(name);
  if (!value) throw new Error('缺少 --' + name);
  return value;
};
const sections = new Set([
  'workbench',
  'inputs',
  'artifacts',
  'runners',
  'reports',
  'gates',
  'previews',
  'releases',
]);
const CHUNK = 512 * 1024;
/** 读取 path 指向的有界 JSON 普通文件，并在解析失败时关闭句柄。
 * Read bounded JSON from the ordinary file at path and close its handle even if parsing fails. */
async function jsonFile(path) {
  const file = await open(resolve(path), 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 1024 ** 2) throw new Error('JSON 文件必须是 1 MiB 以内的普通文件');
    return JSON.parse(await file.readFile('utf8'));
  } finally {
    await file.close();
  }
}
/** 校验本机地址、认证和项目范围后执行一个命令，输出 JSON 或抛出错误。
 * Validate the loopback endpoint, credentials and project scope, then execute one command and emit JSON or throw.
 * 设计思路 / Design：下载先取限时租约，核验全部分块后以独占链接发布，finally 释放租约；
 * downloads obtain a bounded lease, publish through an exclusive link after verification, and release in finally.
 * 上传两次流式摘要一致后才完成制品；失败的服务端上传保留供审阅清理。
 * Uploads complete only after two matching streamed digests; failed server uploads remain for reviewed cleanup. */
async function main() {
  if (!command || command === 'help' || command === '--help' || flags.has('--help')) {
    console.log(help);
    return;
  }
  const known = new Set([
    '--vm',
    '--project',
    '--token',
    '--url',
    '--section',
    '--file',
    '--id',
    '--revision',
    '--plan',
    '--input',
    '--run',
    '--manifest',
    '--release',
    '--out',
    '--signing-key',
    '--reviewed',
    '--reviewed-draft',
    '--include-source',
  ]);
  for (const [name, value] of flags) {
    if (!known.has(name)) throw new Error('未知选项：' + name);
    if (['--reviewed', '--reviewed-draft', '--include-source'].includes(name) && value !== true)
      throw new Error(name + ' 是显式开关，不接受值');
  }
  const url = new URL(optional('url') || 'http://127.0.0.1:7337');
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('CLI 仅接受本机 HTTP 根地址');
  const token = optional('token') || process.env.SAKURA_TOKEN;
  if (!token) throw new Error('请设置 SAKURA_TOKEN 或传入 --token');
  const vmId = required('vm'),
    projectId = required('project');
  // help 无需构建；实际联网仅使用随包的受管入口，不加载 TypeScript 源码。
  // Help needs no build; network commands use the packaged managed entry without loading TypeScript source.
  const { networkFor, networkRuntime } = await import('../.sakura-server/network-entry.js').catch((error) => {
    throw new Error(
      '受管网络入口不可用；源码目录请先运行 npm run build，运行包请安装运行依赖。' + String(error),
    );
  });
  const network = networkFor('tool:delivery-cli');
  try {
    const { fetch } = network;
    /** 以固定范围访问 section 的 GET/POST，限制响应内存并拒绝重定向。
     * Call the scoped section with GET/POST, bounding response memory and rejecting redirects. */
    const call = async (section, body) => {
      if (!sections.has(section)) throw new Error('交付领域不存在：' + section);
      const target = new URL('/api/delivery-' + section, url);
      target.search = new URLSearchParams({ vmId, projectId }).toString();
      const response = await fetch(target, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        headers: { 'x-sakura-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const chunks = [];
      let total = 0;
      if (!response.body) throw new Error('服务未返回 JSON 内容');
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          total += chunk.byteLength;
          if (total > 16 * 1024 ** 2) {
            await reader.cancel();
            throw new Error('服务响应超过 16 MiB');
          }
          chunks.push(chunk);
        }
      } finally {
        reader.releaseLock();
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!response.ok)
        throw new Error(
          'HTTP ' + response.status + '：' + String(result.error || result.message || '交付请求失败'),
        );
      return result;
    };
    /** 解析本命令明确指定的 JSON 输入文件。
     * Parse the JSON input file explicitly selected for this command. */
    const input = async () => jsonFile(required('file'));
    let result;
    if (command === 'view') result = await call(optional('section') || 'workbench');
    else if (command === 'template-preview')
      result = await call('workbench', { action: 'preview-import', text: JSON.stringify(await input()) });
    else if (command === 'template-save') {
      const json = await input(),
        revision = Number(optional('revision') || '0');
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('--revision 必须是非负整数');
      result = await call('workbench', {
        action: 'save',
        input: {
          definition: json.definition || json,
          expectedRevision: revision,
          ...(optional('id') ? { id: optional('id') } : {}),
        },
      });
    } else if (command === 'input-preview') {
      const json = await input();
      result = await call('inputs', {
        action: 'preview',
        definition: json.definition || json,
        reviewedDraft: flags.has('--reviewed-draft'),
      });
    } else if (command === 'input-capture')
      result = await call('inputs', { action: 'capture', token: required('plan') });
    else if (command === 'run') {
      if (!flags.has('--reviewed')) throw new Error('审阅输入、命令和联网权限后传入 --reviewed');
      result = await call('runners', {
        action: 'start',
        input: { mode: 'build', inputId: required('input'), reviewed: true },
      });
    } else if (command === 'status') {
      const runs = await call('runners');
      result = optional('run') ? runs.find((run) => run.id === optional('run')) : runs;
      if (!result) throw new Error('当前项目中不存在指定运行');
    } else if (command === 'cancel')
      result = await call('runners', { action: 'cancel', id: required('run') });
    else if (command === 'candidate')
      result = await call('releases', {
        action: 'candidate',
        inputId: required('input'),
        runId: required('run'),
        manifestId: required('manifest'),
      });
    else if (command === 'gate-policy')
      result = await call('gates', { action: 'policy', input: await input() });
    else if (command === 'gate') result = await call('gates', { action: 'evaluate', input: await input() });
    else if (command === 'register')
      result = await call('releases', { ...(await input()), action: 'register' });
    else if (command === 'accept') result = await call('releases', { ...(await input()), action: 'accept' });
    else if (command === 'act') result = await call(required('section'), await input());
    else if (command === 'export') {
      const exported = await call('releases', {
        action: 'export',
        id: required('release'),
        includeSource: flags.has('--include-source'),
        ...(optional('signing-key') ? { signingKeyRef: optional('signing-key') } : {}),
      });
      const file = exported.manifest.files[0];
      if (
        exported.manifest.files.length !== 1 ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        file.bytes > 2 ** 30 ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        exported.packageDigest !== file.sha256
      )
        throw new Error('导出清单格式无效');
      const target = resolve(required('out')),
        temporary = target + '.partial-' + randomUUID();
      const handle = await open(temporary, 'wx', 0o600),
        hash = createHash('sha256');
      let offset = 0;
      let lease;
      try {
        lease = await call('artifacts', { action: 'open-read', id: exported.manifest.id });
        if (
          !lease ||
          typeof lease.token !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lease.token)
        ) {
          lease = undefined;
          throw new Error('下载保护租约格式无效');
        }
        if (typeof lease.expiresAt !== 'string' || !Number.isFinite(Date.parse(lease.expiresAt)))
          throw new Error('下载保护租约期限无效');
        while (offset < file.bytes) {
          if (Date.parse(lease.expiresAt) <= Date.now()) throw new Error('下载租约已到期，请重新导出下载');
          const part = await call('artifacts', {
            action: 'read',
            blobId: file.blobId,
            offset,
            length: CHUNK,
          });
          const bytes = Buffer.from(part.data, 'base64');
          if (
            !bytes.length ||
            bytes.length > CHUNK ||
            part.offset !== offset + bytes.length ||
            part.offset > file.bytes ||
            part.sha256 !== file.sha256
          )
            throw new Error('下载分块身份或长度不一致');
          hash.update(bytes);
          let written = 0;
          while (written < bytes.length) {
            const chunk = await handle.write(bytes, written, bytes.length - written, offset + written);
            written += chunk.bytesWritten;
          }
          offset = part.offset;
        }
        if (hash.digest('hex') !== file.sha256) throw new Error('导出文件摘要不一致');
        await handle.sync();
        await handle.close();
        await link(temporary, target);
        await unlink(temporary);
        result = {
          path: target,
          bytes: offset,
          packageDigest: exported.packageDigest,
          signed: exported.signed,
        };
      } catch (error) {
        await handle.close().catch(() => {});
        await unlink(temporary).catch(() => {});
        throw error;
      } finally {
        if (lease)
          await call('artifacts', { action: 'close-read', token: lease.token }).catch((error) => {
            console.error('下载租约关闭未确认，将于 ' + lease.expiresAt + ' 到期：' + String(error));
            process.exitCode = 1;
          });
      }
    } else if (command === 'import') {
      const path = resolve(required('file')),
        before = await lstat(path);
      if (!before.isFile() || before.isSymbolicLink() || before.size > 2 ** 30)
        throw new Error('交付包必须是 1 GiB 以内的普通文件');
      const handle = await open(path, 'r'),
        buffer = Buffer.alloc(CHUNK),
        hash = createHash('sha256');
      try {
        const opened = await handle.stat();
        if (opened.ino !== before.ino || opened.dev !== before.dev) throw new Error('交付文件身份已变化');
        for (let offset = 0; ;) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
          if (!bytesRead) break;
          hash.update(buffer.subarray(0, bytesRead));
          offset += bytesRead;
        }
        const digest = hash.digest('hex'),
          upload = await call('artifacts', { action: 'begin', sha256: digest, bytes: before.size }),
          second = createHash('sha256');
        for (let offset = 0; offset < before.size;) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            Math.min(buffer.length, before.size - offset),
            offset,
          );
          if (!bytesRead) throw new Error('交付文件被截断');
          const bytes = buffer.subarray(0, bytesRead);
          second.update(bytes);
          const written = await call('artifacts', {
            action: 'chunk',
            id: upload.id,
            offset,
            data: bytes.toString('base64'),
          });
          if (written.offset !== offset + bytesRead) throw new Error('服务端上传偏移不一致');
          offset = written.offset;
        }
        const after = await handle.stat();
        if (second.digest('hex') !== digest || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
          throw new Error('上传期间文件已变化，未发布上传内容');
        const blob = await call('artifacts', { action: 'complete', id: upload.id });
        const manifest = await call('artifacts', {
          action: 'seal',
          label: basename(path),
          kind: 'import',
          files: [{ ...blob, path: 'delivery.sakura-delivery.zip', mode: 0o600 }],
        });
        result = await call('releases', { action: 'import', manifestId: manifest.id });
      } finally {
        await handle.close();
      }
    } else throw new Error('未知命令：' + command + '；使用 help 查看帮助');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    // 本 CLI 拥有独立运行时，先关闭作用域，再等待工作进程退出。
    // This CLI owns its runtime: close the scope first, then wait for worker shutdown.
    try {
      await network.close();
    } finally {
      await networkRuntime.close();
    }
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : '交付命令失败');
  process.exitCode = 1;
});
