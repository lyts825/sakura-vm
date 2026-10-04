import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as snapshotsServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginOperation } from '../../server/plugin-api.ts';

import { z } from 'zod';
import { AppError } from '../../shared/errors.ts';

import { importEncrypted } from '../../server/encrypted-backups.ts';
import { Bundles } from '../../server/bundles.ts';
import { GoldenImages } from '../../server/golden-images.ts';
import { goldenActionSchema } from '../../shared/golden-images.ts';
import { Rescue } from '../../server/rescue.ts';
import { SnapshotDiff } from '../../server/snapshot-diff.ts';
import { SnapshotMerge } from '../../server/snapshot-merge.ts';
import { snapshotMergeInputSchema } from '../../shared/snapshot-merge.ts';
import { snapshotDiffInputSchema } from '../../shared/snapshot-diff.ts';
import { SignedBundles, signedBundleActionSchema } from '../../server/signed-bundles.ts';
import { rescueRunSchema } from '../../shared/rescue.ts';

export async function activate(host: PluginContext) {
  const signatures = host.provide(snapshotsServices.signedBundles, new SignedBundles(host.capabilities.metadata.reference('signed-bundles')));
  await signatures.init();
  host.provide(snapshotsServices.bundles, new Bundles(host.vm, signatures, host.system));
  const golden = host.provide(snapshotsServices.goldenImages, new GoldenImages(host.vm, host.bundles));
  host.registerJobs(golden.jobs, () => {
    throw new AppError('请先刷新黄金镜像库核对结果，再明确发起操作', 409);
  });
  const rescue = host.provide(snapshotsServices.rescue, new Rescue(host.vm));
  await rescue.init();
  host.registerJobs(rescue.jobs, () => {
    throw new AppError('请在快照页检查救援命令后重新执行', 409);
  });
  const snapshotDiff = host.provide(snapshotsServices.snapshotDiff, new SnapshotDiff(host.vm));
  host.registerJobs(snapshotDiff.jobs, () => {
    throw new AppError('请在快照页选择快照后重新比较', 409);
  });
  const snapshotMerge = host.provide(snapshotsServices.snapshotMerge, new SnapshotMerge(host.vm, host.bundles));
  host.registerJobs(snapshotMerge.jobs, () => {
    throw new AppError('请在快照页核对分支和目标后重新合并', 409);
  });
}
export const operations: Record<string, PluginOperation> = {
  'snapshot-merge-view': {
    response: pluginRouteResponses["snapshots.snapshot-merge-view"].schema,
    execute(url) {
      return this.use(snapshotsServices.snapshotMerge).view(url.pathname.split('/')[3]);
    },
  },
  'snapshot-merge-run': {
    request: snapshotMergeInputSchema,
    response: pluginRouteResponses["snapshots.snapshot-merge-run"].schema,
    execute(url, input) {
      return this.use(snapshotsServices.snapshotMerge).run(url.pathname.split('/')[3], input);
    },
  },
  'snapshot-diff-view': {
    response: pluginRouteResponses["snapshots.snapshot-diff-view"].schema,
    execute(url) {
      return this.use(snapshotsServices.snapshotDiff).view(url.pathname.split('/')[3]);
    },
  },
  'snapshot-diff-run': {
    request: snapshotDiffInputSchema,
    response: pluginRouteResponses["snapshots.snapshot-diff-run"].schema,
    execute(url, input) {
      return this.use(snapshotsServices.snapshotDiff).run(url.pathname.split('/')[3], input);
    },
  },
  'signed-bundles-view': {
    response: pluginRouteResponses["snapshots.signed-bundles-view"].schema,
    execute() {
      return this.use(snapshotsServices.signedBundles).view();
    },
  },
  'signed-bundles-action': {
    request: signedBundleActionSchema,
    response: pluginRouteResponses["snapshots.signed-bundles-action"].schema,
    execute(_url, input) {
      return this.use(snapshotsServices.signedBundles).action(input);
    },
  },
  'rescue-view': {
    response: pluginRouteResponses["snapshots.rescue-view"].schema,
    execute(url) {
      return this.use(snapshotsServices.rescue).view(url.pathname.split('/')[3]);
    },
  },
  'rescue-artifact': {
    response: pluginRouteResponses["snapshots.rescue-artifact"].schema,
    execute(url) {
      return this.use(snapshotsServices.rescue).artifact(
        url.pathname.split('/')[3],
        z.uuid().parse(url.searchParams.get('run')),
        z.uuid().parse(url.searchParams.get('artifact')),
      );
    },
  },
  'rescue-run': {
    request: rescueRunSchema,
    response: pluginRouteResponses["snapshots.rescue-run"].schema,
    execute(url, input) {
      return this.use(snapshotsServices.rescue).run(url.pathname.split('/')[3], input);
    },
  },
  'golden-list': {
    response: pluginRouteResponses["snapshots.golden-list"].schema,
    execute() {
      return this.use(snapshotsServices.goldenImages).view();
    },
  },
  'golden-action': {
    request: goldenActionSchema,
    response: pluginRouteResponses["snapshots.golden-action"].schema,
    execute(_url, input, signal) {
      return this.use(snapshotsServices.goldenImages).action(input, signal);
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
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
  if (parts[1] === 'import' && parts.length === 2 && req.method === 'POST') {
    if (this.activity.importing) throw new AppError('另一个导入仍在进行', 409);
    const name = z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      .parse(url.searchParams.get('name'));
    await this.activity.exclusive('import', async () => {
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
    });
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (req.method === 'POST' && parts[3] === 'snapshots' && parts.length === 4) {
    const { name, online, memory } = z
      .object({ name: z.string().trim().min(1).max(60), online: z.boolean().optional(),
        memory: z.boolean().optional() })
      .strict()
      .parse(await body(req));
    if (memory && !online) throw new AppError('整机状态快照要求运行中的实例', 409);
    return send(await (memory ? this.vm.memorySnapshot(id, name)
      : online ? this.vm.onlineSnapshot(id, name) : this.vm.snapshot(id, name)), 201);
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
          .object({ backup: z.boolean().default(true), memory: z.boolean().optional() })
          .strict()
          .parse(await body(req))
      : { backup: false };
    return send(await (input.memory ? this.vm.restoreMemory(id, parts[4], input.backup)
      : this.vm.restore(id, parts[4], input.backup)));
  }
  if (action === 'snapshots' && parts[4] && parts.length === 5) {
    if (req.method === 'DELETE') {
      send(await this.vm.editSnapshot(id, parts[4], null));
      return true;
    }
    if (req.method === 'PATCH') {
      send(
        await this.vm.editSnapshot(
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
      await this.downloads.send({ id, type: 'export', name: this.vm.get(id).name + '.sakura' }, res);
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

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.post.import": route,
  "legacy.post.vms.vmId.snapshots": route,
  "legacy.patch.vms.vmId.snapshots.snapshotId": route,
  "legacy.delete.vms.vmId.snapshots.snapshotId": route,
  "legacy.post.vms.vmId.snapshots.snapshotId.restore": route,
  "legacy.get.vms.vmId.export": route,
  "legacy.post.vms.vmId.clone": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("snapshots");
