import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Ide } from '../../server/ide.ts';

export const services = {
  ide: serviceRef<ServiceInterface<Ide>>('ide', 'ide'),
};
