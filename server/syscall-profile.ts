import { z } from 'zod';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import type { Machines } from './machines.ts';
import { Workspaces } from './workspaces.ts';
import { SyscallProjectTasks, type SyscallProjectTaskOptions } from './syscall-project-task.ts';
import { createHash } from 'node:crypto';

export const syscallProfileInput = z.object({
  mode: z.enum(['status', 'install', 'run']).default('status'),
  profile: z.enum(['restricted', 'networkless']).default('restricted'),
  command: z.string().min(1).max(512).optional(),
  args: z.array(z.string().max(4096)).max(32).default([]),
  confirmed: z.boolean().default(false),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
}).strict();

const helper = String.raw`#!/usr/bin/env python3
import ctypes
import errno
import json
import os
import signal
import socket
import sys
import time

import seccomp

ADMIN = (
    'mount', 'umount2', 'pivot_root', 'ptrace', 'bpf', 'keyctl',
    'add_key', 'request_key', 'init_module', 'finit_module',
    'delete_module', 'kexec_load', 'kexec_file_load', 'reboot',
    'swapon', 'swapoff', 'setns', 'unshare', 'userfaultfd',
    'perf_event_open', 'open_by_handle_at', 'name_to_handle_at',
    'iopl', 'ioperm', 'acct', 'syslog', 'clone3',
    'io_uring_setup', 'io_uring_enter', 'io_uring_register',
)
NETWORK = (
    'socket', 'socketpair', 'connect', 'bind', 'listen',
    'accept', 'accept4', 'sendto', 'recvfrom', 'sendmsg', 'recvmsg',
)
CLONE_NAMESPACE_FLAGS = (
    0x00020000, 0x02000000, 0x04000000, 0x08000000,
    0x10000000, 0x20000000, 0x40000000,
)


def status():
    fields = {}
    with open('/proc/self/status', encoding='ascii') as source:
        for line in source:
            if line.startswith(('Seccomp:', 'Seccomp_filters:', 'NoNewPrivs:')):
                name, value = line.split(':', 1)
                fields[name] = int(value.strip())
    return fields


def apply(profile):
    if profile not in ('restricted', 'networkless'):
        raise ValueError('unknown syscall profile')
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'PR_SET_NO_NEW_PRIVS failed')
    filt = seccomp.SyscallFilter(defaction=seccomp.ALLOW)
    deny = seccomp.ERRNO(errno.EPERM)
    names = ADMIN + (NETWORK if profile == 'networkless' else ())
    for name in names:
        if seccomp.resolve_syscall(seccomp.Arch.NATIVE, name) < 0:
            raise RuntimeError('unsupported syscall in policy: ' + name)
        filt.add_rule(deny, name)
    for flag in CLONE_NAMESPACE_FLAGS:
        filt.add_rule(deny, 'clone',
                      seccomp.Arg(0, seccomp.MASKED_EQ, flag, flag))
    filt.set_attr(seccomp.Attr.CTL_NNP, 1)
    filt.load()


def self_test(profile):
    before = status()
    apply(profile)
    after = status()
    if after.get('Seccomp') != 2 or after.get('NoNewPrivs') != 1:
        raise RuntimeError('seccomp or no_new_privs is not active')
    if ('Seccomp_filters' in before and 'Seccomp_filters' in after
            and after['Seccomp_filters'] <= before['Seccomp_filters']):
        raise RuntimeError('no new seccomp filter was loaded')
    try:
        connection = socket.socket()
    except OSError as error:
        if profile != 'networkless' or error.errno != errno.EPERM:
            raise
    else:
        connection.close()
        if profile == 'networkless':
            raise RuntimeError('network socket was not denied')
    print(json.dumps({'profile': profile, 'seccomp': after['Seccomp'],
                      'noNewPrivs': after['NoNewPrivs'],
                      'networkDenied': profile == 'networkless'}))


def run(profile, seconds, argv):
    if not argv:
        raise ValueError('command required')
    signals = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)
    blocked = signal.pthread_sigmask(signal.SIG_BLOCK, signals)
    try:
        pid = os.fork()
    except BaseException:
        signal.pthread_sigmask(signal.SIG_SETMASK, blocked)
        raise
    if pid == 0:
        try:
            for number in signals:
                signal.signal(number, signal.SIG_DFL)
            os.setsid()
            signal.pthread_sigmask(signal.SIG_SETMASK, blocked)
            apply(profile)
            os.execvp(argv[0], argv)
        except BaseException as error:
            print('seccomp launch failed: ' + str(error), file=sys.stderr)
            os._exit(126)
    reaped = False
    def kill_group():
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            # A signal can arrive before the child has called setsid().
            if not reaped:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
    def stop(number, _frame):
        signal.pthread_sigmask(signal.SIG_BLOCK, signals)
        raise SystemExit(128 + number)
    for number in signals:
        signal.signal(number, stop)
    try:
        signal.pthread_sigmask(signal.SIG_SETMASK, blocked)
        deadline = time.monotonic() + seconds
        while True:
            done, result = os.waitpid(pid, os.WNOHANG)
            if done:
                reaped = True
                code = os.waitstatus_to_exitcode(result)
                return code if code >= 0 else 128 - code
            if time.monotonic() >= deadline:
                print('seccomp command timed out', file=sys.stderr)
                return 124
            time.sleep(0.05)
    finally:
        signal.pthread_sigmask(signal.SIG_BLOCK, signals)
        # Also stop background descendants when the selected command exits.
        kill_group()
        if not reaped:
            os.waitpid(pid, 0)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--self-test':
        self_test(sys.argv[2])
    elif len(sys.argv) >= 5 and sys.argv[1] == '--run' and sys.argv[4] == '--':
        sys.exit(run(sys.argv[2], int(sys.argv[3]), sys.argv[5:]))
    else:
        raise SystemExit('usage: sakura-seccomp --self-test PROFILE | --run PROFILE SECONDS -- COMMAND [ARGS]')
`;

const helperPath = '/usr/local/lib/sakura/seccomp-run.py';
const helperSha256 = createHash('sha256').update(helper).digest('hex');
const systemCommand = (body: string) =>
  '/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -c ' + quote('cd /\nset -eu\n' + body);
const systemDirectory = `import os,stat
def open_system_directory():
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  for name in ('','usr','local','lib','sakura'):
   if name:
    next_fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
    os.close(fd)
    fd=next_fd
   s=os.fstat(fd)
   if s.st_uid!=0 or s.st_gid!=0 or stat.S_IMODE(s.st_mode)&0o022:
    raise RuntimeError('seccomp system directory ownership or mode changed')
  return fd
 except BaseException:
  os.close(fd)
  raise
`;
// Inspect the installed file without executing it as administrator. The self
// tests below interpret only the trusted built-in source in isolated Python.
const verifyHelper = systemDirectory + `import hashlib
parent=open_system_directory()
try:
 fd=os.open('seccomp-run.py',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
finally:
 os.close(parent)
try:
 s=os.fstat(fd)
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_gid!=0 or stat.S_IMODE(s.st_mode)!=0o755 or s.st_nlink!=1:
  raise RuntimeError('seccomp helper ownership or mode changed')
 b=os.read(fd,${Buffer.byteLength(helper) + 1})
 if len(b)!=${Buffer.byteLength(helper)} or hashlib.sha256(b).hexdigest()!=${JSON.stringify(helperSha256)}:
  raise RuntimeError('seccomp helper content changed')
finally:
 os.close(fd)
`;
const fixedPython = '/usr/bin/python3 -I -c ' + quote(helper);
const probe = systemCommand('/usr/bin/python3 -I -S -c ' + quote(verifyHelper) + '\n' +
  fixedPython + ' --self-test restricted\n' + fixedPython + ' --self-test networkless');
const changed = () => new AppError('受限命令原客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');

export async function checkSyscallProfile(machines: Machines, id: string,
  signal?: AbortSignal) {
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, reason: '请先启动实例。' };
  const live = machines.live.get(id);
  if (!live) throw changed();
  signal?.throwIfAborted();
  const result = await machines.exec(id, probe, 15000, signal);
  signal?.throwIfAborted();
  if (machines.live.get(id) !== live || machines.state(id) !== 'running') throw changed();
  return { ready: result.code === 0, executed: false,
    profiles: ['restricted', 'networkless'],
    reason: result.code === 0 ? '客户机 seccomp 过滤器与网络禁用策略均已实测生效。' :
      '客户机 seccomp 执行器未就绪；请运行 install 安装 Python 与 libseccomp。',
    ...(result.code === 0 ? {} : { diagnostic: result.stderr.slice(-1000) }) };
}

export async function runSyscallProfile(machines: Machines, id: string,
  input: unknown, signal?: AbortSignal, workspaces?: Workspaces, taskOptions: SyscallProjectTaskOptions = {}) {
  const options = syscallProfileInput.parse(input);
  if (options.mode === 'status') {
    const status = await checkSyscallProfile(machines, id, signal);
    return { code: status.ready ? 0 : 1, ...status };
  }
  machines.requireUnlocked(id);
  if (machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
  if (options.mode === 'install') {
    const live = machines.live.get(id);
    const assertOrigin = () => {
      signal?.throwIfAborted();
      if (!live || machines.live.get(id) !== live || machines.state(id) !== 'running') throw changed();
    };
    assertOrigin();
    const install = await machines.exec(id, systemCommand(
      'if command -v apk >/dev/null; then apk add --no-cache python3 py3-libseccomp; elif command -v apt-get >/dev/null; then apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-seccomp; else exit 1; fi\ninstall -d -m 755 /usr/local/lib/sakura'),
      300000, signal);
    assertOrigin();
    if (install.code !== 0) throw new AppError('安装 seccomp 依赖失败：' + install.stderr.slice(-1000), 409);
    const parent = await machines.exec(id, systemCommand('# SAKURA_SECCOMP_PARENT_CHECK\n/usr/bin/python3 -I -S -c ' +
      quote(systemDirectory + 'parent=open_system_directory()\nos.close(parent)\n')), 10000, signal);
    assertOrigin();
    if (parent.code !== 0) throw new AppError('seccomp 系统目录归属或权限无法核对', 409, 'SYSCALL_SYSTEM_DIRECTORY_INVALID');
    await machines.writeGuestFile(id, helperPath, helper);
    assertOrigin();
    const permissions = await machines.exec(id, systemCommand('chown 0:0 ' + quote(helperPath) + '\nchmod 755 ' + quote(helperPath)), 10000, signal);
    assertOrigin();
    if (permissions.code !== 0) throw new AppError('设置 seccomp 执行器权限失败', 409);
    const checked = await checkSyscallProfile(machines, id, signal);
    assertOrigin();
    if (!checked.ready) throw new AppError('seccomp 安装后验证失败：' +
      ('diagnostic' in checked ? checked.diagnostic || '' : checked.reason), 409);
    return { code: 0, ...checked, executed: true };
  }
  if (!options.confirmed || !options.command)
    throw new AppError('运行受限命令需要 command 与 confirmed=true', 400);
  const scope = workspaces || new Workspaces(machines);
  const tasks = new SyscallProjectTasks(machines, scope, taskOptions);
  const run = () => tasks.withProject(id, signal, undefined, async () => {
    const project = tasks.project(id);
    const checked = await checkSyscallProfile(machines, id, signal);
    await tasks.assertCurrent(id);
    if (!checked.ready) throw new AppError(checked.reason, 409);
    const args = [options.profile, String(options.timeoutSeconds), '--',
      options.command!, ...options.args].map(quote).join(' ');
    const result = await tasks.exec(id, fixedPython + ' --run ' + args,
      (options.timeoutSeconds + 15) * 1000, signal, project);
    return { code: result.code, stdout: tasks.redact(id, result.stdout), stderr: tasks.redact(id, result.stderr),
      ready: result.code === 0, executed: true, profile: options.profile, timedOut: result.code === 124,
      projectId: project._workspace || 'default', directory: project.directory,
      networkIsolation: project.networkIsolation || 'host' };
  });
  try { return workspaces ? await run() : await scope.projects.with(id, undefined, run); }
  finally {
    try { await tasks.close(); } finally { if (!workspaces) await scope.close(); }
  }
}
