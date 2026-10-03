"""Portable admission and exact SSH service ancestry models; no live Linux proof."""
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
import time
import types
import uuid

source = Path(sys.argv[1]).read_bytes()
tree = ast.parse(source)
definitions = ast.Module(body=[node for node in tree.body if isinstance(node, (ast.Assign, ast.FunctionDef, ast.ClassDef))], type_ignores=[])


def namespace():
    ns = dict(base64=base64, hashlib=hashlib, json=json, os=os, re=re, stat=stat, struct=struct, time=time, uuid=uuid)
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
                 '/usr/lib/ssh/sshd-session': image(6), '/usr/bin/systemctl': image(9)}
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
    ns['egress_nnp_birth'] = lambda _parent, pid: dict(startTicks=processes[pid]['startTicks'], inactive=False) if pid in processes else None
    ns['egress_boot_read'] = lambda path: pid_files.get(path)
    return ns, processes, pid_files, flags


def systemd_fixture():
    ns, processes, _pid_files, flags = live_fixture()
    for item in processes.values():
        item['cgroupName'] = '/system.slice/' + ('crond.service' if item['pid'] == 500 else 'ssh.service')
    # The controller uses a different Root connection. Replay the real PAM
    # scope failure without adding the accepted connection to its ancestors.
    processes[1040] = process(1040, 1, group='/system.slice/ssh.service', arguments=[b'/usr/sbin/sshd', b'-D'])
    processes[1040]['startTicks'] = '78000'
    processes[1743] = process(1743, 1040, group='/user.slice/user-0.slice/session-84.scope', arguments=[b'sshd: root@notty'])
    processes[1743]['startTicks'] = '78472'
    responses = {
        'ssh.service': dict(Id='ssh.service', LoadState='loaded', ActiveState='active', SubState='running',
                            NeedDaemonReload='no', NoNewPrivileges='yes', MainPID='1040', ControlGroup='/system.slice/ssh.service'),
        'sshd.service': dict(Id='sshd.service', LoadState='not-found', ActiveState='inactive', SubState='dead',
                             NeedDaemonReload='no', NoNewPrivileges='no', MainPID='0', ControlGroup=''),
    }
    queries, closed = [], []
    previous_open, previous_stat = ns['os'].open, ns['os'].fstat
    ns['tool'] = lambda name: '/usr/bin/' + name
    ns['directory_fd'] = lambda path: 12 if path == '/usr/bin' else 10
    ns['egress_nnp_directory'] = lambda path: 11 if path == '/proc' else 10
    def open_fd(name, mode, **kwargs):
        if name == 'systemctl':
            assert kwargs == dict(dir_fd=12)
            return 20
        return previous_open(name, mode, **kwargs)
    ns['os'].open = open_fd
    ns['os'].fstat = lambda descriptor: image(9) if descriptor == 20 else previous_stat(descriptor)
    ns['os'].close = closed.append
    def execute(argv, **kwargs):
        assert argv[:5] == ['systemctl', 'show', '--system', '--no-pager', '--all']
        assert argv[5] == '--property=Id,LoadState,ActiveState,SubState,NeedDaemonReload,NoNewPrivileges,MainPID,ControlGroup'
        assert kwargs == dict(executable='/proc/self/fd/20', pass_fds=(20,), timeout=15)
        unit = argv[6]
        assert unit in ('ssh.service', 'sshd.service') and len(argv) == 7
        queries.append(unit)
        if flags.get('query_hook'):
            flags['query_hook'](unit, len(queries))
        return '\n'.join(key + '=' + value for key, value in responses[unit].items()).encode() + b'\n'
    ns['execute'] = execute
    return ns, processes, responses, queries, closed, flags


def systemd_pam_sessions_and_bounded_authority():
    ns, processes, _responses, queries, closed, _flags = systemd_fixture()
    scope = '/user.slice/user-1000.slice/session-c12.scope'
    processes[1800] = process(1800, 1040, group=scope, arguments=[b'sshd: alice [priv]'])
    processes[1801] = process(1801, 1800, executable='/usr/lib/ssh/sshd-session', inode=6, uid=1000, group=scope)
    processes[1802] = process(1802, 1801, executable='/usr/lib/ssh/sshd-auth', inode=3, uid=22, group=scope)
    for pid in range(2000, 2020):
        processes[pid] = process(pid, 1800, executable='/usr/lib/ssh/sshd-session', inode=6, uid=1000, group=scope)
    original = copy.deepcopy(processes)
    ns['egress_nnp_live']({'uid': 20000}, 'systemd')
    assert processes == original, 'admission cannot mutate, restart or signal sessions'
    assert queries == ['ssh.service', 'ssh.service'], 'all sessions share one before/after authority query'
    assert closed.count(20) == 1, 'the fixed systemctl descriptor must close exactly once'

    ns, processes, responses, queries, closed, _flags = systemd_fixture()
    processes[1200] = process(1200, 1, group='/system.slice/sshd.service')
    processes[1900] = process(1900, 1200, group='/user.slice/user-1001.slice/session-85.scope', uid=1001,
                              arguments=[b'sshd: bob@notty'])
    responses['sshd.service'] = dict(responses['ssh.service'], Id='sshd.service', MainPID='1200', ControlGroup='/system.slice/sshd.service')
    ns['egress_nnp_live']({'uid': 20000}, 'systemd')
    assert queries == ['ssh.service', 'sshd.service', 'ssh.service', 'sshd.service']
    assert closed.count(20) == 1

    ns, processes, _responses, queries, closed, _flags = systemd_fixture()
    del processes[1743]
    ns['egress_nnp_live']({'uid': 20000}, 'systemd')
    assert not queries and 20 not in closed, 'the existing service-cgroup path does not open or query systemctl'


def systemd_scope_and_listener_refusals():
    for variant in ('missing-main-pid', 'nonroot-listener', 'helper-listener', 'wrong-listener-group',
                    'orphan', 'fake-title', 'unknown-parent', 'foreign-image', 'foreign-exe', 'retired-image',
                    'other-scope', 'generic-user-slice', 'foreign-session-name'):
        ns, processes, _responses, _queries, closed, _flags = systemd_fixture()
        child, listener = processes[1743], processes[1040]
        if variant == 'missing-main-pid':
            del processes[1040]
        elif variant == 'nonroot-listener':
            listener['uids'] = [1000] * 4
        elif variant == 'helper-listener':
            listener.update(executable='/usr/lib/ssh/sshd-session', image=image(6), arguments=[b'sshd-session: root [listener]'])
        elif variant == 'wrong-listener-group':
            listener['cgroupName'] = '/system.slice/sshd.service'
        elif variant in ('orphan', 'fake-title'):
            child['parentPid'] = 1
            if variant == 'fake-title':
                child['arguments'] = [b'sshd: root [listener]']
        elif variant in ('unknown-parent', 'other-scope'):
            processes[1500] = process(1500, 1040, group=child['cgroupName'])
            processes[1500]['startTicks'] = '78400'
            child['parentPid'] = 1500
            if variant == 'unknown-parent':
                processes[1500].update(executable='/bin/sh', image=image(7))
            else:
                processes[1500]['cgroupName'] = '/user.slice/user-0.slice/session-83.scope'
        elif variant == 'foreign-image':
            child['image'] = image(99)
        elif variant == 'foreign-exe':
            child['executable'] = '/bin/sh'
        elif variant == 'retired-image':
            child.update(executable='/usr/sbin/sshd (deleted)', image=image(99))
        elif variant == 'generic-user-slice':
            child['cgroupName'] = '/user.slice/user-0.slice'
        elif variant == 'foreign-session-name':
            child['cgroupName'] = '/user.slice/user-0.slice/session-forged.scope'
        refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'systemd'), 'EGRESS_NNP_SERVICE_UNVERIFIED')
        assert closed.count(20) == (0 if variant in ('generic-user-slice', 'foreign-session-name') else 1), variant
    for pid in (1040, 1743):
        ns, processes, _responses, _queries, closed, _flags = systemd_fixture()
        processes[pid]['nnp'] = 0
        detail = refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'systemd'), 'EGRESS_NNP_RESTART_REQUIRED')
        assert detail['pid'] == pid
        assert 20 not in closed, 'NNP rejection precedes the PAM authority fallback'
    for executable, inode, uid in (('/usr/sbin/sshd', 1, 1000), ('/usr/lib/ssh/sshd-session', 6, 1000),
                                   ('/usr/lib/ssh/sshd-auth', 3, 22)):
        ns, processes, _responses, _queries, closed, _flags = systemd_fixture()
        processes[1800] = process(1800, 1040, executable=executable, inode=inode, uid=uid, nnp=0,
                                  group='/user.slice/user-1000.slice/session-85.scope', arguments=[b'sshd: user [priv]'])
        detail = refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'systemd'), 'EGRESS_NNP_RESTART_REQUIRED')
        assert detail['pid'] == 1800 and closed.count(20) == 1, 'even an already verified listener cannot exempt an NNP=0 child'


def systemd_authority_changes_and_fd_cleanup():
    for field, value in (('MainPID', '100'), ('ControlGroup', '/system.slice/sshd.service'), ('Id', 'sshd.service'),
                         ('LoadState', 'masked'), ('ActiveState', 'inactive'), ('SubState', 'dead'),
                         ('NeedDaemonReload', 'yes'), ('NoNewPrivileges', 'no')):
        ns, _processes, responses, queries, closed, flags = systemd_fixture()
        def drift(unit, count):
            if count == 2:
                responses[unit][field] = value
        flags['query_hook'] = drift
        refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'systemd'), 'EGRESS_NNP_PROCESS_CHANGED')
        assert queries == ['ssh.service', 'ssh.service'] and closed.count(20) == 1, field
    for phase in ('initial', 'final'):
        for variant in ('query-failed', 'untrusted-tool', 'setid-tool', 'nonexec-tool', 'open-failed'):
            if phase == 'final' and variant != 'query-failed':
                continue
            ns, _processes, _responses, queries, closed, _flags = systemd_fixture()
            code = 'EGRESS_NNP_PROCESS_CHANGED' if phase == 'final' else 'EGRESS_NNP_SERVICE_UNVERIFIED'
            if variant == 'query-failed':
                execute = ns['execute']
                def fail(argv, **kwargs):
                    if phase == 'initial' or queries:
                        ns['refuse']('SYSTEM_TOOL_FAILED')
                    return execute(argv, **kwargs)
                ns['execute'] = fail
            elif variant == 'open-failed':
                open_fd = ns['os'].open
                def fail_open(name, mode, **kwargs):
                    if name == 'systemctl':
                        raise PermissionError('model-tool-open-refused')
                    return open_fd(name, mode, **kwargs)
                ns['os'].open = fail_open
            else:
                fstat = ns['os'].fstat
                def unsafe_tool(descriptor):
                    info = fstat(descriptor)
                    if descriptor == 20:
                        if variant == 'untrusted-tool':
                            info.st_uid = 1000
                        else:
                            info.st_mode = stat.S_IFREG | (0o4755 if variant == 'setid-tool' else 0o644)
                    return info
                ns['os'].fstat = unsafe_tool
                code = 'UNTRUSTED_RECORD' if variant == 'untrusted-tool' else 'EGRESS_NNP_UNSUPPORTED'
            if variant == 'open-failed':
                try:
                    ns['egress_nnp_live']({'uid': 20000}, 'systemd')
                except PermissionError:
                    pass
                else:
                    raise AssertionError('missing tool-open failure')
            else:
                refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'systemd'), code)
            assert closed.count(20) == (0 if variant == 'open-failed' else 1), (phase, variant)
            assert closed.count(11) == closed.count(12) == 1, 'both proc and tool parent pins are closed exactly once'


def systemd_pam_identity_changes_and_chain_bounds():
    for stage in ('initial', 'final'):
        for variant in ('parent', 'birth', 'image', 'executable', 'uid', 'caps', 'cgroup', 'nnp', 'exited', 'listener-birth'):
            ns, _processes, _responses, queries, closed, _flags = systemd_fixture()
            original, reads = ns['egress_nnp_process'], {}
            def changed(parent, pid):
                current = original(parent, pid)
                reads[pid] = reads.get(pid, 0) + 1
                watched = 1040 if variant == 'listener-birth' else 1743
                drift = reads[pid] > 1 if stage == 'initial' else len(queries) >= 2
                if pid == watched and drift:
                    if variant == 'parent':
                        current['parentPid'] = 1
                    elif variant in ('birth', 'listener-birth'):
                        current['startTicks'] = str(int(current['startTicks']) + 1)
                    elif variant == 'image':
                        current['image'] = image(99)
                    elif variant == 'executable':
                        current['executable'] = '/bin/sh'
                    elif variant == 'uid':
                        current['uids'] = [1000] * 4
                    elif variant == 'caps':
                        current['caps'] = [0, 1, 0]
                    elif variant == 'cgroup':
                        current['cgroupName'] = '/user.slice/user-0.slice/session-85.scope'
                    elif variant == 'nnp':
                        current['nnp'] = 0
                    elif variant == 'exited':
                        return None
                return current
            ns['egress_nnp_process'] = changed
            detail = refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'systemd'), 'EGRESS_NNP_PROCESS_CHANGED')
            assert detail['pid'] == (1040 if variant == 'listener-birth' else 1743), (stage, variant)
            assert closed.count(20) == 1
    for variant in ('cycle', 'parent-born-later', 'over-bound'):
        ns, processes, _responses, _queries, closed, _flags = systemd_fixture()
        if variant == 'cycle':
            processes[1743]['parentPid'] = 1743
        elif variant == 'parent-born-later':
            processes[1040]['startTicks'] = '78473'
        else:
            # Insert newest to oldest so the failing leaf reaches the actual
            # bound instead of first admitting each short suffix separately.
            scope = processes[1743]['cgroupName']
            del processes[1743]
            for pid in range(3000, 2871, -1):
                processes[pid] = process(pid, pid - 1 if pid != 2872 else 1040, group=scope,
                                         arguments=[b'sshd: ordinary [priv]'])
        refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'systemd'), 'EGRESS_NNP_PROCESS_CHANGED')
        assert closed.count(20) == 1


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


def initial_snapshot_recovers_unrelated_churn():
    for variant in ('new-unrelated-pid', 'unrelated-transient-image'):
        ns, processes, _responses, queries, closed, _flags = systemd_fixture()
        calls, reads = dict(listdir=0), {}
        ns['time'] = types.SimpleNamespace(monotonic=lambda: 0)
        original_list, original_read = ns['os'].listdir, ns['egress_nnp_process']
        unrelated = process(9000, 1, executable='/usr/bin/sleep', inode=90, uid=1000, nnp=0,
                            group='/user.slice/user-1000.slice/session-99.scope')
        if variant == 'unrelated-transient-image':
            processes[9000] = unrelated
        def listed(fd):
            calls['listdir'] += 1
            if variant == 'new-unrelated-pid' and calls['listdir'] == 2:
                processes[9000] = unrelated
            return original_list(fd)
        def read(parent, pid):
            reads[pid] = reads.get(pid, 0) + 1
            if variant == 'unrelated-transient-image' and pid == 9000 and reads[pid] == 1:
                ns['refuse']('EGRESS_NNP_PROCESS_CHANGED', {'pid': pid, 'reason': 'process-identity-or-image-changed'})
            return original_read(parent, pid)
        ns['os'].listdir, ns['egress_nnp_process'] = listed, read
        ns['egress_nnp_live']({'uid': 20000}, 'systemd')
        assert queries == ['ssh.service', 'ssh.service'] and closed.count(20) == 1
        assert calls['listdir'] == 3
        assert reads[9000] == (1 if variant == 'new-unrelated-pid' else 2), 'incremental collection must read the actual new/transient PID'
        assert processes[1743]['parentPid'] == 1040 and processes[1743]['startTicks'] == '78472'


def initial_snapshot_rejects_dangerous_new_pids():
    for born_at in (2, 4):
        for variant, code in (('ssh-nnp-zero', 'EGRESS_NNP_RESTART_REQUIRED'), ('cron-nnp-zero', 'EGRESS_NNP_RESTART_REQUIRED'),
                              ('unknown-ssh-owner', 'EGRESS_NNP_SERVICE_UNVERIFIED'), ('project-nnp-zero', 'EGRESS_NNP_RESTART_REQUIRED'),
                              ('project-capability', 'EGRESS_NNP_ACCOUNT_PRIVILEGED'), ('project-mixed-uid', 'EGRESS_NNP_ACCOUNT_PRIVILEGED')):
            ns, processes, _responses, _queries, closed, _flags = systemd_fixture()
            ns['time'] = types.SimpleNamespace(monotonic=lambda: 0)
            calls, read_pids = dict(listdir=0), []
            original_list, original_read = ns['os'].listdir, ns['egress_nnp_process']
            child = process(9000, 1040, group='/user.slice/user-1000.slice/session-99.scope', nnp=0, uid=1000,
                            arguments=[b'sshd: ordinary@notty'])
            if variant == 'unknown-ssh-owner':
                child.update(nnp=1, parentPid=1, cgroupName='/unknown.scope')
            elif variant == 'cron-nnp-zero':
                child = process(9000, 1, executable='/usr/sbin/crond', inode=2, nnp=0, group='/system.slice/crond.service')
            elif variant.startswith('project-'):
                child.update(executable='/bin/sh', image=image(90), uids=[20000] * 4, nnp=0 if variant == 'project-nnp-zero' else 1)
                if variant == 'project-capability':
                    child['caps'] = [0, 1, 0]
                elif variant == 'project-mixed-uid':
                    child['uids'][1] = 0
            def listed(fd):
                calls['listdir'] += 1
                if calls['listdir'] >= 2:
                    pid = 9100 + calls['listdir']
                    processes[pid] = process(pid, 1, executable='/usr/bin/sleep', inode=90, uid=1000, nnp=0)
                if calls['listdir'] == born_at:
                    processes[9000] = child
                return original_list(fd)
            def read(parent, pid):
                read_pids.append(pid)
                return original_read(parent, pid)
            ns['os'].listdir, ns['egress_nnp_process'] = listed, read
            detail = refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'systemd'), code)
            assert detail['pid'] == 9000 and calls['listdir'] == 4 and read_pids.count(9000) == 1
            assert all(pid in read_pids for pid in processes), 'the final census must read every new actual PID before admission'
            assert detail.get('stage') != 'process-snapshot' and closed.count(20) == 1


def initial_snapshot_retry_bounds_and_safe_reasons():
    for variant in ('continuous-read-change', 'before-read-deadline', 'after-read-deadline', 'after-birth-deadline',
                    'after-census-deadline', 'between-increments-deadline', 'retry-read-deadline'):
        ns, processes, _responses, queries, closed, _flags = systemd_fixture()
        clock, calls, reads, births = [0], dict(listdir=0, monotonic=0), [], []
        def monotonic():
            calls['monotonic'] += 1
            if variant == 'before-read-deadline' and calls['monotonic'] == 4:
                clock[0] = 15
            return clock[0]
        ns['time'] = types.SimpleNamespace(monotonic=monotonic)
        original_list, original_read, original_birth = ns['os'].listdir, ns['egress_nnp_process'], ns['egress_nnp_birth']
        if variant in ('continuous-read-change', 'retry-read-deadline'):
            processes[9000] = process(9000, 1, executable='/usr/bin/sleep', inode=90, uid=1000, nnp=0)
        def listed(fd):
            calls['listdir'] += 1
            if variant.endswith('deadline') and calls['listdir'] == 2:
                processes[9000] = process(9000, 1, executable='/usr/bin/sleep', inode=90, uid=1000, nnp=0)
            if (variant == 'after-census-deadline' and calls['listdir'] == 2) or \
               (variant == 'between-increments-deadline' and calls['listdir'] == 3):
                clock[0] = 15
            return original_list(fd)
        def read(parent, pid):
            reads.append(pid)
            if pid == 9000 and (variant == 'continuous-read-change' or (variant == 'retry-read-deadline' and calls['listdir'] == 1)):
                ns['refuse']('EGRESS_NNP_PROCESS_CHANGED', {'pid': pid, 'reason': 'process-identity-or-image-changed'})
            current = original_read(parent, pid)
            if (variant == 'after-read-deadline' and pid == 9000) or \
               (variant == 'retry-read-deadline' and calls['listdir'] == 2):
                clock[0] = 15.1
            return current
        def birth(parent, pid):
            births.append(pid)
            current = original_birth(parent, pid)
            if variant == 'after-birth-deadline':
                clock[0] = 15.1
            return current
        ns['os'].listdir, ns['egress_nnp_process'], ns['egress_nnp_birth'] = listed, read, birth
        detail = refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'systemd'), 'EGRESS_NNP_PROCESS_CHANGED')
        assert detail['manager'] == 'systemd' and detail['stage'] == 'process-snapshot' and not queries and 20 not in closed
        assert detail['snapshotAttempts'] == (3 if variant == 'continuous-read-change' else 2 if variant == 'retry-read-deadline' else 1)
        assert detail['incrementRounds'] == (0 if variant in ('continuous-read-change', 'retry-read-deadline') else
                                             2 if variant == 'between-increments-deadline' else 1)
        expected_reason = 'process-identity-or-image-changed' if variant == 'continuous-read-change' else 'process-snapshot-deadline'
        assert detail['reason'] == expected_reason
        assert not any(key in detail for key in ('arguments', 'environment', 'cmdline', 'status'))
        if variant == 'after-read-deadline':
            assert reads.count(100) == reads.count(200) == reads.count(9000) == 1, 'a single incremental read crossing fifteen seconds stops immediately'
        elif variant == 'after-birth-deadline':
            assert births == [100], 'a single birth read crossing the window must stop before the next PID'
        elif variant == 'before-read-deadline':
            assert not births and 9000 not in reads
        elif variant == 'retry-read-deadline':
            assert reads.count(100) == 2 and reads.count(200) == 1
    # The first ordinary collection retains its original host-controlled
    # timeout rather than rejecting a slow but internally stable guest.
    ns, _processes, _responses, queries, _closed, _flags = systemd_fixture()
    clock = [0]
    ns['time'] = types.SimpleNamespace(monotonic=lambda: clock[0])
    original_read = ns['egress_nnp_process']
    def slow(parent, pid):
        clock[0] += 3
        return original_read(parent, pid)
    ns['egress_nnp_process'] = slow
    ns['egress_nnp_live']({'uid': 20000}, 'systemd')
    assert clock[0] > 5 and queries == ['ssh.service', 'ssh.service']


def incremental_census_includes_continuous_births():
    ns, processes, _responses, queries, closed, _flags = systemd_fixture()
    calls, reads, snapshots = dict(listdir=0), [], []
    ns['time'] = types.SimpleNamespace(monotonic=lambda: 0)
    original_list, original_read, original_snapshot = ns['os'].listdir, ns['egress_nnp_process'], ns['egress_nnp_snapshot']
    def listed(fd):
        calls['listdir'] += 1
        if calls['listdir'] > 1:
            for offset in range(2):
                pid = 9000 + calls['listdir'] * 2 + offset
                processes[pid] = process(pid, 1, executable='/usr/bin/sleep', inode=90, uid=1000, nnp=0)
        return original_list(fd)
    def read(parent, pid):
        reads.append(pid)
        return original_read(parent, pid)
    def snapshot(parent, manager):
        current = original_snapshot(parent, manager)
        snapshots.append(current)
        return current
    ns['os'].listdir, ns['egress_nnp_process'], ns['egress_nnp_snapshot'] = listed, read, snapshot
    ns['egress_nnp_live']({'uid': 20000}, 'systemd')
    assert calls['listdir'] == 4 and set(snapshots[0]) == set(processes)
    assert all(reads.count(pid) == 1 for pid in processes if pid >= 9000), 'all six actual new processes, including the last pair, are read once'
    assert reads.count(100) == reads.count(200) == reads.count(300) == 1, 'birth checks must not restart the entire expensive collection'
    assert queries == ['ssh.service', 'ssh.service'] and closed.count(20) == closed.count(11) == 1


def incremental_census_rejects_pid_reuse_and_unstable_reads():
    for variant in ('reused-first-increment', 'reused-last-increment', 'vanished-then-reused', 'new-read-changed', 'cached-birth-invalid'):
        ns, processes, _responses, queries, closed, _flags = systemd_fixture()
        calls, reads, births = dict(listdir=0), [], []
        ns['time'] = types.SimpleNamespace(monotonic=lambda: 0)
        processes[9000] = process(9000, 1, executable='/usr/bin/sleep', inode=90, uid=1000, nnp=0)
        original_list, original_read, original_birth = ns['os'].listdir, ns['egress_nnp_process'], ns['egress_nnp_birth']
        def listed(fd):
            calls['listdir'] += 1
            if calls['listdir'] > 1:
                pid = 9100 + calls['listdir']
                processes[pid] = process(pid, 1, executable='/usr/bin/sleep', inode=90, uid=1000, nnp=0)
            if (variant == 'reused-first-increment' and calls['listdir'] == 2) or \
               (variant in ('reused-last-increment', 'vanished-then-reused') and calls['listdir'] == 4):
                processes[9000] = process(9000, 1, executable='/bin/sh', inode=91, uid=20000, nnp=0)
                processes[9000]['startTicks'] = '900001'
            return original_list(fd)
        def read(parent, pid):
            reads.append(pid)
            if variant == 'new-read-changed' and pid == 9102:
                ns['refuse']('EGRESS_NNP_PROCESS_CHANGED', {'pid': pid, 'reason': 'process-identity-or-image-changed'})
            return original_read(parent, pid)
        def birth(parent, pid):
            births.append(pid)
            if variant == 'vanished-then-reused' and pid == 9000 and calls['listdir'] < 4:
                return None
            if variant == 'cached-birth-invalid' and pid == 9000:
                ns['refuse']('EGRESS_NNP_PROCESS_CHANGED', {'pid': pid, 'reason': 'process-birth-invalid'})
            return original_birth(parent, pid)
        ns['os'].listdir, ns['egress_nnp_process'], ns['egress_nnp_birth'] = listed, read, birth
        detail = refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'systemd'), 'EGRESS_NNP_PROCESS_CHANGED')
        assert detail['snapshotAttempts'] == 1 and detail['stage'] == 'process-snapshot'
        assert detail['incrementRounds'] == (3 if variant in ('reused-last-increment', 'vanished-then-reused') else 1)
        expected = 'process-identity-or-image-changed' if variant == 'new-read-changed' else \
                   'process-birth-invalid' if variant == 'cached-birth-invalid' else 'process-pid-reused'
        assert detail['reason'] == expected and not queries and 20 not in closed and closed.count(11) == 1
        assert reads.count(9000) == 1, 'a changed kernel birth is rejected rather than silently overwriting the cached PID'


def pinned_process_birth_and_fd_cleanup():
    for variant in ('valid', 'name-contains-parentheses', 'zombie', 'dead', 'kernel-thread', 'fake-kthread-name',
                    'wrong-pid', 'truncated', 'invalid-birth', 'invalid-flags', 'overflow-flags', 'too-large',
                    'missing-directory', 'missing-stat', 'gone-after-stat-open', 'read-failed'):
        ns, opened, closed = namespace(), [], []
        fields = [b'S', b'1'] + [b'0'] * 17 + [b'7000']
        raw = b'70 (sshd arbitrary) ' + b' '.join(fields)
        if variant == 'name-contains-parentheses':
            raw = b'70 (name) with (parentheses) ' + b' '.join(fields)
        elif variant in ('zombie', 'dead', 'kernel-thread', 'invalid-flags', 'overflow-flags'):
            if variant in ('zombie', 'dead'):
                fields[0] = b'Z' if variant == 'zombie' else b'X'
            else:
                fields[6] = b'2097152' if variant == 'kernel-thread' else b'unknown' if variant == 'invalid-flags' else b'4294967296'
            raw = b'70 (sshd arbitrary) ' + b' '.join(fields)
        elif variant == 'fake-kthread-name':
            raw = b'70 (kthreadd) ' + b' '.join(fields)
        elif variant == 'wrong-pid':
            raw = b'71 (sshd arbitrary) ' + b' '.join(fields)
        elif variant == 'truncated':
            raw = b'70 (sshd arbitrary) S 1'
        elif variant == 'invalid-birth':
            raw = raw.replace(b'7000', b'+7000')
        elif variant == 'too-large':
            raw = b'x' * 16385
        def open_fd(name, flags, **kwargs):
            opened.append((name, flags, kwargs))
            if (variant == 'missing-directory' and name == '70') or (variant in ('missing-stat', 'gone-after-stat-open') and name == 'stat'):
                raise FileNotFoundError('model-gone')
            return 20 if name == '70' else 21
        def read(fd, count):
            assert fd == 21 and count == 16385
            if variant == 'read-failed':
                raise PermissionError('model-read-refused')
            return raw
        def exists(name, **kwargs):
            assert name == '70' and kwargs == dict(dir_fd=10, follow_symlinks=False)
            if variant == 'gone-after-stat-open':
                raise ProcessLookupError('model-process-exited')
            return types.SimpleNamespace(st_mode=stat.S_IFDIR)
        ns['os'] = types.SimpleNamespace(O_RDONLY=1, O_DIRECTORY=2, O_NOFOLLOW=4, O_CLOEXEC=8,
                                        open=open_fd, close=closed.append, read=read, stat=exists)
        if variant in ('valid', 'name-contains-parentheses', 'zombie', 'dead', 'kernel-thread', 'fake-kthread-name'):
            assert ns['egress_nnp_birth'](10, 70) == dict(startTicks='7000', inactive=variant in ('zombie', 'dead', 'kernel-thread'))
        elif variant in ('missing-directory', 'gone-after-stat-open'):
            assert ns['egress_nnp_birth'](10, 70) is None
        elif variant == 'missing-stat':
            assert refused(ns, lambda: ns['egress_nnp_birth'](10, 70), 'EGRESS_NNP_PROCESS_CHANGED') == \
                   {'pid': 70, 'reason': 'process-birth-unavailable'}
        elif variant == 'read-failed':
            try:
                ns['egress_nnp_birth'](10, 70)
            except PermissionError:
                pass
            else:
                raise AssertionError('an unknown stat-read error was accepted')
        else:
            assert refused(ns, lambda: ns['egress_nnp_birth'](10, 70), 'EGRESS_NNP_PROCESS_CHANGED') == \
                   {'pid': 70, 'reason': 'process-birth-invalid'}
        assert opened[0] == ('70', 15, dict(dir_fd=10))
        if variant != 'missing-directory':
            assert opened[1] == ('stat', 13, dict(dir_fd=20))
        assert closed == ([] if variant == 'missing-directory' else [20] if variant in ('missing-stat', 'gone-after-stat-open') else [21, 20])
        # Exercise the real snapshot's incomplete-read branch with the same
        # production stat decoder and pinned-FD fixture, not a duplicated rule.
        if variant in ('valid', 'fake-kthread-name', 'zombie', 'dead', 'kernel-thread', 'invalid-flags'):
            closed.clear()
            ns['os'].listdir = lambda _: ['70']
            ns['time'] = types.SimpleNamespace(monotonic=lambda: 0)
            ns['egress_nnp_process'] = lambda *_: None
            if variant in ('zombie', 'dead', 'kernel-thread'):
                assert ns['egress_nnp_snapshot'](10, 'systemd') == {}
                assert closed == [21, 20, 21, 20]
            else:
                detail = refused(ns, lambda: ns['egress_nnp_snapshot'](10, 'systemd'), 'EGRESS_NNP_PROCESS_CHANGED')
                assert detail['reason'] == ('process-birth-invalid' if variant == 'invalid-flags' else 'process-read-incomplete')
                assert detail['snapshotAttempts'] == 3 and detail['incrementRounds'] == 0
                assert closed == [21, 20] * 3


def root_ancestor_failures_and_used_nodes_are_not_retried():
    for variant in ('cycle', 'missing-controller', 'nonroot-controller', 'used-node-reparented'):
        ns, processes, _responses, queries, closed, _flags = systemd_fixture()
        calls = dict(listdir=0)
        original_list = ns['os'].listdir
        def listed(fd):
            calls['listdir'] += 1
            return original_list(fd)
        ns['os'].listdir = listed
        if variant == 'cycle':
            processes[200]['parentPid'] = 300
        elif variant == 'missing-controller':
            del processes[300]
        elif variant == 'nonroot-controller':
            processes[300]['uids'] = [1000] * 4
        else:
            read = ns['egress_nnp_process']
            def changed(parent, pid):
                current = read(parent, pid)
                if pid == 1743 and len(queries) >= 2:
                    current['parentPid'] = 1
                return current
            ns['egress_nnp_process'] = changed
        detail = refused(ns, lambda: ns['egress_nnp_live']({'uid': 20000}, 'systemd'), 'EGRESS_NNP_PROCESS_CHANGED')
        assert calls['listdir'] == 2 and detail.get('stage') != 'process-snapshot'
        if variant == 'used-node-reparented':
            assert detail['pid'] == 1743 and queries == ['ssh.service', 'ssh.service'] and closed.count(20) == 1
        else:
            assert not queries and 20 not in closed
            assert detail['reason'] == ('root-ancestor-cycle-or-limit' if variant == 'cycle' else 'controller-process-not-root-or-missing')


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
    flags = dict(stat_reads=0, image_reads=0, parent_changed=False, image_changed=False)
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
    def current_image(*_args, **_kwargs):
        flags['image_reads'] += 1
        return image(2 if flags['image_changed'] and flags['image_reads'] > 1 else 1)
    ns['os'] = types.SimpleNamespace(O_RDONLY=0, O_DIRECTORY=0, O_NOFOLLOW=0, O_CLOEXEC=0,
                                    open=lambda name, *_args, **_kwargs: name, close=lambda *_: None,
                                    read=read, readlink=lambda *_args, **_kwargs: '/usr/sbin/sshd',
                                    stat=current_image)
    item = ns['egress_nnp_process'](10, 70)
    assert item['parentPid'] == 1 and item['startTicks'] == '7000' and item['nnp'] == 1
    for parent_changed, image_changed in ((True, False), (False, True)):
        flags.update(stat_reads=0, image_reads=0, parent_changed=parent_changed, image_changed=image_changed)
        detail = refused(ns, lambda: ns['egress_nnp_process'](10, 70), 'EGRESS_NNP_PROCESS_CHANGED')
        assert detail == {'pid': 70, 'reason': 'process-identity-or-image-changed'}
    flags.update(stat_reads=0, image_reads=0, parent_changed=False, image_changed=False)
    files['cmdline'] = b'x' * 65537
    detail = refused(ns, lambda: ns['egress_nnp_process'](10, 70), 'EGRESS_NNP_PROCESS_CHANGED')
    assert detail == {'pid': 70, 'reason': 'process-field-too-large', 'file': 'cmdline'}
    files['cmdline'] = b'/usr/sbin/sshd\0-D\0'
    original_open, original_readlink = ns['os'].open, ns['os'].readlink
    ns['os'].listdir = lambda _: ['70']
    ns['time'] = types.SimpleNamespace(monotonic=lambda: 0)
    for missing in ('stat', 'status', 'cmdline', 'cgroup', 'exe'):
        def missing_open(name, *args, **kwargs):
            if name == missing:
                raise FileNotFoundError('model-live-source-missing')
            return original_open(name, *args, **kwargs)
        def missing_exe(*args, **kwargs):
            if missing == 'exe':
                raise FileNotFoundError('model-live-executable-missing')
            return original_readlink(*args, **kwargs)
        ns['os'].open, ns['os'].readlink = missing_open, missing_exe
        assert ns['egress_nnp_process'](10, 70) is None
        detail = refused(ns, lambda: ns['egress_nnp_snapshot'](10, 'systemd'), 'EGRESS_NNP_PROCESS_CHANGED')
        assert detail['reason'] == ('process-birth-unavailable' if missing == 'stat' else 'process-read-incomplete')
        assert detail['pid'] == 70 and detail['snapshotAttempts'] == 3 and detail['incrementRounds'] == 0


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
          openrc_current_launchers, configuration_is_separate_from_live_admission, readable_pinned_directories,
          systemd_pam_sessions_and_bounded_authority, systemd_scope_and_listener_refusals,
          systemd_authority_changes_and_fd_cleanup, systemd_pam_identity_changes_and_chain_bounds,
          initial_snapshot_recovers_unrelated_churn, initial_snapshot_rejects_dangerous_new_pids,
          initial_snapshot_retry_bounds_and_safe_reasons, root_ancestor_failures_and_used_nodes_are_not_retried,
          incremental_census_includes_continuous_births, incremental_census_rejects_pid_reuse_and_unstable_reads,
          pinned_process_birth_and_fd_cleanup]
for check in checks:
    check()
print(json.dumps(dict(passed=True, kind='portable-model-only', sourceSha256=hashlib.sha256(source).hexdigest(),
                      checks=[check.__name__ for check in checks]), separators=(',', ':')))
