/** 固定领域命令共用的有界文件传输；入口配置及动作表均来自正式代码。 */
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readSuiteFile, removeSuitePartial } from './suite-files.mjs';
import { suiteCommands } from './suite-commands.generated.mjs';
export async function suiteInputFile(path) {
  if (!path) return {};
  const value = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await readSuiteFile(path, 1024 ** 2)),
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参数必须为 JSON 对象');
  return value;
}
export async function writeSuiteOutput(file, bytes) {
  const handle = await open(file, 'wx', 0o600),
    identity = await handle.stat();
  let complete = false;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    complete = true;
    return { file, bytes: bytes.length, byteIntegrity: 'verified' };
  } finally {
    await handle.close();
    if (!complete) await removeSuitePartial(file, identity);
  }
}
export function createSuiteCli({ prefix, label, sourceDomain, maximumFile, verify }) {
  if (!Object.hasOwn(suiteCommands, prefix) || !Object.hasOwn(suiteCommands[prefix], sourceDomain))
    throw new Error('领域 CLI 配置不存在');
  const methods = suiteCommands[prefix];
  const help = `${label}（${Object.keys(methods).length} 个领域）
  sakura ${prefix} <领域> <动作> [参数.json]
  sakura ${prefix} upload <workspaceId> <文件> [--export]
  sakura ${prefix} download <参数.json> <新输出.zip>
  sakura ${prefix} verify <交接.zip>  （离线，纯 Node）
领域与固定动作：
${Object.entries(methods)
  .map(([domain, actions]) => `  ${domain}: ${actions.join(', ')}`)
  .join('\n')}
参数必须为 JSON 对象；作用域为 workspaceId，固定引用为 {domain,id,revision}。
导出和接受导入须先预览。请求成功与检查通过分别记录。
退出码：0 操作完成，1 已知业务失败，2 输入或传输失败，3 不确定或不支持，4 清理未确认。`;
  const cli = async (args, { api } = {}) => {
    const [domain = 'help', action, ...rest] = args;
    if (['help', '--help'].includes(domain)) return { help };
    if (domain === 'verify') {
      if (!action || rest.length) throw new Error(`用法：${prefix} verify <交接.zip>`);
      return verify(action);
    }
    if (!api) throw new Error('此命令需要已认证的本机服务');
    if (domain === 'upload') {
      if (!action || !rest[0] || rest.length > 2 || (rest[1] && rest[1] !== '--export'))
        throw new Error(`用法：${prefix} upload <workspaceId> <文件> [--export]`);
      const path = rest[0],
        info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maximumFile)
        throw new Error(`材料须为最多 ${maximumFile / 1024 ** 2} MiB 的普通文件`);
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
        const extension = path.split('.').at(-1)?.toLowerCase(),
          format =
            prefix === 'locale' && ['png', 'jpg', 'jpeg'].includes(extension)
              ? extension === 'png'
                ? 'png'
                : 'jpeg'
              : extension === 'json'
                ? 'json'
                : 'text';
        const upload = await api(`/${prefix}-${sourceDomain}/begin-upload`, 'POST', {
          workspaceId: action,
          name: path.replaceAll('\\', '/').split('/').at(-1),
          format,
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
          if (!bytesRead) throw new Error('材料读取中断，请查询原上传');
          await api(`/${prefix}-${sourceDomain}/append-upload`, 'POST', {
            workspaceId: action,
            id: upload.id,
            offset,
            data: buffer.subarray(0, bytesRead).toString('base64'),
          });
          offset += bytesRead;
        }
        return await api(`/${prefix}-${sourceDomain}/finish-upload`, 'POST', {
          workspaceId: action,
          id: upload.id,
        });
      } finally {
        await handle.close();
      }
    }
    if (domain === 'download') {
      if (!action || rest.length !== 1) throw new Error(`用法：${prefix} download <参数.json> <新输出.zip>`);
      const input = await suiteInputFile(action),
        file = rest[0],
        handle = await open(file, 'wx', 0o600),
        identity = await handle.stat();
      let complete = false;
      try {
        let offset = 0;
        const hash = createHash('sha256');
        for (;;) {
          const part = await api(`/${prefix}-exchange/download`, 'POST', {
              ...input,
              offset,
              length: 512 * 1024,
            }),
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
        const record = await api(`/${prefix}-exchange/get`, 'POST', input);
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
      throw new Error(`未知的${label}命令；运行 ${prefix} help`);
    const value = await api(`/${prefix}-${domain}/${action}`, 'POST', await suiteInputFile(rest[0]));
    const outcome =
      value?.content?.result ?? value?.evaluation?.content?.result ?? value?.check?.content?.result;
    if (
      outcome === 'failed' ||
      (prefix === 'supply' &&
        domain === 'provenance' &&
        action === 'verify' &&
        value?.content?.signatureValid === false) ||
      (domain === 'reviews' && action === 'recheck' && value?.valid === false)
    )
      process.exitCode = 1;
    else if (outcome === 'inconclusive' || outcome === 'not-supported') process.exitCode = 3;
    else if (value?.content?.cleanup === 'unknown') process.exitCode = 4;
    return value;
  };
  return { cli, help };
}
