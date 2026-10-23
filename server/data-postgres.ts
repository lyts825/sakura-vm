/** 仅固定目标、固定表列的 PostgreSQL 读取。 Bounded identity-pinned PostgreSQL reads. */
import { Client } from 'pg';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import { isIP } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { open, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SecretsV1 } from './service-contracts/v1.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import { dataPgSchema, type DataPg } from '../shared/contracts/data-services.ts';
import type { DataScope } from '../shared/contracts/data-common.ts';
import { networkFor, type NetworkScope } from './network/index.ts';
import { AppError } from '../shared/errors.ts';
import { storageRuntime } from './storage-runtime.ts';
import type { DataAuthorize } from './data-store.ts';
const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
class GovernedPgStream extends Duplex {
  private socket?: Socket;
  private opening?: Promise<void>;
  private network?: NetworkScope;
  constructor(
    private address: string,
    private port: number,
    private signal: AbortSignal,
  ) {
    super();
  }
  connect() {
    this.opening = (async () => {
      const scope = networkFor('core:data-postgres');
      this.network = scope;
      const socket = await scope.dial({ host: this.address, port: this.port }, this.signal, 15000);
      this.socket = socket;
      socket.on('data', (chunk) => {
        if (!this.push(chunk)) socket.pause();
      });
      socket.on('end', () => this.push(null));
      socket.on('error', (error) => this.destroy(error));
      socket.on('close', () => this.destroy());
      socket.resume();
      this.emit('connect');
    })().catch((error) => {
      this.destroy(error);
    });
    return this;
  }
  setNoDelay() {
    return this;
  }
  setKeepAlive() {
    return this;
  }
  ref() {
    this.socket?.ref();
    return this;
  }
  unref() {
    this.socket?.unref();
    return this;
  }
  _read() {
    this.socket?.resume();
  }
  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    void Promise.resolve(this.opening).then(() => {
      if (!this.socket) return callback(new Error('PostgreSQL 连接未建立'));
      this.socket.write(chunk, encoding, callback);
    }, callback);
  }
  _final(callback: (error?: Error | null) => void) {
    if (this.socket) this.socket.end(callback);
    else callback();
  }
  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.socket?.destroy();
    void (this.network?.close() ?? Promise.resolve()).then(
      () => callback(error),
      (failure) => callback(error ?? failure),
    );
  }
}
export async function capturePostgres(
  scope: DataScope,
  input: DataPg,
  secrets: SecretsV1,
  artifacts: DeliveryArtifactsV1,
  directory: string,
  authorize: DataAuthorize,
  signal: AbortSignal,
) {
  input = dataPgSchema.parse(input);
  signal = AbortSignal.any([signal, AbortSignal.timeout(input.timeoutSeconds * 1000)]);
  if (!isIP(input.address)) throw new AppError('数据库计划必须固定明确的 IP 地址', 400, 'DATA_PG_ADDRESS');
  await authorize(scope);
  const credentials = await secrets.resolveVersioned(
    scope.vmId,
    { PASSWORD: input.secretRef },
    { PASSWORD: input.secretVersion },
  );
  const stream = new GovernedPgStream(input.address, input.port, signal);
  const client = new Client({
    host: input.host,
    port: input.port,
    database: input.database,
    user: input.user,
    password: credentials.PASSWORD,
    ssl: { rejectUnauthorized: true, ...(input.ca ? { ca: input.ca } : {}) },
    stream: () => stream,
    connectionTimeoutMillis: 15000,
    statement_timeout: input.timeoutSeconds * 1000,
    query_timeout: (input.timeoutSeconds + 5) * 1000,
  });
  client.on('error', () => stream.destroy());
  credentials.PASSWORD = '';
  const abort = () => stream.destroy(new Error('DATA_PG_CANCELLED'));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const path = join(directory, 'postgres-' + randomUUID() + '.jsonl');
  let connected = false;
  let rows = 0;
  let bytes = 0;
  let complete = false;
  try {
    await mkdir(directory, { recursive: true });
    const sha256 = await storageRuntime.run(
      {
        owner: 'core:data-postgres',
        taskId: randomUUID(),
        label: '只读数据库捕获',
        signal,
        paths: [directory],
        mode: 'write',
        buffers: 2,
        files: 1,
        temporary: [{ path: directory, bytes: 512 * 1024 ** 2 }],
      },
      async () => {
        const file = await open(path, 'wx+', 0o600),
          hash = createHash('sha256');
        try {
          await client.connect();
          connected = true;
          await authorize(scope);
          const version = await client.query('SHOW server_version_num');
          if (
            Number(version.rows[0].server_version_num) < 180000 ||
            Number(version.rows[0].server_version_num) >= 190000
          )
            throw new AppError('首版只接受 PostgreSQL 18', 409, 'DATA_PG_VERSION');
          await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
          await client.query('SET LOCAL search_path = pg_catalog');
          await client.query(
            'LOCK TABLE ONLY ' + q(input.schema) + '.' + q(input.table) + ' IN ACCESS SHARE MODE',
          );
          await client.query(
            "SELECT set_config('statement_timeout',$1,true),set_config('idle_in_transaction_session_timeout',$1,true)",
            [String(input.timeoutSeconds * 1000)],
          );
          const table = await client.query(
            'SELECT c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity,EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) inherited FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2',
            [input.schema, input.table],
          );
          const relation = table.rows[0];
          if (
            table.rowCount !== 1 ||
            relation.relkind !== 'r' ||
            relation.relrowsecurity ||
            relation.relforcerowsecurity ||
            relation.inherited
          )
            throw new AppError('数据库表不属于允许的普通表范围', 409, 'DATA_PG_TABLE');
          const columns = await client.query(
            'SELECT a.attname,a.attgenerated,t.typnamespace::regnamespace::text namespace,t.typname FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped',
            [relation.oid],
          );
          const allowed = new Set([
            'bool',
            'int2',
            'int4',
            'int8',
            'float4',
            'float8',
            'numeric',
            'text',
            'varchar',
            'bpchar',
            'date',
            'timestamp',
            'timestamptz',
          ]);
          for (const name of input.columns) {
            const col = columns.rows.find((v) => v.attname === name);
            if (!col || col.attgenerated || col.namespace !== 'pg_catalog' || !allowed.has(col.typname))
              throw new AppError('数据库列类型或生成规则不受支持', 409, 'DATA_PG_COLUMN');
          }
          const role = await client.query(
            "SELECT r.rolsuper,r.rolbypassrls,has_table_privilege(current_user,$1::oid,'INSERT,UPDATE,DELETE,TRUNCATE') writable FROM pg_catalog.pg_roles r WHERE r.rolname=current_user",
            [relation.oid],
          );
          if (role.rows[0]?.rolsuper || role.rows[0]?.rolbypassrls || role.rows[0]?.writable)
            throw new AppError('请使用无写权限的专用读取账号', 403, 'DATA_PG_ROLE');
          await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
          await client.query("SET LOCAL TimeZone = 'UTC'");
          await client.query(
            'DECLARE sakura_data_cursor NO SCROLL CURSOR FOR SELECT ' +
              input.columns.map(q).join(',') +
              ' FROM ONLY ' +
              q(input.schema) +
              '.' +
              q(input.table),
          );
          while (true) {
            signal.throwIfAborted();
            await authorize(scope);
            const batch = await client.query({
              text: 'FETCH FORWARD 1000 FROM sakura_data_cursor',
              rowMode: 'array',
              types: { getTypeParser: () => (value: string) => value },
            });
            if (!batch.rows.length) break;
            for (const values of batch.rows) {
              const row = Object.fromEntries(input.columns.map((name, index) => [name, values[index]]));
              const chunk = Buffer.from(JSON.stringify(row) + '\n');
              bytes += chunk.length;
              if (bytes > 512 * 1024 ** 2) throw new AppError('数据库捕获超过 512 MiB', 413);
              hash.update(chunk);
              for (let written = 0; written < chunk.length;) {
                const part = await file.write(chunk, written, chunk.length - written);
                if (!part.bytesWritten) throw new AppError('数据库临时文件写入未完成', 503);
                written += part.bytesWritten;
              }
              rows++;
            }
          }
          await client.query('CLOSE sakura_data_cursor');
          await client.query('ROLLBACK');
          complete = true;
          await file.sync();
          return hash.digest('hex');
        } finally {
          await file.close();
        }
      },
    );
    // 先释放捕获阶段的设备写租约，再以只读租约交给制品写入，避免嵌套占用唯一写槽。
    return await storageRuntime.run(
      {
        owner: 'core:data-postgres',
        taskId: randomUUID(),
        label: '封存数据库捕获',
        paths: [directory],
        mode: 'read',
        buffers: 1,
        files: 1,
        signal,
      },
      async () => {
        const file = await open(path, 'r');
        try {
          const upload = await artifacts.begin(scope, { sha256: sha256, bytes });
          let offset = 0;
          while (offset < bytes) {
            const buffer = Buffer.alloc(Math.min(512 * 1024, bytes - offset));
            const part = await file.read(buffer, 0, buffer.length, offset);
            if (!part.bytesRead) throw new AppError('数据库临时文件发生变化', 409);
            await artifacts.chunk(
              scope,
              upload.id,
              offset,
              buffer.subarray(0, part.bytesRead).toString('base64'),
            );
            offset += part.bytesRead;
          }
          signal.throwIfAborted();
          const blob = await artifacts.complete(scope, upload.id);
          const manifest = await artifacts.seal(scope, {
            kind: 'source',
            label: 'PostgreSQL 只读捕获',
            files: [{ path: 'table.jsonl', ...blob, mode: 0o400 }],
          });
          return {
            manifest,
            rows,
            parse: {
              delimiter: ',',
              header: true,
              nullValue: '',
              schema: input.columns.map((name) => ({ name, type: 'VARCHAR', nullable: true })),
            },
          };
        } finally {
          await file.close();
        }
      },
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    const detail =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code
        : error instanceof Error
          ? error.name
          : 'UNKNOWN';
    throw new AppError('数据库捕获失败（' + detail + '），未提交完整版本', 409, 'DATA_PG_CAPTURE_FAILED');
  } finally {
    signal.removeEventListener('abort', abort);
    try {
      if (connected && !complete && !signal.aborted) await client.query('ROLLBACK');
    } finally {
      try {
        await client.end();
      } finally {
        stream.destroy();
        await rm(path, { force: true });
      }
    }
  }
}
