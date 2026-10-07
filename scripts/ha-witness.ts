/** HA 见证命令入口，加载配置并路由初始化、预检、观察、演练计划、迁移及恢复操作。
 * Load HA witness configuration and dispatch initialization, preflight, observation, reviewed drills, migration and recovery. */
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
  /** 向见证轮询的取消信号发出中断，当前循环随后退出并执行其既有清理。
   * Abort the witness polling signal so the active loop exits through its existing cleanup. */
  const abort = () => stop.abort();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  let previous = '';
  try {
    const result = await observeHaFailoverDrill(config, plan, {
      output: flags.get('--output')!, witnessUrl: flags.get('--witness-url'),
      timeoutMs: Number(seconds) * 1000, signal: stop.signal,
      /** 只在阶段或错误标签变化时输出结构化观测，保留稳定性与源端启动许可，避免稳定轮询产生重复日志。
       * Log structured observations only when phase/error changes, retaining stability and source-start permission without repeating steady polling logs. */
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
  /** 以 closing 防止重复关闭见证服务；成功退出进程，关闭失败保留错误日志并设置失败退出码。
   * Guard witness shutdown with closing; exit after success, or log close failure and set a failing exit code. */
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
