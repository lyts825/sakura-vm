"""Portable admission and OpenRC qualification models; no live Linux proof."""
import ast
import base64
import copy
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


def namespace():
    ns = dict(base64=base64, hashlib=hashlib, json=json, os=os, re=re, stat=stat, struct=struct, uuid=uuid)
    exec(compile(definitions, 'production-egress-nnp-definitions', 'exec'), ns)
    return ns


def refused(ns, call, code):
    try:
        call()
    except ns['Refusal'] as error:
        assert error.code == code, (error.code, code)
        return error.detail
    raise AssertionError('expected ' + code)


def image(inode=1):
    return types.SimpleNamespace(st_dev=1, st_ino=inode, st_uid=0, st_mode=stat.S_IFREG | 0o755, st_nlink=1)


def process(pid, parent_pid, executable='/usr/sbin/sshd', nnp=1, uid=0, arguments=None, group='/openrc.sshd', inode=1):
    return dict(pid=pid, parentPid=parent_pid, startTicks=str(pid * 100), executable=executable,
                image=image(inode), uids=[uid] * 4, nnp=nnp, caps=[0, 0, 0],
                arguments=arguments or [executable.encode()], cgroupName=group)


def live_fixture():
    ns = namespace()
    installed = {'/usr/sbin/sshd': image(), '/usr/sbin/crond': image(2), '/usr/lib/ssh/sshd-auth': image(3),
                 '/usr/lib/ssh/sshd-session': image(6)}
    processes = {
        100: process(100, 1),
        200: process(200, 100, nnp=0, arguments=[b'sshd: root@notty']),
        300: process(300, 200, executable='/usr/bin/python3', nnp=0, inode=4),
        500: process(500, 1, executable='/usr/sbin/crond', group='/openrc.crond', inode=2),
    }
    pid_files, flags = {}, dict(new_pid=False)
    ns['os'] = types.SimpleNamespace(
        path=types.SimpleNamespace(isfile=lambda path: path in installed, realpath=lambda path: path,
                                  dirname=os.path.dirname, basename=os.path.basename),
        O_RDONLY=0, O_NOFOLLOW=0, O_CLOEXEC=0,
        open=lambda name, _flags, **_kwargs: name,
        fstat=lambda descriptor: next(info for path, info in installed.items() if os.path.basename(path) == descriptor),
        close=lambda *_: None, getpid=lambda: 300,
        listdir=lambda _fd: [str(pid) for pid in processes] + (['999'] if flags['new_pid'] else []))
    ns['directory_fd'] = lambda _path: 10
    ns['egress_nnp_directory'] = lambda _path: 10
    ns['egress_nnp_process'] = lambda _parent, pid: copy.deepcopy(processes.get(pid))
    ns['egress_boot_read'] = lambda path: pid_files.get(path)
    return ns, processes, pid_files, flags


def live_services_and_root_management():
    ns, processes, pid_files, _flags = live_fixture()
    ns['egress_nnp_live']({'uid': 20000}, 'openrc')
    processes[100]['nnp'] = 0
    detail = refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_RESTART_REQUIRED')
    assert detail['pid'] == 100 and detail['parentPid'] == 1 and detail['service'] == 'sshd'
    assert detail['startTicks'] == '10000' and detail['executable'] == '/usr/sbin/sshd'
    processes[100]['nnp'] = 1
    processes[500]['nnp'] = 0
    refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_RESTART_REQUIRED')
    processes[500]['nnp'] = 1
    processes[100]['cgroupName'] = '/'
    refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_SERVICE_UNVERIFIED')
    pid_files['/run/sshd.pid'] = b'100\n'
    ns['egress_nnp_live']({'uid': 20000}, 'openrc')
    for item in processes.values():
        item['cgroupName'] = '/system.slice/' + ('crond.service' if item['pid'] == 500 else 'ssh.service')
    ns['egress_nnp_live']({'uid': 20000}, 'systemd')
    processes[100]['cgroupName'] = '/system.slice/sshd@socket-connection.service/session'
    ns['egress_nnp_live']({'uid': 20000}, 'systemd')
    processes[100]['cgroupName'] = '/system.slice/system-sshd.slice/sshd@socket-connection.service/session'
    ns['egress_nnp_live']({'uid': 20000}, 'systemd')
    processes[100]['cgroupName'] = '/system.slice/unrelated.slice/sshd@socket-connection.service/session'
    refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'systemd'), 'EGRESS_NNP_SERVICE_UNVERIFIED')


def surviving_pre_auth_and_nonroot_sessions():
    for variant in ('root-title', 'orphan', 'nonroot', 'split-auth', 'retired-image'):
        ns, processes, _pid_files, _flags = live_fixture()
        child = process(400, 100, nnp=0, arguments=[b'sshd: root [priv]'])
        if variant == 'orphan':
            child.update(parentPid=1, cgroupName='/')
        elif variant == 'nonroot':
            child['uids'] = [1000] * 4
        elif variant == 'split-auth':
            child.update(executable='/usr/lib/ssh/sshd-auth', image=image(3), arguments=[b'sshd-auth'])
        elif variant == 'retired-image':
            child.update(executable='/usr/sbin/sshd (deleted)', image=image(99))
        processes[400] = child
        before = copy.deepcopy({pid: (item['uids'], item['nnp']) for pid, item in processes.items()})
        detail = refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_RESTART_REQUIRED')
        assert detail['pid'] == 400
        assert before == {pid: (item['uids'], item['nnp']) for pid, item in processes.items()}, 'admission must not kill or mutate old sessions'
    ns, processes, _pid_files, _flags = live_fixture()
    processes[400] = process(400, 1, arguments=[b'sshd: root [priv]'], executable='/bin/sh', inode=5, nnp=0, uid=1000)
    ns['egress_nnp_live']({'uid': 20000}, 'openrc')
    processes[200]['parentPid'] = 400
    # A non-Root ancestor stops the verified management chain. Changing a
    # process title does not turn an unrelated pre-auth process into that chain.
    processes[300]['parentPid'] = 400
    refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_RESTART_REQUIRED')


def openrc_ssh_descendants_and_listener_identity():
    ns, processes, pid_files, _flags = live_fixture()
    # Replay the observed 4407 -> 3326 kernel identity against a controlled
    # listener anchor. The further fixture tests a multi-stage SSH chain.
    processes[3326] = process(3326, 1, group='/')
    processes[3326]['startTicks'] = '37500'
    pid_files['/run/sshd.pid'] = b'3326\n'
    processes[4407] = process(4407, 3326, executable='/usr/lib/ssh/sshd-session', inode=6, group='/')
    processes[4407]['startTicks'] = '37665'
    ns['egress_nnp_live']({'uid': 20000}, 'openrc')
    def fixture():
        ns, processes, pid_files, _flags = live_fixture()
        processes[100]['cgroupName'] = '/'
        pid_files['/run/sshd.pid'] = b'100\n'
        processes[3326] = process(3326, 100, executable='/usr/lib/ssh/sshd-session', inode=6, group='/',
                                  arguments=[b'sshd-session: root [priv]'])
        processes[3326]['startTicks'] = '37500'
        processes[4407] = process(4407, 3326, executable='/usr/lib/ssh/sshd-session', inode=6, group='/',
                                  arguments=[b'sshd-session: root@notty'])
        processes[4407]['startTicks'] = '37665'
        return ns, processes, pid_files
    ns, processes, pid_files = fixture()
    # The live Alpine failure was a different Root connection, outside the
    # current controller's ancestor chain, with a split sshd-session image.
    processes[4450] = process(4450, 3326, executable='/usr/lib/ssh/sshd-session', inode=6, uid=1000, group='/')
    processes[4460] = process(4460, 4407, executable='/usr/lib/ssh/sshd-auth', inode=3, uid=22, group='/')
    processes[4470] = process(4470, 100, uid=1001, group='/', arguments=[b'sshd: beta@notty'])
    processes[4480] = process(4480, 100, executable='/usr/lib/ssh/sshd-session (deleted)', inode=99, group='/')
    before = copy.deepcopy(processes)
    ns['egress_nnp_live']({'uid': 20000}, 'openrc')
    assert processes == before, 'admission cannot mutate, restart or terminate an established session'
    for pid in (100, 3326, 4407, 4450, 4460):
        processes[pid]['nnp'] = 0
        detail = refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_RESTART_REQUIRED')
        assert detail['pid'] == pid, (pid, detail)
        processes[pid]['nnp'] = 1

    for variant in ('orphan', 'fake-title', 'unknown-parent', 'nonroot-listener', 'helper-pidfile', 'missing-pidfile', 'malformed-pidfile'):
        ns, processes, pid_files = fixture()
        if variant in ('orphan', 'fake-title'):
            processes[4407]['parentPid'] = 1
            if variant == 'fake-title':
                processes[4407]['arguments'] = [b'sshd: root [listener]']
        elif variant == 'unknown-parent':
            processes[3390] = process(3390, 3326, executable='/bin/sh', inode=7, group='/')
            processes[3390]['startTicks'] = '37600'
            processes[4407]['parentPid'] = 3390
        elif variant == 'nonroot-listener':
            processes[100]['uids'] = [1000] * 4
        elif variant == 'helper-pidfile':
            pid_files['/run/sshd.pid'] = b'4407\n'
            processes[4407]['arguments'] = [b'sshd: root [listener]']
        elif variant == 'missing-pidfile':
            pid_files.clear()
        elif variant == 'malformed-pidfile':
            pid_files['/run/sshd.pid'] = b'100 3326\n'
        refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_SERVICE_UNVERIFIED')

    for variant in ('reparented', 'late-reparented', 'reused-pid', 'changed-image', 'changed-executable', 'changed-uid',
                    'changed-cgroup', 'changed-caps', 'exited-child', 'changed-listener'):
        ns, processes, _pid_files = fixture()
        reads = {}
        original = ns['egress_nnp_process']
        def changed(parent, pid):
            current = original(parent, pid)
            reads[pid] = reads.get(pid, 0) + 1
            watched = 100 if variant == 'changed-listener' else 4407
            threshold = 2 if variant == 'late-reparented' else 1
            if pid == watched and reads[pid] > threshold:
                if variant in ('reparented', 'late-reparented'):
                    current['parentPid'] = 1
                elif variant in ('reused-pid', 'changed-listener'):
                    current['startTicks'] = str(int(current['startTicks']) + 1)
                elif variant == 'changed-image':
                    current['image'] = image(99)
                elif variant == 'changed-executable':
                    current['executable'] = '/usr/bin/python3'
                elif variant == 'changed-uid':
                    current['uids'] = [1000] * 4
                elif variant == 'changed-cgroup':
                    current['cgroupName'] = '/unrelated'
                elif variant == 'changed-caps':
                    current['caps'] = [0, 1, 0]
                elif variant == 'exited-child':
                    return None
            return current
        ns['egress_nnp_process'] = changed
        detail = refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_PROCESS_CHANGED')
        assert detail['pid'] == (100 if variant == 'changed-listener' else 4407)
    ns, processes, pid_files = fixture()
    reads = dict(count=0)
    def changed_pidfile(path):
        if path == '/run/sshd.pid':
            reads['count'] += 1
            return b'100\n' if reads['count'] == 1 else b'9999\n'
        return None
    ns['egress_boot_read'] = changed_pidfile
    refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_PROCESS_CHANGED')
    ns, processes, _pid_files = fixture()
    processes[3326]['startTicks'] = '40000'
    refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_PROCESS_CHANGED')
    ns, processes, _pid_files = fixture()
    processes[3326]['parentPid'] = 4407
    processes[3326]['startTicks'] = processes[4407]['startTicks']
    refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_PROCESS_CHANGED')


def existing_account_flags_and_capabilities():
    ns, processes, _pid_files, _flags = live_fixture()
    processes[600] = process(600, 1, executable='/bin/sh', inode=5, uid=20000, group='/sakura/project')
    ns['egress_nnp_live']({'uid': 20000}, 'openrc')
    processes[600]['nnp'] = 0
    detail = refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_RESTART_REQUIRED')
    assert detail['service'] == 'project-existing-process'
    processes[600]['nnp'] = 1
    for capabilities in ([1, 0, 0], [0, 1, 0], [0, 0, 1]):
        processes[600]['caps'] = capabilities
        refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_ACCOUNT_PRIVILEGED')
    processes[600]['caps'] = [0, 0, 0]
    processes[600]['uids'] = [20000, 0, 0, 0]
    refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'openrc'), 'EGRESS_NNP_ACCOUNT_PRIVILEGED')


def pinned_process_identity():
    ns = namespace()
    flags = dict(stat_reads=0, parent_changed=False, image_changed=False)
    files = {
        'status': b'Uid:\t0\t0\t0\t0\nNoNewPrivs:\t1\nCapEff:\t0\nCapPrm:\t0\nCapAmb:\t0\n',
        'cmdline': b'/usr/sbin/sshd\0-D\0',
        'cgroup': b'0::/openrc.sshd\n',
    }
    def read(descriptor, _limit):
        if descriptor != 'stat':
            return files[descriptor]
        flags['stat_reads'] += 1
        fields = [b'S', b'1'] + [b'0'] * 17 + [b'7000']
        if flags['parent_changed'] and flags['stat_reads'] > 1:
            fields[1] = b'2'
        return b'70 (sshd arbitrary) ' + b' '.join(fields)
    ns['os'] = types.SimpleNamespace(O_RDONLY=0, O_DIRECTORY=0, O_NOFOLLOW=0, O_CLOEXEC=0,
                                    open=lambda name, *_args, **_kwargs: name, close=lambda *_: None,
                                    read=read, readlink=lambda *_args, **_kwargs: '/usr/sbin/sshd',
                                    stat=lambda *_args, **_kwargs: image(2 if flags['image_changed'] and flags['stat_reads'] > 1 else 1))
    item = ns['egress_nnp_process'](10, 70)
    assert item['parentPid'] == 1 and item['startTicks'] == '7000' and item['nnp'] == 1
    flags.update(stat_reads=0, parent_changed=True)
    refused(ns, lambda: ns['egress_nnp_process'](10, 70), 'EGRESS_NNP_PROCESS_CHANGED')


def openrc_current_launchers():
    ns = namespace()
    library = '/lib/rc/sh'
    shell = b'default_start() { ssd_start; }\nstart-stop-daemon.sh\nsupervise-daemon.sh\n'
    files = {library + '/openrc-run.sh': shell,
             library + '/start-stop-daemon.sh': b'${no_new_privs:+--no-new-privs}',
             library + '/supervise-daemon.sh': b'${no_new_privs:+--no-new-privs}'}
    conf_entries, invocations, flags = [], [], dict(help=True, failed=False)
    ns['egress_boot_read'] = lambda path: files.get(path)
    ns['directory_fd'] = lambda _path: 10
    ns['tool'] = lambda name: '/sbin/' + name
    ns['os'] = types.SimpleNamespace(path=types.SimpleNamespace(isfile=lambda path: path in files,
                                    realpath=lambda path: path, dirname=os.path.dirname, basename=os.path.basename),
                                    listdir=lambda _path: conf_entries,
                                    O_RDONLY=0, O_NOFOLLOW=0, O_CLOEXEC=0,
                                    open=lambda *_args, **_kwargs: 20, fstat=lambda _: image(), close=lambda *_: None)
    def help_result(argv, **kwargs):
        name = argv[0]
        environment = dict(ns['CLEAN_ENV'])
        if name == 'supervise-daemon':
            assert argv == ['supervise-daemon', 'sshd', '--help']
            environment['RC_SVCNAME'] = 'sshd'
        else:
            assert argv == ['start-stop-daemon', '--help']
        assert kwargs == dict(pass_fds=(20,), executable='/proc/self/fd/20', controlled_env=environment)
        invocations.append((argv, environment))
        if flags['failed']:
            ns['refuse']('SYSTEM_TOOL_FAILED')
        return b'--no-new-privs' if flags['help'] else b'older version'
    ns['execute'] = help_result
    standard = b'#!/sbin/openrc-run\ncommand=/usr/sbin/sshd\nstart_pre() { checkconfig; }\n'
    ns['egress_openrc_nnp']('sshd', standard, b'OPERATOR_OPTION=yes\n')
    assert len(invocations) == 2
    ns['egress_openrc_nnp']('sshd', standard + b'start() { default_start; }\n', b'')
    for extra in (b'start() { /usr/sbin/sshd; }\n', b'default_start() { true; }\n',
                  b'supervisor=s6\n', b'start_pre() { no_new_privs=; }\n'):
        refused(ns, lambda extra=extra: ns['egress_openrc_nnp']('sshd', standard + extra, b''), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
    conf_entries.append('sshd.default')
    refused(ns, lambda: ns['egress_openrc_nnp']('sshd', standard, b''), 'EGRESS_NNP_SERVICE_UNSUPPORTED')
    conf_entries.clear()
    flags['help'] = False
    refused(ns, lambda: ns['egress_openrc_nnp']('sshd', standard, b''), 'EGRESS_NNP_UNSUPPORTED')
    flags['help'] = True
    flags['failed'] = True
    detail = refused(ns, lambda: ns['egress_openrc_nnp']('sshd', standard, b''), 'EGRESS_NNP_UNSUPPORTED')
    assert detail['reason'] == 'launcher-help-unavailable' and detail['tool'] == 'start-stop-daemon'
    flags['failed'] = False
    files[library + '/start-stop-daemon.sh'] = b'old launcher'
    refused(ns, lambda: ns['egress_openrc_nnp']('sshd', standard, b''), 'EGRESS_NNP_UNSUPPORTED')


def configuration_is_separate_from_live_admission():
    ns = namespace()
    data = b'[Service]\nNoNewPrivileges=yes\n'
    filename = '/etc/systemd/system/sshd.service.d/sakura-project-egress.conf'
    record = dict(version=1, guards=2, phase='applied', manager='systemd', build='a' * 64,
                  files={filename: dict(sha256=hashlib.sha256(data).hexdigest(), mode=0o644, previousSha256=None)}, links={})
    ns['json_read'] = lambda *_args: record
    ns['os'] = types.SimpleNamespace(path=types.SimpleNamespace(isdir=lambda _: True), lstat=lambda _: image())
    ns['os'].lstat = lambda _: types.SimpleNamespace(st_mode=stat.S_IFREG | 0o644)
    ns['egress_boot_plan'] = lambda *_args: ({filename: dict(data=data, mode=0o644)}, {}, {})
    ns['egress_boot_read'] = lambda _: data
    queries = []
    ns['egress_systemd_nnp'] = lambda units: queries.append(units)
    assert ns['egress_nnp_configuration']() == 'systemd'
    ns['egress_nnp_live'] = lambda value, manager: ns['refuse']('EGRESS_NNP_RESTART_REQUIRED', dict(pid=100, manager=manager))
    refused(ns, lambda: ns['egress_nnp_check']({'uid': 20000}), 'EGRESS_NNP_RESTART_REQUIRED')
    assert queries == [ns['EGRESS_SYSTEMD_UNITS'], ns['EGRESS_SYSTEMD_UNITS'], ('user@20000.service',)]
    record['guards'] = 1
    refused(ns, lambda: ns['egress_nnp_configuration'](), 'EGRESS_NNP_PENDING')


def readable_pinned_directories():
    ns = namespace()
    events = []
    ns['directory_fd'] = lambda path: (events.append(('pin', path)) or 10)
    ns['os'] = types.SimpleNamespace(O_RDONLY=1, O_DIRECTORY=2, O_NOFOLLOW=4, O_CLOEXEC=8,
                                    open=lambda name, flags, **kwargs: (events.append(('open', name, flags, kwargs)) or 20),
                                    fstat=lambda _: types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0),
                                    close=lambda descriptor: events.append(('close', descriptor)))
    assert ns['egress_nnp_directory']('/proc') == 20
    assert events == [('pin', '/proc'), ('open', '.', 15, dict(dir_fd=10)), ('close', 10)]
    events.clear()
    ns['os'].fstat = lambda _: types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o777, st_uid=0)
    refused(ns, lambda: ns['egress_nnp_directory']('/proc'), 'UNTRUSTED_RECORD')
    assert events[-2:] == [('close', 20), ('close', 10)]


checks = [live_services_and_root_management, surviving_pre_auth_and_nonroot_sessions,
          openrc_ssh_descendants_and_listener_identity, existing_account_flags_and_capabilities, pinned_process_identity,
          openrc_current_launchers, configuration_is_separate_from_live_admission, readable_pinned_directories]
for check in checks:
    check()
print(json.dumps(dict(passed=True, kind='portable-model-only', sourceSha256=hashlib.sha256(source).hexdigest(),
                      checks=[check.__name__ for check in checks]), separators=(',', ':')))
