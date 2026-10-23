import type { FeatureProps } from '../../src/feature-shared';
import { FoundryPanel } from '../../src/FoundryPanel';
const Panel = (props: FeatureProps) => <FoundryPanel {...props} section="blueprints" />;
export const developmentSections = { 'foundry-blueprints': Panel };
