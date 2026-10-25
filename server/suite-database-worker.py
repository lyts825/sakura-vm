#!/usr/bin/env python3
"""Fixed PostgreSQL declarations in a private Unix-socket database; never accepts SQL."""
import copy
import datetime
import hashlib
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import tempfile
import time

IDENT = re.compile(r'^[a-z][a-z0-9_]{0,47}$')
TYPES = {'text', 'integer', 'bigint', 'numeric', 'boolean', 'date', 'timestamptz'}
TOOL = 'postgres-declarations-v1'
MAX_BYTES = 8 * 1024 * 1024
RESULT = {'format': 'sakura-database-result/1', 'state': 'failed', 'outcome': 'inconclusive',
          'baseline': None, 'after': None, 'steps': [], 'recovery': None,
          'cleanup': 'unknown', 'error': None, 'tool': TOOL}

def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)

def digest(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()

def ident(value):
    if not isinstance(value, str) or not IDENT.fullmatch(value):
        raise ValueError('DATABASE_IDENTIFIER')
    return '"' + value + '"'

def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if not isinstance(value, str) or len(value) > 4096 or '\x00' in value:
        raise ValueError('DATABASE_VALUE')
    value.encode('utf-8', 'strict')
    return "'" + value.replace("'", "''") + "'"

def typename(value):
    if value not in TYPES:
        raise ValueError('DATABASE_TYPE')
    return value

def strict(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError('DATABASE_UNKNOWN_FIELDS')

def validate_schema(schema):
    strict(schema, ['format', 'tables', 'encoding', 'timezone', 'collation'])
    if (schema['format'], schema['encoding'], schema['timezone'], schema['collation']) != ('sakura-database-schema/1', 'UTF8', 'UTC', 'C'):
        raise ValueError('DATABASE_SCHEMA')
    if not 1 <= len(schema['tables']) <= 20:
        raise ValueError('DATABASE_TABLE_BUDGET')
    names = set()
    for table in schema['tables']:
        strict(table, ['name', 'columns', 'constraints', 'indexes'])
        ident(table['name'])
        if table['name'] in names or not 1 <= len(table['columns']) <= 32:
            raise ValueError('DATABASE_COLUMNS')
        names.add(table['name'])
        columns = set()
        for col in table['columns']:
            strict(col, ['name', 'type', 'nullable'])
            ident(col['name']); typename(col['type'])
            if col['name'] in columns or not isinstance(col['nullable'], bool):
                raise ValueError('DATABASE_COLUMNS')
            columns.add(col['name'])
        declarations = set()
        for item in table['constraints'] + table['indexes']:
            ident(item['name'])
            if item['name'] in declarations or not 1 <= len(item['columns']) <= 8 or len(set(item['columns'])) != len(item['columns']) or not set(item['columns']) <= columns:
                raise ValueError('DATABASE_CONSTRAINT')
            declarations.add(item['name'])
        for item in table['constraints']:
            strict(item, ['name', 'kind', 'columns'])
            if item['kind'] not in ('primary', 'unique', 'not-null') or (item['kind'] == 'not-null' and len(item['columns']) != 1):
                raise ValueError('DATABASE_CONSTRAINT')
        for item in table['indexes']:
            strict(item, ['name', 'columns', 'unique'])
            if not isinstance(item['unique'], bool):
                raise ValueError('DATABASE_INDEX')

def validate_dataset(dataset):
    strict(dataset, ['format', 'schema', 'data', 'source', 'generatorSeed'])
    if dataset['format'] != 'sakura-database-dataset/1' or dataset['source'] not in ('synthetic', 'reviewed-input', 'captured-baseline'):
        raise ValueError('DATABASE_DATASET')
    validate_schema(dataset['schema'])
    tables = {table['name']: table for table in dataset['schema']['tables']}
    seen = set(); total = 0
    for data in dataset['data']:
        strict(data, ['table', 'rows'])
        if data['table'] not in tables or data['table'] in seen:
            raise ValueError('DATABASE_DATA_TABLES')
        seen.add(data['table']); total += len(data['rows'])
        for row in data['rows']:
            if len(row) != len(tables[data['table']]['columns']):
                raise ValueError('DATABASE_ROW_WIDTH')
            for value in row:
                literal(value)
    if seen != set(tables) or total > 5000:
        raise ValueError('DATABASE_ROW_BUDGET')

class SqlFailure(Exception):
    def __init__(self, state):
        self.state = state
        super().__init__('DATABASE_SQL_' + state)

class Database:
    def __init__(self, root, deadline, statement_timeout, lock_timeout):
        self.root = root; self.deadline = deadline
        self.cluster = root / 'cluster'; self.socket = root / 'socket'
        self.socket.mkdir(mode=0o700)
        self.statement_timeout = statement_timeout; self.lock_timeout = lock_timeout
        self.started = False
        self.schema = None
        self.identity = str(root.name)
        self.version = ''

    def remaining(self):
        remaining = self.deadline - time.time()
        if remaining <= 0:
            raise TimeoutError('DATABASE_DEADLINE')
        return max(.1, min(remaining, 60))

    def command(self, args, text=None, timeout=None):
        result = subprocess.run(args, input=text, text=True, capture_output=True,
                                timeout=timeout or self.remaining(), env={**os.environ, 'LC_ALL': 'C', 'TZ': 'UTC', 'PGCLIENTENCODING': 'UTF8'})
        if len(result.stdout.encode()) + len(result.stderr.encode()) > MAX_BYTES:
            raise ValueError('DATABASE_OUTPUT_LIMIT')
        return result

    def sql(self, sql, admin=False):
        prefix = "SET timezone='UTC';SET datestyle='ISO,YMD';SET standard_conforming_strings=on;SET search_path=public;SET statement_timeout=" + str(self.statement_timeout) + ";SET lock_timeout=" + str(self.lock_timeout) + ";\n"
        result = self.command(['psql', '-X', '-qAt', '--no-password', '-v', 'ON_ERROR_STOP=1',
                               '-v', 'VERBOSITY=sqlstate', '-h', str(self.socket), '-p', '5432',
                               '-U', 'sakura_tool_admin' if admin else 'sakura_rehearsal',
                               '-d', 'postgres' if admin else 'sakura_rehearsal'], prefix + sql)
        if result.returncode:
            state = re.search(r'(?:ERROR|FATAL):\s+([A-Z0-9]{5})', result.stderr)
            raise SqlFailure(state.group(1) if state else 'XXXXX')
        return result.stdout.strip()

    def start(self):
        version = self.command(['postgres', '--version'])
        if version.returncode or not re.search(r'PostgreSQL\) 17\.', version.stdout):
            raise ValueError('DATABASE_POSTGRES_PROFILE')
        self.version = version.stdout.strip()
        created = self.command(['initdb', '-D', str(self.cluster), '-U', 'sakura_tool_admin',
                                '--encoding=UTF8', '--locale=C', '--auth-local=trust', '--auth-host=reject'])
        if created.returncode:
            raise ValueError('DATABASE_INITDB')
        with (self.cluster / 'postgresql.conf').open('a', encoding='utf-8') as stream:
            stream.write("\nlisten_addresses=''\nunix_socket_directories='" + str(self.socket).replace("'", "''") + "'\nunix_socket_permissions=0700\nshared_preload_libraries=''\nmax_connections=8\nshared_buffers=32MB\nmax_worker_processes=0\nmax_parallel_workers=0\nfsync=on\nfull_page_writes=on\n")
        started = self.command(['pg_ctl', '-D', str(self.cluster), '-l', str(self.root / 'postgres.log'), '-w', '-t', '30', 'start'])
        if started.returncode:
            raise ValueError('DATABASE_START')
        self.started = True
        self.sql('CREATE ROLE sakura_rehearsal LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; CREATE DATABASE sakura_rehearsal OWNER sakura_rehearsal TEMPLATE template0 ENCODING \'UTF8\' LC_COLLATE \'C\' LC_CTYPE \'C\';', True)
        self.sql("REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE,CREATE ON SCHEMA public TO sakura_rehearsal;")

    def create_table(self, table):
        definitions = [ident(c['name']) + ' ' + typename(c['type']) + ('' if c['nullable'] else ' NOT NULL') for c in table['columns']]
        self.sql('CREATE TABLE ' + ident(table['name']) + '(' + ','.join(definitions) + ')')

    def add_constraint(self, table, constraint):
        if constraint['kind'] == 'not-null':
            return 'ALTER TABLE ' + ident(table) + ' ALTER COLUMN ' + ident(constraint['columns'][0]) + ' SET NOT NULL'
        return 'ALTER TABLE ' + ident(table) + ' ADD CONSTRAINT ' + ident(constraint['name']) + (' PRIMARY KEY ' if constraint['kind'] == 'primary' else ' UNIQUE ') + '(' + ','.join(map(ident, constraint['columns'])) + ')'

    def index_sql(self, table, item):
        return 'CREATE ' + ('UNIQUE ' if item['unique'] else '') + 'INDEX ' + ident(item['name']) + ' ON ' + ident(table) + '(' + ','.join(map(ident, item['columns'])) + ')'

    def load(self, dataset):
        self.schema = copy.deepcopy(dataset['schema'])
        for table in self.schema['tables']:
            self.create_table(table)
            rows = next(body['rows'] for body in dataset['data'] if body['table'] == table['name'])
            for offset in range(0, len(rows), 100):
                self.sql('INSERT INTO ' + ident(table['name']) + ' VALUES ' + ','.join('(' + ','.join(map(literal, row)) + ')' for row in rows[offset:offset + 100]))
            for item in table['constraints']:
                self.sql(self.add_constraint(table['name'], item))
            for item in table['indexes']:
                self.sql(self.index_sql(table['name'], item))

    def snapshot(self):
        data = []; counts = {}
        actual_tables = json.loads(self.sql("SELECT COALESCE(json_agg(tablename ORDER BY tablename),'[]'::json) FROM pg_tables WHERE schemaname='public'"))
        if actual_tables != sorted(t['name'] for t in self.schema['tables']):
            raise ValueError('DATABASE_SCHEMA_DRIFT')
        for table in sorted(self.schema['tables'], key=lambda item: item['name']):
            query = "SELECT COALESCE(json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) ORDER BY a.attnum),'[]'::json) FROM pg_attribute a JOIN pg_class c ON a.attrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND c.relname=" + literal(table['name']) + " AND a.attnum>0 AND NOT a.attisdropped"
            columns = json.loads(self.sql(query))
            for col, actual in zip(table['columns'], columns):
                expected_not_null = not col['nullable'] or any(col['name'] in item['columns'] and item['kind'] in ('primary', 'not-null') for item in table['constraints'])
                if actual['name'] != col['name'] or actual['type'].replace('timestamp with time zone', 'timestamptz') != col['type'] or actual['notNull'] != expected_not_null:
                    raise ValueError('DATABASE_SCHEMA_DRIFT')
            if len(columns) != len(table['columns']):
                raise ValueError('DATABASE_SCHEMA_DRIFT')
            actual_constraints = json.loads(self.sql("SELECT COALESCE(json_agg(json_build_object('name',con.conname,'kind',con.contype,'columns',(SELECT json_agg(a.attname ORDER BY x.n) FROM unnest(con.conkey) WITH ORDINALITY x(attnum,n) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=x.attnum)) ORDER BY con.conname),'[]'::json) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=" + literal(table['name']) + " AND con.contype IN ('p','u')"))
            expected_constraints = sorted([{'name': item['name'], 'kind': 'p' if item['kind'] == 'primary' else 'u', 'columns': item['columns']} for item in table['constraints'] if item['kind'] != 'not-null'], key=lambda item: item['name'])
            if actual_constraints != expected_constraints:
                raise ValueError('DATABASE_CONSTRAINT_DRIFT')
            actual_indexes = json.loads(self.sql("SELECT COALESCE(json_agg(json_build_object('name',ic.relname,'unique',ix.indisunique,'columns',(SELECT json_agg(a.attname ORDER BY x.n) FROM unnest(ix.indkey) WITH ORDINALITY x(attnum,n) JOIN pg_attribute a ON a.attrelid=ix.indrelid AND a.attnum=x.attnum)) ORDER BY ic.relname),'[]'::json) FROM pg_index ix JOIN pg_class c ON c.oid=ix.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=ix.indexrelid WHERE n.nspname='public' AND c.relname=" + literal(table['name']) + " AND NOT EXISTS(SELECT 1 FROM pg_constraint co WHERE co.conindid=ix.indexrelid)"))
            if actual_indexes != sorted(table['indexes'], key=lambda item: item['name']):
                raise ValueError('DATABASE_INDEX_DRIFT')
            def canonical_column(column):
                name = ident(column['name'])
                if column['type'] == 'boolean':
                    return name
                if column['type'] == 'timestamptz':
                    return 'to_char(' + name + ' AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\')'
                return name + '::text'
            expr = ','.join(canonical_column(c) for c in table['columns'])
            rows = [json.loads(line) for line in self.sql('SELECT json_build_array(' + expr + ') FROM ' + ident(table['name'])).splitlines() if line]
            if len(rows) > 5000:
                raise ValueError('DATABASE_ROW_BUDGET')
            rows.sort(key=lambda row: canonical(row).encode('utf-8'))
            counts[table['name']] = len(rows); data.append({'table': table['name'], 'rows': rows})
        schema = copy.deepcopy(self.schema); schema['tables'].sort(key=lambda table: table['name'])
        fixed = {'schema': schema, 'data': data, 'algorithm': 'postgres-canonical-rows-v1', 'coverage': 'complete'}
        return {'format': 'sakura-database-snapshot/1', **fixed, 'rowCounts': counts, 'digest': digest(fixed), 'postgresVersion': self.version, 'databaseIdentity': self.identity}

    def operation(self, op):
        kind = op.get('kind'); schema = copy.deepcopy(self.schema)
        if kind == 'create-table':
            strict(op, ['kind', 'table']); validate_schema({**schema, 'tables': [op['table']]})
            if any(t['name'] == op['table']['name'] for t in schema['tables']):
                raise ValueError('DATABASE_TABLE_EXISTS')
            definitions = [ident(c['name']) + ' ' + typename(c['type']) + ('' if c['nullable'] else ' NOT NULL') for c in op['table']['columns']]
            sql = 'CREATE TABLE ' + ident(op['table']['name']) + '(' + ','.join(definitions) + ');'
            sql += ';'.join(self.add_constraint(op['table']['name'], item) for item in op['table']['constraints']) + ';'
            sql += ';'.join(self.index_sql(op['table']['name'], item) for item in op['table']['indexes'])
            schema['tables'].append(op['table'])
        else:
            table = next((t for t in schema['tables'] if t['name'] == op.get('table')), None)
            if not table:
                raise ValueError('DATABASE_TABLE_MISSING')
            table_name = ident(table['name'])
            def column(name):
                result = next((c for c in table['columns'] if c['name'] == name), None)
                if not result:
                    raise ValueError('DATABASE_COLUMN_MISSING')
                return result
            if kind == 'add-column':
                strict(op, ['kind', 'table', 'column']); c = op['column']; strict(c, ['name', 'type', 'nullable'])
                sql = 'ALTER TABLE ' + table_name + ' ADD COLUMN ' + ident(c['name']) + ' ' + typename(c['type']) + ('' if c['nullable'] else ' NOT NULL')
                table['columns'].append(c)
            elif kind == 'rename-column':
                strict(op, ['kind', 'table', 'from', 'to']); column(op['from'])['name'] = op['to']
                sql = 'ALTER TABLE ' + table_name + ' RENAME COLUMN ' + ident(op['from']) + ' TO ' + ident(op['to'])
                for item in table['constraints'] + table['indexes']:
                    item['columns'] = [op['to'] if name == op['from'] else name for name in item['columns']]
            elif kind == 'convert-column':
                strict(op, ['kind', 'table', 'column', 'to', 'rejectLoss'])
                if op['rejectLoss'] is not True:
                    raise ValueError('DATABASE_LOSS_POLICY')
                c = column(op['column']); old = typename(c['type']); new = typename(op['to']); col = ident(c['name'])
                lost = self.sql('SELECT count(*) FROM ' + table_name + ' WHERE ' + col + ' IS DISTINCT FROM ((' + col + '::' + new + ')::' + old + ')')
                if lost != '0':
                    raise ValueError('DATABASE_CONVERSION_LOSS')
                sql = 'ALTER TABLE ' + table_name + ' ALTER COLUMN ' + col + ' TYPE ' + new + ' USING ' + col + '::' + new
                c['type'] = new
            elif kind == 'drop-column':
                strict(op, ['kind', 'table', 'column']); column(op['column'])
                if any(op['column'] in item['columns'] for item in table['constraints'] + table['indexes']):
                    raise ValueError('DATABASE_DEPENDENT_COLUMN')
                sql = 'ALTER TABLE ' + table_name + ' DROP COLUMN ' + ident(op['column']) + ' RESTRICT'
                table['columns'] = [c for c in table['columns'] if c['name'] != op['column']]
            elif kind == 'create-index':
                strict(op, ['kind', 'table', 'index']); sql = self.index_sql(table['name'], op['index']); table['indexes'].append(op['index'])
            elif kind == 'add-constraint':
                strict(op, ['kind', 'table', 'constraint']); sql = self.add_constraint(table['name'], op['constraint']); table['constraints'].append(op['constraint'])
            elif kind == 'backfill':
                strict(op, ['kind', 'table', 'column', 'expression', 'onlyNull']); c = column(op['column']); expression = op['expression']; typ = expression.get('kind')
                if typ == 'constant':
                    strict(expression, ['kind', 'value']); value = literal(expression['value'])
                else:
                    source = ident(column(expression.get('column'))['name'])
                    if typ == 'copy':
                        strict(expression, ['kind', 'column']); value = source
                    elif typ in ('lower', 'upper'):
                        strict(expression, ['kind', 'column']); value = typ + '(' + source + ')'
                    elif typ == 'coalesce':
                        strict(expression, ['kind', 'column', 'fallback']); value = 'coalesce(' + source + ',' + literal(expression['fallback']) + ')'
                    else:
                        raise ValueError('DATABASE_EXPRESSION')
                sql = 'UPDATE ' + table_name + ' SET ' + ident(c['name']) + '=' + value + (' WHERE ' + ident(c['name']) + ' IS NULL' if op['onlyNull'] else '')
            else:
                raise ValueError('DATABASE_OPERATION')
        validate_schema(schema)
        self.sql('BEGIN;' + sql + ';COMMIT;')
        self.schema = schema

    def stop(self):
        if not self.started:
            return True
        result = self.command(['pg_ctl', '-D', str(self.cluster), '-m', 'immediate', '-w', '-t', '10', 'stop'], timeout=15)
        self.started = False
        return result.returncode == 0 and not (self.cluster / 'postmaster.pid').exists()

def main():
    raw = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('DATABASE_INPUT_LIMIT')
    envelope = json.loads(raw)
    value = envelope['input']
    strict(value, ['format', 'mode', 'dataset', 'operations', 'expectedBaselineDigest', 'deadline', 'lockTimeoutMs', 'statementTimeoutMs'])
    if value['format'] != 'sakura-database-worker/1' or value['mode'] not in ('rehearse', 'restore') or len(value['operations']) > 50:
        raise ValueError('DATABASE_INPUT')
    validate_dataset(value['dataset'])
    if digest(value) != envelope['inputDigest']:
        raise ValueError('DATABASE_INPUT_DIGEST')
    deadline = datetime.datetime.fromisoformat(envelope['deadline'].replace('Z', '+00:00')).timestamp()
    deadline = min(deadline, datetime.datetime.fromisoformat(value['deadline'].replace('Z', '+00:00')).timestamp())
    if not 0 < deadline - time.time() <= 900 or not 100 <= value['lockTimeoutMs'] <= 5000 or not 100 <= value['statementTimeoutMs'] <= 30000:
        raise ValueError('DATABASE_DEADLINE')
    if value['mode'] == 'restore' and (value['operations'] or value['dataset']['source'] != 'captured-baseline' or not value['expectedBaselineDigest']):
        raise ValueError('DATABASE_RESTORE_INPUT')
    root = pathlib.Path(tempfile.mkdtemp(prefix='db-rehearsal-', dir='/tmp'))
    os.chmod(root, 0o700)
    db = Database(root, deadline, value['statementTimeoutMs'], value['lockTimeoutMs'])
    journal = root / 'intent.jsonl'
    def append(item):
        with journal.open('a', encoding='utf-8') as stream:
            stream.write(canonical(item) + '\n'); stream.flush(); os.fsync(stream.fileno())
    try:
        db.start(); db.load(value['dataset']); RESULT['baseline'] = db.snapshot()
        if value['expectedBaselineDigest'] and RESULT['baseline']['digest'] != value['expectedBaselineDigest']:
            raise ValueError('DATABASE_BASELINE_CHANGED')
        for sequence, operation in enumerate(value['operations']):
            before = db.snapshot(); started = time.monotonic()
            intent = digest({'sessionId': envelope['sessionId'], 'sequence': sequence, 'operation': operation, 'beforeDigest': before['digest']})
            step = {'sequence': sequence, 'operation': operation, 'state': 'unknown', 'intentDigest': intent, 'beforeDigest': before['digest'], 'afterDigest': None, 'durationMs': 0, 'sqlState': None, 'error': None, 'transaction': 'per-operation'}
            append({'state': 'intent', 'intentDigest': intent, 'sequence': sequence}); RESULT['steps'].append(step)
            committed = False
            try:
                db.operation(operation); committed = True; after = db.snapshot()
                step.update(state='observed', afterDigest=after['digest'])
                append({'state': 'observed', 'sequence': sequence, 'intentDigest': intent, 'afterDigest': after['digest']})
            except (SqlFailure, ValueError) as error:
                uncertain = committed or getattr(error, 'state', None) == 'XXXXX'
                step.update(state='unknown' if uncertain else 'failed', sqlState=getattr(error, 'state', None), error=str(error)[:1000])
                append({'state': step['state'], 'sequence': sequence, 'intentDigest': intent, 'error': str(error)[:1000]})
                RESULT['outcome'] = 'inconclusive' if uncertain else 'failed'; RESULT['error'] = str(error)[:1000]
                break
            finally:
                step['durationMs'] = max(0, (time.monotonic() - started) * 1000)
        RESULT['after'] = db.snapshot()
        RESULT['state'] = 'completed' if not RESULT['error'] else 'failed'
        if not RESULT['error']:
            RESULT['outcome'] = 'passed'
        if value['mode'] == 'restore':
            confirmed = RESULT['after']['digest'] == value['expectedBaselineDigest']
            RESULT['recovery'] = {'expectedDigest': value['expectedBaselineDigest'], 'actualDigest': RESULT['after']['digest'], 'confirmed': confirmed, 'kind': 'canonical-logical-baseline'}
            if not confirmed:
                RESULT['outcome'] = 'failed'
    except BaseException as error:
        RESULT['error'] = str(error)[:1000]
        RESULT['state'] = 'interrupted' if isinstance(error, (KeyboardInterrupt, TimeoutError)) else 'failed'
        RESULT['outcome'] = 'inconclusive'
    finally:
        try:
            RESULT['cleanup'] = 'confirmed' if db.stop() else 'unknown'
        except BaseException:
            RESULT['cleanup'] = 'unknown'
        encoded = canonical(RESULT).encode('utf-8')
        if len(encoded) > MAX_BYTES:
            RESULT.update(baseline=None, after=None, outcome='inconclusive', error='DATABASE_OUTPUT_LIMIT')
            encoded = canonical(RESULT).encode('utf-8')
        sys.stdout.buffer.write(encoded); sys.stdout.buffer.flush()

if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        RESULT['error'] = str(error)[:1000]
        sys.stdout.write(canonical(RESULT))
