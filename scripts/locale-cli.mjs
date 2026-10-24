/** 本地化的固定命令；语言文件仅写入用户指定的新文件。 */
import { createHash } from 'node:crypto';
import { createSuiteCli, suiteInputFile, writeSuiteOutput } from './suite-cli.mjs';
const base = createSuiteCli({
  prefix: 'locale',
  label: '本地化交付',
  sourceDomain: 'catalogs',
  maximumFile: 32 * 1024 ** 2,
  verify: async (file) => (await import('./locale-verify.mjs')).verifyLocaleFile(file),
});
export const localeHelp = base.help + '\n  sakura locale language-file <版本引用.json> <语言> <新文件.json>';
export async function localeCli(args, { api } = {}) {
  if (!args.length || ['help', '--help'].includes(args[0])) return { help: localeHelp };
  if (args[0] !== 'language-file') return base.cli(args, { api });
  if (!api || args.length !== 4)
    throw new Error('用法：locale language-file <版本引用.json> <语言> <新文件.json>');
  const input = await suiteInputFile(args[1]),
    record = await api('/locale-releases/get', 'POST', input);
  if (
    record.origin !== 'local' ||
    record.state !== 'sealed' ||
    record.content?.format !== 'sakura-locale-release/1'
  )
    throw new Error('请选择本机封存语言版本');
  const file = record.content.files.find((file) => file.language === args[2]);
  if (!file) throw new Error('版本中没有此语言');
  const bytes = Buffer.from(file.text);
  if (
    bytes.length > 2 * 1024 ** 2 ||
    bytes.length !== file.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== file.digest
  )
    throw new Error('语言文件摘要不一致');
  return writeSuiteOutput(args[3], bytes);
}
