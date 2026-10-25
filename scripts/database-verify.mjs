/** 有界离线核验入口，不调用宿主、网络或数据库工具。 */
import { verifySuiteFile } from './suite-verify.mjs';
export const verifyDatabaseFile = (file) => verifySuiteFile('database', file);
