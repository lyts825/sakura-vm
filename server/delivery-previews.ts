/** 从同一制品创建常驻限时预览；入口和外网权限彼此独立。 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import type { DeliveryScope, DeliveryCandidate } from '../shared/contracts/delivery-common.ts';
import { deliveryScopeSchema } from '../shared/contracts/delivery-common.ts';
import { deliveryPreviewSchema, type DeliveryPreview } from '../shared/contracts/delivery-execution.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { Jobs } from './jobs.ts';
import { DeliveryExecutor, type DeliverySpace } from './delivery-executor.ts';
import { DeliveryIngress } from './delivery-ingress.ts';
import { assertDeliveryCandidate } from './delivery-candidate.ts';
import { captureOperationCheck } from './operation-context.ts';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
export class DeliveryPreviews {
  readonly jobs = new Jobs('delivery-previews');
  private rows: DeliveryPreview[] = [];
  private executor: DeliveryExecutor;
  private ingress = new Map<string, DeliveryIngress>();
  private saving = Promise.resolve();
  private closed = false;
  constructor(
    machines: VmAccess,
    workspaces: WorkspacesV1,
    private artifacts: DeliveryArtifactsV1,
    private metadata: PluginMetadata,
    private authorize: (scope: DeliveryScope) => void | Promise<void> = () => {},
  ) {
    this.executor = new DeliveryExecutor(machines, workspaces, artifacts);
  }
  /** 重启后不恢复入口，保留原实例身份供核销。 Never restores ingress on restart; preserves original cleanup identity. */
  async init() {
    const saved = (await this.metadata.read()).value;
    this.rows = z.array(deliveryPreviewSchema).parse(saved === undefined ? [] : saved);
    for (const row of this.rows)
      if (!['stopped', 'expired', 'failed'].includes(row.state)) {
        row.state = 'failed';
        row.cleanup = 'unknown';
        row.error = '控制服务重启；须按原实例身份核销后重建入口';
        delete row.url;
      }
    await this.persist();
  }
  private persist() {
    const snapshot = structuredClone(this.rows);
    const next = this.saving.then(async () => {
      await this.metadata.replace(snapshot);
    });
    this.saving = next.catch(() => {});
    return next;
  }
  private own(scope: DeliveryScope, id: string) {
    const row = this.rows.find(
      (row) => row.id === id && row.scope.vmId === scope.vmId && row.scope.projectId === scope.projectId,
    );
    if (!row) throw new AppError('预览不存在', 404);
    return row;
  }
  async list(scope: DeliveryScope) {
    deliveryScopeSchema.parse(scope);
    await this.authorize(scope);
    return structuredClone(
      this.rows.filter((row) => row.scope.vmId === scope.vmId && row.scope.projectId === scope.projectId),
    );
  }
  async get(scope: DeliveryScope, id: string) {
    await this.authorize(scope);
    return structuredClone(this.own(scope, id));
  }
  /** 从确切候选创建限时实例，健康后才发布独立入口。 Creates a deadline-bound candidate VM and exposes ingress only after health succeeds. */
  async start(
    scope: DeliveryScope,
    input: { candidate: DeliveryCandidate; lifetimeMinutes: number; reviewed: true },
  ): Promise<DeliveryPreview> {
    await this.authorize(scope);
    if (this.closed) throw new AppError('预览服务正在关闭', 503);
    if (input.reviewed !== true) throw new AppError('启动命令和联网权限需要审阅', 400);
    const candidate = assertDeliveryCandidate(scope, input.candidate),
      minutes = z.number().int().min(1).max(1440).parse(input.lifetimeMinutes);
    if (candidate.startup.kind === 'command') throw new AppError('命令行制品请使用接收验证运行', 409);
    const manifest = await this.artifacts.get(scope, candidate.manifestId);
    if (
      !(await this.artifacts.references(scope, manifest.id)).some(
        (reference) =>
          reference === 'candidate:' + candidate.digest ||
          reference === 'accepted-import:' + candidate.digest,
      )
    )
      throw new AppError('交付包仍在隔离区；请先审阅并接受该确切候选', 409);
    if (manifest.digest !== candidate.manifestDigest) throw new AppError('候选制品身份不匹配', 409);
    await this.artifacts.verify(scope, manifest.id);
    if (
      this.rows.filter((row) => ['preparing', 'starting', 'healthy', 'unhealthy'].includes(row.state))
        .length >= 8
    )
      throw new AppError('预览数量已到上限', 429);
    const row: DeliveryPreview = {
      schemaVersion: 1,
      id: randomUUID(),
      scope,
      candidateDigest: candidate.digest,
      manifestId: manifest.id,
      manifestDigest: manifest.digest,
      startupDigest: createHash('sha256').update(JSON.stringify(candidate.startup)).digest('hex'),
      state: 'preparing',
      cleanup: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
      healthPath: candidate.startup.healthPath,
      log: '',
    };
    const check = captureOperationCheck();
    await this.artifacts.retain(scope, manifest.id, 'preview:' + row.id);
    if (
      this.rows.filter((value) => ['preparing', 'starting', 'healthy', 'unhealthy'].includes(value.state))
        .length >= 8
    ) {
      await this.artifacts.release(scope, manifest.id, 'preview:' + row.id);
      throw new AppError('预览数量已到上限', 429);
    }
    this.rows.push(row);
    await this.persist();
    try {
      const job = this.jobs.start(
        row.id,
        async (log, signal) => {
          let space: DeliverySpace | undefined, service: Promise<unknown> | undefined;
          const controller = new AbortController(),
            combined = AbortSignal.any([signal, controller.signal]);
          try {
            await check();
            await this.authorize(scope);
            space = await this.executor.create(
              candidate.environment,
              minutes,
              combined,
              async (vmId, vmCreatedAt) => {
                row.vmId = vmId;
                row.vmCreatedAt = vmCreatedAt;
                await this.persist();
              },
            );
            await this.executor.stage(space, scope, manifest, combined);
            await this.executor.environment(space, combined);
            const clock = await this.executor.machines.exec(space.vmId, 'date +%s', 15_000, combined);
            const guestNow = Number(clock.stdout.trim());
            if (clock.code !== 0 || !Number.isSafeInteger(guestNow))
              throw new AppError('客户机时钟无法核对', 409);
            // Persist a guest-clock deadline once; host deadline remains authoritative and never moves on restart.
            const deadline =
              guestNow + Math.max(0, Math.floor((Date.parse(row.expiresAt) - Date.now()) / 1000));
            row.log += `Guest deadline ${deadline}; host deadline ${row.expiresAt}\n`;
            // A root-owned, fixed watchdog survives the host SSH session and guest reboot. Project commands cannot extend it.
            const watchdog = `#!/bin/sh\nwhile [ "$(date +%s)" -lt ${deadline} ]; do sleep 1; done\n/sbin/poweroff -f\n`;
            const install =
              `set -eu\nmkdir -p /usr/local/sbin\nprintf %s ${quote(watchdog)} > /usr/local/sbin/sakura-delivery-expire\nchmod 700 /usr/local/sbin/sakura-delivery-expire\n` +
              `if command -v rc-update >/dev/null 2>&1; then mkdir -p /etc/local.d; printf '%s\\n' '#!/bin/sh' 'nohup /usr/local/sbin/sakura-delivery-expire >/dev/null 2>&1 &' > /etc/local.d/sakura-delivery.start; chmod 700 /etc/local.d/sakura-delivery.start; rc-update add local default; ` +
              `elif command -v systemctl >/dev/null 2>&1; then printf '%s\\n' '[Unit]' 'Description=Delivery absolute expiry' '[Service]' 'ExecStart=/usr/local/sbin/sakura-delivery-expire' 'Restart=always' '[Install]' 'WantedBy=multi-user.target' > /etc/systemd/system/sakura-delivery-expire.service; systemctl enable sakura-delivery-expire; elif test -f /etc/inittab; then printf '%s\\n' '::once:/usr/local/sbin/sakura-delivery-expire' >> /etc/inittab; else exit 1; fi\nnohup /usr/local/sbin/sakura-delivery-expire >/dev/null 2>&1 &`;
            const installed = await this.executor.machines.exec(space.vmId, install, 30_000, combined);
            if (installed.code !== 0)
              throw new AppError('客户机绝对到期约束安装失败：' + installed.stderr, 409);
            row.state = 'starting';
            await this.persist();
            const startup = candidate.startup,
              command =
                startup.kind === 'static'
                  ? `if command -v busybox >/dev/null 2>&1 && busybox --list | grep -qx httpd; then exec busybox httpd -f -p 127.0.0.1:${startup.port} -h .; else exec python3 -m http.server ${startup.port} --bind 127.0.0.1; fi`
                  : startup.command;
            let exited = false,
              serviceError: unknown;
            service = this.executor
              .command(
                space,
                'cd ' + quote(startup.root) + ' && ' + command,
                Math.max(1, Math.ceil((Date.parse(row.expiresAt) - Date.now()) / 1000)),
                combined,
                (text) => {
                  row.log = (row.log + text).slice(-65536);
                  log(text);
                },
              )
              .then(
                (result) => {
                  exited = true;
                  if (result.code !== 0) serviceError = new Error('服务退出：' + result.code);
                },
                (error) => {
                  exited = true;
                  serviceError = error;
                },
              );
            const original = space;
            const ingress = new DeliveryIngress(
              this.executor.machines,
              space,
              startup.port,
              row.expiresAt,
              () => this.executor.check(original),
              async () => {
                await check();
                await this.authorize(scope);
              },
            );
            this.ingress.set(row.id, ingress);
            await ingress.open(row.id);
            const readyDeadline = Math.min(
              Date.parse(row.expiresAt),
              Date.now() + startup.timeoutSeconds * 1000,
            );
            while (Date.now() < readyDeadline && !exited) {
              if (
                await ingress.health(startup.healthPath).catch((error) => {
                  row.log = (row.log + 'Health: ' + String(error) + '\n').slice(-65536);
                  return false;
                })
              )
                break;
              await this.persist();
              await delay(500, undefined, { signal: combined });
            }
            if (exited || !(await ingress.health(startup.healthPath)))
              throw serviceError || new AppError('服务未通过真实健康检查', 409);
            row.state = 'healthy';
            row.healthAt = new Date().toISOString();
            row.url = ingress.url;
            await this.persist();
            while (Date.now() < Date.parse(row.expiresAt) && !exited) {
              await delay(Math.min(1000, Date.parse(row.expiresAt) - Date.now()), undefined, {
                signal: combined,
              });
            }
            if (exited && Date.now() < Date.parse(row.expiresAt) - 2000)
              throw serviceError || new AppError('预览服务提前结束', 409);
            row.state = 'expired';
          } catch (error) {
            row.state = signal.aborted
              ? 'stopped'
              : Date.now() >= Date.parse(row.expiresAt)
                ? 'expired'
                : 'failed';
            row.error = String(error);
          } finally {
            delete row.url;
            let ingressError: unknown;
            try {
              await this.ingress.get(row.id)?.close();
            } catch (error) {
              ingressError = error;
            }
            this.ingress.delete(row.id);
            controller.abort();
            await service;
            row.cleanup = 'pending';
            try {
              if (row.vmId && row.vmCreatedAt) await this.executor.destroy(row.vmId, row.vmCreatedAt);
              if (ingressError) throw ingressError;
              row.cleanup = 'verified';
            } catch (error) {
              row.cleanup = 'unknown';
              row.error = (row.error || '') + '\n' + String(error);
            }
            await this.persist();
          }
        },
        { vmId: scope.vmId, projectId: scope.projectId, title: '候选预览' },
      );
      row.jobId = job.id;
      await this.persist();
      return structuredClone(row);
    } catch (error) {
      if (row.jobId) {
        this.jobs.cancel(row.id);
        row.cleanup = 'unknown';
      } else {
        row.state = 'failed';
        row.cleanup = row.vmId ? 'unknown' : 'verified';
      }
      row.error = String(error);
      await this.persist();
      throw error;
    }
  }
  /** 通过真实入口核验配置的健康路径。 Probes the configured health path through the real ingress. */
  async health(scope: DeliveryScope, id: string) {
    await this.authorize(scope);
    const row = this.own(scope, id),
      ingress = this.ingress.get(id);
    if (!ingress || !row.url || Date.now() >= Date.parse(row.expiresAt))
      throw new AppError('预览不在有效运行期限内', 409);
    row.state = (await ingress.health(row.healthPath).catch(() => false)) ? 'healthy' : 'unhealthy';
    row.healthAt = new Date().toISOString();
    await this.persist();
    return this.get(scope, id);
  }
  /** 先撤回入口，再取消原服务及核销实例。 Withdraws ingress before cancelling the service and cleaning its VM. */
  async stop(scope: DeliveryScope, id: string) {
    await this.authorize(scope);
    const row = this.own(scope, id);
    await this.ingress.get(id)?.close();
    this.ingress.delete(id);
    delete row.url;
    if (row.jobId && ['preparing', 'starting', 'healthy', 'unhealthy'].includes(row.state))
      await this.jobs.cancel(row.id);
    return this.get(scope, id);
  }
  /** 仅核销已停预览保存的原实例身份。 Recovers only the original identity of an inactive preview. */
  async recover(scope: DeliveryScope, id: string) {
    await this.authorize(scope);
    const row = this.own(scope, id);
    if (this.ingress.has(id) || ['preparing', 'starting', 'healthy', 'unhealthy'].includes(row.state))
      throw new AppError('请先停止原预览', 409);
    if (row.vmId && row.vmCreatedAt) await this.executor.destroy(row.vmId, row.vmCreatedAt);
    row.cleanup = 'verified';
    await this.persist();
    return this.get(scope, id);
  }
  async close() {
    this.closed = true;
    for (const ingress of this.ingress.values()) await ingress.close();
    await this.jobs.close();
    await this.saving;
  }
}
