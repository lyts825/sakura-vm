import { createConnection, createServer } from 'node:net';
import { once } from 'node:events';

export async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res())));
  return port;
}
export async function qmp(port: number, command: string, args?: Record<string, unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setEncoding('utf8');
    let input = '';
    let sent = false;
    let settled = false;
    const timer = setTimeout(() => finish(new Error('QMP response timed out')), 5000);
    function finish(error?: Error, data?: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(data);
    }
    socket.on('error', (e) => finish(e));
    socket.on('close', () => finish(new Error('QMP closed')));
    socket.on('data', (data) => {
      if (settled) return;
      input += data;
      let index: number;
      while ((index = input.indexOf('\n')) >= 0) {
        const line = input.slice(0, index);
        input = input.slice(index + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return finish(new Error('Invalid QMP response'));
        }
        if (msg === null || typeof msg !== 'object' || Array.isArray(msg))
          return finish(new Error('Invalid QMP response'));
        if (msg.QMP) socket.write(JSON.stringify({ execute: 'qmp_capabilities', id: 'hello' }) + '\n');
        if (msg.id === 'hello' && !sent) {
          if (msg.error) return finish(new Error(msg.error.desc || 'QMP negotiation failed'));
          sent = true;
          socket.write(JSON.stringify({ execute: command, arguments: args, id: 'command' }) + '\n');
        }
        if (msg.id === 'command')
          return finish(msg.error ? new Error(msg.error.desc) : undefined, msg.return);
      }
    });
  });
}
