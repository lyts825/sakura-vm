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
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenWindowStation(string name, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetProcessWindowStation(IntPtr station);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder name, int length, out int needed);
  [DllImport("user32.dll", SetLastError=true)] static extern bool OpenClipboard(IntPtr window);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr GetClipboardData(uint format);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetClipboardData(uint format, IntPtr value);
  [DllImport("ole32.dll")] static extern int OleGetClipboard(out IntPtr value);
  [DllImport("ole32.dll")] static extern int OleSetClipboard(IntPtr value);
  [DllImport("ole32.dll")] static extern int OleInitialize(IntPtr reserved);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenFileMapping(uint access, bool inherit, string name);
  [DllImport("kernel32.dll")] static extern IntPtr MapViewOfFile(IntPtr section, uint access, uint high, uint low, UIntPtr length);
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("kernel32.dll")] static extern bool UnmapViewOfFile(IntPtr view);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static readonly List<object> phases = new List<object>();
  static string stationName, owner, pipe; static IntPtr station;
  static string argument(string prefix) {
    foreach(string value in Environment.GetCommandLineArgs()) if(value.StartsWith(prefix, StringComparison.Ordinal))return value.Substring(prefix.Length);
    throw new Exception("missing owned argument");
  }
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
