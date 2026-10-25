import {createSuiteCli} from './suite-cli.mjs';
const base=createSuiteCli({prefix:'event',label:'事件与异步处理',sourceDomain:'contracts',maximumFile:2*1024**2,verify:async file=>(await import('./event-verify.mjs')).verifyEventFile(file)});
export const eventHelp=base.help;export const eventCli=base.cli;
