"""Effective systemd policy models; no claim of a live systemd guest proof."""
import ast
import base64
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import stat
import struct
import sys
import types
import uuid

source = Path(sys.argv[1]).read_bytes()


def fixture():
    ns = dict(base64=base64, hashlib=hashlib, json=json, os=os, re=re, stat=stat, struct=struct, uuid=uuid)
    tree = ast.parse(source)
    definitions = ast.Module(body=[node for node in tree.body if isinstance(node, (ast.Assign, ast.FunctionDef, ast.ClassDef))],
                             type_ignores=[])
    exec(compile(definitions, 'production-systemd-nnp-definitions', 'exec'), ns)
    responses, queries, files, directories = {'<manager>': b'UnitPath=/etc/systemd/system /usr/lib/systemd/system\n'}, [], {}, {}
    ns['tool'] = lambda name: '/usr/bin/' + name
    ns['directory_fd'] = lambda _path: 10
    ns['egress_nnp_directory'] = lambda path: path
    ns['egress_boot_read'] = lambda path: files.get(path)
    ns['pwd'] = types.SimpleNamespace(getpwuid=lambda uid: types.SimpleNamespace(pw_name='project-' + str(uid)))
    ns['os'] = types.SimpleNamespace(path=types.SimpleNamespace(realpath=lambda value: value,
                                    dirname=posixpath.dirname, basename=posixpath.basename, normpath=posixpath.normpath,
                                    lexists=lambda path: path in files or path in directories),
                                    O_RDONLY=0, O_NOFOLLOW=0, O_CLOEXEC=0,
                                    listdir=lambda path: directories.get(path, []),
                                    open=lambda *_args, **_kwargs: 20, close=lambda *_: None,
                                    fstat=lambda _: types.SimpleNamespace(st_mode=stat.S_IFREG | 0o755, st_uid=0, st_nlink=1))
    def execute(argv, **kwargs):
        assert argv[:5] == ['systemctl', 'show', '--system', '--no-pager', '--all']
        assert kwargs == dict(executable='/proc/self/fd/20', pass_fds=(20,), timeout=15)
        unit = argv[-1] if len(argv) == 7 else '<manager>'
        assert argv[5].startswith('--property=')
        queries.append(unit)
        return responses[unit]
    ns['execute'] = execute
    return ns, responses, queries, files, directories


def command(flags=''):
    return '{ path=/usr/sbin/sshd ; argv[]=/usr/sbin/sshd -D ; flags=' + flags + \
           ' ; start_time=[] ; stop_time=[] ; pid=0 ; code=(null) ; status=0/0 }'


def reply(unit, **changes):
    account = re.fullmatch(r'user@([1-9][0-9]*)\.service', unit)
    values = dict(Id=unit, LoadState='loaded', ActiveState='inactive', NeedDaemonReload='no', NoNewPrivileges='yes',
                  User=account.group(1) if account else '', AmbientCapabilities='', SecureBits='0',
                  ExecStart=command().replace('flags=', 'ignore_errors=no'), ExecStartEx=command())
    for key, value in changes.items():
        if key.endswith('Ex') and key[:-2] not in changes:
            values[key[:-2]] = value
    values.update(changes)
    lines = []
    for key, entries in values.items():
        for value in entries if isinstance(entries, list) else [entries]:
            if value is not None:
                lines.append(key + '=' + value)
    return ('\n'.join(lines) + '\n').encode()


def install_gate(ns, files, directories, name):
    folder = '/etc/systemd/system/' + name + '.d'
    files[folder + '/sakura-project-egress.conf'] = ns['EGRESS_SYSTEMD_GATE']
    directories[folder] = ['sakura-project-egress.conf']


def refused(ns, call, code):
    try:
        call()
    except ns['Refusal'] as error:
        assert error.code == code, (error.code, code)
        return error.detail
    raise AssertionError('expected ' + code)


def effective_values_and_template_instance():
    ns, responses, queries, _files, _directories = fixture()
    for unit in ('sshd.service', 'user@20001.service'):
        responses[unit] = reply(unit)
    ns['egress_systemd_nnp'](('sshd.service', 'user@20001.service'))
    assert queries == ['sshd.service', 'user@20001.service']
    responses['user@20001.service'] = reply('user@20001.service', NoNewPrivileges='no')
    detail = refused(ns, lambda: ns['egress_systemd_nnp'](('user@20001.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
    assert detail['service'] == 'user@20001.service' and detail['reason'] == 'effective-no-new-privileges'
    for changes in (dict(User='root'), dict(AmbientCapabilities='cap_setuid'), dict(SecureBits='1')):
        responses['user@20001.service'] = reply('user@20001.service', **changes)
        detail = refused(ns, lambda: ns['egress_systemd_nnp'](('user@20001.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
        assert detail['reason'] == 'user-manager-identity-or-capabilities'
    responses['user@20001.service'] = reply('user@20001.service', User='project-20001')
    ns['egress_systemd_nnp'](('user@20001.service',))
    responses['sshd.service'] = reply('sshd.service', NeedDaemonReload='yes')
    refused(ns, lambda: ns['egress_systemd_nnp'](('sshd.service',)), 'EGRESS_NNP_PENDING')
    responses['sshd.service'] = reply('sshd.service', Id='unrelated.service')
    refused(ns, lambda: ns['egress_systemd_nnp'](('sshd.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
    responses['sshd.service'] = reply('sshd.service', Id='ssh.service')
    ns['egress_systemd_nnp'](('sshd.service',))


def full_privilege_prefix_and_complete_flags():
    ns, responses, _queries, _files, _directories = fixture()
    commands = ('ExecStartEx', 'ExecStartPreEx', 'ExecStartPostEx', 'ExecConditionEx', 'ExecReloadEx', 'ExecStopEx', 'ExecStopPostEx')
    for key in commands:
        for flag in ('privileged', 'no-setuid', 'ambient', 'unknown-future-flag'):
            responses['sshd.service'] = reply('sshd.service', **{key: command(flag)})
            refused(ns, lambda: ns['egress_systemd_nnp'](('sshd.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
    responses['sshd.service'] = reply('sshd.service', ExecStartEx=command('ignore-failure no-env-expand'))
    ns['egress_systemd_nnp'](('sshd.service',))
    # Empty arrays are absent in actual systemctl output, including --all.
    responses['sshd.service'] = reply('sshd.service')
    assert b'ExecStartPre' not in responses['sshd.service']
    ns['egress_systemd_nnp'](('sshd.service',))
    disguised = command('privileged').replace('argv[]=/usr/sbin/sshd', 'argv[]=/usr/sbin/sshd ; flags=ignore-failure ; start_time=[]')
    responses['sshd.service'] = reply('sshd.service', ExecStartEx=disguised)
    refused(ns, lambda: ns['egress_systemd_nnp'](('sshd.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
    for key in commands:
        responses['sshd.service'] = reply('sshd.service', **{key[:-2]: command(), key: None})
        refused(ns, lambda: ns['egress_systemd_nnp'](('sshd.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
    responses['sshd.service'] = reply('sshd.service', ExecStartPre=[command(), command()], ExecStartPreEx=[command()])
    refused(ns, lambda: ns['egress_systemd_nnp'](('sshd.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
    responses['sshd.service'] = reply('sshd.service', ExecStartPreEx=[command(), command('privileged')])
    refused(ns, lambda: ns['egress_systemd_nnp'](('sshd.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')


def absent_units_are_separate_from_live_protection():
    ns, responses, queries, files, directories = fixture()
    install_gate(ns, files, directories, 'atd.service')
    directories['/usr/lib/systemd/system/service.d'] = ['10-timeout.conf']
    files['/usr/lib/systemd/system/service.d/10-timeout.conf'] = b'[Service]\nTimeoutStopSec=180\n'
    for state in ('not-found', 'masked'):
        responses['atd.service'] = reply('atd.service', LoadState=state, NoNewPrivileges='no', ExecStart=None, ExecStartEx=None)
        ns['egress_systemd_nnp'](('atd.service',))
    assert queries == ['atd.service', '<manager>', 'atd.service', '<manager>']
    responses['atd.service'] = reply('atd.service', LoadState='not-found', ActiveState='active', NoNewPrivileges='no')
    refused(ns, lambda: ns['egress_systemd_nnp'](('atd.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
    responses['atd.service'] = reply('atd.service', LoadState='not-found', NoNewPrivileges='no')
    extra = '/etc/systemd/system/atd.service.d/zz-operator.conf'
    directories['/etc/systemd/system/atd.service.d'].append('zz-operator.conf')
    for policy in (b'NoNewPrivileges=no', b'ExecStart=+/bin/sh', b'AmbientCapabilities=CAP_SETUID', b'User=root',
                   b'.include other.conf', b'NoNewPrivileges=y\\\nes'):
        files[extra] = b'[Service]\n' + policy + b'\n'
        detail = refused(ns, lambda: ns['egress_systemd_nnp'](('atd.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
        assert detail['reason'] == 'unqualified-extra-dropin' and detail['path'] == extra
    directories['/etc/systemd/system/atd.service.d'].remove('zz-operator.conf')
    responses['<manager>'] = b'UnitPath=/usr/lib/systemd/system\n'
    detail = refused(ns, lambda: ns['egress_systemd_nnp'](('atd.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
    assert detail['reason'] == 'managed-future-policy-unavailable'
    responses['<manager>'] = b'UnitPath="/etc/systemd/system with spaces"\n'
    detail = refused(ns, lambda: ns['egress_systemd_nnp'](('atd.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
    assert detail['reason'] == 'unit-search-path-unavailable'


def ssh_templates_and_installed_instances():
    ns, responses, queries, files, directories = fixture()
    for prefix in ('ssh', 'sshd'):
        responses[prefix + '@sakura-nnp-check.service'] = reply(prefix + '@sakura-nnp-check.service')
    directories['/etc/systemd/system'] = ['ssh@operator.service.d', 'ssh@.service.d', 'unrelated.service']
    responses['ssh@operator.service'] = reply('ssh@operator.service', NoNewPrivileges='no')
    detail = refused(ns, lambda: ns['egress_systemd_nnp'](('ssh@.service', 'sshd@.service')), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
    assert detail['service'] == 'ssh@operator.service'
    assert queries == ['<manager>', 'ssh@sakura-nnp-check.service', 'sshd@sakura-nnp-check.service', 'ssh@operator.service']
    responses['ssh@operator.service'] = reply('ssh@operator.service')
    ns['egress_systemd_nnp'](('ssh@.service', 'sshd@.service'))
    install_gate(ns, files, directories, 'ssh@.service')
    responses['ssh@operator.service'] = reply('ssh@operator.service', LoadState='masked', NoNewPrivileges='no')
    ns['egress_systemd_nnp'](('ssh@.service',))
    directories['/etc/systemd/system/ssh@operator.service.d'] = ['late.conf']
    files['/etc/systemd/system/ssh@operator.service.d/late.conf'] = b'[Service]\nNoNewPrivileges=no\n'
    refused(ns, lambda: ns['egress_systemd_nnp'](('ssh@.service',)), 'EGRESS_NNP_SERVICE_UNSUPPORTED')


def admission_and_restore_check_real_user_instances():
    ns, _responses, _queries, _files, _directories = fixture()
    events = []
    ns['egress_nnp_configuration'] = lambda: (events.append(('configuration',)) or 'systemd')
    ns['egress_systemd_nnp'] = lambda units: events.append(('effective', units))
    ns['egress_nnp_live'] = lambda value, manager: events.append(('live', value['uid'], manager))
    ns['egress_nnp_check']({'uid': 20001})
    assert events == [('configuration',), ('effective', ('user@20001.service',)), ('live', 20001, 'systemd')]
    events.clear()
    values = {'private-project': dict(uid=20002, networkIsolation='private'), 'host-project': dict(uid=20003, networkIsolation='host')}
    ns['binding_read'] = lambda project, *_: values[project]
    ns['reservation_check'] = lambda *_: None
    ns['egress_prepare'] = lambda value, **kwargs: events.append(('prepare', value['uid'], kwargs))
    ns['egress_commit'] = lambda value, **kwargs: events.append(('commit', value['uid'], kwargs))
    result = ns['egress_restore']({'reserved': {key: dict(projectId=key) for key in values}})
    assert result == dict(version=1, privateAccounts=1)
    assert ('effective', ('user@20002.service',)) in events and ('effective', ('user@20003.service',)) not in events
    assert not any(event[0] == 'live' for event in events), 'early restoration does not wait for daemons or restart sessions'


checks = [effective_values_and_template_instance, full_privilege_prefix_and_complete_flags,
          absent_units_are_separate_from_live_protection, ssh_templates_and_installed_instances,
          admission_and_restore_check_real_user_instances]
for check in checks:
    check()
print(json.dumps(dict(passed=True, kind='portable-model-only', sourceSha256=hashlib.sha256(source).hexdigest(),
                      checks=[check.__name__ for check in checks]), separators=(',', ':')))
