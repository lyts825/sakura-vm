import {createSuiteCli} from './suite-cli.mjs';
const base=createSuiteCli({prefix:'learning',label:'交互式实验',sourceDomain:'assets',maximumFile:8*1024**2,verify:async file=>(await import('./learning-verify.mjs')).verifyLearningFile(file)});
export const learningHelp=base.help;export const learningCli=base.cli;
