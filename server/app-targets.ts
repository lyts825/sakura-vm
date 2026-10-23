/** 应用专用目标、互斥变更租约与受控重启交接。 */
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import type { EgressRulesV1 } from './service-contracts/egress-rules.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { AppAction } from '../shared/contracts/app-http.ts';
import { appActionSchemas } from '../shared/contracts/app-http.ts';
import { appTargetSchema, appIdSchema, type AppTarget } from '../shared/contracts/app-runtime.ts';
import { AppStore, appHash, appNow, appNewId, appView, appRequire } from './app-store.ts';
import {
  appDiskIdentity,
  appBoot,
  appCheck,
  appWaitRunning,
  appOwnDirectory,
  appProject,
} from './app-runtime.ts';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
import { Jobs } from './jobs.ts';
export class AppTargets {
  readonly jobs = new Jobs('app-targets');
  private store: AppStore<AppTarget>;
  constructor(
    private machines: VmAccess,
    private workspaces: WorkspacesV1,
    metadata: PluginMetadata,
    private authorize: () => Promise<void>,
    private images?: ImageAssetsV1,
    private egress?: EgressRulesV1,
  ) {
    this.store = new AppStore(metadata, appTargetSchema, authorize);
  }
  async view(appId?: string) {
    return appView({
      targets: await this.store.read(appId),
      images: this.images ? await this.images.list() : [],
      networkPlans: appId && this.egress ? await this.egress.list('app-targets:' + appId) : [],
      targetReceipts:
        appId && this.images
          ? (await this.images.owned('app-targets:' + appId)).map((r) => ({
              vmId: r.vmId,
              createdAt: r.createdAt,
              token: r.token,
              cleanup: r.cleanup,
            }))
          : [],
      capabilities: [
        {
          id: 'persistent-isolated-target',
          ready: !!this.images,
          reason: this.images ? '镜像服务可用，创建时核对实际网络能力' : '需要本体镜像资产服务',
        },
      ],
    });
  }
  async act(appId: string, raw: AppAction) {
    appIdSchema.parse(appId);
    const input = appActionSchemas.targets.parse(raw);
    await this.authorize();
    if (input.action === 'create') {
      if (!this.images) throw new AppError('本体镜像资产服务不可用', 503);
      if ((await this.store.read()).some((t) => t.appId === appId)) throw new AppError('应用标识已存在', 409);
      const images = this.images;
      this.jobs.start(
        appId,
        async (_log, signal) => {
          await this.authorize();
          const image = input.imageRef
            ? await images.verify(input.imageRef)
            : await images.prepareBuiltin(input.distro, input.architecture);
          if (image.virtualBytes > input.diskGiB * 1024 ** 3)
            throw new AppError('镜像虚拟容量超过已审阅磁盘预算', 409);
          const receipt = await images.createOwnedVm({
            imageRef: { assetId: image.id, digest: image.digest },
            owner: 'app-targets:' + appId,
            name: 'app-' + appId.slice(0, 8),
            memoryMiB: input.memoryMiB,
            cpus: input.cpus,
            network: 'isolated',
            persistent: true,
          });
          try {
            signal.throwIfAborted();
            await this.machines.start(receipt.vmId);
            await appWaitRunning(this.machines, receipt.vmId, signal);
            await this.adopt(appId, input.name, receipt.vmId, this.workspaces.projects.current(receipt.vmId));
          } catch (error) {
            // Owned image receipts persist independently of this plugin, including failed cleanup.
            try {
              await images.destroyOwnedVm(receipt);
            } catch {
              /* Recovery remains discoverable by exact owner. */
            }
            throw error;
          }
        },
        { title: '创建应用专用实例', action: 'create' },
      );
      return appView({ selectedId: appId });
    }
    if (input.action === 'adopt') {
      await this.adopt(appId, input.name, input.vmId, input.projectId);
      return this.view(appId);
    }
    if (input.action === 'cleanup-target') {
      if (!this.images) throw new AppError('镜像资产服务不可用', 503);
      const receipt = appRequire(
        (await this.images.owned('app-targets:' + appId)).find((r) => r.token === input.token),
        '目标回执不存在',
      );
      if ((await this.store.read()).some((t) => t.vmId === receipt.vmId))
        throw new AppError('目标已由应用使用，拒绝清理', 409);
      await this.images.destroyOwnedVm(receipt);
      return this.view(appId);
    }
    const target = appRequire((await this.store.read(appId))[0], '应用目标不存在');
    if (input.action === 'preview-rebind') {
      if (target.lease || target.transition) throw new AppError('原变更或迁移尚未核销，不能重新绑定', 409);
      await appCheck(this.machines, target, false);
      if (this.machines.state(target.vmId) !== 'running')
        throw new AppError('先启动原应用 VM，再核对新启动身份', 409);
      await appProject(this.machines, this.workspaces, target);
      const toBootId = await appBoot(this.machines, target.vmId);
      if (toBootId === target.bootId) throw new AppError('启动身份未变化，无需重新绑定', 409);
      const base = {
        id: appNewId(),
        vmId: target.vmId,
        vmCreatedAt: target.vmCreatedAt,
        diskIdentity: target.diskIdentity,
        targetRevision: target.revision,
        fromBootId: target.bootId,
        toBootId,
        createdAt: appNow(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };
      await this.store.write((rows) => {
        const t = rows.find((r) => r.appId === appId)!;
        if (t.lease || t.transition || t.revision !== target.revision || t.bootId !== target.bootId)
          throw new AppError('重新绑定预览期间目标变化', 409);
        t.rebind = { ...base, digest: appHash(base), state: 'planned' };
        t.state = 'drifted';
      });
      return appView({ ...(await this.view(appId)), selectedId: base.id });
    }
    if (input.action === 'begin-rebind' || input.action === 'complete-rebind') {
      const plan = appRequire(target.rebind || undefined, '重新绑定计划不存在');
      const { digest, state, completedAt, ...base } = plan;
      if (
        plan.id !== input.id ||
        appHash(base) !== digest ||
        state === 'applied' ||
        plan.vmId !== target.vmId ||
        plan.vmCreatedAt !== target.vmCreatedAt ||
        plan.diskIdentity !== target.diskIdentity ||
        plan.targetRevision !== target.revision ||
        plan.fromBootId !== target.bootId ||
        target.transition
      )
        throw new AppError('重新绑定计划或原目标已变化', 409);
      await appCheck(this.machines, target, false);
      if (
        this.machines.state(target.vmId) !== 'running' ||
        (await appBoot(this.machines, target.vmId)) !== plan.toBootId
      )
        throw new AppError('审阅后客户机再次重启，重新生成计划', 409);
      await appProject(this.machines, this.workspaces, target);
      if (input.action === 'begin-rebind') {
        if (input.digest !== digest || (state === 'planned' && Date.parse(plan.expiresAt) <= Date.now()))
          throw new AppError('重新绑定摘要不符或计划过期', 409);
        await this.store.write((rows) => {
          const t = rows.find((r) => r.appId === appId)!;
          if (
            t.rebind?.id !== plan.id ||
            t.revision !== plan.targetRevision ||
            t.transition ||
            (t.lease &&
              (t.rebind.state !== 'applying' ||
                t.lease.operationId !== plan.id ||
                t.lease.planDigest !== digest))
          )
            throw new AppError('其他变更或未知迁移持有原目标租约', 409);
          t.lease ||= {
            id: appNewId(),
            operationId: plan.id,
            planDigest: digest,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            executionId: appNewId(),
            bootId: plan.toBootId,
          };
          t.rebind.state = 'applying';
          t.state = 'unknown';
        });
      } else {
        await this.store.write((rows) => {
          const t = rows.find((r) => r.appId === appId)!;
          if (
            t.rebind?.id !== plan.id ||
            t.rebind.state !== 'applying' ||
            t.lease?.id !== input.leaseId ||
            t.lease.operationId !== plan.id ||
            t.lease.planDigest !== digest ||
            t.revision !== plan.targetRevision
          )
            throw new AppError('重新绑定执行租约变化', 409);
          t.bootId = plan.toBootId;
          t.revision++;
          t.desired = 'stopped';
          t.state = 'ready';
          t.lease = null;
          t.rebind.state = 'applied';
          t.rebind.completedAt = appNow();
        });
      }
      return this.view(appId);
    }
    if (input.action === 'relocate') {
      if (target.lease?.id !== input.leaseId || target.transition)
        throw new AppError('恢复交接租约无效', 409);
      if (target.vmId !== input.originalVmId || target.vmCreatedAt !== input.originalCreatedAt)
        throw new AppError('恢复原目标已变化', 409);
      this.machines.requireStopped(target.vmId);
      await appCheck(this.machines, target, false);
      const vm = this.machines.get(input.vmId);
      if (
        vm.createdAt !== input.vmCreatedAt ||
        vm.sandbox ||
        vm.rescueOf ||
        vm.managedNetwork !== 'isolated' ||
        this.machines.state(vm.id) !== 'running'
      )
        throw new AppError('恢复目标身份或持久隔离状态不符', 409);
      if ((await this.store.read()).some((t) => t.vmId === vm.id))
        throw new AppError('恢复副本已登记给其他应用', 409);
      const cfg = await this.workspaces.projects.with(vm.id, target.projectId, () =>
        this.workspaces.config(vm.id),
      );
      if (cfg.directory !== target.directory) throw new AppError('恢复项目目录与检查点不符', 409);
      const bootId = await appBoot(this.machines, vm.id),
        diskIdentity = await appDiskIdentity(vm.id);
      const r = await this.machines.exec(
        vm.id,
        `test -d ${quote(target.directory)} && test ! -L ${quote(target.directory)} && test ! -e ${quote(target.directory + '/runtime.env')}`,
        10000,
      );
      if (r.code) throw new AppError('恢复目录或秘密清除证明不符', 409);
      await this.store.write((rows) => {
        const t = rows.find((r) => r.appId === appId)!;
        if (t.vmId !== target.vmId || t.lease?.id !== input.leaseId)
          throw new AppError('恢复登记并发冲突', 409);
        Object.assign(t, {
          vmId: vm.id,
          vmCreatedAt: vm.createdAt,
          bootId,
          diskIdentity,
          revision: t.revision + 1,
          state: 'ready',
          desired: 'stopped',
        });
        t.lease!.parentExecutionId = t.lease!.executionId;
        t.lease!.executionId = appNewId();
        t.lease!.bootId = bootId;
      });
      return this.view(appId);
    }
    if (input.action.startsWith('network-')) {
      if (!this.egress) throw new AppError('本体有限出站服务不可用', 503);
      await appCheck(this.machines, target);
      if (target.lease || target.transition) throw new AppError('变更处理中，拒绝修改网络授权', 409);
      if (input.action === 'network-preview') {
        const plan = await this.egress.preview({
          vmId: target.vmId,
          owner: 'app-targets:' + appId,
          destinations: input.destinations,
          expiresAt: input.expiresAt,
        });
        return appView({ ...(await this.view(appId)), selectedId: plan.id });
      }
      if (
        input.action === 'network-apply' ||
        input.action === 'network-observe' ||
        input.action === 'network-revoke'
      ) {
        const plan = appRequire(
          (await this.egress.list('app-targets:' + appId)).find((r) => r.id === input.id),
          '网络计划不属于此应用',
        );
        if (plan.vmId !== target.vmId) throw new AppError('网络计划目标不一致', 409);
        if (input.action === 'network-apply') await this.egress.apply(input.id, input.digest);
        else if (input.action === 'network-observe') await this.egress.observe(input.id);
        else await this.egress.revoke(input.id);
      }
      return this.view(appId);
    }
    if (input.action === 'claim') {
      await appCheck(
        this.machines,
        target,
        !(input.allowStopped && this.machines.state(target.vmId) === 'stopped'),
      );
      await this.store.write((rows) => {
        const t = appRequire(
          rows.find((r) => r.appId === appId),
          '应用目标不存在',
        );
        if (t.lease) throw new AppError('应用已有变更租约，过期也须先核销原操作', 409);
        if (
          t.transition ||
          t.revision !== input.expectedRevision ||
          t.bootId !== input.expectedBootId ||
          t.diskIdentity !== input.expectedDiskIdentity
        )
          throw new AppError('申请租约的原启动基线已经变化', 409);
        t.lease = {
          id: appNewId(),
          operationId: input.operationId,
          planDigest: input.planDigest,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          executionId: appNewId(),
          bootId: t.bootId,
        };
      });
    } else if (input.action === 'release') {
      await this.store.write((rows) => {
        const t = appRequire(
          rows.find((r) => r.appId === appId),
          '应用目标不存在',
        );
        if (t.lease?.id !== input.leaseId) throw new AppError('变更租约不匹配', 409);
        t.lease = null;
      });
    } else if (input.action === 'desired') {
      await this.store.write((rows) => {
        const t = rows.find((r) => r.appId === appId)!;
        t.desired = input.value;
      });
    } else if (input.action === 'begin-boot') {
      await appCheck(this.machines, target);
      if (!target.lease) throw new AppError('受控关机需要有效变更租约', 409);
      await this.store.write((rows) => {
        const t = rows.find((r) => r.appId === appId)!;
        if (t.transition) throw new AppError('已有待核销启动转换', 409);
        t.transition = { id: appNewId(), fromBootId: t.bootId, state: 'intent' };
        t.state = 'transitioning';
      });
    } else if (input.action === 'boot-stopped' || input.action === 'boot-backed-up') {
      await appCheck(this.machines, target, false);
      this.machines.requireStopped(target.vmId);
      if (!target.transition || !target.lease) throw new AppError('无预先登记的启动转换', 409);
      if (input.action === 'boot-stopped' && target.transition.state !== 'intent')
        throw new AppError('关机转换状态不匹配', 409);
      if (input.action === 'boot-backed-up' && target.transition.state !== 'stopped')
        throw new AppError('冷备转换状态不匹配', 409);
      await this.store.write((rows) => {
        const t = rows.find((r) => r.appId === appId)!;
        t.transition!.state = input.action === 'boot-stopped' ? 'stopped' : 'backed-up';
        if (input.action === 'boot-backed-up') t.transition!.backupId = input.backupId;
      });
    } else if (input.action === 'complete-boot') {
      await appCheck(this.machines, target, false);
      if (!target.transition || !target.lease || target.transition.state !== 'backed-up')
        throw new AppError('缺少受控关机与完整冷备回执', 409);
      const bootId = await appBoot(this.machines, target.vmId);
      if (bootId === target.transition.fromBootId) throw new AppError('客户机未完成受控重启', 409);
      await this.store.write((rows) => {
        const t = rows.find((r) => r.appId === appId)!;
        t.bootId = bootId;
        t.revision++;
        t.lease!.expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        t.lease!.parentExecutionId = t.lease!.executionId;
        t.lease!.executionId = appNewId();
        t.lease!.bootId = bootId;
        t.transition = null;
        t.state = 'ready';
      });
    } else if (input.action === 'reconcile') {
      await appCheck(this.machines, target);
      if (target.transition) throw new AppError('存在启动转换，须先核销冷备记录', 409);
      await this.store.write((rows) => {
        const t = rows.find((r) => r.appId === appId)!;
        t.state = 'ready';
      });
    }
    return this.view(appId);
  }
  private async adopt(appId: string, name: string, vmId: string, projectId: string) {
    await this.authorize();
    const rows = await this.store.read();
    if (rows.some((r) => r.vmId === vmId || r.appId === appId)) throw new AppError('VM 或应用已被登记', 409);
    const vm = this.machines.get(vmId);
    if (vm.sandbox || vm.rescueOf || vm.managedNetwork !== 'isolated')
      throw new AppError('仅接管具有持久隔离配置的专用 VM', 409);
    if (this.machines.state(vmId) !== 'running') throw new AppError('先启动拟接管的专用实例', 409);
    const list = await this.workspaces.projects.list(vmId);
    if (!list.projects.some((p) => p.id === projectId) || list.projects.length !== 1)
      throw new AppError('首版只接管单项目专用实例', 409);
    const config = await this.workspaces.projects.with(vmId, projectId, () => this.workspaces.config(vmId));
    if (
      config.template !== 'none' ||
      config.command ||
      config.services?.length ||
      config.repository ||
      config.setup ||
      Object.keys(config.runtimes || {}).length ||
      Object.keys(config.environment || {}).length ||
      Object.keys(config.secrets || {}).length
    )
      throw new AppError('实例已有服务或项目配置，拒绝覆盖接管', 409);
    const directory = '/workspace/apps/' + appId;
    const out = await this.machines.exec(
      vmId,
      `set -eu\nfor tool in python3 tmux cc ip openssl useradd groupadd nft; do command -v "$tool" >/dev/null || { echo "missing runtime tool: $tool" >&2; exit 73; }; done\nprintf '#include <stdint.h>\\n#include <linux/if.h>\\n#include <sys/socket.h>\\n' | cc -x c -fsyntax-only -\ntest ! -e ${quote(directory)}\nmkdir -p /workspace/apps\nmkdir -m 700 ${quote(directory)}`,
      30000,
    );
    if (out.code) throw new AppError('专用目录或项目运行工具未就绪：' + out.stderr.slice(0, 1000), 409);
    await this.workspaces.projects.with(vmId, projectId, () =>
      this.workspaces.save(vmId, { directory, template: 'none', networkIsolation: 'host' }),
    );
    const target = appTargetSchema.parse({
      appId,
      name,
      revision: 1,
      vmId,
      vmCreatedAt: vm.createdAt,
      projectId,
      directory,
      diskIdentity: await appDiskIdentity(vmId),
      bootId: await appBoot(this.machines, vmId),
      createdAt: appNow(),
      desired: 'stopped',
      state: 'ready',
      lease: null,
      transition: null,
    });
    await appOwnDirectory(this.machines, this.workspaces, target, directory);
    await this.store.write((all) => {
      if (all.some((r) => r.vmId === vmId || r.appId === appId)) throw new AppError('目标已被并发登记', 409);
      all.push(target);
    });
  }
  async close() {
    await this.jobs.close();
    if (this.egress)
      for (const t of await this.store.read())
        for (const plan of await this.egress.list('app-targets:' + t.appId))
          if (['active', 'installing', 'unknown'].includes(plan.state)) {
            try {
              await this.egress.revoke(plan.id);
            } catch {
              await this.store.write((rows) => {
                rows.find((r) => r.appId === t.appId)!.state = 'unknown';
              });
            }
          }
  }
}
