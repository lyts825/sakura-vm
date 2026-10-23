/** 镜像工坊领域服务：每个插件独立元数据，跨域仅使用公共服务。 */
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import {
  foundryActionSchema,
  foundryBlueprintSchema,
  foundryPlanSchema,
  foundryRecordSchema,
  foundryScopeSchema,
  type FoundryScope,
  type FoundryRecord,
  type FoundryAction,
  type FoundryPlan,
  type FoundryResult,
  type FoundryView,
  type FoundryBlueprint,
  type FoundryUse,
  foundrySections,
} from '../shared/contracts/foundry.ts';
import type { ImageAsset, OwnedImageVm } from '../shared/contracts/image-assets.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import type { FoundrySourcesV1, FoundryCatalogV1 } from './service-contracts/foundry.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { VmAccess } from './vm-access.ts';
import { Jobs } from './jobs.ts';
import { packageCacheScript } from './package-cache.ts';
import { quote } from './shell.ts';
const schema = z
  .object({
    version: z.literal(1),
    rows: z.array(foundryRecordSchema).max(2000),
    plans: z.array(foundryPlanSchema).max(128),
    imports: z
      .record(
        z.string(),
        z.object({ scope: foundryScopeSchema, blueprint: foundryBlueprintSchema.optional() }).strict(),
      )
      .default({}),
  })
  .strict();
type State = z.infer<typeof schema>;
type Section = (typeof foundrySections)[number];
const key = (s: FoundryScope) => s.workspaceId;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ref = (a: ImageAsset) => ({ assetId: a.id, digest: a.digest });
const templates: FoundryView['templates'] = [
  {
    name: '隔离交付基础',
    packages: [
      'python3',
      'tmux',
      'gcc',
      'musl-dev',
      'linux-headers',
      'make',
      'iproute2',
      'openssl',
      'shadow',
      'nftables',
      'iptables',
    ],
    commands: [],
    tools: ['python3', 'tmux', 'cc', 'ip', 'openssl', 'useradd', 'groupadd', 'nft', 'iptables'],
    memoryMiB: 1024,
    timeoutMinutes: 30,
  },
  {
    name: 'Node.js 离线运行环境',
    packages: [
      'python3',
      'tmux',
      'gcc',
      'musl-dev',
      'linux-headers',
      'make',
      'iproute2',
      'openssl',
      'shadow',
      'nftables',
      'iptables',
      'nodejs',
      'npm',
    ],
    commands: [],
    tools: [
      'python3',
      'tmux',
      'cc',
      'ip',
      'openssl',
      'useradd',
      'groupadd',
      'nft',
      'iptables',
      'node',
      'npm',
    ],
    memoryMiB: 2048,
    timeoutMinutes: 45,
  },
  {
    name: 'Python 离线运行环境',
    packages: [
      'python3',
      'tmux',
      'gcc',
      'musl-dev',
      'linux-headers',
      'make',
      'iproute2',
      'openssl',
      'shadow',
      'nftables',
      'iptables',
    ],
    commands: [],
    tools: ['python3', 'tmux', 'cc', 'ip', 'openssl', 'useradd', 'groupadd', 'nft', 'iptables'],
    memoryMiB: 1024,
    timeoutMinutes: 30,
  },
];
const tasks: Record<Section, readonly string[]> = {
  sources: [],
  blueprints: [],
  depot: ['materials', 'recover'],
  builders: ['build', 'recover'],
  sanitizers: ['sanitize', 'recover'],
  checks: ['check', 'recover'],
  catalog: ['publish', 'instantiate', 'withdraw', 'recover'],
  exchange: ['export', 'accept', 'recover'],
  workbench: [],
};
/** 只接收本包自建实例；清理固定路径，不接收外部任意脚本或路径。 */
const reseed = `set -eu
if [ -d /var/lib/cloud ]; then rm -rf -- /var/lib/cloud; fi
if command -v rc-update >/dev/null 2>&1; then
 for service in tiny-cloud-boot tiny-cloud-early tiny-cloud-main tiny-cloud-final; do
  test -f "/etc/init.d/$service" || { echo "缺少首次启动初始化器：$service" >&2; exit 9; }
  level=default; [ "$service" != tiny-cloud-boot ] || level=boot
  rc-update add "$service" "$level"
 done
elif ! command -v cloud-init >/dev/null 2>&1; then
 echo '镜像缺少支持的首次启动初始化器' >&2; exit 9
fi
sync`;
const growAlpine = `set -eu
if ! command -v resize2fs >/dev/null; then apk add --no-cache e2fsprogs-extra; fi
root=$(awk '$2=="/" {print $1}' /proc/mounts)
case "$root" in /dev/vda) resize2fs /dev/vda ;; *) echo "由系统初始化器处理根分区容量：$root" ;; esac
`;
const sanitize = `${reseed}
rm -f /root/.ash_history /root/.bash_history /root/.python_history /root/.npmrc /root/.pypirc
rm -f /root/.netrc /root/.git-credentials /etc/apt/auth.conf /var/log/cloud-init.log /var/log/cloud-init-output.log
rm -rf -- /root/.ssh /root/.aws /root/.azure /root/.config/gcloud /root/.docker /etc/apt/auth.conf.d
rm -f /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub /etc/machine-id /var/lib/dbus/machine-id
if [ -d /var/lib/cloud ]; then rm -rf -- /var/lib/cloud; fi
mkdir -p /usr/local/sbin
cat > /usr/local/sbin/foundry-first-boot <<'FOUNDRY_IDENTITY'
#!/bin/sh
set -eu
if [ ! -s /etc/machine-id ]; then tr -d '-' < /proc/sys/kernel/random/uuid > /etc/machine-id; fi
ssh-keygen -A
FOUNDRY_IDENTITY
chmod 700 /usr/local/sbin/foundry-first-boot
if command -v rc-update >/dev/null 2>&1; then
 printf '#!/sbin/openrc-run\ndescription="Foundry unique machine identity"\ncommand="/usr/local/sbin/foundry-first-boot"\ndepend() { before sshd tiny-cloud-final; }\n' > /etc/init.d/foundry-identity
 chmod 700 /etc/init.d/foundry-identity
 rc-update add foundry-identity boot
elif command -v systemctl >/dev/null 2>&1; then
 printf '[Unit]\nBefore=ssh.service sshd.service\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/foundry-first-boot\n[Install]\nWantedBy=multi-user.target\n' > /etc/systemd/system/foundry-identity.service
 systemctl enable foundry-identity.service
else
 echo '不支持此系统的首次启动身份适配器' >&2; exit 9
fi
rm -f /root/.ssh/authorized_keys
test ! -e /etc/machine-id
test ! -e /root/.ssh/authorized_keys
test ! -e /root/.netrc
test ! -e /root/.git-credentials
test ! -e /root/.aws
test ! -e /root/.docker
sync
printf 'identity-cleanup=confirmed\n'
`;

export class Foundry implements FoundryCatalogV1 {
  readonly jobs: Jobs;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(
    readonly section: Section,
    private metadata: PluginMetadata,
    private machines: VmAccess,
    private assets: ImageAssetsV1,
    private dependencies: FoundrySourcesV1[],
    private authorize: (scope: FoundryScope) => Promise<void>,
  ) {
    this.jobs = new Jobs('foundry-' + section);
  }
  private async state(scope: FoundryScope) {
    foundryScopeSchema.parse(scope);
    if (this.closed) throw new AppError('工坊插件已关闭', 503);
    await this.authorize(scope);
    const s = await this.metadata.read();
    return {
      value:
        s.value === null ? { version: 1 as const, rows: [], plans: [], imports: {} } : schema.parse(s.value),
      revision: s.revision,
    };
  }
  private async mutate<T>(scope: FoundryScope, fn: (s: State) => Promise<T> | T) {
    const task = this.queue.then(async () => {
      const s = await this.state(scope),
        result = await fn(s.value);
      await this.metadata.replace(schema.parse(s.value), {
        expectedRevision: s.revision,
        beforeCommit: () => this.authorize(scope),
      });
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async view(scope: FoundryScope): Promise<FoundryView> {
    const state = (await this.state(scope)).value,
      rows = new Map<string, FoundryRecord>();
    for (const service of this.dependencies)
      for (const row of (await service.view(scope)).rows) rows.set(row.id, row);
    for (const row of state.rows.filter((r) => key(r.scope) === key(scope))) rows.set(row.id, row);
    return {
      rows: [...rows.values()],
      plans: state.plans.filter((p) => key(p.scope) === key(scope) && Date.parse(p.expiresAt) > Date.now()),
      templates,
      capabilities: tasks[this.section].slice(),
      pendingUploads: (await this.assets.uploads()).filter((u) => {
        const imported = state.imports[u.id];
        return imported && key(imported.scope) === key(scope);
      }),
    };
  }
  private async get(scope: FoundryScope, id: string) {
    const row = (await this.view(scope)).rows.find((r) => r.id === id);
    if (!row) throw new AppError('当前工坊中不存在此记录', 404);
    return row;
  }
  private async add(
    scope: FoundryScope,
    input: Pick<FoundryRecord, 'name' | 'parents'> & Partial<FoundryRecord>,
  ) {
    return this.mutate(scope, async (s) => {
      if (s.rows.length >= 2000) throw new AppError('工坊记录数量已达上限', 507);
      const row = foundryRecordSchema.parse({
        id: randomUUID(),
        scope,
        section: this.section,
        revision: 1,
        digest: hash(input),
        createdAt: new Date().toISOString(),
        state: 'ready',
        ...input,
      });
      // 引用先于可见记录提交；元数据失败时保留引用，不留下可被回收的发布记录。
      if (row.image) await this.assets.retain(ref(row.image), this.owner(scope, row.id));
      s.rows.push(row);
      return row;
    });
  }
  private async update(scope: FoundryScope, id: string, patch: Partial<FoundryRecord>) {
    return this.mutate(scope, (s) => {
      const row = s.rows.find((r) => r.id === id && key(r.scope) === key(scope));
      if (!row) throw new AppError('只能修改本插件拥有的记录', 403);
      Object.assign(row, patch, { revision: row.revision + 1 });
      row.digest = hash({
        section: row.section,
        parents: row.parents,
        blueprint: row.blueprint,
        image: row.image,
        evidence: row.evidence,
        state: row.state,
      });
      return structuredClone(row);
    });
  }
  private require(section: Section[]) {
    if (!section.includes(this.section)) throw new AppError('此插件不提供该操作', 403);
  }
  private async blueprint(scope: FoundryScope, row: FoundryRecord): Promise<FoundryBlueprint> {
    if (row.blueprint) return row.blueprint;
    for (const id of row.parents) {
      const parent = await this.get(scope, id);
      if (parent.blueprint) return parent.blueprint;
    }
    throw new AppError('缺少固定的环境蓝图', 409);
  }
  private async assertImage(row: FoundryRecord) {
    if (!row.image) throw new AppError('记录没有已封存镜像', 409);
    await this.assets.verify(ref(row.image));
    return row.image;
  }
  private owner(scope: FoundryScope, id: string) {
    return 'foundry-' + this.section + ':' + hash(scope).slice(0, 20) + ':' + id;
  }
  private async waitVm(receipt: OwnedImageVm, signal: AbortSignal) {
    const until = Date.now() + 240000;
    signal.throwIfAborted();
    await this.machines.start(receipt.vmId);
    while (this.machines.state(receipt.vmId) === 'starting' && Date.now() < until)
      await delay(200, undefined, { signal });
    signal.throwIfAborted();
    const vm = this.machines.get(receipt.vmId);
    if (vm.createdAt !== receipt.createdAt || this.machines.state(receipt.vmId) !== 'running')
      throw new AppError('工坊实例启动未完成', 409);
  }
  private async command(
    receipt: OwnedImageVm,
    command: string,
    signal: AbortSignal,
    log: (s: string) => void,
    timeout = 180000,
  ) {
    if (this.machines.get(receipt.vmId).createdAt !== receipt.createdAt)
      throw new AppError('工坊实例身份变化', 409);
    const r = await this.machines.exec(receipt.vmId, command, timeout, signal, (t) => log(t.slice(-32000)));
    if (r.code !== 0)
      throw new AppError('工坊命令失败，退出码 ' + r.code + '：' + r.stderr.slice(-2000), 409);
    return r.stdout;
  }
  private async launch(scope: FoundryScope, row: FoundryRecord, task: string, base: FoundryRecord) {
    const job = this.jobs.start(row.id, async (log, signal) => {
      const receipts: OwnedImageVm[] = [];
      let error: unknown;
      try {
        await this.authorize(scope);
        await this.update(scope, row.id, { state: 'running', cleanup: 'pending' });
        const blueprint = await this.blueprint(scope, base);
        const image = await this.assertImage(base);
        const count = task === 'check' ? 2 : 1;
        let captured: ImageAsset | undefined;
        const evidence: string[] = [];
        for (let n = 0; n < count; n++) {
          signal.throwIfAborted();
          const receipt = await this.assets.createOwnedVm({
            imageRef: ref(image),
            owner: this.owner(scope, row.id),
            name: 'foundry-' + randomUUID().slice(0, 8),
            memoryMiB: blueprint.memoryMiB,
            cpus: 1,
            network: task === 'materials' ? 'nat' : 'isolated',
            lifetimeMinutes: blueprint.timeoutMinutes,
            persistent: false,
          });
          receipts.push(receipt);
          await this.update(scope, row.id, { receipts: [...receipts] });
          await this.waitVm(receipt, signal);
          if (task === 'materials') {
            if (image.distro === 'alpine') await this.command(receipt, growAlpine, signal, log, 300000);
            for (const pkg of blueprint.packages) {
              log('预取 ' + pkg + '\n');
              await this.command(
                receipt,
                packageCacheScript(image.distro, 'cache-prefetch', pkg),
                signal,
                log,
                blueprint.timeoutMinutes * 60000,
              );
            }
            const inventory = await this.command(
              receipt,
              'set -eu\nfind /var/cache/sakura/packages -name SHA256SUMS -type f -exec cat {} \\;\ndu -sk /var/cache/sakura/packages',
              signal,
              log,
            );
            if (Buffer.byteLength(inventory) > 524288) throw new AppError('材料清单过大', 413);
            const total = Number(inventory.trim().split('\n').at(-1)?.split(/\s+/)[0]);
            if (!Number.isFinite(total) || total > 2 * 1024 * 1024)
              throw new AppError('材料超过 2 GiB 预算', 413);
            evidence.push(inventory);
            await this.command(receipt, reseed, signal, log);
          }
          if (task === 'build') {
            for (const pkg of blueprint.packages)
              await this.command(
                receipt,
                packageCacheScript(image.distro, 'cache-install', pkg),
                signal,
                log,
                blueprint.timeoutMinutes * 60000,
              );
            for (const command of blueprint.commands)
              await this.command(receipt, command, signal, log, blueprint.timeoutMinutes * 60000);
            evidence.push(
              await this.command(
                receipt,
                'set -eu\n' +
                  blueprint.tools.map((t) => 'command -v ' + quote(t)).join('\n') +
                  '\n' +
                  (image.distro === 'alpine' ? 'apk info -vv' : 'dpkg-query -W'),
                signal,
                log,
              ),
            );
            await this.command(receipt, reseed, signal, log);
          }
          if (task === 'sanitize') {
            evidence.push(await this.command(receipt, sanitize, signal, log));
          }
          if (task === 'check') {
            const vm = this.machines.get(receipt.vmId);
            if (vm.managedNetwork !== 'isolated' && vm.sandbox?.network !== 'isolated')
              throw new AppError('验收实例没有本体断网约束', 409);
            if (blueprint.tools.includes('cc')) {
              const source =
                '#define _GNU_SOURCE\n#include <stdint.h>\n#include <sched.h>\n#include <linux/capability.h>\n#include <sys/prctl.h>\nint main(void) { uint32_t value = 0; return (int)value; }\n';
              evidence.push(
                await this.command(
                  receipt,
                  'set -eu\nprintf %s ' +
                    quote(source) +
                    ' > /tmp/foundry-compiler.c\ncc -Wall -Werror /tmp/foundry-compiler.c -o /tmp/foundry-compiler\n/tmp/foundry-compiler\nprintf "compiler-headers=confirmed\\n"',
                  signal,
                  log,
                ),
              );
            }
            const probe = `set -eu\n${blueprint.tools.map((t) => 'command -v ' + quote(t)).join('\n')}\ntest -s /etc/machine-id\nprintf 'machine='; cat /etc/machine-id\nprintf '\\nssh='; ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub\nprintf '\\ncontroller='; sha256sum /root/.ssh/authorized_keys\nuseradd -u 29000 -M -s /bin/sh foundrycheck\nprintf private > /tmp/foundry-private\nchmod 600 /tmp/foundry-private\nsu -s /bin/sh foundrycheck -c 'test "$(id -u)" = 29000; test ! -r /tmp/foundry-private'\npython3 -I -S -c ${quote("import socket\ns=socket.socket();s.settimeout(2)\ntry:\n s.connect(('1.1.1.1',443))\nexcept OSError:\n print('network=isolated')\nelse:\n raise SystemExit('unexpected network access')\nfinally:\n s.close()")}`;
            evidence.push(await this.command(receipt, probe, signal, log));
          }
          await this.machines.stop(receipt.vmId);
          if (this.machines.live.has(receipt.vmId)) throw new AppError('封存前停止尚未确认', 503);
          if (task !== 'check') {
            captured = await this.assets.captureVm(receipt.vmId, receipt.createdAt);
            await this.assets.retain(ref(captured), this.owner(scope, row.id));
          }
        }
        if (task === 'check') {
          for (const prefix of ['machine=', 'ssh=', 'controller=']) {
            const values = evidence.flatMap((t) => t.split('\n').filter((l) => l.startsWith(prefix)));
            if (values.length !== 2 || new Set(values).size !== 2)
              throw new AppError('两台验收实例的身份未独立更新：' + prefix, 409);
          }
          captured = image;
          await this.assets.retain(ref(image), this.owner(scope, row.id));
        }
        await this.update(scope, row.id, {
          image: captured,
          evidence: evidence.join('\n--- independent boot ---\n').slice(0, 1048576),
          state: 'succeeded',
        });
      } catch (e) {
        error = e;
        await this.update(scope, row.id, {
          state: signal.aborted ? 'interrupted' : 'failed',
          error: e instanceof Error ? e.message.slice(0, 4096) : String(e).slice(0, 4096),
        });
      } finally {
        let unknown = false;
        for (const receipt of receipts) {
          try {
            await this.assets.destroyOwnedVm(receipt);
          } catch (e) {
            unknown = true;
            log('清理未确认：' + String(e) + '\n');
          }
        }
        await this.update(scope, row.id, {
          cleanup: unknown ? 'unknown' : 'confirmed',
          receipts: await this.assets.owned(this.owner(scope, row.id)),
        });
        if (unknown) throw new AppError('工坊资源清理未确认', 503, 'VM_CLEANUP_PENDING');
      }
      if (error) throw error;
    });
    try {
      return await this.update(scope, row.id, { jobId: job.id });
    } catch (error) {
      this.jobs.cancel(row.id, error);
      await this.jobs.wait(row.id);
      throw error;
    }
  }
  async previewUse(scope: FoundryScope, id: string): Promise<FoundryUse> {
    this.require(['catalog']);
    const row = await this.get(scope, id);
    if (row.section !== 'catalog' || row.state !== 'published' || row.cleanup !== 'confirmed')
      throw new AppError('镜像修订尚未发布或已撤回', 409);
    const a = await this.assertImage(row);
    return { imageRef: ref(a), revisionDigest: row.digest, evidence: row.evidence, cleanup: 'confirmed' };
  }
  async authorizeUse(scope: FoundryScope, id: string, owner: string) {
    if (!owner) throw new AppError('需要明确消费者身份');
    // 目录只批准修订；引用必须由真实消费者通过本体接口取得。
    return this.previewUse(scope, id);
  }
  async act(scope: FoundryScope, raw: FoundryAction): Promise<FoundryResult> {
    await this.state(scope);
    const input = foundryActionSchema.parse(raw);
    if (input.action === 'stage-import') {
      this.require(['sanitizers']);
      const image = await this.assets.verify(ref(input.image));
      const row = await this.add(scope, {
        name: input.blueprint.name + ' 导入待清理',
        parents: [],
        blueprint: input.blueprint,
        image,
        state: 'accepted',
        trust: 'unverified',
      });
      return row;
    }
    if (input.action === 'prepare') {
      this.require(['sources']);
      const asset = await this.assets.prepareBuiltin(input.distro, input.architecture);
      const row = await this.add(scope, {
        name: input.distro + ' / ' + input.architecture,
        parents: [],
        image: asset,
      });
      return row;
    }
    if (input.action === 'save') {
      this.require(['blueprints']);
      const blueprint = foundryBlueprintSchema.parse(input.blueprint),
        source = await this.get(scope, blueprint.sourceId);
      if (source.section !== 'sources' || source.state !== 'ready')
        throw new AppError('请选择已核验的基础来源', 409);
      await this.assertImage(source);
      if (input.id) {
        const old = await this.get(scope, input.id);
        if (old.revision !== input.expectedRevision) throw new AppError('蓝图修订冲突', 409);
        return this.add(scope, {
          name: blueprint.name,
          parents: [source.id],
          blueprint,
          image: source.image,
        });
      }
      if (input.expectedRevision !== 0) throw new AppError('新蓝图修订必须从 0 创建', 409);
      return this.add(scope, { name: blueprint.name, parents: [source.id], blueprint, image: source.image });
    }
    if (input.action === 'archive') {
      const row = await this.get(scope, input.id);
      if (row.revision !== input.expectedRevision) throw new AppError('归档修订冲突', 409);
      if (
        row.section !== this.section ||
        row.cleanup !== 'confirmed' ||
        ['queued', 'running', 'published'].includes(row.state)
      )
        throw new AppError('先完成任务、确认清理并撤回发布，再归档本插件记录', 409);
      const archived = await this.update(scope, row.id, { state: 'archived' });
      if (row.image) await this.assets.release(ref(row.image), this.owner(scope, row.id));
      return archived;
    }
    if (input.action === 'plan') {
      if (!tasks[this.section].includes(input.input.task)) throw new AppError('当前插件不提供此任务', 403);
      const row = await this.get(scope, input.input.id);
      const plan = foundryPlanSchema.parse({
        token: randomUUID(),
        scope,
        input: input.input,
        dependencyDigest: row.digest,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        network:
          input.input.task === 'materials'
            ? 'nat'
            : ['build', 'sanitize', 'check', 'instantiate'].includes(input.input.task)
              ? 'isolated'
              : 'none',
        description:
          input.input.task === 'materials'
            ? '显式创建 NAT 临时实例，只预取所选基础镜像仓库中的系统软件包；默认限 2 GiB。其他执行阶段不联网。'
            : input.input.task === 'sanitize'
              ? '在独立副本删除构建凭据、控制授权、SSH 主机密钥、机器标识和 cloud-init 缓存；设置首次启动生成身份。'
              : '固定输入摘要 ' + row.digest + '；使用独立实例，失败保留清理回执。',
      });
      await this.mutate(scope, (s) => {
        s.plans = s.plans.filter((p) => Date.parse(p.expiresAt) > Date.now());
        s.plans.push(plan);
      });
      return plan;
    }
    if (input.action === 'execute') {
      const plan = await this.mutate(scope, (s) => {
        const p = s.plans.find((x) => x.token === input.token && key(x.scope) === key(scope));
        if (!p || Date.parse(p.expiresAt) < Date.now()) throw new AppError('计划已过期或已使用', 409);
        s.plans = s.plans.filter((x) => x.token !== input.token);
        return p;
      });
      const base = await this.get(scope, plan.input.id);
      if (base.digest !== plan.dependencyDigest) throw new AppError('计划输入已变化，请重新预览', 409);
      const task = plan.input.task;
      if (task === 'recover') {
        if (base.section !== this.section || this.jobs.view(base.id)?.status === 'running')
          throw new AppError('先取消活动任务并等待清理结束', 409);
        for (const receipt of await this.assets.owned(this.owner(scope, base.id)))
          await this.assets.destroyOwnedVm(receipt);
        return this.update(scope, base.id, {
          state: ['queued', 'running'].includes(base.state) ? 'interrupted' : base.state,
          cleanup: 'confirmed',
          receipts: await this.assets.owned(this.owner(scope, base.id)),
        });
      }
      if (task === 'withdraw') return this.update(scope, base.id, { state: 'withdrawn' });
      if (task === 'accept') {
        this.require(['exchange']);
        if (base.state !== 'quarantined') throw new AppError('导入尚未完整或已接受', 409);
        return this.update(scope, base.id, {
          state: 'accepted',
          evidence: '来源未认证；用户显式接收，仅允许下一阶段清理与本机验收。',
        });
      }
      if (task === 'publish') {
        if (base.section !== 'checks' || base.state !== 'succeeded' || base.cleanup !== 'confirmed')
          throw new AppError('需要成功且清理确认的双实例验收', 409);
        const a = await this.assertImage(base),
          row = await this.add(scope, {
            name: plan.input.name || base.name,
            parents: [base.id],
            blueprint: base.blueprint,
            image: a,
            evidence: base.evidence,
            state: 'published',
            trust: base.trust,
          });
        return row;
      }
      if (task === 'instantiate') {
        const use = await this.previewUse(scope, base.id);
        const row = await this.add(scope, {
          name: plan.input.name || base.name,
          parents: [base.id],
          image: base.image,
          state: 'running',
          cleanup: 'pending',
        });
        const receipt = await this.assets.createOwnedVm({
          imageRef: use.imageRef,
          owner: this.owner(scope, row.id),
          name: 'foundry-use-' + randomUUID().slice(0, 8),
          network: 'isolated',
          persistent: true,
        });
        return this.update(scope, row.id, { receipts: [receipt], state: 'succeeded', cleanup: 'confirmed' });
      }
      if (task === 'export') {
        if (!base.image || !['published', 'succeeded'].includes(base.state))
          throw new AppError('只能导出已封存且验收过的镜像', 409);
        return this.add(scope, {
          name: base.name + ' 交接',
          parents: [base.id],
          blueprint: base.blueprint,
          image: base.image,
          state: 'succeeded',
          evidence: JSON.stringify({
            format: 'sakura-image-v1',
            image: base.image,
            blueprint: base.blueprint,
            sourceDigest: base.digest,
            signature: null,
          }),
          trust: base.trust,
        });
      }
      const allowed: Record<string, Section[]> = {
        materials: ['blueprints'],
        build: ['depot'],
        sanitize: ['builders', 'sanitizers'],
        check: ['sanitizers'],
      };
      if (
        !allowed[task]?.includes(base.section) ||
        !['ready', 'succeeded', 'accepted'].includes(base.state) ||
        base.cleanup !== 'confirmed'
      )
        throw new AppError('前一阶段尚未完成或清理未确认', 409);
      const blueprint = await this.blueprint(scope, base),
        row = await this.add(scope, {
          name: plan.input.name || blueprint.name,
          parents: [base.id],
          blueprint,
          state: 'queued',
          cleanup: 'pending',
          trust: base.trust,
        });
      try {
        return await this.launch(scope, row, task, base);
      } catch (e) {
        const receipts = await this.assets.owned(this.owner(scope, row.id));
        await this.update(scope, row.id, {
          state: 'failed',
          error: String(e).slice(0, 4096),
          cleanup: receipts.every((r) => r.cleanup === 'confirmed') ? 'confirmed' : 'unknown',
          receipts,
        });
        throw e;
      }
    }
    if (input.action === 'cancel') {
      const row = await this.get(scope, input.id);
      if (row.section !== this.section) throw new AppError('不可取消其他插件任务', 403);
      this.jobs.cancel(row.id);
      return row;
    }
    if (input.action === 'begin-import') {
      this.require(['sources', 'exchange']);
      const upload = await this.assets.begin(input.input);
      await this.mutate(scope, (s) => {
        s.imports[upload.id] = { scope, blueprint: input.blueprint };
      });
      return upload;
    }
    if (input.action === 'append-import') {
      this.require(['sources', 'exchange']);
      const imported = (await this.state(scope)).value.imports[input.id];
      if (!imported || key(imported.scope) !== key(scope)) throw new AppError('上传不属于当前工坊空间', 403);
      return this.assets.append(input.id, input.offset, input.data);
    }
    if (input.action === 'finish-import') {
      this.require(['sources', 'exchange']);
      const imported = (await this.state(scope)).value.imports[input.id];
      if (!imported || key(imported.scope) !== key(scope)) throw new AppError('上传不属于当前工坊空间', 403);
      const image = await this.assets.finish(input.id),
        row = await this.add(scope, {
          name: image.distro + ' 导入镜像',
          parents: [],
          image,
          state: this.section === 'sources' ? 'ready' : 'quarantined',
          trust: 'unverified',
          blueprint:
            this.section === 'exchange'
              ? imported.blueprint || { ...templates[0], sourceId: randomUUID() }
              : undefined,
        });
      return row;
    }
    if (input.action === 'discard-import') {
      this.require(['sources', 'exchange']);
      const imported = (await this.state(scope)).value.imports[input.id];
      if (!imported || key(imported.scope) !== key(scope)) throw new AppError('上传不属于当前工坊空间', 403);
      await this.assets.discardUpload(input.id);
      await this.mutate(scope, (s) => {
        delete s.imports[input.id];
      });
      return { closed: true };
    }
    if (input.action === 'open-read') {
      const row = await this.get(scope, input.id),
        image = await this.assertImage(row);
      return this.assets.acquire(ref(image), this.owner(scope, row.id));
    }
    if (input.action === 'read')
      return this.assets.read(input.imageRef, input.token, input.offset, input.length);
    if (input.action === 'close-read') {
      await this.assets.closeLease(input.token);
      return { closed: true };
    }
    if (input.action === 'cleanup-plan') {
      this.require(['catalog']);
      return this.assets.cleanupPlan();
    }
    if (input.action === 'cleanup') {
      this.require(['catalog']);
      return this.assets.cleanup(input.token);
    }
    throw new AppError('未提供此操作');
  }
  async close() {
    await this.jobs.close();
    await this.queue;
    this.closed = true;
  }
}
