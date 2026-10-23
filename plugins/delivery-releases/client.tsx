/** 按插件贡献装配工作台分区。 Compose the declared workbench section for this plugin. */
import { DeliveryPanel } from '../../src/DeliveryPanel';
import type { FeatureProps } from '../../src/feature-shared';
/** 仅呈现本分区；请求权限由插件边界提供。 Render the section using its plugin-bound request capability. */
const Panel = (props: FeatureProps) => <DeliveryPanel {...props} section="releases" />;
export const developmentSections = { 'delivery-releases': Panel };
