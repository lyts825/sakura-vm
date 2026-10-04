import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  projectFiles: serviceRef('project-search', 'projectFiles', serviceContracts.ProjectFiles),
};
