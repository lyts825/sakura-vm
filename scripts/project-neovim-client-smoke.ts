import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { quote } from '../server/files.ts';

const run = promisify(execFile);
type Project = { id: string; name: string; path: string; alias: string };

/** Edits remote files with the real Neovim netrw client and the fixture's pinned SSH config. */
export async function projectNeovimClientSmoke(
  root: string,
  sshConfig: string,
  projects: Project[],
  external: (alias: string, script: string, timeout?: number) => Promise<string>,
) {
  const executable = process.env.SAKURA_SSH_NEOVIM_CLIENT;
  if (!executable) return;
  assert.match(basename(executable).toLowerCase(), /^nvim(?:\.exe)?$/);
  const version = (
    await run(executable, ['--version'], {
      windowsHide: true,
      timeout: 30_000,
      encoding: 'utf8',
    })
  ).stdout.split(/\r?\n/)[0];
  const client = join(root, 'neovim-client');
  const temporary = join(client, 'tmp');
  await mkdir(temporary, { recursive: true });
  const ssh =
    process.platform === 'win32'
      ? join(process.env.SystemRoot || 'C:/Windows', 'System32/OpenSSH/ssh.exe')
      : 'ssh';
  const scp =
    process.platform === 'win32'
      ? join(process.env.SystemRoot || 'C:/Windows', 'System32/OpenSSH/scp.exe')
      : 'scp';
  // netrw invokes the platform shell. These are fixture-owned local paths, not an EX command
  // assembled from a project name; reject shell metacharacters before quoting on Windows.
  const shellArgument = (value: string) => {
    if (process.platform !== 'win32') return quote(value);
    assert.ok(!/[\0\r\n"%!^&|<>]/.test(value), 'Unsupported shell character in owned client path');
    return '"' + value.replaceAll('\\', '/') + '"';
  };
  const options = ` -F ${shellArgument(resolve(sshConfig))} -o BatchMode=yes -o ConnectTimeout=10`;
  const records: Record<string, unknown>[] = [];
  for (const project of projects) {
    assert.match(project.alias, /^[a-z0-9-]+$/i);
    const file = project.path + '/neovim-client-editor.txt';
    const before = project.name + ' before Neovim';
    const after = project.name + ' saved by Neovim 雪';
    await external(project.alias, `set -eu\nprintf '%s\\n' ${quote(before)} >${quote(file)}\n`);
    // Windows netrw escapes spaces with literal backslashes even when scp uses SFTP.
    // The dedicated endpoint already fixes SFTP's working directory to this project.
    const remote =
      process.platform === 'win32'
        ? `scp://${project.alias}/./neovim-client-editor.txt`
        : `scp://${project.alias}/${file}`;
    const config = join(client, project.id + '.json');
    const evidence = join(client, project.id + '-evidence.json');
    await writeFile(
      config,
      JSON.stringify({
        remote,
        before,
        after,
        evidence,
        ssh: shellArgument(ssh) + options,
        scp: shellArgument(scp) + ' -q' + options,
      }),
    );
    const script = join(client, project.id + '.lua');
    await writeFile(script, probe);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SAKURA_NEOVIM_SMOKE_CONFIG: config,
      TEMP: temporary,
      TMP: temporary,
      XDG_CONFIG_HOME: join(client, 'config'),
      XDG_DATA_HOME: join(client, 'data'),
      XDG_CACHE_HOME: join(client, 'cache'),
      XDG_STATE_HOME: join(client, 'state'),
    };
    delete env.SHELL;
    try {
      const result = await run(executable, ['--headless', '-u', 'NONE', '-i', 'NONE', '-n', '-l', script], {
        env,
        windowsHide: true,
        timeout: 120_000,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      await writeFile(join(client, project.id + '.log'), result.stdout + result.stderr);
    } catch (error) {
      const result = error as Error & { stdout?: string; stderr?: string };
      await writeFile(
        join(client, project.id + '.log'),
        String(result.stdout || '') + String(result.stderr || ''),
      );
      throw result;
    }
    const record = JSON.parse(await readFile(evidence, 'utf8'));
    assert.equal(record.ok, true, JSON.stringify(record));
    assert.equal(record.read, before);
    assert.equal(record.saved, after);
    assert.equal(record.reopened, after);
    assert.equal(await external(project.alias, `cat -- ${quote(file)}`), after);
    const identity = (
      await external(project.alias, `pwd; printf '%s\\n' "$SAKURA_SCOPE"; readlink /proc/self/ns/net`)
    ).split('\n');
    assert.deepEqual(identity.slice(0, 2), [project.path, project.name]);
    assert.match(identity[2], /^net:\[\d+\]$/);
    records.push({
      alias: project.alias,
      projectPath: project.path,
      clientVersion: version,
      network: identity[2],
      ...record,
    });
    console.log(`${project.name}: actual Neovim netrw remote open, edit, save and reopen passed`);
  }
  if (records.length > 1) assert.notEqual(records[0].network, records[1].network);
  await writeFile(join(root, 'neovim-client-evidence.json'), JSON.stringify(records, null, 2));
}

const probe = `local config = vim.json.decode(table.concat(vim.fn.readfile(vim.env.SAKURA_NEOVIM_SMOKE_CONFIG), "\\n"))
vim.o.modeline = false
vim.o.exrc = false
vim.o.swapfile = false
vim.o.undofile = false
vim.o.fileformat = "unix"
vim.g.netrw_ssh_cmd = config.ssh
vim.g.netrw_scp_cmd = config.scp
vim.g.netrw_use_nt_rcp = 0
vim.g.netrw_cygwin = 0
vim.cmd("packadd netrw")
local result = { ok = false, remote = config.remote }
local ok, err = xpcall(function()
  vim.cmd("edit " .. vim.fn.fnameescape(config.remote))
  assert(vim.v.shell_error == 0, "netrw read command failed")
  result.read = vim.api.nvim_buf_get_lines(0, 0, 1, false)[1]
  assert(result.read == config.before, "remote file was not read: " .. tostring(result.read))
  vim.api.nvim_buf_set_lines(0, 0, -1, false, { config.after })
  vim.cmd("write")
  assert(vim.v.shell_error == 0, "netrw write command failed")
  assert(not vim.bo.modified, "remote file remains modified")
  result.saved = vim.api.nvim_buf_get_lines(0, 0, 1, false)[1]
  vim.cmd("edit!")
  assert(vim.v.shell_error == 0, "netrw reopen command failed")
  result.reopened = vim.api.nvim_buf_get_lines(0, 0, 1, false)[1]
  assert(result.reopened == config.after, "remote file was not saved")
  result.ok = true
end, debug.traceback)
if not ok then result.error = tostring(err) end
vim.fn.writefile({ vim.json.encode(result) }, config.evidence)
if not ok then vim.cmd("cquit 1") end
`;
