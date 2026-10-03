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
