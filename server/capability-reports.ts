import { readdir, readFile, stat } from 'node:fs/promises';
import { cpus, freemem, totalmem } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { AppError, DATA, checkedId, vmDir } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import type { JobView } from './jobs.ts';
import { editorConnectionProfile } from './ide.ts';
import { projectIdSchema } from './project-catalog.ts';
import { capabilityViews, type CapabilityId } from './capability-definitions.ts';

export const reportCapabilities = new Set<string>([
  'editor-profiles',
  'metrics-export',
  'event-timeline',
  'activity-digest',
  'slo-dashboard',
  'error-budget',
  'capacity-forecast',
  'anomaly-detection',
  'log-index',
  'schema-panels',
  'compliance-evidence',
  'proxy-pac',
]);

type Point = {
  sampledAt: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
};
type Event = { id: string; vmId: string; createdAt: string; kind: string; message: string };
const suiteState = () =>
  readStore<{ history: Record<string, Point[]>; events: Event[] }>(join(DATA, 'feature-suite.json'), () => ({
    history: {},
    events: [],
  }));

export async function taskHistory(id: string, projectId: string): Promise<JobView[]> {
  const folder = join(DATA, 'jobs');
  const names = await readdir(folder).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return [] as string[];
  });
  const result: JobView[] = [];
  for (const name of names.filter((name) => /^[a-z0-9-]+\.json$/.test(name)).sort()) {
    const file = join(folder, name);
    if ((await stat(file)).size > 16 * 1024 * 1024) throw new AppError('任务历史超出读取上限：' + name);
    const rows = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(rows)) throw new AppError('任务历史格式无效：' + name);
    result.push(
      ...rows.filter((job: JobView) => job.vmId === id && (job.projectId || 'default') === projectId),
    );
    if (result.length > 20000) throw new AppError('任务历史超过 20,000 条');
  }
  return result.filter((job) => Number.isFinite(Date.parse(job.startedAt)));
}

export function taskSlo(jobs: JobView[], targetPercent: number) {
  const finished = jobs.filter((job) => job.status !== 'running');
  const success = finished.filter((job) => job.status === 'done').length;
  const failed = finished.length - success;
  const allowedFailures = finished.length * (1 - targetPercent / 100);
  const actualPercent = finished.length ? (100 * success) / finished.length : null;
  return {
    basis: 'completed-tasks',
    samples: finished.length,
    success,
    failed,
    targetPercent,
    actualPercent,
    achieved: actualPercent === null ? null : actualPercent >= targetPercent,
    allowedFailures,
    remainingFailures: allowedFailures - failed,
    consumedPercent: allowedFailures > 0 ? (100 * failed) / allowedFailures : failed ? null : 0,
  };
}

export function metricExport(id: string, name: string, point: Point, format: string) {
  const metrics = [
    ['sakura_cpu_percent', '%', point.cpuPercent],
    ['sakura_memory_used_bytes', 'By', point.memoryUsed],
    ['sakura_memory_total_bytes', 'By', point.memoryTotal],
    ['sakura_disk_used_bytes', 'By', point.diskUsed],
    ['sakura_disk_total_bytes', 'By', point.diskTotal],
  ] as const;
  if (metrics.some(([, , value]) => !Number.isFinite(value))) throw new AppError('采样含无效数值');
  if (format === 'otlp-json') {
    const time = Date.parse(point.sampledAt);
    if (!Number.isFinite(time)) throw new AppError('采样时间无效');
    const value = {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'sakura' } },
              { key: 'sakura.vm.id', value: { stringValue: id } },
              { key: 'sakura.vm.name', value: { stringValue: name } },
            ],
          },
          scopeMetrics: [
            {
              scope: { name: 'sakura.metrics' },
              metrics: metrics.map(([name, unit, value]) => ({
                name,
                unit,
                gauge: {
                  dataPoints: [{ timeUnixNano: (BigInt(time) * 1000000n).toString(), asDouble: value }],
                },
              })),
            },
          ],
        },
      ],
    };
    return {
      filename: 'sakura-metrics.json',
      mime: 'application/json',
      content: JSON.stringify(value) + '\n',
    };
  }
  const escape = (value: string) =>
    value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
  return {
    filename: 'sakura-metrics.prom',
    mime: 'text/plain',
    content: metrics
      .map(
        ([metric, , value]) =>
          `# TYPE ${metric} gauge\n${metric}{vm_id="${escape(id)}",vm_name="${escape(name)}"} ${value}\n`,
      )
      .join(''),
  };
}

export function baselineAnomalies(history: Point[], window: number, sigma: number) {
  const rows = history.filter((point) => Number.isFinite(Date.parse(point.sampledAt))).slice(-window - 1);
  if (rows.length < 6) throw new AppError('需要至少 6 个历史采样点，请启用监控采样后重试', 409);
  const latest = rows.at(-1)!;
  const fields = ['cpuPercent', 'memoryUsed', 'diskUsed'] as const;
  const metrics = fields.map((field) => {
    const values = rows
      .slice(0, -1)
      .map((point) => point[field])
      .filter(Number.isFinite);
    if (values.length < 5 || !Number.isFinite(latest[field])) throw new AppError('资源采样不完整', 409);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const standardDeviation = Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
    );
    const delta = latest[field] - mean;
    const threshold = Math.max(
      sigma * standardDeviation,
      field === 'cpuPercent' ? 5 : Math.max(1024 ** 2, mean * 0.05),
    );
    return {
      field,
      current: latest[field],
      baseline: mean,
      standardDeviation,
      delta,
      threshold,
      anomalous: Math.abs(delta) > threshold,
    };
  });
  return {
    sampledAt: latest.sampledAt,
    baselineSamples: rows.length - 1,
    metrics,
    anomalies: metrics.filter((item) => item.anomalous),
  };
}

export async function runReport(
  machines: Machines,
  workspaces: Workspaces,
  id: string,
  featureId: CapabilityId,
  p: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  const projectId = workspaces.projects.current(id);
  if (featureId === 'schema-panels') {
    const actions = ['suite', 'extended', 'next'].flatMap((scope) =>
      capabilityViews(scope as 'suite' | 'extended' | 'next'),
    );
    return {
      actions: actions.length,
      download: {
        filename: 'sakura-action-schemas.json',
        mime: 'application/json',
        content: JSON.stringify({ version: 1, actions }, null, 2),
      },
    };
  }
  if (featureId === 'proxy-pac') {
    const rules = p.rules as Array<{ domain: string; subdomains: boolean; proxy: string }>;
    for (const rule of rules)
      if (
        rule.proxy !== 'DIRECT' &&
        (Number(rule.proxy.split(':').at(-1)) < 1 || Number(rule.proxy.split(':').at(-1)) > 65535)
      )
        throw new AppError('代理端口需要在 1–65535 之间');
    const content =
      'function FindProxyForURL(url, host) {\n  host = host.toLowerCase();\n' +
      rules
        .map(
          (rule) =>
            '  if (host === ' +
            JSON.stringify(rule.domain) +
            (rule.subdomains
              ? ' || host.slice(-' + (rule.domain.length + 1) + ') === ' + JSON.stringify('.' + rule.domain)
              : '') +
            ') return ' +
            JSON.stringify(rule.proxy) +
            ';\n',
        )
        .join('') +
      '  return "DIRECT";\n}\n';
    return {
      rules: rules.length,
      download: { filename: 'sakura-proxy.pac', mime: 'application/x-ns-proxy-autoconfig', content },
    };
  }
  if (featureId === 'editor-profiles') {
    const { config, ...profile } = await editorConnectionProfile(machines, workspaces, id, signal);
    const { alias, directory } = profile;
    return {
      editor: p.editor,
      ...profile,
      instructions:
        p.editor === 'jetbrains'
          ? '在 JetBrains Gateway 的 SSH 连接中选择此档案，项目目录见 directory。'
          : p.editor === 'neovim'
            ? '使用下载的 SSH 档案配置 netrw 的 SSH 命令，再打开 remotePath。'
            : '将档案导入 Remote-SSH 后打开指定项目目录。',
      remotePath: `scp://${alias}/${directory}/`,
      download: { filename: alias + '-ssh.config', mime: 'text/plain', content: config },
      expiresOnRestart: true,
    };
  }
  if (featureId === 'metrics-export') {
    const point = await workspaces.metrics(id);
    return {
      sampledAt: point.sampledAt,
      download: metricExport(id, machines.get(id).name, point, String(p.format)),
    };
  }
  if (featureId === 'capacity-forecast') {
    const running = [...machines.records.values()].filter((vm) => machines.live.has(vm.id));
    const total = totalmem(),
      free = freemem(),
      hostCpus = cpus().length;
    const reservedBytes = (total * Number(p.reservePercent)) / 100;
    const memorySlots = Math.max(0, Math.floor((free - reservedBytes) / (Number(p.memoryMiB) * 1024 ** 2)));
    const allocatedCpus = running.reduce((sum, vm) => sum + vm.cpus, 0);
    const cpuSlots = Math.max(0, Math.floor((hostCpus - allocatedCpus) / Number(p.cpus)));
    const instanceSlots = Math.max(0, 4 - running.length);
    return {
      checkedAt: new Date().toISOString(),
      totalMemory: total,
      freeMemory: free,
      reservedBytes,
      hostCpus,
      allocatedCpus,
      memorySlots,
      cpuSlots,
      instanceSlots,
      additionalInstances: Math.min(memorySlots, cpuSlots, instanceSlots),
      assumptions: { ...p, cpuOvercommit: false },
    };
  }
  const suite = await suiteState();
  if (featureId === 'anomaly-detection')
    return baselineAnomalies(suite.history[id] || [], Number(p.window), Number(p.sigma));
  const jobs = await taskHistory(id, projectId);
  signal.throwIfAborted();
  if (featureId === 'compliance-evidence') {
    const since = Date.now() - Number(p.hours) * 3600000;
    const evidence = {
      format: 'sakura-operation-evidence-v1',
      generatedAt: new Date().toISOString(),
      vmId: id,
      projectId,
      since: new Date(since).toISOString(),
      tasks: jobs
        .filter((job) => Date.parse(job.startedAt) >= since)
        .map((job) => ({
          id: job.id,
          scope: job.scope,
          action: job.action,
          status: job.status,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          result: job.result,
          logSha256: createHash('sha256').update(job.log).digest('hex'),
        })),
      schemaSha256: createHash('sha256')
        .update(
          JSON.stringify(
            ['suite', 'extended', 'next'].flatMap((scope) =>
              capabilityViews(scope as 'suite' | 'extended' | 'next'),
            ),
          ),
        )
        .digest('hex'),
    };
    const content = JSON.stringify(evidence, null, 2);
    return {
      tasks: evidence.tasks.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      download: { filename: 'sakura-evidence.json', mime: 'application/json', content },
    };
  }
  if (featureId === 'log-index') {
    const file = join(DATA, 'capability-index', checkedId(id), projectIdSchema.parse(projectId) + '.json');
    if (p.mode === 'build') {
      const entries = jobs.map((job) => ({
        id: job.id,
        title: job.title,
        scope: job.scope,
        startedAt: job.startedAt,
        status: job.status,
        log: String(job.log || '').slice(-32768),
      }));
      const value = { createdAt: new Date().toISOString(), entries };
      if (Buffer.byteLength(JSON.stringify(value)) > 32 * 1024 ** 2)
        throw new AppError('日志索引超过 32 MiB');
      await writeStore(file, value);
      return { createdAt: value.createdAt, tasks: entries.length };
    }
    if (!p.query) throw new AppError('搜索需要 query');
    const index = await readStore<{
      createdAt: string;
      entries: Array<Pick<JobView, 'id' | 'title' | 'log'>>;
    } | null>(file, () => null);
    if (!index) throw new AppError('请先构建日志索引', 409);
    const matches: Array<Record<string, unknown>> = [];
    let totalMatches = 0;
    for (const entry of index.entries)
      entry.log.split('\n').forEach((line, index) => {
        if (line.toLocaleLowerCase().includes(String(p.query).toLocaleLowerCase())) {
          totalMatches++;
          if (matches.length < Number(p.limit))
            matches.push({
              taskId: entry.id,
              title: entry.title,
              line: index + 1,
              text: line.slice(0, 1000),
            });
        }
      });
    return { createdAt: index.createdAt, matches, totalMatches, snapshot: true };
  }
  const events = (suite.events || []).filter((event) => event.vmId === id);
  if (featureId === 'event-timeline') {
    const timeline: Array<Record<string, unknown> & { time: string }> = [
      ...jobs.flatMap((job) => [
        { time: job.startedAt, kind: 'task-start', taskId: job.id, title: job.title, scope: job.scope },
        ...(job.finishedAt
          ? [
              {
                time: job.finishedAt,
                kind: 'task-' + job.status,
                taskId: job.id,
                title: job.title,
                scope: job.scope,
                error: job.error,
              },
            ]
          : []),
      ]),
      ...events.map((event) => ({
        time: event.createdAt,
        kind: 'alert-' + event.kind,
        eventId: event.id,
        message: event.message,
      })),
    ];
    timeline.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    return { events: timeline.slice(0, Number(p.limit)), total: timeline.length, projectId };
  }
  const since = Date.now() - Number(p.hours) * 3600000;
  const recent = jobs.filter((job) => Date.parse(job.finishedAt || job.startedAt) >= since);
  if (featureId === 'slo-dashboard' || featureId === 'error-budget')
    return { since: new Date(since).toISOString(), ...taskSlo(recent, Number(p.targetPercent)) };
  if (featureId === 'activity-digest')
    return {
      since: new Date(since).toISOString(),
      tasks: recent.length,
      byStatus: Object.fromEntries(
        ['running', 'done', 'error', 'cancelled', 'interrupted'].map((status) => [
          status,
          recent.filter((job) => job.status === status).length,
        ]),
      ),
      totalDurationMs: recent.reduce(
        (sum, job) =>
          sum + (job.finishedAt ? Math.max(0, Date.parse(job.finishedAt) - Date.parse(job.startedAt)) : 0),
        0,
      ),
      failures: recent
        .filter((job) => ['error', 'interrupted'].includes(job.status))
        .map((job) => ({ id: job.id, title: job.title, error: job.error })),
      alerts: events.filter((event) => Date.parse(event.createdAt) >= since).length,
    };
  throw new AppError('未知报告操作');
}
