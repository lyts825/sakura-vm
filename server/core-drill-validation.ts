/** 显式准备期间验证独立监管；只使用本体新建的无盘 QEMU 与固定冻结控制器。
 * Validate supervision during explicit preparation using a new diskless QEMU and fixed frozen controller. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arch, release } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA, ROOT } from './paths.ts';
import { MetadataStore } from './metadata-store.ts';
import { processSupervisor, spawnObserved, type ObservedHostProcess } from './process-supervisor.ts';
import { withoutPluginAuthority } from './plugin-authority.ts';
import { withNewResourceContext } from './host-runtime/context.ts';
import type { VmAccess } from './vm-access.ts';
import { windowsProcessPin } from './vm-process-pin.ts';
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const proofSchema = z
  .object({
    fingerprint: z.string(),
    verifiedAt: z.iso.datetime(),
    latenessMs: z.number().min(0).max(5000),
    targetCreated: z.string(),
    controllerCreated: z.string(),
  })
  .strict();
const evidenceSchema = z
  .object({
    kind: z.string(),
    reason: z.string(),
    at: z.number(),
    pid: z.number(),
    created: z.string(),
    watchdogPid: z.number().int(),
    watchdogCreated: z.string(),
    faultDeadline: z.number(),
    runDeadline: z.number(),
  })
  .strict();

/** 监管不继承业务插件取消信号；额度仅在实际子进程退出时归还。
 * The guard does not inherit plugin cancellation; physical process exit releases its budget. */
export function launchCoreDrillProcess(
  adapter: 'drill-watchdog' | 'drill-validation-controller',
  file: string,
  args: string[],
) {
  return withoutPluginAuthority(() =>
    withNewResourceContext({ owner: 'core:drill-supervision' }, () =>
      processSupervisor.observe(
        adapter,
        () =>
          spawnObserved(file, args, {
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'ignore'],
          }),
        { owner: 'core:drill-supervision', lane: 'control' },
      ),
    ),
  );
}

export class CoreDrillValidation {
  readonly root = join(DATA, 'drill-supervision');
  readonly executable =
    [
      join(ROOT, '.sakura-server', 'assets', 'resilience', 'drill-watchdog.exe'),
      join(ROOT, '.tools', 'resilience', 'drill-watchdog.exe'),
    ].find(existsSync) || join(ROOT, '.tools', 'resilience', 'drill-watchdog.exe');
  private proof = new MetadataStore<unknown>(join(this.root, 'host-validation.json'), {
    fallback: () => null,
  });
  private pending?: Promise<void>;
  private guest = false;
  constructor(private machines: VmAccess) {}
  private async fingerprint() {
    if (process.platform !== 'win32' || arch() !== 'x64')
      throw new AppError('独立演练监管当前仅验证 Windows x64', 409, 'DRILL_PLATFORM_UNAVAILABLE');
    const bytes = await readFile(this.executable),
      metadata = JSON.parse(await readFile(this.executable.replace(/\.exe$/, '.json'), 'utf8'));
    const source = await readFile(new URL('./drill-watchdog.cs', import.meta.url));
    if (metadata.digest !== hash(bytes) || metadata.sourceDigest !== hash(source))
      throw new AppError('监管程序与构建摘要不匹配', 409, 'DRILL_ASSET_MISMATCH');
    return hash(
      [process.platform, arch(), release(), process.execPath, metadata.digest, metadata.sourceDigest].join(
        '\n',
      ),
    );
  }
  async view() {
    try {
      const fingerprint = await this.fingerprint(),
        evidence = proofSchema.safeParse((await this.proof.read()).value);
      const host = evidence.success && evidence.data.fingerprint === fingerprint;
      return {
        host,
        guest: this.guest,
        gaps: [
          ...(!host ? ['先显式准备隔离夹具，验证本机独立监管'] : []),
          ...(!this.guest ? ['本次服务运行尚未验证固定客户机监管'] : []),
        ],
      };
    } catch (error) {
      return { host: false, guest: false, gaps: [String(error).slice(0, 500)] };
    }
  }
  markGuestVerified() {
    this.guest = true;
  }
  async ensureHost() {
    if ((await this.view()).host) return;
    if (!this.pending)
      this.pending = this.verifyHost().finally(() => {
        this.pending = undefined;
      });
    await this.pending;
  }
  private async verifyHost() {
    const fingerprint = await this.fingerprint(),
      id = randomUUID(),
      folder = join(this.root, 'validation', id);
    await mkdir(folder, { recursive: true });
    const pidFile = join(folder, 'qemu.pid'),
      receipt = join(folder, 'watchdog.jsonl');
    const abort = new AbortController();
    let controller: ObservedHostProcess | undefined, watchdog: ObservedHostProcess | undefined;
    // The native owner and finite engine timeout also contain failures before the watchdog is armed.
    const vm = this.machines.engine.run(
      'sakura-qemu',
      [
        '-S',
        '-nodefaults',
        '-display',
        'none',
        '-monitor',
        'none',
        '-serial',
        'none',
        '-m',
        '128',
        '-smp',
        '1',
        '-machine',
        'q35,accel=tcg',
        '-pidfile',
        pidFile,
      ],
      { owner: 'core:drill-validation', processKind: 'vm', timeoutMs: 12000, signal: abort.signal },
    );
    void vm.catch(() => {});
    try {
      const readyBy = Date.now() + 5000;
      while (!existsSync(pidFile) && Date.now() < readyBy) await delay(25);
      const pid = Number((await readFile(pidFile, 'utf8')).trim());
      const target = await windowsProcessPin(pid);
      controller = await launchCoreDrillProcess('drill-validation-controller', process.execPath, [
        fileURLToPath(new URL('./core-drill-validation-controller.mjs', import.meta.url)),
      ]);
      if (!controller.child.pid) throw new Error('Validation controller did not start');
      const pin = await windowsProcessPin(controller.child.pid),
        deadline = Date.now() + 2000;
      watchdog = await launchCoreDrillProcess('drill-watchdog', this.executable, [
        String(pid),
        target.created,
        String(pin.pid),
        pin.created,
        String(deadline),
        String(deadline + 2000),
        randomBytes(32).toString('hex'),
        receipt,
        join(folder, 'mailbox'),
      ]);
      await watchdog.waitForClose(6500);
      const rows = (await readFile(receipt, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => evidenceSchema.parse(JSON.parse(line)));
      const stopped = rows.find((row) => row.kind === 'stopped' && row.reason === 'fault-deadline');
      if (
        !stopped ||
        stopped.pid !== pid ||
        stopped.created !== target.created ||
        stopped.faultDeadline !== deadline ||
        stopped.at < deadline ||
        stopped.at - deadline > 5000 ||
        controller.child.exitCode !== null
      )
        throw new AppError('冻结控制器下的独立 QEMU 截止校验失败', 503, 'DRILL_VALIDATION_FAILED');
      await vm.catch((error) => {
        if (error instanceof AppError && error.code === 'HOST_PROCESS_CLEANUP_PENDING') throw error;
      });
      await this.proof.replace({
        fingerprint,
        verifiedAt: new Date().toISOString(),
        latenessMs: stopped.at - deadline,
        targetCreated: target.created,
        controllerCreated: pin.created,
      });
    } finally {
      abort.abort();
      await vm.catch(() => {});
      if (controller) await controller.waitForClose(10000);
      if (watchdog) await watchdog.waitForClose(6500);
    }
  }
}
