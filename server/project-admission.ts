import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectIdentitySchema } from './project-identity.ts';

const directoryMigrationLatchSchema = z
  .object({
    version: z.literal(1),
    projectId: projectIdSchema,
    planId: z.uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    phase: z.enum(['applying', 'failed', 'directory-applied', 'applied']),
    identity: projectIdentitySchema,
  })
  .strict()
  .refine(
    (value) =>
      value.projectId === value.identity.projectId &&
      (value.phase !== 'applied' || value.identity.phase === 'active'),
  );
/** Read-only early admission guard; native prepare checks the same latch atomically under its registry lock. */
export async function assertNoPendingProjectDirectoryMigration(
  machines: Pick<Machines, 'exec'>,
  vmId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  projectIdSchema.parse(projectId);
  const script =
    `import json,os,stat\npath=${JSON.stringify('/var/lib/sakura/project-directory-migrations/' + projectId + '/latch.json')}\n` +
    `fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)\ntry:\n` +
    ` for part in path.split('/')[1:-1]:\n` +
    `  try: child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)\n` +
    `  except FileNotFoundError: print('null');raise SystemExit(0)\n` +
    `  os.close(fd);fd=child;info=os.fstat(fd)\n` +
    `  assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022\n` +
    `  if part in (${JSON.stringify('project-directory-migrations')},${JSON.stringify(projectId)}): assert stat.S_IMODE(info.st_mode)==0o700\n` +
    ` try: record=os.open('latch.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)\n` +
    ` except FileNotFoundError: print('null');raise SystemExit(0)\n` +
    ` try:\n` +
    `  info=os.fstat(record);assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and stat.S_IMODE(info.st_mode)==0o600 and info.st_nlink==1\n` +
    `  data=os.read(record,8193);assert len(data)<=8192\n` +
    `  def pairs(items):\n` +
    `   value={}\n` +
    `   for key,item in items:\n` +
    `    assert key not in value;value[key]=item\n` +
    `   return value\n` +
    `  value=json.loads(data,object_pairs_hook=pairs);print(json.dumps(value))\n` +
    ` finally: os.close(record)\n` +
    `finally: os.close(fd)\n`;
  const result = await machines.exec(
    vmId,
    'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -ec ' +
      quote(
        `set -eu\n` +
          `for sakura_migration_directory in / /var /var/lib /var/lib/sakura /var/lib/sakura/project-directory-migrations; do\n` +
          ` if sakura_migration_metadata=$(stat -c '%u %f' -- "$sakura_migration_directory" 2>&1); then\n` +
          `  set -- $sakura_migration_metadata\n` +
          `  [ "$#" -eq 2 ] && [ "$1" = 0 ] || exit 1\n` +
          `  case "$2" in ''|*[!0-9a-fA-F]*|?????????*) exit 1;; esac\n` +
          `  sakura_migration_mode=$((0x$2))\n` +
          `  [ "$((sakura_migration_mode & ~0177777))" -eq 0 ] || exit 1\n` +
          `  [ "$((sakura_migration_mode & 0170000))" -eq "$((0040000))" ] || exit 1\n` +
          `  [ "$((sakura_migration_mode & 022))" -eq 0 ] || exit 1\n` +
          ` else\n` +
          `  case "$sakura_migration_metadata" in *': No such file or directory') printf '%s\\n' null; exit 0;; esac\n` +
          `  exit 1\n` +
          ` fi\n` +
          `done\n` +
          `exec /usr/bin/python3 -I -S -c ${quote(script)}`,
      ),
    10000,
    signal,
  );
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    value = undefined;
  }
  if (result.code !== 0 || (value !== null && !directoryMigrationLatchSchema.safeParse(value).success))
    throw new AppError('目录迁移锁定记录无法核对，拒绝新运行', 409, 'PROJECT_DIRECTORY_LATCH_CHANGED');
  if (value !== null) {
    const latch = directoryMigrationLatchSchema.parse(value);
    if (latch.projectId !== projectId || latch.phase !== 'applied')
      throw new AppError(
        '目录迁移尚未完整确认，请回到原计划重试应用',
        409,
        'PROJECT_DIRECTORY_MIGRATION_PENDING',
      );
  }
}
