import { X509Certificate } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { readFile } from 'node:fs/promises';
import { HaWitness, type HaWitnessPlan } from './ha-witness-core.ts';
import { haHttpsRequest } from './ha-witness-http.ts';
import { haWitnessServerConfigSchema, redfishPowerState, witnessVms,
  type HaWitnessServerConfig } from './ha-witness-server.ts';

export type HaWitnessCheck = { ok: true; detail: string } | { ok: false; error: string };
type Observed = { powerState?: string; targetHostId?: string;
  targetVmId?: string; targetStatus?: 'stopped' | 'starting' | 'running';
  applicationVmId?: string; applicationReady?: boolean; activeVmId?: string | null };

async function check(task: () => Promise<string>): Promise<HaWitnessCheck> {
  try { return { ok: true, detail: await task() }; }
  catch (error) { return { ok: false, error: (error as Error).message }; }
}

function targetInput(plan: HaWitnessPlan) {
  return { transferId: plan.transferId, remoteVmId: plan.remoteVmId,
    sha256: plan.sha256, sourceVmId: plan.sourceVmId, snapshotId: plan.snapshotId };
}

/** Read-only connectivity and identity checks; no fencing, activation or traffic writes. */
export async function checkHaWitnessDeployment(raw: unknown) {
  const config: HaWitnessServerConfig = haWitnessServerConfigSchema.parse(raw);
  const denyControl = async (): Promise<never> => {
    throw new Error('只读部署预检不能执行接管操作');
  };
  const witness = new HaWitness(config.stateFile, witnessVms(config), {
    fence: denyControl, confirmFence: denyControl, targetStatus: denyControl, activate: denyControl,
    applicationReady: denyControl, switchTraffic: denyControl,
    trafficTarget: denyControl, retire: denyControl,
  });
  await witness.init();
  const listener = await check(async () => {
    const [cert, key] = await Promise.all([
      readFile(config.listen.certFile), readFile(config.listen.keyFile),
    ]);
    createSecureContext({ cert, key });
    const parsed = new X509Certificate(cert);
    if (Date.parse(parsed.validFrom) > Date.now() ||
        Date.parse(parsed.validTo) <= Date.now())
      throw new Error('见证监听证书不在有效期内');
    return `证书有效至 ${parsed.validTo}`;
  });
  const vms = await Promise.all(config.vms.map(async (vm) => {
    const { phase, plan } = await witness.deploymentState({
      sourceHostId: vm.sourceHostId, sourceVmId: vm.sourceVmId,
    });
    const observed: Observed = {};
    const redfish = check(async () => {
      const ca = vm.redfish.caFile ? await readFile(vm.redfish.caFile) : undefined;
      const result = await haHttpsRequest(
        new URL(vm.redfish.systemPath, vm.redfish.baseUrl).toString(),
        'GET', undefined, { basic: { username: vm.redfish.username,
          password: vm.redfish.password }, ca,
          fingerprint: vm.redfish.fingerprint });
      const powerState = redfishPowerState(result, vm.redfish.systemUuid);
      observed.powerState = powerState;
      if (phase !== 'source' && powerState !== 'Off')
        throw new Error(`见证已进入 ${phase}，但来源宿主电源状态为 ${powerState}`);
      return `PowerState=${powerState}`;
    });
    const target = check(async () => {
      const result = await haHttpsRequest(new URL('/peer/status', vm.target.baseUrl).toString(),
        'GET', undefined, { bearer: vm.target.token,
          fingerprint: vm.target.fingerprint }) as { version?: unknown; id?: unknown };
      if (result?.version !== 1 || result.id !== vm.targetHostId)
        throw new Error('目标主机身份与见证配置不一致');
      observed.targetHostId = result.id as string;
      return `hostId=${result.id}`;
    });
    const replica = plan ? check(async () => {
      const result = await haHttpsRequest(new URL('/peer/replica-activate-check',
        vm.target.baseUrl).toString(), 'POST', targetInput(plan),
        { bearer: vm.target.token, fingerprint: vm.target.fingerprint }) as {
        ready?: unknown; id?: unknown; status?: unknown };
      if (result?.ready !== true || result.id !== plan.remoteVmId ||
          !['stopped', 'starting', 'running'].includes(String(result.status)))
        throw new Error('目标副本身份或预检状态不一致');
      observed.targetVmId = result.id as string;
      observed.targetStatus = result.status as Observed['targetStatus'];
      if (phase === 'source' && result.status !== 'stopped')
        throw new Error('来源仍获授权时，目标副本不应已经启动');
      if (phase === 'promoted' && result.status !== 'running')
        throw new Error('已接管的目标副本未运行');
      return `vmId=${result.id}, status=${result.status}`;
    }) : null;
    const application = plan ? check(async () => {
      const url = new URL(vm.application.url);
      url.searchParams.set('vmId', plan.remoteVmId);
      const result = await haHttpsRequest(url.toString(), 'GET', undefined,
        { bearer: vm.application.token,
          fingerprint: vm.application.fingerprint }) as {
        ready?: unknown; vmId?: unknown };
      if (result?.vmId !== plan.remoteVmId || typeof result.ready !== 'boolean')
        throw new Error('应用健康接口未返回目标实例及布尔就绪状态');
      observed.applicationVmId = result.vmId as string;
      observed.applicationReady = result.ready;
      if (phase === 'promoted' && !result.ready)
        throw new Error('已接管的目标应用未就绪');
      return `vmId=${result.vmId}, ready=${result.ready}`;
    }) : null;
    const traffic = check(async () => {
      const url = new URL('/status', vm.traffic.baseUrl);
      url.searchParams.set('sourceVmId', vm.sourceVmId);
      const result = await haHttpsRequest(url.toString(), 'GET', undefined,
        { bearer: vm.traffic.token,
          fingerprint: vm.traffic.fingerprint }) as { activeVmId?: unknown };
      if (result?.activeVmId !== null &&
          typeof result?.activeVmId !== 'string')
        throw new Error('流量状态接口未返回 activeVmId');
      observed.activeVmId = result.activeVmId as string | null;
      if (phase === 'promoted' && result.activeVmId !== plan?.remoteVmId)
        throw new Error('已接管实例未成为流量入口');
      return `activeVmId=${result.activeVmId || 'none'}`;
    });
    const checks = { redfish: await redfish, target: await target,
      replica: replica ? await replica : null,
      application: application ? await application : null,
      traffic: await traffic };
    return { sourceVmId: vm.sourceVmId, phase,
      armed: !!plan, plan, observed, checks,
      ok: Object.values(checks).every((item) => !item || item.ok) };
  }));
  // Reads happen across external systems. Mark phase/plan changes during the
  // sample so an observer does not mistake a normal transition for split-brain.
  await witness.init();
  const completed = await Promise.all(vms.map(async (vm) => {
    const configVm = config.vms.find((item) => item.sourceVmId === vm.sourceVmId)!;
    const after = await witness.deploymentState({ sourceHostId: configVm.sourceHostId,
      sourceVmId: vm.sourceVmId });
    return { ...vm, phaseAfter: after.phase,
      stable: vm.phase === after.phase && vm.plan?.transferId === after.plan?.transferId };
  }));
  return { ok: listener.ok && completed.every((vm) => vm.ok), listener, vms: completed };
}
export type HaWitnessPreflightReport = Awaited<ReturnType<typeof checkHaWitnessDeployment>>;
