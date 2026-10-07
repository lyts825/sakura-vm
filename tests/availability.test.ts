/**
 * 模块职责：回归验证模块，围绕 `availability` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `availability`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: availability reports measured uptime, downtime and collector gaps without inventing coverage; availability clamps report windows, bounds retention and rejects overlapping evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { observeAvailability, availabilityReport, type AvailabilitySpan } from '../server/availability.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: availability reports measured uptime, downtime and collector gaps without inventing coverage
 * 协作入口 / Collaborators: `Date.UTC`, `observeAvailability`, `availabilityReport`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(report.durationsSeconds.running, 60)`; `assert.equal(report.durationsSeconds.unreachable, 30)`.
 */
test('availability reports measured uptime, downtime and collector gaps without inventing coverage', () => {
  const spans: AvailabilitySpan[] = [],
    start = Date.UTC(2026, 0, 1);
  observeAvailability(spans, 'running', start);
  observeAvailability(spans, 'running', start + 30000);
  observeAvailability(spans, 'unreachable', start + 60000);
  observeAvailability(spans, 'unreachable', start + 90000);
  observeAvailability(spans, 'stopped', start + 300000);
  observeAvailability(spans, 'stopped', start + 330000);
  const report = availabilityReport(spans, 1, start + 360000);
  assert.equal(report.durationsSeconds.running, 60);
  assert.equal(report.durationsSeconds.unreachable, 30);
  assert.equal(report.durationsSeconds.stopped, 30);
  assert.equal(report.unknownSeconds, 3480);
  assert.equal(report.observedSeconds, 120);
  assert.equal(report.availablePercent, 50);
  assert.ok(report.intervals.some((span) => span.status === 'unknown' && span.seconds === 210));
  assert.equal(availabilityReport([], 24).availablePercent, null);
  assert.equal(availabilityReport([], 24).coveragePercent, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: availability clamps report windows, bounds retention and rejects overlapping evidence
 * 协作入口 / Collaborators: `Date.UTC`, `observeAvailability`, `assert.equal`, `availabilityReport`.
 * 检查边界 / Checked boundaries: `assert.equal(availabilityReport(spans, 1, start + 3600 * 30000).availablePercent, 100)`; `assert.equal(availabilityReport(spans, 1, start + 3600 * 30000).coveragePercent, 100)`.
 */
test('availability clamps report windows, bounds retention and rejects overlapping evidence', () => {
  const start = Date.UTC(2026, 0, 1),
    spans: AvailabilitySpan[] = [];
  for (let index = 0; index <= 3600; index++) observeAvailability(spans, 'running', start + index * 30000);
  assert.equal(availabilityReport(spans, 1, start + 3600 * 30000).availablePercent, 100);
  assert.equal(availabilityReport(spans, 1, start + 3600 * 30000).coveragePercent, 100);
  const lastEnd = spans.at(-1)!.end;
  observeAvailability(spans, 'error', lastEnd - 1000);
  assert.equal(spans.at(-1)!.end, lastEnd);
  observeAvailability(spans, 'stopped', lastEnd + 40 * 86400000);
  assert.equal(availabilityReport(spans, 720, lastEnd + 40 * 86400000).coveragePercent, 0);
  const many: AvailabilitySpan[] = [];
  for (let index = 0; index < 8100; index++)
    observeAvailability(many, index % 2 ? 'running' : 'stopped', start + index * 30000);
  assert.equal(many.length, 8000);
  assert.throws(
    () =>
      availabilityReport(
        [
          { start, end: start + 10, status: 'running' },
          { start, end: start + 20, status: 'stopped' },
        ],
        1,
      ),
    /重叠/,
  );
});
