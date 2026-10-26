// Launches the fixed Python worker inside a capability-free AppContainer and owned Job.
using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Security.Cryptography;

internal static class Program {
  const uint EXTENDED_STARTUPINFO_PRESENT=0x00080000, CREATE_SUSPENDED=4, CREATE_NO_WINDOW=0x08000000;
  const uint STARTF_USESTDHANDLES=0x100, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE=0x2000, JOB_OBJECT_LIMIT_JOB_MEMORY=0x200, JOB_OBJECT_LIMIT_ACTIVE_PROCESS=8;
  const uint GENERIC_READ=0x80000000, GENERIC_WRITE=0x40000000, FILE_SHARE_READ=1, FILE_SHARE_WRITE=2, OPEN_EXISTING=3, CREATE_ALWAYS=2;
  static IntPtr Job=IntPtr.Zero;
  static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int length; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr sid; public IntPtr capabilities; public int count; public int reserved; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string reserved,desktop,title; public int x,y,xSize,ySize,xCountChars,yCountChars,fillAttribute,flags; public short showWindow,reserved2; public IntPtr reservedPtr,stdInput,stdOutput,stdError; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO startup; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public uint processId,threadId; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking; public uint activeProcesses; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong rOps,wOps,oOps,rBytes,wBytes,oBytes; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long user,kernel,periodUser,periodKernel; public uint faults,total,active,terminated; }
  [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr caps,uint count,out IntPtr sid);
  [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attr,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref STARTUPINFOEX startup,out PROCESS_INFORMATION info);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFileW(string name,uint access,uint share,ref SECURITY_ATTRIBUTES security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,IntPtr data,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int cls,out ACCOUNTING info,uint size,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenJobObjectW(uint access,bool inherit,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
  [DllImport("userenv.dll",CharSet=CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name,out IntPtr sid);
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct PROCESS_ENTRY { public uint size,usage,pid; public UIntPtr heap; public uint module,threads,parent; public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string name; }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32FirstW(IntPtr snapshot,ref PROCESS_ENTRY entry);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32NextW(IntPtr snapshot,ref PROCESS_ENTRY entry);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl,uint revision,out IntPtr descriptor,out uint size);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetSecurityDescriptorSacl(IntPtr descriptor,out bool present,out IntPtr sacl,out bool defaulted);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern uint SetNamedSecurityInfoW(string name,int type,uint info,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int cls,out int value,int length,out int returned);

  static void Check(bool ok,string code) { if(!ok) {int error=Marshal.GetLastWin32Error();throw new Win32Exception(error,code+" win32="+error); } }
  static void Canonical(string path) {
    if(Path.GetFullPath(path)!=path) throw new Exception("SANDBOX_PATH_CANONICAL");
    for(string current=path;!String.IsNullOrEmpty(current);current=Path.GetDirectoryName(current)) {
      if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0) throw new Exception("SANDBOX_REPARSE_POINT");
    }
  }
  static void Access(string path,SecurityIdentifier sid,FileSystemRights rights,bool add) {
    var acl=Directory.GetAccessControl(path);
    var rule=new FileSystemAccessRule(sid,rights,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow);
    if(add) acl.AddAccessRule(rule); else acl.RemoveAccessRuleSpecific(rule);
    Directory.SetAccessControl(path,acl);
  }
  static IntPtr FileHandle(string path,uint access,uint disposition) {
    var sa=new SECURITY_ATTRIBUTES {length=Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)),inherit=1};
    var handle=CreateFileW(path,access,FILE_SHARE_READ|FILE_SHARE_WRITE,ref sa,disposition,0x80,IntPtr.Zero);
    if(handle==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error(),"SANDBOX_STREAM");return handle;
  }
  static string Hash(byte[] data){using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(data)).Replace("-","").ToLowerInvariant();}
  static string ProfileName(string working){return "SakuraCreation-"+Hash(Encoding.UTF8.GetBytes(working.ToLowerInvariant())).Substring(0,32);}
  static string ReceiptPath(string working){return working+".receipt.json";}
  static string Creation(IntPtr process){long c,e,k,u;Check(GetProcessTimes(process,out c,out e,out k,out u),"SANDBOX_PROCESS_TIME");return c.ToString(System.Globalization.CultureInfo.InvariantCulture);}
  static uint ParentPid(){var snapshot=CreateToolhelp32Snapshot(2,0);if(snapshot==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());try{var entry=new PROCESS_ENTRY();entry.size=(uint)Marshal.SizeOf(typeof(PROCESS_ENTRY));if(Process32FirstW(snapshot,ref entry))do{if(entry.pid==(uint)Process.GetCurrentProcess().Id)return entry.parent;}while(Process32NextW(snapshot,ref entry));throw new Exception("SANDBOX_PARENT_IDENTITY");}finally{CloseHandle(snapshot);}}
  static void ProtectedWrite(string path,Dictionary<string,object> data){
    var identity=WindowsIdentity.GetCurrent().User;var security=new FileSecurity();security.SetOwner(identity);security.SetAccessRuleProtection(true,false);
    foreach(var sid in new SecurityIdentifier[]{identity,new SecurityIdentifier("S-1-5-18"),new SecurityIdentifier("S-1-5-32-544")})security.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,AccessControlType.Allow));
    string temporary=path+"."+Guid.NewGuid().ToString("N")+".tmp";
    using(var stream=new FileStream(temporary,FileMode.CreateNew,FileSystemRights.Write,FileShare.None,4096,FileOptions.WriteThrough,security)){byte[] bytes=Encoding.UTF8.GetBytes(Json.Serialize(data));stream.Write(bytes,0,bytes.Length);stream.Flush(true);}
    if(File.Exists(path))File.Replace(temporary,path,null);else File.Move(temporary,path);
  }
  static Dictionary<string,object> ProtectedRead(string path){
    var info=new FileInfo(path);if(!info.Exists||info.Length>65536||(info.Attributes&FileAttributes.ReparsePoint)!=0)throw new Exception("SANDBOX_RECEIPT_IDENTITY");var security=File.GetAccessControl(path);string user=WindowsIdentity.GetCurrent().User.Value;
    var allowed=new HashSet<string>(new string[]{user,"S-1-5-18","S-1-5-32-544"});if(!allowed.Contains(security.GetOwner(typeof(SecurityIdentifier)).Value))throw new Exception("SANDBOX_RECEIPT_OWNER");
    foreach(FileSystemAccessRule rule in security.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(rule.AccessControlType==AccessControlType.Allow&&!allowed.Contains(rule.IdentityReference.Value)&&(rule.FileSystemRights&(FileSystemRights.Write|FileSystemRights.Delete|FileSystemRights.ChangePermissions|FileSystemRights.TakeOwnership))!=0)throw new Exception("SANDBOX_RECEIPT_WRITABLE");
    return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path,Encoding.UTF8));
  }
  static bool OriginalAlive(uint pid,string created,bool terminate){
    if(pid==0)return false;var process=OpenProcess(0x1000|0x100000|(terminate?1u:0u),false,pid);if(process==IntPtr.Zero){int code=Marshal.GetLastWin32Error();if(code==87)return false;throw new Win32Exception(code,"SANDBOX_ORIGINAL_PROCESS_QUERY");}
    try{if(Creation(process)!=created)return false;if(WaitForSingleObject(process,0)==0)return false;if(terminate){Check(TerminateProcess(process,126),"SANDBOX_ORIGINAL_TERMINATE");if(WaitForSingleObject(process,5000)!=0)throw new Exception("SANDBOX_ORIGINAL_EXIT_PENDING");return false;}return true;}finally{CloseHandle(process);}
  }
  static int Reconcile(string runtime,string working){
    Canonical(working);var receipt=ProtectedRead(ReceiptPath(working));if(Convert.ToString(receipt["working"])!=working||Convert.ToString(receipt["runtime"])!=runtime||Convert.ToString(receipt["profile"])!=ProfileName(working))throw new Exception("SANDBOX_RECEIPT_BINDING");
    string profile=Convert.ToString(receipt["profile"]),jobName="Local\\"+profile;if(Convert.ToString(receipt["jobName"])!=jobName)throw new Exception("SANDBOX_JOB_BINDING");
    var job=OpenJobObjectW(0x0004|0x0008,false,jobName);try{
      OriginalAlive(Convert.ToUInt32(receipt["helperPid"]),Convert.ToString(receipt["helperCreated"]),true);
      if(job!=IntPtr.Zero){Check(TerminateJobObject(job,126),"SANDBOX_RECOVERY_TERMINATE");ACCOUNTING accounting=new ACCOUNTING();DateTime deadline=DateTime.UtcNow.AddSeconds(5);do{Check(QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero),"SANDBOX_RECOVERY_ACCOUNTING");if(accounting.active==0)break;Thread.Sleep(10);}while(DateTime.UtcNow<deadline);if(accounting.active!=0)throw new Exception("SANDBOX_CLEANUP_PENDING");}
      if(receipt.ContainsKey("nativeOwnerPid")&&Convert.ToUInt32(receipt["nativeOwnerPid"])>0)OriginalAlive(Convert.ToUInt32(receipt["nativeOwnerPid"]),Convert.ToString(receipt["nativeOwnerCreated"]),true);
      if(receipt.ContainsKey("childPid")&&Convert.ToUInt32(receipt["childPid"])>0&&OriginalAlive(Convert.ToUInt32(receipt["childPid"]),Convert.ToString(receipt["childCreated"]),false))throw new Exception("SANDBOX_CHILD_EXIT_PENDING");
      IntPtr sid;int result=DeriveAppContainerSidFromAppContainerName(profile,out sid);if(result==0){try{var identity=new SecurityIdentifier(sid);if(Directory.Exists(runtime))Access(runtime,identity,FileSystemRights.ReadAndExecute,false);if(Directory.Exists(working))Access(working,identity,FileSystemRights.Modify,false);}finally{FreeSid(sid);}}
      int deleted=DeleteAppContainerProfile(profile);if(deleted!=0&&deleted!=unchecked((int)0x80070002))Marshal.ThrowExceptionForHR(deleted);
      receipt["cleanup"]="confirmed";receipt["reconciled"]=true;if(Convert.ToString(receipt["status"])!="completed"&&Convert.ToString(receipt["status"])!="failed")receipt["status"]="cancelled";ProtectedWrite(ReceiptPath(working),receipt);
      Console.WriteLine(Json.Serialize(new {ok=true,result=new {cleanup="confirmed",status=receipt["status"]}}));return 0;
    }finally{if(job!=IntPtr.Zero)CloseHandle(job);}
  }
  static void SetJobLimits() {
    var limits=new EXTENDED_LIMIT();
    limits.basic.flags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|JOB_OBJECT_LIMIT_JOB_MEMORY|JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    limits.basic.activeProcesses=3;limits.jobMemory=new UIntPtr(1024UL*1024*1024);
    var size=Marshal.SizeOf(typeof(EXTENDED_LIMIT));var memory=Marshal.AllocHGlobal(size);
    try {Marshal.StructureToPtr(limits,memory,false);Check(SetInformationJobObject(Job,9,memory,(uint)size),"SANDBOX_JOB_LIMIT");} finally {Marshal.FreeHGlobal(memory);}
  }
  static int Main(string[] args) {
    if(args.Length==3&&args[0]=="--reconcile"){try{return Reconcile(Path.GetFullPath(args[1]),Path.GetFullPath(args[2]));}catch(Exception error){Console.Error.WriteLine(error.ToString());return 1;}}
    bool guarded=args.Length==4&&args[0]=="--guard";if(guarded)args=new string[]{args[1],args[2],args[3]};
    IntPtr sid=IntPtr.Zero,attributeList=IntPtr.Zero,capabilitiesMemory=IntPtr.Zero,handlesMemory=IntPtr.Zero,jobsMemory=IntPtr.Zero,environment=IntPtr.Zero;
    IntPtr stdin=IntPtr.Zero,stdout=IntPtr.Zero,stderr=IntPtr.Zero;PROCESS_INFORMATION process=new PROCESS_INFORMATION();
    SecurityIdentifier identity=null;string profile=null,runtime=null,working=null;bool runtimeAcl=false,workingAcl=false,assigned=false;
    Dictionary<string,object> receipt=null;
    try {
      if(args.Length!=3)throw new Exception("SANDBOX_ARGUMENTS");runtime=Path.GetFullPath(args[0]);working=Path.GetFullPath(args[1]);
      Canonical(runtime);Canonical(working);if(runtime==working||working.StartsWith(runtime+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||runtime.StartsWith(working+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("SANDBOX_DIRECTORY_OVERLAP");
      int timeout=int.Parse(args[2]);if(timeout<100||timeout>120000)throw new Exception("SANDBOX_DEADLINE");
      string executable=Path.Combine(runtime,"python.exe"),worker=Path.Combine(runtime,"seventh-creation-native-worker.py");
      if(!File.Exists(executable)||!File.Exists(worker))throw new Exception("SANDBOX_TOOL_MISSING");
      byte[] request;
      using(var input=Console.OpenStandardInput())using(var buffer=new MemoryStream()) {
        byte[] chunk=new byte[65536];int count;
        while((count=input.Read(chunk,0,chunk.Length))>0){buffer.Write(chunk,0,count);if(buffer.Length>16*1024*1024)throw new Exception("SANDBOX_INPUT_LIMIT");}request=buffer.ToArray();
      }
      profile=ProfileName(working);
      // Persist original actor identity before creating any profile, ACL grant or Job.
      string jobName="Local\\"+profile;
      receipt=new Dictionary<string,object>{{"schemaVersion",1},{"runtime",runtime},{"working",working},{"profile",profile},{"jobName",jobName},{"helperPid",Process.GetCurrentProcess().Id},{"helperCreated",Creation(Process.GetCurrentProcess().Handle)},{"status","preparing"},{"cleanup","pending"},{"guarded",guarded},{"childPid",0}};
      if(guarded){uint parent=ParentPid();using(var owner=Process.GetProcessById((int)parent)){if(!String.Equals(owner.ProcessName,"posixloom",StringComparison.OrdinalIgnoreCase))throw new Exception("SANDBOX_NATIVE_OWNER_IDENTITY");receipt["nativeOwnerPid"]=parent;receipt["nativeOwnerCreated"]=Creation(owner.Handle);}}
      ProtectedWrite(ReceiptPath(working),receipt);
      int hr=CreateAppContainerProfile(profile,profile,"Fixed creation tools with no network capabilities",IntPtr.Zero,0,out sid);
      if(hr!=0)Marshal.ThrowExceptionForHR(hr);
      identity=new SecurityIdentifier(sid);
      Access(runtime,identity,FileSystemRights.ReadAndExecute,true);runtimeAcl=true;
      Access(working,identity,FileSystemRights.Modify,true);workingAcl=true;
      // The AppContainer has low integrity; permit writes only to this owned workspace.
      IntPtr label;uint labelSize;Check(ConvertStringSecurityDescriptorToSecurityDescriptorW("S:(ML;OICI;NW;;;LW)",1,out label,out labelSize),"SANDBOX_LABEL");
      try {bool present,defaulted;IntPtr sacl;Check(GetSecurityDescriptorSacl(label,out present,out sacl,out defaulted),"SANDBOX_LABEL_READ");uint labelResult=SetNamedSecurityInfoW(working,1,0x10,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,sacl);if(labelResult!=0)throw new Win32Exception((int)labelResult,"SANDBOX_LABEL_SET");}finally{LocalFree(label);}
      Job=CreateJobObject(IntPtr.Zero,jobName);Check(Job!=IntPtr.Zero,"SANDBOX_JOB_CREATE");if(Marshal.GetLastWin32Error()==183)throw new Exception("SANDBOX_JOB_ALREADY_EXISTS");SetJobLimits();receipt["status"]="prepared";
      ProtectedWrite(ReceiptPath(working),receipt);
      if(guarded){DateTime readyDeadline=DateTime.UtcNow.AddSeconds(10);string start=working+".start.json";while(!File.Exists(start)){if(File.Exists(Path.Combine(working,"cancel.request")))throw new Exception("NATIVE_CANCELLED");if(DateTime.UtcNow>=readyDeadline)throw new Exception("NATIVE_PREPARE_EXPIRED");Thread.Sleep(10);}if(new FileInfo(start).Length>16*1024*1024)throw new Exception("NATIVE_INPUT_LIMIT");request=File.ReadAllBytes(start);}
      File.WriteAllBytes(Path.Combine(working,"input.json"),request);receipt["inputDigest"]=Hash(request);ProtectedWrite(ReceiptPath(working),receipt);
      stdin=FileHandle(Path.Combine(working,"input.json"),GENERIC_READ,OPEN_EXISTING);
      stdout=FileHandle(Path.Combine(working,"output.json"),GENERIC_WRITE,CREATE_ALWAYS);
      stderr=FileHandle(Path.Combine(working,"stderr.txt"),GENERIC_WRITE,CREATE_ALWAYS);
      IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,3,0,ref size);attributeList=Marshal.AllocHGlobal(size);
      Check(InitializeProcThreadAttributeList(attributeList,3,0,ref size),"SANDBOX_ATTRIBUTES");
      var capabilities=new SECURITY_CAPABILITIES {sid=sid};capabilitiesMemory=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));Marshal.StructureToPtr(capabilities,capabilitiesMemory,false);
      Check(UpdateProcThreadAttribute(attributeList,0,new IntPtr(0x00020009),capabilitiesMemory,new IntPtr(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES))),IntPtr.Zero,IntPtr.Zero),"SANDBOX_CAPABILITIES");
      handlesMemory=Marshal.AllocHGlobal(IntPtr.Size*3);Marshal.WriteIntPtr(handlesMemory,0,stdin);Marshal.WriteIntPtr(handlesMemory,IntPtr.Size,stdout);Marshal.WriteIntPtr(handlesMemory,IntPtr.Size*2,stderr);
      Check(UpdateProcThreadAttribute(attributeList,0,new IntPtr(0x00020002),handlesMemory,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero),"SANDBOX_HANDLE_LIST");
      jobsMemory=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobsMemory,Job);Check(UpdateProcThreadAttribute(attributeList,0,new IntPtr(0x0002000D),jobsMemory,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"SANDBOX_ATOMIC_JOB_LIST");
      var safeEnvironment=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      foreach(string key in new string[]{"SystemRoot","SystemDrive","USERPROFILE","LOCALAPPDATA","APPDATA","ProgramData","ProgramFiles","windir"}) {string value=Environment.GetEnvironmentVariable(key);if(value!=null)safeEnvironment[key]=value;}
      safeEnvironment["COMSPEC"]=Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"),"System32","cmd.exe");
      safeEnvironment["PATH"]=runtime+";"+Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"),"System32");
      safeEnvironment["OMP_NUM_THREADS"]="1";safeEnvironment["OPENBLAS_NUM_THREADS"]="1";safeEnvironment["MKL_NUM_THREADS"]="1";safeEnvironment["PYTHONDONTWRITEBYTECODE"]="1";safeEnvironment["TEMP"]=working;safeEnvironment["TMP"]=working;
      var block=new StringBuilder();foreach(var entry in safeEnvironment)block.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');block.Append('\0');string environmentBlock=block.ToString();
      environment=Marshal.StringToHGlobalUni(environmentBlock);
      var startup=new STARTUPINFOEX();startup.startup.cb=Marshal.SizeOf(typeof(STARTUPINFOEX));startup.startup.flags=(int)STARTF_USESTDHANDLES;startup.startup.stdInput=stdin;startup.startup.stdOutput=stdout;startup.startup.stdError=stderr;startup.attributes=attributeList;
      string command="\""+executable+"\" -I -B \""+worker+"\"";
      Check(CreateProcessW(executable,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,EXTENDED_STARTUPINFO_PRESENT|CREATE_SUSPENDED|CREATE_NO_WINDOW|0x400,environment,working,ref startup,out process),"SANDBOX_CREATE_PROCESS");
      assigned=true;receipt["childPid"]=process.processId;receipt["childCreated"]=Creation(process.process);receipt["status"]="running";ProtectedWrite(ReceiptPath(working),receipt);
      IntPtr token;Check(OpenProcessToken(process.process,8,out token),"SANDBOX_TOKEN_OPEN");try{int isContainer,returned;Check(GetTokenInformation(token,29,out isContainer,4,out returned),"SANDBOX_TOKEN_QUERY");if(isContainer!=1)throw new Exception("SANDBOX_TOKEN_NOT_APPCONTAINER");}finally{CloseHandle(token);}
      Check(ResumeThread(process.thread)!=0xffffffff,"SANDBOX_RESUME");
      DateTime deadline=DateTime.UtcNow.AddMilliseconds(timeout);bool timedOut=false,overflow=false,cancelled=false;
      while(WaitForSingleObject(process.process,25)==0x102) {
        if(File.Exists(Path.Combine(working,"cancel.request"))){cancelled=true;TerminateJobObject(Job,126);break;}
        if(DateTime.UtcNow>=deadline){timedOut=true;TerminateJobObject(Job,124);break;}
        if(new FileInfo(Path.Combine(working,"output.json")).Length>16*1024*1024||new FileInfo(Path.Combine(working,"stderr.txt")).Length>65536){overflow=true;TerminateJobObject(Job,125);break;}
      }
      WaitForSingleObject(process.process,5000);uint exit;Check(GetExitCodeProcess(process.process,out exit),"SANDBOX_EXIT");
      TerminateJobObject(Job,0);ACCOUNTING accounting=new ACCOUNTING();DateTime cleanup=DateTime.UtcNow.AddSeconds(5);
      do {Check(QueryInformationJobObject(Job,1,out accounting,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero),"SANDBOX_ACCOUNTING");if(accounting.active==0)break;Thread.Sleep(10);}while(DateTime.UtcNow<cleanup);
      if(accounting.active!=0)throw new Exception("SANDBOX_CLEANUP_PENDING");
      CloseHandle(stdout);stdout=IntPtr.Zero;CloseHandle(stderr);stderr=IntPtr.Zero;CloseHandle(stdin);stdin=IntPtr.Zero;
      // A tool can finish between two polls. Recheck final lengths before any managed read.
      if(new FileInfo(Path.Combine(working,"output.json")).Length>16*1024*1024||new FileInfo(Path.Combine(working,"stderr.txt")).Length>65536)overflow=true;
      receipt["cleanup"]="confirmed";receipt["status"]=exit==0?"completed":"failed";receipt["exitCode"]=exit;receipt["outputBytes"]=new FileInfo(Path.Combine(working,"output.json")).Length;if(!overflow)receipt["outputDigest"]=Hash(File.ReadAllBytes(Path.Combine(working,"output.json")));if(timedOut||overflow||cancelled)receipt["errorCode"]=cancelled?"NATIVE_CANCELLED":timedOut?"NATIVE_DEADLINE_EXCEEDED":"NATIVE_OUTPUT_LIMIT";ProtectedWrite(ReceiptPath(working),receipt);
      Console.Error.WriteLine("SANDBOX_RECEIPT appcontainer=true networkCapabilities=0 activeProcesses=0 pid="+process.processId+" exit="+exit);
      if(timedOut||overflow||cancelled){string code=cancelled?"NATIVE_CANCELLED":timedOut?"NATIVE_DEADLINE_EXCEEDED":"NATIVE_OUTPUT_LIMIT";Console.Out.WriteLine("{\"ok\":false,\"code\":\""+code+"\"}");return 124;}
      string output=File.ReadAllText(Path.Combine(working,"output.json"),Encoding.UTF8);
      if(String.IsNullOrWhiteSpace(output))throw new Exception("SANDBOX_EMPTY_OUTPUT "+File.ReadAllText(Path.Combine(working,"stderr.txt"),Encoding.UTF8));
      Console.Out.Write(output);
      return (int)exit;
    } catch(Exception error) {Console.Error.WriteLine(error.ToString());return 1;}
    finally {
      if(process.process!=IntPtr.Zero&&!assigned)TerminateProcess(process.process,1);
      if(Job!=IntPtr.Zero){TerminateJobObject(Job,1);CloseHandle(Job);}if(process.thread!=IntPtr.Zero)CloseHandle(process.thread);if(process.process!=IntPtr.Zero)CloseHandle(process.process);
      if(stdin!=IntPtr.Zero)CloseHandle(stdin);if(stdout!=IntPtr.Zero)CloseHandle(stdout);if(stderr!=IntPtr.Zero)CloseHandle(stderr);
      if(attributeList!=IntPtr.Zero){DeleteProcThreadAttributeList(attributeList);Marshal.FreeHGlobal(attributeList);}if(capabilitiesMemory!=IntPtr.Zero)Marshal.FreeHGlobal(capabilitiesMemory);if(handlesMemory!=IntPtr.Zero)Marshal.FreeHGlobal(handlesMemory);if(jobsMemory!=IntPtr.Zero)Marshal.FreeHGlobal(jobsMemory);if(environment!=IntPtr.Zero)Marshal.FreeHGlobal(environment);
      if(identity!=null){try{if(runtimeAcl)Access(runtime,identity,FileSystemRights.ReadAndExecute,false);}catch{}try{if(workingAcl)Access(working,identity,FileSystemRights.Modify,false);}catch{}}
      if(sid!=IntPtr.Zero)FreeSid(sid);if(profile!=null)DeleteAppContainerProfile(profile);
    }
  }
}
