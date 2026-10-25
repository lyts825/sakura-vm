import type { PluginPageProps } from '../../src/plugin-client';
import { LearningLabPanel } from '../../src/LearningLabPanel';
import '../../src/plugin-fonts.css';
const Page = ({ request, token }: PluginPageProps) => (
  <LearningLabPanel request={request} accessEpoch={token} authorized={!!token} />
);
export const pages = { 'learning-lab': Page };
