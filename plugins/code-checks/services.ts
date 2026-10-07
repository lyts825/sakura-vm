/**
 * 模块职责：“代码与调试工具”插件的有类型服务引用（intelligence、languageServices、debugger），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  intelligence: serviceRef('code-checks', 'intelligence', serviceContracts.CodeIntelligence),
  languageServices: serviceRef('code-checks', 'languageServices', serviceContracts.LanguageServices),
  debugger: serviceRef('code-checks', 'debugger', serviceContracts.DebugAdapter),
};
