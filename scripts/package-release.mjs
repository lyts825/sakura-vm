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
  '见证状态升级、配置更换及从备份恢复使用 `--migrate`、`--reconfigure` 和 `--recover`，要求新的备份和回执路径；具体参数及恢复封锁流程见 `.sakura-witness/docs/ha-witness-maintenance.md`。恢复后先核对并退役全部历史副本，再放行来源；启用自动回切时，在来源应用健康和流量确认后完成。',
  '演练：`npm run ha:witness -- --drill-plan <config.json> <sourceVmId> --output <new-plan.json>`，再运行 `npm run ha:witness -- --observe <config.json> --plan <new-plan.json> --output <new-observations.jsonl>`。工具只读取接口、生成计划与记录，不执行故障注入，不将接口记录视为物理节点独立的证明。',
  '浏览器扩展位于 `browser-extension`，可在 Chromium/Chrome 的扩展程序页加载已解压的扩展程序；需在 Sakura 中启用账户模式并由管理员配对。',
  'Windows 可运行 `npm run tray` 打开系统托盘；菜单中可选择登录自启和由托盘启动 Sakura。',
  'Windows x64 第 7 版运行包包含 x64 与 x86 应用剪贴板代理；在系统设置中按完整 EXE 路径选择应用后保存启用。受控启动先保持主线程暂停并持久保存归属，再同步加载早期策略，覆盖普通原生 EXE 的原始应用 DLL/TLS，及纯 IL CLR 的固定位数、AnyCPU 和优先 32 位初始化；参数使用 JSON 字符串数组。普通 CreateProcessW/A 与同用户、同会话 CreateProcessAsUserW/A 子孙进程在创建前建立专属 Job 保留，先确认归属、准确令牌和继承策略，再恢复应用代码；保留命令、环境、cwd、标准句柄和调用者 CREATE_SUSPENDED 语义。ShellExecuteW/A 及带原 SEE_MASK_NOASYNC 的 ShellExecuteExW/A 支持已核验的普通本地 EXE open，同线程原属性列表通过公开接口附加原 Job，原属性和 Shell 暂停、恢复行为保持；需显式 asInvoker 清单及可核验的直接关联，不支持的激活路径明确拒绝。父进程退出或策略换代时按准确身份清理准备中的子进程。启用规则时 CreateProcessWithTokenW/WithLogonW 明确拒绝，停用后转交原系统接口；未知扩展启动属性、调试标志和不同用户或会话的令牌也明确拒绝。运行中附加已验证 Win32/OLE、标准 EDIT/RichEdit、WinRT Desktop，以及 Framework 4.8.1 和 .NET 10.0.9 双架构的 WinForms/WPF；拒绝复制或剪切时保留原剪贴板、控件文本和选区，控件重建继续执行规则。独立自行启动的进程仍需等待扫描附加；混合模式或 ReadyToRun CLR、系统级启动 DLL、受保护或打包程序、异步或委托 Shell 激活及其他未接入的创建路径、剪贴板历史/云同步及其他系统接口不受此代理保证。',
  'Alpine、Debian、Ubuntu 的项目 SSH/SFTP 入口使用各自密钥、固定主机公钥、项目目录和网络。Alpine 使用 OpenRC 与真实 cgroup v2，提供普通 SSH 和 Neovim；VS Code Remote-SSH 与 JetBrains Gateway 使用 Debian 或 Ubuntu。',
  'Linux 剪贴板源码和协议资产随包校验。在 KDE 桌面的“原生应用剪贴板”入口选择 X11 或 Wayland，安装代理、绑定完整应用路径并启动。桌面使用原项目 UID/GID 与完整运行票据，分别核对外层 VNC 和嵌套 XWayland 的认证及真实监听。X11 普通 Xlib/XCB 动态应用在当前项目网络中运行，INCR 与 MULTIPLE 每项收齐检查，复制超出原子请求上限时拒绝；普通 fork 子进程可建立新连接，不能继续使用继承的受管显示器指针。原生 Wayland 使用独立账户、运行目录和项目网络，核对实际 compositor、连接身份及 cgroup；通过专属 idmapped mount 读写原项目私有目录，原盘属主、权限和 ACL 保持，程序降权后从映射视图核对并执行准确 ELF。内核、文件系统或路径重叠不支持时明确拒绝。复制与粘贴的数据管道完整收齐并检查后才释放，支持 Qt/GTK 普通剪贴板与 primary selection。桌面偏好可选择原生 Wayland 会话。规则热更新不能撤回对端已收到的缓存，既有非受管程序、特殊协议和其他系统路径仍未覆盖。',
  '桌面中的单应用窗口也固定原项目账号、目录及网络，每个窗口另有独立应用 UID、专属目录视图和完整运行域。参数每行一个并保留空格。只有应用、窗口管理器与实际 RFB 监听全部核对后才显示运行；浏览器采用随机密码认证。停止与创建者观察到的自然退出按原完整运行域清理，包括脱离父进程的子进程；清理未确认保留原记录并允许重试，账户和主目录保留。服务重载只读恢复记录，不重新发行运行票据或接管退出监视；旧 UID 标记显示归属待核对。目录须先显式预览与应用迁移，缺失目录不会自动创建。',
  '默认项目 API/SDK/CLI 命令、初始化、主命令、普通服务、就绪与命令式健康检查使用各项目固定 UID/GID 和独立 home。命令与环境通过有界标准输入或受保护文件传递，降权后执行；主命令和服务保存完整归属，停止清理所属后台子进程，主进程退出仍保留其后代。失联或身份变化保留记录并明确报错，健康检查暂停自动重启，面板允许重试。私有项目停止先冻结本次网络，再确认所有运行停止后删除准确的命名空间；旧请求不能删除重新建立的网络。',
  '开发页的“版本”面板刷新只读取最近采样，点击“探测项目版本”才在项目 UID 与项目网络中执行版本检查。应用精确版本先核对已安装版本并重新验证，再保存项目选择；“清除版本选择”取消 pin，不删除文件或运行时。CLI 的 runtimes inspect 同样只读取缓存，runtimes probe 主动探测。共享 Node/Python 安装属于实例管理员操作；完整任务清理后才确认安装可用，未知旧目录或半成品拒绝自动接管。',
  '构建农场按节点保存的项目绑定运行，每次准备捕获配置，正文使用项目 UID、独立 home 和网络。子目录不改变原账号目录绑定，同项目多个槽位拥有各自完整票据与 cgroup；取消只清理所属槽位，清理失败的错误码和原记录在重载后保留，未确认时不能更换绑定。',
  '能力中心的 SSH Agent 转发每次需明确提交 command、confirmed=true 和 1–300 秒时限；命令与确认不能保存为默认配置。宿主需运行 SSH Agent，客户机需 OpenSSH 客户端、系统 Python、真实 cgroup v2 与 Linux pidfd。命令使用项目账号、独立 home 和网络，通过受保护正文执行；固定 broker 和摘要清单随包提供。每条任务有独立入口与宿主连接，直接请求核对账号及完整任务域，原 SSH 监听保持私有权限。命令结束、超时或取消后确认域和资源清理再核销账号票据；未确认时保留原记录、具体错误码与待关闭连接供恢复，不关闭另一任务或宿主 Agent 守护进程。转发可请求密钥签名，提交前须确认命令及依赖可信，私钥不会复制到客户机。',
  '能力中心的 GPG Agent 转发也每次明确提交 command、confirmed=true 与 1–300 秒时限，并以项目账号和受保护正文执行。Windows x64 宿主需已有原生 GnuPG extra socket，固定文件/ACL/原进程身份并在发送 nonce 前保存 helper 回执；Unix/MSYS socket及命名管道当前明确拒绝。客户机需 GnuPG、系统 Python、cgroup v2、pidfd 和允许 remote Unix 转发的 sshd。每条任务有独立的项目 GNUPGHOME，需导入公钥；示例用 --no-autostart，Shell 命令自行决定调用参数。取消和退出先确认域、宿主连接与准确临时资源清理，再核销账号票据。失败保留原回执和错误码，重载不从丢失的内存登记推断已关闭，宿主 Agent 与私钥不由此入口管理。',
  '既有 root 属主目录需由项目所有者在已保存的配置中预览迁移计划，核对后明确应用；缺失目录不会自动创建，链接、其他项目重叠和跨挂载拒绝。迁移中断或绑定确认失联时保留原计划重试，读取不自动迁移。待清理或状态未确认时拒绝覆盖配置；旧 root/tmux 运行先按原归属停止。客户机热目录满 1,024 张票据时，每批自动归档最多 512 张本次 boot 已关闭且任务域无进程的完整回执，允许继续运行新任务；归档旧 ID 仍拒绝重放，查询与重复关闭不重新占用热目录。归档按 UUID 前两位分桶，每桶最多 4,096 项；容量或写入核对失败保留原票据，须先完成原清理或排查具体错误。账号限制仅涵盖已接通的项目入口，显式管理员命令、特权代理与客户机 root 仍有其他权限路径。共享及私有项目可在空目录首次检出 Git：系统固定 smart-HTTP 代理只下载对象，项目 UID 在原网络内核对 bundle 和默认分支并检出；已有仓库不自动更新。Git 只读认证在已应用网络档案中单独配置，凭据不进入 Git 参数、项目环境和日志。取消或失败按原 boot、任务与准确资源核对清理，未确认保留记录。',
  '认证 npm/pip 仓库在网络档案中按管理器设置下载端点、认证方式和另存的只读私密配置名称，预览并应用后用于共享预取。独占 SFTP 临时文件与有界回环代理限定凭证范围，不加载项目下载配置；认证 npm 需要第 2/3 版完整锁文件，pip 需要 HTML Simple 索引和二进制 wheel，安装继续在项目网络中离线执行。',
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
