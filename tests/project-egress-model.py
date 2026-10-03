"""Portable transaction tests of production egress definitions; no Linux proof."""
import ast
import base64
import copy
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
import types
import uuid

source = Path(sys.argv[1]).read_bytes()
tree = ast.parse(source)
definitions = ast.Module(body=[node for node in tree.body if isinstance(node, (ast.Assign, ast.FunctionDef, ast.ClassDef))], type_ignores=[])


def fixture(mode='private'):
    ns = dict(base64=base64, hashlib=hashlib, json=json, os=os, re=re, stat=stat, struct=struct, uuid=uuid)
    exec(compile(definitions, 'production-egress-definitions', 'exec'), ns)
    value = dict(version=1, phase='active', registryId=str(uuid.uuid4()), identityId=str(uuid.uuid4()),
                 projectId='default', uid=20000, networkIsolation=mode, revision=1, directory='/workspace')
    current = copy.deepcopy(value)
    context = dict(bootId=str(uuid.uuid4()), networkDevice='4', networkInode='4001')
    records, tables, events = {}, {}, []
    flags = dict(lost_create=False, lost_delete=False, lost_write=False, handle=50)
    ns['egress_context'] = lambda: dict(context)
    ns['egress_nnp_check'] = lambda _value: None
    ns['egress_nnp_configuration'] = lambda: 'systemd'
    ns['egress_systemd_nnp'] = lambda _units: None
    ns['json_read'] = lambda path, *_args: copy.deepcopy(records.get(path))
    def write(path, record):
        records[path] = copy.deepcopy(record)
        events.append(('record', record['phase'], record['mode']))
        if flags['lost_write']:
            flags['lost_write'] = False
            raise OSError('owned durable write ACK lost')
    ns['json_write'] = write
    ns['binding_read'] = lambda *_args: copy.deepcopy(current)
    def kernel(arguments, data=None, *, json_output=True):
        if arguments == ['list', 'tables']:
            assert json_output is True and data is None
            return json.dumps({'nftables': [{'metainfo': {'json_schema_version': 1}}] +
                              [{'table': {'family': 'inet', 'name': name, 'handle': items[0]['table']['handle']}}
                               for name, items in tables.items()]}).encode()
        if arguments[:3] == ['list', 'table', 'inet']:
            assert json_output is True and data is None
            return json.dumps({'nftables': tables[arguments[3]]}).encode()
        assert arguments == ['-f', '-']
        if json_output:
            batch = json.loads(data)['nftables']
            assert len(batch) == 1 and set(batch[0]) == {'delete'}, 'only deletion uses JSON transactions'
            name = batch[0]['delete']['table']['name']
            events.append(('delete', name))
            del tables[name]
            if flags['lost_delete']:
                flags['lost_delete'] = False
                raise OSError('owned delete ACK lost')
        else:
            # Independently parse the entire controlled syntax. Never accept
            # arbitrary strings or construct the fake kernel by echoing the
            # production generator/spec; every policy token is fixed here.
            assert isinstance(data, bytes)
            marker = rb'sakura-project-egress-v1:[a-f0-9-]{36}:[a-f0-9-]{36}'
            syntax = (rb'create table inet skp_uid_([0-9]+) \{ comment "(' + marker + rb')"; \}\n'
                      rb'add chain inet skp_uid_([0-9]+) output \{ type filter hook output priority 300; policy accept; \}\n'
                      rb'add rule inet skp_uid_([0-9]+) output meta skuid ([0-9]+) drop comment "(' + marker + rb')"\n')
            matched = re.fullmatch(syntax, data)
            assert matched is not None, 'unknown fixed create syntax or extra token'
            uid, owner, chain_table_uid, rule_table_uid, rule_uid, rule_owner = [item.decode('ascii') for item in matched.groups()]
            expected_owner = 'sakura-project-egress-v1:' + value['registryId'] + ':' + value['identityId']
            assert uid == chain_table_uid == rule_table_uid == rule_uid == str(value['uid'])
            assert owner == rule_owner == expected_owner
            name = 'skp_uid_' + uid
            common = {'family': 'inet', 'table': name}
            items = [{'table': {'family': 'inet', 'name': name, 'comment': owner}},
                     {'chain': dict(common, name='output', type='filter', hook='output', prio=300, policy='accept')},
                     {'rule': dict(common, chain='output', comment=owner, expr=[
                         {'match': {'op': '==', 'left': {'meta': {'key': 'skuid'}}, 'right': int(uid)}}, {'drop': None}])}]
            assert name not in tables
            for item in items:
                flags['handle'] += 1
                next(iter(item.values()))['handle'] = flags['handle']
            tables[name] = items
            events.append(('create', name))
            if flags['lost_create']:
                flags['lost_create'] = False
                raise OSError('owned create ACK lost')
        return b''
    ns['egress_nft'] = kernel
    return types.SimpleNamespace(ns=ns, value=value, current=current, records=records,
                                 tables=tables, flags=flags, events=events, context=context)


def refused(f, call, code):
    try:
        call()
    except f.ns['Refusal'] as error:
        assert error.code == code, (error.code, code)
    else:
        raise AssertionError('expected ' + code)


def provision(f):
    f.ns['egress_prepare'](f.value)
    f.ns['egress_commit'](f.value)


def private_and_host_rules():
    f = fixture()
    provision(f)
    name, objects = f.ns['egress_spec'](f.value)
    assert len(f.tables) == 1 and name == 'skp_uid_20000'
    assert objects[1]['chain']['hook'] == 'output' and objects[1]['chain']['family'] == 'inet'
    assert objects[2]['rule']['expr'] == [{'match': {'op': '==', 'left': {'meta': {'key': 'skuid'}}, 'right': 20000}}, {'drop': None}]
    assert f.events[0] == ('record', 'pending', 'private') and f.events[1][0] == 'create'
    before = copy.deepcopy(f.records), len(f.events)
    f.ns['egress_check'](f.value)
    assert before == (f.records, len(f.events)), 'readonly validation must not repair'
    shared = fixture('host')
    shared.ns['egress_context'] = lambda: (_ for _ in ()).throw(AssertionError('host needs no namespace query'))
    provision(shared)
    assert not shared.tables and not shared.records


def create_ack_and_record_loss():
    for flag in ('lost_create', 'lost_write'):
        f = fixture()
        f.flags[flag] = True
        try:
            provision(f)
        except OSError:
            pass
        else:
            raise AssertionError('lost ACK must remain failure')
        refused(f, lambda: f.ns['egress_check'](f.value), 'EGRESS_PENDING')
        provision(f)
        assert len(f.tables) == 1
        f.ns['egress_check'](f.value)


def foreign_or_tampered_table():
    for damage in ('handle', 'uid', 'verdict', 'chain', 'extra', 'absent'):
        f = fixture()
        provision(f)
        name = f.ns['egress_spec'](f.value)[0]
        if damage == 'handle': f.tables[name][0]['table']['handle'] += 100
        elif damage == 'uid': f.tables[name][2]['rule']['expr'][0]['match']['right'] += 1
        elif damage == 'verdict': f.tables[name][2]['rule']['expr'][1] = {'accept': None}
        elif damage == 'chain': f.tables[name][1]['chain']['prio'] = 0
        elif damage == 'extra': f.tables[name].append({'rule': {'handle': 555, 'family': 'inet'}})
        else: del f.tables[name]
        before = copy.deepcopy(f.tables), copy.deepcopy(f.records)
        refused(f, lambda: f.ns['egress_check'](f.value), 'EGRESS_TABLE_CHANGED')
        refused(f, lambda: f.ns['egress_prepare'](f.value), 'EGRESS_TABLE_CHANGED')
        assert before == (f.tables, f.records)
    f = fixture()
    name, objects = f.ns['egress_spec'](f.value)
    f.tables[name] = copy.deepcopy(objects)
    for i, item in enumerate(f.tables[name]): next(iter(item.values()))['handle'] = i + 1
    refused(f, lambda: provision(f), 'EGRESS_OWNER_ABSENT')
    assert not f.records


def modes_and_exact_delete():
    f = fixture()
    provision(f)
    target = dict(f.value, revision=2, networkIsolation='host')
    f.ns['egress_prepare'](target, transition=True)
    assert f.tables, 'host mode cannot unblock before binding commit'
    refused(f, lambda: f.ns['egress_commit'](target), 'EGRESS_PENDING')
    f.current.update(target)
    f.flags['lost_delete'] = True
    try: f.ns['egress_commit'](target)
    except OSError: pass
    else: raise AssertionError('delete ACK loss must remain pending')
    assert not f.tables and next(iter(f.records.values()))['deleteIssued']
    refused(f, lambda: f.ns['egress_check'](target), 'EGRESS_PENDING')
    f.ns['egress_prepare'](target)
    f.ns['egress_commit'](target)
    assert not f.tables and next(iter(f.records.values()))['phase'] == 'applied'
    f.ns['egress_check'](target)
    private = dict(target, revision=3, networkIsolation='private')
    f.ns['egress_prepare'](private, transition=True)
    refused(f, lambda: f.ns['egress_check'](target), 'EGRESS_PENDING')
    f.current.update(private)
    f.ns['egress_commit'](private)
    assert len(f.tables) == 1


def owner_and_namespace_refusals():
    for key, changed in [('identityId', str(uuid.uuid4())), ('uid', 21000), ('projectId', '1234567890abcdef'),
                         ('networkInode', '9999'), ('handle', True), ('deleteIssued', 1)]:
        f = fixture()
        provision(f)
        state = next(iter(f.records.values()))
        state[key] = changed
        before = copy.deepcopy(f.tables), copy.deepcopy(f.records)
        try: f.ns['egress_prepare'](f.value)
        except f.ns['Refusal']: pass
        else: raise AssertionError('foreign owner must refuse')
        assert before == (f.tables, f.records)


def reboot_restores_intents():
    f = fixture()
    provision(f)
    f.context['bootId'] = str(uuid.uuid4())
    f.context['networkInode'] = '4002'
    f.tables.clear()
    refused(f, lambda: f.ns['egress_check'](f.value), 'EGRESS_PENDING')
    f.current['phase'] = f.value['phase'] = 'intent'
    f.ns['reservation_check'] = lambda value, _store: None
    result = f.ns['egress_restore']({'reserved': {'20000': {'projectId': 'default'}}})
    assert result == {'version': 1, 'privateAccounts': 1} and len(f.tables) == 1
    f.ns['egress_check'](f.value)
    assert next(iter(f.records.values()))['bootId'] == f.context['bootId']


def boot_service_plans():
    f = fixture()
    files, links, _appends = f.ns['egress_boot_plan']('a' * 64, 'systemd')
    restore = files[f.ns['EGRESS_BOOT'] + '/restore']['data']
    assert b'env -i' in restore and b'python3 -I -S' in restore
    assert base64.b64encode(b'{"action":"restore-egress"}') in restore
    assert b'DefaultDependencies=no' in files['/etc/systemd/system/sakura-project-egress.service']['data']
    for name in ('ssh.service', 'sshd.service', 'ssh@.service', 'sshd@.service', 'cron.service', 'crond.service',
                 'cronie.service', 'atd.service', 'systemd-user-sessions.service', 'user@.service'):
        assert files['/etc/systemd/system/' + name + '.d/sakura-project-egress.conf']['data'] == \
            b'[Unit]\nRequires=sakura-project-egress.service\nAfter=sakura-project-egress.service\n[Service]\nNoNewPrivileges=yes\n'
    assert len(links) == 1
    f.ns['os'] = types.SimpleNamespace(path=types.SimpleNamespace(lexists=lambda _path: False))
    files, links, appends = f.ns['egress_boot_plan']('b' * 64, 'openrc')
    assert b'need localmount' in files['/etc/init.d/sakura-project-egress']['data']
    assert len(links) == 1 and not appends
    refused(f, lambda: f.ns['egress_boot_plan']('a' * 64, 'unknown'), 'EGRESS_INIT_UNSUPPORTED')


def rebind_commit_order():
    f = fixture()
    provision(f)
    f.value.update(directoryDevice='1', directoryInode='100')
    f.current.update(f.value)
    f.ns.update(network_ready=lambda *_: None, runs_for=lambda *_: [],
               project_directory=lambda _: types.SimpleNamespace(st_dev=1, st_ino=100),
               probe=lambda *_: None, migration_retire_applied=lambda *_: None,
               durable_unlink=lambda *_: None)
    def binding(candidate):
        assert f.tables and next(iter(f.records.values()))['phase'] == 'pending'
        f.events.append(('binding', candidate['networkIsolation']))
        f.current.update(candidate)
    f.ns['binding_write'] = binding
    candidate = f.ns['rebind'](f.value, {'expected': {}, 'directory': '/workspace', 'networkIsolation': 'host'}, f.context['bootId'])
    assert candidate['revision'] == 2 and not f.tables
    assert next(i for i, event in enumerate(f.events) if event[0] == 'binding') < next(i for i, event in enumerate(f.events) if event[0] == 'delete')


def boot_install_and_interrupted_upgrade(openrc=False, directory_sync_failures=False):
    f = fixture()
    files, links, modes, owner_records, events = {}, {}, {}, {}, []
    flags = {'atomic_loss': False, 'reload_loss': False, 'directory_loss': False}
    descriptors, sequence = {}, dict(next=10)
    # Linux flag values are independent of the host OS running this model.
    # The owned Alpine observation confirmed O_PATH fsync errno=EBADF and a
    # readable FD to the same inode succeeding; do not mock both as equivalent.
    linux_path, linux_directory, linux_nofollow, linux_cloexec = 0x200000, 0x10000, 0x20000, 0x80000
    init_services = {'/etc/init.d/sshd', '/etc/init.d/crond', '/etc/init.d/local'} if openrc else set()
    if openrc:
        files['/etc/conf.d/sshd'] = b'OPERATOR_OPTION=yes\n'
        modes['/etc/conf.d/sshd'] = 0o644
    f.ns['egress_parent'] = lambda _path: None
    f.ns['egress_openrc_nnp'] = lambda *_args: None
    f.ns['egress_boot_read'] = lambda path: files.get(path)
    f.ns['json_read'] = lambda path, *_args: copy.deepcopy(owner_records.get(path))
    def record(path, value):
        owner_records[path] = copy.deepcopy(value)
        events.append(('record', value['phase']))
    f.ns['json_write'] = record
    def atomic(path, data):
        assert next(iter(owner_records.values()))['phase'] == 'pending'
        if flags['atomic_loss']:
            flags['atomic_loss'] = False
            raise OSError('owned interruption before file replacement')
        files[path] = data
    f.ns['atomic'] = atomic
    def info(path):
        return types.SimpleNamespace(st_mode=stat.S_IFLNK | 0o777 if path in links else stat.S_IFREG | modes.get(path, 0o755), st_uid=0, st_nlink=1)
    def descriptor_open(path, permissions, **kwargs):
        if 'dir_fd' in kwargs:
            assert path == '.'
            parent = descriptors[kwargs['dir_fd']]
            assert parent['directory']
            path = parent['path']
        sequence['next'] += 1
        descriptor = sequence['next']
        descriptors[descriptor] = dict(path=path, flags=permissions, directory=bool(permissions & linux_directory))
        return descriptor
    def descriptor_info(descriptor):
        entry = descriptors[descriptor]
        return types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o755 if entry['directory'] else stat.S_IFREG | modes[entry['path']],
                                     st_uid=0, st_nlink=1)
    def descriptor_sync(descriptor):
        entry = descriptors[descriptor]
        if entry['flags'] & linux_path:
            raise OSError(errno.EBADF, 'O_PATH cannot fsync')
        if entry['directory']:
            events.append(('parent-sync', entry['path']))
            if flags['directory_loss']:
                flags['directory_loss'] = False
                raise OSError(errno.EIO, 'owned parent sync failure after symlink publication')
    def create_link(destination, path):
        events.append(('symlink', path))
        links[path] = destination
    f.ns['os'] = types.SimpleNamespace(path=types.SimpleNamespace(
        isdir=lambda path: not openrc and path == '/run/systemd/system',
        isfile=lambda path: openrc and path == '/sbin/openrc-run',
        dirname=os.path.dirname,
        basename=os.path.basename,
        lexists=lambda path: path in files or path in links or path in init_services),
        lstat=info, readlink=lambda path: links[path],
        chmod=lambda path, mode, **_kwargs: modes.update({path: mode}),
        symlink=create_link,
        O_RDONLY=0, O_DIRECTORY=linux_directory, O_PATH=linux_path, O_NOFOLLOW=linux_nofollow, O_CLOEXEC=linux_cloexec,
        open=descriptor_open, fstat=descriptor_info, fsync=descriptor_sync, close=lambda descriptor: descriptors.pop(descriptor))
    f.ns['directory_fd'] = lambda path: descriptor_open(path, linux_path | linux_directory | linux_nofollow | linux_cloexec)
    f.ns['tool'] = lambda name: '/usr/bin/' + name
    def reload(argv, **_kwargs):
        assert argv == (['/usr/bin/rc-update', '-u'] if openrc else ['/usr/bin/systemctl', 'daemon-reload'])
        owner = next(iter(owner_records.values()))
        assert owner['phase'] == 'pending'
        assert all(hashlib.sha256(files[path]).hexdigest() == item['sha256'] and modes[path] == item['mode']
                   for path, item in owner['files'].items()), 'publish and sync every managed policy before daemon reload'
        assert all(links.get(path) == destination for path, destination in owner['links'].items())
        assert events[-1] == ('parent-sync', os.path.dirname(next(iter(owner['links'])))), 'sync the link parent before reload/applied'
        events.append(('reload',))
        if flags['reload_loss']:
            flags['reload_loss'] = False
            raise OSError('owned reload ACK lost')
    f.ns['execute'] = reload
    if directory_sync_failures:
        pin = f.ns['directory_fd']('/controlled')
        try:
            descriptor_sync(pin)
        except OSError as error:
            assert error.errno == errno.EBADF
        else:
            raise AssertionError('O_PATH must have the observed Linux fsync refusal')
        finally:
            f.ns['os'].close(pin)
        for attempt in range(2):
            flags['directory_loss'] = True
            try:
                f.ns['egress_bootstrap']('a' * 64)
            except OSError as error:
                assert error.errno == errno.EIO
            else:
                raise AssertionError('failed parent sync must prevent reload and applied on both new and existing links')
            assert next(iter(owner_records.values()))['phase'] == 'pending' and links and not descriptors
            assert not any(event[0] == 'reload' or event == ('record', 'applied') for event in events)
            assert len([event for event in events if event[0] == 'symlink']) == 1, 'recover the existing exact symlink without replacing it'
            assert len([event for event in events if event[0] == 'parent-sync']) == attempt + 1
    assert f.ns['egress_bootstrap']('a' * 64) == ('openrc' if openrc else 'systemd')
    assert not descriptors
    before = len(events)
    f.ns['egress_bootstrap']('a' * 64)
    assert len(events) == before, 'healthy current boot files must not reload services'
    # Upgrade an owned V1 restore-only installation without losing the operator
    # prefix. An interruption retains exact previous hashes for safe recovery.
    prior = next(iter(owner_records.values()))
    del prior['guards']
    for filename in prior['files']:
        if openrc and filename.startswith('/etc/conf.d/'):
            files[filename] = files[filename].replace(b'# SAKURA_PROJECT_EGRESS_V2', b'# SAKURA_PROJECT_EGRESS_V1').replace(b'no_new_privs=yes\n', b'')
        elif not openrc and filename.endswith('/sakura-project-egress.conf'):
            files[filename] = files[filename].replace(b'[Service]\nNoNewPrivileges=yes\n', b'')
        prior['files'][filename]['sha256'] = hashlib.sha256(files[filename]).hexdigest()
    flags['atomic_loss'] = True
    try: f.ns['egress_bootstrap']('a' * 64)
    except OSError: pass
    else: raise AssertionError('V1 guard upgrade interruption must remain pending')
    assert next(iter(owner_records.values()))['phase'] == 'pending'
    f.ns['egress_bootstrap']('a' * 64)
    assert next(iter(owner_records.values()))['guards'] == 2
    flags['atomic_loss'] = True
    try: f.ns['egress_bootstrap']('b' * 64)
    except OSError: pass
    else: raise AssertionError('upgrade interruption must remain pending')
    assert next(iter(owner_records.values()))['phase'] == 'pending'
    f.ns['egress_bootstrap']('b' * 64)
    assert next(iter(owner_records.values()))['phase'] == 'applied'
    assert ('/usr/local/lib/sakura-project-identity/' + 'b' * 64 + '/controller.py').encode() in files[f.ns['EGRESS_BOOT'] + '/restore']
    flags['reload_loss'] = True
    try: f.ns['egress_bootstrap']('c' * 64)
    except OSError: pass
    else: raise AssertionError('reload loss must remain pending')
    f.ns['egress_bootstrap']('c' * 64)
    if openrc:
        conf = '/etc/conf.d/sshd'
        assert files[conf].startswith(b'OPERATOR_OPTION=yes\n')
        assert files[conf].endswith(b'rc_need="${rc_need-} sakura-project-egress"\nno_new_privs=yes\n')
        files[conf] = files[conf].replace(b'OPERATOR_OPTION=yes', b'OPERATOR_OPTION=changed')
        f.ns['egress_bootstrap']('c' * 64)
        assert files[conf].startswith(b'OPERATOR_OPTION=changed\n'), 'keep operator settings before the managed tail'
    saved_files = copy.deepcopy(files)
    filename = f.ns['EGRESS_BOOT'] + '/restore'
    files[filename] = b'foreign source\n'
    refused(f, lambda: f.ns['egress_bootstrap']('d' * 64), 'EGRESS_BOOT_CHANGED')
    assert files[filename] == b'foreign source\n'
    files.update(saved_files)
    link = next(iter(links))
    del links[link]
    refused(f, lambda: f.ns['egress_bootstrap']('c' * 64), 'EGRESS_BOOT_CHANGED')


def openrc_dependencies_and_operator_settings():
    boot_install_and_interrupted_upgrade(True)


def boot_symlink_sync_and_pending_recovery():
    boot_install_and_interrupted_upgrade(False, True)
    boot_install_and_interrupted_upgrade(True, True)


def bounded_kernel_json():
    f = fixture()
    for value in [[], {'nftables': {}}, {'nftables': [None]}, {'nftables': [{'table': {}, 'rule': {}}]},
                  {'nftables': [], 'other': []}, {'nftables': [{}] * 8194}]:
        refused(f, lambda value=value: f.ns['egress_json'](json.dumps(value).encode()), 'EGRESS_STATE_INVALID')
    assert f.ns['egress_json'](b'{"nftables":[{"metainfo":{"json_schema_version":1}}]}') == []


checks = [private_and_host_rules, create_ack_and_record_loss, foreign_or_tampered_table, modes_and_exact_delete,
          owner_and_namespace_refusals, reboot_restores_intents, boot_service_plans, rebind_commit_order,
          boot_install_and_interrupted_upgrade, openrc_dependencies_and_operator_settings,
          boot_symlink_sync_and_pending_recovery, bounded_kernel_json]
for check in checks: check()
print(json.dumps({'passed': True, 'kind': 'portable-model-only', 'sourceSha256': hashlib.sha256(source).hexdigest(),
                  'checks': [check.__name__ for check in checks]}, separators=(',', ':')))
