/** 固定媒体配方、派生文件及原任务回执的本机 CLI。 */
import { createSuiteCli } from './suite-cli.mjs';
const base = createSuiteCli({
  prefix: 'media',
  label: '媒体资源制作',
  sourceDomain: 'sources',
  maximumFile: 4 * 1024 ** 2,
  verify: async (file) => (await import('./media-verify.mjs')).verifyMediaFile(file),
});
export const mediaHelp =
  base.help +
  '\n先上传并审阅 PNG/JPEG/WebP/WAV/MP4，再批准隔离探测、编译固定配方和转换。\n转换输出核验后显式发布，集合须人工接受后导出。取消和核销只处理原会话；导入材料始终是来源声明。';
export async function mediaCli(args, { api } = {}) {
  if (!args.length || ['help', '--help'].includes(args[0])) return { help: mediaHelp };
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
