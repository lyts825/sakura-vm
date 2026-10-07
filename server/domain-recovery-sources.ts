/**
 * 模块职责：把备份、冷迁移和同步的持久领域票据接入恢复目录，依据原日志判断恢复状态。
 */
import type { DomainRecoveryPort, DomainRecoveryTicket } from '../shared/contracts/domain-recovery.ts';
import { recoveryBinding, type RecoveryBinding } from '../shared/contracts/recovery.ts';
import { AppError } from '../shared/errors.ts';
import { discoverBackupRecoveryTickets } from './backups.ts';
import { discoverColdMigrationRecoveryTickets } from './cold-migration.ts';
import { discoverSyncRecoveryTickets } from './sync.ts';
import type { RecoverySource } from './recovery-catalog.ts';

type Options = {
  vmIds(): readonly string[];
  backups?(): DomainRecoveryPort | undefined;
  coldMigrations?(): DomainRecoveryPort | undefined;
  sync?(): DomainRecoveryPort | undefined;
};
type Definition = {
  id: string;
  action: { id: string; title: string };
  port(): DomainRecoveryPort | undefined;
  scan(): Promise<DomainRecoveryTicket[]>;
  exactTerminalRevision?: boolean;
};
function binding(domain: string, ticket: DomainRecoveryTicket): RecoveryBinding {
  const origin = ticket.origin;
  return recoveryBinding.parse({ domain, ticketId: ticket.id, owner: origin?.owner || 'domain:' + domain,
    vmId: ticket.vmId, projectId: ticket.projectId, pluginId: origin?.pluginId,
    pluginInstanceId: origin?.pluginInstanceId, pluginGeneration: origin?.pluginGeneration,
    artifactDigest: origin?.artifactDigest, operationId: origin?.operationId });
}
const key = (value: RecoveryBinding) => JSON.stringify(value);
function source(definition: Definition): RecoverySource {
  let tickets = new Map<string, DomainRecoveryTicket>();
  let terminal = new Map<string, DomainRecoveryTicket>();
  const rememberTerminal = (current: DomainRecoveryTicket[]) => {
    terminal = new Map(current.filter(ticket => ticket.state === 'resolved')
      .map(ticket => [key(binding(definition.id, ticket)), ticket]));
  };
  const port = () => { try { return definition.port(); } catch { return undefined; } };
  return {
    id: definition.id,
    discover: async () => {
      const live = port();
      let current: DomainRecoveryTicket[];
      if (live) {
        try { current = await live.recoveryTickets(); }
        catch { current = (await definition.scan()).map(ticket => ({ ...ticket, available: false })); }
      } else current = await definition.scan();
      rememberTerminal(current);
      tickets = new Map(current.map(ticket => [key(binding(definition.id, ticket)), ticket]));
      return current.filter(ticket => ticket.state === 'pending').map(ticket => ({
        binding: binding(definition.id, ticket), ticketRevision: ticket.revision, error: ticket.error,
        resourceIds: ticket.origin?.resourceIds || [],
        actions: live && ticket.available && !ticket.error ? [definition.action] : [],
      }));
    },
    recover: async (candidate, action) => {
      const live = port(), ticket = tickets.get(key(candidate.binding));
      if (!live || !ticket || !ticket.available || ticket.error || action !== definition.action.id ||
          ticket.revision !== candidate.ticketRevision)
        throw new AppError('原领域票据或恢复服务当前不可用', 409, 'DOMAIN_RECOVERY_UNAVAILABLE');
      await live.recoverTicket(ticket);
      // Read durable domain state once. Catalog confirmation never infers success from a missing file.
      rememberTerminal(await definition.scan());
    },
    confirmed: record => {
      const ticket = terminal.get(key(record.binding));
      return !!ticket && (!definition.exactTerminalRevision || ticket.revision === record.ticketRevision);
    },
  };
}

/** Static discovery survives disabled plugins; mutations always return to the owning domain. */
export function domainRecoverySources(options: Options): RecoverySource[] {
  return [
    source({ id: 'backup-publication', action: { id: 'reconcile', title: '核对原备份发布日志' },
      port: () => options.backups?.(), scan: discoverBackupRecoveryTickets, exactTerminalRevision: true }),
    source({ id: 'cold-migration', action: { id: 'retry-copy', title: '重试原迁移复制并保留源实例' },
      port: () => options.coldMigrations?.(), scan: discoverColdMigrationRecoveryTickets }),
    source({ id: 'sync-checkpoint', action: { id: 'rollback', title: '回滚原同步检查点' },
      port: () => options.sync?.(), scan: () => discoverSyncRecoveryTickets(options.vmIds()) }),
  ];
}
