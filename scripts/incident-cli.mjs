/** 固定案例、证据、原动作回执和复盘交接的本机命令。 */
import { createSuiteCli } from './suite-cli.mjs';
const base = createSuiteCli({
  prefix: 'incident',
  label: '事件响应与复盘',
  sourceDomain: 'evidence',
  maximumFile: 32 * 1024 ** 2,
  verify: async (file) => (await import('./incident-verify.mjs')).verifyIncidentFile(file),
});
export const incidentHelp =
  base.help +
  '\n先使用 cases open 创建案例。upload 完成后自动固定证据；大文件按分块传输。\n时间线使用 timeline headers / events 按固定修订分页读取。默认交接仅选择封存报告与人审脱敏副本。\n未知回执的 acknowledge 只记录核对说明，不确认成功或重发动作。';
export async function incidentCli(args, { api } = {}) {
  if (!args.length || ['help', '--help'].includes(args[0])) return { help: incidentHelp };
  const result = await base.cli(args, { api });
  if (args[0] !== 'upload') return result;
  return api('/incident-evidence/attach', 'POST', {
    workspaceId: args[1],
    source: { domain: result.domain, id: result.id, revision: result.revision },
  });
}
