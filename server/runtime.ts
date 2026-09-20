import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  };
  for (const binary of Object.values(binaries))
    if (!existsSync(binary)) throw new AppError(`缺少 QEMU：${binary}。请运行 npm run setup。`, 503);
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
  return { runtime, service, run, version };
}
export type Engine = Awaited<ReturnType<typeof createRuntime>>;
