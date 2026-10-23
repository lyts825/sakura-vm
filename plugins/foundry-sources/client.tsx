import type { FeatureProps } from '../../src/feature-shared';
import { FoundryPanel } from '../../src/FoundryPanel';
const Panel = (props: FeatureProps) => <FoundryPanel {...props} section="sources" />;
export const developmentSections = { 'foundry-sources': Panel };
