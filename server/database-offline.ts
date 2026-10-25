/** 纯离线核验：完整性和历史声明的一致性，不认证原工具或转移执行许可。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as D from '../shared/contracts/database-evolution.ts';
import {
  databasePortable,
  databaseFixtureClaim,
  databasePortableDomains,
} from './suite-database-portable.ts';
import { verifySuiteGraph, offlineHash, offlineKey } from './suite-offline.ts';
import {
  validateDatabaseDataset,
  validateDatabaseSchema,
  compileDatabaseProgram,
  parseDatabaseCsv,
} from './suite-database-analysis.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
const portableReport = D.databaseReport
  .omit({ sealedBy: true, sourceTrust: true })
  .extend({ sealedByClaim: S.suiteId, sourceTrust: z.literal('unauthenticated') })
  .strict();
function fail(code: string): never {
  throw new Error('DATABASE_VERIFY_' + code);
}
export function verifyDatabaseSnapshot(raw: unknown) {
  const snapshot = D.databaseSnapshot.parse(raw);
  validateDatabaseDataset({
    format: 'sakura-database-dataset/1',
    schema: snapshot.schema,
    data: snapshot.data,
    source: 'captured-baseline',
    generatorSeed: null,
  });
  if (
    snapshot.digest !==
    offlineHash({
      schema: snapshot.schema,
      data: snapshot.data,
      algorithm: snapshot.algorithm,
      coverage: snapshot.coverage,
    })
  )
    fail('SNAPSHOT_DIGEST');
  if (
    offlineHash(snapshot.rowCounts) !==
    offlineHash(Object.fromEntries(snapshot.data.map((t) => [t.table, t.rows.length])))
  )
    fail('ROW_COUNTS');
  for (const table of snapshot.data) {
    const schema = snapshot.schema.tables.find((t) => t.name === table.table)!;
    const position = (name: string) => schema.columns.findIndex((c) => c.name === name);
    for (const row of table.rows)
      for (const [i, column] of schema.columns.entries())
        if (
          row[i] === null &&
          (!column.nullable ||
            schema.constraints.some(
              (c) => ['primary', 'not-null'].includes(c.kind) && c.columns.includes(column.name),
            ))
        )
          fail('NULL_CONSTRAINT');
    for (const constraint of [
      ...schema.constraints.filter((c) => ['primary', 'unique'].includes(c.kind)),
      ...schema.indexes.filter((i) => i.unique),
    ]) {
      const seen = new Set<string>();
      for (const row of table.rows) {
        const values = constraint.columns.map((c) => row[position(c)]);
        if (values.some((x) => x === null)) continue;
        const key = offlineHash(
          values.map((v, i) =>
            schema.columns[position(constraint.columns[i])].type === 'numeric'
              ? String(v)
                  .replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
                  .replace(/^-0$/, '0')
              : v,
          ),
        );
        if (seen.has(key)) fail('KEY_CONSTRAINT');
        seen.add(key);
      }
    }
    const sorted = [...table.rows].sort((a, b) =>
      Buffer.compare(Buffer.from(JSON.stringify(a)), Buffer.from(JSON.stringify(b))),
    );
    if (offlineHash(sorted) !== offlineHash(table.rows)) fail('ROW_ORDER');
  }
  return snapshot;
}
export function verifyDatabaseBundle(bytes: Uint8Array) {
  const graph = verifySuiteGraph(
      bytes,
      'sakura-database-evolution/1',
      databasePortableDomains,
      'database-sources',
    ),
    contents = new Map<string, any>();
  for (const row of graph.rows) {
    if (row.origin !== 'imported') fail('LOCAL_AUTHORITY');
    if (row.kind === 'source') {
      const material = S.suiteMaterial.parse(row.content);
      if (!['json', 'csv'].includes(material.format) || material.allowExport) fail('MATERIAL_POLICY');
      continue;
    }
    const value = databasePortable.parse(row.content);
    contents.set(offlineKey(row), value.claims);
  }
  const get = (r: S.SuiteRef, owner: S.SuiteRecord) => {
    graph.get(r, owner);
    const value = contents.get(offlineKey(r));
    if (!value) fail('CLAIM');
    return value;
  };
  const baseline = (value: z.infer<typeof databaseFixtureClaim>) => {
    let item = value;
    for (let depth = 0; depth < 16; depth++) {
      if (item.result?.baseline) return item.result.baseline;
      if (!item.parentFixture) return null;
      item = databaseFixtureClaim.parse(contents.get(offlineKey(item.parentFixture)));
    }
    return fail('BASELINE_DEPTH');
  };
  let reports = 0,
    snapshots = 0;
  for (const row of graph.rows) {
    if (row.kind === 'source') continue;
    const value = contents.get(offlineKey(row));
    if (row.domain === 'database-sources') {
      const pinned = D.databasePinned.parse(value);
      validateDatabaseDataset(pinned.dataset);
      if (offlineHash(pinned.dataset) !== pinned.digest) fail('INPUT_DIGEST');
      const source = graph.get(pinned.source, row);
      if (source.kind !== 'source') fail('INPUT_SOURCE');
      const material = S.suiteMaterial.parse(source.content),
        text = new TextDecoder('utf-8', { fatal: true }).decode(graph.materials.get(offlineKey(source))!);
      if (material.format === 'json') {
        if (offlineHash(validateDatabaseDataset(parseSuiteJson(text, 8 * 1024 ** 2))) !== pinned.digest)
          fail('INPUT_BYTES');
      } else {
        const table = pinned.dataset.schema.tables[0],
          csv = parseDatabaseCsv(text);
        if (
          pinned.dataset.schema.tables.length !== 1 ||
          offlineHash(csv.shift()) !== offlineHash(table.columns.map((c) => c.name))
        )
          fail('CSV_HEADER');
        const values = csv.map((row) =>
          row.map((v, i) =>
            v === '\\N'
              ? null
              : table.columns[i]?.type === 'boolean'
                ? v === 'true'
                  ? true
                  : v === 'false'
                    ? false
                    : fail('CSV_BOOLEAN')
                : v,
          ),
        );
        if (offlineHash(pinned.dataset.data) !== offlineHash([{ table: table.name, rows: values }]))
          fail('CSV_DATA');
      }
    } else if (row.domain === 'database-schemas') {
      const schema = D.databaseValidated.parse(value);
      validateDatabaseSchema(schema.schema);
      if (offlineHash(schema.schema) !== schema.digest) fail('SCHEMA_DIGEST');
      const pinned = D.databasePinned.parse(get(schema.source, row));
      if (offlineHash(pinned.dataset.schema) !== schema.digest) fail('SCHEMA_SOURCE');
    } else if (row.domain === 'database-changes') {
      const program = D.databaseProgram.parse(value),
        baseline = D.databaseValidated.parse(get(program.baseline, row));
      if (
        offlineHash(compileDatabaseProgram(baseline.schema, program.baseline, program.operations)) !==
        offlineHash(program)
      )
        fail('PROGRAM');
    } else if (row.domain === 'database-fixtures') {
      const fixture = databaseFixtureClaim.parse(value);
      get(fixture.source, row);
      if (fixture.changes) get(fixture.changes, row);
      if (fixture.parentFixture) get(fixture.parentFixture, row);
      if (fixture.result) {
        const operations = fixture.changes
          ? D.databaseProgram.parse(get(fixture.changes, row)).operations
          : [];
        if (fixture.result.steps.length > operations.length) fail('STEP_COUNT');
        for (const [i, step] of fixture.result.steps.entries()) {
          if (
            step.sequence !== i ||
            offlineHash(step.operation) !== offlineHash(operations[i]) ||
            (i > 0 && fixture.result.steps[i - 1].state !== 'observed')
          )
            fail('STEP_SEQUENCE');
        }
        if (
          fixture.result.outcome === 'passed' &&
          (fixture.result.steps.length !== operations.length ||
            fixture.result.steps.some((s) => s.state !== 'observed') ||
            !fixture.result.baseline ||
            !fixture.result.after)
        )
          fail('PASSED_COVERAGE');
        for (const snapshot of [fixture.result.baseline, fixture.result.after])
          if (snapshot) {
            verifyDatabaseSnapshot(snapshot);
            snapshots++;
          }
        if (
          fixture.result.recovery?.confirmed &&
          fixture.result.recovery.actualDigest !== fixture.result.recovery.expectedDigest
        )
          fail('RESTORE_DIGEST');
      }
    } else if (row.domain === 'database-runners') {
      const run = D.databaseRun.parse(value);
      databaseFixtureClaim.parse(get(run.fixture, row));
      if (run.changes) get(run.changes, row);
      if (run.restores) get(run.restores, row);
    } else if (row.domain === 'database-checks') {
      const check = D.databaseCheck.parse(value);
      if (!check.sourceClaimOnly) fail('EXECUTION_CLAIM');
      const run = D.databaseRun.parse(get(check.run, row));
      const fixture = databaseFixtureClaim.parse(get(check.fixture, row));
      if (offlineKey(run.fixture) !== offlineKey(check.fixture)) fail('CHECK_WINDOW');
      const operations = fixture.changes
        ? D.databaseProgram.parse(contents.get(offlineKey(fixture.changes))).operations
        : [];
      if (
        check.totalSteps !== operations.length ||
        check.observedSteps !== (fixture.result?.steps.filter((s) => s.state === 'observed').length ?? 0) ||
        check.failedSteps !== (fixture.result?.steps.filter((s) => s.state === 'failed').length ?? 0) ||
        check.unknownSteps !== (fixture.result?.steps.filter((s) => s.state === 'unknown').length ?? 0)
      )
        fail('CHECK_COUNTS');
      if (
        check.outcome === 'passed' &&
        (fixture.result?.outcome !== 'passed' || fixture.state !== 'completed')
      )
        fail('CHECK_PASSED');
      if (check.cleanup !== fixture.cleanup) fail('CHECK_CLEANUP');
      if (
        check.baselineDigest !== (baseline(fixture)?.digest ?? null) ||
        check.afterDigest !== (fixture.result?.after?.digest ?? null)
      )
        fail('CHECK_DIGEST');
    } else if (row.domain === 'database-rehearsals') {
      const rehearsal = D.databaseRehearsal.parse(value);
      get(rehearsal.run, row);
      if (rehearsal.recovery) get(rehearsal.recovery, row);
      if (rehearsal.check) get(rehearsal.check, row);
    } else if (row.domain === 'database-reports') {
      const report = portableReport.parse(value);
      reports++;
      const check = D.databaseCheck.parse(get(report.check, row));
      get(report.run, row);
      if (report.recovery) get(report.recovery, row);
      if (offlineHash(check) !== offlineHash(report.assessment)) fail('REPORT_CHECK');
      if (check.cleanup !== 'confirmed') fail('REPORT_CLEANUP');
    } else fail('DOMAIN');
  }
  if (!reports) fail('REPORT_REQUIRED');
  return {
    valid: true,
    format: 'sakura-database-evolution/1',
    objects: graph.rows.length,
    materials: graph.materials.size,
    reports,
    snapshots,
    manifestDigest: graph.manifestDigest,
    sourceTrust: 'unauthenticated',
    executionAllowed: false,
    approvalsTransferred: false,
    productionApproval: false,
  };
}
