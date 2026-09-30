# Windows 普通应用剪贴板策略

Windows x64 原生代理为显式选择的普通 EXE 应用执行复制、粘贴、文本大小与敏感内容规则。网页工作台规则仍保存在浏览器；本机应用规则由控制服务保存，在「系统设置 → 管理 Windows 剪贴板策略」管理。

## 使用

1. 启动要管理的应用，打开管理页面，刷新应用列表。
2. 选择进程并添加应用。服务核对当前 Windows 用户、会话、PID、进程创建时间、完整 EXE 路径与文件摘要；同一程序后续启动的进程也适用此规则。
3. 修改复制、粘贴、其他格式、敏感文本和 UTF-8 文本上限，勾选启用并保存。
4. 查看每个进程的状态。「已接入 Win32/OLE」表示此进程的代理已成功加载且规则与当前保存值一致；拒绝计数不含剪贴板文本。附加失败、架构未知、文件变化与版本不一致分别显示错误。
5. 更新应用程序后，重新选择正在运行的新版本，重新绑定摘要并保存。同一代理构建切换安装目录时复用进程中的已有 DLL；更换代理构建后，旧进程需要重启才能使用新代理，显式停用仍可解除同一 ABI 的旧规则。

默认停用。禁用其他格式或启用敏感检测时，只允许 Windows 纯文本及其语言区域元数据，文件、图片、HTML、RTF 和其他自定义格式均被拒绝；OLE 混合格式复制会过滤被禁格式并保留允许的纯文本。敏感检测涵盖常见私钥、令牌、JWT、带凭据的 URL 与明文凭据赋值，不能识别所有秘密或图片中的内容。文本上限为 1 KiB 到 1 MiB，按 UTF-8 字节计算。

停用或移除规则会核对并解除本安装已控制的存活进程限制；失败项保留归属记录并显示错误，刷新可重试。关闭控制服务不会放宽已加载规则，应用退出后代理结束。服务重载会恢复同一归属、核对现有代理并扫描新进程，界面会话锁定不会关闭后台执行。数据目录迁移维护期间暂停扫描和配置写入，进程中已加载规则继续执行。

## 执行范围

代理只附加当前 Windows 用户、同一会话的 x64 EXE 进程，使用 Win32 剪贴板函数与 OLE `IDataObject` 包装执行规则。读取时再次检查当前权限与内容，包括代理接入后通过包装取得的 OLE 对象、源对象延迟提供的数据以及 Win32 延迟渲染。OLE 自身对象与格式元数据仅在已经授权的 OLE 操作内传递，应用实际内容仍由包装层检查。`GetDataHere` 通过检查过的临时全局内存填充调用者缓冲区；启用时暂不支持该方法的流、存储或文件介质，较大的全局内存介质也可能被拒绝。

每个代理使用仅当前用户与 SYSTEM 可访问的命名内存段，只保存规则、版本、进程身份与计数。控制服务在附加前写入进程归属记录；PID 复用、进程列表短暂不可见与附加失败都不能被视为已成功应用。停用解除方向、内容与大小限制，但不卸载仍可能被使用的函数跳板或 OLE 包装；包装只提供受管接口，其他扩展接口在代理存续期间不可用。完全移除代理需要退出该应用。

这不是内核级 DLP 边界。新应用在周期扫描并成功附加前可以操作剪贴板；受保护进程、其他用户、其他会话、32 位程序和通过其他底层接口绕过常规 API 的程序不在保证范围内，也不能撤回应用先前已经读出的文本或接入前取得的原始数据对象。需要零间隙或对恶意本机程序的强制策略时仍需独立系统设施。Linux X11 应用可从 KDE 的原生入口显式启动，范围见 [Linux X11 应用剪贴板策略](x11-clipboard.md)；已有普通 Linux 程序、原生 Wayland 等路径仍未覆盖，因此总清单保持部分实现。

## 构建、分发与验证

Windows 源码构建需要 x64 MinGW-w64 C++ 编译器 `g++.exe`。编译器不在 PATH 时可设置进程环境变量 `SAKURA_NATIVE_CLIPBOARD_CXX` 为其完整路径。本机已使用 GCC 13.2；运行包使用静态 C++ 运行时，目标机使用代理无需安装此编译器。

```powershell
npm run build:native-clipboard
npm run build
npm run test:native-clipboard
```

源码编译到 `.tools/native-clipboard`，生产构建复制到 `.sakura-server/assets/native-clipboard`。代理 DLL、控制程序和 MinHook 许可均有大小与 SHA-256 清单，服务运行前逐项核对，完整性失败拒绝附加。DLL 不可用时，仍可通过经过校验的控制程序停用已归属的进程。运行包的整体摘要与更新也包含这些文件。Linux 构建不生成 Windows 二进制，相关页面会显示不可用。

`test:native-clipboard` 编译并启动真实 Win32/OLE 测试应用，创建只属于测试的新窗口站和桌面。测试启动器使用新的本机登录标识，但保留当前用户的本机权限；不创建账户、不加载配置文件、不使用网络凭据，不读写交互桌面的剪贴板。测试涵盖方向限制、格式枚举、错误进程身份、UTF-8 大小、敏感文本、畸形数据、二进制格式、OLE 缓存对象与 `GetDataHere`、混合格式、延迟渲染、自动扫描、会话锁定、控制重载和显式停用。Node 测试使用模拟原生适配器验证持久归属与异常处理；浏览器测试验证实际服务配置类的保存和失败状态。其他 Windows 版本及商业图形应用仍需独立兼容性验证。

MinHook 固定为官方 1.3.4、提交 `c3fcafdc10146beb5919319d0683e44e3c30d537`。源码保留原许可与逐文件来源摘要，构建拒绝不匹配源码。许可随运行包分发。

接口行为依据微软的 [剪贴板操作](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-operations)、[OLE 剪贴板读取](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-olegetclipboard) 和 [GetDataHere](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-idataobject-getdatahere) 文档实现。测试隔离遵循 [窗口站创建](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createwindowstationw) 与 [CreateProcessWithLogonW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createprocesswithlogonw) 的本机权限和登录语义；钩子库来源为 [MinHook 官方仓库](https://github.com/TsudaKageyu/minhook)。
