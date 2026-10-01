import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { clipboardModernRuntimeFixture } from './clipboard-modern-runtime-fixture.mjs';

assert.equal(process.platform, 'win32');
const run = promisify(execFile),
  bits = Number(process.argv[2] || 64);
assert.ok(bits === 64 || bits === 32);
const root = resolve('.data/native-clipboard-interface-test-temp/interface-' + bits + '-' + randomUUID());
await mkdir(join(root, 'assets'), { recursive: true });
process.env.TEMP = root;
process.env.TMP = root;
process.env.DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false';
process.env.DOTNET_ADD_GLOBAL_TOOLS_TO_PATH = 'false';
process.env.DOTNET_DISABLE_GUI_ERRORS = '1';
const source = resolve('native/windows-clipboard/fixture-interfaces.cpp');
const assets = resolve(process.env.SAKURA_NATIVE_CLIPBOARD_ASSETS || '.tools/native-clipboard');
const manifest = JSON.parse(await readFile(join(assets, 'native-clipboard.json'), 'utf8'));
for (const file of manifest.files) {
  const bytes = await readFile(join(assets, file.name));
  assert.equal(bytes.length, file.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  await writeFile(join(root, 'assets', file.name), bytes);
}
await writeFile(join(root, 'assets/native-clipboard.json'), JSON.stringify(manifest, null, 2));
const compiler32 = resolve('.tools/mingw32-16.2.0/mingw32/bin/g++.exe');
const compiler =
  bits === 32
    ? process.env.SAKURA_NATIVE_CLIPBOARD_CXX32 ||
      (existsSync(compiler32) ? compiler32 : 'i686-w64-mingw32-g++.exe')
    : process.env.SAKURA_NATIVE_CLIPBOARD_CXX || 'g++.exe';
const executable = join(root, 'fixture-interfaces.exe');
await run(
  compiler,
  [
    '-std=c++17',
    '-O2',
    '-s',
    '-static',
    '-municode',
    source,
    '-o',
    executable,
    '-lole32',
    '-luuid',
    '-lshell32',
    '-ladvapi32',
  ],
  { timeout: 60_000, windowsHide: true },
);
const fixtureSha256 = createHash('sha256')
  .update(await readFile(executable))
  .digest('hex');
const framework = join(
  process.env.SystemRoot || 'C:\\Windows',
  'Microsoft.NET',
  bits === 64 ? 'Framework64' : 'Framework',
  'v4.0.30319',
);
const managedCompiler = join(framework, 'csc.exe'),
  managedSource = resolve('native/windows-clipboard/fixture-interfaces.cs');
const managedExecutable = join(root, 'fixture-interfaces-managed.exe');
assert.ok(existsSync(managedCompiler), 'Offline .NET Framework compiler unavailable');
await run(
  managedCompiler,
  [
    '/nologo',
    '/target:exe',
    '/platform:' + (bits === 64 ? 'x64' : 'x86'),
    '/out:' + managedExecutable,
    '/r:System.Windows.Forms.dll',
    '/r:System.Web.Extensions.dll',
    '/r:System.Drawing.dll',
    '/r:System.Xaml.dll',
    '/r:' + join(framework, 'WPF/WindowsBase.dll'),
    '/r:' + join(framework, 'WPF/PresentationCore.dll'),
    '/r:' + join(framework, 'WPF/PresentationFramework.dll'),
    managedSource,
  ],
  { timeout: 60_000, windowsHide: true },
);
let modernExecutable, modernAssembly, modernRuntime, modernConfiguration, modernSdk;
if (process.env.SAKURA_CLIPBOARD_MODERN_DOTNET === '1') {
  const modern = join(root, 'modern');
  await mkdir(modern);
  const project = join(modern, 'fixture-interfaces-modern.csproj');
  const configuration = join(modern, 'NuGet.Config');
  await writeFile(
    configuration,
    '<?xml version="1.0"?><configuration><packageSources><clear/></packageSources></configuration>',
  );
  await writeFile(
    project,
    `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0-windows</TargetFramework><OutputType>Exe</OutputType><PlatformTarget>${bits === 32 ? 'x86' : 'x64'}</PlatformTarget><UseAppHost>${bits !== 32}</UseAppHost><RuntimeFrameworkVersion>10.0.9</RuntimeFrameworkVersion><RollForward>Disable</RollForward><UseWindowsForms>true</UseWindowsForms><UseWPF>true</UseWPF><EnableDefaultCompileItems>false</EnableDefaultCompileItems><NuGetAudit>false</NuGetAudit></PropertyGroup><ItemGroup><Compile Include="${managedSource}" /></ItemGroup></Project>`,
  );
  const env = {
    ...process.env,
    DOTNET_CLI_HOME: join(modern, 'home'),
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    NUGET_PACKAGES: join(modern, 'packages'),
  };
  const sdk = await run('dotnet.exe', ['--version'], { env, windowsHide: true, timeout: 15_000 });
  modernSdk = {
    version: sdk.stdout.trim(),
    cliHome: env.DOTNET_CLI_HOME,
    packageRoot: env.NUGET_PACKAGES,
    certificateGeneration: false,
    globalToolsPathRegistration: false,
    guiErrorsDisabled: true,
    nugetSources: [],
  };
  const restored = await run(
    'dotnet.exe',
    ['restore', project, '--configfile', configuration, '--disable-parallel'],
    { env, windowsHide: true, timeout: 60_000 },
  );
  const built = await run('dotnet.exe', ['build', project, '--no-restore', '--nologo'], {
    env,
    windowsHide: true,
    timeout: 60_000,
  });
  await writeFile(
    join(modern, 'offline-build.log'),
    sdk.stdout + sdk.stderr + restored.stdout + restored.stderr + built.stdout + built.stderr,
  );
  const output = join(modern, 'bin/Debug/net10.0-windows');
  modernAssembly = join(output, 'fixture-interfaces-modern.dll');
  modernConfiguration = JSON.parse(
    await readFile(join(output, 'fixture-interfaces-modern.runtimeconfig.json'), 'utf8'),
  );
  assert.equal(modernConfiguration.runtimeOptions.rollForward, 'Disable');
  assert.ok(modernConfiguration.runtimeOptions.frameworks.every((entry) => entry.version === '10.0.9'));
  if (bits === 32) {
    modernRuntime = await clipboardModernRuntimeFixture(
      join(root, 'modern-runtime'),
      process.env.SAKURA_CLIPBOARD_DOTNET_X86_RUNTIME,
    );
    modernExecutable = modernRuntime.host;
    process.env.DOTNET_ROOT_X86 = modernRuntime.root;
  } else modernExecutable = join(output, 'fixture-interfaces-modern.exe');
  process.env.DOTNET_MULTILEVEL_LOOKUP = '0';
  process.env.DOTNET_CLI_TELEMETRY_OPTOUT = '1';
  assert.ok(existsSync(modernExecutable));
}
const controller = join(root, 'assets', `sakura-clipboard-controller${bits === 32 ? '-x86' : ''}.exe`);
const library = join(root, 'assets', `SakuraClipboardPolicy${bits === 32 ? '-x86' : ''}.dll`);
const owner = randomUUID(),
  processes = [];
const report = {
  version: 1,
  bits,
  root,
  nativeBuild: manifest.build,
  nativeFiles: manifest.files,
  scope:
    process.env.SAKURA_CLIPBOARD_CREATION_PROBE_ONLY === '1'
      ? 'nested-control-creation'
      : 'ordinary-interfaces-full',
  fixtureSha256,
  sourceSha256: createHash('sha256')
    .update(await readFile(source))
    .digest('hex'),
  privateStationOnly: true,
  clipboardHistoryAndCloudApiInvoked: false,
  managedFixtureSha256: createHash('sha256')
    .update(await readFile(managedExecutable))
    .digest('hex'),
  managedSourceSha256: createHash('sha256')
    .update(await readFile(managedSource))
    .digest('hex'),
  managedCompiler,
  controlledClrAnyCpuGuardRetained: true,
  modernManagedFixtureSha256: modernExecutable
    ? createHash('sha256')
        .update(await readFile(modernExecutable))
        .digest('hex')
    : undefined,
  modernAssemblySha256: modernAssembly
    ? createHash('sha256')
        .update(await readFile(modernAssembly))
        .digest('hex')
    : undefined,
  modernRuntimeConfiguration: modernConfiguration,
  modernRuntime: modernRuntime?.proof,
  modernSdk,
  earlyClrOrAnyCpuLaunchTested: false,
  packagedUwpTested: false,
  managedLifecycle: [],
  tests: [],
  failures: [],
  leaks: [],
  mutations: [],
  unsupported: [],
  snapshots: [],
};
await writeFile(
  join(root, 'investigation-context.json'),
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      scope: 'owned ordinary Windows clipboard fixture',
      externalServiceDiscoveryPerformedThisRun: false,
      previousExternalDiscoveryEvidence:
        '.data/native-clipboard-interface-test-temp/summary-28d6f632-b62b-4e5e-bf82-f6e92bafdfd3/verification-summary.json',
      userAccountOrLicenseUsed: false,
      userGlobalSshOrIdeReadOrEdited: false,
      realFencingOrTrafficInvoked: false,
      sourceAudit: {
        baselineWin32Hooks: 8,
        baselineOleHooks: 3,
        currentWin32Hooks: 14,
        currentOleHooks: 3,
        explicitWinrtHooks: 0,
        ordinaryMessageAndManagedFixturesPresentAtCurrentStart: true,
        controlLifecycleHooksAdded: 6,
        missingHookDoesNotEstablishBypass: true,
        controlledClrAnyCpuGuardRetained: true,
      },
    },
    null,
    2,
  ),
);
console.log('Owned ordinary clipboard interfaces proof:', root, 'native build:', manifest.build);

async function launch(station, managed) {
  const pipe = '\\\\.\\pipe\\SakuraClipboardInterfaces.' + randomUUID();
  let socket,
    child,
    lines,
    closed = false,
    stderr = '';
  const queued = [],
    waiting = [];
  const server = createServer((connection) => {
    if (socket) {
      connection.destroy();
      return;
    }
    socket = connection;
    lines = createInterface({ input: socket });
    lines.on('line', (line) => {
      const value = JSON.parse(line);
      if (waiting.length) waiting.shift().resolve(value);
      else queued.push(value);
    });
    socket.on('close', () => {
      closed = true;
      for (const item of waiting.splice(0)) item.reject(new Error('Owned fixture pipe closed'));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, resolve);
  });
  const args = managed
    ? managed.assembly
      ? ['--managed-host-launch', managed.executable, managed.assembly, pipe, station, managed.framework]
      : ['--managed-launch', managed.executable, pipe, station, managed.framework]
    : ['--launch', pipe];
  child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('error', (error) => {
    closed = true;
    for (const item of waiting.splice(0)) item.reject(error);
  });
  child.on('exit', (code) => {
    closed = true;
    for (const item of waiting.splice(0)) item.reject(new Error(`Owned fixture exited ${code}: ${stderr}`));
  });
  const next = () =>
    queued.length
      ? Promise.resolve(queued.shift())
      : closed
        ? Promise.reject(new Error(stderr || 'Owned fixture closed'))
        : new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Owned fixture response timeout')), 30_000);
            waiting.push({
              resolve: (value) => {
                clearTimeout(timer);
                resolve(value);
              },
              reject: (error) => {
                clearTimeout(timer);
                reject(error);
              },
            });
          });
  const fixture = {
    child,
    image: managed?.executable || executable,
    request: async (action, text) => {
      socket.write(action + (text === undefined ? '' : '\t' + text) + '\n');
      return next();
    },
    close: async () => {
      socket?.end();
      if (!closed)
        await new Promise((resolve) => {
          child.once('exit', resolve);
          setTimeout(() => {
            if (!closed) child.kill();
            resolve();
          }, 5000).unref();
        });
      lines?.close();
      socket?.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  processes.push(fixture);
  fixture.ready = await next();
  assert.equal(fixture.ready.privateStation, true);
  assert.equal(fixture.ready.jobBound, true);
  assert.ok(fixture.ready.station && fixture.ready.station.toLowerCase() !== 'winsta0');
  if (managed && managed.framework !== '--native-peer') {
    assert.equal(fixture.ready.processBits, bits, 'Actual managed process architecture');
    assert.equal(fixture.ready.uiVisible, false, 'Owned managed UI must remain hidden');
    assert.equal(fixture.ready.policyPresent, false, 'Runtime fixture starts before ordinary attachment');
  }
  if (station) assert.equal(fixture.ready.station, station);
  return fixture;
}
async function agent(args) {
  try {
    return JSON.parse((await run(controller, args, { windowsHide: true, timeout: 30_000 })).stdout);
  } catch (error) {
    throw new Error(error.stdout ? JSON.parse(error.stdout).error : error.message);
  }
}
async function apply(fixture, flags, maximum = 1048576, active = true) {
  const state = await agent([
    'apply',
    owner,
    String(fixture.ready.pid),
    fixture.ready.created,
    fixture.image,
    library,
    String(flags),
    String(maximum),
    active ? '1' : '0',
  ]);
  assert.equal(state.ready, true);
  assert.equal(state.active, active);
  report.snapshots.push({ fixture: fixture.ready, rule: { flags, maximum, active }, state });
  return state;
}
async function snapshot(fixture, phase) {
  const state = await agent(['status', owner, String(fixture.ready.pid), fixture.ready.created]);
  assert.equal(state.ready, true);
  report.snapshots.push({ fixture: fixture.ready, phase, state });
  return state;
}
const plain = 'owned interfaces ordinary text 中文',
  secret = 'password=owned-interfaces-secret-123456789';
const overflow = '中'.repeat(600);
function check(label, observed, expected, detail) {
  const pass = observed === expected;
  report.tests.push({ label, pass, observed, expected, ...detail });
  if (!pass) {
    report.failures.push(label);
    console.error('ORDINARY API POLICY FAILURE:', label);
  } else console.log('passed:', label);
  return pass;
}
function blockedTransfer(label, observed, forbidden, detail) {
  const pass = check(label, observed === forbidden, false, { observedText: observed, ...detail });
  if (!pass) report.leaks.push(label);
  return pass;
}
function preserved(label, observed, expected, detail) {
  const pass = check(label, observed, expected, detail);
  if (!pass) report.mutations.push(label);
  return pass;
}
async function ordinarySuite(target, peer, name) {
  const plain = name.endsWith('ansi')
    ? 'owned interfaces ordinary ANSI text'
    : 'owned interfaces ordinary text 中文';
  const overflow = name.endsWith('ansi') ? 'a'.repeat(1800) : '中'.repeat(600);
  const prefix = name === 'winrt' ? 'winrt' : name;
  const copyAction = prefix + '-copy',
    pasteAction = prefix === 'winrt' ? 'winrt-read' : prefix + '-paste';
  await apply(target, 3);
  await peer.request('write', plain);
  const pasted = await target.request(pasteAction);
  if (!pasted.ok || pasted.text !== plain) {
    report.unsupported.push({ name, reason: 'Allowed paste baseline unavailable', result: pasted });
    console.log('not established:', name, pasted.error);
    return;
  }
  await peer.request('write', 'baseline marker');
  const copied = await target.request(copyAction, plain);
  const baseline = await peer.request('read');
  if (baseline.text !== plain) {
    const diagnostic = name.startsWith('rich')
      ? await target.request(name + '-diagnostic', plain)
      : undefined;
    report.unsupported.push({
      name,
      reason: 'Allowed copy baseline unavailable',
      result: copied,
      diagnostic,
    });
    console.log('not established:', name, copied.error);
    return;
  }
  report.tests.push({ label: name + ' allowed ordinary copy/paste baseline', pass: true });
  await apply(target, 1);
  await peer.request('write', plain);
  const deniedPaste = await target.request(pasteAction);
  blockedTransfer(name + ' paste denied', deniedPaste.text, plain, { result: deniedPaste });
  await snapshot(target, name + ' paste denied');
  await apply(target, 2);
  await peer.request('write', 'untouched marker');
  const deniedCopy = await target.request(copyAction, plain),
    afterCopy = await peer.request('read');
  blockedTransfer(name + ' copy denied', afterCopy.text, plain, { result: deniedCopy });
  preserved(name + ' denied copy preserves previous clipboard', afterCopy.text, 'untouched marker', {
    result: deniedCopy,
  });
  await snapshot(target, name + ' copy denied');
  if (['edit', 'rich', 'editansi', 'richansi'].includes(name)) {
    await peer.request('write', 'untouched marker');
    const cut = await target.request(name + '-cut', plain),
      afterCut = await peer.request('read');
    blockedTransfer(name + ' cut clipboard denied', afterCut.text, plain, { result: cut });
    preserved(name + ' denied cut preserves previous clipboard', afterCut.text, 'untouched marker', {
      result: cut,
    });
    preserved(name + ' denied cut preserves source', cut.text, plain, { result: cut });
    await snapshot(target, name + ' cut denied');
  }
  await apply(target, 11);
  await peer.request('write', secret);
  const sensitivePaste = await target.request(pasteAction);
  blockedTransfer(name + ' sensitive paste denied', sensitivePaste.text, secret, { result: sensitivePaste });
  await snapshot(target, name + ' sensitive paste denied');
  await peer.request('write', 'untouched marker');
  const sensitiveCopy = await target.request(copyAction, secret),
    afterSensitiveCopy = await peer.request('read');
  blockedTransfer(name + ' sensitive copy denied', afterSensitiveCopy.text, secret, {
    result: sensitiveCopy,
  });
  preserved(
    name + ' sensitive copy preserves previous clipboard',
    afterSensitiveCopy.text,
    'untouched marker',
    { result: sensitiveCopy },
  );
  await snapshot(target, name + ' sensitive copy denied');
  await apply(target, 3, 1024);
  await peer.request('write', overflow);
  const longPaste = await target.request(pasteAction);
  blockedTransfer(name + ' UTF-8 paste limit', longPaste.text, overflow, { result: longPaste });
  await snapshot(target, name + ' UTF-8 paste limit');
  await peer.request('write', 'untouched marker');
  const longCopy = await target.request(copyAction, overflow),
    afterLongCopy = await peer.request('read');
  blockedTransfer(name + ' UTF-8 copy limit', afterLongCopy.text, overflow, { result: longCopy });
  preserved(name + ' UTF-8 copy preserves previous clipboard', afterLongCopy.text, 'untouched marker', {
    result: longCopy,
  });
  await snapshot(target, name + ' UTF-8 copy limit');
}
async function keyboardAndLifecycleSuite(target, peer, name) {
  const plain = name.endsWith('ansi')
    ? 'owned interfaces ordinary ANSI text'
    : 'owned interfaces ordinary text 中文';
  check(
    name + ' existing control subclass confirmed',
    (await target.request(name + '-confirm', manifest.build)).ok,
    true,
  );
  for (const binding of ['ctrl-c', 'ctrl-x', 'ctrl-insert', 'shift-delete']) {
    await apply(target, 3);
    await peer.request('write', 'keyboard baseline marker');
    const permitted = await target.request(name + '-key-' + binding, plain);
    check(
      name + ' ' + binding + ' original keyboard copy baseline',
      (await peer.request('read')).text,
      plain,
      { result: permitted },
    );
    if (binding === 'ctrl-c' || binding === 'ctrl-x')
      check(name + ' ' + binding + ' translated WM_CHAR', permitted.translatedChars > 0, true);
    if (binding === 'ctrl-x' || binding === 'shift-delete')
      check(name + ' ' + binding + ' original keyboard cut baseline', permitted.text, '');
    await apply(target, 2);
    await peer.request('write', 'untouched marker');
    const denied = await target.request(name + '-key-' + binding, plain),
      afterDenied = await peer.request('read');
    blockedTransfer(name + ' ' + binding + ' copy denied', afterDenied.text, plain, { result: denied });
    preserved(name + ' ' + binding + ' denied clipboard retained', afterDenied.text, 'untouched marker');
    preserved(name + ' ' + binding + ' denied source retained', denied.text, plain);
    await apply(target, 11);
    await peer.request('write', 'untouched marker');
    const sensitive = await target.request(name + '-key-' + binding, secret),
      afterSensitive = await peer.request('read');
    blockedTransfer(name + ' ' + binding + ' sensitive copy denied', afterSensitive.text, secret, {
      result: sensitive,
    });
    preserved(
      name + ' ' + binding + ' sensitive clipboard retained',
      afterSensitive.text,
      'untouched marker',
    );
    preserved(name + ' ' + binding + ' sensitive source retained', sensitive.text, secret);
    await snapshot(target, name + ' ' + binding + ' ordinary keyboard handlers');
  }
  await apply(target, 3, 1024);
  await peer.request('write', 'boundary marker');
  await target.request(name + '-copy', 'v'.repeat(1024));
  check(name + ' exact ASCII UTF-8 boundary allowed', (await peer.request('read')).text, 'v'.repeat(1024));
  await apply(target, 11);
  await peer.request('write', 'selection marker');
  await target.request(name + '-selection-copy', secret + ' owned safe slice');
  check(
    name + ' selected safe text from sensitive document allowed',
    (await peer.request('read')).text,
    'owned safe slice',
  );
  for (let index = 0; index < 3; index++) {
    await apply(target, 2);
    const recreated = await target.request(name + '-recreate');
    check(name + ' owned HWND destroy/recreate ' + index, recreated.ok, true, { result: recreated });
    check(
      name + ' recreated subclass confirmed ' + index,
      (await target.request(name + '-confirm', manifest.build)).ok,
      true,
    );
    await peer.request('write', 'untouched marker');
    const denied = await target.request(name + '-cut', plain);
    preserved(
      name + ' recreated denied clipboard retained ' + index,
      (await peer.request('read')).text,
      'untouched marker',
    );
    preserved(name + ' recreated denied source retained ' + index, denied.text, plain);
    await apply(target, 3);
    await target.request(name + '-copy', plain);
    check(name + ' hot reenabled recreated copy ' + index, (await peer.request('read')).text, plain);
  }
}
async function olePreflightSuite(target, peer) {
  for (const mode of ['unavailable', 'noenum', 'binaryonly']) {
    await apply(target, 3);
    await peer.request('write', 'untouched marker');
    const result = await target.request('ole-probe-' + mode, plain);
    check('OLE ' + mode + ' fails before replacing old clipboard', result.ok, false, { result });
    preserved(
      'OLE ' + mode + ' previous clipboard retained',
      (await peer.request('read')).text,
      'untouched marker',
    );
    await snapshot(target, 'OLE incomplete or blocked format preflight ' + mode);
  }
  await apply(target, 7);
  const binary = await target.request('ole-probe-binaryonly', plain);
  check('OLE permitted binary-only format retains existing files rule', binary.ok, true, { result: binary });
  check('OLE permitted binary-only public read available', (await peer.request('read-binary')).ok, true);
  await apply(target, 3);
  await peer.request('write', 'untouched marker');
  const copying = target.request('ole-probe-changing', plain);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await apply(target, 2);
  const changed = await copying;
  check('OLE policy changed while reading provider refuses copy', changed.ok, false, { result: changed });
  preserved(
    'OLE changed policy retains previous clipboard',
    (await peer.request('read')).text,
    'untouched marker',
  );
  await apply(target, 3);
  await peer.request('write', 'untouched marker');
  const mixed = await target.request('ole-copy-rich', plain);
  check('OLE mixed formats keep permitted plain text', mixed.ok, true);
  check('OLE mixed formats filtered public text available', (await peer.request('ole-read')).text, plain);
  check(
    'OLE mixed formats blocked alternate format hidden',
    (await peer.request('ole-read-binary')).ok,
    false,
  );
}
async function nestedCreationSuite(target, peer) {
  const text = 'owned nested ordinary ANSI text';
  for (const parent of ['a', 'w'])
    for (const child of ['edit', 'editansi', 'rich', 'richansi']) {
      const name = `nested ${parent} parent ${child}`;
      await apply(target, 3);
      await peer.request('write', 'nested baseline marker');
      const baseline = await target.request(`nested-${parent}-${child}`, text);
      check(name + ' created standard child', baseline.ok, true, { result: baseline });
      check(name + ' before parent returns allowed clipboard', (await peer.request('read')).text, text);
      check(name + ' before parent returns allowed cut source', baseline.text, '');
      await apply(target, 2);
      await peer.request('write', 'untouched marker');
      const denied = await target.request(`nested-${parent}-${child}`, text),
        copied = await peer.request('read');
      blockedTransfer(name + ' before parent returns prohibited transfer refused', copied.text, text);
      preserved(name + ' before parent returns source retained', denied.text, text);
      preserved(name + ' before parent returns clipboard retained', copied.text, 'untouched marker');
      await snapshot(target, name + ' creation return boundary');
    }
}
async function managedLifecycleSuite(target, peer, name) {
  const family = `${target.ready.modern ? 'modern ' : 'Framework '}${name}`;
  const selected = 'owned selected 中文';
  const prefix = 'prefix ',
    suffix = ' suffix password=hidden-document-only';
  const document = prefix + selected + suffix;
  const prepare = (value, offset, count) =>
    target.request(name + '-prepare-selection', `${offset}:${count}:${value}`);
  const retains = (label, value, source, offset, count, selection) => {
    preserved(family + ' ' + label + ' source retained', value.text, source, { result: value });
    check(family + ' ' + label + ' selection start retained', value.selectionStart, offset);
    check(family + ' ' + label + ' selection length retained', value.selectionLength, count);
    preserved(family + ' ' + label + ' selected text retained', value.selectedText, selection);
    check(family + ' ' + label + ' hidden owned control alive', value.uiAlive && !value.uiVisible, true);
  };
  await apply(target, 11);
  let before = await prepare(document, prefix.length, selected.length);
  check(family + ' initial selected document ready', before.selectedText, selected);
  await target.request(name + '-copy-current');
  check(
    family + ' selected safe slice of sensitive document allowed',
    (await peer.request('read')).text,
    selected,
  );
  retains(
    'allowed partial copy',
    await target.request(name + '-snapshot'),
    document,
    prefix.length,
    selected.length,
    selected,
  );
  await apply(target, 2);
  for (const action of ['copy', 'cut']) {
    await peer.request('write', 'untouched marker');
    const result = await target.request(name + '-' + action + '-current');
    const copied = await peer.request('read');
    blockedTransfer(family + ' hot denied partial ' + action + ' has no transfer', copied.text, selected);
    preserved(
      family + ' hot denied partial ' + action + ' clipboard retained',
      copied.text,
      'untouched marker',
    );
    retains('hot denied partial ' + action, result, document, prefix.length, selected.length, selected);
  }
  await apply(target, 11);
  const sensitiveDocument = prefix + secret + ' suffix';
  await prepare(sensitiveDocument, prefix.length, secret.length);
  await peer.request('write', 'untouched marker');
  const deniedSensitive = await target.request(name + '-cut-current');
  preserved(
    family + ' sensitive partial cut clipboard retained',
    (await peer.request('read')).text,
    'untouched marker',
  );
  retains('sensitive partial cut', deniedSensitive, sensitiveDocument, prefix.length, secret.length, secret);
  const overflow = '中'.repeat(600),
    longDocument = prefix + overflow + ' suffix';
  await apply(target, 3, 1024);
  await prepare(longDocument, prefix.length, overflow.length);
  await peer.request('write', 'untouched marker');
  const deniedLimit = await target.request(name + '-cut-current');
  preserved(
    family + ' UTF-8 partial cut clipboard retained',
    (await peer.request('read')).text,
    'untouched marker',
  );
  retains('UTF-8 partial cut', deniedLimit, longDocument, prefix.length, overflow.length, overflow);
  for (let index = 0; index < 3; index++) {
    await apply(target, 2);
    const recreated = await target.request(name + '-recreate');
    check(
      family + ' destroyed old HWND before rebuilding ' + index,
      recreated.oldDestroyedBeforeCreate,
      true,
      { result: recreated },
    );
    check(
      family + ' new hidden owned control alive ' + index,
      recreated.uiAlive && !recreated.uiVisible,
      true,
    );
    check(family + ' new control still has policy ' + index, recreated.policyPresent, true);
    report.managedLifecycle.push({ family, iteration: index, before: before.uiHandle, ...recreated });
    before = recreated;
    await prepare(document, prefix.length, selected.length);
    await peer.request('write', 'untouched marker');
    const denied = await target.request(name + '-cut-current');
    preserved(
      family + ' rebuilt denied clipboard retained ' + index,
      (await peer.request('read')).text,
      'untouched marker',
    );
    retains('rebuilt denied cut ' + index, denied, document, prefix.length, selected.length, selected);
    await apply(target, 3);
    await target.request(name + '-copy-current');
    check(
      family + ' rebuilt hot reenabled selected copy ' + index,
      (await peer.request('read')).text,
      selected,
    );
    await snapshot(target, family + ' rebuilt control ' + index);
  }
  await apply(target, 3, 1048576, false);
  await target.request(name + '-cut-current');
  check(
    family + ' explicit disable allows ordinary selected cut',
    (await peer.request('read')).text,
    selected,
  );
  check(
    family + ' explicit disable deletes only selected range',
    (await target.request(name + '-snapshot')).text,
    prefix + suffix,
  );
  await apply(target, 2);
  await prepare(document, prefix.length, selected.length);
  await peer.request('write', 'untouched marker');
  const enabled = await target.request(name + '-cut-current');
  preserved(family + ' reenable clipboard retained', (await peer.request('read')).text, 'untouched marker');
  retains('reenabled cut', enabled, document, prefix.length, selected.length, selected);
}
let peer,
  target,
  completed = false;
try {
  peer = await launch();
  // Join the same freshly created private station, never the user's WinSta0.
  // The --launch launcher creates its own station. A dedicated launch variant
  // is used for every peer sharing the original station.
  target = await launch(peer.ready.station, { executable, framework: '--native-peer' });
  report.station = peer.ready.station;
  report.identities = { peer: peer.ready, target: target.ready };
  report.keyboardInputScope =
    'Own private GUI thread SetKeyboardState, standard WM_KEYDOWN/TranslateMessage/WM_CHAR; no global SendInput';
  if (report.scope !== 'ordinary-interfaces-full') await nestedCreationSuite(target, peer);
  if (report.scope === 'ordinary-interfaces-full') {
    report.ansiUnicodeObservation = [];
    for (const name of ['editansi', 'richansi']) {
      await peer.request('write', 'unhooked ANSI observation marker');
      const result = await target.request(name + '-copy', plain),
        copied = await peer.request('read');
      report.ansiUnicodeObservation.push({
        name,
        phase: 'before-policy',
        input: plain,
        source: result.text,
        clipboard: copied.text,
      });
    }
    for (const name of ['edit', 'rich', 'editansi', 'richansi'])
      check(
        name + ' unhooked before attachment',
        (await target.request(name + '-confirm', manifest.build)).ok,
        false,
      );
    for (const name of ['edit', 'rich', 'editansi', 'richansi', 'winrt'])
      await ordinarySuite(target, peer, name);
    for (const name of ['edit', 'rich', 'editansi', 'richansi'])
      await keyboardAndLifecycleSuite(target, peer, name);
    await nestedCreationSuite(target, peer);
    await apply(target, 3);
    for (const previous of report.ansiUnicodeObservation) {
      const result = await target.request(previous.name + '-copy', plain),
        copied = await peer.request('read');
      check(previous.name + ' platform Unicode source conversion unchanged', result.text, previous.source);
      check(
        previous.name + ' platform Unicode clipboard conversion unchanged',
        copied.text,
        previous.clipboard,
      );
    }
    await olePreflightSuite(target, peer);
    await apply(target, 3);
    await peer.request('write', plain);
    const cached = await target.request('winrt-cache');
    if (cached.ok) {
      await apply(target, 1);
      const result = await target.request('winrt-read-cached');
      blockedTransfer('WinRT cached DataPackageView after paste restriction', result.text, plain, { result });
      await snapshot(target, 'WinRT cached DataPackageView after paste restriction');
    }
    await apply(target, 3, 1048576, false);
    check('explicit disable restores ordinary Win32 read', (await target.request('read')).text, plain);
    report.managedIdentities = [];
    for (const selected of [
      { executable: managedExecutable, modern: false },
      ...(modernExecutable
        ? [{ executable: modernExecutable, assembly: bits === 32 ? modernAssembly : undefined, modern: true }]
        : []),
    ])
      for (const name of ['winforms', 'wpf', 'winforms-ui', 'wpf-ui']) {
        const managed = await launch(peer.ready.station, { ...selected, framework: name });
        assert.equal(managed.ready.modern, selected.modern);
        if (selected.modern) {
          assert.equal(managed.ready.runtime, '10.0.9');
          assert.equal(managed.ready.processArchitecture, bits === 32 ? 'X86' : 'X64');
          if (modernRuntime)
            for (const [field, directory] of [
              ['coreLibPath', 'Microsoft.NETCore.App'],
              ['coreClrPath', 'Microsoft.NETCore.App'],
              ['desktopAssemblyPath', 'Microsoft.WindowsDesktop.App'],
            ])
              assert.ok(
                managed.ready[field]
                  .toLowerCase()
                  .startsWith(join(modernRuntime.root, 'shared', directory, '10.0.9').toLowerCase() + '\\'),
                field + ' must use the verified private runtime',
              );
        }
        report.managedIdentities.push(managed.ready);
        await ordinarySuite(managed, peer, name);
        if (name.endsWith('-ui')) {
          await apply(managed, 2);
          await peer.request('write', 'untouched marker');
          const cut = await managed.request(name + '-cut', plain);
          blockedTransfer(name + ' UI cut copied text denied', (await peer.request('read')).text, plain, {
            result: cut,
          });
          preserved(name + ' UI cut source retained', cut.text, plain);
          preserved(
            name + ' UI cut clipboard retained',
            (await peer.request('read')).text,
            'untouched marker',
          );
          await managedLifecycleSuite(managed, peer, name);
        }
        if (name.endsWith('-ui')) continue;
        await apply(managed, 3);
        await peer.request('write', plain);
        const cached = await managed.request(name + '-cache');
        if (cached.ok) {
          await apply(managed, 1);
          const result = await managed.request(name + '-read-cached');
          blockedTransfer(name + ' cached IDataObject after paste restriction', result.text, plain, {
            result,
          });
          await snapshot(managed, name + ' cached IDataObject after paste restriction');
        }
        await apply(managed, 3, 1048576, false);
        await peer.request('write', plain);
        check(
          name + ' explicit disable restores ordinary read',
          (await managed.request(name + '-paste')).text,
          plain,
        );
      }
  }
  completed = true;
} catch (error) {
  report.runtimeFailure = { name: error.name, message: error.message };
  throw error;
} finally {
  for (const fixture of processes.reverse()) await fixture.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  report.completed = completed;
  report.outcome = !completed
    ? 'incomplete-probe'
    : report.leaks.length
      ? 'ordinary-api-data-leak'
      : report.failures.length
        ? 'ordinary-api-regression-failure'
        : report.unsupported.length
          ? 'required-baseline-unavailable'
          : 'no-leak-or-mutation-in-supported-probes';
  await writeFile(join(root, 'interfaces-proof.json'), JSON.stringify(report, null, 2));
  console.log('Evidence:', join(root, 'interfaces-proof.json'));
}
assert.equal(
  report.leaks.length,
  0,
  'Ordinary public APIs transferred prohibited data; inspect the owned evidence',
);
assert.equal(
  report.failures.length,
  0,
  'Ordinary public API rejection mutated clipboard or source text; inspect the owned evidence',
);
assert.equal(
  report.unsupported.length,
  0,
  'Required ordinary API allowed baseline unavailable; inspect the owned evidence',
);
