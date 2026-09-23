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
import { GitWorkbench } from './git-workbench.ts';
import { ProjectFiles } from './project-files.ts';
import { CommandPresets } from './command-presets.ts';
import { Toolchains } from './toolchains.ts';
import { NetworkProfiles } from './network-profiles.ts';
import { Secrets } from './secrets.ts';
import { ServiceHealth } from './service-health.ts';
import { Containers } from './containers.ts';
import { DataMigration } from './data-migration.ts';
import { importEncrypted } from './encrypted-backups.ts';
import { FileHistory } from './file-history.ts';
import { Pipelines } from './pipelines.ts';
import { RuntimeVersions } from './runtime-versions.ts';
import { CodeIntelligence } from './code-intelligence.ts';
import { FeatureSuite } from './feature-suite.ts';
import { ExtendedFeatures } from './extended-features.ts';

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
  git: GitWorkbench;
  projectFiles: ProjectFiles;
  commands: CommandPresets;
  toolchains: Toolchains;
  network: NetworkProfiles;
  secrets: Secrets;
  health: ServiceHealth;
  containers: Containers;
  migration: DataMigration;
  history: FileHistory;
  pipelines: Pipelines;
  runtimes: RuntimeVersions;
  intelligence: CodeIntelligence;
  suite: FeatureSuite;
  extended: ExtendedFeatures;
  private mutations = 0;
  private importing = false;
  private closed = false;
  private closing?: Promise<void>;
  private active = new Map<AbortController, Promise<boolean>>();
  constructor(private machines: Machines) {
    this.files = new Files(machines);
    this.history = new FileHistory(machines, this.files);
    this.files.beforeReplace = (id, path, ftp, signal) => this.history.capture(id, path, ftp, signal);
    this.files.trash = (id, path, recursive) => this.history.trash(id, path, recursive);
    this.machines.fileBeforeReplace = this.files.beforeReplace;
    this.bundles = new Bundles(machines);
    this.downloads = new Downloads(machines, this.files, this.bundles);
    this.secrets = new Secrets(machines);
    this.network = new NetworkProfiles(machines);
    this.workspaces = new Workspaces(machines, { secrets: this.secrets, network: this.network });
    this.sync = new FolderSync(machines, this.workspaces.projects);
    this.backups = new Backups(machines, this.bundles, this.secrets);
    this.maintenance = new Maintenance(machines);
    this.ide = new Ide(machines, this.workspaces);
    this.recipes = new Recipes(machines, this.workspaces);
    this.git = new GitWorkbench(machines, this.workspaces);
    this.projectFiles = new ProjectFiles(machines, this.workspaces);
    this.commands = new CommandPresets(machines, this.workspaces);
    this.toolchains = new Toolchains(machines, this.workspaces);
    this.health = new ServiceHealth(machines, this.workspaces);
    this.containers = new Containers(machines, this.workspaces);
    this.migration = new DataMigration(machines, () =>
      this.jobStores().filter((store) => store !== this.migration.jobs),
    );
    this.pipelines = new Pipelines(machines, this.workspaces, this.files);
    this.runtimes = new RuntimeVersions(machines, this.workspaces);
    this.intelligence = new CodeIntelligence(machines, this.workspaces);
    this.suite = new FeatureSuite(machines, this.workspaces);
    this.extended = new ExtendedFeatures(machines, this.workspaces);
  }
  private jobStores() {
    return [
      this.jobs,
      this.images.jobs,
      this.workspaces.jobs,
      this.sync.jobs,
      this.downloads.jobs,
      this.backups.jobs,
      this.maintenance.jobs,
      this.git.jobs,
      this.commands.jobs,
      this.toolchains.jobs,
      this.network.jobs,
      this.health.jobs,
      this.containers.jobs,
      this.migration.jobs,
      this.pipelines.jobs,
      this.runtimes.jobs,
      this.suite.jobs,
      this.extended.jobs,
    ];
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
        this.git.close(),
        this.commands.close(),
        this.toolchains.close(),
        this.network.close(),
        this.health.close(),
        this.containers.close(),
        this.migration.close(),
        this.pipelines.close(),
        this.runtimes.close(),
        this.suite.close(),
        this.extended.close(),
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
    const mutation = req.method !== 'GET' && req.method !== 'HEAD' && url.pathname !== '/api/migration';
    if (mutation) this.mutations++;
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
        const route = () =>
          this.routeRequest(
            req,
            res,
            url,
            async (request) => {
              const value = await body(request, abort.signal);
              if (mutation && this.migration.blocked && !url.pathname.endsWith('/cancel'))
                throw new AppError('数据目录迁移维护中', 409);
              return value;
            },
            abort.signal,
          );
        const vm = /^\/api\/vms\/([^/]+)\//.exec(url.pathname)?.[1];
        const scoped = new Set([
          'git',
          'project-files',
          'commands',
          'tools',
          'network',
          'secrets',
          'health',
          'containers',
          'project',
          'project-runtime',
          'sync',
          'sync-preview',
          'history',
          'pipelines',
          'pipeline-artifact',
          'runtimes',
          'code-diagnostics',
          'advanced',
          'extended-features',
          'projects',
        ]);
        return vm && scoped.has(url.pathname.split('/').filter(Boolean)[3]) && /^[0-9a-f-]{36}$/i.test(vm)
          ? this.workspaces.projects.with(vm, url.searchParams.get('project'), route)
          : route();
      })
      .finally(() => {
        this.active.delete(abort);
        if (mutation) this.mutations--;
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
      const stores = this.jobStores();
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
          const withProject = <T>(action: () => Promise<T>) =>
            this.workspaces.projects
              ? this.workspaces.projects.inScope(id, job.projectId || 'default', action)
              : action();
          if (store === this.images.jobs) send(this.images.prepare(job.key!));
          else if (store === this.workspaces.jobs && job.action) {
            const [action, service] = job.action.split(':');
            send(
              await withProject(() =>
                this.workspaces.run(
                  id,
                  z.enum(['setup', 'start', 'stop', 'terminal']).parse(action),
                  service,
                ),
              ),
            );
          } else if (store === this.sync.jobs && job.action)
            send(
              await withProject(() => this.sync.run(id, z.enum(['both', 'push', 'pull']).parse(job.action))),
            );
          else if (store === this.downloads.jobs) send(await this.downloads.issue(id, { type: 'export' }));
          else if (store === this.backups.jobs && job.action === 'run') send(await this.backups.run(id));
          else if (store === this.maintenance.jobs && job.action === 'diagnose')
            send(this.maintenance.diagnose(id));
          else if (store === this.maintenance.jobs && job.action === 'finish-resize')
            send(this.maintenance.finishResize(id));
          else if (store === this.pipelines.jobs && job.action?.startsWith('run:'))
            send(await withProject(() => this.pipelines.run(id, job.action!.slice(4))));
          else if (store === this.runtimes.jobs && job.action?.startsWith('install:')) {
            const [, tool, version] = job.action.split(':');
            send(await withProject(() => this.runtimes.install(id, { tool, version })));
          } else if (store === this.suite.jobs && job.action?.startsWith('package:')) {
            const [operationValue, ...nameParts] = job.action.slice(8).split(':');
            const operation = z.enum(['list', 'search', 'install', 'remove', 'update']).parse(operationValue);
            send(
              await withProject(() =>
                Promise.resolve(this.suite.package(id, { operation, name: nameParts.join(':') || undefined })),
              ),
            );
          } else if (store === this.suite.jobs && job.action?.startsWith('dev:')) {
            const operation = z
              .enum(['test', 'test-discover', 'lint', 'format', 'dependencies', 'lock', 'lock-check', 'install-locked', 'worktree-list', 'worktree-add', 'worktree-remove', 'database'])
              .parse(job.action.slice(4));
            if (operation === 'worktree-add' || operation === 'worktree-remove' || operation === 'database')
              throw new AppError('此开发任务包含参数，请回到能力中心重新执行');
            send(await withProject(() => Promise.resolve(this.suite.dev(id, { operation }))));
          } else if (store === this.extended.jobs && job.action?.startsWith('extended:')) {
            const featureId = job.action.slice('extended:'.length);
            send(
              await withProject(() =>
                Promise.resolve(this.extended.action(id, { action: 'run', featureId })),
              ),
            );
          } else if (store === this.extended.jobs && job.action?.startsWith('operation:')) {
            throw new AppError('此工程操作包含参数，请回到能力中心重新执行');
          } else if (store === this.jobs) send(this.installIme(id));
          else throw new AppError('请回到原功能页面重新执行');
          return true;
        }
      }
    }
    if (parts[1] === 'events' && parts.length === 2 && req.method === 'GET') {
      const events = this.jobStores().flatMap((store) =>
        store
          .list()
          .filter((job) => ['error', 'cancelled', 'interrupted'].includes(job.status))
          .map((job) => ({
            type: 'job',
            id: job.id,
            vmId: job.vmId,
            projectId: job.projectId,
            title: job.title,
            status: job.status,
            message: job.error || job.phase,
            at: job.finishedAt || job.startedAt,
          })),
      );
      send({ events: events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100) });
      return true;
    }
    if (parts[1] === 'feature-suite' && parts.length === 2 && req.method === 'GET') {
      send(await this.suite.catalog());
      return true;
    }
    if (parts[1] === 'extended-features' && parts.length === 2 && req.method === 'GET') {
      send(await this.extended.catalog());
      return true;
    }
    if (parts[1] === 'migration' && parts.length === 2) {
      if (req.method === 'GET') {
        send(await this.migration.view());
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({
            action: z.enum(['preview', 'start', 'cancel-activation']),
            target: z.string().max(4096).optional(),
            token: z.string().optional(),
          })
          .strict()
          .parse(await body(req));
        if (input.action === 'cancel-activation') send(await this.migration.cancelActivation());
        else if (input.action === 'preview') {
          const { files: _files, ...plan } = await this.migration.plan(input.target || '');
          send(plan);
        } else {
          if (this.mutations || this.importing) throw new AppError('请等待正在执行的请求完成', 409);
          send(await this.migration.start(input.target || '', input.token || ''), 202);
        }
        return true;
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
        const passphrase = req.headers['x-sakura-passphrase'];
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
            : await this.bundles.import(name, req, signal),
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
    if (action === 'projects') {
      if (req.method === 'GET') {
        send(await this.workspaces.projects.list(id));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .discriminatedUnion('action', [
            z.object({ action: z.literal('create'), name: z.string(), config: z.unknown() }).strict(),
            z.object({ action: z.literal('select'), projectId: z.string() }).strict(),
            z.object({ action: z.literal('rename'), projectId: z.string(), name: z.string() }).strict(),
          ])
          .parse(await body(req));
        send(
          input.action === 'create'
            ? await this.workspaces.projects.create(id, input.name, async () => {
                await this.workspaces.save(id, input.config);
              })
            : await this.workspaces.projects.update(
                id,
                input.projectId,
                input.action === 'rename' ? input.name : undefined,
              ),
        );
        return true;
      }
    }
    if (action === 'history') {
      if (req.method === 'GET') {
        if (url.searchParams.has('content'))
          send(await this.history.content(id, url.searchParams.get('content')!));
        else send({ items: await this.history.list(id, url.searchParams.get('path') || undefined) });
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({
            action: z.enum(['restore', 'purge']),
            id: z.uuid(),
            expectedVersion: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
          })
          .strict()
          .parse(await body(req));
        send(
          input.action === 'restore'
            ? await this.history.restore(id, input.id, input.expectedVersion)
            : await this.history.purge(id, input.id),
        );
        return true;
      }
    }
    if (action === 'pipelines') {
      if (req.method === 'GET') {
        send(await this.pipelines.view(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.pipelines.save(id, await body(req)));
        return true;
      }
      if (req.method === 'DELETE') {
        const input = z
          .object({ id: z.uuid() })
          .strict()
          .parse(await body(req));
        send(await this.pipelines.remove(id, input.id));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({ action: z.literal('run'), pipelineId: z.uuid() })
          .strict()
          .parse(await body(req));
        send(await this.pipelines.run(id, input.pipelineId), 202);
        return true;
      }
    }
    if (action === 'pipeline-artifact' && req.method === 'POST') {
      const input = z
        .object({ runId: z.uuid(), index: z.number().int().min(0).max(19) })
        .strict()
        .parse(await body(req));
      const target = await this.pipelines.artifact(id, input.runId, input.index);
      send(await this.downloads.issueLocal(id, { path: target.file, name: target.name }));
      return true;
    }
    if (action === 'runtimes') {
      if (req.method === 'GET') {
        send(await this.runtimes.view(id, signal));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .discriminatedUnion('action', [
            z
              .object({
                action: z.literal('select'),
                node: z.string().optional(),
                python: z.string().optional(),
              })
              .strict(),
            z
              .object({ action: z.literal('install'), tool: z.enum(['node', 'python']), version: z.string() })
              .strict(),
          ])
          .parse(await body(req));
        send(
          input.action === 'select'
            ? await this.runtimes.select(id, { node: input.node, python: input.python })
            : await this.runtimes.install(id, input),
          input.action === 'install' ? 202 : 200,
        );
        return true;
      }
    }
    if (action === 'git') {
      if (req.method === 'GET') {
        send(
          url.searchParams.has('path')
            ? await this.git.diff(
                id,
                url.searchParams.get('path')!,
                url.searchParams.get('staged') === '1',
                signal,
              )
            : await this.git.view(id, signal),
        );
        return true;
      }
      if (req.method === 'POST') {
        send(await this.git.run(id, await body(req)), 202);
        return true;
      }
    }
    if (action === 'project-files' && req.method === 'GET') {
      send(
        await this.projectFiles.scan(
          id,
          url.searchParams.get('q') || '',
          url.searchParams.get('content') === '1',
          signal,
        ),
      );
      return true;
    }
    if (action === 'code-diagnostics' && req.method === 'GET') {
      send(await this.intelligence.diagnose(id, url.searchParams.get('path') || '', signal));
      return true;
    }
    if (action === 'advanced') {
      if (req.method === 'GET') {
        send(await this.suite.view(id, Number(url.searchParams.get('limit') || 120)));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.suite.update(id, await body(req)));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.suite.action(id, await body(req), signal), 202);
        return true;
      }
    }
    if (action === 'extended-features') {
      if (req.method === 'GET') {
        send(await this.extended.view(id));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.extended.action(id, await body(req), signal), 202);
        return true;
      }
    }
    if (action === 'commands') {
      if (req.method === 'GET') {
        send({
          projectId: this.workspaces.projects.current(id),
          presets: await this.commands.list(id),
          job: this.commands.jobs.view(this.workspaces.projects.key(id)),
        });
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.commands.save(id, await body(req)));
        return true;
      }
      if (req.method === 'DELETE') {
        const input = z
          .object({ id: z.uuid() })
          .strict()
          .parse(await body(req));
        send(await this.commands.remove(id, input.id));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({ id: z.uuid(), values: z.record(z.string(), z.string()).default({}) })
          .strict()
          .parse(await body(req));
        send(await this.commands.run(id, input.id, input.values), 202);
        return true;
      }
    }
    if (action === 'tools') {
      if (req.method === 'GET') {
        send(await this.toolchains.view(id, signal));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.toolchains.install(id, await body(req)), 202);
        return true;
      }
    }
    if (action === 'network') {
      if (req.method === 'GET') {
        send({ ...(await this.network.state(id)), job: this.network.jobs.view(id) });
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({
            action: z.enum(['preview', 'apply', 'restore', 'test']),
            config: z.unknown().optional(),
            token: z.string().optional(),
          })
          .strict()
          .parse(await body(req));
        send(
          input.action === 'preview'
            ? await this.network.preview(id, input.config, signal)
            : input.action === 'apply'
              ? await this.network.apply(id, input.config, input.token || '')
              : input.action === 'restore'
                ? await this.network.restore(id)
                : this.network.test(id, input.config),
        );
        return true;
      }
    }
    if (action === 'secrets') {
      if (req.method === 'GET') {
        send({ items: await this.secrets.list(id) });
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.secrets.save(id, await body(req)));
        return true;
      }
      if (req.method === 'DELETE') {
        const input = z
          .object({ name: z.string() })
          .strict()
          .parse(await body(req));
        send(await this.secrets.remove(id, input.name));
        return true;
      }
    }
    if (action === 'health' && req.method === 'GET') {
      send(await this.health.view(id));
      return true;
    }
    if (action === 'containers') {
      if (req.method === 'GET') {
        send(
          url.searchParams.has('logs')
            ? await this.containers.logs(id, url.searchParams.get('logs')!, signal)
            : await this.containers.view(id, signal),
        );
        return true;
      }
      if (req.method === 'POST') {
        send(await this.containers.run(id, await body(req)), 202);
        return true;
      }
    }
    if (action === 'backup-download' && req.method === 'POST') {
      const input = z
        .object({ backupId: z.uuid() })
        .strict()
        .parse(await body(req));
      send(await this.downloads.issueLocal(id, await this.backups.downloadable(id, input.backupId)));
      return true;
    }
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
    if (action === 'compact' && req.method === 'POST') {
      send(this.maintenance.compact(id), 202);
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
            decisions: z
              .record(
                z.string().max(4096),
                z.enum([
                  'push',
                  'pull',
                  'both',
                  'skip',
                  'delete-host',
                  'delete-guest',
                  'restore-host',
                  'restore-guest',
                ]),
              )
              .optional(),
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
