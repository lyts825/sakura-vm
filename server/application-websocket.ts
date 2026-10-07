/**
 * 模块职责：建立终端等 WebSocket 通道；异步准备期间也监听断开，确保原连接资源可清理。
 * Module purpose: Opens terminal and other WebSocket channels; observes disconnects during asynchronous preparation to retain cleanup ownership.
 */
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
import {
  encodeSocketOutput,
  closeSocket,
  parseSocketInput,
  socketUpgradeStatuses,
  SOCKET_CLIENT_BYTES,
  SOCKET_SERVER_BYTES,
  type SocketChannel,
  type JsonSocketChannel,
  type SocketServerMessage,
} from '../shared/contracts/websocket.ts';

/** Only this explicit domain code has a public recovery instruction; never expose exception messages. */
/**
 * 入口 / Entry: terminalConnectionFailure.
 * 功能：在建立终端等 WebSocket 通道中，执行此领域的具体处理步骤并返回其结果；本入口产生 `'目录及父目录尚未授权给项目账户，请显式迁移权限（PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED）。'` / `'终端连接暂不可用，请重试。'` 供上层消费（`application-websocket.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-websocket.ts`; this entry produces `'目录及父目录尚未授权给项目账户，请显式迁移权限（PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED）。'` / `'终端连接暂不可用，请重试。'` for its caller. Module context: Opens terminal and other WebSocket channels; observes disconnects during asynchronous preparation to retain cleanup ownership.
 * 分支 / Branches: `error instanceof AppError && error.code === 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED'`.
 * 输入 / Inputs: error: unknown
 * 输出 / Returns: `'目录及父目录尚未授权给项目账户，请显式迁移权限（PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED）。'`; `'终端连接暂不可用，请重试。'`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function terminalConnectionFailure(error: unknown) {
  if (error instanceof AppError && error.code === 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED')
    return '目录及父目录尚未授权给项目账户，请显式迁移权限（PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED）。';
  return '终端连接暂不可用，请重试。';
}

type SocketContext = {
  /**
   * 签名 / Signature: SocketContext.allowedRequest.
   * 功能：为建立终端等 WebSocket 通道声明 allowedRequest 的输入与结果契约，所属容器为 SocketContext。
   * Purpose: Declares the input/result contract for allowedRequest in SocketContext. Module responsibility: Opens terminal and other WebSocket channels; observes disconnects during asynchronous preparation to retain cleanup ownership.
   * 输入 / Inputs: req: IncomingMessage
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  allowedRequest: (req: IncomingMessage) => boolean;
  dev: ApplicationServices['dev'];
  features: ApplicationServices['features'];
  gateway: OperationGateway;
  machines: ApplicationServices['machines'];
  projectTerminals: ApplicationServices['projectTerminals'];
  server: import('node:http').Server;
  session: ApplicationServices['session'];
  socketAccounts: WeakMap<WebSocket, string>;
  /**
   * 签名 / Signature: SocketContext.socketAuthorization.
   * 功能：为建立终端等 WebSocket 通道声明 socketAuthorization 的输入与结果契约，所属容器为 SocketContext。
   * Purpose: Declares the input/result contract for socketAuthorization in SocketContext. Module responsibility: Opens terminal and other WebSocket channels; observes disconnects during asynchronous preparation to retain cleanup ownership.
   * 输入 / Inputs: credential: string; mode: string; id: string; terminalSession: string | null optional; terminalProject: string | null optional
   * 输出 / Returns: import('./access-control.ts').Principal | { role: 'owner' } | null.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
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
/**
 * 入口 / Entry: attachApplicationWebSocket.
 * 功能：注册升级处理，核验账户、项目和插件归属后连接终端、事件、日志或桌面通道。
 * Purpose: Registers upgrades and connects terminal/event/log/desktop channels after account, project and plugin verification.
 * 设计：异步准备前安装关闭监听；权限过期、只读输入、过大消息及慢消费者会关闭原连接，准备迟到的回执仍需释放。
 * Design: Close listeners precede preparation; expired grants, read-only input, oversized messages and slow consumers close the original connection, including late preparation receipts.
 * 输入 / Inputs: context: SocketContext
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
  /**
   * 入口 / Entry: attachApplicationWebSocket.callback@80.
   * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（server.on / upgrade）。
   * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (server.on / upgrade).
   * 输入 / Inputs: req; socket; head
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `requestUrl`; `socket.destroy`; `url.pathname.startsWith`; `socket.write`; 更新 / updates `admission`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `socket.end('HTTP/1.1 ' + socketUpgradeStatuses.locked + ' Locked\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');`; `return;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `socket.end('HTTP/1.1 ' + socketUpgradeStatuses.locked + ' Locked\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');`; `return;`; these statements determine whether a failure is absorbed or rejected again.
   */
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
      socket.end('HTTP/1.1 ' + socketUpgradeStatuses.locked + ' Locked\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    let admission: Awaited<ReturnType<OperationGateway['prepare']>>;
    try {
      admission = await gateway.prepare(req, url, 'UPGRADE');
    } catch {
      socket.end('HTTP/1.1 ' + socketUpgradeStatuses.refused + ' Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const { parameters } = gateway.resolve('UPGRADE', url.pathname);
    const id = parameters.vmId || 'events';
    const mode = admission.declaration.socketChannel as SocketChannel;
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
      socket.write('HTTP/1.1 ' + socketUpgradeStatuses.refused + ' Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (socket.destroyed) return;
    try {
      /**
       * 入口 / Entry: attachApplicationWebSocket.callback@135.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（ws.handleUpgrade）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (ws.handleUpgrade).
       * 输入 / Inputs: client
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      ws.handleUpgrade(req, socket, head, (client) => {
        client.on('error', () => {});
        // Install before any asynchronous domain preparation. Read-only channels accept no app input.
        /**
         * 入口 / Entry: attachApplicationWebSocket.callback@138.
         * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（client.on / message）。
         * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (client.on / message).
         * 输入 / Inputs: raw; binary
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `closeSocket`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         * 失败处理：catch 分支执行 `closeSocket(client, 'invalidMessage');`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `closeSocket(client, 'invalidMessage');`; these statements determine whether a failure is absorbed or rejected again.
         */
        client.on('message', (raw, binary) => {
          const bytes = Array.isArray(raw)
            ? raw.reduce((sum, part) => sum + part.byteLength, 0)
            : raw.byteLength;
          const desktop = mode === 'desktop' || mode === 'desktop-view';
          if (bytes > SOCKET_CLIENT_BYTES) closeSocket(client, 'messageTooLarge');
          else if (desktop ? !binary : binary) closeSocket(client, 'unsupportedMessageType');
          else if (!desktop && mode !== 'terminal') closeSocket(client, 'readOnlyChannel');
          else if (!desktop) {
            try {
              parseSocketInput(mode, raw.toString());
            } catch {
              closeSocket(client, 'invalidMessage');
            }
          }
        });
        /**
         * 入口 / Entry: attachApplicationWebSocket.callback@155.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（admission.run）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (admission.run).
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `socketCredentials.set`; `socketAccounts.set`; `setTimeout`; `socketTerminalGrants.set`; `socketVms.set`; 更新 / updates `terminalLease`, `ssh`.
         * 拒绝 / Refusals: 条件 / conditions `mode === 'terminal-view' && 'id' in principal && !terminalGrant?.terminalId`; 异常 / errors `new AppError('此共享授权未绑定运行会话，请让管理员重新共享终端', 409)`.
         * 失败处理：catch 分支执行 `client.terminate();`; `return;`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `client.terminate();`; `return;`; these statements determine whether a failure is absorbed or rejected again.
         */
        void admission
          .run(async () => {
            await admission.check();
            if (client.readyState !== WebSocket.OPEN) return;
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
              const grant = terminalSharing?.find(principal.id, id, terminalSession!, terminalProject);
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
              /**
               * 入口 / Entry: attachApplicationWebSocket.revoke.
               * 功能：把本层请求转交 `closeSocket`，沿用该实现的结果与失败路径。
               * Purpose: Delegates this request to `closeSocket` and propagates the provider result or rejection.
               * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
               * 输出 / Returns: `closeSocket(client, 'pluginRevoked')`.
               * 副作用 / Effects: `closeSocket`.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              const revoke = () => closeSocket(client, 'pluginRevoked');
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
              closeSocket(client, 'incidentLockdown');
              return;
            }
            /**
             * 入口 / Entry: attachApplicationWebSocket.callback@210.
             * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（admission.run）。
             * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (admission.run).
             * 输入 / Inputs: message: SocketServerMessage<C>
             * 输出 / Returns: `void`.
             * 副作用 / Effects: `closeSocket`; `client.send`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             * 失败处理：catch 分支执行 `closeSocket(client, 'invalidServerMessage');`，是否吞掉错误或重新拒绝由这些语句决定。
             * Failure handling: Catch paths execute `closeSocket(client, 'invalidServerMessage');`; these statements determine whether a failure is absorbed or rejected again.
             */
            /**
             * 入口 / Entry: attachApplicationWebSocket.sender.
             * 功能：在建立终端等 WebSocket 通道中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(message: SocketServerMessage<C>) => { if (client.readyState === WebSocket.OPEN) { if (client.bufferedAmount > 1024 * 1024) {…` / `void` 供上层消费（`application-websocket.ts`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-websocket.ts`; this entry produces `(message: SocketServerMessage<C>) => { if (client.readyState === WebSocket.OPEN) { if (client.bufferedAmount > 1024 * 1024) {…` / `void` for its caller. Module context: Opens terminal and other WebSocket channels; observes disconnects during asynchronous preparation to retain cleanup ownership.
             * 处理：通过 `closeSocket`, `encodeSocketOutput`, `client.send` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `closeSocket`, `encodeSocketOutput`, `client.send`; the branches below determine continuation, return or refusal.
             * 分支 / Branches: `client.readyState === WebSocket.OPEN`; `client.bufferedAmount > 1024 * 1024`; `Buffer.byteLength(payload) > SOCKET_SERVER_BYTES`.
             * 输入 / Inputs: channel: C
             * 输出 / Returns: `(message: SocketServerMessage<C>) => { if (client.readyState === WebSocket.OPEN) { if (client.bufferedAmount > 1024 * 1024) {…`; `void`.
             * 副作用 / Effects: `closeSocket`; `client.send`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             * 失败处理：catch 分支执行 `closeSocket(client, 'invalidServerMessage');`，是否吞掉错误或重新拒绝由这些语句决定。
             * Failure handling: Catch paths execute `closeSocket(client, 'invalidServerMessage');`; these statements determine whether a failure is absorbed or rejected again.
             */
            const sender = <C extends JsonSocketChannel>(channel: C) =>
            /**
             * 中文功能：只向 OPEN 客户端发送已编码输出；积压超过 1 MiB、消息超限或编码失败时按原因关闭连接。
             * English: Sends encoded output only to OPEN clients, closing with a reason for over-1-MiB backlog, oversized messages or encoding failures.
             * 所属 / Owner: attachApplicationWebSocket.catch.sender.
             * 输入 / Inputs: message: SocketServerMessage<C>.
             */
            (message: SocketServerMessage<C>) => {
              if (client.readyState === WebSocket.OPEN) {
                if (client.bufferedAmount > 1024 * 1024) {
                  closeSocket(client, 'slowConsumer');
                  return;
                }
                try {
                  const payload = encodeSocketOutput(channel, message);
                  if (Buffer.byteLength(payload) > SOCKET_SERVER_BYTES) {
                    closeSocket(client, 'messageTooLarge');
                    return;
                  }
                  client.send(payload);
                } catch {
                  closeSocket(client, 'invalidServerMessage');
                }
              }
            };
            if (mode === 'desktop' || mode === 'desktop-view') {
              try {
                const port = appSession ? await features.desktops.apps.port(id, appSession) : 5901;
                await admission.check();
                if (client.readyState !== WebSocket.OPEN) return;
                await features.desktops.attach(
                  id,
                  client,
                  mode === 'desktop-view',
                  port,
                  appSession || undefined,
                  terminalProject,
                );
              } catch {
                closeSocket(client, 'desktopUnavailable');
              }
              return;
            }
            if (events) {
              const send = sender('events');
              /**
               * 入口 / Entry: attachApplicationWebSocket.listener.
               * 功能：把本层请求转交 `send`，沿用该实现的结果与失败路径。
               * Purpose: Delegates this request to `send` and propagates the provider result or rejection.
               * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
               * 输出 / Returns: `send({ type: 'change', data: null })`.
               * 副作用 / Effects: `send`.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              const listener = () => send({ type: 'change', data: null });
              machines.on('change', listener);
              client.on('close', () => machines.off('change', listener));
              listener();
              return;
            }
            if (mode === 'logs') {
              const send = sender('logs');
              send({ type: 'data', data: machines.logs.get(id) || '等待 Linux 启动…\r\n' });
              /**
               * 入口 / Entry: attachApplicationWebSocket.listener.
               * 功能：把本层请求转交 `send`，沿用该实现的结果与失败路径。
               * Purpose: Delegates this request to `send` and propagates the provider result or rejection.
               * 输入 / Inputs: data: string
               * 输出 / Returns: `send({ type: 'data', data })`.
               * 副作用 / Effects: `send`.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              const listener = (data: string) => send({ type: 'data', data });
              machines.on(`log:${id}`, listener);
              client.on('close', () => machines.off(`log:${id}`, listener));
              return;
            }
            const send = sender(mode);
            let ssh: Awaited<ReturnType<typeof machines.connect>> | undefined;
            let terminalLease: Awaited<ReturnType<typeof projectTerminals.prepare>> | undefined;
            const terminalAbort = new AbortController();
            /**
             * 入口 / Entry: attachApplicationWebSocket.releaseTerminal.
             * 功能：在建立终端等 WebSocket 通道中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`application-websocket.ts`）。
             * Purpose: Ends, revokes or cleans resources owned by this domain action in `application-websocket.ts`; the calls and state transitions below complete the operation. Module context: Opens terminal and other WebSocket channels; observes disconnects during asynchronous preparation to retain cleanup ownership.
             * 处理：通过 `Promise.resolve().catch`, `Promise.resolve`, `terminalLease.release` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `Promise.resolve().catch`, `Promise.resolve`, `terminalLease.release`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
             * 副作用 / Effects: `terminalLease.release`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
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
                  ? terminalSharing?.find(principal.id, id, terminalSession!, terminalProject)
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
              // close may have fired before the preparation returned its cleanup receipt.
              if (terminalAbort.signal.aborted || client.readyState !== WebSocket.OPEN) {
                releaseTerminal();
                return;
              }
              ssh = await machines.connect(id, 10000, terminalAbort.signal);
              await admission.check();
              if (client.readyState !== WebSocket.OPEN) {
                ssh.end();
                return;
              }
              ssh.on('error', () => send({ type: 'error', data: '终端连接暂不可用，请重试。' }));
              ssh.once('close', () => client.close());
              /**
               * 入口 / Entry: attachApplicationWebSocket.connected.
               * 功能：在建立终端等 WebSocket 通道中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`application-websocket.ts`）。
               * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-websocket.ts`; this entry produces `void` for its caller. Module context: Opens terminal and other WebSocket channels; observes disconnects during asynchronous preparation to retain cleanup ownership.
               * 处理：通过 `stream.close`, `ssh.end`, `send`, `client.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
               * Processing: Coordinates its dependencies through `stream.close`, `ssh.end`, `send`, `client.close`; the branches below determine continuation, return or refusal.
               * 分支 / Branches: `!error && (terminalAbort.signal.aborted || client.readyState !== WebSocket.OPEN)`; `error`; `networkIsolation !== 'host' && networkIsolation !== 'private'`.
               * 输入 / Inputs: error: Error | undefined; stream: ClientChannel
               * 输出 / Returns: `void`.
               * 副作用 / Effects: `stream.close`; `send`; `client.close`; `closeSocket`.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              const connected = (error: Error | undefined, stream: ClientChannel) => {
                if (!error && (terminalAbort.signal.aborted || client.readyState !== WebSocket.OPEN)) {
                  stream.close();
                  ssh?.end();
                  return;
                }
                if (error) {
                  send({ type: 'error', data: '终端连接暂不可用，请重试。' });
                  client.close();
                  ssh?.end();
                  return;
                }
                // The service V1 result is wider than this wire enum. Keep the existing 1011 refusal.
                const networkIsolation = terminalLease!.networkIsolation;
                if (networkIsolation !== 'host' && networkIsolation !== 'private') {
                  closeSocket(client, 'invalidServerMessage');
                  return;
                }
                send({ type: 'ready', data: {
                  projectId: terminalLease!.projectId,
                  networkIsolation,
                } });
                const stdout = new StringDecoder('utf8'),
                  stderr = new StringDecoder('utf8');
                stream.on('data', (data: Buffer) => send({ type: 'data', data: stdout.write(data) }));
                stream.stderr.on('data', (data: Buffer) => send({ type: 'data', data: stderr.write(data) }));
                stream.on('error', () => send({ type: 'error', data: '终端连接暂不可用，请重试。' }));
                stream.on('close', () => {
                  send({ type: 'exit', data: true });
                  client.close();
                  ssh?.end();
                });
                /**
                 * 入口 / Entry: attachApplicationWebSocket.callback@336.
                 * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（client.on / message）。
                 * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (client.on / message).
                 * 输入 / Inputs: raw; binary
                 * 输出 / Returns: `void`.
                 * 副作用 / Effects: `closeSocket`; `stream.write`; `stream.setWindow`.
                 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                 * 失败处理：catch 分支执行 `closeSocket(client, 'invalidTerminalInput');`，是否吞掉错误或重新拒绝由这些语句决定。
                 * Failure handling: Catch paths execute `closeSocket(client, 'invalidTerminalInput');`; these statements determine whether a failure is absorbed or rejected again.
                 */
                client.on('message', (raw, binary) => {
                  try {
                    if (client.readyState !== WebSocket.OPEN || binary) return;
                    session.requireUnlocked();
                    if (mode === 'terminal-view') {
                      closeSocket(client, 'readOnlyTerminal');
                      return;
                    }
                    const msg = parseSocketInput(mode, raw.toString());
                    if (msg.type === 'input') stream.write(msg.data);
                    if (msg.type === 'resize')
                      stream.setWindow(
                        Math.max(2, Math.min(200, msg.rows)),
                        Math.max(10, Math.min(400, msg.cols)),
                        0,
                        0,
                      );
                  } catch {
                    closeSocket(client, 'invalidTerminalInput');
                  }
                });
              };
              ssh.exec(
                terminalLease.command,
                { pty: { term: 'xterm-256color', cols: 100, rows: 28 } },
                connected,
              );
            } catch (error: unknown) {
              send({ type: 'error', data: terminalConnectionFailure(error) });
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
