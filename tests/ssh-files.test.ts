import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { secureSshPaths } from '../server/ssh-files.ts';

test('SSH permissions protect actual files with quoted Unicode paths and reject links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-ssh-files-'));
  const folder = join(root, "中文 it's $(quoted)"),
    file = join(folder, 'identity');
  await mkdir(folder);
  await writeFile(file, 'fixture identity');
  const run = promisify(execFile);
  try {
    await secureSshPaths([folder, file]);
    if (process.platform === 'win32') {
      const script =
        `$owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().User\n` +
        `$acl=[System.IO.File]::GetAccessControl('${file.replaceAll("'", "''")}')\n` +
        `[Console]::WriteLine($owner.Value); [Console]::WriteLine($acl.AreAccessRulesProtected)\n` +
        `foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) { [Console]::WriteLine($rule.IdentityReference.Value) }`;
      const { stdout } = await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { windowsHide: true, timeout: 15_000 },
      );
      const [owner, protectedRules, ...principals] = stdout.trim().split(/\r?\n/);
      assert.equal(protectedRules, 'True');
      assert.deepEqual(new Set(principals), new Set([owner, 'S-1-5-18', 'S-1-5-32-544']));
    } else {
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.equal((await stat(folder)).mode & 0o777, 0o700);
    }
    const alias = join(root, 'linked-folder');
    await symlink(folder, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(secureSshPaths([alias]), /链接|联接/);
    await assert.rejects(secureSshPaths([join(alias, 'identity')]), /链接|联接/);
  } finally {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.match(root, /sakura-ssh-files-/);
    await rm(root, { recursive: true, force: true });
  }
});
