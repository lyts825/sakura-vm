import { serviceRef } from '../../server/service-ref.ts';
import type { Sandboxes } from '../../server/sandboxes.ts';

export const services = {
  sandboxes: serviceRef<Sandboxes>('sandbox', 'sandboxes'),
};
