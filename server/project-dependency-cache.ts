import { z } from 'zod';
import { quote } from './files.ts';

export const dependencyManagerSchema = z.enum(['npm', 'pip']);
export type DependencyManager = z.infer<typeof dependencyManagerSchema>;
export type ProjectCacheOperation = 'prefetch-dependencies' | 'install-cached-dependencies';

const projectIdSchema = z.string().regex(/^(default|[a-f0-9]{16})$/);

/** Shared downloaders accept only the separately saved instance mirror/proxy profile. */
export function dependencyDownloadEnvironment(input: Record<string, string> = {}) {
  const output: Record<string, string> = {};
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
    'NPM_CONFIG_REGISTRY', 'PIP_INDEX_URL']) {
    const value = input[key];
    if (!value) continue;
    let url: URL;
    try { url = new URL(value); } catch {
      throw new Error('依赖预取的镜像与代理地址无效');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || /[\s\x00-\x1f]/.test(value))
      throw new Error('依赖预取的镜像与代理地址不能包含凭证、查询参数或非 HTTP(S) 协议');
    output[key] = value;
  }
  for (const key of ['NO_PROXY', 'no_proxy']) {
    const value = input[key];
    if (value && !/^[A-Za-z0-9_.,:*\-\[\]/]*$/.test(value))
      throw new Error('依赖预取的代理排除列表无效');
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
  return `cd /\nexec env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin ` +
    Object.entries(environment).map(([key, value]) => quote(`${key}=${value}`)).join(' ') +
    ` /bin/sh -c ${quote(script)}`;
}

/** The guest manages its own project cache; only fixed, validated paths enter this script. */
export function projectDependencyCacheScript(directory: string, projectId: string,
  manager: DependencyManager, operation: ProjectCacheOperation, downloadEnvironment: Record<string, string> = {}) {
  projectIdSchema.parse(projectId);
  dependencyManagerSchema.parse(manager);
  const root = `/var/cache/sakura/project-deps/${projectId}/${manager}`;
  const header = `set -eu
cd ${quote(directory)}
cache=${quote(root)}`;
  if (manager === 'npm') {
    const prerequisites = `command -v npm >/dev/null || { echo '请先安装 npm' >&2; exit 2; }
test -f package.json || { echo '项目没有 package.json' >&2; exit 2; }
if [ -f npm-shrinkwrap.json ]; then lock=npm-shrinkwrap.json; else lock=package-lock.json; fi
test -f "$lock" || { echo '项目没有 npm 锁文件' >&2; exit 2; }`;
    if (operation === 'prefetch-dependencies') return cleanDownloadScript(`set -eu
cd /
umask 077
cache=${quote(root)}
source=${quote(directory)}
command -v node >/dev/null && command -v npm >/dev/null || { echo '请先安装 npm 与 Node.js' >&2; exit 2; }
test -f "$source/package.json" || { echo '项目没有 package.json' >&2; exit 2; }
if [ -f "$source/npm-shrinkwrap.json" ]; then lock=npm-shrinkwrap.json; else lock=package-lock.json; fi
test -f "$source/$lock" || { echo '项目没有 npm 锁文件' >&2; exit 2; }
mkdir -p "$cache/data"
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
mkdir "$stage/home"
export HOME="$stage/home"
cd "$stage"
node -e ${quote(npmPrefetchValidation)} "$source" "$lock" "$stage"
touch "$stage/user.npmrc" "$stage/global.npmrc"
npm ci --ignore-scripts --cache "$cache/data" --prefer-online --no-audit --no-fund --userconfig="$stage/user.npmrc" --globalconfig="$stage/global.npmrc"
(cd "$source" && sha256sum -c "$stage/LOCKSUMS" >/dev/null)
cp -- "$stage/LOCKSUMS" "$cache/LOCKSUMS.tmp"
mv -- "$cache/LOCKSUMS.tmp" "$cache/LOCKSUMS"
printf '已预取 npm 锁文件依赖：%s\n' "$lock"`, downloadEnvironment);
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
  if (operation === 'prefetch-dependencies') return cleanDownloadScript(`set -eu
cd /
umask 077
cache=${quote(root)}
source=${quote(directory)}
command -v python3 >/dev/null || { echo '请先安装 Python 3' >&2; exit 2; }
python3 -I -m pip --isolated --version >/dev/null || { echo '请先安装 pip' >&2; exit 2; }
test -f "$source/requirements.txt" || { echo '项目没有 requirements.txt' >&2; exit 2; }
mkdir -p "$(dirname "$cache")"
stage=$(mktemp -d "$(dirname "$cache")/.staging.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/wheels"
mkdir "$stage/home"
export HOME="$stage/home" PIP_CONFIG_FILE=/dev/null
cp -- "$source/requirements.txt" "$stage/requirements.txt"
cd "$stage"
if grep -Ev '^[[:space:]]*(#|$)' requirements.txt | grep -Ev '^[[:space:]]*[A-Za-z0-9_.-]+(\\[[A-Za-z0-9_,.-]+\\])?==[A-Za-z0-9_.+!-]+[[:space:]]*$' | grep -q .; then
  echo '离线缓存仅支持固定版本的普通 PyPI 包；请移除 URL、路径、选项和未固定的依赖' >&2; exit 2
fi
sha256sum requirements.txt > "$stage/LOCKSUMS"
python3 -I -m pip --isolated download --no-input --no-cache-dir --disable-pip-version-check --only-binary=:all: --index-url ${quote(dependencyDownloadEnvironment(downloadEnvironment).PIP_INDEX_URL || 'https://pypi.org/simple')} -r "$stage/requirements.txt" -d "$stage/wheels"
(cd "$stage/wheels" && set -- *.whl && [ -f "$1" ] && sha256sum -- *.whl > WHEELS)
(cd "$source" && sha256sum -c "$stage/LOCKSUMS" >/dev/null)
backup="$cache.previous.$$"
if [ -e "$cache" ]; then mv -- "$cache" "$backup"; fi
if ! mv -- "$stage" "$cache"; then
  if [ -e "$backup" ]; then mv -- "$backup" "$cache"; fi
  exit 1
fi
rm -rf -- "$backup"
trap - EXIT
printf '已预取 Python 固定版本依赖\n'`, downloadEnvironment);
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
