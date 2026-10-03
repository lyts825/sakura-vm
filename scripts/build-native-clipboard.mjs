import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

if (process.platform !== 'win32') {
  console.log('Windows native clipboard helper requires a Windows build host.');
  process.exit(0);
}
const execute = promisify(execFile);
const source = resolve('native/windows-clipboard');
const target = resolve('.tools/native-clipboard');
const vendor = join(source, 'vendor/minhook');
const provenance = JSON.parse(await readFile(join(vendor, 'provenance.json'), 'utf8'));
const earlyVendor = join(source, 'vendor/detours');
const earlyProvenance = JSON.parse(await readFile(join(earlyVendor, 'provenance.json'), 'utf8'));
const hash = createHash('sha256');
for (const name of [
  'protocol.h',
  'early-import.h',
  'control-system.h',
  'descendant.h',
  'descendant-reservation.h',
  'descendant-token.h',
  'descendant-cleanup.h',
  'descendant-policy.h',
  'shell-provenance.h',
  'shell-policy.h',
  'descendant-controller.h',
  'early-policy.def',
  'policy.cpp',
  'controller.cpp',
])
  hash.update(await readFile(join(source, name)));
for (const file of provenance.files) {
  const data = await readFile(join(vendor, file.path));
  if (createHash('sha256').update(data).digest('hex') !== file.sha256)
    throw new Error(`MinHook source differs: ${file.path}`);
  hash.update(data);
}
for (const file of earlyProvenance.files) {
  const data = await readFile(join(earlyVendor, file.path));
  if (createHash('sha256').update(data).digest('hex') !== file.sha256)
    throw new Error(`Detours source differs: ${file.path}`);
  hash.update(data);
}
const build = hash.digest('hex');
await mkdir(target, { recursive: true });
const bundled32 = resolve('.tools/mingw32-16.2.0/mingw32/bin/g++.exe');
const compilers = [
  {
    bits: 64,
    compiler: process.env.SAKURA_NATIVE_CLIPBOARD_CXX || 'g++.exe',
    prefix: /^x86_64-(?:\w+-)*mingw32\s*$/,
    suffix: '',
    decoder: 'hde64.c',
  },
  {
    bits: 32,
    compiler:
      process.env.SAKURA_NATIVE_CLIPBOARD_CXX32 ||
      (existsSync(bundled32) ? bundled32 : 'i686-w64-mingw32-g++.exe'),
    prefix: /^i686-(?:\w+-)*mingw32\s*$/,
    suffix: '-x86',
    decoder: 'hde32.c',
  },
];
for (const entry of compilers) {
  const { stdout: machine } = await execute(entry.compiler, ['-dumpmachine'], {
    windowsHide: true,
    timeout: 10000,
  });
  if (!entry.prefix.test(machine))
    throw new Error(
      `Native clipboard requires a ${entry.bits}-bit MinGW-w64 C++ compiler. Set SAKURA_NATIVE_CLIPBOARD_CXX${entry.bits === 32 ? '32' : ''} to its g++.exe.`,
    );
}
const common = [
  '-std=c++17',
  '-O2',
  '-s',
  '-Wall',
  '-Wextra',
  '-static',
  '-Wl,--no-insert-timestamp',
  `-DSAKURA_CLIPBOARD_BUILD="${build}"`,
  // MinGW's strsafe inline variadic functions otherwise duplicate libmingwex
  // definitions. This toolchain switch leaves Microsoft's pinned source intact.
  '-D__CRT__NO_INLINE',
];
const earlySources = ['detours.cpp', 'modules.cpp', 'disasm.cpp', 'image.cpp', 'creatwth.cpp'].map((name) =>
  join(earlyVendor, 'src', name),
);
for (const entry of compilers) {
  await execute(
    entry.compiler,
    [
      ...common,
      '-shared',
      '-Wl,--kill-at',
      join(source, 'policy.cpp'),
      join(source, 'early-policy.def'),
      ...earlySources,
      ...['buffer.c', 'hook.c', 'trampoline.c', 'hde/' + entry.decoder].map((name) =>
        join(vendor, 'src', name),
      ),
      '-o',
      join(target, `SakuraClipboardPolicy${entry.suffix}.dll`),
      '-luser32',
      '-lcomctl32',
      '-lole32',
      '-luuid',
      '-ladvapi32',
      '-lshell32',
    ],
    { windowsHide: true, timeout: 60000 },
  );
  await execute(
    entry.compiler,
    [
      ...common,
      '-municode',
      join(source, 'controller.cpp'),
      ...earlySources,
      '-o',
      join(target, `sakura-clipboard-controller${entry.suffix}.exe`),
      '-ladvapi32',
      '-lxmllite',
      '-lshlwapi',
      '-luuid',
      '-lole32',
    ],
    { windowsHide: true, timeout: 60000 },
  );
}
const files = [];
await copyFile(join(vendor, 'LICENSE.txt'), join(target, 'MinHook-LICENSE.txt'));
await copyFile(join(earlyVendor, 'LICENSE.md'), join(target, 'Detours-LICENSE.md'));
for (const name of [
  'SakuraClipboardPolicy.dll',
  'sakura-clipboard-controller.exe',
  'SakuraClipboardPolicy-x86.dll',
  'sakura-clipboard-controller-x86.exe',
  'MinHook-LICENSE.txt',
  'Detours-LICENSE.md',
]) {
  const bytes = await readFile(join(target, name));
  if (name.endsWith('.dll') || name.endsWith('.exe')) {
    const machine = bytes.readUInt16LE(bytes.readUInt32LE(0x3c) + 4);
    if (machine !== (name.includes('-x86') ? 0x14c : 0x8664))
      throw new Error(`Native output architecture differs: ${name}`);
  }
  files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(
  join(target, 'native-clipboard.json'),
  JSON.stringify({ version: 7, architecture: 'x64', build, files }, null, 2) + '\n',
);
console.log(`Built Windows native clipboard agent ${build}: ${files.map((f) => f.name).join(', ')}`);
