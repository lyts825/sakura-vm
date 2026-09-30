import { quote } from './files.ts';

// Account names are never recycled: data left by an old window cannot become
// readable by a new window that happens to receive the same Unix identity.
export function appIdentity(id: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
    throw new Error('Invalid application session ID');
  const user = `skapp${id.replaceAll('-', '').slice(0, 24)}`;
  return { user, home: `/home/${user}`, marker: `/var/lib/sakura/single-apps/${id}` };
}

export function appIdentityScript(id: string, alpine: boolean) {
  const { user, home, marker } = appIdentity(id);
  const create = alpine
    ? `adduser -D -h ${home} -s /bin/sh ${user}`
    : `useradd -m -d ${home} -s /bin/sh ${user}`;
  return `set -eu
test ! -e ${home} && test ! -L ${home}
! id ${user} >/dev/null 2>&1
mkdir -p /var/lib/sakura/single-apps
test ! -e ${marker} && test ! -L ${marker}
${create}
chmod 700 ${home}
uid=$(id -u ${user})
test "$uid" -ge 1000
umask 077
printf '%s\\n' "$uid" > ${marker}
password=$(head -c 6 /dev/urandom | base64)
password_binary=$(command -v vncpasswd || command -v tigervncpasswd)
printf '%s\\n' "$password" | "$password_binary" -f > ${home}/.sakura-vnc-password
chown "$uid" ${home}/.sakura-vnc-password
chmod 600 ${home}/.sakura-vnc-password
printf '%s\\n' "$uid" "$password"`;
}

export function appIdentityCheck(id: string, uid: number) {
  if (!Number.isSafeInteger(uid) || uid < 1000) throw new Error('Invalid application UID');
  const { user, marker } = appIdentity(id);
  return `test -f ${marker} && test ! -L ${marker}
test "$(stat -c %u ${marker})" = 0
test "$(cat ${marker})" = ${uid}
test "$(id -u ${user})" = ${uid}`;
}

export function appCleanupScript(id: string, uid: number) {
  return `${appIdentityCheck(id, uid)} || exit 1\n${uidCleanupScript(uid)}`;
}

/** Stop an existing account's processes without racing PID reuse. */
export function uidCleanupScript(uid: number, environment?: 'SAKURA_DESKTOP_UID') {
  if (!Number.isSafeInteger(uid) || uid < 1000) throw new Error('Invalid application UID');
  const script = `import os,signal,time
uid=${environment ? `int(os.environ[${JSON.stringify(environment)}])` : uid}
if uid<1000: raise RuntimeError('Unsafe application UID')
def processes():
  for name in os.listdir('/proc'):
    if not name.isdigit(): continue
    try:
      if os.stat('/proc/'+name).st_uid==uid: yield int(name)
    except FileNotFoundError: pass
def stop(sig):
  for pid in processes():
    fd=None
    try:
      fd=os.pidfd_open(pid)
      if os.stat('/proc/'+str(pid)).st_uid==uid:
        signal.pidfd_send_signal(fd,sig)
    except ProcessLookupError: pass
    except FileNotFoundError: pass
    finally:
      if fd is not None: os.close(fd)
stop(signal.SIGTERM)
started=time.monotonic()
while any(processes()):
  if time.monotonic()-started>5: raise RuntimeError('Application processes did not exit')
  if time.monotonic()-started>0.5: stop(signal.SIGKILL)
  time.sleep(0.1)`;
  return `python3 -I -S -c ${quote(script)}`;
}

export function appSupervisedCommand(id: string, uid: number, command: string, afterCleanup = '') {
  const cleanup = appCleanupScript(id, uid) + '\n' + afterCleanup;
  return `sh -c ${quote(`set -eu\n${appIdentityCheck(id, uid)}\n` +
    `cleanup() { trap - EXIT HUP INT TERM; ${cleanup}\n}\n` +
    `trap cleanup EXIT\ntrap 'exit 129' HUP INT TERM\n${command}\n`)}`;
}

export function appVncFirewallScript(id: string, uid: number, port: number) {
  if (!Number.isInteger(port) || port < 5910 || port > 5917) throw new Error('Invalid application port');
  const { marker } = appIdentity(id);
  const chain = `SAP_${id.replaceAll('-', '').slice(0, 16)}`;
  const owner = quote(`sakura-single-app:${id}`);
  const jump = `-p tcp --dport 5900:5999 -m owner --uid-owner ${uid} -m comment --comment ${owner} -j ${chain}`;
  return `set -eu
${appIdentityCheck(id, uid)}
test ! -e ${marker}.firewall
! iptables -w -S ${chain} >/dev/null 2>&1
! ip6tables -w -S ${chain} >/dev/null 2>&1
created4=no; created6=no; attached4=no; attached6=no
rollback() {
  trap - EXIT HUP INT TERM
  test "$attached4" = no || iptables -w -D OUTPUT -d 127.0.0.0/8 ${jump} || true
  test "$attached6" = no || ip6tables -w -D OUTPUT -d ::1/128 ${jump} || true
  if test "$created4" = yes; then iptables -w -F ${chain} || true; iptables -w -X ${chain} || true; fi
  if test "$created6" = yes; then ip6tables -w -F ${chain} || true; ip6tables -w -X ${chain} || true; fi
}
trap rollback EXIT HUP INT TERM
iptables -w -N ${chain}; created4=yes
ip6tables -w -N ${chain}; created6=yes
for family in iptables ip6tables; do
  "$family" -w -A ${chain} -p tcp --dport ${port} -j RETURN
  "$family" -w -A ${chain} -m comment --comment ${owner} -j REJECT
done
iptables -w -I OUTPUT 1 -d 127.0.0.0/8 ${jump}; attached4=yes
ip6tables -w -I OUTPUT 1 -d ::1/128 ${jump}; attached6=yes
umask 077
touch ${marker}.firewall
trap - EXIT HUP INT TERM`;
}

export function appVncFirewallRemoveScript(id: string, uid: number, port: number) {
  if (!Number.isInteger(port) || port < 5910 || port > 5917) throw new Error('Invalid application port');
  const { marker } = appIdentity(id);
  const chain = `SAP_${id.replaceAll('-', '').slice(0, 16)}`;
  const owner = quote(`sakura-single-app:${id}`);
  return `set -eu
${appIdentityCheck(id, uid)}
umask 077
exec 9>${marker}.firewall-lock
flock -x -w 10 9
if test -f ${marker}.firewall && test ! -L ${marker}.firewall &&
    test "$(stat -c %u ${marker}.firewall)" = 0; then
  for family in iptables ip6tables; do
    destination=127.0.0.0/8
    test "$family" = iptables || destination=::1/128
    if ! "$family" -w -S ${chain} >/dev/null 2>&1; then continue; fi
    rules=$("$family" -w -S ${chain})
    test "$(printf '%s\\n' "$rules" | wc -l)" -eq 3
    "$family" -w -C ${chain} -p tcp --dport ${port} -j RETURN
    "$family" -w -C ${chain} -m comment --comment ${owner} -j REJECT
    "$family" -w -D OUTPUT -d "$destination" -p tcp --dport 5900:5999 -m owner --uid-owner ${uid} -m comment --comment ${owner} -j ${chain}
    "$family" -w -F ${chain}
    "$family" -w -X ${chain}
  done
  rm -f ${marker}.firewall
fi`;
}
