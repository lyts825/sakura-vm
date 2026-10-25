import type { PluginPageProps } from '../../src/plugin-client';
import { EvaluationStudioPanel } from '../../src/EvaluationStudioPanel';
import '../../src/plugin-fonts.css';
const Page = ({ request, token }: PluginPageProps) => (
  <EvaluationStudioPanel request={request} accessEpoch={token} />
);
export const pages = { 'model-evaluation': Page };
