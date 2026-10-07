/**
 * 模块职责（中文）：离线 CLR 类型初始化及 Main 探针先确认私有 station 与精确策略，再要求 Win32/OLE 均拒绝复制粘贴，私有管道输出阶段证据。
 * Module responsibilities (English): Offline CLR type-initializer/Main probes first confirm private station/exact policy, require Win32/OLE copy-paste refusal and report phase evidence over a private pipe.
 */
/** 离线 CLR 早期剪贴板夹具，独立选择非交互 window station 后才调用 API 并记录初始化证据。 */
// Owned, offline CLR fixture. Clipboard calls begin only after independently
// selecting a non-interactive station; no interactive clipboard is inspected.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

class SakuraManagedEarly {
  /** 中文：按给定名称、继承标志和权限打开 window station，返回需按生命周期保留的句柄；失败为空并提供 Win32 错误。 English: Open a named window station with supplied inheritance/access flags, returning a handle retained for its lifecycle or null with Win32 error. 参数声明 / Declared parameters: string name, bool inherit, uint access. */
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenWindowStation(string name, bool inherit, uint access);
  /** 中文：将当前进程绑定指定 station，夹具先确认非交互来源再调用；布尔值报告 API 成功。 English: Bind this process to the supplied station after fixture verification of noninteractive provenance; a boolean reports API success. 参数声明 / Declared parameters: IntPtr station. */
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetProcessWindowStation(IntPtr station);
  /** 中文：向有界缓冲区读取 station 名称等用户对象信息，输出所需容量，夹具据此确认私有 station。 English: Read user-object information such as station name into bounded storage, report required size and support private-station verification. 参数声明 / Declared parameters: IntPtr handle, int index, StringBuilder name, int length, out int needed. */
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder name, int length, out int needed);
  /** 中文：以指定拥有者打开当前 station 的剪贴板，成功后必须配对 CloseClipboard。 English: Open the current station's clipboard for the supplied owner, requiring CloseClipboard after success. 参数声明 / Declared parameters: IntPtr window. */
  [DllImport("user32.dll", SetLastError=true)] static extern bool OpenClipboard(IntPtr window);
  /** 中文：释放当前调用者打开的剪贴板锁，保持它与 OpenClipboard 的配对关系。 English: Release the clipboard lock opened by this caller, pairing it with OpenClipboard. */
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  /** 中文：读取指定格式的剪贴板句柄，句柄由系统拥有不可由夹具释放，失败返回空。 English: Read a format's clipboard handle, owned by the system rather than freed by fixtures; null denotes failure. 参数声明 / Declared parameters: uint format. */
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr GetClipboardData(uint format);
  /** 中文：交付指定格式的数据句柄或延迟渲染空占位，只有成功后系统取得数据所有权。 English: Supply a format's data handle or delayed-render null placeholder, transferring data ownership to the system only on success. 参数声明 / Declared parameters: uint format, IntPtr value. */
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetClipboardData(uint format, IntPtr value);
  /** 中文：返回当前剪贴板 IDataObject 指针与 HRESULT，成功所得 COM 引用需释放。 English: Return the current clipboard IDataObject pointer/HRESULT, requiring release of a successful COM reference. 参数声明 / Declared parameters: out IntPtr value. */
  [DllImport("ole32.dll")] static extern int OleGetClipboard(out IntPtr value);
  /** 中文：将对象或空值交给 OLE 设置剪贴板，按 HRESULT 判断结果，调用方仍平衡自己的 COM 引用。 English: Set OLE clipboard to an object/null and judge by HRESULT while callers still balance their own COM references. 参数声明 / Declared parameters: IntPtr value. */
  [DllImport("ole32.dll")] static extern int OleSetClipboard(IntPtr value);
  /** 中文：为当前线程初始化 OLE，返回 HRESULT；夹具在 STA 中调用后才使用 OLE 接口。 English: Initialize OLE for the current thread and return HRESULT before fixture OLE access on STA. 参数声明 / Declared parameters: IntPtr reserved. */
  [DllImport("ole32.dll")] static extern int OleInitialize(IntPtr reserved);
  /** 中文：按精确命名与权限取得策略共享段句柄，失败为空，成功需最终 CloseHandle。 English: Acquire a policy-section handle by exact name/access, returning null on failure and requiring eventual CloseHandle on success. 参数声明 / Declared parameters: uint access, bool inherit, string name. */
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenFileMapping(uint access, bool inherit, string name);
  /** 中文：按段句柄、偏移与长度映射内存，返回需 UnmapViewOfFile 的地址；空地址表示失败。 English: Map a section by handle/offset/length, returning an address requiring UnmapViewOfFile or null on failure. 参数声明 / Declared parameters: IntPtr section, uint access, uint high, uint low, UIntPtr length. */
  [DllImport("kernel32.dll")] static extern IntPtr MapViewOfFile(IntPtr section, uint access, uint high, uint low, UIntPtr length);
  /** 中文：返回当前进程 PID，与创建时间合用形成夹具身份。 English: Return this process's PID, paired with creation time for fixture identity. */
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
  /** 中文：返回当前原生线程 ID，用于 GUI 消息投递和同线程来源证据。 English: Return the native thread ID for GUI message delivery and same-thread provenance evidence. */
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  /** 中文：取得当前进程伪句柄用于身份查询，调用者不关闭该伪句柄。 English: Obtain the current-process pseudo-handle for identity queries without closing it. */
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  /** 中文：读取精确进程句柄的创建/退出时间和 CPU 时间，输出参数仅在成功时用于身份核验。 English: Read creation/exit/CPU times from an exact process handle, using outputs for identity validation only on success. 参数声明 / Declared parameters: IntPtr process, out long created, out long exited, out long kernel, out long user. */
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  /** 中文：查询已经加载的模块而不增加引用计数，用于策略存在性和运行时证据。 English: Query an already-loaded module without increasing references for policy-presence/runtime evidence. 参数声明 / Declared parameters: string name. */
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  /** 中文：解除本进程的映射地址，释放视图但不关闭共享段句柄，布尔值报告成功。 English: Unmap this process's view without closing its section handle; a boolean reports success. 参数声明 / Declared parameters: IntPtr view. */
  [DllImport("kernel32.dll")] static extern bool UnmapViewOfFile(IntPtr view);
  /** 中文：关闭所持有的内核句柄，不用于释放映射地址或伪句柄；布尔值报告结果。 English: Close an owned kernel handle rather than a mapped address/pseudo-handle, returning API success. 参数声明 / Declared parameters: IntPtr handle. */
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static readonly List<object> phases = new List<object>();
  static string stationName, owner, pipe; static IntPtr station;
  /** 中文：从命令行取得固定前缀参数，缺失抛错，避免任何隐式交互 station 回退。 English: Read a fixed-prefix command-line argument and throw on absence, preventing implicit interactive-station fallback. 参数声明 / Declared parameters: string prefix. */
  static string argument(string prefix) {
    foreach(string value in Environment.GetCommandLineArgs()) if(value.StartsWith(prefix, StringComparison.Ordinal))return value.Substring(prefix.Length);
    throw new Exception("missing owned argument");
  }
  /** 中文：类型初始化先创建入口 marker、选择并核验私有 station，再执行最早 CLR 剪贴板探针，失败中止初始化。 English: Create an entry marker/select and verify a private station in the type initializer before the earliest CLR clipboard probe, aborting initialization on failure. */
  static SakuraManagedEarly() {
    string marker = argument("--marker=");
    using(File.Create(marker)) {}
    stationName = argument("--station="); owner = argument("--owner="); pipe = argument("--pipe=");
    if(stationName.Length==0 || stationName.Equals("WinSta0", StringComparison.OrdinalIgnoreCase))throw new Exception("private station required");
    station=OpenWindowStation(stationName,false,0x37f);
    if(station==IntPtr.Zero || !SetProcessWindowStation(station))throw new Exception("private station unavailable");
    StringBuilder actual=new StringBuilder(256);int needed;
    if(!GetUserObjectInformation(station,2,actual,512,out needed) || actual.ToString()!=stationName)throw new Exception("private station changed");
    probe("type-initializer");
  }
  /** 中文：核对精确进程策略和敏感禁止规则，再验证 Win32/OLE 均拒绝复制粘贴并记录计数；finally 关闭剪贴板和共享映射。 English: Verify exact-process policy/sensitive-denial rules, test Win32/OLE copy-paste refusals and record counters, with clipboard/mapping cleanup in finally. 参数声明 / Declared parameters: string phase. */
  static void probe(string phase) {
    uint pid=GetCurrentProcessId();long created,exited,kernel,user;
    if(!GetProcessTimes(GetCurrentProcess(),out created,out exited,out kernel,out user))throw new Exception("creation unavailable");
    IntPtr section=OpenFileMapping(4,false,"Local\\SakuraClipboard."+owner+"."+pid+"."+created);
    IntPtr view=section==IntPtr.Zero?IntPtr.Zero:MapViewOfFile(section,4,0,0,(UIntPtr)128);
    if(view==IntPtr.Zero)throw new Exception("early policy missing");
    bool ready=false;uint flags=0;
    try {
      ready=Marshal.ReadInt32(view,0)==0x53434c50 && Marshal.ReadInt32(view,4)==1 &&
        (Marshal.ReadInt32(view,8)&1)==0 && Marshal.ReadInt32(view,12)==1 && Marshal.ReadInt32(view,16)==pid &&
        Marshal.ReadInt32(view,28)==1 && Marshal.ReadInt64(view,32)==created;
      flags=(uint)Marshal.ReadInt32(view,20);
      if(!ready || flags!=8 || GetModuleHandle(IntPtr.Size==8?"SakuraClipboardPolicy.dll":"SakuraClipboardPolicy-x86.dll")==IntPtr.Zero)
        throw new Exception("early policy not ready");
      if(!OpenClipboard(IntPtr.Zero))throw new Exception("private clipboard unavailable");
      int copyError,pasteError;
      try {
        IntPtr read=GetClipboardData(13);pasteError=Marshal.GetLastWin32Error();
        IntPtr written=SetClipboardData(13,IntPtr.Zero);copyError=Marshal.GetLastWin32Error();
        if(read!=IntPtr.Zero || written!=IntPtr.Zero || pasteError!=5 || copyError!=5)throw new Exception("Win32 policy bypass");
      } finally { CloseClipboard(); }
      int initialized=OleInitialize(IntPtr.Zero);if(initialized<0)throw new Exception("OLE initialization failed");
      IntPtr data;int olePaste=OleGetClipboard(out data),oleCopy=OleSetClipboard(IntPtr.Zero);
      if(data!=IntPtr.Zero || olePaste!=unchecked((int)0x80070005) || oleCopy!=unchecked((int)0x80070005))throw new Exception("OLE policy bypass");
      phases.Add(new {phase,pid,created=created.ToString(),bits=IntPtr.Size*8,thread=GetCurrentThreadId(),ready,flags,
        privateStation=true,copyError,pasteError,oleCopy=unchecked((uint)oleCopy),olePaste=unchecked((uint)olePaste),
        copies=Marshal.ReadInt64(view,40),pastes=Marshal.ReadInt64(view,48)});
    } finally {UnmapViewOfFile(view);CloseHandle(section);}
  }
  /** 中文：追加 Main 阶段探针，经有界连接管道输出所有阶段及 CLR 版本，等待 exit，using 释放通道。 English: Append the Main-stage probe, report phases/CLR version over a boundedly connected pipe, wait for exit and dispose the channel with using. */
  [STAThread] static int Main() {
    probe("main");
    using(var channel=new NamedPipeClientStream(".",pipe,PipeDirection.InOut)) {
      channel.Connect(10000);
      using(var writer=new StreamWriter(channel,new UTF8Encoding(false),4096,true))
      using(var reader=new StreamReader(channel,new UTF8Encoding(false),false,4096,true)) {
        writer.AutoFlush=true;writer.WriteLine(new JavaScriptSerializer().Serialize(new {phases,runtime=Environment.Version.ToString()}));
        if(reader.ReadLine()!="exit")return 7;
      }
    }
    return 0;
  }
}
