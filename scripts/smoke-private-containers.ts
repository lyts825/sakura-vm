import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { JobView } from '../server/jobs.ts';

const distro = process.argv[2] || 'debian';
assert.ok(['debian', 'ubuntu'].includes(distro));
const directory = process.argv[3] || (await mkdtemp(join(tmpdir(), 'sakura-private-containers-')));
const owned = await realpath(directory);
assert.equal(dirname(owned), await realpath(tmpdir()));
assert.match(basename(owned), /^sakura-(private-containers|container-probe)-/);
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve(
  '.data/images',
  distro === 'ubuntu' ? 'ubuntu-24.04.qcow2' : 'debian-12.qcow2',
);
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Secrets } = await import('../server/secrets.ts');
const { Containers } = await import('../server/containers.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { quote } = await import('../server/files.ts');
const {
  privateDockerPaths,
  privateDockerCommand,
  privateDockerStatus,
  preparePrivateDocker,
  stopPrivateDocker,
} = await import('../server/private-docker.ts');
const engine = await createRuntime(),
  machines = new Machines(engine);
let vmId = '',
  workspaces: InstanceType<typeof Workspaces> | undefined,
  containers: InstanceType<typeof Containers> | undefined,
  features: InstanceType<typeof FeatureSuite> | undefined;
const secret = 'sakura-private-container-' + randomUUID(),
  image = 'sakura-private-smoke:local';
async function command(script: string, timeout = 30_000) {
  const result = await machines.exec(vmId, script, timeout);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
async function boot() {
  await machines.start(vmId);
  const deadline = Date.now() + 300_000;
  while (machines.state(vmId) === 'starting' && Date.now() < deadline) await delay(100);
  assert.equal(machines.state(vmId), 'running', machines.logs.get(vmId));
}
const within = <T>(project: string, work: () => Promise<T>) => workspaces!.projects.with(vmId, project, work);
async function action(project: string, input: unknown, error?: RegExp) {
  await within(project, () => containers!.run(vmId, input));
  await containers!.jobs.wait(vmId);
  const job = containers!.jobs.view(vmId)!;
  assert.equal(job.projectId, project);
  if (error) {
    assert.equal(job.status, 'error');
    assert.match(job.error || '', error);
  } else assert.equal(job.status, 'done', job.error + '\n' + job.log);
  assert.ok(!job.log.includes(secret), 'job output must redact the project secret');
  return job;
}
const view = (project: string) => within(project, () => containers!.view(vmId));
async function traffic(project: string, expected: string) {
  const config = await within(project, () => workspaces!.config(vmId));
  const request = privateDockerCommand(
    config,
    `python3 -I -S -c ${quote("import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:18080',timeout=2).read().decode())")}`,
    false,
  );
  const deadline = Date.now() + 15_000;
  while (true) {
    const result = await machines.exec(vmId, request, 5000);
    if (result.code === 0) {
      assert.equal(result.stdout.trim(), expected);
      return;
    }
    assert.ok(Date.now() < deadline, result.stderr);
    await delay(200);
  }
}
try {
  await machines.init();
  const prior = [...machines.records.values()][0];
  if (prior) assert.match(prior.name, /^(private-docker-probe|private-containers-)/);
  const vm =
    prior ||
    (await machines.create({
      name: 'private-containers-' + distro,
      distro,
      memoryMiB: 3072,
      cpus: 2,
      diskGiB: 12,
      forwards: [],
    }));
  vmId = vm.id;
  await boot();
  // Reusing an owned probe avoids repeating package downloads while developing
  // the smoke. The default invocation always creates a new isolated VM.
  if (prior && basename(directory).startsWith('sakura-container-probe-')) {
    const old = {
      directory: '/workspace/probe',
      template: 'none' as const,
      repository: '',
      setup: '',
      command: '',
      networkIsolation: 'private' as const,
    };
    await machines.locked(vmId, () =>
      preparePrivateDocker(machines, vmId, old, new AbortController().signal),
    );
    await command(
      `if ${privateDockerPaths('default').config}/docker-client inspect probe >/dev/null 2>&1; then ${privateDockerPaths('default').config}/docker-client rm -f probe; fi`,
    );
    await stopPrivateDocker(machines, vmId, old);
  }
  const secrets = process.platform === 'win32' ? new Secrets(machines) : undefined;
  if (secrets) await secrets.save(vmId, { name: 'container-key', value: secret });
  workspaces = new Workspaces(machines, { secrets });
  containers = new Containers(machines, workspaces);
  await within('default', () => workspaces!.save(vmId, { directory: '/workspace/shared' }));
  console.log(`${distro}: installing Docker/Compose into the isolated test VM`);
  await action('default', { action: 'install' });
  await command(
    `export DEBIAN_FRONTEND=noninteractive\napt-get install -y busybox-static\n` +
      `mkdir -p /tmp/sakura-private-image/bin /tmp/sakura-private-image/etc /tmp/sakura-private-image/root /workspace/shared\n` +
      `cp /bin/busybox /tmp/sakura-private-image/bin/busybox\n` +
      `for applet in $(/bin/busybox --list); do [ "$applet" = busybox ] || ln -sf busybox "/tmp/sakura-private-image/bin/$applet"; done\n` +
      `printf 'root:x:0:0:root:/root:/bin/sh\\n' > /tmp/sakura-private-image/etc/passwd\n` +
      `printf 'root:x:0:\\n' > /tmp/sakura-private-image/etc/group\n` +
      `tar -C /tmp/sakura-private-image -cf - . | docker --host unix:///var/run/docker.sock import - ${image}`,
    180_000,
  );
  const projects: string[] = [];
  for (const label of ['alpha', 'beta']) {
    const path = label === 'alpha' ? "/workspace/private 'alpha space" : '/workspace/private-beta';
    const existing: { id: string; name: string } | undefined = (
      await workspaces.projects.list(vmId)
    ).projects.find((item) => item.name === label);
    const project: string =
      existing?.id ||
      (
        await workspaces.projects.create(vmId, label, () =>
          workspaces!
            .save(vmId, {
              directory: path,
              networkIsolation: 'private',
              environment: { SCOPE: label, DOCKER_HOST: 'unix:///var/run/docker.sock' },
              ...(secrets ? { secrets: { TOKEN: 'container-key' } } : {}),
            })
            .then(() => {}),
        )
      ).active;
    projects.push(project);
    await action(project, { action: 'start-project-runtime' });
    if (existing) {
      const p = privateDockerPaths(project);
      await command(
        `ids=$(${p.config}/docker-client ps -aq); if [ -n "$ids" ]; then ${p.config}/docker-client rm -f $ids; fi`,
      );
    }
    await action(project, { action: 'pull', image });
    assert.equal(
      await command(
        `${privateDockerPaths(project).config}/docker-client run --rm --user 65534:65534 ${image} /bin/busybox id -u`,
      ),
      '65534',
    );
    await command(
      `mkdir -p ${quote(path + '/site')}; printf '%s' ${quote(label)} > ${quote(path + '/site/index.html')}`,
    );
    await machines.writeGuestFile(
      vmId,
      path + '/compose.yaml',
      `services:\n  app:\n    image: ${image}\n    network_mode: host\n    restart: always\n` +
        `    command: ["/bin/busybox", "httpd", "-f", "-p", "127.0.0.1:18080", "-h", "/site"]\n` +
        `    volumes:\n      - ${JSON.stringify(path + '/site:/site:ro')}\n` +
        `    environment:\n      SCOPE: "\${SCOPE}"\n      ${secrets ? 'TOKEN: "${TOKEN}"' : 'TOKEN: test'}\n`,
      true,
    );
    await action(project, { action: 'compose-up', file: 'compose.yaml' });
    await traffic(project, label);
    const info = await view(project);
    assert.equal(info.available, true);
    assert.equal(info.containers.length, 1);
    assert.ok(!JSON.stringify(info).includes(secret));
    const p = privateDockerPaths(project),
      details = JSON.parse(await command(`${p.config}/docker-client inspect ${info.containers[0].ID}`))[0];
    assert.equal(details.HostConfig.RestartPolicy.Name, 'no');
    assert.ok(details.Config.Env.includes('SCOPE=' + label));
    if (secrets) assert.ok(details.Config.Env.includes('TOKEN=' + secret));
    const actual = await command(
      `stat -Lc '%d:%i' /proc/${details.State.Pid}/ns/net /run/netns/sk-${project}`,
    );
    assert.equal(actual.split('\n')[0], actual.split('\n')[1]);
    const config = await within(project, () => workspaces!.config(vmId));
    await within(project, () =>
      assert.rejects(
        workspaces!.save(vmId, { ...config, directory: '/workspace/moved' }),
        /移除项目容器并停止/,
      ),
    );
    await within(project, () =>
      assert.rejects(workspaces!.save(vmId, { ...config, networkIsolation: 'host' }), /移除项目容器并停止/),
    );
  }
  const [alpha, beta] = projects,
    alphaConfig = await within(alpha, () => workspaces!.config(vmId));
  assert.equal(
    (await view('default')).containers.length,
    0,
    'private containers are absent from the shared daemon',
  );
  const hostRefusal = await machines.exec(
    vmId,
    `python3 -I -S -c ${quote("import socket; s=socket.socket(); s.settimeout(2); s.connect(('127.0.0.1',18080))")}`,
    5000,
  );
  assert.notEqual(hostRefusal.code, 0);
  const privateRefusal = await machines.exec(
    vmId,
    privateDockerCommand(
      alphaConfig,
      `python3 -I -S -c ${quote("import socket; s=socket.socket(); s.settimeout(2); s.connect(('1.1.1.1',443))")}`,
      false,
    ),
    5000,
  );
  assert.notEqual(privateRefusal.code, 0);
  console.log(
    `${distro}: two project Docker/containerd pairs, identical ports, actual namespaces, secret loading and traffic isolation passed`,
  );
  await containers.close();
  await within(alpha, () =>
    assert.rejects(
      workspaces!.save(vmId, { ...alphaConfig, directory: '/workspace/moved' }),
      /移除项目容器并停止/,
    ),
  );
  containers = new Containers(machines, workspaces);
  assert.equal((await view(alpha)).runtime?.valid, true);
  await traffic(beta, 'beta');
  await action(alpha, { action: 'compose-down', file: 'compose.yaml' });
  await machines.writeGuestFile(
    vmId,
    alphaConfig.directory + '/Dockerfile',
    `FROM ${image}\nRUN /bin/busybox readlink /proc/self/ns/net > /build-net; echo ${randomUUID()} > /build-check\n`,
    true,
  );
  await action(alpha, { action: 'dockerfile-up', file: 'Dockerfile' });
  const built = (await view(alpha)).containers[0];
  const p = privateDockerPaths(alpha);
  const buildNetwork = await command(
    `${p.config}/docker-client exec ${built.ID} /bin/busybox cat /build-net`,
  );
  assert.equal(
    buildNetwork,
    await command(`nsenter --net=/run/netns/sk-${alpha} -- readlink /proc/self/ns/net`),
  );
  if (secrets) {
    const check = await command(
      `${p.config}/docker-client exec ${built.ID} /bin/busybox sh -c ${quote('test "$TOKEN" != ""; test "$SCOPE" = alpha; printf %s passed')}`,
    );
    assert.equal(check, 'passed');
  }
  await action(alpha, { action: 'stop', id: built.ID });
  await action(alpha, { action: 'start', id: built.ID });
  await action(alpha, { action: 'restart', id: built.ID });
  await action(alpha, { action: 'stop', id: built.ID });
  await action(alpha, { action: 'remove', id: built.ID });
  for (const args of [
    ['--host=unix:///var/run/docker.sock', 'ps'],
    ['-Hunix:///var/run/docker.sock', 'ps'],
    ['run', '--network=bridge', image, 'sleep', '10'],
    ['run', '--privileged', image, 'sleep', '10'],
    ['run', '--cap-add=NET_ADMIN', image, 'sleep', '10'],
    ['run', '--cap-add=CAP_NET_ADMIN', image, 'sleep', '10'],
    ['run', '--restart=always', image, 'sleep', '10'],
  ]) {
    const rejected = await machines.exec(
      vmId,
      `${p.config}/docker-client ${args.map(quote).join(' ')}`,
      10_000,
    );
    assert.notEqual(rejected.code, 0, 'private client must refuse endpoint, network and privilege overrides');
  }
  console.log(`${distro}: installing the official Dev Container CLI`);
  await action('default', { action: 'install-devcontainer-cli' });
  const devconfig = alphaConfig.directory + '/.devcontainer.json';
  const dev = {
    image,
    remoteUser: 'root',
    updateRemoteUserUID: false,
    userEnvProbe: 'none',
    workspaceFolder: '/workspace',
    workspaceMount: 'source=' + alphaConfig.directory + ',target=/workspace,type=bind',
    containerEnv: { SCOPE: '${localEnv:SCOPE}', ...(secrets ? { TOKEN: '${localEnv:TOKEN}' } : {}) },
  };
  await machines.writeGuestFile(vmId, devconfig, JSON.stringify(dev), true);
  await action(alpha, { action: 'devcontainer-up' });
  const devContainer = (await view(alpha)).containers[0];
  assert.ok(devContainer);
  const devDetail = JSON.parse(await command(`${p.config}/docker-client inspect ${devContainer.ID}`))[0];
  assert.equal(devDetail.HostConfig.NetworkMode, 'host');
  assert.equal(devDetail.HostConfig.RestartPolicy.Name, 'no');
  assert.ok(devDetail.Config.Env.includes('SCOPE=alpha'));
  if (secrets) assert.ok(devDetail.Config.Env.includes('TOKEN=' + secret));
  await action(alpha, { action: 'stop', id: devContainer.ID });
  await action(alpha, { action: 'remove', id: devContainer.ID });
  const { image: _sourceImage, ...devBuild } = dev;
  await machines.writeGuestFile(
    vmId,
    devconfig,
    JSON.stringify({ ...devBuild, build: { dockerfile: 'Dockerfile' } }),
    true,
  );
  await action(alpha, { action: 'devcontainer-up' });
  const devBuilt = (await view(alpha)).containers[0];
  assert.equal(
    await command(`${p.config}/docker-client exec ${devBuilt.ID} /bin/busybox cat /build-net`),
    await command(`nsenter --net=/run/netns/sk-${alpha} -- readlink /proc/self/ns/net`),
  );
  await action(alpha, { action: 'stop', id: devBuilt.ID });
  await action(alpha, { action: 'remove', id: devBuilt.ID });
  await machines.writeGuestFile(
    vmId,
    devconfig,
    JSON.stringify({ ...dev, runArgs: ['--cap-add=NET_ADMIN'] }),
    true,
  );
  await action(alpha, { action: 'devcontainer-up' }, /不能修改项目网络/);
  assert.equal((await view(alpha)).containers.length, 0);
  await machines.writeGuestFile(
    vmId,
    devconfig,
    JSON.stringify({
      dockerComposeFile: 'compose.yaml',
      service: 'app',
      workspaceFolder: '/site',
      remoteUser: 'root',
      updateRemoteUserUID: false,
      userEnvProbe: 'none',
    }),
    true,
  );
  await action(alpha, { action: 'devcontainer-up' });
  await traffic(alpha, 'alpha');
  const composeDev = (await view(alpha)).containers[0];
  assert.equal(
    JSON.parse(await command(`${p.config}/docker-client inspect ${composeDev.ID}`))[0].HostConfig
      .RestartPolicy.Name,
    'no',
  );
  await action(alpha, { action: 'stop', id: composeDev.ID });
  await action(alpha, { action: 'remove', id: composeDev.ID });
  console.log(`${distro}: Dev Container image/Compose configurations and privilege override refusal passed`);
  const redisSource = process.env.SAKURA_REDIS_SMOKE_IMAGE;
  if (redisSource) {
    assert.match(redisSource, /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$/);
    await command(
      `docker --host unix:///var/run/docker.sock image inspect ${quote(redisSource)} >/dev/null 2>&1 || docker --host unix:///var/run/docker.sock pull ${quote(redisSource)}\n` +
        `docker --host unix:///var/run/docker.sock tag ${quote(redisSource)} redis:7-alpine`,
      300_000,
    );
    console.log(`${distro}: Redis image prepared from ${redisSource}`);
  }
  features = new FeatureSuite(machines, workspaces, {
    privateDatabase: (...args) => containers!.privateDatabase(...args),
  });
  const databasePassword = 'redis-' + randomUUID();
  const databaseKey = randomUUID();
  for (const project of projects) {
    await within(project, async () =>
      features!.dev(vmId, {
        operation: 'database',
        database: 'redis',
        name: 'private-redis',
        port: 16379,
        password: databasePassword,
      }),
    );
    const key = (await within(project, async () => workspaces!.projects.key(vmId))) + ':dev';
    await features.jobs.wait(key);
    const databaseJob: JobView = features.jobs.view(key)!;
    assert.equal(databaseJob.status, 'done', databaseJob.error + '\n' + databaseJob.log);
    assert.ok(!databaseJob.log.includes(databasePassword));
    const databaseConfig = await within(project, () => workspaces!.config(vmId));
    const redis =
      `import socket,time\n` +
      `def query(*args,authenticated=False):\n    s=socket.create_connection(('127.0.0.1',16379),2)\n    def send(values):\n        payload='*'+str(len(values))+'\\r\\n'+''.join('$'+str(len(v))+'\\r\\n'+v+'\\r\\n' for v in values)\n        s.sendall(payload.encode()); return s.recv(4096).decode()\n    if authenticated: assert send(['AUTH',${JSON.stringify(databasePassword)}])=='+OK\\r\\n'\n    result=send(args); s.close(); return result\n` +
      `end=time.time()+30\nwhile True:\n    try: assert query('AUTH',${JSON.stringify(databasePassword)})=='+OK\\r\\n'; break\n    except (OSError,AssertionError):\n        if time.time()>end: raise\n        time.sleep(0.2)\n` +
      `assert query('PING').startswith('-NOAUTH')\n` +
      `assert query('GET',${JSON.stringify(databaseKey)},authenticated=True)=='$-1\\r\\n'\n` +
      `assert query('SET',${JSON.stringify(databaseKey)},${JSON.stringify(project)},authenticated=True)=='+OK\\r\\n'\n` +
      `assert ${JSON.stringify(project)} in query('GET',${JSON.stringify(databaseKey)},authenticated=True)\nprint('authenticated')`;
    await command(privateDockerCommand(databaseConfig, `python3 -I -S -c ${quote(redis)}`, false), 45_000);
    assert.ok(!JSON.stringify(await view(project)).includes(databasePassword));
    const db = (await view(project)).containers.find((item: any) => item.Names === 'private-redis')!;
    const logs = await within(project, () => containers!.logs(vmId, db.ID));
    assert.ok(!logs.log.includes(databasePassword));
  }
  const redactionContainer = await command(
    `${p.config}/docker-client run -d --name redaction-check --env ${quote('MYSQL_PASSWORD=' + databasePassword)} ${image} /bin/sh -c ${quote('echo "$MYSQL_PASSWORD"; sleep 600')}`,
  );
  await delay(500);
  const redacted = await within(alpha, () => containers!.logs(vmId, redactionContainer));
  assert.ok(!redacted.log.includes(databasePassword));
  assert.ok(redacted.log.includes('[私密配置已隐藏]'));
  await action(alpha, { action: 'stop', id: redactionContainer });
  await action(alpha, { action: 'remove', id: redactionContainer });
  const sharedDatabase = await machines.exec(
    vmId,
    `python3 -I -S -c ${quote("import socket; socket.create_connection(('127.0.0.1',16379),2)")}`,
    5000,
  );
  assert.notEqual(sharedDatabase.code, 0);
  console.log(
    `${distro}: automation database preset, identical Redis ports, real authentication and shared-network refusal passed`,
  );
  for (const project of projects) {
    const db = (await view(project)).containers.find((item: any) => item.Names === 'private-redis')!;
    await action(project, { action: 'stop', id: db.ID });
    await action(project, { action: 'remove', id: db.ID });
  }
  await features.close();
  features = undefined;
  const bindingPath = p.config + '/binding.json',
    binding = await command(`cat ${bindingPath}`);
  await machines.writeGuestFile(
    vmId,
    bindingPath,
    JSON.stringify({ ...JSON.parse(binding), version: 99 }),
    true,
  );
  assert.equal((await view(alpha)).runtime?.valid, false);
  await action(alpha, { action: 'start-project-runtime' }, /绑定已变化/);
  await machines.writeGuestFile(vmId, bindingPath, binding, true);
  await machines.suspend(vmId);
  assert.equal((await view(alpha)).available, false);
  await within(alpha, () =>
    assert.rejects(containers!.run(vmId, { action: 'start-project-runtime' }), /请先启动/),
  );
  await within(alpha, () =>
    assert.rejects(workspaces!.save(vmId, { ...alphaConfig, networkIsolation: 'host' }), /恢复|暂停/),
  );
  await machines.resume(vmId);
  const beforeCancel = await command(
    "find /tmp -maxdepth 1 -name '.sakura-compose-*' -o -name '.sakura-image-*'",
  );
  await machines.writeGuestFile(
    vmId,
    alphaConfig.directory + '/cancel.Dockerfile',
    `FROM ${image}\nRUN /bin/busybox sleep 600\n`,
    true,
  );
  await within(alpha, () => containers!.run(vmId, { action: 'dockerfile-up', file: 'cancel.Dockerfile' }));
  const buildDeadline = Date.now() + 45_000;
  while (!(await command(`${p.config}/docker-client ps -q`))) {
    const current: JobView = containers.jobs.view(vmId)!;
    assert.equal(current.status, 'running', current.error + '\n' + current.log);
    assert.ok(Date.now() < buildDeadline, 'build container must start before cancellation');
    await delay(200);
  }
  containers.jobs.cancel(vmId);
  await containers.jobs.wait(vmId);
  assert.equal(containers.jobs.view(vmId)?.status, 'cancelled');
  await delay(1000);
  assert.equal(
    (await view(alpha)).containers.length,
    0,
    'cancelled Docker build must release intermediate containers',
  );
  assert.equal(
    await command("find /tmp -maxdepth 1 -name '.sakura-compose-*' -o -name '.sakura-image-*'"),
    beforeCancel,
  );
  await traffic(beta, 'beta');
  console.log(`${distro}: binding tampering refusal and actual build cancellation cleanup passed`);
  await machines.writeGuestFile(
    vmId,
    alphaConfig.directory + '/bad-compose.yaml',
    `services:\n  bad:\n    image: ${image}\n    command: ["/bin/busybox", "sleep", "600"]\n`,
    true,
  );
  await action(alpha, { action: 'compose-up', file: 'bad-compose.yaml' }, /network_mode: host|不创建网络/);
  await machines.writeGuestFile(
    vmId,
    alphaConfig.directory + '/unused-network.yaml',
    `services:\n  bad:\n    image: ${image}\n    network_mode: host\n    command: ["/bin/busybox", "sleep", "600"]\nnetworks:\n  unused: {}\n`,
    true,
  );
  await action(alpha, { action: 'compose-up', file: 'unused-network.yaml' });
  assert.equal(
    (await view(alpha)).runtime?.valid,
    true,
    'unused network definitions must not create interfaces',
  );
  await action(alpha, { action: 'compose-down', file: 'unused-network.yaml' });
  assert.equal((await view(alpha)).containers.length, 0);
  await command(`ip -n sk-${alpha} route add blackhole 198.51.100.0/24`);
  await action(alpha, { action: 'dockerfile-up', file: 'Dockerfile' }, /路由/);
  await traffic(beta, 'beta');
  await command(`ip -n sk-${alpha} route del blackhole 198.51.100.0/24`);
  await action(alpha, { action: 'stop-project-runtime' });
  assert.equal((await view(alpha)).runtime?.running, false);
  await within(alpha, () => workspaces!.save(vmId, { ...alphaConfig, directory: '/workspace/rebound' }));
  await within(alpha, () => workspaces!.save(vmId, alphaConfig));
  await action(alpha, { action: 'start-project-runtime' });
  await action(alpha, { action: 'compose-up', file: 'compose.yaml' });
  await traffic(alpha, 'alpha');
  await command('sync');
  await machines.stop(vmId, true);
  await boot();
  for (const project of projects)
    assert.equal(
      (await view(project)).runtime?.running,
      false,
      'private Docker does not auto-start at guest boot',
    );
  await action(alpha, { action: 'start-project-runtime' });
  const recovered = (await view(alpha)).containers[0];
  assert.match(recovered.Status, /Exited|Created/);
  await action(alpha, { action: 'start', id: recovered.ID });
  await traffic(alpha, 'alpha');
  await action(alpha, { action: 'compose-down', file: 'compose.yaml' });
  await action(alpha, { action: 'stop-project-runtime' });
  await action(beta, { action: 'start-project-runtime' });
  await action(beta, { action: 'compose-down', file: 'compose.yaml' });
  await action(beta, { action: 'stop-project-runtime' });
  console.log(
    `${distro}: Dockerfile build network, lifecycle, invalid Compose and route refusal, rebinding and real VM reboot recovery passed`,
  );
} catch (error) {
  if (vmId && machines.state(vmId) === 'running')
    console.error(
      await machines
        .exec(
          vmId,
          'journalctl -u "sakura-docker-*" -n 15 --no-pager; node --version; node --jitless -e "console.log(process.version)"; npm --version; journalctl -k -n 8 --no-pager; ps -eo pid,ppid,comm',
          30_000,
        )
        .catch(() => null),
    );
  throw error;
} finally {
  await features?.close();
  await containers?.close();
  await workspaces?.close();
  if (vmId && machines.live.has(vmId)) await machines.stop(vmId, true).catch(() => {});
  await machines.close();
  if (process.env.SAKURA_KEEP_CONTAINER_SMOKE === '1') console.log('Retained owned fixture:', owned);
  else {
    assert.equal(dirname(await realpath(directory)), await realpath(tmpdir()));
    assert.match(basename(owned), /^sakura-(private-containers|container-probe)-/);
    await rm(owned, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
