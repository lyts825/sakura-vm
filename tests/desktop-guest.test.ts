import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopCommands, desktopProjectPrepare, desktopProjectImePrepare, imeInstall } from '../server/desktop-guest.ts';

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
    if (distro !== 'alpine') assert.match(commands.prepare, /apt-get [^\n]*install[^\n]*plasma-workspace-wayland/);
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

function aptBody(command: string) {
  // Unwrap only the fixed administration frame. Execute the actual emitted
  // package fragment; the unrelated Root adapter must not run on the host.
  const prefix = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -c ';
  if (command.startsWith(prefix)) {
    const quoted = command.slice(prefix.length);
    assert.ok(quoted.startsWith("'") && quoted.endsWith("'"));
    command = quoted.slice(1, -1).replaceAll("'\\''", "'");
    assert.ok(command.startsWith('set -eu\ncd /\n'));
  }
  const begin = command.indexOf('export DEBIAN_FRONTEND=noninteractive\nsakura_packages_ready=1\n');
  assert.ok(begin >= 0);
  const end = command.indexOf('\nfi', begin);
  assert.ok(end > begin);
  return command.slice(begin, end + 3);
}

function aptFixture(body: string, last: string, status = 'installed ok', queryCode = 0, failure = '', noRecommends = true) {
  return run(`set -eu
exec 3>&1
dpkg-query() {
  [ "$#" = 3 ] && [ "$1" = -W ] && [ "$2" = '-f=\${db:Status-Status} \${db:Status-Eflag}' ] || exit 93
  printf 'query:%s\\n' "$3" >&3
  if [ "$3" = '${last}' ]; then printf '%s' '${status}'; return ${queryCode}; fi
  printf 'installed ok'
}
apt-get() {
  [ "$1" = -o ] && [ "$2" = DPkg::Lock::Timeout=120 ] || exit 94
  [ "$3" = -o ] && [ "$4" = Acquire::Retries=2 ] || exit 95
  [ "$5" = -o ] && [ "$6" = Acquire::http::Timeout=30 ] || exit 96
  shift 6
  action=$1
  printf 'apt:%s\\n' "$action" >&3
  case "$action" in
    update) [ "$#" = 1 ] || exit 97 ;;
    install)
      shift
      [ "$1" = -y ] || exit 98
      shift
      ${noRecommends ? '[ "$1" = --no-install-recommends ] || exit 99; shift' : '[ "$1" != --no-install-recommends ] || exit 99'}
      for package in "$@"; do final=$package; done
      [ "$final" = '${last}' ] || exit 91
      ;;
    *) exit 92 ;;
  esac
  if [ "$action" = '${failure}' ]; then
    printf 'original APT %s failure\\n' "$action" >&2
    return 100
  fi
}
${body}
printf 'continued:%s\\n' "$DEBIAN_FRONTEND"
`);
}

for (const distro of ['debian', 'ubuntu']) {
  const commands = desktopCommands(distro);
  const paths = [
    { name: 'desktop preparation', command: commands.prepare, last: 'util-linux', noRecommends: true },
    { name: 'IME install', command: imeInstall(distro), last: 'fcitx5-frontend-qt5', noRecommends: false },
    { name: 'project desktop preparation', command: desktopProjectPrepare(distro, commands.preferences), last: 'iptables', noRecommends: true },
    { name: 'project IME preparation', command: desktopProjectImePrepare(distro), last: 'fcitx5-frontend-qt5', noRecommends: true },
  ];
  for (const entry of paths) {
    test(`${distro} ${entry.name} skips APT only for a fully installed fixed package set`, options, () => {
      const body = aptBody(entry.command);
      const result = aptFixture(body, entry.last, 'installed ok', 0, '', entry.noRecommends);
      assert.equal(result.status, 0, result.stderr);
      const lines = result.stdout.trim().split(/\r?\n/);
      assert.ok(lines.includes('query:' + entry.last));
      assert.ok(lines.filter(line => line.startsWith('query:')).length >= 4);
      assert.ok(!lines.some(line => line.startsWith('apt:')), 'a complete install does not acquire an APT writer lock');
      assert.equal(lines.at(-1), 'continued:noninteractive', 'later preparation still executes');
    });
    test(`${distro} ${entry.name} uses bounded APT for missing, incomplete or failed package queries`, options, () => {
      const body = aptBody(entry.command);
      for (const [status, queryCode] of [['', 1], ['unpacked ok', 0], ['half-configured ok', 0], ['config-files ok', 0],
        ['triggers-pending ok', 0], ['installed reinstreq', 0], ['installed ok', 1], ['', 0]] as const) {
        const result = aptFixture(body, entry.last, status, queryCode, '', entry.noRecommends);
        assert.equal(result.status, 0, `${status}/${queryCode}: ${result.stderr}`);
        assert.deepEqual(result.stdout.trim().split(/\r?\n/).filter(line => line.startsWith('apt:')),
          ['apt:update', 'apt:install']);
        assert.ok(result.stdout.endsWith('continued:noninteractive\n'));
      }
    });
  }
  test(`${distro} APT update and install errors retain their real code and prevent later preparation`, options, () => {
    const body = aptBody(desktopProjectPrepare(distro, commands.preferences));
    for (const failure of ['update', 'install']) {
      const result = aptFixture(body, 'iptables', '', 1, failure);
      assert.equal(result.status, 100, result.stderr);
      assert.equal(result.stderr.trim(), `original APT ${failure} failure`);
      assert.ok(!result.stdout.includes('continued:'));
      assert.deepEqual(result.stdout.trim().split(/\r?\n/).filter(line => line.startsWith('apt:')),
        failure === 'update' ? ['apt:update'] : ['apt:update', 'apt:install']);
    }
  });
}
