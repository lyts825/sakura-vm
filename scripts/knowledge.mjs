/** 纯 Node 知识 CLI：明确空间、上传、计划和离线复核。 Pure Node CLI with explicit scopes and no VM requirement. */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
const argv = process.argv.slice(2),
  domain = argv.shift(),
  command = argv[0] && !argv[0].startsWith('--') ? argv.shift() : undefined,
  flags = new Map();
for (let i = 0; i < argv.length; i++) {
  const name = argv[i];
  if (!name.startsWith('--') || flags.has(name) || !argv[i + 1] || argv[i + 1].startsWith('--'))
    throw new Error('选项重复或缺少值：' + name);
  flags.set(name, argv[++i]);
}
const opt = (key, fallback) => flags.get('--' + key) ?? fallback,
  required = (key) => {
    const v = opt(key);
    if (!v) throw new Error('缺少 --' + key);
    return v;
  };
const allowed = new Set([
  '--space',
  '--file',
  '--out',
  '--input',
  '--url',
  '--token',
  '--name',
  '--format',
  '--allow-export',
  '--template',
  '--query',
  '--id',
  '--revision',
  '--plan',
]);
for (const key of flags.keys()) if (!allowed.has(key)) throw new Error('未知选项 ' + key);
let network, networkRuntime;
const abort = new AbortController();
process.on('SIGINT', () => abort.abort());
async function main() {
  if (!domain || domain === 'help' || domain === '--help') {
    console.log(`Sakura Knowledge Studio
node scripts/knowledge.mjs space create --name 名称
node scripts/knowledge.mjs space list
node scripts/knowledge.mjs source upload --space UUID --file README.md [--allow-export true]
node scripts/knowledge.mjs example --name 虚构项目 --template handover
node scripts/knowledge.mjs search --space UUID --query 备份恢复
node scripts/knowledge.mjs <领域> <方法> --input request.json [--space UUID]
node scripts/knowledge.mjs extract run --space UUID --plan TOKEN
node scripts/knowledge.mjs exchange download --space UUID --id UUID --out handover.knowledge
node scripts/knowledge.mjs import inspect --file handover.knowledge
node scripts/knowledge.mjs import accept --input acceptance.json
node scripts/knowledge.mjs verify --file handover.knowledge
领域：sources、extract、index、evidence、entries、documents、reviews、publish、exchange、workbench。
方法与严格输入见 docs/knowledge-studio.md。create/revise/readPinned/compare/archive 等逐方法调用真实领域服务。
认证：SAKURA_TOKEN 或 --token；地址默认 http://127.0.0.1:7337。
verify 为纯离线复核，不需要 token、VM 或构建。`);
    return;
  }
  if (domain === 'verify') {
    const info = await stat(required('file'));
    if (info.size > 24 * 1024 ** 2) throw new Error('包超过 24 MiB');
    const { verifyBundle } = await import('./knowledge-verify.mjs');
    console.log(JSON.stringify(verifyBundle(JSON.parse(await readFile(required('file'), 'utf8'))), null, 2));
    return;
  }
  const origin = new URL(opt('url', 'http://127.0.0.1:7337'));
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
    throw new Error('地址无效');
  if (origin.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))
    throw new Error('远端地址需要 HTTPS');
  const token = opt('token', process.env.SAKURA_TOKEN);
  if (!token) throw new Error('缺少 SAKURA_TOKEN');
  const core = await import('../.sakura-server/network-entry.js').catch(() => {
    throw new Error('在线命令需要已构建的受管网络入口；请先运行构建。离线 verify 无需构建。');
  });
  networkRuntime = core.networkRuntime;
  network = core.networkFor('tool:knowledge-cli');
  const call = async (section, method, body) => {
    const response = await network.fetch(new URL(`/api/knowledge-${section}/${method}`, origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sakura-token': token },
      body: JSON.stringify(body),
      signal: abort.signal,
      redirect: 'error',
    });
    const chunks = [];
    let size = 0;
    for await (const part of response.body ?? []) {
      size += part.length;
      if (size > 32 * 1024 ** 2) throw new Error('响应超过 32 MiB');
      chunks.push(Buffer.from(part));
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
    return payload;
  };
  let section = domain,
    method = command,
    input = opt('input') ? JSON.parse(await readFile(opt('input'), 'utf8')) : {};
  if (opt('space')) input.spaceId = opt('space');
  if (opt('id')) input.id = opt('id');
  if (opt('revision')) input.revision = Number(opt('revision'));
  if (opt('plan')) input.token = opt('plan');
  if (domain === 'space') {
    section = 'sources';
    method = { create: 'createSpace', list: 'listSpaces', show: 'space', revoke: 'revokeSpace' }[command];
    if (command === 'create') input = { name: required('name') };
  }
  if (domain === 'example') {
    section = 'workbench';
    method = 'example';
    input = { name: required('name'), template: opt('template', 'handover') };
  }
  if (domain === 'search') {
    section = 'index';
    method = 'search';
    input = { spaceId: required('space'), query: required('query'), limit: 50 };
  }
  if (domain === 'source') {
    section = 'sources';
    if (command === 'upload') {
      const file = required('file'),
        info = await stat(file);
      if (!info.isFile() || info.size > 8 * 1024 ** 2) throw new Error('上传必须是最多 8 MiB 的普通文本文件');
      const ext = file.split('.').at(-1)?.toLowerCase();
      if (['pdf', 'docx', 'xlsx', 'zip', 'exe', 'dll', 'png', 'svg'].includes(ext))
        throw new Error('不支持此材料格式');
      const format = opt(
        'format',
        { md: 'markdown', json: 'json', csv: 'csv', html: 'html', htm: 'html' }[ext] || 'text',
      );
      input = {
        spaceId: required('space'),
        name: basename(file),
        format,
        data: (await readFile(file)).toString('base64'),
        policy: {
          read: true,
          index: true,
          cite: true,
          publish: true,
          export: opt('allow-export', 'false') === 'true',
        },
      };
    }
  }
  if (domain === 'entry') section = 'entries';
  if (domain === 'document') section = 'documents';
  if (domain === 'review') section = 'reviews';
  if (domain === 'citation') section = 'evidence';
  if (domain === 'import') {
    section = 'exchange';
    method = command === 'inspect' ? 'inspectImport' : 'acceptImport';
    if (command === 'inspect') {
      const info = await stat(required('file'));
      if (info.size > 24 * 1024 ** 2) throw new Error('包超过 24 MiB');
      input = { bundle: JSON.parse(await readFile(required('file'), 'utf8')) };
    }
  }
  const methods = {
    sources: [
      'createSpace',
      'listSpaces',
      'space',
      'revokeSpace',
      'listSources',
      'getSource',
      'upload',
      'redact',
      'planCapture',
      'capture',
      'read',
      'verify',
      'planPolicy',
      'applyPolicy',
      'capacity',
      'planCleanup',
      'cleanup',
    ],
    extract: ['plan', 'run', 'get', 'list', 'jobs', 'cancel'],
    index: ['plan', 'build', 'search', 'coverage', 'jobs', 'cancel'],
    evidence: ['create', 'inspect', 'check', 'migrate', 'list'],
    entries: ['create', 'revise', 'readPinned', 'list', 'compare', 'archive'],
    documents: ['templates', 'create', 'revise', 'readPinned', 'list', 'compare', 'archive'],
    reviews: ['open', 'readPinned', 'decide', 'recheck', 'list'],
    publish: ['plan', 'apply', 'read', 'withdraw', 'rollback', 'list'],
    exchange: [
      'planExport',
      'export',
      'download',
      'inspectImport',
      'acceptImport',
      'imports',
      'discardImport',
    ],
    workbench: ['view', 'preferences', 'example'],
  };
  if (!methods[section]?.includes(method)) throw new Error('未知领域或方法，运行 help 查看入口');
  const result = await call(section, method, input);
  if (opt('out'))
    await writeFile(required('out'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  else console.log(JSON.stringify(result, null, 2));
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await network?.close();
    } finally {
      await networkRuntime?.close();
    }
  });
