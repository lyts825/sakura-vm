/** 烟雾验收：验证项目依赖缓存的原子发布、故障拒绝及保留夹具证据。
 * Smoke acceptance for dependency-cache atomic publication, fault refusal and retained owned evidence. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { JobView } from '../server/jobs.ts';

assert.equal(
  process.argv.length,
  3,
  'Pass the stopped Alpine fixture directory created by test:project-auth-cache.',
);
const parent = await realpath(resolve('.data/dependency-auth-test-temp'));
const root = await realpath(resolve(process.argv[2]));
assert.equal(dirname(root), parent);
assert.match(basename(root), /^sakura-auth-cache-[A-Za-z0-9_-]+$/);
const authEvidence = JSON.parse(await readFile(join(root, 'authenticated-prefetch-evidence.json'), 'utf8'));
assert.equal(authEvidence.distro, 'alpine');
assert.equal(typeof authEvidence.vmId, 'string');
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { quote } = await import('../server/files.ts');
const { guestTask } = await import('../server/guest-task.ts');
const { resolveDependencyAuthentication, withDependencyAuthentication } =
  await import('../server/dependency-downloads.ts');
const { projectDependencyCachePlan, pipCachePublication } =
  await import('../server/project-dependency-cache.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const machines = new Machines(await createRuntime());
await machines.init();
assert.equal(machines.records.size, 1);
const vm = [...machines.records.values()][0];
assert.equal(vm.name, 'auth-cache-smoke');
assert.equal(vm.distro, 'alpine');
assert.equal(vm.id, authEvidence.vmId);
assert.equal(machines.state(vm.id), 'stopped');
const nonce = randomBytes(8).toString('hex');
const guestRoot = '/run/sakura-cache-atomic-' + nonce;
const project = '/workspace/sakura-cache-atomic-' + nonce;
const cacheParent = '/var/cache/sakura/project-deps/' + nonce;
const cache = cacheParent + '/pip';
const evidence: object[] = [];
let suite: InstanceType<typeof FeatureSuite> | undefined;
/** 在本验收夹具的指定实例中执行传入脚本，使用函数中的超时约束并断言退出码为零，返回捕获的标准输出；失败附来宾诊断而不被当作空输出。
 * Execute the supplied script in the specified fixture VM under this function’s timeout, assert exit code zero and return captured stdout; failures include guest diagnostics rather than become empty output. */
const run = async (command: string, timeout = 30_000) => {
  const result = await machines.exec(vm.id, command, timeout);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return result.stdout.trim();
};
/** 用 SFTP wx/0600 创建专用夹具文件，拒绝覆盖已存在资源，等待流写入完成。
 * Create a dedicated fixture file with SFTP wx/0600, rejecting overwrite and awaiting stream completion. */
const write = async (path: string, content: string) =>
  machines.sftp(vm.id, (ftp) =>
    pipeline(
      Readable.from([Buffer.from(content)]),
      ftp.createWriteStream(path, { flags: 'wx', mode: 0o600 }),
    ),
  );

/** 生成调用真实 pip 发布算法的故障注入 Python：拦截 rename 系统调用前后、信号死亡和不支持/碰撞，记录阶段以验证原子可见性。
 * Generate fault-injection Python around the real pip publication algorithm, intercepting rename phases/signals/unsupported-or-collision cases and recording events for atomic-visibility checks. */
function fixturePublication(label: string, phase = 'normal', death = '', injected = '') {
  return `import ctypes, errno, json, os, shutil, signal, sys, threading, time
namespace = {'__name__': 'publication_fixture'}
exec(${JSON.stringify(pipCachePublication)}, namespace)
stage, cache = sys.argv[1:]
with open(os.path.join(stage, 'generation'), 'w') as output: output.write(${JSON.stringify(label)})
original = ctypes.CDLL
record = ${JSON.stringify(guestRoot + '/' + label + '.json')}
events = []
def save(when, flags):
 events.append({'phase': when, 'flags': flags})
 with open(record, 'w') as output: json.dump(events, output)
 if when == ${JSON.stringify(phase)} and ${JSON.stringify(death)}:
  os.killpg(os.getpgrp(), getattr(signal, ${JSON.stringify(death || 'SIGTERM')}))
class Intercept:
 def __init__(self, function): object.__setattr__(self, 'function', function)
 def __getattr__(self, name): return getattr(self.function, name)
 def __setattr__(self, name, value): setattr(self.function, name, value)
 def __call__(self, *args):
  flags = getattr(args[-1], 'value', args[-1])
  save('before', flags)
  if ${JSON.stringify(injected)} == 'unsupported':
   ctypes.set_errno(errno.ENOSYS); return -1
  if ${JSON.stringify(injected)} == 'collision':
   shutil.copytree(stage, cache)
   with open(os.path.join(cache, 'generation'), 'w') as output: output.write('raced-first')
  result = self.function(*args)
  if result == 0: save('after', flags)
  return result
class Library:
 def __init__(self, actual): self.actual = actual
 def __getattr__(self, name):
  function = getattr(self.actual, name)
  return Intercept(function) if name in ('renameat2', 'syscall') else function
ctypes.CDLL = lambda *args, **kwargs: Library(original(*args, **kwargs))
try:
 namespace['publish'](stage, cache)
except Exception as error:
 print('publication fixture errno=' + str(getattr(error, 'errno', None)), file=sys.stderr)
 sys.exit(2)
`;
}

/** 读取缓存代次和 WHEELS，逐文件核对摘要及 LOCKSUMS，要求预期缺失或完整代次，不接受半发布目录。
 * Read cache generation/WHEELS and verify each digest/LOCKSUMS, requiring expected absence or a complete generation rather than partially published directories. */
const verify = async (expected: string | null) => {
  const result = JSON.parse(
    await run(
      `python3 -I -c ${quote(`import hashlib,json,os
cache=${JSON.stringify(cache)}
if not os.path.exists(cache): print(json.dumps({'exists':False}))
else:
 generation=open(os.path.join(cache,'generation')).read() if os.path.isfile(os.path.join(cache,'generation')) else 'production'
 rows=open(os.path.join(cache,'wheels','WHEELS')).read().splitlines()
 for row in rows:
  digest,name=row.split('  ',1)
  assert hashlib.sha256(open(os.path.join(cache,'wheels',name),'rb').read()).hexdigest()==digest
 assert os.path.isfile(os.path.join(cache,'LOCKSUMS'))
 print(json.dumps({'exists':True,'generation':generation,'wheels':len(rows)}))`)}`,
    ),
  );
  if (expected === null) assert.equal(result.exists, false);
  else {
    assert.equal(result.generation, expected);
    assert.ok(result.wheels >= 2);
  }
  return result;
};

try {
  await machines.start(vm.id);
  const deadline = Date.now() + 270_000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(vm.id)))
      throw new Error(machines.logs.get(vm.id));
    await delay(250);
  }
  await run(`umask 077; mkdir -p ${quote(guestRoot + '/auth')} ${quote(project)} ${quote(cacheParent)}`);
  const tokens = {
    npm: 'owned-atomic-npm-' + randomBytes(16).toString('hex'),
    pip: 'owned-atomic-pip-' + randomBytes(16).toString('hex'),
  };
  await write(guestRoot + '/auth/tokens.json', JSON.stringify(tokens));
  const registry = (await readFile('scripts/project-auth-cache-fixture.py', 'utf8'))
    .replaceAll('/run/sakura-auth-fixture', guestRoot + '/auth')
    .replace(
      '        files = {',
      `        if self.path.endswith('.whl') and os.path.exists(os.path.join(ROOT, 'pause-pip')):
            with open(os.path.join(ROOT, 'pause-reached'), 'w') as output: output.write(self.path)
            while os.path.exists(os.path.join(ROOT, 'pause-pip')): time.sleep(.02)
        files = {"/public/simple/owned-auth-probe/owned_auth_probe-1.0.0-py3-none-any.whl": private_wheel,`,
    )
    .replace(
      'if self.path == "/python/simple/owned-auth-probe/":',
      'if self.path in ("/python/simple/owned-auth-probe/", "/public/simple/owned-auth-probe/"):',
    )
    .replace(
      'if self.path == "/python/simple/owned-public-probe/":',
      'if self.path in ("/python/simple/owned-public-probe/", "/public/simple/owned-public-probe/"):',
    );
  await write(guestRoot + '/auth/registry.py', registry);
  await run(
    `nohup env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin python3 -I ${quote(guestRoot + '/auth/registry.py')} </dev/null >${quote(guestRoot + '/auth/log')} 2>&1 &`,
  );
  const ready = JSON.parse(
    await run(
      `for i in $(seq 1 100); do if [ -s ${quote(guestRoot + '/auth/ready.json')} ]; then cat ${quote(guestRoot + '/auth/ready.json')}; exit 0; fi; sleep 0.1; done; exit 1`,
    ),
  );
  const authentication = await resolveDependencyAuthentication(
    vm.id,
    {
      kind: 'basic',
      endpoint: `http://127.0.0.1:${ready.port}/python/simple/`,
      username: 'reader',
      passwordSecret: 'atomic-pip-read',
    },
    { /** 向本夹具认证解析器提供当前 pip 令牌，只经生产认证桥传递。
 * Supply the current pip token to this fixture authentication resolver through the production authentication bridge. */ value: async () => tokens.pip } as any,
  );
  await write(project + '/requirements.txt', 'owned-auth-probe==1.0.0\n');
  console.log(
    'Owned Alpine ready:',
    vm.id,
    await run(
      'python3 -I -c \'import ctypes,platform; print(platform.machine(),hasattr(ctypes.CDLL(None),"renameat2"))\'',
    ),
  );

  /** 用真实认证桥与 guestTask 执行预取，可替换发布段注入故障；finally 清理临时目录/所有者票据，再核验退出模式、事件和缓存代次。
   * Run prefetch through the real authentication bridge/guestTask with optional publication fault injection; finally remove staging/owner receipts, then verify exit mode/events/cache generation. */
  const prefetch = async (
    label: string,
    expected: string | null,
    phase = 'normal',
    death = '',
    injected = '',
    instrument = true,
  ) => {
    let plan: ReturnType<typeof projectDependencyCachePlan> | undefined;
    let result: { code: number; stderr: string } | undefined;
    try {
      result = await withDependencyAuthentication(
        machines,
        vm.id,
        authentication,
        new AbortController().signal,
        async (paths) => {
          plan = projectDependencyCachePlan(project, nonce, 'pip', 'prefetch-dependencies', {}, paths);
          /** 对源码做两层 POSIX 引号编码并取内层内容，以精确替换嵌套 shell 命令中的发布段。
           * Double-encode source with POSIX quoting and take its inner content for exact publication replacement inside nested shell commands. */
          const nested = (source: string) => quote(quote(source)).slice(1, -1);
          const command = instrument
            ? plan.command.replace(
                nested(pipCachePublication),
                nested(fixturePublication(label, phase, death, injected)),
              )
            : plan.command;
          if (instrument) assert.notEqual(command, plan.command);
          return guestTask(machines, vm.id, command, new AbortController().signal, undefined, 60_000);
        },
      );
    } finally {
      if (plan?.cleanup) {
        await run(plan.cleanup);
        await run(
          `test ! -e ${quote(plan.temporaryDirectory!)} && test ! -e ${quote(plan.temporaryDirectory! + '.owner')}`,
        );
      }
    }
    assert.equal(result!.code === 0, !death && !injected, result!.stderr);
    const events = instrument ? JSON.parse(await run(`cat ${quote(guestRoot + '/' + label + '.json')}`)) : [];
    const snapshot = await verify(expected);
    evidence.push({ label, phase, death, injected, code: result!.code, events, snapshot });
    console.log('PASS', label, JSON.stringify({ events, snapshot }));
  };
  await prefetch('first-before-term', null, 'before', 'SIGTERM');
  await prefetch('first-before-kill', null, 'before', 'SIGKILL');
  await prefetch('first-normal', 'first-normal');
  await prefetch('replace-before-term', 'first-normal', 'before', 'SIGTERM');
  await prefetch('replace-before-kill', 'first-normal', 'before', 'SIGKILL');
  await prefetch('replace-unsupported', 'first-normal', 'normal', '', 'unsupported');
  await prefetch('replace-after-term', 'replace-after-term', 'after', 'SIGTERM');
  await prefetch('replace-after-kill', 'replace-after-kill', 'after', 'SIGKILL');
  await prefetch('replace-normal', 'replace-normal');
  await run(`rm -rf -- ${quote(cache)}`);
  await prefetch('first-after-term', 'first-after-term', 'after', 'SIGTERM');
  await run(`rm -rf -- ${quote(cache)}`);
  await prefetch('first-after-kill', 'first-after-kill', 'after', 'SIGKILL');
  await run(`rm -rf -- ${quote(cache)}`);
  await prefetch('first-collision', 'raced-first', 'normal', '', 'collision');
  await run(`rm -rf -- ${quote(cache)}`);
  await prefetch('production-first', 'production', 'normal', '', '', false);
  await prefetch('production-replace', 'production', 'normal', '', '', false);
  const stress = projectDependencyCachePlan(project, nonce, 'pip', 'prefetch-dependencies');
  try {
    await run(
      `umask 077; mkdir -- ${quote(stress.temporaryDirectory!)}; printf 'created\\n' > ${quote(stress.temporaryDirectory! + '.owner')}; cp -a ${quote(cache + '/.')} ${quote(stress.temporaryDirectory!)}`,
    );
    const stressScript = `import os,sys,threading,time,json
namespace={'__name__':'stress_fixture'}
exec(${JSON.stringify(pipCachePublication)},namespace)
stage,cache=sys.argv[1:]
errors=[];samples=[0];stop=threading.Event()
def observe():
 while not stop.is_set():
  try:
   os.stat(cache)
   for path in ('LOCKSUMS','wheels/WHEELS'):
    with open(os.path.join(cache,path),'rb') as data: assert data.read()
   samples[0]+=1
  except Exception as error: errors.append(type(error).__name__)
thread=threading.Thread(target=observe);thread.start()
try:
 for _ in range(1000): namespace['publish'](stage,cache)
finally:
 stop.set();thread.join(2)
assert not errors,errors
assert samples[0]>0
print(json.dumps({'exchanges':1000,'samples':samples[0],'missing':len(errors)}))`;
    const sample = JSON.parse(
      await run(`python3 -I -c ${quote(stressScript)} ${quote(stress.temporaryDirectory!)} ${quote(cache)}`),
    );
    await verify('production');
    evidence.push({ label: 'concurrent-current-observation', ...sample });
    console.log('PASS concurrent-current-observation', JSON.stringify(sample));
  } finally {
    await run(stress.cleanup!);
  }
  let managedAuth = true;
  const spaces = {
    projects: { /** 返回实例 ID 与本次 nonce 的组合配置键，保证原子缓存验收和其他项目状态不混用。
 * Return VM-ID/nonce configuration key so atomic-cache checks cannot mix other project state. */ key: () => vm.id + ':' + nonce, /** 返回本轮固定 nonce 作为项目上下文，保持所有操作绑定同一验收项目。
 * Return this run’s fixed nonce as project context to bind all operations to one verification project. */ current: () => nonce },
    /** 提供私有网络、固定目录及故意不可解析的秘密配置，验证预取不依赖项目正文或秘密。
     * Provide private-network/fixed-directory/intentionally unresolvable secrets to verify prefetch does not depend on project bodies/secrets. */
    config: async () => ({
      directory: project,
      networkIsolation: 'private',
      environment: {},
      secrets: { MISSING: 'must-not-resolve' },
    }),
    /** 立即失败，确保预取路径不能尝试解析项目秘密；若被调用，验收暴露越界依赖。
     * Fail immediately to prove prefetch cannot resolve project secrets; invocation exposes an unauthorized dependency. */
    resolvedConfig: async () => {
      throw new Error('prefetch resolved project secrets');
    },
    /** 按认证模式提供空环境或专用公开 pip 地址，分开验证受管理认证与匿名下载路径。
     * Return empty environment or the dedicated public pip index according to authentication mode to test managed-auth/anonymous paths separately. */
    networkEnvironment: async () =>
      managedAuth ? {} : { PIP_INDEX_URL: `http://127.0.0.1:${ready.port}/public/simple/` },
    /** 只在管理认证模式返回本夹具认证描述，匿名模式返回 undefined。
     * Return this fixture authentication descriptor only in managed mode, otherwise undefined. */
    dependencyDownloadAuthentication: async () => (managedAuth ? authentication : undefined),
  };
  suite = new FeatureSuite(machines, spaces as any);
  const key = vm.id + ':' + nonce + ':dev';
  const originalExec = machines.exec.bind(machines);
  let failCleanupOnce = false;
  let stageCleanups = 0;
  machines.exec = /** 只对识别出的 staging 清理命令计数并丢一次 SSH 确认，其他 exec 原样转发，验证原子缓存事务的清理重试。
 * Count only recognized staging-cleanup commands and lose one SSH acknowledgement, forwarding other exec unchanged to test atomic-cache cleanup retries. */ async (...args: Parameters<typeof machines.exec>) => {
    if (args[1].startsWith('set -eu\nif [ -f') && args[1].includes('sakura_stage_state')) {
      stageCleanups++;
      if (failCleanupOnce) {
        failCleanupOnce = false;
        throw new Error('owned stage cleanup transient SSH failure');
      }
    }
    return originalExec(...args);
  };
  for (const authed of [true, false]) {
    managedAuth = authed;
    const kind = authed ? 'auth' : 'public';
    await run(`rm -rf -- ${quote(cache)}`);
    for (const phase of ['first', 'replace']) {
      suite.dev(vm.id, { operation: 'prefetch-dependencies', manager: 'pip' });
      await suite.jobs.wait(key);
      const job: JobView = suite.jobs.view(key)!;
      assert.equal(job.status, 'done', job.error + '\n' + job.log);
      await verify('production');
      evidence.push({ label: 'managed-' + kind + '-' + phase, status: job.status });
      console.log('PASS managed-' + kind + '-' + phase);
    }
    const inode = await run(`stat -c %i ${quote(cache)}`);
    await write(guestRoot + '/auth/pause-pip', 'owned slow download');
    failCleanupOnce = true;
    const cleanupsBefore = stageCleanups;
    suite.dev(vm.id, { operation: 'prefetch-dependencies', manager: 'pip' });
    await run(
      `for i in $(seq 1 400); do if [ -f ${quote(guestRoot + '/auth/pause-reached')} ]; then exit 0; fi; sleep 0.05; done; exit 1`,
    );
    suite.jobs.cancel(key);
    await suite.jobs.wait(key);
    const cancelled: JobView = suite.jobs.view(key)!;
    assert.equal(cancelled.status, 'cancelled', cancelled.error + '\n' + cancelled.log);
    assert.equal(failCleanupOnce, false);
    assert.ok(stageCleanups - cleanupsBefore >= 2);
    assert.equal(await run(`stat -c %i ${quote(cache)}`), inode);
    await verify('production');
    await run(`rm -f -- ${quote(guestRoot + '/auth/pause-pip')} ${quote(guestRoot + '/auth/pause-reached')}`);
    await run(`test -z "$(find ${quote(cacheParent)} -maxdepth 1 -name '.staging.*' -print)"`);
    evidence.push({
      label: 'managed-' + kind + '-cancel',
      status: cancelled.status,
      stageCleanupAttempts: stageCleanups - cleanupsBefore,
      retainedInode: inode,
    });
    console.log('PASS managed-' + kind + '-cancel with verified group stop and retried exact stage cleanup');
  }
  machines.exec = originalExec;
  await run(`test -z "$(find ${quote(cacheParent)} -maxdepth 1 -name '.staging.*' -print)"`);
  await run('test -z "$(find /run -maxdepth 1 -name \'sakura-dependency-auth.*\' -print)"');
  await writeFile(
    join(root, 'atomic-cache-evidence.json'),
    JSON.stringify({ distro: vm.distro, vmId: vm.id, cache, cases: evidence }, null, 2),
  );
  console.log(
    'PASS authenticated pip atomic publication: first/replacement, exact TERM/KILL boundaries, unsupported and concurrent-first preservation; all owned stages removed',
  );
} finally {
  await suite?.close();
  await machines.close();
  console.log('Stopped retained owned fixture:', root);
}
