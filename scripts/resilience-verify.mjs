/** 纯 Node 离线校验器。纯数据封套不解压、不启动服务、不联网、不执行附件。
 * Pure Node offline verifier. Data envelopes never extract, start services, network or execute attachments. */
import { createHash } from 'node:crypto';
const hash = (data) => createHash('sha256').update(data).digest('hex');
const exact = (value, keys) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    throw new Error('Unexpected object fields');
};
export function verifyResilienceBundle(bundle) {
  exact(bundle, ['format', 'sourceTrust', 'entries']);
  if (
    bundle.format !== 'sakura-resilience-1' ||
    bundle.sourceTrust !== 'unauthenticated' ||
    !Array.isArray(bundle.entries) ||
    bundle.entries.length !== 3
  )
    throw new Error('Unsupported bundle format');
  const paths = new Set(),
    entries = new Map();
  let total = 0;
  for (const entry of bundle.entries) {
    exact(entry, ['path', 'bytes', 'digest', 'contentType', 'purpose', 'data']);
    if (
      typeof entry.path !== 'string' ||
      !/^[a-z][a-z0-9-]*\.json$/.test(entry.path) ||
      paths.has(entry.path.toLowerCase())
    )
      throw new Error('Unsafe or duplicate path');
    paths.add(entry.path.toLowerCase());
    if (
      entry.contentType !== 'application/json' ||
      !['report', 'scenario', 'samples'].includes(entry.purpose) ||
      entries.has(entry.purpose)
    )
      throw new Error('Unsupported entry');
    if (
      typeof entry.data !== 'string' ||
      entry.data.length > 280 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data)
    )
      throw new Error('Invalid base64');
    const bytes = Buffer.from(entry.data, 'base64');
    total += bytes.length;
    if (
      bytes.length !== entry.bytes ||
      entry.bytes > 200 * 1024 * 1024 ||
      total > 200 * 1024 * 1024 ||
      hash(bytes) !== entry.digest ||
      bytes.toString('base64') !== entry.data
    )
      throw new Error('Entry size or digest mismatch');
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    entries.set(entry.purpose, data);
  }
  const report = entries.get('report'),
    scenario = entries.get('scenario'),
    segments = entries.get('samples');
  if (
    !report ||
    !Array.isArray(segments) ||
    JSON.stringify(report.segments) !== JSON.stringify(segments) ||
    JSON.stringify(report.run?.plan?.scenario) !== JSON.stringify(scenario)
  )
    throw new Error('Report references do not match');
  if (report.digest !== hash(JSON.stringify({ ...report, digest: '' })))
    throw new Error('Report digest mismatch');
  if (segments.length > 8) throw new Error('Segment budget exceeded');
  let sampleCount = 0;
  for (const s of segments) {
    if (!Array.isArray(s.samples) || s.samples.length > 20000 || s.algorithm !== 'nearest-rank-v1')
      throw new Error('Invalid sample segment');
    sampleCount += s.samples.length;
    if (sampleCount > 20000) throw new Error('Sample budget exceeded');
    const good = s.samples
        .filter((v) => v.ok)
        .map((v) => v.elapsedMs)
        .sort((a, b) => a - b),
      duplicates = s.samples.length - new Set(s.samples.map((v) => v.requestId)).size;
    if (
      s.samples.some((v) => typeof v.ok !== 'boolean' || !Number.isFinite(v.elapsedMs) || v.elapsedMs < 0) ||
      s.count !== s.samples.length ||
      s.errors !== s.samples.filter((v) => !v.ok).length ||
      s.duplicates !== duplicates ||
      s.p95Ms !== (good.length ? good[Math.ceil(good.length * 0.95) - 1] : null)
    )
      throw new Error('Sample summary mismatch');
    const passed =
      s.missing.length === 0 &&
      duplicates === 0 &&
      s.count >= scenario.minimumSamples &&
      s.errors <= scenario.maxErrors &&
      s.p95Ms !== null &&
      s.p95Ms <= scenario.maxP95Ms &&
      (s.phase === 'fault' || s.durationMs >= 60000);
    if (s.passed !== passed) throw new Error('Probe verdict mismatch');
  }
  const complete =
    report.run.state === 'completed' &&
    report.run.cleanup === 'confirmed' &&
    report.run.containment === 'confirmed';
  const phases = segments.filter((s) => s.phase === 'baseline' || s.phase === 'recovery');
  if (
    report.classification === 'passed' &&
    (!complete ||
      report.run.outcome !== 'passed' ||
      phases.length !== 2 ||
      phases.some((s) => !s.passed) ||
      !report.run.evidence.some((e) => e.effect === 'observed') ||
      report.run.evidence.some((e) => e.deadlineBreach) ||
      report.run.intents.some((i) => i.status !== 'confirmed'))
  )
    throw new Error('Passed report lacks evidence');
  const text = JSON.stringify(bundle);
  if (
    /(?:BEGIN [A-Z ]*PRIVATE KEY|\"(?:secret|password|accessToken|approvalToken|leaseToken)\"\s*:)/i.test(
      JSON.stringify(report),
    )
  )
    throw new Error('Executable credential field in report');
  return {
    integrity: 'valid',
    sourceTrust: 'unauthenticated',
    bytes: total,
    digest: hash(text),
    findings: ['来源未认证；摘要只能证明文件一致性。'],
    report,
  };
}
