/** 纯 Node 逐操作 CLI；离线 verify 不调用 API 或加载服务。
 * Pure Node per-operation CLI; offline verify never calls an API or loads a server. */
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyResilienceBundle } from './resilience-verify.mjs';
export const resilienceHelp = `resilience status [--workspace local]
resilience image-import --file image.qcow2 --distro alpine --architecture x86_64 [--workspace local]
resilience <targets|fixtures|guard|faults|probes|recovery|scenarios|runs|reports> <operation> --file request.json
resilience verify --file bundle.json --offline
resilience export --id report-id --output bundle.json [--workspace local]
resilience watch --id run-id [--workspace local]
resilience cancel|reconcile --id run-id [--workspace local]
resilience import --file bundle.json [--workspace local]
resilience accept --id import-id [--workspace local]
Read operations: targets view/get; fixtures view/sources; guard view; faults catalogue; probes view; scenarios view/templates; runs view/get; reports view/imports/retention.
Writes: targets register; fixtures prepareBuiltin/beginImport/appendImport/finishImport/prepare/cleanupPreview/cleanup; guard contain/reconcile; recovery preview/apply; scenarios save; runs preview/approve/start/cancel/reconcile; reports seal/export/import/accept/discardImport/compare/pin/archive.
Write request files contain the exact operation schema, including scope. Approvals and run start are separate commands.`;
const operations = {
  targets: ['view', 'register', 'get'],
  fixtures: [
    'view',
    'sources',
    'prepareBuiltin',
    'beginImport',
    'appendImport',
    'finishImport',
    'prepare',
    'cleanupPreview',
    'cleanup',
  ],
  guard: ['view', 'contain', 'reconcile'],
  faults: ['catalogue', 'observe'],
  probes: ['view'],
  recovery: ['preview', 'apply'],
  scenarios: ['view', 'templates', 'save'],
  runs: ['view', 'get', 'preview', 'approve', 'start', 'cancel', 'reconcile'],
  reports: [
    'view',
    'imports',
    'discardImport',
    'retention',
    'pin',
    'archive',
    'seal',
    'export',
    'import',
    'accept',
    'compare',
  ],
  workbench: ['view'],
};
const reads = new Set(['view', 'get', 'sources', 'templates', 'catalogue', 'retention', 'imports']);
async function json(file) {
  if (!file) throw new Error('需要 --file');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 200 * 1024 * 1024)
    throw new Error('文件不是普通文件或超过 200 MiB');
  return JSON.parse(await readFile(file, 'utf8'));
}
export async function resilienceCommand(action, name, args, api) {
  if (action !== 'resilience') return { handled: false };
  const argv = [name, ...args].filter((v) => v !== undefined),
    command = argv.shift() || 'status',
    flags = {};
  for (let i = 0; i < argv.length; i++)
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      flags[key] = key === 'offline' ? true : argv[++i];
    }
  const scope = { workspaceId: flags.workspace || 'local' };
  if (command === 'help') return { handled: true, value: resilienceHelp };
  if (command === 'image-import') {
    const file = flags.file,
      info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 ** 3)
      throw new Error('镜像不是普通文件或超过 32 GiB');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const digest = hash.digest('hex');
    const upload = await api('/resilience-fixtures/beginImport', 'POST', {
      scope,
      input: {
        digest,
        bytes: info.size,
        distro: flags.distro || 'alpine',
        architecture: flags.architecture || 'x86_64',
        source: basename(file),
      },
    });
    let offset = 0;
    for await (const data of createReadStream(file, { highWaterMark: 512 * 1024 })) {
      const next = await api('/resilience-fixtures/appendImport', 'POST', {
        scope,
        id: upload.id,
        offset,
        data: data.toString('base64'),
      });
      offset = next.offset;
    }
    return {
      handled: true,
      value: await api('/resilience-fixtures/finishImport', 'POST', { scope, id: upload.id }),
    };
  }
  if (command === 'verify') {
    if (flags.offline !== true) throw new Error('verify 必须显式使用 --offline');
    const result = verifyResilienceBundle(await json(flags.file));
    const { report, ...summary } = result;
    return { handled: true, value: summary };
  }
  let domain, operation, input;
  if (command === 'status') {
    domain = 'workbench';
    operation = 'view';
    input = { scope };
  } else if (command === 'watch') {
    domain = 'runs';
    operation = 'get';
    input = { scope, id: flags.id };
  } else if (['cancel', 'reconcile'].includes(command)) {
    domain = 'runs';
    operation = command;
    input = { scope, id: flags.id };
  } else if (['export', 'accept'].includes(command)) {
    domain = 'reports';
    operation = command;
    input = { scope, id: flags.id };
  } else if (command === 'import') {
    domain = 'reports';
    operation = 'import';
    input = { scope, bundle: await json(flags.file) };
  } else {
    domain = command;
    operation = argv[0];
    if (!operations[domain]?.includes(operation)) throw new Error(resilienceHelp);
    input = flags.file ? await json(flags.file) : { scope };
  }
  let value;
  if (reads.has(operation)) {
    const query = new URLSearchParams({ workspaceId: input.scope.workspaceId });
    for (const key of ['id', 'runId']) if (input[key]) query.set(key, input[key]);
    if (input.ref) {
      query.set('id', input.ref.id);
      query.set('revision', input.ref.revision);
    }
    value = await api('/resilience-' + domain + '/' + operation + '?' + query);
  } else value = await api('/resilience-' + domain + '/' + operation, 'POST', input);
  if (command === 'export') {
    if (!flags.output) throw new Error('导出需要 --output');
    verifyResilienceBundle(value);
    await writeFile(flags.output, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    value = { file: flags.output, integrity: 'valid', sourceTrust: 'unauthenticated' };
  }
  return { handled: true, value };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  const result = await resilienceCommand('resilience', command, args, () => {
    throw new Error('在线命令请通过 Sakura 受管 CLI 调用');
  });
  console.log(JSON.stringify(result.value, null, 2));
}
