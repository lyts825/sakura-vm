# Windows 受控启动的早期剪贴板策略

受控启动覆盖普通、未打包的原生 x64/x86 EXE 的原始应用 import DLL 初始化、DLL TLS、EXE TLS 与主入口，也覆盖纯 IL CLR 应用在类型初始化与 Main 前的策略加载。CLR 的固定 x64、固定 x86、AnyCPU 及优先 32 位使用相应代理。启动器先验证已保存的 EXE 路径、SHA-256、规则和匹配架构，然后将子进程以 suspended 状态原子加入本次专属 Job。服务持久保存 PID、创建时间、映像和策略归属，并授权 `attach` 后，helper 才修改这个子进程的 import 表或运行 loader；不会修改磁盘上的应用 EXE。

Microsoft Detours 将策略 DLL 插入首个 import，先于原始应用 DLL 初始化。策略 DLL 在自己的 `DllMain` 中核对仅供本次子进程使用的 payload、映射 ABI、build、PID/创建时间和已保存规则，同步提交全部 Win32/OLE hooks，再发布 ready。任一核对或事务失败都返回初始化失败，不回退到应用运行后的扫描注入。[Detours 官方说明](https://github.com/microsoft/Detours/wiki/DetourCreateProcessWithDllEx)

helper 随后用一个初始化线程完成 loader 工作，primary thread 在此期间保持 suspended。应用 DLL/TLS 的 process-attach 回调会运行于初始化线程；依赖这些回调必须在主线程执行的应用可能不兼容，不能将这条路径当成所有应用的兼容性保证。helper 独立读取 ready 和实际 DLL 路径，服务再次核对保存的版本、规则、资产和进程身份后才授权 `resume`。专属 Job 的 kill-on-close 保留至 `ResumeThread` 成功，之后才清除并发布 committed 回执。

MinHook 原有运行中附加路径仍用于扫描及手动附加。它会枚举、暂停其他线程，不能移入 loader lock。早期路径使用 Microsoft Detours 官方 `simple` 示例中的当前线程事务方式；不调用 `LoadLibrary`、不暂停其他线程、不等待另一个 loader-bound 线程或 worker。User32、Ole32 与 Common Controls 是策略 DLL 的静态系统依赖；标准控件的线程钩子和已存在窗口接入在普通运行期执行。此处的 hook 设置遵循微软示例；应用自己的初始化代码仍须遵守 Windows 的 DllMain 约束。[官方示例](https://github.com/microsoft/Detours/blob/1dbd4ea281d73d478aa8d09a8b83fbd265f715f7/samples/simple/simple.cpp)、[DLL 初始化约束](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-best-practices)

## 支持条件和明确拒绝

### 普通子进程提前继承

第 5 版代理同步拦截已接入进程的普通 `CreateProcessW/A`，第 6 版加入同用户、同会话且可核验令牌的 `CreateProcessAsUserW/A`。它在创建前锁定 Windows 可能选择的 EXE，再保留原参数创建主线程暂停的子进程，通过 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 原子加入本次独立的 kill-on-close Job。创建后必须核对 OS 实际映像与锁定文件一致；文件替换或不同映像不能套用检查后的摘要。

具名 Job 的保留记录在创建前发布于仅当前用户/SYSTEM 可访问的独立映射，包含准确父 PID/创建时间/build 和本次唯一 Job token。普通 status/apply 根据 OS 父身份打开该记录并检查准确 Job 成员；pending 状态下，普通 apply 在建立剪贴板 mapping 或运行任何 remote loader/configure 线程前明确拒绝。这个保留覆盖 child 已能被列举、broker 请求尚未到达服务的窗口，同 EXE 的普通扫描也不能抢先注入。保留在 helper 提交、原 Job 解除关闭终止且创建调用返回之前保持；因此已提交的 `CREATE_SUSPENDED` child 可以正常热更新。[IsProcessInJob](https://learn.microsoft.com/en-us/windows/win32/api/jobapi/nf-jobapi-isprocessinjob)

当前用户/SYSTEM ACL、拒绝远程客户端且独占首次实例的命名管道连接独立 broker。代理核对 OS 提供的 server PID 与创建时间；broker 从 OS 获取 client PID、核对用户/会话与父进程创建时间，并从已认证父进程自行复制进程、主线程、Job 和锁定 EXE 句柄。调用者和 broker 各自只关闭自己的句柄，不因发送结果不确定关闭另一进程里的句柄。broker 核对 OS 父 PID、Job 成员及唯一子进程、准确创建时间和主线程一次暂停，再将真实身份交给服务。Windows 支持跨 x86/x64 复制这些句柄。[DuplicateHandle](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle)

服务将子进程自身摘要、准确父 PID/创建时间和最初已保存应用的路径/摘要写入归属文件，再授权匹配位数 helper 的早期 import 注入。该 helper 沿用 `prepared → attached → resume → committed` 顺序，独立复核实际共享规则，并在插入 import 与最后恢复前重新核对当前 owner endpoint 的 broker PID/创建时间/build 和存活状态。扫描、重载、规则更新及停用按持久保存的原应用来源处理不同 EXE 的子孙进程。

服务收到请求后，在任何异步预检或 adopt 前同步登记准确 child 身份。扫描在每个异步读、归属写和 apply 边界复核这项仲裁，并跳过整个采用中的候选；adopt 只等待已发出的同一身份写入或原生命令收敛，不等待父应用的全局启动队列。若存在独立历史归属，明确拒绝把它改成继承来源。helper 真实退出并关闭 stdio、清理结束后才释放采用身份；扫描的旧 list 快照不能删除 prepared 归属，也不能另开普通附加路径。

broker 在等待授权时监测准确父进程 HANDLE 和客户端管道 EOF，并立即终止本次 Job；helper 也在各阶段及 resume 前核对准确父创建时间与存活状态。broker 保留本次复制的句柄直到服务请求结束或服务 EOF，避免晚到的 helper 使用已回收的句柄编号。服务关闭仍由准确待处理 Job 收敛，不会结束另一已提交应用。

子请求并发处理，持久写入使用短独立队列，不等待父进程受控启动完成；因此父应用 DLL TLS、DllMain、EXE TLS 或 CLR 类型初始化中的普通子创建不会与父初始化等待互锁。关闭服务或保存新规则时，先取消旧子进程代际、关闭 broker 并等待真实进程/stdio `close` 及全部待处理 helper 收敛，再完成关闭或保存新规则；独立 Job 清理仅影响本次未提交的子进程分支。服务不可用或迁移维护期间，新请求失败；已提交进程中的剪贴板规则继续执行。

调用者使用普通 `STARTUPINFO`；原命令行、环境、工作目录、标准句柄和继承参数保持原值。`CREATE_SUSPENDED` 返回后主线程仍保持一次暂停，Main 等待调用者恢复；与受控根进程相同，loader 初始化线程已经执行受保护的应用 DLL/TLS 回调。调用者 opaque `STARTUPINFOEX` 属性列表无法通过受支持 API 克隆并添加 Job，带有此标志或 `DEBUG_PROCESS`/`DEBUG_ONLY_THIS_PROCESS` 的普通创建明确返回 `ERROR_NOT_SUPPORTED`。第 7 版只对下一节已证明来源的原 Shell 表追加 Job；代理进程、打包激活、直接 `NtCreateUserProcess` 等其他路径仍没有提前继承承诺。

### 普通 Shell EXE open

第 7 版拦截原 `ShellExecuteExW/A` 和 `ShellExecuteW/A`，在显式普通 EXE open 边界建立线程局部 scope。原 Shell 调用及其全部参数继续由 Windows 处理。Ex 必须已经设置 NOASYNC；默认 Ex 在本机 STA/MTA 均实测使用另一个线程，不能仅凭 TRUE 或 hInstApp 大于 32 认定提前继承完成。代理不会暗加 NOASYNC/site，也不会用裸 CreateProcess 模拟 Shell。W/A 须实际证明同线程普通 EXE 创建。[ShellExecuteEx](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecuteexw)、[NOASYNC 与返回句柄](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-shellexecuteinfoa)

源路径须为规范的本地绝对普通 EXE，文件通过禁止写入/替换的只读 HANDLE 固定；OS child 映像再与该文件核对。代理只读检查直接 `.exe → exefile` 与 `"%1" %*` open 注册，拒绝 DDE、DelegateExecute/DropTarget/ExplorerCommand 委托、App Paths 打包身份/DropTarget、ShellExecuteHooks、IFEO 调试及 AppCompat 注册。嵌入资源 1 经 CreateActCtx/QueryActCtx 核验为显式 asInvoker 且 UiAccess=false；缺失、提升权限、UIAccess、sidecar manifest 或 `.local` 和无法核验的元数据在原 Shell 调用前拒绝。NULL/未知 verb、runas、IDLIST/CLASSKEY 等非允许 flags、UNC/网络驱动和未知激活机制同样拒绝。关联和目录预检不是整个系统配置的原子快照；有权限并发改写这些配置、文件目录或进程内 hooks 的对抗者不在保证内。[应用清单](https://learn.microsoft.com/en-us/windows/win32/sbscs/application-manifests)、[实际 RunLevel 查询](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryactctxw)、[Shell COM 方法](https://learn.microsoft.com/en-us/windows/win32/shell/app-registration)

公开 Initialize/Update/Delete hooks 核对真实 system32/SysWOW64 Shell32 或 Windows.Storage caller、当前 scope 代次、线程、原初始化容量和每次成功更新/删除。仅原表来源完整、还有空位、没有既存 JOB_LIST 的 child 创建可 claim。公开 Update 在原表追加稳定的单元素本次 Job HANDLE 数组，未知 `0x60001` 保留原表、原值和原指针；不读 opaque 布局，不猜该属性含义，不重建属性表。原 Initialize/Update、来源记录、claim、追加和原同步 OS 创建分别在短 ledger 锁内核验，删除不能抢先释放 Windows 正在读取的数组；锁不跨 broker/helper 等待。原表重新初始化、claimed 后更新、跨线程/代次更新、容量不足、既存 Job、来源缺失和重复创建均不能变成另一条附加路径。[属性初始化](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-initializeprocthreadattributelist)、[属性值生命周期](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)

Job 数组及同权限复制的 HANDLE 保留至真正原 Delete 和 scope 收尾。缺失 Delete 的表隔离保留其稳定存储，禁止复用，清理只结束本次 Job 和准确 child HANDLE；不会为释放内存而让 Windows 保存悬空值指针。失败时另核对并终止已持有的准确 child HANDLE，不能仅假定 TerminateJobObject 已回收一个未成功验证 Job 成员的子进程。成功须完整删除记录且恰好一个 child 已提交，返回的 hProcess 若存在也须对应其 PID/创建时间；无 child success、重入和 scope 内普通 STARTUPINFO 降级不能伪装成成功。

本次专属 Job 在创建前发布 pending 归属，scanner/普通 apply 不能先建 mapping 或运行 loader；其余身份核验、归属持久化、prepared/attached/resume/committed、broker 父 HANDLE/EOF 清理与取消沿用第 5/6 版合约。Shell 自己的 CREATE_SUSPENDED 保留，加载完成后由原 Shell 恢复，job commit 顺序不变。scope 内规则停用或变化不能绕过提前创建核验；scope 外停用直接调用原 Windows API，包含默认异步、NULL verb、无返回 hProcess 和原 GetLastError。ShellExecuteEx 官方禁止在 loader lock/DllMain 中调用，因此本节不承诺初始化回调中的 Shell 操作；普通 W/A 和已核验 AsUser 的原早期初始化覆盖保留。

### 带令牌的创建

微软明确允许 `CreateProcessAsUserW/A` 使用扩展 startup info，因此第 6 版通过原 API 的扩展结构加入创建时 Job。调用者的令牌由 `DuplicateHandle(DUPLICATE_SAME_ACCESS)` 固定为同一对象，保留原权限；其他线程关闭或复用原句柄不能替换传入 Windows 的对象。没有使用 `DuplicateTokenEx` 重造生产令牌，也没有改变调用者的安全属性、环境、目录、句柄继承或 Windows 的权限检查。系统内部同步调用这些创建 API 时使用线程局部递归保护；保护范围只涵盖本次原系统调用，不跳过成功 child 的后续继承。[CreateProcessAsUserW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw)

SID 和会话读取由两次 `TokenStatistics` 的 TokenId/ModifiedId/AuthenticationId/type 核对包围，避免拼接变化前后的身份。源对象必须是可查询的 primary token、当前 Windows 用户和当前会话。调用原 API 前、读取实际 child token 前后，重新比对源对象的全部身份及 ModifiedId；即使属性恢复原值，旧快照也不能重新被接受。实际 child 另须符合源 SID、会话、primary 类型和认证标识，broker/helper 各阶段仍独立复核真实 child，预检不能代替这些实核。源变化或不可验证条件在应用代码前由本次 Job 精确清理。NULL token 保留 Windows 原 NULL 参数，但仅在没有线程 impersonation 且当前 primary 对象未变化时可用；跨用户/会话、impersonation token、匿名或不可查询令牌明确返回 `ERROR_ACCESS_DENIED`。[令牌查询](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation)

`CreateProcessWithTokenW` 文档允许扩展结构，但本机原函数对正确 `sizeof(STARTUPINFOEX)` 和 `EXTENDED_STARTUPINFO_PRESENT` 的空属性或 Job 属性均返回 87；普通结构在当前用户缺少 SeImpersonatePrivilege 时返回 1314。`CreateProcessWithLogonW` 文档仅指定普通 `STARTUPINFO`，实测普通本机 NETCREDENTIALS_ONLY 可创建，扩展 Job 形式返回 87。因此第 6 版启用规则时拒绝这两种创建：可核验 WithToken 返回 `ERROR_NOT_SUPPORTED`，不可核验令牌先返回 `ERROR_ACCESS_DENIED`；WithLogon 直接返回 `ERROR_NOT_SUPPORTED`，不尝试认证、加载配置文件或使用网络凭据。两者都不采用先创建再 `AssignProcessToJobObject` 的降级；停用后原参数原样调用系统 API。其他 Windows 版本与具有不同权限的用户仍需独立兼容性验证。[CreateProcessWithTokenW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithtokenw)、[CreateProcessWithLogonW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithlogonw)

以下早期映像条件同时适用于受控根进程与子进程。

- 必须是未打包 Windows GUI/console PE，支持原生 x86/x64 或纯 IL CLR。AnyCPU 在 x64 Windows 上使用 x64 helper；32BITREQUIRED/32BITPREFERRED 使用 x86 helper。磁盘 PE/CLR 标记和实际 suspended 子进程位数均须核对一致。非 x86/x64、混合模式 CLR、ReadyToRun/本机入口、歧义或越界 CLR 映射及未知位数标记拒绝。
- 策略 DLL 必须具有完整本地路径，能无损往返 Windows import 使用的活动代码页，且锁定的文件身份符合已核验资产。路径过长、编码不能表示、符号缺失或实际载入其他映像拒绝。
- 动态代码禁止、Microsoft/Store-only 映像签名限制及不能核对的进程保护拒绝。
- EXE `.local`、包加载重定向，以及将策略 DLL、User32/Ole32/Common Controls、关键运行库、当前 OS KnownDLL 或 API-set 名称重定向的应用清单拒绝。仅允许系统目录或经过核对的架构匹配 WinSxS Common Controls；应用及策略目录中的私有 comctl32 和非系统清单重定向拒绝。普通官方 Common Controls 清单可用。
- 老运行包 v1/v2 保留已有进程策略的扫描、恢复及停用能力；受控启动要求 v3 的双架构早期代理及校验通过的 Detours 许可资产，不静默降级。
- 普通 `CreateProcessW/A` 子进程提前继承要求 v5 或更新；已核验令牌的 `CreateProcessAsUserW/A` 要求 v6；有界普通 Shell EXE open 要求 v7。新服务保留 v5/v6 资产各自已有的创建、恢复与停用，不将旧代理当作具备新增 API 能力。代理接入前已创建的进程和其他底层创建路径仍未覆盖；对恶意同用户本机代码的强制边界仍需要独立系统设施。

Windows 的 `.local` 和 SxS 重定向优先于 KnownDLL，包括指定完整路径的 DLL。helper 在创建子进程前及持久 prepared 后、编辑 import 前各检查一次。清单通过 `CreateActCtx`/`QueryActCtx` 获取 OS 实际解析的程序集图，再读取这些清单的 XML；不能把 `ulFileCount=0` 当作没有重定向，因为本机实测该计数在有效 DLL 重定向时仍为 0。EXE 资源使用仅映射数据/资源的 `LoadLibraryEx`，不会执行该应用的 imports、DLL/TLS。解析图内嵌入私有程序集的 DLL/EXE 会检查全部本地 RT_MANIFEST 资源与语言版本，缺失或不可核对的实际清单拒绝；资源枚举异常不会误判成“没有清单”。XML 使用系统 XmlLite 内存流，禁止 DTD、外部 resolver，限制文档大小和深度，并按解码后的文件名检查，包括 UTF-16 和字符引用。[DLL 搜索顺序](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-search-order)、[资源映射语义](https://learn.microsoft.com/en-us/windows/win32/api/libloaderapi/nf-libloaderapi-loadlibraryexw)、[XmlLite 安全约束](<https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ms752816(v=vs.85)>)

规则真正初始化时还核对进程内已加载的 User32/Ole32 与 Common Controls 的完整系统路径，ready 后 helper 核对策略 DLL 的实际完整路径。这些运行期检查与两次预检共同拒绝不兼容对象，但两次文件预检不构成目录的原子快照。应用目录、外部清单或系统配置在检查和 loader 之间被其他进程恶意改写，可能改变加载顺序；EXE 和策略 DLL 的只读锁不能锁住整个目录。该路径不承诺阻止有权限修改目录/进程内存/系统设置的对抗者。

原始应用 imports/TLS 之前，Windows 必须初始化策略依赖的系统 DLL。由这些系统 DLL 初始化引入的系统级第三方启动 DLL，例如启用的 AppInit_DLLs，也可能先于策略 `DllMain` 执行。这条应用启动路径没有拦截或更改系统的该类机制，也不覆盖驱动、手工映射、直接调用底层剪贴板系统接口、恶意卸载/改写 hooks。Microsoft 说明 AppInit_DLLs 可向交互应用加载自定义 DLL，并在启用 Secure Boot 时禁用；测试不会修改这些系统设置，也不会据此假设每台机器的状态。[AppInit_DLLs 官方说明](https://learn.microsoft.com/en-us/windows/win32/dlls/secure-boot-and-appinit-dlls)

任何已创建子进程的失败都由本次专属 Job 处理。若 primary 已 resume、Job 已解除 kill-on-close，而 helper 在 committed 回执送达前被外部杀死，已施加策略的应用可能继续存活；界面报告“启动未确认”、保留并刷新持久归属，不把所有通信失败说成子进程必已终止。

## 依赖和复核

早期注入依赖固定为官方 Microsoft Detours 4.0.1，commit `1dbd4ea281d73d478aa8d09a8b83fbd265f715f7`，MIT。`native/windows-clipboard/vendor/detours/provenance.json` 逐文件记录 SHA-256；构建前核验未修改的上游字节，发行包含 `Detours-LICENSE.md`。MinGW 的 `__CRT__NO_INLINE` 工具链定义避免 strsafe/libmingwex 的重复符号，没有修改上游源码。早期路径不通过跨架构 rundll32 代理，每个目标使用匹配 helper。

在 Windows 构建机设置空间充足的自有 TEMP/TMP、测试目录和 x64/x86 MinGW 编译器后运行：

```powershell
$env:TEMP = Join-Path (Get-Location) '.data/native-clipboard-test-temp'
$env:TMP = $env:TEMP
$env:SAKURA_NATIVE_CLIPBOARD_CXX = 'C:/Strawberry/c/bin/g++.exe'
node scripts/build-native-clipboard.mjs
node --import tsx scripts/smoke-native-clipboard-early.mjs 64
node --import tsx scripts/smoke-native-clipboard-early.mjs 32
node --import tsx scripts/smoke-native-clipboard.mjs 64
node --import tsx scripts/smoke-native-clipboard.mjs 32
node --import tsx scripts/smoke-native-clipboard-token.mjs
node --import tsx scripts/smoke-native-clipboard-shell.mjs
node --import tsx --test tests/native-clipboard.test.ts
```

早期 fixture 是测试专属 EXE 和 import DLL，生成独有目录、窗口站及命名管道。DLL 的首个 TLS、首个 DllMain、EXE TLS 和首条 wmain 指令各执行真实 Win32 与 OLE 剪贴板调用；每次调用前独立确认并切换到非 WinSta0 的私有窗口站。四阶段均要求对应进程/创建时间的 ready、active、flags，Win32 `ERROR_ACCESS_DENIED`、OLE `E_ACCESSDENIED` 以及累计阻断计数。输出 proof 仅含元数据，不读取宿主交互桌面的剪贴板。

`npm run test:native-clipboard:managed-early` 使用已安装的离线 .NET Framework 编译器，在测试专属窗口站实测固定 x64/x86、AnyCPU、优先 32 位。类型初始化和 Main 各核对映射身份、已加载代理、ready/active/flags、真实位数、Win32/OLE 拒绝及累计计数。故意编译不兼容的策略 DLL 后，新建的独立 CLR EXE 必须在首个应用初始化 marker 前被拒绝，由原 Job 关闭；原已提交应用保持存活，失败归属只在刷新确认后核销。该脚本不安装运行时、不创建账号，不覆盖打包应用、特殊 CLR 宿主或所有商业应用兼容性。Detours 的启动头恢复仍使用已核对的官方实现，参见 [官方启动注入说明](https://github.com/microsoft/Detours/wiki/DetourCreateProcessWithDllEx)。

同一 smoke 还验证 Common Controls 和 DLL 资源内的私有程序集清单可以启动，User32 SxS、UTF-16 字符引用 sidecar 清单、私有程序集 DLL 资源重定向和 `.local` 在子进程创建前被拒绝，以及 cold build 不匹配时首个应用 TLS marker 不存在、本次 Job 清理、已提交的另一个测试进程继续存活、持久归属保留至刷新核销。旧 smoke 继续覆盖运行中附加、OLE 数据对象、更新/停用/重启及受控启动 prepared/attached/通信丢失等分支。

第 6 版 token smoke 的 70 个场景保留普通 W/A 的全部 30 个回归，新增 AsUserW/A 跨架构、应用 DLL/TLS 初始化期间创建、纯 IL CLR child、调用者暂停、令牌变更、原参数和准确清理反例。停用后的结果由未接入 fixture 调用同一原 API 对照；标准句柄核对使用真实对象比较，允许 Windows WithLogon 的合法数值重映射。原非零失败轮次、夹具 stdio 继承等待及精确清理记录均保留，修复后的独立轮次取得源码不变、全部 broker/窗口站/对照父进程实际 `close` 和无残留自有进程的回执。测试始终使用自有私有窗口站，NETCREDENTIALS_ONLY 仅为夹具建立本机登录标识，不创建账号或使用网络凭据；没有安装运行时或访问交互剪贴板。

第 7 版最终 build `77ae2eefeb5683e906a04547301275d1f585f29b3633622ab95ae3d0f12b4fea` 通过 Shell smoke 133 个场景回执，含双架构各 24 项公开属性模型/OS 生命周期断言。模型实测原 Initialize/Update 与 claim 不可交错、claimed 更新和 live re-init 不调用原 API、原 Job/容量不足/来源和线程代次拒绝、未知 Shell 属性保留、Job 数组至真正 Delete 的存活及 missing Delete 隔离；另创建一个确实不属于清理 Job 的暂停自有进程，证明准确 hProcess 补清理、exit 1 和应用 marker 缺失。真实 Shell 场景包含早期与运行中 MinHook 父进程、原 Ex NOASYNC 与 W/A、两种 COM apartment、跨架构孙进程与同父双线程、broker 前扫描拒绝、父 EOF、代际/停用在 scope 内发生、准备/附加失败、原 Windows 停用与未接入对照。没有改 registry/文件关联、安装运行时或调用交互剪贴板。

最终 Shell 14 个 broker、4 个模型/对照父进程和窗口站启动器实际进程/stdio close 0，owned0；同 build 的普通/令牌回归 71 个场景、16 个 broker、对照父进程与窗口站启动器 close 0，准确目录清单 owned0，含完整历史 v5/v6 资产恢复及停用。40 项 Node 用例通过。每轮原 proof、日志、源码及六资产字节单独保留，冻结记录各自 SHA-256；首轮缺 SDK 编译宏的非零日志也保留，不据此宣称支持其他 OS、商业应用、CLR Shell 启动或底层创建 API。
