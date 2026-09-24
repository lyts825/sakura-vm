import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { z } from 'zod';
import { AppError } from '../model.ts';

import { importEncrypted } from '../encrypted-backups.ts';

export const services = [] as const;
export async function activate(host: Features) {}
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
  if (req.method === 'POST' && parts[3] === 'snapshots' && parts.length === 4) {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(60) })
      .strict()
      .parse(await body(req));
    return send(await this.machines.snapshot(id, name), 201);
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
