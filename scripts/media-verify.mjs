/** 有界离线核验入口，不调用宿主、网络或媒体解码器。 */
import { verifySuiteFile } from './suite-verify.mjs';
export const verifyMediaFile = (file) => verifySuiteFile('media', file);
