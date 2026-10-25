import type { PluginPageProps } from '../../src/plugin-client';
import { MediaStudioPanel } from '../../src/MediaStudioPanel';
import '../../src/plugin-fonts.css';
const Page = ({ request, token }: PluginPageProps) => (
  <MediaStudioPanel request={request} accessEpoch={token} />
);
export const pages = { 'media-studio': Page };
