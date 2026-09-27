import { z } from 'zod';
import { quote } from './files.ts';

export const dependencyManagerSchema = z.enum(['npm', 'pip']);
export type DependencyManager = z.infer<typeof dependencyManagerSchema>;
export type ProjectCacheOperation = 'prefetch-dependencies' | 'install-cached-dependencies';

const projectIdSchema = z.string().regex(/^(default|[a-f0-9]{16})$/);

/** The guest manages its own project cache; only fixed, validated paths enter this script. */
export function projectDependencyCacheScript(directory: string, projectId: string,
  manager: DependencyManager, operation: ProjectCacheOperation) {
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
    if (operation === 'prefetch-dependencies') return `${header}
${prerequisites}
mkdir -p "$cache/data"
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
cp package.json "$lock" "$stage/"
(cd "$stage" && npm ci --ignore-scripts --cache "$cache/data" --prefer-online --no-audit --no-fund)
sha256sum package.json "$lock" > "$cache/LOCKSUMS.tmp"
mv -- "$cache/LOCKSUMS.tmp" "$cache/LOCKSUMS"
printf '已预取 npm 锁文件依赖：%s\n' "$lock"`;
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
  if (operation === 'prefetch-dependencies') return `${header}
${prerequisites}
mkdir -p "$(dirname "$cache")"
stage=$(mktemp -d "$(dirname "$cache")/.staging.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/wheels"
python3 -m pip download --only-binary=:all: -r requirements.txt -d "$stage/wheels"
(cd "$stage/wheels" && set -- *.whl && [ -f "$1" ] && sha256sum -- *.whl > WHEELS)
sha256sum requirements.txt > "$stage/LOCKSUMS"
backup="$cache.previous.$$"
if [ -e "$cache" ]; then mv -- "$cache" "$backup"; fi
if ! mv -- "$stage" "$cache"; then
  if [ -e "$backup" ]; then mv -- "$backup" "$cache"; fi
  exit 1
fi
rm -rf -- "$backup"
trap - EXIT
printf '已预取 Python 固定版本依赖\n'`;
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
