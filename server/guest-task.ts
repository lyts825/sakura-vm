import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Machines } from './machines.ts';
import { quote } from './files.ts';
import { AppError } from './model.ts';
import { z } from 'zod';
import type { BaseAgent } from 'ssh2';
import { isOwnedTaskAgent } from './ssh-agent-scope.ts';

export const guestTaskControlRoot = '/run/sakura-guest-tasks';
export function guestTaskControlPaths(runId: string) {
  const id = z.uuid().parse(runId), directory = `${guestTaskControlRoot}/${id}`;
  return { directory, receipt: `${directory}/.sakura-job-${id}.pid` };
}
const rootCommand = (phase: 'RUN' | 'CLEANUP' | 'CONFIRM_STOPPED' | 'RETIRE', source: string, forwarded = false) =>
  `# SAKURA_GUEST_TASK_${phase}\n/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C` +
  // Only a minted, exact task owner may preserve the authenticated channel's
  // sshd listener. It is not an arbitrary project environment exception.
  (forwarded && phase === 'RUN' ? ' SAKURA_SSH_AGENT_SOURCE="${SSH_AUTH_SOCK-}"' : '') +
  ` /bin/sh -c ${quote('cd /\n' + source)}`;

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

// Check the kernel mount table rather than trusting an ordinary directory with
// cgroup-looking files. No libcgroup package is required in a managed guest.
const cgroupFields = `sakura_cgroup2() {
  [ -d /sys/fs/cgroup ] && [ ! -L /sys/fs/cgroup ] || return 1
  while IFS= read -r sakura_mount; do
    set -f; set -- $sakura_mount; set +f
    [ "$#" -ge 10 ] && [ "$5" = /sys/fs/cgroup ] || continue
    while [ "$#" -gt 0 ] && [ "$1" != - ]; do shift; done
    [ "$#" -ge 3 ] && [ "$2" = cgroup2 ] && return 0
  done < /proc/self/mountinfo
  return 1
}
sakura_inode() {
  if command -v stat >/dev/null 2>&1; then stat -L -c %i "$1"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -I -S -c 'import os,sys; print(os.stat(sys.argv[1]).st_ino)' "$1"
  else return 1; fi
}
sakura_empty() {
  sakura_populated=
  while read -r sakura_event sakura_value sakura_extra; do
    if [ "$sakura_event" = populated ] && [ -z "$sakura_extra" ]; then sakura_populated=$sakura_value; fi
  done < /proc/self/fd/8/cgroup.events
  [ "$sakura_populated" = 0 ]
}`;

function taskCommands(runId: string, token: string, script: string, timeout: number, input = false, forwarded = false) {
  const { directory, receipt } = guestTaskControlPaths(runId), owner = directory + '/owner';
  const status = receipt + '.status',
    cancel = receipt + '.cancel',
    stop = receipt + '.stop',
    ownership = receipt + '.scope',
    refused = receipt + '.refused',
    scopeName = 'sakura-task-' + runId,
    scope = '/sys/fs/cgroup/' + scopeName;
  // /run and the root-only base are checked before creation. The per-call token
  // prevents an old or concurrent use of the same run UUID from authorizing
  // writes, cleanup or receipt retirement. No Python is needed for this guard.
  const controlFields = `sakura_control_fail() { echo "SAKURA_TASK_CONTROL_REFUSED: $1" >&2; exit 125; }
sakura_control_directory() {
  [ -d "$1" ] && [ ! -L "$1" ] || sakura_control_fail '控制目录类型无法核对'
  sakura_control_info=$(stat -c '%u %g %a' "$1") || sakura_control_fail '控制目录权限无法读取'
  set -f; set -- $sakura_control_info "$2"; set +f
  [ "$#" -eq 4 ] && [ "$1" = 0 ] && [ "$2" = 0 ] || sakura_control_fail '控制目录不属于 root'
  case "$3" in ''|*[!0-7]*) sakura_control_fail '控制目录权限无效';; esac
  if [ "$4" = private ]; then
    [ "$3" = 700 ] || sakura_control_fail '控制目录必须为 root0700'
  else
    [ "$((0$3 & 022))" -eq 0 ] || sakura_control_fail '控制目录父级可由其他账号写入'
  fi
}
sakura_control_base() {
  [ "$(id -u)" = 0 ] || sakura_control_fail '任务控制需要 root'
  sakura_control_directory / parent
  sakura_control_directory /run parent
  if [ "$1" = create ] && [ ! -e ${quote(guestTaskControlRoot)} ] && [ ! -L ${quote(guestTaskControlRoot)} ]; then
    (umask 077; mkdir -m 0700 ${quote(guestTaskControlRoot)}) 2>/dev/null || true
  fi
  sakura_control_directory ${quote(guestTaskControlRoot)} private
}
sakura_control_file() {
  if [ -e "$1" ] || [ -L "$1" ]; then
    [ ! -L "$1" ] || sakura_control_fail '控制记录不是非链接普通文件'
    sakura_control_metadata=$(stat -c '%u %g %a %h' "$1" 2>/dev/null) || {
      [ ! -e "$1" ] && [ ! -L "$1" ] && return 0
      sakura_control_fail '控制记录元数据无法读取'
    }
    [ -f "$1" ] || {
      [ ! -e "$1" ] && [ ! -L "$1" ] && return 0
      sakura_control_fail '控制记录不是普通文件'
    }
    [ "$sakura_control_metadata" = '0 0 600 1' ] || sakura_control_fail '控制记录归属、权限或链接数无法核对'
  fi
}
sakura_control_task() {
  sakura_control_base existing
  sakura_control_directory ${quote(directory)} private
  sakura_control_file ${quote(owner)}
  [ -f ${quote(owner)} ] && [ "$(stat -c %s ${quote(owner)})" = 76 ] || sakura_control_fail '任务控制授权记录缺失或无效'
  read -r sakura_control_version sakura_control_token sakura_control_boot sakura_control_extra < ${quote(owner)} || sakura_control_fail '任务控制授权记录无法读取'
  [ "$sakura_control_version" = 1 ] && [ "$sakura_control_token" = ${quote(token)} ] &&
    [ -z "$sakura_control_extra" ] && [ "$sakura_control_boot" = "$(cat /proc/sys/kernel/random/boot_id)" ] || sakura_control_fail '任务控制授权或启动身份不符'
  for sakura_control_record in ${[receipt, receipt + '.tmp', ownership, ownership + '.tmp', refused, refused + '.tmp', status, status + '.tmp', cancel, stop, stop + '.tmp'].map(quote).join(' ')}; do
    sakura_control_file "$sakura_control_record"
  done
}
`;
  const prepareControl = `${controlFields}
umask 077
sakura_control_base create
[ ! -e ${quote(directory)} ] && [ ! -L ${quote(directory)} ] || sakura_control_fail 'run UUID 的控制目录已存在，未接管旧任务'
mkdir -m 0700 ${quote(directory)} || sakura_control_fail '任务控制目录无法独占创建'
sakura_control_directory ${quote(directory)} private
printf '%s %s %s\\n' 1 ${quote(token)} "$(cat /proc/sys/kernel/random/boot_id)" > ${quote(owner)}
sakura_control_task`;
  // The anchor provides a short TERM grace period and a finite lifetime. The
  // cgroup, inherited across setsid/fork, owns the complete foreground task.
  // Its open descriptor cannot accidentally address a replacement directory.
  const anchor = `set -eu
umask 077
trap '' HUP INT TERM
${controlFields}
sakura_control_task
${processFields}
${cgroupFields}
sakura_boot=$1; sakura_leader=$2; sakura_leader_start=$3; sakura_scope_inode=$4
[ ! -e ${quote(cancel)} ] || exit 125
[ "$(cat /proc/sys/kernel/random/boot_id)" = "$sakura_boot" ] || exit 125
exec 8< ${quote(scope)}
[ "$(sakura_inode /proc/self/fd/8)" = "$sakura_scope_inode" ] || exit 125
exec 9> /proc/self/fd/8/cgroup.kill
sakura_stat /proc/$$/stat
[ "$sakura_group" = "$sakura_leader" ] && [ "$sakura_session" = "$sakura_leader" ] || exit 125
sakura_anchor_start=$sakura_start
sakura_stat /proc/"$sakura_leader"/stat
[ "$sakura_start" = "$sakura_leader_start" ] || exit 125
[ ! -e ${quote(cancel)} ] || exit 125
sakura_control_task
printf '%s %s %s %s %s %s %s %s\\n' 2 "$sakura_boot" "$sakura_leader" "$sakura_leader_start" "$$" "$sakura_anchor_start" ${quote(scopeName)} "$sakura_scope_inode" > ${quote(receipt + '.tmp')}
mv ${quote(receipt + '.tmp')} ${quote(receipt)}
sakura_stop_requested() {
  sakura_control_task
  [ -f ${quote(stop)} ] || return 1
  read -r sakura_stop_version sakura_stop_boot sakura_stop_leader sakura_stop_leader_start sakura_stop_anchor sakura_stop_anchor_start sakura_stop_scope sakura_stop_inode sakura_stop_extra < ${quote(stop)} || return 1
  [ "$sakura_stop_version" = 2 ] && [ -z "$sakura_stop_extra" ] &&
    [ "$sakura_stop_boot" = "$sakura_boot" ] && [ "$sakura_stop_leader" = "$sakura_leader" ] &&
    [ "$sakura_stop_leader_start" = "$sakura_leader_start" ] && [ "$sakura_stop_anchor" = "$$" ] &&
    [ "$sakura_stop_anchor_start" = "$sakura_anchor_start" ] &&
    [ "$sakura_stop_scope" = ${quote(scopeName)} ] && [ "$sakura_stop_inode" = "$sakura_scope_inode" ]
}
sakura_ticks=0; sakura_finished_ticks=0
while [ "$sakura_ticks" -lt ${Math.ceil(timeout / 1000) + 30} ] && [ "$sakura_finished_ticks" -lt 30 ] && ! sakura_stop_requested; do
  sleep 1; sakura_ticks=$((sakura_ticks + 1))
  if [ -f ${quote(status)} ]; then sakura_finished_ticks=$((sakura_finished_ticks + 1)); fi
done
# A lost control connection must not leave a guard or detached descendant
# forever. TERM addresses this live anchor's own group; KILL addresses its
# already opened cgroup, including new groups and sessions made by the task.
sakura_stat /proc/$$/stat
[ "$sakura_start" = "$sakura_anchor_start" ] && [ "$sakura_group" = "$sakura_leader" ] &&
  [ "$sakura_session" = "$sakura_leader" ] || exit 125
[ "$(cat /proc/sys/kernel/random/boot_id)" = "$sakura_boot" ] &&
  [ "$(sakura_inode /proc/self/fd/8)" = "$sakura_scope_inode" ] || exit 125
kill -TERM 0 2>/dev/null || true
sleep 0.2
printf 1 >&9`;
  const worker = `set -eu
${input ? 'exec 7<&-\n' : ''}
umask 077
${controlFields}
sakura_control_task
sakura_finish() {
  sakura_code=$?
  sakura_control_task
  printf '%s' "$sakura_code" > ${quote(status + '.tmp')}
  mv ${quote(status + '.tmp')} ${quote(status)}
}
trap sakura_finish 0
${processFields}
${cgroupFields}
sakura_boot=$(cat /proc/sys/kernel/random/boot_id)
sakura_refuse() {
  sakura_control_task
  printf '%s %s %s\\n' 2 "$sakura_boot" ${quote(scopeName)} > ${quote(refused + '.tmp')}
  mv ${quote(refused + '.tmp')} ${quote(refused)}
  echo "SAKURA_TASK_SCOPE_UNAVAILABLE: $1；项目代码未执行" >&2
  exit 126
}
[ ! -e ${quote(cancel)} ] || sakura_refuse '任务启动已撤销'
if ! sakura_cgroup2 && [ -x /sbin/rc-service ]; then /sbin/rc-service cgroups start >/dev/null 2>&1 || true; fi
sakura_cgroup2 || sakura_refuse '客户机需要可写 cgroup v2'
[ ! -e ${quote(scope)} ] && [ ! -L ${quote(scope)} ] || { echo '任务 cgroup 名称已被占用；项目代码未执行' >&2; exit 125; }
mkdir ${quote(scope)} || sakura_refuse '无法创建独立任务 cgroup'
sakura_scope_inode=$(sakura_inode ${quote(scope)})
case "$sakura_scope_inode" in ''|*[!0-9]*) echo '任务 cgroup 身份无法读取；项目代码未执行' >&2; exit 125;; esac
sakura_control_task
printf '%s %s %s %s\\n' 2 "$sakura_boot" ${quote(scopeName)} "$sakura_scope_inode" > ${quote(ownership + '.tmp')}
mv ${quote(ownership + '.tmp')} ${quote(ownership)}
[ -w ${quote(scope + '/cgroup.kill')} ] || { echo 'SAKURA_TASK_SCOPE_UNAVAILABLE: 客户机缺少可写 cgroup.kill；项目代码未执行' >&2; exit 126; }
[ ! -e ${quote(cancel)} ] || exit 125
printf '%s' "$$" > ${quote(scope + '/cgroup.procs')}
grep -qx ${quote('0::/' + scopeName)} /proc/self/cgroup || { echo '任务未进入已登记 cgroup；项目代码未执行' >&2; exit 125; }
[ ! -e ${quote(cancel)} ] || exit 125
sakura_stat /proc/$$/stat
[ "$sakura_group" = "$$" ] && [ "$sakura_session" = "$$" ] || exit 125
sakura_leader_start=$sakura_start
sh -c ${quote(anchor)} sakura-task-anchor "$sakura_boot" "$$" "$sakura_leader_start" "$sakura_scope_inode" </dev/null >/dev/null 2>&1 &
sakura_anchor=$!
sakura_waits=0
while [ ! -f ${quote(receipt)} ]; do
  [ ! -e ${quote(cancel)} ] && kill -0 "$sakura_anchor" 2>/dev/null && [ "$sakura_waits" -lt 50 ] || exit 125
  sakura_waits=$((sakura_waits + 1)); sleep 0.1
done
[ ! -e ${quote(cancel)} ] || exit 125
sh -c ${quote(script)}`;
  const run = rootCommand('RUN', `${input ? 'exec 7<&0\n' : ''}${prepareControl}
setsid sh -c ${quote(worker)} ${input ? '<&7 ' : ''}&
sakura_launcher=$!
${input ? 'exec 7<&-\n' : ''}
wait "$sakura_launcher" || true
sakura_waits=0
while [ ! -f ${quote(status)} ]; do
  sakura_control_task
  if [ -f ${quote(receipt)} ]; then
    read -r sakura_version sakura_boot sakura_worker sakura_worker_start sakura_anchor sakura_anchor_start < ${quote(receipt)}
    if ! kill -0 "$sakura_worker" 2>/dev/null; then [ -f ${quote(status)} ] || { echo '任务进程意外退出' >&2; exit 1; }; fi
  elif [ "$sakura_waits" -ge 50 ]; then echo '任务进程未能启动' >&2; exit 1; fi
  sakura_waits=$((sakura_waits + 1)); sleep 0.1
done
sakura_code=$(cat ${quote(status)})
exit "$sakura_code"`, forwarded);
  const cleanup = rootCommand('CLEANUP', `set -eu
umask 077
${controlFields}
sakura_control_task
${processFields}
${cgroupFields}
sakura_fail() { echo "$1" >&2; exit 1; }
: > ${quote(cancel)}
sakura_waits=0
while [ ! -f ${quote(ownership)} ] && [ ! -f ${quote(refused)} ] && [ "$sakura_waits" -lt 10 ]; do
  sakura_waits=$((sakura_waits + 1)); sleep 0.1
done
[ -f ${quote(ownership)} ] || {
  if [ -f ${quote(refused)} ]; then
    read -r sakura_version sakura_boot sakura_scope sakura_extra < ${quote(refused)} || sakura_fail '拒绝启动记录无法读取'
    [ "$sakura_version" = 2 ] && [ "$sakura_boot" = "$(cat /proc/sys/kernel/random/boot_id)" ] &&
      [ "$sakura_scope" = ${quote(scopeName)} ] && [ -z "$sakura_extra" ] &&
      [ ! -e ${quote(scope)} ] && [ ! -L ${quote(scope)} ] || sakura_fail '拒绝启动记录无法核对'
    exit 0
  fi
  sakura_fail '任务归属尚未登记；启动已撤销，清理未确认'
}
read -r sakura_version sakura_boot sakura_scope sakura_scope_inode sakura_extra < ${quote(ownership)} || sakura_fail '任务 cgroup 归属记录无法读取'
[ "$sakura_version" = 2 ] && [ "$sakura_scope" = ${quote(scopeName)} ] && [ -z "$sakura_extra" ] && [ "\${#sakura_boot}" -eq 36 ] || sakura_fail '任务 cgroup 归属记录无效'
case "$sakura_boot" in *[!0-9a-f-]*) sakura_fail '任务启动身份无效';; esac
case "$sakura_scope_inode" in ''|*[!0-9]*) sakura_fail '任务 cgroup 身份无效';; esac
sakura_same_boot() { [ "$(cat /proc/sys/kernel/random/boot_id)" = "$sakura_boot" ]; }
sakura_same_boot || sakura_fail '客户机启动身份已改变；拒绝终止过期任务域'
# rmdir cannot remove a populated cgroup. Its absence after an interrupted
# cleanup therefore confirms the original scope ended; never adopt a new inode.
if [ ! -e ${quote(scope)} ] && [ ! -L ${quote(scope)} ]; then exit 0; fi
sakura_cgroup2 && [ ! -L ${quote(scope)} ] || sakura_fail '任务 cgroup 挂载无法核对'
exec 8< ${quote(scope)}
[ "$(sakura_inode /proc/self/fd/8)" = "$sakura_scope_inode" ] || sakura_fail '任务 cgroup inode 已改变；拒绝终止其他任务域'
sakura_leader=; sakura_anchor=
if [ -f ${quote(receipt)} ]; then
  read -r sakura_ready_version sakura_ready_boot sakura_leader sakura_leader_start sakura_anchor sakura_anchor_start sakura_ready_scope sakura_ready_inode sakura_extra < ${quote(receipt)} || sakura_fail '任务就绪归属记录无法读取'
  [ "$sakura_ready_version" = 2 ] && [ "$sakura_ready_boot" = "$sakura_boot" ] &&
    [ "$sakura_ready_scope" = "$sakura_scope" ] && [ "$sakura_ready_inode" = "$sakura_scope_inode" ] &&
    [ -z "$sakura_extra" ] || sakura_fail '任务就绪归属记录与 cgroup 不一致'
  for sakura_number in "$sakura_leader" "$sakura_leader_start" "$sakura_anchor" "$sakura_anchor_start"; do
    case "$sakura_number" in ''|*[!0-9]*) sakura_fail '任务进程身份无效';; esac
  done
  [ "$sakura_leader" -gt 1 ] && [ "$sakura_anchor" -gt 1 ] || sakura_fail '任务进程身份无效'
fi
sakura_owned_anchor() {
  [ -n "$sakura_anchor" ] &&
  sakura_same_boot && sakura_stat /proc/"$sakura_anchor"/stat &&
    [ "$sakura_start" = "$sakura_anchor_start" ] && [ "$sakura_group" = "$sakura_leader" ] &&
    [ "$sakura_session" = "$sakura_leader" ] && [ "$sakura_state" != Z ] && [ "$sakura_state" != X ] &&
    grep -qx ${quote('0::/' + scopeName)} /proc/"$sakura_anchor"/cgroup
}
if sakura_owned_anchor; then
  sakura_control_task
  printf '%s %s %s %s %s %s %s %s\\n' 2 "$sakura_boot" "$sakura_leader" "$sakura_leader_start" "$sakura_anchor" "$sakura_anchor_start" "$sakura_scope" "$sakura_scope_inode" > ${quote(stop + '.tmp')}
  mv ${quote(stop + '.tmp')} ${quote(stop)}
fi
sakura_waits=0
while ! sakura_empty && [ "$sakura_waits" -lt 15 ]; do
  sakura_waits=$((sakura_waits + 1)); sleep 0.1
done
sakura_same_boot && [ "$(sakura_inode /proc/self/fd/8)" = "$sakura_scope_inode" ] || sakura_fail '任务 cgroup 身份已改变；清理未确认'
if ! sakura_empty; then
  exec 9> /proc/self/fd/8/cgroup.kill
  printf 1 >&9
fi
sakura_waits=0
while ! sakura_empty && [ "$sakura_waits" -lt 20 ]; do
  sakura_waits=$((sakura_waits + 1)); sleep 0.1
done
sakura_same_boot || sakura_fail '客户机启动身份已改变；清理未确认'
if ! sakura_empty; then sakura_fail '任务 cgroup 仍有运行进程，保留归属记录'; fi
[ "$(sakura_inode ${quote(scope)})" = "$sakura_scope_inode" ] || sakura_fail '任务 cgroup 路径已改变；清理未确认'
# Remove the empty scope before afterCleanup or retiring the cancellation
# marker. A delayed bootstrap can no longer enter it and run project code.
rmdir ${quote(scope)} || sakura_fail '任务 cgroup 无法核销，保留取消标记和归属记录'`);
  const confirmStopped = rootCommand('CONFIRM_STOPPED', `set -eu
${controlFields}
sakura_control_task
if [ -f ${quote(ownership)} ]; then
  read -r sakura_version sakura_boot sakura_scope sakura_scope_inode sakura_extra < ${quote(ownership)}
  case "$sakura_scope_inode" in ''|*[!0-9]*) echo '任务 cgroup 身份无效' >&2; exit 1;; esac
elif [ -f ${quote(refused)} ]; then
  read -r sakura_version sakura_boot sakura_scope sakura_extra < ${quote(refused)}
else echo '任务停止归属记录已丢失' >&2; exit 1; fi
[ "$sakura_version" = 2 ] && [ "$sakura_scope" = ${quote(scopeName)} ] && [ -z "$sakura_extra" ] &&
  [ "$sakura_boot" = "$(cat /proc/sys/kernel/random/boot_id)" ] &&
  [ ! -e ${quote(scope)} ] && [ ! -L ${quote(scope)} ] || {
  echo '客户机启动身份或任务域停止状态已改变；后续清理未确认' >&2; exit 1;
}`);
  // Only retire after the host received verified cleanup and the stage callback
  // completed. A lost cleanup reply leaves the receipt available for a retry.
  const retire = rootCommand('RETIRE', `set -eu
${controlFields}
sakura_control_base existing
[ ! -e ${quote(scope)} ] && [ ! -L ${quote(scope)} ] || sakura_control_fail '任务域未停止，拒绝核销控制记录'
if [ ! -e ${quote(directory)} ] && [ ! -L ${quote(directory)} ]; then exit 0; fi
sakura_control_directory ${quote(directory)} private
if [ ! -e ${quote(owner)} ] && [ ! -L ${quote(owner)} ]; then
  # Only an already empty private directory can resume an interrupted rmdir.
  [ -z "$(ls -A ${quote(directory)})" ] || sakura_control_fail '授权记录缺失且控制目录非空'
  rmdir ${quote(directory)}
  exit 0
fi
sakura_control_task
rm -f ${[receipt, receipt + '.tmp', ownership, ownership + '.tmp', refused, refused + '.tmp', status, status + '.tmp', cancel, stop, stop + '.tmp'].map(quote).join(' ')}
rm -f ${quote(owner)}
rmdir ${quote(directory)}`);
  return { run, cleanup, confirmStopped, retire };
}

// A dedicated cgroup owns descendants even after they create new groups or
// sessions. Cleanup uses independent, bounded control connections and refuses
// unsupported guests before executing any project code.
export async function guestTask(
  machines: Machines,
  id: string,
  script: string,
  signal: AbortSignal,
  log?: (text: string) => void,
  timeout = 1200000,
  agentPath?: string | BaseAgent,
  afterCleanup?: () => Promise<void>,
  options: { input?: Buffer; runId?: string; forwardedAgent?: true } = {},
) {
  if (options.input !== undefined && (!Buffer.isBuffer(options.input) || options.input.length > 128 * 1024))
    throw new AppError('命令输入超过 128 KiB 或类型无效', 413, 'GUEST_INPUT_INVALID');
  const input = options.input === undefined ? undefined : Buffer.from(options.input);
  const instance = machines.live.get(id);
  const runId = options.runId ? z.uuid().parse(options.runId) : randomUUID(),
    { receipt } = guestTaskControlPaths(runId);
  if (options.forwardedAgent && (input === undefined || !options.runId ||
      !isOwnedTaskAgent(machines, id, runId, agentPath)))
    throw new AppError('SSH Agent 必须属于本次已登记的受保护任务', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
  const commands = taskCommands(runId, randomUUID(), script, timeout, input !== undefined, options.forwardedAgent);
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
            throw new Error(result.stderr.trim() || result.stdout.trim() || '任务 cgroup 清理失败');
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
    throw new AppError(message, 503, failure instanceof AppError && failure.code === 'PROJECT_IDENTITY_CLEANUP_FAILED'
      ? failure.code : 'GUEST_TASK_CLEANUP_FAILED');
  };
  try {
    // BusyBox setsid can fork and return 0 before its child exits. The actual
    // worker status remains explicit and independent of the launcher PID.
    const result = input === undefined
      ? await machines.exec(id, commands.run, timeout, signal, log, agentPath)
      : await machines.execInput(id, commands.run, input, timeout, signal, log, agentPath);
    if (result.code === 126 && result.stderr.includes('SAKURA_TASK_SCOPE_UNAVAILABLE:'))
      throw new AppError(result.stderr.trim(), 409, 'GUEST_TASK_SCOPE_UNAVAILABLE');
    return result;
  } finally {
    if (instance) {
      await control(commands.cleanup, '清理');
      if (machines.live.get(id) !== instance)
        throw new AppError('客户机实例已改变，原任务清理未确认', 503, 'GUEST_TASK_CLEANUP_FAILED');
      if (afterCleanup)
        await control(async () => {
          // A guest reboot can retain the host's Live object. Each callback
          // attempt also checks the original guest boot and the removed scope.
          const confirmed = await machines.exec(id, commands.confirmStopped, 5000);
          if (confirmed.code !== 0) throw new Error(confirmed.stderr.trim() || '任务停止身份未确认');
          if (machines.live.get(id) !== instance) throw new Error('客户机实例已改变');
          await afterCleanup();
        }, '后续清理');
      await control(commands.retire, '归属核销');
    }
  }
}
