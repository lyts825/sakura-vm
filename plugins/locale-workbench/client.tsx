/** 本地化页面按需载入，启用和打开页面不运行样例。 */
import type { PluginPageProps } from '../../src/plugin-client';
import { LocaleStudioPanel } from '../../src/LocaleStudioPanel';
import '../../src/plugin-fonts.css';
const Page = ({ request, token }: PluginPageProps) => <LocaleStudioPanel request={request} accessEpoch={token} />;
export const pages = { 'localization-studio': Page };
