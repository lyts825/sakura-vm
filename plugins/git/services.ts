import { serviceRef } from '../../server/service-ref.ts';
import type { GitWorkbench } from '../../server/git-workbench.ts';

export const services = {
  git: serviceRef<GitWorkbench>('git', 'git'),
};
