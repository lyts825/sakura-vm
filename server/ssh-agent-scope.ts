import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connect, type Socket } from 'node:net';
import { deflateSync } from 'node:zlib';
import ssh2, { type GetStreamCallback } from 'ssh2';
import { z } from 'zod';
import { AppError, ROOT } from './model.ts';
import type { Machines } from './machines.ts';
import { quote } from './files.ts';
import { projectIdentitySchema } from './project-identity.ts';
const { OpenSSHAgent } = ssh2;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const sshAgentResourceSchema = z.object({ version: z.literal(1), kind: z.literal('ssh-agent'),
  leaseId: z.uuid(), brokerSha256: digest, timeoutSeconds: z.number().int().min(1).max(300) }).strict();
export type SshAgentResource = z.infer<typeof sshAgentResourceSchema>;
export const sshAgentContextSchema = z.object({ resource: sshAgentResourceSchema,
  identity: projectIdentitySchema, owner: z.object({ kind: z.literal('task'), runId: z.uuid(), bootId: z.uuid() }).strict(),
  sha256: digest }).strict();
export type SshAgentContext = z.infer<typeof sshAgentContextSchema>;
const manifestSchema = z.object({ version: z.literal(1), file: z.literal('broker.py'),
  size: z.number().int().min(1).max(262144), sha256: digest }).strict();
const fixedEnvironment = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C';
export const sshAgentControlRoot = '/run/sakura-agent-forwards';
export const sshAgentSocketRoot = '/run/sakura-agent-sockets';
export const sshAgentSocketPath = (leaseId: string) => `${sshAgentSocketRoot}/${z.uuid().parse(leaseId)}/agent`;

/** One owner creates and revokes only its own host streams, including pending connects. */
export class OwnedForwardAgent extends OpenSSHAgent {
  private streams = new Set<Socket>();
  private revoked = false;
  private closing?: Promise<void>;
  private abort: () => void;
  constructor(private path: string, private signal: AbortSignal) {
    super(path);
    this.abort = () => { void this.close().catch(() => {}); };
    signal.addEventListener('abort', this.abort, { once: true });
    if (signal.aborted) this.abort();
  }
  override getStream(callback: GetStreamCallback) {
    if (this.revoked || this.signal.aborted || this.streams.size >= 8) {
      callback(new Error('This task agent is closed or its connection budget is exhausted')); return;
    }
    let stream: Socket;
    try { stream = connect(this.path); } catch (error) { callback(error as Error); return; }
    this.streams.add(stream);
    let delivered = false;
    const finish = (error?: Error) => {
      if (delivered) return;
      delivered = true; clearTimeout(timer);
      if (error || this.revoked || this.signal.aborted) {
        stream.destroy(); callback(error || new Error('This task agent was revoked'));
      } else callback(null, stream);
    };
    const timer = setTimeout(() => finish(new Error('Agent connection timed out')), 3000);
    stream.once('connect', () => finish());
    stream.on('error', error => { finish(error); stream.destroy(); });
    stream.once('end', () => stream.destroy());
    stream.once('close', () => { this.streams.delete(stream); finish(new Error('Agent stream closed')); });
  }
  close() {
    this.revoked = true; this.signal.removeEventListener('abort', this.abort);
    if (this.closing) return this.closing;
    const operation = (async () => {
      const streams = [...this.streams];
      await Promise.all(streams.map(stream => new Promise<void>((resolve, reject) => {
        const closed = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => {
          stream.off('close', closed);
          reject(new AppError('本任务宿主 Agent stream 关闭未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'));
        }, 5000);
        stream.once('close', closed); stream.destroy();
      })));
    })();
    // A late actual socket close may make the next exact cleanup successful.
    // Keep revoked, but do not permanently cache an unconfirmed close promise.
    this.closing = operation.then(() => { this.closing = undefined; }, error => {
      this.closing = undefined; throw error;
    });
    return this.closing;
  }
  get streamCount() { return this.streams.size; }
}

type HostOwner = { agent: OwnedForwardAgent; context: SshAgentContext; live: NonNullable<ReturnType<Machines['live']['get']>>;
  cleaned: boolean };
const owners = new WeakMap<Machines, Map<string, HostOwner>>();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ownerKey = (vmId: string, context: SshAgentContext) => vmId + ':' + context.owner.runId;
export function bindTaskAgent(machines: Machines, vmId: string, context: SshAgentContext,
  agent: OwnedForwardAgent, live: HostOwner['live']) {
  context = sshAgentContextSchema.parse(context);
  if (machines.live.get(vmId) !== live) throw new AppError('Agent 准备的客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
  let registry = owners.get(machines); if (!registry) { registry = new Map(); owners.set(machines, registry); }
  const key = ownerKey(vmId, context);
  if (registry.has(key)) throw new AppError('本次 Agent 运行已被登记', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
  const value: HostOwner = { context: structuredClone(context), agent, live, cleaned: false }; registry.set(key, value);
  // Execution completion and resource cleanup are different lifetimes. A failed
  // host close must leave this exact stream owner reachable for recovery.
  return () => { if (value.cleaned && registry.get(key) === value) registry.delete(key); };
}
export function isOwnedTaskAgent(machines: Machines, vmId: string, runId: string, agent: unknown) {
  const value = owners.get(machines)?.get(vmId + ':' + runId);
  return agent instanceof OwnedForwardAgent && value?.agent === agent && value.live === machines.live.get(vmId);
}

// All generation and bootstrap paths are fixed. Existing unknown entries are
// refused rather than truncated; the helper is executed from verified bytes.
const bootstrap = `import base64,hashlib,json,os,stat,sys
request=json.loads(base64.b64decode(sys.argv[1],validate=True)); sha=request['context']['resource']['brokerSha256']
root='/run/sakura-agent-forwards'; filename=root+'/tools/'+sha+'/broker.py'
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
  for parent in [root,root+'/records','/run/sakura-agent-sockets']:
   if os.path.lexists(parent): os.close(directory(parent,0o755 if parent.endswith('sockets') else 0o700))
  assert not os.path.lexists(root+'/records/'+request['context']['resource']['leaseId']+'.json')
  assert not os.path.lexists('/run/sakura-agent-sockets/'+request['context']['resource']['leaseId'])
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
request=json.loads(sys.argv[1]); root='/run/sakura-agent-forwards'; tools=root+'/tools'
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

export class SshAgentScopes {
  constructor(private machines: Machines, private options: { sourceDirectory?: string } = {}) {}
  async asset() {
    const directory = this.options.sourceDirectory || join(ROOT, '.sakura-server/assets/ssh-agent');
    try {
      const manifest = manifestSchema.parse(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')));
      const source = await readFile(join(directory, manifest.file));
      if (source.length !== manifest.size || createHash('sha256').update(source).digest('hex') !== manifest.sha256)
        throw new Error('asset mismatch');
      return { ...manifest, source };
    } catch { throw new AppError('SSH Agent broker 资产缺失或摘要不符', 503, 'PROJECT_IDENTITY_AGENT_ASSET_INVALID'); }
  }
  async resource(timeoutSeconds: number) {
    return sshAgentResourceSchema.parse({ version: 1, kind: 'ssh-agent', leaseId: randomUUID(),
      brokerSha256: (await this.asset()).sha256, timeoutSeconds });
  }
  async install(vmId: string, resource: SshAgentResource, signal: AbortSignal) {
    const asset = await this.asset();
    if (asset.sha256 !== resource.brokerSha256) throw new AppError('Agent 资产在任务准备后改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    const compressed = deflateSync(asset.source);
    const command = `# SAKURA_SSH_AGENT_INSTALL\n${fixedEnvironment} /usr/bin/python3 -I -S -c ${quote(installer)} ${quote(JSON.stringify({ sha256: asset.sha256, size: asset.size }))}`;
    const reply = await this.machines.execInput(vmId, command, compressed, 15000, signal);
    const value = z.object({ version: z.literal(1), ok: z.literal(true), sha256: digest }).strict().safeParse(parseJson(reply.stdout));
    if (reply.code !== 0 || !value.success || value.data.sha256 !== resource.brokerSha256)
      throw new AppError('SSH Agent broker 私有 generation 安装未确认', 503, 'PROJECT_IDENTITY_AGENT_ASSET_INVALID');
  }
  command(action: 'run' | 'cleanup' | 'read', context: SshAgentContext, launcher?: string) {
    context = sshAgentContextSchema.parse(context);
    if (action === 'run' && !launcher) throw new Error('missing fixed launcher');
    const data = Buffer.from(JSON.stringify({ action, context, ...(launcher ? { launcher } : {}) })).toString('base64');
    // RUN has a single whitelisted sshd value. It never accepts a project env.
    const environment = fixedEnvironment + (action === 'run' ? ' SAKURA_SSH_AGENT_SOURCE="${SAKURA_SSH_AGENT_SOURCE-}"' : '');
    return `# SAKURA_SSH_AGENT_${action.toUpperCase()}\n${environment} /usr/bin/python3 -I -S -c ${quote(bootstrap)} ${quote(data)}`;
  }
  async cleanup(vmId: string, context: SshAgentContext) {
    context = sshAgentContextSchema.parse(context);
    const owner = owners.get(this.machines)?.get(ownerKey(vmId, context));
    if (owner) {
      if (!same(owner.context, context))
        throw new AppError('本次 Agent 宿主归属已改变', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      await owner.agent.close();
    }
    let failure: unknown;
    const live = this.machines.live.get(vmId);
    for (let attempt = 0; attempt < 3; ++attempt) {
      if (!live || this.machines.live.get(vmId) !== live) break;
      try {
        const reply = await this.machines.exec(vmId, this.command('cleanup', context), 7000);
        const parsed = cleanupReply.safeParse(parseJson(reply.stdout));
        if (reply.code !== 0 || !parsed.success || !same(parsed.data.result.context, context) || this.machines.live.get(vmId) !== live)
          throw new Error('Agent exact cleanup reply missing or changed');
        if (owner) {
          owner.cleaned = true;
          if (owners.get(this.machines)?.get(ownerKey(vmId, context)) === owner)
            owners.get(this.machines)!.delete(ownerKey(vmId, context));
        }
        return;
      } catch (error) { failure = error; }
    }
    throw new AppError(`本次 SSH Agent 资源清理未确认，原运行回执保留：${failure instanceof Error ? failure.message : '客户机身份已改变'}`,
      503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  }
  async readonly(vmId: string, context: SshAgentContext) {
    const reply = await this.machines.exec(vmId, this.command('read', context), 7000);
    const parsed = readReply.safeParse(parseJson(reply.stdout));
    if (reply.code !== 0 || !parsed.success || !same(parsed.data.result.context, context))
      throw new AppError('SSH Agent 资源回执读取未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    return parsed.data.result;
  }
}
const numberText = z.string().regex(/^(0|[1-9][0-9]*)$/);
const unixObject = z.object({ device: numberText, inode: numberText,
  uid: z.number().int().nonnegative(), gid: z.number().int().nonnegative(),
  mode: z.number().int().min(0).max(0o7777), type: z.number().int() }).strict();
const processSchema = z.object({ pid: z.number().int().min(2), startTicks: numberText }).strict();
export const sshAgentRecordSchema = z.object({ version: z.literal(1), context: sshAgentContextSchema,
  phase: z.enum(['preparing', 'ready', 'failed', 'closed']),
  scope: z.object({ device: numberText, inode: numberText, controlToken: z.uuid() }).strict(),
  source: z.object({ path: z.string().min(1).max(107), parent: unixObject, socket: unixObject, peer: processSchema }).strict().nullable(),
  endpointDirectory: unixObject.nullable(), endpoint: unixObject.nullable(), broker: processSchema.nullable(),
  failure: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable() }).strict().superRefine((value, ctx) => {
  if (value.phase === 'ready' && (!value.source || !value.endpointDirectory || !value.endpoint || !value.broker || value.failure))
    ctx.addIssue({ code: 'custom', message: 'Agent ready 回执缺少完整对象身份' });
});
const resultSchema = z.object({ phase: z.enum(['preparing', 'ready', 'failed', 'closed']),
  context: sshAgentContextSchema, record: sshAgentRecordSchema.nullable() }).strict().superRefine((value, ctx) => {
  if ((!value.record && value.phase !== 'closed') || (value.record &&
      (value.record.phase !== value.phase || !same(value.record.context, value.context))))
    ctx.addIssue({ code: 'custom', message: 'Agent 回执与原上下文不符' });
});
const readReply = z.object({ version: z.literal(1), ok: z.literal(true), result: resultSchema }).strict();
const cleanupReply = z.object({ version: z.literal(1), ok: z.literal(true),
  result: resultSchema.safeExtend({ phase: z.literal('closed') }) }).strict();
const parseJson = (text: string) => { try { return JSON.parse(text); } catch { return null; } };
