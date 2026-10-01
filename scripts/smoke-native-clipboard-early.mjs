import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { basename, dirname, join, resolve } from 'node:path';
import { NativeClipboard } from '../server/native-clipboard.ts';

assert.equal(process.platform, 'win32');
const bits = Number(process.argv[2] || '64');
assert.ok(bits === 32 || bits === 64);
const folder = resolve('.data/native-clipboard-test-temp/early-fixture-' + randomUUID());
await mkdir(folder, { recursive: true });
process.env.TEMP = process.env.TMP = resolve('.data/native-clipboard-test-temp');
const execute = promisify(execFile);
const compiler =
  bits === 32
    ? process.env.SAKURA_NATIVE_CLIPBOARD_CXX32 || resolve('.tools/mingw32-16.2.0/mingw32/bin/g++.exe')
    : process.env.SAKURA_NATIVE_CLIPBOARD_CXX || 'g++.exe';
const common = ['-std=c++17', '-O2', '-s', '-static', '-Wl,--no-insert-timestamp'];
const application = join(folder, 'early.exe'),
  holder = join(folder, 'station.exe'),
  probe = join(folder, 'EarlySakuraProbe.dll');
const importLibrary = join(folder, 'libEarlySakuraProbe.a');
const manifestApplication = join(folder, 'manifest.exe'),
  redirectApplication = join(folder, 'redirect.exe'),
  externalManifestApplication = join(folder, 'external-manifest.exe'),
  privateApplication = join(folder, 'private-assembly.exe'),
  privateRedirectApplication = join(folder, 'private-redirect.exe');
await execute(
  compiler,
  [
    ...common,
    '-shared',
    `-Wl,--out-implib,${importLibrary}`,
    resolve('native/windows-clipboard/fixture-early-dll.cpp'),
    '-o',
    probe,
    '-lole32',
  ],
  { windowsHide: true, timeout: 60000 },
);
await execute(
  compiler,
  [
    ...common,
    '-municode',
    resolve('native/windows-clipboard/fixture-early.cpp'),
    importLibrary,
    '-o',
    application,
    '-lole32',
  ],
  { windowsHide: true, timeout: 60000 },
);
await execute(
  compiler,
  [
    ...common,
    '-municode',
    resolve('native/windows-clipboard/fixture.cpp'),
    '-o',
    holder,
    '-lole32',
    '-luuid',
    '-lshell32',
    '-ladvapi32',
  ],
  { windowsHide: true, timeout: 60000 },
);
async function channel() {
  const pipe = '\\\\.\\pipe\\SakuraEarlyFixture.' + randomUUID();
  const server = createServer();
  let socket, lines;
  const queued = [],
    waiting = [];
  server.on('connection', (connection) => {
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
      for (const item of waiting.splice(0)) item.reject(new Error('owned fixture channel closed'));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, resolve);
  });
  return {
    pipe,
    next: () =>
      queued.length
        ? Promise.resolve(queued.shift())
        : new Promise((resolve, reject) => {
            const item = {
              resolve: (value) => {
                clearTimeout(timer);
                resolve(value);
              },
              reject: (error) => {
                clearTimeout(timer);
                reject(error);
              },
            };
            const timer = setTimeout(() => {
              waiting.splice(waiting.indexOf(item), 1);
              reject(new Error('owned fixture response timeout'));
            }, 40000);
            waiting.push(item);
          }),
    write: (value) => socket?.write(value),
    close: async () => {
      socket?.end();
      lines?.close();
      socket?.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
const windres = join(
  dirname(compiler.includes('/') || compiler.includes('\\') ? compiler : 'C:/Strawberry/c/bin/g++.exe'),
  'windres.exe',
);
async function manifestExecutable(target, redirect = false, dependency, imports = importLibrary) {
  const xml = target + '.resource.manifest',
    rc = xml + '.rc',
    object = xml + '.o';
  await writeFile(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
<assemblyIdentity type="win32" name="Sakura.EarlyFixture" version="1.0.0.0" processorArchitecture="*"/>
${redirect ? '<file name="user32.dll"/>' : dependency || '<dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency>'}
</assembly>`,
  );
  await writeFile(rc, `1 24 "${xml.replaceAll('\\', '/')}"\n`);
  await execute(windres, ['-i', rc, '-o', object, '-O', 'coff'], { windowsHide: true, timeout: 10000 });
  await execute(
    compiler,
    [
      ...common,
      '-municode',
      resolve('native/windows-clipboard/fixture-early.cpp'),
      imports,
      object,
      '-o',
      target,
      '-lole32',
    ],
    { windowsHide: true, timeout: 60000 },
  );
}
async function privateAssembly(target, redirect = false) {
  const name = `Sakura.EarlyPrivate.${bits}${redirect ? '.Redirect' : ''}`,
    dll = join(folder, name + '.dll'),
    imports = dll + '.a',
    xml = dll + '.manifest',
    rc = xml + '.rc',
    object = xml + '.o',
    identity = `<assemblyIdentity type="win32" name="${name}" version="1.0.0.0" processorArchitecture="${bits === 64 ? 'amd64' : 'x86'}"/>`;
  await writeFile(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">${identity}<file name="${redirect ? 'user32.dll' : basename(dll)}"/></assembly>`,
  );
  await writeFile(rc, `1 24 "${xml.replaceAll('\\', '/')}"\n`);
  await execute(windres, ['-i', rc, '-o', object, '-O', 'coff'], { windowsHide: true, timeout: 10000 });
  await execute(
    compiler,
    [
      ...common,
      '-shared',
      `-Wl,--out-implib,${imports}`,
      resolve('native/windows-clipboard/fixture-early-dll.cpp'),
      object,
      '-o',
      dll,
      '-lole32',
    ],
    { windowsHide: true, timeout: 60000 },
  );
  await manifestExecutable(
    target,
    false,
    `<dependency><dependentAssembly>${identity}</dependentAssembly></dependency>`,
    imports,
  );
}
await manifestExecutable(manifestApplication);
await manifestExecutable(redirectApplication, true);
await privateAssembly(privateApplication);
await privateAssembly(privateRedirectApplication, true);
await copyFile(application, externalManifestApplication);
await writeFile(
  externalManifestApplication + '.manifest',
  Buffer.from(
    '\ufeff<?xml version="1.0" encoding="UTF-16"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><assemblyIdentity type="win32" name="Sakura.EarlyExternalFixture" version="1.0.0.0" processorArchitecture="*"/><file name="user&#x33;2.dll"/></assembly>',
    'utf16le',
  ),
);
const station = await channel();
const holding = spawn(holder, ['--launch', station.pipe], {
  windowsHide: true,
  shell: false,
  stdio: 'ignore',
});
const file = join(folder, 'native.json'),
  assets = resolve('.tools/native-clipboard');
const service = new NativeClipboard({ file, assets, interval: 0 });
const run = await channel();
let launched;
const sessions = [];
async function manifestLaunch(identity, saved, application = manifestApplication) {
  const connection = await channel();
  sessions.push(connection);
  const sha256 = createHash('sha256')
    .update(await readFile(application))
    .digest('hex');
  await service.action({
    action: 'configure',
    version: service.view().version,
    settings: {
      enabled: true,
      applications: [
        ...service.view().settings.applications,
        {
          image: application,
          sha256,
          rule: { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 1048576 },
        },
      ],
    },
  });
  const committed = await service.action({
    action: 'launch',
    version: service.view().version,
    image: application,
    sha256,
    args: [
      `--early-station=${identity.station}`,
      `--early-owner=${saved.owner}`,
      `--early-pipe=${connection.pipe}`,
    ],
  });
  const evidence = await connection.next();
  assert.equal(evidence.pid, committed.process.pid);
  assert.equal(evidence.created, committed.process.created);
  assert.equal(evidence.phases.length, 4);
  for (const phase of evidence.phases) {
    assert.equal(phase.ready, true);
    assert.equal(phase.privateStation, true);
    assert.equal(phase.copyError, 5);
    assert.equal(phase.pasteError, 5);
  }
  return { process: committed.process, evidence };
}
async function rejectedRedirections(identity, saved) {
  const marker = join(folder, 'must-not-enter-redirected-initializer');
  const sha256 = createHash('sha256')
    .update(await readFile(redirectApplication))
    .digest('hex');
  await service.action({
    action: 'configure',
    version: service.view().version,
    settings: {
      enabled: true,
      applications: [
        ...service.view().settings.applications,
        {
          image: redirectApplication,
          sha256,
          rule: { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 1048576 },
        },
      ],
    },
  });
  const request = {
    action: 'launch',
    image: redirectApplication,
    sha256,
    args: [
      `--early-station=${identity.station}`,
      `--early-owner=${saved.owner}`,
      `--early-pipe=${run.pipe}`,
      `--early-marker=${marker}`,
    ],
  };
  const count = JSON.parse(await readFile(file, 'utf8')).managed.length;
  let manifestError;
  await assert.rejects(service.action({ ...request, version: service.view().version }), (error) => {
    manifestError = error.message;
    return /manifest redirects/.test(error.message);
  });
  assert.equal(existsSync(marker), false);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).managed.length, count);
  await writeFile(redirectApplication + '.local', 'owned redirection refusal test');
  await assert.rejects(
    service.action({ ...request, version: service.view().version }),
    /\.local redirection/,
  );
  assert.equal(existsSync(marker), false);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).managed.length, count);
  const externalHash = createHash('sha256')
    .update(await readFile(externalManifestApplication))
    .digest('hex');
  await service.action({
    action: 'configure',
    version: service.view().version,
    settings: {
      enabled: true,
      applications: [
        ...service.view().settings.applications,
        {
          image: externalManifestApplication,
          sha256: externalHash,
          rule: { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 1048576 },
        },
      ],
    },
  });
  let externalManifestError;
  await assert.rejects(
    service.action({
      ...request,
      image: externalManifestApplication,
      sha256: externalHash,
      version: service.view().version,
    }),
    (error) => {
      externalManifestError = error.message;
      return /manifest redirects/.test(error.message);
    },
  );
  assert.equal(existsSync(marker), false);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).managed.length, count);
  const privateHash = createHash('sha256')
    .update(await readFile(privateRedirectApplication))
    .digest('hex');
  await service.action({
    action: 'configure',
    version: service.view().version,
    settings: {
      enabled: true,
      applications: [
        ...service.view().settings.applications,
        {
          image: privateRedirectApplication,
          sha256: privateHash,
          rule: { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 1048576 },
        },
      ],
    },
  });
  let privateManifestError;
  await assert.rejects(
    service.action({
      ...request,
      image: privateRedirectApplication,
      sha256: privateHash,
      version: service.view().version,
    }),
    (error) => {
      privateManifestError = error.message;
      return /manifest redirects/.test(error.message);
    },
  );
  assert.equal(existsSync(marker), false);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).managed.length, count);
  return {
    policyDependencySxsRedirectRejected: true,
    externalUtf16CharacterReferenceRedirectRejected: true,
    manifestError,
    externalManifestError,
    privateAssemblyResourceRedirectRejected: true,
    privateManifestError,
    dotLocalRejected: true,
    noApplicationInitializer: true,
    noChildCreated: true,
  };
}
async function rejectedColdInitialization(identity) {
  const badAssets = join(folder, 'mismatched-assets');
  await cp(assets, badAssets, { recursive: true });
  const failedApplication = join(folder, 'failure.exe');
  await copyFile(application, failedApplication);
  const source = resolve('native/windows-clipboard'),
    minhook = join(source, 'vendor/minhook/src'),
    detours = join(source, 'vendor/detours/src');
  const name = `SakuraClipboardPolicy${bits === 32 ? '-x86' : ''}.dll`;
  await execute(
    compiler,
    [
      ...common,
      '-D__CRT__NO_INLINE',
      `-DSAKURA_CLIPBOARD_BUILD="${'f'.repeat(64)}"`,
      '-shared',
      '-Wl,--kill-at',
      join(source, 'policy.cpp'),
      join(source, 'early-policy.def'),
      ...['buffer.c', 'hook.c', 'trampoline.c', `hde/hde${bits}.c`].map((file) => join(minhook, file)),
      ...['detours.cpp', 'modules.cpp', 'disasm.cpp', 'image.cpp', 'creatwth.cpp'].map((file) =>
        join(detours, file),
      ),
      '-o',
      join(badAssets, name),
      '-luser32',
      '-lole32',
      '-luuid',
    ],
    { windowsHide: true, timeout: 60000 },
  );
  const manifest = JSON.parse(await readFile(join(badAssets, 'native-clipboard.json'), 'utf8'));
  const bytes = await readFile(join(badAssets, name)),
    entry = manifest.files.find((file) => file.name === name);
  entry.size = bytes.length;
  entry.sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(badAssets, 'native-clipboard.json'), JSON.stringify(manifest));
  const failureFile = join(folder, 'failure-native.json'),
    marker = join(folder, 'must-not-enter-application-initialization');
  const sha256 = createHash('sha256')
    .update(await readFile(failedApplication))
    .digest('hex');
  const failed = new NativeClipboard({ file: failureFile, assets: badAssets, interval: 0 });
  try {
    await failed.init();
    await failed.action({
      action: 'configure',
      version: failed.view().version,
      settings: {
        enabled: true,
        applications: [
          {
            image: failedApplication,
            sha256,
            rule: { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 1048576 },
          },
        ],
      },
    });
    const saved = JSON.parse(await readFile(failureFile, 'utf8'));
    let errorMessage;
    await assert.rejects(
      failed.action({
        action: 'launch',
        version: failed.view().version,
        image: failedApplication,
        sha256,
        args: [
          `--early-station=${identity.station}`,
          `--early-owner=${saved.owner}`,
          `--early-pipe=${run.pipe}`,
          `--early-marker=${marker}`,
        ],
      }),
      (error) => {
        errorMessage = error.message;
        return /初始化|initializ|modules unavailable/.test(error.message);
      },
    );
    const retained = JSON.parse(await readFile(failureFile, 'utf8')).managed;
    assert.equal(retained.length, 1, 'cold failure retains its durably saved ownership until reconciliation');
    assert.equal(
      existsSync(marker),
      false,
      'the first application DLL TLS callback must never execute after cold policy rejection',
    );
    const helper = join(badAssets, `sakura-clipboard-controller${bits === 32 ? '-x86' : ''}.exe`);
    const inventory = JSON.parse(
      (await execute(helper, ['list'], { windowsHide: true, timeout: 5000 })).stdout,
    ).processes;
    assert.equal(
      inventory.some((item) => item.pid === retained[0].pid && item.created === retained[0].created),
      false,
      'only the newly owned failed child is cleaned up',
    );
    const status = JSON.parse(
      (
        await execute(helper, ['status', saved.owner, String(retained[0].pid), retained[0].created], {
          windowsHide: true,
          timeout: 5000,
        })
      ).stdout,
    );
    assert.equal(status.present, false);
    assert.equal(
      inventory.some(
        (item) => item.pid === launched.process.pid && item.created === launched.process.created,
      ),
      true,
      'the previously committed owned fixture remains alive',
    );
    await failed.action({ action: 'refresh' });
    assert.equal(JSON.parse(await readFile(failureFile, 'utf8')).managed.length, 0);
    return {
      mismatchedBuildRejected: true,
      applicationInitializerNeverEntered: true,
      jobCleaned: true,
      ownershipRetainedUntilReconciliation: true,
      previousCommittedProcessRetained: true,
      errorMessage,
      process: retained[0],
    };
  } finally {
    await failed.close();
  }
}
try {
  const identity = await station.next();
  assert.notEqual(identity.station.toLowerCase(), 'winsta0');
  await service.init();
  // Bind the owned native executable by the same digest method as normal UI use.
  const sha256 = createHash('sha256')
    .update(await readFile(application))
    .digest('hex');
  await service.action({
    action: 'configure',
    version: service.view().version,
    settings: {
      enabled: true,
      applications: [
        {
          image: application,
          sha256,
          rule: { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 1048576 },
        },
      ],
    },
  });
  const saved = JSON.parse(await readFile(file, 'utf8'));
  const pending = service.action({
    action: 'launch',
    version: service.view().version,
    image: application,
    sha256,
    args: [`--early-station=${identity.station}`, `--early-owner=${saved.owner}`, `--early-pipe=${run.pipe}`],
  });
  launched = await pending;
  const evidence = await run.next();
  assert.equal(evidence.pid, launched.process.pid);
  assert.equal(evidence.created, launched.process.created);
  assert.equal(evidence.phases.length, 4);
  for (const [index, phase] of evidence.phases.entries()) {
    assert.equal(phase.phase, index);
    assert.equal(phase.pid, evidence.pid);
    assert.equal(phase.created, evidence.created);
    assert.equal(
      phase.ready,
      true,
      `phase ${index} must observe ready policy before its first clipboard call`,
    );
    assert.equal(phase.active, true);
    assert.equal(phase.privateStation, true);
    assert.equal(phase.systemUser32, true);
    assert.equal(phase.systemOle32, true);
    assert.equal(phase.flags, 8);
    assert.equal(phase.copyError, 5);
    assert.equal(phase.pasteError, 5);
    assert.equal(phase.oleCopy, 0x80070005);
    assert.equal(phase.olePaste, 0x80070005);
    assert.equal(phase.copies, (index + 1) * 2);
    assert.equal(phase.pastes, (index + 1) * 2);
  }
  assert.equal(evidence.phases[0].thread, evidence.phases[1].thread);
  assert.notEqual(
    evidence.phases[0].thread,
    evidence.phases[3].thread,
    'DLL initializers execute in the loader bootstrap before the suspended main thread resumes',
  );
  const manifest = JSON.parse(await readFile(join(assets, 'native-clipboard.json'), 'utf8'));
  const normalManifest = await manifestLaunch(identity, saved);
  const privateManifest = await manifestLaunch(identity, saved, privateApplication);
  const redirections = await rejectedRedirections(identity, saved);
  const coldFailure = await rejectedColdInitialization(identity);
  const proof = {
    bits,
    build: manifest.build,
    station: identity.station,
    process: launched.process,
    phases: ['application-dll-tls', 'application-dll-main', 'executable-tls', 'wmain'],
    evidence,
    coldFailure,
    normalManifest,
    privateManifest,
    redirections,
  };
  await writeFile(join(folder, 'early-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(
    `Actual ${bits}-bit first application DLL TLS/DllMain and executable TLS clipboard calls were blocked under ready policy in a private window station.`,
  );
  console.log(
    `Actual ${bits}-bit cold build mismatch failed before the first application DLL TLS callback; its Job cleaned up, ownership was retained and the prior committed fixture survived.`,
  );
  console.log(`Early initialization proof: ${join(folder, 'early-proof.json')}`);
  console.log(
    `Actual ${bits}-bit Common Controls and embedded private assembly manifest launches passed; User32 SxS, UTF-16 sidecar, private assembly resource and .local redirection were refused before child creation.`,
  );
} finally {
  run.write('exit\n');
  for (const connection of sessions) connection.write('exit\n');
  station.write('exit\n');
  await service.close();
  await Promise.all([run.close(), station.close(), ...sessions.map((connection) => connection.close())]);
  if (holding.exitCode === null)
    await new Promise((resolve) => {
      holding.once('exit', resolve);
      setTimeout(() => {
        holding.kill();
        resolve();
      }, 5000).unref();
    });
}
