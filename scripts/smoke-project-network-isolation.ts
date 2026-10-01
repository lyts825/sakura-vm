import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const distro = process.argv[2] || process.env.SAKURA_TEST_DISTRO || 'alpine';
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro), 'unsupported smoke distro');
const imageName = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2',
  ubuntu: 'ubuntu-24.04.qcow2' }[distro]!;
const directory = await mkdtemp(join(tmpdir(), 'sakura-project-netns-'));
await mkdir(join(directory, 'images'), { recursive: true });
await copyFile(resolve('.data/images', imageName), join(directory, 'images', imageName));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = join(directory, 'images');
process.env.SAKURA_IMAGE_PATH = join(directory, 'images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Features } = await import('../server/features.ts');
const { CommandPresets } = await import('../server/command-presets.ts');
const { Pipelines } = await import('../server/pipelines.ts');
const { GitWorkbench } = await import('../server/git-workbench.ts');
const { RuntimeVersions } = await import('../server/runtime-versions.ts');
const { Toolchains } = await import('../server/toolchains.ts');
const { Ide } = await import('../server/ide.ts');
const { projectNetworkCommand, projectPrivateShellCommand } = await import('../server/project-network-isolation.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const features = await Features.create(machines, ['projects', 'service-health']);
const commands = new CommandPresets(machines, features.workspaces);
const pipelines = new Pipelines(machines, features.workspaces, features.files);
const git = new GitWorkbench(machines, features.workspaces);
const runtimes = new RuntimeVersions(machines, features.workspaces);
const toolchains = new Toolchains(machines, features.workspaces);
const ide = new Ide(machines, features.workspaces, join(directory, 'host-ssh'));
async function command(id: string, script: string, timeout = 10_000) {
  const result = await machines.exec(id, script, timeout);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
async function job(id: string, projectId = 'default') {
  const key = projectId === 'default' ? id : `${id}:${projectId}`;
  await features.workspaces.jobs.wait(key);
  const result = features.workspaces.jobs.view(key);
  assert.equal(result?.status, 'done', result?.error + '\n' + result?.log);
}
async function interactiveProjectShell(id: string, command: string) {
  const ssh = await machines.connect(id);
  try {
    await new Promise<void>((resolve, reject) => {
      ssh.exec(command, { pty: { term: 'xterm-256color', cols: 80, rows: 24 } },
        (error, stream) => {
          if (error) return reject(error);
          let stderr = '', stdout = '';
          const timeout = setTimeout(() => reject(new Error('project shell did not close: ' + stdout + stderr)), 15_000);
          stream.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-4096); });
          stream.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
          stream.on('error', reject);
          stream.on('close', (code: number) => {
            clearTimeout(timeout);
            code === 0 ? resolve() : reject(new Error(stderr || stdout || `project shell exited ${code}`));
          });
          stream.end('readlink /proc/self/ns/net > /workspace/first-shell.ns\n' +
            'ip -4 route show > /workspace/first-shell.routes\nexit\n');
        });
    });
  } finally { ssh.end(); }
}
try {
  const vm = await machines.create({ name: `project-netns-${distro}`, distro: distro as
    'alpine' | 'debian' | 'ubuntu', memoryMiB: 1024, cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300_000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(vm.id)))
      throw new Error(machines.logs.get(vm.id));
    await delay(250);
  }
  const hostNamespace = await command(vm.id, 'readlink /proc/self/ns/net');
  await ide.update();
  const sshConfig = join(directory, 'ssh', 'config');
  const originalSshConfig = await readFile(sshConfig, 'utf8');
  if (distro === 'alpine') assert.doesNotMatch(originalSshConfig, new RegExp(`Host sakura-${vm.name}`));
  else assert.match(originalSshConfig, new RegExp(`Host sakura-${vm.name}`));
  await features.workspaces.save(vm.id, { directory: '/workspace/first',
    networkIsolation: 'private',
    environment: { SAKURA_SCOPE: 'private' },
    setup: 'test "$SAKURA_SCOPE" = private; readlink /proc/self/ns/net > /workspace/first-setup.ns',
    command: 'readlink /proc/self/ns/net > /workspace/first.ns; exec sleep 600' });
  assert.doesNotMatch(await readFile(sshConfig, 'utf8'),
    new RegExp(`Host sakura-${vm.name}`));
  const privateIde = await ide.view(vm.id);
  assert.equal(privateIde.supported, true);
  assert.ok('projectScoped' in privateIde && privateIde.projectScoped);
  assert.equal(privateIde.command, '');
  if (distro === 'alpine') {
    assert.equal(privateIde.vscodeSupported, false);
    assert.equal(privateIde.url, '');
  }
  await features.workspaces.run(vm.id, 'start');
  await job(vm.id);
  const firstNamespace = await command(vm.id, 'cat /workspace/first.ns');
  assert.equal(await command(vm.id, 'cat /workspace/first-setup.ns'), firstNamespace);
  await interactiveProjectShell(vm.id,
    projectPrivateShellCommand(await features.workspaces.config(vm.id)));
  assert.equal(await command(vm.id, 'cat /workspace/first-shell.ns'), firstNamespace);
  assert.equal(await command(vm.id, 'cat /workspace/first-shell.routes'), '');
  assert.notEqual(firstNamespace, hostNamespace);
  assert.equal(await command(vm.id, 'ip netns exec sk-default ip -4 route show'), '');
  await command(vm.id, `mkdir -p /usr/local/bin /opt/sakura-runtimes/node-1.2.3/bin
cat > /usr/local/bin/node <<'SAKURA_NODE_PROBE'
#!/bin/sh
readlink /proc/self/ns/net > /workspace/first-tool-probe.ns
echo v1.2.3
SAKURA_NODE_PROBE
cat > /opt/sakura-runtimes/node-1.2.3/bin/node <<'SAKURA_RUNTIME_PROBE'
#!/bin/sh
readlink /proc/self/ns/net > /workspace/first-selected-runtime.ns
echo v1.2.3
SAKURA_RUNTIME_PROBE
chmod 755 /usr/local/bin/node /opt/sakura-runtimes/node-1.2.3/bin/node`);
  assert.equal((await runtimes.inspect(vm.id,
    await features.workspaces.config(vm.id))).node, '1.2.3');
  assert.equal(await command(vm.id, 'cat /workspace/first-tool-probe.ns'), firstNamespace);
  await command(vm.id, 'rm /workspace/first-tool-probe.ns');
  await toolchains.view(vm.id);
  assert.equal(await command(vm.id, 'cat /workspace/first-tool-probe.ns'), firstNamespace);
  await runtimes.select(vm.id, { node: '1.2.3' });
  assert.equal(await command(vm.id, 'cat /workspace/first-selected-runtime.ns'), firstNamespace);
  await command(vm.id, 'ip -n sk-default route add blackhole 203.0.113.0/24');
  try {
    const guarded = await machines.exec(vm.id,
      projectNetworkCommand(await features.workspaces.config(vm.id),
        'touch /workspace/private-route-bypass'));
    assert.notEqual(guarded.code, 0, 'managed command ran after a route appeared');
    await command(vm.id, 'test ! -e /workspace/private-route-bypass');
  } finally {
    await command(vm.id, 'ip -n sk-default route del blackhole 203.0.113.0/24');
  }
  const gitPath = await command(vm.id, 'command -v git');
  assert.match(gitPath, /^\/[A-Za-z0-9/._+-]+$/);
  await command(vm.id, `mv ${gitPath} ${gitPath}.sakura-real
cat > ${gitPath} <<'SAKURA_GIT_PROBE'
#!/bin/sh
readlink /proc/self/ns/net > /workspace/first-git.ns
if [ "$1" = clone ]; then
  readlink /proc/self/ns/net > /workspace/second-clone.ns
  test -z "$SAKURA_PRIVATE_ENV" || exit 1
  mkdir -p /workspace/second
  cp -R /workspace/source-repo/.git /workspace/second/.git
  exit 0
fi
if [ "$1" = -C ] && [ "$3" = checkout ]; then
  readlink /proc/self/ns/net > /workspace/second-checkout.ns
  test "$SAKURA_PRIVATE_ENV" = inside || exit 1
fi
exec ${gitPath}.sakura-real "$@"
SAKURA_GIT_PROBE
chmod 755 ${gitPath}`);
  await git.view(vm.id);
  assert.equal(await command(vm.id, 'cat /workspace/first-git.ns'), firstNamespace);
  await command(vm.id, `mkdir -p /workspace/source-repo
${gitPath}.sakura-real -C /workspace/source-repo init -q
printf 'isolated checkout\n' > /workspace/source-repo/README
${gitPath}.sakura-real -C /workspace/source-repo add README
${gitPath}.sakura-real -C /workspace/source-repo -c user.name=Test -c user.email=test@example.invalid commit -qm initial`);
  const presets = await commands.save(vm.id, { name: 'namespace',
    command: 'readlink /proc/self/ns/net > /workspace/first-preset.ns' });
  await commands.run(vm.id, presets[0].id, {});
  await commands.jobs.wait(vm.id);
  assert.equal(commands.jobs.view(vm.id)?.status, 'done');
  assert.equal(await command(vm.id, 'cat /workspace/first-preset.ns'), firstNamespace);
  const pipeline = await pipelines.save(vm.id, { name: 'namespace', steps: [{ name: 'record',
    command: 'readlink /proc/self/ns/net > /workspace/first-pipeline.ns' }] });
  await pipelines.run(vm.id, pipeline.id);
  await pipelines.jobs.wait(vm.id);
  assert.equal(pipelines.jobs.view(vm.id)?.status, 'done');
  assert.equal(await command(vm.id, 'cat /workspace/first-pipeline.ns'), firstNamespace);
  await assert.rejects(features.workspaces.save(vm.id, { directory: '/workspace/first',
    networkIsolation: 'host',
    command: 'exec sleep 600' }), /请先停止运行中的项目/);
  const index = await features.workspaces.projects.create(vm.id, 'Second project',
    async () => { await features.workspaces.save(vm.id, { directory: '/workspace/second',
      networkIsolation: 'private', repository: 'https://example.invalid/repo',
      environment: { SAKURA_PRIVATE_ENV: 'inside' },
      services: [{ name: 'api',
        command: 'readlink /proc/self/ns/net > /workspace/second.ns; exec sleep 600',
        ready: 'test "$(readlink /proc/self/ns/net)" = "$(cat /workspace/second.ns)"' }] }); });
  const secondId = index.active;
  await features.workspaces.projects.with(vm.id, secondId, async () => {
    await features.workspaces.run(vm.id, 'start');
    await job(vm.id, secondId);
  });
  const secondNamespace = await command(vm.id, 'cat /workspace/second.ns');
  assert.notEqual(secondNamespace, hostNamespace);
  assert.notEqual(secondNamespace, firstNamespace);
  assert.equal(await command(vm.id, 'cat /workspace/second-clone.ns'), hostNamespace);
  assert.equal(await command(vm.id, 'cat /workspace/second-checkout.ns'), secondNamespace);
  assert.equal(await command(vm.id, 'cat /workspace/second/README'), 'isolated checkout');
  assert.equal(await command(vm.id, `ip netns exec sk-${secondId} ip -4 route show`), '');
  await features.workspaces.projects.with(vm.id, secondId, async () => {
    await features.workspaces.run(vm.id, 'stop');
    await job(vm.id, secondId);
  });
  await features.workspaces.projects.with(vm.id, 'default', async () => {
    await features.workspaces.run(vm.id, 'stop');
    await job(vm.id);
  });
  assert.equal(await command(vm.id, 'ip netns list'), '');
  await features.workspaces.projects.with(vm.id, secondId, async () => {
    await features.workspaces.save(vm.id, { directory: '/workspace/second',
      networkIsolation: 'host' });
  });
  assert.doesNotMatch(await readFile(sshConfig, 'utf8'),
    new RegExp(`Host sakura-${vm.name}`));
  await features.workspaces.projects.with(vm.id, 'default', async () => {
    await features.workspaces.save(vm.id, { directory: '/workspace/first',
      networkIsolation: 'host' });
  });
  const restoredSshConfig = await readFile(sshConfig, 'utf8');
  if (distro === 'alpine') assert.doesNotMatch(restoredSshConfig, new RegExp(`Host sakura-${vm.name}`));
  else assert.match(restoredSshConfig, new RegExp(`Host sakura-${vm.name}`));
  console.log(`Real ${distro} project namespaces, setup, services, Git, presets, pipelines and cleanup passed`);
} finally {
  await commands.close();
  await pipelines.close();
  await git.close();
  await runtimes.close();
  await toolchains.close();
  await ide.close();
  await features.close();
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-project-netns-'));
  await rm(directory, { recursive: true, force: true });
}
