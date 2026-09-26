import test from 'node:test';
import assert from 'node:assert/strict';
import { observeAvailability, availabilityReport, type AvailabilitySpan } from '../server/availability.ts';

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
