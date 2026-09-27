import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { AppError } from './model.ts';
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

export function dependencyOrder(root: string, graph: Record<string, string[]>) {
  const visiting = new Set<string>(),
    visited = new Set<string>(),
    order: string[] = [];
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
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {}

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
    if (featureId === 'flamegraph')
      return { featureId, ...await checkFlamegraph(this.machines, id, signal) };
    if (featureId === 'ebpf-profiler')
      return { featureId, ...await checkEbpfProfiler(this.machines, id, signal) };
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

  async run(id: string, featureId: CapabilityId, input: unknown, signal: AbortSignal) {
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    const parameters = capabilityParameters(featureId, input);
    signal.throwIfAborted();
    if (featureId === 'flamegraph')
      return runFlamegraph(this.machines, id, parameters, signal);
    if (featureId === 'ebpf-profiler')
      return runEbpfProfiler(this.machines, id, parameters, signal);
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
      const result = await runReport(this.machines, this.workspaces, id, featureId, parameters, signal);
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
      return this.workspaces.projects.with(p.targetVmId, p.targetProjectId, async () => {
        const targetProject = await this.workspaces.config(p.targetVmId);
        const source = posix.join(sourceProject.directory, p.source),
          target = posix.join(targetProject.directory, p.target);
        await this.checkFilePath(p.targetVmId, target, false, signal);
        await this.checkFilePath(id, source, true, signal);
        const digest = createHash('sha256');
        const copied = await this.machines.sftp(
          id,
          async (ftp) => {
            const before = await ftpStat(ftp, source);
            if (!before?.isFile()) throw new AppError('源文件不存在或不是普通文件');
            const stream = ftp.createReadStream(source);
            const checked = new Transform({
              transform(chunk, _encoding, done) {
                digest.update(chunk);
                done(null, chunk);
              },
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
        await this.machines.sftp(
          p.targetVmId,
          async (ftp) => {
            await pipeline(
              ftp.createReadStream(target),
              new Writable({
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
    const result = await this.machines.locked('capability:' + this.workspaces.projects.key(id), () =>
      runEngineeringOperation(this.machines, this.workspaces, id, featureId, parameters, signal),
    );
    return {
      ...result,
      ready: result.code === 0,
      executed: true,
      ...(featureId === 'network-topology' ? { forwards: this.machines.get(id).forwards } : {}),
    };
  }

  private async checkFilePath(id: string, path: string, required: boolean, signal: AbortSignal) {
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
