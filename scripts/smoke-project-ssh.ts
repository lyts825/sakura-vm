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
assert.ok(['debian', 'ubuntu'].includes(distro));
const directory = process.argv[3] || (await mkdtemp(join(tmpdir(), 'sakura-project-ssh-')));
const owned = await realpath(directory);
assert.equal(dirname(owned), await realpath(tmpdir()));
assert.match(basename(owned), /^sakura-project-ssh-/);
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve(
  '.data/images',
  distro === 'ubuntu' ? 'ubuntu-24.04.qcow2' : 'debian-12.qcow2',
);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Secrets } = await import('../server/secrets.ts');
const { Ide } = await import('../server/ide.ts');
const { quote } = await import('../server/files.ts');
const { vmDir } = await import('../server/model.ts');
const machines = new Machines(await createRuntime());
let vmId = '',
  workspaces: InstanceType<typeof Workspaces> | undefined,
  ide: InstanceType<typeof Ide> | undefined;
const privateValue = 'project-ssh-' + randomUUID();
const run = promisify(execFile);
const ssh =
  process.platform === 'win32'
    ? join(process.env.SystemRoot || 'C:/Windows', 'System32/OpenSSH/ssh.exe')
    : 'ssh';
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
    console.log(`${distro}: preparing SSH for ${name}`);
    await within(id, async () => {
      const current = await workspaces!.config(vmId);
      await workspaces!.save(vmId, { ...current, environment: { ...current.environment,
        original: 'project value', SSH_ORIGINAL_COMMAND: 'project value' } });
    });
    const view = await within(id, () => ide!.install(vmId));
    assert.equal(view.supported, true);
    assert.ok('runtime' in view && view.runtime?.valid);
    assert.ok(view.command.includes('ssh-remote+'));
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
    if (secrets)
      assert.ok(
        (await external(view.alias, 'printf %s "$TOKEN"')) === privateValue,
        'project SSH must resolve the frozen secret without printing its value',
      );
    projects.push({ id, name, path, alias: view.alias });
  }
  console.log(
    `${distro}: independent OpenSSH authentication, directories, environments and actual namespaces passed`,
  );
  for (const project of projects) {
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
        within(project.id, () => workspaces!.save(vmId, { ...current, directory: project.path + '-moved' })),
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
  await ide.close();
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
    if (process.env.SAKURA_SSH_VSCODE_ARCHIVE) children.push(Number(await command(`cat ${home}/vscode.pid`)));
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
  const unitFile = `/etc/systemd/system/sakura-ssh-${projects[0].id}.service`;
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
} catch (error) {
  if (vmId && machines.state(vmId) === 'running')
    console.error(
      await machines.exec(vmId, 'journalctl -u "sakura-ssh-*" -n 15 --no-pager', 15_000).catch(() => null),
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
