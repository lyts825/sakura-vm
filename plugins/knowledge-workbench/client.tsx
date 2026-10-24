/** 知识工作台独立页面，无需选择 VM。 Standalone knowledge page with no VM selection. */
import type { PluginPageProps } from '../../src/plugin-client';
import { KnowledgeStudioPanel } from '../../src/KnowledgeStudioPanel';
import '../../src/plugin-fonts.css';
const Page = ({ request, token }: PluginPageProps) => (
  <KnowledgeStudioPanel request={request} accessEpoch={token} />
);
export const pages = { 'knowledge-studio': Page };
