import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('Windows 托盘伴侣仅支持 Windows。');
const root = fileURLToPath(new URL('..', import.meta.url));
await access(join(root, '.sakura-server', 'index.js'));
const script = join(root, 'scripts', 'sakura-tray.ps1');
await access(script);
const portOption = process.argv[2];
if (portOption !== undefined &&
    (!/^\d{1,5}$/.test(portOption) || Number(portOption) < 1 || Number(portOption) > 65535))
  throw new Error('端口必须在 1–65535 之间。');
const child = spawn('powershell.exe', [
  '-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
  '-File', script, ...(portOption ? ['-Port', portOption] : []),
], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
await new Promise((resolve, reject) => {
  child.once('spawn', resolve);
  child.once('error', reject);
});
child.unref();
console.log('Sakura 托盘正在启动。');
