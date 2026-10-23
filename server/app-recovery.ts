/** 冷备严格关闭 VM，保留启动转换回执；恢复仅创建独立实例。 */
import type { PluginMetadata } from './plugin-metadata.ts';
import type { AppTargetsV1, AppRoutesV1, AppDataV1 } from './service-contracts/app-runtime.ts';
import type { WorkspacesV1, BackupsV1 } from './service-contracts/v1.ts';
import type { VmAccess } from './vm-access.ts';
import { appActionSchemas, type AppAction } from '../shared/contracts/app-http.ts';
import {
  appCheckpointSchema,
  appBackupPolicySchema,
  type AppCheckpoint,
} from '../shared/contracts/app-runtime.ts';
import { z } from 'zod';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import { AppStore, appNow, appNewId, appView, appRequire, appHash } from './app-store.ts';
import { appTarget, appCheck, appRunProject, appWaitRunning, appExec } from './app-runtime.ts';
import { Jobs } from './jobs.ts';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
export class AppRecovery {
  readonly jobs = new Jobs('app-recovery');
  private store: AppStore<AppCheckpoint>;
  private policies: AppStore<z.infer<typeof appBackupPolicySchema>>;
  private schedule?: ScheduleHandle;
  constructor(
    metadata: PluginMetadata,
    private machines: VmAccess,
    private targets: AppTargetsV1,
    private workspaces: WorkspacesV1,
    private backups: BackupsV1,
    private routes: AppRoutesV1,
    private authorize: () => Promise<void>,
    private data: AppDataV1,
    policyMetadata: PluginMetadata,
  ) {
    this.store = new AppStore(metadata, appCheckpointSchema, authorize);
    this.policies = new AppStore(policyMetadata, appBackupPolicySchema, authorize);
  }
  async init() {
    await this.store.write((rows) => {
      for (const r of rows) if (!['ready', 'failed', 'unknown'].includes(r.state)) r.state = 'unknown';
    });
    this.schedule = scheduler.register({
      owner: 'plugin:app-recovery',
      label: '停止应用的定时冷备',
      intervalMs: 60000,
      overlap: 'skip',
      catchUp: 'once',
      run: async ({ signal }) => {
        for (const policy of await this.policies.read()) {
          signal.throwIfAborted();
          if (!policy.enabled || Date.parse(policy.nextAt) > Date.now()) continue;
          const t = await appTarget(this.targets, policy.appId);
          if (
            t.desired !== 'stopped' ||
            t.lease ||
            t.transition ||
            this.machines.state(t.vmId) !== 'running'
          ) {
            await this.policies.write((rows) => {
              rows.find((r) => r.id === policy.id)!.reason = '等待：只在应用已停止、VM 已运行且无变更时执行';
            });
            continue;
          }
          const operationId = appNewId();
          try {
            await this.targets.act(policy.appId, {
              action: 'claim',
              operationId,
              planDigest: appHash([policy.id, policy.nextAt]),
              expectedRevision: t.revision,
              expectedBootId: t.bootId,
              expectedDiskIdentity: t.diskIdentity,
            });
            const owned = await appTarget(this.targets, policy.appId),
              leaseId = owned.lease!.id;
            const checkpoint = await this.checkpoint(policy.appId, leaseId, 'app-recovery');
            await this.targets.act(policy.appId, { action: 'release', leaseId });
            await this.policies.write((rows) =>
              Object.assign(
                rows.find((r) => r.id === policy.id)!,
                {
                  lastAt: appNow(),
                  lastCheckpointId: checkpoint.id,
                  nextAt: new Date(Date.now() + policy.intervalHours * 3600000).toISOString(),
                  reason: '已完成 VM 关机冷备、完整校验和受控重启',
                },
              ),
            );
          } catch (error) {
            await this.policies.write((rows) =>
              Object.assign(
                rows.find((r) => r.id === policy.id)!,
                {
                  enabled: false,
                  reason: '定时冷备暂停，需核销原操作：' + (error as Error).message.slice(0, 1800),
                },
              ),
            );
          }
        }
      },
    });
  }
  async view(appId?: string) {
    return appView({
      checkpoints: await this.store.read(appId),
      backupPolicies: await this.policies.read(appId),
    });
  }
  private async update(id: string, value: Partial<AppCheckpoint>) {
    await this.store.write((rows) => {
      Object.assign(
        appRequire(
          rows.find((r) => r.id === id),
          '检查点不存在',
        ),
        value,
      );
    });
  }
  async checkpoint(appId: string, leaseId: string, managedBy: 'app-recovery' | 'app-deploy' = 'app-deploy') {
    let t = await appTarget(this.targets, appId);
    if (t.lease?.id !== leaseId) throw new AppError('冷备变更租约失效', 409);
    await this.authorize();
    await appCheck(this.machines, t);
    const row: AppCheckpoint = {
      appId,
      id: appNewId(),
      vmId: t.vmId,
      vmCreatedAt: t.vmCreatedAt,
      diskIdentity: t.diskIdentity,
      state: 'planned',
      managedBy,
      fromBootId: t.bootId,
      createdAt: appNow(),
      datasets: (await this.data.view(appId)).datasets,
    };
    await this.store.write((rows) => {
      rows.push(row);
    });
    try {
      const route = (await this.routes.view(appId)).routes.at(-1);
      if (route?.state === 'open')
        await this.routes.act(appId, { action: 'drain', expectedRevision: route.revision });
      await this.update(row.id, { state: 'stopping' });
      await appRunProject(this.machines, this.workspaces, t, 'stop');
      await appExec(
        this.machines,
        t,
        `python3 -I -S -c ${quote('import os,stat\np=' + JSON.stringify(t.directory + '/runtime.env') + '\nif os.path.lexists(p):\n s=os.lstat(p)\n assert stat.S_ISREG(s.st_mode) and not stat.S_ISLNK(s.st_mode)\n os.unlink(p)')}`,
      );
      await this.targets.act(appId, { action: 'begin-boot' });
      await this.machines.stop(t.vmId);
      this.machines.requireStopped(t.vmId);
      await appCheck(this.machines, t, false);
      await this.targets.act(appId, { action: 'boot-stopped' });
      const previous = new Set((await this.backups.view(t.vmId)).items.map((b) => b.id));
      await this.update(row.id, { state: 'backing-up' });
      const job = await this.backups.run(t.vmId);
      await this.backups.jobs.wait(job.key || t.vmId);
      if (this.backups.jobs.view(job.key || t.vmId)?.status !== 'done')
        throw new AppError('冷备任务失败，实例保持停止待核销', 409);
      const backup = appRequire(
        (await this.backups.view(t.vmId)).items.find((b) => !previous.has(b.id)),
        '备份未发布新的完整记录',
      );
      await this.update(row.id, { state: 'verifying', backupId: backup.id });
      const verify = await this.backups.operate(t.vmId, backup.id, 'verify');
      if ('key' in verify) {
        await this.backups.jobs.wait(verify.key || t.vmId);
        if (this.backups.jobs.view(verify.key || t.vmId)?.status !== 'done')
          throw new AppError('备份完整性校验失败', 409);
      }
      const checked = appRequire(
        (await this.backups.view(t.vmId)).items.find((b) => b.id === backup.id && b.verifiedAt && !b.error),
        '备份未通过完整性验证',
      );
      await this.update(row.id, { state: 'restarting', checksum: checked.checksum });
      await this.targets.act(appId, { action: 'boot-backed-up', backupId: checked.id });
      await this.authorize();
      await appCheck(this.machines, t, false);
      await this.machines.start(t.vmId);
      await appWaitRunning(this.machines, t.vmId);
      await this.targets.act(appId, { action: 'complete-boot' });
      await this.targets.act(appId, { action: 'desired', value: 'stopped' });
      t = await appTarget(this.targets, appId);
      await this.update(row.id, { state: 'ready', toBootId: t.bootId });
      return appRequire(
        (await this.store.read(appId)).find((r) => r.id === row.id),
        '检查点不存在',
      );
    } catch (error) {
      await this.update(row.id, { state: 'unknown', error: (error as Error).message.slice(0, 2000) });
      throw error;
    }
  }
  async act(appId: string, raw: AppAction) {
    const input = appActionSchemas.recovery.parse(raw);
    await this.authorize();
    if (input.action === 'rebind-preview') {
      return this.targets.act(appId, { action: 'preview-rebind' });
    }
    if (input.action === 'rebind') {
      this.jobs.start(
        input.id,
        async () => {
          await this.targets.act(appId, { action: 'begin-rebind', id: input.id, digest: input.digest });
          const t = await appTarget(this.targets, appId),
            plan = t.rebind!;
          const current = { ...t, bootId: plan.toBootId };
          // 新 boot 已证明旧内核退出；仍准确关闭旧入口并清除当前项目残留，再提交新基线。
          const route = (await this.routes.view(appId)).routes.at(-1);
          if (route) await this.routes.act(appId, { action: 'close', expectedRevision: route.revision });
          await appRunProject(this.machines, this.workspaces, current, 'stop');
          await appExec(
            this.machines,
            current,
            `python3 -I -S -c ${quote('import os,stat\np=' + JSON.stringify(t.directory + '/runtime.env') + '\nif os.path.lexists(p):\n s=os.lstat(p)\n assert stat.S_ISREG(s.st_mode) and not stat.S_ISLNK(s.st_mode)\n os.unlink(p)')}`,
          );
          await this.targets.act(appId, { action: 'complete-rebind', id: input.id, leaseId: t.lease!.id });
        },
        { title: '核销重启前的应用并重新绑定', action: 'rebind' },
      );
      return appView({ ...(await this.targets.view(appId)), selectedId: input.id });
    }
    if (input.action === 'schedule') {
      await appTarget(this.targets, appId);
      await this.policies.write((rows) => {
        const row = rows.find((r) => r.appId === appId),
          value = {
            appId,
            id: row?.id || appNewId(),
            enabled: input.enabled,
            intervalHours: input.intervalHours,
            nextAt: new Date(Date.now() + input.intervalHours * 3600000).toISOString(),
            reason: '只对已停止应用执行；运行中跳过，不自动停止业务',
          };
        if (row) Object.assign(row, value);
        else rows.push(value);
      });
      return this.view(appId);
    }
    if (input.action === 'checkpoint') {
      const operationId = appNewId();
      this.jobs.start(
        operationId,
        async () => {
          let t = await appTarget(this.targets, appId);
          if (!input.leaseId) {
            await this.targets.act(appId, {
              action: 'claim',
              operationId,
              planDigest: appHash([appId, 'checkpoint', operationId]),
              expectedRevision: t.revision,
              expectedBootId: t.bootId,
              expectedDiskIdentity: t.diskIdentity,
            });
            t = await appTarget(this.targets, appId);
          }
          const leaseId = input.leaseId || t.lease!.id;
          await this.checkpoint(appId, leaseId, 'app-recovery');
          if (!input.leaseId) await this.targets.act(appId, { action: 'release', leaseId });
        },
        { title: '应用关机冷备', action: 'checkpoint' },
      );
      return appView({ ...(await this.view(appId)), selectedId: operationId });
    }
    const c = appRequire(
      (await this.store.read(appId)).find((r) => r.id === input.id),
      '检查点不存在',
    );
    if (this.machines.get(c.vmId).createdAt !== c.vmCreatedAt)
      throw new AppError('检查点原 VM 身份变化', 409);
    if (input.action === 'reconcile') {
      if (!c.backupId) throw new AppError('没有已确认备份，须保留原记录并检查实例', 409);
      const item = (await this.backups.view(c.vmId)).items.find((b) => b.id === c.backupId);
      if (!item?.verifiedAt || item.error) throw new AppError('检查点尚未校验', 409);
      let t = await appTarget(this.targets, appId);
      if (c.activationOperationId && t.lease?.operationId === c.activationOperationId) {
        if (this.jobs.view(c.activationOperationId)?.status === 'running')
          throw new AppError('恢复交接仍在执行', 409);
        if (t.vmId === c.restoredVmId && t.vmCreatedAt === c.restoredCreatedAt) {
          await appCheck(this.machines, t);
          await this.data.act(appId, {
            action: 'restore-catalog',
            datasets: c.datasets,
            leaseId: t.lease.id,
          });
          await this.update(c.id, { activatedAt: appNow() });
        } else {
          await appCheck(this.machines, t, false);
          const restored = this.machines.get(c.restoredVmId!);
          if (restored.createdAt !== c.restoredCreatedAt) throw new AppError('恢复副本已替换', 409);
          if (this.machines.live.has(restored.id)) await this.machines.stop(restored.id);
          this.machines.requireStopped(restored.id);
          await this.targets.act(appId, { action: 'desired', value: 'stopped' });
        }
        await this.targets.act(appId, { action: 'release', leaseId: t.lease.id });
        return this.view(appId);
      }
      if (c.state === 'unknown' && t.vmId === c.vmId && t.transition && t.lease) {
        if (this.jobs.view(t.lease.operationId)?.status === 'running')
          throw new AppError('冷备仍在执行', 409);
        await appCheck(this.machines, t, false);
        if (t.transition.state === 'intent' && this.machines.state(t.vmId) === 'stopped')
          await this.targets.act(appId, { action: 'boot-stopped' });
        t = await appTarget(this.targets, appId);
        if (t.transition!.state === 'stopped')
          await this.targets.act(appId, { action: 'boot-backed-up', backupId: item.id });
        if (this.machines.state(t.vmId) === 'stopped') {
          await this.machines.start(t.vmId);
          await appWaitRunning(this.machines, t.vmId);
        }
        await this.targets.act(appId, { action: 'complete-boot' });
        await this.targets.act(appId, { action: 'desired', value: 'stopped' });
        t = await appTarget(this.targets, appId);
        await this.update(c.id, {
          state: 'ready',
          toBootId: t.bootId,
          checksum: item.checksum,
          error: undefined,
        });
        if (c.managedBy === 'app-recovery')
          await this.targets.act(appId, { action: 'release', leaseId: t.lease!.id });
      }
      return this.view(appId);
    }
    if (input.action === 'activate-restored') {
      if (!c.restoredVmId || !c.restoredCreatedAt) throw new AppError('检查点没有已确认恢复副本', 409);
      const t = await appTarget(this.targets, appId);
      if (t.lease || t.transition) throw new AppError('原目标变更尚未核销', 409);
      if (c.activatedAt) throw new AppError('恢复副本已交接', 409);
      const operationId = appNewId();
      await this.targets.act(appId, {
        action: 'claim',
        operationId,
        planDigest: appHash([c.id, c.checksum, c.restoredVmId, c.restoredCreatedAt]),
        expectedRevision: t.revision,
        expectedBootId: t.bootId,
        expectedDiskIdentity: t.diskIdentity,
        allowStopped: true,
      });
      const leaseId = (await appTarget(this.targets, appId)).lease!.id;
      await this.update(c.id, { activationOperationId: operationId });
      this.jobs.start(
        operationId,
        async () => {
          await this.authorize();
          await appCheck(this.machines, t, this.machines.state(t.vmId) === 'running');
          const route = (await this.routes.view(appId)).routes.at(-1);
          if (route) await this.routes.act(appId, { action: 'close', expectedRevision: route.revision });
          if (this.machines.state(t.vmId) === 'running') {
            await appRunProject(this.machines, this.workspaces, t, 'stop');
            await this.machines.stop(t.vmId);
          }
          this.machines.requireStopped(t.vmId);
          const vm = this.machines.get(c.restoredVmId!);
          if (vm.createdAt !== c.restoredCreatedAt) throw new AppError('恢复副本已替换', 409);
          await this.machines.isolateStopped(vm.id, vm.createdAt);
          if (this.machines.get(vm.id).managedNetwork !== 'isolated')
            throw new AppError('恢复副本未固化隔离', 409);
          await this.machines.start(vm.id);
          await appWaitRunning(this.machines, vm.id);
          await this.targets.act(appId, {
            action: 'relocate',
            leaseId,
            vmId: vm.id,
            vmCreatedAt: vm.createdAt,
            originalVmId: t.vmId,
            originalCreatedAt: t.vmCreatedAt,
          });
          await this.data.act(appId, { action: 'restore-catalog', datasets: c.datasets, leaseId });
          await this.update(c.id, { activatedAt: appNow() });
          await this.targets.act(appId, { action: 'release', leaseId });
        },
        { title: '恢复副本交接', action: 'activate-restored' },
      );
      return appView({ ...(await this.view(appId)), selectedId: operationId });
    }
    if (!c.backupId) throw new AppError('检查点未完成', 409);
    const before = new Set(this.machines.records.keys());
    const work = await this.backups.operate(
      c.vmId,
      c.backupId,
      input.action === 'verify' ? 'verify' : 'restore',
      input.action === 'restore' ? input.name : undefined,
    );
    if ('key' in work) {
      await this.backups.jobs.wait(work.key || c.vmId);
      if (this.backups.jobs.view(work.key || c.vmId)?.status !== 'done')
        throw new AppError('备份验证或恢复失败', 409);
    }
    if (input.action === 'restore') {
      const restored = [...this.machines.records.values()].filter(
        (v) => !before.has(v.id) && v.name === input.name,
      );
      if (restored.length !== 1) throw new AppError('恢复目标身份不明确，拒绝登记', 409);
      this.machines.requireStopped(restored[0].id);
      await this.machines.isolateStopped(restored[0].id, restored[0].createdAt);
      await this.update(c.id, { restoredVmId: restored[0].id, restoredCreatedAt: restored[0].createdAt });
    }
    return this.view(appId);
  }
  async close() {
    await this.schedule?.close();
    await this.jobs.close();
  }
}
