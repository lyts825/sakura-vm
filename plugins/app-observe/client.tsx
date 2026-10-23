/** 本插件分区使用自身受限请求能力。 */
import { AppRuntimePanel } from '../../src/AppRuntimePanel';
import type { FeatureProps } from '../../src/feature-shared';
const Panel = (props: FeatureProps) => <AppRuntimePanel {...props} section="observe" />;
export const developmentSections = { 'app-observe': Panel };
