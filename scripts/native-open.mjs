import { spawn } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseNativeArguments(args) {
  let port = 7337,
    extension,
    path,
    print = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--port' && /^\d{1,5}$/.test(args[index + 1] || '')) port = Number(args[++index]);
    else if (arg === '--extension' && /^\.[a-z0-9][a-z0-9_-]{0,23}$/.test(args[index + 1] || ''))
      extension = args[++index];
    else if (arg === '--print-url') print = true;
    else if (arg === '--shell-path' && args[index + 1]?.endsWith('|') && path === undefined)
      path = args[++index].slice(0, -1);
    else if (arg === '--' && index === args.length - 2 && path === undefined) path = args[++index];
    else
      throw new Error('Usage: native-open --port 7337 [--extension .txt] [--print-url] -- <absolute path>');
  }
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    !path ||
    !isAbsolute(path) ||
    path.length > 4096 ||
    /[\x00-\x1f]/.test(path)
  )
    throw new Error('无效的本机路径或端口');
  return { port, extension, path, print };
}

export async function requestNativeOpen(options, transport = fetch) {
  const origin = `http://127.0.0.1:${options.port}`;
  const send = async (path, init = {}) => {
    const response = await transport(origin + path, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    if (text.length > 65536) throw new Error('控制服务返回内容过大');
    const body = JSON.parse(text);
    if (!response.ok) throw new Error(body.error || '打开工作区失败');
    return body;
  };
  const { token } = await send('/api/bootstrap');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('无效的控制凭证');
  const { ticket } = await send('/api/native-integration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sakura-Token': token },
    body: JSON.stringify({
      action: 'receive',
      path: options.path,
      ...(options.extension ? { extension: options.extension } : {}),
    }),
  });
  if (typeof ticket !== 'string' || !/^[a-f0-9-]{36}$/.test(ticket)) throw new Error('无效的打开请求');
  // Ignore any server-supplied URL. The browser destination is always local.
  return `${origin}/#native=${ticket}`;
}
async function browser(url) {
  if (process.platform !== 'win32') throw new Error('此打开助手仅支持 Windows');
  await new Promise((resolve, reject) => {
    const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [url], {
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
export async function main(args) {
  const options = parseNativeArguments(args);
  try {
    const url = await requestNativeOpen(options);
    if (options.print) console.log(url);
    else await browser(url);
  } catch (error) {
    if (!options.print)
      await browser(
        `http://127.0.0.1:${options.port}/#native-error=${encodeURIComponent(String(error.message).slice(0, 500))}`,
      ).catch(() => {});
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Sakura: ${error.message}`);
    process.exitCode = 1;
  });
