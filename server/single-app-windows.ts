import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError } from './model.ts';
import { quote } from './files.ts';

export const singleAppInput = z.object({
  program: z.string().regex(/^[A-Za-z][A-Za-z0-9+._-]{0,63}$/),
  args: z.array(z.string().max(256).refine((value) => !/[\x00-\x1f]/.test(value))).max(12).default([]),
  resolution: z.enum(['800x600', '1024x768', '1280x800']).default('1024x768'),
}).strict();

type AppSession = { id: string; vmId: string; program: string; display: number;
  port: number; resolution: string; startedAt: string };
const sessionName = (id: string) => `sakura-single-app-${id.slice(0, 12)}`;
const sessionLog = (id: string) => `/tmp/${sessionName(id)}.log`;

export class SingleAppWindows {
  private sessions = new Map<string, AppSession>();
  private pending = new Set<Promise<AppSession>>();
  private closed = false;
  constructor(private machines: Machines) {
    machines.on('change', this.onChange);
  }
  private onChange = () => {
    for (const [id, session] of this.sessions)
      if (!this.machines.records.has(session.vmId) ||
          this.machines.state(session.vmId) !== 'running') this.sessions.delete(id);
  };

  private async alive(session: AppSession) {
    if (this.machines.state(session.vmId) !== 'running') return false;
    const result = await this.machines.exec(session.vmId,
      `tmux has-session -t =${sessionName(session.id)} 2>/dev/null`, 5000);
    return result.code === 0;
  }

  async list(id: string) {
    this.machines.get(id);
    const rows = [...this.sessions.values()].filter((session) => session.vmId === id);
    return Promise.all(rows.map(async (session) => ({ ...session,
      status: await this.alive(session) ? 'running' : 'stopped' })));
  }

  async port(id: string, sessionId: string) {
    const session = this.sessions.get(z.uuid().parse(sessionId));
    if (!session || session.vmId !== id || this.machines.state(id) !== 'running')
      throw new AppError('应用窗口会话不存在或已停止', 404);
    if (!await this.alive(session)) throw new AppError('应用窗口会话已退出', 409);
    return session.port;
  }

  async start(id: string, raw: unknown) {
    const input = singleAppInput.parse(raw);
    const pending = this.machines.locked(`single-app:${id}`, async () => {
      if (this.closed || this.machines.closing)
        throw new AppError('应用窗口服务正在关闭', 503);
      const vm = this.machines.get(id);
      if (vm.distro && vm.distro !== 'alpine')
        throw new AppError('单应用窗口目前需要 Alpine 客户机', 409);
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
      const existing = [...this.sessions.values()].filter((session) => session.vmId === id);
      const active = [];
      for (const session of existing) {
        if (await this.alive(session)) active.push(session);
        else this.sessions.delete(session.id);
      }
      if (active.length >= 4) throw new AppError('每个实例最多运行四个单应用窗口', 409);
      const provision = await this.machines.exec(id,
        `set -eu\nif ! command -v Xvnc >/dev/null || ! command -v openbox >/dev/null || ` +
          `! command -v xauth >/dev/null || ! command -v xdpyinfo >/dev/null || ` +
          `! command -v tmux >/dev/null; then ` +
          `apk add --no-cache --timeout 30 tigervnc openbox xauth xdpyinfo tmux xterm font-dejavu; fi\n` +
          `if ! id sakura-desktop >/dev/null 2>&1; then ` +
          `adduser -D -h /home/sakura-desktop -s /bin/sh sakura-desktop; fi\n` +
          `command -v ${input.program} >/dev/null`, 180000);
      if (provision.code !== 0)
        throw new AppError(provision.stderr.slice(-1000) || '应用或图形环境安装失败', 409);
      let display = 0;
      for (const candidate of [10, 11, 12, 13, 14, 15, 16, 17]) {
        if (active.some((session) => session.display === candidate)) continue;
        const check = await this.machines.exec(id,
          `test ! -e /tmp/.X11-unix/X${candidate} && ` +
          `! nc -z 127.0.0.1 ${5900 + candidate} >/dev/null 2>&1`, 5000);
        if (check.code === 0) { display = candidate; break; }
      }
      if (!display) throw new AppError('没有可用的应用窗口显示端口', 409);
      const session: AppSession = { id: randomUUID(), vmId: id, program: input.program,
        display, port: 5900 + display, resolution: input.resolution,
        startedAt: new Date().toISOString() };
      const app = [input.program, ...input.args.map(quote)].join(' ');
      const script = `set -eu
directory=$(mktemp -d /tmp/${sessionName(session.id)}.XXXXXXXX)
chmod 700 "$directory"
export DISPLAY=:${display} XAUTHORITY="$directory/Xauthority"
xauth -f "$XAUTHORITY" add "$DISPLAY" . "$(od -An -N16 -tx1 /dev/urandom | tr -d '[:space:]')"
Xvnc "$DISPLAY" -geometry ${input.resolution} -depth 24 -rfbport ${session.port} -interface 127.0.0.1 -localhost -SecurityTypes None -AlwaysShared -nolisten tcp -auth "$XAUTHORITY" >"$directory/xvnc.log" 2>&1 &
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
      const launch = await this.machines.exec(id,
        `tmux new-session -d -s ${sessionName(session.id)} ` +
          quote(`su sakura-desktop -s /bin/sh -c ${quote(script)} > ${quote(sessionLog(session.id))} 2>&1`),
        10000);
      if (launch.code !== 0) throw new AppError(launch.stderr || '无法启动单应用窗口', 409);
      try {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const status = await this.machines.exec(id,
            `tmux has-session -t =${sessionName(session.id)} 2>/dev/null && ` +
            `nc -z 127.0.0.1 ${session.port} >/dev/null 2>&1`, 5000);
          if (status.code === 0) {
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
        await this.machines.exec(id,
          `tmux kill-session -t =${sessionName(session.id)} 2>/dev/null || true`, 5000).catch(() => {});
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
      if (this.machines.state(id) === 'running') {
        const result = await this.machines.exec(id,
          `if tmux has-session -t =${sessionName(session.id)} 2>/dev/null; then ` +
          `tmux kill-session -t =${sessionName(session.id)}; fi`, 10000);
        if (result.code !== 0) throw new AppError('无法停止应用窗口', 409);
      }
      this.sessions.delete(session.id);
      return { stopped: true };
    });
  }

  async close() {
    this.closed = true;
    this.machines.off('change', this.onChange);
    await Promise.allSettled([...this.pending]);
    await Promise.allSettled([...this.sessions.values()].map((session) =>
      this.stop(session.vmId, session.id)));
    this.sessions.clear();
  }
}
