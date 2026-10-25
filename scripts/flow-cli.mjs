import { createSuiteCli } from './suite-cli.mjs';
const base = createSuiteCli({
  prefix: 'flow',
  label: '流程工作台',
  sourceDomain: 'inputs',
  maximumFile: 1024 ** 2,
  verify: async (file) => (await import('./flow-verify.mjs')).verifyFlowFile(file),
});
export const flowHelp =
  base.help +
  '\n每个阶段先 preview-step，再 approvals approve，最后 runs advance；未知结果只能 reconcile，不能重发。';
export const flowCli = async (args, context) => {
  const value = await base.cli(args, context),
    content = value?.content;
  if (content?.format === 'sakura-flow-plan/1' && content.kind === 'graph' && !content.valid)
    process.exitCode = 1;
  if (content?.format === 'sakura-flow-run/1') {
    if (
      content.cancelled &&
      content.nodes.some(
        (node) =>
          ['running', 'unknown'].includes(node.status) && node.receipt?.result?.cleanupConfirmed === false,
      )
    )
      process.exitCode = 4;
    else if (content.nodes.some((node) => node.status === 'unknown')) process.exitCode = 3;
    else if (content.status === 'completed' && content.nodes.some((node) => node.status === 'failed'))
      process.exitCode = 1;
  }
  if (content?.format === 'sakura-flow-timer/1' && content.state === 'unknown') process.exitCode = 3;
  return value;
};
