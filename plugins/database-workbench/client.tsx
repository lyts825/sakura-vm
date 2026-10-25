import type { PluginPageProps } from '../../src/plugin-client';
import { DatabaseEvolutionPanel } from '../../src/DatabaseEvolutionPanel';
import '../../src/plugin-fonts.css';
const Page = ({ request, token }: PluginPageProps) => (
  <DatabaseEvolutionPanel request={request} accessEpoch={token} />
);
export const pages = { 'database-evolution': Page };
