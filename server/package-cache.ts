import { z } from 'zod';
import { AppError } from './model.ts';
import { quote } from './files.ts';

export const packageCacheOperations = ['cache-list', 'cache-prefetch', 'cache-install', 'cache-clear'] as const;
export type PackageCacheOperation = (typeof packageCacheOperations)[number];
const cachePackage = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9+_.-]{0,127}$/,
  '缓存软件包需要不含路径和版本约束的名称');
const root = '/var/cache/sakura/packages';

/** Generate a bounded guest-side operation. The package manager verifies package signatures. */
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
