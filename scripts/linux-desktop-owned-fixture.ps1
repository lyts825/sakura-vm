# Windows 侧自有 Linux 桌面夹具协调器，核对源目录和 QEMU 身份，记录本次复制、运行及退出证据。
# Coordinate owned Linux desktop fixtures from Windows, verify source/QEMU identities and record this copy/run/exit evidence.
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
 // 按访问权、共享权、打开方式与标志打开对象，返回拥有关闭责任的安全句柄；调用方用非跟随重解析方式并检查 IsInvalid。
 // Open an object with explicit access, sharing, disposition and flags, returning an owned safe handle; callers prevent reparse traversal and check IsInvalid.
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string p,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 // 从已持有句柄读取元数据及链接数，失败返回 false，供 Stat 转成封闭失败。
 // Read metadata/link counts through the held handle; false is converted by Stat into a fail-closed error.
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
 // 按信息类读取卷号和 128 位文件 ID，输出结构大小必须与声明一致；false 表示无法绑定对象身份。
 // Read the volume and 128-bit file ID for the requested information class; structure size must match the declaration and false means identity cannot be bound.
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle h,int kind,out IdInfo i,uint size);
 // 把已打开对象的最终路径写入有界缓冲，返回所需长度；调用方拒绝零值、截断和不同物理路径。
 // Write the opened object’s final path into a bounded buffer and return the required length; callers reject zero, truncation and differing physical paths.
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle h,StringBuilder s,uint n,uint flags);
 [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {public int Length;public IntPtr Descriptor;public int Inherit;}
 // 把 SDDL 转成原生安全描述符，成功后内存必须 LocalFree；失败不允许退回默认目录权限。
 // Convert SDDL into a native security descriptor that must be LocalFree’d on success; failure must not fall back to default directory permissions.
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text,uint version,out IntPtr descriptor,out uint size);
 // 用显式、非继承安全属性独占创建目录，已有目录或其他失败返回 false，避免复用来源不明的根。
 // Exclusively create a directory with explicit noninheriting security attributes; existing directories or other failures return false instead of reusing an unknown root.
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectoryW(string path,ref SecurityAttributes security);
 // 释放安全描述符转换函数分配的本地堆内存，返回值由清理路径忽略。
 // Release local-heap memory allocated by security-descriptor conversion; the cleanup path ignores the returned pointer.
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
 public class Held {public string Path,Id;public bool Directory,Source;public SafeFileHandle Handle;public FileStream Stream;public Info Initial;}
 public static readonly Dictionary<string,Held> All=new Dictionary<string,Held>(StringComparer.OrdinalIgnoreCase);
 public static readonly List<string> SourceFiles=new List<string>(),SourceDirectories=new List<string>();
 // 无符号合并 FILETIME 的高低 DWORD 为 64 位时间票据，避免带符号字段扩展改变出生/修改时间。
 // Combine FILETIME DWORDs as unsigned bits into a 64-bit timestamp, avoiding sign extension in birth/write evidence.
 static ulong Time(System.Runtime.InteropServices.ComTypes.FILETIME t){return ((ulong)(uint)t.dwHighDateTime<<32)|(uint)t.dwLowDateTime;}
 // 只接受已规范化的驱动器绝对路径，拒绝别名字符、点段、空段、ADS 和尾点/空格；验证后返回原值，不通过改写掩盖歧义。
 // Accept only already-canonical absolute drive paths, rejecting alias characters, dot/empty components, ADS and trailing dots/spaces; return the original value after validation rather than rewriting ambiguity.
 public static string Clean(string p){if(p==null||p.Length>32768||p.Length<3||p[1]!=':'||p[2]!='\\'||p.IndexOfAny(new char[]{'\0','\r','\n','/','*','?','"','<','>','|'})>=0)throw new IOException("COW_PATH");if(p.Length>3)foreach(string c in p.Substring(3).Split('\\')){if(c.Length==0||c=="."||c==".."||c.Contains(":" )||c.EndsWith(".")||c.EndsWith(" "))throw new IOException("COW_PATH_COMPONENT");}if(!String.Equals(System.IO.Path.GetFullPath(p),p,StringComparison.Ordinal))throw new IOException("COW_PATH_CANONICAL");return p;}
 // 查询已持有对象的基础元数据；系统调用失败抛 COW_STAT，返回值用于后续身份和不可变性检查。
 // Query basic metadata through the held object; system-call failure throws COW_STAT and the result feeds identity/immutability checks.
 public static Info Stat(SafeFileHandle h){Info i;if(!GetFileInformationByHandle(h,out i))throw new IOException("COW_STAT");return i;}
 // 用卷号和完整 128 位文件 ID 生成稳定身份字符串；缺少原生文件 ID 时直接失败，不以路径替代身份。
 // Build a stable identity from volume plus full 128-bit file ID; fail if native identity is unavailable instead of substituting a pathname.
 static string Identity(SafeFileHandle h){IdInfo i;if(!GetFileInformationByHandleEx(h,18,out i,24))throw new IOException("COW_FILE_ID");return i.Volume.ToString("x")+":"+BitConverter.ToString(i.Id).Replace("-","").ToLowerInvariant();}
 // 复用同路径同类型的已持有对象，或不跟随重解析地打开并绑定最终路径/文件 ID；源对象仅共享读取，祖先允许子项写入但禁止自身删除。拒绝异常属性、多硬链和别名，失败立即释放新句柄。
 // Reuse a held same-path/same-type object or open without reparse traversal and bind final path/file ID. Sources share reads only; ancestors permit child writes while denying their own deletion. Reject forbidden attributes, multiple hard links and aliases, disposing the new handle on failure.
 public static Held Open(string p,bool directory,bool source){Clean(p);Held old;if(All.TryGetValue(p,out old)){if(old.Directory!=directory)throw new IOException("COW_ROLE_CHANGED");if(source&&!old.Source){old.Source=true;if(directory)SourceDirectories.Add(p);else SourceFiles.Add(p);}return old;}
  // Original objects stay FileShare.Read. Ancestors and the new private
  // owned root allow writes to their children while still denying deletion
  // or renaming of the held directory itself. Product stores use atomic CAS.
  SafeFileHandle h=CreateFileW(p,0x80020000,source?1u:3u,IntPtr.Zero,3,0x02200000,IntPtr.Zero);if(h.IsInvalid)throw new IOException("COW_READ_LOCK");
  try{Info i=Stat(h);if((i.Attributes&0x004c1400)!=0||((i.Attributes&16)!=0)!=directory||(!directory&&i.Links!=1))throw new IOException("COW_TYPE");
   StringBuilder b=new StringBuilder(32768);uint n=GetFinalPathNameByHandleW(h,b,32768,0);if(n==0||n>=32768)throw new IOException("COW_FINAL_PATH");string actual=b.ToString();if(actual.StartsWith("\\\\?\\"))actual=actual.Substring(4);if(!String.Equals(actual.TrimEnd('\\'),p.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))throw new IOException("COW_FINAL_ALIAS");
   Held value=new Held{Path=p,Id=Identity(h),Directory=directory,Source=source,Handle=h,Initial=i};if(!directory)value.Stream=new FileStream(h,FileAccess.Read,1048576,false);All.Add(p,value);if(source){if(directory)SourceDirectories.Add(p);else SourceFiles.Add(p);}return value;
  }catch{h.Dispose();throw;}}
 // 按驱动器根到末段顺序持有路径的所有目录祖先，使用非源角色防止祖先被替换而允许自有子项事务。
 // Hold every ancestor from drive root to final component as nonsource directories, preventing ancestor replacement while allowing owned child transactions.
 public static void Parents(string p){Clean(p);string current=p.Substring(0,3);Open(current,true,false);foreach(string part in p.Substring(3).Split('\\')){current=System.IO.Path.Combine(current,part);Open(current,true,false);}}
 // 按序遍历并持有整个源树，限制深度 16、目录 1024、文件 8192；异常属性和超预算立即拒绝，文件内容稍后在同一句柄读取。
 // Traverse and hold the source tree in order with depth 16, 1024-directory and 8192-file budgets; reject forbidden attributes/budget overflow and later read contents through the same handles.
 public static void Tree(string root,int depth){if(depth>16||SourceDirectories.Count>=1024)throw new IOException("COW_TREE_BUDGET");Open(root,true,true);foreach(string p in Directory.GetFileSystemEntries(root).OrderBy(x=>x,StringComparer.Ordinal)){if(SourceFiles.Count>=8192)throw new IOException("COW_FILE_BUDGET");uint a=(uint)File.GetAttributes(p);if((a&0x004c1400)!=0)throw new IOException("COW_TREE_TYPE");if((a&16)!=0)Tree(p,depth+1);else Open(p,false,true);}}
 // This pure membership check is also exercised by the inventory model. An
 // independently enumerated entry is never allowed to become an unlocked
 // baseline, even when it appeared between Tree and the first snapshot.
 // 把独立枚举的路径/属性与已持有的直接源子项严格对照，拒绝重复、遗漏、新项、大小写别名和属性/类型变化；新增项不能变成无锁基线。
 // Compare independently enumerated paths/attributes with held direct source children; reject duplicates, omissions, additions, case aliases and type/attribute changes so new entries never become an unlocked baseline.
 public static void VerifyInventory(string parent,string[] paths,uint[] attributes){if(paths.Length!=attributes.Length)throw new IOException("COW_INVENTORY_SHAPE");var expected=All.Values.Where(h=>h.Source&&String.Equals(System.IO.Path.GetDirectoryName(h.Path),parent,StringComparison.OrdinalIgnoreCase)).ToDictionary(h=>h.Path,h=>h,StringComparer.OrdinalIgnoreCase);var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);for(int n=0;n<paths.Length;n++){string path=Clean(paths[n]);Held held;if(!String.Equals(System.IO.Path.GetDirectoryName(path),parent,StringComparison.Ordinal)||!seen.Add(path)||!expected.TryGetValue(path,out held)||!held.Source||!String.Equals(path,held.Path,StringComparison.Ordinal)||(attributes[n]&0x004c1400)!=0||((attributes[n]&16)!=0)!=held.Directory||attributes[n]!=held.Initial.Attributes)throw new IOException("COW_INVENTORY_UNHELD_ENTRY");}if(seen.Count!=expected.Count)throw new IOException("COW_INVENTORY_MISSING_ENTRY");}
 // 逐源目录在枚举前后检查句柄身份，校验精确成员并逐项复验，阻止遍历与快照之间的目录竞态。
 // Check each source directory before/after enumeration, verify exact membership and recheck every entry to detect races between traversal and snapshot.
 public static void SealInventory(){foreach(string parent in SourceDirectories){Check(parent);string[] paths=Directory.GetFileSystemEntries(parent).OrderBy(x=>x,StringComparer.Ordinal).ToArray();uint[] attributes=paths.Select(p=>(uint)File.GetAttributes(p)).ToArray();VerifyInventory(parent,paths,attributes);foreach(string path in paths)Check(path);Check(parent);}}
 // 比较源对象属性、卷/索引、链接数、长度、出生和修改时间；忽略读取会改变的访问时间，返回是否仍是原始元数据。
 // Compare source attributes, volume/index, link count, size and birth/write times; ignore read-modified access time and report whether original metadata remains.
 static bool Same(Info a,Info b){return a.Attributes==b.Attributes&&a.Volume==b.Volume&&a.Links==b.Links&&a.IndexHigh==b.IndexHigh&&a.IndexLow==b.IndexLow&&a.SizeHigh==b.SizeHigh&&a.SizeLow==b.SizeLow&&Time(a.Creation)==Time(b.Creation)&&Time(a.Write)==Time(b.Write);}
 // 经原句柄复验文件 ID；源对象须保持全部记录元数据，非源祖先仍须保持属性/链接/出生时间，任何变化均封闭失败。
 // Recheck file ID through the original handle; sources retain full recorded metadata while nonsource ancestors retain attributes/link count/birth time, failing closed on change.
 public static void Check(string p){Held h=All[p];Info current=Stat(h.Handle);if(Identity(h.Handle)!=h.Id||(h.Source&&!Same(h.Initial,current))||current.Attributes!=h.Initial.Attributes||current.Links!=h.Initial.Links||Time(current.Creation)!=Time(h.Initial.Creation))throw new IOException("COW_ORIGINAL_METADATA_CHANGED");}
 // 对已持有普通文件在前后身份检查之间计算完整 SHA-256，限制 64 GiB 并重置流位置；目录和过大文件拒绝。
 // Hash a held regular file with SHA-256 between identity checks, enforce a 64-GiB limit and reset stream position; reject directories and oversized files.
 public static string Hash(string p){Held h=All[p];if(h.Directory)throw new IOException("COW_HASH_DIRECTORY");Check(p);if(h.Stream.Length>68719476736L)throw new IOException("COW_FILE_SIZE");h.Stream.Position=0;string digest;using(SHA256 a=SHA256.Create())digest=BitConverter.ToString(a.ComputeHash(h.Stream)).Replace("-","").ToLowerInvariant();Check(p);return digest;}
 // 在 maximum 限额内从已持有文件读取精确全部字节，前后检查不变性；目录、超额或短读抛错。
 // Read all bytes exactly from a held file within maximum, checking immutability before/after; directories, oversized inputs and short reads throw.
 public static byte[] Read(string p,int maximum){Held h=All[p];if(h.Directory||h.Stream.Length>maximum)throw new IOException("COW_READ_SIZE");Check(p);h.Stream.Position=0;byte[] data=new byte[(int)h.Stream.Length];int offset=0;while(offset<data.Length){int n=h.Stream.Read(data,offset,data.Length-offset);if(n<=0)throw new IOException("COW_SHORT_READ");offset+=n;}Check(p);return data;}
 // 返回已校验对象的身份、类型、元数据和可选文件哈希；大小/时间以字符串保留整数精度，目录不计算内容哈希。
 // Return validated identity, type, metadata and optional file digest; stringify size/times to preserve integer precision and never content-hash a directory.
 public static object Pin(string p,bool hash){Held h=All[p];Check(p);Info i=Stat(h.Handle);return new {path=p,id=h.Id,directory=h.Directory,attributes=i.Attributes,links=i.Links,size=(((ulong)i.SizeHigh<<32)|i.SizeLow).ToString(),creationTicks=Time(i.Creation).ToString(),writeTicks=Time(i.Write).ToString(),sha256=hash&&!h.Directory?Hash(p):null};}
 // 读取已持有文件的有界区间，偏移非负且长度最多 65536；读取前后复验对象并拒绝越界和短读。
 // Read a bounded held-file range with nonnegative offset and at most 65536 bytes; recheck the object before/after and reject out-of-range or short reads.
 public static byte[] Slice(string p,long offset,int length){Held h=All[p];if(h.Directory||offset<0||length<0||length>65536||offset+length>h.Stream.Length)throw new IOException("COW_SLICE");Check(p);h.Stream.Position=offset;byte[] data=new byte[length];int read=0;while(read<length){int n=h.Stream.Read(data,read,length-read);if(n<=0)throw new IOException("COW_SLICE_SHORT");read+=n;}Check(p);return data;}
 // 校验路径后按调用方 SDDL 独占创建私有目录；描述符在 finally 释放，权限转换或创建失败均不复用已有对象。
 // Validate the path and exclusively create a private directory using caller SDDL; free its descriptor in finally and never reuse existing objects after conversion/creation failure.
 public static void NewDirectory(string p,string sddl){Clean(p);IntPtr descriptor;uint size;if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl,1,out descriptor,out size))throw new IOException("COW_DIRECTORY_SECURITY");try{SecurityAttributes a=new SecurityAttributes{Length=Marshal.SizeOf(typeof(SecurityAttributes)),Descriptor=descriptor,Inherit=0};if(!CreateDirectoryW(p,ref a))throw new IOException("COW_DIRECTORY_NOT_EXCLUSIVE");}finally{LocalFree(descriptor);}}
 // 仅为未持有的新文件临时开句柄并生成含哈希证据，finally 移除登记和释放流/句柄，不扩大永久源清单。
 // Temporarily hold an unregistered new file to capture hashed evidence, removing registration and disposing stream/handle in finally without extending the permanent source inventory.
 public static object Transient(string p){if(All.ContainsKey(p))throw new IOException("COW_TRANSIENT_HELD");Held h=Open(p,false,false);try{return Pin(p,true);}finally{All.Remove(p);if(h.Stream!=null)h.Stream.Dispose();h.Handle.Dispose();}}
 // 释放全部已持有对象的流和安全句柄；清理不重建或清空源证据集合，调用方仅在保护事务结束时使用。
 // Dispose streams and safe handles for all held objects without rebuilding/clearing evidence collections; callers use this at the guard transaction’s end.
 public static void Close(){foreach(Held h in All.Values){if(h.Stream!=null)h.Stream.Dispose();h.Handle.Dispose();}}
}
public static class CowOwnedJob {
 [StructLayout(LayoutKind.Sequential)] struct BasicLimit {public long ProcessTime,JobTime;public uint Flags;public UIntPtr MinWorking,MaxWorking;public uint ActiveLimit;public UIntPtr Affinity;public uint Priority,Scheduling;}
 [StructLayout(LayoutKind.Sequential)] struct Io {public ulong ReadOperations,WriteOperations,OtherOperations,ReadBytes,WriteBytes,OtherBytes;}
 [StructLayout(LayoutKind.Sequential)] struct Extended {public BasicLimit Basic;public Io Io;public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory;}
 // 创建自有未命名 Windows Job 并返回原生句柄；零值表示失败，关闭责任由保护器承担。
 // Create an owned unnamed Windows Job and return its native handle; zero means failure and the guard owns closure.
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr security,string name);
 // 向已拥有的 Job 设置扩展限制，结构大小和信息类由调用方明确指定；false 表示限制未落实。
 // Set extended limits on the owned Job with explicit structure size/information class; false means the requested containment was not applied.
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Extended limits,uint length);
 // 向有界原生缓冲查询 Job 进程成员，返回成功标志和字节数；调用方仍须验证成员计数和 PID 范围。
 // Query Job process membership into a bounded native buffer, returning success and byte count; callers still validate member count and PID ranges.
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr data,uint length,out uint returned);
 // 把已验证进程句柄纳入自有 Job，失败返回 false，不能据此宣称已取得子树控制。
 // Assign the verified process handle to the owned Job; false means subtree control has not been obtained.
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 // 以指定退出码终止自有 Job 全部成员；成功返回仅代表请求已发出，后续仍需等待成员清空。
 // Terminate all owned Job members with the supplied exit code; success acknowledges the request and callers still wait for empty membership.
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 // 按精确 PID 打开非继承进程句柄用于出生票据和 Job 入场，零值表示无法取得所需权限。
 // Open a noninheriting handle by exact PID for birth-ticket validation and Job admission; zero indicates unavailable required access.
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 // 读取进程 FILETIME 出生/退出/CPU 时间，调用方用出生时间排除 PID 重用；false 表示无法验证原进程。
 // Read process birth/exit/CPU FILETIMEs; callers use birth time to exclude PID reuse and false means original-process identity cannot be verified.
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out System.Runtime.InteropServices.ComTypes.FILETIME creation,out System.Runtime.InteropServices.ComTypes.FILETIME exit,out System.Runtime.InteropServices.ComTypes.FILETIME kernel,out System.Runtime.InteropServices.ComTypes.FILETIME user);
 // 释放由 Job/进程 API 返回的原生句柄；不接收 CowReadGuard 的 SafeFileHandle，避免双重所有权。
 // Release native handles returned by Job/process APIs, keeping them separate from CowReadGuard SafeFileHandle ownership.
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static IntPtr job=IntPtr.Zero;static uint worker;
 // 设置或解除 KILL_ON_JOB_CLOSE 标志；设置失败直接抛错，正常放行只能在确认 Job 仅剩协调 worker 后解除。
 // Set or clear KILL_ON_JOB_CLOSE and throw if the limit cannot be applied; normal release clears it only after proving the coordinator is the sole member.
 static void Limits(bool kill){Extended value=new Extended();value.Basic.Flags=kill?0x2000u:0u;if(!SetInformationJobObject(job,9,ref value,(uint)Marshal.SizeOf(typeof(Extended))))throw new IOException("COW_JOB_LIMITS");}
 // 只创建一次保护 Job，先通过 PID+FILETIME 精确核实 worker，再启用关 Job 杀全树并入场；finally 释放临时进程句柄，任一步失败不伪造拥有权。
 // Create containment once: verify worker by PID plus FILETIME, enable kill-on-close and admit it; dispose the temporary process handle in finally and never claim ownership after a failed step.
 public static void Own(uint pid,string creationTicks){if(job!=IntPtr.Zero)throw new IOException("COW_JOB_REUSE");IntPtr process=OpenProcess(0x00101101,false,pid);if(process==IntPtr.Zero)throw new IOException("COW_JOB_PROCESS");try{System.Runtime.InteropServices.ComTypes.FILETIME c,e,k,u;if(!GetProcessTimes(process,out c,out e,out k,out u)||((((ulong)(uint)c.dwHighDateTime<<32)|(uint)c.dwLowDateTime).ToString()!=creationTicks))throw new IOException("COW_JOB_BIRTH");job=CreateJobObjectW(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new IOException("COW_JOB_CREATE");Limits(true);if(!AssignProcessToJobObject(job,process))throw new IOException("COW_JOB_ASSIGN");worker=pid;}finally{CloseHandle(process);}}
 // 用最多 1024 个指针宽度 PID 的缓冲查询当前 Job 成员，校验计数和 uint 范围，finally 释放原生内存；无 Job 返回空数组。
 // Query current Job members into space for 1024 pointer-width PIDs, validate count/uint ranges and free native memory in finally; no Job returns an empty array.
 public static uint[] Members(){if(job==IntPtr.Zero)return new uint[0];IntPtr data=Marshal.AllocHGlobal(8+1024*IntPtr.Size);try{uint returned;if(!QueryInformationJobObject(job,3,data,(uint)(8+1024*IntPtr.Size),out returned))throw new IOException("COW_JOB_QUERY");int count=Marshal.ReadInt32(data,4);if(count<0||count>1024)throw new IOException("COW_JOB_BUDGET");uint[] values=new uint[count];for(int n=0;n<count;n++){long pid=IntPtr.Size==8?Marshal.ReadInt64(data,8+n*8):Marshal.ReadInt32(data,8+n*4);if(pid<1||pid>uint.MaxValue)throw new IOException("COW_JOB_PID");values[n]=(uint)pid;}return values;}finally{Marshal.FreeHGlobal(data);}}
 // 要求 Job 恰有已记录 worker 一个成员，否则拒绝释放，确保所有自有子进程已经关闭。
 // Require the recorded worker to be the Job’s sole member before release, proving all owned descendants have closed.
 public static void OnlyWorker(){uint[] members=Members();if(members.Length!=1||members[0]!=worker)throw new IOException("COW_JOB_CHILDREN_NOT_CLOSED");}
 // 正常释放先验证仅剩 worker 再解除关 Job 杀进程；异常退出终止全 Job 并最多等 30 秒清空。无论结果都关闭 Job 句柄并重置状态。
 // On normal release prove worker-only membership before disabling kill-on-close; on failure terminate the Job and wait at most thirty seconds for emptiness. Always close the Job handle and reset state.
 public static void Close(bool normal){if(job==IntPtr.Zero)return;try{if(normal){OnlyWorker();Limits(false);}else{if(!TerminateJobObject(job,73))throw new IOException("COW_JOB_TERMINATE");DateTime deadline=DateTime.UtcNow.AddSeconds(30);while(Members().Length!=0){if(DateTime.UtcNow>deadline)throw new IOException("COW_JOB_CLOSE_TIMEOUT");System.Threading.Thread.Sleep(25);}}}finally{CloseHandle(job);job=IntPtr.Zero;}}
}
'@

# 向协调器逐行输出压缩 JSON 并立即刷新，Depth 22 保留目录与运行证明结构；不混入诊断文本。
# Write one compressed JSON protocol line and flush immediately; depth 22 preserves directory/run evidence without mixing diagnostic text.
function emit($o){[Console]::Out.WriteLine(($o|ConvertTo-Json -Compress -Depth 22));[Console]::Out.Flush()}
# 在两次目录封口检查之间采集已持有源文件的哈希与目录身份/成员清单；新增、消失或未持锁成员直接失败，避免把竞态结果接纳为基线。
# Capture hashes of held source files and directory identities/membership between two inventory seals; added, missing or unheld entries fail rather than becoming a raced baseline.
function snap {
 [CowReadGuard]::SealInventory()
 $files=@(foreach($path in [CowReadGuard]::SourceFiles){[CowReadGuard]::Pin($path,$true)})
 $dirs=@(foreach($path in [CowReadGuard]::SourceDirectories){@{pin=[CowReadGuard]::Pin($path,$false);entries=@(Get-ChildItem -LiteralPath $path -Force|Sort-Object Name|ForEach-Object{$h=[CowReadGuard]::All[$_.FullName];if(-not $h -or -not $h.Source){throw 'DESKTOP_UNHELD_ENTRY'};@{name=$_.Name;id=$h.Id;directory=$_.PSIsContainer;attributes=[uint32]$_.Attributes}})}})
 [CowReadGuard]::SealInventory()
 return @{files=$files;directories=$dirs;inventorySealed=$true}
}
# 只列出物理工具路径精确匹配且命令行引用本次目录或源盘的 QEMU/qemu-img 进程，返回 PID、出生时间及命令证据供释放前验收。
# List QEMU/qemu-img processes only when the executable path matches exactly and argv references this run’s directory or source disk; return PID, birth time and command evidence for release checks.
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
