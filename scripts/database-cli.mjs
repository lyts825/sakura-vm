/** 数据库固定声明和原执行会话的本机 CLI。 */
import { createSuiteCli } from './suite-cli.mjs';
const base = createSuiteCli({
  prefix: 'database',
  label: '数据库演进演练',
  sourceDomain: 'sources',
  maximumFile: 8 * 1024 ** 2,
  verify: async (file) => (await import('./database-verify.mjs')).verifyDatabaseFile(file),
});
export const databaseHelp =
  base.help +
  '\n先生成或明确审阅固定 JSON/CSV，再验证结构、编译声明并批准独立副本。\n取消和核销只处理原会话；restore 必须批准新的计划并使用新副本。导入报告始终是来源声明。';
export async function databaseCli(args, { api } = {}) {
  if (!args.length || ['help', '--help'].includes(args[0])) return { help: databaseHelp };
  const value = await base.cli(args, { api }),
    content = value?.content,
    outcome = content?.outcome ?? content?.assessment?.outcome ?? content?.result?.outcome,
    cleanup = content?.cleanup ?? content?.assessment?.cleanup ?? content?.session?.cleanup;
  if (cleanup === 'unknown' || cleanup === 'pending') process.exitCode = 4;
  else if (outcome === 'failed') process.exitCode = 1;
  else if (
    outcome === 'inconclusive' ||
    content?.session?.state === 'running' ||
    content?.session?.state === 'preparing'
  )
    process.exitCode = 3;
  return value;
}
