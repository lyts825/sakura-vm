import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { z } from 'zod';
import { AppError, ROOT } from './model.ts';
import type { Machines } from './machines.ts';
import { quote } from './files.ts';
import { projectIdentitySchema } from './project-identity.ts';
import { OwnedGpgForward, closeGpgHostLease, type GpgHostSnapshot } from './gpg-agent-host.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const gpgAgentResourceSchema = z.object({ version: z.literal(1), kind: z.literal('gpg-agent'),
  leaseId: z.uuid(), brokerSha256: digest, timeoutSeconds: z.number().int().min(1).max(300),
  hostSourceSha256: digest, hostHelperSha256: digest }).strict();
export type GpgAgentResource = z.infer<typeof gpgAgentResourceSchema>;
export const gpgAgentContextSchema = z.object({ resource: gpgAgentResourceSchema, identity: projectIdentitySchema,
  owner: z.object({ kind: z.literal('task'), runId: z.uuid(), bootId: z.uuid() }).strict(), sha256: digest }).strict();
export type GpgAgentContext = z.infer<typeof gpgAgentContextSchema>;
const manifestSchema = z.object({ version: z.literal(1), file: z.literal('broker.py'),
  size: z.number().int().min(1).max(262144), sha256: digest }).strict();
const fixedEnvironment = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C';
export const gpgAgentControlRoot = '/run/sakura-gpg-forwards';
export const gpgAgentSocketRoot = '/run/sakura-gpg-sockets';
export const gpgAgentHomeRoot = '/run/sakura-gpg-data';
export const gpgAgentSocketPath = (leaseId: string) => `${gpgAgentSocketRoot}/${z.uuid().parse(leaseId)}/agent`;
export const gpgAgentSourcePath = (leaseId: string) => `${gpgAgentControlRoot}/sources/${z.uuid().parse(leaseId)}/agent`;
export const gpgAgentHomePath = (leaseId: string) => `${gpgAgentHomeRoot}/${z.uuid().parse(leaseId)}/home`;

type HostOwner = { bridge: OwnedGpgForward; context: GpgAgentContext;
  live: NonNullable<ReturnType<Machines['live']['get']>>; cleaned: boolean };
const owners = new WeakMap<Machines, Map<string, HostOwner>>();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ownerKey = (vmId: string, context: GpgAgentContext) => vmId + ':' + context.owner.runId;
export function bindTaskGpg(machines: Machines, vmId: string, context: GpgAgentContext,
  bridge: OwnedGpgForward, live: HostOwner['live']) {
  context = gpgAgentContextSchema.parse(context);
  if (!(bridge instanceof OwnedGpgForward) || bridge.hostSourceSha256 !== context.resource.hostSourceSha256 ||
      bridge.hostHelperSha256 !== context.resource.hostHelperSha256 || machines.live.get(vmId) !== live)
    throw new AppError('GPG Agent 宿主归属或客户机运行身份不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
  let registry = owners.get(machines); if (!registry) { registry = new Map(); owners.set(machines, registry); }
  const key = ownerKey(vmId, context);
  if (registry.has(key)) throw new AppError('本次 GPG Agent 运行已被登记', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
  bridge.bind(context, live);
  const value: HostOwner = { context: structuredClone(context), bridge, live, cleaned: false }; registry.set(key, value);
  return () => { if (value.cleaned && registry.get(key) === value) registry.delete(key); };
}
export function isOwnedTaskGpg(machines: Machines, vmId: string, context: GpgAgentContext, bridge: unknown) {
  const value = owners.get(machines)?.get(ownerKey(vmId, gpgAgentContextSchema.parse(context)));
  return bridge instanceof OwnedGpgForward && value?.bridge === bridge && same(value.context, context) &&
    value.live === machines.live.get(vmId);
}

// All generation and bootstrap paths are fixed. Existing unknown entries are
// refused rather than truncated; the helper is executed from verified bytes.
const bootstrap = `import base64,hashlib,json,os,stat,sys
request=json.loads(base64.b64decode(sys.argv[1],validate=True)); sha=request['context']['resource']['brokerSha256']
root='/run/sakura-gpg-forwards'; filename=root+'/tools/'+sha+'/broker.py'
def directory(path,mode=None):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC); info=os.fstat(fd)
 assert info.st_uid==0 and info.st_gid==0 and not stat.S_IMODE(info.st_mode)&0o022
 if mode is not None: assert stat.S_IMODE(info.st_mode)==mode
 return fd
fd=directory('/run'); os.close(fd)
for path in [root,root+'/tools',root+'/tools/'+sha]:
 if not os.path.lexists(path):
  if request['action']!='cleanup': raise RuntimeError('AGENT_ASSET_ABSENT')
  # No helper was ever published. An absent exact resource and endpoint can be
  # confirmed without installing anything on the cleanup path.
  for parent in [root,root+'/records',root+'/sources','/run/sakura-gpg-sockets','/run/sakura-gpg-data']:
   if os.path.lexists(parent): os.close(directory(parent,0o755 if parent.endswith('sockets') or parent.endswith('data') else 0o700))
  assert not os.path.lexists(root+'/records/'+request['context']['resource']['leaseId']+'.json')
  assert not os.path.lexists('/run/sakura-gpg-sockets/'+request['context']['resource']['leaseId'])
  assert not os.path.lexists(root+'/sources/'+request['context']['resource']['leaseId'])
  assert not os.path.lexists('/run/sakura-gpg-data/'+request['context']['resource']['leaseId'])
  assert not os.path.lexists('/sys/fs/cgroup/sakura-task-'+request['context']['owner']['runId'])
  print(json.dumps({'version':1,'ok':True,'result':{'phase':'closed','context':request['context'],'record':None}})); sys.exit(0)
 os.close(directory(path,0o700))
fd=os.open(filename,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC); info=os.fstat(fd)
assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_gid==0 and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600 and 0<info.st_size<=262144
source=os.read(fd,262145); assert len(source)==info.st_size and not os.read(fd,1)
assert hashlib.sha256(source).hexdigest()==sha; os.close(fd)
sys.argv=[filename,sys.argv[1]]; exec(compile(source,filename,'exec'),{'__name__':'__main__','__file__':filename})
`;
const installer = `import hashlib,json,os,stat,sys,uuid,zlib,fcntl
request=json.loads(sys.argv[1]); root='/run/sakura-gpg-forwards'; tools=root+'/tools'
def directory(path,create=False):
 if create and not os.path.lexists(path): os.mkdir(path,0o700)
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC); info=os.fstat(fd)
 assert info.st_uid==0 and info.st_gid==0 and not stat.S_IMODE(info.st_mode)&0o022
 if path!='/run': assert stat.S_IMODE(info.st_mode)==0o700
 return fd
os.umask(0o077); os.close(directory('/run')); os.close(directory(root,True)); parent=directory(tools,True)
lock=os.open('install.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,0o600,dir_fd=parent)
info=os.fstat(lock); assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_gid==0 and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600
fcntl.flock(lock,fcntl.LOCK_EX)
raw=sys.stdin.buffer.read(131073); assert len(raw)<=131072
codec=zlib.decompressobj(); source=codec.decompress(raw,262145)
assert codec.eof and not codec.unconsumed_tail and not codec.unused_data and len(source)==request['size'] and 0<len(source)<=262144
assert hashlib.sha256(source).hexdigest()==request['sha256']
def verify(path):
 gen=directory(path); fd=os.open('broker.py',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=gen); info=os.fstat(fd)
 assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_gid==0 and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600 and info.st_size==len(source)
 value=os.read(fd,262145); assert len(value)==info.st_size and hashlib.sha256(value).hexdigest()==request['sha256']; os.close(fd)
 assert sorted(os.listdir(gen))==['broker.py']; os.close(gen)
target=tools+'/'+request['sha256']
if not os.path.lexists(target):
 stage=tools+'/stage-'+str(uuid.uuid4()); os.mkdir(stage,0o700); gen=directory(stage)
 fd=os.open('broker.py',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=gen)
 with os.fdopen(fd,'wb') as out: out.write(source); out.flush(); os.fsync(out.fileno())
 os.fsync(gen); os.close(gen); verify(stage); os.rename(stage,target); os.fsync(parent)
verify(target); print(json.dumps({'version':1,'ok':True,'sha256':request['sha256']}))
`;

export class GpgAgentScopes {
  constructor(private machines: Machines, private options: { sourceDirectory?: string } = {}) {}
  async asset() {
    const directory = this.options.sourceDirectory || join(ROOT, '.sakura-server/assets/gpg-agent');
    try {
      const manifest = manifestSchema.parse(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')));
      const source = await readFile(join(directory, manifest.file));
      if (source.length !== manifest.size || createHash('sha256').update(source).digest('hex') !== manifest.sha256)
        throw new Error('asset mismatch');
      return { ...manifest, source };
    } catch { throw new AppError('GPG Agent broker 资产缺失或摘要不符', 503, 'PROJECT_IDENTITY_AGENT_ASSET_INVALID'); }
  }
  async resource(timeoutSeconds: number, host: Pick<GpgHostSnapshot, 'hostSourceSha256' | 'hostHelperSha256'>) {
    return gpgAgentResourceSchema.parse({ version: 1, kind: 'gpg-agent', leaseId: randomUUID(),
      brokerSha256: (await this.asset()).sha256, timeoutSeconds,
      hostSourceSha256: host.hostSourceSha256, hostHelperSha256: host.hostHelperSha256 });
  }
  async install(vmId: string, resource: GpgAgentResource, signal: AbortSignal) {
    const asset = await this.asset();
    if (asset.sha256 !== resource.brokerSha256) throw new AppError('Agent 资产在任务准备后改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    const compressed = deflateSync(asset.source);
    const command = `# SAKURA_GPG_AGENT_INSTALL\n${fixedEnvironment} /usr/bin/python3 -I -S -c ${quote(installer)} ${quote(JSON.stringify({ sha256: asset.sha256, size: asset.size }))}`;
    const reply = await this.machines.execInput(vmId, command, compressed, 15000, signal);
    const value = z.object({ version: z.literal(1), ok: z.literal(true), sha256: digest }).strict().safeParse(parseJson(reply.stdout));
    if (reply.code !== 0 || !value.success || value.data.sha256 !== resource.brokerSha256)
      throw new AppError('GPG Agent broker 私有 generation 安装未确认', 503, 'PROJECT_IDENTITY_AGENT_ASSET_INVALID');
  }
  command(action: 'prepare' | 'run' | 'cleanup' | 'read', context: GpgAgentContext, launcher?: string) {
    context = gpgAgentContextSchema.parse(context);
    if (action === 'run' && !launcher) throw new Error('missing fixed launcher');
    const data = Buffer.from(JSON.stringify({ action, context, ...(launcher ? { launcher } : {}) })).toString('base64');
    if (action !== 'run' && launcher !== undefined) throw new Error('launcher only belongs to run');
    return `# SAKURA_GPG_AGENT_${action.toUpperCase()}\n${fixedEnvironment} /usr/bin/python3 -I -S -c ${quote(bootstrap)} ${quote(data)}`;
  }
  async prepare(vmId: string, context: GpgAgentContext, signal: AbortSignal) {
    context = gpgAgentContextSchema.parse(context); signal.throwIfAborted();
    const live = this.machines.live.get(vmId);
    if (!live) throw new AppError('GPG Agent 准备缺少客户机运行身份', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    const reply = await this.machines.exec(vmId, this.command('prepare', context), 10000, signal);
    const parsed = prepareReply.safeParse(parseJson(reply.stdout));
    if (reply.code !== 0 || !parsed.success || !same(parsed.data.result.context, context) ||
        parsed.data.result.sourcePath !== gpgAgentSourcePath(context.resource.leaseId) || this.machines.live.get(vmId) !== live)
      throw new AppError('GPG Agent source 准备未确认，原记录保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    return parsed.data.result;
  }
  async cleanup(vmId: string, context: GpgAgentContext) {
    context = gpgAgentContextSchema.parse(context);
    const owner = owners.get(this.machines)?.get(ownerKey(vmId, context));
    // The owner authenticates the old host lease. After a guest reboot,
    // cleanup must examine the current guest and prove the old paths absent;
    // its live handle stays pinned across host close and every retry.
    const live = this.machines.live.get(vmId);
    if (owner) {
      if (!same(owner.context, context))
        throw new AppError('本次 Agent 宿主归属已改变', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      await owner.bridge.close();
    } else await closeGpgHostLease(context);
    let failure = 'Agent cleanup transport failed';
    for (let attempt = 0; attempt < 3; ++attempt) {
      if (!live || this.machines.live.get(vmId) !== live) {
        failure = 'Agent cleanup live changed before exec'; break;
      }
      let reply: Awaited<ReturnType<Machines['exec']>>;
      try {
        reply = await this.machines.exec(vmId, this.command('cleanup', context), 7000);
      } catch {
        // SSH errors can contain arbitrary remote text. Retain only the fixed
        // transport classification, never a command, stdout or error message.
        failure = 'Agent cleanup transport failed'; continue;
      }
      if (this.machines.live.get(vmId) !== live) {
        failure = `Agent cleanup live changed after exec; exec code ${cleanupExecCode(reply.code)}`; break;
      }
      const refused = cleanupReplyFailure(reply, context);
      if (refused) { failure = refused; continue; }
      if (owner) {
        owner.cleaned = true;
        if (owners.get(this.machines)?.get(ownerKey(vmId, context)) === owner)
          owners.get(this.machines)!.delete(ownerKey(vmId, context));
      }
      return;
    }
    throw new AppError(`本次 GPG Agent 资源清理未确认，原运行回执保留：${failure}`,
      503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  }
  async readonly(vmId: string, context: GpgAgentContext) {
    context = gpgAgentContextSchema.parse(context);
    const live = this.machines.live.get(vmId);
    const reply = await this.machines.exec(vmId, this.command('read', context), 7000);
    const parsed = readReply.safeParse(parseJson(reply.stdout));
    if (!live || this.machines.live.get(vmId) !== live || reply.code !== 0 || !parsed.success || !same(parsed.data.result.context, context))
      throw new AppError('GPG Agent 资源回执读取未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    return parsed.data.result;
  }
}
const numberText = z.string().regex(/^(0|[1-9][0-9]*)$/);
const unixObject = z.object({ device: numberText, inode: numberText,
  uid: z.number().int().nonnegative(), gid: z.number().int().nonnegative(),
  mode: z.number().int().min(0).max(0o7777), type: z.number().int() }).strict();
const processSchema = z.object({ pid: z.number().int().min(2), startTicks: numberText }).strict();
export const gpgAgentRecordSchema = z.object({ version: z.literal(1), context: gpgAgentContextSchema,
  phase: z.enum(['prepared', 'preparing', 'ready', 'failed', 'closed']),
  scope: z.object({ device: numberText, inode: numberText, controlToken: z.uuid() }).strict().nullable(),
  sourceDirectory: unixObject.nullable(),
  source: z.object({ path: z.string().min(1).max(107), parent: unixObject, socket: unixObject, peer: processSchema }).strict().nullable(),
  endpointDirectory: unixObject.nullable(), endpoint: unixObject.nullable(), broker: processSchema.nullable(),
  homeDirectory: unixObject.nullable(), home: unixObject.nullable(),
  redirect: z.object({ object: unixObject, sha256: digest }).strict().nullable(),
  homeCleanup: z.object({ phase: z.enum(['freeze-intent', 'frozen', 'removing', 'removed']), frozenHome: unixObject.nullable(),
    directories: z.array(z.object({ path: z.array(z.string().min(1).max(255).regex(/^[A-Za-z0-9._#=+\-~]+$/)
      .refine(value => value !== '.' && value !== '..')).min(1).max(16),
      phase: z.enum(['freeze-intent', 'frozen', 'removed']), original: unixObject, frozen: unixObject }).strict()).max(128) }).strict().nullable(),
  failure: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable() }).strict().superRefine((value, ctx) => {
  if (value.phase === 'ready' && (!value.scope || !value.sourceDirectory || !value.source || !value.endpointDirectory ||
      !value.endpoint || !value.homeDirectory || !value.home || !value.redirect || !value.broker || value.failure))
    ctx.addIssue({ code: 'custom', message: 'Agent ready 回执缺少完整对象身份' });
  if (value.phase === 'prepared' && (value.scope || !value.sourceDirectory || value.source || value.endpointDirectory ||
      value.endpoint || value.homeDirectory || value.home || value.redirect || value.broker || value.homeCleanup || value.failure))
    ctx.addIssue({ code: 'custom', message: 'Agent prepared 回执已经绑定执行资源' });
  if (value.source && (value.source.path !== gpgAgentSourcePath(value.context.resource.leaseId) ||
      !same(value.source.parent, value.sourceDirectory)))
    ctx.addIssue({ code: 'custom', message: 'Agent source 回执不是原固定目录' });
  const expectedObjects = { sourceDirectory: [0, 0, 0o700, 0o40000],
    endpointDirectory: [0, value.context.identity.gid, 0o710, 0o40000],
    endpoint: [0, value.context.identity.gid, 0o660, 0o140000],
    homeDirectory: [0, value.context.identity.gid, 0o710, 0o40000],
    home: [value.context.identity.uid, value.context.identity.gid, 0o700, 0o40000] } as const;
  for (const [name, expected] of Object.entries(expectedObjects)) {
    const object = value[name as keyof typeof expectedObjects];
    if (object && !same([object.uid, object.gid, object.mode, object.type], expected))
      ctx.addIssue({ code: 'custom', message: 'Agent 对象权限回执不符' });
  }
  if (value.source && (value.source.socket.uid !== 0 || value.source.socket.gid !== 0 || value.source.socket.type !== 0o140000))
    ctx.addIssue({ code: 'custom', message: 'Agent source 回执不属于 root socket' });
  if (value.redirect) {
    const object = value.redirect.object;
    const bytes = `%Assuan%\nsocket=${gpgAgentSocketPath(value.context.resource.leaseId)}\n`;
    if (!same([object.uid, object.gid, object.mode, object.type], [0, value.context.identity.gid, 0o440, 0o100000]) ||
        value.redirect.sha256 !== createHash('sha256').update(bytes).digest('hex'))
      ctx.addIssue({ code: 'custom', message: 'Agent 路由回执不属于固定 root 文件' });
  }
  const transition = value.homeCleanup;
  if (transition) {
    const target = value.home ? { ...value.home, uid: 0, gid: 0, mode: 0o700 } : undefined;
    if (!target || (transition.frozenHome && !same(transition.frozenHome, target)) ||
        (transition.phase !== 'freeze-intent' && !transition.frozenHome))
      ctx.addIssue({ code: 'custom', message: 'Agent home freeze 不是原 inode transition' });
    const paths = new Set<string>();
    for (const child of transition.directories) {
      const path = JSON.stringify(child.path);
      if (paths.has(path) || child.original.type !== 0o40000 ||
          child.original.uid !== value.context.identity.uid || child.original.gid !== value.context.identity.gid ||
          !same(child.frozen, { ...child.original, uid: 0, gid: 0, mode: 0o700 }))
        ctx.addIssue({ code: 'custom', message: 'Agent 子目录 freeze transition 不符' });
      paths.add(path);
    }
  }
});
const resultSchema = z.object({ phase: z.enum(['prepared', 'preparing', 'ready', 'failed', 'closed']),
  context: gpgAgentContextSchema, record: gpgAgentRecordSchema.nullable() }).strict().superRefine((value, ctx) => {
  if ((!value.record && value.phase !== 'closed') || (value.record &&
      (value.record.phase !== value.phase || !same(value.record.context, value.context))))
    ctx.addIssue({ code: 'custom', message: 'Agent 回执与原上下文不符' });
});
const readReply = z.object({ version: z.literal(1), ok: z.literal(true), result: resultSchema }).strict();
const cleanupReply = z.object({ version: z.literal(1), ok: z.literal(true),
  result: resultSchema.safeExtend({ phase: z.literal('closed') }) }).strict();
// Only the pinned broker's fixed refusal vocabulary may enter an error. In
// particular, a syntactically plausible unknown code is not remote-safe text.
const brokerRefusalCodes = new Set(`AGENT_CONTROL_FAILED BOOT_CHANGED BROKER_FAILED BROKER_READY_FAILED
BROKER_READY_TIMEOUT BROKER_REPLACED CGROUP_CHANGED CGROUP_UNAVAILABLE CLOSED_ENDPOINT_PRESENT CLOSED_HOME_PRESENT
CLOSED_SOURCE_PRESENT CONTEXT_INVALID CONTROLLER_OWNER CONTROLLER_SCOPE DIRECTORY_ABSENT DIRECTORY_OWNER
ENDPOINT_CONTENT_CHANGED ENDPOINT_INVALID ENDPOINT_REPLACED ENDPOINT_UNCONFIRMED HOME_CLEANUP_TIMEOUT HOME_DATA_CHANGED
HOME_DATA_NAME HOME_DATA_OWNER HOME_DEPTH_BUDGET HOME_DEVICE_CHANGED HOME_DIRECTORY_BUDGET HOME_DIRECTORY_OWNER
HOME_DIRECTORY_REPLACED HOME_ENTRY_BUDGET HOME_MOUNTED HOME_PARENT_REPLACED HOME_REPLACED HOME_UNCONFIRMED
LAUNCHER_INVALID LEASE_CONTENT_CHANGED LEASE_REPLACED LOCK_OWNER MOUNTINFO_INVALID OLD_BOOT_RESOURCE_PRESENT
OTHER_RESOURCE_UNCONFIRMED PATH_INVALID PEER_ACCOUNT PEER_PRIVILEGES PEER_SCOPE PREPARE_FAILED PROCESS_CHANGED
PROCESS_EXITED PROCESS_INVALID PROTOCOL_ANCILLARY PROTOCOL_BUDGET PROTOCOL_BUFFER PROTOCOL_CLOSED PROTOCOL_COMMAND
PROTOCOL_CONTROL PROTOCOL_GREETING PROTOCOL_INQUIRY PROTOCOL_REQUEST_BUDGET PROTOCOL_RESPONSE PROTOCOL_SIZE
PROTOCOL_STATE PROTOCOL_TIMEOUT RECORD_BUDGET RECORD_CHANGED RECORD_INVALID RECORD_OWNER REDIRECT_REPLACED
REDIRECT_SIZE REDIRECT_UNCONFIRMED REQUEST_INVALID RESOURCE_ABSENT RESOURCE_CHANGED RESOURCE_EXISTS RESOURCE_LIMIT
RESOURCE_NOT_PREPARED RESOURCE_REVOKED RESOURCE_UNCONFIRMED SCOPE_ACTIVE SOURCE_CLOSE_UNCONFIRMED SOURCE_INVALID
SOURCE_OWNER SOURCE_PARENT SOURCE_PEER SOURCE_PEER_ACCOUNT SOURCE_PEER_CHANGED SOURCE_REPLACED SOURCE_SHARED
TASK_OWNER`.split(/\s+/));
const brokerRefusal = z.object({ ok: z.literal(false), detail: z.null(), code: z.string().refine(value =>
  value.startsWith('GPG_AGENT_') && brokerRefusalCodes.has(value.slice('GPG_AGENT_'.length))) }).strict();
const cleanupSchemaFields = new Set(`version ok result phase context resource kind leaseId brokerSha256 timeoutSeconds
hostSourceSha256 hostHelperSha256 identity registryId projectId identityId revision account uid gid home directory
directoryDevice directoryInode homeDevice homeInode networkIsolation owner runId bootId sha256 record scope device
inode controlToken sourceDirectory source path parent socket peer pid startTicks endpointDirectory endpoint broker
homeDirectory redirect object homeCleanup frozenHome directories original frozen failure mode type`.split(/\s+/));
const cleanupExecCode = (code: number) => Number.isSafeInteger(code) ? String(code) : 'invalid';
function cleanupReplyFailure(reply: { code: number; stdout: string }, context: GpgAgentContext) {
  const prefix = `Agent cleanup exec code ${cleanupExecCode(reply.code)}`;
  let value: unknown;
  try { value = JSON.parse(reply.stdout); }
  catch { return `${prefix}; reply JSON invalid`; }
  const refused = brokerRefusal.safeParse(value);
  if (refused.success) return `${prefix}; broker refusal ${refused.data.code}`;
  const parsed = cleanupReply.safeParse(value);
  if (!parsed.success) {
    // Zod messages and unknown property names can echo remote data. Publish
    // only bounded paths made from this schema's fixed fields and indices.
    const paths = [...new Set(parsed.error.issues.slice(0, 3).map(issue => issue.path.slice(0, 16).map(part =>
      typeof part === 'number' ? '[index]' : typeof part === 'string' && cleanupSchemaFields.has(part) ? part : '[field]'
    ).join('.') || '<root>'))];
    return `${prefix}; reply schema path ${paths.join(', ')}`;
  }
  if (reply.code !== 0) return `${prefix}; unexpected successful reply`;
  if (!same(parsed.data.result.context, context)) return `${prefix}; reply context changed`;
}
const prepareReply = z.object({ version: z.literal(1), ok: z.literal(true), result: z.object({
  phase: z.literal('prepared'), context: gpgAgentContextSchema, sourcePath: z.string().min(1).max(107),
  record: gpgAgentRecordSchema }).strict().superRefine((value, ctx) => {
    if (value.record.phase !== 'prepared' || value.record.scope !== null || !same(value.context, value.record.context) ||
        value.sourcePath !== gpgAgentSourcePath(value.context.resource.leaseId))
      ctx.addIssue({ code: 'custom', message: 'Agent prepared 回复归属不符' });
  }) }).strict();
const parseJson = (text: string) => { try { return JSON.parse(text); } catch { return null; } };
