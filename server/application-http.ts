import type { ResourceScopeV1 } from './service-contracts/v1.ts';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { ZodError, z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { accessHandoffInput, accessPasswordInput } from './access-control.ts';
import type { ApplicationServices } from './application-services.ts';
import { attachApplicationWebSocket } from './application-websocket.ts';
import { extensionOrigin } from './browser-extensions.ts';
import { graphqlInfo, graphqlLimits } from './graphql-api.ts';
import { hostRuntime } from './host-runtime/index.ts';
import { listenHttpServer } from './http-listener.ts';
import { createMachineApi } from './http-machines.ts';
import { coreHttpHandlers } from './core-http-handlers.ts';
import { sendJson as send } from './http-response.ts';
import { readJsonBody, requestUrl } from './http.ts';
import { assistantRequest } from './local-assistant.ts';
import { logRetentionRequest } from './log-retention.ts';
import { metadataQueueSnapshot } from './metadata-queue.ts';
import { monitorSnapshot } from './monitor.ts';
import { networkFor, networkRuntime } from './network/index.ts';
import { apiDocument } from './openapi.ts';
import { createOperationAuthority } from './operation-authority.ts';
import { operationEntries } from './operation-catalog.ts';
import { loaders } from './plugins/registry.ts';
import { PLUGINS } from '../shared/plugins.ts';
import { OperationGateway, currentOperation, validateOperationInput } from './operation-gateway.ts';
import { passkeyRemove } from './passkeys.ts';
import { PORT, ROOT } from './paths.ts';
import { policyBundlePreview, policyBundleTarget } from './policy-bundles.ts';
import { guestInteropRequest } from './process-interop.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectSchema } from './project-config.ts';
import { remoteAuditAction } from './remote-audit.ts';
import { ResourceScope } from './resource-scope.ts';
import { scheduler } from './scheduler.ts';
import { generateSdk } from './sdk.ts';
import { sameOrigin, tokenMatches } from './security.ts';
import { ssoCallbackPage, type SsoProvider } from './sso.ts';
import { terminalShareInput } from './terminal-sharing.ts';
const { createHttpServer: createServer } = networkFor('core:application');
const body = async (req: IncomingMessage, limit?: number, signal?: AbortSignal) =>
  validateOperationInput(await readJsonBody(req, limit, signal));

export async function startApplicationHttp(services: ApplicationServices, resources: ResourceScopeV1) {
  const { engine, usbHotplug, projectExecution } = services;
  const {
    access,
    assistant,
    audit,
    automationRules,
    browserExtensions,
    buildFarm,
    changeApprovals,
    coldMigrations,
    dev,
    features,
    fleetRollouts,
    gpuProfiles,
    graph,
    hostMounts,
    hostPeers,
    jitPrivileges,
    machines,
    mediaDevices,
    memoryReclaim,
    mobileCompanion,
    native,
    nativeClipboard,
    passkeys,
    policyBundles,
    processInterop,
    projectPermissions,
    projectTerminals,
    remoteAudit,
    retention,
    rollouts,
    selectedPlugins,
    session,
    snapshotReplications,
    sso,
    terminalSharing,
    trustedBoot,
    virtioFsShares,
    webhooks,
    plugins,
  } = services;
  const ws = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  resources.defer(
    'websockets',
    () => {
      for (const socket of ws.clients) socket.close();
      ws.close();
    },
    0,
  );
  const protectedResponses = new Set<ServerResponse>();
  services.onSessionChange((locked, transitioned) => {
    if (transitioned) services.token = randomBytes(32).toString('hex');
    if (locked) {
      access.revokeAll();
      sso.cancelPending();
      native.revoke();
      assistant.revoke();
      for (const client of ws.clients) client.terminate();
      for (const response of protectedResponses) response.destroy();
    }
    machines.emit('change');
  });
  services.connectionHooks.terminate = () => {
    for (const client of ws.clients) client.terminate();
  };
  const socketVms = new WeakMap<WebSocket, string>();
  const socketPlugins = new WeakMap<
    WebSocket,
    { identity: string; generation: string; accountId?: string; vmId?: string; projectId?: string }
  >();
  const socketAccounts = new WeakMap<WebSocket, string>();
  const socketCredentials = new WeakMap<WebSocket, string>();
  const socketTerminalGrants = new WeakMap<WebSocket, string>();
  const terminateAccountSockets = (id: string) => {
    for (const client of ws.clients) if (socketAccounts.get(client) === id) client.terminate();
  };
  const terminateCredentialSockets = (credential: string) => {
    for (const client of ws.clients) if (socketCredentials.get(client) === credential) client.terminate();
  };
  const terminateTerminalGrantSockets = (id: string) => {
    for (const client of ws.clients) if (socketTerminalGrants.get(client) === id) client.terminate();
  };
  machines.on('incident-lockdown', (id: string) => {
    for (const store of features.jobStores())
      for (const job of store.list())
        if (job.vmId === id && job.status === 'running' && job.id) store.cancel(job.id);
    for (const socket of ws.clients)
      if (socketVms.get(socket) === id) socket.close(1008, 'Incident lockdown');
  });
  let vite: Awaited<ReturnType<typeof import('vite').createServer>> | undefined;
  const equalToken = (value: unknown) => {
    if (!access.enabled) return tokenMatches(value, services.token);
    try {
      return access.authorize(value).role === 'owner';
    } catch {
      return false;
    }
  };
  const socketAuthorization = (
    credential: string,
    mode: string,
    id: string,
    terminalSession?: string | null,
    terminalProject?: string | null,
  ) => {
    if (!access.enabled) return equalToken(credential) ? { role: 'owner' as const } : null;
    try {
      const principal = access.authorize(credential);
      return (principal.role === 'owner' && mode !== 'terminal-view') ||
        (principal.role === 'viewer' &&
          principal.vmIds.includes(id) &&
          (mode === 'desktop-view' ||
            (mode === 'terminal-view' &&
              !!terminalSession &&
              !!terminalSharing.find(principal.id, id, terminalSession, terminalProject))))
        ? principal
        : null;
    } catch {
      return null;
    }
  };
  const allowedRequest = (req: IncomingMessage) => sameOrigin(req.headers, PORT);
  const requirePasskeyOrigin = (req: IncomingMessage) => {
    if (req.headers.host !== `localhost:${PORT}`)
      throw new AppError('通行密钥需要在 localhost 页面使用', 400);
  };
  const authorized = (req: IncomingMessage) => {
    session.requireUnlocked();
    if (access.enabled) return access.authorize(req.headers['x-sakura-token']);
    if (!equalToken(req.headers['x-sakura-token'])) throw new AppError('访问凭证已过期，请刷新页面', 401);
    return { role: 'owner' as const };
  };
  const authorizedBody = async (req: IncomingMessage, limit?: number, signal?: AbortSignal) => {
    const input = await body(req, limit, signal);
    authorized(req);
    return input;
  };
  plugins.assertReady();
  const gateway = new OperationGateway({
    enabled: () => features.enabled,
    owner: (url, entry) =>
      entry.transport === 'websocket'
        ? (url.searchParams.has('session') ? entry.sessionOwner : undefined) || entry.executionOwner || entry.owner
        : entry.owner,
    instance: (owner) =>
      owner === 'core' ? plugins.system.caller : plugins.directory.get('official', owner),
    catalogVersion: () => plugins.directory.view().version,
    bind: createOperationAuthority({
      machines,
      features,
      access,
      session,
      projectPermissions,
      browserExtensions,
      equalToken,
      socketAuthorization,
    }),
  });
  const sendSsoPage = (
    res: ServerResponse,
    origin: string | null,
    state: string,
    result?: unknown,
    error?: string,
  ) => {
    const { html, nonce } = ssoCallbackPage(origin, state, result, error);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`,
    });
    res.end(html);
  };
  const samlPost = async (req: IncomingMessage) => {
    if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))
      throw new AppError('SAML 回调需要表单编码', 415);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1_500_000) throw new AppError('SAML 响应过大', 413);
      chunks.push(chunk);
    }
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    if (form.getAll('SAMLResponse').length !== 1 || form.getAll('RelayState').length !== 1)
      throw new AppError('SAML 响应缺少唯一的状态与断言', 400);
    return { SAMLResponse: form.get('SAMLResponse')!, RelayState: form.get('RelayState')! };
  };
  const extensionApi = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host || ''))
      throw new AppError('仅接受本机扩展连接', 403);
    let origin: string;
    try {
      origin = extensionOrigin(
        req.headers.origin || (req.method === 'GET' ? req.headers['x-sakura-extension-origin'] : undefined),
      );
      if (req.method !== 'OPTIONS' && req.headers['x-sakura-extension-origin'] !== origin)
        throw new Error('扩展来源不一致');
    } catch {
      throw new AppError('需要有效的浏览器扩展来源', 403);
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin, X-Sakura-Extension-Origin');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Sakura-Extension-Origin, X-Sakura-Extension-Token',
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    session.requireUnlocked();
    protectedResponses.add(res);
    const unprotect = () => protectedResponses.delete(res);
    res.once('finish', unprotect);
    res.once('close', unprotect);
    if (!access.enabled) throw new AppError('请先启用账户模式', 409);
    if (url.pathname === '/api/extension/connect') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await browserExtensions.connect(origin, await body(req, 4096)), 201);
      } finally {
        releaseMutation();
      }
    }
    if (url.pathname === '/api/extension/inventory') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      const grant = browserExtensions.authorize(origin, req.headers['x-sakura-extension-token']);
      const vms = await Promise.all([...machines.records.keys()].map((id) => machines.view(id)));
      session.requireUnlocked();
      return send(res, {
        permissions: grant.permissions,
        expiresAt: grant.expiresAt,
        checkedAt: new Date().toISOString(),
        vms: vms.map(({ id, name, status, distro, cpus, memoryMiB, diskGiB }) => ({
          id,
          name,
          status,
          distro,
          cpus,
          memoryMiB,
          diskGiB,
        })),
      });
    }
    throw new AppError('接口不存在', 404);
  };
  const machineApi = createMachineApi({
    machines,
    features,
    pluginRuntime: () => plugins.directory.view(),
    engine,
    session,
    usbHotplug,
    projectPermissions,
    projectExecution,
    authorizedBody,
  });
  const api = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (url.pathname === '/api/access/status') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, { ...access.status(), session: session.view() });
    }
    if (url.pathname === '/api/session') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, session.view());
    }
    if (url.pathname === '/api/session/unlock') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      return send(res, await session.unlock(await body(req, 4096)));
    }
    if (url.pathname === '/api/session/unlock/passkey/options') {
      if (req.method !== 'POST' || !access.enabled || !session.view().locked)
        throw new AppError('控制面未启用通行密钥解锁', 409);
      requirePasskeyOrigin(req);
      z.object({})
        .strict()
        .parse(await body(req, 4096));
      return send(res, await passkeys.beginUnlock(session.getGeneration()));
    }
    if (url.pathname === '/api/session/unlock/passkey/verify') {
      if (req.method !== 'POST' || !access.enabled || !session.view().locked)
        throw new AppError('控制面未启用通行密钥解锁', 409);
      requirePasskeyOrigin(req);
      const { login, lockGeneration } = await passkeys.finishUnlock(await body(req, 65536));
      try {
        const unlocked = await session.unlockWithPasskey(lockGeneration!);
        return send(res, { ...login, session: unlocked });
      } catch (error) {
        access.logout(login.token);
        throw error;
      }
    }
    if (
      url.pathname === '/api/access/sso/oidc/callback' ||
      url.pathname === '/api/access/sso/saml/callback'
    ) {
      const providerId: SsoProvider = url.pathname.includes('/oidc/') ? 'oidc' : 'saml';
      if (req.method !== (providerId === 'oidc' ? 'GET' : 'POST')) throw new AppError('不支持此方法', 405);
      const post = providerId === 'saml' ? await samlPost(req) : undefined;
      const state = providerId === 'oidc' ? url.searchParams.get('state') || '' : post!.RelayState;
      const origin = sso.pendingOrigin(providerId, state);
      try {
        session.requireUnlocked();
        const completed =
          providerId === 'oidc'
            ? await sso.completeOidc(
                new URL(url.search, `http://localhost:${PORT}/api/access/sso/oidc/callback`),
              )
            : await sso.completeSaml(post!);
        try {
          session.requireUnlocked();
        } catch (error) {
          if ('token' in completed.result) access.logout(completed.result.token);
          throw error;
        }
        return sendSsoPage(res, completed.origin, completed.state, completed.result);
      } catch (error) {
        return sendSsoPage(
          res,
          origin,
          state,
          undefined,
          error instanceof Error ? error.message : '单点登录失败',
        );
      }
    }
    session.requireUnlocked();
    if (url.pathname === '/api/access/sso/providers') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, sso.providers());
    }
    if (url.pathname === '/api/access/sso/start') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const input = await body(req, 4096);
      session.requireUnlocked();
      const credential = req.headers['x-sakura-token'];
      const started = await sso.begin(input, typeof credential === 'string' ? credential : undefined);
      try {
        session.requireUnlocked();
      } catch (error) {
        sso.cancelPending();
        throw error;
      }
      return send(res, started);
    }
    if (url.pathname === '/api/access/login') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const login = await access.login(await body(req, 4096));
      try {
        session.requireUnlocked();
      } catch (error) {
        access.logout(login.token);
        throw error;
      }
      return send(res, login);
    }
    if (url.pathname === '/api/access/handoff/redeem') {
      if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
      const { sourceToken, ...login } = await access.redeemHandoff(await body(req, 4096));
      try {
        session.requireUnlocked();
      } catch (error) {
        access.logout(login.token);
        throw error;
      }
      terminateCredentialSockets(sourceToken);
      return send(res, login);
    }
    if (url.pathname === '/api/access/passkeys/login/options') {
      if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
      requirePasskeyOrigin(req);
      z.object({})
        .strict()
        .parse(await body(req, 4096));
      return send(res, await passkeys.beginAuthentication());
    }
    if (url.pathname === '/api/access/passkeys/login/verify') {
      if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
      requirePasskeyOrigin(req);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const login = await passkeys.finishAuthentication(await body(req, 65536));
      try {
        session.requireUnlocked();
      } catch (error) {
        access.logout(login.token);
        throw error;
      }
      return send(res, login);
    }
    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
      if (access.enabled) throw new AppError('请登录账户后访问 Sakura', 401);
      return send(res, { token: services.token, session: session.view() });
    }
    // End already admitted streams when a lock takes effect. The lock response itself must survive.
    if (url.pathname !== '/api/session/lock') {
      protectedResponses.add(res);
      const remove = () => protectedResponses.delete(res);
      res.once('finish', remove);
      res.once('close', remove);
    }
    if (await features.downloads?.route(req, res, url)) return;
    const principal = authorized(req);
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/recoveries') {
      if (req.method === 'GET') return send(res, { version: 1, records: await services.recoveries.refresh() });
      return send(res, await services.recoveries.retry(await authorizedBody(req, 4096)));
    }
    if (url.pathname === '/api/operations')
      return send(res, { version: gateway.version, operations: gateway.directory() });
    if (url.pathname === '/api/host-runtime') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      if (access.enabled && accountPrincipal?.role !== 'owner')
        throw new AppError('仅管理员可查看系统资源状态', 403);
      return send(res, {
        ...hostRuntime.snapshot(),
        diagnostics: services.diagnostics.snapshot(),
        schedules: scheduler.snapshot(),
        metadata: metadataQueueSnapshot(),
      });
    }
    if (url.pathname === '/api/network-runtime') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      if (access.enabled && accountPrincipal?.role !== 'owner')
        throw new AppError('仅管理员可查看网络运行状态', 403);
      return send(res, networkRuntime.snapshot());
    }
    if (url.pathname === '/api/access/sso') {
      if (req.method !== 'GET' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      return send(res, sso.view(accountPrincipal.role === 'owner' ? undefined : accountPrincipal.id));
    }
    if (url.pathname === '/api/access/sso/oidc' || url.pathname === '/api/access/sso/saml') {
      if (accountPrincipal?.role !== 'owner') throw new AppError('仅管理员可配置单点登录', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const providerId: SsoProvider = url.pathname.endsWith('oidc') ? 'oidc' : 'saml';
      if (req.method === 'DELETE') return send(res, await sso.disable(providerId));
      if (req.method !== 'PUT') throw new AppError('不支持此方法', 405);
      const input = await authorizedBody(req, providerId === 'saml' ? 700_000 : 8192);
      return send(
        res,
        providerId === 'oidc' ? await sso.configureOidc(input) : await sso.configureSaml(input),
      );
    }
    if (/^\/api\/access\/sso\/link\/(oidc|saml)$/.test(url.pathname)) {
      if (req.method !== 'DELETE' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await sso.unlink(accountPrincipal.id, url.pathname.split('/').at(-1) as SsoProvider));
    }
    const operation = currentOperation();
    if (!operation) throw new AppError('HTTP 入口缺少操作准入', 403, 'OPERATION_NOT_ADMITTED');
    // The configuration handler retains the member-specific save behavior; permission is the declared policy.
    if (accountPrincipal?.role === 'member' && operation.approval === 'project-change') {
      const { parameters } = gateway.resolve(req.method || 'GET', url.pathname);
      const vmId = parameters.vmId;
      const projectId = url.searchParams.get('project')!;
      const proposal = projectSchema.parse(await authorizedBody(req, 32768));
      return features.workspaces.projects.with(vmId, projectId, async () => {
        const previous = await features.workspaces.config(vmId);
        return send(res, await features.workspaces.save(vmId, proposal, previous.directory));
      });
    }
    if (url.pathname === '/api/access/projects') {
      if (req.method !== 'GET' || accountPrincipal?.role !== 'member')
        throw new AppError('只有项目成员可查看授权项目', 403);
      return send(res, { projects: await projectPermissions.accessible(accountPrincipal) });
    }
    if (url.pathname === '/api/access/changes') {
      if (!accountPrincipal || !changeApprovals) throw new AppError('请先启用账户模式与项目工作区插件', 409);
      if (req.method === 'GET') return send(res, { changes: await changeApprovals.list(accountPrincipal) });
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await changeApprovals.create(accountPrincipal, await authorizedBody(req, 65536)), 201);
    }
    if (/^\/api\/access\/changes\/[a-f0-9-]{36}\/decision$/.test(url.pathname)) {
      if (req.method !== 'POST' || !accountPrincipal || !changeApprovals)
        throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(
        res,
        await changeApprovals.decide(
          accountPrincipal,
          url.pathname.split('/')[4],
          await authorizedBody(req, 4096),
        ),
      );
    }
    if (/^\/api\/access\/changes\/[a-f0-9-]{36}\/apply$/.test(url.pathname)) {
      if (req.method !== 'POST' || !accountPrincipal || !changeApprovals)
        throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      z.object({})
        .strict()
        .parse(await authorizedBody(req, 4096));
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await changeApprovals.apply(accountPrincipal, url.pathname.split('/')[4]));
      } finally {
        releaseMutation();
      }
    }
    if (url.pathname === '/api/access/view') {
      if (req.method !== 'GET' || !access.enabled) throw new AppError('不支持此方法', 405);
      const ids = principal.role === 'viewer' ? principal.vmIds : [...machines.records.keys()];
      const vms = await Promise.all(
        ids.filter((id) => machines.records.has(id)).map((id) => machines.view(id)),
      );
      return send(res, {
        role: principal.role,
        checkedAt: new Date().toISOString(),
        desktopAvailable: features.socketEnabled('desktop'),
        vms: vms.map(({ id, name, status, distro, cpus, memoryMiB, diskGiB }) => ({
          id,
          name,
          status,
          distro,
          cpus,
          memoryMiB,
          diskGiB,
        })),
      });
    }
    if (url.pathname === '/api/access/logout') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const credential = req.headers['x-sakura-token'];
      const result = access.logout(credential);
      if (typeof credential === 'string') terminateCredentialSockets(credential);
      return send(res, result);
    }
    if (url.pathname === '/api/access/handoff') {
      if (!accountPrincipal) throw new AppError('账户模式未启用', 409);
      if (req.method === 'DELETE') return send(res, access.cancelHandoff(req.headers['x-sakura-token']));
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const input = accessHandoffInput.parse(await authorizedBody(req, 4096));
      const proof = await access.login({ username: accountPrincipal.username, password: input.password });
      access.logout(proof.token);
      return send(res, await access.createHandoff(req.headers['x-sakura-token']));
    }
    if (url.pathname === '/api/access/terminal-shares') {
      if (!accountPrincipal) throw new AppError('账户模式未启用', 409);
      if (req.method === 'GET') {
        const vmId = url.searchParams.get('vmId');
        const projectId = url.searchParams.get('project');
        if (vmId) z.uuid().parse(vmId);
        if (projectId !== null) projectIdSchema.parse(projectId);
        if (accountPrincipal.role === 'viewer' && vmId && !accountPrincipal.vmIds.includes(vmId))
          throw new AppError('实例不在账户范围内', 403);
        return send(res, {
          grants: terminalSharing.list(
            accountPrincipal.role === 'viewer' ? accountPrincipal.id : undefined,
            vmId || undefined,
            projectId || undefined,
          ),
        });
      }
      if (req.method !== 'POST' || accountPrincipal.role !== 'owner')
        throw new AppError('只有管理员可共享终端', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      if (!features.socketEnabled('terminal-session')) throw new AppError('请先启用可恢复终端会话插件', 409);
      const input = terminalShareInput.parse(await authorizedBody(req, 4096));
      machines.requireUnlocked(input.vmId);
      const viewer = access
        .users()
        .find(
          (user) =>
            user.id === input.viewerId &&
            user.role === 'viewer' &&
            user.vmIds.includes(input.vmId) &&
            (user.expiresAt === null || user.expiresAt > Date.now()),
        );
      if (!viewer) throw new AppError('只读账户无此实例权限', 403);
      const result = await terminalSharing.create(input);
      terminateTerminalGrantSockets(result.id);
      return send(res, result, 201);
    }
    if (/^\/api\/access\/terminal-shares\/[a-f0-9-]{36}$/.test(url.pathname)) {
      if (req.method !== 'DELETE' || accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可撤销终端共享', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const id = url.pathname.split('/').at(-1)!;
      const result = await terminalSharing.revoke(id);
      terminateTerminalGrantSockets(id);
      return send(res, result);
    }
    if (url.pathname === '/api/access/jit') {
      if (!accountPrincipal) throw new AppError('账户模式未启用', 409);
      if (req.method === 'GET') return send(res, { requests: jitPrivileges.list(accountPrincipal) });
      if (req.method !== 'POST' || accountPrincipal.role !== 'viewer')
        throw new AppError('只有只读账户可申请临时授权', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await jitPrivileges.create(accountPrincipal, await authorizedBody(req, 4096)), 201);
    }
    if (url.pathname === '/api/browser-extensions') {
      if (accountPrincipal?.role !== 'owner') throw new AppError('只有管理员可管理浏览器扩展', 403);
      if (req.method === 'GET')
        return send(res, { connections: browserExtensions.list(accountPrincipal.id) });
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      z.object({})
        .strict()
        .parse(await authorizedBody(req, 4096));
      return send(res, browserExtensions.createPairing(accountPrincipal.id), 201);
    }
    if (url.pathname === '/api/mobile-companion') {
      if (accountPrincipal?.role !== 'owner') throw new AppError('只有管理员可管理移动伴侣', 403);
      if (req.method === 'GET')
        return send(res, {
          ...mobileCompanion.view(accountPrincipal.id),
          listener: hostPeers.view().listener,
          fingerprint: hostPeers.view().fingerprint,
        });
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await mobileCompanion.action(accountPrincipal.id, await authorizedBody(req, 4096)));
      } finally {
        releaseMutation();
      }
    }
    if (/^\/api\/browser-extensions\/[a-f0-9-]{36}$/.test(url.pathname)) {
      if (req.method !== 'DELETE' || accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可撤销浏览器扩展', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await browserExtensions.revoke(accountPrincipal.id, url.pathname.split('/')[3]));
      } finally {
        releaseMutation();
      }
    }
    if (/^\/api\/access\/jit\/[a-f0-9-]{36}\/decision$/.test(url.pathname)) {
      if (req.method !== 'POST' || accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可审批临时授权', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(
        res,
        await jitPrivileges.decide(
          accountPrincipal,
          url.pathname.split('/')[4],
          await authorizedBody(req, 4096),
        ),
      );
    }
    if (/^\/api\/access\/jit\/[a-f0-9-]{36}\/execute$/.test(url.pathname)) {
      if (req.method !== 'POST' || accountPrincipal?.role !== 'viewer')
        throw new AppError('只有申请账户可执行临时授权', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      z.object({})
        .strict()
        .parse(await authorizedBody(req, 4096));
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await jitPrivileges.execute(accountPrincipal, url.pathname.split('/')[4]));
      } finally {
        releaseMutation();
      }
    }
    if (url.pathname === '/api/access/passkeys') {
      if (req.method !== 'GET' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      return send(res, { passkeys: access.passkeysFor(accountPrincipal.id) });
    }
    if (url.pathname === '/api/access/passkeys/register/options') {
      if (req.method !== 'POST' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      requirePasskeyOrigin(req);
      return send(res, await passkeys.beginRegistration(accountPrincipal, await authorizedBody(req, 4096)));
    }
    if (url.pathname === '/api/access/passkeys/register/verify') {
      if (req.method !== 'POST' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      requirePasskeyOrigin(req);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(
        res,
        await passkeys.finishRegistration(accountPrincipal, await authorizedBody(req, 65536)),
        201,
      );
    }
    if (/^\/api\/access\/passkeys\/[A-Za-z0-9_-]{16,1024}$/.test(url.pathname)) {
      if (req.method !== 'DELETE' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const input = passkeyRemove.parse(await authorizedBody(req, 4096));
      const proof = await access.login({ username: accountPrincipal.username, password: input.password });
      access.logout(proof.token);
      const result = await access.removePasskey(accountPrincipal.id, url.pathname.split('/').at(-1)!);
      terminateAccountSockets(accountPrincipal.id);
      return send(res, result);
    }
    if (url.pathname === '/api/access/enable') {
      if (req.method !== 'POST' || access.enabled) throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const result = await access.enable(await authorizedBody(req, 4096));
      services.token = randomBytes(32).toString('hex');
      for (const client of ws.clients) client.terminate();
      return send(res, result);
    }
    if (url.pathname === '/api/access/users') {
      if (!access.enabled) throw new AppError('账户模式未启用', 409);
      if (req.method === 'GET') return send(res, { users: access.users() });
      if (req.method === 'POST') {
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        const input = await authorizedBody(req, 4096);
        const vmIds = z
          .array(z.uuid())
          .min(1)
          .max(32)
          .parse((input as { vmIds?: unknown }).vmIds);
        for (const id of vmIds) machines.get(id);
        return send(res, await access.createViewer(input), 201);
      }
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/access/members') {
      if (req.method !== 'POST' || accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可创建项目成员', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await access.createMember(await authorizedBody(req, 4096)), 201);
    }
    if (/^\/api\/access\/members\/[a-f0-9-]{36}$/.test(url.pathname)) {
      if (req.method !== 'DELETE' || accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可删除项目成员', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const id = url.pathname.split('/').at(-1)!;
      const result = await access.removeMember(id);
      terminateAccountSockets(id);
      await projectPermissions.revokeMember(id);
      return send(res, result);
    }
    if (url.pathname === '/api/access/project-permissions') {
      if (accountPrincipal?.role !== 'owner') throw new AppError('只有管理员可管理项目权限', 403);
      if (!features.enabled.has('projects')) throw new AppError('项目工作区插件未启用', 403);
      const vmId = z.uuid().parse(url.searchParams.get('vmId'));
      const projectId = url.searchParams.get('projectId') || '';
      if (req.method === 'GET') return send(res, await projectPermissions.view(vmId, projectId));
      if (req.method !== 'PUT') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await projectPermissions.configure(vmId, projectId, await authorizedBody(req, 32768)));
    }
    if (url.pathname.startsWith('/api/access/policy-bundles/')) {
      if (accountPrincipal?.role !== 'owner') throw new AppError('只有管理员可管理项目策略包', 403);
      if (!features.enabled.has('projects')) throw new AppError('项目工作区插件未启用', 403);
      if (url.pathname === '/api/access/policy-bundles/keys') {
        if (req.method === 'GET') return send(res, policyBundles.keys());
        if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        return send(res, await policyBundles.action(await authorizedBody(req, 8192)));
      }
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (url.pathname === '/api/access/policy-bundles/export') {
        const target = policyBundleTarget.parse(await authorizedBody(req, 4096));
        return send(res, { bundle: await policyBundles.export(target.vmId, target.projectId) });
      }
      if (url.pathname === '/api/access/policy-bundles/preview') {
        const input = policyBundlePreview.parse(await authorizedBody(req, 65536));
        return send(res, await policyBundles.preview(input.bundle, input.target));
      }
      if (url.pathname === '/api/access/policy-bundles/apply') {
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        const releaseMutation = features.operations.enter();
        try {
          return send(res, await policyBundles.apply(await authorizedBody(req, 65536)));
        } finally {
          releaseMutation();
        }
      }
      throw new AppError('接口不存在', 404);
    }
    if (/^\/api\/access\/users\/[a-f0-9-]{36}$/.test(url.pathname)) {
      if (req.method !== 'DELETE') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const id = url.pathname.split('/').at(-1)!;
      const result = await access.removeViewer(id);
      terminateAccountSockets(id);
      await terminalSharing.revokeViewer(id);
      return send(res, result);
    }
    if (url.pathname === '/api/access/password') {
      if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const input = accessPasswordInput.parse(await authorizedBody(req, 4096));
      const proof = await access.login({ username: accountPrincipal!.username, password: input.password });
      access.logout(proof.token);
      await browserExtensions.revokeAll();
      await mobileCompanion.revokeAll();
      const result = await access.changeOwnerPassword(input);
      for (const client of ws.clients) client.terminate();
      return send(res, result);
    }
    if (url.pathname === '/api/session/lock' || url.pathname === '/api/session/activity') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      z.object({})
        .strict()
        .parse(await authorizedBody(req, 4096));
      return send(res, url.pathname.endsWith('/lock') ? session.lock() : session.activity());
    }
    if (url.pathname === '/api/session/settings') {
      if (req.method === 'GET') return send(res, session.view());
      if (req.method !== 'PATCH') throw new AppError('不支持此方法', 405);
      const releaseMutation = features.operations.enter();
      try {
        const input = await authorizedBody(req, 4096);
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        return send(res, await session.configure(input));
      } finally {
        releaseMutation();
      }
    }
    if (url.pathname === '/api/graphql-schema') {
      if (req.method !== 'GET') throw new AppError('Schema 接口仅支持读取', 405);
      return send(res, graphqlInfo());
    }
    if (url.pathname === '/api/graphql') {
      if (req.method !== 'POST') throw new AppError('GraphQL 查询使用 POST JSON', 405);
      const abort = new AbortController();
      const cancel = () => {
        if (!res.writableFinished) abort.abort();
      };
      req.once('aborted', cancel);
      res.once('close', cancel);
      if (req.aborted || res.destroyed) cancel();
      try {
        const result = await graph.query(
          await authorizedBody(req, graphqlLimits.requestBytes, abort.signal),
          abort.signal,
        );
        res.writeHead(result.status, {
          'Content-Type': 'application/graphql-response+json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(JSON.stringify(result.body));
      } finally {
        req.off('aborted', cancel);
        res.off('close', cancel);
      }
    }
    if (url.pathname === '/api/openapi' || url.pathname === '/api/sdk') {
      if (req.method !== 'GET') throw new AppError('文档接口仅支持读取', 405);
      const specification = apiDocument(features.enabled, PORT, gateway.version);
      return send(
        res,
        url.pathname === '/api/openapi'
          ? specification
          : { filename: 'sakura-client.mjs', mime: 'text/javascript', content: generateSdk(specification) },
      );
    }
    if (url.pathname === '/api/monitor') {
      if (req.method !== 'GET') throw new AppError('监控接口仅支持读取', 405);
      return send(res, await monitorSnapshot(machines, features.jobStores()));
    }
    if (url.pathname === '/api/audit' && req.method === 'GET') return send(res, await audit.read(200));
    if (url.pathname === '/api/audit/remote') {
      if (accountPrincipal?.role !== 'owner') throw new AppError('只有管理员可管理远程审计', 403);
      if (req.method === 'GET') return send(res, await remoteAudit.status());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const input = remoteAuditAction.parse(await authorizedBody(req, 8192));
      const releaseMutation = features.operations.enter();
      try {
        return send(
          res,
          input.action === 'configure'
            ? await remoteAudit.configure(input.target)
            : input.action === 'disable'
              ? await remoteAudit.disable()
              : input.action === 'verify'
                ? await remoteAudit.verify()
                : await remoteAudit.sync(),
        );
      } finally {
        releaseMutation();
      }
    }
    if (url.pathname === '/api/log-retention') {
      if (req.method === 'GET') return send(res, retention.view());
      if (req.method === 'POST') {
        const input = logRetentionRequest.parse(await authorizedBody(req));
        return send(
          res,
          input.action === 'preview'
            ? retention.preview(input.policy)
            : await retention.save(input.policy, input.token),
        );
      }
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/webhooks') {
      if (req.method === 'GET') return send(res, webhooks.view());
      if (req.method === 'POST') return send(res, await webhooks.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/automation-rules') {
      if (req.method === 'GET') return send(res, automationRules.view());
      if (req.method === 'POST')
        return send(res, await automationRules.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/feature-rollouts') {
      if (req.method === 'GET')
        return send(res, {
          ...rollouts.view(),
          selected: selectedPlugins,
          active: [...features.enabled],
        });
      if (req.method === 'POST') return send(res, await rollouts.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/fleet-policy-rollouts') {
      if (req.method === 'GET') return send(res, fleetRollouts.view());
      if (req.method === 'POST')
        return send(res, await fleetRollouts.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/gpu-profiles') {
      if (req.method === 'GET') return send(res, await gpuProfiles.view());
      if (req.method === 'POST') return send(res, await gpuProfiles.action(await authorizedBody(req, 8192)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/build-farm') {
      if (req.method === 'GET')
        return send(
          res,
          url.searchParams.has('vmId')
            ? await buildFarm.projects(url.searchParams.get('vmId')!)
            : buildFarm.view(),
        );
      if (req.method === 'POST') return send(res, await buildFarm.action(await authorizedBody(req, 8192)));
      throw new AppError('不支持此方法', 405);
    }
    const mediaRoute = /^\/api\/vms\/([a-f0-9-]{36})\/media-devices$/.exec(url.pathname);
    if (mediaRoute) {
      if (req.method === 'GET') return send(res, await mediaDevices.view(mediaRoute[1]));
      if (req.method === 'POST')
        return send(res, await mediaDevices.action(mediaRoute[1], await authorizedBody(req, 8192)));
      throw new AppError('不支持此方法', 405);
    }
    const reclaimRoute = /^\/api\/vms\/([a-f0-9-]{36})\/memory-reclaim$/.exec(url.pathname);
    if (reclaimRoute) {
      if (req.method === 'GET') return send(res, await memoryReclaim.view(reclaimRoute[1]));
      if (req.method === 'POST')
        return send(res, await memoryReclaim.action(reclaimRoute[1], await authorizedBody(req, 4096)));
      throw new AppError('不支持此方法', 405);
    }
    const hostMountRoute = /^\/api\/vms\/([a-f0-9-]{36})\/host-mount$/.exec(url.pathname);
    if (hostMountRoute) {
      if (req.method === 'GET') return send(res, await hostMounts.view(hostMountRoute[1]));
      if (req.method === 'POST')
        return send(res, await hostMounts.action(hostMountRoute[1], await authorizedBody(req, 4096)));
      throw new AppError('不支持此方法', 405);
    }
    const virtioFsRoute = /^\/api\/vms\/([a-f0-9-]{36})\/virtio-fs$/.exec(url.pathname);
    if (virtioFsRoute) {
      if (req.method === 'GET') return send(res, await virtioFsShares.view(virtioFsRoute[1]));
      if (req.method === 'POST')
        return send(res, await virtioFsShares.action(virtioFsRoute[1], await authorizedBody(req, 4096)));
      throw new AppError('不支持此方法', 405);
    }
    const trustedBootRoute = /^\/api\/vms\/([a-f0-9-]{36})\/trusted-boot$/.exec(url.pathname);
    if (trustedBootRoute) {
      if (req.method === 'GET') return send(res, await trustedBoot.view(trustedBootRoute[1]));
      if (req.method === 'POST')
        return send(res, await trustedBoot.action(trustedBootRoute[1], await authorizedBody(req, 4096)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/host-peers') {
      if (req.method === 'GET') return send(res, { ...hostPeers.view(), local: await hostPeers.status() });
      if (req.method === 'POST')
        return send(res, await hostPeers.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/cold-migrations') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, coldMigrations?.view() || { enabled: false, entries: [] });
    }
    if (url.pathname === '/api/snapshot-replications') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, snapshotReplications?.view() || { enabled: false, entries: [] });
    }
    if (url.pathname === '/api/native-clipboard') {
      if (req.method === 'GET') return send(res, nativeClipboard.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      return send(res, await nativeClipboard.action(await authorizedBody(req, 32768)));
    }
    if (url.pathname === '/api/native-integration') {
      if (req.method === 'GET') return send(res, await native.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await native.action(await authorizedBody(req, 32768)));
      } finally {
        releaseMutation();
      }
    }
    if (url.pathname === '/api/assistant') {
      if (req.method === 'GET') return send(res, assistant.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const abort = new AbortController();
      const cancel = () => {
        if (!res.writableFinished) abort.abort();
      };
      req.once('aborted', cancel);
      res.once('close', cancel);
      if (req.aborted || res.destroyed) cancel();
      try {
        const input = assistantRequest.parse(await authorizedBody(req, 128 * 1024, abort.signal));
        if (input.action === 'configure') {
          const releaseMutation = features.operations.enter();
          try {
            if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
            return send(res, await assistant.configure(input.version, input.settings));
          } finally {
            releaseMutation();
          }
        }
        if (input.action === 'preview') return send(res, assistant.preview(input.input));
        return send(
          res,
          input.action === 'models'
            ? await assistant.models(abort.signal)
            : await assistant.generate(input.previewId, abort.signal),
        );
      } finally {
        req.off('aborted', cancel);
        res.off('close', cancel);
      }
    }
    const route = url.pathname.split('/').filter(Boolean);
    if (route[1] === 'vms' && route[2] && route[3] === 'lockdown' && route.length === 4) {
      machines.get(route[2]);
      if (req.method === 'GET') return send(res, { locked: machines.incidentLocked(route[2]) });
      if (req.method === 'POST') {
        const input = z
          .object({ locked: z.boolean() })
          .strict()
          .parse(await authorizedBody(req));
        return send(res, await machines.setIncidentLockdown(route[2], input.locked));
      }
      throw new AppError('不支持此方法', 405);
    }
    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      route[1] === 'vms' &&
      route[2] &&
      route[3] !== 'stop' &&
      route[3] !== 'next-features'
    )
      machines.requireUnlocked(route[2]);
    if (url.pathname === '/api/plugins') {
      if (req.method === 'GET') return send(res, plugins.view());
      if (req.method === 'PATCH') {
        const releaseMutation = features.operations.enter();
        try {
          const input = await authorizedBody(req);
          if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
          return send(res, await plugins.change(input));
        } finally {
          releaseMutation();
        }
      }
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/community-plugins') {
      if (principal.role !== 'owner') throw new AppError('只有管理员可管理第三方插件', 403);
      if (req.method === 'GET') return send(res, plugins.community.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await plugins.community.action(await authorizedBody(req, 64 * 1024)));
      } finally {
        releaseMutation();
      }
    }
    if (route[1] === 'community-plugins' && route[2] === 'extensions' && route.length === 5) {
      if (principal.role !== 'owner') throw new AppError('只有管理员可调用第三方插件', 403);
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const releaseMutation = features.operations.enter();
      try {
        return send(
          res,
          await plugins.community.invokeRoute(route[3], route[4], await authorizedBody(req, 32 * 1024)),
        );
      } finally {
        releaseMutation();
      }
    }
    if (
      await features.route(req, res, url, (request, signal, limit) => authorizedBody(request, limit, signal))
    )
      return;
    if (await machineApi(req, res, url)) return;
    throw new AppError('接口不存在', 404);
  };

  const guestApi = async (req: IncomingMessage, res: ServerResponse) => {
    if (
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') ||
      ![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host || '') ||
      req.headers.origin || req.headers['sec-fetch-site']
    ) throw new AppError('仅接受本机客户机连接', 403);
    const input = guestInteropRequest.parse(await body(req, 4096));
    return send(res, await processInterop.guest(input, Array.isArray(req.headers['x-sakura-guest-token'])
      ? undefined : req.headers['x-sakura-guest-token']));
  };
  const implementedHandlers = coreHttpHandlers(api, guestApi, extensionApi);
  // Disabled plugins are inspected without activation; publication still requires a real implementation.
  for (const plugin of PLUGINS) {
    const module = await loaders[plugin.id]();
    for (const id of [...Object.keys(module.httpHandlers || {}), ...Object.keys(module.operations || {})])
      implementedHandlers[plugin.id + '.' + id] = api;
  }
  for (const [id, handler] of Object.entries(implementedHandlers)) {
    const entry = operationEntries.find(candidate => candidate.declaration.id === id);
    if (!entry) throw new Error('处理器缺少操作声明，禁止发布：' + id);
    gateway.register(entry, (req, res, url) => audit.span(
      { kind: 'request', name: entry.declaration.id, operationId: entry.declaration.id },
      async () => handler(req, res, url, entry), () => res.statusCode));
  }
  gateway.seal();
  const dispatchApi = (req: IncomingMessage, res: ServerResponse, url: URL) =>
    gateway.dispatch(req, res, url);
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/api/guest/interop')
        return await dispatchApi(req, res, new URL(req.url, `http://localhost:${PORT}`));
      if (req.url?.startsWith('/api/extension/')) {
        const extensionUrl = requestUrl(req.url, PORT);
        if (
          extensionUrl &&
          ['/api/extension/connect', '/api/extension/inventory'].includes(extensionUrl.pathname)
        )
          return await audit.span(
            { kind: 'request', name: (req.method + ' ' + extensionUrl.pathname).slice(0, 200) },
            () => dispatchApi(req, res, extensionUrl),
            () => res.statusCode,
          );
      }
      const url = requestUrl(req.url, PORT);
      if (!url) throw new AppError('无效的请求地址', 400);
      const ssoCallback =
        (req.url?.startsWith('/api/access/sso/oidc/callback?') &&
          url.pathname === '/api/access/sso/oidc/callback' &&
          req.method === 'GET') ||
        (req.url === '/api/access/sso/saml/callback' && req.method === 'POST');
      if (!allowedRequest(req) && !(ssoCallback && req.headers.host === `localhost:${PORT}`))
        throw new AppError('仅接受本机同源访问', 403);
      if (url.pathname.startsWith('/api/')) {
        if (
          (url.pathname === '/api/access/login' ||
            url.pathname === '/api/access/handoff/redeem' ||
            url.pathname === '/api/access/passkeys/login/verify' ||
            url.pathname === '/api/session/unlock/passkey/verify') &&
          req.method === 'POST'
        )
          return await audit.span(
            { kind: 'request', name: 'POST ' + url.pathname },
            () => dispatchApi(req, res, url),
            () => res.statusCode,
          );
        let actorId: string | undefined;
        if (access.enabled) {
          try {
            actorId = access.authorize(req.headers['x-sakura-token']).id;
          } catch {}
        }
        if (
          !['GET', 'HEAD'].includes(req.method || '') &&
          (actorId || (!access.enabled && equalToken(req.headers['x-sakura-token'])))
        ) {
          const vmId = /^\/api\/vms\/([a-f0-9-]{36})(?:\/|$)/.exec(url.pathname)?.[1];
          return await audit.span(
            {
              kind: 'request',
              name: (req.method + ' ' + url.pathname).slice(0, 200),
              ...(vmId && z.uuid().safeParse(vmId).success ? { vmId } : {}),
              ...(actorId ? { actorId } : {}),
            },
            () => dispatchApi(req, res, url),
            () => res.statusCode,
          );
        }
        return await dispatchApi(req, res, url);
      }
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
        '.png': 'image/png',
        '.webmanifest': 'application/manifest+json',
      };
      res.writeHead(200, {
        'Content-Type': mime[extname(candidate)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control':
          candidate.endsWith('.html') || candidate.endsWith('sw.js') || candidate.endsWith('.webmanifest')
            ? 'no-cache'
            : 'public, max-age=3600',
        'Content-Security-Policy':
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data: blob:; media-src 'self' blob:; object-src blob:; frame-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'",
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error: any) {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.end();
        return;
      }
      const message =
        error instanceof ZodError
          ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')
          : error.message;
      const status = error instanceof ZodError ? 400 : error.status || 500;
      const code =
        error instanceof ZodError
          ? 'INVALID_INPUT'
          : error.code ||
            (
              {
                400: 'INVALID_INPUT',
                401: 'UNAUTHORIZED',
                403: 'FORBIDDEN',
                404: 'NOT_FOUND',
                405: 'METHOD_NOT_ALLOWED',
                409: 'CONFLICT',
                413: 'PAYLOAD_TOO_LARGE',
                415: 'UNSUPPORTED_MEDIA_TYPE',
                503: 'UNAVAILABLE',
              } as Record<number, string>
            )[status] ||
            'INTERNAL_ERROR';
      send(
        res,
        { error: message || '操作失败', code, ...(status === 423 ? { session: session.view() } : {}) },
        status,
      );
    }
  });

  resources.defer(
    'http',
    () => {
      server.close();
    },
    0,
  );
  attachApplicationWebSocket({
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
  });
  if (dev) {
    const { createServer } = await import('vite');
    vite = resources.own(
      'vite',
      await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' }),
      410,
    );
  }
  services.acceptRequests();
  await listenHttpServer(server, PORT, '127.0.0.1');
}
