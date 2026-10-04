import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Recipes } from '../../server/recipes.ts';

export const services = {
  recipes: serviceRef<ServiceInterface<Recipes>>('recipes', 'recipes'),
};
