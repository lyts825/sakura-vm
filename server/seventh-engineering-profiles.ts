/** 四种固定工程工具的独立输入合同和客户机档案；不接受工具名或命令。 */
import { z } from 'zod';
import type { SuiteExecutionProfile } from './suite-execution-profile.ts';
import { AppError } from '../shared/errors.ts';
const base64=z.string().min(1).max(87384).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const seventhScheduleWorkerInput=z.object({protocol:z.literal('sakura-seventh-schedule/1'),intervalMs:z.number().int().min(10).max(10000),count:z.number().int().min(1).max(100),durationMs:z.number().int().min(0).max(10000).default(0),overlap:z.enum(['skip','queue','parallel']).default('queue'),concurrency:z.number().int().min(1).max(4).default(2)}).strict();
export const seventhExtensionWorkerInput=z.object({protocol:z.literal('sakura-seventh-extension/1'),source:z.string().min(1).max(262144)}).strict();
export const seventhProtocolWorkerInput=z.object({protocol:z.literal('sakura-seventh-protocol/1'),messages:z.array(base64).min(1).max(1000),replies:z.array(base64).min(1).max(1000),fragmentBytes:z.number().int().min(0).max(65536).default(0),target:z.object({kind:z.literal('linux-executable'),artifactBase64:z.string().min(1).max(700000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional()}).strict().refine(v=>v.messages.length===v.replies.length,'每条消息必须有固定响应');
const json=z.json();
const route=z.string().min(1).max(1024).refine(v=>v.startsWith('/')&&!v.includes('://')&&!v.includes('\r')&&!v.includes('\n'));
const identifier=z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const methods=z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD']);
const virtualCall=z.object({service:identifier,method:methods.default('GET'),path:route,body:json.nullable().default(null)}).strict();
const virtualRule=z.object({id:identifier,method:methods.default('GET'),path:route,priority:z.number().int().min(0).max(1000000),whenState:z.record(z.string().max(100),json).default({}),response:z.object({status:z.number().int().min(100).max(599),body:json}).strict(),set:z.record(z.string().max(100),json).default({}),calls:z.array(virtualCall).max(20).default([]),delayMs:z.number().int().min(0).max(30000).default(0),disconnect:z.boolean().default(false)}).strict();
export const seventhVirtualizationWorkerInput=z.object({protocol:z.literal('sakura-seventh-virtualization/1'),services:z.array(z.object({id:identifier,initialState:z.record(z.string().max(100),json).default({}),rules:z.array(virtualRule).max(200)}).strict()).min(1).max(20),requests:z.array(virtualCall).max(1000),snapshot:z.object({states:z.record(z.string().max(100),z.record(z.string().max(100),json)),requestCursor:z.number().int().nonnegative(),modelDigest:z.string().regex(/^[a-f0-9]{64}$/),seed:z.number().int().min(0).max(4294967295).default(1),schemaVersion:z.literal(1).default(1)}).strict().optional(),seed:z.number().int().min(0).max(4294967295).default(1)}).strict().superRefine((value,ctx)=> {
  const ids=new Set(value.services.map(s=>s.id));if(ids.size!==value.services.length)ctx.addIssue({code:'custom',message:'服务ID重复'});
  for(const service of value.services){const rules=new Set<string>();for(const rule of service.rules){const key=rule.method+' '+rule.path+' '+rule.priority;if(rules.has(key))ctx.addIssue({code:'custom',message:'匹配优先级重复'});rules.add(key);for(const call of rule.calls)if(!ids.has(call.service))ctx.addIssue({code:'custom',message:'内部服务引用缺失'});}}
  for(const request of value.requests)if(!ids.has(request.service))ctx.addIssue({code:'custom',message:'请求服务引用缺失'});
});
const worker=new URL('./seventh-engineering-worker.py',import.meta.url);
function versions(stdout:string) {const lines=stdout.trim().split(/\r?\n/).filter(Boolean);if(!lines.length||lines.some(s=>s.length>256))throw new AppError('工程固定依赖探针失败',409,'ENGINEERING_PROBE');return Object.fromEntries(lines.map((line,i)=>['dependency'+i,line]));}
function outcome(value:unknown):'passed'|'failed'|'inconclusive' {const result=z.object({outcome:z.enum(['passed','failed','inconclusive'])}).passthrough().parse(value);return result.outcome;}
const pythonProbe='set -eu\ncommand -v python3 >/dev/null\npython3 -I -S -c "import json,socket,http.server,http.client,threading,subprocess,hashlib;import sys;print(sys.version.split()[0])"';
const common={worker,probe:pythonProbe,probeResult:versions,outcome,memoryMiB:1024,cpus:1,maximumSeconds:900,maximumInputBytes:8*1024**2-4096,maximumOutputBytes:8*1024**2};
export const seventhScheduleExecutionProfile:SuiteExecutionProfile=Object.freeze({...common,id:'schedule-probe',consumers:['official:schedlab-harness'],input:seventhScheduleWorkerInput,maximumSeconds:600});
export const seventhExtensionExecutionProfile:SuiteExecutionProfile=Object.freeze({...common,id:'extension-build',consumers:['official:extforge-builds'],input:seventhExtensionWorkerInput,probe:pythonProbe+'\ncommand -v clang >/dev/null\ncommand -v wasm-ld >/dev/null\nclang --version | head -1\nwasm-ld --version',maximumSeconds:120});
export const seventhProtocolExecutionProfile:SuiteExecutionProfile=Object.freeze({...common,id:'protocol-scenario',consumers:['official:protostate-runs'],input:seventhProtocolWorkerInput,maximumSeconds:120});
export const seventhVirtualizationExecutionProfile:SuiteExecutionProfile=Object.freeze({...common,id:'multi-service',consumers:['official:virtservice-sessions'],input:seventhVirtualizationWorkerInput});
