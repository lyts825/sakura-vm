import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { freePort, qmp } from './qmp.ts';
import {
  RuntimeManager,
  PosixLoomService,
  NATIVE_COMMANDS,
  NATIVE_COMMAND_ADAPTERS,
} from '../.vendor/posixloom/dist/src/index.js';
import { ROOT, DATA, AppError } from './model.ts';

export async function createRuntime() {
  const qemuDir = process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const binaries = {
    'sakura-qemu': join(qemuDir, `qemu-system-x86_64${suffix}`),
    'sakura-img': join(qemuDir, `qemu-img${suffix}`),
    'sakura-io': join(qemuDir, `qemu-io${suffix}`),
  };
  for (const binary of [binaries['sakura-qemu'], binaries['sakura-img']])
    if (!existsSync(binary)) throw new AppError(`缺少 QEMU：${binary}。请运行 npm run setup。`, 503);
  const qemuIoAvailable = existsSync(binaries['sakura-io']);
  const data = join(DATA, 'posixloom');
  await mkdir(join(data, 'config'), { recursive: true });
  await writeFile(
    join(data, 'config/config.json'),
    JSON.stringify({
      process: { maxConcurrent: 16, maxConcurrentPerClient: 16, defaultTimeoutMs: 30000 },
      updates: { enabled: false, autoApply: false },
    }),
  );
  process.env.POSIXLOOM_DATA_ROOT = data;
  const runtime = await RuntimeManager.create(join(ROOT, '.vendor/posixloom'), {
    plugins: [
      {
        manifest: {
          id: 'sakura.qemu',
          version: '1.0.0',
          description: 'Managed QEMU processes',
          provides: [NATIVE_COMMANDS.id, NATIVE_COMMAND_ADAPTERS.id],
        },
        activate(context) {
          context.provide(NATIVE_COMMAND_ADAPTERS, {
            id: 'sakura-exact-argv',
            adapt: (argv) => ({ argv: [...argv], decisions: [] }),
          });
          for (const [name, executable] of Object.entries(binaries))
            if (existsSync(executable))
              context.provide(NATIVE_COMMANDS, {
                name,
                executable,
                adapterId: 'sakura-exact-argv',
                shellEquivalent: true,
              });
        },
      },
    ],
  });
  if (process.platform === 'win32' && !runtime.findNativeHost()) {
    await runtime.close();
    throw new AppError('请先构建 PosixLoom Native Host：npm run setup', 503);
  }
  const service = new PosixLoomService(runtime);
  const run = async (
    tool: keyof typeof binaries,
    args: string[],
    options: { signal?: AbortSignal; timeoutMs?: number; output?: (data: Buffer) => void } = {},
  ) => {
    const sessionId = service.createSession();
    try {
      const result = await service.execute(
        {
          sessionId,
          kind: 'argv',
          argv: [tool, ...args],
          statePolicy: 'isolated',
          timeoutMs: options.timeoutMs || 30000,
          signal: options.signal,
        },
        { onOutput: (e) => options.output?.(e.data) },
      );
      if (result.command.kind !== 'exited' || result.command.exitCode !== 0) {
        if (options.signal?.aborted) return '';
        throw new Error(result.stderr.toString().trim() || `QEMU: ${JSON.stringify(result.command)}`);
      }
      return result.stdout.toString();
    } finally {
      service.sessions.close(sessionId);
    }
  };
  const version = (await run('sakura-qemu', ['--version'])).split(/\r?\n/)[0];
  // Probe a paused, diskless VM. A compiled-in accelerator is not sufficient:
  // the Windows feature and host hypervisor must also be usable by this user.
  let whpxAvailable = false;
  if (process.platform === 'win32') {
    const port = await freePort();
    const abort = new AbortController();
    let exited = false;
    const probe = run(
      'sakura-qemu',
      [
        '-accel',
        'whpx',
        '-machine',
        'q35',
        '-nodefaults',
        '-display',
        'none',
        '-S',
        '-qmp',
        `tcp:127.0.0.1:${port},server=on,wait=off`,
      ],
      { signal: abort.signal, timeoutMs: 5000 },
    )
      .catch(() => {})
      .finally(() => {
        exited = true;
      });
    try {
      const deadline = performance.now() + 3000;
      while (!exited && performance.now() < deadline) {
        try {
          await qmp(port, 'query-status');
          whpxAvailable = true;
          break;
        } catch {
          if (!exited) await delay(100);
        }
      }
    } finally {
      abort.abort();
      await probe;
    }
  }
  return { runtime, service, run, version, whpxAvailable, qemuIoAvailable };
}
export type Engine = Awaited<ReturnType<typeof createRuntime>>;
