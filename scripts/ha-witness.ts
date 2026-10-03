import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HaWitness } from '../server/ha-witness-core.ts';
import { haWitnessServerConfigSchema, startHaWitnessServer,
  witnessVms } from '../server/ha-witness-server.ts';
import { checkHaWitnessDeployment } from '../server/ha-witness-preflight.ts';
import { observeHaFailoverDrill, prepareHaFailoverDrill } from '../server/ha-witness-drill.ts';
import { maintainHaWitnessState } from '../server/ha-witness-maintenance.ts';

const mode = process.argv[2];
const command = ['--initialize', '--preflight', '--drill-plan', '--observe',
  '--migrate', '--reconfigure', '--recover'].includes(mode) ? mode : null;
const configPath = process.argv[command ? 3 : 2];
if (!configPath)
  throw new Error('用法：npm run ha:witness -- [--initialize|--preflight|--drill-plan|--observe|--migrate|--reconfigure|--recover] <config.json>');
const config = haWitnessServerConfigSchema.parse(
  JSON.parse(await readFile(resolve(configPath), 'utf8')));
const flags = new Map<string, string>();
if (command === '--drill-plan' || command === '--observe' ||
    command === '--migrate' || command === '--reconfigure' || command === '--recover') {
  const tail = process.argv.slice(command === '--drill-plan' ? 5 : 4);
  const allowed = command === '--drill-plan' ? ['--output', '--witness-url']
    : command === '--observe' ? ['--plan', '--output', '--timeout-seconds', '--witness-url']
      : command === '--migrate' ? ['--backup', '--output']
        : command === '--recover' ? ['--from-state', '--backup', '--output']
        : ['--next-config', '--backup', '--output'];
  for (let index = 0; index < tail.length; index += 2) {
    const key = tail[index], value = tail[index + 1];
    if (!allowed.includes(key) || !value || value.startsWith('--') || flags.has(key))
      throw new Error('见证命令参数无效或重复');
    flags.set(key, value);
  }
}
if (command === '--initialize') {
  await HaWitness.initialize(config.stateFile, witnessVms(config));
  console.log('HA 见证状态文件已初始化；请保护此文件并确保位于持久存储。');
  process.exit(0);
}
if (command === '--preflight') {
  const report = await checkHaWitnessDeployment(config);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} else if (command === '--migrate' || command === '--reconfigure' || command === '--recover') {
  if (!flags.has('--backup') || !flags.has('--output') ||
      (command === '--reconfigure' && !flags.has('--next-config')) ||
      (command === '--recover' && !flags.has('--from-state')))
    throw new Error('用法：--migrate <config.json> --backup <new-backup.json> --output <new-receipt.json>；--reconfigure 另须 --next-config <new-config.json>；--recover 另须 --from-state <valid-state-backup.json>');
  const next = command === '--reconfigure'
    ? haWitnessServerConfigSchema.parse(JSON.parse(await readFile(resolve(flags.get('--next-config')!), 'utf8')))
    : config;
  const report = await maintainHaWitnessState(config, next, {
    mode: command === '--migrate' ? 'migrate' : command === '--recover' ? 'recover' : 'reconfigure',
    ...(command === '--recover' ? { recoveryStateFile: flags.get('--from-state')! } : {}),
    backupFile: flags.get('--backup')!, output: flags.get('--output')!,
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} else if (command === '--drill-plan') {
  const id = process.argv[4];
  if (!id) throw new Error('用法：--drill-plan <config.json> <sourceVmId> [--output <plan.json>]');
  const plan = await prepareHaFailoverDrill(config, id, flags.get('--witness-url'));
  if (flags.has('--output')) {
    const output = resolve(flags.get('--output')!);
    await writeFile(output, JSON.stringify(plan, null, 2) + '\n',
      { flag: 'wx', mode: 0o600, flush: true });
    console.log(JSON.stringify({ ready: true, planFile: output, drillId: plan.drillId }));
  } else console.log(JSON.stringify(plan, null, 2));
} else if (command === '--observe') {
  if (!flags.has('--plan') || !flags.has('--output'))
    throw new Error('用法：--observe <config.json> --plan <plan.json> --output <new-observations.jsonl> [--timeout-seconds 600]');
  const seconds = flags.get('--timeout-seconds') || '600';
  if (!/^\d+$/.test(seconds) || Number(seconds) < 60 || Number(seconds) > 86400)
    throw new Error('观察时限须为 60–86400 秒');
  const plan = JSON.parse(await readFile(resolve(flags.get('--plan')!), 'utf8'));
  const stop = new AbortController();
  const abort = () => stop.abort();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  let previous = '';
  try {
    const result = await observeHaFailoverDrill(config, plan, {
      output: flags.get('--output')!, witnessUrl: flags.get('--witness-url'),
      timeoutMs: Number(seconds) * 1000, signal: stop.signal,
      onSample: (sample) => {
        const label = `${sample.phase || 'unavailable'}:${sample.error || ''}`;
        if (label !== previous) {
          console.log(JSON.stringify({ at: sample.at, phase: sample.phase || null,
            stable: sample.stable, sourceStartAllowed: sample.sourceStartAllowed ?? null,
            error: sample.error || null }));
          previous = label;
        }
      },
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
} else {
  const service = await startHaWitnessServer(config);
  console.log(`HA 见证服务已监听 ${config.listen.host}:${config.listen.port}`);
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    void service.close().then(() => process.exit(0), (error) => {
      console.error('HA 见证服务关闭失败：', error);
      process.exitCode = 1;
    });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
