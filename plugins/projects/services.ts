import { serviceRef } from '../../server/service-ref.ts';
import type { Workspaces } from '../../server/workspaces.ts';

export const services = {
  workspaces: serviceRef<Workspaces>('projects', 'workspaces'),
};
