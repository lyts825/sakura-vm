import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import ssh2 from 'ssh2';

const distro = process.argv[2] || 'debian';
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro));
if (process.env.SAKURA_SSH_STOP_RECOVERY_ONLY === '1') assert.equal(distro, 'alpine');
if (distro === 'alpine' && (process.env.SAKURA_SSH_VSCODE_ARCHIVE || process.env.SAKURA_SSH_VSCODE_CLIENT))
  throw new Error('Alpine 只验证普通项目 SSH/SFTP；VS Code Remote-SSH 不支持该客户机');
const directory = resolve(process.argv[3] || (await mkdtemp(join(tmpdir(), 'sakura-project-ssh-'))));
const owned = await realpath(directory);
assert.equal(dirname(owned), await realpath(tmpdir()));
assert.match(basename(owned), /^sakura-project-ssh-/);
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve(
  '.data/images',
  { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' }[distro]!,
);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Secrets } = await import('../server/secrets.ts');
const { Ide } = await import('../server/ide.ts');
const { quote } = await import('../server/files.ts');
const { vmDir } = await import('../server/model.ts');
const { runReport } = await import('../server/capability-reports.ts');
const { secureSshPaths } = await import('../server/ssh-files.ts');
const { projectVscodeClientSmoke } = await import('./project-vscode-client-smoke.ts');
const { projectNeovimClientSmoke } = await import('./project-neovim-client-smoke.ts');
const machines = new Machines(await createRuntime());
const guestExec = machines.exec.bind(machines);
let execution = 0;
machines.exec = async (...args: Parameters<typeof machines.exec>) => {
  const sequence = ++execution,
    began = Date.now();
  const origin = new Error('Guest execution call site').stack;
  if (process.env.SAKURA_SSH_TRACE_EXEC === '1') console.log(`guest exec ${sequence} started`, origin);
  try {
    const result = await guestExec(...args);
    if (process.env.SAKURA_SSH_TRACE_EXEC === '1')
      console.log(`guest exec ${sequence} finished after ${Date.now() - began}ms, code=${result.code}`);
    return result;
  } catch (error) {
    // Caller locations identify the lifecycle step without logging commands or secrets.
    console.error(`guest exec ${sequence} failed after ${Date.now() - began}ms`, origin);
    throw error;
  }
};
let vmId = '',
  workspaces: InstanceType<typeof Workspaces> | undefined,
  ide: InstanceType<typeof Ide> | undefined;
const privateValue = 'project-ssh-' + randomUUID();
const run = promisify(execFile);
const ssh =
  process.platform === 'win32'
    ? join(process.env.SystemRoot || 'C:/Windows', 'System32/OpenSSH/ssh.exe')
    : 'ssh';
const sftpClient =
  process.platform === 'win32'
    ? join(process.env.SystemRoot || 'C:/Windows', 'System32/OpenSSH/sftp.exe')
    : 'sftp';
const sftpPath = (value: string) => '"' + value.replaceAll('\\', '/').replaceAll('"', '\\"') + '"';
const within = <T>(project: string, action: () => Promise<T>) =>
  workspaces!.projects.with(vmId, project, action);
async function command(script: string) {
  const result = await machines.exec(vmId, script, 30_000);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}
async function external(alias: string, script: string, timeout = 30_000) {
  const result = await run(
    ssh,
    [
      '-F',
      join(directory, 'ssh-client/config'),
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-T',
      alias,
      script,
    ],
    { timeout, encoding: 'utf8' },
  );
  return result.stdout.trim();
}
type TestProject = { id: string; name: string; path: string; alias: string };
async function clientFor(project: TestProject, keyProject = project.id) {
  const record = JSON.parse(
    await readFile(join(vmDir(vmId), 'project-ssh', project.id, 'runtime.json'), 'utf8'),
  );
  const raw = ssh2.utils.parseKey(record.hostPublicKey);
  assert.ok(!(raw instanceof Error) && !Array.isArray(raw));
  const config = await readFile(join(directory, 'ssh/config'), 'utf8');
  const block = config.split('Host ' + project.alias + '\n')[1].split('\nHost ')[0];
  const port = Number(/\n\s+Port (\d+)/.exec('\n' + block)?.[1]);
  assert.ok(Number.isInteger(port) && port > 1024);
  const privateKey = await readFile(join(vmDir(vmId), 'project-ssh', keyProject, 'id_rsa'));
  const client = new ssh2.Client();
  // Authentication refusal can be followed by a socket reset during destroy.
  client.on('error', () => {});
  try {
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', reject);
      client.connect({
        host: '127.0.0.1',
        port,
        username: 'root',
        privateKey,
        hostVerifier: (key: Buffer) => key.equals(raw.getPublicSSH()),
        readyTimeout: 10_000,
      });
    });
    return client;
  } catch (error) {
    client.destroy();
    throw error;
  }
}
async function forwardHttp(client: ssh2.Client, port: number, path: string) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SSH HTTP forwarding timed out')), 15_000);
    client.forwardOut('127.0.0.1', 0, '127.0.0.1', port, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
      stream.once('end', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString());
      });
      stream.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
  });
}
async function alpineReceiptStopRecovery(projects: TestProject[]) {
  const [alpha, beta] = projects;
  const runtime = '/run/sakura-project-ssh/' + alpha.id;
  const receipt = runtime + '/owner.json';
  const group = '/sys/fs/cgroup/openrc.sakura-ssh-' + alpha.id;
  const writeOwner = (text: string) =>
    command(`printf '%s' ${quote(Buffer.from(text).toString('base64'))} | base64 -d >${receipt}`);
  const betaOwner = await command(`cat /run/sakura-project-ssh/${beta.id}/owner.json`);
  const assertBeta = async () => {
    const view = await within(beta.id, () => ide!.view(vmId));
    assert.ok('runtime' in view && view.runtime?.valid);
    assert.equal(await command(`cat /run/sakura-project-ssh/${beta.id}/owner.json`), betaOwner);
    assert.equal(await external(beta.alias, 'printf %s "$SAKURA_SCOPE"'), beta.name);
  };
  const cases: Array<{ name: string; value: (owner: Record<string, unknown>) => string }> = [
    { name: 'bad JSON', value: () => '{' },
    { name: 'missing PID', value: (owner) => JSON.stringify({ ...owner, pid: undefined }) },
    { name: 'invalid PID type', value: (owner) => JSON.stringify({ ...owner, pid: String(owner.pid) }) },
    { name: 'old boot ID', value: (owner) => JSON.stringify({ ...owner, bootId: randomUUID() }) },
    { name: 'old start ticks', value: (owner) => JSON.stringify({ ...owner, startTicks: '0' }) },
  ];
  for (const item of cases) {
    const owner = JSON.parse(await command(`cat ${receipt}`));
    const detached = Number(
      await external(alpha.alias, 'setsid sleep 600 >/dev/null 2>&1 </dev/null & echo $!'),
    );
    assert.equal(await command(`cat /proc/${detached}/cgroup`), '0::/openrc.sakura-ssh-' + alpha.id);
    const client = await clientFor(alpha);
    let closed = false;
    client.once('close', () => {
      closed = true;
    });
    const damaged = item.value(owner);
    try {
      await writeOwner(damaged);
      const stopped = await within(alpha.id, () => ide!.stop(vmId));
      assert.ok('runtime' in stopped && !stopped.runtime?.running && !stopped.runtime?.valid);
      assert.equal('sshCommand' in stopped && stopped.sshCommand, '');
      const deadline = Date.now() + 5000;
      while (!closed && Date.now() < deadline) await delay(20);
      assert.equal(closed, true, 'stopping a damaged receipt closes already authenticated bridges');
      assert.equal(await command(`if [ -e ${group} ]; then echo live; fi`), '');
      assert.equal(
        await command(
          `if [ -e /proc/${owner.pid}/stat ] || [ -e /proc/${detached}/stat ]; then echo live; fi`,
        ),
        '',
      );
      assert.equal(
        await command(
          `for state in started starting stopping inactive failed wasinactive; do path=/run/openrc/$state/sakura-ssh-${alpha.id}; if [ -e "$path" ] || [ -L "$path" ]; then echo "$state"; fi; done`,
        ),
        '',
      );
      assert.equal(
        await command(`cat ${receipt}`),
        damaged,
        'stop succeeds while the receipt remains damaged',
      );
      assert.ok(
        !(await readFile(join(directory, 'ssh/config'), 'utf8')).includes('\nHost ' + alpha.alias + '\n') &&
          !(await readFile(join(directory, 'ssh/config'), 'utf8')).startsWith('Host ' + alpha.alias + '\n'),
      );
      await assertBeta();
      await within(alpha.id, () => ide!.stop(vmId));
      const rebuilt = await within(alpha.id, () => ide!.install(vmId));
      assert.ok('runtime' in rebuilt && rebuilt.runtime?.valid);
      assert.equal(await external(alpha.alias, 'printf %s "$SAKURA_SCOPE"'), alpha.name);
      assert.notEqual(JSON.parse(await command(`cat ${receipt}`)).runId, owner.runId);
      await assertBeta();
      console.log(
        `alpine: direct stop with ${item.name} clears cgroup, bridge and markers; repeated stop and rebuild pass; beta unchanged`,
      );
    } finally {
      client.destroy();
    }
  }
  const owner = JSON.parse(await command(`cat ${receipt}`));
  await writeOwner('{');
  await command(`printf '%s\\n' ${owner.pid} >/sys/fs/cgroup/cgroup.procs`);
  try {
    await assert.rejects(
      within(alpha.id, () => ide!.stop(vmId)),
      /子进程尚未停止/,
    );
    assert.equal(
      await command(`readlink /proc/${owner.pid}/exe`),
      '/usr/sbin/sshd',
      'stop never kills an unattributed main PID from a damaged receipt',
    );
    const outside = await within(alpha.id, () => ide!.view(vmId));
    assert.ok('runtime' in outside && outside.runtime?.running && !outside.runtime?.valid);
    assert.equal('sshCommand' in outside && outside.sshCommand, '');
    await assert.rejects(within(alpha.id, () => ide!.install(vmId)));
    const config = await within(alpha.id, () => workspaces!.config(vmId));
    await assert.rejects(
      within(alpha.id, () => workspaces!.save(vmId, { ...config, directory: config.directory + '-escaped' })),
      /停止项目 SSH/,
    );
    await assertBeta();
  } finally {
    await command(`mkdir -p ${group}; printf '%s\\n' ${owner.pid} >${group}/cgroup.procs`);
  }
  await within(alpha.id, () => ide!.stop(vmId));
  assert.equal(await command(`cat ${receipt}`), '{');
  const recovered = await within(alpha.id, () => ide!.install(vmId));
  assert.ok('runtime' in recovered && recovered.runtime?.valid);
  await assertBeta();
  console.log(
    'alpine: damaged receipt with matching sshd outside cgroup refuses stop/start/directory changes without killing it; restoring actual cgroup permits damaged stop and rebuild',
  );
}
async function waitBoot() {
  const deadline = Date.now() + 300_000;
  let progressAt = Date.now() + 60_000;
  while (machines.state(vmId) === 'starting' && Date.now() < deadline) {
    await delay(100);
    if (Date.now() > progressAt) {
      console.log(`${distro}: boot pending`, machines.logs.get(vmId)?.slice(-2000));
      progressAt = Date.now() + 60_000;
    }
  }
  assert.equal(machines.state(vmId), 'running', machines.logs.get(vmId));
}
try {
  await machines.init();
  const prior = [...machines.records.values()][0];
  if (prior) assert.equal(prior.name, 'project-ssh-' + distro);
  const vm =
    prior ||
    (await machines.create({
      name: 'project-ssh-' + distro,
      distro,
      memoryMiB: 2048,
      cpus: 2,
      diskGiB: 8,
      forwards: [],
    }));
  vmId = vm.id;
  await machines.start(vmId);
  await waitBoot();
  const secrets = process.platform === 'win32' ? new Secrets(machines) : undefined;
  if (secrets) await secrets.save(vmId, { name: 'project-ssh-token', value: privateValue });
  workspaces = new Workspaces(machines, { secrets });
  ide = new Ide(machines, workspaces, join(directory, 'ssh-client'));
  const projects: TestProject[] = [];
  for (const name of ['alpha', 'beta']) {
    const path = name === 'alpha' ? "/workspace/ssh alpha's project" : '/workspace/ssh-beta';
    const existing: { id: string; name: string } | undefined = (
      await workspaces.projects.list(vmId)
    ).projects.find((item) => item.name === name);
    const id: string =
      existing?.id ||
      (
        await workspaces.projects.create(vmId, name, () =>
          workspaces!
            .save(vmId, {
              directory: path,
              networkIsolation: 'private',
              environment: { SAKURA_SCOPE: name },
              ...(secrets ? { secrets: { TOKEN: 'project-ssh-token' } } : {}),
            })
            .then(() => {}),
        )
      ).active;
    await assert.rejects(
      within(id, () =>
        runReport(
          machines,
          workspaces!,
          vmId,
          'editor-profiles',
          { editor: 'neovim' },
          new AbortController().signal,
        ),
      ),
      /先在项目页配置/,
    );
    console.log(`${distro}: preparing SSH for ${name}`);
    await within(id, async () => {
      const current = await workspaces!.config(vmId);
      await workspaces!.save(vmId, {
        ...current,
        environment: {
          ...current.environment,
          original: 'project value',
          SSH_ORIGINAL_COMMAND: 'project value',
        },
      });
    });
    const view = await within(id, () => ide!.install(vmId));
    assert.equal(view.supported, true);
    assert.ok('runtime' in view && view.runtime?.valid);
    assert.equal(view.vscodeSupported, distro !== 'alpine');
    if (distro === 'alpine') {
      assert.equal(view.command, '');
      assert.equal(view.url, '');
      assert.ok('sshCommand' in view && view.sshCommand?.includes(view.alias));
      for (const editor of ['vscode', 'jetbrains'])
        await assert.rejects(
          within(id, () =>
            runReport(
              machines,
              workspaces!,
              vmId,
              'editor-profiles',
              { editor },
              new AbortController().signal,
            ),
          ),
          /Alpine/,
        );
    } else assert.ok(view.command.includes('ssh-remote+'));
    const result = (
      await external(view.alias, `pwd; printf '%s\\n' "$SAKURA_SCOPE"; readlink /proc/self/ns/net`)
    ).split('\n');
    assert.deepEqual(result.slice(0, 2), [path, name]);
    assert.equal(result[2], await command(`ip netns exec sk-${id} readlink /proc/self/ns/net`));
    assert.notEqual(result[2], await command('readlink /proc/1/ns/net'));
    assert.equal(await external(view.alias, 'printf %s "$HOME"'), '/var/lib/sakura/ssh/' + id);
    assert.equal(
      await external(view.alias, 'printf %s "$VSCODE_AGENT_FOLDER"'),
      '/var/lib/sakura/ssh/' + id + '/.vscode-server',
    );
    for (const editor of distro === 'alpine' ? ['neovim'] : ['jetbrains', 'neovim', 'vscode']) {
      const profile = await within(id, () =>
        runReport(machines, workspaces!, vmId, 'editor-profiles', { editor }, new AbortController().signal),
      );
      assert.equal(profile.projectScoped, true);
      assert.equal(profile.projectId, id);
      assert.equal(profile.networkIsolation, 'private');
      assert.notEqual(profile.port, machines.live.get(vmId)?.sshPort);
      assert.equal(profile.identityFile, join(vmDir(vmId), 'project-ssh', id, 'id_rsa'));
      const config = join(directory, editor + '-' + id + '.config');
      await writeFile(config, (profile.download as { content: string }).content, { mode: 0o600 });
      await secureSshPaths([config]);
      const exported = await run(
        ssh,
        ['-F', config, '-o', 'BatchMode=yes', '-T', String(profile.alias), 'pwd; readlink /proc/self/ns/net'],
        { timeout: 30_000, encoding: 'utf8' },
      );
      assert.deepEqual(exported.stdout.trim().split('\n'), [path, result[2]]);
    }
    if (secrets)
      assert.ok(
        (await external(view.alias, 'printf %s "$TOKEN"')) === privateValue,
        'project SSH must resolve the frozen secret without printing its value',
      );
    projects.push({ id, name, path, alias: view.alias });
    if (distro === 'alpine') {
      const stored = JSON.parse(await readFile(join(vmDir(vmId), 'project-ssh', id, 'runtime.json'), 'utf8'));
      assert.equal(stored.manager, 'openrc');
      const owner = JSON.parse(await command(`cat /run/sakura-project-ssh/${id}/owner.json`));
      assert.equal(owner.manager, 'openrc');
      assert.equal(owner.runId, stored.runId);
      assert.equal(owner.bootId, await command('cat /proc/sys/kernel/random/boot_id'));
      assert.equal(await command(`readlink /proc/${owner.pid}/exe`), '/usr/sbin/sshd');
      assert.equal(await command(`cat /proc/${owner.pid}/cgroup`), `0::/openrc.sakura-ssh-${id}`);
      assert.ok(Object.hasOwn(stored.files, `/etc/init.d/sakura-ssh-${id}`));
      assert.equal(Object.hasOwn(stored.files, `/etc/systemd/system/sakura-ssh-${id}.service`), false);
      const receipt = `/run/sakura-project-ssh/${id}/owner.json`;
      for (const invalid of ['{', JSON.stringify({ ...owner, pid: undefined })]) {
        await command(
          `printf '%s' ${quote(Buffer.from(invalid).toString('base64'))} | base64 -d >${receipt}`,
        );
        try {
          const malformed = await within(id, () => ide!.view(vmId));
          assert.ok(
            'runtime' in malformed && malformed.runtime?.running && !malformed.runtime?.valid,
            'invalid owner records never hide actual kernel-owned SSH processes',
          );
          assert.equal('sshCommand' in malformed && malformed.sshCommand, '');
          await assert.rejects(within(id, () => ide!.install(vmId)));
          assert.equal(
            JSON.parse(await readFile(join(vmDir(vmId), 'project-ssh', id, 'runtime.json'), 'utf8')).runId,
            stored.runId,
            'failed authority checks cannot replace a running service binding',
          );
          assert.equal(await command(`readlink /proc/${owner.pid}/exe`), '/usr/sbin/sshd');
        } finally {
          await command(
            `printf '%s' ${quote(Buffer.from(JSON.stringify(owner)).toString('base64'))} | base64 -d >${receipt}`,
          );
        }
      }
      await command(
        `printf '%s' ${quote(Buffer.from(JSON.stringify({ ...owner, runId: randomUUID() })).toString('base64'))} | base64 -d >${receipt}`,
      );
      try {
        const changedOwner = await within(id, () => ide!.view(vmId));
        assert.ok('runtime' in changedOwner && changedOwner.runtime?.running && !changedOwner.runtime?.valid);
        assert.equal('sshCommand' in changedOwner && changedOwner.sshCommand, '');
      } finally {
        await command(
          `printf '%s' ${quote(Buffer.from(JSON.stringify(owner)).toString('base64'))} | base64 -d >${receipt}`,
        );
      }
      await command(`printf '%s\\n' ${owner.pid} > /sys/fs/cgroup/cgroup.procs`);
      try {
        const unowned = await within(id, () => ide!.view(vmId));
        assert.ok('runtime' in unowned && unowned.runtime?.running && !unowned.runtime?.valid);
        const unchanged = await within(id, () => workspaces!.config(vmId));
        await assert.rejects(
          within(id, () => workspaces!.save(vmId, { ...unchanged, directory: path + '-unowned' })),
          /停止项目 SSH/,
        );
        await assert.rejects(
          within(id, () => ide!.stop(vmId)),
          /子进程尚未停止/,
        );
        assert.equal(
          await command(`readlink /proc/${owner.pid}/exe`),
          '/usr/sbin/sshd',
          'cleanup does not blindly kill a process outside the owned kernel group',
        );
      } finally {
        await command(
          `mkdir -p /sys/fs/cgroup/openrc.sakura-ssh-${id}; printf '%s\\n' ${owner.pid} >/sys/fs/cgroup/openrc.sakura-ssh-${id}/cgroup.procs`,
        );
      }
      const restored = await within(id, () => ide!.view(vmId));
      assert.ok('runtime' in restored && restored.runtime?.valid);
    }
  }
  console.log(
    `${distro}: independent OpenSSH authentication, directories, environments and actual namespaces passed`,
  );
  if (process.env.SAKURA_SSH_STOP_RECOVERY_ONLY === '1') {
    await alpineReceiptStopRecovery(projects);
    console.log('alpine: targeted damaged-receipt stop recovery passed');
  } else {
    for (const project of projects) {
      const localUpload = join(directory, 'openssh-sftp-' + project.name + '.txt');
      const localDownload = join(directory, 'openssh-sftp-' + project.name + '-download.txt');
      const batch = join(directory, 'openssh-sftp-' + project.name + '.batch');
      await writeFile(localUpload, 'OpenSSH SFTP ' + project.name);
      await writeFile(
        batch,
        `pwd\nput ${sftpPath(localUpload)} ${sftpPath(project.path + '/openssh-sftp.txt')}\n` +
          `get ${sftpPath(project.path + '/openssh-sftp.txt')} ${sftpPath(localDownload)}\nquit\n`,
      );
      const copied = await run(
        sftpClient,
        ['-F', join(directory, 'ssh-client/config'), '-o', 'BatchMode=yes', '-b', batch, project.alias],
        { timeout: 30_000, encoding: 'utf8' },
      );
      assert.ok(copied.stdout.includes(project.path));
      assert.equal(await readFile(localDownload, 'utf8'), 'OpenSSH SFTP ' + project.name);
      const escaped = await run(
        ssh,
        [
          '-F',
          join(directory, 'ssh-client/config'),
          '-o',
          'BatchMode=yes',
          '-T',
          project.alias,
          'python3 -I -S -c ' + quote("import socket; socket.create_connection(('1.1.1.1',443),2)"),
        ],
        { timeout: 10_000, encoding: 'utf8' },
      ).then(
        () => 0,
        (error: NodeJS.ErrnoException) => error.code,
      );
      assert.notEqual(escaped, 0);
      const client = await clientFor(project);
      try {
        const ftp = await new Promise<ssh2.SFTPWrapper>((resolve, reject) =>
          client.sftp((error, ftp) => (error ? reject(error) : resolve(ftp))),
        );
        const cwd = await new Promise<string>((resolve, reject) =>
          ftp.realpath('.', (error, path) => (error ? reject(error) : resolve(path))),
        );
        assert.equal(cwd, project.path);
        await new Promise<void>((resolve, reject) =>
          ftp.writeFile(project.path + '/ssh-check.txt', project.name, (error) =>
            error ? reject(error) : resolve(),
          ),
        );
        assert.equal(await external(project.alias, 'cat ssh-check.txt'), project.name);
        await external(
          project.alias,
          `nohup python3 -I -S -m http.server 40123 --bind 127.0.0.1 >"$HOME/http.log" 2>&1 </dev/null & echo $! >"$HOME/http.pid"; ` +
            `setsid sleep 600 >"$HOME/child.log" 2>&1 </dev/null & echo $! >"$HOME/child.pid"`,
        );
        let response = '';
        for (let i = 0; i < 50; i++) {
          response = await forwardHttp(client, 40123, '/ssh-check.txt').catch(() => '');
          if (response.endsWith(project.name)) break;
          await delay(100);
        }
        assert.ok(response.startsWith('HTTP/1.0 200') && response.endsWith(project.name));
        await assert.rejects(
          new Promise<void>((resolve, reject) =>
            client.forwardOut('127.0.0.1', 0, '1.1.1.1', 443, (error, stream) => {
              stream?.destroy();
              error ? reject(error) : resolve();
            }),
          ),
        );
        const archive = process.env.SAKURA_SSH_VSCODE_ARCHIVE;
        if (archive) {
          assert.match(process.env.SAKURA_SSH_VSCODE_SHA256 || '', /^[a-f0-9]{64}$/);
          assert.equal(
            createHash('sha256')
              .update(await readFile(archive))
              .digest('hex'),
            process.env.SAKURA_SSH_VSCODE_SHA256,
          );
          const remote = '/var/lib/sakura/ssh/' + project.id + '/vscode-server.tar.gz';
          console.log(`${distro}: transferring official VS Code Server to ${project.name}`);
          await new Promise<void>((resolve, reject) =>
            ftp.fastPut(archive, remote, { concurrency: 8, chunkSize: 64 * 1024 }, (error) =>
              error ? reject(error) : resolve(),
            ),
          );
          assert.equal(
            await external(project.alias, `sha256sum ${quote(remote)} | cut -d ' ' -f 1`),
            process.env.SAKURA_SSH_VSCODE_SHA256,
          );
          await external(
            project.alias,
            `set -eu\nmkdir -p "$VSCODE_AGENT_FOLDER/sakura-smoke"\n` +
              `tar -xzf ${quote(remote)} -C "$VSCODE_AGENT_FOLDER/sakura-smoke" --strip-components=1\n` +
              `umask 077; cat /proc/sys/kernel/random/uuid >"$HOME/vscode.token"\n` +
              `nohup "$VSCODE_AGENT_FOLDER/sakura-smoke/bin/code-server" --start-server --server-data-dir "$VSCODE_AGENT_FOLDER" ` +
              `--host=127.0.0.1 --port=40124 --connection-token-file "$HOME/vscode.token" --accept-server-license-terms --telemetry-level off ` +
              `>"$HOME/vscode.log" 2>&1 </dev/null & echo $! >"$HOME/vscode.pid"`,
            120_000,
          );
          let version = '';
          for (let i = 0; i < 100; i++) {
            version = await forwardHttp(client, 40124, '/version').catch(() => '');
            if (version.includes('200 OK')) break;
            await delay(100);
          }
          assert.ok(version.includes('200 OK'), `${project.name}: official VS Code Server did not respond`);
          assert.equal(
            await external(project.alias, `readlink /proc/$(cat "$HOME/vscode.pid")/ns/net`),
            await command(`ip netns exec sk-${project.id} readlink /proc/self/ns/net`),
          );
          console.log(
            `${distro}: official VS Code Server, private cache and forwarded version endpoint passed for ${project.name}`,
          );
        }
        const current = await within(project.id, () => workspaces!.config(vmId));
        await assert.rejects(
          within(project.id, () =>
            workspaces!.save(vmId, { ...current, directory: project.path + '-moved' }),
          ),
          /停止项目 SSH/,
        );
      } finally {
        client.destroy();
      }
    }
    await assert.rejects(clientFor(projects[0], projects[1].id), /authentication|authenticate/i);
    console.log(
      `${distro}: real SFTP, independent same-port applications, forwarding restrictions and wrong project key refusal passed`,
    );
    await projectNeovimClientSmoke(directory, join(directory, 'ssh-client/config'), projects, external);
    if (distro === 'alpine') await alpineReceiptStopRecovery(projects);
    if (distro !== 'alpine')
      await projectVscodeClientSmoke(directory, join(directory, 'ssh-client/config'), projects, external);
    await within('default', () =>
      workspaces!.save(vmId, { directory: '/workspace/ssh-shared', environment: { SAKURA_SCOPE: 'shared' } }),
    );
    const shared = await within('default', () => ide!.install(vmId));
    assert.ok('projectScoped' in shared && shared.projectScoped);
    assert.equal(await external(shared.alias, 'printf %s "$SAKURA_SCOPE"'), 'shared');
    assert.equal(
      await external(shared.alias, 'readlink /proc/self/ns/net'),
      await command('readlink /proc/1/ns/net'),
    );
    assert.equal(await external(shared.alias, 'printf %s "$HOME"'), '/var/lib/sakura/ssh/default');
    assert.ok(
      !(await readFile(join(directory, 'ssh/config'), 'utf8')).split('\n').includes('Host sakura-' + vm.name),
    );
    await within('default', () => ide!.stop(vmId));
    console.log(`${distro}: shared project uses its own key and binding without restoring a VM-wide alias`);
    if (distro === 'alpine') {
      const project = projects[0],
        home = '/var/lib/sakura/ssh/' + project.id;
      const children = (await command(`cat ${home}/http.pid ${home}/child.pid`)).split('\n').map(Number);
      await command(`rc-service sakura-ssh-${project.id} stop`);
      for (const pid of children)
        assert.equal(await command(`if [ -e /proc/${pid}/stat ]; then echo live; fi`), '');
      const stopped = await within(project.id, () => ide!.view(vmId));
      assert.ok('runtime' in stopped && !stopped.runtime?.running);
      assert.equal(await external(projects[1].alias, 'cat ssh-check.txt'), projects[1].name);
      await within(project.id, () => ide!.install(vmId));
      assert.equal(await external(project.alias, 'cat ssh-check.txt'), project.name);
      console.log(
        'alpine: altered OpenRC receipt and kernel ownership refused; native rc-service stop clears only its project',
      );
    }
    await ide.close();
    await assert.rejects(
      within(projects[0].id, () =>
        runReport(
          machines,
          workspaces!,
          vmId,
          'editor-profiles',
          { editor: 'neovim' },
          new AbortController().signal,
        ),
      ),
      /启用 IDE 插件/,
    );
    const alphaConfig = await within(projects[0].id, () => workspaces!.config(vmId));
    await assert.rejects(
      within(projects[0].id, () =>
        workspaces!.save(vmId, { ...alphaConfig, directory: projects[0].path + '-moved' }),
      ),
      /停止项目 SSH/,
    );
    ide = new Ide(machines, workspaces, join(directory, 'ssh-client'));
    for (const project of projects) {
      const view = await within(project.id, () => ide!.view(vmId));
      assert.ok('runtime' in view && view.runtime?.valid);
      assert.equal(await external(project.alias, 'cat ssh-check.txt'), project.name);
    }
    await machines.suspend(vmId);
    await assert.rejects(
      within(projects[0].id, () => ide!.install(vmId)),
      /启动发行版/,
    );
    await assert.rejects(
      within(projects[0].id, () => workspaces!.save(vmId, { ...alphaConfig, networkIsolation: 'host' })),
      /恢复实例/,
    );
    await machines.resume(vmId);
    for (const project of projects) await within(project.id, () => ide!.view(vmId));
    const children: number[] = [];
    for (const project of projects) {
      const home = '/var/lib/sakura/ssh/' + project.id;
      children.push(...(await command(`cat ${home}/http.pid ${home}/child.pid`)).split('\n').map(Number));
      if (process.env.SAKURA_SSH_VSCODE_ARCHIVE)
        children.push(Number(await command(`cat ${home}/vscode.pid`)));
      await within(project.id, () => ide!.stop(vmId));
    }
    for (const pid of children)
      assert.equal(await command(`if [ -e /proc/${pid}/stat ]; then echo live; fi`), '');
    console.log(`${distro}: control reload, paused refusal and detached process cleanup passed`);
    await within(projects[0].id, () => ide!.install(vmId));
    await command(`printf '\\n# changed\\n' >> /etc/sakura/ssh/${projects[0].id}/command`);
    const tampered = await within(projects[0].id, () => ide!.view(vmId));
    assert.ok('runtime' in tampered && !tampered.runtime?.valid && tampered.runtime?.running);
    assert.equal(tampered.command, '');
    await assert.rejects(
      within(projects[0].id, () =>
        runReport(
          machines,
          workspaces!,
          vmId,
          'editor-profiles',
          { editor: 'neovim' },
          new AbortController().signal,
        ),
      ),
      /先在项目页配置/,
    );
    await within(projects[0].id, () => ide!.stop(vmId));
    await within(projects[0].id, () => ide!.install(vmId));
    const configFolder = `/etc/sakura/ssh/${projects[0].id}`;
    const pinned = join(vmDir(vmId), 'project-ssh', projects[0].id, 'known_hosts');
    await writeFile(pinned, 'changed host key pin\n');
    const changedPin = await within(projects[0].id, () => ide!.view(vmId));
    assert.ok('runtime' in changedPin && changedPin.runtime?.running && !changedPin.runtime?.valid);
    assert.equal(changedPin.command, '');
    await assert.rejects(
      within(projects[0].id, () => ide!.install(vmId)),
      /客户端密钥或主机公钥/,
    );
    await within(projects[0].id, () => ide!.stop(vmId));
    await within(projects[0].id, () => ide!.install(vmId));
    const unitFile =
      distro === 'alpine'
        ? `/etc/init.d/sakura-ssh-${projects[0].id}`
        : `/etc/systemd/system/sakura-ssh-${projects[0].id}.service`;
    const detached = Number(
      await external(projects[0].alias, 'setsid sleep 600 >/dev/null 2>&1 </dev/null & echo $!'),
    );
    await command(`mv ${configFolder} ${configFolder}.smoke; mv ${unitFile} ${unitFile}.smoke`);
    try {
      const missing = await within(projects[0].id, () => ide!.view(vmId));
      assert.ok('runtime' in missing && missing.runtime?.running && !missing.runtime?.valid);
      assert.equal(missing.command, '');
      await assert.rejects(
        within(projects[0].id, () =>
          workspaces!.save(vmId, { ...alphaConfig, directory: projects[0].path + '-moved' }),
        ),
        /停止项目 SSH/,
      );
      await within(projects[0].id, () => ide!.stop(vmId));
      assert.equal(await command(`if [ -e /proc/${detached}/stat ]; then echo live; fi`), '');
    } finally {
      await command(`mv ${configFolder}.smoke ${configFolder}; mv ${unitFile}.smoke ${unitFile}`);
    }
    await within(projects[0].id, () => ide!.install(vmId));
    await command(`ip -n sk-${projects[0].id} route add 192.0.2.0/24 dev lo`);
    const routed = await within(projects[0].id, () => ide!.view(vmId));
    assert.ok('runtime' in routed && !routed.runtime?.valid);
    assert.equal(routed.command, '');
    await within(projects[0].id, () => ide!.stop(vmId));
    await command(`ip -n sk-${projects[0].id} route del 192.0.2.0/24 dev lo`);
    if (secrets) {
      await within(projects[0].id, () => ide!.install(vmId));
      await secrets.save(vmId, { name: 'project-ssh-token', value: privateValue + '-rotated' });
      const rotated = await within(projects[0].id, () => ide!.view(vmId));
      assert.ok(
        'runtime' in rotated && !rotated.runtime?.valid && rotated.runtime?.reason?.includes('环境已变化'),
      );
      await ide.close();
      await workspaces.close();
      workspaces = new Workspaces(machines);
      ide = new Ide(machines, workspaces, join(directory, 'ssh-client'));
      await within(projects[0].id, () => ide!.stop(vmId));
      await assert.rejects(
        within(projects[0].id, () => ide!.install(vmId)),
        /secrets 插件/,
      );
      await ide.close();
      await workspaces.close();
      workspaces = new Workspaces(machines, { secrets });
      ide = new Ide(machines, workspaces, join(directory, 'ssh-client'));
    }
    await within(projects[0].id, () => ide!.install(vmId));
    await command('sync');
    await machines.stop(vmId, true);
    await machines.start(vmId);
    await waitBoot();
    const rebooted = await within(projects[0].id, () => ide!.view(vmId));
    assert.ok('runtime' in rebooted && !rebooted.runtime?.running && !rebooted.runtime?.valid);
    assert.equal(rebooted.command, '');
    await within(projects[0].id, () => ide!.install(vmId));
    assert.equal(await external(projects[0].alias, 'cat ssh-check.txt'), projects[0].name);
    await within(projects[0].id, () => ide!.stop(vmId));
    console.log(
      `${distro}: changed files and local pin, missing service files, added routes, rotated secrets, missing secret provider and reboot recovery passed`,
    );
  }
} catch (error) {
  if (vmId && machines.state(vmId) === 'running')
    console.error(
      await machines
        .exec(
          vmId,
          distro === 'alpine'
            ? 'tail -n 30 /run/sakura-project-ssh/*/log 2>/dev/null; rc-status'
            : 'journalctl -u "sakura-ssh-*" -n 15 --no-pager',
          15_000,
        )
        .catch(() => null),
    );
  throw error;
} finally {
  await ide?.close();
  await workspaces?.close();
  if (vmId && machines.state(vmId) === 'running') await machines.exec(vmId, 'sync', 15_000).catch(() => {});
  if (vmId && machines.live.has(vmId)) await machines.stop(vmId, true).catch(() => {});
  await machines.close();
  if (process.env.SAKURA_KEEP_SSH_SMOKE === '1') console.log('Retained owned fixture:', owned);
  else {
    assert.equal(dirname(await realpath(directory)), await realpath(tmpdir()));
    assert.match(basename(owned), /^sakura-project-ssh-/);
    await rm(owned, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
