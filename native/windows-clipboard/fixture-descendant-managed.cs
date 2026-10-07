/**
 * 模块职责（中文）：离线 CLR 祖先的类型初始化器先核验策略和私有 station，再经普通无 shell Process.Start 创建 EXE；Main 只汇报初始证据和等待私有控制。
 * Module responsibilities (English): An offline CLR ancestor verifies policy/private station in its type initializer before ordinary shell-free Process.Start; Main reports initial evidence and waits for private control.
 */
/** 离线 CLR 后代夹具：类型初始化器通过普通 System.Diagnostics 路径创建另一 EXE，验证 Main 前的受控创建。 */
// Owned CLR ancestor: its type initializer creates a different EXE through the
// ordinary System.Diagnostics CreateProcess path, before Main begins.
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
class SakuraDescendantManaged {
  /** 中文：按给定名称、继承标志和权限打开 window station，返回需按生命周期保留的句柄；失败为空并提供 Win32 错误。 English: Open a named window station with supplied inheritance/access flags, returning a handle retained for its lifecycle or null with Win32 error. 参数声明 / Declared parameters: string name,bool inherit,uint access. */
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenWindowStation(string name,bool inherit,uint access);
  /** 中文：将当前进程绑定指定 station，夹具先确认非交互来源再调用；布尔值报告 API 成功。 English: Bind this process to the supplied station after fixture verification of noninteractive provenance; a boolean reports API success. 参数声明 / Declared parameters: IntPtr station. */
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetProcessWindowStation(IntPtr station);
  /** 中文：按精确命名与权限取得策略共享段句柄，失败为空，成功需最终 CloseHandle。 English: Acquire a policy-section handle by exact name/access, returning null on failure and requiring eventual CloseHandle on success. 参数声明 / Declared parameters: uint access,bool inherit,string name. */
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr OpenFileMapping(uint access,bool inherit,string name);
  /** 中文：按段句柄、偏移与长度映射内存，返回需 UnmapViewOfFile 的地址；空地址表示失败。 English: Map a section by handle/offset/length, returning an address requiring UnmapViewOfFile or null on failure. 参数声明 / Declared parameters: IntPtr section,uint access,uint high,uint low,UIntPtr length. */
  [DllImport("kernel32.dll")] static extern IntPtr MapViewOfFile(IntPtr section,uint access,uint high,uint low,UIntPtr length);
  /** 中文：读取精确进程句柄的创建/退出时间和 CPU 时间，输出参数仅在成功时用于身份核验。 English: Read creation/exit/CPU times from an exact process handle, using outputs for identity validation only on success. 参数声明 / Declared parameters: IntPtr process,out long created,out long exited,out long kernel,out long user. */
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
  /** 中文：解除本进程的映射地址，释放视图但不关闭共享段句柄，布尔值报告成功。 English: Unmap this process's view without closing its section handle; a boolean reports success. 参数声明 / Declared parameters: IntPtr value. */
  [DllImport("kernel32.dll")] static extern bool UnmapViewOfFile(IntPtr value);
  /** 中文：关闭所持有的内核句柄，不用于释放映射地址或伪句柄；布尔值报告结果。 English: Close an owned kernel handle rather than a mapped address/pseudo-handle, returning API success. 参数声明 / Declared parameters: IntPtr value. */
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr value);
  static Process child; static bool initializerReady;
  /** 中文：从真实命令行按固定前缀取得夹具参数，缺少则抛错避免选用默认交互资源。 English: Get fixture arguments by exact prefix from the command line, throwing on absence to avoid default interactive resources. 参数声明 / Declared parameters: string prefix. */
  static string Arg(string prefix) {foreach(string value in Environment.GetCommandLineArgs())if(value.StartsWith(prefix,StringComparison.Ordinal))return value.Substring(prefix.Length);throw new Exception("owned argument missing");}
  /** 中文：按 CRT 引号/反斜杠规则编码单个子 argv，包括空值与末尾反斜杠。 English: Encode one child argv with CRT quote/backslash rules, including empty values and trailing slashes. 参数声明 / Declared parameters: string text. */
  static string Quote(string text) {
    StringBuilder answer=new StringBuilder("\"");int slashes=0;
    foreach(char value in text){if(value=='\\'){++slashes;continue;}answer.Append('\\',value=='"'?slashes*2+1:slashes);slashes=0;answer.Append(value);}
    answer.Append('\\',slashes*2);return answer.Append('"').ToString();
  }
  /** 中文：用当前 PID/创建时间及 owner 打开共享策略，检查活动和就绪状态，finally 关闭段与视图。 English: Open shared policy by PID/creation time/owner, check active/readiness and close section/view in finally. */
  static bool Ready() {
    var current=Process.GetCurrentProcess();long created,exited,kernel,user;
    if(!GetProcessTimes(current.Handle,out created,out exited,out kernel,out user))throw new Exception("owned creation unavailable");
    IntPtr section=OpenFileMapping(4,false,"Local\\SakuraClipboard."+Arg("--descendant-owner=")+"."+current.Id+"."+created);
    IntPtr view=section==IntPtr.Zero?IntPtr.Zero:MapViewOfFile(section,4,0,0,(UIntPtr)128);
    try {return view!=IntPtr.Zero && Marshal.ReadInt32(view,12)==1 && Marshal.ReadInt32(view,28)==1 && Marshal.ReadInt64(view,32)==created;}
    finally {if(view!=IntPtr.Zero)UnmapViewOfFile(view);if(section!=IntPtr.Zero)CloseHandle(section);}
  }
  /** 中文：Main 前类型初始化先检查祖先策略并选择私有 station，再用无 shell 的 Process.Start 创建指定子 EXE；任何前置失败抛错。 English: Before Main, verify ancestor policy/select a private station then start the chosen child EXE without a shell; throw on any prerequisite failure. */
  static SakuraDescendantManaged() {
    initializerReady=Ready();if(!initializerReady)throw new Exception("ancestor initializer policy missing");
    string station=Arg("--descendant-station=");if(station.Equals("WinSta0",StringComparison.OrdinalIgnoreCase))throw new Exception("private station required");
    IntPtr privateStation=OpenWindowStation(station,false,0x37f);
    if(privateStation==IntPtr.Zero || !SetProcessWindowStation(privateStation))throw new Exception("owned private station unavailable");
    string arguments=Quote("--early-station="+station)+" "+Quote("--early-owner="+Arg("--descendant-owner="))+" "+
      Quote("--early-pipe="+Arg("--spawn-pipe="))+" "+Quote("--early-marker="+Arg("--spawn-marker="));
    child=Process.Start(new ProcessStartInfo(Arg("--spawn-child="),arguments){UseShellExecute=false,CreateNoWindow=true});
    if(child==null)throw new Exception("owned child did not start");
  }
  /** 中文：通过有界连接的私有管道报告初始化创建的子身份和当前策略，并等待 exit 命令，using 释放通道与读写器。 English: Report initializer-created child identity/current policy over a boundedly connected private pipe, wait for exit and dispose channel/readers/writers with using. */
  static int Main() {
    long created,exited,kernel,user;GetProcessTimes(child.Handle,out created,out exited,out kernel,out user);
    using(var pipe=new NamedPipeClientStream(".",Arg("--descendant-pipe=").Substring(9),PipeDirection.InOut)){
      pipe.Connect(10000);using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true))using(var reader=new StreamReader(pipe,new UTF8Encoding(false),false,4096,true)){
        writer.AutoFlush=true;writer.WriteLine(new JavaScriptSerializer().Serialize(new {pid=Process.GetCurrentProcess().Id,initializerReady,entryReady=Ready(),
          initial=new {started=true,pid=child.Id,created=created.ToString(),error=0},bits=IntPtr.Size*8}));
        return reader.ReadLine()=="exit"?0:7;
      }
    }
  }
}
