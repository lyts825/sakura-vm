/** 有界的报告解析；只输出数据，XML 不允许实体及外部文档。 Bounded data-only report parsing without XML entities. */
import { DOMParser } from '@xmldom/xmldom';
import { z } from 'zod';
import type { DeliveryReportFormat } from '../shared/contracts/delivery-common.ts';
import type { DeliveryEvidence } from '../shared/contracts/delivery-quality.ts';
type Parsed = Pick<
  DeliveryEvidence,
  'status' | 'tests' | 'failures' | 'skipped' | 'coverage' | 'diagnostics' | 'benchmark' | 'detail'
>;
/** 将 value 转为有限非负计数，无效值抛错。 Convert value to a finite nonnegative count or throw. */
const number = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw Error('报告包含无效计数');
  return n;
};
/** 校验 covered/total 并返回百分比；总数为零时返回零。 Validate covered/total and return a percentage, using zero for an empty total. */
const percent = (covered: unknown, total: unknown) => {
  const c = number(covered),
    t = number(total);
  if (c > t) throw Error('覆盖数超过总数');
  return t ? (100 * c) / t : 0;
};
/** 按 format 解析有界 bytes，返回统计或明确的缺失、截断、损坏状态，不执行报告内容。 Parse bounded bytes by format into statistics or explicit missing/truncated/malformed status without executing content. */
export function parseDeliveryReport(format: DeliveryReportFormat, bytes: Buffer): Parsed {
  const result: Parsed = {
    status: 'passed',
    tests: 0,
    failures: 0,
    skipped: 0,
    coverage: null,
    diagnostics: [],
    benchmark: null,
    detail: '',
  };
  if (bytes.length > 2 * 1024 * 1024)
    return { ...result, status: 'truncated', detail: '报告超过 2 MiB 解析上限' };
  if (!bytes.length) return { ...result, status: 'missing', detail: '报告为空' };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (format === 'junit') {
      if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Error('禁止 XML DTD 和实体');
      const tags = text.match(/<[^>]+>/g) ?? [];
      let depth = 0;
      if (tags.length > 50000) throw Error('XML 节点数量超限');
      for (const tag of tags) {
        if (tag.startsWith('</')) depth--;
        else if (!tag.startsWith('<?') && !tag.startsWith('<!') && !tag.endsWith('/>')) depth++;
        if (depth > 64) throw Error('XML 嵌套超过 64 层');
      }
      const doc = new DOMParser({
        onError: () => {
          throw Error('XML 格式错误');
        },
      }).parseFromString(text, 'application/xml');
      if (!['testsuite', 'testsuites'].includes(doc.documentElement?.tagName ?? ''))
        throw Error('JUnit 根节点无效');
      const cases = Array.from(doc.getElementsByTagName('testcase'));
      if (cases.length > 20000) throw Error('测试用例数量超限');
      result.tests = cases.length;
      for (const entry of cases) {
        if (entry.getElementsByTagName('failure').length || entry.getElementsByTagName('error').length)
          result.failures++;
        if (entry.getElementsByTagName('skipped').length) result.skipped++;
      }
      if (!cases.length) {
        const suites = Array.from(doc.getElementsByTagName('testsuite')).filter(
          (s) => !s.getElementsByTagName('testsuite').length,
        );
        for (const suite of suites) {
          result.tests += number(suite.getAttribute('tests') ?? 0);
          result.failures +=
            number(suite.getAttribute('failures') ?? 0) + number(suite.getAttribute('errors') ?? 0);
          result.skipped += number(suite.getAttribute('skipped') ?? 0);
        }
      }
      if (
        result.failures + result.skipped > result.tests ||
        ![result.tests, result.failures, result.skipped].every(Number.isInteger)
      )
        throw Error('JUnit 计数不一致');
      if (!result.tests || result.failures || result.tests === result.skipped) result.status = 'failed';
    } else if (format === 'lcov') {
      let total = 0,
        covered = 0,
        records = 0;
      const paths = new Set<string>();
      let active = false;
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('SF:')) {
          if (active || paths.has(line.slice(3))) throw Error('LCOV 重复或嵌套源记录');
          paths.add(line.slice(3));
          records++;
          active = true;
        } else if (line.startsWith('DA:')) {
          if (!active) throw Error('LCOV 缺少源文件');
          const [lineNo, hits] = line.slice(3).split(',');
          if (!Number.isInteger(number(lineNo)) || number(lineNo) < 1) throw Error('LCOV 行号无效');
          total++;
          if (number(hits) > 0) covered++;
        } else if (line === 'end_of_record') active = false;
      }
      if (!records || active || !total) throw Error('LCOV 记录不完整');
      result.coverage = percent(covered, total);
    } else {
      const json = JSON.parse(text);
      if (format === 'istanbul') {
        const lines = json.total?.lines;
        if (!lines) throw Error('缺少 Istanbul total.lines');
        result.coverage = percent(lines.covered, lines.total);
      } else if (format === 'coverage-py') {
        if (!json.totals) throw Error('缺少 coverage.py totals');
        result.coverage = percent(json.totals.covered_lines, json.totals.num_statements);
      } else if (format === 'diagnostics') {
        const parsed = z
          .object({
            diagnostics: z
              .array(
                z
                  .object({ severity: z.enum(['error', 'warning', 'info']), message: z.string().max(4000) })
                  .strict(),
              )
              .max(1000),
          })
          .strict()
          .parse(json);
        result.diagnostics = parsed.diagnostics;
        result.failures = parsed.diagnostics.filter((d) => d.severity === 'error').length;
        if (result.failures) result.status = 'failed';
      } else {
        result.benchmark = z
          .object({
            tool: z.string().min(1).max(200),
            environment: z.string().min(1).max(2000),
            inputClass: z.string().min(1).max(200),
            samplesMs: z.array(z.number().finite().nonnegative().max(86400000)).min(1).max(10000),
          })
          .strict()
          .parse(json);
      }
    }
    result.detail = result.status === 'passed' ? '报告已解析' : '报告包含失败或没有实际执行的测试';
  } catch (error) {
    result.status = 'malformed';
    result.detail = (error instanceof Error ? error.message : '报告无效').slice(0, 2000);
  }
  return result;
}
