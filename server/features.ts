import type { IncomingMessage, ServerResponse } from 'node:http';
import { posix } from 'node:path';
import { z } from 'zod';
import { AppError, guestPath } from './model.ts';
import type { Machines } from './machines.ts';
import { Files } from './files.ts';
import { Images } from './images.ts';
import { Bundles } from './bundles.ts';
import { Workspaces } from './workspaces.ts';
import { FolderSync } from './sync.ts';
import { Jobs } from './jobs.ts';
import { imeInstall } from './desktop-guest.ts';
import { Downloads } from './downloads.ts';
import { Backups } from './backups.ts';
import { Maintenance } from './maintenance.ts';
import { Ide } from './ide.ts';
import { Recipes } from './recipes.ts';
import { guestTask } from './guest-task.ts';

export class Features {
  files: Files;
  images = new Images();
  bundles: Bundles;
  downloads: Downloads;
  workspaces: Workspaces;
  sync: FolderSync;
  jobs = new Jobs('input-method');
  backups: Backups;
  maintenance: Maintenance;
  ide: Ide;
  recipes: Recipes;
  private importing = false;
  private closed = false;
  private closing?: Promise<void>;
  private active = new Map<AbortController, Promise<boolean>>();
  constructor(private machines: Machines) {
    this.files = new Files(machines);
    this.bundles = new Bundles(machines);
    this.downloads = new Downloads(machines, this.files, this.bundles);
    this.workspaces = new Workspaces(machines);
    this.sync = new FolderSync(machines);
    this.backups = new Backups(machines, this.bundles);
    this.maintenance = new Maintenance(machines);
    this.ide = new Ide(machines, this.workspaces);
    this.recipes = new Recipes(machines, this.workspaces);
  }
  async close() {
    if (!this.closing) {
      this.closed = true;
      for (const abort of this.active.keys()) abort.abort();
      this.closing = Promise.all([
        this.downloads.close(),
        this.images.jobs.close(),
        this.workspaces.close(),
        this.sync.close(),
        this.jobs.close(),
        this.backups.close(),
        this.maintenance.close(),
        this.ide.close(),
        Promise.allSettled([...this.active.values()]),
      ]).then(() => {});
    }
    await this.closing;
  }
  async route(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    body: (req: IncomingMessage, signal?: AbortSignal) => Promise<any>,
  ) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const abort = new AbortController();
    const disconnected = () => {
      if (!res.writableFinished) abort.abort();
    };
    req.once('aborted', disconnected);
    res.once('close', disconnected);
    if (req.aborted || res.destroyed) abort.abort();
    const pending = Promise.resolve()
      .then(() => {
        abort.signal.throwIfAborted();
        return this.routeRequest(req, res, url, (request) => body(request, abort.signal), abort.signal);
      })
      .finally(() => {
        this.active.delete(abort);
        req.off('aborted', disconnected);
        res.off('close', disconnected);
      });
    this.active.set(abort, pending);
    return pending;
  }
  private async routeRequest(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    body: (req: IncomingMessage) => Promise<any>,
    signal: AbortSignal,
  ) {
    const parts = url.pathname.split('/').filter(Boolean);
    const send = (data: unknown, status = 200) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(data));
    };
    if (parts[1] === 'jobs') {
      const stores = [
        this.jobs,
        this.images.jobs,
        this.workspaces.jobs,
        this.sync.jobs,
        this.downloads.jobs,
        this.backups.jobs,
        this.maintenance.jobs,
      ];
      if (parts.length === 2 && req.method === 'GET') {
        send({
          jobs: stores
            .flatMap((s) => s.list())
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, 300),
          warnings: stores.flatMap((s) => (s.persistenceError ? [s.persistenceError] : [])),
        });
        return true;
      }
      if (parts.length === 4 && req.method === 'POST') {
        const store = stores.find((s) => s.get(parts[2])),
          job = store?.get(parts[2]);
        if (!store || !job) throw new AppError('任务不存在', 404);
        if (parts[3] === 'cancel') {
          store.cancel(parts[2]);
          send({ ok: true });
          return true;
        }
        if (parts[3] === 'retry') {
          if (job.status === 'running') throw new AppError('任务仍在执行', 409);
          const id = job.vmId || job.key!;
          if (store === this.images.jobs) send(this.images.prepare(job.key!));
          else if (store === this.workspaces.jobs && job.action) {
            const [action, service] = job.action.split(':');
            send(
              await this.workspaces.run(
                id,
                z.enum(['setup', 'start', 'stop', 'terminal']).parse(action),
                service,
              ),
            );
          } else if (store === this.sync.jobs && job.action)
            send(await this.sync.run(id, z.enum(['both', 'push', 'pull']).parse(job.action)));
          else if (store === this.downloads.jobs) send(await this.downloads.issue(id, { type: 'export' }));
          else if (store === this.backups.jobs && job.action === 'run') send(await this.backups.run(id));
          else if (store === this.maintenance.jobs && job.action === 'diagnose')
            send(this.maintenance.diagnose(id));
          else if (store === this.maintenance.jobs && job.action === 'finish-resize')
            send(this.maintenance.finishResize(id));
          else if (store === this.jobs) send(this.installIme(id));
          else throw new AppError('请回到原功能页面重新执行');
          return true;
        }
      }
    }
    if (parts[1] === 'storage' && parts.length === 2 && req.method === 'GET') {
      send(await this.maintenance.storage());
      return true;
    }
    if (parts[1] === 'recipes' && parts.length === 2 && req.method === 'POST') {
      const { name, recipe } = z
        .object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), recipe: z.unknown() })
        .strict()
        .parse(await body(req));
      send(await this.recipes.create(name, recipe), 201);
      return true;
    }
    if (parts[1] === 'vms' && parts[2] === 'batch' && parts.length === 3 && req.method === 'POST') {
      const { ids, action } = z
        .object({ ids: z.array(z.string().uuid()).min(1).max(32), action: z.enum(['start', 'stop']) })
        .strict()
        .parse(await body(req));
      const results = [];
      for (const id of new Set(ids)) {
        signal.throwIfAborted();
        try {
          await this.machines[action](id);
          results.push({ id, ok: true });
        } catch (error) {
          results.push({ id, ok: false, error: (error as Error).message });
        }
      }
      send({ results });
      return true;
    }
    if (parts[1] === 'images') {
      if (parts.length === 2 && req.method === 'GET') {
        send(this.images.list());
        return true;
      }
      if (parts.length === 3 && req.method === 'POST') {
        send(this.images.prepare(parts[2]), 202);
        return true;
      }
    }
    if (parts[1] === 'import' && parts.length === 2 && req.method === 'POST') {
      if (this.importing) throw new AppError('另一个导入仍在进行', 409);
      const name = z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,31}$/)
        .parse(url.searchParams.get('name'));
      this.importing = true;
      try {
        send(await this.bundles.import(name, req, signal), 201);
      } finally {
        this.importing = false;
      }
      return true;
    }
    if (parts[1] !== 'vms' || !parts[2]) return false;
    const id = parts[2],
      action = parts[3];
    this.machines.get(id);
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
    if (parts.length !== 4) return false;
    if (action === 'organization' && req.method === 'PUT') {
      send(await this.machines.organize(id, await body(req)));
      return true;
    }
    if (action === 'diagnostics') {
      if (req.method === 'GET') {
        send({ report: this.maintenance.report(id), job: this.maintenance.jobs.view(id) });
        return true;
      }
      if (req.method === 'POST') {
        send(this.maintenance.diagnose(id), 202);
        return true;
      }
    }
    if (action === 'resize' && req.method === 'POST') {
      const value = z
        .object({ diskGiB: z.number().int().min(2).max(128).optional(), finish: z.boolean().optional() })
        .strict()
        .parse(await body(req));
      if (value.finish) send(this.maintenance.finishResize(id), 202);
      else if (value.diskGiB) send(this.maintenance.resize(id, value.diskGiB), 202);
      else throw new AppError('请输入目标磁盘容量');
      return true;
    }
    if (action === 'ide') {
      if (req.method === 'GET') {
        send(await this.ide.view(id));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.ide.install(id));
        return true;
      }
    }
    if (action === 'recipe') {
      if (req.method === 'GET') {
        send(await this.recipes.export(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.recipes.apply(id, await body(req)));
        return true;
      }
      if (req.method === 'POST') {
        const { action: kind } = z
          .object({ action: z.enum(['read', 'write']) })
          .strict()
          .parse(await body(req));
        send(await this.recipes[kind](id));
        return true;
      }
    }
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
          })
          .strict()
          .parse(await body(req));
        if (input.action === 'run') send(await this.backups.run(id), 202);
        else {
          if (!input.backupId) throw new AppError('请选择备份');
          send(await this.backups.operate(id, input.backupId, input.action, input.name));
        }
        return true;
      }
    }
    if (action === 'sync-preview' && req.method === 'POST') {
      send(await this.sync.preview(id, signal));
      return true;
    }
    if (action === 'download' && req.method === 'POST') {
      send(await this.downloads.issue(id, await body(req)), 201);
      return true;
    }
    if (action === 'terminal-session' && req.method === 'POST') {
      const { session } = z
        .object({ session: z.string().regex(/^[a-z0-9-]{1,48}$/) })
        .strict()
        .parse(await body(req));
      if (this.machines.state(id) === 'running')
        await this.machines.exec(
          id,
          `if command -v tmux >/dev/null && tmux has-session -t =sakura-terminal-${session} 2>/dev/null; then tmux kill-session -t =sakura-terminal-${session}; fi`,
        );
      send({ ok: true });
      return true;
    }
    if (action === 'transfer') {
      const path = guestPath(url.searchParams.get('path'));
      if (req.method === 'PUT') {
        send(await this.files.upload(id, path, req, url.searchParams.get('overwrite') === '1', signal));
        return true;
      }
      if (req.method === 'GET') {
        await this.downloads.send({ id, type: 'file', path, name: posix.basename(path) }, res);
        return true;
      }
    }
    if (action === 'file-operation' && req.method === 'POST') {
      const input = z
        .object({
          action: z.enum(['mkdir', 'rename', 'delete']),
          path: z.string(),
          destination: z.string().optional(),
          recursive: z.boolean().default(false),
        })
        .strict()
        .parse(await body(req));
      send(await this.files.operation(id, input.action, input.path, input.destination, input.recursive));
      return true;
    }
    if (action === 'export' && req.method === 'GET') {
      await this.downloads.send({ id, type: 'export', name: this.machines.get(id).name + '.sakura' }, res);
      return true;
    }
    if (action === 'clone' && req.method === 'POST') {
      const { name, snapshot } = z
        .object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), snapshot: z.string().uuid().optional() })
        .strict()
        .parse(await body(req));
      send(await this.bundles.clone(id, name, snapshot, signal), 201);
      return true;
    }
    if (action === 'metrics' && req.method === 'GET') {
      send(await this.workspaces.metrics(id));
      return true;
    }
    if (action === 'services') {
      if (req.method === 'PATCH') {
        const { forwards } = z
          .object({ forwards: z.unknown() })
          .strict()
          .parse(await body(req));
        send(await this.machines.setForwards(id, forwards));
        return true;
      }
      if (req.method === 'GET') {
        let listening = new Set<number>();
        if (this.machines.state(id) === 'running') {
          const result = await this.machines.exec(id, 'cat /proc/net/tcp /proc/net/tcp6', 10000);
          if (result.code !== 0) throw new AppError('无法读取客户机监听端口');
          listening = new Set(
            result.stdout
              .split('\n')
              .map((line) => line.trim().split(/\s+/))
              .filter((columns) => columns[3] === '0A')
              .map((columns) => parseInt(columns[1].split(':').at(-1)!, 16)),
          );
        }
        send({
          forwards: this.machines.get(id).forwards.map((p) => ({ ...p, listening: listening.has(p.guest) })),
          listening: [...listening],
        });
        return true;
      }
    }
    if (action === 'project') {
      if (req.method === 'GET') {
        send(await this.workspaces.view(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.workspaces.save(id, await body(req)));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({
            action: z.enum(['setup', 'start', 'stop', 'terminal']),
            service: z
              .string()
              .regex(/^[a-z][a-z0-9-]{0,31}$/)
              .optional(),
          })
          .strict()
          .parse(await body(req));
        send(await this.workspaces.run(id, input.action, input.service), 202);
        return true;
      }
    }
    if (action === 'project-runtime' && req.method === 'GET') {
      send(await this.workspaces.runtime(id, signal));
      return true;
    }
    if (action === 'sync') {
      if (req.method === 'GET') {
        send(await this.sync.view(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.sync.save(id, await body(req)));
        return true;
      }
      if (req.method === 'POST') {
        const { direction, token, decisions } = z
          .object({
            direction: z.enum(['both', 'push', 'pull']),
            token: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            decisions: z.record(z.string().max(4096), z.enum(['push', 'pull', 'both', 'skip'])).optional(),
          })
          .strict()
          .parse(await body(req));
        send(await this.sync.run(id, direction, token, decisions), 202);
        return true;
      }
    }
    if (action === 'ime') {
      if (req.method === 'GET') {
        send(this.jobs.view(id));
        return true;
      }
      if (req.method === 'POST') {
        if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
        send(this.installIme(id), 202);
        return true;
      }
    }
    return false;
  }
  private installIme(id: string) {
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    return this.jobs.start(
      id,
      async (log, signal) => {
        const result = await guestTask(
          this.machines,
          id,
          imeInstall(this.machines.get(id).distro),
          signal,
          log,
        );
        if (result.code !== 0) throw new Error(result.stderr || '输入法安装失败');
      },
      { title: '安装中文输入法', vmId: id, action: 'install' },
    );
  }
}
