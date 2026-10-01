import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const version = '10.0.9';
const metadataUrl = 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json';
// Fixed official 10.0.9 entries, cross-checked with Microsoft's release
// metadata. Reusing an owned fixture cannot replace these with its own hashes.
const archivePins = {
  'dotnet-runtime-win-x86.zip': {
    group: 'runtime',
    url: 'https://builds.dotnet.microsoft.com/dotnet/Runtime/10.0.9/dotnet-runtime-10.0.9-win-x86.zip',
    sha512:
      '78a76b1d3df217b6c24e84c4e76703edd5b512eec9b225ea9091128275d3c1c2033d8144ca25462ad03980b7062b7ef026ce05a6d1c0ffbbd0d7da236349aaf4',
  },
  'windowsdesktop-runtime-win-x86.zip': {
    group: 'windowsdesktop',
    url: 'https://builds.dotnet.microsoft.com/dotnet/WindowsDesktop/10.0.9/windowsdesktop-runtime-10.0.9-win-x86.zip',
    sha512:
      'd2a330ad2dfdaf5e6b78ed4f44e966ce40ce73d884acd9cdc585214ee88e4cf62c881efe64c2c2df8c065727ba1db4d8004d65b4ef46c6a343ed3210c8776f6a',
  },
};
// SHA-256 values of these files inside the SHA-512 verified official archives.
const filePins = {
  'dotnet.exe': '003c1aa2676409b02e2ed081bde4a55d78fde5cda3845dc0edbfb9f8cf45fe6e',
  'host/fxr/10.0.9/hostfxr.dll': 'fd9a71439c312a4667d693e31a0623950affaeaccc299300e6a8c47035fd12ef',
  'shared/Microsoft.NETCore.App/10.0.9/coreclr.dll':
    'd27cad32a1a0b3a4c79e5665b857acdcdf5da2066d86431aa19bfa42e7c99190',
  'shared/Microsoft.NETCore.App/10.0.9/System.Private.CoreLib.dll':
    '1435c0f0375612f40b8c64b70c3899bcfd12bba84848c9306aa91de1f401ee33',
  'shared/Microsoft.WindowsDesktop.App/10.0.9/System.Windows.Forms.dll':
    '757528dc653fe8f32d2ce02eca20263252984e1e6962cccb4dedcc29d8e110f8',
  'shared/Microsoft.WindowsDesktop.App/10.0.9/PresentationFramework.dll':
    '20c7f7bd87f9feba09c6c68903487523eb50c3dfe2fd3ef87b86ed2e53772b85',
  'shared/Microsoft.WindowsDesktop.App/10.0.9/PresentationCore.dll':
    '9af81af42807f9b7fb86025204fbcb245799acfecf17a321c31b44dbcb2b83fc',
  'shared/Microsoft.WindowsDesktop.App/10.0.9/WindowsBase.dll':
    '3d66a11f26131646033579d285bc911364e788c176d2f6c0ec11f10d4ae52f85',
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const privateParent = resolve('.data');
function ownedPath(path) {
  const result = resolve(path),
    difference = relative(privateParent, result);
  assert.ok(
    difference && !difference.startsWith('..') && !isAbsolute(difference),
    'Runtime fixture must be under this workspace .data',
  );
  assert.equal(result[0].toLowerCase(), resolve(process.cwd())[0].toLowerCase());
  return result;
}
async function official(url, maximum) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.hostname, 'builds.dotnet.microsoft.com');
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
    headers: { 'Accept-Encoding': 'identity' },
  });
  assert.equal(response.status, 200, `Official runtime download failed: ${response.status}`);
  const declared = response.headers.get('content-length'),
    length = declared === null ? null : Number(declared);
  if (length !== null) assert.ok(Number.isSafeInteger(length) && length > 0 && length <= maximum);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    assert.ok(total <= maximum);
    chunks.push(chunk);
  }
  assert.ok(total > 0);
  const bytes = Buffer.concat(chunks, total);
  if (
    length !== null &&
    (!response.headers.get('content-encoding') || response.headers.get('content-encoding') === 'identity')
  )
    assert.equal(bytes.length, length);
  return bytes;
}
function peX86(bytes, name) {
  assert.equal(bytes.readUInt16LE(0), 0x5a4d, name + ' DOS header');
  const offset = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.readUInt32LE(offset), 0x4550, name + ' PE header');
  assert.equal(bytes.readUInt16LE(offset + 4), 0x14c, name + ' must be real x86');
}
async function verifyFiles(root, proof) {
  assert.equal(proof.version, version);
  assert.equal(proof.rid, 'win-x86');
  assert.equal(proof.metadataUrl, metadataUrl);
  assert.deepEqual(proof.files, filePins);
  const hashes = {};
  for (const [name, expected] of Object.entries(proof.files)) {
    const path = resolve(root, name),
      difference = relative(root, path);
    assert.ok(difference && !difference.startsWith('..') && !isAbsolute(difference));
    const bytes = await readFile(path);
    hashes[name] = sha256(bytes);
    assert.equal(hashes[name], expected, 'Runtime fixture changed: ' + name);
    if (name === 'dotnet.exe' || name.endsWith('/coreclr.dll')) peX86(bytes, name);
  }
  return hashes;
}
export async function clipboardModernRuntimeFixture(destination, reused) {
  assert.equal(process.platform, 'win32');
  const root = ownedPath(reused || destination);
  let proof;
  if (reused) {
    proof = JSON.parse(await readFile(join(root, 'runtime-proof.json'), 'utf8'));
    await verifyFiles(root, proof);
    assert.equal(proof.archives.length, 2);
    assert.deepEqual(proof.archives.map((item) => item.localName).sort(), Object.keys(archivePins).sort());
    const metadataBytes = await readFile(join(root, 'official-releases.json'));
    assert.equal(sha256(metadataBytes), proof.metadataSha256);
    const release = JSON.parse(metadataBytes).releases.find((item) => item['release-version'] === version);
    for (const archive of proof.archives) {
      const pin = archivePins[archive.localName];
      assert.equal(archive.url, pin.url);
      assert.equal(archive.expectedSha512, pin.sha512);
      const published = release[pin.group].files.find(
        (item) => item.name === archive.localName && item.rid === 'win-x86',
      );
      assert.equal(published.url, pin.url);
      assert.equal(published.hash, pin.sha512);
      const bytes = await readFile(join(root, archive.localName));
      assert.equal(createHash('sha512').update(bytes).digest('hex'), archive.expectedSha512);
    }
  } else {
    await mkdir(root, { recursive: true });
    const metadataBytes = await official(metadataUrl, 5 * 1024 * 1024);
    await writeFile(join(root, 'official-releases.json'), metadataBytes);
    const metadata = JSON.parse(metadataBytes);
    const release = metadata.releases.find((item) => item['release-version'] === version);
    assert.ok(release);
    assert.equal(release.runtime.version, version);
    assert.equal(release.windowsdesktop.version, version);
    proof = {
      version,
      rid: 'win-x86',
      root,
      metadataUrl,
      metadataSha256: sha256(metadataBytes),
      releaseDate: release['release-date'],
      archives: [],
      files: {},
      portableOnly: true,
      systemInstallationChanged: false,
    };
    for (const [group, name] of [
      ['runtime', 'dotnet-runtime-win-x86.zip'],
      ['windowsdesktop', 'windowsdesktop-runtime-win-x86.zip'],
    ]) {
      const entry = release[group].files.find((item) => item.rid === 'win-x86' && item.name === name);
      assert.ok(entry);
      assert.match(entry.hash, /^[0-9a-f]{128}$/);
      assert.equal(entry.url, archivePins[name].url);
      assert.equal(entry.hash, archivePins[name].sha512);
      assert.ok(new URL(entry.url).pathname.includes('/' + version + '/'));
      const bytes = await official(entry.url, 200 * 1024 * 1024);
      const actualSha512 = createHash('sha512').update(bytes).digest('hex');
      assert.equal(actualSha512, entry.hash, 'Official runtime archive SHA-512 mismatch');
      const archive = join(root, name);
      await writeFile(archive, bytes);
      const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
      await execute(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Add-Type -AssemblyName System.IO.Compression.FileSystem; $fixtureRoot=${literal(root)}; $fixtureArchive=[IO.Compression.ZipFile]::OpenRead(${literal(archive)}); try { foreach($fixtureEntry in $fixtureArchive.Entries) { $fixtureTarget=[IO.Path]::GetFullPath([IO.Path]::Combine($fixtureRoot,$fixtureEntry.FullName)); if($fixtureTarget -ne $fixtureRoot -and -not $fixtureTarget.StartsWith($fixtureRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Official archive entry left its owned destination' } } } finally { $fixtureArchive.Dispose() }; Expand-Archive -LiteralPath ${literal(archive)} -DestinationPath ${literal(root)} -Force`,
        ],
        { windowsHide: true, timeout: 60_000, env: { ...process.env, TEMP: root, TMP: root } },
      );
      proof.archives.push({
        group,
        url: entry.url,
        localName: name,
        bytes: bytes.length,
        expectedSha512: entry.hash,
        actualSha512,
      });
    }
    for (const name of [
      'dotnet.exe',
      `host/fxr/${version}/hostfxr.dll`,
      `shared/Microsoft.NETCore.App/${version}/coreclr.dll`,
      `shared/Microsoft.NETCore.App/${version}/System.Private.CoreLib.dll`,
      `shared/Microsoft.WindowsDesktop.App/${version}/System.Windows.Forms.dll`,
      `shared/Microsoft.WindowsDesktop.App/${version}/PresentationFramework.dll`,
      `shared/Microsoft.WindowsDesktop.App/${version}/PresentationCore.dll`,
      `shared/Microsoft.WindowsDesktop.App/${version}/WindowsBase.dll`,
    ])
      proof.files[name] = sha256(await readFile(join(root, name)));
    await verifyFiles(root, proof);
  }
  const host = join(root, 'dotnet.exe');
  const env = {
    ...process.env,
    TEMP: root,
    TMP: root,
    DOTNET_CLI_HOME: join(root, 'cli-home'),
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
    DOTNET_ADD_GLOBAL_TOOLS_TO_PATH: 'false',
    DOTNET_DISABLE_GUI_ERRORS: '1',
    DOTNET_MULTILEVEL_LOOKUP: '0',
    DOTNET_CLI_UI_LANGUAGE: 'en',
  };
  const info = await execute(host, ['--info'], { env, windowsHide: true, timeout: 15_000 });
  const runtimes = await execute(host, ['--list-runtimes'], { env, windowsHide: true, timeout: 15_000 });
  assert.match(info.stdout, /Version:\s+10\.0\.9/);
  assert.match(info.stdout, /Architecture:\s+x86/);
  assert.match(runtimes.stdout, /Microsoft\.NETCore\.App 10\.0\.9/);
  assert.match(runtimes.stdout, /Microsoft\.WindowsDesktop\.App 10\.0\.9/);
  proof.hostInfo = info.stdout;
  proof.runtimes = runtimes.stdout;
  proof.verifiedAt = new Date().toISOString();
  await writeFile(join(root, 'runtime-proof.json'), JSON.stringify(proof, null, 2));
  return { host, root, proof };
}
