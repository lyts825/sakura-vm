/**
 * 模块职责（中文）：加载全局样式与语言包，在会话锁定/账户边界内挂载 React 应用，并在热更新时复用根节点。
 * Module responsibility (English): Mounting the application inside account/session boundaries after installing the language pack, while hot updates reuse the React root.
 * 详细范围（中文）：内部入口供相邻界面或契约模块使用；职责覆盖在账户与会话边界内挂载应用并先安装语言包，热更新复用 React 根，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Internal entry points support adjacent UI/contract modules. The scope covers Mounting the application inside account/session boundaries after installing the language pack, while hot updates reuse the React root. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { SessionBoundary } from './SessionLock';
import { AccessBoundary } from './AccessControl';
import { installLanguagePack } from './localization';
import './fonts.css';
import './style.css';

const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
await installLanguagePack(document.body);
root.render(<SessionBoundary><AccessBoundary><App /></AccessBoundary></SessionBoundary>);
