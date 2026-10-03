$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$r=[Console]::In.ReadLine()|ConvertFrom-Json
$parent='E:\Sakura-verification-6fb9a7f4-3e97-42fa-a3f8-2db21f22ca9c'
$workspace='D:\27247\Desktop\Sakura'
$source=[IO.Path]::Combine($workspace,'.data\linux-clipboard-test-temp\sakura-x11-zXRIm0')
$original=[IO.Path]::Combine($workspace,'.data\images\debian-12.qcow2')
$qemu=[IO.Path]::Combine($workspace,'.tools\qemu\qemu-system-x86_64.exe')
$img=[IO.Path]::Combine($workspace,'.tools\qemu\qemu-img.exe')
if(@($r.PSObject.Properties.Name|Sort-Object) -join ',' -cne 'invocation,newVmId,parentCreationTicks,parentImage,parentPid'){throw 'DESKTOP_GUARD_REQUEST'}
foreach($value in @($r.invocation,$r.newVmId)){if($value -notmatch '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'){throw 'DESKTOP_GUARD_UUID'}}
if($r.newVmId -ceq '53cc186f-aaf4-4d77-85ef-b1b42031be50'){throw 'DESKTOP_GUARD_SOURCE_VM'}
$owned=[IO.Path]::Combine($parent,'linux-desktop-identity-cow-'+$r.invocation)
Add-Type -TypeDefinition @'
using System;using System.IO;using System.Text;using System.Linq;using System.Collections.Generic;
using System.Runtime.InteropServices;using System.Security.Cryptography;using Microsoft.Win32.SafeHandles;
public static class CowReadGuard {
 [StructLayout(LayoutKind.Sequential)] public struct Info {public uint Attributes;public System.Runtime.InteropServices.ComTypes.FILETIME Creation,Access,Write;public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;}
 [StructLayout(LayoutKind.Sequential)] public struct IdInfo {public ulong Volume;[MarshalAs(UnmanagedType.ByValArray,SizeConst=16)]public byte[] Id;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string p,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle h,int kind,out IdInfo i,uint size);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle h,StringBuilder s,uint n,uint flags);
 [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {public int Length;public IntPtr Descriptor;public int Inherit;}
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text,uint version,out IntPtr descriptor,out uint size);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectoryW(string path,ref SecurityAttributes security);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
 public class Held {public string Path,Id;public bool Directory,Source;public SafeFileHandle Handle;public FileStream Stream;public Info Initial;}
 public static readonly Dictionary<string,Held> All=new Dictionary<string,Held>(StringComparer.OrdinalIgnoreCase);
 public static readonly List<string> SourceFiles=new List<string>(),SourceDirectories=new List<string>();
 static ulong Time(System.Runtime.InteropServices.ComTypes.FILETIME t){return ((ulong)(uint)t.dwHighDateTime<<32)|(uint)t.dwLowDateTime;}
 public static string Clean(string p){if(p==null||p.Length>32768||p.Length<3||p[1]!=':'||p[2]!='\\'||p.IndexOfAny(new char[]{'\0','\r','\n','/','*','?','"','<','>','|'})>=0)throw new IOException("COW_PATH");if(p.Length>3)foreach(string c in p.Substring(3).Split('\\')){if(c.Length==0||c=="."||c==".."||c.Contains(":" )||c.EndsWith(".")||c.EndsWith(" "))throw new IOException("COW_PATH_COMPONENT");}if(!String.Equals(System.IO.Path.GetFullPath(p),p,StringComparison.Ordinal))throw new IOException("COW_PATH_CANONICAL");return p;}
 public static Info Stat(SafeFileHandle h){Info i;if(!GetFileInformationByHandle(h,out i))throw new IOException("COW_STAT");return i;}
 static string Identity(SafeFileHandle h){IdInfo i;if(!GetFileInformationByHandleEx(h,18,out i,24))throw new IOException("COW_FILE_ID");return i.Volume.ToString("x")+":"+BitConverter.ToString(i.Id).Replace("-","").ToLowerInvariant();}
 public static Held Open(string p,bool directory,bool source){Clean(p);Held old;if(All.TryGetValue(p,out old)){if(old.Directory!=directory)throw new IOException("COW_ROLE_CHANGED");if(source&&!old.Source){old.Source=true;if(directory)SourceDirectories.Add(p);else SourceFiles.Add(p);}return old;}
  // Original objects stay FileShare.Read. Ancestors and the new private
  // owned root allow writes to their children while still denying deletion
  // or renaming of the held directory itself. Product stores use atomic CAS.
  SafeFileHandle h=CreateFileW(p,0x80020000,source?1u:3u,IntPtr.Zero,3,0x02200000,IntPtr.Zero);if(h.IsInvalid)throw new IOException("COW_READ_LOCK");
  try{Info i=Stat(h);if((i.Attributes&0x004c1400)!=0||((i.Attributes&16)!=0)!=directory||(!directory&&i.Links!=1))throw new IOException("COW_TYPE");
   StringBuilder b=new StringBuilder(32768);uint n=GetFinalPathNameByHandleW(h,b,32768,0);if(n==0||n>=32768)throw new IOException("COW_FINAL_PATH");string actual=b.ToString();if(actual.StartsWith("\\\\?\\"))actual=actual.Substring(4);if(!String.Equals(actual.TrimEnd('\\'),p.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))throw new IOException("COW_FINAL_ALIAS");
   Held value=new Held{Path=p,Id=Identity(h),Directory=directory,Source=source,Handle=h,Initial=i};if(!directory)value.Stream=new FileStream(h,FileAccess.Read,1048576,false);All.Add(p,value);if(source){if(directory)SourceDirectories.Add(p);else SourceFiles.Add(p);}return value;
  }catch{h.Dispose();throw;}}
 public static void Parents(string p){Clean(p);string current=p.Substring(0,3);Open(current,true,false);foreach(string part in p.Substring(3).Split('\\')){current=System.IO.Path.Combine(current,part);Open(current,true,false);}}
 public static void Tree(string root,int depth){if(depth>16||SourceDirectories.Count>=1024)throw new IOException("COW_TREE_BUDGET");Open(root,true,true);foreach(string p in Directory.GetFileSystemEntries(root).OrderBy(x=>x,StringComparer.Ordinal)){if(SourceFiles.Count>=8192)throw new IOException("COW_FILE_BUDGET");uint a=(uint)File.GetAttributes(p);if((a&0x004c1400)!=0)throw new IOException("COW_TREE_TYPE");if((a&16)!=0)Tree(p,depth+1);else Open(p,false,true);}}
 // This pure membership check is also exercised by the inventory model. An
 // independently enumerated entry is never allowed to become an unlocked
 // baseline, even when it appeared between Tree and the first snapshot.
 public static void VerifyInventory(string parent,string[] paths,uint[] attributes){if(paths.Length!=attributes.Length)throw new IOException("COW_INVENTORY_SHAPE");var expected=All.Values.Where(h=>h.Source&&String.Equals(System.IO.Path.GetDirectoryName(h.Path),parent,StringComparison.OrdinalIgnoreCase)).ToDictionary(h=>h.Path,h=>h,StringComparer.OrdinalIgnoreCase);var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);for(int n=0;n<paths.Length;n++){string path=Clean(paths[n]);Held held;if(!String.Equals(System.IO.Path.GetDirectoryName(path),parent,StringComparison.Ordinal)||!seen.Add(path)||!expected.TryGetValue(path,out held)||!held.Source||!String.Equals(path,held.Path,StringComparison.Ordinal)||(attributes[n]&0x004c1400)!=0||((attributes[n]&16)!=0)!=held.Directory||attributes[n]!=held.Initial.Attributes)throw new IOException("COW_INVENTORY_UNHELD_ENTRY");}if(seen.Count!=expected.Count)throw new IOException("COW_INVENTORY_MISSING_ENTRY");}
 public static void SealInventory(){foreach(string parent in SourceDirectories){Check(parent);string[] paths=Directory.GetFileSystemEntries(parent).OrderBy(x=>x,StringComparer.Ordinal).ToArray();uint[] attributes=paths.Select(p=>(uint)File.GetAttributes(p)).ToArray();VerifyInventory(parent,paths,attributes);foreach(string path in paths)Check(path);Check(parent);}}
 static bool Same(Info a,Info b){return a.Attributes==b.Attributes&&a.Volume==b.Volume&&a.Links==b.Links&&a.IndexHigh==b.IndexHigh&&a.IndexLow==b.IndexLow&&a.SizeHigh==b.SizeHigh&&a.SizeLow==b.SizeLow&&Time(a.Creation)==Time(b.Creation)&&Time(a.Write)==Time(b.Write);}
 public static void Check(string p){Held h=All[p];Info current=Stat(h.Handle);if(Identity(h.Handle)!=h.Id||(h.Source&&!Same(h.Initial,current))||current.Attributes!=h.Initial.Attributes||current.Links!=h.Initial.Links||Time(current.Creation)!=Time(h.Initial.Creation))throw new IOException("COW_ORIGINAL_METADATA_CHANGED");}
 public static string Hash(string p){Held h=All[p];if(h.Directory)throw new IOException("COW_HASH_DIRECTORY");Check(p);if(h.Stream.Length>68719476736L)throw new IOException("COW_FILE_SIZE");h.Stream.Position=0;string digest;using(SHA256 a=SHA256.Create())digest=BitConverter.ToString(a.ComputeHash(h.Stream)).Replace("-","").ToLowerInvariant();Check(p);return digest;}
 public static byte[] Read(string p,int maximum){Held h=All[p];if(h.Directory||h.Stream.Length>maximum)throw new IOException("COW_READ_SIZE");Check(p);h.Stream.Position=0;byte[] data=new byte[(int)h.Stream.Length];int offset=0;while(offset<data.Length){int n=h.Stream.Read(data,offset,data.Length-offset);if(n<=0)throw new IOException("COW_SHORT_READ");offset+=n;}Check(p);return data;}
 public static object Pin(string p,bool hash){Held h=All[p];Check(p);Info i=Stat(h.Handle);return new {path=p,id=h.Id,directory=h.Directory,attributes=i.Attributes,links=i.Links,size=(((ulong)i.SizeHigh<<32)|i.SizeLow).ToString(),creationTicks=Time(i.Creation).ToString(),writeTicks=Time(i.Write).ToString(),sha256=hash&&!h.Directory?Hash(p):null};}
 public static byte[] Slice(string p,long offset,int length){Held h=All[p];if(h.Directory||offset<0||length<0||length>65536||offset+length>h.Stream.Length)throw new IOException("COW_SLICE");Check(p);h.Stream.Position=offset;byte[] data=new byte[length];int read=0;while(read<length){int n=h.Stream.Read(data,read,length-read);if(n<=0)throw new IOException("COW_SLICE_SHORT");read+=n;}Check(p);return data;}
 public static void NewDirectory(string p,string sddl){Clean(p);IntPtr descriptor;uint size;if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl,1,out descriptor,out size))throw new IOException("COW_DIRECTORY_SECURITY");try{SecurityAttributes a=new SecurityAttributes{Length=Marshal.SizeOf(typeof(SecurityAttributes)),Descriptor=descriptor,Inherit=0};if(!CreateDirectoryW(p,ref a))throw new IOException("COW_DIRECTORY_NOT_EXCLUSIVE");}finally{LocalFree(descriptor);}}
 public static object Transient(string p){if(All.ContainsKey(p))throw new IOException("COW_TRANSIENT_HELD");Held h=Open(p,false,false);try{return Pin(p,true);}finally{All.Remove(p);if(h.Stream!=null)h.Stream.Dispose();h.Handle.Dispose();}}
 public static void Close(){foreach(Held h in All.Values){if(h.Stream!=null)h.Stream.Dispose();h.Handle.Dispose();}}
}
public static class CowOwnedJob {
 [StructLayout(LayoutKind.Sequential)] struct BasicLimit {public long ProcessTime,JobTime;public uint Flags;public UIntPtr MinWorking,MaxWorking;public uint ActiveLimit;public UIntPtr Affinity;public uint Priority,Scheduling;}
 [StructLayout(LayoutKind.Sequential)] struct Io {public ulong ReadOperations,WriteOperations,OtherOperations,ReadBytes,WriteBytes,OtherBytes;}
 [StructLayout(LayoutKind.Sequential)] struct Extended {public BasicLimit Basic;public Io Io;public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr security,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Extended limits,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr data,uint length,out uint returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out System.Runtime.InteropServices.ComTypes.FILETIME creation,out System.Runtime.InteropServices.ComTypes.FILETIME exit,out System.Runtime.InteropServices.ComTypes.FILETIME kernel,out System.Runtime.InteropServices.ComTypes.FILETIME user);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static IntPtr job=IntPtr.Zero;static uint worker;
 static void Limits(bool kill){Extended value=new Extended();value.Basic.Flags=kill?0x2000u:0u;if(!SetInformationJobObject(job,9,ref value,(uint)Marshal.SizeOf(typeof(Extended))))throw new IOException("COW_JOB_LIMITS");}
 public static void Own(uint pid,string creationTicks){if(job!=IntPtr.Zero)throw new IOException("COW_JOB_REUSE");IntPtr process=OpenProcess(0x00101101,false,pid);if(process==IntPtr.Zero)throw new IOException("COW_JOB_PROCESS");try{System.Runtime.InteropServices.ComTypes.FILETIME c,e,k,u;if(!GetProcessTimes(process,out c,out e,out k,out u)||((((ulong)(uint)c.dwHighDateTime<<32)|(uint)c.dwLowDateTime).ToString()!=creationTicks))throw new IOException("COW_JOB_BIRTH");job=CreateJobObjectW(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new IOException("COW_JOB_CREATE");Limits(true);if(!AssignProcessToJobObject(job,process))throw new IOException("COW_JOB_ASSIGN");worker=pid;}finally{CloseHandle(process);}}
 public static uint[] Members(){if(job==IntPtr.Zero)return new uint[0];IntPtr data=Marshal.AllocHGlobal(8+1024*IntPtr.Size);try{uint returned;if(!QueryInformationJobObject(job,3,data,(uint)(8+1024*IntPtr.Size),out returned))throw new IOException("COW_JOB_QUERY");int count=Marshal.ReadInt32(data,4);if(count<0||count>1024)throw new IOException("COW_JOB_BUDGET");uint[] values=new uint[count];for(int n=0;n<count;n++){long pid=IntPtr.Size==8?Marshal.ReadInt64(data,8+n*8):Marshal.ReadInt32(data,8+n*4);if(pid<1||pid>uint.MaxValue)throw new IOException("COW_JOB_PID");values[n]=(uint)pid;}return values;}finally{Marshal.FreeHGlobal(data);}}
 public static void OnlyWorker(){uint[] members=Members();if(members.Length!=1||members[0]!=worker)throw new IOException("COW_JOB_CHILDREN_NOT_CLOSED");}
 public static void Close(bool normal){if(job==IntPtr.Zero)return;try{if(normal){OnlyWorker();Limits(false);}else{if(!TerminateJobObject(job,73))throw new IOException("COW_JOB_TERMINATE");DateTime deadline=DateTime.UtcNow.AddSeconds(30);while(Members().Length!=0){if(DateTime.UtcNow>deadline)throw new IOException("COW_JOB_CLOSE_TIMEOUT");System.Threading.Thread.Sleep(25);}}}finally{CloseHandle(job);job=IntPtr.Zero;}}
}
'@

function emit($o){[Console]::Out.WriteLine(($o|ConvertTo-Json -Compress -Depth 22));[Console]::Out.Flush()}
function snap {
 [CowReadGuard]::SealInventory()
 $files=@(foreach($path in [CowReadGuard]::SourceFiles){[CowReadGuard]::Pin($path,$true)})
 $dirs=@(foreach($path in [CowReadGuard]::SourceDirectories){@{pin=[CowReadGuard]::Pin($path,$false);entries=@(Get-ChildItem -LiteralPath $path -Force|Sort-Object Name|ForEach-Object{$h=[CowReadGuard]::All[$_.FullName];if(-not $h -or -not $h.Source){throw 'DESKTOP_UNHELD_ENTRY'};@{name=$_.Name;id=$h.Id;directory=$_.PSIsContainer;attributes=[uint32]$_.Attributes}})}})
 [CowReadGuard]::SealInventory()
 return @{files=$files;directories=$dirs;inventorySealed=$true}
}
function census {
 return @(Get-CimInstance Win32_Process -Filter "Name='qemu-system-x86_64.exe' OR Name='qemu-img.exe'"|Where-Object{($_.ExecutablePath -ceq $qemu -or $_.ExecutablePath -ceq $img) -and $_.CommandLine -and ($_.CommandLine.Contains($owned) -or $_.CommandLine.Contains($source) -or $_.CommandLine.Contains($original))}|Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine)
}
$released=$false;$initial=$null
try {
 $process=[Diagnostics.Process]::GetProcessById([int]$r.parentPid)
 if($process.MainModule.FileName -cne $r.parentImage -or $process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -cne $r.parentCreationTicks){throw 'DESKTOP_WORKER_BIRTH'}
 $process.Dispose()
 if(@(census).Count -ne 0){throw 'DESKTOP_SOURCE_LIVE'}
 [CowReadGuard]::Parents([IO.Path]::GetDirectoryName($source));[CowReadGuard]::Tree($source,0)
 foreach($path in @($original,$qemu,$img)){[CowReadGuard]::Parents([IO.Path]::GetDirectoryName($path));[CowReadGuard]::Open($path,$false,$true)|Out-Null}
 $catalogPath=[IO.Path]::Combine($source,'machines.json')
 if([CowReadGuard]::Hash($catalogPath) -cne 'da5ee5ef35ee5737abb9897131f8d22d4206044fee05c45f30f83948d94ed971'){throw 'DESKTOP_SOURCE_CATALOG_SHA'}
 $catalog=[Text.Encoding]::UTF8.GetString([CowReadGuard]::Read($catalogPath,65536))|ConvertFrom-Json
 if(@($catalog).Count -ne 1 -or $catalog[0].id -cne '53cc186f-aaf4-4d77-85ef-b1b42031be50' -or $catalog[0].distro -cne 'debian' -or $catalog[0].bootstrapped -ne $true){throw 'DESKTOP_SOURCE_CATALOG'}
 $proofPath=[IO.Path]::Combine($source,'native-wayland-evidence.json')
 if([CowReadGuard]::Hash($proofPath) -cne 'ca303af77c4b1cb896ee6f67bb80b951ee66e6a552dab08bd926404f58d68ef2'){throw 'DESKTOP_SOURCE_PROOF_SHA'}
 $proof=[Text.Encoding]::UTF8.GetString([CowReadGuard]::Read($proofPath,1048576))|ConvertFrom-Json
 if($proof.vmId -cne $catalog[0].id -or $proof.passed -ne $true -or $proof.vmStopped -ne $true){throw 'DESKTOP_SOURCE_NOT_CLOSED'}
 $initial=snap
 [CowOwnedJob]::Own([uint32]$r.parentPid,[string]$r.parentCreationTicks)
 [CowReadGuard]::Parents($parent)
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 [CowReadGuard]::NewDirectory($owned,('O:'+ $sid +'G:'+ $sid +'D:P(A;OICI;FA;;;'+$sid+')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'))
 [CowReadGuard]::Open($owned,$true,$false)|Out-Null
 emit @{event='LOCKED';snapshot=$initial;root=$owned;rootPin=[CowReadGuard]::Pin($owned,$false);guardPid=$PID;guardCreationTicks=([Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToFileTimeUtc().ToString());jobMembers=@([CowOwnedJob]::Members())}
 while($line=[Console]::In.ReadLine()) {
  if($line.Length -gt 4096){throw 'DESKTOP_GUARD_COMMAND_SIZE'}
  $request=$line|ConvertFrom-Json
  if(@($request.PSObject.Properties.Name).Count -ne 1 -or $request.action -cne 'release'){throw 'DESKTOP_GUARD_COMMAND'}
  [CowOwnedJob]::OnlyWorker()
  if(@(census).Count -ne 0){throw 'DESKTOP_RESOURCE_NOT_CLOSED'}
  $after=snap
  if(($initial|ConvertTo-Json -Compress -Depth 22) -cne ($after|ConvertTo-Json -Compress -Depth 22)){throw 'DESKTOP_SOURCE_CHANGED'}
  emit @{event='RELEASED';snapshot=$after;exactQemuAndImg=0;jobMembers=@([CowOwnedJob]::Members());rootPin=[CowReadGuard]::Pin($owned,$false)}
  $released=$true;break
 }
 if(-not $released){throw 'DESKTOP_GUARD_EOF'}
}finally{[CowOwnedJob]::Close($released);[CowReadGuard]::Close()}
