/** 独立服务引用。 Versioned domain service reference. */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  sources: serviceRef('knowledge-sources', 'knowledgeSources', serviceContracts.KnowledgeSources),
};
