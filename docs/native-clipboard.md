# Windows 普通应用剪贴板策略

Windows x64 宿主的原生代理为显式选择的 x64 和 x86 普通 EXE 应用执行复制、粘贴、文本大小与敏感内容规则。网页工作台规则仍保存在浏览器；本机应用规则由控制服务保存，在「系统设置 → 管理 Windows 剪贴板策略」管理。

## 使用

1. 启动要管理的应用，打开管理页面，刷新应用列表。
2. 选择进程并添加应用。服务核对当前 Windows 用户、会话、PID、进程创建时间、完整 EXE 路径与文件摘要；同一程序后续启动的进程也适用此规则。
3. 修改复制、粘贴、其他格式、敏感文本和 UTF-8 文本上限，勾选启用并保存。
4. 在已保存的应用规则下填写启动参数，格式为 JSON 字符串数组，例如 `["D:\\Projects\\记录.txt", "--选项"]`，点「受控启动此应用」。参数逐项传递，空字符串、空格、引号、反斜杠与中文保持原值，不交给 shell；最多 64 项，每项最多 2,048、合计最多 8,192 个字符。修改规则后需先保存，停用时不能受控启动。
5. 查看每个进程的状态。「已接入 Win32/OLE」表示此进程的代理已成功加载且规则与当前保存值一致；拒绝计数不含剪贴板文本。附加失败、架构未知、文件变化与版本不一致分别显示错误。启动结果未确认时先刷新进程状态，避免重复启动已经运行的应用。
6. 更新应用程序后，重新选择正在运行的新版本，重新绑定摘要并保存。同一代理构建切换安装目录时复用进程中的已有 DLL；更换代理构建后，旧进程需要重启才能使用新代理，显式停用仍可解除同一 ABI 的旧规则。

默认停用。已成功接入的应用通过普通 `CreateProcessW/A` 创建子进程时，子进程和后续孙进程自动继承原应用已保存的规则，包括不同 EXE 和 x64/x86 跨架构创建；服务保存每个子进程自身的摘要、准确父进程 PID/创建时间，以及原应用规则来源。继承进程持续使用原应用规则，修改、停用或移除原应用规则会一并核对和更新这些进程。这个提前继承路径需要第 5 版原生运行包和运行中的控制服务。

禁用其他格式或启用敏感检测时，只允许 Windows 纯文本及其语言区域元数据，文件、图片、HTML、RTF 和其他自定义格式均被拒绝；OLE 混合格式复制会过滤被禁格式并保留允许的纯文本。敏感检测涵盖常见私钥、令牌、JWT、带凭据的 URL 与明文凭据赋值，不能识别所有秘密或图片中的内容。文本上限为 1 KiB 到 1 MiB，按 UTF-8 字节计算。

标准 ANSI/Unicode Edit 与 RichEdit 控件在 `WM_COPY`、`WM_CUT` 和常见复制/剪切按键执行前检查实际选区。规则拒绝时保留旧剪贴板与选区源文本；只检查选中的片段，不因未选中的敏感文本拒绝正常复制。覆盖已存在、之后创建、销毁重建以及父窗口初始化内创建的标准子控件。自定义控件仍须通过受管剪贴板 API；无法保证其自身在 API 调用前的其他副作用。

OLE 复制在调用原始 `OleSetClipboard` 前检查完整的可接受全局内存正文，过滤混合格式，拒绝无法枚举或无法取得的正文。这样普通被拒绝的 OLE 复制不会先清空旧剪贴板。延迟提供的数据与缓存对象在实际读取时继续按当前规则复核。

停用或移除规则会核对并解除本安装已控制的存活进程限制；失败项保留归属记录并显示错误，刷新可重试。关闭控制服务不会放宽已加载规则，应用退出后代理结束。服务重载会恢复同一归属、核对现有代理并扫描新进程，界面会话锁定不会关闭后台执行。数据目录迁移维护期间暂停扫描和配置写入，进程中已加载规则继续执行。

## 执行范围

代理只附加当前 Windows 用户、同一会话的 x64 或 x86 EXE 进程，服务核对架构后用对应控制程序和 DLL 接入，使用 Win32 剪贴板函数与 OLE `IDataObject` 包装执行规则。未知架构继续拒绝；旧的第 1 版原生运行包只支持 x64，第 2 版支持双架构运行中附加，第 3 版支持受控早期启动，第 5 版支持具备创建保留的普通子进程提前继承；旧第 4 版资产保留已有归属恢复和停用能力，但不启用旧子通道。读取时再次检查当前权限与内容，包括代理接入后通过包装取得的 OLE 对象、源对象延迟提供的数据以及 Win32 延迟渲染。OLE 自身对象与格式元数据仅在已经授权的 OLE 操作内传递，应用实际内容仍由包装层检查。`GetDataHere` 通过检查过的临时全局内存填充调用者缓冲区；启用时暂不支持该方法的流、存储或文件介质，较大的全局内存介质也可能被拒绝。

每个代理使用仅当前用户与 SYSTEM 可访问的命名内存段，只保存规则、版本、进程身份与计数。控制服务在附加前写入进程归属记录；PID 复用、进程列表短暂不可见与附加失败都不能被视为已成功应用。停用解除方向、内容与大小限制，但不卸载仍可能被使用的函数跳板或 OLE 包装；包装只提供受管接口，其他扩展接口在代理存续期间不可用。完全移除代理需要退出该应用。

普通进程成功附加后，Windows Runtime Desktop Clipboard、.NET Framework WinForms/WPF 与现代 .NET WinForms/WPF 的常规 API 也通过上述 Win32/OLE 路径执行规则；标准文本控件的复制与剪切使用同一选区保护。纯 IL CLR/AnyCPU 可以通过受控启动在应用代码前接入；自行启动的托管程序在扫描附加前仍未受管，也不承诺所有打包应用或自定义接口兼容。

受控启动核对已保存版本、启用状态、EXE 摘要与 PE 架构，再用匹配架构工具锁定文件并创建暂停的主线程。创建时通过 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 将新进程加入本次专属 Job，失败时不会留下尚未登记的暂停进程。服务先持久保存进程归属，再将策略 DLL 插入首个 import；它在原始应用 DLL/TLS 初始化之前同步核对并加载规则。初始化线程完成 loader 工作期间，主线程保持暂停。服务独立核对真实共享状态、当前规则、身份、文件摘要、界面锁及迁移维护状态，最后才允许恢复主线程。此路径需要支持创建时 Job 分配的 Windows 10 或更新版本；不支持时明确拒绝创建。

恢复主线程之前的失败、控制工具 EOF 或异常退出由专属 Job 结束本次子进程。恢复成功后清除该 Job 的关闭终止标志，使应用在 Sakura 关闭后继续保留已加载规则。若最终提交回执丢失，已受限的子进程可能仍然存活；服务保留持久归属，报告「启动未确认」并通过刷新或后台扫描核对，不把丢失回复视为成功或保证已终止。

受控启动覆盖普通未打包原生 EXE 的原始应用 import DLL、DLL TLS、EXE TLS 与主入口，以及纯 IL CLR/AnyCPU 的应用代码。第 5 版也覆盖已接入原生/CLR 应用在这些应用初始化阶段通过普通 `CreateProcessW/A` 创建的子进程，子进程仍先持久登记再插入策略 import。需要初始化回调运行在主线程的应用可能不兼容。`.local`、关键依赖清单重定向、混合模式 CLR、ReadyToRun、本机入口、进程保护或无法核对的加载条件明确拒绝。系统 DLL 初始化引入的第三方启动 DLL、检查后恶意改写目录或系统设置，以及绕过这两个创建 API 的路径仍不在承诺范围内。检查、loader lock、暂停语义和创建路径边界见 [早期启动范围](windows-clipboard-early-init.md)。自行启动的应用及代理接入前已创建的子进程仍需等待周期扫描并成功附加。

普通子进程提前继承保留调用者的命令行、环境、工作目录、标准句柄和继承标志；调用者指定 `CREATE_SUSPENDED` 时，返回后主线程仍保持一次暂停，由调用者继续恢复。无法安全合并调用者的 opaque `STARTUPINFOEX` 属性列表，因此此路径及调试创建标志明确返回 `ERROR_NOT_SUPPORTED`，不会启动未受管子进程。控制服务关闭、迁移维护或规则代际正在切换时，正在准备的子进程由其独立 Job 清理；控制服务不可用期间，仍启用规则的应用无法新建这些受管子进程，服务恢复后可重试。显式停用规则后创建 API 恢复普通行为。

这不是内核级 DLP 边界。受保护进程、其他用户、其他会话、ARM 应用和通过其他底层接口绕过常规 API 的程序不在保证范围内，也不能撤回应用先前已经读出的文本或接入前取得的原始数据对象。对恶意本机程序强制执行策略仍需独立系统设施。Linux 应用可从 KDE 的原生入口显式启动，范围分别见 [X11 策略](x11-clipboard.md) 和 [Wayland 策略](wayland-clipboard.md)；已有未接入进程与其他底层路径仍未覆盖，因此总清单保持部分实现。

## 构建、分发与验证

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
npm run test:native-clipboard:interfaces -- 64
npm run test:native-clipboard:interfaces -- 32
```

源码编译到 `.tools/native-clipboard`，生产构建复制到 `.sakura-server/assets/native-clipboard`。第 5 版原生清单仍覆盖两种架构的代理 DLL、控制程序及 MinHook、Detours 两份许可，均有大小与 SHA-256；服务运行前逐项核对，完整性失败拒绝附加。主控制程序保留相同的 128 字节剪贴板共享 ABI，子进程 broker 使用独立 ABI；即使 x86 DLL 或附加工具不可用，仍可停用已归属且加载完成的进程规则，无须重新加载 DLL。运行包的整体摘要与更新也包含这些文件。Linux 构建不生成 Windows 二进制，相关页面会显示不可用。

`test:native-clipboard` 编译并启动真实 Win32/OLE 测试应用，创建只属于测试的新窗口站和桌面。默认测试 x64，参数 `32` 测试 x86 受管应用与 x64 对端交换内容。测试启动器使用新的本机登录标识，但保留当前用户的本机权限；不创建账户、不加载配置文件、不使用网络凭据，不读写交互桌面的剪贴板。两种架构均实测方向限制、格式枚举、错误进程身份、UTF-8 大小、敏感文本、畸形数据、二进制格式、OLE 缓存对象与 `GetDataHere`、混合格式、延迟渲染、自动扫描、会话锁定、控制重载和显式停用。Node 测试使用模拟原生适配器验证持久归属与异常处理，另检查双架构路由、旧清单拒绝和 x86 工具损坏时通过主控制程序停用；浏览器测试验证实际服务配置类的保存和失败状态。其他 Windows 版本及商业图形应用仍需独立兼容性验证。

`test:native-clipboard:interfaces` 同样使用私有窗口站，实测 WinRT、WinForms/WPF API 与标准控件、方向热更新、敏感和超限拒绝，以及旧剪贴板、剪切源和选区保持。设置 `SAKURA_CLIPBOARD_MODERN_DOTNET=1` 额外构建 .NET 10.0.9 fixture；需要本机 x64 SDK，x86 运行时使用测试目录内的微软官方固定 ZIP，核对官方 SHA-512 和关键加载文件 SHA-256，不安装或修改系统运行时。已有测试运行时可通过 `SAKURA_CLIPBOARD_DOTNET_X86_RUNTIME` 指定工作区 `.data` 中的自有目录，复用时仍逐项核对。

最终 x64、x86 各 717 项接口断言通过，现代 .NET fixture 实际进程分别为 X64/64 位和 X86/32 位，实际 CoreCLR、CoreLib 与桌面程序集路径均核对。每轮包含 108 项选区保持断言与 12 次 Framework/现代 .NET 文本控件销毁重建。托管窗口创建但保持隐藏；测试用实际非交互键盘消息，不对用户桌面发送输入。这批历史接口测试不证明早期启动；纯 IL CLR/AnyCPU 的新增受控启动入口、独立验证及拒绝范围见 [早期启动说明](windows-clipboard-early-init.md)。打包 UWP、历史和云同步仍未由这些测试覆盖。证据与最终构建摘要见 [本轮实现记录](capability-completion.md)。

受控启动另在 x64/x86 私有窗口站实测主函数首个语句已加载相同构建的 ready/active 策略，首次普通复制和粘贴被拒绝；包含空字符串、空格、引号、反斜杠、中文、emoji、换行与命令样字符的参数原样到达。每种架构通过准备及附加阶段各自的 EOF/控制工具异常退出、恢复后提交 stdout 丢失共 5 个真实失败分支，以及写入归属后与附加后两种控制服务关闭分支。清理只影响本次子进程，原有 fixture 与其他规则保留；归属、扫描、重载及停用继续通过。21 项 Node 用例验证顺序、身份、实际策略复核、锁及迁移变化、持久写失败和严格参数；浏览器验证双架构启动、字面参数、版本冲突、失败提示、未保存禁用与手机布局。证据保存为所属测试目录的 `controlled-launch-proof.json`。

MinHook 固定为官方 1.3.4、提交 `c3fcafdc10146beb5919319d0683e44e3c30d537`。源码保留原许可与逐文件来源摘要，构建拒绝不匹配源码。许可随运行包分发。

早期路径使用 Microsoft Detours 4.0.1、固定提交 `1dbd4ea281d73d478aa8d09a8b83fbd265f715f7`。双架构私有窗口站实测首个应用 DLL TLS、DllMain、EXE TLS 及 wmain 的 Win32/OLE 调用均受到当前策略约束；正常 Common Controls 可启动，关键依赖重定向与 cold build 不匹配明确拒绝，失败 Job 清理不影响另一已提交测试进程。来源、失败回归和许可说明见 [早期启动验证](windows-clipboard-early-init.md)。

`smoke-native-clipboard-descendants.mjs` 的 30 个真实场景覆盖跨 EXE、x64/x86 双向创建、隐式 EXE、实际孙进程与并发、四种 CLR 子进程、原生 DLL/TLS 和 CLR 类型初始化期间创建、调用者暂停及提交后热更新、创建前具名 Job 保留、broker 请求到达服务前的普通附加拒绝、扫描 list/status 与 prepared/attached 的交错、父进程 EOF 精确清理、持久写失败、准备及附加阶段拒绝、控制服务重载、关闭与配置切换期间取消，以及显式停用。每轮保留 `descendant-proof.json`、源码/资产摘要、原始归属文件、编译日志和实际 broker/窗口站启动器 `close` 回执；失败轮次也保留。测试只在自己的私有窗口站执行剪贴板调用，不操作交互剪贴板。

受控创建的系统接口依据微软 [CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)、[创建属性与 Job 列表](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute) 和 [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) 文档；实现与实机测试承诺范围以上述普通原生应用及早期启动说明为准。

接口行为依据微软的 [剪贴板操作](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-operations)、[OLE 剪贴板读取](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-olegetclipboard) 和 [GetDataHere](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-idataobject-getdatahere) 文档实现。测试隔离遵循 [窗口站创建](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createwindowstationw) 与 [CreateProcessWithLogonW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithlogonw) 的本机权限和登录语义；钩子库来源为 [MinHook 官方仓库](https://github.com/TsudaKageyu/minhook)。
