import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Workspaces } from '../../server/workspaces.ts';

export const services = {
  workspaces: serviceRef<ServiceInterface<Workspaces>>('projects', 'workspaces'),
};
