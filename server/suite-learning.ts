/** 自学内容、文件材料和检查定义；实际文件动作由固定工具会话执行。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as L from '../shared/contracts/learning-lab.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import {
  SuiteRoot,
  SuiteStore,
  suiteActor,
  suiteHash,
  suiteSha,
  suiteFail,
  type SuiteAuthorize,
} from './suite-store.ts';
import { SuiteMaterials } from './suite-materials.ts';
import { readSuiteText } from './suite-compute.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
import { imageAssetSchema } from '../shared/contracts/image-assets.ts';

export const learningScope = (s: S.SuiteScope) => ({ workspaceId: s.workspaceId });
export const learningRef = (r: S.SuiteRecord): S.SuiteRef => ({
  domain: r.domain,
  id: r.id,
  revision: r.revision,
});
export const learningPin = (s: S.SuiteScope, r: S.SuiteRef) => ({
  ...learningScope(s),
  id: r.id,
  revision: r.revision,
});
export const learningJson = (v: unknown) => S.suiteJson.parse(v);
export type LearningPeers = Readonly<Record<string, S.SuiteRecordsV1>>;
export function learningLocal(r: S.SuiteRecord, domain: string) {
  if (r.domain !== domain || r.origin !== 'local' || r.state !== 'sealed')
    suiteFail('LEARNING_LOCAL_REQUIRED', '需要本机封存的固定对象；外来学习声明不能转成成绩');
  return r;
}
export class LearningDomain extends SuiteStore {
  constructor(
    id: string,
    m: PluginMetadata,
    a: SuiteAuthorize,
    root: S.SuiteWorkspacePortV1,
    peers: LearningPeers,
  ) {
    super(id, m, a, root, peers);
  }
  protected override access(s?: S.SuiteScope) {
    return super.access(s ? learningScope(s) : undefined);
  }
  override fixed(s: S.SuiteScope, r: S.SuiteRef, imported = false) {
    return super.fixed(learningScope(s), r, imported);
  }
  protected async native<T>(s: S.SuiteScope, r: S.SuiteRef, domain: string, schema: z.ZodType<T>) {
    const row = learningLocal(await this.fixed(s, r), domain);
    return { row, value: schema.parse(row.content) };
  }
  protected result(
    s: S.SuiteScope,
    name: string,
    content: unknown,
    references: S.SuiteRef[],
    prior?: S.SuiteRecord,
  ) {
    return this.put(
      {
        ...learningScope(s),
        name,
        content: learningJson(content),
        references,
        ...(prior ? { id: prior.id, expectedRevision: prior.revision } : {}),
      },
      'result',
      true,
    );
  }
}
export class LearningCourses extends SuiteRoot {
  constructor(m: PluginMetadata, a: SuiteAuthorize, lessons: () => S.SuiteRecordsV1) {
    super('learning-courses', m, a, 64 * 1024 ** 3);
    Object.defineProperty(this.peers, 'learning-lessons', { enumerable: true, get: lessons });
  }
  async create(raw: z.infer<typeof L.learningCreateCourse>) {
    const i = L.learningCreateCourse.parse(raw),
      workspace = i.workspaceId
        ? await this.workspace(learningScope(i as S.SuiteScope))
        : await this.createWorkspace({ name: i.name });
    const course = await this.put(
      {
        workspaceId: workspace.id,
        name: i.name,
        references: [],
        content: learningJson({
          format: 'sakura-learning-course/1',
          title: i.title,
          description: i.description,
          status: 'draft',
          lessons: [],
          selfStudyOnly: true,
        }),
      },
      'result',
      true,
    );
    return { workspace, course };
  }
  async sealCourse(raw: z.infer<typeof L.learningSealCourse>) {
    const i = L.learningSealCourse.parse(raw),
      s = learningScope(i),
      row = learningLocal(await this.get(learningPin(s, i.course)), this.domain),
      value = L.learningCourse.parse(row.content);
    if (value.status !== 'draft') suiteFail('LEARNING_COURSE_ALREADY_READY');
    const keys = new Set<string>();
    let count = 0;
    for (const r of i.lessons) {
      const lesson = L.learningLesson.parse(
        learningLocal(await this.fixed(s, r), 'learning-lessons').content,
      );
      if (
        suiteHash(lesson.course) !== suiteHash(i.course) ||
        keys.has(lesson.key) ||
        lesson.prerequisites.some((p) => !keys.has(p))
      )
        suiteFail('LEARNING_LESSON_ORDER', '课程必须按无环先修顺序包含独立课节');
      keys.add(lesson.key);
      count++;
    }
    if (count !== new Set(i.lessons.map(suiteHash)).size) suiteFail('LEARNING_DUPLICATE_LESSON');
    return this.put(
      {
        ...s,
        id: row.id,
        expectedRevision: row.revision,
        name: row.name,
        references: i.lessons,
        content: learningJson({ ...value, status: 'ready', lessons: i.lessons }),
      },
      'result',
      true,
    );
  }
}
export class LearningAssets extends SuiteMaterials {
  constructor(
    m: PluginMetadata,
    u: PluginMetadata,
    a: SuiteAuthorize,
    root: S.SuiteWorkspacePortV1,
    private imagesPort: ImageAssetsV1,
  ) {
    super('learning-assets', m, u, a, 64 * 1024 ** 3, 8 * 1024 ** 2, ['json'], root);
  }
  async images() {
    await this.access();
    const rows = await this.imagesPort.list();
    if (rows.length > 1000) suiteFail('LEARNING_IMAGES_LIMIT');
    return rows.map((r) => imageAssetSchema.parse(r));
  }
  async upload(raw: z.input<typeof L.learningUpload>) {
    const i = L.learningUpload.parse(raw),
      bytes = Buffer.from(JSON.stringify({ format: 'sakura-learning-files/1', files: i.files })),
      s = learningScope(i),
      u = await this.beginUpload({
        ...s,
        name: i.name,
        format: 'json',
        bytes: bytes.length,
        digest: suiteSha(bytes),
        allowExport: i.allowExport,
      });
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
      await this.appendUpload({
        ...s,
        id: u.id,
        offset,
        data: bytes.subarray(offset, offset + 512 * 1024).toString('base64'),
      });
    return this.finishUpload({ ...s, id: u.id });
  }
  async files(raw: S.SuitePin) {
    const i = S.suitePin.parse(raw),
      row = learningLocal(await this.get(i), this.domain),
      asset = L.learningAsset.parse(row.content),
      source = await this.get(learningPin(i, asset.source)),
      material = S.suiteMaterial.parse(source.content);
    if (material.digest !== asset.sourceDigest) suiteFail('LEARNING_ASSET_DIGEST');
    return L.learningFiles.parse(
      parseSuiteJson((await readSuiteText(this, learningScope(i), asset.source, 8 * 1024 ** 2)).text),
    );
  }
  async pin(raw: z.infer<typeof L.learningPinAsset>) {
    const i = L.learningPinAsset.parse(raw),
      s = learningScope(i);
    if (i.source.domain !== this.domain) suiteFail('LEARNING_SOURCE_DOMAIN');
    const source = await this.get(learningPin(s, i.source)),
      material = S.suiteMaterial.parse(source.content),
      files = L.learningFiles.parse(
        parseSuiteJson((await readSuiteText(this, s, i.source, 8 * 1024 ** 2)).text),
      );
    await this.imagesPort.verify(i.image);
    return this.put(
      {
        ...s,
        name: i.name,
        references: [i.source],
        content: learningJson({
          format: 'sakura-learning-asset/1',
          source: i.source,
          sourceDigest: material.digest,
          image: i.image,
          paths: files.files.map((f) => f.path),
          bytes: files.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0),
        }),
      },
      'result',
      true,
    );
  }
}
export class LearningLessons extends LearningDomain {
  async compile(raw: z.infer<typeof L.learningCompileLesson>) {
    const i = L.learningCompileLesson.parse(raw),
      course = await this.native(i, i.course, 'learning-courses', L.learningCourse);
    await this.native(i, i.asset, 'learning-assets', L.learningAsset);
    if (
      course.value.status !== 'draft' ||
      i.prerequisites.includes(i.key) ||
      new Set(i.prerequisites).size !== i.prerequisites.length
    )
      suiteFail('LEARNING_LESSON_DEFINITION');
    return this.result(
      i,
      i.name,
      {
        format: 'sakura-learning-lesson/1',
        course: i.course,
        asset: i.asset,
        key: i.key,
        title: i.title,
        body: i.body,
        prerequisites: i.prerequisites,
      },
      [i.course, i.asset],
    );
  }
}
export class LearningSteps extends LearningDomain {
  async compile(raw: z.input<typeof L.learningCompileSteps>) {
    const i = L.learningCompileSteps.parse(raw);
    await this.native(i, i.lesson, 'learning-lessons', L.learningLesson);
    return this.result(i, i.name, { format: 'sakura-learning-steps/1', lesson: i.lesson, steps: i.steps }, [
      i.lesson,
    ]);
  }
}
export class LearningChecks extends LearningDomain {
  async compile(raw: z.infer<typeof L.learningCompileChecks>) {
    const i = L.learningCompileChecks.parse(raw);
    await this.native(i, i.lesson, 'learning-lessons', L.learningLesson);
    return this.result(
      i,
      i.name,
      {
        format: 'sakura-learning-checks/1',
        lesson: i.lesson,
        rules: i.rules,
        coverage: 'fixed-local-tool-checks',
      },
      [i.lesson],
    );
  }
  async explain(raw: S.SuitePin) {
    const row = await this.get(S.suitePin.parse(raw));
    L.learningChecks.parse(row.content);
    return row;
  }
}
type Assets = S.SuiteRecordsV1 & { files(i: S.SuitePin): Promise<z.infer<typeof L.learningFiles>> };
export class LearningEnvironments extends LearningDomain {
  constructor(
    m: PluginMetadata,
    a: SuiteAuthorize,
    root: S.SuiteWorkspacePortV1,
    peers: LearningPeers,
    private assets: Assets,
  ) {
    super('learning-environments', m, a, root, peers);
  }
  async prepare(raw: z.infer<typeof L.learningPrepare>) {
    const i = L.learningPrepare.parse(raw),
      c = await this.native(i, i.course, 'learning-courses', L.learningCourse),
      asset = await this.native(i, i.asset, 'learning-assets', L.learningAsset);
    if (c.value.status !== 'ready') suiteFail('LEARNING_COURSE_NOT_READY');
    for (const lesson of c.value.lessons) {
      const v = await this.native(i, lesson, 'learning-lessons', L.learningLesson);
      if (suiteHash(v.value.asset) !== suiteHash(i.asset)) suiteFail('LEARNING_ASSET_MISMATCH');
    }
    const snapshot = (await this.assets.files(learningPin(i, i.asset))).files;
    return this.result(
      i,
      i.name,
      {
        format: 'sakura-learning-environment/1',
        course: i.course,
        asset: i.asset,
        image: asset.value.image,
        snapshot,
        snapshotDigest: suiteHash(snapshot),
        demo: { running: false, data: null },
        fromCheckpoint: null,
        preparation: 'fixed-input-definition',
        executionStarted: false,
      },
      [i.course, i.asset],
    );
  }
  async checkpoint(raw: z.infer<typeof L.learningCheckpointInput>) {
    const i = L.learningCheckpointInput.parse(raw),
      r = await this.native(i, i.session, 'learning-sessions', L.learningSession),
      v = r.value;
    if (v.pending || v.cleanup !== 'confirmed' || !v.attempts.some((a) => a.result?.completed))
      suiteFail('LEARNING_CHECKPOINT_UNSETTLED');
    const env = await this.native(i, v.environment, this.domain, L.learningEnvironment);
    const existing = (await this.readState()).rows.filter(
      (row) =>
        row.actor === suiteActor() &&
        row.workspaceId === i.workspaceId &&
        L.learningCheckpoint.safeParse(row.content).success,
    );
    if (existing.length >= 5)
      suiteFail('LEARNING_CHECKPOINT_LIMIT', '每个空间最多保留 5 个检查点，请先清理旧记录');
    return this.result(
      i,
      i.name,
      {
        format: 'sakura-learning-checkpoint/1',
        session: i.session,
        course: v.course,
        asset: env.value.asset,
        image: env.value.image,
        snapshot: v.snapshot,
        snapshotDigest: v.snapshotDigest,
        demo: v.demo,
        originalAttempt: r.row.id,
        progressTransferred: false,
      },
      [i.session, v.course, env.value.asset],
    );
  }
  async restore(raw: z.infer<typeof L.learningRestore>) {
    const i = L.learningRestore.parse(raw),
      c = await this.native(i, i.checkpoint, this.domain, L.learningCheckpoint),
      v = c.value;
    return this.result(
      i,
      i.name,
      {
        format: 'sakura-learning-environment/1',
        course: v.course,
        asset: v.asset,
        image: v.image,
        snapshot: v.snapshot,
        snapshotDigest: v.snapshotDigest,
        demo: v.demo,
        fromCheckpoint: i.checkpoint,
        preparation: 'fixed-input-definition',
        executionStarted: false,
      },
      [i.checkpoint, v.course, v.asset],
    );
  }
}
export class LearningProgress extends LearningDomain {
  async summarize(raw: z.infer<typeof L.learningProgressInput>) {
    const i = L.learningProgressInput.parse(raw),
      course = await this.native(i, i.course, 'learning-courses', L.learningCourse),
      port = this.peers['learning-sessions'],
      attempts = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
      const page = await port.list({ ...learningScope(i), cursor, limit: 100, history: false });
      for (const row of page.items) {
        const value = L.learningSession.safeParse(row.content);
        if (row.origin !== 'local' || !value.success || suiteHash(value.data.course) !== suiteHash(i.course))
          continue;
        attempts.push({
          session: learningRef(row),
          status: value.data.status,
          completed: value.data.completedLessons.length,
          total: course.value.lessons.length,
          outcome: value.data.outcome,
        });
        if (attempts.length > 100) suiteFail('LEARNING_PROGRESS_LIMIT', '课程尝试超过 100 条，请先清理');
      }
      cursor = page.next;
    }
    return this.result(
      i,
      '课程进度',
      {
        format: 'sakura-learning-progress/1',
        course: i.course,
        actor: suiteActor(),
        attempts,
        certification: false,
      },
      [i.course, ...attempts.map((a) => a.session)],
    );
  }
  async compare(raw: z.infer<typeof L.learningCompare>) {
    const i = L.learningCompare.parse(raw),
      left = await this.native(i, i.left, this.domain, L.learningProgress),
      right = await this.native(i, i.right, this.domain, L.learningProgress);
    if (
      suiteHash(left.value.course) !== suiteHash(right.value.course) ||
      left.value.actor !== right.value.actor
    )
      suiteFail('LEARNING_PROGRESS_INCOMPARABLE');
    return this.result(
      i,
      '学习进度比较',
      {
        format: 'sakura-learning-progress-comparison/1',
        left: i.left,
        right: i.right,
        attemptDelta: right.value.attempts.length - left.value.attempts.length,
        certification: false,
      },
      [i.left, i.right],
    );
  }
}
export class LearningAssessments extends LearningDomain {
  async assess(raw: z.infer<typeof L.learningAssessmentInput>) {
    const i = L.learningAssessmentInput.parse(raw),
      session = await this.native(i, i.session, 'learning-sessions', L.learningSession),
      course = await this.native(i, session.value.course, 'learning-courses', L.learningCourse),
      v = session.value;
    return this.result(
      i,
      i.name,
      {
        format: 'sakura-learning-assessment/1',
        session: i.session,
        course: v.course,
        completed: v.completedLessons.length,
        total: course.value.lessons.length,
        outcome: v.pending || v.cleanup !== 'confirmed' ? 'inconclusive' : v.outcome,
        cleanup: v.cleanup,
        selfReview: null,
        status: 'review',
        certification: false,
        basis: 'actual-local-tool-checks',
      },
      [i.session, v.course],
    );
  }
  async selfReview(raw: z.infer<typeof L.learningSelfReview>) {
    const i = L.learningSelfReview.parse(raw),
      r = await this.native(i, i.assessment, this.domain, L.learningAssessment);
    if (r.value.status === 'sealed') suiteFail('LEARNING_ASSESSMENT_SEALED');
    return this.result(
      i,
      r.row.name,
      { ...r.value, selfReview: { actor: suiteActor(), note: i.note, completed: i.completed } },
      r.row.references,
      r.row,
    );
  }
  async sealAssessment(raw: z.infer<typeof L.learningSealAssessment>) {
    const i = L.learningSealAssessment.parse(raw),
      r = await this.native(i, i.assessment, this.domain, L.learningAssessment);
    if (r.value.status === 'sealed' || !r.value.selfReview || r.value.cleanup !== 'confirmed')
      suiteFail('LEARNING_ASSESSMENT_NOT_READY');
    return this.result(i, r.row.name, { ...r.value, status: 'sealed' }, r.row.references, r.row);
  }
}
