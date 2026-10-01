import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeReleaseManifest } from './release-manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputRoot = join(root, 'release');
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'sakura-'));
for (const folder of ['dist', '.sakura-server', '.sakura-witness'])
  await cp(join(root, folder), join(output, folder), { recursive: true });
await cp(join(root, 'browser-extension'), join(output, 'browser-extension'), { recursive: true });
await cp(join(root, 'package-lock.json'), join(output, 'package-lock.json'));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
manifest.scripts = {
  setup: manifest.scripts.setup,
  start: manifest.scripts.start,
  'start:wsl': manifest.scripts['start:wsl'],
  'ha:witness': manifest.scripts['ha:witness'],
  'check:wsl': manifest.scripts['check:wsl'],
  sakura: manifest.scripts.sakura,
  tray: manifest.scripts.tray,
  'update:status': manifest.scripts['update:status'],
  'update:check': manifest.scripts['update:check'],
  'update:stage': manifest.scripts['update:stage'],
  'update:activate': manifest.scripts['update:activate'],
  'update:rollback': manifest.scripts['update:rollback'],
};
delete manifest.devDependencies;
await writeFile(join(output, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
await mkdir(join(output, 'scripts'));
for (const file of [
  'setup.mjs',
  'versions.mjs',
  'cli.mjs',
  'guest-cli.mjs',
  'development-cli.mjs',
  'sandbox-cli.mjs',
  'resumable-download.mjs',
  'native-open.mjs',
  'sakura-tray.ps1',
  'start-tray.mjs',
  'launch.mjs',
  'launch-witness.mjs',
  'wsl-runtime.mjs',
  'self-update.mjs',
  'release-manifest.mjs',
])
  await cp(join(root, 'scripts', file), join(output, 'scripts', file));
const readme = [
  '# Sakura 运行包',
  '',
  '此目录包含已编译的 Web 和服务端，以及内置插件的按需加载入口。',
  '当前面向 Windows x64。在目标机器安装 Node.js 22.12+、Git 和 Rust/MSVC 构建环境后运行：',
  '',
  '```',
  'npm ci --omit=dev',
  'npm run setup',
  'npm start',
  '```',
  '',
  '`setup` 准备固定版本的 PosixLoom、QEMU 和基础镜像。运行依赖以随包 `package.json` 为准。',
  '已配置含 Linux QEMU、swtpm、virtiofsd 和 OVMF 的 WSL 发行版时，也可先运行 `npm run check:wsl`，再用 `npm run start:wsl` 启动可用 TPM 与 Virtio-FS 的 Linux 后端；数据单独保存在该发行版的 Linux 文件系统中。',
  '默认插件选择为空；内置插件代码随运行包提供，选择后重启服务加载。',
  '独立第三节点可运行 `npm run ha:witness -- --preflight <config.json>` 检查见证配置，再运行 `npm run ha:witness -- <config.json>`；见证入口随活动版本切换，完整性失败时拒绝启动。部署说明和配置模板位于 `.sakura-witness/docs/ha-external-drill.md`，systemd 示例位于 `.sakura-witness/scripts/ha-witness.service.example`；这些文件均纳入运行包摘要。',
  '演练：`npm run ha:witness -- --drill-plan <config.json> <sourceVmId> --output <new-plan.json>`，再运行 `npm run ha:witness -- --observe <config.json> --plan <new-plan.json> --output <new-observations.jsonl>`。工具只读取接口、生成计划与记录，不执行故障注入，不将接口记录视为物理节点独立的证明。',
  '浏览器扩展位于 `browser-extension`，可在 Chromium/Chrome 的扩展程序页加载已解压的扩展程序；需在 Sakura 中启用账户模式并由管理员配对。',
  'Windows 可运行 `npm run tray` 打开系统托盘；菜单中可选择登录自启和由托盘启动 Sakura。',
  'Windows x64 运行包包含 x64 与 x86 应用剪贴板代理；在系统设置中按完整 EXE 路径选择应用后保存启用。受控启动先保持主线程暂停并持久保存归属，核对实际代理及规则后恢复；参数使用 JSON 字符串数组，逐项传递。自行启动的进程仍需等待扫描附加，DLL/TLS 初始化、受保护进程及其他系统接口不受此代理保证。',
  'Alpine、Debian、Ubuntu 的项目 SSH/SFTP 入口使用各自密钥、固定主机公钥、项目目录和网络。Alpine 使用 OpenRC 与真实 cgroup v2，提供普通 SSH 和 Neovim；VS Code Remote-SSH 与 JetBrains Gateway 使用 Debian 或 Ubuntu。',
  'Linux X11 剪贴板源码随包校验。在 KDE 桌面的“原生应用剪贴板”入口安装代理、绑定完整应用路径并启动；普通 Xlib/XCB 动态应用在当前项目网络中运行，INCR 与 MULTIPLE 每项收齐检查，复制超出原子请求上限时拒绝。原生 Wayland、已运行的其他应用、静态程序及底层协议仍未覆盖。',
  '更新：从原安装目录运行 `npm run update:check -- <新包目录>`、`npm run update:stage -- <新包目录>`，',
  '然后运行 `npm run update:activate -- versions/<编号>` 并重启 Sakura。',
  '可用 `npm run update:rollback` 切回上一个版本，再重启服务。更新前请保存或备份重要数据。',
  '',
].join('\n');
await writeFile(join(output, 'README.md'), readme);
await writeReleaseManifest(output);
for (const name of ['graphql', 'selfsigned', 'ssh2', 'ws', 'zod'])
  if (!Object.hasOwn(manifest.dependencies, name)) throw new Error(`缺少运行依赖：${name}`);
console.log(output);
