import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AppError } from './model.ts';
import { HaWitnessClient, haWitnessClientConfigSchema } from './ha-witness-client.ts';
import { haWitnessPlanSchema } from './ha-witness-core.ts';
import { checkHaWitnessDeployment, type HaWitnessPreflightReport } from './ha-witness-preflight.ts';
import { haWitnessServerConfigSchema, type HaWitnessServerConfig } from './ha-witness-server.ts';

const endpointSchema = z.object({ witness: z.string(), redfishSystem: z.string(),
  target: z.string(), application: z.string(), traffic: z.string() }).strict();
export const haDrillPlanSchema = z.object({
  version: z.literal(1), kind: z.literal('sakura-ha-drill-plan'), drillId: z.uuid(),
  createdAt: z.iso.datetime(), witnessNode: z.string().min(1),
  configDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSystemUuid: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
  failureThreshold: z.number().int().min(2).max(10), replica: haWitnessPlanSchema,
  endpoints: endpointSchema, operatorSteps: z.array(z.string()).min(1),
}).strict();
export type HaDrillPlan = z.infer<typeof haDrillPlanSchema>;
type VmReport = HaWitnessPreflightReport['vms'][number];
export type HaDrillSample = {
  at: string; ok: boolean; stable: boolean;
  phase?: string; planMatches?: boolean; sourceStartAllowed?: boolean;
  observed?: VmReport['observed']; checks?: VmReport['checks']; error?: string;
};

function vmConfig(config: HaWitnessServerConfig, id: string) {
  z.uuid().parse(id);
  const vm = config.vms.find((item) => item.sourceVmId === id);
  if (!vm) throw new AppError('演练实例未在见证配置中登记', 404);
  return vm;
}

function publicUrl(value: string) {
  const url = new URL(value);
  // Application URLs may have query parameters; never put them into the plan.
  url.search = ''; url.hash = '';
  return url.toString();
}

async function context(config: HaWitnessServerConfig, id: string, witnessUrl?: string) {
  const vm = vmConfig(config, id);
  if (!config.listen.port) throw new AppError('演练需要见证服务的固定监听端口');
  const fingerprint = new X509Certificate(await readFile(config.listen.certFile)).fingerprint256;
  const host = config.listen.host === '0.0.0.0' ? '127.0.0.1'
    : config.listen.host === '::' ? '::1' : config.listen.host;
  const url = witnessUrl || `https://${host.includes(':') ? `[${host}]` : host}:${config.listen.port}/`;
  const clientConfig = haWitnessClientConfigSchema.parse({ version: 1, url, fingerprint,
    token: config.sourceTokens?.[vm.sourceHostId] || config.sourceToken });
  const endpoints = { witness: publicUrl(clientConfig.url),
    redfishSystem: new URL(vm.redfish.systemPath, vm.redfish.baseUrl).toString(),
    target: publicUrl(vm.target.baseUrl), application: publicUrl(vm.application.url),
    traffic: publicUrl(vm.traffic.baseUrl) };
  const publicBinding = { witnessNode: hostname(), stateFile: resolve(config.stateFile),
    sourceHostId: vm.sourceHostId, sourceVmId: vm.sourceVmId, targetHostId: vm.targetHostId,
    sourceSystemUuid: vm.redfish.systemUuid.toLowerCase(), failureThreshold: vm.failureThreshold,
    endpoints, pins: { witness: fingerprint, redfish: vm.redfish.fingerprint || null,
      redfishCaFile: vm.redfish.caFile ? resolve(vm.redfish.caFile) : null,
      redfishCaSha256: vm.redfish.caFile ? createHash('sha256')
        .update(await readFile(vm.redfish.caFile)).digest('hex') : null,
      target: vm.target.fingerprint, application: vm.application.fingerprint || null,
      traffic: vm.traffic.fingerprint || null } };
  return { vm, endpoints, digest: createHash('sha256').update(JSON.stringify(publicBinding)).digest('hex'),
    client: new HaWitnessClient(clientConfig) };
}

function samePlan(left: VmReport['plan'], right: HaDrillPlan['replica']) {
  return !!left && JSON.stringify(haWitnessPlanSchema.parse(left)) ===
    JSON.stringify(haWitnessPlanSchema.parse(right));
}

async function readSample(config: HaWitnessServerConfig, plan: HaDrillPlan,
  client: HaWitnessClient): Promise<HaDrillSample> {
  try {
    const report = await checkHaWitnessDeployment(config);
    const vm = report.vms.find((item) => item.sourceVmId === plan.replica.sourceVmId)!;
    const identity = { sourceHostId: plan.replica.sourceHostId, sourceVmId: plan.replica.sourceVmId };
    const before = await client.status(identity);
    let sourceStartAllowed: boolean;
    try { await client.authorizeStart(identity); sourceStartAllowed = true; }
    catch (error) {
      // Only an authenticated, explicit 409 proves refusal. TLS, timeouts and
      // unreachable hosts must not be reported as successful source fencing.
      if (!(error instanceof AppError) || !/HTTP 409$/.test(error.message)) throw error;
      sourceStartAllowed = false;
    }
    const after = await client.status(identity);
    return { at: new Date().toISOString(), phase: after.phase,
      ok: report.listener.ok && vm.ok && !after.error,
      stable: vm.stable && vm.phaseAfter === before.phase && before.phase === after.phase &&
        before.targetVmId === after.targetVmId,
      planMatches: samePlan(vm.plan, plan.replica) && after.targetVmId === plan.replica.remoteVmId,
      sourceStartAllowed, observed: vm.observed, checks: vm.checks,
      ...(after.error ? { error: after.error } : {}) };
  } catch (error) {
    return { at: new Date().toISOString(), ok: false, stable: false,
      error: error instanceof Error ? error.message : '演练只读观察失败' };
  }
}

export function assessHaDrillSample(plan: HaDrillPlan, sample: HaDrillSample) {
  if (!sample.stable) return { complete: false, violation: null };
  if (!sample.planMatches) return { complete: false, violation: '见证计划已撤销或改变，须重新准备演练' };
  const observed = sample.observed;
  if (sample.phase === 'source' && sample.sourceStartAllowed === false)
    return { complete: false, violation: '来源阶段未获得明确启动授权' };
  if (sample.phase !== 'source' && sample.sourceStartAllowed === true)
    return { complete: false, violation: '隔离或接管阶段仍授权来源启动' };
  if ((sample.phase === 'source' || sample.phase === 'fencing') &&
      observed?.targetStatus && observed.targetStatus !== 'stopped')
    return { complete: false, violation: '来源关闭确认之前目标副本已启动' };
  if ((sample.phase === 'fenced' || sample.phase === 'promoted') &&
      observed?.powerState && observed.powerState !== 'Off')
    return { complete: false, violation: '隔离或接管阶段来源宿主不再关闭' };
  return { complete: sample.ok && sample.phase === 'promoted' &&
    sample.sourceStartAllowed === false && observed?.powerState === 'Off' &&
    observed.targetHostId === plan.replica.targetHostId &&
    observed.targetVmId === plan.replica.remoteVmId && observed.targetStatus === 'running' &&
    observed.applicationVmId === plan.replica.remoteVmId && observed.applicationReady === true &&
    observed.activeVmId === plan.replica.remoteVmId, violation: null };
}

/** Produces a concrete plan after read-only checks; never injects a production fault. */
export async function prepareHaFailoverDrill(raw: unknown, id: string, witnessUrl?: string) {
  const config = haWitnessServerConfigSchema.parse(raw);
  const selected = await context(config, id, witnessUrl);
  const report = await checkHaWitnessDeployment(config);
  const vm = report.vms.find((item) => item.sourceVmId === id)!;
  if (!report.listener.ok || !vm.ok || !vm.stable || vm.phase !== 'source' || !vm.plan ||
      vm.observed.powerState !== 'On' || vm.observed.targetStatus !== 'stopped' ||
      vm.observed.applicationReady !== false || vm.observed.activeVmId !== id)
    throw new AppError('演练基线未就绪：须来源通电、见证布防、目标停机、健康为 false 且流量指向来源', 409);
  const replica = vm.plan;
  const status = await selected.client.status({ sourceHostId: replica.sourceHostId, sourceVmId: id });
  if (status.phase !== 'source' || status.armed !== true || status.targetVmId !== replica.remoteVmId ||
      typeof status.lastHeartbeatAt !== 'number' ||
      Date.now() - status.lastHeartbeatAt >= selected.vm.failureThreshold * 15_000 ||
      Date.now() - Date.parse(replica.snapshotAt) > replica.maxReplicaAgeMinutes * 60_000)
    throw new AppError('来源心跳或副本已过期，不能生成演练计划', 409);
  await selected.client.authorizeStart({ sourceHostId: replica.sourceHostId, sourceVmId: id });
  return haDrillPlanSchema.parse({ version: 1, kind: 'sakura-ha-drill-plan', drillId: randomUUID(),
    createdAt: new Date().toISOString(), witnessNode: hostname(), configDigest: selected.digest,
    sourceSystemUuid: selected.vm.redfish.systemUuid.toLowerCase(),
    failureThreshold: selected.vm.failureThreshold, replica, endpoints: selected.endpoints,
    operatorSteps: [
      '核对资产清单：来源、目标和见证是独立节点；同电脑适配器无法证明硬件故障接管。',
      `核对本次隔离对象：来源宿主 ${replica.sourceHostId}，Redfish 系统 UUID ${selected.vm.redfish.systemUuid.toLowerCase()}；审查其全部受影响实例。`,
      `确认数据时效、停机窗口和回迁方案：只允许接管目标实例 ${replica.remoteVmId}，禁止重新导入旧快照覆盖目标写入。`,
      '先启动 --observe 并等待基线记录，再由已获授权的操作者使上述来源宿主失联；工具不发送关机或切流命令。',
      '保留观察 JSONL、来源宿主/目标/见证资产身份、真实 BMC 日志及实际流量请求证据；检查见证进程重启后来源仍被拒绝。',
      '恢复时先使来源宿主系统可访问但保持来源实例停机，回迁数据，停止目标并通过 dataReconciled=true 退出接管；重新复制后才能再次布防。',
    ] });
}

type ObserveOptions = { output: string; witnessUrl?: string; timeoutMs?: number;
  intervalMs?: number; signal?: AbortSignal; onSample?: (sample: HaDrillSample) => void };

/** Records read-only evidence across a user-controlled real fault injection. */
export async function observeHaFailoverDrill(raw: unknown, rawPlan: unknown, options: ObserveOptions) {
  const config = haWitnessServerConfigSchema.parse(raw), plan = haDrillPlanSchema.parse(rawPlan);
  const selected = await context(config, plan.replica.sourceVmId, options.witnessUrl);
  if (selected.digest !== plan.configDigest || plan.witnessNode !== hostname())
    throw new AppError('演练计划与本节点配置不一致，须重新生成计划', 409);
  const output = resolve(options.output), timeoutMs = options.timeoutMs ?? 600_000;
  const intervalMs = options.intervalMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
      !Number.isSafeInteger(intervalMs) || intervalMs <= 0)
    throw new AppError('演练观察时限或采样间隔无效');
  await writeFile(output, JSON.stringify({ type: 'start', version: 1,
    drillId: plan.drillId, plan, observerNode: hostname(),
    physicalNodeIndependenceVerified: false,
    note: '本记录证明接口观察结果；独立硬件身份须另附资产与BMC证据。' }) + '\n',
  { flag: 'wx', mode: 0o600, flush: true });
  const record = async (value: unknown) => appendFile(output, JSON.stringify(value) + '\n', { flush: true });
  const deadline = Date.now() + timeoutMs;
  let baseline = false, consecutivePromoted = 0, samples = 0;
  let failure = '观察超时，未确认完整接管';
  while (Date.now() < deadline) {
    if (options.signal?.aborted) { failure = '观察已停止；不执行来源恢复或目标操作'; break; }
    const sample = await readSample(config, plan, selected.client);
    samples++;
    await record({ type: baseline ? 'observation' : 'baseline', sample });
    options.onSample?.(sample);
    if (!baseline) {
      if (!sample.ok || !sample.stable || !sample.planMatches || sample.phase !== 'source' ||
          sample.sourceStartAllowed !== true || sample.observed?.powerState !== 'On' ||
          sample.observed.targetStatus !== 'stopped' || sample.observed.applicationReady !== false ||
          sample.observed.activeVmId !== plan.replica.sourceVmId) {
        failure = '未捕获就绪的来源基线；不能把已有接管状态当作本次演练成功'; break;
      }
      baseline = true;
    }
    const result = assessHaDrillSample(plan, sample);
    if (result.violation) { failure = result.violation; break; }
    consecutivePromoted = result.complete ? consecutivePromoted + 1 : 0;
    if (consecutivePromoted >= 2) {
      const success = { type: 'result', ok: true, drillId: plan.drillId, output,
        samples, promotionObserved: true, physicalNodeIndependenceVerified: false };
      await record(success); return success;
    }
    await new Promise<void>((done) => {
      const stop = () => { clearTimeout(timer); done(); };
      const timer = setTimeout(() => { options.signal?.removeEventListener('abort', stop); done(); },
        Math.min(intervalMs, Math.max(1, deadline - Date.now())));
      options.signal?.addEventListener('abort', stop, { once: true });
    });
  }
  const failed = { type: 'result', ok: false, drillId: plan.drillId, output, samples,
    promotionObserved: false, physicalNodeIndependenceVerified: false, error: failure };
  await record(failed); return failed;
}
