/** 固定项目根、运行身份与普通文件副本。 Pins project root, VM lifetime and no-follow file handles. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { VmAccess } from './vm-access.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { FilesV2 } from './service-contracts/files-v2.ts';
import {
  captureRequestSchema,
  capturePlanSchema,
  capturePathSchema,
  type ProjectCapturePlan,
  type ProjectCaptureRequest,
} from '../shared/contracts/files-capture.ts';
import { captureOperationCheck } from './operation-context.ts';
import { vmLifetime, type VmIdentity } from './vm-lifetime.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { projectVersion, type Project } from './project-config.ts';
import { quote } from './shell.ts';
import { binding, sha, hash, fail } from './knowledge-store.ts';
import { hostRuntime, type ResourceLease } from './host-runtime/index.ts';
const program = String.raw`import os,sys,json,stat,hashlib,base64
p=json.loads(base64.b64decode(sys.argv[1])); opened=[]; links=[]
try:
 root=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW); opened.append(root)
 for part in p['root'].split('/'):
  if not part: continue
  if part in ('.','..'): raise ValueError('root')
  child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=root); opened.append(child); links.append((root,part,child));root=child
 parts=p['path'].split('/'); parent=root
 for part in parts[:-1]:
  if part in ('','.','..'): raise ValueError('path')
  child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent);opened.append(child);links.append((parent,part,child));parent=child
 fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent);opened.append(fd);links.append((parent,parts[-1],fd))
 before=os.fstat(fd)
 if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_size>16777216:raise ValueError('file')
 identity=[str(before.st_dev),str(before.st_ino),str(before.st_size),str(before.st_mtime_ns),str(before.st_ctime_ns)]
 if p.get('identity') and identity!=p['identity']:raise ValueError('changed')
 h=hashlib.sha256(); pieces=[]; length=0
 while True:
  b=os.read(fd,131072)
  if not b: break
  h.update(b);length+=len(b)
  if length>16777216:raise ValueError('size')
  pieces.append(b)
 after=os.fstat(fd)
 if identity!=[str(after.st_dev),str(after.st_ino),str(after.st_size),str(after.st_mtime_ns),str(after.st_ctime_ns)]:raise ValueError('changed')
 for parent,name,child in links:
  a=os.stat(name,dir_fd=parent,follow_symlinks=False);b=os.fstat(child)
  if stat.S_ISLNK(a.st_mode) or (a.st_dev,a.st_ino)!=(b.st_dev,b.st_ino):raise ValueError('path changed')
 content=b''.join(pieces);offset=p.get('offset',0);take=p.get('length',0)
 with open('/proc/sys/kernel/random/boot_id','r') as f:boot=f.read().strip()
 print(json.dumps({'identity':identity,'sha256':h.hexdigest(),'bytes':len(content),'boot':boot,'data':base64.b64encode(content[offset:offset+take]).decode()}))
finally:
 for fd in reversed(opened):os.close(fd)
`;
type Live = NonNullable<ReturnType<VmAccess['live']['get']>>;
type Ticket = {
  plan: ProjectCapturePlan;
  request: ProjectCaptureRequest;
  project: Project;
  live: Live;
  createdAt: string;
  identity: VmIdentity;
  boot: string;
  binding: string;
  check: () => Promise<void>;
  files: Map<string, { identity: string[]; data?: Buffer }>;
  consumed: boolean;
  ready: boolean;
  lease?: ResourceLease;
};
const replySchema = z
  .object({
    identity: z.array(z.string()).length(5),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z
      .number()
      .int()
      .min(0)
      .max(16 * 1024 ** 2),
    boot: z.string().uuid(),
    data: z.string().max(400000),
  })
  .strict();
export class FilesCapture implements FilesV2 {
  private tickets = new Map<string, Ticket>();
  private abort = new AbortController();
  private pending = new Set<Promise<unknown>>();
  constructor(
    private machines: VmAccess,
    private workspaces: WorkspacesV1 | undefined,
  ) {}
  private async check(t: Ticket) {
    await t.check();
    this.abort.signal.throwIfAborted();
    if (t.binding !== binding() || Date.parse(t.plan.expiresAt) < Date.now())
      fail('PLAN_EXPIRED', '原捕获票据已过期或消费者改变');
    if (
      this.machines.live.get(t.request.vmId) !== t.live ||
      this.machines.state(t.request.vmId) !== 'running' ||
      this.machines.get(t.request.vmId).createdAt !== t.createdAt
    )
      fail('SOURCE_CHANGED', '原 VM 创建或运行身份改变');
    vmLifetime(t.request.vmId, t.live).assert(t.identity);
    const current = await this.workspaces!.projects.inScope(t.request.vmId, t.request.projectId, () =>
      this.workspaces!.readCommittedConfig(t.request.vmId),
    );
    await t.check();
    if (
      projectVersion(current) !== t.request.configRevision ||
      current.directory !== t.project.directory ||
      (current._workspace || 'default') !== t.request.projectId
    )
      fail('SOURCE_CHANGED', '原项目配置改变');
    if (this.machines.live.get(t.request.vmId) !== t.live) fail('SOURCE_CHANGED', '等待期间运行身份改变');
  }
  private async call(t: Ticket, path: string, offset = 0, length = 0, external?: AbortSignal) {
    await this.check(t);
    const payload = Buffer.from(
      JSON.stringify({
        root: t.project.directory,
        path,
        offset,
        length,
        identity: t.files.get(path)?.identity,
      }),
    ).toString('base64');
    const signal = AbortSignal.any([this.abort.signal, ...(external ? [external] : [])]);
    const result = await this.workspaces!.projects.inScope(t.request.vmId, t.request.projectId, () =>
      projectIdentityTask(
        this.machines,
        t.request.vmId,
        t.project,
        { command: '/usr/bin/python3 -I -S -c ' + quote(program) + ' ' + quote(payload), environment: {} },
        signal,
        undefined,
        30000,
        undefined,
        undefined,
        { expectedLive: t.live },
      ),
    );
    await this.check(t);
    if (result.code !== 0)
      fail('SOURCE_CHANGED', '固定只读捕获失败；要求已有 python3、有效项目身份和普通文件，不安装工具');
    let reply: z.infer<typeof replySchema>;
    try {
      reply = replySchema.parse(JSON.parse(result.stdout));
    } catch {
      fail('SOURCE_CHANGED', '捕获回执格式不符');
    }
    if (t.boot && reply!.boot !== t.boot) fail('SOURCE_CHANGED', '原 boot 身份改变');
    t.boot ||= reply!.boot;
    return reply!;
  }
  private observe<T>(work: Promise<T>) {
    this.pending.add(work);
    void work.then(
      () => this.pending.delete(work),
      () => this.pending.delete(work),
    );
    return work;
  }
  planCapture(input: ProjectCaptureRequest, signal?: AbortSignal) {
    return this.observe(this.planInner(input, signal));
  }
  private async planInner(input: ProjectCaptureRequest, signal?: AbortSignal) {
    const p = captureRequestSchema.parse(input);
    if (!this.workspaces) fail('FILES_CAPTURE_UNAVAILABLE', '启用 projects 后才能固定捕获');
    if (new Set(p.relativePaths.map((s) => s.normalize('NFC').toLowerCase())).size !== p.relativePaths.length)
      fail('SOURCE_CHANGED', '捕获路径重复或大小写冲突');
    if (this.tickets.size >= 20) fail('KNOWLEDGE_QUOTA', '捕获票据过多，请释放旧票据');
    const check = captureOperationCheck(),
      owner = binding(),
      live = this.machines.live.get(p.vmId),
      createdAt = this.machines.get(p.vmId).createdAt;
    if (!live || this.machines.state(p.vmId) !== 'running') fail('SOURCE_CHANGED', 'VM 必须已运行');
    const identity = vmLifetime(p.vmId, live).capture();
    await check();
    const project = await this.workspaces.projects.inScope(p.vmId, p.projectId, () =>
      this.workspaces!.readCommittedConfig(p.vmId),
    );
    const token = randomUUID();
    const ticket: Ticket = {
      plan: {
        token,
        manifestDigest: '0'.repeat(64),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        consistency: 'selected-file-copies',
        files: [],
      },
      request: p,
      project,
      live,
      createdAt,
      identity,
      boot: identity.bootId ?? '',
      binding: owner,
      check,
      files: new Map(),
      consumed: false,
      ready: false,
    };
    let total = 0;
    for (const path of p.relativePaths) {
      signal?.throwIfAborted();
      const file = await this.call(ticket, path, 0, 0, signal);
      total += file.bytes;
      if (total > Math.min(p.maxBytes, 32 * 1024 ** 2))
        fail('EXTRACT_LIMIT', '捕获总量超过预览预算或首版 32 MiB 上限', 413);
      ticket.files.set(path, { identity: file.identity });
      ticket.plan.files.push({ path, bytes: file.bytes, sha256: file.sha256 });
    }
    ticket.plan.manifestDigest = hash(ticket.plan.files);
    await this.check(ticket);
    this.tickets.set(token, ticket);
    return capturePlanSchema.parse(ticket.plan);
  }
  capture(input: { planToken: string }, signal?: AbortSignal) {
    return this.observe(this.captureInner(input, signal));
  }
  private async captureInner(input: { planToken: string }, signal?: AbortSignal) {
    const p = z.object({ planToken: z.string().uuid() }).strict().parse(input),
      t = this.tickets.get(p.planToken);
    if (!t || t.consumed) fail('PLAN_EXPIRED', '原捕获计划不存在或已消费');
    await this.check(t);
    if (t.consumed) fail('PLAN_EXPIRED', '原计划已消费');
    t.consumed = true;
    try {
      t.lease = await hostRuntime.acquire({
        owner: 'files',
        kind: 'knowledge-capture-buffer',
        label: 'fixed project capture',
        cost: { 'io.buffers': t.plan.files.reduce((n, f) => n + f.bytes, 0) + 16 * 1024 ** 2 },
        signal: AbortSignal.any([this.abort.signal, ...(signal ? [signal] : [])]),
      });
      let total = 0;
      for (const f of t.plan.files) {
        const parts: Buffer[] = [];
        let offset = 0;
        do {
          signal?.throwIfAborted();
          const r = await this.call(t, f.path, offset, Math.min(128 * 1024, f.bytes - offset), signal);
          if (r.sha256 !== f.sha256 || r.bytes !== f.bytes) fail('SOURCE_CHANGED', '捕获字节与预览不同');
          const bytes = Buffer.from(r.data, 'base64');
          if (bytes.length !== Math.min(128 * 1024, f.bytes - offset))
            fail('SOURCE_CHANGED', '捕获分块不完整');
          parts.push(bytes);
          offset += bytes.length;
        } while (offset < f.bytes);
        const bytes = Buffer.concat(parts);
        if (sha(bytes) !== f.sha256) fail('SOURCE_CHANGED', '捕获摘要失败');
        total += bytes.length;
        if (total > t.request.maxBytes) fail('EXTRACT_LIMIT', '捕获超过预算');
        t.files.get(f.path)!.data = bytes;
      }
      await this.check(t);
      t.ready = true;
      return capturePlanSchema.parse(t.plan);
    } catch (e) {
      t.lease?.release();
      this.tickets.delete(p.planToken);
      throw e;
    }
  }
  async readCaptured(token: string, path: string, offset: number, length: number) {
    z.string().uuid().parse(token);
    capturePathSchema.parse(path);
    z.number().int().min(0).parse(offset);
    z.number()
      .int()
      .min(1)
      .max(256 * 1024)
      .parse(length);
    const t = this.tickets.get(token);
    if (!t || !t.ready) fail('PLAN_EXPIRED', '完整固定副本尚不可读取');
    await this.check(t);
    const data = t.files.get(path)?.data;
    if (!data || offset > data.length) fail('SOURCE_CHANGED', '固定副本不可读取');
    const part = data.subarray(offset, offset + length);
    await t.check();
    return { data: part.toString('base64'), offset, eof: offset + part.length === data.length };
  }
  async releaseCapture(token: string) {
    const t = this.tickets.get(token);
    if (t && t.binding !== binding()) fail('SOURCE_USE_REVOKED', '只能归还原消费者的捕获票据', 403);
    t?.lease?.release();
    this.tickets.delete(token);
  }
  async close() {
    this.abort.abort();
    await Promise.allSettled([...this.pending]);
    for (const t of this.tickets.values()) t.lease?.release();
    this.tickets.clear();
  }
}
