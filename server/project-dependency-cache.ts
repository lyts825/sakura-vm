import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { quote } from './files.ts';

export const dependencyManagerSchema = z.enum(['npm', 'pip']);
export type DependencyManager = z.infer<typeof dependencyManagerSchema>;
export type ProjectCacheOperation = 'prefetch-dependencies' | 'install-cached-dependencies';

const projectIdSchema = z.string().regex(/^(default|[a-f0-9]{16})$/);

/** Shared downloaders accept only the separately saved instance mirror/proxy profile. */
export function dependencyDownloadEnvironment(input: Record<string, string> = {}) {
  const output: Record<string, string> = {};
  for (const key of [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'http_proxy',
    'https_proxy',
    'NPM_CONFIG_REGISTRY',
    'PIP_INDEX_URL',
  ]) {
    const value = input[key];
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('依赖预取的镜像与代理地址无效');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /[\s\x00-\x1f]/.test(value)
    )
      throw new Error('依赖预取的镜像与代理地址不能包含凭证、查询参数或非 HTTP(S) 协议');
    output[key] = value;
  }
  for (const key of ['NO_PROXY', 'no_proxy']) {
    const value = input[key];
    if (value && !/^[A-Za-z0-9_.,:*\-\[\]/]*$/.test(value)) throw new Error('依赖预取的代理排除列表无效');
    if (value) output[key] = value;
  }
  return output;
}

// npm can execute git prepare hooks even when the project lifecycle scripts
// are disabled. Only registry dependency selectors and integrity-bound HTTP(S)
// package archives enter the clean staging directory.
export const npmPrefetchValidation = String.raw`
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const [directory, filename, stage] = process.argv.slice(1);
const fail = () => { throw new Error('共享预取仅支持带摘要的 npm registry 锁定依赖；请移除 Git、URL、路径、工作区链接或未完整锁定的依赖'); };
const name = value => typeof value === 'string' && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(value);
const selector = value => {
 if (typeof value !== 'string' || !value || value.length > 2048) return fail();
 const alias = /^npm:((?:@[^/]+\/)?[^@]+)@(.+)$/.exec(value);
 if (alias) { if (!name(alias[1])) fail(); value = alias[2]; }
 if (!/^[0-9A-Za-z*^~<>=|. +_-]+$/.test(value)) fail();
};
const dependencies = value => {
 if (!value || Array.isArray(value) || typeof value !== 'object') fail();
 for (const [key, spec] of Object.entries(value)) { if (!name(key)) fail(); selector(spec); }
};
const archive = entry => {
 if (!entry || typeof entry !== 'object' || entry.link || typeof entry.resolved !== 'string' ||
     typeof entry.version !== 'string' || !/^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(entry.version) ||
     typeof entry.integrity !== 'string' || !/^(?:sha(?:1|256|384|512)-[A-Za-z0-9+/]+={0,2})(?:\s+sha(?:1|256|384|512)-[A-Za-z0-9+/]+={0,2})*$/.test(entry.integrity)) fail();
 let url; try { url = new URL(entry.resolved); } catch { fail(); }
 if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
     /[\s\x00-\x1f]/.test(entry.resolved)) fail();
 for (const field of ['dependencies','optionalDependencies','peerDependencies','requires'])
  if (entry[field]) dependencies(entry[field]);
};
const bytes = fs.readFileSync(path.join(directory, 'package.json'));
const lockBytes = fs.readFileSync(path.join(directory, filename));
const manifest = JSON.parse(bytes), lock = JSON.parse(lockBytes), clean = {};
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
    manifest.workspaces || manifest.bundledDependencies || manifest.bundleDependencies) fail();
for (const field of ['name','version']) if (manifest[field] !== undefined) {
 if (typeof manifest[field] !== 'string') fail(); clean[field] = manifest[field];
}
for (const field of ['dependencies','devDependencies','optionalDependencies','peerDependencies']) {
 if (manifest[field]) { dependencies(manifest[field]); clean[field] = manifest[field]; }
}
if (manifest.overrides) {
 const overrides = value => {
  if (typeof value === 'string') { selector(value); return; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  for (const [key, spec] of Object.entries(value)) {
   if (key !== '.') {
    const match = /^((?:@[^/]+\/)?[^@]+)(?:@(.+))?$/.exec(key);
    if (!match || !name(match[1])) fail(); if (match[2]) selector(match[2]);
   }
   overrides(spec);
  }
 };
 overrides(manifest.overrides); clean.overrides = manifest.overrides;
}
const walk = rows => {
 if (!rows || typeof rows !== 'object' || Array.isArray(rows)) fail();
 for (const [key, entry] of Object.entries(rows)) {
  if (!name(key) || !entry || typeof entry !== 'object') fail();
  const nested = entry.dependencies; archive({ ...entry, dependencies: undefined });
  if (nested) walk(nested);
 }
};
if (![1,2,3].includes(lock.lockfileVersion)) fail();
if (lock.lockfileVersion >= 2) {
 if (!lock.packages || Array.isArray(lock.packages) || typeof lock.packages !== 'object') fail();
 for (const [key, entry] of Object.entries(lock.packages)) {
  if (key === '') {
   for (const field of ['dependencies','devDependencies','optionalDependencies','peerDependencies'])
    if (entry && entry[field]) dependencies(entry[field]);
   continue;
  }
  if (!key.startsWith('node_modules/') || key.includes('\\') || key.split('/').some(part => !part || part === '.' || part === '..')) fail();
  archive(entry);
 }
 if (lock.dependencies) walk(lock.dependencies);
} else {
 walk(lock.dependencies || {});
}
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(clean));
fs.writeFileSync(path.join(stage, filename), lockBytes);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
fs.writeFileSync(path.join(stage, 'LOCKSUMS'), hash(bytes) + '  package.json\n' + hash(lockBytes) + '  ' + filename + '\n');
`;

function cleanDownloadScript(script: string, input: Record<string, string>) {
  const environment = dependencyDownloadEnvironment(input);
  return (
    `cd /\nexec env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin ` +
    Object.entries(environment)
      .map(([key, value]) => quote(`${key}=${value}`))
      .join(' ') +
    ` /bin/sh -c ${quote(script)}`
  );
}

// renameat2 exchanges nonempty directories in one kernel operation. The direct
// syscall is also available on musl without a named libc wrapper; the numbers
// below are the Linux x86-64 and asm-generic 64-bit ABI values, not guesses.
// https://man7.org/linux/man-pages/man2/rename.2.html
// https://github.com/torvalds/linux/blob/master/arch/x86/entry/syscalls/syscall_64.tbl
// https://github.com/torvalds/linux/blob/master/include/uapi/asm-generic/unistd.h
export const pipCachePublication = String.raw`
import ctypes, errno, os, platform, re, stat, sys

def publish(stage, cache):
 if sys.platform != 'linux': raise OSError(errno.ENOSYS, 'Linux atomic cache publication is unavailable')
 if not re.fullmatch(r'/var/cache/sakura/project-deps/(?:default|[a-f0-9]{16})/pip', cache):
  raise ValueError('invalid cache path')
 parent = os.path.dirname(cache)
 if os.path.dirname(stage) != parent or not re.fullmatch(r'\.staging\.pip\.[a-f0-9]{32}', os.path.basename(stage)):
  raise ValueError('invalid staging path')
 libc = ctypes.CDLL(None, use_errno=True)
 rename = getattr(libc, 'renameat2', None)
 if rename is not None:
  rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
  rename.restype = ctypes.c_int
  invoke = lambda fd, old, new, flags: rename(fd, old, fd, new, flags)
 else:
  number = {'x86_64': 316, 'aarch64': 276}.get(platform.machine().lower())
  if number is None or ctypes.sizeof(ctypes.c_void_p) != 8:
   raise OSError(errno.ENOSYS, 'Linux atomic cache publication ABI is unavailable')
  syscall = libc.syscall
  syscall.restype = ctypes.c_long
  invoke = lambda fd, old, new, flags: syscall(ctypes.c_long(number), ctypes.c_int(fd), ctypes.c_char_p(old),
    ctypes.c_int(fd), ctypes.c_char_p(new), ctypes.c_uint(flags))
 fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
 try:
  def directory(info):
   if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
    raise ValueError('unprotected cache directory')
  directory(os.fstat(fd))
  directory(os.stat(os.path.basename(stage), dir_fd=fd, follow_symlinks=False))
  try:
   directory(os.stat('pip', dir_fd=fd, follow_symlinks=False))
   flags = 2 # RENAME_EXCHANGE: current always names the complete old or new directory.
  except FileNotFoundError:
   flags = 1 # RENAME_NOREPLACE: never overwrite a concurrently published first cache.
  if invoke(fd, os.fsencode(os.path.basename(stage)), b'pip', flags) != 0:
   code = ctypes.get_errno()
   raise OSError(code, os.strerror(code))
 finally:
  os.close(fd)

if __name__ == '__main__':
 try:
  publish(*sys.argv[1:])
 except Exception:
  print('Python 缓存原子发布失败；现有缓存保持不变，请核对 Linux 内核、文件系统和权限支持', file=sys.stderr)
  sys.exit(2)
`;

export type ProjectDependencyCachePlan = { command: string; cleanup?: string; temporaryDirectory?: string };

/** Host-selected paths let the caller clean only this task after even SIGKILL. */
export function projectDependencyCachePlan(
  directory: string,
  projectId: string,
  manager: DependencyManager,
  operation: ProjectCacheOperation,
  downloadEnvironment: Record<string, string> = {},
  authentication?: { credentialFile: string; brokerFile: string },
): ProjectDependencyCachePlan {
  projectIdSchema.parse(projectId);
  dependencyManagerSchema.parse(manager);
  const nonce = randomBytes(16).toString('hex');
  const stage = `/var/cache/sakura/project-deps/${projectId}/.staging.${manager}.${nonce}`;
  const marker = stage + '.owner';
  const lockTemporary = `/var/cache/sakura/project-deps/${projectId}/npm/LOCKSUMS.${nonce}.tmp`;
  // The external marker is not exchanged into current. Before "created", the
  // stage is empty and only rmdir is allowed if mkdir's acknowledgment was lost.
  const cleanup = `set -eu
if [ -f ${quote(marker)} ] && [ ! -L ${quote(marker)} ]; then
  sakura_stage_state=$(cat ${quote(marker)})
  if [ "$sakura_stage_state" = created ]; then
    test ! -L ${quote(stage)} || { echo '依赖暂存目录身份无效' >&2; exit 1; }
    rm -rf -- ${quote(stage)}
  else
    rmdir -- ${quote(stage)} 2>/dev/null || { test ! -e ${quote(stage)} || { echo '依赖暂存目录归属未确认' >&2; exit 1; }; }
  fi
  rm -f -- ${quote(marker)} ${manager === 'npm' ? quote(lockTemporary) : ''}
else
  rmdir -- ${quote(stage)} 2>/dev/null || { test ! -e ${quote(stage)} || { echo '依赖暂存目录归属未确认' >&2; exit 1; }; }
fi`;
  return {
    command: dependencyCacheCommand(directory, projectId, manager, operation, downloadEnvironment, authentication,
      stage, marker, cleanup, lockTemporary),
    ...(operation === 'prefetch-dependencies' ? { cleanup, temporaryDirectory: stage } : {}),
  };
}

/** Compatibility for direct guest scripts; managed callers also run plan.cleanup. */
export function projectDependencyCacheScript(
  directory: string,
  projectId: string,
  manager: DependencyManager,
  operation: ProjectCacheOperation,
  downloadEnvironment: Record<string, string> = {},
  authentication?: { credentialFile: string; brokerFile: string },
) {
  return projectDependencyCachePlan(directory, projectId, manager, operation, downloadEnvironment, authentication).command;
}

/** The guest manages its own project cache; only fixed, validated paths enter this script. */
function dependencyCacheCommand(
  directory: string,
  projectId: string,
  manager: DependencyManager,
  operation: ProjectCacheOperation,
  downloadEnvironment: Record<string, string> = {},
  authentication?: { credentialFile: string; brokerFile: string },
  stagingDirectory = '',
  marker = '',
  cleanup = '',
  lockTemporary = '',
) {
  projectIdSchema.parse(projectId);
  dependencyManagerSchema.parse(manager);
  if (
    authentication &&
    (operation !== 'prefetch-dependencies' ||
      !/^\/run\/sakura-dependency-auth\.(?:[A-Za-z0-9]{12}|[A-Za-z0-9]{32})\/credential\.json$/.test(
        authentication.credentialFile,
      ) ||
      authentication.brokerFile !== authentication.credentialFile.replace(/credential\.json$/, 'broker.py'))
  )
    throw new Error('认证下载临时路径无效');
  const root = `/var/cache/sakura/project-deps/${projectId}/${manager}`;
  const header = `set -eu
cd ${quote(directory)}
cache=${quote(root)}`;
  if (manager === 'npm') {
    const prerequisites = `command -v npm >/dev/null || { echo '请先安装 npm' >&2; exit 2; }
test -f package.json || { echo '项目没有 package.json' >&2; exit 2; }
if [ -f npm-shrinkwrap.json ]; then lock=npm-shrinkwrap.json; else lock=package-lock.json; fi
test -f "$lock" || { echo '项目没有 npm 锁文件' >&2; exit 2; }`;
    if (operation === 'prefetch-dependencies')
      return cleanDownloadScript(
        `set -eu
cd /
umask 077
cache=${quote(root)}
source=${quote(directory)}
command -v node >/dev/null && command -v npm >/dev/null || { echo '请先安装 npm 与 Node.js' >&2; exit 2; }
${authentication ? "command -v python3 >/dev/null || { echo '认证依赖预取需要系统 Python 3' >&2; exit 2; }" : ''}
test -f "$source/package.json" || { echo '项目没有 package.json' >&2; exit 2; }
if [ -f "$source/npm-shrinkwrap.json" ]; then lock=npm-shrinkwrap.json; else lock=package-lock.json; fi
test -f "$source/$lock" || { echo '项目没有 npm 锁文件' >&2; exit 2; }
mkdir -p "$cache/data"
stage=${quote(stagingDirectory)}
(set -C; printf 'reserved\\n' > ${quote(marker)})
trap ${quote(cleanup)} EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP
mkdir -- "$stage"
printf 'created\\n' > ${quote(marker)}
mkdir "$stage/home"
export HOME="$stage/home"
cd "$stage"
node -e ${quote(npmPrefetchValidation)} "$source" "$lock" "$stage"
touch "$stage/user.npmrc" "$stage/global.npmrc"
${
  authentication
    ? `python3 -I ${quote(authentication.brokerFile)} ${quote(authentication.credentialFile)} npm "$stage" "$cache/data"`
    : 'npm ci --ignore-scripts --cache "$cache/data" --prefer-online --no-audit --no-fund --userconfig="$stage/user.npmrc" --globalconfig="$stage/global.npmrc"'
}
(cd "$source" && sha256sum -c "$stage/LOCKSUMS" >/dev/null)
cp -- "$stage/LOCKSUMS" ${quote(lockTemporary)}
mv -- ${quote(lockTemporary)} "$cache/LOCKSUMS"
printf '已预取 npm 锁文件依赖：%s\n' "$lock"`,
        downloadEnvironment,
      );
    return `${header}
${prerequisites}
test -f "$cache/LOCKSUMS" || { echo '项目依赖缓存不存在' >&2; exit 2; }
sha256sum -c "$cache/LOCKSUMS" >/dev/null
npm ci --offline --ignore-scripts --cache "$cache/data" --no-audit --no-fund
printf '已从离线缓存安装 npm 依赖\n'`;
  }
  const prerequisites = `command -v python3 >/dev/null || { echo '请先安装 Python 3' >&2; exit 2; }
python3 -m pip --version >/dev/null || { echo '请先安装 pip' >&2; exit 2; }
test -f requirements.txt || { echo '项目没有 requirements.txt' >&2; exit 2; }
if grep -Ev '^[[:space:]]*(#|$)' requirements.txt | grep -Ev '^[[:space:]]*[A-Za-z0-9_.-]+(\\[[A-Za-z0-9_,.-]+\\])?==[A-Za-z0-9_.+!-]+[[:space:]]*$' | grep -q .; then
  echo '离线缓存仅支持固定版本的普通 PyPI 包；请移除 URL、路径、选项和未固定的依赖' >&2; exit 2
fi`;
  if (operation === 'prefetch-dependencies')
    return cleanDownloadScript(
      `set -eu
cd /
umask 077
cache=${quote(root)}
source=${quote(directory)}
command -v python3 >/dev/null || { echo '请先安装 Python 3' >&2; exit 2; }
python3 -I -m pip --isolated --version >/dev/null || { echo '请先安装 pip' >&2; exit 2; }
test -f "$source/requirements.txt" || { echo '项目没有 requirements.txt' >&2; exit 2; }
mkdir -p "$(dirname "$cache")"
stage=${quote(stagingDirectory)}
(set -C; printf 'reserved\\n' > ${quote(marker)})
trap ${quote(cleanup)} EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP
mkdir -- "$stage"
printf 'created\\n' > ${quote(marker)}
mkdir -p "$stage/wheels"
mkdir "$stage/home"
export HOME="$stage/home" PIP_CONFIG_FILE=/dev/null
cp -- "$source/requirements.txt" "$stage/requirements.txt"
cd "$stage"
if grep -Ev '^[[:space:]]*(#|$)' requirements.txt | grep -Ev '^[[:space:]]*[A-Za-z0-9_.-]+(\\[[A-Za-z0-9_,.-]+\\])?==[A-Za-z0-9_.+!-]+[[:space:]]*$' | grep -q .; then
  echo '离线缓存仅支持固定版本的普通 PyPI 包；请移除 URL、路径、选项和未固定的依赖' >&2; exit 2
fi
sha256sum requirements.txt > "$stage/LOCKSUMS"
${
  authentication
    ? `python3 -I ${quote(authentication.brokerFile)} ${quote(authentication.credentialFile)} pip "$stage" "$stage/wheels"`
    : `python3 -I -m pip --isolated download --no-input --no-cache-dir --disable-pip-version-check --only-binary=:all: --index-url ${quote(dependencyDownloadEnvironment(downloadEnvironment).PIP_INDEX_URL || 'https://pypi.org/simple')} -r "$stage/requirements.txt" -d "$stage/wheels"`
}
(cd "$stage/wheels" && set -- *.whl && [ -f "$1" ] && sha256sum -- *.whl > WHEELS)
(cd "$source" && sha256sum -c "$stage/LOCKSUMS" >/dev/null)
cd /
python3 -I -c ${quote(pipCachePublication)} "$stage" "$cache"
printf '已预取 Python 固定版本依赖\n'`,
      downloadEnvironment,
    );
  return `${header}
${prerequisites}
test -f "$cache/LOCKSUMS" && test -f "$cache/wheels/WHEELS" || { echo '项目依赖缓存不存在' >&2; exit 2; }
sha256sum -c "$cache/LOCKSUMS" >/dev/null
(cd "$cache/wheels" && sha256sum -c WHEELS >/dev/null)
mkdir -p .sakura
python3 -m venv .sakura/venv
.sakura/venv/bin/python -m pip install --no-index --no-build-isolation --only-binary=:all: --find-links="$cache/wheels" -r requirements.txt
printf '已从离线缓存安装 Python 依赖到 .sakura/venv\n'`;
}
