/** 事件交接的纯 Node 核验入口，不认证发送方身份或转移批准。 */
import { verifySuiteFile } from './suite-verify.mjs';
export const verifyIncidentFile = (file) => verifySuiteFile('incident', file);
