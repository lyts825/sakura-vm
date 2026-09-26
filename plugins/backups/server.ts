export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginOperation } from '../../server/plugin-api.ts';

import { z } from 'zod';
import { AppError } from '../../server/model.ts';

import { Backups } from '../../server/backups.ts';
import { retryTarget } from '../../server/plugins/retry.ts';
import { BackupRecovery } from '../../server/backup-recovery.ts';
import { backupRecoverySchema } from '../../shared/backup-recovery.ts';
import { rescueArtifactSchema, rescueJobSchema, rescueViewSchema } from '../../shared/rescue.ts';

export async function activate(host: PluginContext) {
  const m = host.machines;
  host.backups = new Backups(m, host.bundles, host.secrets);
  host.registerJobs(host.backups.jobs, (job) => {
    if (job.action !== 'run') throw new AppError('请回到原功能页面重新执行');
    return host.backups.run(retryTarget(job));
  });
  const recovery = host.provide('backupRecovery', new BackupRecovery(m, host.backups, host.bundles));
  await recovery.init();
  host.registerJobs(recovery.jobs, () => {
    throw new AppError('请在备份文件恢复面板重新选择备份和文件', 409);
  });
}
export const operations: Record<string, PluginOperation> = {
  'recovery-view': {
    response: rescueViewSchema,
    execute(url) {
      return this.use<BackupRecovery>('backups', 'backupRecovery').view(url.pathname.split('/')[3]);
    },
  },
  'recovery-run': {
    request: backupRecoverySchema,
    response: rescueJobSchema,
    execute(url, input) {
      return this.use<BackupRecovery>('backups', 'backupRecovery').run(url.pathname.split('/')[3], input);
    },
  },
  'recovery-artifact': {
    response: rescueArtifactSchema,
    execute(url) {
      return this.use<BackupRecovery>('backups', 'backupRecovery').artifact(
        url.pathname.split('/')[3],
        z.uuid().parse(url.searchParams.get('run')),
        z.uuid().parse(url.searchParams.get('artifact')),
      );
    },
  },
};
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: (req: IncomingMessage) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data));
    return true;
  };
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  if (parts.length === 4) {
    if (action === 'backup-download' && req.method === 'POST') {
      const input = z
        .object({ backupId: z.uuid() })
        .strict()
        .parse(await body(req));
      const content = await this.backups.downloadable(id, input.backupId);
      send(
        content.type === 'stream'
          ? this.downloads.issueStream(id, content)
          : await this.downloads.issueLocal(id, { path: content.path, name: content.name }),
      );
      return true;
    }
  }
  if (parts.length === 4) {
    if (action === 'backups') {
      if (req.method === 'GET') {
        send(await this.backups.view(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.backups.policy(id, await body(req)));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({
            action: z.enum(['run', 'verify', 'restore', 'delete']),
            backupId: z.string().uuid().optional(),
            name: z.string().optional(),
            password: z.string().max(1024).optional(),
          })
          .strict()
          .parse(await body(req));
        if (input.action === 'run') send(await this.backups.run(id, input.password), 202);
        else {
          if (!input.backupId) throw new AppError('请选择备份');
          send(await this.backups.operate(id, input.backupId, input.action, input.name, input.password));
        }
        return true;
      }
    }
  }
  return false;
}
