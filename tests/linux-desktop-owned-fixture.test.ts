/**
 * 模块职责：共享测试夹具模块，围绕 `linux-desktop-owned-fixture` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `linux-desktop-owned-fixture`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: ordinary service admission restarts only loaded real fragments and skips only explicit not-found; post-restart admission bounds only waiting for the original typed refusal and preserves public call timeouts.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createCipheriv, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Socket } from 'node:net';
import test from 'node:test';
import ts from 'typescript';
import ssh2 from 'ssh2';
import { WebSocket, WebSocketServer } from 'ws';
import { closeOwnedDesktopSshClient, desktopFixtureLogPath, desktopFixtureParent, LinuxDesktopOwnedFixture, ownedDesktopQemuArguments, ownedDesktopBootstrapTimeout, parseOwnedDesktopBootstrapReply, sha256 } from '../scripts/linux-desktop-owned-fixture.ts';
import { probeOwnedDesktopRfb } from '../scripts/linux-desktop-rfb-probe.ts';

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new Function('assert', 'Buffer', 'sha256', program + '\nreturn { parseOwnedAdmis…`）。
 * Result: Return the branch-computed value (`new Function('assert', 'Buffer', 'sha256', program + '\nreturn { parseOwnedAdmis…`).
 * 协作入口 / Collaborators: `readFileSync`, `source.indexOf`, `assert.ok`, `ts.transpileModule`.
 * 检查边界 / Checked boundaries: `assert.ok(start >= 0 && end > start)`.
 */
function admissionParsers() {
  const source = readFileSync(new URL('../scripts/smoke-project-desktop-identity.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function parseOwnedAdmissionServiceReply('), end = source.indexOf('const singleAppFdClassifier =', start);
  assert.ok(start >= 0 && end > start);
  const program = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function('assert', 'Buffer', 'sha256', program + '\nreturn { parseOwnedAdmissionServiceReply, ownedAdmissionRetryRemaining, ownedAdmissionControlAction, parseOwnedBootstrapCloudReply };')(assert, Buffer, sha256);
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: ordinary service admission restarts only loaded real fragments and skips only explicit not-found
 * 协作入口 / Collaborators: `admissionParsers`, `assert.equal`, `parse`, `loaded.replace`.
 * 检查边界 / Checked boundaries: `assert.equal(parse(loaded, 'ssh.service').restart, true)`; `assert.equal(parse(absent, 'cron.service').restart, false)`.
 */
test('ordinary service admission restarts only loaded real fragments and skips only explicit not-found', () => {
  const { parseOwnedAdmissionServiceReply: parse } = admissionParsers();
  const loaded = 'LoadState=loaded\nFragmentPath=/lib/systemd/system/ssh.service\nId=ssh.service\nActiveState=active\nNoNewPrivileges=yes\nMainPID=354\n';
  const absent = 'LoadState=not-found\nFragmentPath=\nId=cron.service\nActiveState=inactive\nNoNewPrivileges=no\nMainPID=0\n';
  assert.equal(parse(loaded, 'ssh.service').restart, true); assert.equal(parse(absent, 'cron.service').restart, false);
  for (const reply of [loaded.replace('LoadState=loaded', 'LoadState=error'), loaded.replace('LoadState=loaded', 'LoadState=masked'),
    loaded.replace('/lib/systemd/system/ssh.service', ''), loaded.replace('/lib/systemd/system/ssh.service', '/lib/../ssh.service'),
    loaded.replace('Id=ssh.service', 'Id=foreign.service'), loaded.replace('MainPID=354', 'MainPID=-1'),
    loaded + 'LoadState=loaded\n', loaded.replace('NoNewPrivileges=yes\n', ''), loaded + 'Unknown=yes\n'])
    assert.throws(() => parse(reply, 'ssh.service'));
  assert.throws(() => parse(absent.replace('FragmentPath=\n', 'FragmentPath=/lib/systemd/system/cron.service\n'), 'cron.service'));
  assert.throws(() => parse(absent.replace('MainPID=0', 'MainPID=345'), 'cron.service'));
  assert.throws(() => parse(loaded, 'foreign.service')); assert.throws(() => parse(' '.repeat(8193), 'ssh.service'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: post-restart admission bounds only waiting for the original typed refusal and preserves public call timeouts
 * 协作入口 / Collaborators: `admissionParsers`, `Object.assign`, `assert.equal`, `remaining`.
 * 检查边界 / Checked boundaries: `assert.equal(remaining(refusal, 30000, 0), 500)`; `assert.equal(remaining(refusal, 30000, 29999), 1)`.
 */
test('post-restart admission bounds only waiting for the original typed refusal and preserves public call timeouts', () => {
  const { ownedAdmissionRetryRemaining: remaining } = admissionParsers();
  const refusal = Object.assign(new Error('original service session still alive'), { code: 'PROJECT_IDENTITY_EGRESS_NNP_RESTART_REQUIRED' });
  assert.equal(remaining(refusal, 30000, 0), 500); assert.equal(remaining(refusal, 30000, 29999), 1);
  for (const error of [new Error('connection lost'), Object.assign(new Error('changed'), { code: 'PROJECT_IDENTITY_EGRESS_TABLE_CHANGED' }),
    { code: refusal.code }, null]) assert.throws(() => remaining(error, 30000, 0), (actual: unknown) => actual === error);
  assert.throws(() => remaining(refusal, 30000, 30000), (actual: unknown) => actual === refusal);
  assert.throws(() => remaining(refusal, 30000, 30001), (actual: unknown) => actual === refusal);
  assert.throws(() => remaining(refusal, Number.NaN, 0), (actual: unknown) => actual === refusal);
  const source = readFileSync(new URL('../scripts/smoke-project-desktop-identity.ts', import.meta.url), 'utf8');
  const retry = source.slice(source.indexOf('const deadline = Date.now() + recovery.retryWaitBudgetMilliseconds;'), source.indexOf('assert.ok(preview.plan);'));
  assert.ok(retry.includes('preview = await migrations.preview(fixture.vmId);'));
  assert.ok(!retry.includes('new AbortController') && !retry.includes('setTimeout') && !retry.includes('Date.now() <= deadline'));
  assert.ok(retry.includes('ownedAdmissionRetryRemaining(retryError, deadline, Date.now())'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: fixed native observer selects only current Root install ensure inspect and excludes environments and other builds
 * 协作入口 / Collaborators: `admissionParsers`, `'1'.repeat`, `assert.equal`, `action`.
 * 检查边界 / Checked boundaries: `assert.equal(action(command({ action: 'install' }), build), 'install')`; `assert.equal(action(command({ action: 'inspect', projectId: ensure.projectId }), build), 'inspect')`.
 */
test('fixed native observer selects only current Root install ensure inspect and excludes environments and other builds', () => {
  const { ownedAdmissionControlAction: action } = admissionParsers(), build = '1'.repeat(64);
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: request: unknown; selectedBuild = build。
   * 结果：返回分支计算值（`"env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/pytho…`）。
   * Result: Return the branch-computed value (`"env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/pytho…`).
   * 验证场景 / Scenario: fixed native observer selects only current Root install ensure inspect and excludes environments and other builds
   * 协作入口 / Collaborators: `Buffer.from(JSON.stringify(request)).toString`, `Buffer.from`, `JSON.stringify`.
   */
  const command = (request: unknown, selectedBuild = build) => "env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S '/usr/local/lib/sakura-project-identity/" + selectedBuild + "/controller.py' '" + Buffer.from(JSON.stringify(request)).toString('base64') + "'";
  const ensure = { action: 'ensure', projectId: '0123456789abcdef', directory: '/srv/projects/owned', networkIsolation: 'private' };
  assert.equal(action(command({ action: 'install' }), build), 'install');
  assert.equal(action(command({ action: 'inspect', projectId: ensure.projectId }), build), 'inspect');
  assert.equal(action(command(ensure), build), 'ensure'); assert.equal(action(command({ ...ensure, expected: {} }), build), 'ensure');
  for (const request of [{ ...ensure, environment: { SECRET: 'not collected' } }, { action: 'install', environment: {} },
    { action: 'run', projectId: ensure.projectId }, { action: 'inspect', projectId: 'foreign' }, { ...ensure, directory: '/srv/\nsecret' }, null])
    assert.equal(action(command(request), build), null);
  assert.equal(action(command(ensure, '2'.repeat(64)), build), null); assert.equal(action(command(ensure) + '; extra', build), null);
  assert.throws(() => action(command(ensure), 'invalid'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pending bootstrap readiness still pins the new DMI and boot and refuses malformed or changed guest replies
 * 协作入口 / Collaborators: `randomUUID`, `vmId.toUpperCase`, `assert.equal`, `parseOwnedDesktopBootstrapReply`.
 * 检查边界 / Checked boundaries: `assert.equal(parseOwnedDesktopBootstrapReply(JSON.stringify(pending), vmId).cloudInitReady, false)`; `assert.equal(ready.cloudInitReady, true)`.
 */
test('pending bootstrap readiness still pins the new DMI and boot and refuses malformed or changed guest replies', () => {
  const vmId = randomUUID(), bootId = randomUUID();
  const pending = { version: 1, kind: 'owned-desktop-bootstrap', dmi: vmId.toUpperCase(), bootId, cloudInitReady: false };
  assert.equal(parseOwnedDesktopBootstrapReply(JSON.stringify(pending), vmId).cloudInitReady, false);
  const ready = parseOwnedDesktopBootstrapReply(JSON.stringify({ ...pending, cloudInitReady: true }), vmId, bootId);
  assert.equal(ready.cloudInitReady, true); assert.equal(ready.dmi, vmId);
  for (const reply of [
    { ...pending, dmi: randomUUID() }, { ...pending, bootId: randomUUID() }, { ...pending, bootId: 'invalid' },
    { ...pending, cloudInitReady: 'false' }, { ...pending, version: 2 }, { ...pending, kind: 'other' },
    { ...pending, extra: null }, { dmi: vmId, bootId, cloudInitReady: true }, null, [],
  ]) assert.throws(() => parseOwnedDesktopBootstrapReply(JSON.stringify(reply), vmId, bootId));
  assert.throws(() => parseOwnedDesktopBootstrapReply('{', vmId));
  assert.throws(() => parseOwnedDesktopBootstrapReply(' '.repeat(1025), vmId));
  for (const remaining of [1, 2, 14999, 15000, 15001, 180000]) {
    const timeout = ownedDesktopBootstrapTimeout(180000, 180000 - remaining);
    assert.ok(timeout > 0 && timeout <= 15000 && timeout <= remaining);
  }
  assert.throws(() => ownedDesktopBootstrapTimeout(180000, 180000));
  assert.throws(() => ownedDesktopBootstrapTimeout(180000, 180001));
  assert.throws(() => ownedDesktopBootstrapTimeout(Number.NaN, 0));
  const source = readFileSync(new URL('../scripts/smoke-project-desktop-identity.ts', import.meta.url), 'utf8');
  const catalog = source.slice(source.indexOf("await writeFile(join(fixture.root, 'machines.json')"), source.indexOf('machines = new Machines('));
  assert.ok(catalog.includes('bootstrapped: false') && !catalog.includes('bootstrapped: true'));
  const rekeyStart = source.indexOf('const rekey ='), rekeyEnd = source.indexOf('await bootstrapCommand(rekey,', rekeyStart);
  const rekey = source.slice(rekeyStart, rekeyEnd), syncAt = rekey.indexOf('/bin/sync\\n'), markerAt = rekey.indexOf("printf 'SAKURA_READY\\\\n' > /dev/ttyS0");
  assert.ok(rekey.includes('cat /sys/class/dmi/id/product_uuid') && rekey.includes('cat /proc/sys/kernel/random/boot_id'));
  assert.ok(syncAt > rekey.indexOf('mv /root/.ssh/authorized_keys.sakura-current-cow /root/.ssh/authorized_keys') && markerAt > syncAt);
  assert.ok(source.indexOf('assert.equal(proof.bootstrapReadiness.ready, true,') < rekeyStart);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bootstrap cloud snapshot binds the observed guest and bounded original ranges without asserting later or full-log stability
 * 协作入口 / Collaborators: `admissionParsers`, `Buffer.from`, `sha256`, `bytes.toString`.
 * 检查边界 / Checked boundaries: `assert.equal(parse(JSON.stringify(value), vmId, bootId).files[0].heldMetadataChanged, true)`; `assert.equal(parse(JSON.stringify(replaced), vmId, bootId).files[0].pathIdentityChanged, true)`.
 */
test('bootstrap cloud snapshot binds the observed guest and bounded original ranges without asserting later or full-log stability', () => {
  const { parseOwnedBootstrapCloudReply: parse } = admissionParsers();
  const vmId = '00000000-0000-4000-8000-000000000001', bootId = '00000000-0000-4000-8000-000000000002';
  const paths = ['/var/lib/cloud/data/status.json', '/var/lib/cloud/data/result.json', '/var/log/cloud-init.log', '/var/log/cloud-init-output.log'];
  const bytes = Buffer.from('observed tail'), metadata = { device: '8', inode: '12', uid: 0, gid: 4, mode: 416, type: 32768, links: 1, size: bytes.length, mtime: '20', ctime: '21' };
  const captured = { path: paths[0], status: 'captured', fdClosed: true, before: metadata, after: { ...metadata, size: metadata.size + 100, mtime: '22' },
    offset: 0, raw: { bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') }, originalFileComplete: true, fullFileStable: false, heldMetadataChanged: true, pathIdentityChanged: false };
  const value = { version: 1, kind: 'owned-desktop-bootstrap-cloud-readonly', maximumFileBytes: 65536, snapshotOnly: true,
    bindingBefore: { dmi: vmId, bootId }, bindingAfter: { dmi: vmId, bootId }, files: [captured, ...paths.slice(1).map(path => ({ path, status: 'missing' }))] };
  assert.equal(parse(JSON.stringify(value), vmId, bootId).files[0].heldMetadataChanged, true);
  const replaced = structuredClone(value); Object.assign(replaced.files[0], { pathIdentityChanged: true });
  assert.equal(parse(JSON.stringify(replaced), vmId, bootId).files[0].pathIdentityChanged, true);
  for (const change of [
    (v: any) => v.bindingBefore.dmi = bootId, (v: any) => v.bindingAfter.bootId = vmId,
    (v: any) => v.files[1].path = '/root/.ssh/authorized_keys', (v: any) => v.files.push(v.files[0]),
    (v: any) => v.files[0].before.uid = 1000, (v: any) => v.files[0].before.type = 40960,
    (v: any) => v.files[0].fdClosed = false, (v: any) => v.files[0].offset = 1,
    (v: any) => v.files[0].raw.sha256 = '0'.repeat(64), (v: any) => v.files[0].raw.bytes++,
    (v: any) => v.files[0].fullFileStable = true, (v: any) => v.snapshotOnly = false,
  ]) { const invalid = structuredClone(value); change(invalid); assert.throws(() => parse(JSON.stringify(invalid), vmId, bootId)); }
  const source = readFileSync(new URL('../scripts/smoke-project-desktop-identity.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const bootstrapCloudDiagnostic = String.raw`'), end = source.indexOf('`;', start + 42);
  const program = source.slice(start, end);
  assert.ok(program.includes('O_NOFOLLOW') && program.includes('count=before.st_size-offset') && !program.includes('subprocess'));
  assert.ok(source.includes('if (!proof.bootstrapDiagnostic)') && source.includes("role === 'rekey' ? 15000 : ownedDesktopBootstrapTimeout(until, Date.now())"));
  assert.ok(source.includes('serialWireBytesCaptured: false, completeSerialLog: false'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: fixed nft atomic fixture refuses occupied accounts, incomplete objects, changed handles and non-refusal exits
 * 协作入口 / Collaborators: `readFileSync`, `source.indexOf`, `assert.ok`, `source.slice`.
 * 检查边界 / Checked boundaries: `assert.ok(start >= 0 && end > start)`; `assert.ok(!program.includes('${'))`.
 */
test('fixed nft atomic fixture refuses occupied accounts, incomplete objects, changed handles and non-refusal exits', () => {
  const source = readFileSync(new URL('../scripts/smoke-project-desktop-identity.ts', import.meta.url), 'utf8');
  const prefix = 'const nftAtomicFixture = String.raw`', start = source.indexOf(prefix), end = source.indexOf('`;', start + prefix.length);
  assert.ok(start >= 0 && end > start);
  const program = source.slice(start + prefix.length, end); assert.ok(!program.includes('${'));
  const controller = readFileSync(new URL('../native/project-identity/controller.py', import.meta.url), 'utf8');
  // Execute only pure production/fixture parsers. No guest, process, account,
  // namespace or nft transaction runs in this model.
  const model = String.raw`
import ast,sys,json,re,hashlib,base64,copy
input_=json.load(sys.stdin)
names={'UUID','Refusal','refuse','identifier','egress_spec','egress_create_text','egress_json','egress_same_json','egress_objects','egress_table_text'}
def select(source,names):
 tree=ast.parse(source);nodes=[node for node in tree.body if isinstance(node,(ast.FunctionDef,ast.ClassDef)) and node.name in names or isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id in names for target in node.targets)]
 assert len(nodes)==len(names);return ast.Module(body=nodes,type_ignores=[])
ns={'re':re,'json':json};exec(compile(select(input_['controller'],names),'<production-pure-nft>','exec'),ns)
fixture_names={'digest','raw','invalid_third_statement','assert_unused_fixture','snapshot','unchanged','rejected'}
scope={'hashlib':hashlib,'base64':base64,'ns':ns};exec(compile(select(input_['program'],fixture_names),'<fixed-fixture-pure-nft>','exec'),scope)
value={'uid':59999,'registryId':'00000000-0000-4000-8000-000000000001','identityId':'00000000-0000-4000-8000-000000000002'}
project={'uid':20000};store={'reserved':{'20000':{'projectId':'0123456789abcdef','identityId':'00000000-0000-4000-8000-000000000003'}}};passwd=b'root:x:0:0:root:/root:/bin/sh\n';group=b'root:x:0:\n';checks=0
def refuse(fn):
 global checks
 try:fn()
 except (AssertionError,ns['Refusal']):checks+=1;return
 raise RuntimeError('invalid fixed fixture state accepted')
unused=scope['assert_unused_fixture'];unused(store,passwd,group,[],None,value,project)
refuse(lambda:unused(store,passwd,group,[],None,value,{'uid':59999}))
refuse(lambda:unused({'reserved':{'59999':{}}},passwd,group,[],None,value,project))
refuse(lambda:unused(store,passwd+b'foreign:x:59999:9::/:/bin/sh\n',group,[],None,value,project))
refuse(lambda:unused(store,passwd,group+b'foreign:x:59999:\n',[],None,value,project))
refuse(lambda:unused(store,passwd,group,[],{'unknown':True},value,project))
refuse(lambda:unused(store,passwd,group,[{'table':{'family':'inet','name':'skp_uid_59999'}}],None,value,project))
batch=ns['egress_create_text'](value);invalid=scope['invalid_third_statement'](batch,value)
assert len(invalid.splitlines())==3 and invalid.splitlines()[:2]==batch.splitlines()[:2] and b' skp_uid_59999 sakura_fixture_absent_chain meta skuid 59999 ' in invalid.splitlines()[2]
refuse(lambda:scope['invalid_third_statement'](b'create table inet skp_uid_59999 { chain output {} }\n',value))
name,expected=ns['egress_spec'](value);objects=copy.deepcopy(expected)
for index,(entry,handle) in enumerate(zip(objects,(10,20,30))):entry[next(iter(entry))]['handle']=handle
objects[0]['table'].pop('comment');marker=expected[0]['table']['comment']
human=('table inet '+name+' { # handle 10\n\tcomment "'+marker+'"\n\tchain output { # handle 20\n\t\ttype filter hook output priority 300; policy accept;\n\t\tmeta skuid 59999 drop comment "'+marker+'" # handle 30\n\t}\n}\n').encode()
def query(role,args,data=None,output=True):return json.dumps({'nftables':[{'metainfo':{'version':'1.0.6'}}]+objects}).encode() if output else human
scope['nft']=query;before=scope['snapshot'](value,'model');assert before['handles']==[10,20,30];scope['unchanged'](before,copy.deepcopy(before))
changed=copy.deepcopy(before);changed['handles'][0]=11;refuse(lambda:scope['unchanged'](before,changed))
changed=copy.deepcopy(before);changed['objects'][0]['table']['handle']=True;refuse(lambda:scope['unchanged'](before,changed))
complete=objects;objects=objects[:1];refuse(lambda:scope['snapshot'](value,'old-table-only'))
objects=copy.deepcopy(complete);objects[2]['rule']['expr'][0]['match']['right']=20000;refuse(lambda:scope['snapshot'](value,'foreign-uid'))
objects=copy.deepcopy(complete);human=human.replace(marker.encode(),b'foreign-marker');refuse(lambda:scope['snapshot'](value,'foreign-marker'))
report={'commands':[]};scope['report']=report
def rejection(role,args,data=None,output=True):
 report['commands'].append({'returncode':1,'stdin':scope['raw'](data)});raise ns['Refusal']('EGRESS_TOOL_FAILED',{'exit':1})
scope['nft']=rejection;assert scope['rejected']('expected',batch)['refusal']['detail']['exit']==1
for bad_exit in (0,-9):
 def no_refusal(role,args,data=None,output=True):
  report['commands'].append({'returncode':bad_exit,'stdin':scope['raw'](data)});raise ns['Refusal']('EGRESS_TOOL_FAILED',{'exit':bad_exit})
 scope['nft']=no_refusal;refuse(lambda:scope['rejected']('invalid-exit',batch))
assert checks==14;print('fixed nft fixture pure refusals passed:14; no nft transaction executed')
`;
  const python = process.env.SAKURA_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  assert.equal(execFileSync(python, ['-I', '-S', '-c', model], { input: JSON.stringify({ program, controller }), encoding: 'utf8', timeout: 10000, windowsHide: true }).trim(),
    'fixed nft fixture pure refusals passed:14; no nft transaction executed');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: fixed guest FD classifier distinguishes original management objects from legitimate mapped and GUI descriptors
 * 协作入口 / Collaborators: `readFileSync`, `source.indexOf`, `assert.ok`, `source.slice`.
 * 检查边界 / Checked boundaries: `assert.ok(start >= 0 && end > start)`; `assert.ok(!classifier.includes('${'))`.
 */
test('fixed guest FD classifier distinguishes original management objects from legitimate mapped and GUI descriptors', () => {
  const source = readFileSync(new URL('../scripts/smoke-project-desktop-identity.ts', import.meta.url), 'utf8');
  const prefix = 'const singleAppFdClassifier = String.raw`', start = source.indexOf(prefix), end = source.indexOf('`;', start + prefix.length);
  assert.ok(start >= 0 && end > start);
  const classifier = source.slice(start + prefix.length, end);
  assert.ok(!classifier.includes('${'));
  const model = String.raw`
import os,re,stat
# The model uses Linux fdinfo flags; its host may be Windows.
os.O_CLOEXEC=0o2000000
def row(number=4,target='/srv/projects/owned',device='9',inode='51',mount='7',kind=stat.S_IFDIR,flags='02300000'):
 return {'number':number,'target':target,'device':device,'inode':inode,'type':kind,'flags':flags,'mountId':mount,'infoInode':inode}
def obj(role='original-source',object_kind='directory',**fields):
 return {**row(**fields),'role':role,'kind':object_kind}
def check(value,objects,role='application'):return classify_descriptor(value,objects,role)
for value in [row(target='/dev/pts/3',kind=stat.S_IFCHR),row(target='socket:[51]',kind=stat.S_IFSOCK),row(target='pipe:[51]',kind=stat.S_IFIFO)]:
 assert check(value,[obj()])['forbiddenOriginalManagementObjects']==[]
assert check(row(),[obj()])['forbiddenOriginalManagementObjects']==['original-source']
mapped=check(row(mount='19'),[obj()]);assert mapped['sameObjectTuple']==['original-source'] and mapped['sameOriginalMount']==[]
namespace=obj(role='original-view',object_kind='namespace',target='mnt:[51]',kind=stat.S_IFREG)
assert check(row(target='mnt:[51]',kind=stat.S_IFREG),[namespace])['forbiddenOriginalManagementObjects']==['original-view']
pipe=obj(role='original-supervisor-stdin',object_kind='supervisor-input',target='pipe:[51]',kind=stat.S_IFIFO)
assert check(row(number=0,target='pipe:[51]',kind=stat.S_IFIFO),[pipe],'supervisor')['forbiddenOriginalManagementObjects']==[]
for role,number in [('application',0),('wm',4),('vnc',4),('owned-descendant',4),('supervisor',4)]:
 assert check(row(number=number,target='pipe:[51]',kind=stat.S_IFIFO),[pipe],role)['forbiddenOriginalManagementObjects']==['original-supervisor-stdin']
source_file=obj(role='fixed-native-source',object_kind='file',kind=stat.S_IFREG)
assert check(row(kind=stat.S_IFREG),[source_file])['forbiddenOriginalManagementObjects']==['fixed-native-source']
assert check(row(kind=stat.S_IFREG,mount='19'),[source_file])['forbiddenOriginalManagementObjects']==[]
unknown=check(row(target='pipe:[52]',inode='52',kind=stat.S_IFIFO),[pipe]);assert unknown['unattributedPipe'] and not unknown['sameOriginalMount']
for value in [{key:value for key,value in row().items() if key!='flags'},row(flags='89'),{**row(),'infoInode':'52'},row(target='net:[51]',kind=stat.S_IFREG)]:
 try:check(value,[namespace]);raise RuntimeError('invalid descriptor was accepted')
 except (AssertionError,KeyError):pass
print('fixed FD model passed:8')
`;
  const python = process.env.SAKURA_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  assert.equal(execFileSync(python, ['-I', '-S', '-c', classifier + model], { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim(), 'fixed FD model passed:8');
});

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: mode: 'vnc' | 'none' | 'text'; action: (url: string, errors: Error[]) => Promise<void>。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `server.once`, `server.on`, `server.address`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(address && typeof address !== 'string')`; `assert.equal(serverClosed, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
async function ownedRfbPeer(mode: 'vnc' | 'none' | 'text', action: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: url: string; errors: Error[]。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(url: string, errors: Error[]) => Promise<void>) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const peers = new Set<WebSocket>(), peerClosures: Promise<void>[] = [], errors: Error[] = [];
  let serverClosed = false;
  server.once('close', () => { serverClosed = true; });
  server.on('error', error => errors.push(error));
  server.on('connection', /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: socket。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `peers.add`, `peerClosures.push`, `socket.on`, `socket.send`.
   */
  socket => {
    peers.add(socket); peerClosures.push(new Promise<void>(done => socket.once('close', () => { peers.delete(socket); done(); })));
    socket.on('error', error => errors.push(error));
    if (mode === 'text') { socket.send('RFB 003.008\n'); return; }
    let step = 0;
    const challenge = Buffer.from(Array.from({ length: 16 }, (_, index) => index));
    // Independent OpenSSL DES-EDE3 with three equal keys is DES. RFB reverses
    // the bits of each password byte before the standard DES key schedule.
    const key = Buffer.from('Own3dPwd').map(byte => {
      let reversed = 0; for (let bit = 0; bit < 8; bit++) reversed = reversed * 2 + ((byte >> bit) & 1); return reversed;
    });
    const cipher = createCipheriv('des-ede3', Buffer.concat([key, key, key]), null); cipher.setAutoPadding(false);
    const response = Buffer.concat([cipher.update(challenge), cipher.final()]);
    socket.send(Buffer.from('RFB 003.')); socket.send(Buffer.from('008\n'));
    socket.on('message', /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: raw; binary。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `step`, `init[4]`, `init[5]`, `init[7]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('Unexpected owned RFB client packet')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `assert.equal`, `Buffer.from`, `value.toString`, `socket.send`.
     * 检查边界 / Checked boundaries: `assert.equal(binary, true)`; `assert.equal(value.toString(), 'RFB 003.008\n')`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    (raw, binary) => {
      try {
        assert.equal(binary, true); const value = Buffer.from(raw as Buffer);
        if (step === 0) {
          assert.equal(value.toString(), 'RFB 003.008\n'); socket.send(Buffer.from([1, mode === 'none' ? 1 : 2]));
        } else if (step === 1) {
          assert.equal(mode, 'vnc'); assert.deepEqual([...value], [2]);
          socket.send(challenge.subarray(0, 3)); socket.send(challenge.subarray(3));
        } else if (step === 2) {
          assert.equal(value.length, 16); const result = Buffer.alloc(4); result.writeUInt32BE(value.equals(response) ? 0 : 1);
          socket.send(result); if (!value.equals(response)) { step = 99; return; }
        } else if (step === 3) {
          assert.deepEqual([...value], [1]); const init = Buffer.alloc(24), name = Buffer.from('owned-protocol-unit');
          init.writeUInt16BE(1024); init.writeUInt16BE(768, 2); init[4] = 32; init[5] = 24; init[7] = 1;
          init.writeUInt32BE(name.length, 20); socket.send(init.subarray(0, 11)); socket.send(Buffer.concat([init.subarray(11), name]));
        } else if (step === 4) {
          assert.deepEqual([...value], [2, 0, 0, 1, 0, 0, 0, 0]);
        } else if (step === 5) {
          assert.deepEqual([...value], [3, 0, 0, 0, 0, 0, 0, 1, 0, 1]);
          const frame = Buffer.alloc(20); frame.writeUInt16BE(1, 2); frame.writeUInt16BE(1, 8); frame.writeUInt16BE(1, 10);
          Buffer.from([13, 77, 149, 255]).copy(frame, 16); socket.send(frame.subarray(0, 7)); socket.send(frame.subarray(7));
        } else throw new Error('Unexpected owned RFB client packet');
        step++;
      } catch (error) { errors.push(error as Error); socket.terminate(); }
    });
  });
  try {
    await new Promise<void>((done, reject) => { server.once('listening', done); server.once('error', reject); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    await action('ws://127.0.0.1:' + address.port, errors);
  } finally {
    for (const peer of peers) peer.terminate();
    await Promise.all(peerClosures);
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    assert.equal(serverClosed, true); assert.equal(peers.size, 0);
  }
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: owned RFB client authenticates fragmented binary frames and physically closes success and refusal
 * 协作入口 / Collaborators: `ownedRfbPeer`.
 */
test('owned RFB client authenticates fragmented binary frames and physically closes success and refusal', { timeout: 15000 }, async () => {
  await ownedRfbPeer('vnc', /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: url; errors。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: owned RFB client authenticates fragmented binary frames and physically closes success and refusal
   * 协作入口 / Collaborators: `probeOwnedDesktopRfb`, `assert.equal`, `assert.ok`, `Promise.all`.
   * 检查边界 / Checked boundaries: `assert.equal(refused.authenticationAccepted, false)`; `assert.equal(refused.authenticationResult, 1)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  async (url, errors) => {
    const closures: Promise<void>[] = [], states: boolean[] = [];
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: socket: WebSocket。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: owned RFB client authenticates fragmented binary frames and physically closes success and refusal
     * 协作入口 / Collaborators: `states.push`, `closures.push`.
     */
    const observe = (socket: WebSocket) => {
      const index = states.push(false) - 1; closures.push(new Promise<void>(done => socket.once('close', () => { states[index] = true; done(); })));
    };
    const refused = await probeOwnedDesktopRfb(url, 'WrongPwd', false, observe);
    assert.equal(refused.authenticationAccepted, false); assert.equal(refused.authenticationResult, 1); assert.equal(refused.physicallyClosed, true);
    const accepted = await probeOwnedDesktopRfb(url, 'Own3dPwd', true, observe);
    assert.equal(accepted.authenticationAccepted, true); assert.equal(accepted.framebuffer.actualPixelBytes, 4);
    assert.equal(accepted.onlyVncPasswordAuthentication, true); assert.equal(accepted.physicallyClosed, true);
    assert.ok(accepted.binaryFrames > 6 && accepted.binaryBytes > 60); await Promise.all(closures);
    assert.deepEqual(states, [true, true]); assert.deepEqual(errors, []);
  });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: owned RFB client refuses unauthenticated and text transports and physically closes both
 * 协作入口 / Collaborators: `ownedRfbPeer`.
 */
test('owned RFB client refuses unauthenticated and text transports and physically closes both', { timeout: 15000 }, async () => {
  for (const mode of ['none', 'text'] as const) await ownedRfbPeer(mode, async (url, errors) => {
    let physicallyClosed = false;
    await assert.rejects(probeOwnedDesktopRfb(url, 'Own3dPwd', true, socket => socket.once('close', () => { physicallyClosed = true; })));
    assert.equal(physicallyClosed, true); assert.deepEqual(errors, []);
  });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: test-only DMI UUID preserves production argv and rejects a supplied or invalid UUID
 * 协作入口 / Collaborators: `assert.deepEqual`, `ownedDesktopQemuArguments`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(ownedDesktopQemuArguments(original, id), [...original, '-uuid', id])`; `assert.deepEqual(original, ['-name', 'sakura-owned', '-machine', 'q35', '-accel', 'tcg,thread=single'])`.
 */
test('test-only DMI UUID preserves production argv and rejects a supplied or invalid UUID', () => {
  const original = ['-name', 'sakura-owned', '-machine', 'q35', '-accel', 'tcg,thread=single'];
  const id = '71d1b307-c853-4795-ae3b-8882b41d7f38';
  assert.deepEqual(ownedDesktopQemuArguments(original, id), [...original, '-uuid', id]);
  assert.deepEqual(original, ['-name', 'sakura-owned', '-machine', 'q35', '-accel', 'tcg,thread=single']);
  assert.throws(() => ownedDesktopQemuArguments([...original, '-uuid', id], id));
  assert.throws(() => ownedDesktopQemuArguments(original, 'other'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real SSH2 client with no socket records non-creation without fabricating close
 * 协作入口 / Collaborators: `client.on`, `closeOwnedDesktopSshClient`, `assert.equal`, `Reflect.get`.
 * 检查边界 / Checked boundaries: `assert.equal(result, 'not-created')`; `assert.equal(state.notCreated, true)`.
 */
test('real SSH2 client with no socket records non-creation without fabricating close', async () => {
  const client = new ssh2.Client(), state = { ready: false, closed: false, notCreated: false };
  client.on('close', () => { state.closed = true; });
  const result = await closeOwnedDesktopSshClient(client, state, new Promise(() => {}), 100);
  assert.equal(result, 'not-created'); assert.equal(state.notCreated, true);
  assert.equal(state.closed, false); assert.equal(Reflect.get(client, '_sock'), undefined);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real SSH2 pre-admission TCP connection waits for physical client and socket closure
 * 协作入口 / Collaborators: `createServer`, `client.once`, `client.on`, `client.connect`.
 * 检查边界 / Checked boundaries: `assert.ok(Reflect.get(client, '_sock'))`; `assert.equal(await closeOwnedDesktopSshClient(client, state, physicalClose, 2000), 'closed')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('real SSH2 pre-admission TCP connection waits for physical client and socket closure', { timeout: 10000 }, async () => {
  const peers = new Set<Socket>();
  let accepted!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const connection = new Promise<void>((done) => { accepted = done; });
  const server = createServer((socket) => {
    peers.add(socket); socket.on('error', () => {}); socket.once('close', () => peers.delete(socket));
    socket.write('SSH-2.0-owned-fixture\r\n'); accepted();
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const client = new ssh2.Client(), state = { ready: false, closed: false, notCreated: false };
  client.once('ready', () => { state.ready = true; });
  const physicalClose = new Promise<void>((done) => client.once('close', () => { state.closed = true; done(); }));
  client.on('error', () => {});
  try {
    client.connect({ host: '127.0.0.1', port: (server.address() as { port: number }).port, username: 'owned-fixture', readyTimeout: 2000 });
    assert.ok(Reflect.get(client, '_sock')); await connection;
    assert.equal(await closeOwnedDesktopSshClient(client, state, physicalClose, 2000), 'closed');
    assert.equal(state.closed, true); assert.equal(state.ready, false); assert.equal(state.notCreated, false);
    assert.equal(Reflect.get(client, '_sock').destroyed, true);
  } finally {
    client.destroy(); for (const peer of peers) peer.destroy(); await physicalClose;
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: guard process keeps stdin open until its actual admission request and physically closes
 * 协作入口 / Collaborators: `process.cwd`, `fixture.raw`, `assert.equal`, `child.child.stdin!.end`.
 * 检查边界 / Checked boundaries: `assert.equal(child.child.stdin!.writableEnded, false)`; `assert.equal(result.stdout.toString(), 'EXACT_ADMISSION_REQUEST')`.
 */
test('guard process keeps stdin open until its actual admission request and physically closes', { skip: process.platform !== 'win32' }, async () => {
  const fixture = new LinuxDesktopOwnedFixture(process.cwd());
  const child = fixture.raw(process.execPath, ['-e', "process.stdin.once('data',bytes=>{process.stdout.write(bytes);process.stdin.destroy();})"], 'delayed-guard-model');
  assert.equal(child.child.stdin!.writableEnded, false);
  child.child.stdin!.end('EXACT_ADMISSION_REQUEST');
  const result = await child.done;
  assert.equal(result.stdout.toString(), 'EXACT_ADMISSION_REQUEST');
  assert.deepEqual(result.entry.exit, { code: 0, signal: null });
  assert.deepEqual(result.entry.close, result.entry.exit);
  assert.ok(result.entry.stdinClosed && result.entry.stdoutClosed && result.entry.stderrClosed);
  assert.equal(fixture.children.size, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: owned Linux desktop receipt uses an exact log role and rejects path escapes
 * 协作入口 / Collaborators: `assert.equal`, `desktopFixtureLogPath`, `assert.throws`, `id.toUpperCase`.
 * 检查边界 / Checked boundaries: `assert.equal(desktopFixtureLogPath(root, id, 'stdout'), root + '\\logs\\' + id + '.stdout.bin')`; `assert.equal(desktopFixtureLogPath(root, id, 'stderr'), root + '\\logs\\' + id + '.stderr.bin')`.
 */
test('owned Linux desktop receipt uses an exact log role and rejects path escapes', () => {
  const root = 'E:\\OwnedFixture\\linux-desktop-identity-cow-aabbccdd';
  const id = '71d1b307-c853-4795-ae3b-8882b41d7f38';
  assert.equal(desktopFixtureLogPath(root, id, 'stdout'), root + '\\logs\\' + id + '.stdout.bin');
  assert.equal(desktopFixtureLogPath(root, id, 'stderr'), root + '\\logs\\' + id + '.stderr.bin');
  for (const invalid of [root + '\\..\\oldFixture', root + '\\.', 'E:relative', '\\\\host\\share', 'E:/Alias'])
    assert.throws(() => desktopFixtureLogPath(invalid, id, 'stdout'));
  for (const invalid of ['..\\oldFixture\\log', id + ':stream', id + '\\x', id.toUpperCase(), 'not-a-uuid'])
    assert.throws(() => desktopFixtureLogPath(root, invalid, 'stdout'));
  assert.throws(() => desktopFixtureLogPath(root, id, 'other' as 'stdout'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: actual PowerShell guard inventory refuses an unheld initial entry, disappearance and role change
 * 协作入口 / Collaborators: `readFileSync`, `source.indexOf`, `assert.ok`, `source.slice`.
 * 检查边界 / Checked boundaries: `assert.ok(start > 0 && end > start)`; `assert.equal(result, 'LOCKED_INVENTORY_MODEL_PASS:6')`.
 */
test('actual PowerShell guard inventory refuses an unheld initial entry, disappearance and role change', { skip: process.platform !== 'win32' }, () => {
  const source = readFileSync(new URL('../scripts/linux-desktop-owned-fixture.ps1', import.meta.url), 'utf8');
  const start = source.indexOf("Add-Type -TypeDefinition @'"), end = source.indexOf("'@", start);
  assert.ok(start > 0 && end > start);
  // Execute the same compiled inventory membership routine. No native handles,
  // source files, fixture directories, guest or process Job are opened here.
  const model = source.slice(start, end + 2) + String.raw`
$parent='E:\OwnedModel'
$held=New-Object CowReadGuard+Held
$held.Path=$parent+'\catalog.json';$held.Directory=$false;$held.Source=$true
$stat=New-Object CowReadGuard+Info;$stat.Attributes=32;$held.Initial=$stat
[CowReadGuard]::All.Add($held.Path,$held)
[CowReadGuard]::VerifyInventory($parent,[string[]]@($held.Path),[uint32[]]@(32))
$rejected=0
foreach($case in @(
 @{paths=[string[]]@($held.Path,$parent+'\new-unlocked');attributes=[uint32[]]@(32,32)},
 @{paths=[string[]]@();attributes=[uint32[]]@()},
 @{paths=[string[]]@($held.Path);attributes=[uint32[]]@(16)},
 @{paths=[string[]]@($held.Path);attributes=[uint32[]]@(1056)},
 @{paths=[string[]]@($held.Path,$held.Path);attributes=[uint32[]]@(32,32)},
 @{paths=[string[]]@($parent+'\..\oldFixture');attributes=[uint32[]]@(32)}
)){
 try{[CowReadGuard]::VerifyInventory($parent,$case.paths,$case.attributes);throw 'MODEL_ACCEPTED_UNHELD'}
 catch{if($_.Exception.Message.Contains('MODEL_ACCEPTED_UNHELD')){throw};$rejected++}
}
if($rejected -ne 6){throw 'MODEL_REJECTION_COUNT'}
[Console]::Write('LOCKED_INVENTORY_MODEL_PASS:6')
`;
  const result = execFileSync(join(process.env.WINDIR!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; & ([ScriptBlock]::Create([Console]::In.ReadToEnd()))"],
    { input: model, windowsHide: true, timeout: 30000, encoding: 'utf8', env: { ...process.env, TEMP: existsSync(desktopFixtureParent) ? desktopFixtureParent : tmpdir(), TMP: existsSync(desktopFixtureParent) ? desktopFixtureParent : tmpdir() } });
  assert.equal(result, 'LOCKED_INVENTORY_MODEL_PASS:6');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: held owned root permits product atomic replacement, while source content and root renaming remain denied
 * 协作入口 / Collaborators: `readFileSync`, `source.indexOf`, `existsSync`, `tmpdir`.
 * 检查边界 / Checked boundaries: `assert.equal(result, 'OWNED_CAS_SOURCE_READONLY_ROOT_PIN_PASS')`.
 */
test('held owned root permits product atomic replacement, while source content and root renaming remain denied', { skip: process.platform !== 'win32' }, () => {
  const source = readFileSync(new URL('../scripts/linux-desktop-owned-fixture.ps1', import.meta.url), 'utf8');
  const start = source.indexOf("Add-Type -TypeDefinition @'"), end = source.indexOf("'@", start);
  const modelParent = existsSync(desktopFixtureParent) ? desktopFixtureParent : tmpdir();
  const directory = join(modelParent, 'linux-desktop-guard-model-' + randomUUID());
  const model = source.slice(start, end + 2) + `\n$root=${JSON.stringify(directory).replace(/^"|"$/g, "'").replaceAll('\\\\', '\\')}\n` + String.raw`
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
[CowReadGuard]::NewDirectory($root,('O:'+ $sid +'G:'+ $sid +'D:P(A;OICI;FA;;;'+$sid+')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'))
[CowReadGuard]::Open($root,$true,$false)|Out-Null
try {
 [IO.File]::WriteAllText($root+'\machines.json','original')
 [IO.File]::WriteAllText($root+'\machines.tmp','replacement')
 [IO.File]::Replace($root+'\machines.tmp',$root+'\machines.json',$root+'\machines.backup')
 if([IO.File]::ReadAllText($root+'\machines.json') -cne 'replacement'){throw 'MODEL_ATOMIC_REPLACE'}
 [CowReadGuard]::Open($root+'\machines.json',$false,$true)|Out-Null
 $writeRejected=$false
 try{[IO.File]::WriteAllText($root+'\machines.json','forbidden')}catch{$writeRejected=$true}
 if(-not $writeRejected){throw 'MODEL_SOURCE_WRITE_ACCEPTED'}
 $renameRejected=$false
 try{[IO.Directory]::Move($root,$root+'-moved')}catch{$renameRejected=$true}
 if(-not $renameRejected){throw 'MODEL_ROOT_RENAME_ACCEPTED'}
 [CowReadGuard]::Check($root)
 [Console]::Write('OWNED_CAS_SOURCE_READONLY_ROOT_PIN_PASS')
}finally{[CowReadGuard]::Close()}
`;
  const result = execFileSync(join(process.env.WINDIR!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; & ([ScriptBlock]::Create([Console]::In.ReadToEnd()))"],
    { input: model, windowsHide: true, timeout: 30000, encoding: 'utf8', env: { ...process.env, TEMP: modelParent, TMP: modelParent } });
  assert.equal(result, 'OWNED_CAS_SOURCE_READONLY_ROOT_PIN_PASS');
});
