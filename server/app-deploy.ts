/** 不可变计划、审批与真实安装事务；健康、运行和清理分别记录。 */
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type {
  AppTargetsV1,
  AppPackagesV1,
  AppConfigV1,
  AppDataV1,
  AppObserveV1,
  AppRoutesV1,
  AppRecoveryV1,
} from './service-contracts/app-runtime.ts';
import { appActionSchemas, type AppAction } from '../shared/contracts/app-http.ts';
import {
  appPlanSchema,
  appInstallationSchema,
  appOperationSchema,
  type AppPlan,
  type AppInstallation,
  type AppOperation,
  type AppTarget,
  type AppPackage,
  type AppConfig,
} from '../shared/contracts/app-runtime.ts';
import { AppStore, appHash, appNow, appNewId, appView, appRequire } from './app-store.ts';
import {
  appTarget,
  appCheck,
  appExec,
  appOwnDirectory,
  appRunProject,
  appUserExec,
  appWrite,
  appEnvFile,
  appProject,
} from './app-runtime.ts';
import { Jobs } from './jobs.ts';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
export class AppDeploy {
  readonly jobs = new Jobs('app-deploy');
  private plans: AppStore<AppPlan>;
  private installations: AppStore<AppInstallation>;
  private operations: AppStore<AppOperation>;
  private reconciling = new Set<string>();
  constructor(
    metadata: { plans: PluginMetadata; installations: PluginMetadata; operations: PluginMetadata },
    private machines: VmAccess,
    private workspaces: WorkspacesV1,
    private targets: AppTargetsV1,
    private packages: AppPackagesV1,
    private config: AppConfigV1,
    private data: AppDataV1,
    private observe: AppObserveV1,
    private routes: AppRoutesV1,
    private recovery: AppRecoveryV1,
    private authorize: () => Promise<void>,
  ) {
    this.plans = new AppStore(metadata.plans, appPlanSchema, authorize);
    this.installations = new AppStore(metadata.installations, appInstallationSchema, authorize);
    this.operations = new AppStore(metadata.operations, appOperationSchema, authorize);
  }
  async init() {
    await this.installations.write((rows) => {
      for (const i of rows) if (i.state === 'running') i.state = 'unknown';
    });
    await this.operations.write((rows) => {
      for (const r of rows)
        if (r.status === 'queued' || r.status === 'running') {
          r.status = 'unknown';
          r.cleanup = 'unknown';
          r.error = '控制器中断，须核销原身份';
        }
    });
  }
  async view(appId?: string) {
    return appView({
      plans: await this.plans.read(appId),
      installations: await this.installations.read(appId),
      operations: await this.operations.read(appId),
    });
  }
  private async update(id: string, patch: Partial<AppOperation>) {
    await this.operations.write((rows) => {
      Object.assign(
        appRequire(
          rows.find((r) => r.id === id),
          '操作记录不存在',
        ),
        patch,
      );
    });
  }
  async act(appId: string, raw: AppAction) {
    const input = appActionSchemas.deploy.parse(raw);
    await this.authorize();
    if (input.action === 'preview') {
      const t = await appTarget(this.targets, appId);
      await appCheck(this.machines, t);
      if (t.lease || t.transition) throw new AppError('先核销原操作或启动转换', 409);
      const installed = (await this.installations.read(appId))
          .filter((i) => i.state === 'running' || i.state === 'stopped')
          .at(-1),
        running = (await this.installations.read(appId)).find((i) => i.state === 'running');
      const packageNeeded = ['install', 'upgrade', 'rollback'].includes(input.kind);
      const pkg = packageNeeded
        ? appRequire(
            (await this.packages.view(appId)).packages.find((p) => p.id === input.packageId && !p.archived),
            '请选择可用的安装包',
          )
        : null;
      const cfg = packageNeeded
        ? appRequire(
            (await this.config.view(appId)).configs.find((c) => c.id === input.configId),
            '请选择配置修订',
          )
        : null;
      if (input.kind === 'install' && running) throw new AppError('应用已运行，请选择升级', 409);
      if (input.kind === 'upgrade' && !installed) throw new AppError('没有可升级的安装记录', 409);
      if (pkg) await this.packages.files(appId, pkg.id);
      if (cfg) await this.config.resolve(appId, cfg.id);
      const datasets = (await this.data.view(appId)).datasets;
      if (input.kind === 'rollback') {
        const old = (await this.installations.read(appId)).find((i) => i.packageId === pkg?.id);
        if (!old || datasets.some((d) => d.schemaVersion !== old.dataSchema))
          throw new AppError('旧版本不匹配当前数据模式，须先恢复数据到新目标', 409);
      }
      if (input.migration && !input.checkpoint) throw new AppError('数据迁移必须先创建已校验冷备', 409);
      if (input.migration && datasets.some((d) => d.schemaVersion !== input.migration!.fromSchema))
        throw new AppError('迁移起始模式与数据不符', 409);
      const prior = running || installed || null,
        base = {
          appId,
          id: appNewId(),
          action: input.kind,
          targetRevision: t.revision,
          dataDigest: appHash(
            datasets.map((d) => [d.id, d.generation, d.schemaVersion, d.path, d.budgetBytes]),
          ),
          bootId: t.bootId,
          diskIdentity: t.diskIdentity,
          packageId: pkg?.id || null,
          packageDigest: pkg?.digest || '',
          configId: cfg?.id || null,
          configDigest: cfg?.digest || '',
          priorInstallationId: prior?.id || null,
          routeRevision: (await this.routes.view(appId)).routes.at(-1)?.revision || 0,
          checkpoint: input.checkpoint,
          migration: input.migration,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          createdAt: appNow(),
          approvedAt: null,
          usedBy: null,
        };
      const plan = appPlanSchema.parse({ ...base, digest: appHash(base) });
      await this.plans.write((rows) => {
        rows.push(plan);
      });
      return appView({ ...(await this.view(appId)), selectedId: plan.id });
    }
    if (input.action === 'approve') {
      await this.plans.write((rows) => {
        const p = appRequire(
          rows.find((r) => r.appId === appId && r.id === input.id),
          '计划不存在',
        );
        if (p.digest !== input.digest || Date.parse(p.expiresAt) <= Date.now() || p.usedBy)
          throw new AppError('计划变化、过期或已使用', 409);
        this.checkDigest(p);
        p.approvedAt = appNow();
      });
      return this.view(appId);
    }
    if (input.action === 'apply') {
      const operationId = appNewId();
      let plan: AppPlan | undefined;
      await this.plans.write((rows) => {
        const p = appRequire(
          rows.find((r) => r.appId === appId && r.id === input.id),
          '计划不存在',
        );
        if (!p.approvedAt || p.usedBy || Date.parse(p.expiresAt) <= Date.now())
          throw new AppError('计划未批准、过期或已使用', 409);
        this.checkDigest(p);
        p.usedBy = operationId;
        plan = structuredClone(p);
      });
      const op: AppOperation = {
        appId,
        id: operationId,
        planId: input.id,
        phase: 'queued',
        status: 'queued',
        cleanup: 'not-needed',
        createdAt: appNow(),
        log: '',
      };
      await this.operations.write((rows) => {
        rows.push(op);
      });
      try {
        this.jobs.start(
          operationId,
          async (log, signal) => {
            await this.execute(plan!, operationId, signal, log);
          },
          { title: '应用变更：' + plan!.action, action: 'apply' },
        );
      } catch (error) {
        await this.update(operationId, {
          status: 'failed',
          error: (error as Error).message,
          finishedAt: appNow(),
        });
        throw error;
      }
      return appView({ ...(await this.view(appId)), selectedId: operationId });
    }
    const op = appRequire(
      (await this.operations.read(appId)).find((r) => r.id === input.id),
      '操作记录不存在',
    );
    if (input.action === 'cancel') {
      this.jobs.cancel(op.id);
      return this.view(appId);
    }
    if (this.reconciling.has(appId)) throw new AppError('应用正在核销原操作，请等待完成', 409);
    this.reconciling.add(appId);
    try {
      const t = await appTarget(this.targets, appId),
        plan = appRequire(
          (await this.plans.read(appId)).find((p) => p.id === op.planId),
          '原计划不存在',
        );
      if (this.jobs.view(op.id)?.status === 'running') throw new AppError('任务仍在运行，先取消并等待', 409);
      if (t.diskIdentity !== plan.diskIdentity) throw new AppError('操作原磁盘已交接，不能核销新目标', 409);
      if (
        (t.bootId !== plan.bootId || t.revision !== plan.targetRevision) &&
        !(t.lease?.operationId === op.id && t.lease.planDigest === plan.digest)
      )
        throw new AppError('操作原启动基线已变化，不能核销新目标', 409);
      if (t.lease && t.lease.operationId !== op.id) throw new AppError('另一操作持有目标租约，不能核销', 409);
      if (
        !['failed', 'unknown', 'cancelled'].includes(op.status) ||
        t.lease?.operationId !== op.id ||
        t.lease.planDigest !== plan.digest
      )
        throw new AppError('原操作未持有待核销租约，禁止改变当前应用运行', 409);
      if (input.action === 'recover-from-checkpoint') {
        if (!['failed', 'unknown', 'cancelled'].includes(op.status))
          throw new AppError('仅允许恢复已结束或中断的失败操作', 409);
        const c = appRequire(
          (await this.recovery.view(appId)).checkpoints.find(
            (c) =>
              c.id === input.checkpointId &&
              c.diskIdentity === plan.diskIdentity &&
              c.state === 'ready' &&
              c.restoredVmId &&
              c.restoredCreatedAt &&
              !c.activatedAt,
          ),
          '缺少原磁盘的已校验恢复副本',
        );
        await appCheck(this.machines, t);
        await this.closeRoute(appId);
        await appRunProject(this.machines, this.workspaces, t, 'stop');
        await this.removeEnv(t);
        await this.targets.act(appId, { action: 'desired', value: 'stopped' });
        if (t.lease) await this.targets.act(appId, { action: 'release', leaseId: t.lease.id });
        const handoff = await this.recovery.act(appId, {
          action: 'activate-restored',
          id: c.id,
          reviewed: true,
        });
        await this.update(op.id, {
          status: 'failed',
          phase: 'recovery-handoff',
          cleanup: 'verified',
          finishedAt: appNow(),
        });
        return appView({ ...(await this.view(appId)), selectedId: handoff.selectedId });
      }
      if (plan.migration && op.cleanup === 'unknown')
        throw new AppError('迁移结果未知，须验证数据或恢复检查点，禁止盲目解锁', 409);
      await appCheck(this.machines, t);
      await this.closeRoute(appId);
      await appRunProject(this.machines, this.workspaces, t, 'stop');
      await this.removeEnv(t);
      await this.targets.act(appId, { action: 'desired', value: 'stopped' });
      await this.installations.write((rows) => {
        for (const i of rows.filter((r) => r.appId === appId))
          if (i.state === 'running' || i.state === 'unknown') i.state = 'stopped';
      });
      await this.update(op.id, {
        status: 'failed',
        phase: 'reconciled-stopped',
        cleanup: 'verified',
        finishedAt: appNow(),
      });
      await this.targets.act(appId, { action: 'release', leaseId: t.lease.id });
      return this.view(appId);
    } finally {
      this.reconciling.delete(appId);
    }
  }
  private async closeRoute(appId: string, drain = false) {
    const r = (await this.routes.view(appId)).routes.at(-1);
    if (r && (r.state === 'open' || !drain))
      await this.routes.act(appId, { action: drain ? 'drain' : 'close', expectedRevision: r.revision });
  }
  private checkDigest(p: AppPlan) {
    const { digest, ...base } = p;
    if (appHash({ ...base, approvedAt: null, usedBy: null }) !== digest)
      throw new AppError('计划内容与固定摘要不符', 409);
  }
  private async removeEnv(t: AppTarget) {
    await appExec(
      this.machines,
      t,
      `python3 -I -S -c ${quote('import os,stat\np=' + JSON.stringify(t.directory + '/runtime.env') + '\nif os.path.lexists(p):\n s=os.lstat(p)\n assert stat.S_ISREG(s.st_mode) and not stat.S_ISLNK(s.st_mode)\n os.unlink(p)')}`,
    );
  }
  private async stage(t: AppTarget, p: AppPackage, directory: string, signal: AbortSignal) {
    const files = await this.packages.files(t.appId, p.id),
      identity = await appOwnDirectory(this.machines, this.workspaces, t, t.directory);
    await appExec(
      this.machines,
      t,
      `set -eu\nmkdir -p ${quote(t.directory + '/releases')}\ntest ! -e ${quote(directory)}\nmkdir -m 700 ${quote(directory)}\nchown ${identity.uid}:${identity.gid} ${quote(directory)}`,
    );
    const dirs = new Set<string>([directory]);
    await this.machines.sftp(t.vmId, async (ftp) => {
      for (const f of files) {
        signal.throwIfAborted();
        await appCheck(this.machines, t);
        let parent = directory;
        for (const part of f.path.split('/').slice(0, -1)) {
          parent += '/' + part;
          if (!dirs.has(parent)) {
            await new Promise<void>((ok, no) =>
              ftp.mkdir(parent, { mode: 0o700 }, (e) => (e ? no(e) : ok())),
            );
            await new Promise<void>((ok, no) =>
              ftp.chown(parent, identity.uid, identity.gid, (e) => (e ? no(e) : ok())),
            );
            dirs.add(parent);
          }
        }
        const h = await new Promise<Buffer>((ok, no) =>
            ftp.open(directory + '/' + f.path, 'wx', { mode: f.mode }, (e, h) => (e ? no(e) : ok(h))),
          ),
          hash = createHash('sha256');
        try {
          let offset = 0;
          while (offset < f.bytes) {
            signal.throwIfAborted();
            const chunk = await this.packages.read(
                t.appId,
                f.blobId,
                offset,
                Math.min(512 * 1024, f.bytes - offset),
              ),
              b = Buffer.from(chunk.data, 'base64');
            if (!b.length || b.length > f.bytes - offset || chunk.offset !== offset + b.length)
              throw new AppError('安装包分块长度或偏移无效', 409);
            hash.update(b);
            await new Promise<void>((ok, no) =>
              ftp.write(h, b, 0, b.length, offset, (e) => (e ? no(e) : ok())),
            );
            offset += b.length;
          }
          if (hash.digest('hex') !== f.sha256) throw new AppError('安装文件摘要不符', 409);
          await new Promise<void>((ok, no) =>
            ftp.fchown(h, identity.uid, identity.gid, (e) => (e ? no(e) : ok())),
          );
        } finally {
          await new Promise<void>((ok, no) => ftp.close(h, (e) => (e ? no(e) : ok())));
        }
      }
    });
  }
  private async configure(t: AppTarget, p: AppPackage, c: AppConfig, directory: string) {
    await appProject(this.machines, this.workspaces, t);
    const values = await this.config.resolve(t.appId, c.id);
    await this.removeEnv(t);
    await appWrite(
      this.machines,
      t,
      t.directory + '/runtime.env',
      appEnvFile({ ...values, APP_DATA_DIR: t.directory + '/data' }),
    );
    await appOwnDirectory(this.machines, this.workspaces, t, t.directory + '/runtime.env');
    const command =
      p.startup.kind === 'static'
        ? `exec python3 -I -m http.server ${p.startup.port} --bind 127.0.0.1 --directory ${quote(directory + '/' + p.startup.directory)}`
        : p.startup.command;
    await this.workspaces.projects.with(t.vmId, t.projectId, async () => {
      const prior = await this.workspaces.view(t.vmId);
      await this.workspaces.save(
        t.vmId,
        {
          directory: t.directory,
          template: 'none',
          networkIsolation: 'host',
          command: `set -eu\n. ${quote(t.directory + '/runtime.env')}\ncd ${quote(directory)}\n${command}`,
        },
        undefined,
        prior.version,
      );
    });
  }
  private async healthy(
    t: AppTarget,
    pkg: AppPackage,
    id: string,
    signal: AbortSignal,
    stabilitySeconds = 60,
  ) {
    const deadline = Date.now() + pkg.startup.timeoutSeconds * 1000;
    let stableSince = 0;
    for (;;) {
      signal.throwIfAborted();
      const v = await this.observe.act(t.appId, {
        action: 'probe',
        installationId: id,
        command: pkg.startup.healthCommand,
        port: pkg.startup.port,
        healthPath: pkg.startup.healthPath,
      });
      const healthy = v.observations.find((o) => o.id === v.selectedId)?.status === 'healthy';
      if (healthy) {
        stableSince ||= Date.now();
        if (Date.now() - stableSince >= stabilitySeconds * 1000) return;
      } else {
        stableSince = 0;
        if (Date.now() > deadline) throw new AppError('应用未通过持续健康窗口', 409);
      }
      if (Date.now() > deadline + stabilitySeconds * 1000) throw new AppError('应用健康窗口超时', 409);
      await delay(2000, undefined, { signal });
    }
  }
  private async resume(t: AppTarget, prior: AppInstallation, leaseId: string, signal: AbortSignal) {
    const pkg = appRequire(
      (await this.packages.view(t.appId)).packages.find(
        (p) => p.id === prior.packageId && p.digest === prior.packageDigest,
      ),
      '前版本制品缺失',
    );
    const cfg = appRequire(
      (await this.config.view(t.appId)).configs.find(
        (c) => c.id === prior.configId && c.digest === prior.configDigest,
      ),
      '前版本配置缺失',
    );
    if (pkg.startup.kind === 'command') throw new AppError('一次性命令不自动重放', 409);
    if ((await this.data.view(t.appId)).datasets.some((d) => d.schemaVersion !== prior.dataSchema))
      throw new AppError('数据版本变化，不允许自动回退', 409);
    await this.packages.files(t.appId, pkg.id);
    await this.configure(t, pkg, cfg, prior.directory);
    await appRunProject(this.machines, this.workspaces, t, 'start', signal);
    await this.healthy(t, pkg, prior.id, signal, 6);
    const routes = await this.routes.act(t.appId, {
      action: 'switch',
      installationId: prior.id,
      expectedRevision: (await this.routes.view(t.appId)).routes.at(-1)?.revision || 0,
      port: pkg.startup.port,
      healthPath: pkg.startup.healthPath,
      leaseId,
    });
    await this.installations.write((rows) => {
      const i = rows.find((r) => r.id === prior.id)!;
      i.state = 'running';
      i.bootId = t.bootId;
      i.routeRevision = routes.routes.at(-1)!.revision;
    });
    await this.targets.act(t.appId, { action: 'desired', value: 'running' });
  }
  private async execute(p: AppPlan, operationId: string, signal: AbortSignal, log: (text: string) => void) {
    let t = await appTarget(this.targets, p.appId),
      leaseId = '',
      migrationStarted = false,
      installation: AppInstallation | undefined,
      prior: AppInstallation | undefined;
    const step = async (phase: string) => {
      await this.authorize();
      signal.throwIfAborted();
      await this.update(operationId, { status: 'running', phase, cleanup: 'pending' });
      await this.operations.write((rows) => {
        const r = rows.find((r) => r.id === operationId)!;
        r.log = (r.log + appNow() + ' ' + phase + '\n').slice(-65536);
      });
      log(phase + '\n');
    };
    try {
      await step('checking-plan');
      await appCheck(this.machines, t);
      if (t.revision !== p.targetRevision || t.bootId !== p.bootId || t.diskIdentity !== p.diskIdentity)
        throw new AppError('计划目标身份已变化', 409);
      if (
        appHash(
          (await this.data.view(p.appId)).datasets.map((d) => [
            d.id,
            d.generation,
            d.schemaVersion,
            d.path,
            d.budgetBytes,
          ]),
        ) !== p.dataDigest
      )
        throw new AppError('计划数据身份或容量预算已变化', 409);
      if (((await this.routes.view(p.appId)).routes.at(-1)?.revision || 0) !== p.routeRevision)
        throw new AppError('入口修订已变化', 409);
      await this.targets.act(p.appId, {
        action: 'claim',
        operationId,
        planDigest: p.digest,
        expectedRevision: p.targetRevision,
        expectedBootId: p.bootId,
        expectedDiskIdentity: p.diskIdentity,
      });
      t = await appTarget(this.targets, p.appId);
      leaseId = t.lease!.id;
      prior = p.priorInstallationId
        ? (await this.installations.read(p.appId)).find((i) => i.id === p.priorInstallationId)
        : undefined;
      await step('stopping-prior');
      await this.closeRoute(p.appId, !['stop', 'uninstall'].includes(p.action));
      await appRunProject(this.machines, this.workspaces, t, 'stop');
      await this.removeEnv(t);
      await this.installations.write((rows) => {
        for (const i of rows.filter((r) => r.appId === p.appId))
          if (i.state === 'running') i.state = 'stopped';
      });
      await this.targets.act(p.appId, { action: 'desired', value: 'stopped' });
      if (p.action === 'stop' || p.action === 'uninstall') {
        if (p.action === 'uninstall' && prior) {
          await step('uninstalling');
          if (prior.directory !== t.directory + '/releases/' + prior.id)
            throw new AppError('版本目录归属不一致', 409);
          await appExec(
            this.machines,
            t,
            `python3 -I -S -c ${quote('import os,stat,shutil\np=' + JSON.stringify(prior.directory) + '\nif os.path.lexists(p):\n s=os.lstat(p)\n assert stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode)\n shutil.rmtree(p)')}`,
          );
        }
        await this.targets.act(p.appId, { action: 'release', leaseId });
        await this.update(operationId, {
          status: 'succeeded',
          phase: p.action,
          cleanup: 'verified',
          finishedAt: appNow(),
        });
        return;
      }
      const pkg = appRequire(
          (await this.packages.view(p.appId)).packages.find(
            (r) => r.id === p.packageId && r.digest === p.packageDigest,
          ),
          '原安装包变化或缺失',
        ),
        cfg = appRequire(
          (await this.config.view(p.appId)).configs.find(
            (r) => r.id === p.configId && r.digest === p.configDigest,
          ),
          '原配置缺失',
        );
      await this.config.resolve(p.appId, cfg.id);
      await this.data.act(p.appId, { action: 'inspect' });
      if (p.checkpoint) {
        await step('cold-backup');
        await this.recovery.checkpoint(p.appId, leaseId);
        t = await appTarget(this.targets, p.appId);
      }
      const id = appNewId(),
        directory = t.directory + '/releases/' + id;
      await step('staging');
      await this.stage(t, pkg, directory, signal);
      if (p.migration) {
        await step('migrating');
        migrationStarted = true;
        await this.data.act(p.appId, { action: 'migrate', ...p.migration, leaseId });
      }
      await step('configuring');
      await this.configure(t, pkg, cfg, directory);
      installation = {
        appId: p.appId,
        id,
        packageId: pkg.id,
        packageDigest: pkg.digest,
        configId: cfg.id,
        configDigest: cfg.digest,
        directory,
        bootId: t.bootId,
        state: 'unknown',
        createdAt: appNow(),
        dataSchema: (await this.data.view(p.appId)).datasets[0]?.schemaVersion || '',
        routeRevision: 0,
      };
      await this.installations.write((rows) => {
        rows.push(installation!);
      });
      await this.update(operationId, { installationId: id });
      await step('starting');
      if (pkg.startup.kind === 'command') {
        await appUserExec(
          this.machines,
          this.workspaces,
          t,
          `. ${quote(t.directory + '/runtime.env')}\ncd ${quote(directory)}\n${pkg.startup.command}`,
          pkg.startup.timeoutSeconds * 1000,
          signal,
        );
        await this.removeEnv(t);
        installation.state = 'stopped';
      } else {
        await appRunProject(this.machines, this.workspaces, t, 'start', signal);
        await step('checking-health');
        await this.healthy(t, pkg, id, signal);
        await step('switching');
        const revision = (await this.routes.view(p.appId)).routes.at(-1)?.revision || 0;
        const route = await this.routes.act(p.appId, {
          action: 'switch',
          installationId: id,
          expectedRevision: revision,
          port: pkg.startup.port,
          healthPath: pkg.startup.healthPath,
          leaseId,
        });
        installation.routeRevision = route.routes.at(-1)?.revision || 0;
        installation.state = 'running';
        await this.targets.act(p.appId, { action: 'desired', value: 'running' });
      }
      await this.installations.write((rows) => {
        Object.assign(
          rows.find((r) => r.id === id)!,
          installation,
        );
      });
      await step('verifying-retirement');
      await this.targets.act(p.appId, { action: 'release', leaseId });
      leaseId = '';
      await this.update(operationId, {
        status: 'succeeded',
        phase: 'completed',
        cleanup: 'verified',
        finishedAt: appNow(),
      });
    } catch (error) {
      let cleanup: 'verified' | 'unknown' = leaseId ? 'unknown' : 'verified',
        rolledBack = false;
      try {
        t = await appTarget(this.targets, p.appId);
        if (!leaseId || t.lease?.id !== leaseId)
          throw new AppError('不持有原操作租约，禁止清理其他操作', 409);
        await appCheck(this.machines, t);
        await this.closeRoute(p.appId, true);
        await appRunProject(this.machines, this.workspaces, t, 'stop');
        await this.removeEnv(t);
        await this.targets.act(p.appId, { action: 'desired', value: 'stopped' });
        if (!migrationStarted) {
          if (prior?.state === 'running' && !signal.aborted) {
            try {
              await this.resume(t, prior, leaseId, signal);
              rolledBack = true;
            } catch {
              await this.closeRoute(p.appId);
              await appRunProject(this.machines, this.workspaces, t, 'stop');
              await this.removeEnv(t);
            }
          } else await this.closeRoute(p.appId);
          cleanup = 'verified';
          if (leaseId && t.lease?.id === leaseId)
            await this.targets.act(p.appId, { action: 'release', leaseId });
        }
      } catch {}
      if (installation)
        await this.installations.write((rows) => {
          const i = rows.find((r) => r.id === installation!.id);
          if (i) i.state = cleanup === 'verified' ? 'failed' : 'unknown';
        });
      await this.update(operationId, {
        status: signal.aborted ? 'cancelled' : 'failed',
        phase: rolledBack ? 'failed-prior-restored' : 'failed-stopped',
        cleanup,
        error: (error as Error).message.slice(0, 2000),
        finishedAt: appNow(),
      });
      throw error;
    }
  }
  async close() {
    await this.jobs.close();
    for (const t of (await this.targets.view()).targets) {
      if (t.desired !== 'running') continue;
      try {
        await this.closeRoute(t.appId);
        await appRunProject(this.machines, this.workspaces, t, 'stop');
        await this.removeEnv(t);
        await this.targets.act(t.appId, { action: 'desired', value: 'stopped' });
        await this.installations.write((rows) => {
          for (const i of rows.filter((r) => r.appId === t.appId && r.state === 'running'))
            i.state = 'stopped';
        });
      } catch {
        await this.installations.write((rows) => {
          for (const i of rows.filter((r) => r.appId === t.appId && r.state === 'running'))
            i.state = 'unknown';
        });
      }
    }
  }
}
