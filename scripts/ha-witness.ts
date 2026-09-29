import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startHaWitnessServer } from '../server/ha-witness-server.ts';
import { HaWitness } from '../server/ha-witness-core.ts';
import { haWitnessServerConfigSchema } from '../server/ha-witness-server.ts';

const initialize = process.argv[2] === '--initialize';
const configPath = process.argv[initialize ? 3 : 2];
if (!configPath)
  throw new Error('用法：npx tsx scripts/ha-witness.ts [--initialize] <config.json>');
const config = haWitnessServerConfigSchema.parse(
  JSON.parse(await readFile(resolve(configPath), 'utf8')));
if (initialize) {
  await HaWitness.initialize(config.stateFile, config.vms);
  console.log('HA 见证状态文件已初始化；请保护此文件并确保位于持久存储。');
  process.exit(0);
}
const service = await startHaWitnessServer(config);
console.log(`HA 见证服务已监听 ${config.listen.host}:${config.listen.port}`);
let closing = false;
const stop = () => {
  if (closing) return;
  closing = true;
  void service.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
