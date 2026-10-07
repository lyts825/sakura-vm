/**
 * 模块职责：回归验证模块，围绕 `gpg-agent-host` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `gpg-agent-host`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: snapshot digest binds complete source pins and construction has no process effects; unsupported host formats refuse before any helper starts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Duplex,PassThrough} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import type {Machines} from '../server/machines.ts';
import type {GpgAgentContext} from '../server/gpg-agent-scope.ts';
import {projectIdentitySchema} from '../server/project-identity.ts';
import {OwnedGpgForward,captureHostGpgSource,closeGpgHostLease,gpgHostSnapshotSchema,gpgHostSnapshotSha256,canonicalGpgMetadata,type GpgHostOptions} from '../server/gpg-agent-host.ts';
import {syntheticGpgHostSnapshot} from './gpg-agent-fixture.ts';

// These models exercise controller ordering and physical-close observations.
// They do not claim Windows ACL, TCP credentials, or an actual GnuPG probe.
const directory=resolve('.data/gpg-agent-host-unit-assets');
const sid='S-1-5-21-1-2-3-1001';
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: n: number。
 * 结果：返回分支计算值（`'1:'+n.toString(16).padStart(32,'0')`）。
 * Result: Return the branch-computed value (`'1:'+n.toString(16).padStart(32,'0')`).
 * 协作入口 / Collaborators: `n.toString(16).padStart`, `n.toString`.
 */
const fileId=(n:number)=>'1:'+n.toString(16).padStart(32,'0');
const manifest={version:1,platform:'win32',architecture:'x64',protocol:1,file:'relay.exe',size:200,sha256:'c'.repeat(64),sourceSha256:'d'.repeat(64),compilerSha256:'e'.repeat(64)};
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `resource, identity, owner, sha256`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `resource, identity, owner, sha256`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `syntheticGpgHostSnapshot`, `randomUUID`, `'f'.repeat`, `projectIdentitySchema.parse`.
 */
function context():GpgAgentContext{
  const snapshot=syntheticGpgHostSnapshot(),identityId=randomUUID();
  return {resource:{version:1,kind:'gpg-agent',leaseId:randomUUID(),brokerSha256:'f'.repeat(64),timeoutSeconds:60,hostSourceSha256:snapshot.hostSourceSha256,hostHelperSha256:snapshot.hostHelperSha256},
    identity:projectIdentitySchema.parse({version:1,phase:'active',registryId:randomUUID(),projectId:'default',identityId,revision:1,uid:20000,gid:20000,account:'skp'+identityId.replaceAll('-','').slice(0,24),home:'/var/lib/sakura-project-homes/'+identityId,directory:'/workspace/owned',homeDevice:'1',homeInode:'2',directoryDevice:'1',directoryInode:'3',networkIsolation:'private'}),
    owner:{kind:'task',runId:randomUUID(),bootId:randomUUID()},sha256:'a'.repeat(64)};
}
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: ctx: GpgAgentContext。
 * 结果：返回分支计算值（`'/run/sakura-gpg-forwards/sources/'+ctx.resource.leaseId+'/agent'`）。
 * Result: Return the branch-computed value (`'/run/sakura-gpg-forwards/sources/'+ctx.resource.leaseId+'/agent'`).
 */
const remote=(ctx:GpgAgentContext)=>'/run/sakura-gpg-forwards/sources/'+ctx.resource.leaseId+'/agent';
/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new Promise<void>(yes=>setImmediate(yes))`）。
 * Result: Return the branch-computed value (`new Promise<void>(yes=>setImmediate(yes))`).
 */
const tick=()=>new Promise<void>(yes=>setImmediate(yes));
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: name: string; body: ()=>Promise<void>。
 * 结果：返回分支计算值（`test(name,{skip:process.platform!=='win32'?'Windows host transport models use Wi…`）。
 * Result: Return the branch-computed value (`test(name,{skip:process.platform!=='win32'?'Windows host transport models use Wi…`).
 * 协作入口 / Collaborators: `test`.
 */
const hostTest=(name:string,body:/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
()=>Promise<void>)=>test(name,{skip:process.platform!=='win32'?'Windows host transport models use Windows process paths':false},body);
class Child extends EventEmitter{
  stdin=new PassThrough();stdout=new PassThrough();stderr=new PassThrough();done=false;autoClose=true;physical=false;
  /**
   * 中文功能：初始化测试夹具实例并保存构造输入，后续方法复用该实例状态。
   * English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
   * 输入 / Inputs: pid: number; operation: string; order: string[]。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `super`, `this.stdin.once`.
   */
  constructor(readonly pid:number,readonly operation:string,readonly order:string[]){super();this.stdin.once('close',()=>{if(this.autoClose)this.finish();});this.stdin.once('finish',()=>{if(this.autoClose)this.finish();});}
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: value: unknown。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.stderr.write`, `JSON.stringify`.
   */
  event(value:unknown){this.stderr.write(JSON.stringify(value)+'\n');}
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: code = 0; signal: NodeJS.Signals|null = null。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `this.done`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `this.event`, `this.order.push`, `this.stdout.end`, `this.stderr.end`.
   */
  finish(code=0,signal:NodeJS.Signals|null=null){if(this.done)return;this.done=true;if(this.operation==='relay'&&this.physical)this.event({event:'CLOSED',physicalSocketClose:true,closeResult:0});this.order.push(this.operation+':actual-close');this.stdout.end();this.stderr.end();this.emit('close',code,signal);}
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`this as unknown as ChildProcessWithoutNullStreams`）。
   * Result: Return the branch-computed value (`this as unknown as ChildProcessWithoutNullStreams`).
   */
  asProcess(){return this as unknown as ChildProcessWithoutNullStreams;}
}
class Channel extends Duplex{
  outgoing:Buffer[]=[];delayClose=false;finishDestroy?:/**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  ()=>void;
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  _read(){}
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: bytes: Buffer; _encoding: BufferEncoding; callback: (error?:Error|null)=>void。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.outgoing.push`, `Buffer.from`, `callback`.
   */
  _write(bytes:Buffer,_encoding:BufferEncoding,callback:/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: error: Error|null。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error?:Error|null)=>void){this.outgoing.push(Buffer.from(bytes));callback();}
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: error: Error|null; callback: (error?:Error|null)=>void。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `this.finishDestroy`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `callback`.
   */
  _destroy(error:Error|null,callback:/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: error: Error|null。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error?:Error|null)=>void){if(this.delayClose)this.finishDestroy=/**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`callback(error)`）。
   * Result: Return the branch-computed value (`callback(error)`).
   * 协作入口 / Collaborators: `callback`.
   */
  ()=>callback(error);else callback(error);}
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: bytes: Buffer。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.push`.
   */
  send(bytes:Buffer){this.push(bytes);}
}
class Ssh extends EventEmitter{
  forwarded=0;unforwarded=0;done=false;delayUnforward=false;delayClose=false;pendingUnforward?:/**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  ()=>void;endCount=0;
  /**
   * 中文功能：初始化测试夹具实例并保存构造输入，后续方法复用该实例状态。
   * English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
   * 输入 / Inputs: order: string[]。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `super`.
   */
  constructor(readonly order:string[]){super();}
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _path: string; callback: (error?:Error)=>void。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.order.push`, `queueMicrotask`.
   */
  openssh_forwardInStreamLocal(_path:string,callback:/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: error: Error。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error?:Error)=>void){this.forwarded++;this.order.push('ssh:listener');queueMicrotask(()=>callback());}
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: _path: string; callback: (error?:Error)=>void。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `this.pendingUnforward`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `queueMicrotask`.
   */
  openssh_unforwardInStreamLocal(_path:string,callback:/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: error: Error。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error?:Error)=>void){this.unforwarded++;/**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.order.push`, `callback`.
   */
  const finish=()=>{this.order.push('ssh:unforward-callback');callback();};if(this.delayUnforward)this.pendingUnforward=finish;else queueMicrotask(finish);}
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `queueMicrotask`.
   */
  end(){this.endCount++;if(!this.delayClose)queueMicrotask(()=>this.finish());}
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `this.done`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `this.order.push`, `this.emit`.
   */
  finish(){if(this.done)return;this.done=true;this.order.push('ssh:actual-close');this.emit('close');}
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: path: string。
   * 结果：返回分支计算值（`new Promise<Channel|null>(yes=>this.emit('unix connection',{socketPath:path},()=…`）。
   * Result: Return the branch-computed value (`new Promise<Channel|null>(yes=>this.emit('unix connection',{socketPath:path},()=…`).
   */
  open(path:string){const channel=new Channel();return new Promise<Channel|null>(yes=>this.emit('unix connection',{socketPath:path},()=>{this.order.push('ssh:accepted');yes(channel);return channel;},()=>{this.order.push('ssh:rejected');yes(null);}));}
}
type Ledger={root:string;rootId:string;intent:any;births:any[];closed:any;guard:Child;parentDead:boolean};
class Model{
  order:string[]=[];children:Child[]=[];ledgers=new Map<string,Ledger>();next=5000;ssh=new Ssh(this.order);live={pid:12};machines={live:new Map([['vm',this.live]]),/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`this.ssh`），以 Promise 交付。
   * Result: Return the branch-computed value (`this.ssh`) through a Promise.
   */
  connect:async()=>this.ssh} as unknown as Machines;
  guardBadHash=false;wrongIdentity=false;ordinary=false;delayBirth=false;releaseBirth?:/**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  ()=>void;nativeAutoClose=true;guardAutoClose=true;deadOverride?:boolean;replacement=false;rawInputs:Buffer[]=[];
  options:GpgHostOptions={sourceDirectory:directory,platform:'win32',closeTimeoutMs:25,/**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: file; args。
   * 结果：返回分支计算值（`this.spawn(file,args).asProcess()`）。
   * Result: Return the branch-computed value (`this.spawn(file,args).asProcess()`).
   * 协作入口 / Collaborators: `this.spawn(file,args).asProcess`, `this.spawn`.
   */
  spawn:(file,args)=>this.spawn(file,args).asProcess()};
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: file: string; args: readonly string[]。
   * 结果：返回分支计算值（`child`）。
   * Result: Return the branch-computed value (`child`).
   * 状态影响 / State effects: `child.autoClose`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `this.children.push`, `Buffer.alloc`, `child.stdin.on`.
   */
  spawn(file:string,args:readonly string[]){
    const operation=args[0]==='-NoLogo'?'guard':args[0],child=new Child(this.next++,operation,this.order);child.autoClose=operation==='guard'?this.guardAutoClose:operation==='relay'?this.nativeAutoClose:true;this.children.push(child);
    let pending=Buffer.alloc(0),initial:any,frames=0;
    if(operation==='guard')child.stdin.on('data',(data:Buffer)=>{
      pending=Buffer.concat([pending,data]);let lf;while((lf=pending.indexOf(10))>=0){const line=pending.subarray(0,lf).toString();pending=pending.subarray(lf+1);if(!line.startsWith('{')){assert.ok(Buffer.from(line,'base64').toString().includes('GpgAssetHandles'));continue;}const request=JSON.parse(line);/**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: value: unknown。
       * 结果：返回分支计算值（`child.stdout.write(JSON.stringify(value)+'\n')`）。
       * Result: Return the branch-computed value (`child.stdout.write(JSON.stringify(value)+'\n')`).
       * 协作入口 / Collaborators: `child.stdout.write`, `JSON.stringify`.
       */
      const output=(value:unknown)=>child.stdout.write(JSON.stringify(value)+'\n');
        if(!initial){initial=request;this.order.push('guard:intent');if(request.context){const pin={pid:process.pid,creationTime:'134353495574608003',sid,image:process.execPath};this.ledgers.set(request.birthRoot,{root:request.birthRoot,rootId:fileId(3),intent:{path:join(request.birthRoot,'lease-intent.json'),fileId:fileId(4),sha256:'4'.repeat(64),record:{version:1,context:request.context,parent:pin,guard:{...pin,pid:child.pid,image:file},hostHelperSha256:manifest.sha256}},births:[],closed:null,guard:child,parentDead:false});}
          output({event:'ASSET_READY',manifest:JSON.stringify(manifest),sha256:this.guardBadHash?'9'.repeat(64):manifest.sha256,size:manifest.size,helperId:fileId(1),manifestId:fileId(2),directory:request.directory,birthRoot:request.birthRoot,birthRootId:fileId(3)});
        }else if(request.action==='check'){this.order.push('guard:check');output({event:'ASSET_CHECKED',id:request.id,sha256:manifest.sha256});}
        else if(request.action==='birth'){const record={path:join(initial.birthRoot,request.id+'.json'),fileId:fileId(child.pid+frames++),sha256:'6'.repeat(64),record:request.receipt};this.ledgers.get(initial.birthRoot)!.births.push(record);this.order.push('guard:birth-written');/**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`output({event:'BIRTH_RECORDED',id:request.id,...record,record:undefined})`）。
         * Result: Return the branch-computed value (`output({event:'BIRTH_RECORDED',id:request.id,...record,record:undefined})`).
         * 协作入口 / Collaborators: `output`.
         */
        const finish=()=>output({event:'BIRTH_RECORDED',id:request.id,...record,record:undefined});if(this.delayBirth)this.releaseBirth=finish;else finish();}
        else if(request.action==='closed'){this.order.push('guard:closed-record');const ledger=this.ledgers.get(request.receipt.root);assert.ok(ledger);assert.ok(this.children.filter(item=>item.operation==='relay').every(item=>item.done));assert.ok(!this.ssh.forwarded||this.ssh.done);const {listenerClosure,originalListenerCreated,actualSshClose,actualUnforward}=request.receipt;ledger.closed={record:{version:1,phase:'closed',context:request.receipt.context,helpers:structuredClone(ledger.births),originalIntentSha256:ledger.intent.sha256,listenerClosure,originalListenerCreated,actualSshClose,actualUnforward}};output({event:'CLOSE_RECORDED',id:request.id});}
        else if(request.action==='lease'){const ledger=this.ledgers.get(request.receipt.root);if(!ledger){child.finish(1);continue;}output({event:'LEASE_READ',id:request.id,root:ledger.root,rootId:ledger.rootId,intent:ledger.intent,births:ledger.births,closed:ledger.closed,originalParentDead:ledger.parentDead,originalGuardDead:ledger.guard.done});}
      }
    });
    else child.stdin.on('data',(data:Buffer)=>{
      pending=Buffer.concat([pending,data]);while(frames<(operation==='relay'?2:1)&&pending.length>=4&&pending.length>=pending.readUInt32BE()+4){const count=pending.readUInt32BE(),request=JSON.parse(pending.subarray(4,count+4).toString());pending=pending.subarray(count+4);frames++;
        if(frames===1){initial=request;this.order.push(operation+':identified');child.event({event:'IDENTITY',helper:{pid:this.wrongIdentity?child.pid+1:child.pid,creationTime:'134353495574608003',sid,image:file},parent:{pid:process.pid,image:process.execPath},asset:{sha256:manifest.sha256,size:manifest.size,file:{id:fileId(1)}}});
          if(operation==='capture'){if(this.ordinary){child.event({event:'ERROR',code:'SOURCE_NOT_RESTRICTED'});child.finish(1);}else{child.event({event:'READY',restricted:true});child.event({event:'CAPTURED',pins:syntheticGpgHostSnapshot().pins});child.event({event:'CLOSED',physicalSocketClose:true,closeResult:0});child.finish();}}
          else if(operation==='dead-check'){const original=this.children.find(item=>item.pid===request.identity.pid);child.event({event:'DEAD_CHECK',originalDead:this.deadOverride??original?.done??true});child.finish();}
        }else{this.order.push('relay:birth-authorized');assert.ok(this.ledgers.get(request.birthRoot)?.births.some(item=>item.path.endsWith(request.relative)));if(this.replacement){child.event({event:'ERROR',code:'SOURCE_SNAPSHOT_CHANGED'});child.finish(1);}else{child.physical=true;child.event({event:'BIRTH_VERIFIED',beforeSourceConnect:true,beforeNonce:true});this.order.push('relay:nonce-model');child.event({event:'READY',restricted:true});}}
      }
      if(frames===2&&pending.length){this.rawInputs.push(Buffer.from(pending));pending=Buffer.alloc(0);}
    });
    return child;
  }
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: signal = new AbortController().signal。
   * 结果：返回分支计算值（`new OwnedGpgForward(syntheticGpgHostSnapshot(),signal,this.options)`）。
   * Result: Return the branch-computed value (`new OwnedGpgForward(syntheticGpgHostSnapshot(),signal,this.options)`).
   * 协作入口 / Collaborators: `syntheticGpgHostSnapshot`.
   */
  bridge(signal=new AbortController().signal){return new OwnedGpgForward(syntheticGpgHostSnapshot(),signal,this.options);}
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `ctx, bridge`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `ctx, bridge`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `context`, `this.bridge`, `bridge.prepareAdmission`, `bridge.bind`.
   */
  async started(){const ctx=context(),bridge=this.bridge();await bridge.prepareAdmission(ctx,this.live);bridge.bind(structuredClone(ctx),this.live);await bridge.start(this.machines,'vm',ctx,remote(ctx));return {ctx,bridge};}
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: snapshot digest binds complete source pins and construction has no process effects
 * 状态影响 / State effects: `snapshot.pins.descendants[0].owner`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syntheticGpgHostSnapshot`, `assert.equal`, `gpgHostSnapshotSchema.safeParse`, `structuredClone`.
 * 检查边界 / Checked boundaries: `assert.equal(model.children.length,0)`; `assert.equal(bridge.hostSourceSha256,original)`.
 */
test('snapshot digest binds complete source pins and construction has no process effects',async()=>{
  const model=new Model(),snapshot=syntheticGpgHostSnapshot(),bridge=new OwnedGpgForward(snapshot,new AbortController().signal,model.options);
  assert.equal(model.children.length,0);const original=bridge.hostSourceSha256;snapshot.pins.descendants[0].owner='S-1-5-18';assert.equal(bridge.hostSourceSha256,original);assert.equal(gpgHostSnapshotSchema.safeParse(snapshot).success,false);
  const untouched=syntheticGpgHostSnapshot();for(const change of [(s:any)=>s.pins.ancestors[0].aclSha256='1'.repeat(64),(s:any)=>s.pins.descendants[0].attributes=128,(s:any)=>s.pins.process.creationTime='134353495574608004']){const changed=structuredClone(untouched);change(changed);const {hostSourceSha256,...body}=changed;assert.notEqual(gpgHostSnapshotSha256(body),hostSourceSha256);}
  assert.equal(canonicalGpgMetadata({b:2,a:1}),canonicalGpgMetadata({a:1,b:2}));await bridge.close();assert.equal(model.children.length,0);
});
hostTest('durable admission precedes journal use and start reuses it with exact binding',async()=>{
  const model=new Model(),ctx=context(),bridge=model.bridge();await assert.rejects(bridge.start(model.machines,'vm',ctx,remote(ctx)));
  await Promise.all([bridge.prepareAdmission(ctx,model.live),bridge.prepareAdmission(structuredClone(ctx),model.live)]);assert.equal(model.children.length,1);assert.equal(model.ledgers.size,1);assert.equal(model.ssh.forwarded,0);
  assert.throws(()=>bridge.bind(ctx,{}));const changed=structuredClone(ctx);changed.owner.bootId=randomUUID();assert.throws(()=>bridge.bind(changed,model.live));
  await assert.rejects(bridge.start(model.machines,'vm',ctx,remote(ctx)+'x'));await bridge.start(model.machines,'vm',ctx,remote(ctx));assert.equal(model.children.length,1);assert.equal(model.ssh.forwarded,1);await assert.rejects(bridge.start(model.machines,'vm',ctx,remote(ctx)));await bridge.close();assert.throws(()=>bridge.bind(ctx,model.live));
});
hostTest('admitted but unstarted owner has durable physical cleanup recoverable with no RAM owner',async()=>{
  const model=new Model(),ctx=context(),bridge=model.bridge();await bridge.prepareAdmission(ctx,model.live);await bridge.close();assert.equal(model.ssh.forwarded,0);const closed=model.ledgers.values().next().value!.closed.record;assert.equal(closed.phase,'closed');assert.equal(closed.listenerClosure,'not-started');assert.equal(closed.actualSshClose,false);assert.equal(closed.actualUnforward,false);assert.equal(closed.originalListenerCreated,false);await closeGpgHostLease(ctx,model.options);assert.ok(model.children.every(child=>child.done));
});
hostTest('source capture requires restricted success, helper actual close, and asset guard actual close',async()=>{
  const model=new Model(),result=await captureHostGpgSource('D:\\private\\e',undefined,model.options);assert.equal(result.hostSourceSha256,syntheticGpgHostSnapshot().hostSourceSha256);assert.ok(model.children.every(child=>child.done));
  const ordinary=new Model();ordinary.ordinary=true;await assert.rejects(captureHostGpgSource('D:\\private\\e',undefined,ordinary.options),(error:any)=>error.code==='GPG_HOST_SOURCE_REFUSED');assert.ok(ordinary.children.every(child=>child.done));
  const invalid=new Model();invalid.guardBadHash=true;await assert.rejects(captureHostGpgSource('D:\\private\\e',undefined,invalid.options));assert.equal(invalid.children.length,1);assert.ok(invalid.children.every(child=>child.done));
  await assert.rejects(captureHostGpgSource('/tmp/agent',undefined,{...model.options,platform:'linux'}),(error:any)=>error.code==='GPG_HOST_FORMAT_UNSUPPORTED');
});
hostTest('helper birth is durable before nonce/SSH acceptance and raw binary NUL is unchanged in both directions',async()=>{
  const model=new Model(),{ctx,bridge}=await model.started();model.delayBirth=true;let accepted=false;const opening=model.ssh.open(remote(ctx)).then(value=>{accepted=true;return value;});await tick();assert.equal(accepted,false);assert.ok(model.order.includes('guard:birth-written'));assert.equal(model.order.includes('relay:birth-authorized'),false);model.releaseBirth!();const channel=await opening;assert.ok(channel);
  const raw=Buffer.from([68,32,0,255,37,48,65,10]);channel.send(raw);await tick();assert.deepEqual(Buffer.concat(model.rawInputs),raw);const helper=model.children.find(child=>child.operation==='relay')!;helper.stdout.write(raw);await tick();assert.deepEqual(Buffer.concat(channel.outgoing),raw);
  assert.ok(model.order.indexOf('guard:birth-written')<model.order.indexOf('relay:nonce-model'));assert.ok(model.order.indexOf('relay:nonce-model')<model.order.indexOf('ssh:accepted'));await bridge.close();const receipt=bridge.helperReceipts[0];assert.equal(receipt.actualClose,true);assert.equal(receipt.exitCode,0);assert.equal(receipt.signal,null);assert.equal(receipt.physicalSocketClose,true);receipt.exitCode=99;assert.equal(bridge.helperReceipts[0].exitCode,0);
});
hostTest('helper identity mismatch and replaced captured source refuse SSH acceptance',async()=>{
  for(const field of ['wrongIdentity','replacement'] as const){const model=new Model(),{ctx,bridge}=await model.started();model[field]=true;assert.equal(await model.ssh.open(remote(ctx)),null);await bridge.close();assert.equal(model.order.includes('ssh:accepted'),false);if(field==='wrongIdentity')assert.equal(model.order.includes('guard:birth-written'),false);else{assert.equal(bridge.helperReceipts[0].exitCode,1);assert.equal(bridge.helperReceipts[0].physicalSocketClose,false);}}
});
hostTest('eight helper budget and revocation preserve neighboring owned stream',async()=>{
  const model=new Model(),{ctx,bridge}=await model.started();const channels=await Promise.all(Array.from({length:8},()=>model.ssh.open(remote(ctx))));assert.ok(channels.every(Boolean));assert.equal(await model.ssh.open(remote(ctx)),null);assert.equal(model.children.filter(child=>child.operation==='relay').length,8);
  const neighborModel=new Model(),neighbor=await neighborModel.started(),other=await neighborModel.ssh.open(remote(neighbor.ctx));await bridge.close();assert.equal(other!.destroyed,false);assert.equal(neighbor.bridge.streamCount,1);assert.equal(bridge.helperCount,0);assert.equal(bridge.streamCount,0);await neighbor.bridge.close();
});
hostTest('close waits actual helper exit before unforward/SSH/ledger, and a failed close can retry',async()=>{
  const model=new Model();model.nativeAutoClose=false;const {ctx,bridge}=await model.started();await model.ssh.open(remote(ctx));const helper=model.children.find(child=>child.operation==='relay')!;await assert.rejects(bridge.close(),(error:any)=>error.code==='PROJECT_IDENTITY_CLEANUP_FAILED');assert.equal(model.ssh.unforwarded,0);assert.equal(model.order.includes('guard:closed-record'),false);assert.equal(bridge.helperReceipts[0].actualClose,false);helper.finish();await bridge.close();assert.ok(model.order.indexOf('relay:actual-close')<model.order.indexOf('ssh:unforward-callback'));assert.ok(model.order.indexOf('ssh:actual-close')<model.order.indexOf('guard:closed-record'));assert.ok(model.children.every(child=>child.done));
});
hostTest('unforward callback, SSH close and asset guard close each remain independent physical gates',async()=>{
  for(const gate of ['unforward','ssh','guard'] as const){const model=new Model(),{ctx,bridge}=await model.started();await model.ssh.open(remote(ctx));if(gate==='unforward')model.ssh.delayUnforward=true;else if(gate==='ssh')model.ssh.delayClose=true;else model.children.find(child=>child.operation==='guard')!.autoClose=false;
    await assert.rejects(bridge.close(),(error:any)=>error.code==='PROJECT_IDENTITY_CLEANUP_FAILED');if(gate==='unforward'){assert.equal(model.ssh.done,false);model.ssh.delayUnforward=false;model.ssh.pendingUnforward!();}else if(gate==='ssh'){assert.equal(model.order.includes('guard:closed-record'),false);model.ssh.finish();}else model.children.find(child=>child.operation==='guard')!.finish();await bridge.close();assert.ok(model.children.every(child=>child.done));}
});
hostTest('restart recovery fails closed for absent ledger, live original parent without close marker and live helper',async()=>{
  const absent=new Model();await assert.rejects(closeGpgHostLease(context(),absent.options),(error:any)=>error.code==='PROJECT_IDENTITY_CLEANUP_FAILED');assert.ok(absent.children.every(child=>child.done));
  const model=new Model(),{ctx,bridge}=await model.started();await model.ssh.open(remote(ctx));await bridge.close();const ledger=model.ledgers.values().next().value!;const closed=ledger.closed;ledger.closed=null;await assert.rejects(closeGpgHostLease(ctx,model.options));ledger.closed=closed;model.deadOverride=false;await assert.rejects(closeGpgHostLease(ctx,model.options));model.deadOverride=true;await closeGpgHostLease(ctx,model.options);assert.ok(model.children.every(child=>child.done));
  ledger.intent.record.context.owner.bootId=randomUUID();await assert.rejects(closeGpgHostLease(ctx,model.options));assert.ok(model.children.every(child=>child.done));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unsupported host formats refuse before any helper starts
 * 协作入口 / Collaborators: `assert.rejects`, `captureHostGpgSource`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(captureHostGpgSource('/tmp/agent',undefined,{...model.options,platform:'linux'}),(error:any)=>error.code==='GPG_HOS…`; `assert.equal(model.children.length,0)`.
 */
test('unsupported host formats refuse before any helper starts',async()=>{
  const model=new Model();await assert.rejects(captureHostGpgSource('/tmp/agent',undefined,{...model.options,platform:'linux'}),(error:any)=>error.code==='GPG_HOST_FORMAT_UNSUPPORTED');assert.equal(model.children.length,0);
  for(const path of ['/tmp/agent','D:/private/agent','\\\\server\\private\\agent','D:\\private\\..\\agent'])await assert.rejects(captureHostGpgSource(path,undefined,{...model.options,platform:'win32'}),(error:any)=>error.code==='GPG_HOST_FORMAT_UNSUPPORTED');assert.equal(model.children.length,0);
});
hostTest('original SSH transport actual close is explicit listener evidence without a fabricated callback',async()=>{
  const model=new Model(),{ctx,bridge}=await model.started();await model.ssh.open(remote(ctx));model.ssh.finish();await bridge.close();const closed=model.ledgers.values().next().value!.closed.record;assert.equal(model.ssh.unforwarded,0);assert.equal(closed.listenerClosure,'ssh-transport-closed');assert.equal(closed.actualSshClose,true);assert.equal(closed.actualUnforward,false);assert.equal(closed.originalListenerCreated,true);await closeGpgHostLease(ctx,model.options);
  closed.actualUnforward=true;await assert.rejects(closeGpgHostLease(ctx,model.options),(error:any)=>error.code==='PROJECT_IDENTITY_CLEANUP_FAILED');assert.ok(model.children.every(child=>child.done));
});
