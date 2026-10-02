import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { quote } from '../server/files.ts';

const run = promisify(execFile);
type Project = { id: string; name: string; path: string; alias: string; home: string; uid: number; gid: number };

/** Runs an actual desktop Remote-SSH window with an isolated profile and workspace extension. */
export async function projectVscodeClientSmoke(root: string, sshConfig: string,
  projects: Project[], external: (alias: string, script: string, timeout?: number) => Promise<string>) {
  const executable = process.env.SAKURA_SSH_VSCODE_CLIENT;
  if (!executable) return;
  assert.equal(basename(executable).toLowerCase(), 'code.exe');
  const installation = dirname(executable);
  const folders = await readdir(installation, { withFileTypes: true });
  const builds = folders.filter((entry) => entry.isDirectory() && /^[a-f0-9]{10}$/.test(entry.name));
  let cli = (await lstat(join(installation, 'resources/app/out/cli.js')).catch(() => null))?.isFile()
    ? join(installation, 'resources/app/out/cli.js') : '';
  for (const build of builds) {
    if (cli) break;
    const product = JSON.parse(await readFile(join(installation, build.name, 'resources/app/product.json'), 'utf8'));
    const version = await run(executable, [join(installation, build.name, 'resources/app/out/cli.js'), '--version'],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 30_000 });
    if (version.stdout.includes(product.commit)) {
      cli = join(installation, build.name, 'resources/app/out/cli.js');
      break;
    }
  }
  assert.ok(cli, 'Could not identify the installed desktop CLI');
  const clientVersion = (await run(executable, [cli, '--version'],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true,
      encoding: 'utf8', timeout: 30_000 })).stdout.trim().split(/\r?\n/);
  const portableData = join(root, 'vscode-client-portable-data'),
    profile = join(portableData, 'user-data'), extensions = join(portableData, 'extensions');
  const clientEnv = { ...process.env, VSCODE_PORTABLE: portableData };
  await mkdir(join(profile, 'User'), { recursive: true });
  await mkdir(extensions, { recursive: true });
  await writeFile(join(profile, 'User/settings.json'), JSON.stringify({
    'remote.SSH.configFile': resolve(sshConfig),
    'remote.SSH.localServerDownload': 'always',
    'remote.SSH.remoteServerListenOnSocket': false,
    'remote.SSH.useLocalServer': false,
    'remote.SSH.remotePlatform': Object.fromEntries(projects.map((project) => [project.alias, 'linux'])),
    'remote.SSH.enableAgentForwarding': false,
    'remote.SSH.enableX11Forwarding': false,
    'remote.SSH.connectTimeout': 60,
    'remote.SSH.logLevel': 'trace',
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none',
    'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
    'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false,
    'window.restoreWindows': 'none', 'files.hotExit': 'off',
  }, null, 2));
  const remoteSsh = process.env.SAKURA_SSH_REMOTE_VSIX || 'ms-vscode-remote.remote-ssh';
  const installed = await run(executable, [cli, '--user-data-dir', profile, '--extensions-dir', extensions,
    '--install-extension', remoteSsh, '--force'],
    { env: { ...clientEnv, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true,
      timeout: 300_000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  console.log('VS Code Remote-SSH isolated install:', installed.stdout.trim());
  const remoteSshFolder = (await readdir(extensions)).find((name) => /^ms-vscode-remote\.remote-ssh-\d/.test(name));
  assert.ok(remoteSshFolder, 'Official Remote-SSH was not installed in the isolated extension directory');
  const remoteSshVersion = JSON.parse(await readFile(join(extensions, remoteSshFolder, 'package.json'), 'utf8')).version;
  const evidence: Record<string, unknown>[] = [];
  for (const project of projects) {
    const output = project.path + '/.sakura-vscode-client-result.json';
    const code = workspaceProbe(project, output, randomUUID());
    const remoteExtension = project.home + '/.vscode-server/extensions/sakura.project-network-probe-0.0.1';
    const manifest = JSON.stringify({ name: 'project-network-probe', displayName: 'Sakura project network probe',
      publisher: 'sakura', version: '0.0.1', engines: { vscode: '^1.90.0' }, extensionKind: ['workspace'],
      activationEvents: ['onStartupFinished'], main: './extension.cjs',
      capabilities: { untrustedWorkspaces: { supported: true } } });
    await external(project.alias, `set -eu\nmkdir -p ${quote(remoteExtension)}\n` +
      `printf '%s' ${quote(Buffer.from(manifest).toString('base64'))} | base64 -d >${quote(remoteExtension + '/package.json')}\n` +
      `printf '%s' ${quote(Buffer.from(code).toString('base64'))} | base64 -d >${quote(remoteExtension + '/extension.cjs')}\n` +
      `rm -f -- ${quote(output)} ${quote(project.path + '/.sakura-vscode-terminal-network')} ${quote(project.path + '/.sakura-vscode-task-network')}\n`);
    const folderUri = `vscode-remote://ssh-remote+${project.alias}${project.path.split('/').map(encodeURIComponent).join('/')}`;
    const env: NodeJS.ProcessEnv = { ...clientEnv }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, ['--user-data-dir', profile, '--extensions-dir', extensions,
      '--new-window', '--folder-uri', folderUri, '--verbose'],
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let childOutput = '';
    child.stdout.on('data', (chunk) => { childOutput = (childOutput + chunk).slice(-16384); });
    child.stderr.on('data', (chunk) => { childOutput = (childOutput + chunk).slice(-16384); });
    let ended = false, launchError: Error | undefined, exit: string | undefined;
    child.once('error', (error) => { launchError = error; ended = true; });
    child.once('exit', (code, signal) => { ended = true; exit = `${code}/${signal}`; });
    try {
      let record: any;
      const deadline = Date.now() + 600_000;
      let progressAt = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const result = await external(project.alias, `if [ -f ${quote(output)} ]; then cat ${quote(output)}; fi`)
          .catch(() => '');
        if (result) { record = JSON.parse(result); break; }
        if (ended) throw launchError || new Error('VS Code exited before workspace probe completed (' + exit + '): ' + childOutput);
        if (Date.now() > progressAt) {
          console.log(`${project.name}: desktop Remote-SSH connection pending; logs in ${join(profile, 'logs')}`);
          progressAt = Date.now() + 60_000;
        }
        await delay(1000);
      }
      assert.ok(record, 'VS Code desktop did not complete the remote workspace probe; ' + childOutput);
      assert.equal(record.ok, true, JSON.stringify(record));
      assert.equal(record.remoteName, 'ssh-remote');
      assert.equal(record.uiKind, 1);
      assert.equal(record.platform, 'linux');
      assert.equal(record.scope, project.name);
      assert.equal(record.home, project.home);
      for (const prefix of ['', 'child', 'terminal', 'task']) {
        assert.equal(record[prefix ? prefix + 'Uid' : 'uid'], project.uid);
        assert.equal(record[prefix ? prefix + 'Gid' : 'gid'], project.gid);
      }
      assert.equal(record.network, record.expectedNetwork);
      assert.equal(record.terminalNetwork, record.expectedNetwork);
      assert.equal(record.taskNetwork, record.expectedNetwork);
      assert.equal(record.externalBlocked, true);
      evidence.push({ alias: project.alias, desktopVersion: clientVersion[0],
        desktopCommit: clientVersion[1], remoteSshVersion, ...record });
      console.log(`${project.name}: actual desktop Remote-SSH, remote extension, text editor, terminal, task and external network refusal passed`);
      // The isolated probe closes only its own test window through VS Code's command API.
      for (let count = 0; !ended && count < 100; count++) await delay(100);
    } finally {
      if (!ended && child.pid) {
        if (process.platform === 'win32') {
          await run(join(process.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
        } else child.kill();
      }
    }
  }
  assert.notEqual(evidence[0]?.network, evidence[1]?.network);
  await writeFile(join(root, 'vscode-client-evidence.json'), JSON.stringify(evidence, null, 2));
}

function workspaceProbe(project: Project, output: string, nonce: string) {
  // This code executes in the Linux workspace extension host of the real desktop client.
  return `const vscode=require('vscode'), fs=require('node:fs'), cp=require('node:child_process'), net=require('node:net');
const project=${JSON.stringify(project)}, output=${JSON.stringify(output)};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ready=file=>fs.existsSync(file)&&fs.statSync(file).size>0&&fs.readFileSync(file,'utf8').trim().split('\\n').length===3;
const check=(condition,message)=>{if(!condition)throw new Error(message)};
exports.activate=async()=>{
 const result={ok:false,remoteName:vscode.env.remoteName,uiKind:vscode.env.uiKind,platform:process.platform,
  scope:process.env.SAKURA_SCOPE,home:process.env.HOME,uid:process.getuid(),gid:process.getgid(),network:fs.readlinkSync('/proc/self/ns/net'),
  expectedNetwork:'net:['+fs.statSync('/run/netns/sk-'+project.id).ino+']'};
 try {
  check(result.platform==='linux'&&result.remoteName==='ssh-remote','probe must run in the Linux workspace extension host');
  check(result.uid===project.uid&&result.gid===project.gid,'extension host project account mismatch');
  check(result.network===result.expectedNetwork,'extension host network mismatch');
  const folder=vscode.workspace.workspaceFolders[0];
  result.workspaceUri=folder.uri.toString();result.workspaceAuthority=folder.uri.authority;
  check(folder.uri.path===project.path,'remote workspace directory mismatch');
  // VS Code translates remote resources to local file URIs inside the workspace extension host.
  check(folder.uri.scheme==='file'&&folder.uri.authority==='','remote workspace file mapping mismatch');
  const file=vscode.Uri.joinPath(folder.uri,${JSON.stringify('vscode-client-editor-' + nonce + '.txt')});
  await vscode.workspace.fs.writeFile(file,Buffer.from(project.name));
  const document=await vscode.workspace.openTextDocument(file); await vscode.window.showTextDocument(document);
  const edit=new vscode.WorkspaceEdit(); edit.insert(file,new vscode.Position(0,project.name.length),' desktop');
  check(await vscode.workspace.applyEdit(edit),'editor edit failed'); await document.save();
  result.editorText=document.getText();check(result.editorText===project.name+' desktop','remote text editor contents mismatch');
  check(fs.readFileSync(file.fsPath,'utf8')===result.editorText,'remote file was not saved');
  const child=cp.spawnSync(process.execPath,['-e',"console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),network:require('node:fs').readlinkSync('/proc/self/ns/net')}))"],{encoding:'utf8'});
  const childIdentity=JSON.parse(child.stdout);result.childNetwork=childIdentity.network;
  result.childUid=childIdentity.uid;result.childGid=childIdentity.gid;
  check(child.status===0&&result.childNetwork===result.expectedNetwork,'extension child network mismatch');
  check(result.childUid===project.uid&&result.childGid===project.gid,'extension child project account mismatch');
  result.externalBlocked=await new Promise(resolve=>{const socket=net.createConnection({host:'1.1.1.1',port:443});
   socket.setTimeout(2000);socket.once('connect',()=>{socket.destroy();resolve(false)});
   socket.once('error',()=>resolve(true));socket.once('timeout',()=>{socket.destroy();resolve(true)})});
  check(result.externalBlocked,'workspace extension unexpectedly reached external network');
  const terminalFile=project.path+${JSON.stringify('/.sakura-vscode-terminal-account-' + nonce)};
  const terminal=vscode.window.createTerminal({name:'Sakura private terminal check',shellPath:'/bin/sh',
   shellArgs:['-c','{ id -u; id -g; readlink /proc/self/ns/net; } > '+JSON.stringify(terminalFile)],cwd:folder.uri});terminal.show();
  for(let i=0;i<1200&&!ready(terminalFile);i++)await wait(50);
  check(ready(terminalFile),'integrated terminal did not create its result');
  const terminalIdentity=fs.readFileSync(terminalFile,'utf8').trim().split('\\n');terminal.dispose();
  result.terminalUid=Number(terminalIdentity[0]);result.terminalGid=Number(terminalIdentity[1]);result.terminalNetwork=terminalIdentity[2];
  check(result.terminalNetwork===result.expectedNetwork,'integrated terminal network mismatch');
  check(result.terminalUid===project.uid&&result.terminalGid===project.gid,'integrated terminal project account mismatch');
  const taskFile=project.path+${JSON.stringify('/.sakura-vscode-task-account-' + nonce)};
  const shellQuote=value=>"'"+value.replaceAll("'","'\\\\''")+"'";
  const task=new vscode.Task({type:'sakura-network-probe'},folder,'Sakura private task check','Sakura',
   new vscode.ShellExecution('{ id -u; id -g; readlink /proc/self/ns/net; } > '+shellQuote(taskFile),{executable:'/bin/sh',shellArgs:['-c']}));
  let taskExit;const taskEnd=vscode.tasks.onDidEndTaskProcess(event=>{
   if(event.execution.task.name===task.name)taskExit=event.exitCode;
  });
  await vscode.tasks.executeTask(task);
  for(let i=0;i<1200&&!ready(taskFile)&&taskExit===undefined;i++)await wait(50);
  taskEnd.dispose();result.taskExitCode=taskExit;
  check(ready(taskFile),'task did not create its result (exit '+taskExit+')');
  const taskIdentity=fs.readFileSync(taskFile,'utf8').trim().split('\\n');
  result.taskUid=Number(taskIdentity[0]);result.taskGid=Number(taskIdentity[1]);result.taskNetwork=taskIdentity[2];
  check(result.taskNetwork===result.expectedNetwork,'task network mismatch');
  check(result.taskUid===project.uid&&result.taskGid===project.gid,'task project account mismatch');
  result.ok=true;
 }catch(error){result.error=String(error&&error.stack||error)}
 fs.writeFileSync(output,JSON.stringify(result));
 if(result.ok){await wait(1000);await vscode.commands.executeCommand('workbench.action.closeWindow')}
};
exports.deactivate=()=>{};
`;
}
