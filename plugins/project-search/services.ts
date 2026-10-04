import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { ProjectFiles } from '../../server/project-files.ts';

export const services = {
  projectFiles: serviceRef<ServiceInterface<ProjectFiles>>('project-search', 'projectFiles'),
};
