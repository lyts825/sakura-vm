import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { z } from 'zod';

import { ProjectFiles } from '../project-files.ts';
import { CommandPresets } from '../command-presets.ts';
import { Toolchains } from '../toolchains.ts';
import { Pipelines } from '../pipelines.ts';
import { RuntimeVersions } from '../runtime-versions.ts';
import { CodeIntelligence } from '../code-intelligence.ts';

export const services = [
  'projectFiles',
  'commands',
  'toolchains',
  'pipelines',
  'runtimes',
  'intelligence',
] as const;
export async function activate(host: Features) {
  const m = host.machines;
  host.projectFiles = new ProjectFiles(m, host.workspaces);
  host.commands = new CommandPresets(m, host.workspaces);
  host.toolchains = new Toolchains(m, host.workspaces);
  host.pipelines = new Pipelines(m, host.workspaces, host.files);
  host.runtimes = new RuntimeVersions(m, host.workspaces);
  host.intelligence = new CodeIntelligence(m, host.workspaces);
}
export async function route(
  this: Features,
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
  }
  if (parts.length === 4) {
    if (action === 'pipeline-artifact' && req.method === 'POST') {
      const input = z
        .object({ runId: z.uuid(), index: z.number().int().min(0).max(19) })
        .strict()
        .parse(await body(req));
      const target = await this.pipelines.artifact(id, input.runId, input.index);
      send(await this.downloads.issueLocal(id, { path: target.file, name: target.name }));
      return true;
    }
  }
  if (parts.length === 4) {
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
  }
  if (parts.length === 4) {
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
  }
  if (parts.length === 4) {
    if (action === 'code-diagnostics' && req.method === 'GET') {
      send(await this.intelligence.diagnose(id, url.searchParams.get('path') || '', signal));
      return true;
    }
  }
  if (parts.length === 4) {
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
  }
  if (parts.length === 4) {
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
  }
  return false;
}
