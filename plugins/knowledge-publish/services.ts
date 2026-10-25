/** 独立服务引用。 Versioned domain service reference. */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  actions: serviceRef('knowledge-publish', 'knowledgeActions', serviceContracts.KnowledgeActions),
  publish: serviceRef('knowledge-publish', 'knowledgePublish', serviceContracts.KnowledgePublish),
};
