import type { PluginPageProps } from '../../src/plugin-client';
import { FlowStudioPanel } from '../../src/FlowStudioPanel';
import '../../src/plugin-fonts.css';
const Page = ({ request, token }: PluginPageProps) => (
  <FlowStudioPanel request={request} accessEpoch={token} />
);
export const pages = { 'flow-studio': Page };
