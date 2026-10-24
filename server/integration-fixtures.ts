/** 固定虚构数据和有界 CSV/JSON 导入。 Bounded fixture parsing and seeded synthetic rows. */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { IntegrationFixturesV1, IntegrationSpecsV1 } from './service-contracts/integration-lab.ts';
import { IntegrationDefinitions, ilBytes, ilFail } from './integration-store.ts';
import {
  fixtureSchema,
  ilName,
  ilId,
  ilJson,
  type IntegrationFixture,
  type IntegrationScope,
  type IntegrationJson,
} from '../shared/contracts/integration-lab.ts';
export function parseIntegrationCsv(text: string): string[][] {
  if (Buffer.byteLength(text) > 50 * 1024 ** 2) ilFail('FIXTURE_TOO_LARGE');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const push = () => {
    if (Buffer.byteLength(field) > 65536) ilFail('CELL_TOO_LARGE');
    row.push(field);
    field = '';
    closed = false;
    if (row.length > 100) ilFail('FIXTURE_COLUMNS');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === '"') {
      if (field || closed) ilFail('CSV_QUOTE');
      quoted = true;
    } else if (c === ',') {
      push();
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      push();
      rows.push(row);
      row = [];
      if (rows.length > 10001) ilFail('FIXTURE_ROWS');
    } else {
      if (closed) ilFail('CSV_TRAILING');
      field += c;
    }
  }
  if (quoted) ilFail('CSV_UNCLOSED');
  if (field || row.length || closed) {
    push();
    rows.push(row);
  }
  return rows;
}
export class IntegrationFixtures
  extends IntegrationDefinitions<IntegrationFixture>
  implements IntegrationFixturesV1
{
  constructor(meta: PluginMetadata, specs: IntegrationSpecsV1) {
    super(meta, fixtureSchema, specs, 'fixtures');
  }
  protected override async validate(_scope: IntegrationScope, value: IntegrationFixture) {
    if (ilBytes(value) > 50 * 1024 ** 2 || new Set(value.columns).size !== value.columns.length)
      ilFail('FIXTURE_INVALID');
    for (const row of value.rows) {
      if (Object.keys(row).some((k) => !value.columns.includes(k))) ilFail('FIXTURE_COLUMN_UNKNOWN');
      for (const cell of Object.values(row)) if (ilBytes(cell) > 65536) ilFail('CELL_TOO_LARGE');
    }
  }
  async importData(
    scope: IntegrationScope,
    raw: { name: string; format: 'json' | 'csv'; text: string; redact: string[] },
  ) {
    const input = z
      .object({
        name: ilName,
        format: z.enum(['json', 'csv']),
        text: z.string().max(50 * 1024 ** 2),
        redact: z.array(ilId).max(100),
      })
      .strict()
      .parse(raw);
    let columns: string[], rows: Record<string, IntegrationJson>[];
    if (input.format === 'csv') {
      const parsed = parseIntegrationCsv(input.text);
      columns = z.array(ilId).min(1).max(100).parse(parsed.shift());
      rows = parsed.map((values) => {
        if (values.length !== columns.length) ilFail('CSV_WIDTH');
        return Object.fromEntries(columns.map((k, i) => [k, values[i]]));
      });
    } else {
      rows = z.array(z.record(ilId, ilJson)).max(10000).parse(JSON.parse(input.text));
      columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    }
    for (const row of rows)
      for (const key of input.redact) if (Object.hasOwn(row, key)) row[key] = '[redacted]';
    return this.save(scope, { content: { name: input.name, columns, rows, redactedFields: input.redact } });
  }
  async generate(scope: IntegrationScope, raw: { name: string; seed: number; rows: number }) {
    const input = z
      .object({
        name: ilName,
        seed: z.number().int().min(0).max(0xffffffff),
        rows: z.number().int().min(1).max(10000),
      })
      .strict()
      .parse(raw);
    let state = input.seed;
    const rows = Array.from({ length: input.rows }, (_, i) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return { id: 'synthetic-' + (i + 1), name: 'Fictional item ' + (i + 1), price: (state % 10000) / 100 };
    });
    return this.save(scope, {
      content: {
        name: input.name,
        columns: ['id', 'name', 'price'],
        rows,
        seed: input.seed,
        redactedFields: [],
      },
    });
  }
}
