#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.error('此入口用于从 Windows 启动 WSL；在 Linux 中请设置 SAKURA_QEMU_DIR=/usr/bin 后运行 npm start。');
  process.exitCode = 1;
} else {
  const mode = process.argv[2] === '--check' ? 'check' : 'start';
  if (process.argv.length > (mode === 'check' ? 3 : 2))
    throw new Error('仅支持 --check 参数');
  const port = Number(process.env.SAKURA_PORT || 7337);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('SAKURA_PORT 不是有效端口');
  const dataDir = process.env.SAKURA_WSL_DATA_DIR || '';
  if (dataDir && (!dataDir.startsWith('/') || /[\r\n\0]/.test(dataDir)))
    throw new Error('SAKURA_WSL_DATA_DIR 必须是 WSL 内的绝对路径');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const script = [
    'set -eu',
    'mode=$1; data=$2; port=$3',
    'repo=$(pwd -P)',
    'command -v node >/dev/null || { echo "WSL 缺少 Linux Node.js 22+" >&2; exit 1; }',
    'node -e "const [major, minor] = process.versions.node.split(String.fromCharCode(46)).map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)" || { echo "WSL 需要 Node.js 22.12+" >&2; exit 1; }',
    'command -v qemu-system-x86_64 >/dev/null || { echo "WSL 缺少 qemu-system-x86_64" >&2; exit 1; }',
    'command -v qemu-img >/dev/null || { echo "WSL 缺少 qemu-img" >&2; exit 1; }',
    'command -v qemu-io >/dev/null || { echo "WSL 缺少 qemu-io" >&2; exit 1; }',
    'command -v swtpm >/dev/null || { echo "WSL 缺少 swtpm" >&2; exit 1; }',
    'if [ -x /usr/libexec/virtiofsd ]; then virtiofsd=/usr/libexec/virtiofsd; elif [ -x /usr/lib/qemu/virtiofsd ]; then virtiofsd=/usr/lib/qemu/virtiofsd; else virtiofsd=$(command -v virtiofsd || true); fi',
    'test -n "$virtiofsd" || { echo "WSL 缺少 virtiofsd" >&2; exit 1; }',
    'test -r /usr/share/OVMF/OVMF_CODE_4M.ms.fd && test -r /usr/share/OVMF/OVMF_VARS_4M.ms.fd || { echo "WSL 缺少 OVMF 安全启动固件" >&2; exit 1; }',
    'qemu-system-x86_64 -tpmdev help 2>&1 | grep -q emulator || { echo "WSL QEMU 缺少 TPM 后端" >&2; exit 1; }',
    'qemu-system-x86_64 -device help 2>&1 | grep -q vhost-user-fs-pci || { echo "WSL QEMU 缺少 Virtio-FS 设备" >&2; exit 1; }',
    'qemu-system-x86_64 -object help 2>&1 | grep -q memory-backend-memfd || { echo "WSL QEMU 缺少共享内存后端" >&2; exit 1; }',
    'test -r "$repo/.sakura-server/index.js" || { echo "请先在 Windows 运行 npm run build" >&2; exit 1; }',
    'test -r "$repo/.data/images/alpine-3.23.qcow2" || { echo "请先在 Windows 运行 npm run setup" >&2; exit 1; }',
    'if [ -z "$data" ]; then data="$HOME/.local/share/sakura-vm"; fi',
    'data=$(realpath -m -- "$data")',
    'case "$data" in /mnt|/mnt/*) echo "WSL 数据目录需要位于 Linux 文件系统，不能放在 /mnt 下" >&2; exit 1;; esac',
    'probe=$data; while [ ! -e "$probe" ]; do probe=$(dirname -- "$probe"); done',
    'case "$(stat -f -c %T "$probe")" in 9p|drvfs|fuseblk) echo "WSL 数据目录不支持 Unix 套接字，请使用 Linux 文件系统" >&2; exit 1;; esac',
    'if [ "$mode" = check ]; then printf "WSL 后端就绪。数据目录：%s\\n" "$data"; exit 0; fi',
    'mkdir -p -- "$data"',
    'export SAKURA_QEMU_DIR=/usr/bin SAKURA_SWTPM_PATH=/usr/bin/swtpm SAKURA_VIRTIOFSD_PATH="$virtiofsd"',
    'export SAKURA_IMAGE_DIR="$repo/.data/images" SAKURA_IMAGE_PATH="$repo/.data/images/alpine-3.23.qcow2"',
    'export SAKURA_DATA_DIR="$data" SAKURA_PORT="$port"',
    'exec node scripts/launch.mjs',
  ].join('\n');
  const child = spawn('wsl.exe', ['--exec', 'bash', '-lc', script,
    'sakura-wsl', mode, dataDir, String(port)],
  { cwd: root, stdio: 'inherit', windowsHide: true });
  child.on('error', (error) => {
    console.error(`无法启动 WSL：${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
}
