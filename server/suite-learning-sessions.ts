/** 每个步骤使用新隔离副本；保存实际快照，查询不重放动作。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as L from '../shared/contracts/learning-lab.ts';
import * as T from '../shared/contracts/suite-execution-learning.ts';
import * as E from '../shared/contracts/suite-execution.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { LearningToolSessionsV1 } from './service-contracts/suite-execution.ts';
import {
  LearningDomain,
  learningScope as scope,
  learningRef as ref,
  learningPin as pin,
  learningLocal,
  learningJson as json,
  type LearningPeers,
} from './suite-learning.ts';
import { suiteActor, suiteHash, suiteSha, suiteFail, type SuiteAuthorize } from './suite-store.ts';
const saved = z
  .object({
    provider: E.suiteExecutionPlan,
    action: T.learningAction,
    name: S.suiteName,
    course: S.suiteRef,
    environment: S.suiteRef,
    steps: z.array(S.suiteRef),
    checks: z.array(S.suiteRef),
    session: S.suiteRef.nullable(),
    lesson: S.suiteRef.nullable(),
    stepId: z.string().nullable(),
  })
  .strict();
export class LearningSessions extends LearningDomain {
  private operations = new Map<string, Promise<unknown>>();
  constructor(
    m: PluginMetadata,
    a: SuiteAuthorize,
    root: S.SuiteWorkspacePortV1,
    peers: LearningPeers,
    private tools: LearningToolSessionsV1,
  ) {
    super('learning-sessions', m, a, root, peers);
  }
  private exclusive<T>(id: string, work: () => Promise<T>) {
    const next = (this.operations.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    this.operations.set(id, next);
    void next
      .finally(() => {
        if (this.operations.get(id) === next) this.operations.delete(id);
      })
      .catch(() => {});
    return next;
  }
  async tool() {
    await this.access();
    return this.tools.tool();
  }
  private async executionPlan(s:S.SuiteScope,action:string,input:S.SuiteJson,references:S.SuiteRef[],provider:E.SuiteExecutionPlan){
    try{return await this.plan(s,action,input,references);}
    catch(error){
      // 发布领域计划失败时立即释放准备输入；本体仍保留未确认清理的原账本。
      try{await this.tools.discardPreview({...scope(s),planId:provider.id,digest:provider.digest});}
      catch(cleanup){throw new AggregateError([error,cleanup],'LEARNING_PREVIEW_CLEANUP_PENDING');}
      throw error;
    }
  }
  private async definitions(s: S.SuiteScope, course: S.SuiteRef, steps: S.SuiteRef[], checks: S.SuiteRef[]) {
    const c = await this.native(s, course, 'learning-courses', L.learningCourse);
    if (
      c.value.status !== 'ready' ||
      steps.length !== c.value.lessons.length ||
      checks.length !== c.value.lessons.length
    )
      suiteFail('LEARNING_COURSE_COVERAGE');
    const lessons = [],
      rules: z.infer<typeof T.learningCheck>[] = [];
    let actions = 0;
    for (let index = 0; index < c.value.lessons.length; index++) {
      const lesson = c.value.lessons[index],
        l = await this.native(s, lesson, 'learning-lessons', L.learningLesson),
        st = await this.native(s, steps[index], 'learning-steps', L.learningSteps),
        ch = await this.native(s, checks[index], 'learning-checks', L.learningChecks);
      if (
        suiteHash(st.value.lesson) !== suiteHash(lesson) ||
        suiteHash(ch.value.lesson) !== suiteHash(lesson)
      )
        suiteFail('LEARNING_LESSON_BINDING');
      const ids = ch.value.rules.map((rule, i) => 'lesson' + index + '-check' + i);
      rules.push(...ch.value.rules.map((rule, i) => ({ ...rule, id: ids[i] })));
      actions += st.value.steps.length;
      lessons.push({ ref: lesson, definition: l.value, steps: st.value.steps, checkIds: ids });
    }
    if (actions > 30 || rules.length > 30)
      suiteFail('LEARNING_COURSE_BUDGET', '一门课程最多 30 个步骤和 30 条检查');
    return { course: c, lessons, rules };
  }
  async preview(raw: z.infer<typeof L.learningPreview>) {
    const i = L.learningPreview.parse(raw),
      s = scope(i),
      d = await this.definitions(s, i.course, i.steps, i.checks),
      env = await this.native(s, i.environment, 'learning-environments', L.learningEnvironment);
    if (
      suiteHash(env.value.course) !== suiteHash(i.course) ||
      d.lessons.some((l) => suiteHash(l.definition.asset) !== suiteHash(env.value.asset))
    )
      suiteFail('LEARNING_ENVIRONMENT_BINDING');
    const input = T.learningWorkerInput.parse({
        protocol: 'sakura-learning-tool/1',
        snapshot: env.value.snapshot,
        demo: env.value.demo,
        action: { kind: 'list' },
        checks: d.rules,
      }),
      provider = await this.tools.preview({
        ...s,
        image: env.value.image,
        input,
        inputDigest: suiteHash(input),
        maxSeconds: 180,
      });
    return this.executionPlan(
      s,
      'learning-start',
      json({
        provider,
        action: input.action,
        name: i.name,
        course: i.course,
        environment: i.environment,
        steps: i.steps,
        checks: i.checks,
        session: null,
        lesson: null,
        stepId: null,
      }),
      [i.course, i.environment, ...i.steps, ...i.checks],
      provider,
    );
  }
  async previewStep(raw: z.infer<typeof L.learningStepInput>) {
    const i = L.learningStepInput.parse(raw),
      s = scope(i);
    return this.exclusive(i.session.id, async () => {
      const row = await this.inspectUnlocked({ ...s, session: i.session }),
        v = L.learningSession.parse(row.content);
      if (row.revision !== i.session.revision)
        suiteFail('LEARNING_SESSION_CHANGED', '会话已更新，请刷新后重新预览');
      if (v.pending || v.status !== 'active' || v.attempts.length >= 31)
        suiteFail('LEARNING_SESSION_NOT_ACTIVE');
      const d = await this.definitions(s, v.course, v.steps, v.checks),
        l = d.lessons.find((l) => suiteHash(l.ref) === suiteHash(i.lesson));
      if (!l) suiteFail('LEARNING_LESSON_NOT_SELECTED');
      if (
        l.definition.prerequisites.some(
          (key) =>
            !d.lessons.some(
              (other) =>
                other.definition.key === key &&
                v.completedLessons.some((r) => suiteHash(r) === suiteHash(other.ref)),
            ),
        )
      )
        suiteFail('LEARNING_PREREQUISITE');
      const step = l.steps.find((st) => st.id === i.stepId);
      if (!step) suiteFail('LEARNING_STEP_NOT_SELECTED');
      if ((i.content !== undefined && !step.editableContent) || (i.body !== undefined && !step.editableBody))
        suiteFail('LEARNING_FIELD_NOT_EDITABLE');
      const action = structuredClone(step.action);
      if (action.kind === 'write' && i.content !== undefined) action.content = i.content;
      if (action.kind === 'request' && i.body !== undefined) action.body = i.body;
      const env = await this.native(s, v.environment, 'learning-environments', L.learningEnvironment),
        input = T.learningWorkerInput.parse({
          protocol: 'sakura-learning-tool/1',
          snapshot: v.snapshot,
          demo: v.demo,
          action,
          checks: d.rules,
        }),
        provider = await this.tools.preview({
          ...s,
          image: env.value.image,
          input,
          inputDigest: suiteHash(input),
          maxSeconds: Math.max(1, Math.min(180, Math.floor((Date.parse(v.deadline) - Date.now()) / 1000))),
        });
      return this.executionPlan(
        s,
        'learning-step',
        json({
          provider,
          action: input.action,
          name: row.name,
          course: v.course,
          environment: v.environment,
          steps: v.steps,
          checks: v.checks,
          session: ref(row),
          lesson: i.lesson,
          stepId: i.stepId,
        }),
        [ref(row), v.course, v.environment, ...v.steps, ...v.checks],
        provider,
      );
    });
  }
  async start(raw: S.SuiteApproval) {
    return this.execute(raw, 'learning-start');
  }
  async step(raw: S.SuiteApproval) {
    return this.execute(raw, 'learning-step');
  }
  private async execute(raw: S.SuiteApproval, action: 'learning-start' | 'learning-step') {
    const i = S.suiteApproval.parse(raw),
      initial = await this.inspectPlan({ ...scope(i), planId: i.planId }),
      selected = saved.parse(initial.input);
    return this.exclusive(selected.session?.id ?? i.planId, async () => {
      const plan = await this.consume(i, action, true),
        p = saved.parse(plan.input);
      if (plan.result) return this.inspectUnlocked({ ...scope(i), session: plan.result });
      let prior: S.SuiteRecord | undefined, value: L.LearningSession | undefined;
      if (p.session) {
        prior = await this.inspectUnlocked({ ...scope(i), session: p.session });
        value = L.learningSession.parse(prior.content);
        if (prior.revision !== p.session.revision || value.pending || value.status !== 'active')
          suiteFail('LEARNING_SESSION_CHANGED');
      }
      const authorize = async () => {
        await this.access(scope(i));
        for (const guard of plan.permissions) {
          const row = await this.fixed(i, guard.ref);
          if (
            row.policyRevision !== guard.policyRevision ||
            (row.authorizationDigest ?? suiteHash(row.policyRevision)) !== guard.policyDigest
          )
            suiteFail('LEARNING_PERMISSION_CHANGED');
        }
      };
      const env = await this.native(i, p.environment, 'learning-environments', L.learningEnvironment);
      let original: S.SuiteRecord | undefined;
      const receipt = await this.tools.start(
        { ...scope(i), planId: p.provider.id, digest: p.provider.digest },
        async (challenge) => {
          await authorize();
          if (
            challenge.planId !== p.provider.id ||
            challenge.digest !== p.provider.digest ||
            challenge.inputDigest !== p.provider.inputDigest
          )
            suiteFail('LEARNING_EXECUTION_CHALLENGE');
          const now = new Date(),
            base =
              value ??
              L.learningSession.parse({
                format: 'sakura-learning-session/1',
                course: p.course,
                environment: p.environment,
                steps: p.steps,
                checks: p.checks,
                status: 'active',
                snapshot: env.value.snapshot,
                snapshotDigest: env.value.snapshotDigest,
                demo: env.value.demo,
                attempts: [],
                completedLessons: [],
                performed: [],
                pending: null,
                startedAt: now.toISOString(),
                updatedAt: now.toISOString(),
                idleExpiresAt: new Date(+now + 15 * 60e3).toISOString(),
                deadline: new Date(+now + 60 * 60e3).toISOString(),
                cleanup: 'confirmed',
                outcome: 'inconclusive',
                selfStudyOnly: true,
              });
          const next = L.learningSession.parse({
            ...base,
            pending: challenge.sessionId,
            cleanup: 'pending',
            updatedAt: now.toISOString(),
            attempts: [
              ...base.attempts,
              {
                sequence: base.attempts.length,
                lesson: p.lesson,
                stepId: p.stepId,
                coreId: challenge.sessionId,
                planDigest: p.provider.digest,
                inputDigest: p.provider.inputDigest,
                state: 'preparing',
                cleanup: 'pending',
                outcome: 'inconclusive',
                result: null,
                error: null,
              },
            ],
          });
          original = await this.result(
            i,
            p.name,
            next,
            [p.course, p.environment, ...p.steps, ...p.checks],
            prior,
          );
          await this.complete(plan, original);
          return { intentDigest: suiteHash({ record: ref(original), challenge }) };
        },
        authorize,
      );
      if (!original) {
        const done = await this.inspectPlan({ ...scope(i), planId: plan.id });
        if (!done.result) suiteFail('LEARNING_INTENT_MISSING');
        original = await this.get(pin(i, done.result));
      }
      return this.synchronize(i, original, receipt);
    });
  }
  async discardPreview(raw: S.SuiteApproval) {
    const i = S.suiteApproval.parse(raw),
      old = await this.inspectPlan({ ...scope(i), planId: i.planId });
    if (old.action !== 'learning-start' && old.action !== 'learning-step') suiteFail('LEARNING_PLAN_ACTION');
    const plan = await this.consume(i, old.action, true),
      p = saved.parse(plan.input);
    if (plan.result) suiteFail('LEARNING_PLAN_STARTED');
    await this.tools.discardPreview({ ...scope(i), planId: p.provider.id, digest: p.provider.digest });
    return this.inspectPlan({ ...scope(i), planId: i.planId });
  }
  private async readOutput(s: S.SuiteScope, r: E.SuiteExecutionReceipt) {
    if (!r.output) suiteFail('LEARNING_OUTPUT_MISSING');
    const parts: Buffer[] = [];
    for (let offset = 0; offset < r.output.bytes;) {
      const chunk = await this.tools.output({
          ...scope(s),
          id: r.id,
          offset,
          length: Math.min(512 * 1024, r.output.bytes - offset),
        }),
        data = Buffer.from(chunk.data, 'base64');
      if (
        !data.length ||
        chunk.offset !== offset + data.length ||
        chunk.total !== r.output.bytes ||
        chunk.digest !== r.output.digest
      )
        suiteFail('LEARNING_OUTPUT_CHANGED');
      parts.push(data);
      offset = chunk.offset;
    }
    const bytes = Buffer.concat(parts);
    if (suiteSha(bytes) !== r.output.digest) suiteFail('LEARNING_OUTPUT_DIGEST');
    return T.learningWorkerOutput.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  }
  private async synchronize(s: S.SuiteScope, row: S.SuiteRecord, r: E.SuiteExecutionReceipt) {
    const v = L.learningSession.parse(row.content);
    if (v.pending !== r.id || r.profile !== 'learning' || r.workspaceId !== row.workspaceId)
      suiteFail('LEARNING_CORE_IDENTITY');
    const next = structuredClone(v),
      a = next.attempts.at(-1)!;
    if (a.inputDigest !== r.inputDigest || a.planDigest === null) suiteFail('LEARNING_CORE_INPUT');
    a.state = r.state;
    a.cleanup = r.cleanup;
    a.outcome = r.outcome;
    a.error = r.error;
    next.cleanup = r.cleanup;
    if (r.cleanup === 'confirmed' && r.output && !a.result) {
      const result = await this.readOutput(s, r);
      if (result.sessionId !== r.id || result.inputDigest !== a.inputDigest)
        suiteFail('LEARNING_OUTPUT_IDENTITY');
      for (const file of result.snapshot) {
        if (suiteSha(file.content) !== file.digest || Buffer.byteLength(file.content) !== file.bytes)
          suiteFail('LEARNING_FILE_DIGEST');
      }
      const snapshot = result.snapshot.map(({ path, content }) => ({ path, content }));
      if (suiteHash(snapshot) !== result.snapshotDigest) suiteFail('LEARNING_SNAPSHOT_DIGEST');
      a.result = result;
      if (result.completed) {
        next.snapshot = snapshot;
        next.snapshotDigest = result.snapshotDigest;
        next.demo = result.demo;
        if (
          a.lesson &&
          a.stepId &&
          !next.performed.some((p) => suiteHash(p.lesson) === suiteHash(a.lesson) && p.stepId === a.stepId)
        )
          next.performed.push({ lesson: a.lesson, stepId: a.stepId });
        const d = await this.definitions(s, v.course, v.steps, v.checks);
        if (
          result.checks.length !== d.rules.length ||
          new Set(result.checks.map((c) => c.id)).size !== d.rules.length
        )
          suiteFail('LEARNING_CHECK_COVERAGE');
        next.completedLessons = d.lessons
          .filter(
            (l) =>
              l.steps.every((step) =>
                next.performed.some((p) => suiteHash(p.lesson) === suiteHash(l.ref) && p.stepId === step.id),
              ) && l.checkIds.every((id) => result.checks.some((c) => c.id === id && c.passed && !c.error)),
          )
          .map((l) => l.ref);
        next.outcome =
          next.completedLessons.length === d.lessons.length
            ? 'passed'
            : result.checks.some((c) => !c.passed)
              ? 'failed'
              : 'inconclusive';
        if (next.outcome === 'passed' && next.status === 'active') next.status = 'finished';
      } else next.outcome = 'inconclusive';
    }
    if (r.cleanup === 'confirmed' && !['preparing', 'running'].includes(r.state)) {
      next.pending = null;
      if (!a.result?.completed && next.status === 'active') next.status = 'interrupted';
      next.idleExpiresAt = new Date(Date.now() + 15 * 60e3).toISOString();
    }
    if (suiteHash(next) === suiteHash(v)) return row;
    next.updatedAt = new Date().toISOString();
    return this.result(s, row.name, L.learningSession.parse(next), row.references, row);
  }
  private async head(s: S.SuiteScope, r: S.SuiteRef) {
    await this.native(s, r, this.domain, L.learningSession);
    const rows = (await this.readState()).rows.filter(
      (row) => row.workspaceId === s.workspaceId && row.actor === suiteActor() && row.id === r.id,
    );
    const head = rows.at(-1) ?? suiteFail('LEARNING_SESSION_MISSING');
    return this.get(pin(s, ref(head)));
  }
  private async inspectUnlocked(raw: z.infer<typeof L.learningSessionSelection>) {
    const i = L.learningSessionSelection.parse(raw);
    let row = await this.head(i, i.session),
      v = L.learningSession.parse(row.content);
    if (v.pending) {
      row = await this.synchronize(i, row, await this.tools.inspect({ ...scope(i), id: v.pending }));
      v = L.learningSession.parse(row.content);
    }
    if (
      !v.pending &&
      v.status === 'active' &&
      (Date.parse(v.idleExpiresAt) <= Date.now() || Date.parse(v.deadline) <= Date.now())
    )
      row = await this.result(
        i,
        row.name,
        { ...v, status: 'paused', updatedAt: new Date().toISOString() },
        row.references,
        row,
      );
    return row;
  }
  async inspect(raw: z.infer<typeof L.learningSessionSelection>) {
    const i = L.learningSessionSelection.parse(raw);
    return this.exclusive(i.session.id, () => this.inspectUnlocked(i));
  }
  async reconcile(raw: z.infer<typeof L.learningSessionSelection>) {
    const i = L.learningSessionSelection.parse(raw);
    return this.exclusive(i.session.id, async () => {
      const row = await this.owned(i),
        v = L.learningSession.parse(row.content);
      if (v.pending) await this.tools.reconcile({ ...scope(i), id: v.pending });
      return this.inspectUnlocked({ ...scope(i), session: ref(row) });
    });
  }
  private async owned(i: z.infer<typeof L.learningSessionSelection>) {
    await this.access();
    const rows = (await this.readState()).rows.filter(
      (r) =>
        r.workspaceId === i.workspaceId &&
        r.actor === suiteActor() &&
        r.domain === i.session.domain &&
        r.id === i.session.id &&
        r.origin === 'local',
    );
    if (!rows.some((r) => r.revision === i.session.revision)) suiteFail('LEARNING_SESSION_NOT_OWNED');
    return rows.at(-1)!;
  }
  async cancel(raw: z.infer<typeof L.learningSessionSelection>) {
    const i = L.learningSessionSelection.parse(raw);
    return this.exclusive(i.session.id, async () => {
      let row = await this.owned(i),
        v = L.learningSession.parse(row.content);
      if (v.pending){
        const receipt=await this.tools.cancel({ ...scope(i), id: v.pending });
        row=await this.synchronize(i,row,receipt);
        v=L.learningSession.parse(row.content);
      }
      return this.result(
        i,
        row.name,
        { ...v, status: 'cancelled', updatedAt: new Date().toISOString() },
        row.references,
        row,
      );
    });
  }
  async pause(raw: z.infer<typeof L.learningSessionSelection>) {
    const i = L.learningSessionSelection.parse(raw);
    return this.exclusive(i.session.id, async () => {
      const row = await this.inspectUnlocked(i),
        v = L.learningSession.parse(row.content);
      if (v.pending || v.status !== 'active') suiteFail('LEARNING_PAUSE_STATE');
      return this.result(
        i,
        row.name,
        { ...v, status: 'paused', updatedAt: new Date().toISOString() },
        row.references,
        row,
      );
    });
  }
  async resume(raw: z.infer<typeof L.learningSessionSelection>) {
    const i = L.learningSessionSelection.parse(raw);
    return this.exclusive(i.session.id, async () => {
      const row = await this.inspectUnlocked(i),
        v = L.learningSession.parse(row.content);
      if (v.pending || v.status !== 'paused' || Date.parse(v.deadline) <= Date.now())
        suiteFail('LEARNING_RESUME_STATE', '会话已到期限，请从检查点创建新尝试');
      return this.result(
        i,
        row.name,
        {
          ...v,
          status: 'active',
          idleExpiresAt: new Date(Date.now() + 15 * 60e3).toISOString(),
          updatedAt: new Date().toISOString(),
        },
        row.references,
        row,
      );
    });
  }
  protected override async releaseOwned(s: S.SuiteScope, row: S.SuiteRecord) {
    const parsed = L.learningSession.safeParse(row.content);
    if (row.origin !== 'local' || !parsed.success) return;
    for (const a of parsed.data.attempts) {
      const r = await this.tools.inspect({ ...scope(s), id: a.coreId });
      if (r.cleanup !== 'confirmed') suiteFail('LEARNING_RESOURCES_RETAINED');
    }
    const retained = new Set(
      (await this.readState()).rows
        .filter(
          (other) =>
            other.id === row.id && other.workspaceId === row.workspaceId && other.revision !== row.revision,
        )
        .flatMap((other) => {
          const value = L.learningSession.safeParse(other.content);
          return value.success ? value.data.attempts.map((a) => a.coreId) : [];
        }),
    );
    for (const a of parsed.data.attempts)
      if (!retained.has(a.coreId)) await this.tools.release({ ...scope(s), id: a.coreId });
  }
  override async close() {
    await Promise.allSettled([...this.operations.values()]);
    await super.close();
  }
}
