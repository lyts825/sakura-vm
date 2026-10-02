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
const fileId=(n:number)=>'1:'+n.toString(16).padStart(32,'0');
const manifest={version:1,platform:'win32',architecture:'x64',protocol:1,file:'relay.exe',size:200,sha256:'c'.repeat(64),sourceSha256:'d'.repeat(64),compilerSha256:'e'.repeat(64)};
function context():GpgAgentContext{
  const snapshot=syntheticGpgHostSnapshot(),identityId=randomUUID();
  return {resource:{version:1,kind:'gpg-agent',leaseId:randomUUID(),brokerSha256:'f'.repeat(64),timeoutSeconds:60,hostSourceSha256:snapshot.hostSourceSha256,hostHelperSha256:snapshot.hostHelperSha256},
    identity:projectIdentitySchema.parse({version:1,phase:'active',registryId:randomUUID(),projectId:'default',identityId,revision:1,uid:20000,gid:20000,account:'skp'+identityId.replaceAll('-','').slice(0,24),home:'/var/lib/sakura-project-homes/'+identityId,directory:'/workspace/owned',homeDevice:'1',homeInode:'2',directoryDevice:'1',directoryInode:'3',networkIsolation:'private'}),
    owner:{kind:'task',runId:randomUUID(),bootId:randomUUID()},sha256:'a'.repeat(64)};
}
const remote=(ctx:GpgAgentContext)=>'/run/sakura-gpg-forwards/sources/'+ctx.resource.leaseId+'/agent';
const tick=()=>new Promise<void>(yes=>setImmediate(yes));
const hostTest=(name:string,body:()=>Promise<void>)=>test(name,{skip:process.platform!=='win32'?'Windows host transport models use Windows process paths':false},body);
class Child extends EventEmitter{
  stdin=new PassThrough();stdout=new PassThrough();stderr=new PassThrough();done=false;autoClose=true;physical=false;
  constructor(readonly pid:number,readonly operation:string,readonly order:string[]){super();this.stdin.once('close',()=>{if(this.autoClose)this.finish();});this.stdin.once('finish',()=>{if(this.autoClose)this.finish();});}
  event(value:unknown){this.stderr.write(JSON.stringify(value)+'\n');}
  finish(code=0,signal:NodeJS.Signals|null=null){if(this.done)return;this.done=true;if(this.operation==='relay'&&this.physical)this.event({event:'CLOSED',physicalSocketClose:true,closeResult:0});this.order.push(this.operation+':actual-close');this.stdout.end();this.stderr.end();this.emit('close',code,signal);}
  asProcess(){return this as unknown as ChildProcessWithoutNullStreams;}
}
class Channel extends Duplex{
  outgoing:Buffer[]=[];delayClose=false;finishDestroy?:()=>void;
  _read(){}
  _write(bytes:Buffer,_encoding:BufferEncoding,callback:(error?:Error|null)=>void){this.outgoing.push(Buffer.from(bytes));callback();}
  _destroy(error:Error|null,callback:(error?:Error|null)=>void){if(this.delayClose)this.finishDestroy=()=>callback(error);else callback(error);}
  send(bytes:Buffer){this.push(bytes);}
}
class Ssh extends EventEmitter{
  forwarded=0;unforwarded=0;done=false;delayUnforward=false;delayClose=false;pendingUnforward?:()=>void;endCount=0;
  constructor(readonly order:string[]){super();}
  openssh_forwardInStreamLocal(_path:string,callback:(error?:Error)=>void){this.forwarded++;this.order.push('ssh:listener');queueMicrotask(()=>callback());}
  openssh_unforwardInStreamLocal(_path:string,callback:(error?:Error)=>void){this.unforwarded++;const finish=()=>{this.order.push('ssh:unforward-callback');callback();};if(this.delayUnforward)this.pendingUnforward=finish;else queueMicrotask(finish);}
  end(){this.endCount++;if(!this.delayClose)queueMicrotask(()=>this.finish());}
  finish(){if(this.done)return;this.done=true;this.order.push('ssh:actual-close');this.emit('close');}
  open(path:string){const channel=new Channel();return new Promise<Channel|null>(yes=>this.emit('unix connection',{socketPath:path},()=>{this.order.push('ssh:accepted');yes(channel);return channel;},()=>{this.order.push('ssh:rejected');yes(null);}));}
}
type Ledger={root:string;rootId:string;intent:any;births:any[];closed:any;guard:Child;parentDead:boolean};
class Model{
  order:string[]=[];children:Child[]=[];ledgers=new Map<string,Ledger>();next=5000;ssh=new Ssh(this.order);live={pid:12};machines={live:new Map([['vm',this.live]]),connect:async()=>this.ssh} as unknown as Machines;
  guardBadHash=false;wrongIdentity=false;ordinary=false;delayBirth=false;releaseBirth?:()=>void;nativeAutoClose=true;guardAutoClose=true;deadOverride?:boolean;replacement=false;rawInputs:Buffer[]=[];
  options:GpgHostOptions={sourceDirectory:directory,platform:'win32',closeTimeoutMs:25,spawn:(file,args)=>this.spawn(file,args).asProcess()};
  spawn(file:string,args:readonly string[]){
    const operation=args[0]==='-NoLogo'?'guard':args[0],child=new Child(this.next++,operation,this.order);child.autoClose=operation==='guard'?this.guardAutoClose:operation==='relay'?this.nativeAutoClose:true;this.children.push(child);
    let pending=Buffer.alloc(0),initial:any,frames=0;
    if(operation==='guard')child.stdin.on('data',(data:Buffer)=>{
      pending=Buffer.concat([pending,data]);let lf;while((lf=pending.indexOf(10))>=0){const line=pending.subarray(0,lf).toString();pending=pending.subarray(lf+1);if(!line.startsWith('{')){assert.ok(Buffer.from(line,'base64').toString().includes('GpgAssetHandles'));continue;}const request=JSON.parse(line);const output=(value:unknown)=>child.stdout.write(JSON.stringify(value)+'\n');
        if(!initial){initial=request;this.order.push('guard:intent');if(request.context){const pin={pid:process.pid,creationTime:'134353495574608003',sid,image:process.execPath};this.ledgers.set(request.birthRoot,{root:request.birthRoot,rootId:fileId(3),intent:{path:join(request.birthRoot,'lease-intent.json'),fileId:fileId(4),sha256:'4'.repeat(64),record:{version:1,context:request.context,parent:pin,guard:{...pin,pid:child.pid,image:file},hostHelperSha256:manifest.sha256}},births:[],closed:null,guard:child,parentDead:false});}
          output({event:'ASSET_READY',manifest:JSON.stringify(manifest),sha256:this.guardBadHash?'9'.repeat(64):manifest.sha256,size:manifest.size,helperId:fileId(1),manifestId:fileId(2),directory:request.directory,birthRoot:request.birthRoot,birthRootId:fileId(3)});
        }else if(request.action==='check'){this.order.push('guard:check');output({event:'ASSET_CHECKED',id:request.id,sha256:manifest.sha256});}
        else if(request.action==='birth'){const record={path:join(initial.birthRoot,request.id+'.json'),fileId:fileId(child.pid+frames++),sha256:'6'.repeat(64),record:request.receipt};this.ledgers.get(initial.birthRoot)!.births.push(record);this.order.push('guard:birth-written');const finish=()=>output({event:'BIRTH_RECORDED',id:request.id,...record,record:undefined});if(this.delayBirth)this.releaseBirth=finish;else finish();}
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
  bridge(signal=new AbortController().signal){return new OwnedGpgForward(syntheticGpgHostSnapshot(),signal,this.options);}
  async started(){const ctx=context(),bridge=this.bridge();await bridge.prepareAdmission(ctx,this.live);bridge.bind(structuredClone(ctx),this.live);await bridge.start(this.machines,'vm',ctx,remote(ctx));return {ctx,bridge};}
}

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
test('unsupported host formats refuse before any helper starts',async()=>{
  const model=new Model();await assert.rejects(captureHostGpgSource('/tmp/agent',undefined,{...model.options,platform:'linux'}),(error:any)=>error.code==='GPG_HOST_FORMAT_UNSUPPORTED');assert.equal(model.children.length,0);
  for(const path of ['/tmp/agent','D:/private/agent','\\\\server\\private\\agent','D:\\private\\..\\agent'])await assert.rejects(captureHostGpgSource(path,undefined,{...model.options,platform:'win32'}),(error:any)=>error.code==='GPG_HOST_FORMAT_UNSUPPORTED');assert.equal(model.children.length,0);
});
hostTest('original SSH transport actual close is explicit listener evidence without a fabricated callback',async()=>{
  const model=new Model(),{ctx,bridge}=await model.started();await model.ssh.open(remote(ctx));model.ssh.finish();await bridge.close();const closed=model.ledgers.values().next().value!.closed.record;assert.equal(model.ssh.unforwarded,0);assert.equal(closed.listenerClosure,'ssh-transport-closed');assert.equal(closed.actualSshClose,true);assert.equal(closed.actualUnforward,false);assert.equal(closed.originalListenerCreated,true);await closeGpgHostLease(ctx,model.options);
  closed.actualUnforward=true;await assert.rejects(closeGpgHostLease(ctx,model.options),(error:any)=>error.code==='PROJECT_IDENTITY_CLEANUP_FAILED');assert.ok(model.children.every(child=>child.done));
});
