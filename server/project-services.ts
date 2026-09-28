import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import type { Machines } from './machines.ts';
import type { Project } from './workspaces.ts';
import { guestTask } from './guest-task.ts';
import { secretRefsSchema } from './secrets.ts';
import { projectNetworkCommand } from './project-network-isolation.ts';

export const environmentSchema = z
  .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(4096))
  .refine((v) => Object.keys(v).length <= 64, '最多 64 个环境变量');
export const serviceSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    command: z.string().trim().min(1).max(8192),
    dependsOn: z.array(z.string()).max(12).default([]),
    ready: z.string().max(2048).default(''),
    timeout: z.number().int().min(5).max(300).default(30),
    environment: environmentSchema.optional(),
    secrets: secretRefsSchema.optional(),
    health: z
      .object({
        command: z.string().trim().min(1).max(2048),
        interval: z.number().int().min(5).max(3600).default(30),
        timeout: z.number().int().min(1).max(30).default(5),
        failures: z.number().int().min(1).max(10).default(3),
        restart: z.boolean().default(false),
        maxRestarts: z.number().int().min(0).max(5).default(3),
        backoff: z.number().int().min(5).max(300).default(10),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ProjectService = z.infer<typeof serviceSchema>;
export function serviceOrder(services: ProjectService[], only?: string) {
  const byName = new Map(services.map((s) => [s.name, s]));
  if (byName.size !== services.length) throw new AppError('服务名称不能重复');
  const seen = new Set<string>(),
    pending = new Set<string>(),
    order: ProjectService[] = [];
  const visit = (name: string) => {
    if (seen.has(name)) return;
    if (pending.has(name)) throw new AppError('服务依赖存在循环');
    const service = byName.get(name);
    if (!service) throw new AppError(`依赖的服务不存在：${name}`);
    pending.add(name);
    for (const dep of service.dependsOn) visit(dep);
    pending.delete(name);
    seen.add(name);
    order.push(service);
  };
  for (const service of services) visit(service.name);
  if (!only) return order;
  if (!byName.has(only)) throw new AppError('服务不存在', 404);
  const needed = new Set<string>();
  const include = (name: string) => {
    needed.add(name);
    for (const dep of byName.get(name)!.dependsOn) include(dep);
  };
  include(only);
  return order.filter((s) => needed.has(s.name));
}
export const serviceSession = (name: string, project?: Project) =>
  `sakura-service-${project?._workspace ? project._workspace + '-' : ''}${name}`;
export const serviceLog = (name: string, project?: Project) => `/tmp/${serviceSession(name, project)}.log`;
export function envPrefix(values: Record<string, string> = {}) {
  return Object.entries(values)
    .map(([name, value]) => `export ${name}=${quote(value)}`)
    .join('\n');
}
export async function runServices(
  machines: Machines,
  id: string,
  project: Project,
  action: 'start' | 'stop',
  log: (s: string) => void,
  signal: AbortSignal,
  only?: string,
) {
  const services = project.services || [];
  const order = serviceOrder(services, only);
  const stop = async (name: string) => {
    const result = await machines.exec(
      id,
      `if tmux has-session -t =${serviceSession(name, project)} 2>/dev/null; then tmux kill-session -t =${serviceSession(name, project)}; fi`,
      10000,
    );
    if (result.code !== 0) throw new AppError(result.stderr || '停止服务失败');
  };
  if (action === 'stop') {
    if (only) {
      const dependents = services.filter(
        (s) => s.name !== only && serviceOrder(services, s.name).some((d) => d.name === only),
      );
      for (const dependent of dependents) {
        const live = await machines.exec(
          id,
          `tmux has-session -t =${serviceSession(dependent.name, project)} 2>/dev/null`,
          5000,
          signal,
        );
        if (live.code === 0) throw new AppError(`请先停止依赖服务 ${dependent.name}`, 409);
      }
    }
    for (const service of [...order].reverse().filter((s) => !only || s.name === only)) {
      signal.throwIfAborted();
      await stop(service.name);
      log(`已停止 ${service.name}\n`);
    }
    return;
  }
  const started: string[] = [];
  try {
    for (const service of order) {
      signal.throwIfAborted();
      const live = await machines.exec(
        id,
        `tmux has-session -t =${serviceSession(service.name, project)} 2>/dev/null`,
        5000,
        signal,
      );
      if (live.code !== 0) {
        log(`启动 ${service.name}…\n`);
        const script = `${envPrefix({ ...project.environment, ...service.environment })}\n${service.command}`;
        started.push(service.name);
        const result = await machines.exec(
          id,
          `tmux new-session -d -s ${serviceSession(service.name, project)} -c ${quote(project.directory)} ${quote(`${projectNetworkCommand(project, script)} > ${quote(serviceLog(service.name, project))} 2>&1`)}`,
          10000,
          signal,
        );
        if (result.code !== 0) throw new AppError(result.stderr || `无法启动 ${service.name}`);
      }
      const deadline = Date.now() + service.timeout * 1000;
      let ready = false;
      do {
        await delay(300, undefined, { signal });
        const alive = await machines.exec(
          id,
          `tmux has-session -t =${serviceSession(service.name, project)} 2>/dev/null`,
          5000,
          signal,
        );
        if (alive.code !== 0) throw new AppError(`${service.name} 已退出，请查看服务日志`);
        if (!service.ready.trim()) {
          ready = true;
          break;
        }
        const check = await guestTask(
          machines,
          id,
          projectNetworkCommand(project,
            `cd ${quote(project.directory)}\n${envPrefix({ ...project.environment, ...service.environment })}\n${service.ready}`),
          signal,
          undefined,
          Math.min(5000, Math.max(1000, deadline - Date.now())),
        ).catch((error) => {
          signal.throwIfAborted();
          if ((error as AppError).status === 408) return { code: 1 };
          throw error;
        });
        ready = check.code === 0;
      } while (!ready && Date.now() < deadline);
      if (!ready) throw new AppError(`${service.name} 就绪检查超时`);
      log(`${service.name} 已就绪\n`);
    }
  } catch (error) {
    for (const name of started.reverse()) await stop(name).catch(() => {});
    throw error;
  }
}
