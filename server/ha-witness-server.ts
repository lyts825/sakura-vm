import { createServer as createHttpsServer, type Server } from 'node:https';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { AppError } from './model.ts';
import { readJsonBody } from './http.ts';
import { HaWitness, type HaWitnessActions, type HaWitnessPlan,
  type HaWitnessVm } from './ha-witness-core.ts';
import { haHttpsRequest } from './ha-witness-http.ts';

const httpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
}, '需要不含凭据的 HTTPS 地址');
const baseUrl = httpsUrl.refine((value) => new URL(value).pathname === '/' &&
  !new URL(value).search, '基础 URL 不能包含路径或查询参数');
const fingerprint = z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
const bearerToken = z.string().regex(/^[a-f0-9]{64}$/);
const systemUuid = z.string().regex(/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/);

export function redfishPowerState(raw: unknown, expectedUuid: string) {
  const result = raw as { UUID?: unknown; PowerState?: unknown } | null;
  if (typeof result?.UUID !== 'string' ||
      result.UUID.toLowerCase() !== expectedUuid.toLowerCase())
    throw new AppError('Redfish 系统 UUID 与配置不一致', 409);
  if (typeof result.PowerState !== 'string' || !result.PowerState)
    throw new AppError('Redfish 未返回 PowerState', 502);
  return result.PowerState;
}

const witnessVmConfigSchema = z.object({
  sourceHostId: z.uuid(), sourceVmId: z.uuid(), targetHostId: z.uuid(),
  failureThreshold: z.number().int().min(2).max(10),
  redfish: z.object({ baseUrl, systemPath: z.string().regex(/^\/redfish\/v1\/Systems\/[A-Za-z0-9._~-]+$/),
    systemUuid,
    username: z.string().min(1).max(128), password: z.string().min(1).max(1024),
    caFile: z.string().min(1).optional(), fingerprint: fingerprint.optional(),
  }).strict().refine((value) => !!value.caFile !== !!value.fingerprint,
    '带外接口必须选择 CA 文件或证书指纹'),
  target: z.object({ baseUrl, fingerprint, token: bearerToken }).strict(),
  application: z.object({ url: httpsUrl, token: bearerToken,
    fingerprint: fingerprint.optional() }).strict(),
  traffic: z.object({ baseUrl, token: bearerToken,
    fingerprint: fingerprint.optional() }).strict(),
}).strict();
export const haWitnessServerConfigSchema = z.object({
  version: z.literal(1), listen: z.object({ host: z.string().min(1),
    port: z.number().int().min(0).max(65535),
    certFile: z.string().min(1), keyFile: z.string().min(1) }).strict(),
  stateFile: z.string().min(1),
  sourceToken: bearerToken.optional(),
  sourceTokens: z.record(z.uuid(), bearerToken).optional(),
  vms: z.array(witnessVmConfigSchema).min(1).max(64),
}).strict().superRefine((config, context) => {
  const hosts = new Set(config.vms.map((vm) => vm.sourceHostId));
  if (!!config.sourceToken === !!config.sourceTokens ||
      (config.sourceToken && hosts.size !== 1) ||
      (config.sourceTokens &&
        (Object.keys(config.sourceTokens).length !== hosts.size ||
         [...hosts].some((host) => !config.sourceTokens?.[host]) ||
         new Set(Object.values(config.sourceTokens)).size !== hosts.size)))
    context.addIssue({ code: 'custom', path: ['sourceTokens'],
      message: '每个来源宿主须有独立令牌；全局来源令牌只适用于单一来源宿主' });
});
export type HaWitnessServerConfig = z.infer<typeof haWitnessServerConfigSchema>;
type ConfigVm = HaWitnessServerConfig['vms'][number];

export function witnessVms(config: HaWitnessServerConfig): HaWitnessVm[] {
  return config.vms.map((vm) => ({ sourceHostId: vm.sourceHostId,
    sourceVmId: vm.sourceVmId, targetHostId: vm.targetHostId,
    failureThreshold: vm.failureThreshold,
    sourceSystemUuid: vm.redfish.systemUuid.toLowerCase() }));
}

function targetInput(plan: HaWitnessPlan) {
  return { transferId: plan.transferId, remoteVmId: plan.remoteVmId,
    sha256: plan.sha256, sourceVmId: plan.sourceVmId, snapshotId: plan.snapshotId };
}

async function actionsFor(config: HaWitnessServerConfig): Promise<HaWitnessActions> {
  const entries = new Map(config.vms.map((vm) => [vm.sourceVmId, vm]));
  const ca = new Map<string, Buffer>();
  for (const vm of config.vms)
    if (vm.redfish.caFile) ca.set(vm.sourceVmId, await readFile(vm.redfish.caFile));
  const entry = (vm: HaWitnessVm): ConfigVm => {
    const found = entries.get(vm.sourceVmId);
    if (!found || found.sourceHostId !== vm.sourceHostId ||
        found.targetHostId !== vm.targetHostId)
      throw new AppError('见证实例配置已变化', 409);
    return found;
  };
  const bmc = async (vm: ConfigVm, method: 'GET' | 'POST',
    path: string, body?: unknown) => haHttpsRequest(
    new URL(path, vm.redfish.baseUrl).toString(), method, body,
    { basic: { username: vm.redfish.username, password: vm.redfish.password },
      ca: ca.get(vm.sourceVmId), fingerprint: vm.redfish.fingerprint,
      timeoutMs: 10_000 });
  const target = async (vm: ConfigVm, path: string, body: unknown) => haHttpsRequest(
    new URL(path, vm.target.baseUrl).toString(), 'POST', body,
    { bearer: vm.target.token, fingerprint: vm.target.fingerprint, timeoutMs: 30_000 });
  return {
    fence: async (identity) => {
      const vm = entry(identity), systemPath = vm.redfish.systemPath;
      const status = redfishPowerState(await bmc(vm, 'GET', systemPath),
        vm.redfish.systemUuid);
      if (status !== 'Off') {
        await bmc(vm, 'POST', `${systemPath}/Actions/ComputerSystem.Reset`,
          { ResetType: 'ForceOff' });
      }
      const deadline = Date.now() + 90_000;
      while (true) {
        const next = redfishPowerState(await bmc(vm, 'GET', systemPath),
          vm.redfish.systemUuid);
        if (next === 'Off') return;
        if (Date.now() >= deadline) throw new AppError('带外控制器未确认来源宿主已关闭', 504);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    },
    targetStatus: async (identity, plan) => {
      const result = await target(entry(identity), '/peer/replica-activate-check',
        targetInput(plan)) as { ready?: boolean; id?: string; status?: string };
      if (result?.ready !== true || result.id !== plan.remoteVmId ||
          !['stopped', 'starting', 'running'].includes(result.status || ''))
        throw new AppError('目标副本预检结果不一致', 409);
      return result.status as 'stopped' | 'starting' | 'running';
    },
    activate: async (identity, plan) => {
      const result = await target(entry(identity), '/peer/replica-activate',
        targetInput(plan)) as { id?: string; status?: string };
      if (result?.id !== plan.remoteVmId ||
          !['starting', 'running'].includes(result.status || ''))
        throw new AppError('目标副本启动结果不一致', 409);
    },
    applicationReady: async (identity, plan) => {
      const vm = entry(identity);
      const url = new URL(vm.application.url);
      url.searchParams.set('vmId', plan.remoteVmId);
      const result = await haHttpsRequest(url.toString(), 'GET', undefined,
        { bearer: vm.application.token,
          fingerprint: vm.application.fingerprint }) as { ready?: boolean; vmId?: string };
      return result?.ready === true && result.vmId === plan.remoteVmId;
    },
    switchTraffic: async (identity, plan) => {
      const vm = entry(identity);
      const result = await haHttpsRequest(new URL('/activate', vm.traffic.baseUrl).toString(),
        'POST', { sourceVmId: plan.sourceVmId, targetVmId: plan.remoteVmId },
        { bearer: vm.traffic.token,
          fingerprint: vm.traffic.fingerprint }) as { accepted?: boolean; activeVmId?: string };
      if (result?.accepted !== true || result.activeVmId !== plan.remoteVmId)
        throw new AppError('流量切换接口未确认目标实例', 409);
    },
    trafficTarget: async (identity, plan) => {
      const vm = entry(identity);
      const url = new URL('/status', vm.traffic.baseUrl);
      url.searchParams.set('sourceVmId', plan.sourceVmId);
      const result = await haHttpsRequest(url.toString(), 'GET', undefined,
        { bearer: vm.traffic.token,
          fingerprint: vm.traffic.fingerprint }) as { activeVmId?: string };
      return result?.activeVmId || '';
    },
    retire: async (identity, plan) => {
      const result = await target(entry(identity), '/peer/replica-retire',
        targetInput(plan)) as { id?: string; retired?: boolean };
      if (result?.id !== plan.remoteVmId || result.retired !== true)
        throw new AppError('目标副本未确认持久退役', 409);
    },
  };
}

const hash = (value: string) => createHash('sha256').update(value).digest();
function authorizedHost(request: IncomingMessage, tokens: Map<string, string>) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const received = header.slice(7);
  if (!/^[a-f0-9]{64}$/.test(received)) return null;
  const receivedHash = hash(received);
  let host: string | null = null;
  for (const [id, token] of tokens)
    if (timingSafeEqual(receivedHash, hash(token))) host = id;
  return host;
}

export async function startHaWitnessServer(raw: unknown,
  now = () => Date.now()) {
  const config = haWitnessServerConfigSchema.parse(raw);
  if (new Set(config.vms.map((vm) => vm.sourceVmId)).size !== config.vms.length)
    throw new AppError('见证实例 ID 重复');
  const sourceTokens = new Map<string, string>(config.sourceTokens
    ? Object.entries(config.sourceTokens)
    : [[config.vms[0].sourceHostId, config.sourceToken!]]);
  const witness = new HaWitness(config.stateFile, witnessVms(config),
    await actionsFor(config), now);
  await witness.init();
  const server: Server = createHttpsServer({
    cert: await readFile(config.listen.certFile), key: await readFile(config.listen.keyFile),
    minVersion: 'TLSv1.2',
  }, (request, response) => void (async () => {
    try {
      const sourceHostId = authorizedHost(request, sourceTokens);
      if (!sourceHostId) throw new AppError('未授权', 401);
      if (request.method !== 'POST') throw new AppError('不支持此方法', 405);
      const body = await readJsonBody(request, 4096);
      if (!body || typeof body !== 'object' ||
          (body as Record<string, unknown>).sourceHostId !== sourceHostId)
        throw new AppError('来源凭据与实例身份不匹配', 403);
      let result: unknown;
      if (request.url === '/v1/heartbeat') result = await witness.heartbeat(body);
      else if (request.url === '/v1/authorize-start') result = await witness.authorizeStart(body);
      else if (request.url === '/v1/status') result = await witness.status(body);
      else if (request.url === '/v1/rejoin') result = await witness.rejoin(body);
      else throw new AppError('接口不存在', 404);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store' });
      response.end(JSON.stringify(result));
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: status === 500 ? '见证服务内部错误' :
        (error as Error).message }));
    }
  })());
  server.requestTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.listen.port, config.listen.host, () => {
      server.off('error', reject); resolve();
    });
  });
  const timer = setInterval(() => void witness.sample().catch((error) =>
    console.error('HA 见证采样失败：', error)), 5_000);
  timer.unref();
  void witness.sample().catch((error) => console.error('HA 见证启动扫描失败：', error));
  return { witness, server, close: async () => {
    clearInterval(timer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await witness.drain();
  } };
}
