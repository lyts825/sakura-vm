# 模块职责：生产出口策略的事务模型：分开记录持久票据、内核表和启动文件，注入丢失回执及中断。
# Module: Transaction models for production egress policy: retain durable receipts, kernel tables and boot files separately and inject lost acknowledgements or interruptions.
# 阅读方式：按初始化、具名辅助函数与测试情景阅读；便携模型与模拟接口不能证明真实 Linux 隔离。
# Reading guide: Follow initialization, named helpers and cases; portable models and substituted interfaces do not attest real Linux isolation.
# 可移植边界模型：通过受控适配器验证生产流程；真实系统权限与进程隔离需另行运行 Linux 验证。
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


# 中文功能：构造本组边界验证所需的模型对象或输入材料。
# English: Construct model objects or input material required by this boundary-verification group.
# 输入 / Inputs: mode = 'private'。
# 结果：返回分支计算值（`types.SimpleNamespace(ns=ns, value=value, current=current, records=records, tables=tables, flags=fla…`），实际类型由实现及使用处约定。
# Result: Return the branch-computed value (`types.SimpleNamespace(ns=ns, value=value, current=current, records=records, tables=tables, flags=fla…`); its implementation and call sites define the actual type.
# 状态影响 / State effects: `ns['egress_context']`, `ns['egress_nnp_check']`, `ns['egress_nnp_configuration']`, `ns['egress_systemd_nnp']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `dict`, `exec`, `compile`, `str`.
# 设计思路：内核适配器独立解析固定 nft 创建语法，不从生产生成结果回显构造假内核；持久记录和表状态分开保存，以便模拟已生效但回执丢失的事务。
# Design: The kernel adapter independently parses fixed nft creation syntax instead of echoing production output into a fake kernel. Persisted records and table state remain separate to model transactions that applied but lost their acknowledgements.
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
    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: path, record。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `records[path]`, `flags['lost_write']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 失败 / Failure: `OSError('owned durable write ACK lost')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `copy.deepcopy`, `events.append`, `OSError`.
    def write(path, record):
        records[path] = copy.deepcopy(record)
        events.append(('record', record['phase'], record['mode']))
        if flags['lost_write']:
            flags['lost_write'] = False
            raise OSError('owned durable write ACK lost')
    ns['json_write'] = write
    ns['binding_read'] = lambda *_args: copy.deepcopy(current)
    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: arguments, data = None, json_output = True。
    # 结果：返回分支计算值（`json.dumps({'nftables': [{'metainfo': {'json_schema_version': 1}}] + [{'table': {'family': 'inet', '… / json.dumps({'nftables': tables[arguments[3]]}).encode()`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`json.dumps({'nftables': [{'metainfo': {'json_schema_version': 1}}] + [{'table': {'family': 'inet', '… / json.dumps({'nftables': tables[arguments[3]]}).encode()`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `flags['lost_delete']`, `flags['handle']`, `next(iter(item.values()))['handle']`, `tables[name]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 失败 / Failure: `OSError('owned delete ACK lost')`; `OSError('owned create ACK lost')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `json.dumps({'nftables': [{'metainfo': {'json_schema_version': 1}}] + [{'table': {'family': 'inet', '…`, `json.dumps`, `tables.items`, `json.dumps({'nftables': tables[arguments[3]]}).encode`.
    # 检查边界 / Checked boundaries: `json_output is True and data is None`; `json_output is True and data is None`.
    # 设计思路：用显式模型状态和受控适配调用排列边界情景，测试只依据其断言证明相应模型行为，不能外推真实系统权限。
    # Design: Arrange boundary cases with explicit model state and controlled adapters. Assertions establish the corresponding model behavior without attesting real system privileges.
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


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: f, call, code。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 失败 / Failure: `AssertionError('expected ' + code)`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `call`, `AssertionError`.
# 检查边界 / Checked boundaries: `error.code == code`.
def refused(f, call, code):
    try:
        call()
    except f.ns['Refusal'] as error:
        assert error.code == code, (error.code, code)
    else:
        raise AssertionError('expected ' + code)


# 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
# English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
# 输入 / Inputs: f。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 协作入口 / Collaborators: `f.ns['egress_prepare']`, `f.ns['egress_commit']`.
def provision(f):
    f.ns['egress_prepare'](f.value)
    f.ns['egress_commit'](f.value)


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `shared.ns['egress_context']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `provision`, `f.ns['egress_spec']`, `len`.
# 检查边界 / Checked boundaries: `len(f.tables) == 1 and name == 'skp_uid_20000'`; `objects[1]['chain']['hook'] == 'output' and objects[1]['chain']['family'] == 'inet'`.
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


# 中文功能：构造本组边界验证所需的模型对象或输入材料。
# English: Construct model objects or input material required by this boundary-verification group.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `f.flags[flag]`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('lost ACK must remain failure')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `fixture`, `provision`, `AssertionError`, `refused`.
# 检查边界 / Checked boundaries: `len(f.tables) == 1`.
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


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `f.tables[name][0]['table']['handle']`, `f.tables[name][2]['rule']['expr'][0]['match']['right']`, `f.tables[name][2]['rule']['expr'][1]`, `f.tables[name][1]['chain']['prio']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `provision`, `f.ns['egress_spec']`, `f.tables[name].append`.
# 检查边界 / Checked boundaries: `before == (f.tables, f.records)`; `not f.records`.
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


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `f.flags['lost_delete']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('delete ACK loss must remain pending')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `fixture`, `provision`, `dict`, `f.ns['egress_prepare']`.
# 检查边界 / Checked boundaries: `f.tables`; `not f.tables and next(iter(f.records.values()))['deleteIssued']`.
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


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `state[key]`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('foreign owner must refuse')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `str`, `uuid.uuid4`, `fixture`, `provision`.
# 检查边界 / Checked boundaries: `before == (f.tables, f.records)`.
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


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `f.context['bootId']`, `f.context['networkInode']`, `f.current['phase']`, `f.value['phase']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `provision`, `str`, `uuid.uuid4`.
# 检查边界 / Checked boundaries: `result == {'version': 1, 'privateAccounts': 1} and len(f.tables) == 1`; `next(iter(f.records.values()))['bootId'] == f.context['bootId']`.
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


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `f.ns['os']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `f.ns['egress_boot_plan']`, `base64.b64encode`, `len`.
# 检查边界 / Checked boundaries: `b'env -i' in restore and b'python3 -I -S' in restore`; `base64.b64encode(b'{"action":"restore-egress"}') in restore`.
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


# 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
# English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `f.ns['binding_write']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 协作入口 / Collaborators: `fixture`, `provision`, `f.value.update`, `f.current.update`.
# 检查边界 / Checked boundaries: `candidate['revision'] == 2 and (not f.tables)`; `next((i for i, event in enumerate(f.events) if event[0] == 'binding')) < next((i for i, event in enu…`.
def rebind_commit_order():
    f = fixture()
    provision(f)
    f.value.update(directoryDevice='1', directoryInode='100')
    f.current.update(f.value)
    f.ns.update(network_ready=lambda *_: None, runs_for=lambda *_: [],
               project_directory=lambda _: types.SimpleNamespace(st_dev=1, st_ino=100),
               probe=lambda *_: None, migration_retire_applied=lambda *_: None,
               durable_unlink=lambda *_: None)
    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: candidate。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 协作入口 / Collaborators: `next`, `iter`, `f.records.values`, `f.events.append`.
    # 检查边界 / Checked boundaries: `f.tables and next(iter(f.records.values()))['phase'] == 'pending'`.
    def binding(candidate):
        assert f.tables and next(iter(f.records.values()))['phase'] == 'pending'
        f.events.append(('binding', candidate['networkIsolation']))
        f.current.update(candidate)
    f.ns['binding_write'] = binding
    candidate = f.ns['rebind'](f.value, {'expected': {}, 'directory': '/workspace', 'networkIsolation': 'host'}, f.context['bootId'])
    assert candidate['revision'] == 2 and not f.tables
    assert next(i for i, event in enumerate(f.events) if event[0] == 'binding') < next(i for i, event in enumerate(f.events) if event[0] == 'delete')


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: openrc = False, directory_sync_failures = False。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 状态影响 / State effects: `files['/etc/conf.d/sshd']`, `modes['/etc/conf.d/sshd']`, `f.ns['egress_parent']`, `f.ns['egress_openrc_nnp']`. Follow the actual model assignments / 以模型中的实际赋值为准。
# 失败 / Failure: `AssertionError('O_PATH must have the observed Linux fsync refusal')`; `AssertionError('failed parent sync must prevent reload and applied on both new and existing links')`；由调用者或用例断言观察 / Observed by callers or case assertions.
# 协作入口 / Collaborators: `fixture`, `dict`, `set`, `types.SimpleNamespace`.
# 检查边界 / Checked boundaries: `error.errno == errno.EBADF`; `error.errno == errno.EIO`.
# 设计思路：分别模拟 systemd/OpenRC 与文件替换、服务重载、父目录同步的故障；O_PATH 与可读目录 FD 有不同 fsync 行为，避免模型抹平生产曾遇到的持久化边界。
# Design: Model systemd/OpenRC separately from failures in replacement, service reload and parent-directory sync. O_PATH and readable directory descriptors have distinct fsync behavior so the model preserves the production persistence boundary.
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
    # 中文功能：构造本组边界验证所需的模型对象或输入材料。
    # English: Construct model objects or input material required by this boundary-verification group.
    # 输入 / Inputs: path, value。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `owner_records[path]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `copy.deepcopy`, `events.append`.
    def record(path, value):
        owner_records[path] = copy.deepcopy(value)
        events.append(('record', value['phase']))
    f.ns['json_write'] = record
    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: path, data。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `flags['atomic_loss']`, `files[path]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 失败 / Failure: `OSError('owned interruption before file replacement')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `next`, `iter`, `owner_records.values`, `OSError`.
    # 检查边界 / Checked boundaries: `next(iter(owner_records.values()))['phase'] == 'pending'`.
    def atomic(path, data):
        assert next(iter(owner_records.values()))['phase'] == 'pending'
        if flags['atomic_loss']:
            flags['atomic_loss'] = False
            raise OSError('owned interruption before file replacement')
        files[path] = data
    f.ns['atomic'] = atomic
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: path。
    # 结果：返回分支计算值（`types.SimpleNamespace(st_mode=stat.S_IFLNK | 511 if path in links else stat.S_IFREG | modes.get(path…`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`types.SimpleNamespace(st_mode=stat.S_IFLNK | 511 if path in links else stat.S_IFREG | modes.get(path…`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `types.SimpleNamespace`, `modes.get`.
    def info(path):
        return types.SimpleNamespace(st_mode=stat.S_IFLNK | 0o777 if path in links else stat.S_IFREG | modes.get(path, 0o755), st_uid=0, st_nlink=1)
    # 中文功能：提供受控执行或协议入口，根据模型输入产生结果、状态变化或可观察失败。
    # English: Provide a controlled execution/protocol entry that produces results, state changes or observable failure from model inputs.
    # 输入 / Inputs: path, permissions, **kwargs。
    # 结果：返回分支计算值（`descriptor`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`descriptor`); its implementation and call sites define the actual type.
    # 状态影响 / State effects: `sequence['next']`, `descriptors[descriptor]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `dict`, `bool`.
    # 检查边界 / Checked boundaries: `path == '.'`; `parent['directory']`.
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
    # 中文功能：完成该测试辅助步骤并交付其计算结果或可观察状态，供相邻验证流程复用。
    # English: Perform this test-helper step and expose its computed result or observable state for reuse by adjacent verification flows.
    # 输入 / Inputs: descriptor。
    # 结果：返回分支计算值（`types.SimpleNamespace(st_mode=stat.S_IFDIR | 493 if entry['directory'] else stat.S_IFREG | modes[ent…`），实际类型由实现及使用处约定。
    # Result: Return the branch-computed value (`types.SimpleNamespace(st_mode=stat.S_IFDIR | 493 if entry['directory'] else stat.S_IFREG | modes[ent…`); its implementation and call sites define the actual type.
    # 协作入口 / Collaborators: `types.SimpleNamespace`.
    def descriptor_info(descriptor):
        entry = descriptors[descriptor]
        return types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o755 if entry['directory'] else stat.S_IFREG | modes[entry['path']],
                                     st_uid=0, st_nlink=1)
    # 中文功能：提供可控的拒绝或失败分支，让测试能够核对调用者的异常处理和证据保留。
    # English: Provide controlled rejection/failure branches so tests can verify caller exception handling and evidence retention.
    # 输入 / Inputs: descriptor。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `flags['directory_loss']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 失败 / Failure: `OSError(errno.EBADF, 'O_PATH cannot fsync')`; `OSError(errno.EIO, 'owned parent sync failure after symlink publication')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `OSError`, `events.append`.
    def descriptor_sync(descriptor):
        entry = descriptors[descriptor]
        if entry['flags'] & linux_path:
            raise OSError(errno.EBADF, 'O_PATH cannot fsync')
        if entry['directory']:
            events.append(('parent-sync', entry['path']))
            if flags['directory_loss']:
                flags['directory_loss'] = False
                raise OSError(errno.EIO, 'owned parent sync failure after symlink publication')
    # 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
    # English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
    # 输入 / Inputs: destination, path。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `links[path]`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 协作入口 / Collaborators: `events.append`.
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
    # 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
    # English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
    # 输入 / Inputs: argv, **_kwargs。
    # 结果：无显式返回值；效果通过模型状态、断言或异常观察。
    # Result: No explicit return value; effects are observed through model state, assertions or exceptions.
    # 状态影响 / State effects: `flags['reload_loss']`. Follow the actual model assignments / 以模型中的实际赋值为准。
    # 失败 / Failure: `OSError('owned reload ACK lost')`；由调用者或用例断言观察 / Observed by callers or case assertions.
    # 协作入口 / Collaborators: `next`, `iter`, `owner_records.values`, `all`.
    # 检查边界 / Checked boundaries: `argv == (['/usr/bin/rc-update', '-u'] if openrc else ['/usr/bin/systemctl', 'daemon-reload'])`; `owner['phase'] == 'pending'`.
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


# 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
# English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 协作入口 / Collaborators: `boot_install_and_interrupted_upgrade`.
def openrc_dependencies_and_operator_settings():
    boot_install_and_interrupted_upgrade(True)


# 中文功能：修改受控文件系统或持久化测试状态，用于安排事务提交、归属变化和故障情景。
# English: Modify the controlled filesystem or persisted test state to arrange transaction commits, ownership changes and fault cases.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 协作入口 / Collaborators: `boot_install_and_interrupted_upgrade`.
def boot_symlink_sync_and_pending_recovery():
    boot_install_and_interrupted_upgrade(False, True)
    boot_install_and_interrupted_upgrade(True, True)


# 中文功能：安排并核对本辅助步骤的实际条件与调用结果；以下断言摘录指出本步骤观察的边界。
# English: Arrange and check actual conditions and call results for this helper; the assertion excerpts below identify its observed boundaries.
# 输入 / Inputs: 无 / none。
# 结果：无显式返回值；效果通过模型状态、断言或异常观察。
# Result: No explicit return value; effects are observed through model state, assertions or exceptions.
# 协作入口 / Collaborators: `fixture`, `refused`, `f.ns['egress_json']`.
# 检查边界 / Checked boundaries: `f.ns['egress_json'](b'{"nftables":[{"metainfo":{"json_schema_version":1}}]}') == []`.
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
