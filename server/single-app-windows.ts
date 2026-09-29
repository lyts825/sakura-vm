import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { join } from 'node:path';
import type { Machines } from './machines.ts';
import { AppError, vmDir } from './model.ts';
import { quote } from './files.ts';
import { readStore, writeStore } from './local-store.ts';

export const singleAppProgram = z.string().regex(/^[A-Za-z][A-Za-z0-9+._-]{0,63}$/);
export const singleAppClipboard = z.object({ copy: z.boolean(), paste: z.boolean() }).strict();
const clipboardStoreSchema = z.object({ version: z.literal(1),
  rules: z.record(singleAppProgram, singleAppClipboard),
}).strict().refine((value) => Object.keys(value.rules).length <= 64,
  '单应用剪贴板规则不能超过 64 条');
export const singleAppInput = z.object({
  program: singleAppProgram,
  args: z.array(z.string().max(256).refine((value) => !/[\x00-\x1f]/.test(value))).max(12).default([]),
  resolution: z.enum(['800x600', '1024x768', '1280x800']).default('1024x768'),
  clipboard: singleAppClipboard.default({ copy: true, paste: true }),
}).strict();

type AppSession = { id: string; vmId: string; program: string; display: number;
  port: number; resolution: string; clipboard: { copy: boolean; paste: boolean };
  startedAt: string; revoked?: boolean };
const sessionName = (id: string) => `sakura-single-app-${id.slice(0, 12)}`;
const sessionLog = (id: string) => `/tmp/${sessionName(id)}.log`;
const sessionPid = (id: string) => `/tmp/sakura-single-app-${id}.pid`;

export class SingleAppWindows {
  private sessions = new Map<string, AppSession>();
  private sessionListeners = new Map<string, Set<() => void>>();
  private pending = new Set<Promise<AppSession>>();
  private closed = false;
  private closeAbort = new AbortController();
  constructor(private machines: Machines) {
    machines.on('change', this.onChange);
  }
  private onChange = () => {
    for (const [id, session] of this.sessions)
      if (!this.machines.records.has(session.vmId) ||
          this.machines.state(session.vmId) !== 'running') {
        this.disconnect(id);
        this.sessions.delete(id);
      }
  };

  private disconnect(sessionId: string) {
    const listeners = this.sessionListeners.get(sessionId);
    this.sessionListeners.delete(sessionId);
    for (const listener of listeners || []) listener();
  }

  onSessionInvalidated(id: string, sessionId: string, listener: () => void) {
    const session = this.sessions.get(z.uuid().parse(sessionId));
    if (!session || session.vmId !== id || session.revoked ||
        this.machines.state(id) !== 'running')
      throw new AppError('应用窗口会话已失效，请停止并重开', 409);
    const listeners = this.sessionListeners.get(sessionId) || new Set<() => void>();
    listeners.add(listener);
    this.sessionListeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size && this.sessionListeners.get(sessionId) === listeners)
        this.sessionListeners.delete(sessionId);
    };
  }

  private clipboardFile(id: string) {
    return join(vmDir(id), 'single-app-clipboard.json');
  }

  async clipboardPolicies(id: string) {
    this.machines.get(id);
    return clipboardStoreSchema.parse(await readStore(this.clipboardFile(id),
      () => ({ version: 1, rules: {} }))).rules;
  }

  async saveClipboardPolicy(id: string, program: string, raw: unknown) {
    singleAppProgram.parse(program);
    const clipboard = singleAppClipboard.parse(raw);
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    return this.machines.locked(`single-app:${id}`, async () => {
      const rules = await this.clipboardPolicies(id);
      const next = clipboardStoreSchema.parse({ version: 1,
        rules: { ...rules, [program]: clipboard } });
      await writeStore(this.clipboardFile(id), next);
      for (const session of this.sessions.values()) {
        if (session.vmId !== id || session.program !== program || session.revoked) continue;
        if ((session.clipboard.copy && !clipboard.copy) ||
            (session.clipboard.paste && !clipboard.paste)) {
          session.revoked = true;
          this.disconnect(session.id);
        }
      }
      return { program, clipboard };
    });
  }

  async removeClipboardPolicy(id: string, program: string) {
    singleAppProgram.parse(program);
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    return this.machines.locked(`single-app:${id}`, async () => {
      const rules = await this.clipboardPolicies(id);
      const removed = Object.hasOwn(rules, program);
      const remaining = Object.fromEntries(Object.entries(rules).filter(([key]) => key !== program));
      await writeStore(this.clipboardFile(id), { version: 1, rules: remaining });
      return { removed, program };
    });
  }

  private async alive(session: AppSession) {
    if (this.machines.state(session.vmId) !== 'running') return false;
    const result = await this.machines.exec(session.vmId,
      `tmux has-session -t =${sessionName(session.id)} 2>/dev/null`, 5000);
    return result.code === 0;
  }

  private async terminate(session: AppSession) {
    const command = `pid=$(cat ${quote(sessionPid(session.id))} 2>/dev/null || true)
case "$pid" in
  ''|*[!0-9]*) ;;
  *) if test -r "/proc/$pid/cmdline" &&
       test "$(stat -c %u "/proc/$pid" 2>/dev/null)" = "$(id -u sakura-desktop)" &&
       tr '\\000' ' ' < "/proc/$pid/cmdline" | grep -Fq ${quote(`sakura_app_id=${session.id}`)}; then
       kill -TERM "$pid" 2>/dev/null || true
     fi ;;
esac
closed=no
for attempt in $(seq 1 25); do
  if ! nc -z 127.0.0.1 ${session.port} >/dev/null 2>&1; then closed=yes; break; fi
  sleep 0.2
done
tmux kill-session -t =${sessionName(session.id)} 2>/dev/null || true
test "$closed" = yes`;
    const result = await this.machines.exec(session.vmId, command, 10000);
    if (result.code !== 0) throw new AppError('无法停止应用窗口的图形进程', 409);
  }

  async list(id: string) {
    this.machines.get(id);
    const rows = [...this.sessions.values()].filter((session) => session.vmId === id);
    return Promise.all(rows.map(async (session) => ({ ...session,
      status: await this.alive(session) ?
        (session.revoked ? 'relaunch-required' : 'running') : 'stopped' })));
  }

  async port(id: string, sessionId: string) {
    const session = this.sessions.get(z.uuid().parse(sessionId));
    if (!session || session.vmId !== id || this.machines.state(id) !== 'running')
      throw new AppError('应用窗口会话不存在或已停止', 404);
    if (session.revoked)
      throw new AppError('剪贴板规则已收紧，请停止并重开此窗口', 409);
    if (!await this.alive(session)) throw new AppError('应用窗口会话已退出', 409);
    if (session.revoked)
      throw new AppError('剪贴板规则已收紧，请停止并重开此窗口', 409);
    return session.port;
  }

  async start(id: string, raw: unknown, signal?: AbortSignal) {
    const input = singleAppInput.parse(raw);
    const activeSignal = signal
      ? AbortSignal.any([signal, this.closeAbort.signal]) : this.closeAbort.signal;
    const pending = this.machines.locked(`single-app:${id}`, async () => {
      activeSignal.throwIfAborted();
      if (this.closed || this.machines.closing)
        throw new AppError('应用窗口服务正在关闭', 503);
      const vm = this.machines.get(id);
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
      const rules = await this.clipboardPolicies(id);
      const savedClipboard = Object.hasOwn(rules, input.program) ? rules[input.program] : undefined;
      const clipboard = { copy: input.clipboard.copy && (savedClipboard?.copy ?? true),
        paste: input.clipboard.paste && (savedClipboard?.paste ?? true) };
      const existing = [...this.sessions.values()].filter((session) => session.vmId === id);
      const active = [];
      for (const session of existing) {
        if (await this.alive(session)) active.push(session);
        else this.sessions.delete(session.id);
      }
      if (active.length >= 4) throw new AppError('每个实例最多运行四个单应用窗口', 409);
      const alpine = !vm.distro || vm.distro === 'alpine';
      const install = alpine
        ? 'apk add --no-cache --timeout 30 tigervnc openbox xauth xdpyinfo tmux xterm font-dejavu'
        : 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && ' +
          'apt-get install -y -qq --no-install-recommends ' +
          'tigervnc-standalone-server openbox xauth x11-utils tmux xterm fonts-dejavu-core netcat-openbsd';
      const createUser = alpine
        ? 'adduser -D -h /home/sakura-desktop -s /bin/sh sakura-desktop'
        : 'useradd -m -d /home/sakura-desktop -s /bin/sh sakura-desktop';
      const provision = await this.machines.exec(id,
        `set -eu\nif ! (command -v Xvnc >/dev/null || command -v Xtigervnc >/dev/null) || ` +
          `! command -v openbox >/dev/null || ! command -v xauth >/dev/null || ` +
          `! command -v xdpyinfo >/dev/null || ! command -v tmux >/dev/null || ` +
          `! command -v xterm >/dev/null || ` +
          `! command -v nc >/dev/null; then ${install}; fi\n` +
          `if ! id sakura-desktop >/dev/null 2>&1; then ${createUser}; fi\n` +
          `command -v ${input.program} >/dev/null`, 240000, activeSignal);
      if (provision.code !== 0)
        throw new AppError(provision.stderr.slice(-1000) || '应用或图形环境安装失败', 409);
      let display = 0;
      for (const candidate of [10, 11, 12, 13, 14, 15, 16, 17]) {
        if (active.some((session) => session.display === candidate)) continue;
        activeSignal.throwIfAborted();
        const check = await this.machines.exec(id,
          `test ! -e /tmp/.X11-unix/X${candidate} && ` +
          `! nc -z 127.0.0.1 ${5900 + candidate} >/dev/null 2>&1`, 5000, activeSignal);
        if (check.code === 0) { display = candidate; break; }
      }
      if (!display) throw new AppError('没有可用的应用窗口显示端口', 409);
      const session: AppSession = { id: randomUUID(), vmId: id, program: input.program,
        display, port: 5900 + display, resolution: input.resolution,
        clipboard,
        startedAt: new Date().toISOString() };
      const app = [input.program, ...input.args.map(quote)].join(' ');
      const script = `set -eu
sakura_app_id=${session.id}
pid_file=${sessionPid(session.id)}
printf '%s\n' "$$" > "$pid_file"
directory=$(mktemp -d /tmp/${sessionName(session.id)}.XXXXXXXX)
chmod 700 "$directory"
export DISPLAY=:${display} XAUTHORITY="$directory/Xauthority"
xauth -f "$XAUTHORITY" add "$DISPLAY" . "$(od -An -N16 -tx1 /dev/urandom | tr -d '[:space:]')"
vnc_binary=$(command -v Xvnc || command -v Xtigervnc)
"$vnc_binary" "$DISPLAY" -geometry ${input.resolution} -depth 24 -rfbport ${session.port} -interface 127.0.0.1 -localhost -SecurityTypes None -AlwaysShared -nolisten tcp -auth "$XAUTHORITY" -AllowOverride=desktop -SendCutText=${clipboard.copy ? 1 : 0} -SendPrimary=${clipboard.copy ? 1 : 0} -AcceptCutText=${clipboard.paste ? 1 : 0} -SetPrimary=${clipboard.paste ? 1 : 0} >"$directory/xvnc.log" 2>&1 &
vnc_pid=$!
wm_pid=''
app_pid=''
cleanup() {
  trap - EXIT HUP INT TERM
  [ -z "$app_pid" ] || kill "$app_pid" 2>/dev/null || true
  [ -z "$wm_pid" ] || kill "$wm_pid" 2>/dev/null || true
  kill "$vnc_pid" 2>/dev/null || true
  wait "$vnc_pid" 2>/dev/null || true
  rm -rf -- "$directory"
  rm -f -- "$pid_file"
}
trap cleanup EXIT HUP INT TERM
ready=no
for attempt in $(seq 1 40); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then ready=yes; break; fi
  kill -0 "$vnc_pid" 2>/dev/null || break
  sleep 0.25
done
[ "$ready" = yes ] || { cat "$directory/xvnc.log" >&2; exit 1; }
openbox >"$directory/openbox.log" 2>&1 &
wm_pid=$!
timeout 14400 ${app} >"$directory/app.log" 2>&1 &
app_pid=$!
wait "$app_pid"
`;
      try {
        activeSignal.throwIfAborted();
        const launch = await this.machines.exec(id,
          `tmux new-session -d -s ${sessionName(session.id)} ` +
            quote(`su sakura-desktop -s /bin/sh -c ${quote(script)} > ${quote(sessionLog(session.id))} 2>&1`),
          10000, activeSignal);
        if (launch.code !== 0) throw new AppError(launch.stderr || '无法启动单应用窗口', 409);
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          activeSignal.throwIfAborted();
          const status = await this.machines.exec(id,
            `tmux has-session -t =${sessionName(session.id)} 2>/dev/null && ` +
            `nc -z 127.0.0.1 ${session.port} >/dev/null 2>&1`, 5000, activeSignal);
          if (status.code === 0) {
            activeSignal.throwIfAborted();
            if (this.closed || this.machines.closing)
              throw new AppError('应用窗口服务正在关闭', 503);
            this.sessions.set(session.id, session);
            return session;
          }
          if (!(await this.alive(session))) break;
          await delay(250);
        }
        const log = await this.machines.exec(id, `tail -c 2000 ${quote(sessionLog(session.id))}`, 5000);
        throw new AppError(log.stdout || '应用窗口未能启动', 409);
      } catch (error) {
        await this.terminate(session).catch(() => {});
        throw error;
      }
    });
    this.pending.add(pending);
    try { return await pending; }
    finally { this.pending.delete(pending); }
  }

  async stop(id: string, sessionId: string) {
    return this.machines.locked(`single-app:${id}`, async () => {
      const session = this.sessions.get(z.uuid().parse(sessionId));
      if (!session || session.vmId !== id) throw new AppError('应用窗口会话不存在', 404);
      this.disconnect(session.id);
      if (this.machines.state(id) === 'running') await this.terminate(session);
      this.sessions.delete(session.id);
      return { stopped: true };
    });
  }

  async close() {
    this.closed = true;
    this.closeAbort.abort();
    this.machines.off('change', this.onChange);
    await Promise.allSettled([...this.pending]);
    await Promise.allSettled([...this.sessions.values()].map((session) =>
      this.stop(session.vmId, session.id)));
    this.sessions.clear();
    this.sessionListeners.clear();
  }
}
