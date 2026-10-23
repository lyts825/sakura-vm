import { useState } from 'react';
import type { FeatureProps } from '../../src/feature-shared';
import type { PluginPageProps } from '../../src/plugin-client';
import { FoundryPanel } from '../../src/FoundryPanel';
import { foundrySections } from '../../shared/contracts/foundry';
const Panel = (props: FeatureProps) => <FoundryPanel {...props} section="workbench" />;
function FoundryPage({ request, token, projectId }: PluginPageProps) {
  const [section, setSection] = useState<(typeof foundrySections)[number]>('workbench');
  return (
    <FoundryPanel
      request={request}
      token={token}
      projectId={projectId}
      section={section}
      onDevelopmentNavigate={(target) => {
        const next = foundrySections.find((value) => 'foundry-' + value === target);
        if (next) setSection(next);
      }}
    />
  );
}
export const pages = { foundry: FoundryPage };
export const developmentSections = { 'foundry-workbench': Panel };
