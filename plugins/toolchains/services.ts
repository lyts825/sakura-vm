import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Toolchains } from '../../server/toolchains.ts';

export const services = {
  toolchains: serviceRef<ServiceInterface<Toolchains>>('toolchains', 'toolchains'),
};
