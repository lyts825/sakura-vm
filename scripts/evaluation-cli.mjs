/** 固定领域命令；所有批准均提交原计划摘要。 */
import { createSuiteCli } from './suite-cli.mjs';
const base = createSuiteCli({
  prefix: 'evaluation',
  label: '模型评测',
  sourceDomain: 'datasets',
  maximumFile: 32 * 1024 ** 2,
  verify: async (file) => (await import('./evaluation-verify.mjs')).verifyEvaluationFile(file),
});
export const evaluationHelp =
  base.help +
  '\n上传后调用 datasets pin 固定人工审阅样例。导入输出仅为来源声明；真实生成与模型判分分别批准。';
export const evaluationCli = base.cli;
