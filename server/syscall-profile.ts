import { z } from 'zod';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import type { Machines } from './machines.ts';

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
    pid = os.fork()
    if pid == 0:
        try:
            os.setsid()
            apply(profile)
            os.execvp(argv[0], argv)
        except BaseException as error:
            print('seccomp launch failed: ' + str(error), file=sys.stderr)
            os._exit(126)
    def stop(_number, _frame):
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
        raise SystemExit(128 + _number)
    for name in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(name, stop)
    deadline = time.monotonic() + seconds
    while True:
        done, result = os.waitpid(pid, os.WNOHANG)
        if done:
            return os.waitstatus_to_exitcode(result)
        if time.monotonic() >= deadline:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(pid, 0)
            print('seccomp command timed out', file=sys.stderr)
            return 124
        time.sleep(0.05)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--self-test':
        self_test(sys.argv[2])
    elif len(sys.argv) >= 5 and sys.argv[1] == '--run' and sys.argv[4] == '--':
        sys.exit(run(sys.argv[2], int(sys.argv[3]), sys.argv[5:]))
    else:
        raise SystemExit('usage: sakura-seccomp --self-test PROFILE | --run PROFILE SECONDS -- COMMAND [ARGS]')
`;

const helperPath = '/usr/local/lib/sakura/seccomp-run.py';
const probe = `test -r ${helperPath} && python3 ${helperPath} --self-test restricted && python3 ${helperPath} --self-test networkless`;

export async function checkSyscallProfile(machines: Machines, id: string,
  signal?: AbortSignal) {
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, reason: '请先启动实例。' };
  const result = await machines.exec(id, probe, 15000, signal);
  return { ready: result.code === 0, executed: false,
    profiles: ['restricted', 'networkless'],
    reason: result.code === 0 ? '客户机 seccomp 过滤器与网络禁用策略均已实测生效。' :
      '客户机 seccomp 执行器未就绪；请运行 install 安装 Python 与 libseccomp。',
    ...(result.code === 0 ? {} : { diagnostic: result.stderr.slice(-1000) }) };
}

export async function runSyscallProfile(machines: Machines, id: string,
  input: unknown, signal?: AbortSignal) {
  const options = syscallProfileInput.parse(input);
  if (options.mode === 'status') {
    const status = await checkSyscallProfile(machines, id, signal);
    return { code: status.ready ? 0 : 1, ...status };
  }
  machines.requireUnlocked(id);
  if (machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
  if (options.mode === 'install') {
    const install = await machines.exec(id,
      'set -e\nif command -v apk >/dev/null; then apk add --no-cache python3 py3-libseccomp; elif command -v apt-get >/dev/null; then apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-seccomp; else exit 1; fi\ninstall -d -m 755 /usr/local/lib/sakura',
      300000, signal);
    if (install.code !== 0) throw new AppError('安装 seccomp 依赖失败：' + install.stderr.slice(-1000), 409);
    await machines.writeGuestFile(id, helperPath, helper);
    const permissions = await machines.exec(id, `chmod 755 ${helperPath}`, 10000, signal);
    if (permissions.code !== 0) throw new AppError('设置 seccomp 执行器权限失败', 409);
    const checked = await checkSyscallProfile(machines, id, signal);
    if (!checked.ready) throw new AppError('seccomp 安装后验证失败：' +
      ('diagnostic' in checked ? checked.diagnostic || '' : checked.reason), 409);
    return { code: 0, ...checked, executed: true };
  }
  if (!options.confirmed || !options.command)
    throw new AppError('运行受限命令需要 command 与 confirmed=true', 400);
  const checked = await checkSyscallProfile(machines, id, signal);
  if (!checked.ready) throw new AppError(checked.reason, 409);
  const args = [options.profile, String(options.timeoutSeconds), '--',
    options.command, ...options.args].map(quote).join(' ');
  const result = await machines.exec(id, `python3 ${helperPath} --run ${args}`,
    (options.timeoutSeconds + 15) * 1000, signal);
  return { code: result.code, ready: result.code === 0, executed: true,
    profile: options.profile, stdout: result.stdout, stderr: result.stderr,
    timedOut: result.code === 124 };
}
