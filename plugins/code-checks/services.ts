import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  intelligence: serviceRef('code-checks', 'intelligence', serviceContracts.CodeIntelligence),
  languageServices: serviceRef('code-checks', 'languageServices', serviceContracts.LanguageServices),
  debugger: serviceRef('code-checks', 'debugger', serviceContracts.DebugAdapter),
};
