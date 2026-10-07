/**
 * 模块职责：只读检查见证部署、证书与动作配置，不通过预检执行真实接管。
 * Module purpose: Read-only checks deployment, certificates and action configuration without performing real promotion.
 */
import { X509Certificate } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { HaWitness, type HaWitnessPlan } from './ha-witness-core.ts';
import { haHttpsRequest } from './ha-witness-http.ts';
import { haWitnessServerConfigSchema, redfishPowerState, witnessVms,
  type HaWitnessServerConfig } from './ha-witness-server.ts';

export type HaWitnessCheck = { ok: true; detail: string } | { ok: false; error: string };
type Observed = { powerState?: string; targetHostId?: string;
  targetVmId?: string; targetStatus?: 'stopped' | 'starting' | 'running';
  applicationVmId?: string; applicationReady?: boolean; activeVmId?: string | null };

/**
 * 入口 / Entry: check.
 * 功能：在只读检查见证部署、证书与动作配置中，核对调用资格、输入或资源归属；本入口产生 `{ ok: true, detail: await task() }` / `{ ok: false, error: (error as Error).message }` 供上层消费（`ha-witness-preflight.ts`）。
 * Purpose: Checks admission, input or resource ownership in `ha-witness-preflight.ts`; this entry produces `{ ok: true, detail: await task() }` / `{ ok: false, error: (error as Error).message }` for its caller. Module context: Read-only checks deployment, certificates and action configuration without performing real promotion.
 * 处理：通过 `task` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `task`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: task: () => Promise<string>
 * 输出 / Returns: Promise<HaWitnessCheck>；结果来自 / values from `{ ok: true, detail: await task() }`; `{ ok: false, error: (error as Error).message }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return { ok: false, error: (error as Error).message };`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return { ok: false, error: (error as Error).message };`; these statements determine whether a failure is absorbed or rejected again.
 */
async function check(task: () => Promise<string>): Promise<HaWitnessCheck> {
  try { return { ok: true, detail: await task() }; }
  catch (error) { return { ok: false, error: (error as Error).message }; }
}

/**
 * 入口 / Entry: targetInput.
 * 功能：从当前输入或状态计算 `{ transferId: plan.transferId, remoteVmId: plan.remoteVmId, sha256: plan.sha256, sourceVmId: plan.sourceVmId, snapshotId: pla…`，供调用方后续验证或使用。
 * Purpose: Computes `{ transferId: plan.transferId, remoteVmId: plan.remoteVmId, sha256: plan.sha256, sourceVmId: plan.sourceVmId, snapshotId: pla…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: plan: HaWitnessPlan
 * 输出 / Returns: `{ transferId: plan.transferId, remoteVmId: plan.remoteVmId, sha256: plan.sha256, sourceVmId: plan.sourceVmId, snapshotId: pla…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function targetInput(plan: HaWitnessPlan) {
  return { transferId: plan.transferId, remoteVmId: plan.remoteVmId,
    sha256: plan.sha256, sourceVmId: plan.sourceVmId, snapshotId: plan.snapshotId };
}

/** Read-only connectivity and identity checks; no fencing, activation or traffic writes. */
/**
 * 入口 / Entry: checkHaWitnessDeployment.
 * 功能：只读核对见证证书、监听配置及远端动作可用性，返回部署检查报告。
 * Purpose: Read-only verifies witness certificates, listeners and remote-action availability, returning deployment checks.
 * 设计：预检不执行接管动作，安全检查失败按项目分类返回，避免检查过程改变电源或见证权威。
 * Design: Preflight does not promote; categorized failures preserve power state and witness authority during inspection.
 * 输入 / Inputs: raw: unknown
 * 输出 / Returns: `{ ok: listener.ok && completed.every((vm) => vm.ok && vm.stable), listener, vms: completed }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function checkHaWitnessDeployment(raw: unknown) {
  const config: HaWitnessServerConfig = haWitnessServerConfigSchema.parse(raw);
  /**
   * 入口 / Entry: checkHaWitnessDeployment.denyControl.
   * 功能：在只读检查见证部署、证书与动作配置中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ha-witness-preflight.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-preflight.ts`; the calls and state transitions below complete the operation. Module context: Read-only checks deployment, certificates and action configuration without performing real promotion.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<never>.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `new Error('只读部署预检不能执行接管操作')`.
   */
  const denyControl = async (): Promise<never> => {
    throw new Error('只读部署预检不能执行接管操作');
  };
  const witness = new HaWitness(config.stateFile, witnessVms(config), {
    fence: denyControl, confirmFence: denyControl, targetStatus: denyControl, activate: denyControl,
    applicationReady: denyControl, switchTraffic: denyControl,
    trafficTarget: denyControl, retire: denyControl,
    sourceApplicationReady: denyControl, restoreTraffic: denyControl,
  });
  await witness.init();
  /**
   * 入口 / Entry: checkHaWitnessDeployment.callback@41.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（check）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (check).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: ``证书有效至 ${parsed.validTo}``.
   * 副作用 / Effects: `createSecureContext`.
   * 拒绝 / Refusals: 条件 / conditions `Date.parse(parsed.validFrom) > Date.now() || Date.parse(parsed.validTo) <= Date.now()`; 异常 / errors `new Error('见证监听证书不在有效期内')`.
   */
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
  /**
   * 入口 / Entry: checkHaWitnessDeployment.callback@52.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（config.vms.map）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (config.vms.map).
   * 输入 / Inputs: vm
   * 输出 / Returns: `{ sourceVmId: vm.sourceVmId, phase, armed: !!plan && !recoveryHeld, plan, failback, recoveryHeld, observed, checks, ok: !reco…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const vms = await Promise.all(config.vms.map(async (vm) => {
    const { phase, plan, failback, recoveryHeld } = await witness.deploymentState({
      sourceHostId: vm.sourceHostId, sourceVmId: vm.sourceVmId,
    });
    const observed: Observed = {};
    /**
     * 入口 / Entry: checkHaWitnessDeployment.callback@57.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（check）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (check).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: ``PowerState=${powerState}``.
     * 副作用 / Effects: 更新 / updates `observed.powerState`.
     * 拒绝 / Refusals: 条件 / conditions `phase !== 'source' && powerState !== 'Off'`; 异常 / errors `new Error(`见证已进入 ${phase}，但来源宿主电源状态为 ${powerState}`)`.
     */
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
    /**
     * 入口 / Entry: checkHaWitnessDeployment.callback@70.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（check）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (check).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: ``hostId=${result.id}``.
     * 副作用 / Effects: 更新 / updates `observed.targetHostId`.
     * 拒绝 / Refusals: 条件 / conditions `result?.version !== 1 || result.id !== vm.targetHostId`; 异常 / errors `new Error('目标主机身份与见证配置不一致')`.
     */
    const target = check(async () => {
      const result = await haHttpsRequest(new URL('/peer/status', vm.target.baseUrl).toString(),
        'GET', undefined, { bearer: vm.target.token,
          fingerprint: vm.target.fingerprint }) as { version?: unknown; id?: unknown };
      if (result?.version !== 1 || result.id !== vm.targetHostId)
        throw new Error('目标主机身份与见证配置不一致');
      observed.targetHostId = result.id as string;
      return `hostId=${result.id}`;
    });
    /**
     * 入口 / Entry: checkHaWitnessDeployment.callback@79.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（check）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (check).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: ``vmId=${result.id}, status=${result.status}``.
     * 副作用 / Effects: 更新 / updates `observed.targetVmId`, `observed.targetStatus`.
     * 拒绝 / Refusals: 条件 / conditions `result?.ready !== true || result.id !== plan.remoteVmId || !['stopped', 'starting', 'running'].includes(String(result.status)…`; `phase === 'source' && result.status !== 'stopped'`; `phase === 'promoted' && result.status !== 'running'`; 异常 / errors `new Error('目标副本身份或预检状态不一致')`; `new Error('来源仍获授权时，目标副本不应已经启动')`.
     */
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
    const applicationConfig = plan ? vm.application : failback ? vm.failback?.application : null;
    const applicationVmId = plan?.remoteVmId || (failback ? vm.sourceVmId : null);
    /**
     * 入口 / Entry: checkHaWitnessDeployment.callback@97.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（check）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (check).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: ``vmId=${result.vmId}, ready=${result.ready}``.
     * 副作用 / Effects: `url.searchParams.set`; 更新 / updates `observed.applicationVmId`, `observed.applicationReady`.
     * 拒绝 / Refusals: 条件 / conditions `result?.vmId !== applicationVmId || typeof result.ready !== 'boolean'`; `phase === 'promoted' && !result.ready`; 异常 / errors `new Error('应用健康接口未返回对应实例及布尔就绪状态')`; `new Error('已接管的目标应用未就绪')`.
     */
    const application = applicationConfig && applicationVmId ? check(async () => {
      const url = new URL(applicationConfig.url);
      url.searchParams.set('vmId', applicationVmId);
      const result = await haHttpsRequest(url.toString(), 'GET', undefined,
        { bearer: applicationConfig.token,
          fingerprint: applicationConfig.fingerprint }) as {
        ready?: unknown; vmId?: unknown };
      if (result?.vmId !== applicationVmId || typeof result.ready !== 'boolean')
        throw new Error('应用健康接口未返回对应实例及布尔就绪状态');
      observed.applicationVmId = result.vmId as string;
      observed.applicationReady = result.ready;
      if (phase === 'promoted' && !result.ready)
        throw new Error('已接管的目标应用未就绪');
      return `vmId=${result.vmId}, ready=${result.ready}`;
    }) : null;
    /**
     * 入口 / Entry: checkHaWitnessDeployment.callback@112.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（check）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (check).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: ``activeVmId=${result.activeVmId || 'none'}``.
     * 副作用 / Effects: `url.searchParams.set`; 更新 / updates `observed.activeVmId`.
     * 拒绝 / Refusals: 条件 / conditions `result?.activeVmId !== null && !z.uuid().safeParse(result?.activeVmId).success`; `plan && result.activeVmId !== null && result.activeVmId !== vm.sourceVmId && result.activeVmId !== plan.remoteVmId`; `phase === 'promoted' && result.activeVmId !== plan?.remoteVmId`; 异常 / errors `new Error('流量状态接口未返回有效实例身份或明确空路由')`; `new Error('流量入口指向未知实例，接管不会覆盖现有路由')`.
     */
    const traffic = check(async () => {
      const url = new URL('/status', vm.traffic.baseUrl);
      url.searchParams.set('sourceVmId', vm.sourceVmId);
      const result = await haHttpsRequest(url.toString(), 'GET', undefined,
        { bearer: vm.traffic.token,
          fingerprint: vm.traffic.fingerprint }) as { activeVmId?: unknown };
      if (result?.activeVmId !== null && !z.uuid().safeParse(result?.activeVmId).success)
        throw new Error('流量状态接口未返回有效实例身份或明确空路由');
      observed.activeVmId = result.activeVmId as string | null;
      if (plan && result.activeVmId !== null && result.activeVmId !== vm.sourceVmId &&
          result.activeVmId !== plan.remoteVmId)
        throw new Error('流量入口指向未知实例，接管不会覆盖现有路由');
      if (phase === 'promoted' && result.activeVmId !== plan?.remoteVmId)
        throw new Error('已接管实例未成为流量入口');
      if (failback?.phase === 'completed' && result.activeVmId !== vm.sourceVmId)
        throw new Error('已完成回切，但流量入口不再指向来源实例');
      if (failback?.phase === 'pending' && result.activeVmId !== vm.sourceVmId &&
          result.activeVmId !== failback.plan.remoteVmId)
        throw new Error('待回切流量入口指向未知实例');
      return `activeVmId=${result.activeVmId || 'none'}`;
    });
    const checks = { redfish: await redfish, target: await target,
      replica: replica ? await replica : null,
      application: application ? await application : null,
      traffic: await traffic };
    return { sourceVmId: vm.sourceVmId, phase,
      armed: !!plan && !recoveryHeld, plan, failback, recoveryHeld, observed, checks,
      ok: !recoveryHeld && Object.values(checks).every((item) => !item || item.ok) };
  }));
  // Reads happen across external systems. Mark phase/plan changes during the
  // sample so an observer does not mistake a normal transition for split-brain.
  await witness.init();
  const completed = await Promise.all(vms.map(async (vm) => {
    const configVm = config.vms.find((item) => item.sourceVmId === vm.sourceVmId)!;
    const after = await witness.deploymentState({ sourceHostId: configVm.sourceHostId,
      sourceVmId: vm.sourceVmId });
    return { ...vm, phaseAfter: after.phase,
      stable: vm.phase === after.phase && vm.plan?.transferId === after.plan?.transferId &&
        vm.failback?.phase === after.failback?.phase &&
        vm.failback?.plan.transferId === after.failback?.plan.transferId &&
        vm.recoveryHeld === after.recoveryHeld };
  }));
  return { ok: listener.ok && completed.every((vm) => vm.ok && vm.stable), listener, vms: completed };
}
export type HaWitnessPreflightReport = Awaited<ReturnType<typeof checkHaWitnessDeployment>>;
