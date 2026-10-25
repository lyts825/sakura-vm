"""Fixed private SQLite WAL broker and separate consumer process; no network or user code."""
import datetime
import hashlib
import json
import multiprocessing
import os
import pathlib
import sqlite3
import sys
import time


def ticks(pid):
    return (pathlib.Path('/proc') / str(pid) / 'stat').read_text().rsplit(') ', 1)[1].split()[19]


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def consume(channel, config, end):
    channel.send({'kind': 'hello', 'pid': os.getpid(), 'startTicks': ticks(os.getpid())})
    while time.monotonic() < end:
        channel.send({'kind': 'next'})
        task = channel.recv()
        if task is None:
            return
        if task == 'wait':
            time.sleep(0.025)
            continue
        if config['experiment'] == 'slow-consumer':
            time.sleep(config['delayMs'] / 1000)
        if task['messageId'] in config.get('poisonIds', []):
            channel.send({'kind': 'reject', 'sequence': task['sequence']})
            channel.recv()
            continue
        channel.send({'kind': 'effect', 'sequence': task['sequence']})
        channel.recv()
        channel.send({'kind': 'ack-lost' if config['experiment'] == 'ack-loss' and task['attempt'] == 1 else 'ack',
                      'sequence': task['sequence']})
        channel.recv()


def run():
    envelope = json.load(sys.stdin)
    config = envelope['input']
    if config.get('protocol') != 'sakura-event-tool/1' or config['experiment'] not in ('duplicate-delivery', 'ack-loss', 'slow-consumer'):
        raise ValueError('EVENT_PROTOCOL')
    messages = config['messages']
    if not 1 <= len(messages) <= 1000 or len({m['id'] for m in messages}) != len(messages):
        raise ValueError('EVENT_MESSAGES')
    if config['ordering'] not in ('fifo', 'per-key') or not isinstance(config['idempotent'], bool):
        raise ValueError('EVENT_OPTIONS')
    if not 0 <= config['delayMs'] <= 500 or not 0 <= config['retryLimit'] <= 3:
        raise ValueError('EVENT_BUDGET')
    start = time.monotonic()
    seconds = datetime.datetime.fromisoformat(envelope['deadline'].replace('Z', '+00:00')).timestamp() - time.time()
    if not 0 < seconds <= 900:
        raise ValueError('EVENT_DEADLINE')
    end = start + seconds - 0.5
    conn = sqlite3.connect('event-broker.sqlite', isolation_level=None)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=FULL')
    conn.execute('CREATE TABLE queue(sequence INTEGER PRIMARY KEY, id TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, visible REAL NOT NULL DEFAULT 0)')
    conn.execute('CREATE TABLE effects(id TEXT PRIMARY KEY, key TEXT NOT NULL, count INTEGER NOT NULL, digest TEXT NOT NULL)')
    trace = []
    log = open('event-intents.jsonl', 'x', encoding='utf-8')

    def event(kind, message_id, attempt, queue_sequence=None):
        if len(trace) >= 12000:
            raise ValueError('EVENT_TRACE_LIMIT')
        delivery = str(queue_sequence) + ':' + str(attempt) if queue_sequence is not None else None
        row = {'sequence': len(trace) + 1, 'kind': kind, 'messageId': message_id, 'deliveryId': delivery, 'attempt': attempt, 'atNs': str(time.monotonic_ns())}
        log.write(canonical(row) + '\n')
        log.flush()
        os.fsync(log.fileno())
        trace.append(row)

    for message in messages:
        digest = hashlib.sha256(canonical(message['payload']).encode()).hexdigest()
        event('produce', message['id'], 0)
        conn.execute('INSERT INTO queue(id,key,digest,state) VALUES(?,?,?,?)', (message['id'], message['key'], digest, 'ready'))
        event('enqueue', message['id'], 0)
        if config['experiment'] == 'duplicate-delivery':
            conn.execute('INSERT INTO queue(id,key,digest,state) VALUES(?,?,?,?)', (message['id'], message['key'], digest, 'ready'))
            event('enqueue', message['id'], 0)
    context = multiprocessing.get_context('fork')
    local, remote = context.Pipe(duplex=True)
    child = context.Process(target=consume, args=(remote, config, end), daemon=True)
    child.start()
    remote.close()
    consumer = None
    try:
        while time.monotonic() < end:
            if not local.poll(0.05):
                if not child.is_alive():
                    break
                continue
            request = local.recv()
            kind = request['kind']
            if kind == 'hello':
                if request['pid'] != child.pid or request['startTicks'] != ticks(child.pid):
                    raise ValueError('EVENT_CONSUMER_IDENTITY')
                consumer = {'pid': request['pid'], 'startTicks': request['startTicks']}
                continue
            if kind == 'next':
                conn.execute("UPDATE queue SET state='ready' WHERE state='leased' AND visible<=?", (time.monotonic(),))
                order = 'sequence' if config['ordering'] == 'fifo' else 'key,sequence'
                selected = conn.execute("SELECT sequence,id,key,digest,attempts FROM queue WHERE state='ready' ORDER BY " + order + ' LIMIT 1').fetchone()
                if selected is None:
                    remaining = conn.execute("SELECT COUNT(*) FROM queue WHERE state IN ('ready','leased')").fetchone()[0]
                    local.send('wait' if remaining else None)
                    if not remaining:
                        break
                    continue
                sequence, message_id, _, _, attempt = selected
                if attempt > config['retryLimit']:
                    event('dead-letter', message_id, attempt, sequence)
                    conn.execute("UPDATE queue SET state='dead' WHERE sequence=?", (sequence,))
                    local.send('wait')
                    continue
                event('deliver', message_id, attempt + 1, sequence)
                conn.execute("UPDATE queue SET state='leased',attempts=attempts+1,visible=? WHERE sequence=?", (time.monotonic() + 0.1, sequence))
                local.send({'sequence': sequence, 'messageId': message_id, 'attempt': attempt + 1})
                continue
            selected = conn.execute("SELECT id,key,digest,attempts,state FROM queue WHERE sequence=?", (request['sequence'],)).fetchone()
            if selected is None or selected[4] != 'leased':
                raise ValueError('EVENT_LEASE_IDENTITY')
            message_id, key, digest, attempt, _ = selected
            if kind == 'effect':
                previous = conn.execute('SELECT count FROM effects WHERE id=?', (message_id,)).fetchone()
                if previous and config['idempotent']:
                    event('deduplicate', message_id, attempt, request['sequence'])
                else:
                    event('effect', message_id, attempt, request['sequence'])
                    conn.execute('INSERT INTO effects(id,key,count,digest) VALUES(?,?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1', (message_id, key, digest))
                    event('effect-applied', message_id, attempt, request['sequence'])
            elif kind == 'reject':
                event('reject', message_id, attempt, request['sequence'])
                conn.execute("UPDATE queue SET state='ready' WHERE sequence=?", (request['sequence'],))
            elif kind in ('ack', 'ack-lost'):
                event(kind, message_id, attempt, request['sequence'])
                if kind == 'ack':
                    conn.execute("UPDATE queue SET state='acked' WHERE sequence=?", (request['sequence'],))
            else:
                raise ValueError('EVENT_COMMAND')
            local.send(True)
    finally:
        local.close()
        child.join(timeout=0.5)
        if child.is_alive():
            child.terminate()
            child.join(timeout=2)
        if child.is_alive():
            child.kill()
            child.join(timeout=2)
        log.close()
    if not consumer:
        raise ValueError('EVENT_CONSUMER_UNCONFIRMED')
    effects = [{'messageId': r[0], 'key': r[1], 'count': r[2], 'digest': r[3]} for r in conn.execute('SELECT id,key,count,digest FROM effects ORDER BY id')]
    remaining = conn.execute("SELECT COUNT(*) FROM queue WHERE state IN ('ready','leased')").fetchone()[0]
    dead = conn.execute("SELECT COUNT(*) FROM queue WHERE state='dead'").fetchone()[0]
    acknowledged = conn.execute("SELECT COUNT(*) FROM queue WHERE state='acked'").fetchone()[0]
    conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    conn.close()
    outcome = 'inconclusive' if remaining else 'failed' if dead or any(r['count'] != 1 for r in effects) else 'passed'
    result = {'protocol': 'sakura-event-result/1', 'sessionId': envelope['sessionId'], 'inputDigest': envelope['inputDigest'],
              'broker': {'engine': 'sqlite-wal', 'version': sqlite3.sqlite_version, 'pid': os.getpid(), 'startTicks': ticks(os.getpid())},
              'consumer': consumer, 'outcome': outcome, 'produced': len(messages),
              'delivered': sum(r['kind'] == 'deliver' for r in trace), 'acknowledged': acknowledged,
              'deduplicated': sum(r['kind'] == 'deduplicate' for r in trace), 'deadLetters': dead, 'remaining': remaining,
              'effects': effects, 'trace': trace, 'elapsedMs': (time.monotonic() - start) * 1000}
    encoded = canonical(result)
    if len(encoded.encode()) > 8 * 1024 * 1024 - 8192:
        raise ValueError('EVENT_OUTPUT_LIMIT')
    sys.stdout.write(encoded)


if __name__ == '__main__':
    run()
