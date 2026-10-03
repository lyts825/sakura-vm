import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { writeStore } from './local-store.ts';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { freePort, qmp } from './qmp.ts';
import {
  RuntimeManager,
  PosixLoomService,
  NATIVE_COMMANDS,
  NATIVE_COMMAND_ADAPTERS,
} from '../.vendor/posixloom/dist/src/index.js';
import { ROOT, DATA } from './paths.ts';
import { AppError } from '../shared/errors.ts';
import { qemuCpuModel } from '../shared/hardware.ts';
import { processSupervisor, type ProcessAdmission } from './process-supervisor.ts';
import { configureHostProcessNativeOwner } from './host-process.ts';

type RunOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  output?: (data: Buffer) => void;
  owner?: string;
  processKind?: 'vm' | 'tool';
  lane?: ProcessAdmission['lane'];
};

export async function createRuntime() {
  const qemuDir = process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const binaries = {
    'sakura-qemu': join(qemuDir, `qemu-system-x86_64${suffix}`),
    'sakura-qemu-aarch64': join(qemuDir, `qemu-system-aarch64${suffix}`),
    'sakura-img': join(qemuDir, `qemu-img${suffix}`),
    'sakura-io': join(qemuDir, `qemu-io${suffix}`),
  };
  for (const binary of [binaries['sakura-qemu'], binaries['sakura-img']])
    if (!existsSync(binary)) throw new AppError(`缺少 QEMU：${binary}。请运行 npm run setup。`, 503);
  const qemuIoAvailable = existsSync(binaries['sakura-io']);
  const data = join(DATA, 'posixloom');
  await mkdir(join(data, 'config'), { recursive: true });
  await writeStore(
    join(data, 'config/config.json'),
    {
      process: { maxConcurrent: 16, maxConcurrentPerClient: 16, defaultTimeoutMs: 30000 },
      updates: { enabled: false, autoApply: false },
    },
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
  configureHostProcessNativeOwner(runtime.findNativeHost());
  const execute = async (tool: keyof typeof binaries, args: string[], options: RunOptions) => {
    if (!Object.hasOwn(binaries, tool) || !existsSync(binaries[tool]))
      throw new AppError('未登记或不可用的 QEMU 工具', 503);
    const kind =
      options.processKind || (tool.startsWith('sakura-qemu') && !args.includes('--version') ? 'vm' : 'tool');
    return processSupervisor.run(
      { owner: options.owner || 'core:qemu', kind, label: tool, lane: options.lane, signal: options.signal },
      async (control) => {
        const sessionId = service.createSession();
        let mayHaveStarted = false,
          completed = false;
        try {
          const result = await service.execute(
            {
              sessionId,
              kind: 'argv',
              argv: [tool, ...args],
              statePolicy: 'isolated',
              timeoutMs: options.timeoutMs ?? 30000,
              signal: options.signal,
            },
            {
              onStarted: () => {
                mayHaveStarted = true;
              },
              onOutput: (event) => options.output?.(event.data),
            },
          );
          completed = true;
          if (
            result.command.kind === 'crashed' &&
            result.command.errorCode === 'NATIVE_HOST_CLEANUP_UNCONFIRMED'
          ) {
            const error = new AppError(
              '原生宿主未确认进程树退出，保留资源名额',
              503,
              'HOST_PROCESS_CLEANUP_PENDING',
            );
            control.cleanupPending(error);
            throw error;
          }
          return result;
        } catch (error) {
          // An exception after dispatch is not a native terminal acknowledgement.
          if (mayHaveStarted && !completed) control.cleanupPending(error);
          throw error;
        } finally {
          service.sessions.close(sessionId);
        }
      },
    );
  };
  const runStatus = async (tool: keyof typeof binaries, args: string[], options: RunOptions = {}) => {
    const result = await execute(tool, args, options);
    if (result.command.kind !== 'exited')
      throw new Error(result.stderr.toString().trim() || `QEMU: ${JSON.stringify(result.command)}`);
    return {
      code: result.command.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  };
  const run = async (tool: keyof typeof binaries, args: string[], options: RunOptions = {}) => {
    const result = await execute(tool, args, options);
    if (result.command.kind !== 'exited' || result.command.exitCode !== 0) {
      if (options.signal?.aborted) return '';
      throw new Error(result.stderr.toString().trim() || `QEMU: ${JSON.stringify(result.command)}`);
    }
    return result.stdout.toString();
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
        '-cpu',
        qemuCpuModel(),
        '-machine',
        'q35',
        '-nodefaults',
        '-display',
        'none',
        '-S',
        '-qmp',
        `tcp:127.0.0.1:${port},server=on,wait=off`,
      ],
      { signal: abort.signal, timeoutMs: 5000, processKind: 'tool', lane: 'control' },
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
  return {
    runtime,
    service,
    run,
    runStatus,
    version,
    whpxAvailable,
    qemuIoAvailable,
    aarch64Available: existsSync(binaries['sakura-qemu-aarch64']),
  };
}
export type Engine = Awaited<ReturnType<typeof createRuntime>>;
