import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Sandboxes } from '../../server/sandboxes.ts';

export const services = {
  sandboxes: serviceRef<ServiceInterface<Sandboxes>>('sandbox', 'sandboxes'),
};
