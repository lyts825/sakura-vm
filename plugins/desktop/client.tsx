/**
 * 模块职责（中文）：“Linux 图形桌面”插件的远程桌面标签的界面入口，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for graphical desktops, single-application windows and clipboard policy.
 * 详细范围（中文）：公开入口包括 tabs；职责覆盖图形桌面、单应用窗口与剪贴板的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include tabs. The scope covers UI interaction and state presentation for graphical desktops, single-application windows and clipboard policy. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { DesktopPanel } from '../../src/DesktopPanel';
import '../../src/features.css';
export const tabs = { desktop: DesktopPanel };
