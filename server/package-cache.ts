/**
 * 模块职责：生成客户机离线软件包缓存脚本，限制包名输入并按发行版选择缓存操作。
 * Module purpose: Builds distribution-specific offline package caching scripts from restricted package names.
 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';

export const packageCacheOperations = ['cache-list', 'cache-prefetch', 'cache-install', 'cache-clear'] as const;
export type PackageCacheOperation = (typeof packageCacheOperations)[number];
const cachePackage = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9+_.-]{0,127}$/,
  '缓存软件包需要不含路径和版本约束的名称');
const root = '/var/cache/sakura/packages';

/** Generate a bounded guest-side operation. The package manager verifies package signatures. */
/**
 * 入口 / Entry: packageCacheScript.
 * 功能：在生成客户机离线软件包缓存脚本中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``set -eu base=${quote(root)} for dir in "$base"/*; do [ -d "$dir" ] && [ -f "$dir/SHA256SUMS" ] || continue count=0; bytes=0 …` / ``${header} [ -d "$target" ] || { echo '缓存不存在' >&2; exit 2; } rm -rf -- "$target" printf '已移除 %s 的离线缓存\n' "$name"`` 供上层消费（`package-cache.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `package-cache.ts`; this entry produces ``set -eu base=${quote(root)} for dir in "$base"/*; do [ -d "$dir" ] && [ -f "$dir/SHA256SUMS" ] || continue count=0; bytes=0 …` / ``${header} [ -d "$target" ] || { echo '缓存不存在' >&2; exit 2; } rm -rf -- "$target" printf '已移除 %s 的离线缓存\n' "$name"`` for its caller. Module context: Builds distribution-specific offline package caching scripts from restricted package names.
 * 处理：通过 `quote`, `cachePackage.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `quote`, `cachePackage.parse`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `operation === 'cache-clear'`; `operation === 'cache-install'`.
 * 输入 / Inputs: distro: string | undefined; operation: PackageCacheOperation; packageName: string optional
 * 输出 / Returns: ``set -eu base=${quote(root)} for dir in "$base"/*; do [ -d "$dir" ] && [ -f "$dir/SHA256SUMS" ] || continue count=0; bytes=0 …`; ``${header} [ -d "$target" ] || { echo '缓存不存在' >&2; exit 2; } rm -rf -- "$target" printf '已移除 %s 的离线缓存\n' "$name"``; ``${header} [ -f "$target/SHA256SUMS" ] || { echo '缓存不存在' >&2; exit 2; } cd "$target" sha256sum -c SHA256SUMS >/dev/null set -…`；另有分支返回 / additional branch-specific returns.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!manager`; `operation === 'cache-list'`; `packageName`; 异常 / errors `new AppError('此发行版暂不支持离线软件包缓存', 409)`; `new AppError('列出缓存不需要软件包名称')`.
 */
export function packageCacheScript(distro: string | undefined, operation: PackageCacheOperation,
  packageName?: string) {
  const manager = distro === 'alpine' || !distro ? 'apk' :
    distro === 'debian' || distro === 'ubuntu' ? 'apt' : null;
  if (!manager) throw new AppError('此发行版暂不支持离线软件包缓存', 409);
  if (operation === 'cache-list') {
    if (packageName) throw new AppError('列出缓存不需要软件包名称');
    return `set -eu
base=${quote(root)}
for dir in "$base"/*; do
  [ -d "$dir" ] && [ -f "$dir/SHA256SUMS" ] || continue
  count=0; bytes=0
  for file in "$dir"/*.apk "$dir"/*.deb; do
    [ -f "$file" ] || continue
    count=$((count + 1))
    size=$(wc -c < "$file")
    bytes=$((bytes + size))
  done
  printf '%s\t%s\t%s\n' "$(basename "$dir")" "$count" "$bytes"
done`;
  }
  const name = cachePackage.parse(packageName);
  const header = `set -eu
name=${quote(name)}
base=${quote(root)}
target="$base/$name"`;
  if (operation === 'cache-clear')
    return `${header}
[ -d "$target" ] || { echo '缓存不存在' >&2; exit 2; }
rm -rf -- "$target"
printf '已移除 %s 的离线缓存\n' "$name"`;
  if (operation === 'cache-install') {
    const suffix = manager === 'apk' ? 'apk' : 'deb';
    const install = manager === 'apk'
      ? 'apk --no-network add "$target"/*.apk'
      : 'DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Cache::archives="$target" --no-download --no-install-recommends install -y "$name"';
    return `${header}
[ -f "$target/SHA256SUMS" ] || { echo '缓存不存在' >&2; exit 2; }
cd "$target"
sha256sum -c SHA256SUMS >/dev/null
set -- "$target"/*.${suffix}
[ -f "$1" ] || { echo '缓存中没有软件包文件' >&2; exit 2; }
${install}`;
  }
  if (operation !== 'cache-prefetch') throw new AppError('未知的软件包缓存操作');
  const fetch = manager === 'apk'
    ? 'apk update\napk fetch --recursive --output "$stage" "$name"'
    : 'apt-get update\nmkdir -p "$stage/partial"\nDEBIAN_FRONTEND=noninteractive apt-get -o Dir::Cache::archives="$stage" --download-only --no-install-recommends install -y "$name"\nset -- "$stage"/*.deb\nif [ ! -f "$1" ]; then (cd "$stage" && apt-get download "$name"); fi';
  const suffix = manager === 'apk' ? 'apk' : 'deb';
  return `${header}
mkdir -p "$base"
stage=$(mktemp -d "$base/.staging.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
${fetch}
set -- "$stage"/*.${suffix}
[ -f "$1" ] || { echo '没有下载到软件包文件' >&2; exit 2; }
(cd "$stage" && sha256sum -- *.${suffix} > SHA256SUMS)
backup="$base/.previous.$name.$$"
if [ -e "$target" ]; then mv -- "$target" "$backup"; fi
if ! mv -- "$stage" "$target"; then
  if [ -e "$backup" ]; then mv -- "$backup" "$target"; fi
  exit 1
fi
rm -rf -- "$backup"
trap - EXIT
printf '已缓存 %s：\n' "$name"
cat "$target/SHA256SUMS"`;
}
