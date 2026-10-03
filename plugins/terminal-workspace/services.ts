import { serviceRef } from '../../server/service-ref.ts';
import type { ProjectTerminals } from '../../server/project-terminals.ts';

export const services = {
  terminals: serviceRef<ProjectTerminals>('terminal-workspace', 'terminals'),
};
