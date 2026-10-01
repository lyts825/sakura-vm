import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const distro = process.argv[2] || 'alpine';
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro));
const parent = resolve('.data/dependency-auth-test-temp');
await mkdir(parent, { recursive: true });
const reuse = process.argv[3];
const root = reuse ? resolve(reuse) : await mkdtemp(join(parent, 'sakura-auth-cache-'));
assert.equal(dirname(await realpath(root)), await realpath(parent));
assert.ok(basename(root).startsWith('sakura-auth-cache-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve(
  '.data/images/' +
    { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' }[distro],
);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { NetworkProfiles } = await import('../server/network-profiles.ts');
const { Secrets } = await import('../server/secrets.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { quote } = await import('../server/files.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const secrets = new Secrets(machines),
  network = new NetworkProfiles(machines);
const workspaces = new Workspaces(machines, { secrets, network });
const suite = new FeatureSuite(machines, workspaces);
try {
  if (reuse) {
    assert.equal(machines.records.size, 1);
    const saved = [...machines.records.values()][0];
    assert.equal(saved.name, 'auth-cache-smoke');
    assert.equal(saved.distro, distro);
    assert.equal(machines.state(saved.id), 'stopped');
  }
  const vm = reuse
    ? [...machines.records.values()][0]
    : await machines.create({
        name: 'auth-cache-smoke',
        distro: distro as 'alpine' | 'debian' | 'ubuntu',
        memoryMiB: 1024,
        cpus: 2,
        diskGiB: 6,
      });
  await machines.start(vm.id);
  const deadline = Date.now() + 270_000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(vm.id)))
      throw new Error(machines.logs.get(vm.id));
    await delay(300);
  }
  const run = async (command: string, timeout = 300_000) => {
    const result = await machines.exec(vm.id, command, timeout);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  const write = async (file: string, text: string) =>
    machines.sftp(vm.id, async (ftp) =>
      pipeline(Readable.from([Buffer.from(text)]), ftp.createWriteStream(file, { flags: 'w', mode: 0o600 })),
    );
  await run(
    distro === 'alpine'
      ? 'apk add --no-cache nodejs npm python3 py3-pip iproute2'
      : 'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y nodejs npm python3-pip python3-venv iproute2',
  );
  console.log(`${distro}: system dependency tools installed in owned VM`);
  await run('umask 077; mkdir -p /run/sakura-auth-fixture /workspace/npm-auth /workspace/pip-auth');
  await run(
    'rm -f /workspace/npm-auth/import-hook-network /workspace/npm-auth/lifecycle-hook /workspace/pip-auth/import-hook-network',
  );
  const tokens = {
    npm: 'owned-npm-' + randomBytes(24).toString('hex'),
    pip: 'owned-pip-' + randomBytes(24).toString('hex'),
  };
  await write('/run/sakura-auth-fixture/tokens.json', JSON.stringify(tokens));
  await write(
    '/run/sakura-auth-fixture/registry.py',
    await readFile('scripts/project-auth-cache-fixture.py', 'utf8'),
  );
  await run(
    'nohup env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin python3 -I /run/sakura-auth-fixture/registry.py </dev/null >/run/sakura-auth-fixture/registry.log 2>&1 &',
  );
  const ready = JSON.parse(
    await run(
      'for i in $(seq 1 100); do if [ -s /run/sakura-auth-fixture/ready.json ]; then cat /run/sakura-auth-fixture/ready.json; exit 0; fi; sleep 0.1; done; exit 1',
    ),
  );
  const endpoint = `http://127.0.0.1:${ready.port}`;
  await secrets.save(vm.id, { name: 'npm-read', value: tokens.npm });
  await secrets.save(vm.id, { name: 'pip-read', value: tokens.pip });
  if ((await network.state(vm.id)).appliedAt) await network.restore(vm.id);
  const preview = await network.preview(vm.id, {
    dependencyDownloads: {
      npm: { kind: 'bearer', endpoint: endpoint + '/npm/', tokenSecret: 'npm-read' },
      pip: {
        kind: 'basic',
        endpoint: endpoint + '/python/simple/',
        username: 'reader',
        passwordSecret: 'pip-read',
      },
    },
  });
  await network.apply(vm.id, preview.config, preview.token);
  const manifests = async (version: string, integrity: string, filename: string) => {
    const manifest = {
      name: 'owned-auth-project',
      version: '1.0.0',
      dependencies: { '@sakura-owned/auth-probe': version },
      scripts: { preinstall: 'touch /workspace/npm-auth/lifecycle-hook' },
    };
    await write('/workspace/npm-auth/package.json', JSON.stringify(manifest));
    await write(
      '/workspace/npm-auth/package-lock.json',
      JSON.stringify({
        name: manifest.name,
        version: manifest.version,
        lockfileVersion: 3,
        packages: {
          '': manifest,
          'node_modules/@sakura-owned/auth-probe': {
            version,
            resolved: endpoint + '/npm/-/' + filename,
            integrity,
            hasInstallScript: true,
          },
        },
      }),
    );
  };
  await manifests('1.0.0', ready.integrity1, 'auth-probe-1.0.0.tgz');
  await write(
    '/workspace/npm-auth/hook.cjs',
    "require('node:fs').appendFileSync('/workspace/npm-auth/import-hook-network',require('node:fs').readlinkSync('/proc/self/ns/net')+'\\n');",
  );
  await write(
    '/workspace/npm-auth/.npmrc',
    'node-options=--require /workspace/npm-auth/hook.cjs\nregistry=http://127.0.0.1:9\n',
  );
  const jobs: any[] = [];
  const dev = async (
    manager: 'npm' | 'pip',
    operation: 'prefetch-dependencies' | 'install-cached-dependencies',
    success = true,
  ) => {
    suite.dev(vm.id, { manager, operation });
    await suite.jobs.wait(`${vm.id}:dev`);
    const job = suite.jobs.view(`${vm.id}:dev`)!;
    assert.equal(job.status, success ? 'done' : 'error', job.error + '\n' + job.log);
    for (const token of [tokens.npm, tokens.pip, Buffer.from('reader:' + tokens.pip).toString('base64')])
      assert.ok(
        !job.log.includes(token) && !(job.error || '').includes(token),
        'credential appeared in job output',
      );
    jobs.push({ manager, operation, status: job.status, log: job.log, error: job.error });
    assert.equal(
      (await run('find /run -maxdepth 1 -name "sakura-dependency-auth.*" -print')).trim(),
      '',
      'credential directory survived',
    );
    return job;
  };
  await workspaces.save(vm.id, {
    directory: '/workspace/npm-auth',
    networkIsolation: 'private',
    environment: {
      NODE_OPTIONS: '--require /workspace/npm-auth/hook.cjs',
      HOME: '/workspace/npm-auth',
      PATH: '/missing',
    },
    secrets: { SHOULD_NOT_RESOLVE: 'missing-provider' },
  });
  await dev('npm', 'prefetch-dependencies');
  await run(
    'test ! -e /workspace/npm-auth/import-hook-network && test ! -e /workspace/npm-auth/lifecycle-hook',
  );
  const npmSums = await run('cat /var/cache/sakura/project-deps/default/npm/LOCKSUMS');
  await manifests('2.0.0', ready.integrity2, 'auth-probe-2.0.0.tgz');
  await secrets.save(vm.id, { name: 'npm-read', value: 'owned-incorrect-credential' });
  await dev('npm', 'prefetch-dependencies', false);
  assert.equal(await run('cat /var/cache/sakura/project-deps/default/npm/LOCKSUMS'), npmSums);
  await secrets.save(vm.id, { name: 'npm-read', value: tokens.npm });
  await manifests('4.0.0', ready.integrity4, 'slow.tgz');
  suite.dev(vm.id, { manager: 'npm', operation: 'prefetch-dependencies' });
  await run(
    'for i in $(seq 1 400); do if grep -q slow.tgz /run/sakura-auth-fixture/requests.json 2>/dev/null; then exit 0; fi; sleep 0.05; done; exit 1',
  );
  const scanProcesses = async () =>
    JSON.parse(
      await run(
        `python3 -I -c ${quote("import glob,json,base64; tokens=json.load(open('/run/sakura-auth-fixture/tokens.json')); values=[v.encode() for v in tokens.values()]+[base64.b64encode(('reader:'+tokens['pip']).encode())]; count=0; leaked=False\nfor path in glob.glob('/proc/[0-9]*/cmdline'):\n try:\n  command=open(path,'rb').read(); args=command.split(b'\\0')\n  if b'python' in args[0] and any(a.startswith(b'/run/sakura-dependency-auth.') and a.endswith(b'/broker.py') for a in args):\n   count+=1; environment=open(path.replace('cmdline','environ'),'rb').read(); leaked=leaked or any(v in command or v in environment for v in values)\n except (FileNotFoundError,PermissionError): pass\nprint(json.dumps({'brokers':count,'leaked':leaked}))")}`,
      ),
    );
  const processScan = await scanProcesses();
  assert.ok(processScan.brokers >= 1);
  assert.equal(processScan.leaked, false);
  suite.jobs.cancel(`${vm.id}:dev`);
  await suite.jobs.wait(`${vm.id}:dev`);
  assert.equal(suite.jobs.view(`${vm.id}:dev`)?.status, 'cancelled');
  const cancelledDownload = suite.jobs.view(`${vm.id}:dev`)!;
  assert.equal((await scanProcesses()).brokers, 0);
  assert.equal((await run('find /run -maxdepth 1 -name "sakura-dependency-auth.*" -print')).trim(), '');
  assert.equal(await run('cat /var/cache/sakura/project-deps/default/npm/LOCKSUMS'), npmSums);
  await manifests('3.0.0', 'sha512-' + randomBytes(64).toString('base64'), 'escape.tgz');
  await dev('npm', 'prefetch-dependencies', false);
  assert.equal(await run('cat /var/cache/sakura/project-deps/default/npm/LOCKSUMS'), npmSums);
  await manifests('1.0.0', ready.integrity1, 'auth-probe-1.0.0.tgz');
  await run('rm -f /workspace/npm-auth/.npmrc');
  await workspaces.save(vm.id, {
    directory: '/workspace/npm-auth',
    networkIsolation: 'private',
    environment: { NODE_OPTIONS: '--require /workspace/npm-auth/hook.cjs' },
  });
  await dev('npm', 'install-cached-dependencies');
  await run(
    'test -f /workspace/npm-auth/node_modules/@sakura-owned/auth-probe/index.js && test ! -e /workspace/npm-auth/lifecycle-hook',
  );
  const privateNetwork = (await run('ip netns exec sk-default readlink /proc/self/ns/net')).trim();
  const npmNetworks = (await run('cat /workspace/npm-auth/import-hook-network')).trim().split('\n');
  assert.ok(npmNetworks.length && npmNetworks.every((value) => value === privateNetwork));
  console.log(
    `${distro}: authenticated npm, bad credential and redirect rejection, private offline installation passed`,
  );

  await write('/workspace/pip-auth/requirements.txt', 'owned-auth-probe==1.0.0\n');
  await write(
    '/workspace/pip-auth/sitecustomize.py',
    "import os\nwith open('/workspace/pip-auth/import-hook-network','a') as out: out.write(os.readlink('/proc/self/ns/net')+'\\n')\n",
  );
  await write('/workspace/pip-auth/pip.conf', '[global]\nindex-url=http://127.0.0.1:9\n');
  await workspaces.save(vm.id, {
    directory: '/workspace/pip-auth',
    networkIsolation: 'private',
    environment: {
      PYTHONPATH: '/workspace/pip-auth',
      PIP_CONFIG_FILE: '/workspace/pip-auth/pip.conf',
      HOME: '/workspace/pip-auth',
    },
    secrets: { SHOULD_NOT_RESOLVE: 'missing-provider' },
  });
  await dev('pip', 'prefetch-dependencies');
  await run('test ! -e /workspace/pip-auth/import-hook-network');
  await workspaces.save(vm.id, {
    directory: '/workspace/pip-auth',
    networkIsolation: 'private',
    environment: { PYTHONPATH: '/workspace/pip-auth' },
  });
  await dev('pip', 'install-cached-dependencies');
  await run(
    '/workspace/pip-auth/.sakura/venv/bin/python -c \'import owned_auth_probe, owned_public_probe; assert owned_auth_probe.VALUE == "owned wheel"\'',
  );
  const pipNetworks = (await run('cat /workspace/pip-auth/import-hook-network')).trim().split('\n');
  assert.ok(pipNetworks.length && pipNetworks.every((value) => value === privateNetwork));
  const requests = JSON.parse(await run('cat /run/sakura-auth-fixture/requests.json'));
  assert.ok(requests.some((item: any) => item.scope === 'npm' && item.authorized && item.hadAuthorization));
  assert.ok(requests.some((item: any) => item.scope === 'pip' && item.authorized && item.hadAuthorization));
  assert.ok(
    requests.some(
      (item: any) => item.scope === 'public' && item.path.includes('.whl') && !item.hadAuthorization,
    ),
  );
  assert.ok(!requests.some((item: any) => item.scope === 'public' && item.hadAuthorization));
  assert.ok(!requests.some((item: any) => item.path.includes('redirect-target')));
  const leaked = await run(
    `python3 -I -c ${quote("import os,json; tokens=json.load(open('/run/sakura-auth-fixture/tokens.json')); import base64; values=[v.encode() for v in tokens.values()]+[base64.b64encode(('reader:'+tokens['pip']).encode())]; files=[os.path.join(d,n) for d,_,ns in os.walk('/var/cache/sakura/project-deps') for n in ns]; print(json.dumps({'files':len(files),'leaked':any(any(v in open(p,'rb').read() for v in values) for p in files)}))")}`,
  );
  const cacheScan = JSON.parse(leaked);
  assert.equal(cacheScan.leaked, false);
  await writeFile(
    join(root, 'authenticated-prefetch-evidence.json'),
    JSON.stringify(
      {
        distro,
        vmId: vm.id,
        privateNetwork,
        npmNetworks,
        pipNetworks,
        requests,
        cacheScan,
        jobs,
        credentialDirectories: 0,
        processScan,
        cancelledDownload: { status: cancelledDownload.status, error: cancelledDownload.error },
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${distro}: credential-scoped npm/pip prefetch, public transitive wheel without auth, no credential cache, private offline install`,
  );
} finally {
  await suite.close();
  await workspaces.close();
  await network.close();
  await machines.close();
  console.log('Retained owned fixture:', root);
}
