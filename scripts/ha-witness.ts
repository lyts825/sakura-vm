import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HaWitness } from '../server/ha-witness-core.ts';
import { haWitnessServerConfigSchema, startHaWitnessServer,
  witnessVms } from '../server/ha-witness-server.ts';
import { checkHaWitnessDeployment } from '../server/ha-witness-preflight.ts';

const initialize = process.argv[2] === '--initialize';
const preflight = process.argv[2] === '--preflight';
const configPath = process.argv[initialize || preflight ? 3 : 2];
if (!configPath)
  throw new Error('用法：npx tsx scripts/ha-witness.ts [--initialize|--preflight] <config.json>');
const config = haWitnessServerConfigSchema.parse(
  JSON.parse(await readFile(resolve(configPath), 'utf8')));
if (initialize) {
  await HaWitness.initialize(config.stateFile, witnessVms(config));
  console.log('HA 见证状态文件已初始化；请保护此文件并确保位于持久存储。');
  process.exit(0);
}
if (preflight) {
  const report = await checkHaWitnessDeployment(config);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
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
