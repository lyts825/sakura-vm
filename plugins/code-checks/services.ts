import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { CodeIntelligence } from '../../server/code-intelligence.ts';
import type { LanguageServices } from '../../server/language-services.ts';
import type { DebugAdapter } from '../../server/debug-adapter.ts';

export const services = {
  intelligence: serviceRef<ServiceInterface<CodeIntelligence>>('code-checks', 'intelligence'),
  languageServices: serviceRef<ServiceInterface<LanguageServices>>('code-checks', 'languageServices'),
  debugger: serviceRef<ServiceInterface<DebugAdapter>>('code-checks', 'debugger'),
};
