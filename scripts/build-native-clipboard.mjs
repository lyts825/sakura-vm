import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

if (process.platform !== 'win32') {
  console.log('Windows native clipboard helper requires a Windows build host.');
  process.exit(0);
}
const execute = promisify(execFile);
const source = resolve('native/windows-clipboard');
const target = resolve('.tools/native-clipboard');
const vendor = join(source, 'vendor/minhook');
const provenance = JSON.parse(await readFile(join(vendor, 'provenance.json'), 'utf8'));
const hash = createHash('sha256');
for (const name of ['protocol.h', 'policy.cpp', 'controller.cpp'])
  hash.update(await readFile(join(source, name)));
for (const file of provenance.files) {
  const data = await readFile(join(vendor, file.path));
  if (createHash('sha256').update(data).digest('hex') !== file.sha256)
    throw new Error(`MinHook source differs: ${file.path}`);
  hash.update(data);
}
const build = hash.digest('hex');
await mkdir(target, { recursive: true });
const compiler = process.env.SAKURA_NATIVE_CLIPBOARD_CXX || 'g++.exe';
const { stdout: machine } = await execute(compiler, ['-dumpmachine'], { windowsHide: true, timeout: 10000 });
if (!/^x86_64-(?:\w+-)*mingw32\s*$/.test(machine))
  throw new Error(
    'Native clipboard requires an x64 MinGW-w64 C++ compiler. Set SAKURA_NATIVE_CLIPBOARD_CXX to its g++.exe.',
  );
const common = [
  '-std=c++17',
  '-O2',
  '-s',
  '-Wall',
  '-Wextra',
  '-static',
  '-Wl,--no-insert-timestamp',
  `-DSAKURA_CLIPBOARD_BUILD="${build}"`,
];
await execute(
  compiler,
  [
    ...common,
    '-shared',
    join(source, 'policy.cpp'),
    ...['buffer.c', 'hook.c', 'trampoline.c', 'hde/hde64.c'].map((name) => join(vendor, 'src', name)),
    '-o',
    join(target, 'SakuraClipboardPolicy.dll'),
    '-luser32',
    '-lole32',
    '-luuid',
  ],
  { windowsHide: true, timeout: 60000 },
);
await execute(
  compiler,
  [
    ...common,
    '-municode',
    join(source, 'controller.cpp'),
    '-o',
    join(target, 'sakura-clipboard-controller.exe'),
    '-ladvapi32',
  ],
  { windowsHide: true, timeout: 60000 },
);
const files = [];
await copyFile(join(vendor, 'LICENSE.txt'), join(target, 'MinHook-LICENSE.txt'));
for (const name of ['SakuraClipboardPolicy.dll', 'sakura-clipboard-controller.exe', 'MinHook-LICENSE.txt']) {
  const bytes = await readFile(join(target, name));
  files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(
  join(target, 'native-clipboard.json'),
  JSON.stringify({ version: 1, architecture: 'x64', build, files }, null, 2) + '\n',
);
console.log(`Built Windows native clipboard agent ${build}: ${files.map((f) => f.name).join(', ')}`);
