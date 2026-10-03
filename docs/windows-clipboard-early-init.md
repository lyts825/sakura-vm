# Windows 受控启动的早期剪贴板策略

受控启动覆盖普通、未打包的原生 x64/x86 EXE 的原始应用 import DLL 初始化、DLL TLS、EXE TLS 与主入口，也覆盖纯 IL CLR 应用在类型初始化与 Main 前的策略加载。CLR 的固定 x64、固定 x86、AnyCPU 及优先 32 位使用相应代理。启动器先验证已保存的 EXE 路径、SHA-256、规则和匹配架构，然后将子进程以 suspended 状态原子加入本次专属 Job。服务持久保存 PID、创建时间、映像和策略归属，并授权 `attach` 后，helper 才修改这个子进程的 import 表或运行 loader；不会修改磁盘上的应用 EXE。

Microsoft Detours 将策略 DLL 插入首个 import，先于原始应用 DLL 初始化。策略 DLL 在自己的 `DllMain` 中核对仅供本次子进程使用的 payload、映射 ABI、build、PID/创建时间和已保存规则，同步提交全部 Win32/OLE hooks，再发布 ready。任一核对或事务失败都返回初始化失败，不回退到应用运行后的扫描注入。[Detours 官方说明](https://github.com/microsoft/Detours/wiki/DetourCreateProcessWithDllEx)

helper 随后用一个初始化线程完成 loader 工作，primary thread 在此期间保持 suspended。应用 DLL/TLS 的 process-attach 回调会运行于初始化线程；依赖这些回调必须在主线程执行的应用可能不兼容，不能将这条路径当成所有应用的兼容性保证。helper 独立读取 ready 和实际 DLL 路径，服务再次核对保存的版本、规则、资产和进程身份后才授权 `resume`。专属 Job 的 kill-on-close 保留至 `ResumeThread` 成功，之后才清除并发布 committed 回执。

MinHook 原有运行中附加路径仍用于扫描及手动附加。它会枚举、暂停其他线程，不能移入 loader lock。早期路径使用 Microsoft Detours 官方 `simple` 示例中的当前线程事务方式；不调用 `LoadLibrary`、不暂停其他线程、不等待另一个 loader-bound 线程或 worker。User32、Ole32 与 Common Controls 是策略 DLL 的静态系统依赖；标准控件的线程钩子和已存在窗口接入在普通运行期执行。此处的 hook 设置遵循微软示例；应用自己的初始化代码仍须遵守 Windows 的 DllMain 约束。[官方示例](https://github.com/microsoft/Detours/blob/1dbd4ea281d73d478aa8d09a8b83fbd265f715f7/samples/simple/simple.cpp)、[DLL 初始化约束](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-best-practices)

## 支持条件和明确拒绝

### 普通子进程提前继承

第 5 版代理同步拦截已接入进程的普通 `CreateProcessW/A`。它在创建前锁定 Windows 可能选择的 EXE，再保留原参数创建主线程暂停的子进程，通过 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 原子加入本次独立的 kill-on-close Job。创建后必须核对 OS 实际映像与锁定文件一致；文件替换或不同映像不能套用检查后的摘要。

具名 Job 的保留记录在创建前发布于仅当前用户/SYSTEM 可访问的独立映射，包含准确父 PID/创建时间/build 和本次唯一 Job token。普通 status/apply 根据 OS 父身份打开该记录并检查准确 Job 成员；pending 状态下，普通 apply 在建立剪贴板 mapping 或运行任何 remote loader/configure 线程前明确拒绝。这个保留覆盖 child 已能被列举、broker 请求尚未到达服务的窗口，同 EXE 的普通扫描也不能抢先注入。保留在 helper 提交、原 Job 解除关闭终止且创建调用返回之前保持；因此已提交的 `CREATE_SUSPENDED` child 可以正常热更新。[IsProcessInJob](https://learn.microsoft.com/en-us/windows/win32/api/jobapi/nf-jobapi-isprocessinjob)

当前用户/SYSTEM ACL、拒绝远程客户端且独占首次实例的命名管道连接独立 broker。代理核对 OS 提供的 server PID 与创建时间；broker 从 OS 获取 client PID、核对用户/会话与父进程创建时间，并从已认证父进程自行复制进程、主线程、Job 和锁定 EXE 句柄。调用者和 broker 各自只关闭自己的句柄，不因发送结果不确定关闭另一进程里的句柄。broker 核对 OS 父 PID、Job 成员及唯一子进程、准确创建时间和主线程一次暂停，再将真实身份交给服务。Windows 支持跨 x86/x64 复制这些句柄。[DuplicateHandle](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle)

服务将子进程自身摘要、准确父 PID/创建时间和最初已保存应用的路径/摘要写入归属文件，再授权匹配位数 helper 的早期 import 注入。该 helper 沿用 `prepared → attached → resume → committed` 顺序，独立复核实际共享规则，并在插入 import 与最后恢复前重新核对当前 owner endpoint 的 broker PID/创建时间/build 和存活状态。扫描、重载、规则更新及停用按持久保存的原应用来源处理不同 EXE 的子孙进程。

服务收到请求后，在任何异步预检或 adopt 前同步登记准确 child 身份。扫描在每个异步读、归属写和 apply 边界复核这项仲裁，并跳过整个采用中的候选；adopt 只等待已发出的同一身份写入或原生命令收敛，不等待父应用的全局启动队列。若存在独立历史归属，明确拒绝把它改成继承来源。helper 真实退出并关闭 stdio、清理结束后才释放采用身份；扫描的旧 list 快照不能删除 prepared 归属，也不能另开普通附加路径。

broker 在等待授权时监测准确父进程 HANDLE 和客户端管道 EOF，并立即终止本次 Job；helper 也在各阶段及 resume 前核对准确父创建时间与存活状态。broker 保留本次复制的句柄直到服务请求结束或服务 EOF，避免晚到的 helper 使用已回收的句柄编号。服务关闭仍由准确待处理 Job 收敛，不会结束另一已提交应用。

子请求并发处理，持久写入使用短独立队列，不等待父进程受控启动完成；因此父应用 DLL TLS、DllMain、EXE TLS 或 CLR 类型初始化中的普通子创建不会与父初始化等待互锁。关闭服务或保存新规则时，先取消旧子进程代际、关闭 broker 并等待真实进程/stdio `close` 及全部待处理 helper 收敛，再完成关闭或保存新规则；独立 Job 清理仅影响本次未提交的子进程分支。服务不可用或迁移维护期间，新请求失败；已提交进程中的剪贴板规则继续执行。

调用者使用普通 `STARTUPINFO`；原命令行、环境、工作目录、标准句柄和继承参数保持原值。`CREATE_SUSPENDED` 返回后主线程仍保持一次暂停，Main 等待调用者恢复；与受控根进程相同，loader 初始化线程已经执行受保护的应用 DLL/TLS 回调。opaque `STARTUPINFOEX` 属性列表无法通过受支持 API 克隆并添加 Job，带有此标志或 `DEBUG_PROCESS`/`DEBUG_ONLY_THIS_PROCESS` 的创建明确返回 `ERROR_NOT_SUPPORTED`。`CreateProcessAsUser`、`CreateProcessWithToken/Logon`、ShellExecute/代理进程、打包激活、直接 `NtCreateUserProcess` 等路径没有提前继承承诺，也不能把普通创建测试当作这些路径的证据。

以下早期映像条件同时适用于受控根进程与子进程。

- 必须是未打包 Windows GUI/console PE，支持原生 x86/x64 或纯 IL CLR。AnyCPU 在 x64 Windows 上使用 x64 helper；32BITREQUIRED/32BITPREFERRED 使用 x86 helper。磁盘 PE/CLR 标记和实际 suspended 子进程位数均须核对一致。非 x86/x64、混合模式 CLR、ReadyToRun/本机入口、歧义或越界 CLR 映射及未知位数标记拒绝。
- 策略 DLL 必须具有完整本地路径，能无损往返 Windows import 使用的活动代码页，且锁定的文件身份符合已核验资产。路径过长、编码不能表示、符号缺失或实际载入其他映像拒绝。
- 动态代码禁止、Microsoft/Store-only 映像签名限制及不能核对的进程保护拒绝。
- EXE `.local`、包加载重定向，以及将策略 DLL、User32/Ole32/Common Controls、关键运行库、当前 OS KnownDLL 或 API-set 名称重定向的应用清单拒绝。仅允许系统目录或经过核对的架构匹配 WinSxS Common Controls；应用及策略目录中的私有 comctl32 和非系统清单重定向拒绝。普通官方 Common Controls 清单可用。
- 老运行包 v1/v2 保留已有进程策略的扫描、恢复及停用能力；受控启动要求 v3 的双架构早期代理及校验通过的 Detours 许可资产，不静默降级。
- 子进程提前继承要求 v5，并只覆盖规则成功加载之后经过普通 `CreateProcessW/A` 的创建。代理接入前已创建的进程和其他底层创建路径仍未覆盖；对恶意同用户本机代码的强制边界仍需要独立系统设施。

Windows 的 `.local` 和 SxS 重定向优先于 KnownDLL，包括指定完整路径的 DLL。helper 在创建子进程前及持久 prepared 后、编辑 import 前各检查一次。清单通过 `CreateActCtx`/`QueryActCtx` 获取 OS 实际解析的程序集图，再读取这些清单的 XML；不能把 `ulFileCount=0` 当作没有重定向，因为本机实测该计数在有效 DLL 重定向时仍为 0。EXE 资源使用仅映射数据/资源的 `LoadLibraryEx`，不会执行该应用的 imports、DLL/TLS。解析图内嵌入私有程序集的 DLL/EXE 会检查全部本地 RT_MANIFEST 资源与语言版本，缺失或不可核对的实际清单拒绝；资源枚举异常不会误判成“没有清单”。XML 使用系统 XmlLite 内存流，禁止 DTD、外部 resolver，限制文档大小和深度，并按解码后的文件名检查，包括 UTF-16 和字符引用。[DLL 搜索顺序](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-search-order)、[资源映射语义](https://learn.microsoft.com/en-us/windows/win32/api/libloaderapi/nf-libloaderapi-loadlibraryexw)、[XmlLite 安全约束](<https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ms752816(v=vs.85)>)

规则真正初始化时还核对进程内已加载的 User32/Ole32 与 Common Controls 的完整系统路径，ready 后 helper 核对策略 DLL 的实际完整路径。这些运行期检查与两次预检共同拒绝不兼容对象，但两次文件预检不构成目录的原子快照。应用目录、外部清单或系统配置在检查和 loader 之间被其他进程恶意改写，可能改变加载顺序；EXE 和策略 DLL 的只读锁不能锁住整个目录。该路径不承诺阻止有权限修改目录/进程内存/系统设置的对抗者。

原始应用 imports/TLS 之前，Windows 必须初始化策略依赖的系统 DLL。由这些系统 DLL 初始化引入的系统级第三方启动 DLL，例如启用的 AppInit_DLLs，也可能先于策略 `DllMain` 执行。这条应用启动路径没有拦截或更改系统的该类机制，也不覆盖驱动、手工映射、直接调用底层剪贴板系统接口、恶意卸载/改写 hooks。Microsoft 说明 AppInit_DLLs 可向交互应用加载自定义 DLL，并在启用 Secure Boot 时禁用；测试不会修改这些系统设置，也不会据此假设每台机器的状态。[AppInit_DLLs 官方说明](https://learn.microsoft.com/en-us/windows/win32/dlls/secure-boot-and-appinit-dlls)

任何已创建子进程的失败都由本次专属 Job 处理。若 primary 已 resume、Job 已解除 kill-on-close，而 helper 在 committed 回执送达前被外部杀死，已施加策略的应用可能继续存活；界面报告“启动未确认”、保留并刷新持久归属，不把所有通信失败说成子进程必已终止。

## 依赖和复核

早期注入依赖固定为官方 Microsoft Detours 4.0.1，commit `1dbd4ea281d73d478aa8d09a8b83fbd265f715f7`，MIT。`native/windows-clipboard/vendor/detours/provenance.json` 逐文件记录 SHA-256；构建前核验未修改的上游字节，发行包含 `Detours-LICENSE.md`。MinGW 的 `__CRT__NO_INLINE` 工具链定义避免 strsafe/libmingwex 的重复符号，没有修改上游源码。早期路径不通过跨架构 rundll32 代理，每个目标使用匹配 helper。

在 Windows 构建机设置 D 盘 TEMP/TMP 和 x64/x86 MinGW 编译器后运行：

```powershell
$env:TEMP = Join-Path (Get-Location) '.data/native-clipboard-test-temp'
$env:TMP = $env:TEMP
$env:SAKURA_NATIVE_CLIPBOARD_CXX = 'C:/Strawberry/c/bin/g++.exe'
node scripts/build-native-clipboard.mjs
node --import tsx scripts/smoke-native-clipboard-early.mjs 64
node --import tsx scripts/smoke-native-clipboard-early.mjs 32
node --import tsx scripts/smoke-native-clipboard.mjs 64
node --import tsx scripts/smoke-native-clipboard.mjs 32
node --import tsx --test tests/native-clipboard.test.ts
```

早期 fixture 是测试专属 EXE 和 import DLL，生成独有目录、窗口站及命名管道。DLL 的首个 TLS、首个 DllMain、EXE TLS 和首条 wmain 指令各执行真实 Win32 与 OLE 剪贴板调用；每次调用前独立确认并切换到非 WinSta0 的私有窗口站。四阶段均要求对应进程/创建时间的 ready、active、flags，Win32 `ERROR_ACCESS_DENIED`、OLE `E_ACCESSDENIED` 以及累计阻断计数。输出 proof 仅含元数据，不读取宿主交互桌面的剪贴板。

`npm run test:native-clipboard:managed-early` 使用已安装的离线 .NET Framework 编译器，在测试专属窗口站实测固定 x64/x86、AnyCPU、优先 32 位。类型初始化和 Main 各核对映射身份、已加载代理、ready/active/flags、真实位数、Win32/OLE 拒绝及累计计数。故意编译不兼容的策略 DLL 后，新建的独立 CLR EXE 必须在首个应用初始化 marker 前被拒绝，由原 Job 关闭；原已提交应用保持存活，失败归属只在刷新确认后核销。该脚本不安装运行时、不创建账号，不覆盖打包应用、特殊 CLR 宿主或所有商业应用兼容性。Detours 的启动头恢复仍使用已核对的官方实现，参见 [官方启动注入说明](https://github.com/microsoft/Detours/wiki/DetourCreateProcessWithDllEx)。

同一 smoke 还验证 Common Controls 和 DLL 资源内的私有程序集清单可以启动，User32 SxS、UTF-16 字符引用 sidecar 清单、私有程序集 DLL 资源重定向和 `.local` 在子进程创建前被拒绝，以及 cold build 不匹配时首个应用 TLS marker 不存在、本次 Job 清理、已提交的另一个测试进程继续存活、持久归属保留至刷新核销。旧 smoke 继续覆盖运行中附加、OLE 数据对象、更新/停用/重启及受控启动 prepared/attached/通信丢失等分支。
