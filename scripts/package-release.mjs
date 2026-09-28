import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeReleaseManifest } from './release-manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputRoot = join(root, 'release');
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'sakura-'));
for (const folder of ['dist', '.sakura-server'])
  await cp(join(root, folder), join(output, folder), { recursive: true });
await cp(join(root, 'browser-extension'), join(output, 'browser-extension'), { recursive: true });
await cp(join(root, 'package-lock.json'), join(output, 'package-lock.json'));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
manifest.scripts = {
  setup: manifest.scripts.setup,
  start: manifest.scripts.start,
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
  'development-cli.mjs',
  'sandbox-cli.mjs',
  'resumable-download.mjs',
  'native-open.mjs',
  'sakura-tray.ps1',
  'start-tray.mjs',
  'launch.mjs',
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
  '默认插件选择为空；内置插件代码随运行包提供，选择后重启服务加载。',
  '浏览器扩展位于 `browser-extension`，可在 Chromium/Chrome 的扩展程序页加载已解压的扩展程序；需在 Sakura 中启用账户模式并由管理员配对。',
  'Windows 可运行 `npm run tray` 打开系统托盘；菜单中可选择登录自启和由托盘启动 Sakura。',
  '更新：从原安装目录运行 `npm run update:check -- <新包目录>`、`npm run update:stage -- <新包目录>`，',
  '然后运行 `npm run update:activate -- versions/<编号>` 并重启 Sakura。',
  '可用 `npm run update:rollback` 切回上一个版本，再重启服务。更新前请保存或备份重要数据。',
  '',
].join('\n');
await writeFile(join(output, 'README.md'), readme);
await writeReleaseManifest(output);
for (const name of ['graphql', 'selfsigned', 'ssh2', 'ws', 'zod'])
  if (!Object.hasOwn(manifest.dependencies, name))
    throw new Error(`缺少运行依赖：${name}`);
console.log(output);
