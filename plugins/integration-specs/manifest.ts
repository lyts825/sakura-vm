/** 契约与工作空间：声明直接依赖和 owner 操作。 Explicit domain dependencies and owner routes. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'integration-specs',
  name: '契约与工作空间',
  description: '契约与工作空间，固定输入、授权和独立审计记录。',
  category: 'development',
  requires: [],
  services: ['integrationSpecs'],

  contributes: {
    tabs: ['development'],
    developmentSections: ['integration-specs'],
    http: [http('/api/integration-specs', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/integration-specs'),
  },
});
