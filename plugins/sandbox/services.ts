import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  sandboxes: serviceRef('sandbox', 'sandboxes', serviceContracts.Sandboxes),
};
