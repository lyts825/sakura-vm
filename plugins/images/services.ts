import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  images: serviceRef('images', 'images', serviceContracts.Images),
  diskImports: serviceRef('images', 'diskImports', serviceContracts.DiskImports),
};
