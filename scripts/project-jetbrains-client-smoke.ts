import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { quote } from '../server/files.ts';

const run = promisify(execFile);
type Project = { id: string; name: string; path: string; alias: string; home: string; uid: number; gid: number };
export type JetbrainsProfile = {
  alias: string;
  host: string;
  port: number;
  username: string;
  directory: string;
  identityFile: string;
  knownHostsFile: string;
  projectScoped: boolean;
  projectId: string;
  hostKeyVerification: string;
  download: { content: string };
};
const xml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&apos;');
const windowsArgument = (value: string) => {
  assert.ok(!/["\r\n]/.test(value), 'Unsafe Windows command path');
  return '"' + value.replaceAll('%', '%%') + '"';
};

/** Prepare only a new, caller-owned client directory; never edit a user's IDE or SSH home. */
export async function prepareJetbrainsGatewayProfile(
  directory: string,
  gateway: string,
  connections: JetbrainsProfile[],
) {
  assert.equal(process.platform, 'win32', 'This real desktop fixture targets Windows Gateway');
  assert.equal(basename(gateway).toLowerCase(), 'gateway64.exe');
  const install = dirname(dirname(resolve(gateway)));
  const product = JSON.parse(await readFile(join(install, 'product-info.json'), 'utf8'));
  assert.equal(product.productCode, 'GW');
  const root = await realpath(directory);
  assert.equal((await lstat(root)).isSymbolicLink(), false);
  const config = join(root, 'config'),
    home = join(root, 'home');
  await mkdir(join(config, 'options'), { recursive: true });
  await mkdir(join(home, '.ssh'), { recursive: true });
  for (const profile of connections) {
    assert.equal(profile.projectScoped, true);
    assert.equal(profile.hostKeyVerification, 'project-and-endpoint');
    assert.equal(profile.host, '127.0.0.1');
    assert.equal(profile.username, 'root');
    assert.match(profile.alias, /^sakura-[a-f0-9-]{36}-[a-f0-9]{16}$/);
    assert.ok(Number.isInteger(profile.port) && profile.port > 1024 && profile.port < 65536);
    const key = (await readFile(profile.knownHostsFile, 'utf8')).split('\n');
    assert.equal(key.length, 3);
    assert.ok(key[0].startsWith(profile.alias + ' ssh-ed25519 '));
    assert.equal(key[1], `[127.0.0.1]:${profile.port} ` + key[0].slice(profile.alias.length + 1));
    assert.equal(key[2], '');
    assert.match(profile.download.content, /StrictHostKeyChecking yes/);
    assert.match(profile.download.content, /GlobalKnownHostsFile none/);
    assert.match(profile.download.content, /IdentityAgent none/);
  }
  const sshConfig = join(home, '.ssh/config');
  await writeFile(sshConfig, connections.map((profile) => profile.download.content).join('\n'), {
    flag: 'wx',
    mode: 0o600,
  });
  const ssh = join(process.env.SystemRoot || 'C:/Windows', 'System32/OpenSSH/ssh.exe');
  const wrapper = join(root, 'project-ssh.cmd');
  await writeFile(
    wrapper,
    '@echo off\r\n' + windowsArgument(ssh) + ' -F ' + windowsArgument(sshConfig) + ' %*\r\n',
    { flag: 'wx' },
  );
  // The current official OpenSSH parser runs `ssh -G`. Windows OpenSSH derives
  // its home from the OS account, so give it this explicit config via its supported tool setting.
  await writeFile(
    join(config, 'options/advancedSettings.xml'),
    '<application><component name="AdvancedSettings"><option name="settings"><map>' +
      '<entry key="ssh.config.backend" value="OPENSSH" />' +
      `<entry key="ssh.tool.custom.path" value="${xml(wrapper)}" />` +
      '</map></option></component></application>',
  );
  await writeFile(
    join(config, 'options/sshConfigs.xml'),
    '<application><component name="SshConfigs"><configs>' +
      connections
        .map(
          (profile) =>
            `<sshConfig authType="OPEN_SSH" host="${xml(profile.alias)}" id="${randomUUID()}" ` +
            `port="${profile.port}" nameFormat="DESCRIPTIVE" username="root" useOpenSSHConfig="true" />`,
        )
        .join('') +
      '</configs></component></application>',
  );
  const vmOptions = join(root, 'owned.vmoptions');
  const defaults = await readFile(join(install, 'bin/gateway64.exe.vmoptions'), 'utf8');
  await writeFile(
    vmOptions,
    defaults +
      '\n' +
      Object.entries({
        'user.home': home,
        'idea.config.path': config,
        'idea.system.path': join(root, 'system'),
        'idea.plugins.path': join(root, 'plugins'),
        'idea.log.path': join(root, 'log'),
        'java.io.tmpdir': root,
        // Official UI-test option: skip the consent question without opting into data sharing.
        'jb.consents.confirmation.enabled': 'false',
        'idea.fatal.error.notification': 'disabled',
      })
        .map(([key, value]) => '-D' + key + '=' + value.replaceAll('\\', '/'))
        .join('\n') +
      '\n',
  );
  return {
    product,
    root,
    config,
    home,
    vmOptions,
    sshConfig,
    wrapper,
    env: {
      ...process.env,
      TEMP: root,
      TMP: root,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(root, 'appdata'),
      LOCALAPPDATA: join(root, 'localappdata'),
      GATEWAY_VM_OPTIONS: vmOptions,
    },
  };
}

export function projectJetbrainsGatewayLink(profile: JetbrainsProfile, idePath: string, home: string) {
  assert.match(home, /^\/var\/lib\/sakura-project-homes\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.ok(idePath.startsWith(home + '/.jetbrains/ide-'));
  assert.ok(!/[\0\r\n]/.test(idePath));
  const fields = new URLSearchParams({
    idePath,
    projectPath: profile.directory,
    host: profile.alias,
    port: String(profile.port),
    user: 'root',
    type: 'ssh',
    deploy: 'false',
    newUi: 'true',
  });
  return 'jetbrains-gateway://connect#' + fields;
}

/** Actual Gateway SSH/SFTP/backend/tunnel proof. Client editor/licensing is recorded separately. */
export async function projectJetbrainsClientSmoke(
  root: string,
  sshConfig: string,
  projects: Project[],
  external: (alias: string, script: string, timeout?: number) => Promise<string>,
  getProfile: (project: Project) => Promise<JetbrainsProfile>,
) {
  const gateway = process.env.SAKURA_SSH_JETBRAINS_GATEWAY;
  if (!gateway) return;
  assert.equal(process.platform, 'win32');
  assert.match(basename(root), /^sakura-project-ssh-/);
  const archive = process.env.SAKURA_SSH_JETBRAINS_BACKEND_ARCHIVE,
    checksum = process.env.SAKURA_SSH_JETBRAINS_BACKEND_SHA256;
  assert.ok(
    archive && checksum && /^[a-f0-9]{64}$/.test(checksum),
    'Supply an official local backend archive and its verified vendor SHA-256',
  );
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  assert.equal(hash.digest('hex'), checksum, 'Official local backend checksum mismatch');
  const shared = '/opt/sakura-jetbrains-' + checksum.slice(0, 16),
    remoteArchive = '/var/tmp/sakura-jetbrains-' + randomUUID() + '.tar.gz';
  const receipt = shared + '/.sakura-archive-sha256';
  const cached = await external(
    projects[0].alias,
    `if [ -f ${quote(receipt)} ]; then cat ${quote(receipt)}; fi`,
  );
  if (cached !== checksum) {
    const scp = join(process.env.SystemRoot || 'C:/Windows', 'System32/OpenSSH/scp.exe');
    await run(
      scp,
      ['-F', resolve(sshConfig), '-o', 'BatchMode=yes', archive, projects[0].alias + ':' + remoteArchive],
      { windowsHide: true, timeout: 300_000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
    );
    await external(
      projects[0].alias,
      `set -eu\n` +
        `[ "$(sha256sum ${quote(remoteArchive)} | cut -d' ' -f1)" = ${quote(checksum)} ]\n` +
        `mkdir -p ${quote(shared)}\n` +
        `tar -xzf ${quote(remoteArchive)} --strip-components=1 -C ${quote(shared)}\n` +
        `test -x ${quote(shared + '/bin/remote-dev-server')}\n` +
        `printf '%s' ${quote(checksum)} >${quote(receipt)}\nrm -f -- ${quote(remoteArchive)}\n`,
      300_000,
    );
  }
  const backend = JSON.parse(
    await external(projects[0].alias, `cat ${quote(shared + '/product-info.json')}`),
  );
  assert.equal(
    backend.productCode,
    'WS',
    'This tested launcher adapter targets the official WebStorm backend',
  );
  assert.match(backend.buildNumber, /^\d+\.\d+\.\d+$/);
  const connections = await Promise.all(projects.map(getProfile));
  const clientRoot = await mkdtemp(join(root, 'jetbrains-gateway-client-'));
  const client = await prepareJetbrainsGatewayProfile(clientRoot, gateway, connections);
  const evidence: Array<Record<string, unknown>> = [];
  for (let index = 0; index < projects.length; index++) {
    const project = projects[index],
      profile = connections[index];
    assert.equal(profile.alias, project.alias);
    assert.equal(profile.projectId, project.id);
    assert.equal(profile.directory, project.path);
    const home = project.home,
      state = home + '/.jetbrains',
      ide = state + '/ide-' + checksum.slice(0, 16);
    const properties =
      `idea.config.path=${state}/config\nidea.system.path=${state}/system\n` +
      `idea.log.path=${state}/log\nidea.plugins.path=${state}/plugins\n`;
    const backendOptions =
      '-Xmx1536m\n' +
      Object.entries({
        'user.home': home,
        'idea.config.path': state + '/config',
        'idea.system.path': state + '/system',
        'idea.log.path': state + '/log',
        'idea.plugins.path': state + '/plugins',
      })
        .map(([key, value]) => '-D' + key + '=' + value)
        .join('\n') +
      '\n';
    // Copy the small launcher directory and share the immutable JBR/libraries.
    // A distinct native launcher path plus fixed properties gives Gateway's own
    // host-status/start commands the same project identity as manual launches.
    const wrapper =
      '#!/bin/sh\nset -eu\n' +
      `export WEBIDE_PROPERTIES=${quote(state + '/ide.properties')}\n` +
      `export WEBIDE_VM_OPTIONS=${quote(state + '/ide.vmoptions')}\n` +
      `export XDG_CONFIG_HOME=${quote(state + '/native-config')}\n` +
      `export XDG_CACHE_HOME=${quote(state + '/native-cache')}\n` +
      `export XDG_DATA_HOME=${quote(state + '/native-data')}\n` +
      `exec ${quote(ide + '/bin/.sakura-original-remote-dev-server.sh')} "$@"\n`;
    await external(
      project.alias,
      `set -eu\nmkdir -p ${quote(ide + '/bin')}\n` +
        `if [ -e ${quote(ide + '/bin/remote-dev-server')} ]; then\n` +
        `cmp -s ${quote(shared + '/bin/remote-dev-server')} ${quote(ide + '/bin/remote-dev-server')} || ` +
        `{ echo 'Existing project launcher changed; stop and redeploy explicitly' >&2; exit 1; }\n` +
        `else cp -a ${quote(shared + '/bin/.')} ${quote(ide + '/bin/')}\n` +
        `cp ${quote(ide + '/bin/remote-dev-server.sh')} ${quote(ide + '/bin/.sakura-original-remote-dev-server.sh')}\nfi\n` +
        `for entry in ${quote(shared)}/*; do name="$(basename "$entry")"; ` +
        `[ "$name" = bin ] || ln -sfn "$entry" ${quote(ide)}/"$name"; done\n` +
        `printf '%s' ${quote(Buffer.from(properties).toString('base64'))} | base64 -d >${quote(state + '/ide.properties')}\n` +
        // The current native remote launcher intentionally ignores *_PROPERTIES;
        // its supported *_VM_OPTIONS supplies the fixed Java paths directly.
        `printf '%s' ${quote(Buffer.from(backendOptions).toString('base64'))} | base64 -d >${quote(state + '/ide.vmoptions')}\n` +
        `printf '%s' ${quote(Buffer.from(wrapper).toString('base64'))} | base64 -d >${quote(ide + '/bin/remote-dev-server.sh')}\n` +
        `chmod 700 ${quote(ide + '/bin/remote-dev-server.sh')}\n` +
        `${quote(ide + '/bin/remote-dev-server.sh')} help >/dev/null\n` +
        // This is an owned fault fixture. Require Gateway to perform an actual
        // SFTP upload instead of inferring that support from a cached worker.
        `worker=${quote(home + '/.cache/JetBrains/RemoteDev/remote-dev-worker')}\n` +
        `if [ -d "$worker" ]; then find "$worker" -maxdepth 1 -type f ` +
        `-name 'remote-dev-worker_*' -delete; fi\n`,
      120_000,
    );
    const link = projectJetbrainsGatewayLink(profile, ide, home);
    const linkFile = join(clientRoot, 'gateway-' + project.id + '.txt');
    await writeFile(linkFile, link + '\n', { mode: 0o600 });
    const startLogLength = (await readFile(join(clientRoot, 'log/idea.log'), 'utf8').catch(() => '')).length;
    const child = spawn(gateway, [link], { env: client.env, stdio: 'ignore', windowsHide: false });
    let launchError: Error | undefined;
    child.once('error', (error) => {
      launchError = error;
    });
    try {
      const deadline = Date.now() + 120_000;
      let logs = '';
      while (Date.now() < deadline) {
        if (launchError) throw launchError;
        logs = (await readFile(join(clientRoot, 'log/idea.log'), 'utf8').catch(() => '')).slice(
          startLogLength,
        );
        if (
          logs.includes('UnattendedHostStatus(') &&
          logs.includes('appVersion=') &&
          logs.includes('port-forwarding-test') &&
          logs.includes('Exit code: 0')
        )
          break;
        await delay(1000);
      }
      assert.ok(
        logs.includes('UnattendedHostStatus(') && logs.includes('appVersion='),
        `Actual Gateway did not authenticate and reach its backend; inspect ${join(clientRoot, 'log')}`,
      );
      assert.ok(
        logs.includes('port-forwarding-test') && logs.includes('Exit code: 0'),
        'Actual Gateway port forwarding was not verified',
      );
      assert.ok(logs.includes('uploading via SFTP'), 'Actual Gateway SFTP worker upload was not observed');
      const processEvidence = JSON.parse(await external(project.alias, backendProcessProbe(project, ide)));
      assert.equal(processEvidence.sshUid, project.uid);
      assert.equal(processEvidence.sshGid, project.gid);
      assert.equal(processEvidence.sshNetwork, processEvidence.expectedNetwork);
      assert.equal(processEvidence.externalBlocked, true);
      assert.ok(processEvidence.backends.length > 0, 'No actual native IDE backend belongs to the project');
      for (const record of processEvidence.backends) {
        assert.equal(record.network, processEvidence.expectedNetwork);
        assert.equal(record.home, home);
        assert.deepEqual(record.uids, Array(4).fill(project.uid));
        assert.deepEqual(record.gids, Array(4).fill(project.gid));
        assert.equal(record.scope, project.name);
        assert.equal(record.cwd, project.path);
        assert.equal(record.properties, state + '/ide.properties');
        assert.equal(record.vmOptions, state + '/ide.vmoptions');
        assert.ok(record.cgroup.endsWith('/sakura-ssh-' + project.id + '.service'));
      }
      assert.ok(
        logs.includes('ideIdentityString=' + state + '/config'),
        'Gateway ignored the fixed project backend configuration directory',
      );
      evidence.push({
        project: project.name,
        alias: profile.alias,
        gatewayVersion: client.product.version,
        gatewayBuild: client.product.buildNumber,
        backendVersion: backend.version,
        backendBuild: backend.buildNumber,
        backendSha256: checksum,
        nativeLinkFile: linkFile,
        backendConfigurationIdentity: state + '/config',
        backendConfigurationVerified: true,
        backendVmOptionsFile: state + '/ide.vmoptions',
        strictHostKeyChecking: true,
        gatewaySftpAndTunnelVerified: true,
        clientEditorVerified: false,
        clientLicensingVerified: false,
        clientBoundary:
          'Native Gateway SSH/SFTP/tunnel/backend verified; frontend onboarding, account/license and text editing require separate proof.',
        ...processEvidence,
      });
      console.log(
        `${project.name}: actual Gateway strict SSH, SFTP worker, port forwarding and project backend ownership passed; graphical editor remains unverified`,
      );
    } finally {
      if (child.pid && process.env.SAKURA_SSH_JETBRAINS_KEEP_CLIENTS !== '1')
        await run(
          join(process.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true },
        ).catch(() => {});
    }
  }
  assert.notEqual(evidence[0]?.expectedNetwork, evidence[1]?.expectedNetwork);
  await writeFile(join(root, 'jetbrains-client-evidence.json'), JSON.stringify(evidence, null, 2));
}

function backendProcessProbe(project: Project, ide: string) {
  const source = `import os,json,pathlib,socket
project=${JSON.stringify(project)}
ide=${JSON.stringify(ide)}
expected='net:['+str(os.stat('/run/netns/sk-'+project['id']).st_ino)+']'
records=[]
for path in pathlib.Path('/proc').glob('[0-9]*'):
 try:
  exe=os.readlink(path/'exe')
  if exe!=ide+'/bin/remote-dev-server': continue
  env=dict(v.split(b'=',1) for v in (path/'environ').read_bytes().split(b'\\0') if b'=' in v)
  status=dict(line.split(':',1) for line in (path/'status').read_text().splitlines() if ':' in line)
  records.append({'pid':int(path.name),'executable':exe,'uids':[int(v) for v in status['Uid'].split()],'gids':[int(v) for v in status['Gid'].split()],'home':env.get(b'HOME',b'').decode(),'scope':env.get(b'SAKURA_SCOPE',b'').decode(),'cwd':os.readlink(path/'cwd'),'network':os.readlink(path/'ns/net'),'cgroup':(path/'cgroup').read_text().strip(),'properties':env.get(b'WEBIDE_PROPERTIES',b'').decode(),'vmOptions':env.get(b'WEBIDE_VM_OPTIONS',b'').decode()})
 except (FileNotFoundError,PermissionError,ValueError): pass
try:
 c=socket.create_connection(('1.1.1.1',443),timeout=2);c.close();blocked=False
except OSError: blocked=True
print(json.dumps({'sshUid':os.getuid(),'sshGid':os.getgid(),'sshNetwork':os.readlink('/proc/self/ns/net'),'expectedNetwork':expected,'externalBlocked':blocked,'backends':records}))`;
  return 'python3 -c ' + quote(source);
}
