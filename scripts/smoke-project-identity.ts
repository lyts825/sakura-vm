/** 烟雾验收：验证持久项目账户、原生运行票据、目录/网络身份及关闭证据。
 * Smoke acceptance for persistent project accounts, native tickets, directory/network identity and shutdown evidence. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const distro = process.argv[2] || 'alpine';
const images: Record<string, string> = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' };
assert.ok(images[distro], 'unsupported smoke distro');
const ownedParent = resolve('.data/project-identity-test-temp');
await mkdir(ownedParent, { recursive: true });
process.env.TEMP = ownedParent; process.env.TMP = ownedParent;
const directory = process.argv[3] ? await realpath(resolve(process.argv[3])) :
  await mkdtemp(join(ownedParent, 'sakura-project-identity-'));
assert.equal(dirname(directory), await realpath(ownedParent));
assert.match(basename(directory), /^sakura-project-identity-/);
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images', images[distro]);
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { ProjectIdentities, projectIdentitySources, projectIdentityRunSchema } = await import('../server/project-identity.ts');
const { quote } = await import('../server/files.ts');
// Retain each previous native proof and its exact three-file source bundle.
// A newer run must never relabel evidence produced by an older launcher.
try {
  const previousRaw = await readFile(join(directory, 'project-identity-evidence.json'));
  const previous = JSON.parse(previousRaw.toString('utf8'));
  assert.match(previous.build, /^[a-f0-9]{64}$/);
  const archive = join(directory, 'source-bundle-' + previous.build);
  await mkdir(archive, { recursive: true });
  for (const name of ['protocol.h', 'launcher.c', 'controller.py', 'manifest.json']) {
    try { await writeFile(join(archive, name), await readFile(join(directory, 'source-bundle', name)), { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  try { await writeFile(join(directory, 'project-identity-evidence.before-network-' + previous.build + '.json'), previousRaw, { flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
// The smoke has an explicit development source directory. Its owned snapshot
// survives an unrelated production build replacing .sakura-server; production
// API operation continues to require the packaged manifest without a fallback.
const sourceDirectory = join(directory, 'source-bundle');
await mkdir(sourceDirectory, { recursive: true });
const aggregate = createHash('sha256'), sourceFiles = [];
for (const name of ['protocol.h', 'launcher.c', 'controller.py']) {
  const bytes = await readFile(resolve('native/project-identity', name));
  aggregate.update(name).update(bytes); sourceFiles.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  await writeFile(join(sourceDirectory, name), bytes);
}
await writeFile(join(sourceDirectory, 'manifest.json'), JSON.stringify({ version: 1, build: aggregate.digest('hex'), files: sourceFiles }));
const source = await projectIdentitySources(sourceDirectory);
let machines: InstanceType<typeof Machines> | undefined, vmId = '';
const checks: string[] = [];
let passed = false, failure = '', bootId = '', secondBootId = '';
let verifiedLegacyBuild = '';
const projectRoot = '/srv/sakura-identity-fixture';
const betaId = '1111111111111111';
console.log(JSON.stringify({ fixture: directory, distro, build: source.manifest.build }));
/** 运行具名异步断言，成功才保存并输出 PASS；异常向外传播，不记录通过。
 * Run named asynchronous assertions, retaining/printing PASS only on success and propagating failures. */
async function check(name: string, work: () => Promise<void>) {
  await work(); checks.push(name); console.log('PASS ' + name);
}
/** 在本验收夹具的指定实例中执行传入脚本，使用函数中的超时约束并断言退出码为零，返回捕获的标准输出；失败附来宾诊断而不被当作空输出。
 * Execute the supplied script in the specified fixture VM under this function’s timeout, assert exit code zero and return captured stdout; failures include guest diagnostics rather than become empty output. */
async function guest(command: string, timeout = 30000) {
  const result = await machines!.exec(vmId, command, timeout);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
/** 以清空环境的隔离 Python 执行固定 heredoc 源码，使用调用方期限，避免用户 site 和环境干扰权限观测。
 * Run fixed heredoc source with clean-environment isolated Python under the caller’s deadline, excluding user site/environment interference. */
async function python(script: string, timeout = 30000) {
  return await guest(`env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S - <<'SAKURA_IDENTITY_FIXTURE'\n${script}\nSAKURA_IDENTITY_FIXTURE`, timeout);
}
/** 五分钟内等待原自有实例运行，失败保留启动日志并报告 lastError。
 * Await the original owned VM within five minutes, preserving boot logs/lastError on failure. */
async function ready() {
  const deadline = Date.now() + 300000;
  while (machines!.state(vmId) === 'starting' && Date.now() < deadline) await delay(200);
  const state = machines!.state(vmId);
  if (state !== 'running') await writeFile(join(directory, 'boot-failure.log'), machines!.logs.get(vmId) || '');
  assert.equal(state, 'running', (await machines!.view(vmId)).lastError || 'owned VM did not become ready');
}
try {
  machines = new Machines(await createRuntime());
  await machines.init();
  const records = await machines.list();
  if (process.argv[3]) {
    assert.equal(records.length, 1, 'owned fixture must contain exactly its one VM');
    const record = records[0];
    assert.equal(record.name, 'project-identity-' + distro); assert.equal(record.distro, distro);
    assert.equal(machines.state(record.id), 'stopped'); vmId = record.id;
    try {
      const evidence = JSON.parse(await readFile(join(directory, 'project-identity-evidence.json'), 'utf8'));
      assert.equal(evidence.vmId, vmId); assert.equal(evidence.distro, distro);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  } else {
    assert.equal(records.length, 0);
    vmId = (await machines.create({ name: 'project-identity-' + distro, distro,
      memoryMiB: distro === 'alpine' ? 768 : 1024, cpus: 2, diskGiB: 8, accelerator: 'auto', forwards: [] })).id;
  }
  console.log(JSON.stringify({ fixture: directory, vmId, distro }));
  await machines.start(vmId); await ready();
  await guest('/bin/sync');
  const identities = new ProjectIdentities(machines, { sourceDirectory });
  const payloadFixture = projectRoot + '/payload-fixture.py';
  /** 用生产 identity.input 生成命令与分离正文，再经真实 execInput 返回完整结果，供畸形帧/票据拒绝核验。
   * Build command/separate body through production identity.input and return real execInput results for malformed-frame/receipt denial checks. */
  async function raw(identity: Parameters<typeof identities.input>[0], run: Parameters<typeof identities.input>[1], execution: Parameters<typeof identities.input>[2]) {
    const plan = identities.input(identity, run, execution);
    return await machines!.execInput(vmId, plan.command, plan.input);
  }
  await check('verified root installation and clean package environment', async () => {
    assert.equal(await identities.install(vmId), source.manifest.build);
    // Recover only zero-byte remnants of this owned fixture's interrupted
    // development installs. Production installation never sweeps old paths.
    await python(`import os,stat,re\nfor n in os.listdir('/tmp'):\n if not re.fullmatch(r'\.sakura-project-identity-[a-f0-9-]{36}',n): continue\n p='/tmp/'+n; i=os.lstat(p); assert stat.S_ISDIR(i.st_mode) and i.st_uid==0 and stat.S_IMODE(i.st_mode)==0o700\n entries=os.listdir(p); assert set(entries).issubset({'controller.py','protocol.h','launcher.c','manifest.json'})\n for f in entries:\n  i=os.lstat(p+'/'+f); assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and i.st_size==0\n  os.unlink(p+'/'+f)\n d=os.open(p,os.O_DIRECTORY); os.fsync(d); os.close(d); os.rmdir(p)\nd=os.open('/tmp',os.O_DIRECTORY); os.fsync(d); os.close(d)`);
    const info = JSON.parse(await python(`import json,os,stat\np=${JSON.stringify(source.directory + '/launch')}\ni=os.lstat(p)\nprint(json.dumps({'uid':i.st_uid,'mode':stat.S_IMODE(i.st_mode),'stages':[n for n in os.listdir('/tmp') if n.startswith('.sakura-project-identity-')]}))`));
    assert.equal(info.uid, 0); assert.equal(info.mode, 0o4755);
    assert.deepEqual(info.stages, []);
  });
  // Reset only explicitly owned fixture directories after a previous failed
  // attempt. New evidence uses persistent identities rather than deleting them.
  await python(`import os,stat\nroot=${JSON.stringify(projectRoot)}\ntry: os.mkdir(root,0o755)\nexcept FileExistsError: pass\ni=os.lstat(root)\nassert stat.S_ISDIR(i.st_mode) and i.st_uid==0\nfor n in ['alpha','beta']:\n try: os.mkdir(root+'/'+n,0o700)\n except FileExistsError: pass`);
  await machines.writeGuestFile(vmId, payloadFixture, await readFile(resolve('native/project-identity/payload-fixture.py'), 'utf8'));
  await guest('if ! ip netns exec sk-default true >/dev/null 2>&1; then ip netns add sk-default; fi; ip -n sk-default link set lo up');
  let alpha = await identities.inspect(vmId, 'default');
  if (alpha?.phase === 'active' && alpha.directory !== projectRoot + '/alpha') {
    assert.match(alpha.directory, /^\/srv\/sakura-identity-fixture\/applied-rebind-[a-f0-9-]{36}$/);
    // Recover only this smoke's explicit directory rebind after an interrupted
    // case. The ordinary launcher still verifies the account and original inode.
    await python(`import os,stat\ni=os.lstat(${JSON.stringify(projectRoot + '/alpha')});assert stat.S_ISDIR(i.st_mode) and i.st_uid==${alpha.uid} and i.st_gid==${alpha.gid}`);
    alpha = await identities.rebind(vmId, alpha, { directory: projectRoot + '/alpha', networkIsolation: alpha.networkIsolation });
  }
  await check('account intent blocks launch and preserves directory permissions', /** 验证 ensure 先固定账户 intent 且不擅自迁移 root 目录，未完整身份不能 prepare；仅在自有夹具显式调整目录后重试，UID/identityId 保持原预留并转 active。
 * Prove ensure fixes account intent without silently migrating a root-owned directory and incomplete identity cannot prepare; after explicit owned-fixture directory changes, retry retains reserved UID/identityId and becomes active. */ async () => {
    if (!alpha) {
      await assert.rejects(identities.ensure(vmId, { projectId: 'default', directory: projectRoot + '/alpha', networkIsolation: 'private' }), /DIRECTORY_MIGRATION_REQUIRED/);
      alpha = await identities.inspect(vmId, 'default');
      assert.equal(alpha!.phase, 'intent');
      const info = JSON.parse(await python(`import json,os,stat\np=${JSON.stringify(projectRoot + '/alpha')}\ni=os.lstat(p)\nprint(json.dumps([i.st_uid,stat.S_IMODE(i.st_mode)]))`));
      assert.deepEqual(info, [0, 0o700]);
      await assert.rejects(identities.prepare(vmId, alpha!), /IDENTITY_INCOMPLETE/);
      await python(`import os\np=${JSON.stringify(projectRoot + '/alpha')}\nos.chown(p,${alpha!.uid},${alpha!.gid})\nos.chmod(p,0o700)`);
    } else if (alpha.phase === 'intent') {
      await python(`import os\np=${JSON.stringify(projectRoot + '/alpha')}\ni=os.stat(p); assert i.st_uid in [0,${alpha.uid}]\nos.chown(p,${alpha.uid},${alpha.gid}); os.chmod(p,0o700)`);
    }
    const prior = alpha!;
    alpha = await identities.ensure(vmId, { projectId: 'default', directory: prior.directory, networkIsolation: 'private' });
    assert.equal(alpha.identityId, prior.identityId); assert.equal(alpha.uid, prior.uid);
    assert.equal(alpha.phase, 'active');
  });
  let beta = await identities.inspect(vmId, betaId);
  if (!beta) {
    await assert.rejects(identities.ensure(vmId, { projectId: betaId, directory: projectRoot + '/beta', networkIsolation: 'host' }), /DIRECTORY_MIGRATION_REQUIRED/);
    beta = await identities.inspect(vmId, betaId);
    await python(`import os\np=${JSON.stringify(projectRoot + '/beta')}\nos.chown(p,${beta!.uid},${beta!.gid})\nos.chmod(p,0o700)`);
  } else if (beta.phase === 'intent') {
    await python(`import os\np=${JSON.stringify(projectRoot + '/beta')}\ni=os.stat(p); assert i.st_uid in [0,${beta.uid}]\nos.chown(p,${beta.uid},${beta.gid}); os.chmod(p,0o700)`);
  }
  beta = await identities.ensure(vmId, { projectId: betaId, directory: beta!.directory, networkIsolation: 'host' });
  await check('ACK retries reuse complete UUID UID GID and distinct home', async () => {
    const retry = await identities.ensure(vmId, { projectId: 'default', directory: alpha!.directory, networkIsolation: 'private' });
    assert.deepEqual(retry, alpha); assert.notEqual(alpha!.uid, beta!.uid); assert.notEqual(alpha!.home, beta!.home);
    await assert.rejects(identities.ensure(vmId, { projectId: 'default', directory: alpha!.directory, networkIsolation: 'private' },
      { registryId: alpha!.registryId, identityId: randomUUID(), revision: alpha!.revision }), /IDENTITY_STALE/);
  });
  await check('readonly ticket query makes no installation or authority writes and rejects missing images absent and old-build receipts', /** 以树摘要证明 runReadonly 不写状态、不安装缺失 controller，也拒绝陌生 runId/其他 build；恢复所有注入后关闭原票据并确认邻项目未变。
 * Use tree digests to prove runReadonly does not write state/install missing controllers and rejects unknown runIds/foreign builds; restore injected changes, close the original receipt and verify the neighbor unchanged. */ async () => {
    const run = await identities.prepare(vmId, alpha!);
    const controller = source.directory + '/controller.py', parked = controller + '.owned-' + randomUUID();
    /** 摘要身份状态树的路径/权限/所有者/inode/时间和内容，并列出暂存目录，用于拒绝操作无副作用比较。
     * Hash identity-state paths/permissions/owners/inodes/timestamps/content and enumerate staging directories for denial-side-effect comparisons. */
    const snapshot = async () => await python(`import hashlib,json,os,stat\nh=hashlib.sha256()\nfor root in ['/var/lib/sakura/project-identities','/run/sakura-project-identities',${JSON.stringify(source.directory)}]:\n for p,dirs,files in os.walk(root):\n  for name in sorted(dirs+files):\n   path=p+'/'+name;i=os.lstat(path);h.update(json.dumps([path,i.st_mode,i.st_uid,i.st_gid,i.st_ino,i.st_size,i.st_mtime_ns],separators=(',',':')).encode())\n   if stat.S_ISREG(i.st_mode): h.update(open(path,'rb').read())\nprint(json.dumps({'hash':h.hexdigest(),'stages':sorted(n for n in os.listdir('/tmp') if n.startswith('.sakura-project-identity-'))}))`);
    const before = await snapshot();
    assert.deepEqual(await identities.runReadonly(vmId, alpha!, run.runId), run);
    assert.equal(await snapshot(), before);
    await assert.rejects(identities.runReadonly(vmId, alpha!, randomUUID()), /RECORD_ABSENT/);
    assert.equal(await snapshot(), before);
    try {
      await python(`import os\nos.rename(${JSON.stringify(controller)},${JSON.stringify(parked)})`);
      await assert.rejects(identities.runReadonly(vmId, alpha!, run.runId), /未返回可核对回执/);
      assert.equal(await python(`import os\nprint(os.path.exists(${JSON.stringify(controller)}))`), 'False');
    } finally { await python(`import os\nos.rename(${JSON.stringify(parked)},${JSON.stringify(controller)})`); }
    /** 在正式控制器锁内修改本夹具运行的 build 字段，制造旧版本票据场景，finally 释放锁描述符。
     * Modify the fixture run build under the production controller lock to create stale-build receipts, releasing the lock descriptor in finally. */
    const writeBuild = async (build: string) => await python(`import importlib.util,os\nspec=importlib.util.spec_from_file_location('owned',${JSON.stringify(controller)});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.sources();lock=m.initialize()\ntry:\n r=m.run_read(${JSON.stringify(run.runId)});r['build']=${JSON.stringify(build)};m.run_write(r)\nfinally: os.close(lock)`);
    try {
      await writeBuild('f'.repeat(64));
      await assert.rejects(identities.runReadonly(vmId, alpha!, run.runId), /其他启动器构建/);
    } finally { await writeBuild(run.build); await identities.stop(vmId, alpha!, run); }
    assert.deepEqual(await identities.inspect(vmId, betaId), beta);
  });
  await check('migration latch blocks fresh inherited and retried runs until the full current identity is applied', /** 逐迁移 latch 阶段和非法形状/权限/身份验证 native prepare 与继承正文均拒绝；精确 applied 才放行，停止既有票据仍允许，finally 清理自有 latch。
 * Test pending latch phases and invalid shape/permissions/identity against native prepare/inherited body rejection; allow only exact applied state, retain existing-ticket stop access and clean the owned latch in finally. */ async () => {
    const latchDirectory = '/var/lib/sakura/project-directory-migrations/default';
    const latch = { version: 1, projectId: 'default', planId: randomUUID(), sha256: 'a'.repeat(64), phase: 'applying', identity: alpha! };
    const saved = await identities.prepare(vmId, alpha!);
    /** 在控制器初始化锁内发布本场景迁移 latch，绑定指定阶段/身份或显式正文，用于门控拒绝；finally 释放锁。
     * Publish the scenario migration latch under the controller initialization lock with supplied phase/identity or explicit body for gate-denial checks, releasing the lock in finally. */
    const writeLatch = async (value: unknown) => await python(`import importlib.util,json,os\nspec=importlib.util.spec_from_file_location('owned',${JSON.stringify(source.directory + '/controller.py')});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.sources()\nlock=m.initialize()\ntry:\n m.make_directory(m.MIGRATIONS);m.make_directory(${JSON.stringify(latchDirectory)});m.json_write(${JSON.stringify(latchDirectory + '/latch.json')},json.loads(${JSON.stringify(JSON.stringify(value))}))\nfinally: os.close(lock)`);
    try {
      for (const phase of ['applying', 'failed', 'directory-applied']) {
        await writeLatch({ ...latch, phase });
        await assert.rejects(identities.prepare(vmId, alpha!), /DIRECTORY_MIGRATION_PENDING/);
        if (phase === 'applying') {
          await assert.rejects(identities.prepare(vmId, alpha!, { runId: saved.runId }), /DIRECTORY_MIGRATION_PENDING/);
          await identities.stop(vmId, alpha!, saved);
        }
        assert.deepEqual(await identities.inspect(vmId, 'default'), alpha);
        assert.deepEqual(await identities.ensure(vmId, { projectId: 'default', directory: alpha!.directory, networkIsolation: alpha!.networkIsolation }), alpha);
        const plan = await identities.inheritedInput(alpha!, { command: 'touch migration-must-not-run' }, { runId: randomUUID() });
        const refused = await machines!.execInput(vmId, plan.command, plan.input);
        assert.equal(refused.code, 1); assert.match(refused.stdout, /DIRECTORY_MIGRATION_PENDING/);
      }
      await writeLatch({ ...latch, unknown: true });
      await assert.rejects(identities.prepare(vmId, alpha!), /DIRECTORY_MIGRATION_INVALID/);
      await writeLatch({ ...latch, identity: { ...alpha!, uid: beta!.uid, gid: beta!.gid } });
      await assert.rejects(identities.prepare(vmId, alpha!), /DIRECTORY_MIGRATION_IDENTITY/);
      await writeLatch({ ...latch, phase: 'applied', identity: { ...alpha!, revision: alpha!.revision + 1 } });
      await assert.rejects(identities.prepare(vmId, alpha!), /DIRECTORY_MIGRATION_IDENTITY/);
      await writeLatch({ ...latch, phase: 'applied' });
      await python(`import os\nos.chmod(${JSON.stringify(latchDirectory + '/latch.json')},0o644)`);
      await assert.rejects(identities.prepare(vmId, alpha!), /RECORD_PERMISSIONS/);
      await python(`import os\nos.chmod(${JSON.stringify(latchDirectory + '/latch.json')},0o600)`);
      const ready = await identities.prepare(vmId, alpha!);
      assert.equal((await identities.exec(vmId, alpha!, ready, { command: "printf 'OWNED_MIGRATION_READY\\n'" })).stdout.trim(), 'OWNED_MIGRATION_READY');
      await guest('test ! -e ' + quote(alpha!.directory + '/migration-must-not-run'));
      assert.deepEqual(await identities.inspect(vmId, betaId), beta);
    } finally {
      await identities.stop(vmId, alpha!, saved);
      await python(`import importlib.util,os\nspec=importlib.util.spec_from_file_location('owned',${JSON.stringify(source.directory + '/controller.py')});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.sources()\nlock=m.initialize()\ntry:\n p=${JSON.stringify(latchDirectory)};m.trusted(os.lstat(p),True,0o700);m.trusted(os.lstat(p+'/latch.json'),mode=0o600);os.unlink(p+'/latch.json');os.rmdir(p)\nfinally: os.close(lock)`);
    }
  });
  await check('legal rebind retires only an exact applied migration gate while incomplete and stale gates continue to refuse execution', /** 验证 pending latch 下 rebind 可更新修订但不能放行正文或删除旧 latch；精确 applied 身份才能释放并迁移模式/目录，陈旧修订拒绝且邻项目保持原状态。
 * Prove rebind under pending latches may advance revision but cannot admit bodies/delete old latches; only exact applied identity releases and changes mode/directory, rejecting stale revisions and preserving the neighbor. */ async () => {
    const latchDirectory = '/var/lib/sakura/project-directory-migrations/default', latchPath = latchDirectory + '/latch.json';
    const originalDirectory = alpha!.directory;
    /** 在控制器初始化锁内发布本场景迁移 latch，绑定指定阶段/身份或显式正文，用于门控拒绝；finally 释放锁。
     * Publish the scenario migration latch under the controller initialization lock with supplied phase/identity or explicit body for gate-denial checks, releasing the lock in finally. */
    const writeLatch = async (phase: string, identity = alpha!) => await python(`import importlib.util,json,os\nspec=importlib.util.spec_from_file_location('owned',${JSON.stringify(source.directory + '/controller.py')});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.sources();lock=m.initialize()\ntry:\n m.make_directory(m.MIGRATIONS);m.make_directory(${JSON.stringify(latchDirectory)});m.json_write(${JSON.stringify(latchPath)},json.loads(${JSON.stringify(JSON.stringify({ version: 1, projectId: 'default', planId: randomUUID(), sha256: 'b'.repeat(64), phase, identity }))}))\nfinally: os.close(lock)`);
    try {
      for (const phase of ['applying', 'failed', 'directory-applied']) {
        const before = alpha!;
        await writeLatch(phase);
        alpha = await identities.rebind(vmId, before, { directory: before.directory, networkIsolation: before.networkIsolation });
        assert.equal(alpha.revision, before.revision + 1);
        const retained = JSON.parse(await python(`import json\nprint(json.dumps(json.load(open(${JSON.stringify(latchPath)}))))`));
        assert.equal(retained.phase, phase); assert.deepEqual(retained.identity, before);
        await assert.rejects(identities.prepare(vmId, alpha), /DIRECTORY_MIGRATION_PENDING/);
        const inherited = await identities.inheritedInput(alpha, { command: 'touch rebind-migration-must-not-run' });
        const rejected = await machines!.execInput(vmId, inherited.command, inherited.input);
        assert.equal(rejected.code, 1); assert.match(rejected.stdout, /DIRECTORY_MIGRATION_PENDING/);
      }
      await writeLatch('applied', { ...alpha!, revision: alpha!.revision + 1 });
      await assert.rejects(identities.rebind(vmId, alpha!, { directory: alpha!.directory, networkIsolation: 'host' }), /DIRECTORY_MIGRATION_IDENTITY/);
      assert.deepEqual(await identities.inspect(vmId, 'default'), alpha);
      for (const mode of ['host', 'private'] as const) {
        await writeLatch('applied');
        const before = alpha!;
        alpha = await identities.rebind(vmId, before, { directory: before.directory, networkIsolation: mode });
        assert.equal(alpha.revision, before.revision + 1); assert.equal(alpha.networkIsolation, mode);
        await guest('test ! -e ' + quote(latchPath));
        const run = await identities.prepare(vmId, alpha);
        assert.equal((await identities.exec(vmId, alpha, run, { command: '/usr/bin/id -u' })).stdout.trim(), String(alpha.uid));
      }
      await writeLatch('applied');
      const path = projectRoot + '/applied-rebind-' + randomUUID();
      await python(`import os\nos.mkdir(${JSON.stringify(path)},0o700);os.chown(${JSON.stringify(path)},${alpha!.uid},${alpha!.gid})`);
      const before = alpha!;
      alpha = await identities.rebind(vmId, before, { directory: path, networkIsolation: 'private' });
      await guest('test ! -e ' + quote(latchPath));
      const run = await identities.prepare(vmId, alpha);
      assert.equal((await identities.exec(vmId, alpha, run, { command: 'pwd' })).stdout.trim(), path);
      await writeLatch('applied');
      alpha = await identities.rebind(vmId, alpha, { directory: originalDirectory, networkIsolation: 'private' });
      await guest('test ! -e ' + quote(latchPath));
      assert.deepEqual(await identities.inspect(vmId, betaId), beta);
    } finally {
      await python(`import importlib.util,os\nspec=importlib.util.spec_from_file_location('owned',${JSON.stringify(source.directory + '/controller.py')});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);lock=m.initialize()\ntry:\n m.durable_unlink(${JSON.stringify(latchPath)});os.rmdir(${JSON.stringify(latchDirectory)})\nfinally: os.close(lock)`);
    }
  });
  await check('upgrade refuses an active real legacy ticket strict stop remains reachable and the legacy setuid entry cannot reuse new tickets', /** 从可信权限、manifest 和内容摘要定位真实历史 argv launcher，活旧票据阻止升级入场；关旧运行后旧 launcher 不得接受新 build 票据，finally 精确清理。
 * Locate a real historical argv launcher through trusted permissions/manifest/content digests; active old receipts block upgrade admission and the old launcher cannot accept a new-build receipt after closure, with exact cleanup in finally. */ async () => {
    const legacyBuild = await python(`import hashlib,json,os,re,stat\nroot='/usr/local/lib/sakura-project-identity';names=['protocol.h','launcher.c','controller.py'];found=[]\nfor build in sorted(os.listdir(root)):\n if not re.fullmatch('[a-f0-9]{64}',build): continue\n path=root+'/'+build;info=os.lstat(path)\n if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022: continue\n try: manifest=json.load(open(path+'/manifest.json'))\n except (OSError,ValueError): continue\n if set(manifest)!={'version','build','files'} or manifest['version']!=1 or manifest['build']!=build or len(manifest['files'])!=3: continue\n h=hashlib.sha256();valid=True;files={}\n for name,entry in zip(names,manifest['files']):\n  try: info=os.lstat(path+'/'+name);data=open(path+'/'+name,'rb').read()\n  except OSError: valid=False;break\n  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600 or entry!={'name':name,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}: valid=False;break\n  h.update(name.encode());h.update(data);files[name]=data\n if not valid or h.hexdigest()!=build or b'"--env"' not in files['launcher.c'] or b'SK_PAYLOAD' in files['launcher.c']: continue\n info=os.lstat(path+'/launch')\n if stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o4755: found.append(build)\nassert found,'owned fixture must retain an actual verified historical argv launcher'\nprint(found[0])`);
    assert.match(legacyBuild, /^[a-f0-9]{64}$/);
    verifiedLegacyBuild = legacyBuild;
    const oldDirectory = '/usr/local/lib/sakura-project-identity/' + legacyBuild;
    const metadata = { action: 'prepare', projectId: 'default', expected: { registryId: alpha!.registryId,
      identityId: alpha!.identityId, revision: alpha!.revision }, runId: randomUUID() };
    const prepared = await guest(`env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S ${quote(oldDirectory + '/controller.py')} ${quote(Buffer.from(JSON.stringify(metadata)).toString('base64'))}`);
    const reply = JSON.parse(prepared); assert.equal(reply.ok, true);
    const old = projectIdentityRunSchema.parse(reply.result); assert.equal(old.build, legacyBuild);
    try {
      const oldSelf = `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C ${quote(oldDirectory + '/launch')} --self ${old.runId} -- /bin/true`;
      const prior = await machines!.execInput(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S ${quote(payloadFixture)} self ${alpha!.uid} ${alpha!.gid} ${quote(Buffer.from(oldSelf).toString('base64'))}`, Buffer.alloc(0));
      assert.equal(prior.code, 0, prior.stderr); assert.equal(JSON.parse(prior.stdout).code, 0);
      await assert.rejects(identities.prepare(vmId, alpha!), /UPGRADE_RUNS_MUST_STOP/);
      const inherited = await identities.inheritedInput(alpha!, { command: 'touch upgrade-must-not-run' });
      const refused = await machines!.execInput(vmId, inherited.command, inherited.input);
      assert.equal(refused.code, 1); assert.match(refused.stdout, /UPGRADE_RUNS_MUST_STOP/);
      const stopped = await identities.stop(vmId, alpha!, old);
      assert.equal(stopped.phase, 'closed'); assert.equal(stopped.build, legacyBuild);
      assert.equal((await identities.status(vmId, alpha!, old)).populated, false);
      const next = await identities.prepare(vmId, alpha!);
      try {
        const wrong = oldSelf.replace(old.runId, next.runId);
        const rejected = await machines!.execInput(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S ${quote(payloadFixture)} self ${alpha!.uid} ${alpha!.gid} ${quote(Buffer.from(wrong).toString('base64'))}`, Buffer.alloc(0));
        assert.equal(rejected.code, 0, rejected.stderr);
        const error = JSON.parse(rejected.stdout); assert.equal(error.code, 126); assert.match(error.stderr, /RUN_IDENTITY/);
        assert.equal((await identities.exec(vmId, alpha!, next, { command: '/usr/bin/id -u' })).stdout.trim(), String(alpha!.uid));
      } finally { await identities.stop(vmId, alpha!, next); }
      await guest('test ! -e ' + quote(alpha!.directory + '/upgrade-must-not-run'));
      assert.deepEqual(await identities.inspect(vmId, betaId), beta);
      console.log(JSON.stringify({ verifiedLegacyBuild: legacyBuild, oldTicketClosed: true, newBuild: source.manifest.build }));
    } finally { await identities.stop(vmId, alpha!, old); }
  });
  await check('upgrade refuses a real closed legacy inherited ticket while its pinned upper cgroup remains populated', /** 历史 inherit-current 票据即使标 closed，上层域仍有脱离子进程也必须阻止升级；只在核实原设备/inode 后清空自有上层域，再验证新 build 入场。
 * Require upgrade blocking when a historical inherit-current receipt is closed but its upper domain still contains detached descendants; empty the owned upper domain only after device/inode checks, then prove new-build admission. */ async () => {
    const upper = 'sakura-task-' + randomUUID(), runId = randomUUID(), pidPath = alpha!.directory + '/legacy-upper-' + randomUUID() + '.pid';
    // This historical compatibility fixture uses only its own non-secret test
    // program in the legacy argv protocol, never a product execution payload.
    const body = `import os,time\nif os.fork()==0:\n os.setsid();open(${JSON.stringify(pidPath)},'w').write(str(os.getpid()))\n for fd in (0,1,2):\n  try: os.close(fd)\n  except OSError: pass\n time.sleep(300)\nelse: time.sleep(.15)`;
    const metadata = { action: 'exec-current', projectId: 'default', expected: { registryId: alpha!.registryId,
      identityId: alpha!.identityId, revision: alpha!.revision }, runId, argv: ['/usr/bin/python3', '-c', body], environment: {} };
    const command = `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S ${quote('/usr/local/lib/sakura-project-identity/' + verifiedLegacyBuild + '/controller.py')} ${quote(Buffer.from(JSON.stringify(metadata)).toString('base64'))}`;
    const launched = await machines!.execInput(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S ${quote(payloadFixture)} inherit ${upper} ${quote(Buffer.from(command).toString('base64'))} ${quote(pidPath)}`, Buffer.alloc(0));
    assert.equal(launched.code, 0, launched.stderr);
    const old = await identities.run(vmId, alpha!, runId);
    assert.equal(old.build, verifiedLegacyBuild); assert.equal(old.mode, 'inherit-current');
    try {
      await identities.stop(vmId, alpha!, old);
      const status = await identities.status(vmId, alpha!, old);
      assert.equal(status.run.phase, 'closed'); assert.equal(status.populated, true);
      await assert.rejects(identities.prepare(vmId, alpha!), /UPGRADE_RUNS_MUST_STOP/);
      const plan = await identities.inheritedInput(alpha!, { command: 'touch closed-upgrade-must-not-run' });
      const refused = await machines!.execInput(vmId, plan.command, plan.input);
      assert.equal(refused.code, 1); assert.match(refused.stdout, /UPGRADE_RUNS_MUST_STOP/);
    } finally {
      await python(`import os,time\np='/sys/fs/cgroup/'+${JSON.stringify(upper)}\ni=os.stat(p,follow_symlinks=False);assert str(i.st_dev)==${JSON.stringify(old.cgroupDevice)} and str(i.st_ino)==${JSON.stringify(old.cgroupInode)}\nwith open(p+'/cgroup.kill','w') as f: f.write('1')\nfor _ in range(250):\n try: os.rmdir(p);break\n except OSError: time.sleep(.02)\nelse: raise RuntimeError('owned old upper did not clear')`);
      await identities.stop(vmId, alpha!, old);
    }
    const next = await identities.prepare(vmId, alpha!);
    assert.equal((await identities.exec(vmId, alpha!, next, { command: '/usr/bin/id -u' })).stdout.trim(), String(alpha!.uid));
    await guest('test ! -e ' + quote(alpha!.directory + '/closed-upgrade-must-not-run'));
    assert.deepEqual(await identities.inspect(vmId, betaId), beta);
  });
  await check('TERM and KILL during reserved account creation preserve identity and never activate partial UID', /** 对账户创建真实工具注入 SIGTERM/SIGKILL，证明留下固定 intent 而非可执行身份；显式补目录归属后重试沿用原 UID/identityId，不发第二账户。
 * Inject SIGTERM/SIGKILL during real account creation and prove fixed intent remains nonexecutable; after explicit directory ownership repair, retry reuses original UID/identityId instead of issuing another account. */ async () => {
    const helper = projectRoot + '/fixture.py';
    await machines!.writeGuestFile(vmId, helper, await readFile(resolve('native/project-identity/fixture.py'), 'utf8'));
    for (const signum of [15, 9]) {
      const id = randomUUID().replaceAll('-', '').slice(0, 16);
      const result = JSON.parse(await guest(`env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S ${quote(helper)} ${source.manifest.build} ${id} ${signum}`, 30000));
      const pending = result.identity;
      assert.equal(pending.phase, 'intent');
      assert.equal(result.signal, signum);
      if (signum === 15) assert.equal(result.toolStoppedByController, true);
      const refused = await machines!.exec(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C ${quote(source.directory + '/launch')} --project ${id} ${pending.identityId} ${pending.revision} ${randomUUID()} -- /bin/true`);
      assert.equal(refused.code, 126); assert.match(refused.stderr, /BINDING_INVALID/);
      await assert.rejects(identities.ensure(vmId, { projectId: id, directory: pending.directory, networkIsolation: 'host' }), /DIRECTORY_MIGRATION_REQUIRED/);
      const retry = await identities.inspect(vmId, id);
      assert.equal(retry!.uid, pending.uid); assert.equal(retry!.identityId, pending.identityId);
      await python(`import os\np=${JSON.stringify(pending.directory)}\nos.chown(p,${pending.uid},${pending.gid}); os.chmod(p,0o700)`);
      const complete = await identities.ensure(vmId, { projectId: id, directory: pending.directory, networkIsolation: 'host' });
      assert.equal(complete.uid, pending.uid); assert.equal(complete.identityId, pending.identityId);
    }
  });
  await check('ancestor traversal is required and an inode replacement requires explicit migration', async () => {
    const id = randomUUID().replaceAll('-', '').slice(0, 16), parent = projectRoot + '/ancestor-' + id, path = parent + '/project';
    await python(`import os\nos.mkdir(${JSON.stringify(parent)},0o700); os.mkdir(${JSON.stringify(path)},0o700)`);
    await assert.rejects(identities.ensure(vmId, { projectId: id, directory: path, networkIsolation: 'host' }), /DIRECTORY_MIGRATION_REQUIRED/);
    const pending = (await identities.inspect(vmId, id))!;
    await python(`import os\nos.chown(${JSON.stringify(path)},${pending.uid},${pending.gid})`);
    await assert.rejects(identities.ensure(vmId, { projectId: id, directory: path, networkIsolation: 'host' }), /DIRECTORY_MIGRATION_REQUIRED/);
    assert.equal(await python(`import os\nprint(oct(os.stat(${JSON.stringify(parent)}).st_mode&0o777))`), '0o700');
    await python(`import os\nos.chmod(${JSON.stringify(parent)},0o711)`);
    const complete = await identities.ensure(vmId, { projectId: id, directory: path, networkIsolation: 'host' });
    assert.equal(complete.uid, pending.uid); assert.equal(complete.identityId, pending.identityId);
  });
  const identityInfo = `import os,json\nstatus={}\nfor line in open('/proc/self/status'):\n key,_,value=line.partition(':')\n if key in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs']: status[key]=value.strip()\nprint(json.dumps({'uid':os.getresuid(),'gid':os.getresgid(),'groups':os.getgroups(),'cwd':os.getcwd(),'home':os.environ.get('HOME'),'net':os.readlink('/proc/self/ns/net'),'cgroup':open('/proc/self/cgroup').read().strip(),'status':status,'marker':os.environ.get('IDENTITY_MARKER')}))`;
  let first = await identities.prepare(vmId, alpha!);
  bootId = first.bootId;
  await check('private UID caps supplementary groups namespace cwd and environment', /** 核验项目 UID/GID、Home/cwd、网络/cgroup、空附属组、零能力及 NoNewPrivs；环境中的 shell 语法必须按字面保留，执行后旧票据不能再次启动正文。
 * Verify project UID/GID, Home/cwd, network/cgroup, empty supplementary groups, zero capabilities and NoNewPrivs; shell syntax in environment stays literal and completed receipts cannot launch another body. */ async () => {
    const result = await identities.exec(vmId, alpha!, first, { command: '/usr/bin/python3 -c ' + quote(identityInfo),
      environment: { IDENTITY_MARKER: '$(touch /tmp/sakura-identity-root-escape)' } });
    assert.equal(result.code, 0, result.stderr);
    const info = JSON.parse(result.stdout);
    assert.deepEqual(info.uid, [alpha!.uid, alpha!.uid, alpha!.uid]);
    assert.deepEqual(info.gid, [alpha!.gid, alpha!.gid, alpha!.gid]); assert.deepEqual(info.groups, []);
    assert.equal(info.cwd, alpha!.directory); assert.equal(info.home, alpha!.home);
    assert.equal(info.net, 'net:[' + first.networkInode + ']');
    assert.equal(info.cgroup, '0::/' + first.cgroupName); assert.equal(info.status.NoNewPrivs, '1');
    for (const name of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(info.status[name], /^0+$/);
    assert.equal(info.marker, '$(touch /tmp/sakura-identity-root-escape)');
    await guest('test ! -e /tmp/sakura-identity-root-escape');
    assert.equal((await identities.status(vmId, alpha!, first)).populated, false);
    const stale = await raw(alpha!, first, { command: 'touch should-not-exist' });
    assert.equal(stale.code, 126); assert.match(stale.stderr, /RUN_CLOSED_OR_INVALID/);
  });
  await check('protected script and environment remain usable by the same UID and hidden from the other project UID', /** 真实运行保护正文并分别以本项目/邻 UID 观察 argv、环境与密封只读 memfd 权限；邻 UID 不可读，finally 取消并证明域关闭，错误文本不得含正文/密钥。
 * Run protected body and inspect argv/environment/sealed read-only memfd as own/neighbor UID; deny neighbor reads, cancel in finally and prove domain closure with body/secret-free error text. */ async () => {
    const run = await identities.prepare(vmId, alpha!), abort = new AbortController();
    const marker = 'OWNED_BODY_' + randomUUID(), secret = 'OWNED_ENV_' + randomUUID();
    const pidPath = alpha!.directory + '/payload-' + randomUUID() + '.pid';
    const execution = { command: `# ${marker}\ntest "$PRIVATE_PAYLOAD" = ${quote(secret)} || exit 77\nprintf '%s\\n' "$$" > ${quote(pidPath)}\nsleep 30\nprintf 'OWNED_DONE\\n'`,
      environment: { PRIVATE_PAYLOAD: secret } };
    const plan = identities.input(alpha!, run, execution);
    assert.ok(!plan.command.includes(marker) && !plan.command.includes(secret));
    let settled = false;
    const completion = identities.exec(vmId, alpha!, run, execution, abort.signal, 20000)
      .then(result => { settled = true; return { result, error: null as Error | null }; },
        error => { settled = true; return { result: null, error: error as Error }; });
    try {
      let pid = 0;
      for (let attempt = 0; attempt < 50 && !settled; attempt++) {
        pid = Number(await python(`try: print(int(open(${JSON.stringify(pidPath)}).read()))\nexcept (OSError,ValueError): print(0)`));
        if (pid) break;
        await delay(100);
      }
      assert.ok(pid > 1, 'payload did not reach the protected script');
      /** 通过分离 stdin 传入秘密/正文标记，观察指定 UID/GID 与原 PID，要求执行成功后解析凭据证据。
       * Pass secret/body markers through separate stdin to observe specified UID/GID/original PID, require success and parse credential evidence. */
      const inspect = async (uid: number, gid: number) => {
        const result = await machines!.execInput(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S ${quote(payloadFixture)} inspect ${uid} ${gid} ${pid}`,
          Buffer.from(JSON.stringify([marker, secret])));
        assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout);
      };
      const own = await inspect(alpha!.uid, alpha!.gid);
      assert.equal(own.argvContainsBody, false); assert.equal(own.environmentReadable, true);
      assert.equal(own.environmentContainsBody, true); assert.equal(own.descriptorReadable, true); assert.equal(own.descriptorContainsBody, true);
      assert.equal(own.fdMode, 0o400); assert.equal(own.fdUid, alpha!.uid); assert.equal(own.seals, 15);
      const foreign = await inspect(beta!.uid, beta!.gid);
      assert.equal(foreign.argvContainsBody, false); assert.equal(foreign.environmentReadable, false);
      assert.equal(foreign.environmentContainsBody, false); assert.equal(foreign.descriptorReadable, false); assert.equal(foreign.descriptorContainsBody, false);
    } finally { abort.abort(); await completion; }
    const finished = await completion;
    assert.ok(finished.error, 'cancelled protected execution must reject');
    assert.ok(!finished.error.message.includes(marker) && !finished.error.message.includes(secret));
    const status = await identities.status(vmId, alpha!, run);
    assert.equal(status.run.phase, 'closed'); assert.equal(status.populated, false);
    assert.deepEqual(await identities.inspect(vmId, betaId), beta);
  });
  await check('native payload rejects malformed framing digest NUL UTF8 duplicate environment and legacy argv before any script executes', /** 逐个构造帧头、预算、长度、UTF-8、重复环境、尾部及摘要故障，保持测试摘要策略可区分错误来源；所有错误须在正文标记前拒绝，旧 argv 环境入口也拒绝。
 * Construct header/budget/length/UTF-8/duplicate-environment/trailing/digest faults with controlled digest handling to distinguish causes; all must reject before body markers, including legacy argv-environment entry. */ async () => {
    const file = alpha!.directory + '/invalid-payload-must-not-run';
    const run = await identities.prepare(vmId, alpha!);
    const plan = identities.input(alpha!, run, { command: 'touch ' + quote(file), environment: { TOKEN: 'utf8-文本' } });
    const malformed: Array<[Buffer, RegExp, boolean?]> = [];
    /** 复制合法帧后应用指定字节变异，并记录预期错误模式，保留原帧供其他负例。
     * Copy a valid frame/apply the requested byte mutation and retain its expected error pattern, preserving the original for other negative cases. */
    const change = (modify: /** 原地修改新复制的 Buffer 以构造单项非法帧；调用方保留原有效帧，并将预期拒绝码与修改副本成对登记。
 * Mutate a freshly copied Buffer in place to construct one invalid frame; the caller retains the valid original and records expected refusal codes with each mutated copy. */ (bytes: Buffer) => void, expected: RegExp) => { const bytes = Buffer.from(plan.input); modify(bytes); malformed.push([bytes, expected]); };
    change(bytes => { bytes[0] ^= 1; }, /PAYLOAD_HEADER/);
    change(bytes => bytes.writeUInt32LE(1, 12), /PAYLOAD_HEADER/);
    change(bytes => bytes.writeUInt32LE(129, 20), /PAYLOAD_BOUND/);
    change(bytes => bytes.writeUInt32LE(bytes.readUInt32LE(16) + 1, 16), /PAYLOAD_LENGTH/);
    change(bytes => { bytes[32] = 0; }, /PAYLOAD_UTF8/);
    change(bytes => { bytes[32] = 0xc0; bytes[33] = 0xaf; }, /PAYLOAD_UTF8/);
    change(bytes => { bytes[32] = 0xed; bytes[33] = 0xa0; bytes[34] = 0x80; }, /PAYLOAD_UTF8/);
    malformed.push([plan.input.subarray(0, 20), /PAYLOAD_TRUNCATED/]);
    malformed.push([plan.input.subarray(0, plan.input.length - 1), /PAYLOAD_LENGTH/]);
    const trailing = Buffer.concat([plan.input, Buffer.from('x')]); trailing.writeUInt32LE(trailing.length - 32, 16);
    malformed.push([trailing, /PAYLOAD_TRAILING/]);
    const entry = plan.input.subarray(32 + plan.input.readUInt32LE(24));
    const duplicate = Buffer.concat([plan.input, entry]); duplicate.writeUInt32LE(duplicate.length - 32, 16); duplicate.writeUInt32LE(2, 20);
    malformed.push([duplicate, /PAYLOAD_ENVIRONMENT_DUPLICATE/]);
    malformed.push([plan.input, /PAYLOAD_DIGEST/, true]);
    try {
      for (const [bytes, expected, wrongDigest] of malformed) {
        const sha = wrongDigest ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex');
        const refused = await machines!.execInput(vmId, plan.command.replace(plan.sha256, sha), bytes);
        assert.equal(refused.code, 126); assert.match(refused.stderr, expected);
      }
      const legacy = await machines!.exec(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C ${quote(source.directory + '/launch')} --project ${alpha!.projectId} ${alpha!.identityId} ${alpha!.revision} ${run.runId} --env TOKEN=old -- /bin/true`);
      assert.equal(legacy.code, 126); assert.match(legacy.stderr, /PAYLOAD_REQUIRED/);
      await guest('test ! -e ' + quote(file));
    } finally { await identities.stop(vmId, alpha!, run); }
  });
  await check('UTF8 exact text boundary works and missing EOF overlimit or cancelled pending input publishes no script', /** 先验证 UTF-8 正文边界可执行，再通过无 EOF、额外字节和待读取消模拟流边界；要求有界超时/拒绝、无正文标记且每次原运行清空。
 * First prove the UTF-8 body boundary executes, then model no-EOF, extra-byte and pending-read cancellation; require bounded timeout/refusal, absent body markers and original-run cleanup each time. */ async () => {
    const exact = '#' + 'é'.repeat(32766) + '\n:';
    assert.equal(Buffer.byteLength(exact), 65535);
    const complete = await identities.prepare(vmId, alpha!);
    assert.equal((await identities.exec(vmId, alpha!, complete, { command: exact + '\n' })).code, 0);
    for (const mode of ['no-eof', 'extra', 'pending']) {
      const run = await identities.prepare(vmId, alpha!);
      const path = alpha!.directory + '/pending-' + mode + '-must-not-run';
      const plan = identities.input(alpha!, run, { command: 'touch ' + quote(path) });
      const command = `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S ${quote(payloadFixture)} ${mode} ${quote(Buffer.from(plan.command).toString('base64'))}`;
      try {
        if (mode === 'pending') {
          const abort = new AbortController(); let ready = false;
          const executing = machines!.execInput(vmId, command, plan.input, 15000, abort.signal,
            text => { if (text.includes('OWNED_PENDING')) { ready = true; abort.abort(); } });
          await assert.rejects(executing); assert.equal(ready, true);
        } else {
          const result = await machines!.execInput(vmId, command, plan.input, 15000);
          assert.equal(result.code, 0, result.stderr); const reply = JSON.parse(result.stdout);
          assert.equal(reply.code, 126); assert.match(reply.stderr, mode === 'no-eof' ? /PAYLOAD_TIMEOUT/ : /PAYLOAD_BOUND/);
          if (mode === 'no-eof') assert.ok(reply.elapsedMs >= 7000 && reply.elapsedMs <= 10000);
        }
      } finally { await identities.stop(vmId, alpha!, run); }
      assert.equal((await identities.status(vmId, alpha!, run)).populated, false);
      await guest('test ! -e ' + quote(path));
    }
  });
  await check('real UID mapped setuid entry and foreign UID ticket rejection', /** 以 self 入口运行本项目和邻项目凭据，只有本 UID/GID 可使用原 run 票据，邻身份应 RUN_IDENTITY；finally 关闭票据。
 * Exercise self entry with own/neighbor credentials; only original UID/GID may use the run receipt while the neighbor gets RUN_IDENTITY, then close it in finally. */ async () => {
    const run = await identities.prepare(vmId, alpha!);
    try {
      const plan = identities.selfInput(run, { command: '/usr/bin/python3 -c ' + quote(identityInfo) });
      /** 构造实际 UID/GID 的自检启动命令，原命令单独 base64 参数传递，供身份不符的拒绝路径验证。
       * Build a real-UID/GID self-check entry with the original command as a separate base64 argument for identity-mismatch denial tests. */
      const entry = (uid: number, gid: number) => `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S ${quote(payloadFixture)} self ${uid} ${gid} ${quote(Buffer.from(plan.command).toString('base64'))}`;
      const reply = await machines!.execInput(vmId, entry(alpha!.uid, alpha!.gid), plan.input);
      assert.equal(reply.code, 0, reply.stderr);
      const result = JSON.parse(reply.stdout); assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).uid[0], alpha!.uid);
      const foreign = await machines!.execInput(vmId, entry(beta!.uid, beta!.gid), plan.input);
      assert.equal(foreign.code, 0, foreign.stderr);
      assert.equal(JSON.parse(foreign.stdout).code, 126); assert.match(JSON.parse(foreign.stdout).stderr, /RUN_IDENTITY/);
    } finally { await identities.stop(vmId, alpha!, run); }
  });
  await check('a replaced account home or supplementary group rejects without changing the neighbor', /** 暂改自有账户 Home 和附属组，分别要求 ACCOUNT_REPLACED 与 SUPPLEMENTARY_GROUP_CHANGED；finally 恢复账户并关票据，邻账户始终不变。
 * Temporarily alter the owned account’s Home/supplementary groups, requiring ACCOUNT_REPLACED and SUPPLEMENTARY_GROUP_CHANGED; restore/close in finally and preserve the neighbor throughout. */ async () => {
    const run = await identities.prepare(vmId, alpha!);
    const neighbor = await identities.inspect(vmId, betaId);
    await guest(`/usr/sbin/usermod -d ${quote(beta!.home)} ${alpha!.account}`);
    try {
      const refused = await raw(alpha!, run, { command: 'touch wrong-account' });
      assert.equal(refused.code, 126); assert.match(refused.stderr, /ACCOUNT_REPLACED/);
      await assert.rejects(identities.inspect(vmId, 'default'), /ACCOUNT_REPLACED/);
      assert.deepEqual(await identities.inspect(vmId, betaId), neighbor);
    } finally { await guest(`/usr/sbin/usermod -d ${quote(alpha!.home)} ${alpha!.account}`); }
    await guest(`env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C gpasswd -a ${alpha!.account} ${beta!.account}`);
    try {
      const refused = await raw(alpha!, run, { command: 'touch wrong-group' });
      assert.equal(refused.code, 126); assert.match(refused.stderr, /SUPPLEMENTARY_GROUP_CHANGED/);
    } finally {
      await guest(`env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C gpasswd -d ${alpha!.account} ${beta!.account}`);
      await identities.stop(vmId, alpha!, run);
    }
    assert.deepEqual(await identities.inspect(vmId, betaId), neighbor);
  });
  await check('UID index absence cannot authorize an active binding', /** 移走原 UID 索引后 launcher 必须拒绝缺失记录；ensure 修复索引沿用原 UID/identityId，finally 删除自有备份并关闭原票据。
 * Remove the original UID index and require launcher refusal; ensure repairs it with original UID/identityId, then remove the owned backup and close the receipt in finally. */ async () => {
    const path = '/var/lib/sakura/project-identities/uids/' + alpha!.uid + '.bin';
    const run = await identities.prepare(vmId, alpha!);
    await python(`import os\nos.rename(${JSON.stringify(path)},${JSON.stringify(path + '.fixture-backup')})`);
    try {
      const refused = await raw(alpha!, run, { command: 'touch incomplete-index' });
      assert.equal(refused.code, 126); assert.match(refused.stderr, /RECORD_ABSENT/);
      const recovered = await identities.ensure(vmId, { projectId: alpha!.projectId, directory: alpha!.directory, networkIsolation: alpha!.networkIsolation });
      assert.equal(recovered.uid, alpha!.uid); assert.equal(recovered.identityId, alpha!.identityId);
    } finally {
      await python(`import os\np=${JSON.stringify(path + '.fixture-backup')}\nif os.path.exists(p): os.unlink(p)`);
      await identities.stop(vmId, alpha!, run);
    }
  });
  await check('directory symlink and inode substitution reject before command', /** 将自有项目目录先替为 symlink 再替为同名新目录，分别拒绝迁移缺失和 inode 替换；finally 恢复原目录，不能按路径名信任替代对象。
 * Replace the owned project directory first with a symlink, then a same-name new directory, requiring migration/inode-replacement refusal; restore the original in finally instead of trusting a pathname. */ async () => {
    const run = await identities.prepare(vmId, alpha!);
    const path = alpha!.directory, old = path + '-original';
    await python(`import os\nos.rename(${JSON.stringify(path)},${JSON.stringify(old)})\nos.symlink(${JSON.stringify(old)},${JSON.stringify(path)})`);
    try {
      const refused = await raw(alpha!, run, { command: 'touch replaced-directory' });
      assert.equal(refused.code, 126); assert.match(refused.stderr, /DIRECTORY_MIGRATION_REQUIRED/);
      await python(`import os\np=${JSON.stringify(path)}\nos.unlink(p); os.mkdir(p,0o700); os.chown(p,${alpha!.uid},${alpha!.gid})`);
      const replacement = await raw(alpha!, run, { command: 'touch replaced-directory' });
      assert.equal(replacement.code, 126); assert.match(replacement.stderr, /DIRECTORY_REPLACED/);
    } finally {
      await python(`import os\np=${JSON.stringify(path)}\nif os.path.islink(p): os.unlink(p)\nelse: os.rmdir(p)\nos.rename(${JSON.stringify(old)},p)`);
      await identities.stop(vmId, alpha!, run);
    }
  });
  /** 生成双 fork/setsid 且关闭标准流的自有后代，发布 PID 后持续存活，验证完整 cgroup 清理不会漏掉脱离会话进程。
   * Generate owned double-fork/setsid descendants closing standard streams, publishing PID then surviving to verify full-cgroup cleanup covers detached sessions. */
  const detached = (file: string) => `import os,time\nif os.fork(): os._exit(0)\nos.setsid()\nif os.fork(): os._exit(0)\nopen(${JSON.stringify(file)},'w').write(str(os.getpid()))\nfor fd in [0,1,2]:\n try: os.close(fd)\n except OSError: pass\ntime.sleep(300)`;
  await check('independent cancellation contains detached descendants and preserves neighbor', /** 两个项目各创建脱离会话子进程，停止 alpha 须清空其固定 run cgroup 且 beta 原 run 仍有人口；finally 精确停止两者，验证这两个运行域在 SSH 通道之外独立存在。
 * Create detached descendants in two projects; stopping alpha empties its pinned run cgroup while beta’s original run remains populated, then stop both exactly in finally to verify these two run domains remain independent beyond SSH-channel lifetime. */ async () => {
    const a = await identities.prepare(vmId, alpha!), b = await identities.prepare(vmId, beta!);
    try {
      assert.equal((await raw(alpha!, a, { command: '/usr/bin/python3 -c ' + quote(detached(alpha!.directory + '/detached.pid')) })).code, 0);
      assert.equal((await raw(beta!, b, { command: '/usr/bin/python3 -c ' + quote(detached(beta!.directory + '/detached.pid')) })).code, 0);
      await delay(200);
      assert.equal((await identities.status(vmId, alpha!, a)).populated, true);
      assert.equal((await identities.status(vmId, beta!, b)).populated, true);
      await identities.stop(vmId, alpha!, a);
      assert.equal((await identities.status(vmId, alpha!, a)).populated, false);
      assert.equal((await identities.status(vmId, beta!, b)).populated, true);
    } finally { await identities.stop(vmId, alpha!, a); await identities.stop(vmId, beta!, b); }
  });
  await check('replaced cgroup is rejected without killing its new occupant', /** 替换原 cgroup 后放入自有无关进程，launcher/stop 必须 CGROUP_REPLACED 且替代进程仍活；finally 只按替代 inode 清理该夹具。
 * Replace the original cgroup with an owned unrelated process; launcher/stop must return CGROUP_REPLACED while the replacement lives, then clean only the verified replacement inode in finally. */ async () => {
    const run = await identities.prepare(vmId, alpha!);
    const result = JSON.parse(await python(`import os,subprocess,json\np='/sys/fs/cgroup/'+${JSON.stringify(run.cgroupName)}\nos.rmdir(p); os.mkdir(p)\nfd=os.open(p,os.O_RDONLY|os.O_DIRECTORY); inode=os.fstat(fd).st_ino\ndef enter():\n with open(p+'/cgroup.procs','w') as f: f.write(str(os.getpid()))\nchild=subprocess.Popen(['/bin/sleep','300'],preexec_fn=enter,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,stdin=subprocess.DEVNULL)\nprint(json.dumps({'pid':child.pid,'inode':str(inode)})); os.close(fd)`));
    assert.notEqual(result.inode, run.cgroupInode);
    try {
      const refused = await raw(alpha!, run, { command: 'touch wrong-cgroup' });
      assert.equal(refused.code, 126); assert.match(refused.stderr, /CGROUP_REPLACED/);
      await assert.rejects(identities.stop(vmId, alpha!, run), /CGROUP_REPLACED/);
      await guest(`kill -0 ${result.pid}`);
    } finally {
      await python(`import os,time\np='/sys/fs/cgroup/'+${JSON.stringify(run.cgroupName)}\nassert str(os.stat(p).st_ino)==${JSON.stringify(result.inode)}\nwith open(p+'/cgroup.kill','w') as f: f.write('1')\nfor _ in range(250):\n try: os.rmdir(p); break\n except OSError: time.sleep(.02)\nelse: raise RuntimeError('owned replacement did not clear')`);
    }
  });
  await check('inherit-current closes root authority FDs preserves the upper cgroup and upper stop contains descendants', /** 核验继承票据记录原上层 cgroup、三个权威描述符不泄漏；关闭身份票据应保留仍运行的上层域，其生命周期由拥有上层域的夹具单独清理。
 * Verify inherited receipts bind the original upper cgroup and leak none of three authority descriptors; identity-ticket closure preserves the populated upper domain for separate cleanup by its owner. */ async () => {
    const upper = 'sakura-task-' + randomUUID(), runId = randomUUID();
    const plan = await identities.inheritedInput(alpha!, { command: '/usr/bin/python3 -c ' + quote(detached(alpha!.directory + '/inherited.pid')) }, { runId });
    const wrapped = await machines!.execInput(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S ${quote(payloadFixture)} inherit ${upper} ${quote(Buffer.from(plan.command).toString('base64'))} ${quote(alpha!.directory + '/inherited.pid')}`, plan.input);
    assert.equal(wrapped.code, 0, wrapped.stderr); const info = JSON.parse(wrapped.stdout);
    assert.equal(info.cgroup, '0::/' + upper);
    assert.equal(info.inheritedAuthorityDescriptors, 3); assert.equal(info.authorityDescriptorLeaked, false);
    const receipt = await identities.run(vmId, alpha!, runId);
    assert.equal(receipt.mode, 'inherit-current'); assert.equal(receipt.cgroupName, upper);
    assert.equal((await identities.status(vmId, alpha!, receipt)).populated, true);
    await identities.stop(vmId, alpha!, receipt);
    assert.equal((await identities.status(vmId, alpha!, receipt)).populated, true,
      'closing an inherited identity ticket must preserve its upper domain');
    await python(`import os,time\np='/sys/fs/cgroup/'+${JSON.stringify(upper)}\nwith open(p+'/cgroup.kill','w') as f: f.write('1')\nfor _ in range(250):\n try: os.rmdir(p); break\n except OSError: time.sleep(.02)\nelse: raise RuntimeError('owned upper did not clear')`);
  });
  await check('same boot network replacement refuses new and old tickets; explicit rebind advances revision', /** 替换私有 netns 后拒绝原票据与 prepare，正式 rebind 保留账户但增修订并接纳新网络；旧身份对象随后必须 IDENTITY_STALE。
 * Replace private netns and reject old receipts/prepare; formal rebind retains the account, advances revision and accepts the new network, after which old identity objects must be IDENTITY_STALE. */ async () => {
    const run = await identities.prepare(vmId, alpha!);
    await guest('ip netns del sk-default; ip netns add sk-default; ip -n sk-default link set lo up');
    try {
      const refused = await raw(alpha!, run, { command: 'touch wrong-network' });
      assert.equal(refused.code, 126); assert.match(refused.stderr, /NETWORK_REPLACED/);
      await assert.rejects(identities.prepare(vmId, alpha!), /NETWORK_REPLACED/);
    } finally { await identities.stop(vmId, alpha!, run); }
    const old = alpha!;
    alpha = await identities.rebind(vmId, old, { directory: old.directory, networkIsolation: old.networkIsolation });
    assert.equal(alpha.uid, old.uid); assert.equal(alpha.identityId, old.identityId); assert.equal(alpha.revision, old.revision + 1);
    first = await identities.prepare(vmId, alpha);
    assert.notEqual(first.networkInode, run.networkInode); await identities.stop(vmId, alpha, first);
    await assert.rejects(identities.prepare(vmId, old), /IDENTITY_STALE/);
  });
  await check('network release intent freezes existing tickets and new payloads while cleanup and neighboring project remain available', /** 验证网络释放租约按 bootId/releaseId 固定原网络且阻止所有新入场，仍有原运行时不能删除；释放可幂等重试但旧租约不得删除新 generation，邻项目仍可执行。
 * Prove network-release leases bind original bootId/releaseId/network and block all new admission, refusing deletion while original runs remain; retries are idempotent but old leases cannot delete new generations, and neighbors remain executable. */ async () => {
    const run = await identities.prepare(vmId, alpha!), neighbor = await identities.prepare(vmId, beta!);
    const fixed = await identities.network(vmId, alpha!); assert.ok(fixed);
    await assert.rejects(identities.beginNetworkRelease(vmId, alpha!, { releaseId: randomUUID(), bootId: randomUUID() }), /BOOT_CHANGED/);
    const releaseId = randomUUID(), lease = await identities.beginNetworkRelease(vmId, alpha!, { releaseId, bootId: run.bootId });
    assert.ok(lease); assert.deepEqual(lease.network, fixed);
    assert.deepEqual(await identities.beginNetworkRelease(vmId, alpha!, { releaseId, bootId: run.bootId }), lease);
    await assert.rejects(identities.prepare(vmId, alpha!), /NETWORK_RETIREMENT_PENDING/);
    await assert.rejects(identities.prepare(vmId, alpha!, { runId: run.runId }), /NETWORK_RETIREMENT_PENDING/);
    await assert.rejects(identities.rebind(vmId, alpha!, { directory: alpha!.directory, networkIsolation: 'private' }), /NETWORK_RETIREMENT_PENDING/);
    const blocked = await raw(alpha!, run, { command: 'touch release-must-not-run' });
    assert.equal(blocked.code, 126); assert.match(blocked.stderr, /NETWORK_RETIREMENT_PENDING/);
    const inherited = await identities.inheritedInput(alpha!, { command: 'touch release-must-not-run' });
    const result = await machines!.execInput(vmId, inherited.command, inherited.input);
    assert.equal(result.code, 1); assert.match(result.stdout, /NETWORK_RETIREMENT_PENDING/);
    await assert.rejects(identities.releaseNetwork(vmId, alpha!, lease), /NETWORK_RUNS_MUST_STOP/);
    const unaffected = await identities.exec(vmId, beta!, neighbor, { command: '/usr/bin/id -u' });
    assert.equal(unaffected.code, 0); assert.equal(Number(unaffected.stdout.trim()), beta!.uid);
    await identities.stop(vmId, alpha!, run);
    const released = await identities.releaseNetwork(vmId, alpha!, lease);
    assert.equal(released.phase, 'released'); assert.deepEqual(released.network, fixed);
    assert.deepEqual(await identities.releaseNetwork(vmId, alpha!, lease), released);
    assert.deepEqual(await identities.beginNetworkRelease(vmId, alpha!, { releaseId, bootId: run.bootId }), lease);
    assert.equal(await identities.network(vmId, alpha!), null);
    assert.equal(await identities.beginNetworkRelease(vmId, alpha!, { releaseId: randomUUID(), bootId: run.bootId }), null);
    await guest('test ! -e /run/netns/sk-default; test ! -e ' + quote(alpha!.directory + '/release-must-not-run'));
    await guest('ip netns add sk-default; ip -n sk-default link set lo up');
    const fresh = await identities.network(vmId, alpha!); assert.ok(fresh); assert.notEqual(fresh.generation, fixed.generation);
    assert.deepEqual(await identities.releaseNetwork(vmId, alpha!, lease), released);
    assert.deepEqual(await identities.network(vmId, alpha!), fresh);
    const next = await identities.beginNetworkRelease(vmId, alpha!, { releaseId: randomUUID(), bootId: run.bootId }); assert.ok(next);
    await assert.rejects(identities.releaseNetwork(vmId, alpha!, lease), /NETWORK_RELEASE_STALE/);
    await identities.releaseNetwork(vmId, alpha!, next);
    await guest('ip netns add sk-default; ip -n sk-default link set lo up');
    const restarted = await identities.prepare(vmId, alpha!);
    const working = await identities.exec(vmId, alpha!, restarted, { command: '/usr/bin/id -u' });
    assert.equal(working.code, 0); assert.equal(Number(working.stdout.trim()), alpha!.uid);
  });
  await check('reserved intent account can release its strictly pinned namespace without directory permission migration', /** intent 阶段也可安全释放其已固定的私有网络，不完成账户或改目录元数据；释放后 intent 身份与原目录证据不变。
 * Safely release a fixed private network even for intent identity without completing the account/changing directory metadata; retain original intent and directory evidence afterward. */ async () => {
    const id = randomUUID().replaceAll('-', '').slice(0, 16), path = projectRoot + '/intent-network-' + id;
    await python(`import os\nos.mkdir(${JSON.stringify(path)},0o700)`);
    await assert.rejects(identities.ensure(vmId, { projectId: id, directory: path, networkIsolation: 'private' }), /DIRECTORY_MIGRATION_REQUIRED/);
    const intent = await identities.inspect(vmId, id); assert.ok(intent); assert.equal(intent.phase, 'intent');
    await guest('ip netns add sk-' + id + '; ip -n sk-' + id + ' link set lo up');
    const before = await python(`import json,os\ni=os.stat(${JSON.stringify(path)});print(json.dumps([i.st_uid,i.st_gid,i.st_mode]))`);
    const lease = await identities.beginNetworkRelease(vmId, intent, { releaseId: randomUUID(), bootId }); assert.ok(lease);
    await identities.releaseNetwork(vmId, intent, lease);
    assert.equal(await identities.network(vmId, intent), null);
    assert.equal(await python(`import json,os\ni=os.stat(${JSON.stringify(path)});print(json.dumps([i.st_uid,i.st_gid,i.st_mode]))`), before);
    assert.deepEqual(await identities.inspect(vmId, id), intent);
  });
  await check('closed inherited ticket with populated pinned cgroup prevents namespace retirement until upper cleanup', /** 关闭继承身份票据后若上层域仍有人口，网络释放仍须拒绝；夹具清空自有上层域后同租约才可释放，防止 closed 状态掩盖活进程。
 * Require network-release refusal while an inherited upper domain remains populated even after identity-ticket closure; release the same lease only after the fixture empties its owned domain, so closed labels cannot hide live processes. */ async () => {
    const upper = 'sakura-task-' + randomUUID(), runId = randomUUID(), pidPath = alpha!.directory + '/release-upper-' + randomUUID() + '.pid';
    const plan = await identities.inheritedInput(alpha!, { command: '/usr/bin/python3 -c ' + quote(detached(pidPath)) }, { runId });
    const wrapped = await machines!.execInput(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S ${quote(payloadFixture)} inherit ${upper} ${quote(Buffer.from(plan.command).toString('base64'))} ${quote(pidPath)}`, plan.input);
    assert.equal(wrapped.code, 0, wrapped.stderr);
    const run = await identities.run(vmId, alpha!, runId);
    const lease = await identities.beginNetworkRelease(vmId, alpha!, { releaseId: randomUUID(), bootId: run.bootId }); assert.ok(lease);
    try {
      await identities.stop(vmId, alpha!, run);
      assert.equal((await identities.status(vmId, alpha!, run)).populated, true);
      await assert.rejects(identities.releaseNetwork(vmId, alpha!, lease), /NETWORK_RUNS_MUST_STOP/);
      await guest('test -e /run/netns/sk-default');
    } finally {
      await python(`import os,time\np='/sys/fs/cgroup/'+${JSON.stringify(upper)}\nwith open(p+'/cgroup.kill','w') as f: f.write('1')\nfor _ in range(250):\n try: os.rmdir(p); break\n except OSError: time.sleep(.02)\nelse: raise RuntimeError('owned upper did not clear')`);
    }
    await identities.releaseNetwork(vmId, alpha!, lease);
    await guest('ip netns add sk-default; ip -n sk-default link set lo up');
  });
  await check('failed interrupted and killed namespace deletion keeps the fixed receipt recoverable before and after actual unlink', /** 在网络删除工具创建、入 cgroup、删除前/后注入失败或控制器死亡，要求 durable deleting guard 保留原租约并阻止 prepare；同租约恢复后才允许重建网络。
 * Inject failure/controller death during network-tool creation, cgroup admission and before/after deletion; require a durable deleting guard retaining the original lease/blocking prepare until same-lease recovery permits network recreation. */ async () => {
    for (const mode of ['failure', 'cancel', 'kill-create', 'kill-cgroup', 'kill-before', 'kill-after']) {
      const lease = await identities.beginNetworkRelease(vmId, alpha!, { releaseId: randomUUID(), bootId }); assert.ok(lease);
      const body = `import importlib.util,json,os,signal\nspec=importlib.util.spec_from_file_location('owned',${JSON.stringify(source.directory + '/controller.py')});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.sources();lock=m.initialize()\nvalue=m.binding_read('default');request=json.loads(${JSON.stringify(JSON.stringify({ releaseId: lease.releaseId, network: lease.network }))});real=m.execute;write=m.json_write;mode=${JSON.stringify(mode)}\ndef injected(argv,*args,**kwargs):\n if argv[1:3]==['netns','delete']:\n  if mode=='failure': m.refuse('SYSTEM_TOOL_FAILED')\n  if mode=='cancel': os.kill(os.getpid(),signal.SIGTERM)\n  if mode=='kill-before': os.kill(os.getpid(),signal.SIGKILL)\n  result=real(argv,*args,**kwargs)\n  if mode=='kill-after': os.kill(os.getpid(),signal.SIGKILL)\n  return result\n return real(argv,*args,**kwargs)\ndef injected_write(path,record):\n if path.endswith('.tool.json') and mode=='kill-cgroup' and record['phase']=='running': os.kill(os.getpid(),signal.SIGKILL)\n write(path,record)\n if path.endswith('.tool.json') and mode=='kill-create' and record['phase']=='creating': os.kill(os.getpid(),signal.SIGKILL)\nsignal.signal(signal.SIGTERM,lambda _s,_f:m.refuse('CONTROL_CANCELLED'));m.execute=injected;m.json_write=injected_write\ntry: m.release_network(value,request,${JSON.stringify(bootId)},lock)\nexcept m.Refusal as e: print(e.code);raise SystemExit(1)\nfinally: os.close(lock)`;
      const result = await machines!.exec(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S - <<'SAKURA_NETWORK_INTERRUPT'\n${body}\nSAKURA_NETWORK_INTERRUPT`);
      assert.notEqual(result.code, 0);
      const guard = JSON.parse(await python(`import importlib.util,json\nspec=importlib.util.spec_from_file_location('owned',${JSON.stringify(source.directory + '/controller.py')});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);print(json.dumps(m.network_guard('default')))`));
      assert.equal(guard.phase, 'deleting'); assert.equal(guard.releaseId, lease.releaseId); assert.deepEqual(guard.network, lease.network);
      await assert.rejects(identities.prepare(vmId, alpha!), /NETWORK_RETIREMENT_PENDING/);
      assert.deepEqual(await identities.beginNetworkRelease(vmId, alpha!, { releaseId: lease.releaseId, bootId }), lease);
      const released = await identities.releaseNetwork(vmId, alpha!, lease);
      assert.deepEqual(released.network, lease.network); await guest('test ! -e /run/netns/sk-default');
      await guest('ip netns add sk-default; ip -n sk-default link set lo up');
    }
  });
  await check('a live pinned deletion child survives controller KILL without deleting a fresh namespace after recovery even when it closes the inherited lock', /** 让真实删除子进程杀控制器后延迟工作，核实原工具域仍活并恢复时完整停止它；重建新网络后等旧延迟窗口过去，旧租约仍不得影响新 generation。
 * Let a real delete child kill its controller and delay work, prove the original tool domain populated and stop it completely on recovery; after recreating the network outwait the old delay and prove old leases cannot affect the new generation. */ async () => {
    const lease = await identities.beginNetworkRelease(vmId, alpha!, { releaseId: randomUUID(), bootId }); assert.ok(lease);
    const marker = '/run/sakura-owned-network-delete-' + randomUUID() + '.json';
    const child = `import json,os,signal,time\nos.closerange(3,65536)\npid=os.getpid();created=open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()[19];cg=open('/proc/self/cgroup').read().strip()\nfd=os.open(${JSON.stringify(marker)},os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.write(fd,json.dumps({'pid':pid,'created':created,'cgroup':cg}).encode());os.close(fd)\nos.kill(os.getppid(),signal.SIGKILL);time.sleep(5)\nos.execve('/usr/sbin/ip' if os.path.exists('/usr/sbin/ip') else '/sbin/ip',['ip','netns','delete','sk-default'],{'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/','LANG':'C'})`;
    const body = `import importlib.util,json,os\nspec=importlib.util.spec_from_file_location('owned',${JSON.stringify(source.directory + '/controller.py')});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.sources();lock=m.initialize();value=m.binding_read('default');real=m.execute\ndef injected(argv,*args,**kwargs):\n if argv[1:3]==['netns','delete']: return real(['/usr/bin/python3','-I','-S','-c',${JSON.stringify(child)}],*args,**kwargs)\n return real(argv,*args,**kwargs)\nm.execute=injected\nm.release_network(value,json.loads(${JSON.stringify(JSON.stringify({ releaseId: lease.releaseId, network: lease.network }))}),${JSON.stringify(bootId)},lock)`;
    try {
      const killed = await machines!.exec(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S - <<'SAKURA_DELETE_ACTIVE_CHILD'\n${body}\nSAKURA_DELETE_ACTIVE_CHILD`);
      assert.notEqual(killed.code, 0);
      const state = JSON.parse(await python(`import json,os\na=json.load(open(${JSON.stringify(marker)}));r=json.load(open('/run/sakura-project-identities/networks/default.tool.json'));assert a['cgroup']=='0::/'+r['cgroupName'];assert r['phase']=='running';assert open('/sys/fs/cgroup/'+r['cgroupName']+'/cgroup.events').read().find('populated 1')>=0;assert os.stat('/run/netns/sk-default').st_ino==${lease.network.networkInode};print(json.dumps({'child':a,'tool':r}))`));
      assert.equal(state.tool.releaseId, lease.releaseId); assert.deepEqual(state.tool.network, lease.network);
      await assert.rejects(identities.prepare(vmId, alpha!), /NETWORK_RETIREMENT_PENDING/);
      await identities.releaseNetwork(vmId, alpha!, lease);
      await guest('test ! -e /run/netns/sk-default; test ! -e /run/sakura-project-identities/networks/default.tool.json; test ! -e ' + quote('/sys/fs/cgroup/' + state.tool.cgroupName));
      await guest('ip netns add sk-default; ip -n sk-default link set lo up');
      const fresh = await identities.network(vmId, alpha!); assert.ok(fresh); assert.notEqual(fresh.generation, lease.network.generation);
      await delay(1200);
      assert.deepEqual(await identities.network(vmId, alpha!), fresh);
      assert.deepEqual((await identities.releaseNetwork(vmId, alpha!, lease)).network, lease.network);
      assert.deepEqual(await identities.network(vmId, alpha!), fresh);
    } finally { await python(`import os\nos.unlink(${JSON.stringify(marker)})`); }
  });
  await check('release refuses unknown namespace replacement and keeps the later instance intact', /** 保存原 netns 描述符并测试同名替代网络不得被旧租约删除；再把同 inode 重挂，generation 仍应变化，旧释放回包不能覆盖新租约，finally 核实 PID+ticks 再收夹具。
 * Hold the original netns descriptor and prove an old lease cannot delete same-name replacements; remounting the same inode still advances generation, and old release replies cannot override a new lease, with PID-plus-ticks cleanup in finally. */ async () => {
    const lease = await identities.beginNetworkRelease(vmId, alpha!, { releaseId: randomUUID(), bootId }); assert.ok(lease);
    const hold = JSON.parse(await python(`import json,os,subprocess,sys\nfd=os.open('/run/netns/sk-default',os.O_RDONLY);p=subprocess.Popen([sys.executable,'-I','-S','-c','import time;time.sleep(120)'],pass_fds=(fd,),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);ticks=open('/proc/'+str(p.pid)+'/stat').read().rsplit(')',1)[1].split()[19];print(json.dumps({'pid':p.pid,'fd':fd,'created':ticks}));os.close(fd)`));
    /** 核验持有进程出生 ticks、namespace FD 类型与 inode 后，将精确保留网络域重新绑定；排他创建目标并在 finally 回原域、释放描述符。
     * Verify holder birth ticks/namespace-FD type/inode before rebinding that retained domain; create the target exclusively and restore the original namespace/release descriptors in finally. */
    const bindHeld = async () => await python(`import ctypes,fcntl,os,stat\npid=${hold.pid};fd=${hold.fd};ticks=open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()[19];assert ticks==${JSON.stringify(hold.created)}\nsource='/proc/'+str(pid)+'/fd/'+str(fd);descriptor=os.open(source,os.O_RDONLY);assert fcntl.ioctl(descriptor,0xb703)==0x40000000;assert str(os.fstat(descriptor).st_ino)==${JSON.stringify(lease.network.networkInode)}\ntarget='/run/netns/sk-default';file=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.close(file);libc=ctypes.CDLL(None,use_errno=True);libc.mount.argtypes=(ctypes.c_char_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_ulong,ctypes.c_void_p);libc.mount.restype=ctypes.c_int;libc.setns.argtypes=(ctypes.c_int,ctypes.c_int);libc.setns.restype=ctypes.c_int;original=os.open('/proc/self/ns/net',os.O_RDONLY);assert libc.setns(descriptor,0x40000000)==0,ctypes.get_errno()\ntry:\n result=libc.mount(b'/proc/self/ns/net',target.encode(),None,4096,None);assert result==0,ctypes.get_errno()\nfinally:\n assert libc.setns(original,0x40000000)==0,ctypes.get_errno();os.close(original);os.close(descriptor)`);
    try {
      await guest('ip netns delete sk-default; ip netns add sk-default; ip -n sk-default link set lo up');
      const inode = await python(`import os\nprint(os.stat('/run/netns/sk-default').st_ino)`);
      assert.notEqual(inode, lease.network.networkInode);
      await assert.rejects(identities.releaseNetwork(vmId, alpha!, lease), /NETWORK_REPLACED/);
      assert.equal(await python(`import os\nprint(os.stat('/run/netns/sk-default').st_ino)`), inode);
      // Exact owned restoration returns the original namespace inode; the
      // release can finish without accepting the unknown replacement.
      await guest('ip netns delete sk-default'); await bindHeld();
      assert.equal(await python(`import os\nprint(os.stat('/run/netns/sk-default').st_ino)`), lease.network.networkInode);
      await identities.releaseNetwork(vmId, alpha!, lease);
      // Reintroduce the very same kernel namespace through the retained FD.
      // The fresh generation must still defeat delayed old release requests.
      await bindHeld();
      const fresh = await identities.network(vmId, alpha!); assert.ok(fresh);
      assert.equal(fresh.networkInode, lease.network.networkInode); assert.notEqual(fresh.generation, lease.network.generation);
      await identities.releaseNetwork(vmId, alpha!, lease);
      assert.deepEqual(await identities.network(vmId, alpha!), fresh);
      const next = await identities.beginNetworkRelease(vmId, alpha!, { releaseId: randomUUID(), bootId }); assert.ok(next);
      await assert.rejects(identities.releaseNetwork(vmId, alpha!, lease), /NETWORK_RELEASE_STALE/);
      await identities.releaseNetwork(vmId, alpha!, next);
    } finally { await python(`import os,signal\npid=${hold.pid}\ntry: ticks=open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()[19]\nexcept FileNotFoundError: raise SystemExit(0)\nassert ticks==${JSON.stringify(hold.created)}\nos.kill(pid,signal.SIGTERM)`); }
    await guest('ip netns add sk-default; ip -n sk-default link set lo up');
  });
  await check('binding and account persist across a real VM reboot; old boot tickets refuse', /** 真实 VM 重启后旧 boot 释放请求和旧运行均拒绝，存在新网络时不得删除；原对象已不存在可记录退役，重复旧释放不得改变新运行网络。
 * After real VM reboot reject old-boot release requests/old runs and never delete a new network; record retirement only when the old object is absent, with repeated old release leaving fresh-run networks unchanged. */ async () => {
    const prior = alpha!, oldRun = await identities.prepare(vmId, prior);
    await identities.stop(vmId, prior, oldRun);
    const oldLease = await identities.beginNetworkRelease(vmId, prior, { releaseId: randomUUID(), bootId: oldRun.bootId }); assert.ok(oldLease);
    await machines!.stop(vmId, true); assert.equal(machines!.state(vmId), 'stopped');
    await machines!.start(vmId); await ready();
    const after = await identities.inspect(vmId, 'default'); assert.deepEqual(after, prior);
    await assert.rejects(identities.beginNetworkRelease(vmId, after!, { releaseId: oldLease.releaseId, bootId: oldRun.bootId }), /BOOT_CHANGED/);
    await guest('ip netns add sk-default; ip -n sk-default link set lo up');
    const freshInode = await python(`import os\nprint(os.stat('/run/netns/sk-default').st_ino)`);
    await assert.rejects(identities.releaseNetwork(vmId, after!, oldLease), /NETWORK_RELEASE_STALE/);
    assert.equal(await python(`import os\nprint(os.stat('/run/netns/sk-default').st_ino)`), freshInode);
    // This disposable test's exact new namespace has no run or processes; root
    // removes only that known instance to exercise prior-boot absence recovery.
    await guest('ip netns delete sk-default');
    const recovered = await identities.releaseNetwork(vmId, after!, oldLease);
    assert.equal(recovered.phase, 'released'); await guest('test ! -e /run/netns/sk-default');
    await guest('ip netns add sk-default; ip -n sk-default link set lo up');
    const run = await identities.prepare(vmId, after!); secondBootId = run.bootId; assert.notEqual(secondBootId, oldRun.bootId);
    assert.deepEqual(await identities.releaseNetwork(vmId, after!, oldLease), recovered);
    const refused = await raw(after!, oldRun, { command: 'touch stale-boot' });
    assert.equal(refused.code, 126); assert.match(refused.stderr, /RECORD_ABSENT|RUN_IDENTITY/);
    const result = await identities.exec(vmId, after!, run, { command: '/usr/bin/id -u' });
    assert.equal(result.code, 0, result.stderr); assert.equal(Number(result.stdout.trim()), after!.uid);
  });
  await check('disk snapshot restore preserves the complete registry and rejects the newer revision', /** 停机快照记录原身份，再推进修订并恢复快照，验证账户/邻项目回到原值；快照之后的身份对象必须 stale，恢复身份能正常运行且 UID 不变。
 * Snapshot original identity while stopped, advance revision and restore the snapshot to prove account/neighbor rollback; post-snapshot identity objects must be stale while restored identity executes with unchanged UID. */ async () => {
    const prior = (await identities.inspect(vmId, 'default'))!;
    await guest('/bin/sync');
    await machines!.stop(vmId, true); assert.equal(machines!.state(vmId), 'stopped');
    const snapshot = await machines!.snapshot(vmId, 'owned persistent project identity');
    await machines!.start(vmId); await ready();
    assert.deepEqual(await identities.inspect(vmId, 'default'), prior);
    const later = await identities.rebind(vmId, prior, { directory: prior.directory, networkIsolation: prior.networkIsolation });
    assert.equal(later.revision, prior.revision + 1); assert.equal(later.uid, prior.uid);
    await guest('/bin/sync');
    await machines!.stop(vmId, true); assert.equal(machines!.state(vmId), 'stopped');
    await machines!.restore(vmId, snapshot.id, false);
    await machines!.start(vmId); await ready();
    const restored = (await identities.inspect(vmId, 'default'))!;
    assert.deepEqual(restored, prior); assert.deepEqual(await identities.inspect(vmId, betaId), beta);
    await assert.rejects(identities.prepare(vmId, later), /IDENTITY_STALE/);
    await guest('ip netns add sk-default; ip -n sk-default link set lo up');
    const run = await identities.prepare(vmId, restored);
    const result = await identities.exec(vmId, restored, run, { command: '/usr/bin/id -u' });
    assert.equal(result.code, 0, result.stderr); assert.equal(Number(result.stdout.trim()), prior.uid);
    alpha = restored;
  });
  await check('root records contain no command or environment and all sessions stop', async () => {
    const keys = await python(`import os,stat\nfor root in ['/var/lib/sakura/project-identities','/run/sakura-project-identities']:\n for parent,dirs,files in os.walk(root):\n  for name in files:\n   p=parent+'/'+name; i=os.lstat(p); assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and stat.S_IMODE(i.st_mode)==0o600\n   data=open(p,'rb').read(); assert b'IDENTITY_MARKER' not in data and b'root-escape' not in data\nprint('verified')`);
    assert.equal(keys, 'verified');
  });
  passed = true;
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(error);
} finally {
  let vmStopped = false;
  try {
    if (machines && vmId) {
      // Persist the disposable image's own cloud/SSH setup as well as the
      // explicitly fsynced identity records before releasing the fixture.
      if (machines.state(vmId) === 'running') await machines.exec(vmId, '/bin/sync', 30000).catch(() => {});
      await machines.stop(vmId, true); vmStopped = machines.state(vmId) === 'stopped';
    }
  } finally {
    await writeFile(join(directory, 'project-identity-evidence.json'), JSON.stringify({ version: 1, passed, error: failure,
      distro, fixture: directory, vmId, vmStopped, build: source.manifest.build, files: source.manifest.files,
      client: { node: process.version, execArgv: process.execArgv },
      serverSha256: createHash('sha256').update(await readFile(resolve('server/project-identity.ts'))).digest('hex'),
      checks, bootId, secondBootId }, null, 2) + '\n');
    await machines?.close();
    console.log(JSON.stringify({ passed, error: failure, vmStopped, fixture: directory, vmId, build: source.manifest.build, checks }));
  }
}
if (!passed) process.exitCode = 1;
