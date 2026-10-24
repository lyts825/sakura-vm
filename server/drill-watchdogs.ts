/** 受管原生监管桥，持久保存精确身份和只收尾邮箱。
 * Managed native watchdog bridge with durable identity and containment-only mailbox. */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { hostExecFile } from './host-process.ts';
import { MetadataStore } from './metadata-store.ts';
import {
  drillIdSchema,
  drillIdentitySchema,
  type DrillIdentity,
} from '../shared/contracts/drill-supervision.ts';
import type { DrillWatchdogPort, DrillWatchdogHandle, DrillWatchdogEvent } from './drill-machine-port.ts';
const descriptor = z
  .object({
    runId: z.uuid(),
    identity: drillIdentitySchema,
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
    faultDeadline: z.iso.datetime(),
    runDeadline: z.iso.datetime(),
  })
  .strict();
const event = z
  .object({
    kind: z.enum(['ready', 'withdrawn', 'stopping', 'stopped', 'unknown']),
    reason: z.string(),
    at: z.number().int(),
    pid: z.number().int(),
    created: z.string(),
    watchdogPid: z.number().int(),
    watchdogCreated: z.string(),
    faultDeadline: z.number().int(),
    runDeadline: z.number().int(),
  })
  .strict();
export type DrillManagedLaunch = (file: string, args: string[]) => Promise<void>;
export class WindowsDrillWatchdogs implements DrillWatchdogPort {
  constructor(
    private root: string,
    private executable: string,
    private controllerCreated: string,
    private launch: DrillManagedLaunch,
    private validation: () => Promise<{ host: boolean; guest: boolean; gaps: string[] }>,
    private probe?: (pid: number) => Promise<{ created: string }>,
  ) {}
  async verified() {
    return process.platform === 'win32'
      ? this.validation()
      : { host: false, guest: false, gaps: ['此宿主尚未验证独立监管'] };
  }
  private paths(runId: string) {
    drillIdSchema.parse(runId);
    return {
      info: join(this.root, runId + '.json'),
      receipt: join(this.root, runId + '.jsonl'),
      mailbox: join(this.root, runId + '.mail'),
    };
  }
  async reconnect(runId: string): Promise<DrillWatchdogHandle> {
    const p = this.paths(runId),
      d = descriptor.parse((await new MetadataStore<unknown>(p.info, { fallback: () => null }).read()).value);
    const message = async (action: string) => {
      const temporary = p.mailbox + '.' + randomUUID() + '.next';
      try {
        await writeFile(temporary, d.nonce + ' ' + action, { mode: 0o600, flag: 'wx' });
        await rename(temporary, p.mailbox);
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    };
    const read = async () => {
      let text: string;
      try {
        text = await readFile(p.receipt, 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw e;
      }
      const lines = text.split('\n');
      lines.pop();
      return lines
        .map((line) => event.parse(JSON.parse(line)))
        .filter(
          (e) => e.pid === d.identity.processId && e.created === d.identity.processCreated,
        ) as DrillWatchdogEvent[];
    };
    return {
      receipt: p.receipt,
      contain: () => message('contain'),
      withdrawn: () => message('withdrawn'),
      read,
      alive: async () => {
        const events = await read(),
          ready = events.find((e) => e.kind === 'ready');
        if (!ready || events.some((e) => e.kind === 'stopped' || e.kind === 'unknown')) return false;
        try {
          const identity = this.probe
            ? await this.probe(ready.watchdogPid)
            : JSON.parse(
                (
                  await hostExecFile(
                    'drill-probe',
                    this.executable,
                    ['identity', String(ready.watchdogPid)],
                    { timeout: 5000, maxBuffer: 4096 },
                  )
                ).stdout,
              );
          return identity.created === ready.watchdogCreated;
        } catch {
          return false;
        }
      },
    };
  }
  async start(identity: DrillIdentity, runId: string, faultDeadline: string, runDeadline: string) {
    drillIdentitySchema.parse(identity);
    const p = this.paths(runId);
    const d = descriptor.parse({
      runId,
      identity,
      nonce: randomBytes(32).toString('hex'),
      faultDeadline,
      runDeadline,
    });
    await mkdir(this.root, { recursive: true });
    const ledger = new MetadataStore<unknown>(p.info, { fallback: () => null }),
      snapshot = await ledger.read();
    if (snapshot.value !== null)
      throw new AppError('原监管回执已存在，必须核销，不能覆盖', 409, 'RESILIENCE_EFFECT_UNKNOWN');
    await ledger.replace(d, { expectedRevision: snapshot.revision });
    // launch 必须由本体 ProcessSupervisor 持有；不继承插件取消信号。
    // Core ProcessSupervisor owns launch; no plugin abort signal may retire this guard.
    await this.launch(this.executable, [
      String(identity.processId),
      identity.processCreated,
      String(process.pid),
      this.controllerCreated,
      String(Date.parse(faultDeadline)),
      String(Date.parse(runDeadline)),
      d.nonce,
      p.receipt,
      p.mailbox,
    ]);
    const handle = await this.reconnect(runId),
      end = Date.now() + 3000;
    while (Date.now() < end) {
      if ((await handle.read()).some((e) => e.kind === 'ready')) return handle;
      await delay(25);
    }
    await handle.contain();
    throw new AppError('独立监管未取得真实句柄就绪回执', 503, 'RESILIENCE_GUARD_UNAVAILABLE');
  }
}
