import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Machines } from './machines.ts';
import { quote } from './files.ts';
import { AppError } from './model.ts';

// Read the complete stat: comm can contain spaces, parentheses, and newlines.
// POSIX shell keeps this available before Python is installed in a guest.
const processFields = `sakura_stat() {
  [ -r "$1" ] || return 1
  sakura_line=$(cat "$1" 2>/dev/null) || return 1
  [ "\${#sakura_line}" -le 4096 ] || return 1
  sakura_rest=\${sakura_line##*) }
  set -f
  set -- $sakura_rest
  set +f
  [ "$#" -ge 20 ] || return 1
  sakura_state=$1; sakura_group=$3; sakura_session=$4; sakura_start=\${20}
}`;

function taskCommands(receipt: string, script: string, timeout: number) {
  const status = receipt + '.status',
    cancel = receipt + '.cancel',
    stop = receipt + '.stop';
  // Keep the session/group alive even if its worker exits or TERM stops it.
  // A retry never authorizes a kill from a reusable numeric PGID alone.
  const anchor = `set -eu
umask 077
trap '' HUP INT TERM
${processFields}
sakura_boot=$1; sakura_leader=$2; sakura_leader_start=$3
[ ! -e ${quote(cancel)} ] || exit 125
[ "$(cat /proc/sys/kernel/random/boot_id)" = "$sakura_boot" ] || exit 125
sakura_stat /proc/$$/stat
[ "$sakura_group" = "$sakura_leader" ] && [ "$sakura_session" = "$sakura_leader" ] || exit 125
sakura_anchor_start=$sakura_start
sakura_stat /proc/"$sakura_leader"/stat
[ "$sakura_start" = "$sakura_leader_start" ] || exit 125
[ ! -e ${quote(cancel)} ] || exit 125
printf '%s %s %s %s %s %s\\n' 1 "$sakura_boot" "$sakura_leader" "$sakura_leader_start" "$$" "$sakura_anchor_start" > ${quote(receipt + '.tmp')}
mv ${quote(receipt + '.tmp')} ${quote(receipt)}
sakura_stop_requested() {
  [ -f ${quote(stop)} ] || return 1
  read -r sakura_stop_version sakura_stop_boot sakura_stop_leader sakura_stop_leader_start sakura_stop_anchor sakura_stop_anchor_start sakura_stop_extra < ${quote(stop)} || return 1
  [ "$sakura_stop_version" = 1 ] && [ -z "$sakura_stop_extra" ] &&
    [ "$sakura_stop_boot" = "$sakura_boot" ] && [ "$sakura_stop_leader" = "$sakura_leader" ] &&
    [ "$sakura_stop_leader_start" = "$sakura_leader_start" ] && [ "$sakura_stop_anchor" = "$$" ] &&
    [ "$sakura_stop_anchor_start" = "$sakura_anchor_start" ]
}
sakura_ticks=0; sakura_finished_ticks=0
while [ "$sakura_ticks" -lt ${Math.ceil(timeout / 1000) + 30} ] && [ "$sakura_finished_ticks" -lt 30 ] && ! sakura_stop_requested; do
  sleep 1; sakura_ticks=$((sakura_ticks + 1))
  if [ -f ${quote(status)} ]; then sakura_finished_ticks=$((sakura_finished_ticks + 1)); fi
done
# A lost control connection must not leave an empty anchor forever. Its own
# identity still reserves this session ID when it enforces a stop request or
# the final deadline. Never signal a numeric PGID from a separate controller:
# keeping this anchor alive closes the stat-check-to-kill PID reuse interval.
sakura_stat /proc/$$/stat
[ "$sakura_start" = "$sakura_anchor_start" ] && [ "$sakura_group" = "$sakura_leader" ] &&
  [ "$sakura_session" = "$sakura_leader" ] || exit 125
# Operand 0 addresses this still-live anchor's own group on dash and BusyBox.
kill -TERM 0 2>/dev/null || true
sleep 0.2
kill -KILL 0`;
  const worker = `set -eu
umask 077
sakura_finish() {
  sakura_code=$?
  printf '%s' "$sakura_code" > ${quote(status + '.tmp')}
  mv ${quote(status + '.tmp')} ${quote(status)}
}
trap sakura_finish 0
[ ! -e ${quote(cancel)} ] || exit 125
${processFields}
sakura_boot=$(cat /proc/sys/kernel/random/boot_id)
sakura_stat /proc/$$/stat
[ "$sakura_group" = "$$" ] && [ "$sakura_session" = "$$" ] || exit 125
sakura_leader_start=$sakura_start
sh -c ${quote(anchor)} sakura-task-anchor "$sakura_boot" "$$" "$sakura_leader_start" </dev/null >/dev/null 2>&1 &
sakura_anchor=$!
sakura_waits=0
while [ ! -f ${quote(receipt)} ]; do
  [ ! -e ${quote(cancel)} ] && kill -0 "$sakura_anchor" 2>/dev/null && [ "$sakura_waits" -lt 50 ] || exit 125
  sakura_waits=$((sakura_waits + 1)); sleep 0.1
done
[ ! -e ${quote(cancel)} ] || exit 125
sh -c ${quote(script)}`;
  const run = `setsid sh -c ${quote(worker)} &
sakura_launcher=$!
wait "$sakura_launcher" || true
sakura_waits=0
while [ ! -f ${quote(status)} ]; do
  if [ -f ${quote(receipt)} ]; then
    read -r sakura_version sakura_boot sakura_worker sakura_worker_start sakura_anchor sakura_anchor_start < ${quote(receipt)}
    if ! kill -0 "$sakura_worker" 2>/dev/null; then [ -f ${quote(status)} ] || { echo '任务进程意外退出' >&2; exit 1; }; fi
  elif [ "$sakura_waits" -ge 50 ]; then echo '任务进程未能启动' >&2; exit 1; fi
  sakura_waits=$((sakura_waits + 1)); sleep 0.1
done
sakura_code=$(cat ${quote(status)})
exit "$sakura_code"`;
  const cleanup = `set -eu
umask 077
${processFields}
sakura_fail() { echo "$1" >&2; exit 1; }
: > ${quote(cancel)}
sakura_waits=0
while [ ! -f ${quote(receipt)} ] && [ "$sakura_waits" -lt 10 ]; do
  sakura_waits=$((sakura_waits + 1)); sleep 0.1
done
[ -f ${quote(receipt)} ] || sakura_fail '任务归属尚未登记；启动已撤销，清理未确认'
read -r sakura_version sakura_boot sakura_leader sakura_leader_start sakura_anchor sakura_anchor_start sakura_extra < ${quote(receipt)} || sakura_fail '任务归属记录无法读取'
[ "$sakura_version" = 1 ] && [ -z "$sakura_extra" ] && [ "\${#sakura_boot}" -eq 36 ] || sakura_fail '任务归属记录无效'
case "$sakura_boot" in *[!0-9a-f-]*) sakura_fail '任务启动身份无效';; esac
for sakura_number in "$sakura_leader" "$sakura_leader_start" "$sakura_anchor" "$sakura_anchor_start"; do
  case "$sakura_number" in ''|*[!0-9]*) sakura_fail '任务进程身份无效';; esac
done
[ "$sakura_leader" -gt 1 ] && [ "$sakura_anchor" -gt 1 ] || sakura_fail '任务进程身份无效'
sakura_same_boot() { [ "$(cat /proc/sys/kernel/random/boot_id)" = "$sakura_boot" ]; }
sakura_owned_anchor() {
  sakura_same_boot && sakura_stat /proc/"$sakura_anchor"/stat &&
    [ "$sakura_start" = "$sakura_anchor_start" ] && [ "$sakura_group" = "$sakura_leader" ] &&
    [ "$sakura_session" = "$sakura_leader" ] && [ "$sakura_state" != Z ] && [ "$sakura_state" != X ]
}
sakura_group_alive() {
  for sakura_file in /proc/[0-9]*/stat; do
    if ! sakura_stat "$sakura_file"; then
      [ ! -e "$sakura_file" ] || sakura_fail '任务进程组状态无法核对'
      continue
    fi
    if [ "$sakura_group" = "$sakura_leader" ] &&
        [ "$sakura_session" = "$sakura_leader" ] && [ "$sakura_state" != Z ] && [ "$sakura_state" != X ]; then return 0; fi
  done
  return 1
}
sakura_same_boot || sakura_fail '客户机启动身份已改变；拒绝终止过期进程组'
if sakura_owned_anchor; then
  printf '%s %s %s %s %s %s\\n' 1 "$sakura_boot" "$sakura_leader" "$sakura_leader_start" "$sakura_anchor" "$sakura_anchor_start" > ${quote(stop + '.tmp')}
  mv ${quote(stop + '.tmp')} ${quote(stop)}
elif sakura_group_alive; then sakura_fail '任务锚点身份不匹配；拒绝终止其他进程组'; fi
sakura_waits=0
while sakura_group_alive && [ "$sakura_waits" -lt 20 ]; do
  sakura_waits=$((sakura_waits + 1)); sleep 0.1
done
sakura_same_boot || sakura_fail '客户机启动身份已改变；清理未确认'
if sakura_group_alive; then sakura_fail '任务进程组仍在运行，保留归属记录'; fi`;
  // Only retire after the host received verified cleanup and the stage callback
  // completed. A lost cleanup reply leaves the receipt available for a retry.
  const retire = `rm -f ${[receipt, receipt + '.tmp', status, status + '.tmp', cancel, stop, stop + '.tmp'].map(quote).join(' ')}`;
  return { run, cleanup, retire };
}

// A dedicated process group lets cancellation stop the guest tree after its
// SSH channel has closed. Cleanup uses independent, bounded control connections.
export async function guestTask(
  machines: Machines,
  id: string,
  script: string,
  signal: AbortSignal,
  log?: (text: string) => void,
  timeout = 1200000,
  agentPath?: string,
  afterCleanup?: () => Promise<void>,
) {
  const instance = machines.live.get(id);
  const receipt = `/tmp/.sakura-job-${randomUUID()}.pid`;
  const commands = taskCommands(receipt, script, timeout);
  const control = async (operation: string | (() => Promise<void>), phase: string) => {
    let failure: unknown;
    for (let attempt = 0; attempt < 3; ++attempt) {
      if (machines.live.get(id) !== instance) {
        failure = new Error('客户机实例已改变，原任务清理未确认');
        break;
      }
      try {
        if (typeof operation === 'string') {
          const result = await machines.exec(id, operation, 5000);
          if (result.code !== 0)
            throw new Error(result.stderr.trim() || result.stdout.trim() || '任务进程组清理失败');
        } else await operation();
        if (machines.live.get(id) !== instance) throw new Error('客户机实例已改变，原任务清理未确认');
        return;
      } catch (error) {
        failure = error;
        log?.(`客户机任务${phase}第 ${attempt + 1} 次未确认，正在核对归属重试。\n`);
        if (attempt < 2) await delay(250 * (attempt + 1));
      }
    }
    const message = `客户机任务${phase}未确认，请核查归属记录 ${receipt}：${failure instanceof Error ? failure.message : String(failure)}`;
    log?.(message + '\n');
    throw new AppError(message, 503, 'GUEST_TASK_CLEANUP_FAILED');
  };
  try {
    // BusyBox setsid can fork and return 0 before its child exits. The actual
    // worker status remains explicit and independent of the launcher PID.
    return await machines.exec(id, commands.run, timeout, signal, log, agentPath);
  } finally {
    if (instance) {
      await control(commands.cleanup, '清理');
      if (machines.live.get(id) !== instance)
        throw new AppError('客户机实例已改变，原任务清理未确认', 503, 'GUEST_TASK_CLEANUP_FAILED');
      if (afterCleanup) await control(afterCleanup, '后续清理');
      await control(commands.retire, '归属核销');
    }
  }
}
