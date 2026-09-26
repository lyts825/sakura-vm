import { hostname } from 'node:os';
import type { Machines } from './machines.ts';
import type { Jobs } from './jobs.ts';

/** Deliberately excludes job titles, logs, commands, results, paths and credentials. */
export async function monitorSnapshot(machines: Pick<Machines, 'list'>, stores: Pick<Jobs, 'list'>[]) {
  const vms = await machines.list();
  const jobs = stores
    .flatMap((store) => store.list())
    .sort(
      (left, right) => (Date.parse(right.startedAt || '') || 0) - (Date.parse(left.startedAt || '') || 0),
    );
  const label = (value: unknown) =>
    typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,80}$/.test(value) ? value : 'task';
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    host: hostname(),
    totalVms: vms.length,
    totalJobs: jobs.length,
    vms: vms
      .slice(0, 100)
      .map((vm) => ({ id: vm.id, name: vm.name, status: vm.status, cpus: vm.cpus, memoryMiB: vm.memoryMiB })),
    jobs: jobs
      .slice(0, 100)
      .map((job) => ({
        id: job.id,
        vmId: job.vmId,
        scope: label(job.scope),
        action: label(job.action),
        status: job.status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      })),
  };
}
