import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { totalmem, freemem, cpus, hostname, platform, arch, loadavg } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { z, ZodError } from 'zod';
import { ROOT, PORT, IMAGE, AppError } from './model.ts';
import { createRuntime } from './runtime.ts';
import { Machines } from './machines.ts';
import { sameOrigin, tokenMatches } from './security.ts';
import { Features } from './features.ts';
import { PluginManager } from './plugin-manager.ts';
import { routeContribution, validateRegistry } from './plugins/registry.ts';
import { readJsonBody as body, requestUrl } from './http.ts';
import type { ClientChannel } from 'ssh2';
import { hostAudit } from './audit.ts';
import { RemoteAuditLock, remoteAuditAction } from './remote-audit.ts';
import { Jobs } from './jobs.ts';
import { monitorSnapshot } from './monitor.ts';
import { apiDocument } from './openapi.ts';
import { generateSdk } from './sdk.ts';
import { LogRetention, logRetentionRequest } from './log-retention.ts';
import { GraphApi, graphqlInfo, graphqlLimits, querySnapshot } from './graphql-api.ts';
import { SessionLock } from './session-lock.ts';
import { Webhooks, collectWebhookEvents } from './webhooks.ts';
import { AutomationRules } from './automation-rules.ts';
import { runEngineeringOperation } from './engineering-runner.ts';
import { Workspaces, projectSchema } from './workspaces.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { ProjectExecution, guestExecutionInput } from './project-execution.ts';
import { projectIdSchema } from './project-catalog.ts';
import { FeatureRollouts } from './feature-rollouts.ts';
import { FleetPolicyRollouts } from './fleet-policy-rollouts.ts';
import { UsbHotplug } from './usb-hotplug.ts';
import { GpuProfiles } from './gpu-profiles.ts';
import { BuildFarm } from './build-farm.ts';
import { MediaDevices } from './media-devices.ts';
import { MemoryReclaim } from './memory-reclaim.ts';
import { HostMounts } from './host-mount.ts';
import { VirtioFsShares } from './virtio-fs.ts';
import { TrustedBootService } from './trusted-boot-service.ts';
import { HostPeers } from './host-peers.ts';
import { createHostImportReceiver } from './host-import-receiver.ts';
import { LiveMigrationReceiver } from './live-migration-receiver.ts';
import { ColdMigrations } from './cold-migration.ts';
import { SnapshotReplications } from './snapshot-replications.ts';
import { HaLocalFailovers } from './ha-local-failovers.ts';
import { HaHostFailover } from './ha-host-failover.ts';
import { HaWitnessClient } from './ha-witness-client.ts';
import { NotebookEnvironments } from './notebook-environments.ts';
import { BrowserIde } from './browser-ide.ts';
import { storagePoolInput } from './storage-pools.ts';
import { DisasterRecoveryDrill } from './disaster-recovery-drill.ts';
import { LocalAssistant, assistantRequest } from './local-assistant.ts';
import { NativeIntegration, nativeMappings } from './native-integration.ts';
import { NativeClipboard } from './native-clipboard.ts';
import { AccessControl, accessHandoffInput, accessPasswordInput } from './access-control.ts';
import { Passkeys, passkeyRemove } from './passkeys.ts';
import { SingleSignOn, ssoCallbackPage, type SsoProvider } from './sso.ts';
import { TerminalSharing, terminalShareInput } from './terminal-sharing.ts';
import { JitPrivileges } from './jit-privileges.ts';
import { ProjectPermissions, type ProjectPermission } from './project-permissions.ts';
import { PolicyBundles, policyBundlePreview, policyBundleTarget } from './policy-bundles.ts';
import { ChangeApprovals } from './change-approvals.ts';
import { BrowserExtensions, extensionOrigin } from './browser-extensions.ts';
import { MobileCompanion } from './mobile-companion.ts';
import { CommunityPlugins } from './community-plugins.ts';
import { ProcessInterop, guestInteropRequest } from './process-interop.ts';

const memberProjectRoutes: Record<string, Partial<Record<'GET' | 'PUT' | 'POST', ProjectPermission>>> = {
  project: { GET: 'read', PUT: 'write', POST: 'execute' },
  'project-runtime': { GET: 'read' },
  'project-files': { GET: 'read' },
  git: { GET: 'read', POST: 'execute' },
  health: { GET: 'read' },
};

async function main() {
  let token = randomBytes(32).toString('hex');
  let sessionChanged = (_locked: boolean, _transitioned: boolean) => {};
  const session = new SessionLock((locked, transitioned) => sessionChanged(locked, transitioned));
  await session.init();
  const access = new AccessControl();
  await access.init();
  const passkeys = new Passkeys(access, PORT);
  const sso = new SingleSignOn(access, PORT);
  await sso.init();
  const dev = process.argv.includes('--dev');
  validateRegistry();
  const plugins = new PluginManager();
  const selectedPlugins = await plugins.init();
  const engine = await createRuntime();
  const machines = new Machines(engine);
  await machines.init();
  const terminalSharing = new TerminalSharing(machines);
  await terminalSharing.init();
  const jitPrivileges = new JitPrivileges(access, machines);
  await jitPrivileges.init();
  const browserExtensions = new BrowserExtensions(access);
  await browserExtensions.init();
  const communityPlugins = new CommunityPlugins();
  await communityPlugins.init();
  const audit = hostAudit();
  const remoteAudit = new RemoteAuditLock(audit);
  await remoteAudit.init();
  Jobs.instrument = (job, work) =>
    audit.span(
      {
        kind: 'job',
        name: (job.scope || 'task') + ':' + (job.action || 'run'),
        vmId: job.vmId,
        projectId: job.projectId,
        jobId: job.id,
      },
      work,
    );
  let features: Features;
  const rollouts = new FeatureRollouts(undefined,
    () => !!features?.migration?.blocked,
    (delta) => { if (features) features.mutations += delta; });
  await rollouts.init();
  features = await Features.create(machines, selectedPlugins,
    (id) => rollouts.decision(id).allowed);
  const projectTerminals = new ProjectTerminals(machines, features.workspaces, {
    get secrets() { return features.secrets; }, get network() { return features.network; },
  });
  const projectExecution = new ProjectExecution(machines, projectTerminals);
  terminalSharing.useProjectTerminals(projectTerminals);
  features.next?.setCommunityPlugins(communityPlugins);
  features.next?.setSnapshotMerge(features.serviceValue('snapshotMerge') as
    import('./snapshot-merge.ts').SnapshotMerge | undefined);
  const usbHotplug = new UsbHotplug(machines, undefined,
    () => !!features.migration?.blocked,
    (delta) => { features.mutations += delta; });
  await usbHotplug.init();
  const mediaDevices = new MediaDevices(machines, usbHotplug,
    () => !!features.migration?.blocked,
    (delta) => { features.mutations += delta; });
  features.next?.setMediaDevices(mediaDevices);
  features.suite?.setMediaDevices(mediaDevices);
  const memoryReclaim = new MemoryReclaim(machines, undefined,
    () => !!features.migration?.blocked,
    (delta) => { features.mutations += delta; });
  await memoryReclaim.init();
  const hostMounts = new HostMounts(machines,
    () => !!features.migration?.blocked,
    (delta) => { features.mutations += delta; });
  await hostMounts.init();
  features.next?.setHostMounts(hostMounts);
  features.suite?.setHostMounts(hostMounts);
  const virtioFsShares = new VirtioFsShares(machines,
    () => !!features.migration?.blocked,
    (delta) => { features.mutations += delta; });
  await virtioFsShares.init();
  features.next?.setVirtioFsShares(virtioFsShares);
  const trustedBoot = new TrustedBootService(machines,
    () => !!features.migration?.blocked,
    (delta) => { features.mutations += delta; });
  await trustedBoot.init();
  features.bundles?.setTrustedBoot(trustedBoot);
  features.extended?.setTrustedBoot(trustedBoot);
  const gpuProfiles = new GpuProfiles(machines, undefined,
    () => !!features.migration?.blocked,
    (delta) => { features.mutations += delta; });
  await gpuProfiles.init();
  const buildFarm = new BuildFarm(machines, undefined,
    () => !!features.migration?.blocked,
    (delta) => { features.mutations += delta; }, undefined, projectTerminals);
  await buildFarm.init();
  features.extraJobStores.push(buildFarm.jobs);
  remoteAudit.setBackgroundAllowed(() => !features.migration?.blocked &&
    !session.view().locked);
  const projectPermissions = new ProjectPermissions(access, machines, features.workspaces);
  await projectPermissions.init();
  const policyBundles = new PolicyBundles(projectPermissions);
  await policyBundles.init();
  const changeApprovals = features.workspaces
    ? new ChangeApprovals(projectPermissions, features.workspaces) : undefined;
  await changeApprovals?.init();
  features.next?.setAcmeMutationCounter((delta) => { features.mutations += delta; });
  features.next?.setAcmeAllowed(() => !session.view().locked && !features.migration?.blocked);
  const processInterop = new ProcessInterop(machines, PORT, () => {
    session.requireUnlocked();
    if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
  });
  features.next?.setProcessInterop(processInterop);
  features.suite?.setProcessInterop(processInterop);
  const hostPeers = new HostPeers(async () => {
    const vms = await machines.list();
    return { platform: platform(), arch: arch(), cpus: Math.max(1, cpus().length),
      memoryTotal: totalmem(), memoryFree: freemem(), load: loadavg().map((value) => Math.max(0, value)),
      vmCount: vms.length, runningVms: vms.filter((vm) => vm.status === 'running').length };
  }, undefined, hostname().slice(0, 128),
  () => !!features.migration?.blocked,
  (delta) => { features.mutations += delta; });
  await hostPeers.init();
  const mobileCompanion = new MobileCompanion(access, async () => {
    const vms = await machines.list();
    return { vms: vms.map(({ id, name, status }) => ({ id, name, status })),
      alerts: await features.suite?.alertEvents() || [] };
  }, () => {
    session.requireUnlocked();
    if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
  }, undefined, undefined, (delta) => { features.mutations += delta; });
  await mobileCompanion.init();
  hostPeers.setMobileHandler((request, response) => mobileCompanion.handle(request, response));
  features.next?.setMobileCheck(() => ({ ready: access.enabled &&
    hostPeers.view().listener.active && hostPeers.view().listener.host === '0.0.0.0',
    devices: access.enabled ? mobileCompanion.view(access.users()
      .find((item) => item.role === 'owner')!.id).devices.length : 0,
    reason: !access.enabled ? '请先启用账户模式。' :
      !hostPeers.view().listener.active || hostPeers.view().listener.host !== '0.0.0.0'
        ? '请启用局域网 HTTPS 同伴入口并重启服务。' : undefined }));
  hostPeers.setRolloutReceiver({
    view: () => ({ hostId: hostPeers.view().hostId, policies: rollouts.view().policies }),
    save: (input) => rollouts.configure(input),
  });
  const liveMigrationReceiver = new LiveMigrationReceiver(machines, hostPeers, () => {
    session.requireUnlocked();
    if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
    if (!features.next) throw new AppError('请先启用扩展功能插件', 503);
  });
  hostPeers.setLiveMigrationReceiver({
    prepare: (input) => liveMigrationReceiver.prepare(input),
    complete: (input) => liveMigrationReceiver.complete(input),
    abort: (input) => liveMigrationReceiver.abort(input),
    status: (input) => Promise.resolve(liveMigrationReceiver.status(input)),
  });
  const fleetRollouts = new FleetPolicyRollouts(hostPeers, undefined,
    () => !!features.migration?.blocked,
    (delta) => { features.mutations += delta; });
  await fleetRollouts.init();
  features.next?.setResourceScheduler((input) => hostPeers.score(input));
  features.next?.setHostPeers(hostPeers);
  features.next?.setSharedDesktopCheck(async (id) => {
    if (!access.enabled) return { ready: false, reason: '请先启用账户模式。' };
    if (!features.socketEnabled('desktop'))
      return { ready: false, reason: '请先启用桌面插件并重启 Sakura。' };
    try {
      const desktop = await features.desktops.view(id, true);
      return desktop.status === 'ready' ? { ready: true }
        : { ready: false, reason: '实例桌面尚未就绪。' };
    } catch (error) { return { ready: false, reason: (error as Error).message }; }
  });
  features.next?.setPasskeyCheck(() => ({ ready: access.enabled,
    registered: access.users().reduce((count, user) => count + access.passkeysFor(user.id).length, 0),
    ...(!access.enabled ? { reason: '请先启用账户模式。' } : {}) }));
  features.next?.setAccountModeReady(() => access.enabled);
  features.next?.setRemoteAuditCheck(async () => {
    const status = await remoteAudit.status();
    return { ready: Boolean(status.target && status.last && status.local.valid &&
      status.protected && status.lastVerifiedAt &&
      Date.now() - Date.parse(status.lastVerifiedAt) < 2 * 3_600_000 &&
      !status.lastError), configured: Boolean(status.target),
      anchoredSequence: status.last?.sequence || 0,
      reason: !status.target ? '请在系统设置中配置启用对象锁的远程审计桶。' :
        status.lastError || (!status.last ? '配置后请同步首个审计锚点。' : undefined) };
  });
  features.next?.setSharedTerminalCheck(async (id) => {
    if (!access.enabled) return { ready: false, reason: '请先启用账户模式。' };
    if (!features.socketEnabled('terminal-session'))
      return { ready: false, reason: '请先启用可恢复终端会话插件并重启 Sakura。' };
    if (machines.state(id) !== 'running')
      return { ready: false, reason: '请先启动实例。' };
    try {
      const result = await machines.exec(id, 'command -v tmux >/dev/null', 10000);
      return result.code === 0 ? { ready: true }
        : { ready: false, reason: '请先在客户机安装 tmux。' };
    } catch (error) { return { ready: false, reason: (error as Error).message }; }
  });
  hostPeers.setImportReceiver(createHostImportReceiver(machines, {
    bundles: () => features.bundles,
    requireSessionUnlocked: () => session.requireUnlocked(),
    migrationBlocked: () => !!features.migration?.blocked,
  }));
  let coldMigrations: ColdMigrations | undefined;
  let snapshotReplications: SnapshotReplications | undefined;
  let haLocalFailovers: HaLocalFailovers | undefined;
  let haHostFailover: HaHostFailover | undefined;
  let notebooks: NotebookEnvironments | undefined;
  let browserIde: BrowserIde | undefined;
  if (features.next) {
    notebooks = new NotebookEnvironments(machines, features.workspaces);
    await notebooks.init();
    features.next.setNotebookEnvironments(notebooks);
    browserIde = new BrowserIde(machines, features.workspaces);
    await browserIde.init();
    features.next.setBrowserIde(browserIde);
  }
  if (features.next && features.bundles) {
    coldMigrations = new ColdMigrations(machines, features.bundles, hostPeers);
    await coldMigrations.init();
    features.next.setColdMigrations(coldMigrations);
    snapshotReplications = new SnapshotReplications(machines, features.bundles, hostPeers);
    await snapshotReplications.init();
    features.next.setSnapshotReplications(snapshotReplications);
    const witnessClient = await HaWitnessClient.fromEnv().catch((error) => {
      console.error('HA 见证配置不可用：', (error as Error).message);
      return null;
    });
    haHostFailover = new HaHostFailover(machines, hostPeers,
      snapshotReplications, () => features.next!.haPolicies(), witnessClient);
    machines.setHaStartGuard((id) => haHostFailover!.authorizeStart(id));
    features.next.setHaHostFailover(haHostFailover);
    await haHostFailover.init();
    haLocalFailovers = new HaLocalFailovers(machines, features.next.haFailureMonitor,
      hostPeers, snapshotReplications, () => features.next!.haPolicies(),
      () => !features.migration?.blocked && !machines.closing);
    haLocalFailovers.setWitnessDisarmGuard((id, failureThreshold) =>
      haHostFailover!.disarm(id, failureThreshold));
    features.next.setHaLocalFailovers(haLocalFailovers);
    await haLocalFailovers.init();
  }
  if (features.next && features.backups && features.bundles)
    features.next.setDisasterRecovery(new DisasterRecoveryDrill(
      machines, features.backups, features.bundles));
  const native = new NativeIntegration(
    () => nativeMappings(features),
    undefined,
    undefined,
    undefined,
    undefined,
    (id?: string) => {
      session.requireUnlocked();
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      if (id) {
        machines.get(id);
        machines.requireUnlocked(id);
      }
    },
  );
  await native.init();
  const nativeClipboard = new NativeClipboard({
    guard: () => session.requireUnlocked(),
    maintenance: () => !!features.migration?.blocked,
    mutation: (delta) => { features.mutations += delta; },
  });
  await nativeClipboard.init();
  const assistant = new LocalAssistant();
  await assistant.init();
  const eventSource = async () => collectWebhookEvents(
    machines,
    features.jobStores().flatMap((store) => store.list()),
    (await features.suite?.alertEvents()) || [],
  );
  communityPlugins.setEventSource(eventSource, true,
    () => !!features.migration?.blocked,
    (delta) => { features.mutations += delta; });
  const webhooks = new Webhooks(
    eventSource,
    undefined,
    undefined,
    undefined,
    () => !!features.migration?.blocked,
    (delta) => {
      features.mutations += delta;
    },
  );
  await webhooks.init();
  const automationRules = new AutomationRules(eventSource, machines, undefined, undefined,
    () => !!features.migration?.blocked,
    (delta) => { features.mutations += delta; },
    async (id, steps, projectId, signal) => {
      const own = !features.workspaces;
      const workspaces = features.workspaces || new Workspaces(machines);
      try {
        return await workspaces.projects.with(id, projectId, () =>
          runEngineeringOperation(machines, workspaces, id, 'runbooks', { steps }, signal));
      } finally {
        if (own) await workspaces.close();
      }
    });
  await automationRules.init();
  const retention = new LogRetention(
    () => features.jobStores(),
    undefined,
    () => !!features.migration?.blocked,
    undefined,
    (delta) => {
      features.mutations += delta;
    },
  );
  await retention.init();
  const graph = new GraphApi(async () => querySnapshot(machines, features.jobStores(), features.enabled));
  plugins.activated(features.enabled, features.errors, features.lifecycle);
  const ws = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  sso.setRevocationHandler(() => { for (const client of ws.clients) client.terminate(); });
  const protectedResponses = new Set<ServerResponse>();
  sessionChanged = (locked, transitioned) => {
    if (transitioned) token = randomBytes(32).toString('hex');
    if (locked) {
      access.revokeAll();
      sso.cancelPending();
      native.revoke();
      assistant.revoke();
      for (const client of ws.clients) client.terminate();
      for (const response of protectedResponses) response.destroy();
    }
    machines.emit('change');
  };
  const socketVms = new WeakMap<WebSocket, string>();
  const socketAccounts = new WeakMap<WebSocket, string>();
  const socketCredentials = new WeakMap<WebSocket, string>();
  const socketTerminalGrants = new WeakMap<WebSocket, string>();
  const terminateAccountSockets = (id: string) => {
    for (const client of ws.clients) if (socketAccounts.get(client) === id) client.terminate();
  };
  const terminateCredentialSockets = (credential: string) => {
    for (const client of ws.clients)
      if (socketCredentials.get(client) === credential) client.terminate();
  };
  const terminateTerminalGrantSockets = (id: string) => {
    for (const client of ws.clients)
      if (socketTerminalGrants.get(client) === id) client.terminate();
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
    if (!access.enabled) return tokenMatches(value, token);
    try { return access.authorize(value).role === 'owner'; } catch { return false; }
  };
  const socketAuthorization = (credential: string, mode: string, id: string,
    terminalSession?: string | null, terminalProject?: string | null) => {
    if (!access.enabled) return equalToken(credential) ? { role: 'owner' as const } : null;
    try {
      const principal = access.authorize(credential);
      return (principal.role === 'owner' && mode !== 'terminal-view') ||
        (principal.role === 'viewer' && principal.vmIds.includes(id) &&
          (mode === 'desktop-view' || (mode === 'terminal-view' && !!terminalSession &&
            !!terminalSharing.find(principal.id, id, terminalSession, terminalProject))))
        ? principal : null;
    } catch { return null; }
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
  function send(res: ServerResponse, data: unknown, status = 200) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  }
  const sendSsoPage = (res: ServerResponse, origin: string | null, state: string,
    result?: unknown, error?: string) => {
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
      origin = extensionOrigin(req.headers.origin ||
        (req.method === 'GET' ? req.headers['x-sakura-extension-origin'] : undefined));
      if (req.method !== 'OPTIONS' && req.headers['x-sakura-extension-origin'] !== origin)
        throw new Error('扩展来源不一致');
    }
    catch { throw new AppError('需要有效的浏览器扩展来源', 403); }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin, X-Sakura-Extension-Origin');
    res.setHeader('Access-Control-Allow-Headers',
      'Content-Type, X-Sakura-Extension-Origin, X-Sakura-Extension-Token');
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
      features.mutations++;
      try { return send(res, await browserExtensions.connect(origin, await body(req, 4096)), 201); }
      finally { features.mutations--; }
    }
    if (url.pathname === '/api/extension/inventory') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      const grant = browserExtensions.authorize(origin, req.headers['x-sakura-extension-token']);
      const vms = await Promise.all([...machines.records.keys()].map((id) => machines.view(id)));
      session.requireUnlocked();
      return send(res, { permissions: grant.permissions, expiresAt: grant.expiresAt,
        checkedAt: new Date().toISOString(),
        vms: vms.map(({ id, name, status, distro, cpus, memoryMiB, diskGiB }) =>
          ({ id, name, status, distro, cpus, memoryMiB, diskGiB })) });
    }
    throw new AppError('接口不存在', 404);
  };
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
      z.object({}).strict().parse(await body(req, 4096));
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
      } catch (error) { access.logout(login.token); throw error; }
    }
    if (url.pathname === '/api/access/sso/oidc/callback' ||
        url.pathname === '/api/access/sso/saml/callback') {
      const providerId: SsoProvider = url.pathname.includes('/oidc/') ? 'oidc' : 'saml';
      if (req.method !== (providerId === 'oidc' ? 'GET' : 'POST'))
        throw new AppError('不支持此方法', 405);
      const post = providerId === 'saml' ? await samlPost(req) : undefined;
      const state = providerId === 'oidc' ? url.searchParams.get('state') || '' : post!.RelayState;
      const origin = sso.pendingOrigin(providerId, state);
      try {
        session.requireUnlocked();
        const completed = providerId === 'oidc'
          ? await sso.completeOidc(new URL(url.search, `http://localhost:${PORT}/api/access/sso/oidc/callback`))
          : await sso.completeSaml(post!);
        try { session.requireUnlocked(); }
        catch (error) {
          if ('token' in completed.result) access.logout(completed.result.token);
          throw error;
        }
        return sendSsoPage(res, completed.origin, completed.state, completed.result);
      } catch (error) {
        return sendSsoPage(res, origin, state, undefined,
          error instanceof Error ? error.message : '单点登录失败');
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
      const started = await sso.begin(input,
        typeof credential === 'string' ? credential : undefined);
      try { session.requireUnlocked(); }
      catch (error) { sso.cancelPending(); throw error; }
      return send(res, started);
    }
    if (url.pathname === '/api/access/login') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const login = await access.login(await body(req, 4096));
      try { session.requireUnlocked(); }
      catch (error) { access.logout(login.token); throw error; }
      return send(res, login);
    }
    if (url.pathname === '/api/access/handoff/redeem') {
      if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
      const { sourceToken, ...login } = await access.redeemHandoff(await body(req, 4096));
      try { session.requireUnlocked(); }
      catch (error) { access.logout(login.token); throw error; }
      terminateCredentialSockets(sourceToken);
      return send(res, login);
    }
    if (url.pathname === '/api/access/passkeys/login/options') {
      if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
      requirePasskeyOrigin(req);
      z.object({}).strict().parse(await body(req, 4096));
      return send(res, await passkeys.beginAuthentication());
    }
    if (url.pathname === '/api/access/passkeys/login/verify') {
      if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
      requirePasskeyOrigin(req);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const login = await passkeys.finishAuthentication(await body(req, 65536));
      try { session.requireUnlocked(); }
      catch (error) { access.logout(login.token); throw error; }
      return send(res, login);
    }
    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
      if (access.enabled) throw new AppError('请登录账户后访问 Sakura', 401);
      return send(res, { token, session: session.view() });
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
    if (url.pathname === '/api/access/sso') {
      if (req.method !== 'GET' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      return send(res, sso.view(accountPrincipal.role === 'owner' ? undefined : accountPrincipal.id));
    }
    if (url.pathname === '/api/access/sso/oidc' ||
        url.pathname === '/api/access/sso/saml') {
      if (accountPrincipal?.role !== 'owner') throw new AppError('仅管理员可配置单点登录', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const providerId: SsoProvider = url.pathname.endsWith('oidc') ? 'oidc' : 'saml';
      if (req.method === 'DELETE') return send(res, await sso.disable(providerId));
      if (req.method !== 'PUT') throw new AppError('不支持此方法', 405);
      const input = await authorizedBody(req, providerId === 'saml' ? 700_000 : 8192);
      return send(res, providerId === 'oidc'
        ? await sso.configureOidc(input) : await sso.configureSaml(input));
    }
    if (/^\/api\/access\/sso\/link\/(oidc|saml)$/.test(url.pathname)) {
      if (req.method !== 'DELETE' || !accountPrincipal)
        throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await sso.unlink(accountPrincipal.id,
        url.pathname.split('/').at(-1) as SsoProvider));
    }
    const passkeyManagementRoute = [
      '/api/access/passkeys', '/api/access/passkeys/register/options',
      '/api/access/passkeys/register/verify',
    ].includes(url.pathname) || /^\/api\/access\/passkeys\/[A-Za-z0-9_-]{16,1024}$/.test(url.pathname);
    const terminalShareRoute = url.pathname === '/api/access/terminal-shares' ||
      /^\/api\/access\/terminal-shares\/[a-f0-9-]{36}$/.test(url.pathname);
    const jitRoute = url.pathname === '/api/access/jit' ||
      /^\/api\/access\/jit\/[a-f0-9-]{36}\/(decision|execute)$/.test(url.pathname);
    const changeRoute = url.pathname === '/api/access/changes' ||
      /^\/api\/access\/changes\/[a-f0-9-]{36}\/(decision|apply)$/.test(url.pathname);
    const memberProjectMatch = /^\/api\/vms\/([a-f0-9-]{36})\/(project|project-runtime|project-files|git|health)$/.exec(url.pathname);
    const memberProjectPermission = memberProjectMatch &&
      memberProjectRoutes[memberProjectMatch[2]]?.[req.method as 'GET' | 'PUT' | 'POST'];
    const memberProjectRoute = !!memberProjectPermission &&
      routeContribution(url.pathname)?.projectScoped === true;
    if (access.enabled && principal.role === 'viewer' &&
        url.pathname !== '/api/access/view' && url.pathname !== '/api/access/logout' &&
        url.pathname !== '/api/access/handoff' && !passkeyManagementRoute &&
        !terminalShareRoute && !jitRoute)
      throw new AppError('只读账户没有此接口的访问权限', 403);
    if (access.enabled && principal.role === 'member' &&
        url.pathname !== '/api/access/logout' &&
        url.pathname !== '/api/access/handoff' &&
        url.pathname !== '/api/access/projects' && !passkeyManagementRoute &&
        !memberProjectRoute && !changeRoute)
      throw new AppError('项目成员没有此接口的访问权限', 403);
    if (accountPrincipal?.role === 'member' && memberProjectRoute) {
      if (!features.enabled.has('projects')) throw new AppError('项目工作区插件未启用', 403);
      const vmId = memberProjectMatch![1];
      const projectId = url.searchParams.get('project');
      if (!projectId) throw new AppError('项目成员请求必须指定项目 ID', 400);
      await projectPermissions.require(accountPrincipal, vmId, projectId, memberProjectPermission!);
      if (req.method === 'PUT' && memberProjectMatch![2] === 'project') {
        if (projectPermissions.requiresApproval(vmId, projectId))
          throw new AppError('此项目的配置变更需要第二位账户审批', 409);
        const proposal = projectSchema.parse(await authorizedBody(req, 32768));
        return features.workspaces.projects.with(vmId, projectId, async () => {
          const previous = await features.workspaces.config(vmId);
          return send(res, await features.workspaces.save(vmId, proposal, previous.directory));
        });
      }
    }
    if (accountPrincipal?.role === 'owner' && req.method === 'PUT' &&
        memberProjectMatch?.[2] === 'project' && features.workspaces) {
      const vmId = memberProjectMatch[1];
      const projectId = url.searchParams.get('project') ||
        (await features.workspaces.projects.list(vmId)).active;
      if (projectPermissions.requiresApproval(vmId, projectId))
        throw new AppError('此项目的配置变更需要第二位账户审批', 409);
    }
    if (url.pathname === '/api/access/projects') {
      if (req.method !== 'GET' || accountPrincipal?.role !== 'member')
        throw new AppError('只有项目成员可查看授权项目', 403);
      return send(res, { projects: await projectPermissions.accessible(accountPrincipal) });
    }
    if (url.pathname === '/api/access/changes') {
      if (!accountPrincipal || !changeApprovals)
        throw new AppError('请先启用账户模式与项目工作区插件', 409);
      if (req.method === 'GET')
        return send(res, { changes: await changeApprovals.list(accountPrincipal) });
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await changeApprovals.create(accountPrincipal,
        await authorizedBody(req, 65536)), 201);
    }
    if (/^\/api\/access\/changes\/[a-f0-9-]{36}\/decision$/.test(url.pathname)) {
      if (req.method !== 'POST' || !accountPrincipal || !changeApprovals)
        throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await changeApprovals.decide(accountPrincipal,
        url.pathname.split('/')[4], await authorizedBody(req, 4096)));
    }
    if (/^\/api\/access\/changes\/[a-f0-9-]{36}\/apply$/.test(url.pathname)) {
      if (req.method !== 'POST' || !accountPrincipal || !changeApprovals)
        throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      z.object({}).strict().parse(await authorizedBody(req, 4096));
      features.mutations++;
      try { return send(res, await changeApprovals.apply(accountPrincipal,
        url.pathname.split('/')[4])); }
      finally { features.mutations--; }
    }
    if (url.pathname === '/api/access/view') {
      if (req.method !== 'GET' || !access.enabled) throw new AppError('不支持此方法', 405);
      const ids = principal.role === 'viewer' ? principal.vmIds : [...machines.records.keys()];
      const vms = await Promise.all(ids.filter((id) => machines.records.has(id)).map((id) => machines.view(id)));
      return send(res, { role: principal.role, checkedAt: new Date().toISOString(),
        desktopAvailable: features.socketEnabled('desktop'),
        vms: vms.map(({ id, name, status, distro, cpus, memoryMiB, diskGiB }) =>
          ({ id, name, status, distro, cpus, memoryMiB, diskGiB })) });
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
      if (req.method === 'DELETE')
        return send(res, access.cancelHandoff(req.headers['x-sakura-token']));
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
        return send(res, { grants: terminalSharing.list(
          accountPrincipal.role === 'viewer' ? accountPrincipal.id : undefined,
          vmId || undefined, projectId || undefined) });
      }
      if (req.method !== 'POST' || accountPrincipal.role !== 'owner')
        throw new AppError('只有管理员可共享终端', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      if (!features.socketEnabled('terminal-session'))
        throw new AppError('请先启用可恢复终端会话插件', 409);
      const input = terminalShareInput.parse(await authorizedBody(req, 4096));
      machines.requireUnlocked(input.vmId);
      const viewer = access.users().find((user) => user.id === input.viewerId &&
        user.role === 'viewer' && user.vmIds.includes(input.vmId) &&
        (user.expiresAt === null || user.expiresAt > Date.now()));
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
      return send(res, await jitPrivileges.create(accountPrincipal,
        await authorizedBody(req, 4096)), 201);
    }
    if (url.pathname === '/api/browser-extensions') {
      if (accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可管理浏览器扩展', 403);
      if (req.method === 'GET')
        return send(res, { connections: browserExtensions.list(accountPrincipal.id) });
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      z.object({}).strict().parse(await authorizedBody(req, 4096));
      return send(res, browserExtensions.createPairing(accountPrincipal.id), 201);
    }
    if (url.pathname === '/api/mobile-companion') {
      if (accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可管理移动伴侣', 403);
      if (req.method === 'GET')
        return send(res, { ...mobileCompanion.view(accountPrincipal.id),
          listener: hostPeers.view().listener,
          fingerprint: hostPeers.view().fingerprint });
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      features.mutations++;
      try { return send(res, await mobileCompanion.action(accountPrincipal.id,
        await authorizedBody(req, 4096))); }
      finally { features.mutations--; }
    }
    if (/^\/api\/browser-extensions\/[a-f0-9-]{36}$/.test(url.pathname)) {
      if (req.method !== 'DELETE' || accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可撤销浏览器扩展', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      features.mutations++;
      try { return send(res, await browserExtensions.revoke(accountPrincipal.id,
        url.pathname.split('/')[3])); }
      finally { features.mutations--; }
    }
    if (/^\/api\/access\/jit\/[a-f0-9-]{36}\/decision$/.test(url.pathname)) {
      if (req.method !== 'POST' || accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可审批临时授权', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await jitPrivileges.decide(accountPrincipal,
        url.pathname.split('/')[4], await authorizedBody(req, 4096)));
    }
    if (/^\/api\/access\/jit\/[a-f0-9-]{36}\/execute$/.test(url.pathname)) {
      if (req.method !== 'POST' || accountPrincipal?.role !== 'viewer')
        throw new AppError('只有申请账户可执行临时授权', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      z.object({}).strict().parse(await authorizedBody(req, 4096));
      features.mutations++;
      try {
        return send(res, await jitPrivileges.execute(accountPrincipal, url.pathname.split('/')[4]));
      } finally { features.mutations--; }
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
      return send(res, await passkeys.finishRegistration(accountPrincipal,
        await authorizedBody(req, 65536)), 201);
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
      token = randomBytes(32).toString('hex');
      for (const client of ws.clients) client.terminate();
      return send(res, result);
    }
    if (url.pathname === '/api/access/users') {
      if (!access.enabled) throw new AppError('账户模式未启用', 409);
      if (req.method === 'GET') return send(res, { users: access.users() });
      if (req.method === 'POST') {
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        const input = await authorizedBody(req, 4096);
        const vmIds = z.array(z.uuid()).min(1).max(32).parse((input as { vmIds?: unknown }).vmIds);
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
      return send(res, await projectPermissions.configure(vmId, projectId,
        await authorizedBody(req, 32768)));
    }
    if (url.pathname.startsWith('/api/access/policy-bundles/')) {
      if (accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可管理项目策略包', 403);
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
        features.mutations++;
        try { return send(res, await policyBundles.apply(await authorizedBody(req, 65536))); }
        finally { features.mutations--; }
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
      features.mutations++;
      try {
        const input = await authorizedBody(req, 4096);
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        return send(res, await session.configure(input));
      } finally {
        features.mutations--;
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
      const specification = apiDocument(features.enabled, PORT);
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
    if (
      features.migration?.blocked &&
      req.method !== 'GET' &&
      url.pathname !== '/api/migration' &&
      !/^\/api\/jobs\/[^/]+\/cancel$/.test(url.pathname)
    )
      throw new AppError('数据目录迁移维护中，请等待完成并重启服务', 409);
    if (url.pathname === '/api/audit/remote') {
      if (accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可管理远程审计', 403);
      if (req.method === 'GET') return send(res, await remoteAudit.status());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const input = remoteAuditAction.parse(await authorizedBody(req, 8192));
      features.mutations++;
      try {
        return send(res, input.action === 'configure'
          ? await remoteAudit.configure(input.target)
          : input.action === 'disable'
            ? await remoteAudit.disable()
            : input.action === 'verify'
              ? await remoteAudit.verify()
              : await remoteAudit.sync());
      } finally { features.mutations--; }
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
      if (req.method === 'POST') return send(res,
        await automationRules.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/feature-rollouts') {
      if (req.method === 'GET') return send(res, {
        ...rollouts.view(), selected: selectedPlugins, active: [...features.enabled],
      });
      if (req.method === 'POST') return send(res,
        await rollouts.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/fleet-policy-rollouts') {
      if (req.method === 'GET') return send(res, fleetRollouts.view());
      if (req.method === 'POST') return send(res,
        await fleetRollouts.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/gpu-profiles') {
      if (req.method === 'GET') return send(res, await gpuProfiles.view());
      if (req.method === 'POST') return send(res,
        await gpuProfiles.action(await authorizedBody(req, 8192)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/build-farm') {
      if (req.method === 'GET') return send(res, url.searchParams.has('vmId')
        ? await buildFarm.projects(url.searchParams.get('vmId')!) : buildFarm.view());
      if (req.method === 'POST') return send(res,
        await buildFarm.action(await authorizedBody(req, 8192)));
      throw new AppError('不支持此方法', 405);
    }
    const mediaRoute = /^\/api\/vms\/([a-f0-9-]{36})\/media-devices$/.exec(url.pathname);
    if (mediaRoute) {
      if (req.method === 'GET') return send(res, await mediaDevices.view(mediaRoute[1]));
      if (req.method === 'POST') return send(res,
        await mediaDevices.action(mediaRoute[1], await authorizedBody(req, 8192)));
      throw new AppError('不支持此方法', 405);
    }
    const reclaimRoute = /^\/api\/vms\/([a-f0-9-]{36})\/memory-reclaim$/.exec(url.pathname);
    if (reclaimRoute) {
      if (req.method === 'GET') return send(res, await memoryReclaim.view(reclaimRoute[1]));
      if (req.method === 'POST') return send(res,
        await memoryReclaim.action(reclaimRoute[1], await authorizedBody(req, 4096)));
      throw new AppError('不支持此方法', 405);
    }
    const hostMountRoute = /^\/api\/vms\/([a-f0-9-]{36})\/host-mount$/.exec(url.pathname);
    if (hostMountRoute) {
      if (req.method === 'GET') return send(res, await hostMounts.view(hostMountRoute[1]));
      if (req.method === 'POST') return send(res,
        await hostMounts.action(hostMountRoute[1], await authorizedBody(req, 4096)));
      throw new AppError('不支持此方法', 405);
    }
    const virtioFsRoute = /^\/api\/vms\/([a-f0-9-]{36})\/virtio-fs$/.exec(url.pathname);
    if (virtioFsRoute) {
      if (req.method === 'GET') return send(res, await virtioFsShares.view(virtioFsRoute[1]));
      if (req.method === 'POST') return send(res,
        await virtioFsShares.action(virtioFsRoute[1], await authorizedBody(req, 4096)));
      throw new AppError('不支持此方法', 405);
    }
    const trustedBootRoute = /^\/api\/vms\/([a-f0-9-]{36})\/trusted-boot$/.exec(url.pathname);
    if (trustedBootRoute) {
      if (req.method === 'GET') return send(res, await trustedBoot.view(trustedBootRoute[1]));
      if (req.method === 'POST') return send(res,
        await trustedBoot.action(trustedBootRoute[1], await authorizedBody(req, 4096)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/host-peers') {
      if (req.method === 'GET') return send(res,
        { ...hostPeers.view(), local: await hostPeers.status() });
      if (req.method === 'POST') return send(res,
        await hostPeers.configure(await authorizedBody(req, 32768)));
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
      features.mutations++;
      try {
        return send(res, await native.action(await authorizedBody(req, 32768)));
      } finally {
        features.mutations--;
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
          features.mutations++;
          try {
            if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
            return send(res, await assistant.configure(input.version, input.settings));
          } finally {
            features.mutations--;
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
        features.mutations++;
        try {
          const input = await authorizedBody(req);
          if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
          return send(res, await plugins.change(input));
        } finally {
          features.mutations--;
        }
      }
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/community-plugins') {
      if (principal.role !== 'owner')
        throw new AppError('只有管理员可管理第三方插件', 403);
      if (req.method === 'GET') return send(res, communityPlugins.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      features.mutations++;
      try { return send(res, await communityPlugins.action(await authorizedBody(req, 64 * 1024))); }
      finally { features.mutations--; }
    }
    if (route[1] === 'community-plugins' && route[2] === 'extensions' && route.length === 5) {
      if (principal.role !== 'owner') throw new AppError('只有管理员可调用第三方插件', 403);
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      features.mutations++;
      try {
        return send(res, await communityPlugins.invokeRoute(route[3], route[4],
          await authorizedBody(req, 32 * 1024)));
      } finally { features.mutations--; }
    }
    if (await features.route(req, res, url, (request, signal, limit) => authorizedBody(request, limit, signal)))
      return;
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
        plugins: [...features.enabled],
        session: session.view(),
      });
    if (route[1] === 'storage-pools' && route.length === 2) {
      if (req.method === 'GET') return send(res, await machines.storagePools.view());
      if (req.method === 'POST')
        return send(res, await machines.storagePools.run(undefined,
          storagePoolInput.parse(await authorizedBody(req)), 'run'));
    }
    if (route[1] === 'vms' && route.length === 2) {
      if (req.method === 'GET') return send(res, await machines.list());
      if (req.method === 'POST') {
        const input = await authorizedBody(req);
        features.validateConfig(input);
        return send(res, await machines.create(input), 201);
      }
    }
    if (route[1] === 'vms' && route[2]) {
      const id = route[2];
      machines.get(id);
      if (route.length === 4 && route[3] === 'usb-hotplug') {
        if (req.method === 'GET') return send(res, await usbHotplug.view(id));
        if (req.method === 'POST') return send(res,
          await usbHotplug.action(id, await authorizedBody(req, 4096)));
        throw new AppError('不支持此方法', 405);
      }
      if (route.length === 3) {
        if (req.method === 'GET') return send(res, await machines.view(id));
        if (req.method === 'PATCH') {
          const input = await authorizedBody(req);
          features.validateConfig(input, machines.get(id));
          return send(res, await machines.update(id, input));
        }
        if (req.method === 'DELETE') {
          await machines.delete(id);
          await projectPermissions.revokeVm(id);
          return send(res, { ok: true });
        }
      }
      if (req.method === 'POST' && route.length === 4 && route[3] === 'start')
        return send(res, await machines.start(id));
      if (req.method === 'POST' && route.length === 4 && route[3] === 'stop') {
        const options = z
          .object({ force: z.boolean().default(false) })
          .strict()
          .parse(await authorizedBody(req));
        return send(res, await machines.stop(id, options.force));
      }
      if (req.method === 'POST' && route.length === 4 && route[3] === 'exec') {
        const abort = new AbortController();
        const cancel = () => { if (!res.writableFinished) abort.abort(); };
        req.once('aborted', cancel); res.once('close', cancel);
        try {
          const input = guestExecutionInput.parse(await authorizedBody(req, 512 * 1024, abort.signal));
          return send(res, await projectExecution.run(id, input, url.searchParams.get('project'), abort.signal));
        } finally {
          req.off('aborted', cancel); res.off('close', cancel);
        }
      }
      if (req.method === 'GET' && route.length === 4 && route[3] === 'logs')
        return send(res, { content: machines.logs.get(id) || '' });
    }
    throw new AppError('接口不存在', 404);
  };

  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/api/guest/interop') {
        if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') ||
            ![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host || '') ||
            req.headers.origin || req.headers['sec-fetch-site'])
          throw new AppError('仅接受本机客户机连接', 403);
        const input = guestInteropRequest.parse(await body(req, 4096));
        const vmId = input.vmId;
        return await audit.span({ kind: 'request', name: 'POST /api/guest/interop', vmId },
          async () => send(res, await processInterop.guest(input,
            Array.isArray(req.headers['x-sakura-guest-token']) ? undefined :
              req.headers['x-sakura-guest-token'])), () => res.statusCode);
      }
      if (req.url?.startsWith('/api/extension/')) {
        const extensionUrl = requestUrl(req.url, PORT);
        if (extensionUrl && ['/api/extension/connect', '/api/extension/inventory']
          .includes(extensionUrl.pathname))
          return await audit.span({ kind: 'request',
            name: (req.method + ' ' + extensionUrl.pathname).slice(0, 200) },
          () => extensionApi(req, res, extensionUrl), () => res.statusCode);
      }
      const url = requestUrl(req.url, PORT);
      if (!url) throw new AppError('无效的请求地址', 400);
      const ssoCallback = (req.url?.startsWith('/api/access/sso/oidc/callback?') &&
        url.pathname === '/api/access/sso/oidc/callback' && req.method === 'GET') ||
        (req.url === '/api/access/sso/saml/callback' && req.method === 'POST');
      if (!allowedRequest(req) && !(ssoCallback && req.headers.host === `localhost:${PORT}`))
        throw new AppError('仅接受本机同源访问', 403);
      if (url.pathname.startsWith('/api/')) {
        if ((url.pathname === '/api/access/login' ||
            url.pathname === '/api/access/handoff/redeem' ||
            url.pathname === '/api/access/passkeys/login/verify' ||
            url.pathname === '/api/session/unlock/passkey/verify') && req.method === 'POST')
          return await audit.span({ kind: 'request', name: 'POST ' + url.pathname },
            () => api(req, res, url), () => res.statusCode);
        let actorId: string | undefined;
        if (access.enabled) {
          try { actorId = access.authorize(req.headers['x-sakura-token']).id; } catch {}
        }
        if (!['GET', 'HEAD'].includes(req.method || '') &&
            (actorId || (!access.enabled && equalToken(req.headers['x-sakura-token'])))) {
          const vmId = /^\/api\/vms\/([a-f0-9-]{36})(?:\/|$)/.exec(url.pathname)?.[1];
          return await audit.span(
            {
              kind: 'request',
              name: (req.method + ' ' + url.pathname).slice(0, 200),
              ...(vmId && z.uuid().safeParse(vmId).success ? { vmId } : {}),
              ...(actorId ? { actorId } : {}),
            },
            () => api(req, res, url),
            () => res.statusCode,
          );
        }
        return await api(req, res, url);
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
          candidate.endsWith('.html') ||
          candidate.endsWith('sw.js') ||
          candidate.endsWith('.webmanifest')
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

  server.on('upgrade', (req, socket, head) => {
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
    const parts = url.pathname.split('/');
    const id = parts[2];
    const mode = parts[3];
    const terminalSession = url.searchParams.get('session');
    const terminalProject = url.searchParams.get('project');
    const appSession = url.searchParams.get('app');
    const events = url.pathname === '/ws/events';
    const credential = url.searchParams.get('token') || '';
    if (
      !allowedRequest(req) ||
      (!events &&
        (parts.length !== 4 || !machines.records.has(id) ||
          !['terminal', 'terminal-view', 'logs', 'desktop', 'desktop-view'].includes(mode))) ||
      (!events && mode !== 'logs' && machines.incidentLocked(id)) ||
      (mode === 'terminal-view' && (!terminalSession || !/^[a-z0-9-]{1,48}$/.test(terminalSession))) ||
      (terminalSession !== null && (!['terminal', 'terminal-view', 'logs'].includes(mode) ||
        !/^[a-z0-9-]{1,48}$/.test(terminalSession))) ||
      (terminalProject !== null && (!['terminal', 'terminal-view', 'desktop', 'desktop-view'].includes(mode) ||
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
    ws.handleUpgrade(req, socket, head, async (client) => {
      try {
        session.requireUnlocked();
      } catch {
        client.terminate();
        return;
      }
      const principal = socketAuthorization(credential, mode, id, terminalSession, terminalProject);
      if (!principal) { client.terminate(); return; }
      socketCredentials.set(client, credential);
      if ('id' in principal) {
        socketAccounts.set(client, principal.id);
        const timer = setTimeout(() => client.terminate(),
          Math.max(1, principal.expiresAt - Date.now()));
        client.once('close', () => clearTimeout(timer));
      }
      if (mode === 'terminal-view' && 'id' in principal) {
        const grant = terminalSharing.find(principal.id, id, terminalSession!, terminalProject);
        if (!grant) { client.terminate(); return; }
        socketTerminalGrants.set(client, grant.id);
        const timer = setTimeout(() => client.terminate(),
          Math.max(1, grant.expiresAt - Date.now()));
        client.once('close', () => clearTimeout(timer));
      }
      if (!events) socketVms.set(client, id);
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
          await features.desktops.attach(id, client, mode === 'desktop-view', port,
            appSession || undefined, terminalProject);
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
      client.on('close', () => {
        terminalAbort.abort(); terminalLease?.release(); ssh?.end();
      });
      try {
        const terminalGrant = mode === 'terminal-view' && 'id' in principal
          ? terminalSharing.find(principal.id, id, terminalSession!, terminalProject) : null;
        if (mode === 'terminal-view' && 'id' in principal && !terminalGrant?.terminalId)
          throw new AppError('此共享授权未绑定运行会话，请让管理员重新共享终端', 409);
        terminalLease = await projectTerminals.prepare(id, terminalProject, terminalSession,
          mode === 'terminal-view', terminalAbort.signal, terminalGrant?.terminalId);
        ssh = await machines.connect(id, 10000, terminalAbort.signal);
        if (client.readyState !== WebSocket.OPEN) {
          ssh.end();
          return;
        }
        ssh.on('error', (error) => sendData('error', error.message));
        ssh.once('close', () => client.close());
        const connected = (error: Error | undefined, stream: ClientChannel) => {
          if (!error && (terminalAbort.signal.aborted || client.readyState !== WebSocket.OPEN)) {
            stream.close(); ssh?.end(); return;
          }
          if (error) {
            sendData('error', error.message);
            client.close();
            ssh?.end();
            return;
          }
          sendData('ready', { projectId: terminalLease!.projectId,
            networkIsolation: terminalLease!.networkIsolation });
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
        ssh.exec(terminalLease.command,
          { pty: { term: 'xterm-256color', cols: 100, rows: 28 } }, connected);
      } catch (error: any) {
        sendData('error', error.message);
        client.close();
        terminalLease?.release();
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
    let failed = false;
    for (const dispose of [
      () => session.close(),
      () => access.close(),
      () => sso.close(),
      () => passkeys.close(),
      () => terminalSharing.close(),
      () => projectExecution.close(),
      () => projectTerminals.close(),
      () => jitPrivileges.close(),
      () => projectPermissions.close(),
      () => policyBundles.close(),
      () => changeApprovals?.close(),
      () => browserExtensions.close(),
      () => mobileCompanion.close(),
      () => communityPlugins.close(),
      () => assistant.close(),
      () => native.close(),
      () => nativeClipboard.close(),
      () => webhooks.close(),
      () => automationRules.close(),
      () => rollouts.close(),
      () => fleetRollouts.close(),
      () => usbHotplug.close(),
      () => mediaDevices.close(),
      () => memoryReclaim.close(),
      () => hostMounts.close(),
      () => virtioFsShares.close(),
      () => trustedBoot.close(),
      () => gpuProfiles.close(),
      () => buildFarm.close(),
      () => haLocalFailovers?.close(),
      () => haHostFailover?.close(),
      () => hostPeers.close(),
      () => retention.close(),
      () => graph.close(),
      () => remoteAudit.close(),
      () => browserIde?.close(),
      () => notebooks?.close(),
      () => features.close(),
      () => machines.close(),
      () => audit.close(),
      () => vite?.close(),
    ]) {
      try {
        await dispose();
      } catch (error) {
        failed = true;
        console.error('Shutdown cleanup failed:', error);
      }
    }
    process.exit(failed ? 1 : 0);
  }
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());
}

void main().catch((error) => {
  console.error('Sakura 启动失败：', error);
  process.exitCode = 1;
});
