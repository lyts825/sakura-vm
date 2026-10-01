import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopCommands } from '../server/desktop-guest.ts';

// Execute the generated POSIX shell, with guest commands replaced by fixtures.
// Git for Windows supplies sh on the project's Windows development host.
const shell =
  process.platform === 'win32'
    ? join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'sh.exe')
    : '/bin/sh';
const options = { skip: !existsSync(shell) };

function run(script: string) {
  const result = spawnSync(shell, ['-s'], {
    input: script,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.ifError(result.error);
  return result;
}

for (const distro of ['alpine', 'debian', 'ubuntu']) {
  test(`${distro} repairs a current desktop install missing its selected Plasma entry`, options, () => {
    const commands = desktopCommands(distro, { sessionType: 'wayland' });
    for (const available of [false, true]) {
      const result = run(`
grep() { return 0; }
command() { [ "$1" = -v ] && [ "$2" = startplasma-wayland ] && return ${available ? 0 : 1}; return 90; }
${commands.versionProbe}
`);
      assert.equal(result.status, available ? 0 : 1, result.stderr);
    }
    if (distro !== 'alpine') assert.match(commands.prepare, /apt-get install[^\n]*plasma-workspace-wayland/);
    assert.ok(commands.configure.includes(commands.versionProbe));
    assert.ok(commands.startWithPreferences.includes(commands.versionProbe));
  });

  test(`${distro} readiness rejects a stale marker and live Plasma when Xvnc is gone`, options, () => {
    // Use a real, existing file for the installation marker without writing to /etc.
    const probe = desktopCommands(distro).probe.replace('/etc/sakura/desktop-version', './package.json');
    for (const displayReady of [false, true]) {
      const result = run(`
test() { return 0; }
rc-service() { return 0; }
systemctl() { return 0; }
pgrep() { return 0; }
timeout() {
  [ "$1" = 3 ] || exit 90
  shift
  "$@"
}
env() {
  [ "$1" = DISPLAY=:1 ] || exit 91
  [ "$2" = XAUTHORITY=/run/sakura-desktop/Xauthority ] || exit 92
  shift 2
  "$@"
}
xdpyinfo() { return ${displayReady ? 0 : 1}; }
${probe}
`);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), displayReady ? 'ready' : 'starting');
    }
  });

  test(`${distro} supervises both desktop children and clears stale readiness on failure`, options, () => {
    const script = desktopCommands(distro).install.match(
      /cat > \/usr\/local\/libexec\/sakura-desktop-session <<'SAKURA_SESSION'\n([\s\S]*?)\nSAKURA_SESSION/,
    )![1];
    const cleanup = script.slice(script.indexOf('cleanup() {'), script.indexOf('for attempt in'));
    const supervise = script.slice(script.indexOf('session_pid=$!') + 'session_pid=$!'.length);
    for (const failedChild of ['vnc', 'plasma']) {
      const result = run(`set -eu
sleep ${failedChild === 'vnc' ? '0.05' : '30'} &
vnc_pid=$!
sleep ${failedChild === 'plasma' ? '0.05' : '30'} &
session_pid=$!
sleep() { command sleep 0.01; }
rm() { printf 'remove %s\\n' "$2"; }
wait() { command wait; printf 'reaped\\n'; }
${cleanup}
${supervise}
`);
      assert.equal(
        result.status,
        1,
        `${failedChild} failure must trigger supervisor restart: ${result.stderr}`,
      );
      assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['remove /run/sakura-desktop/ready', 'reaped']);
    }
  });
}
