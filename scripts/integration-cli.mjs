/** 纯 Node 集成 CLI，与网页共享 HTTP 领域服务。 Pure Node CLI using the same domain gateway. */
import { readFile, open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import {
  readIntegrationZip,
  writeIntegrationZip,
  verifyBundle,
  integrationHtml,
} from './integration-verify.mjs';
const domains = {
  image: 'runners',
  workspace: 'specs',
  spec: 'specs',
  environment: 'environments',
  fixture: 'fixtures',
  mock: 'mocks',
  scenario: 'scenarios',
  assertion: 'assertions',
  run: 'runners',
  load: 'load',
  report: 'reports',
  exchange: 'exchange',
  workbench: 'workbench',
};
export const integrationHelp = `sakura integration <domain> <action> --workspace <id> --file <input.json> [--json]
domain: workspace, spec, environment, fixture, mock, scenario, assertion, run, load, report, exchange, workbench
image import --workspace <id> --file prepared.qcow2 --distro debian --architecture x86_64
view 无需 --file；其他动作读取严格 JSON 对象，action 由子命令提供。
workspace create --file template.json 使用 workbench create；spec create-workspace 创建空工作空间。
run preview / apply / inspect / cancel / recover；load save / seal / preview / apply。
export --workspace <id> --file selection.json --out bundle.zip
import --file bundle.zip；exchange accept --file approval.json
verify --file bundle.zip [--out evidence.html] 完全离线，不加载插件。
直接运行：node scripts/integration-cli.mjs；认证使用 SAKURA_TOKEN。`;
export function integrationExitCode(value) {
  if (
    value?.cleanupConfirmed === false &&
    ['cleanup-pending', 'interrupted', 'effect-unknown'].includes(value.state)
  )
    return 4;
  if (
    value?.state === 'effect-unknown' ||
    value?.verdict === 'inconclusive' ||
    value?.evaluation?.results?.some((r) => r.outcome === 'unevaluated')
  )
    return 3;
  if (
    value?.verdict === 'failed' ||
    value?.error ||
    value?.evaluation?.results?.some((r) => r.outcome === 'violated')
  )
    return 1;
  return 0;
}
export async function integrationCli(argv, options = {}) {
  const args = [...argv],
    domain = args.shift();
  if (!domain || ['help', '--help'].includes(domain)) return { help: integrationHelp };
  let action = !args[0]?.startsWith('--') ? args.shift() : undefined;
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (
      !['--workspace', '--file', '--out', '--url', '--json', '--distro', '--architecture'].includes(k) ||
      flags.has(k)
    )
      throw Error('未知或重复选项 ' + k);
    if (k === '--json') flags.set(k, true);
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('缺少选项值 ' + k);
      flags.set(k, args[++i]);
    }
  }
  const file = flags.get('--file');
  if (domain === 'verify') {
    const bundle = readIntegrationZip(await readFile(file));
    if (flags.has('--out')) {
      const output = await open(flags.get('--out'), 'wx', 0o600);
      try {
        await output.writeFile(integrationHtml(bundle));
        await output.sync();
      } finally {
        await output.close();
      }
    }
    return verifyBundle(bundle);
  }
  const url = new URL(flags.get('--url') || 'http://127.0.0.1:7337');
  if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.protocol !== 'http:' ||
    url.username ||
    url.password
  )
    throw Error('只允许本机 Sakura 地址');
  // 在线分支才装入网络核心，离线核验在无源码、无开发依赖时同样可用。 Load managed transport only for online work.
  const networkCore = options.api ? undefined : await import('./network-client.mjs');
  const network = networkCore?.networkFor('tool:integration-cli');
  const api =
    options.api ||
    (async (path, method = 'GET', body) => {
      const token = options.token || process.env.SAKURA_TOKEN;
      if (!token) throw Error('缺少 SAKURA_TOKEN');
      const response = await network.fetch(url.origin + '/api' + path, {
        method,
        headers: { 'X-Sakura-Token': token, 'Content-Type': 'application/json', Origin: url.origin },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
      });
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body ?? []) {
        bytes += chunk.length;
        if (bytes > 256 * 1024 ** 2) throw Error('响应超过 256 MiB');
        chunks.push(Buffer.from(chunk));
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!response.ok)
        throw Object.assign(Error(value.error || '请求失败'), { code: value.code || 'HTTP_ERROR' });
      return value;
    });
  try {
    const scope = flags.has('--workspace')
      ? '?workspaceId=' + encodeURIComponent(flags.get('--workspace'))
      : '';
    let result;
    if (domain === 'image' && action === 'import') {
      if (!flags.has('--workspace')) throw Error('镜像导入需要 --workspace');
      const handle = await open(file, 'r');
      let upload;
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > 8 * 1024 ** 3) throw Error('镜像必须是最多 8 GiB 的普通文件');
        const hash = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) hash.update(chunk);
        upload = (
          await api('/integration-runners' + scope, 'POST', {
            action: 'image-begin',
            digest: hash.digest('hex'),
            bytes: before.size,
            distro: flags.get('--distro') || 'debian',
            architecture: flags.get('--architecture') || 'x86_64',
            source: 'local:' + basename(file),
          })
        ).result;
        const buffer = Buffer.alloc(512 * 1024);
        for (let offset = 0; offset < before.size;) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            Math.min(buffer.length, before.size - offset),
            offset,
          );
          if (!bytesRead) throw Error('镜像读取提前结束');
          await api('/integration-runners' + scope, 'POST', {
            action: 'image-append',
            id: upload.id,
            offset,
            data: buffer.subarray(0, bytesRead).toString('base64'),
          });
          offset += bytesRead;
        }
        const after = await handle.stat();
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
          throw Error('镜像读取期间发生变化');
        result = (
          await api('/integration-runners' + scope, 'POST', { action: 'image-finish', id: upload.id })
        ).result;
      } finally {
        await handle.close();
      }
    } else if (domain === 'import') {
      const bytes = await readFile(file);
      readIntegrationZip(bytes);
      const upload = (
        await api('/integration-exchange', 'POST', {
          action: 'upload-begin',
          name: basename(file),
          bytes: bytes.length,
          digest: createHash('sha256').update(bytes).digest('hex'),
          contentType: 'application/zip',
        })
      ).result;
      for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
        await api('/integration-exchange', 'POST', {
          action: 'upload-append',
          id: upload.id,
          offset,
          data: bytes.subarray(offset, offset + 512 * 1024).toString('base64'),
        });
      result = (await api('/integration-exchange', 'POST', { action: 'upload-complete', id: upload.id }))
        .result;
    } else if (domain === 'export') {
      const selection = JSON.parse(await readFile(file, 'utf8'));
      result = (await api('/integration-exchange' + scope, 'POST', { ...selection, action: 'export' }))
        .result;
      const out = flags.get('--out');
      if (!out) throw Error('缺少 --out');
      const handle = await open(out, 'wx', 0o600);
      try {
        await handle.writeFile(writeIntegrationZip(result));
        await handle.sync();
      } finally {
        await handle.close();
      }
      result = { file: out, digest: result.digest };
    } else {
      let section = domains[domain];
      if (!section) throw Error('未知领域');
      if (domain === 'workspace' && action === 'create') {
        section = 'workbench';
        action = 'create';
      }
      if (!action || action === 'view') result = (await api('/integration-' + section + scope)).result;
      else {
        const input = file ? JSON.parse(await readFile(file, 'utf8')) : {};
        if (Object.hasOwn(input, 'action') && input.action !== action) throw Error('文件动作与命令不一致');
        result = (await api('/integration-' + section + scope, 'POST', { ...input, action })).result;
      }
    }
    if (options.setExitCode !== false) process.exitCode = integrationExitCode(result);
    return result;
  } finally {
    if (network) {
      try {
        await network.close();
      } finally {
        await networkCore.networkRuntime.close();
      }
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await integrationCli(process.argv.slice(2)), null, 2));
  } catch (e) {
    console.error(JSON.stringify({ code: e.code || 'INPUT_ERROR', error: e.message }));
    process.exitCode = 2;
  }
}
