import { randomUUID } from 'node:crypto';
import type { Machines } from './machines.ts';
import { quote } from './files.ts';

// A dedicated process group lets cancellation stop the guest process tree even
// after its SSH channel has closed. The control connection is separate.
export async function guestTask(
  machines: Machines,
  id: string,
  script: string,
  signal: AbortSignal,
  log?: (text: string) => void,
  timeout = 1200000,
) {
  const instance = machines.live.get(id);
  const pid = `/tmp/.sakura-job-${randomUUID()}.pid`;
  const status = pid + '.status';
  const worker = `echo $$ > ${quote(pid)}\nsh -c ${quote(script)}\nsakura_code=$?\nprintf '%s' "$sakura_code" > ${quote(status + '.tmp')}\nmv ${quote(status + '.tmp')} ${quote(status)}\nexit "$sakura_code"`;
  try {
    // BusyBox setsid can fork and return 0 before the child exits. Preserve the
    // actual script status explicitly, independently of setsid's launcher PID.
    return await machines.exec(
      id,
      `setsid sh -c ${quote(worker)} &\nsakura_launcher=$!\nwait "$sakura_launcher" || true\nsakura_waits=0\nwhile [ ! -f ${quote(status)} ]; do\n  if [ -f ${quote(pid)} ]; then\n    if ! kill -0 "$(cat ${quote(pid)})" 2>/dev/null; then [ -f ${quote(status)} ] || { echo '任务进程意外退出' >&2; exit 1; }; fi\n  elif [ "$sakura_waits" -ge 50 ]; then echo '任务进程未能启动' >&2; exit 1; fi\n  sakura_waits=$((sakura_waits + 1))\n  sleep 0.1\ndone\nsakura_code=$(cat ${quote(status)})\nexit "$sakura_code"`,
      timeout,
      signal,
      log,
    );
  } finally {
    if (instance && machines.live.get(id) === instance)
      await machines
        .exec(
          id,
          `if [ -f ${quote(pid)} ]; then p=$(cat ${quote(pid)}); case "$p" in ''|*[!0-9]*) ;; *) kill -TERM -- -"$p" 2>/dev/null || true; sleep 0.2; kill -KILL -- -"$p" 2>/dev/null || true;; esac; fi; rm -f ${quote(pid)} ${quote(status)} ${quote(status + '.tmp')}`,
          5000,
        )
        .catch(() => {});
  }
}
