import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hostProcess } from './host-process.ts';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { captureOperationCheck, withOperationCheck } from './operation-context.ts';
import { vmLifetime } from './vm-lifetime.ts';
import { withResourceContext } from './host-runtime/context.ts';

const programId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/);
const executable = z.string().max(512).regex(/^[a-zA-Z]:\\[^\x00-\x1f"<>|?*]+\.exe$/i);
export const processInteropInput = z.object({
  mode: z.enum(['status', 'allow', 'remove', 'install', 'disable']).default('status'),
  programId: programId.optional(),
  executable: executable.optional(),
  fixedArgs: z.array(z.string().max(4096)).max(32).optional(),
}).strict();
export const guestInteropRequest = z.object({
  vmId: z.uuid(), programId,
}).strict();

type Program = { executable: string; fixedArgs: string[]; sha256: string };
type Entry = { enabled: boolean; tokenHash?: string; programs: Record<string, Program> };
type State = Record<string, Entry>;
const stateSchema = z.record(z.uuid(), z.object({
  enabled: z.boolean(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  programs: z.record(programId, z.object({
    executable, fixedArgs: z.array(z.string().max(4096)).max(32),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()),
}).strict());
const file = () => join(DATA, 'process-interop.json');
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

async function checkedExecutable(path: string) {
  executable.parse(path);
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new AppError('需要普通 Windows EXE 文件', 400);
  if ((await realpath(path)).toLowerCase() !== resolve(path).toLowerCase())
    throw new AppError('不允许经符号链接或联接指向可执行文件', 400);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function sameToken(expected: string | undefined, actual: string | undefined) {
  if (!expected || !actual || !/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(actual))
    return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

async function runProgram(program: Program, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const authority = captureOperationCheck();
  const env: NodeJS.ProcessEnv = {};
    for (const name of ['SystemRoot', 'WINDIR', 'Path', 'PATH', 'TEMP', 'TMP', 'USERPROFILE']) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
  const result = await withOperationCheck(async () => {
    // Check the registered image after process-budget admission, not before an arbitrarily long queue.
    if (await checkedExecutable(program.executable) !== program.sha256)
      throw new AppError('Windows 程序已改变，请重新登记', 409);
    await authority();
  }, () => hostProcess('process-interop', program.executable, program.fixedArgs,
    { signal, env, timeout: 30000, maxBuffer: 128 * 1024 }));
  return { exitCode: result.code, stdout: result.stdout, stderr: result.stderr };
}

export class ProcessInterop {
  private stateValue?: State;
  private loading?: Promise<State>;
  private writes = Promise.resolve();
  private busy = new Set<string>();

  constructor(private machines: Machines, private port: number,
    private allowed: () => void = () => {}, private execute: typeof runProgram = runProgram) {}

  private async state() {
    return this.stateValue ||= await (this.loading ||= readStore<State>(file(), () => ({}))
      .then((value) => stateSchema.parse(value)));
  }

  private async mutate(change: (state: State) => void) {
    const write = this.writes.catch(() => {}).then(async () => {
      const next = structuredClone(await this.state());
      change(next);
      await writeStore(file(), next);
      this.stateValue = next;
    });
    this.writes = write;
    await write;
  }

  private guard(id: string) {
    this.allowed();
    this.machines.get(id);
    this.machines.requireUnlocked(id);
  }

  async action(id: string, options: unknown, phase: 'check' | 'run', signal?: AbortSignal) {
    this.guard(id);
    const input = processInteropInput.parse(options);
    const entry = (await this.state())[id] || { enabled: false, programs: {} };
    const programs = Object.entries(entry.programs).map(([name, program]) => ({
      programId: name, executable: program.executable, fixedArgs: program.fixedArgs,
      sha256: program.sha256,
    }));
    if (input.mode === 'status')
      return { ready: process.platform === 'win32', executed: false,
        enabled: entry.enabled, installed: !!entry.tokenHash, programs,
        ...(process.platform !== 'win32' ? { reason: '仅支持 Windows 宿主机' } : {}),
        message: '先登记固定 EXE，再启动实例并安装 sakura-win；在 Linux 中运行 sakura-win <programId>。' };
    if (process.platform !== 'win32') throw new AppError('仅支持 Windows 宿主机', 409);
    if (input.mode === 'allow') {
      if (!input.programId || !input.executable) throw new AppError('需要 programId 和 executable', 400);
      const sha256 = await checkedExecutable(input.executable);
      if (phase === 'run') {
        await this.mutate((state) => {
          const target = state[id] ||= { enabled: false, programs: {} };
          target.programs[input.programId!] = { executable: input.executable!,
            fixedArgs: input.fixedArgs || [], sha256 };
        });
      }
      return { ready: true, executed: phase === 'run', programId: input.programId, sha256 };
    }
    if (input.mode === 'remove') {
      if (!input.programId) throw new AppError('需要 programId', 400);
      if (!entry.programs[input.programId]) throw new AppError('程序尚未登记', 404);
      if (phase === 'run') await this.mutate((state) => {
        if (!state[id]?.programs[input.programId!]) throw new AppError('程序尚未登记', 404);
        delete state[id].programs[input.programId!];
      });
      return { ready: true, executed: phase === 'run', programId: input.programId };
    }
    if (input.mode === 'disable') {
      if (phase === 'run') await this.mutate((state) => {
        const target = state[id] ||= { enabled: false, programs: {} };
        target.enabled = false;
        delete target.tokenHash;
      });
      return { ready: true, executed: phase === 'run', enabled: phase === 'run' ? false : entry.enabled };
    }
    if (!programs.length) throw new AppError('请先登记 Windows 程序', 409);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
    if (phase === 'check') {
      const check = await this.machines.exec(id, 'command -v curl; command -v jq', 10000, signal);
      return { ready: check.code === 0, executed: false, installed: !!entry.tokenHash,
        reason: check.code === 0 ? undefined : '客户机需要 curl 和 jq；run 会尝试安装。' };
    }
    const check = await this.machines.exec(id,
      'command -v curl >/dev/null && command -v jq >/dev/null || { if command -v apk >/dev/null; then apk add --no-cache curl jq; elif command -v apt-get >/dev/null; then apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y curl jq; else exit 1; fi; }',
      180000, signal);
    if (check.code !== 0) throw new AppError('安装客户机 curl/jq 失败：' + check.stderr.slice(0, 1000), 409);
    const token = randomBytes(32).toString('hex');
    const helper = [
      '#!/bin/sh', 'set -eu',
      'if [ "$#" -ne 1 ]; then echo "usage: sakura-win <programId>" >&2; exit 2; fi',
      'id="$1"',
      'case "$id" in ""|*[!a-zA-Z0-9_-]*) echo "invalid programId" >&2; exit 2;; esac',
      'payload=$(printf \'{"vmId":"' + id + '","programId":"%s"}\' "$id")',
      'result=$(printf %s "$payload" | curl --config /etc/sakura/interop.curl --noproxy "*" --fail-with-body --silent --show-error --max-time 35 -H "Host: localhost:' + this.port + '" -H "Content-Type: application/json" --data-binary @- http://10.0.2.2:' + this.port + '/api/guest/interop)',
      'printf %s "$result" | jq -rj ".stdout // empty"',
      'printf %s "$result" | jq -rj ".stderr // empty" >&2',
      'code=$(printf %s "$result" | jq -r ".exitCode")',
      'exit "$code"',
      '',
    ].join('\n');
    const mkdir = await this.machines.exec(id, 'install -d -m 700 /etc/sakura', 10000, signal);
    if (mkdir.code !== 0) throw new AppError('创建客户机配置目录失败', 409);
    await this.machines.writeGuestFile(id, '/etc/sakura/interop.curl',
      'header = "X-Sakura-Guest-Token: ' + token + '"\n');
    await this.machines.writeGuestFile(id, '/usr/local/bin/sakura-win', helper);
    const chmod = await this.machines.exec(id,
      'chmod 600 /etc/sakura/interop.curl && chmod 755 /usr/local/bin/sakura-win', 10000, signal);
    if (chmod.code !== 0) throw new AppError('设置客户机调用程序权限失败', 409);
    await this.mutate((state) => {
      const target = state[id] ||= { enabled: false, programs: {} };
      if (!Object.keys(target.programs).length) throw new AppError('请先登记 Windows 程序', 409);
      target.enabled = true;
      target.tokenHash = digest(token);
    });
    return { ready: true, executed: true, enabled: true, installed: true,
      command: 'sakura-win <programId>' };
  }

  async guest(request: unknown, token: string | undefined, signal?: AbortSignal) {
    const { vmId, programId: name } = guestInteropRequest.parse(request);
    this.guard(vmId);
    const live = this.machines.live.get(vmId);
    if (!live) throw new AppError('实例未运行', 409);
    const lifetime = vmLifetime(vmId, live), identity = lifetime.capture();
    const executionSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    const entry = (await this.state())[vmId];
    if (!entry?.enabled || !sameToken(entry.tokenHash, digest(token || '')))
      throw new AppError('客户机调用未授权', 403);
    if (this.machines.state(vmId) !== 'running') throw new AppError('实例未运行', 409);
    if (!entry.programs[name]) throw new AppError('程序未获准调用', 403);
    const program = structuredClone(entry.programs[name]);
    const fingerprint = JSON.stringify(program);
    const check = async () => {
      this.guard(vmId);
      // stateValue is published only after writeStore confirms the atomic write. Never re-enter its writer queue.
      const current = this.stateValue?.[vmId];
      if (!current?.enabled || !sameToken(current.tokenHash, digest(token || '')) ||
          JSON.stringify(current.programs[name]) !== fingerprint)
        throw new AppError('客户机程序授权已改变', 403, 'INTEROP_AUTHORITY_CHANGED');
      if (this.machines.live.get(vmId) !== live || this.machines.state(vmId) !== 'running')
        throw new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      lifetime.assert(identity);
    };
    await check();
    if (this.busy.has(vmId)) throw new AppError('实例已有程序在运行', 409);
    this.busy.add(vmId);
    try {
      return { programId: name, ...await withResourceContext(identity, () =>
        withOperationCheck(check, () => this.execute(program, executionSignal))) };
    }
    finally { this.busy.delete(vmId); }
  }
}
