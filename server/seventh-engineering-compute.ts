/** 六个工程包的固定计算动作及起步模板。执行型动作必须交给专属本体会话。 */
import { boundedInput, checkpoint, obj, reject, type R } from './seventh-engineering-common.ts';
import { scheduleAction } from './seventh-engineering-schedule.ts';
import { dependencyAction } from './seventh-engineering-dependency.ts';
import { replicaAction } from './seventh-engineering-replica.ts';
import { protocolAction } from './seventh-engineering-protocol.ts';
import { extensionAction } from './seventh-engineering-extension.ts';
import { virtualizationAction } from './seventh-engineering-virtualization.ts';
export const SEVENTH_ENGINEERING_ACTIONS:Record<string,string[]>={
  'schedule-semantics-lab':['calendars.validate','clocks.resolve','rules.validate','rules.expand','policies.validate','workloads.validate','scenarios.preview','simulations.run','checks.evaluate','checks.compare','checks.explain'],
  'extension-authoring-studio':['manifests.validate','interfaces.preview','toolchains.inspect','inspections.inspect','inspections.explain','cases.validate','trials.run','signatures.prepareEnvelope','signatures.importSignature','signatures.verify','bundles.validate','catalogs.compose','catalogs.validate','catalogs.exportCatalog'],
  'dependency-resolution-studio':['catalogs.validate','roots.validate','platforms.validate','constraints.compile','constraints.explain','candidates.preview','solves.run','proofs.checkAssignment','proofs.explainConflict','proofs.coverage','comparisons.compare','locks.validate'],
  'protocol-state-lab':['grammars.validate','guards.validate','targets.inspect','messages.encode','messages.decode','messages.validate','generators.generate','generators.expand','machines.validate','scenarios.preview','properties.evaluate','properties.explain','properties.compare','traces.decode','traces.readFrames','reductions.reduce'],
  'replica-sync-lab':['models.validate','schemas.validate','replicas.validate','clocks.validate','operations.compose','channels.validate','policies.validate','scenarios.preview','runs.run','judgments.evaluate','judgments.compare','judgments.explain','snapshots.capture','conflicts.inspect','conflicts.proposeResolution','comparisons.compare'],
  'service-virtualization-studio':['contracts.validate','matchers.validate','states.validate','transitions.validate','faults.validate','packages.validate','scenarios.preview','assertions.evaluate','assertions.explain','assertions.compare','traffic.coverage','sessions.checkpoint','sessions.fork'],
};
export const SEVENTH_ENGINEERING_VM_ACTIONS:Record<string,{profile:string;consumer:string;protocol:string;actions:string[]}>={
  'schedule-semantics-lab':{profile:'schedule-probe',consumer:'schedlab-harness',protocol:'sakura-seventh-schedule/1',actions:['harness.preview','harness.start','harness.cancel','harness.reconcile']},
  'extension-authoring-studio':{profile:'extension-build',consumer:'extforge-builds',protocol:'sakura-seventh-extension/1',actions:['builds.preview','builds.start','builds.cancel','builds.reconcile']},
  'protocol-state-lab':{profile:'protocol-scenario',consumer:'protostate-runs',protocol:'sakura-seventh-protocol/1',actions:['runs.preview','runs.start','runs.cancel','runs.reconcile']},
  'service-virtualization-studio':{profile:'multi-service',consumer:'virtservice-sessions',protocol:'sakura-seventh-virtualization/1',actions:['sessions.preview','sessions.start','sessions.cancel','sessions.reconcile']},
};
type Template={id:string;name:string;description:string;domain:string;method:string;input:R};
const hash='0'.repeat(64);
const schedule={start:'2026-03-08T06:00:00Z',end:'2026-03-08T09:00:00Z',timeZone:'America/New_York',rule:{type:'cron',expression:'30 2 * * *',gap:'skip',repeated:'both'}};
const catalog=[{name:'app',version:'1.0.0',sha256:hash,dependencies:{core:'>=1.0.0 <2.0.0'}},{name:'core',version:'1.0.0',sha256:hash},{name:'core',version:'1.1.0',sha256:hash}];
const operation=(replica:string,sequence:number,value:number)=>({id:replica+':'+sequence,replica,sequence,key:'count',kind:'increment',value,predecessors:[]});
const services=[{id:'orders',initialState:{confirmed:false},rules:[{id:'place',method:'POST',path:'/orders',priority:0,whenState:{},response:{status:201,body:{accepted:true}},set:{confirmed:true},calls:[{service:'stock',method:'POST',path:'/reserve',body:{sku:'demo'}}],delayMs:0,disconnect:false}]},{id:'stock',initialState:{reserved:false},rules:[{id:'reserve',method:'POST',path:'/reserve',priority:0,whenState:{},response:{status:200,body:{reserved:true}},set:{reserved:true},calls:[],delayMs:0,disconnect:false}]}];
const program=(expression:string)=>`static unsigned char input[32768]; static unsigned char output[128]; int alloc(int n){return n>=0&&n<=32768?(int)input:0;} int run(int p,int n){unsigned int value=${expression}; char digits[16]; int k=0; do{digits[k++]=(char)('0'+value%10);value/=10;}while(value&&k<15); const char head[]={123,34,118,97,108,117,101,34,58,0}; int at=4; for(int j=0;head[j];j++)output[at++]=head[j]; while(k)output[at++]=digits[--k];output[at++]='}';unsigned int len=(unsigned int)(at-4);for(int j=0;j<4;j++)output[j]=(unsigned char)(len>>(8*j));return (int)output;}`;
export const SEVENTH_ENGINEERING_TEMPLATES:Record<string,Template[]>={
  'schedule-semantics-lab':[
    {id:'dst-daily',name:'跨时区日报',description:'固定窗口中的缺失本地时刻与顺延差异。',domain:'rules',method:'expand',input:schedule},
    {id:'overlap-retry',name:'长任务与重试',description:'30秒周期、45秒任务和固定失败的有限模型。',domain:'simulations',method:'run',input:{start:'2026-10-26T00:00:00Z',end:'2026-10-26T00:03:00Z',timeZone:'UTC',rule:{type:'interval',everyMs:30000},policy:{overlap:'queue',maxRetries:2,backoffMs:1000},workload:{durationMs:45000,failAttempts:2}}},
    {id:'real-clock',name:'真实短周期探针',description:'在专属客户机记录单调时钟、墙上时钟与实际触发。',domain:'harness',method:'start',input:{protocol:'sakura-seventh-schedule/1',intervalMs:50,count:5,durationMs:10,overlap:'queue',concurrency:1}},
  ],
  'extension-authoring-studio':[
    {id:'byte-summary',name:'JSON字节摘要',description:'实际编译固定C源码，返回输入字节数。',domain:'builds',method:'start',input:{protocol:'sakura-seventh-extension/1',source:program('(unsigned int)n')}},
    {id:'bounded-counter',name:'有界计数表单',description:'编译常量边界示例并检查ABI和产物。',domain:'builds',method:'start',input:{protocol:'sakura-seventh-extension/1',source:program('32768u')}},
    {id:'metadata-classifier',name:'元数据基线',description:'编译纯计算输出并用独立用例校验与外部签名。',domain:'builds',method:'start',input:{protocol:'sakura-seventh-extension/1',source:program('(unsigned int)(n>0)')}},
  ],
  'dependency-resolution-studio':[
    {id:'minimal-update',name:'最小升级',description:'从固定元数据比较旧锁偏好。',domain:'solves',method:'run',input:{packages:catalog,roots:{app:'1.0.0'},oldLock:{app:'1.0.0',core:'1.0.0'},platform:{os:'linux',arch:'x86_64'}}},
    {id:'peer-conflict',name:'同伴冲突',description:'两个根约束的不可满足解释。',domain:'proofs',method:'explainConflict',input:{packages:[{name:'a',version:'1.0.0',sha256:hash,peerDependencies:{core:'1.0.0'}},{name:'b',version:'1.0.0',sha256:hash,peerDependencies:{core:'1.1.0'}},...catalog],roots:{a:'1.0.0',b:'1.0.0'}}},
    {id:'platform-boundary',name:'平台缺项',description:'仅Linux制品不能填充Windows目标。',domain:'solves',method:'run',input:{packages:[{name:'native',version:'1.0.0',sha256:hash,os:['linux']}],roots:{native:'1.0.0'},platform:{os:'windows',arch:'x86_64'}}},
  ],
  'protocol-state-lab':[
    {id:'framed-message',name:'长度前缀消息',description:'显式大小端、字节长度和偏移。',domain:'messages',method:'encode',input:{fields:[{name:'length',type:'u16',endian:'be'},{name:'payload',type:'bytes',lengthFrom:'length',maxLength:100}],values:{length:3,payload:'YWJj'}}},
    {id:'handshake',name:'握手状态',description:'固定轨迹的合法与非法转换。',domain:'properties',method:'evaluate',input:{machine:{initial:'closed',states:['closed','open','done'],transitions:[{from:'closed',event:'hello',to:'open'},{from:'open',event:'close',to:'done'}]},events:['hello','close']}},
    {id:'fragmented-tcp',name:'真实分片TCP',description:'专属客户机固定二进制对端与分块发送。',domain:'runs',method:'start',input:{protocol:'sakura-seventh-protocol/1',messages:['YWJj','ZGVm'],replies:['T0s=','T0s='],fragmentBytes:1}},
  ],
  'replica-sync-lab':[
    {id:'concurrent-register',name:'并发修改',description:'保留两个并发值及人工冲突。',domain:'runs',method:'run',input:{replicas:['a','b'],policy:'manual',operations:[{id:'a:1',replica:'a',sequence:1,key:'title',kind:'set',value:'A',predecessors:[]},{id:'b:1',replica:'b',sequence:1,key:'title',kind:'set',value:'B',predecessors:[]}]}},
    {id:'duplicate-counter',name:'重复投递计数',description:'同一操作重复投递只计一次。',domain:'runs',method:'run',input:{replicas:['a','b'],policy:'counter',operations:[operation('a',1,2),operation('b',1,3)],deliveries:[{to:'a',operationId:'a:1'},{to:'a',operationId:'a:1'},{to:'a',operationId:'b:1'},{to:'b',operationId:'b:1'},{to:'b',operationId:'a:1'}]}},
    {id:'offline-pending',name:'长期离线恢复',description:'未交付操作保留不确定收敛结论。',domain:'runs',method:'run',input:{replicas:['a','b'],policy:'counter',operations:[operation('a',1,1)],deliveries:[{to:'a',operationId:'a:1'}]}},
  ],
  'service-virtualization-studio':[
    {id:'order-stock',name:'下单与库存',description:'两个真实内部HTTP服务及联合状态快照。',domain:'sessions',method:'start',input:{protocol:'sakura-seventh-virtualization/1',services,requests:[{service:'orders',method:'POST',path:'/orders',body:{sku:'demo'}}],seed:1}},
    {id:'identity-profile',name:'身份与资料',description:'虚构令牌及固定服务响应，不接入真实身份系统。',domain:'sessions',method:'start',input:{protocol:'sakura-seventh-virtualization/1',services:[{id:'identity',initialState:{},rules:[{id:'token',method:'POST',path:'/token',priority:0,whenState:{},response:{status:200,body:{token:'fictional'}},set:{},calls:[],delayMs:0,disconnect:false}]},{id:'profile',initialState:{},rules:[{id:'profile',method:'GET',path:'/me',priority:0,whenState:{},response:{status:200,body:{name:'sample'}},set:{},calls:[],delayMs:0,disconnect:false}]}],requests:[{service:'identity',method:'POST',path:'/token',body:null},{service:'profile',method:'GET',path:'/me',body:null}],seed:1}},
    {id:'payment-unknown',name:'支付结果未知',description:'响应断开与已提交模型状态分别保存。',domain:'sessions',method:'start',input:{protocol:'sakura-seventh-virtualization/1',services:[{id:'payment',initialState:{paid:false},rules:[{id:'pay',method:'POST',path:'/pay',priority:0,whenState:{},response:{status:200,body:{paid:true}},set:{paid:true},calls:[],delayMs:0,disconnect:true}]}],requests:[{service:'payment',method:'POST',path:'/pay',body:null}],seed:1}},
  ],
};
export async function computeSeventhEngineering(packId:string,action:string,input:Record<string,unknown>,signal?:AbortSignal):Promise<unknown> {
  boundedInput(input);checkpoint(signal);
  if(!(SEVENTH_ENGINEERING_ACTIONS[packId]??[]).includes(action))reject(SEVENTH_ENGINEERING_VM_ACTIONS[packId]?.actions.includes(action)?'ENGINEERING_VM_SESSION_REQUIRED':'ENGINEERING_ACTION_UNSUPPORTED',action);
  const data=obj(input);
  if(packId==='schedule-semantics-lab')return scheduleAction(action,data,signal);
  if(packId==='extension-authoring-studio')return extensionAction(action,data,signal);
  if(packId==='dependency-resolution-studio')return dependencyAction(action,data,signal);
  if(packId==='protocol-state-lab')return protocolAction(action,data,signal);
  if(packId==='replica-sync-lab')return replicaAction(action,data,signal);
  if(packId==='service-virtualization-studio')return virtualizationAction(action,data,signal);
  reject('ENGINEERING_PACKAGE_UNSUPPORTED',packId);
}
