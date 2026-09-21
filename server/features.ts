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

export class Features {
  files: Files;
  images = new Images();
  bundles: Bundles;
  downloads: Downloads;
  workspaces: Workspaces;
  sync: FolderSync;
  jobs = new Jobs();
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
          .object({ action: z.enum(['setup', 'start', 'stop', 'terminal']) })
          .strict()
          .parse(await body(req));
        send(await this.workspaces.run(id, input.action), 202);
        return true;
      }
    }
    if (action === 'project-runtime' && req.method === 'GET') {
      send(await this.workspaces.runtime(id));
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
        const { direction } = z
          .object({ direction: z.enum(['both', 'push', 'pull']) })
          .strict()
          .parse(await body(req));
        send(await this.sync.run(id, direction), 202);
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
        send(
          this.jobs.start(id, async (log, signal) => {
            const result = await this.machines.exec(
              id,
              imeInstall(this.machines.get(id).distro),
              1200000,
              signal,
              log,
            );
            if (result.code !== 0) throw new Error(result.stderr || '输入法安装失败');
          }),
          202,
        );
        return true;
      }
    }
    return false;
  }
}
