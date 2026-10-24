/** 独立插件页面入口。 Independent plugin panel. */
import type { FeatureProps } from '../../src/feature-shared';
import { IntegrationLabPanel } from '../../src/IntegrationLabPanel';
const Panel = (props: FeatureProps) => <IntegrationLabPanel request={props.request} section="assertions" />;
export const developmentSections = { 'integration-assertions': Panel };
