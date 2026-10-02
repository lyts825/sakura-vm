import {spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {join,win32,resolve} from 'node:path';
import type {Duplex} from 'node:stream';
import type {Client} from 'ssh2';
import {z} from 'zod';
import {AppError,DATA,ROOT} from './model.ts';
import type {Machines} from './machines.ts';
import type {GpgAgentContext} from './gpg-agent-scope.ts';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const localPath=z.string().min(4).max(32767).regex(/^[A-Za-z]:\\[^\x00-\x1f]*$/).refine(value=>win32.normalize(value)===value&&!value.split('\\').slice(1).some(part=>!part||part==='.'||part==='..'||/[\/:*?"<>|]/.test(part)||/[ .]$/.test(part)));
const filePin=z.object({id:z.string().regex(/^[a-f0-9]{1,16}:[a-f0-9]{32}$/),owner:z.string().regex(/^S-1-\d+(?:-\d+)+$/),aclSha256:digest,
  attributes:z.number().int().min(0).max(0xffffffff),links:z.number().int().min(1),directory:z.boolean(),protectedAcl:z.boolean()}).strict();
const processPin=z.object({pid:z.number().int().min(1).max(0xffffffff),creationTime:z.string().regex(/^[1-9]\d{0,19}$/),sid:z.string().regex(/^S-1-\d+(?:-\d+)+$/),image:localPath}).strict();
const sourcePins=z.object({kind:z.literal('w32'),anchorPath:localPath,relativePath:z.string().min(1).max(2048).refine(value=>!value.startsWith('\\')&&value.split('\\').every(part=>!!part&&part!=='.'&&part!=='..'&&!/[\x00-\x1f\/:*?"<>|]/.test(part)&&!/[ .]$/.test(part))),
  anchor:filePin,ancestors:z.array(filePin).min(1).max(65),descendants:z.array(filePin).min(1).max(8),sourceFileSha256:digest,port:z.number().int().min(1).max(65535),process:processPin}).strict();
const snapshotBody=z.object({version:z.literal(1),pins:sourcePins,hostHelperSha256:digest}).strict();
export function canonicalGpgMetadata(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonicalGpgMetadata).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalGpgMetadata((value as Record<string,unknown>)[key])).join(',')+'}';
  return JSON.stringify(value);
}
export function gpgHostSnapshotSha256(value:z.infer<typeof snapshotBody>){return createHash('sha256').update(canonicalGpgMetadata(snapshotBody.parse(value))).digest('hex');}
export const gpgHostSnapshotSchema=snapshotBody.extend({hostSourceSha256:digest}).strict().superRefine((value,ctx)=>{
  const {hostSourceSha256,...body}=value;
  if(gpgHostSnapshotSha256(body)!==hostSourceSha256)ctx.addIssue({code:'custom',message:'Captured GPG source digest differs'});
  if(!value.pins.anchor.directory||!value.pins.anchor.protectedAcl||canonicalGpgMetadata(value.pins.anchor)!==canonicalGpgMetadata(value.pins.ancestors.at(-1))||value.pins.descendants.at(-1)!.directory||value.pins.descendants.at(-1)!.links!==1)
    ctx.addIssue({code:'custom',message:'Captured GPG source object layout differs'});
});
export type GpgHostSnapshot=z.infer<typeof gpgHostSnapshotSchema>;
type SpawnHost=(file:string,args:readonly string[],options:SpawnOptionsWithoutStdio)=>ChildProcessWithoutNullStreams;
export type GpgHostOptions={sourceDirectory?:string;spawn?:SpawnHost;closeTimeoutMs?:number;platform?:NodeJS.Platform};
const manifestSchema=z.object({version:z.literal(1),platform:z.literal('win32'),architecture:z.literal('x64'),protocol:z.literal(1),file:z.literal('relay.exe'),size:z.number().int().min(1).max(16777216),sha256:digest,sourceSha256:digest,compilerSha256:digest}).strict();
const cleanupFailure=()=>new AppError('本次 GPG 宿主连接的物理关闭尚未确认',503,'PROJECT_IDENTITY_CLEANUP_FAILED');
const unavailable=(code:string,message='宿主 GPG Agent 受限 extra socket 无法完成身份验证')=>new AppError(message,409,code);
function frozen<T>(value:T):T {if(value&&typeof value==='object'){for(const item of Object.values(value))frozen(item);Object.freeze(value);}return value;}
function boundedWait<T>(promise:Promise<T>,milliseconds:number,error:()=>Error):Promise<T>{return new Promise((yes,no)=>{const timer=setTimeout(()=>no(error()),milliseconds);promise.then(value=>{clearTimeout(timer);yes(value);},reason=>{clearTimeout(timer);no(reason);});});}

// Fixed read-only native asset guard. Ancestors and both asset files stay open
// without FILE_SHARE_WRITE/DELETE until this controller closes its input pipe.
// Its new private birth directory also confines CodeDOM temporary files.
const assetGuardScript=String.raw`$ErrorActionPreference='Stop'
$request=[Console]::In.ReadLine()|ConvertFrom-Json
$self=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$birth=[IO.Path]::GetFullPath($request.birthRoot)
if($birth -cne $request.birthRoot -or [IO.Directory]::Exists($birth) -or [IO.File]::Exists($birth)){throw 'GPG_BIRTH_DIRECTORY_EXISTS'}
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($self)));$acl.SetAccessRuleProtection($true,$false)
foreach($principal in @($self,'S-1-5-18','S-1-5-32-544')){
 $sid=New-Object Security.Principal.SecurityIdentifier($principal)
 $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)
}
$directory=New-Object IO.DirectoryInfo($birth);$directory.Create($acl)
$env:TEMP=$birth;$env:TMP=$birth
Add-Type -TypeDefinition @'
using System;using System.IO;using System.Collections.Generic;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;
public static class GpgAssetHandles {
 [StructLayout(LayoutKind.Sequential)] public struct Info {public uint Attributes;public System.Runtime.InteropServices.ComTypes.FILETIME Creation,Access,Write;public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;}
 [StructLayout(LayoutKind.Sequential)] public struct IdInfo {public ulong Volume;[MarshalAs(UnmanagedType.ByValArray,SizeConst=16)]public byte[] Id;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle handle,int kind,out IdInfo info,uint size);
 public static readonly List<SafeFileHandle> Handles=new List<SafeFileHandle>();public static readonly List<FileStream> Streams=new List<FileStream>();
 public static SafeFileHandle Open(string path,bool directory){var handle=CreateFileW(path,0x80020000,1,IntPtr.Zero,3,0x02200000,IntPtr.Zero);if(handle.IsInvalid)throw new IOException("GPG_ASSET_OPEN");Info info;if(!GetFileInformationByHandle(handle,out info)||(info.Attributes&0x004c1400)!=0||((info.Attributes&16)!=0)!=directory||(!directory&&info.Links!=1)){handle.Dispose();throw new IOException("GPG_ASSET_TYPE");}Handles.Add(handle);return handle;}
 public static string Identity(SafeFileHandle handle){IdInfo info;if(!GetFileInformationByHandleEx(handle,18,out info,24))throw new IOException("GPG_ASSET_FILE_ID");return info.Volume.ToString("x")+":"+BitConverter.ToString(info.Id).Replace("-","").ToLowerInvariant();}
 public static byte[] Read(SafeFileHandle handle,int maximum){var stream=new FileStream(handle,FileAccess.Read);Streams.Add(stream);if(stream.Length<1||stream.Length>maximum)throw new IOException("GPG_ASSET_SIZE");var bytes=new byte[(int)stream.Length];int offset=0;while(offset<bytes.Length){int count=stream.Read(bytes,offset,bytes.Length-offset);if(count==0)throw new IOException("GPG_ASSET_READ");offset+=count;}return bytes;}
 public static void Close(){foreach(var stream in Streams)stream.Dispose();foreach(var handle in Handles)handle.Dispose();}
}
'@
function checkAcl($path){
 $security=$(if([IO.Directory]::Exists($path)){[IO.Directory]::GetAccessControl($path)}else{[IO.File]::GetAccessControl($path)});$owner=$security.GetOwner([Security.Principal.SecurityIdentifier]).Value
 if(@($self,'S-1-5-18','S-1-5-32-544') -notcontains $owner){throw 'GPG_ASSET_OWNER'}
 foreach($rule in $security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  if($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly){continue}
  if($rule.AccessControlType -eq 'Allow' -and ([int64]$rule.FileSystemRights -band 0x500D0156) -and @($self,'S-1-5-18','S-1-5-32-544') -notcontains $rule.IdentityReference.Value){throw 'GPG_ASSET_WRITABLE'}
 }
 return $security.Sddl
}
function hash($bytes){$algorithm=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$algorithm.Dispose()}}
function pinProcess($number,$expectedImage){
 $process=[Diagnostics.Process]::GetProcessById([int]$number)
 $image=$process.MainModule.FileName
 if($image -cne $expectedImage){throw 'GPG_CONTROL_IMAGE'}
 return @{pid=[int]$number;creationTime=$process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();sid=$self;image=$image}
}
function originalDead($pin){
 try{$process=[Diagnostics.Process]::GetProcessById([int]$pin.pid)}catch [ArgumentException]{return $true}
 try{if($process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -cne $pin.creationTime){return $true};if($process.HasExited){return $true};if($process.MainModule.FileName -cne $pin.image){throw 'GPG_PROCESS_IMAGE_CHANGED'};return $false}finally{$process.Dispose()}
}
function readRecord($filename){
 $held=[GpgAssetHandles]::Open($filename,$false);$null=checkAcl $filename;$bytes=[GpgAssetHandles]::Read($held,65536)
 return @{path=$filename;fileId=[GpgAssetHandles]::Identity($held);sha256=(hash $bytes);record=([Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json)}
}
function lease($receipt){
 $old=[IO.Path]::GetFullPath($receipt.root)
 if($old -cne $receipt.root -or $old -cne $request.ledgerRoot){throw 'GPG_LEASE_PATH'}
 $walk=$old.Substring(0,3);$null=[GpgAssetHandles]::Open($walk,$true)
 foreach($component in $old.Substring(3).Split('\')){if(-not $component -or $component -in @('.','..') -or $component -match '[:/*?"<>|]' -or $component -match '[ .]$'){throw 'GPG_LEASE_COMPONENT'};$walk=[IO.Path]::Combine($walk,$component);$null=[GpgAssetHandles]::Open($walk,$true)}
 $security=[IO.Directory]::GetAccessControl($old)
 if(-not $security.AreAccessRulesProtected -or $security.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $self){throw 'GPG_LEASE_OWNER'}
 foreach($rule in $security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly){continue};if($rule.AccessControlType -eq 'Allow' -and [int64]$rule.FileSystemRights -and @($self,'S-1-5-18','S-1-5-32-544') -notcontains $rule.IdentityReference.Value){throw 'GPG_LEASE_PRIVATE'}}
 $leaseHandle=[GpgAssetHandles]::Handles[[GpgAssetHandles]::Handles.Count-1]
 $intent=readRecord ([IO.Path]::Combine($old,'lease-intent.json'));$records=@()
 foreach($item in (Get-ChildItem -LiteralPath $old -Force|Sort-Object Name)){if($item.Name -match '^[a-f0-9-]{36}\.json$'){$records+=readRecord $item.FullName}}
 if($records.Count -gt 8){throw 'GPG_LEASE_BIRTH_BUDGET'}
 $closed=$null;$closedPath=[IO.Path]::Combine($old,'host-close.json')
 if([IO.File]::Exists($closedPath)){$closed=readRecord $closedPath}
 return @{event='LEASE_READ';root=$old;rootId=[GpgAssetHandles]::Identity($leaseHandle);intent=$intent;births=$records;closed=$closed;originalParentDead=(originalDead $intent.record.parent);originalGuardDead=(originalDead $intent.record.guard)}
}
try{
 $path=[IO.Path]::GetFullPath($request.directory)
 if($path -cne $request.directory -or $path -notmatch '^[A-Za-z]:\\'){throw 'GPG_ASSET_PATH'}
 $current=$path.Substring(0,3);$null=[GpgAssetHandles]::Open($current,$true)
 foreach($part in $path.Substring(3).Split('\')){if(-not $part -or $part -in @('.','..') -or $part -match '[:/*?"<>|]' -or $part -match '[ .]$'){throw 'GPG_ASSET_COMPONENT'};$current=[IO.Path]::Combine($current,$part);$null=[GpgAssetHandles]::Open($current,$true)}
 $directoryAcl=checkAcl $path
 $manifestPath=[IO.Path]::Combine($path,'manifest.json');$helperPath=[IO.Path]::Combine($path,'relay.exe')
 $manifest=[GpgAssetHandles]::Open($manifestPath,$false);$helper=[GpgAssetHandles]::Open($helperPath,$false)
 $manifestAcl=checkAcl $manifestPath;$helperAcl=checkAcl $helperPath
 $manifestBytes=[GpgAssetHandles]::Read($manifest,8192);$helperBytes=[GpgAssetHandles]::Read($helper,16777216)
 $helperHash=hash $helperBytes
 if($helperBytes.Length -lt 128 -or $helperBytes[0] -ne 77 -or $helperBytes[1] -ne 90){throw 'GPG_ASSET_PE'}
 $pe=[BitConverter]::ToUInt32($helperBytes,60)
 if($pe -lt 64 -or $pe+26 -gt $helperBytes.Length -or [BitConverter]::ToUInt32($helperBytes,$pe) -ne 17744 -or [BitConverter]::ToUInt16($helperBytes,$pe+4) -ne 34404 -or [BitConverter]::ToUInt16($helperBytes,$pe+24) -ne 523){throw 'GPG_ASSET_ARCHITECTURE'}
 $birthHandle=[GpgAssetHandles]::Open($birth,$true)
 if($request.context){
  $parent=pinProcess $request.parentPid $request.parentImage;$guard=pinProcess $PID ([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
  $intent=@{version=1;context=$request.context;parent=$parent;guard=$guard;hostHelperSha256=$helperHash}
  $intentBytes=[Text.Encoding]::UTF8.GetBytes(($intent|ConvertTo-Json -Compress -Depth 16))
  $intentPath=[IO.Path]::Combine($birth,'lease-intent.json');$output=New-Object IO.FileStream($intentPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try{$output.Write($intentBytes,0,$intentBytes.Length);$output.Flush($true)}finally{$output.Dispose()}
  $null=[GpgAssetHandles]::Open($intentPath,$false)
 }
 $ready=@{event='ASSET_READY';manifest=[Text.Encoding]::UTF8.GetString($manifestBytes);sha256=$helperHash;size=$helperBytes.Length;helperId=[GpgAssetHandles]::Identity($helper);manifestId=[GpgAssetHandles]::Identity($manifest);directory=$path;birthRoot=$birth;birthRootId=[GpgAssetHandles]::Identity($birthHandle)}
 [Console]::Out.WriteLine(($ready|ConvertTo-Json -Compress -Depth 8));[Console]::Out.Flush()
 while($null -ne ($line=[Console]::In.ReadLine())){
  if($line.Length -gt 16384){throw 'GPG_GUARD_REQUEST_SIZE'};$value=$line|ConvertFrom-Json
  if((checkAcl $path) -cne $directoryAcl -or (checkAcl $manifestPath) -cne $manifestAcl -or (checkAcl $helperPath) -cne $helperAcl){throw 'GPG_ASSET_ACL_CHANGED'}
  if($value.action -eq 'check'){[Console]::Out.WriteLine((@{event='ASSET_CHECKED';id=$value.id;sha256=$helperHash}|ConvertTo-Json -Compress));[Console]::Out.Flush();continue}
  if($value.action -eq 'lease'){$result=lease $value.receipt;$result.id=$value.id;[Console]::Out.WriteLine(($result|ConvertTo-Json -Compress -Depth 20));[Console]::Out.Flush();continue}
  if($value.action -eq 'closed'){
   $target=[IO.Path]::GetFullPath($value.receipt.root)
   if($target -cne $request.ledgerRoot){throw 'GPG_LEASE_CLOSE_PATH'}
   $observed=lease $value.receipt
   foreach($record in $observed.births){if($record.record.image -cne $helperPath -or $record.record.hostHelperSha256 -cne $helperHash -or -not (originalDead $record.record)){throw 'GPG_HELPER_CLOSE_UNCONFIRMED'}}
   if(-not $observed.closed){
    if($value.receipt.listenerClosure -notin @('not-started','unforward-acknowledged','ssh-transport-closed')){throw 'GPG_LISTENER_CLOSE_KIND'}
    $record=@{version=1;phase='closed';context=$value.receipt.context;helpers=$observed.births;originalIntentSha256=$observed.intent.sha256;actualSshClose=$value.receipt.actualSshClose;actualUnforward=$value.receipt.actualUnforward;listenerClosure=$value.receipt.listenerClosure;originalListenerCreated=$value.receipt.originalListenerCreated}
    $bytes=[Text.Encoding]::UTF8.GetBytes(($record|ConvertTo-Json -Compress -Depth 20));$filename=[IO.Path]::Combine($target,'host-close.json')
    $output=New-Object IO.FileStream($filename,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try{$output.Write($bytes,0,$bytes.Length);$output.Flush($true)}finally{$output.Dispose()}
   }
   [Console]::Out.WriteLine((@{event='CLOSE_RECORDED';id=$value.id}|ConvertTo-Json -Compress));[Console]::Out.Flush();continue
  }
  if($value.action -ne 'birth' -or $value.id -notmatch '^[a-f0-9-]{36}$' -or $value.receipt.image -cne $helperPath -or $value.receipt.hostHelperSha256 -cne $helperHash){throw 'GPG_HELPER_BIRTH_REQUEST'}
  $filename=[IO.Path]::Combine($birth,$value.id+'.json');$bytes=[Text.Encoding]::UTF8.GetBytes(($value.receipt|ConvertTo-Json -Compress -Depth 16))
  $file=New-Object IO.FileStream($filename,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try{$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
  $held=[GpgAssetHandles]::Open($filename,$false);$null=checkAcl $filename
  [Console]::Out.WriteLine((@{event='BIRTH_RECORDED';id=$value.id;path=$filename;fileId=[GpgAssetHandles]::Identity($held);sha256=(hash $bytes)}|ConvertTo-Json -Compress));[Console]::Out.Flush()
 }
}finally{[GpgAssetHandles]::Close()}
`;

type ChildResult={code:number|null;signal:NodeJS.Signals|null};
class ProcessOwner {
  readonly closed:Promise<ChildResult>;actual?:ChildResult;failed?:Error;
  constructor(readonly child:ChildProcessWithoutNullStreams){
    child.stdin.on('error',()=>{});child.stdout.on('error',()=>{});child.stderr.on('error',()=>{});
    this.closed=new Promise(resolve=>{child.once('error',error=>{this.failed=error;});child.once('close',(code,signal)=>{this.actual={code,signal};resolve(this.actual);});});
  }
  async close(timeout:number){if(this.actual)return;this.child.stdin.destroy();this.child.stdout.resume();await boundedWait(this.closed,timeout,cleanupFailure);}
}
type GuardAsset={manifest:z.infer<typeof manifestSchema>;path:string;id:string;birthRoot:string;birthRootId:string};
class AssetGuard extends ProcessOwner {
  private requests=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  readonly asset:Promise<GuardAsset>;private cancelled=false;
  constructor(options:GpgHostOptions,signal?:AbortSignal,context?:GpgAgentContext,recoveryContext?:GpgAgentContext){
    const shell=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const create=options.spawn||spawn as SpawnHost;
    const birthRoot=context?hostLedgerPath(context):join(DATA,'gpg-agent-host-owner-'+randomUUID());
    // Windows command lines have a 32767-character ceiling. The fixed program
    // enters the private controller pipe before any caller metadata or frames.
    const bootstrap="$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false,$true);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$program=[Console]::In.ReadLine();if($null -eq $program -or $program.Length -gt 65536){throw 'GPG_GUARD_PROGRAM_SIZE'};& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($program))))";
    const child=create(shell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(bootstrap,'utf16le').toString('base64')],{windowsHide:true,stdio:'pipe',env:{...process.env,PSModulePath:join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules'),PSModuleAnalysisCachePath:'NUL'}});
    super(child);let readyResolve!:(value:GuardAsset)=>void,readyReject!:(reason:unknown)=>void;
    this.asset=new Promise((yes,no)=>{readyResolve=yes;readyReject=no;});this.asset.catch(()=>{});
    let pending='',total=0;
    const fail=(reason:Error)=>{readyReject(reason);for(const request of this.requests.values())request.reject(reason);this.requests.clear();};
    child.stderr.on('data',(bytes:Buffer)=>{total+=bytes.length;if(total>32768)child.stdin.destroy();});
    child.stdout.on('data',(bytes:Buffer)=>{total+=bytes.length;if(total>131072){fail(unavailable('GPG_HOST_ASSET_INVALID'));child.stdin.destroy();return;}pending+=bytes.toString('utf8');let lf;while((lf=pending.indexOf('\n'))>=0){const line=pending.slice(0,lf);pending=pending.slice(lf+1);try{const value=JSON.parse(line);if(value.event==='ASSET_READY'){
        const manifest=manifestSchema.parse(JSON.parse(value.manifest));if(value.sha256!==manifest.sha256||value.size!==manifest.size||!filePin.shape.id.safeParse(value.helperId).success||value.directory!==resolve(options.sourceDirectory||join(ROOT,'.sakura-server/assets/gpg-agent-host')))throw new Error('asset mismatch');
        if(value.birthRoot!==birthRoot||!filePin.shape.id.safeParse(value.birthRootId).success)throw new Error('birth root');readyResolve({manifest,path:join(value.directory,manifest.file),id:value.helperId,birthRoot:value.birthRoot,birthRootId:value.birthRootId});
      }else{const request=this.requests.get(value.id);if(!request)throw new Error('unexpected asset response');this.requests.delete(value.id);request.resolve(value);}}catch{fail(unavailable('GPG_HOST_ASSET_INVALID'));child.stdin.destroy();}}});
    child.once('error',()=>fail(unavailable('GPG_HOST_ASSET_INVALID')));void this.closed.then(()=>{fail(unavailable('GPG_HOST_ASSET_INVALID'));});
    child.stdin.write(Buffer.from(assetGuardScript,'utf8').toString('base64')+'\n'+JSON.stringify({directory:resolve(options.sourceDirectory||join(ROOT,'.sakura-server/assets/gpg-agent-host')),birthRoot,ledgerRoot:context?hostLedgerPath(context):recoveryContext?hostLedgerPath(recoveryContext):undefined,context,parentPid:process.pid,parentImage:process.execPath})+'\n');
    const abort=()=>{this.cancelled=true;child.stdin.destroy();};signal?.addEventListener('abort',abort,{once:true});void this.closed.then(()=>signal?.removeEventListener('abort',abort));if(signal?.aborted)abort();
  }
  async command(action:'check'|'birth'|'lease'|'closed',receipt?:unknown){if(this.actual||this.cancelled)throw unavailable('GPG_HOST_ASSET_INVALID');const id=randomUUID();const response=new Promise<any>((resolve,reject)=>this.requests.set(id,{resolve,reject}));this.child.stdin.write(JSON.stringify({action,id,receipt})+'\n');return boundedWait(response,5000,()=>unavailable('GPG_HOST_ASSET_INVALID'));}
}
export type GpgHostHelperReceipt=z.infer<typeof processPin>&{hostHelperSha256:string;hostSourceSha256:string;birth?:{path:string;fileId:string;sha256:string};actualClose:boolean;exitCode:number|null;signal:NodeJS.Signals|null;physicalSocketClose:boolean|null};
const hostLedgerPath=(context:GpgAgentContext)=>join(DATA,`gpg-agent-host-owner-${z.uuid().parse(context.resource.leaseId)}-${z.uuid().parse(context.owner.runId)}`);
type ListenerClosure={listenerClosure:'not-started'|'unforward-acknowledged'|'ssh-transport-closed';originalListenerCreated:boolean|null;actualSshClose:boolean;actualUnforward:boolean};
function validListenerClosure(value:ListenerClosure){
  if(typeof value.actualSshClose!=='boolean'||typeof value.actualUnforward!=='boolean')return false;
  if(value.listenerClosure==='not-started')return value.originalListenerCreated===false&&value.actualUnforward===false;
  if(value.listenerClosure==='unforward-acknowledged')return value.originalListenerCreated===true&&value.actualUnforward===true&&value.actualSshClose===true;
  return value.listenerClosure==='ssh-transport-closed'&&(value.originalListenerCreated===true||value.originalListenerCreated===null)&&value.actualSshClose===true&&value.actualUnforward===false;
}
class NativeRelay extends ProcessOwner {
  readonly ready:Promise<void>;readonly captured:Promise<z.infer<typeof sourcePins>>;readonly identified:Promise<z.infer<typeof processPin>>;identity?:z.infer<typeof processPin>;physicalClose=false;private events:Record<string,unknown>[]=[];
  constructor(asset:GuardAsset,operation:'capture'|'relay'|'identity'|'dead-check',body:Record<string,unknown>,options:GpgHostOptions){
    const create=options.spawn||spawn as SpawnHost;const child=create(asset.path,[operation],{windowsHide:true,stdio:'pipe'});super(child);
    let readyResolve!:()=>void,readyReject!:(reason:unknown)=>void,captureResolve!:(pins:z.infer<typeof sourcePins>)=>void,captureReject!:(reason:unknown)=>void,identityResolve!:(pin:z.infer<typeof processPin>)=>void,identityReject!:(error:unknown)=>void;
    this.ready=new Promise((yes,no)=>{readyResolve=yes;readyReject=no;});this.captured=new Promise((yes,no)=>{captureResolve=yes;captureReject=no;});this.ready.catch(()=>{});this.captured.catch(()=>{});
    this.identified=new Promise((yes,no)=>{identityResolve=yes;identityReject=no;});this.identified.catch(()=>{});let pending='',total=0;
    const fail=(error:Error)=>{identityReject(error);readyReject(error);captureReject(error);child.stdin.destroy();};
    child.stderr.on('data',(bytes:Buffer)=>{total+=bytes.length;if(total>131072){fail(unavailable('GPG_HOST_PROTOCOL_INVALID'));return;}pending+=bytes.toString('utf8');let lf;while((lf=pending.indexOf('\n'))>=0){const line=pending.slice(0,lf);pending=pending.slice(lf+1);try{const value=JSON.parse(line);this.events.push(value);if(this.events.length>64)throw new Error('event budget');if(value.event==='IDENTITY'){
        const identity=processPin.parse(value.helper);if(identity.pid!==child.pid||identity.image!==asset.path||value.asset?.sha256!==asset.manifest.sha256||value.asset?.size!==asset.manifest.size||value.asset?.file?.id!==asset.id||value.parent?.pid!==process.pid||value.parent?.image!==process.execPath)throw new Error('helper identity');this.identity=identity;identityResolve(identity);
      }else if(value.event==='READY'){if(!this.identity||value.restricted!==true)throw new Error('unattested helper');readyResolve();}
      else if(value.event==='CAPTURED')captureResolve(sourcePins.parse(value.pins));
      else if(value.event==='CLOSED'){if(value.physicalSocketClose!==true||value.closeResult!==0)throw new Error('physical close');this.physicalClose=true;}
      else if(value.event==='ERROR')fail(unavailable(value.code==='SOURCE_W32_FORMAT'||value.code==='SOURCE_FORMAT_UNSUPPORTED'?'GPG_HOST_FORMAT_UNSUPPORTED':'GPG_HOST_SOURCE_REFUSED'));}catch{fail(unavailable('GPG_HOST_PROTOCOL_INVALID'));}}});
    child.once('error',()=>fail(unavailable('GPG_HOST_SOURCE_UNAVAILABLE')));void this.closed.then(()=>{identityReject(unavailable('GPG_HOST_SOURCE_REFUSED'));readyReject(unavailable('GPG_HOST_SOURCE_REFUSED'));captureReject(unavailable('GPG_HOST_SOURCE_REFUSED'));});
    const request=Buffer.from(JSON.stringify({version:1,parentPid:process.pid,parentImage:process.execPath,helperSha256:asset.manifest.sha256,helperSize:asset.manifest.size,...body}));if(request.length>65536)throw unavailable('GPG_HOST_PROTOCOL_INVALID');const header=Buffer.alloc(4);header.writeUInt32BE(request.length);child.stdin.write(Buffer.concat([header,request]));
    if(operation!=='relay')child.stdout.resume();if(operation==='identity'||operation==='dead-check')child.stdin.end();
  }
  authorize(birth:Record<string,unknown>){const bytes=Buffer.from(JSON.stringify(birth));if(bytes.length>65536)throw unavailable('GPG_HOST_PROTOCOL_INVALID');const header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);this.child.stdin.write(Buffer.concat([header,bytes]));}
  get metadata(){return this.events;}
}
export async function captureHostGpgSource(path?:string,signal?:AbortSignal,options:GpgHostOptions={}):Promise<GpgHostSnapshot>{
  signal?.throwIfAborted();if((options.platform||process.platform)!=='win32')throw unavailable('GPG_HOST_FORMAT_UNSUPPORTED','当前宿主平台不支持可核实的 GPG Agent 转发');
  if(!path)throw unavailable('GPG_HOST_SOURCE_UNAVAILABLE');const parsedPath=localPath.safeParse(path);if(!parsedPath.success)throw unavailable('GPG_HOST_FORMAT_UNSUPPORTED');path=parsedPath.data;
  const guard=new AssetGuard(options,signal);let helper:NativeRelay|undefined;
  try{const asset=await boundedWait(guard.asset,10000,()=>unavailable('GPG_HOST_ASSET_INVALID'));await guard.command('check');signal?.throwIfAborted();helper=new NativeRelay(asset,'capture',{path,timeoutSeconds:60},options);const abort=()=>helper?.child.stdin.destroy();signal?.addEventListener('abort',abort,{once:true});
    try{const pins=await boundedWait(helper.captured,13000,()=>unavailable('GPG_HOST_SOURCE_UNAVAILABLE'));const exit=await boundedWait(helper.closed,5000,cleanupFailure);signal?.throwIfAborted();if(exit.code!==0||exit.signal||!helper.physicalClose)throw unavailable('GPG_HOST_SOURCE_REFUSED');const body={version:1 as const,pins,hostHelperSha256:asset.manifest.sha256};return frozen(gpgHostSnapshotSchema.parse({...body,hostSourceSha256:gpgHostSnapshotSha256(body)}));}finally{signal?.removeEventListener('abort',abort);}
  }finally{await helper?.close(options.closeTimeoutMs||5000);await guard.close(options.closeTimeoutMs||5000);}
}

/** A run owns one SSH listener, a pinned asset guard, and at most eight relays. */
export class OwnedGpgForward {
  private readonly snapshot:GpgHostSnapshot;private revoked=false;private binding?:{context:GpgAgentContext;live:object};
  private client?:Client;private clientClosed=false;private listener=false;private listenerRequested=false;private originalListenerCreated=false;private unforwardAcknowledged=false;private remote?:string;private guard?:AssetGuard;
  private helpers=new Set<NativeRelay>();private channels=new Set<Duplex>();private work=new Set<Promise<unknown>>();private closing?:Promise<void>;private started=false;
  private receipts:GpgHostHelperReceipt[]=[];private readonly abort:()=>void;private onConnection?:(_:unknown,accept:()=>Duplex,reject:()=>void)=>void;private admissions=0;private recordedClosed=false;private runTimer?:ReturnType<typeof setTimeout>;private admission?:Promise<void>;private preparedAdmission=false;
  constructor(snapshot:GpgHostSnapshot,private signal:AbortSignal,private options:GpgHostOptions={}){
    this.snapshot=frozen(gpgHostSnapshotSchema.parse(structuredClone(snapshot)));this.abort=()=>{void this.close().catch(()=>{});};signal.addEventListener('abort',this.abort,{once:true});if(signal.aborted)this.abort();
  }
  get hostSourceSha256(){return this.snapshot.hostSourceSha256;}
  get hostHelperSha256(){return this.snapshot.hostHelperSha256;}
  get helperCount(){return this.helpers.size;}
  get streamCount(){return this.channels.size;}
  get helperReceipts(){return structuredClone(this.receipts);}
  bind(context:GpgAgentContext,live:object){
    if(this.revoked||context.resource.hostSourceSha256!==this.hostSourceSha256||context.resource.hostHelperSha256!==this.hostHelperSha256)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');
    if(this.binding){if(this.binding.live===live&&canonicalGpgMetadata(this.binding.context)===canonicalGpgMetadata(context))return;throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');}
    if(this.started)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');
    this.binding={context:frozen(structuredClone(context)),live};
  }
  /** Durable intent is established before the project run journal admits it. */
  async prepareAdmission(context:GpgAgentContext,live:object,signal?:AbortSignal){
    this.bind(context,live);this.signal.throwIfAborted();signal?.throwIfAborted();
    if((this.options.platform||process.platform)!=='win32')throw unavailable('GPG_HOST_FORMAT_UNSUPPORTED');
    if(this.admission)return this.admission;
    const operation=(async()=>{
      this.guard=new AssetGuard(this.options,undefined,this.binding!.context);
      const asset=await boundedWait(this.guard.asset,10000,()=>unavailable('GPG_HOST_ASSET_INVALID'));
      if(asset.manifest.sha256!==this.hostHelperSha256||this.revoked)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');
      await this.guard.command('check');this.signal.throwIfAborted();signal?.throwIfAborted();
      if(this.revoked)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');this.preparedAdmission=true;
    })();
    this.admission=operation;this.work.add(operation);const abort=()=>{void this.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try{await operation;}finally{this.work.delete(operation);signal?.removeEventListener('abort',abort);}
  }
  async start(machines:Machines,vmId:string,context:GpgAgentContext,remoteSourcePath:string,signal?:AbortSignal){
    if(this.revoked||this.started||!this.binding||!this.preparedAdmission||this.binding.live!==machines.live.get(vmId)||canonicalGpgMetadata(context)!==canonicalGpgMetadata(this.binding.context)||remoteSourcePath!==`/run/sakura-gpg-forwards/sources/${z.uuid().parse(context.resource.leaseId)}/agent`)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');
    this.signal.throwIfAborted();signal?.throwIfAborted();this.started=true;this.remote=remoteSourcePath;
    const seconds=z.number().int().min(1).max(300).parse(context.resource.timeoutSeconds);const deadline=performance.now()+seconds*1000;
    this.runTimer=setTimeout(()=>{void this.close().catch(()=>{});},seconds*1000);
    const operation=(async()=>{
      const asset=await this.guard!.asset;if(asset.manifest.sha256!==this.hostHelperSha256||this.revoked)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');await this.guard!.command('check');
      const client=await machines.connect(vmId,10000,signal||this.signal);this.client=client;client.once('close',()=>{this.clientClosed=true;for(const channel of this.channels)channel.destroy();for(const helper of this.helpers)helper.child.stdin.destroy();});client.on('error',()=>{});
      if(this.revoked||machines.live.get(vmId)!==this.binding!.live)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');
      this.onConnection=(raw,accept,reject)=>{
        const info=raw as {socketPath?:string};if(this.revoked||this.admissions>=8||performance.now()>=deadline||info.socketPath!==remoteSourcePath){try{reject();}catch{}return;}this.admissions++;
        let channel:Duplex|undefined,helper:NativeRelay|undefined;
        const open=(async()=>{try{await this.guard!.command('check');if(this.revoked)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');helper=new NativeRelay(asset,'relay',{pins:this.snapshot.pins,context:this.binding!.context,timeoutSeconds:Math.max(1,Math.min(300,Math.ceil((deadline-performance.now())/1000)))},this.options);this.helpers.add(helper);void helper.closed.then(()=>this.helpers.delete(helper!));await boundedWait(helper.identified,5000,()=>unavailable('GPG_HOST_SOURCE_UNAVAILABLE'));if(this.revoked||machines.live.get(vmId)!==this.binding!.live||performance.now()>=deadline)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');
          const birthIdentity={...helper.identity!,hostHelperSha256:this.hostHelperSha256,hostSourceSha256:this.hostSourceSha256};const receipt:GpgHostHelperReceipt={...birthIdentity,actualClose:false,exitCode:null,signal:null,physicalSocketClose:null};this.receipts.push(receipt);const observed=helper;void helper.closed.then(result=>{receipt.actualClose=true;receipt.exitCode=result.code;receipt.signal=result.signal;receipt.physicalSocketClose=observed.physicalClose;});
          const born=await this.guard!.command('birth',{...birthIdentity,context:this.binding!.context});if(born.event!=='BIRTH_RECORDED'||!filePin.shape.id.safeParse(born.fileId).success||!digest.safeParse(born.sha256).success||born.path!==join(asset.birthRoot,born.id+'.json'))throw unavailable('GPG_HOST_PROTOCOL_INVALID');receipt.birth={path:born.path,fileId:born.fileId,sha256:born.sha256};
          if(this.revoked||performance.now()>=deadline)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');helper.authorize({birthRoot:asset.birthRoot,birthRootId:asset.birthRootId,relative:born.id+'.json',fileId:born.fileId,sha256:born.sha256,context:this.binding!.context,hostSourceSha256:this.hostSourceSha256,hostHelperSha256:this.hostHelperSha256});await boundedWait(helper.ready,9000,()=>unavailable('GPG_HOST_SOURCE_UNAVAILABLE'));if(this.revoked||machines.live.get(vmId)!==this.binding!.live||performance.now()>=deadline)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');
          if(this.revoked)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');channel=accept();this.channels.add(channel);const source=helper;
          channel.on('error',()=>source.child.stdin.destroy());channel.once('end',()=>source.child.stdin.end());channel.once('close',()=>{this.channels.delete(channel!);source.child.stdin.destroy();source.child.stdout.resume();});source.child.once('close',()=>channel?.destroy());channel.pipe(source.child.stdin);source.child.stdout.pipe(channel);
        }catch{if(!channel)try{reject();}catch{}channel?.destroy();await helper?.close(this.options.closeTimeoutMs||5000);}})();this.work.add(open);void open.finally(()=>this.work.delete(open)).catch(()=>{});
      };
      client.on('unix connection',this.onConnection);await boundedWait(new Promise<void>((yes,no)=>{try{this.listenerRequested=true;client.openssh_forwardInStreamLocal(remoteSourcePath,error=>{if(error)no(error);else{this.listener=true;this.originalListenerCreated=true;yes();}});}catch(error){no(error);}}),10000,()=>unavailable('GPG_HOST_SOURCE_UNAVAILABLE'));
      if(this.revoked)throw unavailable('PROJECT_IDENTITY_HOST_CHANGED');
    })();this.work.add(operation);try{await operation;}catch(error){throw error;}finally{this.work.delete(operation);}
  }
  close(){
    this.revoked=true;clearTimeout(this.runTimer);this.signal.removeEventListener('abort',this.abort);if(this.client&&this.onConnection)this.client.off('unix connection',this.onConnection);
    for(const channel of this.channels)channel.destroy();for(const helper of this.helpers){helper.child.stdin.destroy();helper.child.stdout.resume();}
    if(this.closing)return this.closing;const timeout=this.options.closeTimeoutMs||5000;
    const operation=(async()=>{
      await boundedWait(Promise.allSettled([...this.work]),timeout,cleanupFailure);
      for(const channel of this.channels)channel.destroy();for(const helper of this.helpers){helper.child.stdin.destroy();helper.child.stdout.resume();}
      await Promise.all([...this.helpers].map(helper=>helper.close(timeout)));
      await Promise.all([...this.channels].map(channel=>channel.closed?Promise.resolve():boundedWait(new Promise<void>(yes=>channel.once('close',yes)),timeout,cleanupFailure)));
      if(this.listener&&this.client&&!this.clientClosed){await boundedWait(new Promise<void>((yes,no)=>{try{this.client!.openssh_unforwardInStreamLocal(this.remote!,error=>{if(error)no(cleanupFailure());else{this.unforwardAcknowledged=true;this.listener=false;yes();}});}catch{no(cleanupFailure());}}),timeout,cleanupFailure);}
      if(this.client&&!this.clientClosed){const closed=new Promise<void>(yes=>this.client!.once('close',yes));this.client.end();await boundedWait(closed,timeout,cleanupFailure);}
      if(this.guard&&!this.recordedClosed){if(!this.binding||this.guard.actual)throw cleanupFailure();const closure:ListenerClosure={listenerClosure:this.unforwardAcknowledged?'unforward-acknowledged':this.listenerRequested?'ssh-transport-closed':'not-started',originalListenerCreated:this.originalListenerCreated?true:this.listenerRequested?null:false,actualSshClose:!!this.client&&this.clientClosed,actualUnforward:this.unforwardAcknowledged};if(!validListenerClosure(closure))throw cleanupFailure();const response=await this.guard.command('closed',{root:hostLedgerPath(this.binding.context),context:this.binding.context,...closure});if(response.event!=='CLOSE_RECORDED')throw cleanupFailure();this.recordedClosed=true;}
      await this.guard?.close(timeout);
    })();this.closing=operation.then(()=>{this.closing=undefined;},error=>{this.closing=undefined;throw error;});return this.closing;
  }
}

/** Recovery examines the original durable lease; a lost JS registry is not proof. */
export async function closeGpgHostLease(context:GpgAgentContext,options:GpgHostOptions={}){
  const timeout=options.closeTimeoutMs||5000;
  if((options.platform||process.platform)!=='win32')throw cleanupFailure();
  const guard=new AssetGuard(options,undefined,undefined,context);let active:NativeRelay|undefined;
  try{
    const asset=await boundedWait(guard.asset,10000,cleanupFailure);
    if(asset.manifest.sha256!==context.resource.hostHelperSha256)throw cleanupFailure();
    const inspect=async()=>{
      const value=await guard.command('lease',{root:hostLedgerPath(context),context});
      if(value.event!=='LEASE_READ'||value.root!==hostLedgerPath(context)||!filePin.shape.id.safeParse(value.rootId).success||!Array.isArray(value.births)||value.births.length>8||value.intent?.record?.version!==1||canonicalGpgMetadata(value.intent.record.context)!==canonicalGpgMetadata(context)||value.intent.record.hostHelperSha256!==asset.manifest.sha256)throw cleanupFailure();
      processPin.parse(value.intent.record.parent);processPin.parse(value.intent.record.guard);
      if(value.closed){const closed=value.closed.record;if(closed?.version!==1||closed.phase!=='closed'||!validListenerClosure(closed)||closed.originalIntentSha256!==value.intent.sha256||canonicalGpgMetadata(closed.context)!==canonicalGpgMetadata(context)||canonicalGpgMetadata(closed.helpers)!==canonicalGpgMetadata(value.births))throw cleanupFailure();}
      else if(value.originalParentDead!==true)throw cleanupFailure();
      const seen=new Set<string>();
      for(const birth of value.births){const record=birth.record;const identity=processPin.parse({pid:record.pid,creationTime:record.creationTime,sid:record.sid,image:record.image});if(identity.image!==asset.path||record.hostHelperSha256!==context.resource.hostHelperSha256||record.hostSourceSha256!==context.resource.hostSourceSha256||canonicalGpgMetadata(record.context)!==canonicalGpgMetadata(context)||!filePin.shape.id.safeParse(birth.fileId).success||!digest.safeParse(birth.sha256).success||seen.has(identity.pid+':'+identity.creationTime))throw cleanupFailure();seen.add(identity.pid+':'+identity.creationTime);}
      return value;
    };
    let ledger=await inspect();
    const until=performance.now()+timeout;
    for(;;){
      let allDead=ledger.originalGuardDead===true;
      for(const birth of ledger.births){
        await guard.command('check');active=new NativeRelay(asset,'dead-check',{identity:birth.record},options);
        const result=await boundedWait(active.closed,timeout,cleanupFailure);if(result.code!==0||result.signal)throw cleanupFailure();
        const observation=active.metadata.find(event=>event.event==='DEAD_CHECK');if(typeof observation?.originalDead!=='boolean')throw cleanupFailure();if(!observation.originalDead)allDead=false;active=undefined;
      }
      if(allDead)break;if(performance.now()>=until)throw cleanupFailure();await new Promise<void>(yes=>setTimeout(yes,50));ledger=await inspect();
    }
    // No process is terminated. PID reuse proves only the original birth ended.
  }catch{throw cleanupFailure();}
  finally{await active?.close(timeout);await guard.close(timeout);}
}
