/** 独立插件页面入口。 Independent plugin panel. */
import type { PluginPageProps } from '../../src/plugin-client';
import { IntegrationLabPanel } from '../../src/IntegrationLabPanel';
const Panel = (props: PluginPageProps) => (
  <IntegrationLabPanel key={props.token} request={props.request} section="workbench" />
);
export const pages = { 'integration-lab': Panel };
