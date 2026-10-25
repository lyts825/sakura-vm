/** 浏览器固定领域命令与完全离线的报告核验。 */
import {createSuiteCli} from './suite-cli.mjs';
const browser=createSuiteCli({prefix:'browser',label:'浏览器验收',sourceDomain:'targets',maximumFile:8*1024**2,verify:async file=>(await import('./browser-verify.mjs')).verifyBrowserFile(file)});
export const browserHelp=browser.help;
export const browserCli=browser.cli;
