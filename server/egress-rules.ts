/** 本体有限出站：先过滤后连通、内核时间截止、独立网络工作器撤回及持久回执。 */
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { MetadataStore } from './metadata-store.ts';
import { DATA } from './paths.ts';
import { captureOperationCheck } from './operation-context.ts';
import { resourceContext } from './host-runtime/context.ts';
import { pluginAuthority } from './plugin-authority.ts';
import type { VmAccess } from './vm-access.ts';
import type { EgressRulesV1 } from './service-contracts/egress-rules.ts';
import { egressInputSchema, egressPlanSchema, type EgressPlan, type EgressInput } from '../shared/contracts/egress-rules.ts';
import { AppError } from '../shared/errors.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stateSchema = z.object({ rows: z.array(egressPlanSchema), owners: z.record(z.string(), z.string()) }).strict();
type State = z.infer<typeof stateSchema>;
export class EgressRules implements EgressRulesV1 {
  private store: MetadataStore<State>;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private machines: VmAccess, root = DATA) {
    this.store = new MetadataStore(join(root, 'egress-rules.json'), { fallback: () => ({ rows: [], owners: {} }) });
  }
  private principal() { return resourceContext()?.serviceConsumerPluginInstanceId || resourceContext()?.callerPluginInstanceId || pluginAuthority()?.identity || 'core:application'; }
  private async state() { await captureOperationCheck()(); const value = await this.store.read(); return { value: stateSchema.parse(value.value), revision: value.revision }; }
  private claim(state: State, owner: string) {
    const principal = this.principal();
    if (state.owners[owner] && state.owners[owner] !== principal) throw new AppError('出站规则属于其他消费者', 403);
    if (principal.startsWith('official:') && !owner.startsWith(principal.slice(9) + ':')) throw new AppError('出站规则消费者命名空间不匹配', 403);
    state.owners[owner] = principal;
  }
  private async mutate<T>(work: (state: State) => Promise<T> | T) {
    return this.exclusive(async () => { const state = await this.state(); const result = await work(state.value);
      await this.store.replace(stateSchema.parse(state.value), { expectedRevision: state.revision, beforeCommit: () => captureOperationCheck()() }); return result; });
  }
  private exclusive<T>(work: () => Promise<T>) {
    const task = this.queue.then(work);
    this.queue = task.catch(() => {}); return task;
  }
  async init() { await this.state(); }
  async close() { await this.queue; await this.store.flush(); }
  async list(owner: string) { const state = (await this.state()).value; this.claim(state, owner); return structuredClone(state.rows.filter(row => row.owner === owner)); }
  private row(state: State, id: string) { const row = state.rows.find(value => value.id === id); if (!row) throw new AppError('出站计划不存在', 404); this.claim(state, row.owner); return row; }
  private chain(row: EgressPlan) { return 'SK_BX_' + row.id.replaceAll('-', '').slice(0, 16); }
  private async exec(row: EgressPlan, script: string) {
    const vm = this.machines.get(row.vmId), live = this.machines.live.get(row.vmId);
    if (vm.createdAt !== row.vmCreatedAt || live?.startedAt !== row.startedAt || this.machines.state(row.vmId) !== 'running') throw new AppError('出站规则的实例身份变化', 409);
    const result = await this.machines.exec(row.vmId, script, 15000);
    if (this.machines.live.get(row.vmId) !== live) throw new AppError('规则操作期间运行身份变化', 409);
    if (result.code !== 0) throw new AppError('无法核验客户机出站规则：' + result.stderr.slice(0, 1200), 409);
    return result.stdout.trim();
  }
  private network(row: EgressPlan, isolated?: boolean) { return this.machines.networkIsolation(row.vmId, row.vmCreatedAt, row.startedAt, isolated, Date.parse(row.expiresAt)); }
  private async originalRunEnded(row: EgressPlan) {
    const vm = this.machines.records.get(row.vmId), live = this.machines.live.get(row.vmId);
    if (!vm && !live) return true;
    if (vm?.createdAt === row.vmCreatedAt && !live && this.machines.state(row.vmId) === 'stopped') return true;
    if (vm?.createdAt === row.vmCreatedAt && live && live.startedAt !== row.startedAt) {
      const current = await this.machines.networkIsolation(row.vmId, vm.createdAt, live.startedAt);
      return current.isolated === true;
    }
    return false;
  }
  private async boot(row: EgressPlan) { if (await this.exec(row, 'cat /proc/sys/kernel/random/boot_id') !== row.bootId) throw new AppError('客户机启动身份变化', 409); }
  async preview(raw: EgressInput) {
    const input = egressInputSchema.parse(raw), end = Date.parse(input.expiresAt);
    if (end < Date.now() + 10000 || end > Date.now() + 86400000) throw new AppError('联网期限须在 10 秒至 24 小时内', 409);
    for (const target of input.destinations) {
      const first = Number(target.address.split('.')[0]);
      if (first === 0 || first === 127 || first >= 224 || /^10\.0\.2\./.test(target.address) || target.address === '169.254.169.254')
        throw new AppError('不支持回环、虚拟管理、元数据或组播地址', 409);
    }
    const vm = this.machines.get(input.vmId), live = this.machines.live.get(input.vmId);
    if (!live || this.machines.state(input.vmId) !== 'running') throw new AppError('先启动隔离目标', 409);
    const clock = await this.machines.exec(input.vmId, 'set -eu\ncommand -v iptables >/dev/null\ncommand -v ip6tables >/dev/null\ncat /proc/sys/kernel/random/boot_id\ndate -u +%s', 15000);
    if (clock.code) throw new AppError('目标缺少 iptables/ip6tables；先在镜像准备阶段安装', 409);
    const [bootId, seconds] = clock.stdout.trim().split(/\s+/);
    if (Math.abs(Date.now() - Number(seconds) * 1000) > 3000) throw new AppError('客户机时钟偏差超过 3 秒，拒绝绝对期限规则', 409);
    const now = new Date().toISOString();
    const base = { ...input, id: randomUUID(), vmCreatedAt: vm.createdAt, startedAt: live.startedAt, bootId, createdAt: now,
      approveBefore: new Date(Math.min(Date.now() + 600000, end)).toISOString() };
    const row = egressPlanSchema.parse({ ...base, digest: hash(base), state: 'planned', ruleDigest: null, observedAt: null, isolated: true, reason: '' });
    const network = await this.network(row);
    if (!network.isolated) throw new AppError('目标尚未隔离，先撤回原出站规则', 409);
    await this.mutate(state => { this.claim(state, input.owner); if (state.rows.length >= 1000) throw new AppError('出站计划记录已达上限', 507); state.rows.push(row); });
    return row;
  }
  private rules(row: EgressPlan) {
    const chain = this.chain(row);
    // 比已审阅绝对期限早 4 秒阻断，覆盖准入时最多 3 秒的客户机时钟偏差。
    const stop = new Date(Date.parse(row.expiresAt) - 4000).toISOString().slice(0, 19);
    return ['set -eu', ...['iptables', 'ip6tables'].flatMap(command => [
      `${command} -w -N ${chain}`, `${command} -w -A ${chain} -o lo -j RETURN`,
      ...(command === 'iptables' ? [
        ...['255.255.255.255', '10.0.2.2'].map(address => `${command} -w -A ${chain} -d ${address} -p udp --sport 68 --dport 67 -j RETURN`),
        `${command} -w -A ${chain} -m conntrack --ctstate ESTABLISHED --ctdir REPLY -j RETURN`,
        ...row.destinations.map(target => `${command} -w -A ${chain} -d ${target.address} -p ${target.protocol} --dport ${target.port} -m time --datestop ${stop} -j RETURN`),
      ] : []), `${command} -w -A ${chain} -m comment --comment sakura-bounded-egress -j REJECT`, `${command} -w -I OUTPUT 1 -j ${chain}`,
    ])].join('\n');
  }
  private async fingerprint(row: EgressPlan) {
    const chain = this.chain(row);
    return hash(await this.exec(row, ['set -eu', ...['iptables', 'ip6tables'].flatMap(command => [
      `${command} -w -C OUTPUT -j ${chain}`, `${command} -w -S OUTPUT`, `${command} -w -S ${chain}`,
    ])].join('\n')));
  }
  async apply(id: string, digest: string) {
    return this.exclusive(async () => {
      const state = (await this.state()).value;
      const row = this.row(state, id);
      if (row.digest !== digest || row.state !== 'planned' || Date.parse(row.approveBefore) <= Date.now()) throw new AppError('计划已改变、已使用或过期', 409);
      if (state.rows.some(other => other.id !== id && other.vmId === row.vmId && ['installing', 'active', 'expired', 'unknown'].includes(other.state))) throw new AppError('目标仍有未核销规则', 409);
      await this.boot(row); row.state = 'installing';
      // 先写入意图。进程中断后保留未知状态，不自动重放。
      const current = await this.store.read();
      await this.store.replace(state, { expectedRevision: current.revision });
      try {
        await this.network(row, true);
        const clock = Number(await this.exec(row, 'date -u +%s')) * 1000;
        if (!Number.isFinite(clock) || Math.abs(Date.now() - clock) > 3000) throw new AppError('客户机时钟偏差超过 3 秒', 409);
        await this.exec(row, this.rules(row));
        row.ruleDigest = await this.fingerprint(row);
        const network = await this.network(row, false);
        row.isolated = network.isolated; row.observedAt = network.observedAt; row.state = 'active'; row.reason = '';
      } catch (error) {
        row.state = 'unknown'; row.reason = String((error as Error).message).slice(0, 2000);
        try { row.isolated = (await this.network(row, true)).isolated; } catch { row.isolated = null; }
      }
      // 意图提交改变了版本；在同一串行队列中重读并提交结果。
      const latest = await this.store.read(); await this.store.replace(state, { expectedRevision: latest.revision });
      return structuredClone(row);
    });
  }
  async observe(id: string) {
    return this.mutate(async state => { const row = this.row(state, id);
      if (row.state === 'planned' || row.state === 'revoked') return structuredClone(row);
      try {
        if (await this.originalRunEnded(row)) { row.state = 'revoked'; row.isolated = true; row.observedAt = new Date().toISOString(); row.reason = '原运行已结束，未恢复临时联网'; return structuredClone(row); }
        await this.boot(row); const network = await this.network(row); row.isolated = network.isolated; row.observedAt = network.observedAt;
        const actual = await this.fingerprint(row);
        if (!row.ruleDigest || actual !== row.ruleDigest) { await this.network(row, true); row.isolated = true; throw new AppError('已安装规则发生变化，已撤回连通性', 409); }
        row.state = Date.parse(row.expiresAt) <= Date.now() ? (network.isolated ? 'expired' : 'unknown') : network.isolated ? 'unknown' : 'active';
        row.reason = row.state === 'unknown' ? '规则与预期连通性不一致，须核销' : '';
      } catch (error) {
        row.state = 'unknown'; row.reason = String((error as Error).message).slice(0, 2000);
        try { row.isolated = (await this.network(row, true)).isolated; } catch { row.isolated = null; }
      }
      return structuredClone(row);
    });
  }
  async revoke(id: string) {
    return this.mutate(async state => { const row = this.row(state, id);
      if (row.state === 'revoked') return structuredClone(row);
      if (await this.originalRunEnded(row)) { row.state = 'revoked'; row.isolated = true; row.observedAt = new Date().toISOString(); row.reason = '原运行已结束，未恢复临时联网'; return structuredClone(row); }
      await this.boot(row); const network = await this.network(row, true); row.isolated = network.isolated;
      if (!row.isolated) throw new AppError('出站撤回尚未确认', 503);
      const chain = this.chain(row);
      await this.exec(row, ['set -eu', ...['iptables', 'ip6tables'].flatMap(command => [
        `if ${command} -w -S ${chain} >/dev/null 2>&1; then`,
        `${command} -w -S ${chain} | grep -q sakura-bounded-egress`,
        `if ${command} -w -C OUTPUT -j ${chain} 2>/dev/null; then ${command} -w -D OUTPUT -j ${chain}; fi`,
        `${command} -w -F ${chain}`, `${command} -w -X ${chain}`, 'fi',
      ])].join('\n'));
      row.state = 'revoked'; row.observedAt = network.observedAt; row.reason = ''; return structuredClone(row);
    });
  }
}
