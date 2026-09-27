export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginOperation } from '../../server/plugin-api.ts';

import { z } from 'zod';
import { AppError } from '../../server/model.ts';

import { importEncrypted } from '../../server/encrypted-backups.ts';
import { Bundles } from '../../server/bundles.ts';
import { GoldenImages } from '../../server/golden-images.ts';
import { goldenActionSchema, goldenEntrySchema, goldenResultSchema } from '../../shared/golden-images.ts';
import { Rescue } from '../../server/rescue.ts';
import { SnapshotDiff } from '../../server/snapshot-diff.ts';
import {
  snapshotDiffInputSchema,
  snapshotDiffJobSchema,
  snapshotDiffViewSchema,
} from '../../shared/snapshot-diff.ts';
import {
  SignedBundles,
  signedBundleActionSchema,
  signedBundleViewSchema,
} from '../../server/signed-bundles.ts';
import {
  rescueArtifactSchema,
  rescueJobSchema,
  rescueRunSchema,
  rescueViewSchema,
} from '../../shared/rescue.ts';

export async function activate(host: PluginContext) {
  const signatures = host.provide('signedBundles', new SignedBundles(host.dataFile('signed-bundles')));
  await signatures.init();
  host.bundles = new Bundles(host.machines, signatures);
  const golden = host.provide('goldenImages', new GoldenImages(host.machines, host.bundles));
  host.registerJobs(golden.jobs, () => {
    throw new AppError('请先刷新黄金镜像库核对结果，再明确发起操作', 409);
  });
  const rescue = host.provide('rescue', new Rescue(host.machines));
  await rescue.init();
  host.registerJobs(rescue.jobs, () => {
    throw new AppError('请在快照页检查救援命令后重新执行', 409);
  });
  const snapshotDiff = host.provide('snapshotDiff', new SnapshotDiff(host.machines));
  host.registerJobs(snapshotDiff.jobs, () => {
    throw new AppError('请在快照页选择快照后重新比较', 409);
  });
}
export const operations: Record<string, PluginOperation> = {
  'snapshot-diff-view': {
    response: snapshotDiffViewSchema,
    execute(url) {
      return this.use<SnapshotDiff>('snapshots', 'snapshotDiff').view(url.pathname.split('/')[3]);
    },
  },
  'snapshot-diff-run': {
    request: snapshotDiffInputSchema,
    response: snapshotDiffJobSchema,
    execute(url, input) {
      return this.use<SnapshotDiff>('snapshots', 'snapshotDiff').run(url.pathname.split('/')[3], input);
    },
  },
  'signed-bundles-view': {
    response: signedBundleViewSchema,
    execute() {
      return this.use<SignedBundles>('snapshots', 'signedBundles').view();
    },
  },
  'signed-bundles-action': {
    request: signedBundleActionSchema,
    response: signedBundleViewSchema,
    execute(_url, input) {
      return this.use<SignedBundles>('snapshots', 'signedBundles').action(input);
    },
  },
  'rescue-view': {
    response: rescueViewSchema,
    execute(url) {
      return this.use<Rescue>('snapshots', 'rescue').view(url.pathname.split('/')[3]);
    },
  },
  'rescue-artifact': {
    response: rescueArtifactSchema,
    execute(url) {
      return this.use<Rescue>('snapshots', 'rescue').artifact(
        url.pathname.split('/')[3],
        z.uuid().parse(url.searchParams.get('run')),
        z.uuid().parse(url.searchParams.get('artifact')),
      );
    },
  },
  'rescue-run': {
    request: rescueRunSchema,
    response: rescueJobSchema,
    execute(url, input) {
      return this.use<Rescue>('snapshots', 'rescue').run(url.pathname.split('/')[3], input);
    },
  },
  'golden-list': {
    response: z
      .object({
        templates: z.array(goldenEntrySchema),
        issues: z.array(z.object({ id: z.uuid(), error: z.string() }).strict()),
        limits: z.object({ count: z.number(), bytes: z.number(), imageBytes: z.number() }).strict(),
        job: z
          .object({ status: z.string(), log: z.string(), startedAt: z.string() })
          .passthrough()
          .nullable(),
        persistenceError: z.string().optional(),
      })
      .strict(),
    execute() {
      return this.use<GoldenImages>('snapshots', 'goldenImages').view();
    },
  },
  'golden-action': {
    request: goldenActionSchema,
    response: goldenResultSchema,
    execute(_url, input, signal) {
      return this.use<GoldenImages>('snapshots', 'goldenImages').action(input, signal);
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
  if (parts[1] === 'import' && parts.length === 2 && req.method === 'POST') {
    if (this.importing) throw new AppError('另一个导入仍在进行', 409);
    const name = z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      .parse(url.searchParams.get('name'));
    this.importing = true;
    try {
      const passphrase = req.headers['x-sakura-passphrase'];
      if (passphrase !== undefined) this.require('backups');
      if (passphrase !== undefined && (typeof passphrase !== 'string' || passphrase.length > 6000))
        throw new AppError('加密密码格式错误');
      send(
        passphrase
          ? await importEncrypted(
              this.bundles,
              name,
              req,
              Buffer.from(passphrase, 'base64').toString('utf8'),
              signal,
            )
          : await this.bundles.importExternal(name, req, signal),
        201,
      );
    } finally {
      this.importing = false;
    }
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  if (req.method === 'POST' && parts[3] === 'snapshots' && parts.length === 4) {
    const { name, online } = z
      .object({ name: z.string().trim().min(1).max(60), online: z.boolean().optional() })
      .strict()
      .parse(await body(req));
    return send(await (online ? this.machines.onlineSnapshot(id, name) : this.machines.snapshot(id, name)), 201);
  }
  if (
    req.method === 'POST' &&
    parts.length === 6 &&
    parts[3] === 'snapshots' &&
    parts[4] &&
    parts[5] === 'restore'
  ) {
    const input = req.headers['content-type']?.startsWith('application/json')
      ? z
          .object({ backup: z.boolean().default(true) })
          .strict()
          .parse(await body(req))
      : { backup: false };
    return send(await this.machines.restore(id, parts[4], input.backup));
  }
  if (action === 'snapshots' && parts[4] && parts.length === 5) {
    if (req.method === 'DELETE') {
      send(await this.machines.editSnapshot(id, parts[4], null));
      return true;
    }
    if (req.method === 'PATCH') {
      send(
        await this.machines.editSnapshot(
          id,
          parts[4],
          z
            .object({ name: z.string().trim().min(1).max(60), note: z.string().max(1000).default('') })
            .strict()
            .parse(await body(req)),
        ),
      );
      return true;
    }
  }
  if (parts.length === 4) {
    if (action === 'export' && req.method === 'GET') {
      await this.downloads.send({ id, type: 'export', name: this.machines.get(id).name + '.sakura' }, res);
      return true;
    }
  }
  if (parts.length === 4) {
    if (action === 'clone' && req.method === 'POST') {
      const { name, snapshot } = z
        .object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), snapshot: z.string().uuid().optional() })
        .strict()
        .parse(await body(req));
      send(await this.bundles.clone(id, name, snapshot, signal), 201);
      return true;
    }
  }
  return false;
}
