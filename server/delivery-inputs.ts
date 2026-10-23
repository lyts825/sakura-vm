/** 捕获完整源码清单、已审阅定义及声明环境；不改变用户索引或分支。
 * Captures complete source manifests, reviewed definitions and declared environments without modifying the index or branch. */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import {
  deliveryDefinitionSchema,
  deliveryScopeSchema,
  type DeliveryScope,
  type DeliveryDefinition,
  type DeliveryFile,
} from '../shared/contracts/delivery-common.ts';
import {
  deliveryInputSchema,
  type DeliveryInputPlan,
  type DeliveryInputSnapshot,
} from '../shared/contracts/delivery-storage.ts';
import type { DeliveryArtifactsV1, DeliveryInputsV1 } from './service-contracts/delivery-storage.ts';
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { VmAccess } from './vm-access.ts';
import { GitProjectTasks, type GitProjectCapture } from './git-project-task.ts';
import { deliveryHash, deliveryPaths } from './delivery-artifacts.ts';
import { deliverySourceProgram } from './delivery-source-program.ts';
import { quote } from './shell.ts';
import { distroInfo } from './images.ts';
import { storageRuntime } from './storage-runtime.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import type { FoundryCatalogV1 } from './service-contracts/foundry.ts';

const fileSchema = z
  .object({
    path: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative(),
    mode: z.number().int(),
  })
  .strict();
const pageSchema = z
  .object({
    files: z.array(fileSchema),
    count: z.number().int().min(0).max(10000),
    totalBytes: z
      .number()
      .int()
      .max(2 ** 30),
    commit: z.string().nullable(),
    identity: z.string(),
    excluded: z.array(z.string()),
    changes: z.array(z.object({ path: z.string(), status: z.string() }).strict()),
  })
  .strict();
const stateSchema = z.object({ schemaVersion: z.literal(1), inputs: z.array(deliveryInputSchema) }).strict();
type Plan = { view: DeliveryInputPlan; capture: GitProjectCapture; identity: string };
/** 比较实例与项目组成的完整范围。Compare the complete VM/project scope. */
const same = (a: DeliveryScope, b: DeliveryScope) => a.vmId === b.vmId && a.projectId === b.projectId;

export class DeliveryInputs implements DeliveryInputsV1 {
  private tasks: GitProjectTasks;
  private plans = new Map<string, Plan>();
  private controller = new AbortController();
  /** 绑定元数据、制品和项目任务；缺省授权仍要求当前项目匹配。
   * Bind metadata, artifacts and project tasks; fallback authorization still requires the current project to match. */
  constructor(
    private metadata: PluginMetadata,
    private artifacts: DeliveryArtifactsV1,
    machines: VmAccess,
    private workspaces: WorkspacesV1,
    private authorizeScope?: (scope: DeliveryScope) => void | Promise<void>,
    private images?: ImageAssetsV1,
    private catalog?: () => FoundryCatalogV1 | undefined,
  ) {
    this.tasks = new GitProjectTasks(machines, workspaces);
  }
  /** 核对 scope 及服务生命周期，再调用宿主授权或严格当前项目检查。
   * Check scope and service lifetime before host authorization or the strict current-project check. */
  private async authorize(scope: DeliveryScope) {
    deliveryScopeSchema.parse(scope);
    this.controller.signal.throwIfAborted();
    if (this.authorizeScope) await this.authorizeScope(scope);
    else if (this.workspaces.projects.current(scope.vmId) !== scope.projectId)
      throw new AppError('当前项目授权与输入范围不一致', 403);
  }
  /** 解析持久快照并携带修订，未知格式拒绝读取。Parse persisted snapshots with their revision, refusing unknown formats. */
  private async state() {
    const state = await this.metadata.read();
    return {
      value:
        state.value == null
          ? { schemaVersion: 1 as const, inputs: [] as DeliveryInputSnapshot[] }
          : stateSchema.parse(state.value),
      revision: state.revision,
    };
  }
  /** 授权后读取本项目输入，不访问源实例。List authorized project inputs without accessing the source VM. */
  async list(scope: DeliveryScope) {
    await this.authorize(scope);
    return (await this.state()).value.inputs.filter((input) => same(input.scope, scope));
  }
  /** 返回指定输入，范围内不存在时报告 404。Return the selected input or report 404 when absent from scope. */
  async get(scope: DeliveryScope, id: string) {
    const item = (await this.list(scope)).find((input) => input.id === id);
    if (!item) throw new AppError('当前项目中不存在此输入快照', 404);
    return item;
  }
  /** 核对原项目身份，在项目 UID 执行固定只读程序并解析 JSON。
   * Recheck the original project identity, run the fixed read-only program as project UID, and parse JSON. */
  private async call(
    captured: GitProjectCapture,
    definition: DeliveryDefinition,
    extra: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    await this.tasks.assertCurrent(captured.id, signal);
    const payload = Buffer.from(
      JSON.stringify({
        root: captured.project.directory,
        mode: definition.source.mode,
        ref: definition.source.ref,
        paths: definition.source.paths,
        ...extra,
      }),
    ).toString('base64');
    const program = deliverySourceProgram.replace(
      'p=json.load(sys.stdin)',
      `p=json.loads(base64.b64decode('${payload}'))`,
    );
    if (Buffer.byteLength(program) > 60000)
      throw new AppError('所选路径清单超过单次受保护任务边界，请缩小选择范围', 413);
    const result = await this.tasks.exec(
      captured.id,
      '/usr/bin/python3 -I -S -c ' + quote(program),
      120000,
      signal,
    );
    if (result.code !== 0)
      throw new AppError(
        '源码捕获被拒绝；需要系统 Git、Python 3、普通文件及已取得的对象。' + result.stderr.slice(-1000),
        409,
        'DELIVERY_SOURCE_REFUSED',
      );
    return JSON.parse(result.stdout) as unknown;
  }
  /** 分页读取全部源码记录，拒绝页间身份变化和路径冲突。
   * Read all source records in pages, rejecting identity changes between pages and conflicting paths. */
  private async inspect(captured: GitProjectCapture, definition: DeliveryDefinition, signal?: AbortSignal) {
    const first = pageSchema.parse(
      await this.call(captured, definition, { action: 'inspect', start: 0 }, signal),
    );
    const files = [...first.files];
    for (let start = files.length; start < first.count; start += 256) {
      const page = pageSchema.parse(
        await this.call(captured, definition, { action: 'inspect', start }, signal),
      );
      if (page.identity !== first.identity || page.count !== first.count || !page.files.length)
        throw new AppError('捕获期间源码发生变化', 409);
      files.push(...page.files);
    }
    deliveryPaths(files);
    return { ...first, files };
  }
  /** 流式核验默认和矩阵镜像，将实际摘要固定到此次定义副本。
   * Stream-verify default and matrix images, pinning actual digests in this definition copy. */
  private async resolveEnvironment(definition: DeliveryDefinition, signal?: AbortSignal) {
    for (const environment of [
      definition.environment,
      ...definition.matrix.map((cell) => cell.environment),
    ]) {
      if (environment.foundry) {
        const catalog = this.catalog?.();
        if (!catalog) throw new AppError('所选工坊目录不可用，请重新审阅镜像选择', 503);
        const use = await catalog.previewUse(
          { workspaceId: environment.foundry.workspaceId },
          environment.foundry.id,
        );
        if (
          !environment.imageRef ||
          use.revisionDigest !== environment.foundry.revisionDigest ||
          use.imageRef.assetId !== environment.imageRef.assetId ||
          use.imageRef.digest !== environment.imageRef.digest
        )
          throw new AppError('工坊发布修订已经变化，请重新审阅', 409);
      }
      if (environment.imageRef) {
        if (!this.images) throw new AppError('镜像资产服务不可用；不会替换所选镜像', 503);
        const asset = await this.images.verify(environment.imageRef);
        if (
          asset.distro !== environment.distro ||
          asset.architecture !== environment.architecture ||
          (environment.imageSha256 && environment.imageSha256 !== asset.digest)
        )
          throw new AppError('镜像资产与已审阅环境不一致', 409);
        environment.imageSha256 = asset.digest;
        continue;
      }
      const image = distroInfo(environment.distro, environment.architecture),
        info = await lstat(image.file);
      if (!info.isFile() || info.isSymbolicLink())
        throw new AppError('请先准备所选发行版和架构的基础镜像', 409);
      const sha256 = await storageRuntime.run(
        {
          owner: 'delivery-inputs',
          taskId: randomUUID(),
          label: '固定交付镜像摘要',
          paths: [image.file],
          mode: 'read',
          buffers: 1,
          files: 1,
          signal,
        },
        async () => {
          const hash = createHash('sha256');
          for await (const bytes of createReadStream(image.file, { signal })) hash.update(bytes);
          return hash.digest('hex');
        },
      );
      const after = await lstat(image.file);
      if (
        after.ino !== info.ino ||
        after.dev !== info.dev ||
        after.size !== info.size ||
        after.mtimeMs !== info.mtimeMs
      )
        throw new AppError('捕获期间镜像发生变化', 409);
      if (environment.imageSha256 && environment.imageSha256 !== sha256)
        throw new AppError('基础镜像与已审阅摘要不一致', 409);
      environment.imageSha256 = sha256;
    }
  }
  /** 捕获项目身份并生成五分钟内有效的源码、定义和镜像预览，不封存内容。
   * Capture project identity and preview source, definition and images for five minutes without sealing content. */
  async preview(
    scope: DeliveryScope,
    input: { definition: DeliveryDefinition; reviewedDraft?: boolean },
    external?: AbortSignal,
  ) {
    await this.authorize(scope);
    const signal = AbortSignal.any([this.controller.signal, ...(external ? [external] : [])]);
    const definition = deliveryDefinitionSchema.parse(input.definition);
    if (definition.source.mode === 'draft' && !input.reviewedDraft)
      throw new AppError('草稿捕获需要明确审阅未提交文件', 400);
    for (const [id, plan] of this.plans)
      if (Date.parse(plan.view.expiresAt) <= Date.now()) this.plans.delete(id);
    if (this.plans.size >= 32) throw new AppError('输入预览数量已达上限', 429);
    await this.resolveEnvironment(definition, signal);
    const captured = await this.tasks.capture(scope.vmId);
    if (captured.projectId !== scope.projectId) throw new AppError('项目已变化', 409);
    return this.tasks.runCaptured(captured, signal, async () => {
      const source = await this.inspect(captured, definition, signal),
        token = randomUUID();
      if (!source.files.length) throw new AppError('所选输入未包含可交付文件', 400);
      const view: DeliveryInputPlan = {
        token,
        scope,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        mode: definition.source.mode,
        ...(source.commit ? { commit: source.commit } : {}),
        projectVersion: captured.version,
        files: source.files,
        excluded: source.excluded,
        changes: source.changes,
        totalBytes: source.totalBytes,
        definition,
      };
      this.plans.set(token, { view, capture: captured, identity: source.identity });
      return structuredClone(view);
    });
  }
  /** 消费预览令牌，按原身份传输完整源码，清理任务后才发布输入快照。
   * Consume the preview token, transfer complete source under the original identity, and publish only after task cleanup.
   * 设计思路 / Design：先后两次复核源码与索引，镜像也按预览摘要重检；
   * recheck source and index before and after transfer, and recheck images against preview digests.
   * 失败保留未引用内容；发布前保留业务引用，再以修订与授权检查提交快照。
   * Failures retain unreferenced bytes; publication retains the business reference before revision- and authorization-checked commit. */
  async capture(scope: DeliveryScope, input: { token: string }, external?: AbortSignal) {
    await this.authorize(scope);
    const plan = this.plans.get(input.token);
    this.plans.delete(input.token);
    if (!plan || !same(plan.view.scope, scope) || Date.parse(plan.view.expiresAt) <= Date.now())
      throw new AppError('输入计划已过期或使用', 409);
    const signal = AbortSignal.any([this.controller.signal, ...(external ? [external] : [])]);
    const result = await this.tasks.runCaptured(plan.capture, signal, async () => {
      const definition = structuredClone(plan.view.definition);
      if (plan.view.commit) definition.source.ref = plan.view.commit;
      await this.resolveEnvironment(definition, signal);
      const before = await this.inspect(plan.capture, definition, signal);
      if (before.identity !== plan.identity) throw new AppError('源文件或索引已变化，请重新预览', 409);
      const files: DeliveryFile[] = [];
      for (const file of before.files) {
        signal.throwIfAborted();
        const upload = await this.artifacts.begin(scope, { sha256: file.sha256, bytes: file.bytes });
        for (let offset = 0; offset < file.bytes;) {
          const chunk = z
            .object({ file: fileSchema, data: z.string() })
            .strict()
            .parse(
              await this.call(plan.capture, definition, { action: 'read', path: file.path, offset }, signal),
            );
          if (JSON.stringify(chunk.file) !== JSON.stringify(file))
            throw new AppError('捕获期间文件内容发生变化', 409);
          const bytes = Buffer.from(chunk.data, 'base64').length;
          if (!bytes) throw new AppError('源码分块缺失', 409);
          const written = await this.artifacts.chunk(scope, upload.id, offset, chunk.data);
          offset = written.offset;
        }
        const blob = await this.artifacts.complete(scope, upload.id);
        files.push({ ...file, blobId: blob.blobId });
      }
      const after = await this.inspect(plan.capture, definition, signal);
      if (after.identity !== plan.identity)
        throw new AppError('捕获结束时源码或索引已变化，已传输内容保留为未引用制品', 409);
      return { files, definition };
    });
    // 原项目任务确认清理后才发布快照。Publish only after the original project task confirms cleanup.
    await this.authorize(scope);
    const manifest = await this.artifacts.seal(scope, {
      label: plan.view.definition.name + ' · 输入',
      kind: 'source',
      files: result.files,
    });
    const { value, revision } = await this.state(),
      id = randomUUID();
    const content = {
      scope,
      manifestId: manifest.id,
      manifestDigest: manifest.digest,
      definition: result.definition,
      projectVersion: plan.view.projectVersion,
      mode: plan.view.mode,
      ...(plan.view.commit ? { commit: plan.view.commit } : {}),
      environmentEvidence: {
        status: 'declared' as const,
        explanation: '环境要求已固定；实际工具、镜像和依赖须由本次隔离执行核验，尚不构成可复现证明。',
      },
    };
    const snapshot = deliveryInputSchema.parse({
      ...content,
      id,
      digest: deliveryHash(content),
      createdAt: new Date().toISOString(),
    });
    await this.artifacts.retain(scope, manifest.id, 'input:' + id);
    for (const environment of [
      snapshot.definition.environment,
      ...snapshot.definition.matrix.map((c) => c.environment),
    ])
      if (environment.imageRef) {
        if (!this.images) throw new AppError('镜像资产服务不可用', 503);
        await this.images.retain(environment.imageRef, 'delivery-inputs:' + id);
      }
    value.inputs.push(snapshot);
    await this.authorize(scope);
    await this.metadata.replace(value, {
      expectedRevision: revision,
      beforeCommit: () => this.authorize(scope),
    });
    return snapshot;
  }
  /** 比较已授权输入的路径、摘要、权限和定义，返回差异分类。
   * Compare paths, digests, modes and definitions of authorized inputs and return categorized differences. */
  async compare(scope: DeliveryScope, leftId: string, rightId: string) {
    const [left, right] = await Promise.all([this.get(scope, leftId), this.get(scope, rightId)]);
    const [a, b] = await Promise.all([
      this.artifacts.get(scope, left.manifestId),
      this.artifacts.get(scope, right.manifestId),
    ]);
    const old = new Map(a.files.map((file) => [file.path, file])),
      current = new Map(b.files.map((file) => [file.path, file]));
    return {
      added: b.files.filter((file) => !old.has(file.path)).map((file) => file.path),
      removed: a.files.filter((file) => !current.has(file.path)).map((file) => file.path),
      changed: b.files
        .filter(
          (file) =>
            old.has(file.path) &&
            (old.get(file.path)!.sha256 !== file.sha256 || old.get(file.path)!.mode !== file.mode),
        )
        .map((file) => file.path),
      definitionChanged: deliveryHash(left.definition) !== deliveryHash(right.definition),
    };
  }
  /** 取消本服务任务并清理预览，等待项目任务关闭。
   * Cancel service tasks, discard previews, and wait for project tasks to close. */
  async close() {
    this.controller.abort();
    this.plans.clear();
    await this.tasks.close();
  }
}
