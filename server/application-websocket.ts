import { type IncomingMessage } from 'node:http';
import { StringDecoder } from 'node:string_decoder';
import type { ClientChannel } from 'ssh2';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { ApplicationServices } from './application-services.ts';
import { requestUrl } from './http.ts';
import { OperationGateway } from './operation-gateway.ts';
import { PORT } from './paths.ts';
import { projectIdSchema } from './project-catalog.ts';
type SocketContext = {
  allowedRequest: (req: IncomingMessage) => boolean;
  dev: ApplicationServices['dev'];
  features: ApplicationServices['features'];
  gateway: OperationGateway;
  machines: ApplicationServices['machines'];
  projectTerminals: ApplicationServices['projectTerminals'];
  server: import('node:http').Server;
  session: ApplicationServices['session'];
  socketAccounts: WeakMap<WebSocket, string>;
  socketAuthorization: (
    credential: string,
    mode: string,
    id: string,
    terminalSession?: string | null,
    terminalProject?: string | null,
  ) => import('./access-control.ts').Principal | { role: 'owner' } | null;
  socketCredentials: WeakMap<WebSocket, string>;
  socketPlugins: WeakMap<
    WebSocket,
    { identity: string; generation: string; accountId?: string; vmId?: string; projectId?: string }
  >;
  socketTerminalGrants: WeakMap<WebSocket, string>;
  socketVms: WeakMap<WebSocket, string>;
  terminalSharing: ApplicationServices['terminalSharing'];
  ws: WebSocketServer;
};
export function attachApplicationWebSocket(context: SocketContext) {
  const {
    allowedRequest,
    dev,
    features,
    gateway,
    machines,
    projectTerminals,
    server,
    session,
    socketAccounts,
    socketAuthorization,
    socketCredentials,
    socketPlugins,
    socketTerminalGrants,
    socketVms,
    terminalSharing,
    ws,
  } = context;
  server.on('upgrade', async (req, socket, head) => {
    const url = requestUrl(req.url, PORT);
    if (!url) {
      socket.destroy();
      return;
    }
    if (!url.pathname.startsWith('/ws/')) {
      if (!dev) socket.destroy();
      return;
    }
    try {
      session.requireUnlocked();
    } catch {
      socket.end('HTTP/1.1 423 Locked\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    let admission: Awaited<ReturnType<OperationGateway['prepare']>>;
    try {
      admission = await gateway.prepare(req, url, 'UPGRADE');
    } catch {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const { parameters } = gateway.resolve('UPGRADE', url.pathname);
    const id = parameters.vmId || 'events';
    const mode = admission.declaration.socketChannel || '';
    const terminalSession = url.searchParams.get('session');
    const terminalProject = url.searchParams.get('project');
    const appSession = url.searchParams.get('app');
    const events = mode === 'events';
    const credential = url.searchParams.get('token') || '';
    if (
      !allowedRequest(req) ||
      (!events &&
        (!machines.records.has(id) ||
          !['terminal', 'terminal-view', 'logs', 'desktop', 'desktop-view'].includes(mode))) ||
      (!events && admission.declaration.vmLock === 'require-unlocked' && machines.incidentLocked(id)) ||
      (mode === 'terminal-view' && (!terminalSession || !/^[a-z0-9-]{1,48}$/.test(terminalSession))) ||
      (terminalSession !== null &&
        (!['terminal', 'terminal-view', 'logs'].includes(mode) ||
          !/^[a-z0-9-]{1,48}$/.test(terminalSession))) ||
      (terminalProject !== null &&
        (!['terminal', 'terminal-view', 'desktop', 'desktop-view'].includes(mode) ||
          !projectIdSchema.safeParse(terminalProject).success)) ||
      (appSession !== null && (mode !== 'desktop' || !z.uuid().safeParse(appSession).success)) ||
      !socketAuthorization(credential, mode, id, terminalSession, terminalProject) ||
      ((mode === 'desktop' || mode === 'desktop-view') && !features.socketEnabled('desktop')) ||
      (url.searchParams.has('session') && !features.socketEnabled('terminal-session'))
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (socket.destroyed) return;
    try {
      ws.handleUpgrade(req, socket, head, (client) => {
        void admission
          .run(async () => {
            await admission.check();
            try {
              session.requireUnlocked();
            } catch {
              client.terminate();
              return;
            }
            const principal = socketAuthorization(credential, mode, id, terminalSession, terminalProject);
            if (!principal) {
              client.terminate();
              return;
            }
            socketCredentials.set(client, credential);
            if ('id' in principal) {
              socketAccounts.set(client, principal.id);
              const timer = setTimeout(
                () => client.terminate(),
                Math.max(1, principal.expiresAt - Date.now()),
              );
              client.once('close', () => clearTimeout(timer));
            }
            if (mode === 'terminal-view' && 'id' in principal) {
              const grant = terminalSharing.find(principal.id, id, terminalSession!, terminalProject);
              if (!grant) {
                client.terminate();
                return;
              }
              socketTerminalGrants.set(client, grant.id);
              const timer = setTimeout(() => client.terminate(), Math.max(1, grant.expiresAt - Date.now()));
              client.once('close', () => clearTimeout(timer));
            }
            if (!events) socketVms.set(client, id);
            if (admission.instance) {
              const generation = admission.instance.generation;
              const revoke = () => client.close(1008, 'Plugin generation revoked');
              admission.instance.signal.addEventListener('abort', revoke, { once: true });
              client.once('close', () => admission.instance?.signal.removeEventListener('abort', revoke));
              socketPlugins.set(client, {
                identity: admission.instance.identity,
                generation,
                accountId: 'id' in principal ? principal.id : undefined,
                vmId: events ? undefined : id,
                projectId: terminalProject || undefined,
              });
              if (admission.instance.signal.aborted) {
                revoke();
                return;
              }
            }
            if (!events && mode !== 'logs' && machines.incidentLocked(id)) {
              client.close(1008, 'Incident lockdown');
              return;
            }
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
            if (mode === 'desktop' || mode === 'desktop-view') {
              try {
                const port = appSession ? await features.desktops.apps.port(id, appSession) : 5901;
                await admission.check();
                await features.desktops.attach(
                  id,
                  client,
                  mode === 'desktop-view',
                  port,
                  appSession || undefined,
                  terminalProject,
                );
              } catch {
                client.close(1011, 'Desktop unavailable');
              }
              return;
            }
            if (events) {
              const listener = () => sendData('change', null);
              machines.on('change', listener);
              client.on('close', () => machines.off('change', listener));
              listener();
              return;
            }
            if (mode === 'logs') {
              sendData('data', machines.logs.get(id) || '等待 Linux 启动…\r\n');
              const listener = (data: string) => sendData('data', data);
              machines.on(`log:${id}`, listener);
              client.on('close', () => machines.off(`log:${id}`, listener));
              return;
            }
            let ssh: Awaited<ReturnType<typeof machines.connect>> | undefined;
            let terminalLease: Awaited<ReturnType<typeof projectTerminals.prepare>> | undefined;
            const terminalAbort = new AbortController();
            const releaseTerminal = () => {
              void Promise.resolve(terminalLease?.release()).catch((error) => {
                console.error('Terminal cleanup unconfirmed:', error);
              });
            };
            client.on('close', () => {
              terminalAbort.abort();
              releaseTerminal();
              ssh?.end();
            });
            try {
              const terminalGrant =
                mode === 'terminal-view' && 'id' in principal
                  ? terminalSharing.find(principal.id, id, terminalSession!, terminalProject)
                  : null;
              if (mode === 'terminal-view' && 'id' in principal && !terminalGrant?.terminalId)
                throw new AppError('此共享授权未绑定运行会话，请让管理员重新共享终端', 409);
              terminalLease = await projectTerminals.prepare(
                id,
                terminalProject,
                terminalSession,
                mode === 'terminal-view',
                terminalAbort.signal,
                terminalGrant?.terminalId,
              );
              ssh = await machines.connect(id, 10000, terminalAbort.signal);
              await admission.check();
              if (client.readyState !== WebSocket.OPEN) {
                ssh.end();
                return;
              }
              ssh.on('error', (error) => sendData('error', error.message));
              ssh.once('close', () => client.close());
              const connected = (error: Error | undefined, stream: ClientChannel) => {
                if (!error && (terminalAbort.signal.aborted || client.readyState !== WebSocket.OPEN)) {
                  stream.close();
                  ssh?.end();
                  return;
                }
                if (error) {
                  sendData('error', error.message);
                  client.close();
                  ssh?.end();
                  return;
                }
                sendData('ready', {
                  projectId: terminalLease!.projectId,
                  networkIsolation: terminalLease!.networkIsolation,
                });
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
                    session.requireUnlocked();
                    if (mode === 'terminal-view') {
                      client.close(1008, 'Read-only terminal');
                      return;
                    }
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
              };
              ssh.exec(
                terminalLease.command,
                { pty: { term: 'xterm-256color', cols: 100, rows: 28 } },
                connected,
              );
            } catch (error: any) {
              sendData('error', error.message);
              client.close();
              releaseTerminal();
              ssh?.end();
            }
          })
          .catch(() => client.terminate());
      });
    } catch {
      socket.destroy();
    }
  });
}
