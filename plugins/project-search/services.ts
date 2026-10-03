import { serviceRef } from '../../server/service-ref.ts';
import type { ProjectFiles } from '../../server/project-files.ts';

export const services = {
  projectFiles: serviceRef<ProjectFiles>('project-search', 'projectFiles'),
};
