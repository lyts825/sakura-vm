import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { POSIXLOOM_COMMIT, QEMU_URL, QEMU_SHA512, ALPINE_URL, ALPINE_SHA512 } from './versions.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(root);
const run = (exe, args, cwd = root) =>
  new Promise((res, rej) => {
    const child = spawn(exe, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.on('error', rej);
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${exe} exited ${code}`))));
  });
const npm = (args, cwd) =>
  run(
    process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm',
    process.platform === 'win32' ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args,
    cwd,
  );
async function hash(path) {
  const h = createHash('sha512');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}
async function download(url, path, digest) {
  if (existsSync(path) && (!digest || (await hash(path)) === digest)) return;
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(900_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(`${path}.part`));
  if (digest && (await hash(`${path}.part`)) !== digest) {
    await rm(`${path}.part`);
    throw new Error('SHA-512 mismatch');
  }
  await rename(`${path}.part`, path);
}
await mkdir('.tools/downloads', { recursive: true });
await mkdir('.data/images', { recursive: true });
const vendor = join(root, '.vendor/posixloom');
if (!existsSync(vendor)) await run('git', ['clone', 'https://github.com/lyts825/posixloom.git', vendor]);
await run('git', ['checkout', '--detach', POSIXLOOM_COMMIT], vendor);
await npm(['ci'], vendor);
await npm(['run', 'build:all'], vendor);
if (
  process.platform === 'win32' &&
  !process.env.SAKURA_QEMU_DIR &&
  !existsSync('.tools/qemu/qemu-system-x86_64.exe')
) {
  // Extract portable binaries; no installer, registry changes or administrator privileges.
  if (!existsSync('.tools/7zip/7z.exe')) {
    await download(
      'https://github.com/ip7z/7zip/releases/download/26.03/7zr.exe',
      '.tools/downloads/7zr.exe',
      '211a97487c573b8611dfe3acacbd361ffd41a888a9d63c69f2a7b52cbadc686a424ea08ec88c9566e4e1365c5d6caf1825865440f79f4a751fefb27fe9f0bea9',
    );
    await download(
      'https://www.7-zip.org/a/7z2501-x64.exe',
      '.tools/downloads/7z-setup.exe',
      '44c7c2b683383f8555f9d8420391c118e4631eb88bb1d5e8ca7b6e2750568a697493509eeba6f758df1a82c2b76298261c672331a22b0d7f3d4487ae05dedfc6',
    );
    await run(resolve('.tools/downloads/7zr.exe'), [
      'x',
      '.tools/downloads/7z-setup.exe',
      '-o.tools/7zip',
      '-y',
    ]);
  }
  await download(QEMU_URL, '.tools/downloads/qemu-setup.exe', QEMU_SHA512);
  await run(resolve('.tools/7zip/7z.exe'), [
    'x',
    '.tools/downloads/qemu-setup.exe',
    '-o.tools/qemu',
    '-y',
    'qemu-system-x86_64.exe',
    'qemu-img.exe',
    '*.dll',
    'share/*',
    'lib/*',
  ]);
}
await download(ALPINE_URL, '.data/images/alpine-3.23.qcow2', ALPINE_SHA512);
await writeFile(
  '.data/images/alpine-3.23.source.json',
  JSON.stringify({ url: ALPINE_URL, sha512: ALPINE_SHA512 }, null, 2),
);
console.log('\nSakura is ready. Run npm run build, then npm start.');
