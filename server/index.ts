import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { totalmem, freemem, cpus, hostname } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { z, ZodError } from 'zod';
import { ROOT, PORT, IMAGE, AppError, guestPath } from './model.ts';
import { createRuntime } from './runtime.ts';
import { Machines } from './machines.ts';
import { sameOrigin, tokenMatches } from './security.ts';

const token = randomBytes(32).toString('hex');
const dev = process.argv.includes('--dev');
const engine = await createRuntime();
const machines = new Machines(engine);
await machines.init();
const ws = new WebSocketServer({ noServer: true, maxPayload: 65536 });
let vite: Awaited<ReturnType<typeof import('vite').createServer>> | undefined;
const equalToken = (value: unknown) => tokenMatches(value, token);
const allowedRequest = (req: IncomingMessage) => sameOrigin(req.headers, PORT);
function send(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new AppError('需要 application/json 请求', 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const data of req) {
    size += data.length;
    if (size > 1500000) throw new AppError('请求内容过大', 413);
    chunks.push(data);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new AppError('JSON 格式错误');
  }
}
const api = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
  if (req.method === 'GET' && url.pathname === '/api/bootstrap') return send(res, { token });
  if (!equalToken(req.headers['x-sakura-token'])) throw new AppError('访问凭证已过期，请刷新页面', 401);
  const route = url.pathname.split('/').filter(Boolean);
  if (req.method === 'GET' && url.pathname === '/api/system')
    return send(res, {
      name: 'Sakura',
      version: '0.1.0',
      engine: engine.version,
      posixloom: '0.1.0',
      nativeHost: Boolean(engine.runtime.findNativeHost()),
      hostname: hostname(),
      platform: process.platform,
      hostCpus: cpus().length,
      hostMemoryMiB: Math.round(totalmem() / 1048576),
      freeMemoryMiB: Math.round(freemem() / 1048576),
      controllerMemoryMiB: Math.round(process.memoryUsage().rss / 1048576),
      imageReady: existsSync(IMAGE),
      imageBytes: (await stat(IMAGE).catch(() => null))?.size || 0,
    });
  if (route[1] === 'vms' && route.length === 2) {
    if (req.method === 'GET') return send(res, await machines.list());
    if (req.method === 'POST') return send(res, await machines.create(await body(req)), 201);
  }
  if (route[1] === 'vms' && route[2]) {
    const id = route[2];
    machines.get(id);
    if (route.length === 3) {
      if (req.method === 'GET') return send(res, await machines.view(id));
      if (req.method === 'PATCH') return send(res, await machines.update(id, await body(req)));
      if (req.method === 'DELETE') {
        await machines.delete(id);
        return send(res, { ok: true });
      }
    }
    if (req.method === 'POST' && route[3] === 'start') return send(res, await machines.start(id));
    if (req.method === 'POST' && route[3] === 'stop') {
      const options = z
        .object({ force: z.boolean().default(false) })
        .strict()
        .parse(await body(req));
      return send(res, await machines.stop(id, options.force));
    }
    if (req.method === 'POST' && route[3] === 'exec') {
      const { command } = z
        .object({ command: z.string().min(1).max(65536) })
        .strict()
        .parse(await body(req));
      return send(res, await machines.exec(id, command));
    }
    if (req.method === 'GET' && route[3] === 'logs')
      return send(res, { content: machines.logs.get(id) || '' });
    if (req.method === 'GET' && route[3] === 'files')
      return send(res, await machines.files(id, guestPath(url.searchParams.get('path') || '/workspace')));
    if (req.method === 'GET' && route[3] === 'file')
      return send(res, {
        content: await machines.readGuestFile(id, guestPath(url.searchParams.get('path'))),
      });
    if (req.method === 'PUT' && route[3] === 'file') {
      const value = z
        .object({ path: z.string(), content: z.string().max(1048576) })
        .strict()
        .parse(await body(req));
      await machines.writeGuestFile(id, guestPath(value.path), value.content);
      return send(res, { ok: true });
    }
    if (req.method === 'POST' && route[3] === 'snapshots' && route.length === 4) {
      const { name } = z
        .object({ name: z.string().trim().min(1).max(60) })
        .strict()
        .parse(await body(req));
      return send(res, await machines.snapshot(id, name), 201);
    }
    if (req.method === 'POST' && route[3] === 'snapshots' && route[4] && route[5] === 'restore')
      return send(res, await machines.restore(id, route[4]));
  }
  throw new AppError('接口不存在', 404);
};

const server = createServer(async (req, res) => {
  try {
    if (!allowedRequest(req)) throw new AppError('仅接受本机同源访问', 403);
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (vite) return vite.middlewares(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError('不支持此方法', 405);
    const dist = join(ROOT, 'dist');
    const path = resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (path !== dist && !path.startsWith(dist + sep)) throw new AppError('无效路径', 403);
    const candidate = (await stat(path).catch(() => null))?.isFile() ? path : join(dist, 'index.html');
    const data = await readFile(candidate);
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.woff2': 'font/woff2',
    };
    res.writeHead(200, {
      'Content-Type': mime[extname(candidate)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': candidate.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'",
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error: any) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const message =
      error instanceof ZodError
        ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')
        : error.message;
    send(res, { error: message || '操作失败' }, error instanceof ZodError ? 400 : error.status || 500);
  }
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  if (!url.pathname.startsWith('/ws/')) {
    if (!dev) socket.destroy();
    return;
  }
  const parts = url.pathname.split('/');
  const id = parts[2];
  const mode = parts[3];
  if (
    !allowedRequest(req) ||
    !equalToken(url.searchParams.get('token')) ||
    !machines.records.has(id) ||
    !['terminal', 'logs'].includes(mode)
  ) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  ws.handleUpgrade(req, socket, head, async (client) => {
    const sendData = (type: string, data: unknown) => {
      if (client.readyState === WebSocket.OPEN) {
        if (client.bufferedAmount > 1024 * 1024) {
          client.close(1008, 'slow consumer');
          return;
        }
        client.send(JSON.stringify({ type, data }));
      }
    };
    client.on('error', () => {});
    if (mode === 'logs') {
      sendData('data', machines.logs.get(id) || '等待 Linux 启动…\r\n');
      const listener = (data: string) => sendData('data', data);
      machines.on(`log:${id}`, listener);
      client.on('close', () => machines.off(`log:${id}`, listener));
      return;
    }
    let ssh: Awaited<ReturnType<typeof machines.connect>> | undefined;
    client.on('close', () => ssh?.end());
    try {
      ssh = await machines.connect(id);
      if (client.readyState !== WebSocket.OPEN) {
        ssh.end();
        return;
      }
      ssh.on('error', (error) => sendData('error', error.message));
      ssh.shell({ term: 'xterm-256color', cols: 100, rows: 28 }, (error, stream) => {
        if (error) {
          sendData('error', error.message);
          client.close();
          ssh?.end();
          return;
        }
        sendData('ready', true);
        const stdout = new StringDecoder('utf8'),
          stderr = new StringDecoder('utf8');
        stream.on('data', (data: Buffer) => sendData('data', stdout.write(data)));
        stream.stderr.on('data', (data: Buffer) => sendData('data', stderr.write(data)));
        stream.on('error', (error: Error) => sendData('error', error.message));
        stream.on('close', () => {
          sendData('exit', true);
          client.close();
          ssh?.end();
        });
        client.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'input' && typeof msg.data === 'string' && msg.data.length <= 32768)
              stream.write(msg.data);
            if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows))
              stream.setWindow(
                Math.max(2, Math.min(200, msg.rows)),
                Math.max(10, Math.min(400, msg.cols)),
                0,
                0,
              );
          } catch {
            client.close(1008, 'invalid message');
          }
        });
      });
    } catch (error: any) {
      sendData('error', error.message);
      client.close();
      ssh?.end();
    }
  });
});
if (dev) {
  const { createServer } = await import('vite');
  vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
}
server.listen(PORT, '127.0.0.1', () =>
  console.log(`Sakura → http://127.0.0.1:${PORT}\n${engine.version} · PosixLoom Native Host`),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  console.log('Stopping managed virtual machines…');
  for (const socket of ws.clients) socket.close();
  ws.close();
  server.close();
  await machines.close();
  await vite?.close();
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
