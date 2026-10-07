/**
 * 模块职责：加载全局样式与语言包，在会话锁定/账户边界内挂载 React 应用，并在热更新时复用根节点。
 */
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { SessionBoundary } from './SessionLock';
import { AccessBoundary } from './AccessControl';
import { installLanguagePack } from './localization';
import '@xterm/xterm/css/xterm.css';
import './fonts.css';
import './style.css';

const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
await installLanguagePack(document.body);
root.render(<SessionBoundary><AccessBoundary><App /></AccessBoundary></SessionBoundary>);
