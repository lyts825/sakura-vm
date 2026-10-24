/** 供应审查的固定命令分派；离线核验无需启动服务。 */
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readSuiteFile, removeSuitePartial } from './suite-files.mjs';
const methods = Object.freeze({
  sources: [
    'list',
    'get',
    'archive',
    'references',
    'preview-cleanup',
    'cleanup',
    'create-workspace',
    'list-workspaces',
    'workspace',
    'revoke-workspace',
    'capacity',
    'policy',
    'upload',
    'pin',
    'begin-upload',
    'append-upload',
    'finish-upload',
    'discard-upload',
    'open-read',
    'read-lease',
    'close-read',
    'uploads',
    'read-source',
    'plan-policy',
    'apply-policy',
    'plan-capture',
    'capture',
  ],
  inventory: ['list', 'get', 'archive', 'references', 'preview-cleanup', 'cleanup', 'parse', 'compare'],
  advisories: [
    'list',
    'get',
    'archive',
    'references',
    'preview-cleanup',
    'cleanup',
    'import-dataset',
    'match',
    'freshness',
  ],
  licenses: [
    'list',
    'get',
    'archive',
    'references',
    'preview-cleanup',
    'cleanup',
    'classify',
    'review-expression',
  ],
  provenance: [
    'list',
    'get',
    'archive',
    'references',
    'preview-cleanup',
    'cleanup',
    'save',
    'seal',
    'inspect',
    'verify',
  ],
  policies: [
    'list',
    'get',
    'archive',
    'references',
    'preview-cleanup',
    'cleanup',
    'save',
    'seal',
    'evaluate',
    'explain',
  ],
  reviews: [
    'list',
    'get',
    'archive',
    'references',
    'preview-cleanup',
    'cleanup',
    'open',
    'decide',
    'recheck',
  ],
  reports: ['list', 'get', 'archive', 'references', 'preview-cleanup', 'cleanup', 'seal', 'compare'],
  exchange: [
    'list',
    'get',
    'archive',
    'references',
    'preview-cleanup',
    'cleanup',
    'preview-export',
    'export',
    'download',
    'begin-import',
    'append-import',
    'transfers',
    'discard-import',
    'inspect-import',
    'accept-import',
    'imports',
  ],
  workbench: [
    'list',
    'get',
    'archive',
    'references',
    'preview-cleanup',
    'cleanup',
    'templates',
    'create-example',
    'run-checks',
    'view',
  ],
});
for (const allowed of Object.values(methods)) allowed.push('inspect-plan', 'preview-recovery');
export const supplyHelp = `软件供应审查（10 个领域）
  sakura supply <领域> <动作> [参数.json]
  sakura supply upload <workspaceId> <文件> [--export]
  sakura supply download <参数.json> <输出.zip>
  sakura supply verify <交接.zip>  （离线，纯 Node）
领域与固定动作：
${Object.entries(methods)
  .map(([d, m]) => `  ${d}: ${m.join(', ')}`)
  .join('\n')}
参数必须为 JSON 对象，作用域使用 workspaceId；固定引用为 {domain,id,revision}。
异步/计划提交成功只代表本次请求接收，业务结论以固定结果为准。导出和接受导入必须先预览。
退出码：0 操作完成，1 已知业务失败，2 输入或传输失败，3 不确定或不支持，4 清理待确认。`;
const inputFile = async (path) => {
  if (!path) return {};
  const value = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await readSuiteFile(path, 1024 ** 2)),
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参数必须为 JSON 对象');
  return value;
};
export async function supplyCli(args, { api } = {}) {
  const [domain = 'help', action, ...rest] = args;
  if (['help', '--help'].includes(domain)) return { help: supplyHelp };
  if (domain === 'verify') {
    if (!action || rest.length) throw new Error('用法：supply verify <交接.zip>');
    return (await import('./supply-verify.mjs')).verifySupplyFile(action);
  }
  if (!api) throw new Error('此命令需要已认证的本机服务');
  if (domain === 'upload') {
    if (!action || !rest[0] || rest.length > 2 || (rest[1] && rest[1] !== '--export'))
      throw new Error('用法：supply upload <workspaceId> <文件> [--export]');
    const path = rest[0],
      info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 ** 2)
      throw new Error('材料须为最多 64 MiB 的普通文件');
    const handle = await open(path, 'r');
    try {
      const bound = await handle.stat();
      if (
        !bound.isFile() ||
        bound.nlink !== 1 ||
        bound.ino !== info.ino ||
        bound.dev !== info.dev ||
        bound.size !== info.size
      )
        throw new Error('材料文件身份已变化');
      const hash = createHash('sha256'),
        buffer = Buffer.alloc(512 * 1024);
      let offset = 0;
      while (offset < info.size) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, info.size - offset),
          offset,
        );
        if (!bytesRead) throw new Error('材料读取中断');
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
      const upload = await api('/supply-sources/begin-upload', 'POST', {
        workspaceId: action,
        name: path.replaceAll('\\', '/').split('/').at(-1),
        format: path.endsWith('.json') ? 'json' : 'text',
        bytes: info.size,
        digest: hash.digest('hex'),
        allowExport: rest[1] === '--export',
      });
      for (offset = 0; offset < info.size;) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, info.size - offset),
          offset,
        );
        if (!bytesRead) throw new Error('材料读取中断；请用 uploads 查询原上传');
        await api('/supply-sources/append-upload', 'POST', {
          workspaceId: action,
          id: upload.id,
          offset,
          data: buffer.subarray(0, bytesRead).toString('base64'),
        });
        offset += bytesRead;
      }
      return await api('/supply-sources/finish-upload', 'POST', { workspaceId: action, id: upload.id });
    } finally {
      await handle.close();
    }
  }
  if (domain === 'download') {
    if (!action || rest.length !== 1) throw new Error('用法：supply download <参数.json> <新输出.zip>');
    const input = await inputFile(action),
      file = rest[0],
      handle = await open(file, 'wx', 0o600);
    const identity = await handle.stat();
    let complete = false;
    try {
      let offset = 0;
      const hash = createHash('sha256');
      for (;;) {
        const part = await api('/supply-exchange/download', 'POST', { ...input, offset, length: 512 * 1024 }),
          bytes = Buffer.from(part.data, 'base64');
        if (
          bytes.toString('base64') !== part.data ||
          part.offset !== offset + bytes.length ||
          (!part.eof && !bytes.length) ||
          part.offset > 16 * 1024 ** 2
        )
          throw new Error('下载回执不一致');
        let written = 0;
        while (written < bytes.length) {
          const { bytesWritten } = await handle.write(bytes, written, bytes.length - written);
          if (!bytesWritten) throw new Error('输出文件写入中断');
          written += bytesWritten;
        }
        hash.update(bytes);
        offset = part.offset;
        if (part.eof) break;
      }
      const record = await api('/supply-exchange/get', 'POST', input);
      if (hash.digest('hex') !== record.content.digest) throw new Error('下载摘要不一致');
      await handle.sync();
      complete = true;
      return { file, bytes: offset, byteIntegrity: 'verified' };
    } finally {
      await handle.close();
      if (!complete) await removeSuitePartial(file, identity);
    }
  }
  if (!Object.hasOwn(methods, domain) || !methods[domain].includes(action) || rest.length > 1)
    throw new Error('未知的供应审查命令；运行 supply help');
  const value = await api(`/supply-${domain}/${action}`, 'POST', await inputFile(rest[0]));
  const outcome = value?.content?.result ?? value?.evaluation?.content?.result;
  if (
    outcome === 'failed' ||
    (domain === 'provenance' && action === 'verify' && value?.content?.signatureValid === false) ||
    (domain === 'reviews' && action === 'recheck' && value?.valid === false)
  )
    process.exitCode = 1;
  else if (outcome === 'inconclusive') process.exitCode = 3;
  else if (value?.content?.cleanup === 'unknown') process.exitCode = 4;
  return value;
}
