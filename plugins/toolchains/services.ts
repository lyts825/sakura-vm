import { serviceRef } from '../../server/service-ref.ts';
import type { Toolchains } from '../../server/toolchains.ts';

export const services = {
  toolchains: serviceRef<Toolchains>('toolchains', 'toolchains'),
};
