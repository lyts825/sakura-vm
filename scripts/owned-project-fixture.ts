/** 核对明确拥有的项目夹具并授权其迁移/执行作用域，防止烟雾脚本误用既有实例数据。 */
import assert from 'node:assert/strict';
import type { VmAccess } from '../server/vm-access.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { quote } from '../server/shell.ts';

/** Only freshly created, disposable VM fixtures call this explicit directory authorization. */
export async function authorizeOwnedProjectFixture(
  machines: VmAccess,
  workspaces: Pick<Workspaces, 'config'>,
  vmId: string,
) {
  const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
  const project = await workspaces.config(vmId);
  assert.ok(project.directory.startsWith('/workspace/') && !project.directory.split('/').includes('..'));
  const made = await machines.exec(vmId, 'mkdir -p ' + quote(project.directory));
  assert.equal(made.code, 0, made.stderr);
  const scopes = new ProjectRunScopes(machines),
    identity = await scopes.reserve(vmId, project);
  const source = `import os,stat\np=${JSON.stringify(project.directory)}\nassert os.path.realpath(p)==p\nfor parent,dirs,files in os.walk(p,followlinks=False):\n for path in [parent]+[os.path.join(parent,name) for name in files]:\n  info=os.lstat(path)\n  assert not stat.S_ISLNK(info.st_mode) and info.st_uid in [0,${identity.uid}]\n  os.chown(path,${identity.uid},${identity.gid},follow_symlinks=False)\n  if stat.S_ISDIR(info.st_mode):os.chmod(path,0o700)\n`;
  const authorized = await machines.exec(vmId, '/usr/bin/python3 -I -S -c ' + quote(source));
  assert.equal(authorized.code, 0, authorized.stderr);
  await scopes.identity(vmId, project);
}
