import { serviceRef } from '../../server/service-ref.ts';
import type { Ide } from '../../server/ide.ts';

export const services = {
  ide: serviceRef<Ide>('ide', 'ide'),
};
