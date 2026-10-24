/** 本地化的纯 Node 核验入口。 */
import { verifySuiteFile } from './suite-verify.mjs';
export const verifyLocaleFile = file => verifySuiteFile('locale', file);
