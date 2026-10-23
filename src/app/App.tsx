/**
 * 模块职责（中文）：应用主界面装配：连接控制面状态、实例/项目选择、插件导航及按需加载的工作区页面。
 * Module responsibility (English): The application shell joining controller state, VM/project selection and plugin surfaces.
 * 详细范围（中文）：公开入口包括 App；职责覆盖连接控制面状态、实例/项目选择与插件页面的应用外壳，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include App. The scope covers The application shell joining controller state, VM/project selection and plugin surfaces. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import {
  Accessibility,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Camera,
  Check,
  ChevronRight,
  CircleDot,
  CircleHelp,
  Cpu,
  Flower2,
  Folder,
  GitBranch,
  HardDrive,
  Layers,
  Maximize2,
  MemoryStick,
  Minimize2,
  Monitor,
  Moon,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  TerminalSquare,
  Wrench,
  X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { NativeHandoff } from '../../shared/native-integration';
import { AccessSettings, AccountLogoutButton } from '../AccessControl';
import { SakuraArt } from '../SakuraArt';
import { SessionLockButton, SessionLockSettings } from '../SessionLock';
import { TerminalPanel } from '../TerminalPanel';
import { api, controllerSession } from '../controller-session';
import { ConfigPanel, CreateModal } from './InstanceForms';
import { readSessionState } from './session-state';
import { active, Alpine, Badge, bytes, memory, Modal, states } from './ui';
import { useControllerState } from './use-controller-state';
import { useProjectSelection } from './use-project-selection';

import { distroName, type Request } from '../feature-shared';

import { mayLeaveEditor } from '../file-editor-state';

import type { VMView } from '../../shared/contracts/vm.ts';
import { pluginSurfaceOwner, pluginSurfaceEnabled } from '../../shared/plugins';
import { ClipboardSettings } from '../ClipboardSettings';
import type { PaletteAction, PaletteTarget } from '../CommandPalette';
import { LocaleSettings } from '../LocaleSettings';
import { ShortcutSettings } from '../ShortcutSettings';
import sakuraMark from '../assets/sakura.svg';
import { installClipboardProtection } from '../clipboard-protection';
import { formatNumber } from '../localization';
import { PluginPage, PluginTab } from '../plugin-client';
import { PluginContext } from '../plugin-context';
import { pluginNavigation } from '../plugin-navigation';
import {
  effectiveShortcuts,
  eventShortcut,
  readShortcuts,
  shortcutCommands,
  shortcutContext,
  shortcutInputTarget,
  watchShortcuts,
} from '../shortcuts';
import { workspaceCommandDefinitions, type WorkspaceCommandDefinition } from '../workspace-navigation';
import { workspacePath } from '../workspace-request';

const TerminalWorkspace = lazy(/** 中文：懒加载 ../TerminalWorkspace 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../TerminalWorkspace and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../TerminalWorkspace').then((module) => ({ default: module.TerminalWorkspace })),
);
const CommandPalette = lazy(/** 中文：懒加载 ../CommandPalette 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../CommandPalette and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../CommandPalette').then((module) => ({ default: module.CommandPalette })),
);
const PluginCenter = lazy(/** 中文：懒加载 ../PluginCenter 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../PluginCenter and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../PluginCenter').then((module) => ({ default: module.PluginCenter })),
);
const TasksPanel = lazy(/** 中文：懒加载 ../TasksPanel 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../TasksPanel and adapt its selected export as the default React component, deferring this feature's UI code download */ () => import('../TasksPanel').then((module) => ({ default: module.TasksPanel })));
const ApiExplorer = lazy(/** 中文：懒加载 ../ApiExplorer 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../ApiExplorer and adapt its selected export as the default React component, deferring this feature's UI code download */ () => import('../ApiExplorer').then((module) => ({ default: module.ApiExplorer })));
const GraphQLExplorer = lazy(/** 中文：懒加载 ../GraphQLExplorer 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../GraphQLExplorer and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../GraphQLExplorer').then((module) => ({ default: module.GraphQLExplorer })),
);
const LogRetentionSettings = lazy(/** 中文：懒加载 ../LogRetentionSettings 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../LogRetentionSettings and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../LogRetentionSettings').then((module) => ({ default: module.LogRetentionSettings })),
);
const WebhookSettings = lazy(/** 中文：懒加载 ../WebhookSettings 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../WebhookSettings and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../WebhookSettings').then((module) => ({ default: module.WebhookSettings })),
);
const AutomationRuleSettings = lazy(/** 中文：懒加载 ../AutomationRuleSettings 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../AutomationRuleSettings and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../AutomationRuleSettings').then((module) => ({ default: module.AutomationRuleSettings })),
);
const FeatureRolloutSettings = lazy(/** 中文：懒加载 ../FeatureRolloutSettings 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../FeatureRolloutSettings and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../FeatureRolloutSettings').then((module) => ({ default: module.FeatureRolloutSettings })),
);
const HostPeersSettings = lazy(/** 中文：懒加载 ../HostPeersSettings 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../HostPeersSettings and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../HostPeersSettings').then((module) => ({ default: module.HostPeersSettings })),
);
const FleetPolicyRolloutSettings = lazy(/** 中文：懒加载 ../FleetPolicyRolloutSettings 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../FleetPolicyRolloutSettings and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../FleetPolicyRolloutSettings').then((module) => ({ default: module.FleetPolicyRolloutSettings })),
);
const GpuProfilesSettings = lazy(/** 中文：懒加载 ../GpuProfilesSettings 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../GpuProfilesSettings and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../GpuProfilesSettings').then((module) => ({ default: module.GpuProfilesSettings })),
);
const BuildFarmSettings = lazy(/** 中文：懒加载 ../BuildFarmSettings 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../BuildFarmSettings and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../BuildFarmSettings').then((module) => ({ default: module.BuildFarmSettings })),
);
const MediaDevicesSettings = lazy(/** 中文：懒加载 ../MediaDevicesSettings 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../MediaDevicesSettings and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../MediaDevicesSettings').then((module) => ({ default: module.MediaDevicesSettings })),
);
const LocalAssistant = lazy(/** 中文：懒加载 ../LocalAssistant 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../LocalAssistant and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../LocalAssistant').then((module) => ({ default: module.LocalAssistant })),
);
/** 按需加载本体可信更新管理界面。Lazily load the core trusted-update management surface. */
const TrustedUpdateSettings = lazy(() => import('../TrustedUpdateSettings').then(module => ({ default: module.TrustedUpdateSettings })));
const NativeIntegrationSettings = lazy(/** 中文：懒加载 ../NativeIntegration 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../NativeIntegration and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../NativeIntegration').then((module) => ({ default: module.NativeIntegrationSettings })),
);
const NativeClipboardSettings = lazy(/** 中文：懒加载 ../NativeClipboardSettings 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../NativeClipboardSettings and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../NativeClipboardSettings').then((module) => ({ default: module.NativeClipboardSettings })),
);
const RecordingLibrary = lazy(/** 中文：懒加载 ../DesktopRecording 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../DesktopRecording and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../DesktopRecording').then((module) => ({ default: module.RecordingLibrary })),
);
const AccessibilityAudit = lazy(/** 中文：懒加载 ../AccessibilityAudit 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../AccessibilityAudit and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../AccessibilityAudit').then((module) => ({ default: module.AccessibilityAudit })),
);
const DevelopmentPanel = lazy(/** 中文：懒加载 ../DevelopmentPanel 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../DevelopmentPanel and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../DevelopmentPanel').then((module) => ({ default: module.DevelopmentPanel })),
);
const MigrationPanel = lazy(/** 中文：懒加载 ../../plugins/migration/client 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load ../../plugins/migration/client and adapt its selected export as the default React component, deferring this feature's UI code download */ () =>
  import('../../plugins/migration/client').then((module) => ({ default: module.MigrationPanel })),
);

const workspaceTabIcons = {
  terminal: TerminalSquare,
  desktop: Monitor,
  files: Folder,
  project: Boxes,
  git: GitBranch,
  development: Wrench,
  containers: Boxes,
  metrics: Cpu,
  services: Network,
  sync: RefreshCw,
  snapshots: Camera,
  maintenance: ShieldCheck,
  config: Settings2,
};
const builtInPageIds = new Set(['workspace', 'plugins', 'tasks', 'settings']);
const corePageIds = new Set(['workspace', 'plugins', 'settings']);
const pageIcons = {
  workspace: TerminalSquare,
  plugins: Puzzle,
  settings: Settings2,
  images: Layers,
  tasks: CircleDot,
  library: Boxes,
  features: Sparkles,
};
const builtInTabIds = new Set(['terminal', 'config', 'development']);

/**
 * 中文：呈现连接控制面状态、实例/项目选择与插件页面的应用外壳中的 App 界面，组合 Plus、ShieldCheck、CircleHelp、ArrowUpRight、Monitor、ChevronRight、SessionLockButton、AccountLogoutButton，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the App surface for The application shell joining controller state, VM/project selection and plugin surfaces and composing Plus, ShieldCheck, CircleHelp, ArrowUpRight, Monitor, ChevronRight, SessionLockButton, AccountLogoutButton. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 */
export function App() {
  const token = useSyncExternalStore(controllerSession.subscribe, controllerSession.getToken);
  const [initialSession] = useState(readSessionState);
  const [selected, setSelectedRaw] = useState(initialSession.selected),
    [requestedPage, setPageRaw] = useState(initialSession.page),
    [requestedTab, setTabRaw] = useState(initialSession.tab);
  const { vms, system, loading, offline, refresh, invalidate, upsertVm, reconnect } =
    useControllerState(setSelectedRaw);
  const enabled = system?.pluginRuntime ? system.pluginRuntime.instances.filter(item =>
    item.source === 'official' && item.phase === 'running').map(item => item.pluginId) : system?.plugins || [];
  /**
   * 中文：根据  判断连接控制面状态、实例/项目选择与插件页面的应用外壳中的输入或条目是否符合条件，返回布尔判断供调用者筛选/保护分支
   * English: Evaluate  to test inputs/entries in The application shell joining controller state, VM/project selection and plugin surfaces, returning a boolean for filtering/guard branches
   * 中文：输入：id：目标资源标识
   * English: Inputs: id: target resource identifier
   */
  const has = (id: string) => enabled.includes(id);
  const page = pluginSurfaceEnabled(enabled, 'pages', requestedPage, system?.pluginRuntime) ? requestedPage : 'workspace';
  const tab = pluginSurfaceEnabled(enabled, 'tabs', requestedTab, system?.pluginRuntime) ? requestedTab : 'terminal';
  const visiblePages = pluginNavigation(enabled, 'pages', system?.pluginRuntime).map((item) => ({
    ...item,
    icon: pageIcons[item.id as keyof typeof pageIcons] || Boxes,
  }));
  const visibleWorkspaceTabs = pluginNavigation(enabled, 'tabs', system?.pluginRuntime).map((item) => ({
    ...item,
    icon: workspaceTabIcons[item.id as keyof typeof workspaceTabIcons] || Boxes,
  }));
  const pluginPageOwner = pluginSurfaceOwner(enabled, 'pages', page, system?.pluginRuntime);
  const pluginTabOwner = pluginSurfaceOwner(enabled, 'tabs', tab, system?.pluginRuntime);
  const primaryWorkspaceTabs =
    visibleWorkspaceTabs.length <= 4
      ? visibleWorkspaceTabs
      : [
          ...visibleWorkspaceTabs.filter((item) => item.id !== 'config').slice(0, 3),
          visibleWorkspaceTabs.find((item) => item.id === 'config')!,
        ];
  const advancedWorkspaceTabs = visibleWorkspaceTabs.filter(
    (item) => !primaryWorkspaceTabs.some((primary) => primary.id === item.id),
  );
  const hasProjects = has('projects'),
    hasPalette = has('command-palette');
  const { projectId, projectLoadError, onProjectChange, selectProject, reloadProject } = useProjectSelection(
    selected,
    hasProjects,
    token,
  );
  /**
   * 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中selectedRaw 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In The application shell joining controller state, VM/project selection and plugin surfaces, selectedRaw state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：value：待校验、转换或保存的输入值
   * English: Inputs: value: input value to validate/transform/save
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   */
  const setSelected = async (value: string) => {
    if (value === selected || (await mayLeaveEditor())) setSelectedRaw(value);
  };
  /**
   * 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中pageRaw 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In The application shell joining controller state, VM/project selection and plugin surfaces, pageRaw state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：value：待校验、转换或保存的输入值
   * English: Inputs: value: input value to validate/transform/save
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   */
  const setPage = async (value: string) => {
    if (value === page || (await mayLeaveEditor())) setPageRaw(value);
  };
  /**
   * 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中tabRaw 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In The application shell joining controller state, VM/project selection and plugin surfaces, tabRaw state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：value：待校验、转换或保存的输入值
   * English: Inputs: value: input value to validate/transform/save
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   */
  const setTab = async (value: string) => {
    if (value === tab || (await mayLeaveEditor())) setTabRaw(value);
  };
  const [busy, setBusy] = useState(false),
    [query, setQuery] = useState('');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(/** 中文：当依赖 [] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership */ () => installClipboardProtection(document, (text) => setToast({ text, error: true })), []);
  const [modal, setModal] = useState<'create' | 'help' | 'delete' | null>(null);
  const [confirm, setConfirm] = useState('');
  const [palette, setPalette] = useState(false);
  const [auditMode, setAuditMode] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [showRetention, setShowRetention] = useState(false);
  const [showSessionLock, setShowSessionLock] = useState(false);
  const [showWebhooks, setShowWebhooks] = useState(false);
  const [showAutomationRules, setShowAutomationRules] = useState(false);
  const [showFeatureRollouts, setShowFeatureRollouts] = useState(false);
  const [showHostPeers, setShowHostPeers] = useState(false);
  const [showFleetRollouts, setShowFleetRollouts] = useState(false);
  const [showGpuProfiles, setShowGpuProfiles] = useState(false);
  const [showBuildFarm, setShowBuildFarm] = useState(false);
  const [showMediaDevices, setShowMediaDevices] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [showTrustedUpdates, setShowTrustedUpdates] = useState(false);
  const [showNative, setShowNative] = useState(false);
  const [showNativeClipboard, setShowNativeClipboard] = useState(false);
  const [showRecordings, setShowRecordings] = useState(false);
  const [openFile, setOpenFile] = useState<{
    id: string;
    path: string;
    revision: number;
    directory?: boolean;
  }>();
  /**
   * 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中palette 状态，selectedRaw 状态，pageRaw 状态，tabRaw 状态，openFile 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In The application shell joining controller state, VM/project selection and plugin surfaces, palette state, selectedRaw state, pageRaw state, tabRaw state, openFile state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：target：事件目标或操作目标
   * English: Inputs: target: event/operation target
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   */
  const navigatePalette = async (target: PaletteTarget) => {
    setPalette(false);
    if (!(await mayLeaveEditor())) return;
    if (target.id) setSelectedRaw(target.id);
    if (target.page) setPageRaw(target.page);
    if (target.tab) setTabRaw(target.tab);
    if (target.file) setOpenFile({ id: target.id || selected, path: target.file, revision: Date.now() });
  };
  const [theme, setTheme] = useState<'day' | 'night'>(/** 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中读取浏览器缓存值；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In The application shell joining controller state, VM/project selection and plugin surfaces, read a browser-cache value. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation */ () => {
    try {
      return localStorage.getItem('sakura-theme') === 'night' ? 'night' : 'day';
    } catch {
      return 'day';
    }
  });
  const [focused, setFocused] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'paused' | 'stopped'>('all');
  const searchRef = useRef<HTMLInputElement>(null);
  const machineRef = useRef<HTMLElement>(null);
  const tabMoreRef = useRef<HTMLDivElement>(null);
  const [moreTabsOpen, setMoreTabsOpen] = useState(false);
  const vm = vms.find((v) => v.id === selected);
  const [shortcuts, setShortcuts] = useState(readShortcuts);
  useEffect(/** 中文：当依赖 [] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership */ () => watchShortcuts(() => setShortcuts(readShortcuts())), []);
  const shortcutScope = shortcutContext(selected, hasProjects ? projectId : undefined);
  const bindings = effectiveShortcuts(shortcuts, shortcutScope);
  /**
   * 中文：提交 operation workspacePath(path, projectId)，完成连接控制面状态、实例/项目选择与插件页面的应用外壳的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation workspacePath(path, projectId) for The application shell joining controller state, VM/project selection and plugin surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：path：目标文件或请求路径；method：请求 HTTP 方法（缺省 'GET'）；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
   * English: Inputs: path: target file/request path; method: request HTTP method (default 'GET'); body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
   */
  const workspaceApi = useCallback<Request>(
    (path, method = 'GET', body, signal) => api(workspacePath(path, projectId), method, body, signal),
    [projectId],
  );
  useEffect(/** 中文：提交 operation /native-integration，完成连接控制面状态、实例/项目选择与插件页面的应用外壳的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /native-integration for The application shell joining controller state, VM/project selection and plugin surfaces. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!token || !system) return;
    let alive = true,
      handling = false;
    const abort = new AbortController();
    /**
     * 中文：提交 operation /native-integration，完成连接控制面状态、实例/项目选择与插件页面的应用外壳的数据交互并更新selectedRaw 状态、pageRaw 状态、tabRaw 状态、openFile 状态、toast 状态；异步失败传给此处的捕获分支或外层动作反馈
     * English: Perform operation /native-integration for The application shell joining controller state, VM/project selection and plugin surfaces and update selectedRaw state, pageRaw state, tabRaw state, openFile state, toast state. Propagate asynchronous failure to this catch path or the outer action feedback
     * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
     * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
     * 中文：拒绝原因：无效的 Windows 打开请求；请启用项目和文件插件后重新打开。这些错误交给直接调用者或本函数 catch 处理
     * English: Refusal reasons: 无效的 Windows 打开请求; 请启用项目和文件插件后重新打开. These errors reach the direct caller or this function's catch handler
     * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
     * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
     */
    const receive = async () => {
      if (handling) return;
      const params = new URLSearchParams(location.hash.slice(1));
      const ticket = params.get('native'),
        error = params.get('native-error');
      if (!ticket && !error) return;
      handling = true;
      try {
        if (error) throw new Error(error.slice(0, 500));
        if (!/^[a-f0-9-]{36}$/.test(ticket || '')) throw new Error('无效的 Windows 打开请求');
        const target = await api<NativeHandoff>(
          '/native-integration',
          'POST',
          { action: 'resolve', ticket },
          abort.signal,
        );
        if (!alive || !(await mayLeaveEditor())) return;
        if (!has('files') || !hasProjects) throw new Error('请启用项目和文件插件后重新打开');
        selectProject(target.vmId, target.projectId);
        setSelectedRaw(target.vmId);
        setPageRaw('workspace');
        setTabRaw('files');
        setOpenFile({
          id: target.vmId,
          path: target.path,
          directory: target.directory,
          revision: Date.now(),
        });
        setToast({ text: '已定位 Windows 对应工作区；文件需已同步到 Linux' });
      } catch (e) {
        if (alive) setToast({ text: (e as Error).message, error: true });
      } finally {
        if (alive) history.replaceState(history.state, '', location.pathname + location.search);
        handling = false;
      }
    };
    void receive();
    window.addEventListener('hashchange', receive);
    /**
     * 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中取消捕获的异步寿命，移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In The application shell joining controller state, VM/project selection and plugin surfaces, abort the captured asynchronous lifetime, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      alive = false;
      abort.abort();
      window.removeEventListener('hashchange', receive);
    };
  }, [token, !!system, hasProjects]);
  const focusMode = focused && page === 'workspace' && !!vm;
  useEffect(/** 中文：当依赖 [selected, page, tab] 变化时持久化浏览器缓存值；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [selected, page, tab] change, persist a browser-cache value. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    try {
      localStorage.setItem('sakura-session', JSON.stringify({ selected, page, tab }));
    } catch {
      // The workspace remains usable when browser storage is unavailable.
    }
  }, [selected, page, tab]);
  useEffect(/** 中文：当依赖 [focusMode] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [focusMode] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (focusMode) machineRef.current?.scrollIntoView({ block: 'start' });
  }, [focusMode]);
  useEffect(/** 中文：当依赖 [moreTabsOpen] 变化时登记浏览器或资源事件监听；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [moreTabsOpen] change, register browser/resource event listeners. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!moreTabsOpen) return;
    /**
     * 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中moreTabsOpen 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In The application shell joining controller state, VM/project selection and plugin surfaces, moreTabsOpen state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：输入：event：触发本处理器的事件及其数据
     * English: Inputs: event: triggering event and its data
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && !tabMoreRef.current?.contains(event.target)) setMoreTabsOpen(false);
    };
    /**
     * 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中moreTabsOpen 状态，把输入焦点移到目标元素；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In The application shell joining controller state, VM/project selection and plugin surfaces, moreTabsOpen state, move input focus to the target. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：输入：event：触发本处理器的事件及其数据
     * English: Inputs: event: triggering event and its data
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoreTabsOpen(false);
        tabMoreRef.current?.querySelector<HTMLButtonElement>('.tabs-more-trigger')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    /**
     * 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In The application shell joining controller state, VM/project selection and plugin surfaces, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreTabsOpen]);
  useEffect(/** 中文：当依赖 [theme] 变化时持久化浏览器缓存值；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [theme] change, persist a browser-cache value. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'night' ? '#201b24' : '#faf7f9');
    try {
      localStorage.setItem('sakura-theme', theme);
    } catch {
      // Theme switching still works when browser storage is unavailable.
    }
  }, [theme]);
  useEffect(/** 中文：当依赖 [bindings, page, focusMode, vm, hasPalette, enabled, navigatePalette] 变化时登记浏览器或资源事件监听；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [bindings, page, focusMode, vm, hasPalette, enabled, navigatePalette] change, register browser/resource event listeners. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    /**
     * 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中focused 状态，palette 状态，theme 状态，阻止浏览器默认行为，把输入焦点移到目标元素；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In The application shell joining controller state, VM/project selection and plugin surfaces, focused state, palette state, theme state, prevent browser default behavior, move input focus to the target. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：输入：event：触发本处理器的事件及其数据
     * English: Inputs: event: triggering event and its data
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    const handleKey = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || shortcutInputTarget(event.target)) return;
      if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) setFocused(false);
      const key = eventShortcut(event);
      const command = key && shortcutCommands.find((command) => bindings[command.id] === key)?.id;
      if (!command) return;
      if (
        (command === 'palette' && !hasPalette) ||
        (command === 'search' && (page !== 'workspace' || focusMode)) ||
        (command === 'focus' && (page !== 'workspace' || !vm)) ||
        (['terminal', 'files', 'project'].includes(command) && !vm) ||
        (['files', 'project'].includes(command) && !pluginSurfaceEnabled(enabled, 'tabs', command, system?.pluginRuntime)) ||
        (command === 'tasks' && !pluginSurfaceEnabled(enabled, 'pages', 'tasks', system?.pluginRuntime))
      )
        return;
      event.preventDefault();
      if (command === 'palette') setPalette(true);
      else if (command === 'search') searchRef.current?.focus();
      else if (command === 'theme') setTheme((value) => (value === 'day' ? 'night' : 'day'));
      else if (command === 'focus') setFocused((value) => !value);
      else if (['terminal', 'files', 'project'].includes(command))
        void navigatePalette({ page: 'workspace', tab: command });
      else void navigatePalette({ page: command });
    };
    window.addEventListener('keydown', handleKey);
    /**
     * 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In The application shell joining controller state, VM/project selection and plugin surfaces, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    return () => window.removeEventListener('keydown', handleKey);
  }, [bindings, page, focusMode, vm, hasPalette, enabled, navigatePalette]);
  useEffect(/** 中文：当依赖 [toast] 变化时timeout 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [toast] change, timeout state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  /**
   * 中文：动作入口统一设置忙碌状态，执行后失效并刷新控制面，再显示成功提示；失败显示 toast，finally 恢复按钮。命令回调仅委托 executeWorkspaceCommand。
   * English: The action entry marks busy, executes, invalidates/refreshes controller state and then shows success. Failures show a toast and finally restores controls; command callbacks only delegate to executeWorkspaceCommand.
   * 中文：输入：action：本次动作或状态机输入；message：签名所示 string 业务值
   * English: Inputs: action: current action/state-machine input; message: the string domain value in the signature
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   */
  async function run(action: /** 中文：在调用者提供的取消信号范围内执行用户动作，失败以拒绝或抛错传回；这是 App.run 的调用契约 | English: Execute a user action within the supplied cancellation signal, propagating failure through rejection/throw; this is the callable contract of App.run | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown>, message?: string) {
    setBusy(true);
    try {
      await action();
      invalidate();
      await refresh();
      if (message) setToast({ text: message });
    } catch (e: any) {
      setToast({ text: e.message, error: true });
    } finally {
      setBusy(false);
    }
  }
  /**
   * 中文：提交 operation /vms/{vm.id}/start，完成连接控制面状态、实例/项目选择与插件页面的应用外壳的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /vms/{vm.id}/start for The application shell joining controller state, VM/project selection and plugin surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const start = () =>
    vm && run(() => api(`/vms/${vm.id}/start`, 'POST'), '正在启动 Linux，终端将在就绪后连接');
  /**
   * 中文：提交 operation /vms/{vm.id}/stop，完成连接控制面状态、实例/项目选择与插件页面的应用外壳的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /vms/{vm.id}/stop for The application shell joining controller state, VM/project selection and plugin surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const stop = () =>
    vm && run(() => api(`/vms/${vm.id}/stop`, 'POST', { force: false }), '发行版已停止，磁盘数据已保留');
  /**
   * 中文：提交 operation /vms/{vm.id}/suspend，完成连接控制面状态、实例/项目选择与插件页面的应用外壳的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /vms/{vm.id}/suspend for The application shell joining controller state, VM/project selection and plugin surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const suspend = () => vm && run(() => api(`/vms/${vm.id}/suspend`, 'POST'), '发行版已暂停，可随时恢复');
  /**
   * 中文：提交 operation /vms/{vm.id}/resume，完成连接控制面状态、实例/项目选择与插件页面的应用外壳的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /vms/{vm.id}/resume for The application shell joining controller state, VM/project selection and plugin surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const resume = () => vm && run(() => api(`/vms/${vm.id}/resume`, 'POST'), '发行版已恢复');
  /**
   * 中文：提交 operation /vms/{id}/start；operation /vms/{id}/stop；operation /vms/{id}/suspend；operation /vms/{id}/resume，完成连接控制面状态、实例/项目选择与插件页面的应用外壳的数据交互并更新palette 状态、modal 状态、confirm 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /vms/{id}/start; operation /vms/{id}/stop; operation /vms/{id}/suspend; operation /vms/{id}/resume for The application shell joining controller state, VM/project selection and plugin surfaces and update palette state, modal state, confirm state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：command：签名所示 WorkspaceCommandDefinition 业务值
   * English: Inputs: command: the WorkspaceCommandDefinition domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const executeWorkspaceCommand = (command: WorkspaceCommandDefinition) => {
    if (command.disabled) return;
    const id = command.target?.id || selected;
    setPalette(false);
    if (command.action === 'create') {
      setModal('create');
      return;
    }
    if (command.action === 'delete') {
      if (!id || id !== selected) return;
      setConfirm('');
      setModal('delete');
      return;
    }
    if (command.action === 'navigate') {
      if (command.target) void navigatePalette(command.target);
      return;
    }
    if (!id) return;
    const operation =
      command.action === 'start'
        ? () => api(`/vms/${id}/start`, 'POST')
        : command.action === 'stop'
          ? () => api(`/vms/${id}/stop`, 'POST', { force: false })
          : command.action === 'suspend'
            ? () => api(`/vms/${id}/suspend`, 'POST')
            : () => api(`/vms/${id}/resume`, 'POST');
    const message =
      command.action === 'start'
        ? '正在启动 Linux，终端将在就绪后连接'
        : command.action === 'stop'
          ? '发行版已停止，磁盘数据已保留'
          : command.action === 'suspend'
            ? '发行版已暂停，可随时恢复'
            : '发行版已恢复';
    void run(operation, message);
  };
  const workspaceActions: PaletteAction[] = workspaceCommandDefinitions({
    vms,
    currentId: selected,
    canCreate: !loading && !!system?.imageReady,
    busy,
  })
    .filter(
      (command) =>
        (!['suspend', 'resume'].includes(command.action) || has('automation')) &&
        (!command.target?.page || pluginSurfaceEnabled(enabled, 'pages', command.target.page, system?.pluginRuntime)),
    )
    .map((command) => ({
      key: command.key,
      title: command.title,
      detail: command.detail,
      keywords: command.keywords,
      disabled: command.disabled,
      /**
       * 中文：动作入口统一设置忙碌状态，执行后失效并刷新控制面，再显示成功提示；失败显示 toast，finally 恢复按钮。命令回调仅委托 executeWorkspaceCommand。
       * English: The action entry marks busy, executes, invalidates/refreshes controller state and then shows success. Failures show a toast and finally restores controls; command callbacks only delegate to executeWorkspaceCommand.
       */
      run: () => executeWorkspaceCommand(command),
    }));
  const running = vms.filter((v) => v.status === 'running').length;
  const visibleVms = vms
    .filter(
      (v) =>
        (statusFilter === 'all' || v.status === statusFilter) &&
        [v.name, v.organization?.group || '', ...(v.organization?.tags || [])]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => Number(!!b.organization?.favorite) - Number(!!a.organization?.favorite));
  const allocated = vms.filter(active).reduce((sum, v) => sum + v.memoryMiB, 0);
  const engineState = offline ? 'error' : system?.nativeHost ? 'running' : 'starting';
  /**
   * 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中moreTabsOpen 状态，分区选择；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In The application shell joining controller state, VM/project selection and plugin surfaces, moreTabsOpen state, tab selection. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：id：目标资源标识
   * English: Inputs: id: target resource identifier
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const focusWorkspaceTab = (id: string) => {
    setMoreTabsOpen(false);
    void setTab(id);
    requestAnimationFrame(() => {
      tabMoreRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus();
    });
  };
  /**
   * 中文：在连接控制面状态、实例/项目选择与插件页面的应用外壳流程中moreTabsOpen 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In The application shell joining controller state, VM/project selection and plugin surfaces, moreTabsOpen state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：focusFirst：此处理器的调用值（缺省 false）
   * English: Inputs: focusFirst: the invocation value for this handler (default false)
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const openAdvancedTabs = (focusFirst = false) => {
    setMoreTabsOpen(true);
    if (focusFirst) {
      requestAnimationFrame(() => {
        tabMoreRef.current
          ?.querySelector<HTMLButtonElement>(`[data-tab="${advancedWorkspaceTabs[0].id}"]`)
          ?.focus();
      });
    }
  };
  const content = (
    <div
      className={`app-shell ${focusMode ? 'focus-mode' : ''}`}
      data-clipboard-app="workbench"
      data-clipboard-vm={selected || undefined}
    >
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Sakura 首页">
          <img src={sakuraMark} alt="" />
          <span>
            Sakura<span className="brand-dot">.</span>
          </span>
          <small>桜</small>
        </a>
        <div className="side-caption">你的工作空间</div>
        <nav aria-label="主导航">
          {['core', 'extensions'].map(/**
           * 中文功能：按基础与扩展分组过滤已经可见的导航页，空分组不渲染，并展示当前页及实例/插件数量。
           * English: Group already-visible navigation pages into core/extensions, omit empty groups and show current-page plus VM/plugin counts.
           * 输入 / Inputs: group.
           * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
           * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
           */
          (group) => {
            const items = visiblePages.filter((item) => corePageIds.has(item.id) === (group === 'core'));
            if (!items.length) return null;
            return (
              <div
                className="nav-group"
                key={group}
                role="group"
                aria-label={group === 'core' ? '基础功能' : '已启用的扩展'}
              >
                {group === 'extensions' && <div className="nav-group-caption">已启用的扩展</div>}
                {items.map((n) => (
                  <button
                    key={n.id}
                    aria-label={n.label}
                    aria-current={page === n.id ? 'page' : undefined}
                    title={n.label}
                    className={page === n.id ? 'nav-item selected' : 'nav-item'}
                    onClick={() => setPage(n.id)}
                  >
                    <n.icon size={18} />
                    <span>{n.label}</span>
                    {n.id === 'workspace' && <small>{vms.length.toString().padStart(2, '0')}</small>}
                    {n.id === 'plugins' && <small>{enabled.length}</small>}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-divider" />
        <div className="side-caption">
          发行版 <span>{vms.length}</span>
        </div>
        <div className="side-distros">
          {vms.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                setSelected(v.id);
                setPage('workspace');
                setQuery('');
                setStatusFilter('all');
              }}
              className={selected === v.id && page === 'workspace' ? 'selected-distro' : ''}
            >
              <span className={`tiny-dot ${v.status}`} />
              <span data-locale-ignore>{v.name}</span>
              <ChevronRight size={13} />
            </button>
          ))}
          <button onClick={() => setModal('create')} disabled={loading || !system?.imageReady}>
            <Plus size={14} />
            <span>添加发行版</span>
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="engine-card">
            <div>
              <span className={`tiny-dot ${engineState}`} />
              本地运行引擎
              <ShieldCheck size={14} />
            </div>
            <p>
              PosixLoom <span>+ QEMU</span>
            </p>
            <small>独立 Linux 内核 · 数据留在本机</small>
          </div>
          <button className="help-link" onClick={() => setModal('help')}>
            <CircleHelp size={17} /> 使用指南 <ArrowUpRight size={14} />
          </button>
          <div className="host-profile">
            <span>
              <Monitor size={17} />
            </span>
            <div>
              <b>本地工作空间</b>
              <small>{system?.hostname || '连接本机中'}</small>
            </div>
            <span className={`tiny-dot ${engineState}`} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span>Sakura</span>
            <ChevronRight size={13} />
            <b>{visiblePages.find((item) => item.id === page)?.label}</b>
          </div>
          <div className="topbar-actions">
            <SessionLockButton />
            <AccountLogoutButton />
            <button
              id="accessibility-mode-toggle"
              data-audit-tools
              className="icon-button"
              aria-label="无障碍检查模式"
              aria-pressed={auditMode}
              title="无障碍检查模式"
              onClick={() => {
                setAuditLoaded(true);
                setAuditMode(!auditMode);
              }}
            >
              <Accessibility size={18} />
            </button>
            {hasPalette && (
              <button
                className="text-button command-shortcut"
                onClick={() => setPalette(true)}
                aria-label="打开命令面板"
              >
                <Search size={16} />
                <span>快速前往</span>
                <kbd>{bindings.palette.replace('Mod', 'Ctrl / ⌘') || '未设置'}</kbd>
              </button>
            )}
            <span className="local-badge">
              <ShieldCheck size={14} />
              仅本机访问
            </span>
            <span className="topbar-divider" />
            <button
              className="theme-toggle"
              aria-label={theme === 'day' ? '切换到夜樱主题' : '切换到花昼主题'}
              title={theme === 'day' ? '切换到夜樱主题' : '切换到花昼主题'}
              onClick={() => setTheme(theme === 'day' ? 'night' : 'day')}
            >
              {theme === 'day' ? <Sun size={16} /> : <Moon size={16} />}
              <span>{theme === 'day' ? '花昼' : '夜樱'}</span>
            </button>
          </div>
        </header>
        <main>
          {page === 'plugins' && system && <PluginCenter request={api} />}
          {page === 'tasks' && <TasksPanel request={api} vms={vms}
            onDiagnose={id => void navigatePalette({ id, page: 'workspace', tab: 'maintenance' })} />}
          {pluginPageOwner && !builtInPageIds.has(page) && (
            <PluginPage
              key={page}
              owner={pluginPageOwner}
              id={page}
              request={workspaceApi}
              vms={vms}
              selected={selected}
              refresh={refresh}
              token={token}
              projectId={projectId}
              onSelected={(id) => void setSelected(id)}
              onCreate={() => setModal('create')}
            />
          )}
          {offline && (
            <div className="error-banner">
              连接出现问题：{offline}
              <button onClick={reconnect}>重新连接</button>
            </div>
          )}
          {page === 'workspace' && (
            <>
              <div className="page-heading welcome-banner">
                <div className="welcome-copy">
                  <div className="eyebrow">
                    <Flower2 size={14} /> A SPACE TO BLOOM
                  </div>
                  <h1>
                    让灵感，在此<span className="accent-text">生长。</span>
                  </h1>
                  <p>一个轻盈的 Linux 空间，让每次创造从容开始。</p>
                  <div className="hero-actions">
                    <button
                      className="primary"
                      onClick={() => setModal('create')}
                      disabled={loading || !system?.imageReady}
                    >
                      <Plus size={16} />
                      创建发行版
                    </button>
                    <button className="hero-guide" onClick={() => void setPage('plugins')}>
                      <Puzzle size={15} /> 按需添加插件 <ArrowUpRight size={15} />
                    </button>
                  </div>
                </div>
                <SakuraArt />
              </div>
              <div className="stats">
                <div className="stat">
                  <span className="stat-label">
                    <Boxes size={16} />
                    我的发行版
                  </span>
                  <div>
                    <strong>{vms.length.toString().padStart(2, '0')}</strong>
                    <span className="stat-note">
                      <i className="tiny-dot running" />
                      {running} 个正在运行
                    </span>
                  </div>
                </div>
                <div className="stat">
                  <span className="stat-label">
                    <MemoryStick size={16} />
                    已分配内存
                  </span>
                  <div>
                    <strong>
                      {formatNumber(allocated >= 1024 ? allocated / 1024 : allocated, {
                        maximumFractionDigits: 1,
                      })}
                      <small>{allocated >= 1024 ? 'GiB' : 'MiB'}</small>
                    </strong>
                    <span className="stat-note">运行实例配置总量</span>
                  </div>
                </div>
                <div className="stat">
                  <span className="stat-label">
                    <HardDrive size={16} />
                    增量磁盘占用
                  </span>
                  <div>
                    <strong>
                      {bytes(vms.reduce((a, v) => a + v.diskBytes, 0)).split(' ')[0]}
                      <small>{bytes(vms.reduce((a, v) => a + v.diskBytes, 0)).split(' ')[1]}</small>
                    </strong>
                    <span className="stat-note">按实际写入增长</span>
                  </div>
                </div>
              </div>
              <div className="workspace-heading">
                <h2>
                  我的工作空间 <span>{vms.length}</span>
                </h2>
                <span>
                  <span className={`tiny-dot ${engineState}`} />{' '}
                  {offline ? '运行引擎连接中断' : system?.nativeHost ? '运行引擎已连接' : '连接运行时'}
                </span>
              </div>
              <div className="workspace">
                <section className="distro-panel" aria-label="发行版列表" aria-busy={loading}>
                  <div className="distro-panel-heading">
                    <span>发行版</span>
                    <span role="status">{loading ? '读取中…' : `${visibleVms.length} / ${vms.length}`}</span>
                  </div>
                  <div className="search-box">
                    <Search size={15} />
                    <input
                      ref={searchRef}
                      aria-label="查找发行版"
                      placeholder="查找发行版…"
                      value={query}
                      disabled={loading}
                      aria-controls="distro-list"
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape' && query) {
                          e.stopPropagation();
                          setQuery('');
                        }
                      }}
                    />
                    {query ? (
                      <button
                        className="clear-search"
                        aria-label="清空发行版搜索"
                        onClick={() => {
                          setQuery('');
                          searchRef.current?.focus();
                        }}
                      >
                        <X size={13} />
                      </button>
                    ) : (
                      <kbd aria-hidden="true">/</kbd>
                    )}
                  </div>
                  <div className="distro-filters" role="group" aria-label="发行版状态筛选">
                    {(
                      [
                        { id: 'all', label: '全部', count: vms.length },
                        { id: 'running', label: '运行中', count: running },
                        {
                          id: 'paused',
                          label: '已暂停',
                          count: vms.filter((v) => v.status === 'paused').length,
                        },
                        {
                          id: 'stopped',
                          label: '已停止',
                          count: vms.filter((v) => v.status === 'stopped').length,
                        },
                      ] as const
                    ).map((filter) => (
                      <button
                        key={filter.id}
                        aria-label={`筛选${filter.label}发行版`}
                        aria-pressed={statusFilter === filter.id}
                        aria-controls="distro-list"
                        onClick={() => setStatusFilter(filter.id)}
                      >
                        {filter.label}
                        <small aria-hidden="true">{filter.count}</small>
                      </button>
                    ))}
                  </div>
                  <div className="distro-list" id="distro-list">
                    {loading && (
                      <div className="distro-skeleton" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </div>
                    )}
                    {visibleVms.map((v) => (
                      <button
                        key={v.id}
                        className={`distro-card ${vm?.id === v.id ? 'active' : ''}`}
                        aria-pressed={vm?.id === v.id}
                        aria-label={`打开 ${v.name}，${states[v.status]}`}
                        onClick={() => setSelected(v.id)}
                      >
                        <div className="distro-card-top">
                          <Alpine small />
                          <div className="distro-identity">
                            <h3 title={v.name} data-locale-ignore>
                              {v.organization?.favorite ? '★ ' : ''}
                              {v.name}
                            </h3>
                            <p>{distroName(v.distro, v.architecture)}</p>
                          </div>
                          {vm?.id === v.id ? <CircleDot size={16} /> : <ChevronRight size={15} />}
                        </div>
                        <div className="distro-resources">
                          <span>
                            <Cpu size={12} />
                            {v.cpus} vCPU
                          </span>
                          <span>
                            <MemoryStick size={12} />
                            {memory(v.memoryMiB)}
                          </span>
                        </div>
                        <div className="distro-card-bottom">
                          <Badge vm={v} />
                          <span>{vm?.id === v.id ? '当前空间' : '打开空间'}</span>
                        </div>
                      </button>
                    ))}
                    {!loading && !vms.length && (
                      <div className="empty-list">
                        <Boxes size={26} />
                        <p>从第一个发行版开始</p>
                      </div>
                    )}
                    {!loading && vms.length > 0 && !visibleVms.length && (
                      <div className="distro-no-results" role="status">
                        <Search size={24} />
                        <h3>
                          {query.trim()
                            ? '没有匹配的发行版'
                            : statusFilter === 'running'
                              ? '暂时没有运行中的空间'
                              : '暂时没有已停止的空间'}
                        </h3>
                        <p>试试其他名称，或查看全部发行版。</p>
                        <button
                          onClick={() => {
                            setQuery('');
                            setStatusFilter('all');
                            searchRef.current?.focus();
                          }}
                        >
                          显示全部 <ArrowRight size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    className="add-distro"
                    onClick={() => setModal('create')}
                    disabled={loading || !system?.imageReady}
                  >
                    <Plus size={16} />
                    新的 Linux 空间
                  </button>
                  <div className="workflow-note">
                    <Flower2 size={22} />
                    <h4>停下片刻，灵感继续。</h4>
                    <p>
                      关闭窗口后，Linux 继续运行。
                      <br />
                      再次打开，就能接着工作。
                    </p>
                    <button onClick={() => setModal('help')}>
                      探索命令行 <ArrowUpRight size={13} />
                    </button>
                  </div>
                </section>
                <section className="machine-panel" ref={machineRef}>
                  {vm ? (
                    <>
                      <div className="machine-head">
                        <div className="machine-title">
                          <Alpine />
                          <div>
                            <div>
                              <h2 data-locale-ignore>{vm.name}</h2>
                              <Badge vm={vm} />
                            </div>
                            <p>
                              <span>{distroName(vm.distro, vm.architecture)}</span>
                              <span>
                                独立内核 ·{' '}
                                {vm.activeAccelerator?.toUpperCase() ||
                                  (vm.accelerator === 'auto' ? '自动' : vm.accelerator.toUpperCase())}
                              </span>
                            </p>
                          </div>
                        </div>
                        <div className="machine-actions">
                          {vm.status === 'running' ? (
                            <>
                              {has('automation') && (
                                <button className="secondary compact" disabled={busy} onClick={suspend}>
                                  暂停
                                </button>
                              )}
                              <button className="secondary compact" disabled={busy} onClick={stop}>
                                <Square size={13} />
                                停止
                              </button>
                            </>
                          ) : vm.status === 'paused' ? (
                            <>
                              {has('automation') && (
                                <button className="primary compact" disabled={busy} onClick={resume}>
                                  恢复
                                </button>
                              )}
                              <button className="secondary compact" disabled={busy} onClick={stop}>
                                <Square size={13} />
                                停止
                              </button>
                            </>
                          ) : active(vm) ? (
                            <button
                              className="secondary compact"
                              disabled={busy || vm.status === 'stopping'}
                              onClick={stop}
                            >
                              <Square size={13} />
                              {vm.status === 'stopping' ? '停止中' : '停止'}
                            </button>
                          ) : (
                            <button className="primary compact" disabled={busy} onClick={start}>
                              <Play size={14} />
                              启动
                            </button>
                          )}
                          <button
                            className="icon-button settings-shortcut"
                            title="发行版设置"
                            aria-label="发行版设置"
                            onClick={() => setTab('config')}
                          >
                            <Settings2 size={18} />
                          </button>
                          <button
                            className="icon-button focus-toggle"
                            aria-label={focusMode ? '退出专注模式' : '进入专注模式'}
                            title={focusMode ? '退出专注模式' : '专注模式'}
                            aria-pressed={focusMode}
                            onClick={() => setFocused(!focused)}
                          >
                            {focusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                          </button>
                        </div>
                      </div>
                      <div className="tab-navigation" ref={tabMoreRef}>
                        <div className="workspace-plugin-tools">
                          <span>
                            {visibleWorkspaceTabs.length > 2
                              ? `${visibleWorkspaceTabs.length - 2} 项插件功能可用`
                              : '终端与配置已就绪'}
                          </span>
                          <button onClick={() => void setPage('plugins')}>
                            <Puzzle size={13} />
                            管理插件
                            <ArrowUpRight size={12} />
                          </button>
                        </div>
                        <div className="tabs" role="tablist" aria-label="发行版常用功能">
                          {primaryWorkspaceTabs.map((t) => (
                            <button
                              role="tab"
                              id={`tab-${t.id}`}
                              data-tab={t.id}
                              aria-controls="machine-content"
                              tabIndex={tab === t.id ? 0 : -1}
                              aria-selected={tab === t.id}
                              key={t.id}
                              className={tab === t.id ? 'active' : ''}
                              onClick={() => {
                                setMoreTabsOpen(false);
                                void setTab(t.id);
                              }}
                              onKeyDown={/**
                               * 中文功能：在主要工作区标签和更多入口间处理左右键、Home/End，选择目标时分别打开高级菜单或聚焦普通标签。
                               * English: Handle left/right/Home/End across primary workspace tabs and the more entry, opening the advanced menu or focusing an ordinary tab as appropriate.
                               * 输入 / Inputs: event.
                               * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
                               * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
                               */
                              (event) => {
                                const ids = [
                                  ...primaryWorkspaceTabs.map((item) => item.id),
                                  ...(advancedWorkspaceTabs.length ? ['more'] : []),
                                ];
                                const index = ids.indexOf(t.id);
                                const next =
                                  event.key === 'ArrowRight'
                                    ? ids[(index + 1) % ids.length]
                                    : event.key === 'ArrowLeft'
                                      ? ids[(index + ids.length - 1) % ids.length]
                                      : event.key === 'Home'
                                        ? ids[0]
                                        : event.key === 'End'
                                          ? ids[ids.length - 1]
                                          : null;
                                if (!next) return;
                                event.preventDefault();
                                if (next === 'more') {
                                  openAdvancedTabs();
                                  tabMoreRef.current
                                    ?.querySelector<HTMLButtonElement>('.tabs-more-trigger')
                                    ?.focus();
                                } else {
                                  focusWorkspaceTab(next);
                                }
                              }}
                            >
                              <t.icon size={15} />
                              {t.label}
                            </button>
                          ))}
                          {advancedWorkspaceTabs.length > 0 && (
                            <button
                              type="button"
                              id="tab-more"
                              aria-label="更多插件功能"
                              className={`tabs-more-trigger ${advancedWorkspaceTabs.some((item) => item.id === tab) ? 'active' : ''}`}
                              aria-expanded={moreTabsOpen}
                              aria-haspopup="menu"
                              onClick={() => setMoreTabsOpen((open) => !open)}
                              onKeyDown={/**
                               * 中文功能：让更多入口的左右键/Home 回到主要标签，ArrowDown 打开并进入高级标签菜单。
                               * English: Return from the more entry to primary tabs on left/right/Home and open/enter the advanced menu on ArrowDown.
                               * 输入 / Inputs: event.
                               * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
                               * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
                               */
                              (event) => {
                                if (event.key === 'ArrowLeft') {
                                  event.preventDefault();
                                  focusWorkspaceTab(primaryWorkspaceTabs[primaryWorkspaceTabs.length - 1].id);
                                }
                                if (event.key === 'ArrowRight' || event.key === 'Home') {
                                  event.preventDefault();
                                  focusWorkspaceTab(primaryWorkspaceTabs[0].id);
                                }
                                if (event.key === 'ArrowDown') {
                                  event.preventDefault();
                                  openAdvancedTabs(true);
                                }
                              }}
                            >
                              <MoreHorizontal size={15} />
                              <span>
                                {advancedWorkspaceTabs.find((item) => item.id === tab)?.label || '更多'}
                              </span>
                              <ChevronRight
                                size={13}
                                className={moreTabsOpen ? 'tabs-more-chevron open' : 'tabs-more-chevron'}
                              />
                            </button>
                          )}
                        </div>
                        <div
                          className="tabs-menu"
                          role="menu"
                          aria-label="更多发行版功能"
                          hidden={!moreTabsOpen}
                        >
                          <div className="tabs-menu-label">已启用的插件功能</div>
                          {advancedWorkspaceTabs.map((t) => (
                            <button
                              type="button"
                              role="menuitem"
                              id={`tab-${t.id}`}
                              data-tab={t.id}
                              key={t.id}
                              className={tab === t.id ? 'selected' : ''}
                              onClick={() => {
                                setMoreTabsOpen(false);
                                void setTab(t.id);
                              }}
                              onKeyDown={/**
                               * 中文功能：让高级标签菜单支持上下/左右循环、Home/End 和 Escape，选择后同步标签及焦点，退出时回到更多按钮。
                               * English: Support up/down/left/right cycling, Home/End and Escape in advanced tabs, synchronize tab/focus on selection, and return to the more button on exit.
                               * 输入 / Inputs: event.
                               * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
                               * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
                               */
                              (event) => {
                                const ids = advancedWorkspaceTabs.map((item) => item.id);
                                const index = ids.indexOf(t.id);
                                const next =
                                  event.key === 'ArrowDown' || event.key === 'ArrowRight'
                                    ? ids[(index + 1) % ids.length]
                                    : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
                                      ? ids[(index + ids.length - 1) % ids.length]
                                      : event.key === 'Home'
                                        ? ids[0]
                                        : event.key === 'End'
                                          ? ids[ids.length - 1]
                                          : null;
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  setMoreTabsOpen(false);
                                  tabMoreRef.current
                                    ?.querySelector<HTMLButtonElement>('.tabs-more-trigger')
                                    ?.focus();
                                  return;
                                }
                                if (!next) return;
                                event.preventDefault();
                                void setTab(next);
                                tabMoreRef.current
                                  ?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)
                                  ?.focus();
                              }}
                            >
                              <t.icon size={15} />
                              <span>{t.label}</span>
                              {t.id === 'snapshots' && vm.snapshots.length > 0 && (
                                <small>{vm.snapshots.length}</small>
                              )}
                              {tab === t.id && <Check size={14} className="tabs-menu-check" />}
                            </button>
                          ))}
                        </div>
                      </div>
                      {vm.lastError && <div className="machine-error">{vm.lastError}</div>}
                      <div
                        className="machine-content"
                        id="machine-content"
                        role="tabpanel"
                        aria-labelledby={`tab-${tab}`}
                      >
                        <div className="terminal-panel-slot" hidden={tab !== 'terminal'}>
                          {hasProjects && !projectId ? (
                            <div className="terminal-offline" role="status">
                              <p>{projectLoadError || '正在加载工作项目…'}</p>
                              {projectLoadError && <button onClick={reloadProject}>重新加载项目</button>}
                            </div>
                          ) : has('terminal-workspace') ? (
                            <TerminalWorkspace
                              key={`${vm.id}:${projectId || ''}`}
                              id={vm.id}
                              projectId={projectId}
                              request={api}
                              render={(session) => (
                                <TerminalPanel
                                  vm={vm}
                                  start={start}
                                  busy={busy}
                                  session={session}
                                  projectId={projectId}
                                />
                              )}
                            />
                          ) : (
                            <TerminalPanel
                              key={`${vm.id}:${projectId || ''}`}
                              vm={vm}
                              start={start}
                              busy={busy}
                              projectId={projectId}
                            />
                          )}
                        </div>
                        {tab === 'development' && (
                          <DevelopmentPanel
                            key={`${vm.id}:${projectId || ''}`}
                            vm={vm}
                            request={workspaceApi}
                            token={token}
                            refresh={refresh}
                            projectId={projectId}
                          />
                        )}
                        {pluginTabOwner && !builtInTabIds.has(tab) && (
                          <PluginTab
                            key={`${pluginTabOwner}-${tab}-${vm.id}:${projectId || ''}`}
                            owner={pluginTabOwner}
                            id={tab}
                            vm={vm}
                            request={workspaceApi}
                            token={token}
                            refresh={refresh}
                            projectId={projectId}
                            onProjectChange={onProjectChange}
                            start={start}
                            busy={busy}
                            configure={() => setTab('config')}
                            openFile={openFile?.id === vm.id ? openFile : undefined}
                          />
                        )}
                        {tab === 'config' && (
                          <ConfigPanel
                            key={`${vm.id}-${vm.memoryMiB}-${vm.cpus}-${vm.accelerator}`}
                            vm={vm}
                            busy={busy}
                            save={(config) =>
                              run(
                                () => api(`/vms/${vm.id}`, 'PATCH', config),
                                '资源配置已保存，下次启动时生效',
                              )
                            }
                            remove={() => {
                              setConfirm('');
                              setModal('delete');
                            }}
                          />
                        )}
                      </div>
                      <div className="machine-footer">
                        <span>
                          <Cpu size={13} />
                          {vm.cpus} vCPU
                        </span>
                        <span>
                          <MemoryStick size={13} />
                          {memory(vm.memoryMiB)}
                        </span>
                        <span>
                          <HardDrive size={13} />
                          {vm.diskGiB} GiB 容量
                        </span>
                        <span className="footer-network">
                          <Network size={13} />
                          NAT · {vm.forwards.length} 条转发
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="welcome-empty">
                      <div className="welcome-art">
                        <span />
                        <Boxes size={46} />
                        <span />
                      </div>
                      <span className="eyebrow">YOUR NEXT IDEA STARTS HERE</span>
                      <h2>给灵感一个 Linux 空间。</h2>
                      <p>
                        无需手动安装系统。一份独立的 Linux，
                        <br />
                        一个独立内核，还有完全属于你的终端。
                      </p>
                      <button
                        className="primary"
                        disabled={loading || !system?.imageReady}
                        onClick={() => setModal('create')}
                      >
                        <Plus size={16} />
                        {loading ? '正在连接运行时' : '创建第一个发行版'}
                      </button>
                      <div className="empty-features">
                        <span>
                          <ShieldCheck size={14} />
                          本地持久化
                        </span>
                        <span>
                          <MemoryStick size={14} />
                          512 MiB 起步
                        </span>
                        <span>
                          <TerminalSquare size={14} />
                          即开即用
                        </span>
                      </div>
                    </div>
                  )}
                </section>
              </div>
              <div className="page-foot">
                <span>
                  <Flower2 size={14} />A little space. A new beginning.
                </span>
                <span>PosixLoom 编排 · QEMU 虚拟化 · Linux</span>
              </div>
            </>
          )}
          {page === 'settings' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <ShieldCheck size={14} /> ROOTED IN YOUR MACHINE
                  </div>
                  <h1>你的机器，你的空间。</h1>
                  <p>所有系统和文件都存储在这台电脑上。</p>
                </div>
              </div>
              <div className="system-grid">
                <LocaleSettings />
                <section className="system-card">
                  <h3>可信更新中心</h3>
                  <p>管理可信发布者，验证本地签名发行包，暂存、启用或回退应用版本。</p>
                  <button className="secondary compact" onClick={() => setShowTrustedUpdates(!showTrustedUpdates)}>
                    {showTrustedUpdates ? '收起更新中心' : '打开更新中心'}
                  </button>
                </section>
                {showTrustedUpdates && <Suspense fallback={<p>正在读取更新状态…</p>}>
                  <TrustedUpdateSettings request={api} />
                </Suspense>}
                <section className="system-card">
                  <h3>本地 AI 助手与命令规划</h3>
                  <p>使用本机模型解释代码、生成测试与修复建议，或预览命令计划。</p>
                  <button className="secondary compact" onClick={() => setShowAssistant(!showAssistant)}>
                    {showAssistant ? '收起本地助手' : '打开本地助手'}
                  </button>
                </section>
                {showAssistant && (
                  <Suspense fallback={<p>正在读取本地助手…</p>}>
                    <LocalAssistant request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>事件与告警通知</h3>
                  <p>将任务事件和按标签筛选的告警发送到已配置的 Webhook 接收端。</p>
                  <button className="secondary compact" onClick={() => setShowWebhooks(!showWebhooks)}>
                    {showWebhooks ? '收起事件通知' : '管理事件通知'}
                  </button>
                </section>
                {showWebhooks && (
                  <Suspense fallback={<p>正在读取通知配置…</p>}>
                    <WebhookSettings request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>事件自动化规则</h3>
                  <p>匹配任务与告警事件，预览后执行实例操作或经单独批准的修复 Runbook。</p>
                  <button
                    className="secondary compact"
                    onClick={() => setShowAutomationRules(!showAutomationRules)}
                  >
                    {showAutomationRules ? '收起自动化规则' : '管理自动化规则'}
                  </button>
                </section>
                {showAutomationRules && (
                  <Suspense fallback={<p>正在读取自动化规则…</p>}>
                    <AutomationRuleSettings request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>插件功能灰度</h3>
                  <p>按稳定主机分桶控制已选择插件在下次服务启动时是否激活。</p>
                  <button
                    className="secondary compact"
                    onClick={() => setShowFeatureRollouts(!showFeatureRollouts)}
                  >
                    {showFeatureRollouts ? '收起插件灰度' : '管理插件灰度'}
                  </button>
                </section>
                {showFeatureRollouts && (
                  <Suspense fallback={<p>正在读取插件灰度…</p>}>
                    <FeatureRolloutSettings request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>主机配对与多主机状态</h3>
                  <p>通过一次性短码和 TLS 指纹连接另一台 Sakura，查看资源与连通性。</p>
                  <button className="secondary compact" onClick={() => setShowHostPeers(!showHostPeers)}>
                    {showHostPeers ? '收起主机配对' : '管理主机配对'}
                  </button>
                </section>
                {showHostPeers && (
                  <Suspense fallback={<p>正在读取主机状态…</p>}>
                    <HostPeersSettings request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>集群策略发布</h3>
                  <p>保存并复核跨主机插件灰度批次，再向获授权的目标逐台发布。</p>
                  <button
                    className="secondary compact"
                    onClick={() => setShowFleetRollouts(!showFleetRollouts)}
                  >
                    {showFleetRollouts ? '收起集群策略' : '管理集群策略'}
                  </button>
                </section>
                {showFleetRollouts && (
                  <Suspense fallback={<p>正在读取集群策略…</p>}>
                    <FleetPolicyRolloutSettings request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>GPU/vGPU 档案</h3>
                  <p>保存并复用虚拟显卡输出与宿主显存配置，预览宿主后端后应用到停止的实例。</p>
                  <button className="secondary compact" onClick={() => setShowGpuProfiles(!showGpuProfiles)}>
                    {showGpuProfiles ? '收起 GPU 档案' : '管理 GPU 档案'}
                  </button>
                </section>
                {showGpuProfiles && (
                  <Suspense fallback={<p>正在读取 GPU 档案…</p>}>
                    <GpuProfilesSettings request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>构建农场</h3>
                  <p>登记 Linux 实例节点，按标签和并发槽位排队执行构建命令。</p>
                  <button className="secondary compact" onClick={() => setShowBuildFarm(!showBuildFarm)}>
                    {showBuildFarm ? '收起构建农场' : '管理构建农场'}
                  </button>
                </section>
                {showBuildFarm && (
                  <Suspense fallback={<p>正在读取构建队列…</p>}>
                    <BuildFarmSettings request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>音视频设备</h3>
                  <p>配置虚拟声卡与宿主音频，并管理 USB 摄像头、麦克风和耳机转发。</p>
                  <button
                    className="secondary compact"
                    onClick={() => setShowMediaDevices(!showMediaDevices)}
                  >
                    {showMediaDevices ? '收起音视频设备' : '管理音视频设备'}
                  </button>
                </section>
                {showMediaDevices && (
                  <Suspense fallback={<p>正在读取音视频设备…</p>}>
                    <MediaDevicesSettings request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>控制面锁定</h3>
                  <p>设置解锁密码和自动锁定的空闲时间。</p>
                  <button className="secondary compact" onClick={() => setShowSessionLock(!showSessionLock)}>
                    {showSessionLock ? '收起锁定设置' : '管理会话锁定'}
                  </button>
                </section>
                {showSessionLock && <SessionLockSettings request={api} />}
                <AccessSettings />
                <section className="system-card">
                  <h3>GraphQL 查询</h3>
                  <p>选择需要的实例和任务字段，读取本机状态。</p>
                  <button className="secondary compact" onClick={() => setShowGraph(!showGraph)}>
                    {showGraph ? '收起 GraphQL 查询' : '打开 GraphQL 查询'}
                  </button>
                </section>
                {showGraph && (
                  <Suspense fallback={<p>正在读取 GraphQL Schema…</p>}>
                    <GraphQLExplorer request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>日志保留策略</h3>
                  <p>设置已结束任务的日志保留天数和容量上限。</p>
                  <button className="secondary compact" onClick={() => setShowRetention(!showRetention)}>
                    {showRetention ? '收起日志策略' : '管理任务日志'}
                  </button>
                </section>
                {showRetention && (
                  <Suspense fallback={<p>正在读取日志策略…</p>}>
                    <LogRetentionSettings request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>开发接口</h3>
                  <p>查看接口文档、试读状态并下载 JavaScript 客户端。</p>
                  <button className="secondary compact" onClick={() => setShowApi(!showApi)}>
                    {showApi ? '收起 API 浏览器' : '打开 API 浏览器'}
                  </button>
                </section>
                {showApi && (
                  <Suspense fallback={<p>正在加载 API 文档…</p>}>
                    <ApiExplorer request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>离线监控 PWA</h3>
                  <p>查看最近的实例状态和任务事件。可在独立监控页启用离线缓存，并通过浏览器安装。</p>
                  <a href="/monitor/index.html" target="_blank" rel="noreferrer">
                    打开只读监控 ↗
                  </a>
                </section>
                <ShortcutSettings
                  preferences={shortcuts}
                  context={shortcutScope}
                  projectName={projectId ? `${vm?.name || ''} / ${projectId}` : undefined}
                />
                <ClipboardSettings vms={vms} />
                <section className="system-card">
                  <h3>Windows 应用剪贴板</h3>
                  <p>为本机应用设置复制与粘贴规则，并查看进程状态。</p>
                  <button
                    className="secondary compact"
                    onClick={() => setShowNativeClipboard(!showNativeClipboard)}
                  >
                    {showNativeClipboard ? '收起 Windows 剪贴板策略' : '管理 Windows 剪贴板策略'}
                  </button>
                </section>
                {showNativeClipboard && (
                  <Suspense fallback={<p>正在读取 Windows 剪贴板策略…</p>}>
                    <NativeClipboardSettings request={api} />
                  </Suspense>
                )}
                <section className="system-card">
                  <h3>桌面录制库</h3>
                  <p>回放、下载或删除保存在此浏览器的录制。</p>
                  <button className="secondary compact" onClick={() => setShowRecordings((value) => !value)}>
                    {showRecordings ? '收起录制库' : '管理录制库'}
                  </button>
                  {showRecordings && (
                    <Suspense fallback={<p>正在读取录制库…</p>}>
                      <RecordingLibrary />
                    </Suspense>
                  )}
                </section>
                <section className="system-card">
                  <h3>Windows 工作区集成</h3>
                  <p>管理资源管理器右键菜单、文件关联及宿主编辑器。</p>
                  <button className="secondary compact" onClick={() => setShowNative(!showNative)}>
                    {showNative ? '收起 Windows 集成' : '管理 Windows 集成'}
                  </button>
                </section>
                {showNative && (
                  <Suspense fallback={<p>正在读取 Windows 集成…</p>}>
                    <NativeIntegrationSettings request={api} />
                  </Suspense>
                )}
                <div className="system-card">
                  <div className="panel-heading">
                    <h3>
                      <Monitor size={19} />
                      宿主机
                    </h3>
                    <span className="tag">{system?.platform}</span>
                  </div>
                  <dl>
                    <dt>设备名称</dt>
                    <dd>{system?.hostname}</dd>
                    <dt>逻辑处理器</dt>
                    <dd>{system?.hostCpus} 核</dd>
                    <dt>物理内存</dt>
                    <dd>{memory(system?.hostMemoryMiB || 0)}</dd>
                    <dt>当前可用内存</dt>
                    <dd>{memory(system?.freeMemoryMiB || 0)}</dd>
                    <dt>控制服务内存</dt>
                    <dd>{memory(system?.controllerMemoryMiB || 0)}</dd>
                  </dl>
                </div>
                <div className="system-card">
                  <h3>
                    <Layers size={19} />
                    运行引擎
                  </h3>
                  <dl>
                    <dt>PosixLoom</dt>
                    <dd>v{system?.posixloom}</dd>
                    <dt>原生宿主</dt>
                    <dd>{system?.nativeHost ? '已连接 · Windows Job Object' : '未连接'}</dd>
                    <dt>QEMU</dt>
                    <dd>{system?.engine.split(' (')[0]}</dd>
                    <dt>同时运行上限</dt>
                    <dd>4 个发行版</dd>
                    <dt>管理服务</dt>
                    <dd>127.0.0.1 · 仅本机</dd>
                  </dl>
                </div>
              </div>
              {has('migration') && <MigrationPanel request={api} />}
              <div className="info-callout">
                <ShieldCheck size={24} />
                <div>
                  <h3>让每一层各司其职。</h3>
                  <p>
                    PosixLoom 管理命令、会话和进程生命周期，QEMU 提供独立 Linux 内核。停止 Sakura
                    服务时，已启动的虚拟机也会关闭，磁盘数据继续保留。
                  </p>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      {palette && hasPalette && (
        <CommandPalette
          vms={vms}
          vm={vm}
          request={api}
          actions={workspaceActions}
          navigate={navigatePalette}
          close={() => setPalette(false)}
        />
      )}
      {auditLoaded && (
        <Suspense fallback={null}>
          <AccessibilityAudit
            enabled={auditMode}
            pageKey={JSON.stringify([page, tab, selected, projectId, theme, modal, palette])}
            pageName={page + (page === 'workspace' ? ':' + tab : '')}
            close={() => {
              setAuditMode(false);
              document.getElementById('accessibility-mode-toggle')?.focus();
            }}
          />
        </Suspense>
      )}
      {toast && (
        <div role="status" className={`toast ${toast.error ? 'error' : ''}`}>
          {toast.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{toast.text}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal === 'create' && (
        <CreateModal
          busy={busy}
          names={vms.map((v) => v.name)}
          close={() => setModal(null)}
          submit={(config, boot) =>
            run(/** 中文：提交 operation /vms；operation /vms/{result.id}/start，完成连接控制面状态、实例/项目选择与插件页面的应用外壳的数据交互并更新当前选择、页面选择、分区选择、搜索或查询文本、statusFilter 状态、modal 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /vms; operation /vms/{result.id}/start for The application shell joining controller state, VM/project selection and plugin surfaces and update current selection, page selection, tab selection, search/query text, statusFilter state, modal state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
              const result = await api<VMView>('/vms', 'POST', config);
              upsertVm(result);
              setSelected(result.id);
              setPage('workspace');
              setTab(config.template && config.template !== 'none' ? 'project' : 'terminal');
              setQuery('');
              setStatusFilter('all');
              setModal(null);
              if (boot) await api(`/vms/${result.id}/start`, 'POST');
            }, '新的 Linux 空间已创建')
          }
        />
      )}
      {modal === 'help' && (
        <Modal
          title="像使用 WSL 一样，自然。"
          subtitle="浏览器和命令行，进入同一个 Linux 工作空间。"
          onClose={() => setModal(null)}
        >
          <div className="help-content">
            <h3>从浏览器开始</h3>
            <p>
              创建发行版后，启动系统并自动连接终端。文件保存在 Linux
              磁盘中，重启后仍然存在。需要文件、桌面或开发工具时，在插件中心按需启用。
            </p>
            <h3>也可以在命令行使用</h3>
            <pre>{`npm run sakura -- list\nnpm run sakura -- shell ${vm?.name || 'alpine-dev'}\nnpm run sakura -- exec ${vm?.name || 'alpine-dev'} -- uname -a\nnpm run sakura -- stop ${vm?.name || 'alpine-dev'}`}</pre>
            <p>首次启动会初始化磁盘、网络和密钥，通常需要几十秒。启动过程中可以直接查看 Linux 日志。</p>
            <div className="subtle-note">
              基础版提供 Alpine 与单终端。整合包可以组合文件、开发、运维或桌面插件；选择后重启服务生效。
            </div>
          </div>
        </Modal>
      )}
      {modal === 'delete' && vm && (
        <Modal
          title="删除发行版"
          subtitle="此操作永久删除该发行版、磁盘和所有快照。"
          onClose={() => setModal(null)}
        >
          <label>
            输入 {vm.name} 以确认
            <input autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setModal(null)}>
              取消
            </button>
            <button
              className="danger"
              disabled={busy || confirm !== vm.name}
              onClick={() =>
                run(/** 中文：提交 operation /vms/{vm.id}，完成连接控制面状态、实例/项目选择与插件页面的应用外壳的数据交互并更新modal 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /vms/{vm.id} for The application shell joining controller state, VM/project selection and plugin surfaces and update modal state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
                  await api(`/vms/${vm.id}`, 'DELETE');
                  setModal(null);
                }, '发行版已删除')
              }
            >
              永久删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
  return (
    <PluginContext.Provider value={enabled}>
      <Suspense fallback={<p role="status">正在加载功能…</p>}>{content}</Suspense>
    </PluginContext.Provider>
  );
}
