/** 核验课程图、文件摘要和声明间一致性；不证明外来成绩或执行身份。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as L from '../shared/contracts/learning-lab.ts';
import { suitePortableClaim } from '../shared/contracts/suite-portable.ts';
import {
  verifySuiteGraph,
  offlineKey as key,
  offlineHash as hash,
  offlineSha as sha,
} from './suite-offline.ts';
export const learningSchemas: Record<string, z.ZodType> = {
  'learning-courses': L.learningCourse,
  'learning-assets': L.learningAsset,
  'learning-lessons': L.learningLesson,
  'learning-environments': z.union([L.learningEnvironment, L.learningCheckpoint]),
  'learning-steps': L.learningSteps,
  'learning-checks': L.learningChecks,
  'learning-sessions': L.learningSession,
  'learning-progress': L.learningProgress,
  'learning-assessments': L.learningAssessment,
};
export function verifyLearningBundle(bytes: Uint8Array) {
  const graph = verifySuiteGraph(
      bytes,
      'sakura-learning-lab/1',
      Object.keys(learningSchemas),
      'learning-assets',
    ),
    claims = new Map<string, unknown>();
  for (const row of graph.rows) {
    if (row.origin !== 'imported') throw new Error('LEARNING_PORTABLE_ORIGIN');
    if (row.kind === 'source') continue;
    claims.set(key(row), learningSchemas[row.domain].parse(suitePortableClaim.parse(row.content).claims));
  }
  const get = <T>(r: S.SuiteRef, schema: z.ZodType<T>, owner?: S.SuiteRecord) =>
    schema.parse(claims.get(key(graph.get(r, owner))));
  let reports = 0,
    sessions = 0;
  for (const row of graph.rows) {
    if (row.kind === 'source') continue;
    const value = claims.get(key(row));
    if (row.domain === 'learning-assets') {
      const a = L.learningAsset.parse(value),
        source = graph.get(a.source, row),
        data = graph.materials.get(key(source));
      if (!data || sha(data) !== a.sourceDigest) throw new Error('LEARNING_ASSET_DIGEST');
      const f = L.learningFiles.parse(JSON.parse(data.toString('utf8')));
      if (
        hash(f.files.map((f) => f.path)) !== hash(a.paths) ||
        f.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) !== a.bytes
      )
        throw new Error('LEARNING_ASSET_MANIFEST');
    }
    if (row.domain === 'learning-courses') {
      const c = L.learningCourse.parse(value),
        keys = new Set<string>();
      for (const r of c.lessons) {
        const l = get(r, L.learningLesson, row);
        if (l.course.id !== row.id && get(l.course, L.learningCourse).title !== c.title)
          throw new Error('LEARNING_COURSE_BINDING');
        if (keys.has(l.key) || l.prerequisites.some((p) => !keys.has(p)))
          throw new Error('LEARNING_LESSON_ORDER');
        keys.add(l.key);
      }
    }
    if (row.domain === 'learning-lessons') {
      const l = L.learningLesson.parse(value);
      get(l.course, L.learningCourse, row);
      get(l.asset, L.learningAsset, row);
    }
    if (row.domain === 'learning-steps') {
      get(L.learningSteps.parse(value).lesson, L.learningLesson, row);
    }
    if (row.domain === 'learning-checks') {
      get(L.learningChecks.parse(value).lesson, L.learningLesson, row);
    }
    if (row.domain === 'learning-environments') {
      const env = L.learningEnvironment.safeParse(value),
        v = env.success ? env.data : L.learningCheckpoint.parse(value);
      get(v.course, L.learningCourse, row);
      get(v.asset, L.learningAsset, row);
      if (hash(v.snapshot) !== v.snapshotDigest) throw new Error('LEARNING_SNAPSHOT_DIGEST');
      if (!env.success) get(L.learningCheckpoint.parse(value).session, L.learningSession, row);
    }
    if (row.domain === 'learning-sessions') {
      const v = L.learningSession.parse(value),
        c = get(v.course, L.learningCourse, row);
      get(v.environment, L.learningEnvironment, row);
      if (
        v.cleanup !== 'confirmed' ||
        v.pending ||
        hash(v.snapshot) !== v.snapshotDigest ||
        v.steps.length !== c.lessons.length ||
        v.checks.length !== c.lessons.length
      )
        throw new Error('LEARNING_SESSION_UNSETTLED');
      for (const a of v.attempts) {
        if (a.cleanup !== 'confirmed') throw new Error('LEARNING_ATTEMPT_UNSETTLED');
        if (!a.result) continue;
        const r = a.result,
          snapshot = r.snapshot.map(({ path, content }) => ({ path, content }));
        if (
          hash(snapshot) !== r.snapshotDigest ||
          r.snapshot.some((f) => sha(f.content) !== f.digest || Buffer.byteLength(f.content) !== f.bytes) ||
          r.inputDigest !== a.inputDigest
        )
          throw new Error('LEARNING_ATTEMPT_DIGEST');
      }
      for (const attempt of v.attempts) {
        const result = attempt.result;
        if (!result?.completed) continue;
        let count = 0;
        for (let index = 0; index < v.checks.length; index++) {
          const selected = get(v.checks[index], L.learningChecks, row);
          for (let ri = 0; ri < selected.rules.length; ri++) {
            count++;
            const rule = selected.rules[ri],
              observed = result.checks.find((check) => check.id === 'lesson' + index + '-check' + ri);
            let actual: unknown = null,
              passed = false,
              problem = false;
            try {
              if (rule.kind === 'status') {
                actual = result.demo.running ? 200 : 503;
                passed = actual === rule.expected;
              } else {
                const file = result.snapshot.find((f) => f.path === rule.path);
                if (rule.kind === 'exists') {
                  actual = !!file;
                  passed = actual === rule.expected;
                } else {
                  if (!file) throw new Error('FILE_NOT_FOUND');
                  if (rule.kind === 'text') {
                    actual = file.content;
                    passed =
                      rule.mode === 'equals'
                        ? file.content === rule.expected
                        : file.content.includes(rule.expected);
                  } else {
                    actual = JSON.parse(file.content);
                    passed = hash(actual) === hash(rule.expected);
                  }
                }
              }
            } catch {
              problem = true;
            }
            if (
              !observed ||
              observed.kind !== rule.kind ||
              observed.passed !== passed ||
              !!observed.error !== problem ||
              hash(observed.actual) !== hash(actual)
            )
              throw new Error('LEARNING_CHECK_CLAIM');
          }
        }
        if (result.checks.length !== count) throw new Error('LEARNING_CHECK_COVERAGE');
      }
      const last = [...v.attempts].reverse().find((a) => a.result?.completed)?.result;
      if (last && last.snapshotDigest !== v.snapshotDigest) throw new Error('LEARNING_SESSION_SNAPSHOT');
      const completed = [];
      for (let index = 0; index < c.lessons.length; index++) {
        const lesson = c.lessons[index],
          steps = get(v.steps[index], L.learningSteps, row),
          checks = get(v.checks[index], L.learningChecks, row);
        if (key(steps.lesson) !== key(lesson) || key(checks.lesson) !== key(lesson))
          throw new Error('LEARNING_CHECK_BINDING');
        if (
          steps.steps.every((step) =>
            v.performed.some((p) => key(p.lesson) === key(lesson) && p.stepId === step.id),
          ) &&
          checks.rules.every((_r, i) =>
            last?.checks.some((c) => c.id === 'lesson' + index + '-check' + i && c.passed && !c.error),
          )
        )
          completed.push(lesson);
      }
      if (
        hash(completed) !== hash(v.completedLessons) ||
        (v.outcome === 'passed' && completed.length !== c.lessons.length)
      )
        throw new Error('LEARNING_COMPLETION_CLAIM');
      sessions++;
    }
    if (row.domain === 'learning-progress') {
      const p = L.learningProgress.parse(value);
      get(p.course, L.learningCourse, row);
      for (const a of p.attempts) {
        const s = get(a.session, L.learningSession, row);
        if (
          key(s.course) !== key(p.course) ||
          a.completed !== s.completedLessons.length ||
          a.status !== s.status ||
          a.outcome !== s.outcome
        )
          throw new Error('LEARNING_PROGRESS_CLAIM');
      }
    }
    if (row.domain === 'learning-assessments') {
      const a = L.learningAssessment.parse(value),
        s = get(a.session, L.learningSession, row),
        c = get(a.course, L.learningCourse, row);
      if (
        a.status !== 'sealed' ||
        !a.selfReview ||
        a.cleanup !== 'confirmed' ||
        key(a.course) !== key(s.course) ||
        a.outcome !== s.outcome ||
        a.completed !== s.completedLessons.length ||
        a.total !== c.lessons.length
      )
        throw new Error('LEARNING_ASSESSMENT_CLAIM');
      reports++;
    }
  }
  if (!reports) throw new Error('LEARNING_ASSESSMENT_REQUIRED');
  return {
    format: 'sakura-learning-lab/1',
    valid: true,
    objects: graph.rows.length,
    sessions,
    reports,
    sourceTrust: 'unauthenticated',
    toolExecutionVerified: false,
    certification: false,
    approvalsTransferred: false,
    manifestDigest: graph.manifestDigest,
  };
}
