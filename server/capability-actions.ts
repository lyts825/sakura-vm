/**
 * 模块职责：检查并执行能力动作，协调依赖顺序、实例运行状态与各领域执行入口。
 * Module purpose: Checks and executes capability actions, coordinating dependency order, VM state and domain execution entry points.
 */
import type { IdeV1, ProjectTerminalsV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { VmAccess as Machines } from './vm-access.ts';

import { AppError } from '../shared/errors.ts';
import { Files, ftpStat } from './files.ts';
import { runEngineeringOperation } from './engineering-runner.ts';
import { capabilityDefinitions, capabilityParameters, type CapabilityId } from './capability-definitions.ts';
import { reportCapabilities, runReport } from './capability-reports.ts';
import { maintenancePolicy, saveMaintenancePolicy, inMaintenance } from './automation-policy.ts';
import { resourceCapabilities, resourceAction } from './resource-actions.ts';
import { hostAudit, traceExport } from './audit.ts';
import { backupBlocks } from './backup-blocks.ts';
import { readAvailabilityReport } from './availability.ts';
import { hostDiskHealth } from './host-disk-health.ts';
import { hostPower, powerDecision, powerPolicy, savePowerPolicy } from './power-policy.ts';
import { checkFlamegraph, runFlamegraph } from './flamegraph.ts';
import { checkEbpfProfiler, runEbpfProfiler } from './ebpf-profiler.ts';
import { networkQuota } from './network-quota.ts';
import { projectQuota } from './project-quota.ts';
import { guestQuota } from './guest-quota.ts';
import { egressPolicy } from './egress-policy.ts';
import { natHairpin } from './nat-hairpin.ts';
import { checkSshAgentForward, runSshAgentForward } from './ssh-agent-forward.ts';
import { checkGpgAgentForward, runGpgAgentForward } from './gpg-agent-forward.ts';
import { checkGpuAcceleration, runGpuAcceleration } from './gpu-acceleration.ts';
import { checkSyscallProfile, runSyscallProfile } from './syscall-profile.ts';

/**
 * 入口 / Entry: dependencyOrder.
 * 功能：在检查并执行能力动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `order` 供上层消费（`capability-actions.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `capability-actions.ts`; this entry produces `order` for its caller. Module context: Checks and executes capability actions, coordinating dependency order, VM state and domain execution entry points.
 * 处理：通过 `visit`, `visiting.clear`, `visited.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `visit`, `visiting.clear`, `visited.clear`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: root: string; graph: Record<string, string[]>
 * 输出 / Returns: `order`.
 * 副作用 / Effects: `visiting.clear`; `visited.clear`; 更新 / updates `order.length`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function dependencyOrder(root: string, graph: Record<string, string[]>) {
  const visiting = new Set<string>(),
    visited = new Set<string>(),
    order: string[] = [];
  /**
   * 入口 / Entry: dependencyOrder.visit.
   * 功能：在检查并执行能力动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`capability-actions.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `capability-actions.ts`; this entry produces `void` for its caller. Module context: Checks and executes capability actions, coordinating dependency order, VM state and domain execution entry points.
   * 处理：通过 `visiting.has`, `visited.has`, `visiting.add`, `visit` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `visiting.has`, `visited.has`, `visiting.add`, `visit`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `visited.has(id)`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `visiting.add`; `visiting.delete`; `visited.add`; `order.push`.
   * 拒绝 / Refusals: 条件 / conditions `visiting.has(id)`; 异常 / errors `new AppError('实例依赖存在循环：' + id)`.
   */
  const visit = (id: string) => {
    if (visiting.has(id)) throw new AppError('实例依赖存在循环：' + id);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph[id] || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };
  // Reject cycles even in an otherwise disconnected configuration.
  for (const id of Object.keys(graph)) visit(id);
  visiting.clear();
  visited.clear();
  order.length = 0;
  visit(root);
  return order;
}

export class CapabilityActions {
  /**
   * 入口 / Entry: CapabilityActions.constructor.
   * 功能：建立 CapabilityActions 的检查并执行能力动作上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the CapabilityActions context for this module's responsibility: Checks and executes capability actions, coordinating dependency order, VM state and domain execution entry points. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; projectTerminals: ProjectTerminalsV1 optional; editor: Pick<IdeV1, 'profile'> optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
    private projectTerminals?: ProjectTerminalsV1,
    private editor?: Pick<IdeV1, 'profile'>,
  ) {}

  /**
   * 入口 / Entry: CapabilityActions.check.
   * 功能：在检查并执行能力动作中，核对调用资格、输入或资源归属；本入口产生 `{ ready: true, executed: false, featureId, reason: '执行入口已实现；提交时验证所选目标与参数。', }` / `{ ready: false, executed: false, featureId, reason: '请先启动发行版。' }` 供上层消费（`CapabilityActions`）。
   * Purpose: Checks admission, input or resource ownership in `CapabilityActions`; this entry produces `{ ready: true, executed: false, featureId, reason: '执行入口已实现；提交时验证所选目标与参数。', }` / `{ ready: false, executed: false, featureId, reason: '请先启动发行版。' }` for its caller. Module context: Checks and executes capability actions, coordinating dependency order, VM state and domain execution entry points.
   * 处理：通过 `this.machines.get`, `this.machines.state`, `checkSshAgentForward`, `checkGpgAgentForward` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.state`, `checkSshAgentForward`, `checkGpgAgentForward`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!definition.requiresGuest`; `this.machines.state(id) !== 'running'`; `featureId === 'ssh-agent-forward'`.
   * 输入 / Inputs: id: string; featureId: CapabilityId; signal: AbortSignal optional
   * 输出 / Returns: `{ ready: true, executed: false, featureId, reason: '执行入口已实现；提交时验证所选目标与参数。', }`; `{ ready: false, executed: false, featureId, reason: '请先启动发行版。' }`; `{ featureId, ...await checkSshAgentForward(this.machines, id, signal) }`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `this.machines.exec`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async check(id: string, featureId: CapabilityId, signal?: AbortSignal) {
    this.machines.get(id);
    const definition = capabilityDefinitions[featureId];
    if (!definition.requiresGuest)
      return {
        ready: true,
        executed: false,
        featureId,
        reason: '执行入口已实现；提交时验证所选目标与参数。',
      };
    if (this.machines.state(id) !== 'running')
      return { ready: false, executed: false, featureId, reason: '请先启动发行版。' };
    if (featureId === 'ssh-agent-forward')
      return { featureId, ...await checkSshAgentForward(this.machines, id, signal) };
    if (featureId === 'gpg-agent-forward')
      return { featureId, ...await checkGpgAgentForward(this.machines, id, signal) };
    if (featureId === 'gpu-acceleration')
      return { featureId, ...await checkGpuAcceleration(this.machines, id, signal) };
    if (featureId === 'syscall-profile')
      return { featureId, ...await checkSyscallProfile(this.machines, id, signal) };
    if (featureId === 'flamegraph')
      return { featureId, ...await checkFlamegraph(this.machines, id, signal) };
    if (featureId === 'ebpf-profiler')
      return { featureId, ...await checkEbpfProfiler(this.machines, id, signal) };
    if (featureId === 'network-quota')
      return { featureId, ...await networkQuota(this.machines, id, {}, 'check', signal) };
    if (featureId === 'project-quota')
      return { featureId, ...await projectQuota(this.machines, this.workspaces, id, {}, 'check', signal) };
    if (featureId === 'guest-quota')
      return { featureId, ...await guestQuota(this.machines, this.workspaces, id, {}, 'check', signal) };
    if (featureId === 'egress-policy')
      return { featureId, ...await egressPolicy(this.machines, id, {}, 'check', signal) };
    if (featureId === 'nat-hairpin')
      return { featureId, ...await natHairpin(this.machines, id, {}, 'check', signal) };
    if (featureId === 'packet-capture') {
      const probe = await this.machines.exec(id,
        'python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)" && command -v tcpdump >/dev/null && tcpdump -D >/dev/null',
        10000, signal);
      return { ready: probe.code === 0, executed: false, featureId,
        reason: probe.code === 0 ? 'tcpdump 与 Python 已就绪；执行时验证网卡和抓包权限。' :
          '需要在客户机安装 tcpdump 与 Python 3.9+，并允许抓包。' };
    }
    if (reportCapabilities.has(featureId) || featureId === 'cross-vm-copy')
      return { ready: true, executed: false, featureId, reason: '实例已运行；执行时检查目标与采样结果。' };
    const probe = await this.machines.exec(
      id,
      'python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)"',
      10000,
      signal,
    );
    return {
      ready: probe.code === 0,
      executed: false,
      featureId,
      reason:
        probe.code === 0 ? '执行器已就绪；操作所需工具在执行时检查。' : '需要客户机 Python 3.9 或更高版本。',
    };
  }

  /**
   * 入口 / Entry: CapabilityActions.run.
   * 功能：按能力 ID 分派备份、网络、资源、分析等实际动作，校验参数和目标实例状态。
   * Purpose: Dispatches capability IDs to backup/network/resource/profiling effects after input and VM checks.
   * 设计：每个分支进入拥有该资源的领域服务；需要双流读取的操作等待两端，避免流失败变成未观察异常。
   * Design: Branches use the owning domain; paired streams are both awaited so a source failure is not left unobserved.
   * 输入 / Inputs: id: string; featureId: CapabilityId; input: unknown; signal: AbortSignal; options: { expectedLive?: ReturnType<Machines['live']['get']>; onEngineeringResult?: (result: … default={}
   * 输出 / Returns: `runSshAgentForward(this.machines, id, parameters, signal, this.workspaces, this.projectTerminals)`; `runGpgAgentForward(this.machines, id, parameters, signal, this.workspaces, this.projectTerminals)`; `runGpuAcceleration(this.machines, id, parameters, signal)`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `targets.push`; `seen.add`; `results.push`; `this.machines.start`; `started.push`; 更新 / updates `remaining`, `totalMatches`, `existing`.
   * 拒绝 / Refusals: 条件 / conditions `featureId === 'power-aware-schedule'`; `p.mode === 'save' && !p.policy`; `featureId === 'audit-log' || featureId === 'otel-tracing'`; 异常 / errors `new AppError('保存时需要提供电源策略')`; `new AppError('审计完整性校验失败：' + report.error, 409)`.
   * 失败处理：catch 分支执行 `if (error instanceof AppError && error.status === 503) throw error;`; `signal.throwIfAborted();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (error instanceof AppError && error.status === 503) throw error;`; `signal.throwIfAborted();`; these statements determine whether a failure is absorbed or rejected again.
   */
  async run(id: string, featureId: CapabilityId, input: unknown, signal: AbortSignal,
    options: { expectedLive?: ReturnType<Machines['live']['get']>;
      /**
       * 签名 / Signature: CapabilityActions.run.onEngineeringResult.
       * 功能：为检查并执行能力动作声明 onEngineeringResult 的输入与结果契约，所属容器为 CapabilityActions.run。
       * Purpose: Declares the input/result contract for onEngineeringResult in CapabilityActions.run. Module responsibility: Checks and executes capability actions, coordinating dependency order, VM state and domain execution entry points.
       * 输入 / Inputs: result: Record<string, unknown>
       * 输出 / Returns: Promise<void>.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      onEngineeringResult?: (result: Record<string, unknown>) => Promise<void> } = {}) {
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    const parameters = capabilityParameters(featureId, input);
    signal.throwIfAborted();
    if (featureId === 'ssh-agent-forward')
      return runSshAgentForward(this.machines, id, parameters, signal, this.workspaces, this.projectTerminals);
    if (featureId === 'gpg-agent-forward')
      return runGpgAgentForward(this.machines, id, parameters, signal, this.workspaces, this.projectTerminals);
    if (featureId === 'gpu-acceleration')
      return runGpuAcceleration(this.machines, id, parameters, signal);
    if (featureId === 'syscall-profile')
      return runSyscallProfile(this.machines, id, parameters, signal, this.workspaces);
    if (featureId === 'flamegraph')
      return runFlamegraph(this.machines, id, parameters, signal);
    if (featureId === 'ebpf-profiler')
      return runEbpfProfiler(this.machines, id, parameters, signal);
    if (featureId === 'network-quota')
      return { code: 0, ...await networkQuota(this.machines, id, parameters, 'run', signal) };
    if (featureId === 'project-quota')
      return { code: 0, ...await projectQuota(this.machines, this.workspaces, id, parameters, 'run', signal) };
    if (featureId === 'guest-quota')
      return { code: 0, ...await guestQuota(this.machines, this.workspaces, id, parameters, 'run', signal) };
    if (featureId === 'egress-policy')
      return { code: 0, ...await egressPolicy(this.machines, id, parameters, 'run', signal) };
    if (featureId === 'nat-hairpin')
      return { code: 0, ...await natHairpin(this.machines, id, parameters, 'run', signal) };
    if (featureId === 'power-aware-schedule') {
      const p = capabilityDefinitions[featureId].schema.parse(parameters);
      if (p.mode === 'save' && !p.policy) throw new AppError('保存时需要提供电源策略');
      const policy =
        p.mode === 'save'
          ? await this.machines.locked(`power-policy:${id}`, () => savePowerPolicy(id, p.policy))
          : await powerPolicy(id);
      const sample = await hostPower(signal);
      return {
        code: 0,
        ready: true,
        executed: true,
        policy,
        sample,
        decision: powerDecision(policy, sample),
      };
    }
    if (featureId === 'host-disk-health') {
      const report = await hostDiskHealth(parameters, signal);
      return {
        code: 0,
        ready: true,
        executed: true,
        ...report,
        download: {
          filename: 'sakura-disk-health.json',
          mime: 'application/json',
          content: JSON.stringify(report, null, 2),
        },
      };
    }
    if (featureId === 'availability-report') {
      const p = capabilityDefinitions[featureId].schema.parse(parameters);
      const report = await readAvailabilityReport(id, p.hours);
      return {
        code: 0,
        ready: true,
        executed: true,
        ...report,
        download: {
          filename: 'sakura-availability.json',
          mime: 'application/json',
          content: JSON.stringify(report, null, 2),
        },
      };
    }
    if (featureId === 'global-dedup') {
      const p = capabilityDefinitions[featureId].schema.parse(parameters);
      return {
        code: 0,
        ready: true,
        executed: true,
        ...(await backupBlocks().inspect(p.mode === 'collect', signal)),
      };
    }
    if (featureId === 'audit-log' || featureId === 'otel-tracing') {
      const p = capabilityDefinitions[featureId].schema.parse(parameters);
      const report = await hostAudit().read(p.limit, p.allMachines ? undefined : id);
      if (!report.valid) throw new AppError('审计完整性校验失败：' + report.error, 409);
      const content = featureId === 'otel-tracing' ? traceExport(report.records) : report;
      return {
        code: 0,
        ready: true,
        executed: true,
        ...report,
        download: {
          filename: featureId + '.json',
          mime: 'application/json',
          content: JSON.stringify(content, null, 2),
        },
      };
    }
    if (resourceCapabilities.has(featureId)) {
      const result = await resourceAction(this.machines, id, featureId, parameters, signal);
      return { code: 0, ready: true, executed: true, ...result };
    }
    if (featureId === 'crash-loop-guard') {
      const p = capabilityDefinitions[featureId].schema.parse(parameters);
      return {
        code: 0,
        ready: true,
        executed: true,
        ...(await this.machines.bootGuard(id, p.mode === 'reset')),
      };
    }
    if (featureId === 'maintenance-windows') {
      const p = capabilityDefinitions[featureId].schema.parse(parameters);
      const policy = await this.machines.locked(`automation-policy:${id}`, () =>
        p.mode === 'save'
          ? saveMaintenancePolicy(id, { enabled: p.enabled, windows: p.windows })
          : maintenancePolicy(id),
      );
      return { code: 0, ready: true, executed: true, policy, active: await inMaintenance(id) };
    }
    if (featureId === 'workspace-search') {
      const p = capabilityDefinitions[featureId].schema.parse(parameters);
      const targets = [...p.targets];
      if (!targets.length) {
        for (const vm of this.machines.records.values())
          if (this.machines.state(vm.id) === 'running') {
            const index = await this.workspaces.projects.list(vm.id);
            targets.push(...index.projects.map((project) => ({ vmId: vm.id, projectId: project.id })));
          }
      }
      if (!targets.length) throw new AppError('没有正在运行的可搜索项目', 409);
      if (targets.length > 32) throw new AppError('一次最多搜索 32 个项目，请明确选择 targets');
      const seen = new Set<string>(),
        results: Array<Record<string, any>> = [];
      let remaining = p.limit,
        totalMatches = 0;
      for (const target of targets) {
        signal.throwIfAborted();
        const key = target.vmId + ':' + target.projectId;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const vm = this.machines.get(target.vmId);
          if (this.machines.state(target.vmId) !== 'running') throw new AppError('实例没有运行');
          const result = await this.workspaces.projects.with(target.vmId, target.projectId, () =>
            runEngineeringOperation(
              this.machines,
              this.workspaces,
              target.vmId,
              'workspace-search',
              {
                query: p.query,
                caseSensitive: p.caseSensitive,
                limit: remaining,
              },
              signal,
            ),
          );
          remaining -= Array.isArray(result.matches) ? result.matches.length : 0;
          totalMatches += Number(result.totalMatches || 0);
          results.push({ ...target, vmName: vm.name, ...result });
        } catch (error) {
          if (error instanceof AppError && error.status === 503) throw error;
          signal.throwIfAborted();
          results.push({ ...target, code: 1, error: (error as Error).message });
        }
      }
      const success = results.every((item) => item.code === 0);
      return {
        code: success ? 0 : 1,
        ready: success,
        executed: true,
        totalMatches,
        truncated: totalMatches > p.limit,
        results,
      };
    }
    if (reportCapabilities.has(featureId)) {
      const result = await runReport(this.machines, this.workspaces, id, featureId, parameters, signal, this.editor);
      return { ...result, code: 0, ready: true, executed: true };
    }
    if (featureId === 'vm-dependency-start') {
      const p = capabilityDefinitions[featureId].schema.parse(parameters);
      const order = dependencyOrder(id, p.dependencies);
      for (const target of order) {
        this.machines.get(target);
        this.machines.requireUnlocked(target);
      }
      const started: string[] = [];
      for (const target of order) {
        signal.throwIfAborted();
        if (this.machines.state(target) === 'paused') throw new AppError('依赖实例已暂停：' + target, 409);
        const alreadyRunning = this.machines.state(target) === 'running';
        if (!alreadyRunning) {
          await this.machines.start(target);
          started.push(target);
        }
        const deadline = Date.now() + p.timeoutSeconds * 1000;
        while (this.machines.state(target) !== 'running') {
          signal.throwIfAborted();
          if (['error', 'stopped', 'stopping'].includes(this.machines.state(target)))
            throw new AppError('依赖实例启动失败：' + this.machines.get(target).name, 409);
          if (Date.now() >= deadline) throw new AppError('等待依赖实例就绪超时：' + target, 408);
          await delay(250, undefined, { signal });
        }
      }
      return { code: 0, ready: true, executed: true, order, started };
    }
    if (featureId === 'test-matrix' || featureId === 'environment-parity') {
      const p = parameters as {
        targets: Array<{ vmId: string; projectId: string }>;
        argv?: string[];
        timeout?: number;
      };
      const keys = p.targets.map((target) => target.vmId + ':' + target.projectId);
      if (new Set(keys).size !== keys.length) throw new AppError('目标实例与项目不能重复');
      for (const target of p.targets) {
        this.machines.get(target.vmId);
        this.machines.requireUnlocked(target.vmId);
        if (this.machines.state(target.vmId) !== 'running') throw new AppError('请先启动全部目标实例', 409);
      }
      const results: Array<Record<string, unknown>> = [];
      for (const target of p.targets) {
        signal.throwIfAborted();
        const operation = featureId === 'test-matrix' ? 'capability-command' : 'environment-fingerprint';
        const result = await this.workspaces.projects.with(target.vmId, target.projectId, () =>
          runEngineeringOperation(
            this.machines,
            this.workspaces,
            target.vmId,
            operation,
            featureId === 'test-matrix' ? { argv: p.argv!, timeout: p.timeout! } : {},
            signal,
          ),
        );
        results.push({ ...target, distro: this.machines.get(target.vmId).distro || 'alpine', ...result });
      }
      const failures = results.filter((value) => value.code !== 0);
      if (featureId === 'test-matrix')
        return { code: failures.length ? 1 : 0, ready: !failures.length, executed: true, results };
      const baseline = results[0].fingerprint as Record<string, unknown> | undefined;
      const differences = results.slice(1).map((item) => {
        const current = item.fingerprint as Record<string, unknown> | undefined;
        const keys = new Set([...Object.keys(baseline || {}), ...Object.keys(current || {})]);
        return {
          vmId: item.vmId,
          projectId: item.projectId,
          fields: [...keys].filter(
            (key) => JSON.stringify(baseline?.[key]) !== JSON.stringify(current?.[key]),
          ),
        };
      });
      return {
        code: failures.length ? 1 : 0,
        ready: !failures.length,
        executed: true,
        equal: !failures.length && differences.every((item) => !item.fields.length),
        results,
        differences,
      };
    }
    if (featureId === 'cross-vm-copy') {
      const p = capabilityDefinitions[featureId].schema.parse(parameters);
      if (id === p.targetVmId) throw new AppError('跨实例复制需要两个不同实例');
      this.machines.get(p.targetVmId);
      this.machines.requireUnlocked(p.targetVmId);
      const sourceProject = await this.workspaces.config(id);
      /**
       * 入口 / Entry: CapabilityActions.run.callback@395.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.workspaces.projects.with）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.workspaces.projects.with).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `{ code: 0, ready: true, executed: true, source, target, ...copied, sha256 }`.
       * 副作用 / Effects: `createHash`.
       * 拒绝 / Refusals: 条件 / conditions `verification.digest('hex') !== sha256`; 异常 / errors `new AppError('目标文件校验失败', 409)`.
       */
      return this.workspaces.projects.with(p.targetVmId, p.targetProjectId, async () => {
        const targetProject = await this.workspaces.config(p.targetVmId);
        const source = posix.join(sourceProject.directory, p.source),
          target = posix.join(targetProject.directory, p.target);
        await this.checkFilePath(p.targetVmId, target, false, signal);
        await this.checkFilePath(id, source, true, signal);
        const digest = createHash('sha256');
        /**
         * 入口 / Entry: CapabilityActions.run.callback@404.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
         * 输入 / Inputs: ftp
         * 输出 / Returns: `(results[0] as PromiseFulfilledResult<{ bytes: number }>).value`.
         * 副作用 / Effects: `ftp.createReadStream`; `AbortSignal.any`; `Files.upload().catch`; `Files.upload`.
         * 拒绝 / Refusals: 条件 / conditions `!before?.isFile()`; `result.status === 'rejected'`; 异常 / errors `new AppError('源文件不存在或不是普通文件')`; `result.reason`.
         */
        const copied = await this.machines.sftp(
          id,
          async (ftp) => {
            const before = await ftpStat(ftp, source);
            if (!before?.isFile()) throw new AppError('源文件不存在或不是普通文件');
            const stream = ftp.createReadStream(source);
            const checked = new Transform({
              /**
               * 入口 / Entry: CapabilityActions.run.transform.
               * 功能：在检查并执行能力动作中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`CapabilityActions`）。
               * Purpose: Executes the domain-specific processing steps and returns their outcome in `CapabilityActions`; the calls and state transitions below complete the operation. Module context: Checks and executes capability actions, coordinating dependency order, VM state and domain execution entry points.
               * 处理：通过 `digest.update`, `done` 协调依赖；下列分支决定是否继续、返回或拒绝。
               * Processing: Coordinates its dependencies through `digest.update`, `done`; the branches below determine continuation, return or refusal.
               * 输入 / Inputs: chunk; _encoding; done
               * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
               * 副作用 / Effects: `digest.update`.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              transform(chunk, _encoding, done) {
                digest.update(chunk);
                done(null, chunk);
              },
              /**
               * 入口 / Entry: CapabilityActions.run.flush.
               * 功能：在检查并执行能力动作中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`CapabilityActions`）。
               * Purpose: Executes the domain-specific processing steps and returns their outcome in `CapabilityActions`; the calls and state transitions below complete the operation. Module context: Checks and executes capability actions, coordinating dependency order, VM state and domain execution entry points.
               * 处理：通过 `ftpStat().then`, `ftpStat` 协调依赖；下列分支决定是否继续、返回或拒绝。
               * Processing: Coordinates its dependencies through `ftpStat().then`, `ftpStat`; the branches below determine continuation, return or refusal.
               * 输入 / Inputs: done
               * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
               * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              flush(done) {
                ftpStat(ftp, source).then((after) => {
                  done(
                    !after?.isFile() || after.size !== before.size || after.mtime !== before.mtime
                      ? new AppError('复制过程中源文件发生变化，请重试', 409)
                      : undefined,
                  );
                }, done);
              },
            });
            // Both branches are awaited: a source failure must not become an unhandled stream error.
            const transfer = new AbortController();
            const transferSignal = AbortSignal.any([signal, transfer.signal]);
            /**
             * 入口 / Entry: CapabilityActions.run.fail.
             * 功能：在检查并执行能力动作中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`CapabilityActions`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `CapabilityActions`; the calls and state transitions below complete the operation. Module context: Checks and executes capability actions, coordinating dependency order, VM state and domain execution entry points.
             * 处理：通过 `transfer.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `transfer.abort`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: error: unknown
             * 输出 / Returns: never.
             * 副作用 / Effects: `transfer.abort`.
             * 拒绝 / Refusals: 异常 / errors `error`.
             */
            const fail = (error: unknown): never => {
              transfer.abort();
              throw error;
            };
            const uploading = new Files(this.machines)
              .upload(p.targetVmId, target, checked, false, transferSignal)
              .catch(fail);
            const feeding = pipeline(stream, checked, { signal: transferSignal }).catch(fail);
            const results = await Promise.allSettled([uploading, feeding]);
            for (const result of results) if (result.status === 'rejected') throw result.reason;
            return (results[0] as PromiseFulfilledResult<{ bytes: number }>).value;
          },
          signal,
        );
        const sha256 = digest.digest('hex'),
          verification = createHash('sha256');
        /**
         * 入口 / Entry: CapabilityActions.run.callback@444.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
         * 输入 / Inputs: ftp
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `ftp.createReadStream`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        await this.machines.sftp(
          p.targetVmId,
          async (ftp) => {
            await pipeline(
              ftp.createReadStream(target),
              new Writable({
                /**
                 * 入口 / Entry: CapabilityActions.run.write.
                 * 功能：在检查并执行能力动作中，校验并提交领域状态变更；完成下述调用及状态处理（`CapabilityActions`）。
                 * Purpose: Validates and commits a domain state change in `CapabilityActions`; the calls and state transitions below complete the operation. Module context: Checks and executes capability actions, coordinating dependency order, VM state and domain execution entry points.
                 * 处理：通过 `verification.update`, `done` 协调依赖；下列分支决定是否继续、返回或拒绝。
                 * Processing: Coordinates its dependencies through `verification.update`, `done`; the branches below determine continuation, return or refusal.
                 * 输入 / Inputs: chunk; _encoding; done
                 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
                 * 副作用 / Effects: `verification.update`.
                 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                 */
                write(chunk, _encoding, done) {
                  verification.update(chunk);
                  done();
                },
              }),
              { signal },
            );
          },
          signal,
        );
        if (verification.digest('hex') !== sha256) throw new AppError('目标文件校验失败', 409);
        return { code: 0, ready: true, executed: true, source, target, ...copied, sha256 };
      });
    }
    if (featureId === 'git-worktrees') {
      const p = capabilityDefinitions[featureId].schema.parse(parameters);
      const config = await this.workspaces.config(id);
      const index = await this.workspaces.projects.list(id);
      let existing: { id: string; name: string } | undefined;
      if (p.mode === 'open' || p.mode === 'remove') {
        for (const item of index.projects) {
          const candidate = await this.workspaces.projects.with(id, item.id, () =>
            this.workspaces.config(id),
          );
          if (candidate.directory === p.directory) {
            existing = item;
            break;
          }
        }
        if (p.mode === 'remove' && existing)
          throw new AppError('该目录仍被项目引用，请先更改项目目录：' + existing.name, 409);
      }
      /**
       * 入口 / Entry: CapabilityActions.run.callback@480.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `{ ...result, ready: result.code === 0, executed: true }`.
       * 副作用 / Effects: `this.workspaces.projects.update`; `this.workspaces.projects.create`; 更新 / updates `result.projectId`.
       * 拒绝 / Refusals: 条件 / conditions `result.code === 0 && p.mode === 'open'`; `typeof result.directory !== 'string' || result.directory !== p.directory`; 异常 / errors `new AppError('工作树目录校验失败')`.
       */
      return this.machines.locked('capability:' + this.workspaces.projects.key(id), async () => {
        const result = await runEngineeringOperation(
          this.machines,
          this.workspaces,
          id,
          featureId,
          parameters,
          signal,
        );
        if (result.code === 0 && p.mode === 'open') {
          if (typeof result.directory !== 'string' || result.directory !== p.directory)
            throw new AppError('工作树目录校验失败');
          signal.throwIfAborted();
          if (existing) {
            await this.workspaces.projects.update(id, existing.id);
            result.projectId = existing.id;
          } else {
            const { _workspace, ...plain } = config;
            const opened = await this.workspaces.projects.create(
              id,
              p.projectName || posix.basename(result.directory).slice(0, 64),
              async () => {
                await this.workspaces.save(id, { ...plain, directory: result.directory });
              },
            );
            result.projectId = opened.active;
          }
        }
        return { ...result, ready: result.code === 0, executed: true };
      });
    }
    /**
     * 入口 / Entry: CapabilityActions.run.engineeringResult.
     * 功能：从当前输入或状态计算 `({ ...result, ready: result.code === 0, executed: true, ...(featureId === 'network-topology' ? { forwards: this.machines.get(…`，供调用方后续验证或使用。
     * Purpose: Computes `({ ...result, ready: result.code === 0, executed: true, ...(featureId === 'network-topology' ? { forwards: this.machines.get(…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: result: Record<string, unknown>
     * 输出 / Returns: `({ ...result, ready: result.code === 0, executed: true, ...(featureId === 'network-topology' ? { forwards: this.machines.get(…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const engineeringResult = (result: Record<string, unknown>) => ({ ...result,
      ready: result.code === 0, executed: true,
      ...(featureId === 'network-topology' ? { forwards: this.machines.get(id).forwards } : {}) });
    const result = await this.machines.locked('capability:' + this.workspaces.projects.key(id), () => {
      if (Object.hasOwn(options, 'expectedLive') && this.machines.live.get(id) !== options.expectedLive)
        throw new AppError('工程任务客户机运行身份与原开发任务不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      return runEngineeringOperation(this.machines, this.workspaces, id, featureId, parameters, signal,
        { ...(this.projectTerminals ? { terminals: this.projectTerminals } : {}),
          onResult: options.onEngineeringResult ? result => options.onEngineeringResult!(engineeringResult(result)) : undefined });
    });
    return {
      ...result,
      ready: result.code === 0,
      executed: true,
      ...(featureId === 'network-topology' ? { forwards: this.machines.get(id).forwards } : {}),
    };
  }

  /**
   * 入口 / Entry: CapabilityActions.checkFilePath.
   * 功能：在检查并执行能力动作中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`CapabilityActions`）。
   * Purpose: Checks admission, input or resource ownership in `CapabilityActions`; the calls and state transitions below complete the operation. Module context: Checks and executes capability actions, coordinating dependency order, VM state and domain execution entry points.
   * 处理：通过 `this.machines.sftp` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.sftp`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; path: string; required: boolean; signal: AbortSignal
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async checkFilePath(id: string, path: string, required: boolean, signal: AbortSignal) {
    /**
     * 入口 / Entry: CapabilityActions.checkFilePath.callback@532.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
     * 输入 / Inputs: ftp
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!info`; `info.isSymbolicLink() || (last ? !info.isFile() : !info.isDirectory())`; `last && !required`; 异常 / errors `new AppError('路径不存在：' + current)`; `new AppError('路径包含链接或非普通文件：' + current)`.
     */
    await this.machines.sftp(
      id,
      async (ftp) => {
        const parts = posix.normalize(path).split('/').filter(Boolean);
        for (let index = 0; index < parts.length; index++) {
          const current = '/' + parts.slice(0, index + 1).join('/');
          const info = await ftpStat(ftp, current),
            last = index === parts.length - 1;
          if (!info) {
            if (last && !required) return;
            throw new AppError('路径不存在：' + current);
          }
          if (info.isSymbolicLink() || (last ? !info.isFile() : !info.isDirectory()))
            throw new AppError('路径包含链接或非普通文件：' + current);
          if (last && !required) throw new AppError('目标已存在，拒绝覆盖', 409);
        }
      },
      signal,
    );
  }
}
