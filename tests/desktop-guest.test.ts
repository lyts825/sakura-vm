/**
 * 模块职责：回归验证模块，围绕 `desktop-guest` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `desktop-guest`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 */
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
    : '/bin/bash'; // Fixture command doubles use hyphenated Bash function names.
const options = { skip: !existsSync(shell) };

/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: script: string。
 * 结果：返回分支计算值（`result`）。
 * Result: Return the branch-computed value (`result`).
 * 协作入口 / Collaborators: `spawnSync`, `fileURLToPath`, `assert.ifError`.
 * 检查边界 / Checked boundaries: `assert.ifError(result.error)`.
 */
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
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `desktopCommands`, `run`, `assert.equal`, `assert.match`.
   * 检查边界 / Checked boundaries: `assert.equal(result.status, available ? 0 : 1, result.stderr)`; `assert.match(commands.prepare, /apt-get [^\n]*install[^\n]*plasma-workspace-wayland/)`.
   */
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

  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `desktopCommands(distro).probe.replace`, `desktopCommands`, `run`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.stderr)`; `assert.equal(result.stdout.trim(), displayReady ? 'ready' : 'starting')`.
   */
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

  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `desktopCommands(distro).install.match`, `desktopCommands`, `script.slice`, `script.indexOf`.
   * 检查边界 / Checked boundaries: `assert.equal( result.status, 1, `${failedChild} failure must trigger supervisor restart: ${result.stderr}`, )`; `assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['remove /run/sakura-desktop/ready', 'reaped'])`.
   */
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

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: command: string。
 * 结果：返回分支计算值（`command.slice(begin, end + 3)`）。
 * Result: Return the branch-computed value (`command.slice(begin, end + 3)`).
 * 状态影响 / State effects: `command`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `command.startsWith`, `command.slice`, `assert.ok`, `quoted.startsWith`.
 * 检查边界 / Checked boundaries: `assert.ok(quoted.startsWith("'") && quoted.endsWith("'"))`; `assert.ok(command.startsWith('set -eu\ncd /\n'))`.
 */
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

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: body: string; last: string; status = 'installed ok'; queryCode = 0; failure = ''; noRecommends = true。
 * 结果：返回分支计算值（`run(`set -eu exec 3>&1 dpkg-query() { [ "$#" = 3 ] && [ "$1" = -W ] && [ "$2" = …`）。
 * Result: Return the branch-computed value (`run(`set -eu exec 3>&1 dpkg-query() { [ "$#" = 3 ] && [ "$1" = -W ] && [ "$2" = …`).
 * 协作入口 / Collaborators: `run`.
 */
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
    /**
     * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
     * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `aptBody`, `aptFixture`, `assert.equal`, `result.stdout.trim().split`.
     * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.stderr)`; `assert.ok(lines.includes('query:' + entry.last))`.
     */
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
    /**
     * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
     * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `aptBody`, `aptFixture`, `assert.equal`, `assert.deepEqual`.
     * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, `${status}/${queryCode}: ${result.stderr}`)`; `assert.deepEqual(result.stdout.trim().split(/\r?\n/).filter(line => line.startsWith('apt:')), ['apt:update', 'apt:install'])`.
     */
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
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `aptBody`, `desktopProjectPrepare`, `aptFixture`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.equal(result.status, 100, result.stderr)`; `assert.equal(result.stderr.trim(), `original APT ${failure} failure`)`.
   */
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
