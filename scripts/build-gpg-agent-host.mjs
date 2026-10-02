import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,lstat,realpath,rename,readdir} from 'node:fs/promises';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tools=join(root,'.tools','gpg-agent-host');
const aclScript=String.raw`$ErrorActionPreference='Stop'
$request=[Console]::In.ReadToEnd()|ConvertFrom-Json
$target=[IO.Path]::GetFullPath($request.path)
if($target -cne $request.path){throw 'GPG_ASSET_PATH'}
$self=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if(-not [IO.Directory]::Exists($target)){
 if(-not $request.create){throw 'GPG_ASSET_DIRECTORY_ABSENT'}
 $acl=New-Object Security.AccessControl.DirectorySecurity
 $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($self)))
 $acl.SetAccessRuleProtection($true,$false)
 foreach($sid in @($self,'S-1-5-18','S-1-5-32-544')){
  $principal=New-Object Security.Principal.SecurityIdentifier($sid)
  $rule=New-Object Security.AccessControl.FileSystemAccessRule($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
 }
 $directory=New-Object IO.DirectoryInfo($target)
 $directory.Create($acl)
}
$item=New-Object IO.DirectoryInfo($target)
if(-not $item.Exists -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'GPG_ASSET_DIRECTORY_TYPE'}
$security=[IO.Directory]::GetAccessControl($target)
$owner=$security.GetOwner([Security.Principal.SecurityIdentifier]).Value
if(@($self,'S-1-5-18','S-1-5-32-544') -notcontains $owner){throw 'GPG_ASSET_DIRECTORY_OWNER'}
foreach($rule in $security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
 if($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly){continue}
 if($rule.AccessControlType -eq 'Allow' -and ([int64]$rule.FileSystemRights -band 0x500D0156) -and @($self,'S-1-5-18','S-1-5-32-544') -notcontains $rule.IdentityReference.Value){throw 'GPG_ASSET_DIRECTORY_WRITABLE'}
}
[Console]::Out.WriteLine('GPG_ASSET_DIRECTORY_VERIFIED')
`;
async function execute(file,args,input,timeout=60000){
 const child=spawn(file,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],...(file.toLowerCase().endsWith('powershell.exe')?{env:{...process.env,PSModulePath:join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules'),PSModuleAnalysisCachePath:join(root,'.data','gpg-host-build-analysis-cache-'+randomUUID())}}:{})});const out=[],err=[];let bytes=0;
 const timer=setTimeout(()=>child.kill(),timeout);
 child.stdout.on('data',b=>{bytes+=b.length;if(bytes>1048576)child.kill();else out.push(b);});
 child.stderr.on('data',b=>{bytes+=b.length;if(bytes>1048576)child.kill();else err.push(b);});
 child.stdin.on('error',()=>{});child.stdin.end(input);
 const result=await new Promise((ok,no)=>{child.once('error',no);child.once('close',(code,signal)=>ok({code,signal,stdout:Buffer.concat(out).toString(),stderr:Buffer.concat(err).toString()}));}).finally(()=>clearTimeout(timer));
 if(result.code!==0||result.signal)throw new Error(`GPG host build command failed (${result.code}/${result.signal}): ${result.stderr.slice(0,4096)}`);
 return result;
}
async function safeDirectory(directory,create){
 const target=resolve(directory),within=relative(root,target);
 if(!within||within.startsWith('..')||isAbsolute(within))throw new Error('GPG asset target must stay inside this workspace');
 let current=dirname(target);
 for(;;){const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(current)!==current)throw new Error('GPG asset ancestor is not canonical');if(current===dirname(current))break;current=dirname(current);}
 const shell=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 await execute(shell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(aclScript,'utf16le').toString('base64')],JSON.stringify({path:target,create}));
 return target;
}
async function preflightTarget(directory){
 const target=resolve(directory),within=relative(root,target);
 if(!within||within.startsWith('..')||isAbsolute(within))throw new Error('GPG asset target must stay inside this workspace');
 // Check the existing target and every existing ancestor before mkdir can
 // traverse them. Missing descendants are allowed only after this check.
 let current=target;
 for(;;){
  let info;try{info=await lstat(current);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(info&&(!info.isDirectory()||info.isSymbolicLink()||await realpath(current)!==current))throw new Error('GPG asset ancestor is not canonical');
  if(current===dirname(current))break;current=dirname(current);
 }
 return target;
}
function manifestCheck(manifest,bytes){
 const keys=['version','platform','architecture','protocol','file','size','sha256','sourceSha256','compilerSha256'];
 if(!manifest||Object.keys(manifest).sort().join(',')!==keys.sort().join(',')||manifest.version!==1||manifest.protocol!==1||manifest.platform!=='win32'||manifest.architecture!=='x64'||manifest.file!=='relay.exe'||!Number.isInteger(manifest.size)||manifest.size<=0||manifest.size>16777216||!['sha256','sourceSha256','compilerSha256'].every(k=>/^[a-f0-9]{64}$/.test(manifest[k]))||bytes.length!==manifest.size||sha(bytes)!==manifest.sha256)throw new Error('GPG host asset manifest/hash differs');
 if(bytes.length<128||bytes.toString('ascii',0,2)!=='MZ')throw new Error('GPG host helper is not PE');
 const pe=bytes.readUInt32LE(0x3c);if(pe<64||pe+26>bytes.length||bytes.readUInt32LE(pe)!==0x4550||bytes.readUInt16LE(pe+4)!==0x8664||bytes.readUInt16LE(pe+24)!==0x20b)throw new Error('GPG host helper architecture differs');
}
async function existing(directory){
 await safeDirectory(directory,false);if((await readdir(directory)).sort().join(',')!=='manifest.json,relay.exe')throw new Error('Unknown GPG asset directory entries');
 for(const name of ['manifest.json','relay.exe']){const info=await lstat(join(directory,name));if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw new Error('GPG asset leaf type differs');}
 const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')),bytes=await readFile(join(directory,'relay.exe'));manifestCheck(manifest,bytes);return{manifest,bytes,identity:await lstat(directory)};
}
async function publish(stage,target){
 let previous;try{await lstat(target);previous=await existing(target);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(previous){
  const now=await lstat(target);if(now.dev!==previous.identity.dev||now.ino!==previous.identity.ino||now.isSymbolicLink())throw new Error('GPG asset directory replaced before publication');
  const backup=join(dirname(target),'.gpg-agent-host-previous-'+randomUUID());
  if(relative(root,backup).startsWith('..')||await realpath(dirname(target))!==dirname(target))throw new Error('GPG asset rename escaped its workspace');
  await rename(target,backup);
  try{await rename(stage,target);}catch(error){try{await lstat(target);}catch(absent){if(absent.code==='ENOENT')await rename(backup,target);}throw error;}
 }else await rename(stage,target);
 return existing(target);
}
export async function prepareGpgAgentHostAssets(targetDirectory=join(root,'.sakura-server','assets','gpg-agent-host')){
 if(process.platform!=='win32')return{supported:false};
 const target=await preflightTarget(targetDirectory);const source=await existing(tools);await mkdir(dirname(target),{recursive:true});
 try{const current=await existing(target);if(current.manifest.sha256===source.manifest.sha256&&current.manifest.sourceSha256===source.manifest.sourceSha256)return{supported:true,...current.manifest};}catch(error){if(error.code!=='ENOENT'&&!String(error.message).includes('GPG_ASSET_DIRECTORY_ABSENT'))throw error;}
 const stage=join(dirname(target),'.gpg-agent-host-stage-'+randomUUID());await safeDirectory(stage,true);
 await writeFile(join(stage,'relay.exe'),source.bytes,{flag:'wx'});await writeFile(join(stage,'manifest.json'),JSON.stringify(source.manifest,null,2)+'\n',{flag:'wx'});
 const published=await publish(stage,target);return{supported:true,...published.manifest};
}
export async function buildGpgAgentHost(){
 if(process.platform!=='win32'){console.log('GPG host transport is unsupported on this build platform.');return{supported:false};}
 if(process.arch!=='x64')throw new Error('GPG host transport requires Windows x64');
 const source=join(root,'native','gpg-agent','windows-relay.cpp'),sourceBytes=await readFile(source),sourceSha256=sha(sourceBytes);
 const compiler=process.env.SAKURA_GPG_AGENT_CXX||process.env.SAKURA_NATIVE_CLIPBOARD_CXX||'g++.exe';
 const machine=await execute(compiler,['-dumpmachine']);if(!/^x86_64-(?:\w+-)*mingw32\s*$/.test(machine.stdout))throw new Error('GPG host transport requires x64 MinGW-w64 C++');
 // The configured build compiler is operator-selected. Its digest records the
 // toolchain; it is not a claim that an arbitrary compiler is authenticated.
 let compilerPath=compiler;if(!isAbsolute(compilerPath)){const found=await execute(join(process.env.SystemRoot||'C:\\Windows','System32','where.exe'),[compiler]);compilerPath=found.stdout.trim().split(/\r?\n/)[0];}
 const compilerSha256=sha(await readFile(compilerPath));await mkdir(dirname(tools),{recursive:true});
 const stage=join(dirname(tools),'.gpg-agent-host-build-'+randomUUID());await safeDirectory(stage,true);
 await execute(compilerPath,['-std=c++20','-O2','-municode','-static','-Wl,--no-insert-timestamp',source,'-o',join(stage,'relay.exe'),'-lws2_32','-liphlpapi','-ladvapi32','-lbcrypt']);
 if(sha(await readFile(source))!==sourceSha256||sha(await readFile(compilerPath))!==compilerSha256)throw new Error('GPG source/compiler changed during build');
 const bytes=await readFile(join(stage,'relay.exe')),manifest={version:1,platform:'win32',architecture:'x64',protocol:1,file:'relay.exe',size:bytes.length,sha256:sha(bytes),sourceSha256,compilerSha256};manifestCheck(manifest,bytes);
 await writeFile(join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});await publish(stage,tools);
 console.log(`Built GPG host transport ${manifest.sha256}`);return{supported:true,...manifest};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildGpgAgentHost();
