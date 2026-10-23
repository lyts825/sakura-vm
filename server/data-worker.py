"""Trusted bounded table worker. Runs only inside an owned guest task domain."""
import csv
import datetime
import decimal
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import sys

LIMIT = 256 * 1024 * 1024
ROOT = Path.cwd().resolve()
OUT = ROOT / 'output'


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def plain(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError('DATA_NON_FINITE')
        return value
    if isinstance(value, (decimal.Decimal, datetime.date, datetime.datetime)):
        return str(value)
    raise ValueError('DATA_NESTED_TYPE')


def scalar_type(value):
    return bool(re.fullmatch(r'(BOOLEAN|TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|VARCHAR|DATE|TIMESTAMP(_MS|_S)?|TIMESTAMP WITH TIME ZONE|DECIMAL\(\d+,\d+\))', value))


def schema(description):
    result = []
    for name, dtype, *_ in description:
        kind = str(dtype)
        if not scalar_type(kind) or not name or len(name) > 256:
            raise ValueError('DATA_UNSUPPORTED_SCHEMA')
        result.append({'name': name, 'type': kind, 'nullable': True})
    if len(result) > 512 or len({x['name'] for x in result}) != len(result):
        raise ValueError('DATA_SCHEMA_LIMIT')
    return result


def known_path(value):
    path = ROOT / value
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT / 'inputs'):
        raise ValueError('DATA_INPUT_PATH')
    return str(path)


def validate_input_files(files, fmt, options):
    if fmt == 'csv' and options['header']:
        for path in files:
            with open(path, encoding='utf-8', newline='') as handle:
                header = next(csv.reader(handle, delimiter=options['delimiter'], strict=True), None)
                if header is None or any(not name for name in header) or len(header) > 512 or len({v.casefold() for v in header}) != len(header):
                    raise ValueError('DATA_CSV_HEADER')
    if fmt == 'csv' and not options.get('schema'):
        # Inference must not quietly round precision-sensitive scalar text.
        for path in files:
            with open(path, encoding='utf-8', newline='') as handle:
                rows = csv.reader(handle, delimiter=options['delimiter'], strict=True)
                if options['header']:
                    next(rows, None)
                for row in rows:
                    for value in row:
                        if re.fullmatch(r'[+-]?\d+', value) and abs(int(value)) > 2**127-1:
                            raise ValueError('DATA_EXPLICIT_SCHEMA_REQUIRED')
                        if re.fullmatch(r'[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?', value) and ('.' in value or 'e' in value.lower()) and len(decimal.Decimal(value).as_tuple().digits) > 15:
                            raise ValueError('DATA_EXPLICIT_SCHEMA_REQUIRED')
    if fmt == 'jsonl':
        declared = {c['name']: c['type'] for c in options.get('schema', [])}
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError('DATA_JSON_DUPLICATE_KEY')
                result[key] = value
            return result
        def invalid_constant(value):
            raise ValueError('DATA_NON_FINITE')
        for path in files:
            with open(path, encoding='utf-8', newline='') as handle:
                while True:
                    line = handle.readline(8*1024*1024+1)
                    if not line:
                        break
                    if len(line.encode('utf-8')) > 8*1024*1024:
                        raise ValueError('DATA_JSON_ROW_LIMIT')
                    row = json.loads(line, object_pairs_hook=unique, parse_float=decimal.Decimal, parse_constant=invalid_constant)
                    if not isinstance(row, dict) or len(row) > 512:
                        raise ValueError('DATA_JSON_OBJECT')
                    for key, value in row.items():
                        if isinstance(value, (dict, list)):
                            raise ValueError('DATA_NESTED_TYPE')
                        if key not in declared and ((isinstance(value, int) and not isinstance(value, bool) and abs(value) > 2**63-1) or (isinstance(value, decimal.Decimal) and len(value.as_tuple().digits) > 15)):
                            raise ValueError('DATA_EXPLICIT_SCHEMA_REQUIRED')


def load_table(con, item, index):
    files = [known_path(p) for p in item['files']]
    options = item['parse']
    validate_input_files(files, item['format'], options)
    cols = options.get('schema')
    if cols and any(not scalar_type(c['type']) for c in cols):
        raise ValueError('DATA_UNSUPPORTED_SCHEMA')
    if item['format'] == 'csv':
        relation = con.read_csv(files, header=options['header'], sep=options['delimiter'], na_values=options['nullValue'], compression='uncompressed', sample_size=-1, strict_mode=True, ignore_errors=False, columns={c['name']: c['type'] for c in cols} if cols else None)
    elif item['format'] == 'jsonl':
        relation = con.read_json(files, format='newline_delimited', compression='uncompressed', sample_size=-1, maximum_object_size=8*1024*1024, columns={c['name']: c['type'] for c in cols} if cols else None, ignore_errors=False)
    elif item['format'] == 'parquet':
        relation = con.read_parquet(files)
    else:
        raise ValueError('DATA_FORMAT')
    relation.create(f'data_{index}')
    actual = schema(con.execute(f'SELECT * FROM data_{index} LIMIT 0').description)
    if cols and [(c['name'], c['type']) for c in actual] != [(c['name'], c['type']) for c in cols]:
        raise ValueError('DATA_SCHEMA_MISMATCH')
    return actual


def write_table(cursor):
    columns = schema(cursor.description)
    path = OUT / 'data.csv'
    rows = 0
    # CSV retains decimal and 128-bit integer text. The recorded schema controls every subsequent read.
    with path.open('x', encoding='utf-8', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow([c['name'] for c in columns])
        while True:
            batch = cursor.fetchmany(1000)
            if not batch:
                break
            for row in batch:
                vals = [plain(v) for v in row]
                # Use a reserved null marker, rejecting actual collisions instead of changing values silently.
                if any(v == '__SAKURA_NULL_4c5fa8__' for v in vals):
                    raise ValueError('DATA_NULL_COLLISION')
                writer.writerow(['__SAKURA_NULL_4c5fa8__' if v is None else v for v in vals])
                rows += 1
            handle.flush()
            if path.stat().st_size > LIMIT:
                raise ValueError('DATA_OUTPUT_LIMIT')
    return {'schema': columns, 'rows': rows, 'files': ['output/data.csv'], 'format': 'csv', 'bytes': path.stat().st_size}


def quality(con, rules, sample):
    table = 'data_0'
    if sample:
        con.execute(f'CREATE TEMP TABLE sample_data AS SELECT * FROM data_0 LIMIT {int(sample)}')
        table = 'sample_data'
    total = con.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
    columns = [d[0] for d in con.execute(f'SELECT * FROM {table} LIMIT 0').description]
    profile = []
    for name in columns:
        col = identifier(name)
        nulls, distinct = con.execute(f'SELECT count(*) FILTER (WHERE {col} IS NULL),count(DISTINCT {col}) FROM {table}').fetchone()
        profile.append({'name': name, 'rows': total, 'nulls': nulls, 'distinct': distinct})
    checks = []
    for rule in rules:
        kind = rule['kind']
        if kind == 'row-count':
            failed = int(total < rule['min'] or ('max' in rule and total > rule['max']))
        elif kind == 'unique':
            cols = ','.join(identifier(c) for c in rule['columns'])
            failed = con.execute(f'SELECT coalesce(sum(n),0) FROM (SELECT count(*) n FROM {table} GROUP BY {cols} HAVING count(*)>1)').fetchone()[0]
        elif kind == 'not-null':
            failed = con.execute(f"SELECT count(*) FROM {table} WHERE {identifier(rule['column'])} IS NULL").fetchone()[0]
        elif kind == 'range':
            col = identifier(rule['column'])
            bounds, parameters = [f'{col} IS NULL'], []
            for key, op in [('min','<'), ('max','>')]:
                if key in rule:
                    bounds.append(f'{col} {op} ?')
                    parameters.append(rule[key])
            failed = con.execute(f"SELECT count(*) FROM {table} WHERE {' OR '.join(bounds)}", parameters).fetchone()[0]
        elif kind == 'allowed':
            col = identifier(rule['column'])
            values = rule['values']
            if not values:
                failed = total
            else:
                clauses = [f'{col} IS NOT DISTINCT FROM ?' for _ in values]
                failed = con.execute(f"SELECT count(*) FROM {table} WHERE NOT ({' OR '.join(clauses)})", values).fetchone()[0]
        elif kind == 'reference':
            other = 'data_' + str(rule['datasetIndex'])
            failed = con.execute(f"SELECT count(*) FROM {table} a WHERE NOT EXISTS (SELECT 1 FROM {other} b WHERE a.{identifier(rule['column'])} IS NOT DISTINCT FROM b.{identifier(rule['referenceColumn'])})").fetchone()[0]
        else:
            raise ValueError('DATA_RULE_KIND')
        checks.append({'rule': rule, 'rows': total, 'failed': int(failed), 'verdict': 'fail' if failed else 'pass', 'scope': 'sample' if sample else 'full'})
    return checks, profile


def notebook(task):
    import nbformat
    from nbclient import NotebookClient
    nb = nbformat.reads(task['notebook'], as_version=4)
    if len(nb.cells) > 500:
        raise ValueError('DATA_NOTEBOOK_CELLS')
    for cell in nb.cells:
        if cell.cell_type == 'code':
            cell.outputs = []
            cell.execution_count = None
    nb.metadata.pop('widgets', None)
    (ROOT / 'parameters.json').write_text(json.dumps(task['parameters'], ensure_ascii=False, allow_nan=False), encoding='utf-8')
    (ROOT / 'datasets.json').write_text(json.dumps(task['inputs'], ensure_ascii=False), encoding='utf-8')
    client = NotebookClient(nb, timeout=min(300, task['environment']['timeoutSeconds']), kernel_name='python3', resources={'metadata': {'path': str(ROOT)}}, allow_errors=False, store_widget_state=False)
    client.execute()
    total = 0
    for cell in nb.cells:
        size = len(json.dumps(cell.get('outputs', []), ensure_ascii=False).encode())
        if size > 1024*1024:
            raise ValueError('DATA_NOTEBOOK_OUTPUT_LIMIT')
        total += size
    if total > 32*1024*1024:
        raise ValueError('DATA_NOTEBOOK_OUTPUT_LIMIT')
    nbformat.write(nb, OUT / 'executed.ipynb')
    metrics = {}
    metrics_file = OUT / 'metrics.json'
    if metrics_file.exists():
        if metrics_file.is_symlink() or metrics_file.stat().st_size > 1024*1024:
            raise ValueError('DATA_METRICS_LIMIT')
        metrics = json.loads(metrics_file.read_text())
        if not isinstance(metrics, dict) or len(metrics) > 1000 or any(not isinstance(k,str) or len(k)>128 or isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for k,v in metrics.items()):
            raise ValueError('DATA_METRICS_SCHEMA')
    return {'notebookFile':'output/executed.ipynb','executedCells':sum(c.cell_type=='code' for c in nb.cells),'metrics':metrics}


def main():
    import duckdb
    task = json.loads((ROOT / 'request.json').read_text(encoding='utf-8'))
    OUT.mkdir(mode=0o700, exist_ok=False)
    result = {'checks': [], 'columns': [], 'metrics': {}, 'truncated': False, 'environment': {'python': sys.version.split()[0], 'duckdb': duckdb.__version__, 'uid': str(os.getuid()) if hasattr(os,'getuid') else 'windows-test'}}
    if duckdb.__version__ != '1.5.6':
        raise ValueError('DATA_ENGINE_VERSION')
    if task['kind'] == 'notebook':
        result.update(notebook(task))
    else:
        con = duckdb.connect(':memory:', config={'threads':task['environment']['cpus'],'memory_limit':str(task['environment']['memoryMiB']//2)+'MB','max_temp_directory_size':'4GB','temp_directory':str(ROOT/'scratch'),'autoinstall_known_extensions':False,'autoload_known_extensions':False,'allow_unsigned_extensions':False})
        try:
            for index,item in enumerate(task['inputs']):
                load_table(con, item, index)
            con.execute("SET enable_external_access=false")
            con.execute("SET allow_community_extensions=false")
            con.execute("SET lock_configuration=true")
            if task['kind']=='quality':
                result['checks'],result['columns']=quality(con,task['rules'],task['sample'])
            elif task['kind']=='mask':
                cols=[d[0] for d in con.execute('SELECT * FROM data_0 LIMIT 0').description]
                masks={m['column']:m for m in task['masks']}
                if len(masks)!=len(task['masks']) or any(c not in cols for c in masks):
                    raise ValueError('DATA_MASK_COLUMN')
                expr,params=[],[]
                for name in cols:
                    col=identifier(name);m=masks.get(name)
                    if not m: expr.append(col)
                    elif m['kind']=='drop': continue
                    elif m['kind']=='constant': expr.append(f'? AS {col}');params.append(m['value'])
                    elif m['kind']=='prefix': expr.append(f'left(cast({col} as varchar),?) AS {col}');params.append(m['length'])
                    elif m['kind']=='bucket': expr.append(f'floor({col}/?)*? AS {col}');params.extend([m['size'],m['size']])
                if not expr: raise ValueError('DATA_MASK_EMPTY')
                result['table']=write_table(con.execute('SELECT '+','.join(expr)+' FROM data_0',params))
            else:
                sql=task.get('sql') if task['kind']=='transform' else 'SELECT * FROM data_0'
                statements=con.extract_statements(sql)
                if len(statements)!=1 or str(statements[0].type)!='StatementType.SELECT':
                    raise ValueError('DATA_QUERY_ONLY')
                result['table']=write_table(con.execute(sql,task['parameters'] if task['parameters'] else None))
        finally:
            con.close()
    size=sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file())
    if size>LIMIT: raise ValueError('DATA_OUTPUT_LIMIT')
    (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,allow_nan=False),encoding='utf-8')


if __name__=='__main__':
    try:
        main()
    except Exception as error:
        # Domain errors may contain data values; expose only bounded type/coded errors.
        code=str(error) if re.fullmatch(r'DATA_[A-Z_]+',str(error)) else 'DATA_WORKER_'+type(error).__name__.upper()
        print(code,file=sys.stderr)
        sys.exit(1)
