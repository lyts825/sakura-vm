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
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenWindowStation(string name,bool inherit,uint access);
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetProcessWindowStation(IntPtr station);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr OpenFileMapping(uint access,bool inherit,string name);
  [DllImport("kernel32.dll")] static extern IntPtr MapViewOfFile(IntPtr section,uint access,uint high,uint low,UIntPtr length);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
  [DllImport("kernel32.dll")] static extern bool UnmapViewOfFile(IntPtr value);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr value);
  static Process child; static bool initializerReady;
  static string Arg(string prefix) {foreach(string value in Environment.GetCommandLineArgs())if(value.StartsWith(prefix,StringComparison.Ordinal))return value.Substring(prefix.Length);throw new Exception("owned argument missing");}
  static string Quote(string text) {
    StringBuilder answer=new StringBuilder("\"");int slashes=0;
    foreach(char value in text){if(value=='\\'){++slashes;continue;}answer.Append('\\',value=='"'?slashes*2+1:slashes);slashes=0;answer.Append(value);}
    answer.Append('\\',slashes*2);return answer.Append('"').ToString();
  }
  static bool Ready() {
    var current=Process.GetCurrentProcess();long created,exited,kernel,user;
    if(!GetProcessTimes(current.Handle,out created,out exited,out kernel,out user))throw new Exception("owned creation unavailable");
    IntPtr section=OpenFileMapping(4,false,"Local\\SakuraClipboard."+Arg("--descendant-owner=")+"."+current.Id+"."+created);
    IntPtr view=section==IntPtr.Zero?IntPtr.Zero:MapViewOfFile(section,4,0,0,(UIntPtr)128);
    try {return view!=IntPtr.Zero && Marshal.ReadInt32(view,12)==1 && Marshal.ReadInt32(view,28)==1 && Marshal.ReadInt64(view,32)==created;}
    finally {if(view!=IntPtr.Zero)UnmapViewOfFile(view);if(section!=IntPtr.Zero)CloseHandle(section);}
  }
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
