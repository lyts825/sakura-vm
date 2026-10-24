/** 软件供应审查的纯 Node 离线核验入口。 */
import { verifySuiteFile } from './suite-verify.mjs';
export const verifySupplyFile = file => verifySuiteFile('supply', file);
