/** 插件独立工作台入口。 */
import type { FeatureProps } from '../../src/feature-shared';
import { DataPanel } from '../../src/DataLabPanel';
const Panel = (props: FeatureProps) => <DataPanel {...props} section="notebooks" />;
export const developmentSections = { 'data-notebooks': Panel };
