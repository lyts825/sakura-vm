# Windows 普通应用剪贴板策略

Windows x64 宿主的原生代理为显式选择的 x64 和 x86 普通 EXE 应用执行复制、粘贴、文本大小与敏感内容规则。网页工作台规则仍保存在浏览器；本机应用规则由控制服务保存，在「系统设置 → 管理 Windows 剪贴板策略」管理。

## 使用

1. 启动要管理的应用，打开管理页面，刷新应用列表。
2. 选择进程并添加应用。服务核对当前 Windows 用户、会话、PID、进程创建时间、完整 EXE 路径与文件摘要；同一程序后续启动的进程也适用此规则。
3. 修改复制、粘贴、其他格式、敏感文本和 UTF-8 文本上限，勾选启用并保存。
4. 在已保存的应用规则下填写启动参数，格式为 JSON 字符串数组，例如 `["D:\\Projects\\记录.txt", "--选项"]`，点「受控启动此应用」。参数逐项传递，空字符串、空格、引号、反斜杠与中文保持原值，不交给 shell；最多 64 项，每项最多 2,048、合计最多 8,192 个字符。修改规则后需先保存，停用时不能受控启动。
5. 查看每个进程的状态。「已接入 Win32/OLE」表示此进程的代理已成功加载且规则与当前保存值一致；拒绝计数不含剪贴板文本。附加失败、架构未知、文件变化与版本不一致分别显示错误。启动结果未确认时先刷新进程状态，避免重复启动已经运行的应用。
6. 更新应用程序后，重新选择正在运行的新版本，重新绑定摘要并保存。同一代理构建切换安装目录时复用进程中的已有 DLL；更换代理构建后，旧进程需要重启才能使用新代理，显式停用仍可解除同一 ABI 的旧规则。

默认停用。已成功接入的应用通过普通 `CreateProcessW/A` 创建子进程时，子进程和后续孙进程自动继承原应用已保存的规则，包括不同 EXE 和 x64/x86 跨架构创建；服务保存每个子进程自身的摘要、准确父进程 PID/创建时间，以及原应用规则来源。继承进程持续使用原应用规则，修改、停用或移除原应用规则会一并核对和更新这些进程。普通创建需要第 5 版或更新原生运行包和运行中的控制服务；第 6 版新增同用户、同会话 `CreateProcessAsUserW/A`，第 7 版新增以下有界普通 Shell EXE open 路径。

禁用其他格式或启用敏感检测时，只允许 Windows 纯文本及其语言区域元数据，文件、图片、HTML、RTF 和其他自定义格式均被拒绝；OLE 混合格式复制会过滤被禁格式并保留允许的纯文本。敏感检测涵盖常见私钥、令牌、JWT、带凭据的 URL 与明文凭据赋值，不能识别所有秘密或图片中的内容。文本上限为 1 KiB 到 1 MiB，按 UTF-8 字节计算。

标准 ANSI/Unicode Edit 与 RichEdit 控件在 `WM_COPY`、`WM_CUT` 和常见复制/剪切按键执行前检查实际选区。规则拒绝时保留旧剪贴板与选区源文本；只检查选中的片段，不因未选中的敏感文本拒绝正常复制。覆盖已存在、之后创建、销毁重建以及父窗口初始化内创建的标准子控件。自定义控件仍须通过受管剪贴板 API；无法保证其自身在 API 调用前的其他副作用。

OLE 复制在调用原始 `OleSetClipboard` 前检查完整的可接受纯文本正文，过滤混合格式，拒绝无法枚举或无法取得的正文。第 8 版同时检查全局内存和可克隆 `IStream`；同一格式同时提供两种介质时逐个检查。这样普通被拒绝的 OLE 复制不会先清空旧剪贴板。延迟提供的数据与缓存对象在实际读取时继续按当前规则复核。

停用或移除规则会核对并解除本安装已控制的存活进程限制；失败项保留归属记录并显示错误，刷新可重试。关闭控制服务不会放宽已加载规则，应用退出后代理结束。服务重载会恢复同一归属、核对现有代理并扫描新进程，界面会话锁定不会关闭后台执行。数据目录迁移维护期间暂停扫描和配置写入，进程中已加载规则继续执行。

## 执行范围

代理只附加当前 Windows 用户、同一会话的 x64 或 x86 EXE 进程，服务核对架构后用对应控制程序和 DLL 接入，使用 Win32 剪贴板函数与 OLE `IDataObject` 包装执行规则。未知架构继续拒绝；旧的第 1 版原生运行包只支持 x64，第 2 版支持双架构运行中附加，第 3 版支持受控早期启动，第 5 版支持具备创建保留的普通子进程提前继承，第 6 版增加已核验令牌的 `CreateProcessAsUserW/A`，第 7 版加入有界普通 Shell EXE open，第 8 版加入普通 OLE 纯文本流；旧第 4 版资产保留已有归属恢复和停用能力，但不启用旧子通道。读取时再次检查当前权限与内容，包括代理接入后通过包装取得的 OLE 对象、源对象延迟提供的数据以及 Win32 延迟渲染。OLE 自身对象与格式元数据仅在已经授权的 OLE 操作内传递，应用实际内容仍由包装层检查。`GetDataHere` 通过检查过的临时全局内存填充调用者缓冲区，第 8 版也支持调用者提供的纯文本 `IStream`；启用时仍拒绝此方法的非文本流、存储或文件介质，较大的全局内存介质也可能被拒绝。

纯文本流在 `GetData`、`GetDataHere` 和 `SetData` 中使用与全局内存相同的方向、敏感内容和 UTF-8 大小限制。代理按 OLE 约定读取从零到返回时游标的完整正文，只移动克隆的游标，再复制为独立内存快照；不会将检查后仍与原应用共享正文的克隆直接返回。正文须以对应文本编码的 NUL 结束，终止符后的额外字节、奇数长度 UTF-16、无法克隆/定位/完整读取或超限的流拒绝。源对象释放后再次核对当前规则；`GetDataHere` 在全部检查通过后才从调用者原游标写入，不替换、截断或释放调用者的流。`SetData` 保留原 `fRelease` 语义，成功接收才释放调用者转交的原介质。已经交付应用的快照与其他已读数据一样不能撤回。[OLE 流游标约定](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-idataobject-getdatahere)、[Clone 共享正文而独立游标](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-istream-clone)、[SetData 所有权](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-idataobject-setdata)

每个代理使用仅当前用户与 SYSTEM 可访问的命名内存段，只保存规则、版本、进程身份与计数。控制服务在附加前写入进程归属记录；PID 复用、进程列表短暂不可见与附加失败都不能被视为已成功应用。停用解除方向、内容与大小限制，但不卸载仍可能被使用的函数跳板或 OLE 包装；包装只提供受管接口，其他扩展接口在代理存续期间不可用。完全移除代理需要退出该应用。

普通进程成功附加后，Windows Runtime Desktop Clipboard、.NET Framework WinForms/WPF 与现代 .NET WinForms/WPF 的常规 API 也通过上述 Win32/OLE 路径执行规则；标准文本控件的复制与剪切使用同一选区保护。纯 IL CLR/AnyCPU 可以通过受控启动在应用代码前接入；自行启动的托管程序在扫描附加前仍未受管，也不承诺所有打包应用或自定义接口兼容。

受控启动核对已保存版本、启用状态、EXE 摘要与 PE 架构，再用匹配架构工具锁定文件并创建暂停的主线程。创建时通过 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 将新进程加入本次专属 Job，失败时不会留下尚未登记的暂停进程。服务先持久保存进程归属，再将策略 DLL 插入首个 import；它在原始应用 DLL/TLS 初始化之前同步核对并加载规则。初始化线程完成 loader 工作期间，主线程保持暂停。服务独立核对真实共享状态、当前规则、身份、文件摘要、界面锁及迁移维护状态，最后才允许恢复主线程。此路径需要支持创建时 Job 分配的 Windows 10 或更新版本；不支持时明确拒绝创建。

恢复主线程之前的失败、控制工具 EOF 或异常退出由专属 Job 结束本次子进程。恢复成功后清除该 Job 的关闭终止标志，使应用在 Sakura 关闭后继续保留已加载规则。若最终提交回执丢失，已受限的子进程可能仍然存活；服务保留持久归属，报告「启动未确认」并通过刷新或后台扫描核对，不把丢失回复视为成功或保证已终止。

受控启动覆盖普通未打包原生 EXE 的原始应用 import DLL、DLL TLS、EXE TLS 与主入口，以及纯 IL CLR/AnyCPU 的应用代码。第 5 版也覆盖已接入原生/CLR 应用在这些应用初始化阶段通过普通 `CreateProcessW/A` 创建的子进程，第 6 版同样覆盖已核验令牌的 `CreateProcessAsUserW/A`；子进程仍先持久登记再插入策略 import。需要初始化回调运行在主线程的应用可能不兼容。`.local`、关键依赖清单重定向、混合模式 CLR、ReadyToRun、本机入口、进程保护或无法核对的加载条件明确拒绝。系统 DLL 初始化引入的第三方启动 DLL、检查后恶意改写目录或系统设置，以及其他创建路径仍不在承诺范围内。检查、loader lock、暂停语义和创建路径边界见 [早期启动范围](windows-clipboard-early-init.md)。自行启动的应用及代理接入前已创建的子进程仍需等待周期扫描并成功附加。

普通子进程提前继承保留调用者的命令行、环境、工作目录、标准句柄和继承标志；调用者指定 `CREATE_SUSPENDED` 时，返回后主线程仍保持一次暂停，由调用者继续恢复。无法安全合并调用者的 opaque `STARTUPINFOEX` 属性列表，因此此路径及调试创建标志明确返回 `ERROR_NOT_SUPPORTED`，不会启动未受管子进程。控制服务关闭、迁移维护或规则代际正在切换时，正在准备的子进程由其独立 Job 清理；控制服务不可用期间，仍启用规则的应用无法新建这些受管子进程，服务恢复后可重试。显式停用规则后创建 API 恢复普通行为。

`CreateProcessAsUserW/A` 使用调用者原令牌的同一内核对象和原访问权限，保留进程/线程安全属性、句柄继承及其他参数，不另造令牌代替 Windows 原函数。源令牌必须能核验为当前用户、同会话的 primary token；调用前及实际子进程核验前后重新读取 TokenId、ModifiedId、类型、认证标识、SID 和会话。实际 child token 另核对 SID、会话、primary 类型与源认证标识，broker/helper 在创建时 Job 内继续独立核验。源令牌在这段期间发生变化、跨用户/会话、缺少查询权、非令牌句柄或 impersonation token 都明确拒绝。`hToken=NULL` 仅支持没有线程 impersonation 且能核对当前 primary 的调用，仍传入原 NULL。规则启用时，已核验的 `CreateProcessWithTokenW` 和 `CreateProcessWithLogonW` 返回 `ERROR_NOT_SUPPORTED`；无法核验的 WithToken 令牌先返回 `ERROR_ACCESS_DENIED`。它们尚无安全的创建时 Job 路径，不能先创建再补归属。停用后这些函数均调用原系统 API，保留原 Windows 结果和错误语义。

第 7 版的 `ShellExecuteExW/A` 支持显式 `open`、规范的本地绝对 EXE 路径和原调用已指定的 `SEE_MASK_NOASYNC`，允许 `NOCLOSEPROCESS`、`FLAG_NO_UI`、`NO_CONSOLE` 与 `WAITFORINPUTIDLE`。`ShellExecuteW/A` 支持同样的普通 EXE open，并须实际完成同线程创建。源 EXE 必须具有嵌入的显式 `asInvoker`、`uiAccess=false` 清单，使用直接 EXE 关联，且没有外部激活或委托注册。调用保留原 Shell 函数、参数、返回句柄和 Windows 错误；没有改用裸 CreateProcess，也不补加 NOASYNC/site 或事后分配 Job。

代理只接受当前 Shell 调用同线程内完整观察到的公开属性初始化、更新及删除。在原表有剩余容量且没有已有 JOB_LIST 时，通过公开 Update 原样追加本次独立 Job；Shell 的未知属性及其原值指针保留。容量不足、来源缺失、表重入/复用、跨线程变更、调用者 opaque EX、原 Job、普通 startup 降级及属性生命周期不完整均拒绝。成功必须核对恰好一个已持久归属且提前加载策略的准确 child；Shell 内部暂停由 Shell 按原行为恢复。默认异步 Ex、NULL/未知 verb、runas、DDE/COM/DropTarget 委托、文件关联或打包激活等不能证明的路径返回 `ERROR_NOT_SUPPORTED`，不把无 child 的 Shell success 当作已受控成功。停用时全部 Shell 调用按原 API 转发，包括默认异步、NULL verb、无返回 child 句柄及 Windows 原错误。Shell API 本身不能用于 DllMain/loader lock，早期初始化回调中的 Shell 创建不在此承诺范围。[Shell 参数与异步语义](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-shellexecuteinfoa)、[公开创建属性生命周期](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)、[Shell 注册与委托](https://learn.microsoft.com/en-us/windows/win32/shell/app-registration)

新服务仍接受第 5、6 版资产，分别保留其普通 W/A 或 W/A+AsUser 提前继承、归属恢复和停用；旧资产不会获得 Shell 支持。切换到第 7 版的不同 build 后，原已接入应用保留旧规则，需重启才能使用新代理；同 ABI 的显式停用仍可解除旧规则。原 v5/v6 源码、六份资产、失败日志及 proof 均独立保留。

产品范围为显式接入的普通应用，以上拒绝条件属于该范围的准入约束。受保护进程、其他用户、其他会话、ARM 应用和通过其他底层接口绕过常规 API 的程序不在保证范围内，也不能撤回应用先前已经读出的文本或接入前取得的原始数据对象。内核级 DLP 与对恶意本机程序强制执行策略仍需独立系统设施。Linux 应用可从 KDE 的原生入口显式启动，范围分别见 [X11 策略](x11-clipboard.md) 和 [Wayland 策略](wayland-clipboard.md)。第 8 版纯文本流本轮只完成功能实现与编译，实际 COM、双架构和商业应用验收留待后续，不能沿用第 7 版历史通过记录作为本次验证。

## 构建、分发与验证

2026-10-03 第 8 版 build `39dfb780cc80c1953710a450b6e36c94fda1b7d70647a6c38e808da2aad391a5` 已完成 x64/x86 代理与控制程序编译，资产位于 `.tools/native-clipboard`，并由 `prepare-server-assets` 同步到 `.sakura-server/assets/native-clipboard`。本轮没有运行单元测试、COM 夹具、真实进程接入或任何剪贴板操作；下方第 7 版及更早通过记录均为历史证据。新增流路径的运行验收后续进行，已接入旧代理的应用需重启后使用新构建。

Windows 源码构建需要 x64 和 i686 MinGW-w64 C++ 编译器。可分别设置 `SAKURA_NATIVE_CLIPBOARD_CXX` 与 `SAKURA_NATIVE_CLIPBOARD_CXX32` 为完整路径；默认 x64 使用 PATH 中的 `g++.exe`，x86 使用 `.tools/mingw32-16.2.0/mingw32/bin/g++.exe`（存在时）或 PATH 中的 `i686-w64-mingw32-g++.exe`。本机已使用 x64 GCC 13.2 和 x86 GCC 16.2；构建核对目标三元组和输出 PE 架构，运行包使用静态 C++ 运行时，目标机使用代理无需安装编译器。

本批 x86 编译器取自 [MinGW-builds 固定发行版](https://github.com/niXman/mingw-builds-binaries/releases/tag/16.2.0-rt_v14-rev1) 的 `i686-16.2.0-release-posix-dwarf-ucrt-rt_v14-rev1.7z`，下载 SHA-256 为 `f060413ae25d008797a50670b3a5c44055ab3e99af9bbe595135e29c71f9ac6a`，在 D 盘 `.tools` 解压；未修改系统 PATH 或用户设置。

```powershell
npm run build:native-clipboard
npm run build
npm run test:native-clipboard
npm run test:native-clipboard -- 32
node --import tsx scripts/smoke-native-clipboard-early.mjs 64
node --import tsx scripts/smoke-native-clipboard-early.mjs 32
node --import tsx scripts/smoke-native-clipboard-descendants.mjs
node --import tsx scripts/smoke-native-clipboard-token.mjs
node --import tsx scripts/smoke-native-clipboard-shell.mjs
npm run test:native-clipboard:interfaces -- 64
npm run test:native-clipboard:interfaces -- 32
```

源码编译到 `.tools/native-clipboard`，生产构建复制到 `.sakura-server/assets/native-clipboard`。第 8 版原生清单仍覆盖两种架构的代理 DLL、控制程序及 MinHook、Detours 两份许可，均有大小与 SHA-256；新增流实现头文件纳入 build ID。服务运行前逐项核对，完整性失败拒绝附加。主控制程序保留相同的 128 字节剪贴板共享 ABI，子进程 broker 和创建保留 ABI 与第 5 版相同；即使 x86 DLL 或附加工具不可用，仍可停用已归属且加载完成的进程规则，无须重新加载 DLL。新服务继续接受旧资产已有能力；第 8 版的新流支持须更新 DLL 并重启旧代理所在应用。运行包的整体摘要与更新也包含这些文件。Linux 构建不生成 Windows 二进制，相关页面会显示不可用。

`test:native-clipboard` 编译并启动真实 Win32/OLE 测试应用，创建只属于测试的新窗口站和桌面。默认测试 x64，参数 `32` 测试 x86 受管应用与 x64 对端交换内容。测试启动器使用新的本机登录标识，但保留当前用户的本机权限；不创建账户、不加载配置文件、不使用网络凭据，不读写交互桌面的剪贴板。两种架构均实测方向限制、格式枚举、错误进程身份、UTF-8 大小、敏感文本、畸形数据、二进制格式、OLE 缓存对象与 `GetDataHere`、混合格式、延迟渲染、自动扫描、会话锁定、控制重载和显式停用。Node 测试使用模拟原生适配器验证持久归属与异常处理，另检查双架构路由、旧清单拒绝和 x86 工具损坏时通过主控制程序停用；浏览器测试验证实际服务配置类的保存和失败状态。其他 Windows 版本及商业图形应用仍需独立兼容性验证。

`test:native-clipboard:interfaces` 同样使用私有窗口站，实测 WinRT、WinForms/WPF API 与标准控件、方向热更新、敏感和超限拒绝，以及旧剪贴板、剪切源和选区保持。设置 `SAKURA_CLIPBOARD_MODERN_DOTNET=1` 额外构建 .NET 10.0.9 fixture；需要本机 x64 SDK，x86 运行时使用测试目录内的微软官方固定 ZIP，核对官方 SHA-512 和关键加载文件 SHA-256，不安装或修改系统运行时。已有测试运行时可通过 `SAKURA_CLIPBOARD_DOTNET_X86_RUNTIME` 指定工作区 `.data` 中的自有目录，复用时仍逐项核对。

最终 x64、x86 各 717 项接口断言通过，现代 .NET fixture 实际进程分别为 X64/64 位和 X86/32 位，实际 CoreCLR、CoreLib 与桌面程序集路径均核对。每轮包含 108 项选区保持断言与 12 次 Framework/现代 .NET 文本控件销毁重建。托管窗口创建但保持隐藏；测试用实际非交互键盘消息，不对用户桌面发送输入。这批历史接口测试不证明早期启动；纯 IL CLR/AnyCPU 的新增受控启动入口、独立验证及拒绝范围见 [早期启动说明](windows-clipboard-early-init.md)。打包 UWP、历史和云同步仍未由这些测试覆盖。证据与最终构建摘要见 [本轮实现记录](capability-completion.md)。

受控启动另在 x64/x86 私有窗口站实测主函数首个语句已加载相同构建的 ready/active 策略，首次普通复制和粘贴被拒绝；包含空字符串、空格、引号、反斜杠、中文、emoji、换行与命令样字符的参数原样到达。每种架构通过准备及附加阶段各自的 EOF/控制工具异常退出、恢复后提交 stdout 丢失共 5 个真实失败分支，以及写入归属后与附加后两种控制服务关闭分支。清理只影响本次子进程，原有 fixture 与其他规则保留；归属、扫描、重载及停用继续通过。21 项 Node 用例验证顺序、身份、实际策略复核、锁及迁移变化、持久写失败和严格参数；浏览器验证双架构启动、字面参数、版本冲突、失败提示、未保存禁用与手机布局。证据保存为所属测试目录的 `controlled-launch-proof.json`。

MinHook 固定为官方 1.3.4、提交 `c3fcafdc10146beb5919319d0683e44e3c30d537`。源码保留原许可与逐文件来源摘要，构建拒绝不匹配源码。许可随运行包分发。

早期路径使用 Microsoft Detours 4.0.1、固定提交 `1dbd4ea281d73d478aa8d09a8b83fbd265f715f7`。双架构私有窗口站实测首个应用 DLL TLS、DllMain、EXE TLS 及 wmain 的 Win32/OLE 调用均受到当前策略约束；正常 Common Controls 可启动，关键依赖重定向与 cold build 不匹配明确拒绝，失败 Job 清理不影响另一已提交测试进程。来源、失败回归和许可说明见 [早期启动验证](windows-clipboard-early-init.md)。

`smoke-native-clipboard-descendants.mjs` 的 30 个真实场景覆盖跨 EXE、x64/x86 双向创建、隐式 EXE、实际孙进程与并发、四种 CLR 子进程、原生 DLL/TLS 和 CLR 类型初始化期间创建、调用者暂停及提交后热更新、创建前具名 Job 保留、broker 请求到达服务前的普通附加拒绝、扫描 list/status 与 prepared/attached 的交错、父进程 EOF 精确清理、持久写失败、准备及附加阶段拒绝、控制服务重载、关闭与配置切换期间取消，以及显式停用。每轮保留 `descendant-proof.json`、源码/资产摘要、原始归属文件、编译日志和实际 broker/窗口站启动器 `close` 回执；失败轮次也保留。测试只在自己的私有窗口站执行剪贴板调用，不操作交互剪贴板。

`smoke-native-clipboard-token.mjs` 在同一隔离环境通过 70 个实际场景，包含上述 30 个普通创建场景，以及 AsUserW/A 双向跨架构、NULL/受限 primary、隐式映像、字面参数、Unicode 环境、工作目录、安全属性与原标准句柄对象、四种 CLR child、原生 DLL TLS/DllMain/EXE TLS 祖先、调用者暂停及提交后热更新、并发、Job 保留、父 EOF、准备/附加失败和规则代际取消。实际源令牌在普通 AsUser 调用前后保持 TokenId/ModifiedId；两种架构另验证源修改及恢复后拒绝旧快照、关闭原句柄后仍固定同一对象，以及 NULL 后新增 impersonation 的拒绝。测试对停用 API 与未接入父进程的原 Windows 结果逐项对照，核对 WithLogon 重映射后的标准句柄仍指向原内核对象，并复用完整历史 v5 资产验证普通创建、恢复和停用；新 Node 单元共 39 项通过。证据含 12 个独立 broker 的实际进程/stdio `close`、窗口站启动器和对照父进程的 `close`，均为退出码 0；本轮自有进程全部退出。新临时目录在 E 盘，不覆盖历史 proof 或资产。[句柄对象比较](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-compareobjecthandles)

受控创建的系统接口依据微软 [CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)、[创建属性与 Job 列表](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute) 和 [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) 文档；实现与实机测试承诺范围以上述普通原生应用及早期启动说明为准。

第 7 版最终 build `77ae2eefeb5683e906a04547301275d1f585f29b3633622ab95ae3d0f12b4fea` 的新 Shell smoke 通过 133 个场景回执，其中 x64/x86 公开属性生命周期 fixture 各有 24 项独立断言。其余场景实测原 W/A/ExW/ExA、STA/MTA、cold Shell DLL、无返回句柄、跨架构孙进程、同父双线程、运行中 MinHook 接入后的父进程、字面 argv/env/cwd、原 startup 与标准句柄对象、Shell 自有暂停、scope 内规则切换、prepared/attached 失败、关闭/代际取消、普通扫描先见 child、父 EOF 及明确不支持的路径。策略在首个应用 DLL TLS、DllMain、EXE TLS 和 Main 前已 ready/active/build 一致，成功不依赖普通扫描。14 个 broker、4 个模型/未接入/运行中对照父进程及窗口站启动器取得真实进程/stdio close 0，自有进程为 0。

同 build 重跑 token smoke 的原 70 项，并新增历史 v6 资产下普通创建、服务重载后 AsUser 创建及停用，共 71 个场景；历史 v5 兼容继续通过。此轮 16 个 broker、未接入对照父进程和窗口站启动器均实际 close 0，另取得准确自有目录进程清单为 0 的回执。40 项 Node 单元通过。Shell 不调用剪贴板 API；旧入口回归中的剪贴板调用仍仅在各自的私有窗口站执行。所有源码、资产、原 proof、失败轮次和实际关闭证据保存在 E 盘各自 UUID 目录，最终冻结逐项记录 SHA-256，不覆盖 v5/v6 历史证明。

接口行为依据微软的 [剪贴板操作](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-operations)、[OLE 剪贴板读取](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-olegetclipboard) 和 [GetDataHere](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-idataobject-getdatahere) 文档实现。测试隔离遵循 [窗口站创建](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createwindowstationw) 与 [CreateProcessWithLogonW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithlogonw) 的本机权限和登录语义；钩子库来源为 [MinHook 官方仓库](https://github.com/TsudaKageyu/minhook)。
