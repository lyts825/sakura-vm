export { manifest } from './manifest.ts';
import { z } from 'zod';
import { AppError } from '../../server/model.ts';
import type { PluginContext, PluginOperation } from '../../server/plugin-api.ts';
import { Sandboxes, sandboxCreateSchema, sandboxRunSchema } from '../../server/sandboxes.ts';
import { sandboxArtifactSchema, sandboxExecutionSchema, sandboxPolicySchema } from '../../shared/sandbox.ts';

export async function activate(host: PluginContext) {
  const service = host.provide('sandboxes', new Sandboxes(host.machines));
  await service.init();
  host.registerJobs(service.jobs, () => {
    throw new AppError('请在沙箱工作台检查命令后重新执行');
  });
}

const viewSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    sandbox: sandboxPolicySchema,
    expired: z.boolean(),
    status: z.enum(['stopped', 'starting', 'running', 'paused', 'stopping', 'error']),
    poweredOn: z.boolean(),
    memoryMiB: z.number(),
    cpus: z.number(),
    diskGiB: z.number(),
  })
  .passthrough();
const jobSchema = z
  .object({
    id: z.string(),
    status: z.enum(['running', 'done', 'error', 'cancelled', 'interrupted']),
    log: z.string(),
    startedAt: z.string(),
    execution: sandboxExecutionSchema.optional(),
  })
  .passthrough();
const success = z.object({ ok: z.literal(true) });
const idFrom = (url: URL) => url.pathname.split('/')[3];
const service = (host: PluginContext) => host.use<Sandboxes>('sandbox', 'sandboxes');

export const operations: Record<string, PluginOperation> = {
  artifact: {
    response: sandboxArtifactSchema.extend({ base64: z.string() }),
    execute(url) {
      return service(this).artifact(
        z.uuid().parse(url.searchParams.get('run')),
        z.uuid().parse(url.searchParams.get('artifact')),
      );
    },
  },
  list: {
    response: z.object({
      sandboxes: z.array(viewSchema),
      runs: z.array(jobSchema),
      persistenceError: z.string().optional(),
    }),
    execute() {
      return service(this).list();
    },
  },
  create: {
    request: sandboxCreateSchema,
    response: viewSchema,
    execute(_url, input) {
      return service(this).create(input);
    },
  },
  inspect: {
    response: viewSchema,
    execute(url) {
      return service(this).view(idFrom(url));
    },
  },
  control: {
    request: z.object({ action: z.enum(['start', 'stop']) }).strict(),
    response: success,
    execute(url, input) {
      return service(this).control(idFrom(url), (input as { action: 'start' | 'stop' }).action);
    },
  },
  destroy: {
    response: success,
    execute(url) {
      return service(this).control(idFrom(url), 'destroy');
    },
  },
  run: {
    request: sandboxRunSchema,
    response: jobSchema,
    execute(url, input) {
      return service(this).run(idFrom(url), input);
    },
  },
};
export async function route() {
  return false;
}
