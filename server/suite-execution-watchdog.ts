/** 复用固定原生监管程序，描述符仅持有本会话原进程身份。 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { MetadataStore } from './metadata-store.ts';
import { launchCoreDrillProcess } from './core-drill-validation.ts';
import { windowsOriginalProcessStopped, type WindowsProcessPin } from './vm-process-pin.ts';
import type { ObservedHostProcess } from './process-supervisor.ts';
import { AppError } from '../shared/errors.ts';
const description = z
  .object({
    id: z.uuid(),
    pid: z.number().int().positive(),
    created: z.string(),
    nonce: z.string(),
    deadline: z.iso.datetime(),
  })
  .strict();
const event = z
  .object({
    kind: z.enum(['ready', 'withdrawn', 'stopping', 'stopped', 'unknown']),
    pid: z.number().int(),
    created: z.string(),
    watchdogPid: z.number().int(),
    watchdogCreated: z.string(),
  })
  .passthrough();
export class SuiteExecutionWatchdogs {
  private children = new Set<ObservedHostProcess>();
  constructor(
    private root: string,
    private executable: string,
    private controllerCreated: string,
  ) {}
  private paths(id: string) {
    z.uuid().parse(id);
    return {
      description: join(this.root, id + '.json'),
      events: join(this.root, id + '.jsonl'),
      mailbox: join(this.root, id + '.mail'),
    };
  }
  async reconnect(id: string) {
    const paths = this.paths(id),
      d = description.parse(
        (await new MetadataStore(paths.description, { fallback: () => null }).read()).value,
      );
    const read = async () => {
      let text: string;
      try {
        text = await readFile(paths.events, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
      if (Buffer.byteLength(text) > 64 * 1024)
        throw new AppError('原监管回执越界', 503, 'SUITE_EXECUTION_GUARD_UNKNOWN');
      const lines = text.split('\n');
      lines.pop();
      return lines
        .map((line) => event.parse(JSON.parse(line)))
        .filter((value) => value.pid === d.pid && value.created === d.created);
    };
    return {
      read,
      contain: async () => {
        const temporary = paths.mailbox + '.' + randomUUID() + '.next';
        try {
          await writeFile(temporary, d.nonce + ' contain', { flag: 'wx', mode: 0o600 });
          await rename(temporary, paths.mailbox);
        } finally {
          await unlink(temporary).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      },
      stopped: () => windowsOriginalProcessStopped(d.pid, d.created),
    };
  }
  async start(id: string, pin: WindowsProcessPin, deadline: string) {
    const paths = this.paths(id),
      value = description.parse({
        id,
        pid: pin.pid,
        created: pin.created,
        nonce: randomBytes(32).toString('hex'),
        deadline,
      });
    await mkdir(this.root, { recursive: true });
    const ledger = new MetadataStore<unknown>(paths.description, { fallback: () => null }),
      snapshot = await ledger.read();
    if (snapshot.value !== null)
      throw new AppError('原会话监管已经登记', 409, 'SUITE_EXECUTION_GUARD_REPLAY');
    await ledger.replace(value, { expectedRevision: snapshot.revision });
    const child = await launchCoreDrillProcess('drill-watchdog', this.executable, [
      String(pin.pid),
      pin.created,
      String(process.pid),
      this.controllerCreated,
      String(Date.parse(deadline)),
      String(Date.parse(deadline)),
      value.nonce,
      paths.events,
      paths.mailbox,
    ]);
    this.children.add(child);
    void child.closed.then(() => this.children.delete(child));
    const handle = await this.reconnect(id),
      until = Date.now() + 5000;
    while (Date.now() < until) {
      if ((await handle.read()).some((value) => value.kind === 'ready')) return handle;
      await delay(25);
    }
    await handle.contain();
    throw new AppError('独立监管未确认就绪', 503, 'SUITE_EXECUTION_GUARD_UNAVAILABLE');
  }
  async close() {
    await Promise.all([...this.children].map((child) => child.waitForClose(5000)));
  }
}
