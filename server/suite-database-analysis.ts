/** 声明校验与结构演算；真实数据库执行结果只能由固定工具产生。 */
import * as D from '../shared/contracts/database-evolution.ts';
import type * as S from '../shared/contracts/suite-common.ts';
import { createHash } from 'node:crypto';
import { canonicalBundle } from '../scripts/suite-bundle.mjs';
import { AppError } from '../shared/errors.ts';
const suiteHash = (value: unknown) => createHash('sha256').update(canonicalBundle(value)).digest('hex');
function suiteFail(code: string, message = code): never {
  throw new AppError(message, 400, code);
}
const unique = (values: string[], what: string) => {
  if (new Set(values).size !== values.length) suiteFail('DATABASE_DUPLICATE', `${what}存在重复名称`);
};
export function validateDatabaseSchema(raw: unknown): D.DatabaseSchema {
  const schema = D.databaseSchema.parse(raw);
  unique(
    schema.tables.map((t) => t.name),
    '表',
  );
  unique(
    schema.tables.flatMap((t) => [
      t.name,
      ...t.indexes.map((i) => i.name),
      ...t.constraints.filter((c) => c.kind !== 'not-null').map((c) => c.name),
    ]),
    '表与索引的共享命名空间',
  );
  for (const table of schema.tables) {
    unique(
      table.columns.map((c) => c.name),
      '列',
    );
    unique([...table.constraints.map((c) => c.name), ...table.indexes.map((i) => i.name)], '约束或索引');
    if (table.constraints.filter((c) => c.kind === 'primary').length > 1)
      suiteFail('DATABASE_PRIMARY_KEY', '每表只允许一个主键');
    for (const item of [...table.constraints, ...table.indexes]) {
      unique(item.columns, '键列');
      if (item.columns.some((c) => !table.columns.some((col) => col.name === c)))
        suiteFail('DATABASE_COLUMN_MISSING', '约束或索引引用未知列');
    }
    for (const constraint of table.constraints)
      if (constraint.kind === 'not-null' && constraint.columns.length !== 1)
        suiteFail('DATABASE_NOT_NULL', '非空约束须指定单列');
  }
  schema.tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return schema;
}
function cell(value: unknown, type: D.DatabaseSchema['tables'][number]['columns'][number]['type']) {
  const parsed = D.databaseCell.parse(value);
  if (parsed === null) return;
  if (type === 'boolean') {
    if (typeof parsed !== 'boolean') suiteFail('DATABASE_VALUE', '布尔列必须使用 JSON 布尔值');
    return;
  }
  if (typeof parsed !== 'string') suiteFail('DATABASE_VALUE', '非布尔列使用字符串以保留精度');
  if (
    parsed.includes('\0') ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(parsed)
  )
    suiteFail('DATABASE_VALUE', '文本必须是有效 UTF-8 且不含 NUL');
  if (['integer', 'bigint'].includes(type)) {
    if (!/^-?(0|[1-9][0-9]*)$/.test(parsed)) suiteFail('DATABASE_VALUE', '整数格式无效');
    const n = BigInt(parsed),
      limit = type === 'integer' ? 2147483648n : 9223372036854775808n;
    if (n < -limit || n >= limit) suiteFail('DATABASE_VALUE', '整数超出声明类型范围');
  }
  if (type === 'numeric' && !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(parsed))
    suiteFail('DATABASE_VALUE', '精确小数必须使用十进制字符串');
  const validDay = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]),
      month = Number(match[2]),
      day = Number(match[3]),
      days = [
        31,
        year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
      ];
    return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
  };
  if (type === 'date' && !validDay(parsed)) suiteFail('DATABASE_VALUE', '日期格式无效');
  if (
    type === 'timestamptz' &&
    (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?Z$/.test(parsed) ||
      !validDay(parsed.slice(0, 10)))
  )
    suiteFail('DATABASE_VALUE', '时间戳须使用 UTC ISO 格式');
}
export function validateDatabaseDataset(raw: unknown): D.DatabaseDataset {
  const data = D.databaseDataset.parse(raw);
  data.schema = validateDatabaseSchema(data.schema);
  unique(
    data.data.map((t) => t.table),
    '数据表',
  );
  let rows = 0;
  if (data.data.length !== data.schema.tables.length)
    suiteFail('DATABASE_DATA_TABLES', '每个表必须提供完整数据数组');
  for (const table of data.schema.tables) {
    const body = data.data.find((x) => x.table === table.name);
    if (!body) suiteFail('DATABASE_DATA_TABLES');
    rows += body.rows.length;
    for (const row of body.rows) {
      if (row.length !== table.columns.length) suiteFail('DATABASE_ROW_WIDTH');
      row.forEach((v, i) => cell(v, table.columns[i].type));
    }
  }
  if (rows > 5000) suiteFail('DATABASE_ROW_BUDGET', '当前完整校验最多 5,000 行');
  return data;
}
export function compileDatabaseProgram(
  rawSchema: unknown,
  baseline: S.SuiteRef,
  operations: unknown,
): D.DatabaseProgram {
  const original = validateDatabaseSchema(rawSchema),
    schema = structuredClone(original),
    ops = D.databaseCompile.shape.operations.parse(operations),
    risks: D.DatabaseProgram['risks'] = [];
  for (const [step, op] of ops.entries()) {
    if (op.kind === 'create-table') {
      if (schema.tables.some((t) => t.name === op.table.name)) suiteFail('DATABASE_TABLE_EXISTS');
      schema.tables.push(op.table);
    } else {
      const table = schema.tables.find((t) => t.name === op.table);
      if (!table) suiteFail('DATABASE_TABLE_MISSING');
      const column = (name: string) =>
        table.columns.find((c) => c.name === name) ?? suiteFail('DATABASE_COLUMN_MISSING');
      if (op.kind === 'add-column') {
        if (table.columns.some((c) => c.name === op.column.name)) suiteFail('DATABASE_COLUMN_EXISTS');
        table.columns.push(op.column);
        if (!op.column.nullable)
          risks.push({
            step,
            code: 'NOT_NULL_EXISTING_ROWS',
            message: '已有数据时直接新增非空列可能失败，请先新增可空列并回填。',
            destructive: false,
          });
      }
      if (op.kind === 'rename-column') {
        const c = column(op.from);
        if (table.columns.some((c) => c.name === op.to)) suiteFail('DATABASE_COLUMN_EXISTS');
        c.name = op.to;
        for (const item of [...table.constraints, ...table.indexes])
          item.columns = item.columns.map((n) => (n === op.from ? op.to : n));
      }
      if (op.kind === 'convert-column') {
        column(op.column).type = op.to;
        risks.push({
          step,
          code: 'TYPE_CONVERSION',
          message: '实际转换须通过往返比对；丢失精度或格式变化将拒绝该条操作。',
          destructive: false,
        });
      }
      if (op.kind === 'drop-column') {
        column(op.column);
        if (table.columns.length === 1) suiteFail('DATABASE_LAST_COLUMN');
        if ([...table.constraints, ...table.indexes].some((c) => c.columns.includes(op.column)))
          suiteFail('DATABASE_DEPENDENT_COLUMN', '先修改依赖约束，本版不提供级联删除');
        table.columns = table.columns.filter((c) => c.name !== op.column);
        risks.push({
          step,
          code: 'DATA_DELETION',
          message: '此操作永久删除本次副本中的列和数据，需要在执行计划中明确批准。',
          destructive: true,
        });
      }
      if (op.kind === 'create-index') table.indexes.push(op.index);
      if (op.kind === 'add-constraint') table.constraints.push(op.constraint);
      if (op.kind === 'backfill') {
        column(op.column);
        if (op.expression.kind !== 'constant') column(op.expression.column);
        risks.push({
          step,
          code: 'DATA_WRITE',
          message: op.onlyNull ? '写入所选列的全部空值行。' : '覆盖所选列的全部行。',
          destructive: !op.onlyNull,
        });
      }
    }
    validateDatabaseSchema(schema);
  }
  return D.databaseProgram.parse({
    format: 'sakura-database-program/1',
    baseline,
    baselineDigest: suiteHash(original),
    operations: ops,
    resultingSchema: validateDatabaseSchema(schema),
    risks,
    stopOnError: true,
    algorithm: 'postgres-declarations-v1',
  });
}
export function generateDatabaseDataset(template: string, rows: number, seed: string): D.DatabaseDataset {
  const schema: D.DatabaseSchema = {
    format: 'sakura-database-schema/1',
    encoding: 'UTF8',
    timezone: 'UTC',
    collation: 'C',
    tables: [
      {
        name: 'accounts',
        columns: [
          { name: 'id', type: 'integer', nullable: false },
          { name: 'email', type: 'text', nullable: true },
          { name: 'amount', type: 'numeric', nullable: true },
        ],
        constraints: [{ name: 'accounts_pk', kind: 'primary', columns: ['id'] }],
        indexes: [],
      },
    ],
  };
  return validateDatabaseDataset({
    format: 'sakura-database-dataset/1',
    schema,
    data: [
      {
        table: 'accounts',
        rows: Array.from({ length: rows }, (_, i) => [
          String(i + 1),
          template === 'unique-conflict' && i < 2
            ? 'duplicate@example.invalid'
            : `user-${suiteHash([seed, i]).slice(0, 8)}@example.invalid`,
          `${i + 1}.25`,
        ]),
      },
    ],
    source: 'synthetic',
    generatorSeed: seed,
  });
}
export function databaseTemplateOperations(template: string): D.DatabaseOperation[] {
  if (template === 'unique-conflict')
    return [
      {
        kind: 'add-constraint',
        table: 'accounts',
        constraint: { name: 'accounts_email_unique', kind: 'unique', columns: ['email'] },
      },
    ];
  if (template === 'independent-recovery')
    return [{ kind: 'convert-column', table: 'accounts', column: 'amount', to: 'integer', rejectLoss: true }];
  return [
    {
      kind: 'add-column',
      table: 'accounts',
      column: { name: 'email_normalized', type: 'text', nullable: true },
    },
    {
      kind: 'backfill',
      table: 'accounts',
      column: 'email_normalized',
      expression: { kind: 'lower', column: 'email' },
      onlyNull: true,
    },
    {
      kind: 'add-constraint',
      table: 'accounts',
      constraint: { name: 'normalized_required', kind: 'not-null', columns: ['email_normalized'] },
    },
  ];
}
export function parseDatabaseCsv(text: string): string[][] {
  if (Buffer.byteLength(text) > 8 * 1024 ** 2) suiteFail('DATABASE_CSV_BYTES');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += ch;
    } else if (ch === '"') {
      if (field || closed) suiteFail('DATABASE_CSV_FORMAT');
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      closed = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      closed = false;
    } else {
      if (closed) suiteFail('DATABASE_CSV_FORMAT');
      field += ch;
    }
    if (field.length > 4096 || row.length > 32 || rows.length > 5001) suiteFail('DATABASE_CSV_BUDGET');
  }
  if (quoted) suiteFail('DATABASE_CSV_FORMAT');
  if (field || row.length || closed) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
