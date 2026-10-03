import { quote } from './files.ts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError } from './model.ts';
import { projectIdentitySchema, projectIdentityRunSchema } from './project-identity.ts';
import { singleAppSources } from './single-app-assets.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/), decimal = z.string().regex(/^[0-9]+$/);
export const appOriginSchema = z.object({ identity: projectIdentitySchema, run: projectIdentityRunSchema,
  program: z.string().regex(/^[A-Za-z][A-Za-z0-9+._-]{0,63}$/), args: z.array(z.string().max(256)).max(12),
  resolution: z.enum(['800x600', '1024x768', '1280x800']), clipboard: z.object({ copy: z.boolean(), paste: z.boolean() }).strict(),
  configVersion: digest,
}).strict().superRefine((value, ctx) => {
  if (value.run.mode !== 'independent' || value.identity.phase !== 'active' ||
      (['registryId', 'identityId', 'projectId', 'revision'] as const).some(key => value.identity[key] !== value.run[key]) ||
      value.run.namespace !== (value.identity.networkIsolation === 'private' ? 'sk-' + value.identity.projectId : ''))
    ctx.addIssue({ code: 'custom', message: '单应用原项目与完整运行归属不符' });
});
export type AppOrigin = z.infer<typeof appOriginSchema>;
const image = z.object({ path: z.string().startsWith('/'), device: decimal, inode: decimal, sha256: digest }).strict();
const fixedTool = image.extend({ command: z.string().startsWith('/') }).strict();
export const appDirectoryViewSchema = z.object({ version: z.literal(1), device: decimal, inode: decimal,
  directoryDevice: decimal, directoryInode: decimal, directoryMode: z.number().int().min(0).max(0o7777),
  mountFlags: z.number().int().min(0).max(0xffffffff).refine(value => (value & 6) === 6),
  projectUid: z.number().int().min(20000).max(59999), projectGid: z.number().int().min(20000).max(59999),
  uid: z.number().int().min(1000).max(19999), gid: z.number().int().min(1000).max(19999),
  desktopRunId: z.uuid(), bootId: z.uuid(), route: z.string().startsWith('/').nullable(),
}).strict();
const process = z.object({ pid: z.number().int().positive(), created: decimal, image: z.string().startsWith('/'),
  device: decimal, inode: decimal }).strict();
const supervisor = process;
const endpoint = process.extend({ kernelInode: decimal }).strict();
export const appRetirementSchema = z.object({ reason: z.literal('guest-reboot'), bootId: z.uuid() }).strict();
export const appReceiptSchema = z.object({ version: z.literal(1), id: z.uuid(), build: digest, origin: appOriginSchema,
  identity: projectIdentitySchema, run: projectIdentityRunSchema,
  state: z.enum(['preparing', 'prepared', 'starting', 'running', 'stopping', 'stopped']),
  uid: z.number().int().min(1000).max(19999), gid: z.number().int().min(1000).max(19999), user: z.string(), home: z.string(),
  homeDevice: decimal.nullable(), homeInode: decimal.nullable(), runtime: z.string(),
  runtimeDevice: decimal.nullable(), runtimeInode: decimal.nullable(), password: z.string().regex(/^[A-Za-z0-9+/]{8}$/),
  display: z.number().int().min(10).max(17), port: z.number().int().min(5910).max(5917), image: fixedTool,
  tools: z.object({ group: fixedTool, account: fixedTool, ipv4: fixedTool, ipv6: fixedTool, vnc: fixedTool,
    password: fixedTool, wm: fixedTool, probe: fixedTool }).strict(),
  directoryView: appDirectoryViewSchema.nullable(), supervisor: supervisor.nullable(), endpoint: endpoint.nullable(),
  processes: z.object({ application: process, wm: process }).strict().nullable(),
  retirement: appRetirementSchema.nullable(), firewall: z.enum(['pending', 'active', 'closed']),
}).strict().superRefine((value, ctx) => {
  const identity = appIdentity(value.id), view = value.directoryView;
  if (value.run.runId !== value.id || value.port !== 5900 + value.display || value.gid !== value.uid ||
      value.user !== identity.user || value.home !== identity.home || value.runtime !== '/run/sakura-single-app-uid/' + value.id ||
      JSON.stringify(value.identity) !== JSON.stringify(value.origin.identity) || JSON.stringify(value.run) !== JSON.stringify(value.origin.run) ||
      Boolean(value.homeDevice) !== Boolean(value.homeInode) || Boolean(value.runtimeDevice) !== Boolean(value.runtimeInode) ||
      (view && (view.uid !== value.uid || view.gid !== value.gid || view.projectUid !== value.identity.uid || view.projectGid !== value.identity.gid ||
        view.desktopRunId !== value.run.runId || view.bootId !== value.run.bootId || view.directoryDevice !== value.identity.directoryDevice ||
        view.directoryInode !== value.identity.directoryInode)) ||
      (value.state === 'running' && (!view || !value.supervisor || !value.endpoint || !value.processes || value.firewall !== 'active')) ||
      (value.retirement && (value.state !== 'stopped' || value.retirement.bootId === value.run.bootId)))
    ctx.addIssue({ code: 'custom', message: '单应用 UID、目录视图或完整回执不符' });
});
export type AppReceipt = z.infer<typeof appReceiptSchema>;
export const appStatusSchema = z.object({ state: z.enum(['running', 'starting', 'exited', 'stopped']),
  receipt: appReceiptSchema, endpoint: endpoint.nullable(), bootId: z.uuid() }).strict();
export const appStopSchema = z.object({ receipt: appReceiptSchema.nullable(), run: projectIdentityRunSchema,
  retirement: appRetirementSchema.nullable() }).strict();
export const appAbsenceSchema = z.object({ version: z.literal(1), id: z.uuid(), bootId: z.uuid(), nativeBuild: digest,
  currentBootId: z.uuid(), ticketAbsent: z.literal(true), cgroupAbsent: z.literal(true), guestReceiptAbsent: z.literal(true),
  runtimeAbsent: z.literal(true) }).strict();
export const appRecoverySchema = z.object({ run: projectIdentityRunSchema.nullable(), absence: appAbsenceSchema.nullable() }).strict()
  .refine(value => Boolean(value.run) !== Boolean(value.absence));

/** Canonical receipt hash only; the stream argv contains no app body or secrets. */
export function appOriginHash(origin: AppOrigin) {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort((value as Record<string, unknown>)[key])])) : value;
  // Match Python ensure_ascii=True, including surrogate pairs in literal args.
  const canonical = JSON.stringify(sort(appOriginSchema.parse(origin))).replace(/[\u007f-\uffff]/g,
    character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
  return createHash('sha256').update(canonical).digest('hex');
}

export class SingleAppControl {
  constructor(private machines: Machines, private options: { sourceDirectory?: string } = {}) {}
  async install(id: string, signal?: AbortSignal) {
    const bundle = await singleAppSources(this.options.sourceDirectory), distro = this.machines.get(id).distro || 'alpine';
    const packages = distro === 'alpine'
      ? 'apk add --no-cache --timeout 30 tigervnc openbox xdpyinfo xterm font-dejavu iptables util-linux python3 shadow'
      : 'export DEBIAN_FRONTEND=noninteractive; apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update && ' +
        'apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y --no-install-recommends ' +
        'tigervnc-standalone-server tigervnc-tools openbox x11-utils xterm fonts-dejavu-core iptables util-linux python3 passwd';
    const installed = await this.machines.exec(id, `set -eu\n` +
      `if ! (command -v Xvnc >/dev/null || command -v Xtigervnc >/dev/null) || ! command -v openbox >/dev/null || ` +
      `! command -v xdpyinfo >/dev/null || ! command -v iptables >/dev/null || ! command -v ip6tables >/dev/null || ` +
      `! command -v useradd >/dev/null || ! command -v groupadd >/dev/null || ! command -v python3 >/dev/null || ` +
      `! (command -v vncpasswd >/dev/null || command -v tigervncpasswd >/dev/null); then ${packages}; fi\n` +
      `python3 -I -S -c ${quote("import pathlib,os,stat; p=pathlib.Path('/usr/local/lib/sakura-single-app'); p.mkdir(mode=0o755,exist_ok=True);\nfor q in [p,*p.parents]:\n s=q.lstat(); assert stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022")}`,
      240000, signal);
    if (installed.code !== 0) throw new AppError('单应用图形环境或受控源码目录准备失败', 409, 'SINGLE_APP_INSTALL_FAILED');
    // Each build is immutable and content-addressed. Old guest builds remain
    // available for cleanup of persisted old receipts after a host upgrade.
    const staging = bundle.directory + '.new';
    const stageCheck = `import pathlib,stat,sys\np=pathlib.Path(sys.argv[1]); p.mkdir(mode=0o700,exist_ok=True); s=p.lstat(); ` +
      `assert stat.S_ISDIR(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o700\n` +
      `for f in p.iterdir():\n s=f.lstat(); assert f.name in ['controller.py','directory-view.py','sources.json','manifest.json'] and stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022 and s.st_nlink==1`;
    const created = await this.machines.exec(id, `python3 -I -S -c ${quote(stageCheck)} ${quote(staging)}`,
      10000, signal);
    if (created.code !== 0) throw new AppError('单应用源码暂存尚未完成，请保留并核对原暂存', 409, 'SINGLE_APP_INSTALL_PENDING');
    for (const [name, raw] of bundle.files) {
      signal?.throwIfAborted();
      await this.machines.writeGuestFile(id, staging + '/' + name, raw.toString('utf8'));
      signal?.throwIfAborted();
    }
    await this.machines.writeGuestFile(id, staging + '/manifest.json', JSON.stringify(bundle.manifest));
    signal?.throwIfAborted();
    const verifier = `import hashlib,json,os,pathlib,stat,sys\np=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2]); expected=sys.argv[3]\n` +
      `def verify(folder):\n s=folder.lstat(); assert stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022; h=hashlib.sha256(); m=json.loads((folder/'manifest.json').read_text()); assert m['build']==expected and m['version']==1 and [e['name'] for e in m['files']]==['controller.py','directory-view.py','sources.json']\n` +
      ` for entry in m['files']:\n  f=folder/entry['name']; s=f.lstat(); assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022 and s.st_nlink==1; b=f.read_bytes(); assert len(b)==entry['size'] and hashlib.sha256(b).hexdigest()==entry['sha256']; h.update(entry['name'].encode()); h.update(b)\n` +
      ` assert h.hexdigest()==expected\nverify(p)\n` +
      `if target.exists():\n verify(target)\n for f in p.iterdir(): f.unlink()\n p.rmdir()\nelse: os.chmod(p,0o755); os.rename(p,target)\n`;
    const committed = await this.machines.exec(id, `python3 -I -S -c ${quote(verifier)} ${quote(staging)} ${quote(bundle.directory)} ${quote(bundle.manifest.build)}`,
      20000, signal);
    if (committed.code !== 0) throw new AppError('单应用固定源码提交未确认', 409, 'SINGLE_APP_SOURCE_CHANGED');
    return bundle.manifest.build;
  }
  command(build: string, action: 'prepare' | 'start' | 'status' | 'stop' | 'recover' | 'prepare-run') {
    digest.parse(build);
    return `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S ` +
      quote('/usr/local/lib/sakura-single-app/' + build + '/controller.py') + ' ' + action;
  }
  async call(id: string, build: string, action: 'prepare' | 'start' | 'status' | 'stop',
    origin: AppOrigin, environment?: Record<string, string>, signal?: AbortSignal) {
    origin = appOriginSchema.parse(origin);
    const input = Buffer.from(JSON.stringify({ id: origin.run.runId, origin, ...(action === 'start' ? { environment: environment || {} } : {}) }));
    if (input.length > 65536) throw new AppError('单应用输入超过传输边界', 413, 'SINGLE_APP_REQUEST_TOO_LARGE');
    const response = await this.machines.execInput(id, this.command(build, action), input, action === 'start' ? 45000 : 40000, signal);
    let reply: { ok?: boolean; code?: string; result?: unknown };
    try { reply = JSON.parse(response.stdout); }
    catch { throw new AppError('单应用控制应答未确认，原运行票据已保留', 503, 'SINGLE_APP_CONTROL_UNCONFIRMED'); }
    if (response.code !== 0 || reply.ok !== true) {
      const code = typeof reply.code === 'string' && /^(SINGLE_APP_|PROJECT_IDENTITY_)[A-Z0-9_]+$/.test(reply.code)
        ? reply.code : 'SINGLE_APP_CONTROL_FAILED';
      throw new AppError(code === 'SINGLE_APP_DIRECTORY_VIEW_UNAVAILABLE'
        ? '内核或文件系统不支持此项目的独立目录视图，请保留原目录并核对支持情况'
        : '单应用原账号、运行或资源核对未通过：' + code, action === 'stop' ? 503 : 409, code);
    }
    return reply.result;
  }
  async recover(id: string, build: string, request: { id: string; identity: z.infer<typeof projectIdentitySchema>; bootId: string; nativeBuild: string }) {
    const response = await this.machines.execInput(id, this.command(build, 'recover'), Buffer.from(JSON.stringify(request)), 40000);
    const parsed = z.object({ ok: z.literal(true), result: appRecoverySchema }).strict().safeParse(
      (() => { try { return JSON.parse(response.stdout); } catch { return null; } })());
    if (response.code !== 0 || !parsed.success)
      throw new AppError('单应用原准备意图无法只读核销；未知原域或资源已保留', 503, 'SINGLE_APP_INTENT_CLEANUP_UNCONFIRMED');
    return parsed.data.result;
  }
  async prepareRun(id: string, build: string, raw: { id: string; identity: z.infer<typeof projectIdentitySchema>; bootId: string; nativeBuild: string }, signal?: AbortSignal) {
    const request = z.object({ id: z.uuid(), identity: projectIdentitySchema, bootId: z.uuid(), nativeBuild: digest }).strict().parse(raw);
    const response = await this.machines.execInput(id, this.command(build, 'prepare-run'), Buffer.from(JSON.stringify(request)), 180000, signal);
    const parsed = z.object({ ok: z.literal(true), result: projectIdentityRunSchema }).strict().safeParse(
      (() => { try { return JSON.parse(response.stdout); } catch { return null; } })());
    if (response.code !== 0 || !parsed.success)
      throw new AppError('单应用原来源的 native 准备应答未确认，请按原 UUID 核对', 503, 'SINGLE_APP_NATIVE_PREPARE_UNCONFIRMED');
    return parsed.data.result;
  }
  async legacy(id: string) {
    // Legacy markers have no complete run, boot or original namespace proof.
    // This fixed read-only inventory grants no stop or stream authorization.
    const probe = `import json,os,pathlib,pwd,re,stat\np=pathlib.Path('/var/lib/sakura/single-apps'); rows=[]\n` +
      `if os.path.lexists(p):\n` +
      ` for q in [p,*p.parents]:\n  s=q.lstat(); assert stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022\n` +
      ` entries=list(p.iterdir()); assert len(entries)<=4096\n` +
      ` for f in entries:\n` +
      `  if not re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',f.name): continue\n` +
      `  s=f.lstat(); assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022 and s.st_nlink==1 and s.st_size<=32\n` +
      `  fd=os.open(f,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)\n` +
      `  try: raw=os.read(fd,33).strip(); assert raw.isdigit() and int(raw)>=1000\n` +
      `  finally: os.close(fd)\n` +
      `  user='skapp'+f.name.replace('-','')[:24]; rows.append({'id':f.name,'uid':int(raw),'user':user,'home':'/home/'+user})\n` +
      `print(json.dumps(rows,separators=(',',':')))\n`;
    const result = await this.machines.exec(id, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C ` +
      `/usr/bin/python3 -I -S -c ${quote(probe)}`, 10000);
    if (result.code !== 0) throw new AppError('旧单应用无完整票据，原标记无法只读核对', 409, 'SINGLE_APP_LEGACY_REVIEW_REQUIRED');
    return z.array(z.object({ id: z.uuid(), uid: z.number().int().min(1000), user: z.string(), home: z.string().startsWith('/') }).strict())
      .max(1024).parse(JSON.parse(result.stdout));
  }
  streamCommand(build: string, origin: AppOrigin) {
    digest.parse(build);
    return this.command(build, 'status').replace(/ status$/, '') + ` stream ${z.uuid().parse(origin.run.runId)} ${appOriginHash(origin)}`;
  }
}

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
