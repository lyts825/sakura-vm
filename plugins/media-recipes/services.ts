import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  recipes: serviceRef('media-recipes', 'mediaRecipes', serviceContracts.MediaRecipes),
};
