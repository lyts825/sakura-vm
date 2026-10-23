/** 本插件分区使用自身受限请求能力。 */
import { AppRuntimePanel } from '../../src/AppRuntimePanel';
import type { FeatureProps } from '../../src/feature-shared';
import type { PluginPageProps } from '../../src/plugin-client';
const Panel = (props: FeatureProps) => <AppRuntimePanel {...props} section="workbench" />;
const Page = ({ request, token, refresh, vms, selected, projectId }: PluginPageProps) => {
  const vm = vms.find((item) => item.id === selected);
  return (
    <AppRuntimePanel
      request={request}
      token={token}
      refresh={refresh}
      vm={vm}
      projectId={vm ? projectId : undefined}
      section="workbench"
    />
  );
};
export const pages = { 'app-runtime': Page };
export const developmentSections = { 'app-workbench': Panel };
