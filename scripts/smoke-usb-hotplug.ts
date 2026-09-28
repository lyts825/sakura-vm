import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { freePort, qmp } from '../server/qmp.ts';

const binary = join(process.cwd(), '.tools', 'qemu',
  process.platform === 'win32' ? 'qemu-system-x86_64.exe' : 'qemu-system-x86_64');
if (!existsSync(binary)) throw new Error(`QEMU binary missing: ${binary}`);
const port = await freePort();
const child = spawn(binary, ['-machine', 'q35', '-accel', 'tcg', '-nodefaults', '-m', '128',
  '-display', 'none', '-monitor', 'none', '-S', '-device', 'qemu-xhci,id=sakura-usb',
  '-qmp', `tcp:127.0.0.1:${port},server=on,wait=off`], { windowsHide: true, stdio: 'ignore' });
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error(`QEMU exited ${child.exitCode}`);
    try { await qmp(port, 'query-status', undefined, 500); ready = true; break; }
    catch { await delay(100); }
  }
  assert.equal(ready, true, 'QMP did not start');
  const id = 'sakura-usb-smoke';
  await qmp(port, 'device_add', { driver: 'usb-host', id, bus: 'sakura-usb.0',
    vendorid: 0xffff, productid: 0xffff });
  const host = await qmp(port, 'human-monitor-command', { 'command-line': 'info usbhost' });
  assert.equal(typeof host, 'string');
  await qmp(port, 'device_del', { id });
  console.log('QEMU xHCI and usb-host QMP hotplug commands passed.');
} finally {
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  if (child.exitCode === null) await Promise.race([stopped, delay(5000)]);
}
