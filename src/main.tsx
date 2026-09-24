import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  Boxes,
  TerminalSquare,
  Folder,
  HardDrive,
  Cpu,
  MemoryStick,
  Plus,
  Play,
  Square,
  ChevronRight,
  ArrowUpRight,
  Settings2,
  Layers,
  CircleHelp,
  X,
  RefreshCw,
  Save,
  Trash2,
  Camera,
  Check,
  Search,
  LoaderCircle,
  Network,
  ShieldCheck,
  Flower2,
  ArrowRight,
  Monitor,
  CircleDot,
  Sun,
  Moon,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  GitBranch,
  Wrench,
  Sparkles,
} from 'lucide-react';
import { SakuraArt } from './SakuraArt';

import { distroName, useRemote, type Request } from './feature-shared';
import type { ImageInfo } from './FeaturePanels';

import { ResponseOrder } from './request-order';
import { mayLeaveEditor } from './file-editor-state';

import type { PaletteAction, PaletteTarget } from './CommandPalette';
import { workspacePath } from './workspace-request';
import { workspaceCommandDefinitions, type WorkspaceCommandDefinition } from './workspace-navigation';
import sakuraMark from './assets/sakura.svg';
import type { VMView, VMConfig } from '../server/model';
import '@xterm/xterm/css/xterm.css';
import './fonts.css';
import './style.css';
import { PluginContext, usePlugin } from './plugin-context';
import { pluginSurfaceEnabled } from '../shared/plugins';

const DesktopPanel = lazy(() =>
  import('./DesktopPanel').then((module) => ({ default: module.DesktopPanel })),
);
const FileBrowser = lazy(() => import('./FileBrowser').then((module) => ({ default: module.FileBrowser })));
const TerminalWorkspace = lazy(() =>
  import('./TerminalWorkspace').then((module) => ({ default: module.TerminalWorkspace })),
);
const FeatureSuitePanel = lazy(() =>
  import('./FeatureSuitePanel').then((module) => ({ default: module.FeatureSuitePanel })),
);
const CommandPalette = lazy(() =>
  import('./CommandPalette').then((module) => ({ default: module.CommandPalette })),
);
const PluginCenter = lazy(() =>
  import('./PluginCenter').then((module) => ({ default: module.PluginCenter })),
);
const ProjectPanel = lazy(() =>
  import('./FeaturePanels').then((module) => ({ default: module.ProjectPanel })),
);
const MetricsPanel = lazy(() =>
  import('./FeaturePanels').then((module) => ({ default: module.MetricsPanel })),
);
const ServicesPanel = lazy(() =>
  import('./FeaturePanels').then((module) => ({ default: module.ServicesPanel })),
);
const SyncPanel = lazy(() => import('./FeaturePanels').then((module) => ({ default: module.SyncPanel })));
const SnapshotsPanel = lazy(() =>
  import('./FeaturePanels').then((module) => ({ default: module.SnapshotsPanel })),
);
const ImageCatalog = lazy(() =>
  import('./FeaturePanels').then((module) => ({ default: module.ImageCatalog })),
);
const TasksPanel = lazy(() =>
  import('./ManagementPanels').then((module) => ({ default: module.TasksPanel })),
);
const LibraryPanel = lazy(() =>
  import('./ManagementPanels').then((module) => ({ default: module.LibraryPanel })),
);
const MaintenancePanel = lazy(() =>
  import('./ManagementPanels').then((module) => ({ default: module.MaintenancePanel })),
);
const GitPanel = lazy(() => import('./DevelopmentPanels').then((module) => ({ default: module.GitPanel })));
const DevelopmentPanel = lazy(() =>
  import('./DevelopmentPanels').then((module) => ({ default: module.DevelopmentPanel })),
);
const ContainersPanel = lazy(() =>
  import('./DevelopmentPanels').then((module) => ({ default: module.ContainersPanel })),
);
const MigrationPanel = lazy(() =>
  import('./DevelopmentPanels').then((module) => ({ default: module.MigrationPanel })),
);

type System = {
  plugins: string[];
  version: string;
  engine: string;
  posixloom: string;
  nativeHost: boolean;
  hostname: string;
  platform: string;
  hostCpus: number;
  hostMemoryMiB: number;
  freeMemoryMiB: number;
  controllerMemoryMiB: number;
  imageReady: boolean;
  imageBytes: number;
};
type ProjectIndex = { active: string; projects: { id: string; name: string }[] };
type SessionState = { selected: string; page: string; tab: string };
const sessionPages = new Set(['workspace', 'plugins', 'tasks', 'library', 'images', 'features', 'settings']);
const sessionTabs = new Set([
  'terminal',
  'desktop',
  'files',
  'project',
  'git',
  'development',
  'containers',
  'metrics',
  'services',
  'sync',
  'snapshots',
  'maintenance',
  'config',
]);
const workspaceTabs = [
  { id: 'terminal', label: '终端', icon: TerminalSquare },
  { id: 'desktop', label: '桌面', icon: Monitor },
  { id: 'files', label: '文件', icon: Folder },
  { id: 'project', label: '项目', icon: Boxes },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'development', label: '开发', icon: Wrench },
  { id: 'containers', label: '容器', icon: Boxes },
  { id: 'metrics', label: '资源', icon: Cpu },
  { id: 'services', label: '服务', icon: Network },
  { id: 'sync', label: '同步', icon: RefreshCw },
  { id: 'snapshots', label: '快照', icon: Camera },
  { id: 'maintenance', label: '维护', icon: ShieldCheck },
  { id: 'config', label: '配置', icon: Settings2 },
] as const;

function readSessionState(): SessionState {
  try {
    const saved = JSON.parse(localStorage.getItem('sakura-session') || '{}') as Partial<SessionState>;
    return {
      selected: typeof saved.selected === 'string' ? saved.selected : '',
      page: typeof saved.page === 'string' && sessionPages.has(saved.page) ? saved.page : 'workspace',
      tab: typeof saved.tab === 'string' && sessionTabs.has(saved.tab) ? saved.tab : 'terminal',
    };
  } catch {
    return { selected: '', page: 'workspace', tab: 'terminal' };
  }
}
let token = '';
async function api<T = any>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      'X-Sakura-Token': token,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
const bytes = (n: number) =>
  n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(1)} MB`;
const memory = (n: number) => (n >= 1024 ? `${Number((n / 1024).toFixed(1))} GiB` : `${n} MiB`);
const states = {
  running: '运行中',
  paused: '已暂停',
  stopped: '已停止',
  starting: '启动中',
  stopping: '停止中',
  error: '需要检查',
};
const active = (vm: VMView) =>
  vm.poweredOn || ['running', 'paused', 'starting', 'stopping'].includes(vm.status);
function Alpine({ small = false }: { small?: boolean }) {
  return (
    <span className={`alpine-mark ${small ? 'small' : ''}`}>
      <svg width="32" height="30" viewBox="0 0 40 36" fill="none">
        <path d="M3 29 18 7l8 12 5-7 7 17H3Z" fill="currentColor" />
        <path d="m13 15 5-8 6 9-6-3-5 2Z" fill="white" />
        <path d="m27 18 4-6 4 9-4-3-4 0Z" fill="white" />
      </svg>
    </span>
  );
}
function Badge({ vm }: { vm: VMView }) {
  return (
    <span className={`badge ${vm.status}`}>
      <span />
      {states[vm.status]}
    </span>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    dialog
      .querySelector<HTMLElement>('input:not([type="hidden"]):not([readonly]), textarea, select')
      ?.focus();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target !== ref.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="关闭对话框" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [initialSession] = useState(readSessionState);
  const [vms, setVms] = useState<VMView[]>([]),
    [system, setSystem] = useState<System | null>(null);
  const [selected, setSelectedRaw] = useState(initialSession.selected),
    [requestedPage, setPageRaw] = useState(initialSession.page),
    [requestedTab, setTabRaw] = useState(initialSession.tab);
  const enabled = system?.plugins || [];
  const has = (id: string) => enabled.includes(id);
  const page = pluginSurfaceEnabled(enabled, 'pages', requestedPage) ? requestedPage : 'workspace';
  const tab = pluginSurfaceEnabled(enabled, 'tabs', requestedTab) ? requestedTab : 'terminal';
  const visibleWorkspaceTabs = workspaceTabs.filter((item) => pluginSurfaceEnabled(enabled, 'tabs', item.id));
  const primaryWorkspaceTabs = visibleWorkspaceTabs.slice(0, 4);
  const advancedWorkspaceTabs = visibleWorkspaceTabs.slice(4);
  const hasProjects = has('projects'),
    hasPalette = has('command-palette');
  const [projectSelections, setProjectSelections] = useState<Record<string, string>>({});
  const setSelected = async (value: string) => {
    if (value === selected || (await mayLeaveEditor())) setSelectedRaw(value);
  };
  const setPage = async (value: string) => {
    if (value === page || (await mayLeaveEditor())) setPageRaw(value);
  };
  const setTab = async (value: string) => {
    if (value === tab || (await mayLeaveEditor())) setTabRaw(value);
  };
  const [loading, setLoading] = useState(true),
    [offline, setOffline] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState('');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [modal, setModal] = useState<'create' | 'help' | 'delete' | null>(null);
  const [confirm, setConfirm] = useState('');
  const [palette, setPalette] = useState(false);
  const [openFile, setOpenFile] = useState<{ id: string; path: string; revision: number }>();
  const navigatePalette = async (target: PaletteTarget) => {
    setPalette(false);
    if (!(await mayLeaveEditor())) return;
    if (target.id) setSelectedRaw(target.id);
    if (target.page) setPageRaw(target.page);
    if (target.tab) setTabRaw(target.tab);
    if (target.file) setOpenFile({ id: target.id || selected, path: target.file, revision: Date.now() });
  };
  useEffect(() => {
    if (!hasPalette) return;
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        const openDialog = document.querySelector('dialog[open]');
        if (openDialog && !openDialog.classList.contains('command-palette')) return;
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [hasPalette]);
  const [theme, setTheme] = useState<'day' | 'night'>(() => {
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
  const projectId = projectSelections[selected];
  const workspaceApi = useCallback<Request>(
    (path, method = 'GET', body, signal) => api(workspacePath(path, projectId), method, body, signal),
    [projectId],
  );
  const onProjectChange = useCallback(
    (next: string) => {
      if (!selected) return;
      setProjectSelections((current) =>
        current[selected] === next ? current : { ...current, [selected]: next },
      );
    },
    [selected],
  );
  useEffect(() => {
    if (!selected || !hasProjects) return;
    const abort = new AbortController();
    let alive = true;
    void api<ProjectIndex>(`/vms/${selected}/projects`, 'GET', undefined, abort.signal)
      .then((data) => {
        if (alive)
          setProjectSelections((current) => ({
            ...current,
            [selected]: data.active,
          }));
      })
      .catch(() => {});
    return () => {
      alive = false;
      abort.abort();
    };
  }, [selected, hasProjects]);
  const focusMode = focused && page === 'workspace' && !!vm;
  useEffect(() => {
    try {
      localStorage.setItem('sakura-session', JSON.stringify({ selected, page, tab }));
    } catch {
      // The workspace remains usable when browser storage is unavailable.
    }
  }, [selected, page, tab]);
  useEffect(() => {
    if (focusMode) machineRef.current?.scrollIntoView({ block: 'start' });
  }, [focusMode]);
  useEffect(() => {
    if (!moreTabsOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && !tabMoreRef.current?.contains(event.target)) setMoreTabsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoreTabsOpen(false);
        tabMoreRef.current?.querySelector<HTMLButtonElement>('.tabs-more-trigger')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreTabsOpen]);
  useEffect(() => {
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
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"], .xterm, .desktop-screen')
      )
        return;
      if (event.key === '/' && page === 'workspace' && !focusMode) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') setFocused(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [page, modal, focusMode]);
  const refreshOrder = useRef(new ResponseOrder());
  const refresh = useCallback(async () => {
    const version = refreshOrder.current.start();
    try {
      const [data, sys] = await Promise.all([api<VMView[]>('/vms'), api<System>('/system')]);
      if (!refreshOrder.current.accept(version)) return;
      setVms(data);
      setSystem(sys);
      setOffline('');
      setSelectedRaw((current) => (data.some((v) => v.id === current) ? current : data[0]?.id || ''));
    } catch (error) {
      if (refreshOrder.current.accept(version)) throw error;
    }
  }, []);
  useEffect(() => {
    let alive = true;
    let events: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const connectEvents = () => {
      if (!alive) return;
      const socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events?token=${token}`,
      );
      events = socket;
      socket.onmessage = () => {
        if (alive) void refresh().catch((e) => setOffline(e.message));
      };
      socket.onclose = () => {
        if (alive) reconnect = setTimeout(connectEvents, 1000);
      };
      socket.onerror = () => socket.close();
    };
    const load = async () => {
      try {
        token = (await api('/bootstrap')).token;
        if (alive) {
          connectEvents();
          await refresh();
        }
      } catch (e: any) {
        setOffline(e.message);
      } finally {
        setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (alive && token) void refresh().catch((e) => setOffline(e.message));
    }, 3500);
    return () => {
      alive = false;
      refreshOrder.current.invalidate();
      clearInterval(timer);
      clearTimeout(reconnect);
      events?.close();
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  async function run(action: () => Promise<unknown>, message?: string) {
    setBusy(true);
    try {
      await action();
      refreshOrder.current.invalidate();
      await refresh();
      if (message) setToast({ text: message });
    } catch (e: any) {
      setToast({ text: e.message, error: true });
    } finally {
      setBusy(false);
    }
  }
  const start = () =>
    vm && run(() => api(`/vms/${vm.id}/start`, 'POST'), '正在启动 Linux，终端将在就绪后连接');
  const stop = () =>
    vm && run(() => api(`/vms/${vm.id}/stop`, 'POST', { force: false }), '发行版已停止，磁盘数据已保留');
  const suspend = () => vm && run(() => api(`/vms/${vm.id}/suspend`, 'POST'), '发行版已暂停，可随时恢复');
  const resume = () => vm && run(() => api(`/vms/${vm.id}/resume`, 'POST'), '发行版已恢复');
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
        (!command.target?.page || pluginSurfaceEnabled(enabled, 'pages', command.target.page)),
    )
    .map((command) => ({
      key: command.key,
      title: command.title,
      detail: command.detail,
      keywords: command.keywords,
      disabled: command.disabled,
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
  const focusWorkspaceTab = (id: string) => {
    setMoreTabsOpen(false);
    void setTab(id);
    requestAnimationFrame(() => {
      tabMoreRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus();
    });
  };
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
    <div className={`app-shell ${focusMode ? 'focus-mode' : ''}`}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Sakura 首页">
          <img src={sakuraMark} alt="" />
          <span>
            Sakura<span className="brand-dot">.</span>
          </span>
          <small>桜</small>
        </a>
        <div className="side-caption">你的开发空间</div>
        <nav aria-label="主导航">
          {[
            { id: 'workspace', icon: TerminalSquare, name: '工作空间' },
            { id: 'plugins', icon: Boxes, name: '插件中心' },
            { id: 'images', icon: Layers, name: '镜像库' },
            { id: 'tasks', icon: CircleDot, name: '任务中心' },
            { id: 'library', icon: Boxes, name: '实例管理' },
            { id: 'features', icon: Sparkles, name: '能力中心' },
            { id: 'settings', icon: Settings2, name: '系统设置' },
          ]
            .filter((n) => pluginSurfaceEnabled(enabled, 'pages', n.id))
            .map((n) => (
              <button
                key={n.id}
                aria-label={n.name}
                aria-current={page === n.id ? 'page' : undefined}
                title={n.name}
                className={page === n.id ? 'nav-item selected' : 'nav-item'}
                onClick={() => setPage(n.id)}
              >
                <n.icon size={18} />
                <span>{n.name}</span>
                {n.id === 'workspace' && <small>{vms.length.toString().padStart(2, '0')}</small>}
              </button>
            ))}
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
              <span>{v.name}</span>
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
            <b>
              {
                {
                  workspace: '工作空间',
                  plugins: '插件中心',
                  images: '镜像库',
                  tasks: '任务中心',
                  library: '实例管理',
                  features: '能力中心',
                  settings: '系统设置',
                }[page]
              }
            </b>
          </div>
          <div className="topbar-actions">
            {hasPalette && (
              <button
                className="text-button command-shortcut"
                onClick={() => setPalette(true)}
                aria-label="打开命令面板"
              >
                <Search size={16} />
                <span>快速前往</span>
                <kbd>Ctrl K</kbd>
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
          {page === 'tasks' && <TasksPanel request={api} vms={vms} />}
          {page === 'library' && <LibraryPanel request={api} vms={vms} refresh={refresh} />}
          {page === 'features' && (
            <FeatureSuitePanel
              key={selected || vms[0]?.id || 'no-instance'}
              request={workspaceApi}
              vms={vms}
              selected={selected}
              onSelected={(id) => void setSelected(id)}
              projectId={projectId}
            />
          )}
          {offline && (
            <div className="error-banner">
              连接出现问题：{offline}
              <button onClick={() => location.reload()}>重新连接</button>
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
                    <button className="hero-guide" onClick={() => setModal('help')}>
                      快速上手 <ArrowUpRight size={15} />
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
                      {allocated >= 1024 ? (allocated / 1024).toFixed(1) : allocated}
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
                            <h3 title={v.name}>
                              {v.organization?.favorite ? '★ ' : ''}
                              {v.name}
                            </h3>
                            <p>{distroName(v.distro)}</p>
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
                              <h2>{vm.name}</h2>
                              <Badge vm={vm} />
                            </div>
                            <p>
                              <span>{distroName(vm.distro)}</span>
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
                              onKeyDown={(event) => {
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
                              className={`tabs-more-trigger ${advancedWorkspaceTabs.some((item) => item.id === tab) ? 'active' : ''}`}
                              aria-expanded={moreTabsOpen}
                              aria-haspopup="menu"
                              onClick={() => setMoreTabsOpen((open) => !open)}
                              onKeyDown={(event) => {
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
                              <span>更多</span>
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
                          <div className="tabs-menu-label">高级工具</div>
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
                              onKeyDown={(event) => {
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
                          {has('terminal-workspace') ? (
                            <TerminalWorkspace
                              key={vm.id}
                              id={vm.id}
                              request={api}
                              render={(session) => (
                                <TerminalPanel vm={vm} start={start} busy={busy} session={session} />
                              )}
                            />
                          ) : (
                            <TerminalPanel key={vm.id} vm={vm} start={start} busy={busy} />
                          )}
                        </div>
                        {tab === 'desktop' && (
                          <DesktopPanel
                            key={vm.id}
                            vm={vm}
                            token={token}
                            start={start}
                            busy={busy}
                            configure={() => setTab('config')}
                            request={api}
                          />
                        )}
                        {tab === 'files' && (
                          <FileBrowser
                            key={vm.id}
                            vm={vm}
                            request={workspaceApi}
                            token={token}
                            refresh={refresh}
                            openFile={openFile?.id === vm.id ? openFile : undefined}
                          />
                        )}
                        {tab === 'project' && (
                          <ProjectPanel
                            key={vm.id}
                            vm={vm}
                            request={workspaceApi}
                            token={token}
                            refresh={refresh}
                            projectId={projectId}
                            onProjectChange={onProjectChange}
                          />
                        )}
                        {tab === 'git' && (
                          <GitPanel
                            key={vm.id}
                            vm={vm}
                            request={workspaceApi}
                            token={token}
                            refresh={refresh}
                            projectId={projectId}
                          />
                        )}
                        {tab === 'development' && (
                          <DevelopmentPanel
                            key={vm.id}
                            vm={vm}
                            request={workspaceApi}
                            token={token}
                            refresh={refresh}
                            projectId={projectId}
                          />
                        )}
                        {tab === 'containers' && (
                          <ContainersPanel
                            key={vm.id}
                            vm={vm}
                            request={workspaceApi}
                            token={token}
                            refresh={refresh}
                            projectId={projectId}
                          />
                        )}
                        {tab === 'metrics' && (
                          <MetricsPanel
                            key={vm.id}
                            vm={vm}
                            request={workspaceApi}
                            token={token}
                            refresh={refresh}
                            projectId={projectId}
                          />
                        )}
                        {tab === 'services' && (
                          <ServicesPanel
                            key={vm.id}
                            vm={vm}
                            request={workspaceApi}
                            token={token}
                            refresh={refresh}
                            projectId={projectId}
                          />
                        )}
                        {tab === 'sync' && (
                          <SyncPanel
                            key={vm.id}
                            vm={vm}
                            request={workspaceApi}
                            token={token}
                            refresh={refresh}
                            projectId={projectId}
                          />
                        )}
                        {tab === 'snapshots' && (
                          <SnapshotsPanel
                            key={vm.id}
                            vm={vm}
                            request={workspaceApi}
                            token={token}
                            refresh={refresh}
                            projectId={projectId}
                          />
                        )}
                        {tab === 'maintenance' && (
                          <MaintenancePanel
                            key={vm.id}
                            vm={vm}
                            request={workspaceApi}
                            token={token}
                            refresh={refresh}
                            projectId={projectId}
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
          {page === 'images' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <Layers size={14} /> THE SEEDS OF SOMETHING NEW
                  </div>
                  <h1>轻装出发。</h1>
                  <p>共享一份基础镜像，为每个想法创建独立的空间。</p>
                </div>
              </div>
              <ImageCatalog request={api} token={token} refresh={refresh} />
              <button className="primary" onClick={() => setModal('create')}>
                <Plus size={16} />
                创建发行版
              </button>
              <div className="info-callout">
                <Layers size={24} />
                <div>
                  <h3>一个基础，多个可能。</h3>
                  <p>基础镜像保持只读。新发行版使用 QCOW2 增量磁盘，只有实际写入的数据占用额外空间。</p>
                </div>
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
            run(async () => {
              const result = await api<VMView>('/vms', 'POST', config);
              refreshOrder.current.invalidate();
              setVms((current) => [...current.filter((entry) => entry.id !== result.id), result]);
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
                run(async () => {
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

function TerminalPanel({
  vm,
  start,
  busy,
  session,
}: {
  vm: VMView;
  start: () => unknown;
  busy: boolean;
  session?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null);
  const fitTerminal = useRef<(() => void) | null>(null);
  const [fontSize, setFontSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('sakura-terminal-font-size'));
      return Number.isInteger(saved) && saved >= 11 && saved <= 18 ? saved : 13;
    } catch {
      return 13;
    }
  });
  const [retry, setRetry] = useState(0),
    [connection, setConnection] = useState('连接中');
  const mode = vm.status === 'running' ? 'terminal' : 'logs';
  useEffect(() => {
    if (!ref.current || vm.status === 'stopped') return;
    const monoFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
    let disposed = false;
    const term = new Terminal({
      cursorBlink: true,
      fontSize,
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontWeight: 400,
      fontWeightBold: 600,
      lineHeight: 1.5,
      scrollback: 4000,
      theme: {
        background: '#26212c',
        foreground: '#eee6ef',
        cursor: '#f1b1cb',
        selectionBackground: '#655168',
        black: '#26212c',
        brightBlack: '#aa97b0',
        green: '#b0d5bb',
        brightGreen: '#c2e6ca',
        red: '#ed9ca8',
        brightRed: '#ffb7c4',
        yellow: '#e9d1a6',
        brightYellow: '#f4e0b9',
        blue: '#adc4ea',
        brightBlue: '#c3d7f5',
        magenta: '#d2acdf',
        brightMagenta: '#e6c2ef',
        cyan: '#a2d4d5',
        brightCyan: '#bce6e6',
        white: '#eee6ef',
        brightWhite: '#fff5fa',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    terminal.current = term;
    let ready = false;
    const socket = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${vm.id}/${mode}?token=${token}${session ? `&session=${encodeURIComponent(session)}` : ''}`,
    );
    setConnection(mode === 'logs' ? '启动日志' : '正在连接');
    const resize = () => {
      if (disposed || !ref.current?.clientWidth) return;
      fit.fit();
      if (ready && socket.readyState === WebSocket.OPEN && mode === 'terminal')
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    const observer = new ResizeObserver(resize);
    fitTerminal.current = resize;
    observer.observe(ref.current);
    const frame = requestAnimationFrame(resize);
    // Canvas needs fresh character metrics after the local web font finishes loading.
    void document.fonts
      .load(`${fontSize}px "Sakura Mono"`)
      .then((faces) => {
        if (disposed || !faces.length || !monoFamily) return;
        term.options.fontFamily = monoFamily;
        resize();
        term.refresh(0, term.rows - 1);
      })
      .catch(() => {
        // Keep the system monospace fallback if a font cannot be loaded.
      });
    socket.onmessage = (event) => {
      if (disposed) return;
      const msg = JSON.parse(event.data);
      if (msg.type === 'data') term.write(msg.data);
      if (msg.type === 'ready') {
        ready = true;
        setConnection('SSH 已连接');
        resize();
        if (
          ref.current?.clientWidth &&
          !document.querySelector('dialog[open]') &&
          (document.activeElement === document.body || ref.current?.contains(document.activeElement))
        )
          term.focus();
      }
      if (msg.type === 'error') {
        term.writeln(`\r\n连接失败：${msg.data}`);
        setConnection('连接失败');
      }
    };
    socket.onclose = () => setConnection('连接已关闭');
    socket.onerror = () => setConnection('连接失败');
    const data = term.onData((data) => {
      if (ready && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }));
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
      data.dispose();
      observer.disconnect();
      term.dispose();
      terminal.current = null;
      fitTerminal.current = null;
    };
  }, [vm.id, vm.status, mode, retry, session]);
  // Resize the existing terminal without replacing its SSH connection or scrollback.
  useEffect(() => {
    if (terminal.current) {
      terminal.current.options.fontSize = fontSize;
      fitTerminal.current?.();
    }
    try {
      localStorage.setItem('sakura-terminal-font-size', String(fontSize));
    } catch {
      // The controls also work when browser storage is unavailable.
    }
  }, [fontSize]);
  const connectionTone =
    vm.status === 'stopped'
      ? 'stopped'
      : connection === 'SSH 已连接'
        ? 'running'
        : connection === '连接失败'
          ? 'error'
          : connection === '连接已关闭'
            ? 'stopped'
            : 'starting';
  return (
    <div className="terminal-wrap">
      <div className="terminal-toolbar">
        <div>
          <span className="terminal-dots">
            <i />
            <i />
            <i />
          </span>
          <span>{vm.status === 'running' ? `root@${vm.name}: ~` : 'Linux 启动控制台'}</span>
        </div>
        <div>
          <div className="terminal-font-controls" role="group" aria-label="终端字号">
            <button
              aria-label="缩小终端字号"
              title="缩小字号"
              disabled={fontSize <= 11}
              onClick={() => setFontSize((size) => Math.max(11, size - 1))}
            >
              <Minus size={12} />
            </button>
            <button
              className="terminal-font-reset"
              aria-label={`重置终端字号，当前 ${fontSize} 像素`}
              title="恢复默认 13px"
              onClick={() => setFontSize(13)}
            >
              {fontSize}
              <small>px</small>
            </button>
            <button
              aria-label="放大终端字号"
              title="放大字号"
              disabled={fontSize >= 18}
              onClick={() => setFontSize((size) => Math.min(18, size + 1))}
            >
              <Plus size={12} />
            </button>
          </div>
          <span className="terminal-tool-divider" aria-hidden="true" />
          <button
            aria-label="清空终端"
            title="清空终端"
            disabled={vm.status === 'stopped'}
            onClick={() => terminal.current?.clear()}
          >
            <Trash2 size={14} />
          </button>
          <button
            aria-label="重新连接终端"
            title="重新连接"
            disabled={vm.status === 'stopped'}
            onClick={() => setRetry((v) => v + 1)}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      {vm.status === 'stopped' ? (
        <div className="terminal-offline">
          <TerminalSquare size={38} />
          <h3>终端正在等你。</h3>
          <p>启动 {vm.name}，继续上次的工作。</p>
          <button className="terminal-start" onClick={start} disabled={busy}>
            <Play size={14} />
            启动并连接
          </button>
        </div>
      ) : (
        <div ref={ref} className="xterm-container" />
      )}
      <div className="terminal-bottom">
        <span className={`terminal-session ${connectionTone}`} role="status">
          <span className={`tiny-dot ${connectionTone}`} />
          {vm.status === 'stopped' ? '发行版已停止' : connection}
        </span>
        <span>
          UTF-8<span className="terminal-separator">/</span>xterm-256color
        </span>
      </div>
    </div>
  );
}

function ResourceFields({
  config,
  set,
  disabled = false,
}: {
  config: VMConfig;
  set: (v: VMConfig) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="resource-fields">
      <div className="form-grid">
        <label>
          <span>
            <Cpu size={15} />
            处理器
          </span>
          <select value={config.cpus} onChange={(e) => set({ ...config, cpus: +e.target.value })}>
            {[1, 2, 4, 8].map((n) => (
              <option key={n} value={n}>
                {n} vCPU
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            <MemoryStick size={15} />
            内存
          </span>
          <select value={config.memoryMiB} onChange={(e) => set({ ...config, memoryMiB: +e.target.value })}>
            {[256, 512, 1024, 2048, 4096, 8192].map((n) => (
              <option key={n} value={n}>
                {memory(n)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        执行模式
        <select
          value={config.accelerator}
          onChange={(e) => set({ ...config, accelerator: e.target.value as VMConfig['accelerator'] })}
        >
          <option value="auto">自动 · 优先使用可用的硬件加速</option>
          <option value="tcg">TCG · 兼容模式，无需系统配置</option>
          <option value="whpx">WHPX · 硬件加速，需已启用 Windows Hypervisor Platform</option>
        </select>
      </label>
    </fieldset>
  );
}
function CreateModal({
  busy,
  names,
  close,
  submit,
}: {
  busy: boolean;
  names: string[];
  close: () => void;
  submit: (c: VMConfig, boot: boolean) => unknown;
}) {
  const [config, set] = useState<VMConfig>({
    name: names.includes('alpine-dev') ? `alpine-${names.length + 1}` : 'alpine-dev',
    memoryMiB: 512,
    cpus: 2,
    diskGiB: 8,
    accelerator: 'auto',
    forwards: [],
  });
  const [boot, setBoot] = useState(true);
  const hasImages = usePlugin('images'),
    hasProjects = usePlugin('projects');
  const images = useRemote<ImageInfo[]>(api, '/images', hasImages);
  const selectedImage = hasImages
    ? images.data?.find((i) => i.id === (config.distro || 'alpine'))
    : { ready: true };
  return (
    <Modal title="一个新的 Linux 空间" subtitle="选择资源，剩下的交给 Sakura。" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(config, boot);
        }}
      >
        <label>
          发行版
          <select
            value={config.distro || 'alpine'}
            onChange={(e) => {
              const distro = e.target.value as VMConfig['distro'];
              const image = images.data?.find((i) => i.id === distro);
              set({
                ...config,
                distro,
                memoryMiB: Math.max(config.memoryMiB, image?.minimumMemory || 512),
                diskGiB: Math.max(config.diskGiB, image?.minimumDisk || 4),
              });
            }}
          >
            {(images.data || [{ id: 'alpine', name: 'Alpine 3.23', ready: true }]).map((image) => (
              <option key={image.id} value={image.id}>
                {image.name}
                {image.ready ? '' : '（请先到镜像库下载）'}
              </option>
            ))}
          </select>
        </label>
        {hasProjects && (
          <label>
            开发环境模板
            <select
              value={config.template || 'none'}
              onChange={(e) => set({ ...config, template: e.target.value as VMConfig['template'] })}
            >
              <option value="none">空白环境</option>
              <option value="node">Node.js + Git + tmux</option>
              <option value="python">Python + Git + tmux</option>
              <option value="rust">Rust + Git + tmux</option>
            </select>
            <small>首次启动自动安装所选工具，可在“项目”中查看进度或重试。</small>
          </label>
        )}
        <label>
          发行版名称
          <input
            required
            autoFocus
            pattern="[a-z][a-z0-9-]*"
            maxLength={32}
            value={config.name}
            onChange={(e) => set({ ...config, name: e.target.value })}
          />
          <small>小写字母、数字和短横线，例如 alpine-dev</small>
        </label>
        <ResourceFields config={config} set={set} />
        <label>
          <span>
            <HardDrive size={15} />
            磁盘容量
            <select value={config.diskGiB} onChange={(e) => set({ ...config, diskGiB: +e.target.value })}>
              {[4, 8, 16, 32, 64, 128].map((n) => (
                <option value={n} key={n}>
                  {n} GiB
                </option>
              ))}
            </select>
          </span>
          <small>按实际写入占用空间，无需预先分配全部容量。</small>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={boot} onChange={(e) => setBoot(e.target.checked)} />
          创建后立即启动
        </label>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy || !selectedImage?.ready}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}创建发行版
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ConfigPanel({
  vm,
  busy,
  save,
  remove,
}: {
  vm: VMView;
  busy: boolean;
  save: (c: VMConfig) => unknown;
  remove: () => void;
}) {
  const [config, set] = useState<VMConfig>({
    name: vm.name,
    cpus: vm.cpus,
    memoryMiB: vm.memoryMiB,
    accelerator: vm.accelerator,
    diskGiB: vm.diskGiB,
    forwards: vm.forwards,
    distro: vm.distro,
    template: vm.template,
  });
  const running = active(vm);
  const hasNetwork = usePlugin('network');
  return (
    <div className="content-panel config-panel">
      <div className="panel-heading">
        <div>
          <h3>为你的工作，分配刚好的资源</h3>
          <p>{running ? '停止发行版后，可以修改配置。' : '配置将在下次启动时生效。'}</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(config);
        }}
      >
        <ResourceFields config={config} set={set} disabled={running} />
        {hasNetwork && (
          <>
            <div className="panel-heading port-heading">
              <h3>
                <Network size={16} />
                本机端口转发
              </h3>
              <button
                type="button"
                className="text-button"
                disabled={running || config.forwards.length >= 12}
                onClick={() => set({ ...config, forwards: [...config.forwards, { host: 8080, guest: 80 }] })}
              >
                <Plus size={14} />
                添加
              </button>
            </div>
            {config.forwards.length === 0 && (
              <p className="muted small-text">
                尚无转发规则。添加后，可从 Windows 的 localhost 访问 Linux 服务。
              </p>
            )}
            {config.forwards.map((p, i) => (
              <div className="port-row" key={i}>
                <label>
                  Windows 端口
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    required
                    value={p.host}
                    disabled={running}
                    onChange={(e) =>
                      set({
                        ...config,
                        forwards: config.forwards.map((f, j) =>
                          j === i ? { ...f, host: +e.target.value } : f,
                        ),
                      })
                    }
                  />
                </label>
                <ArrowRight size={17} />
                <label>
                  Linux 端口
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={p.guest}
                    disabled={running}
                    onChange={(e) =>
                      set({
                        ...config,
                        forwards: config.forwards.map((f, j) =>
                          j === i ? { ...f, guest: +e.target.value } : f,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="删除端口规则"
                  disabled={running}
                  onClick={() => set({ ...config, forwards: config.forwards.filter((_, j) => j !== i) })}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </>
        )}
        <div className="config-actions">
          <button className="primary compact" disabled={busy || running}>
            <Save size={14} />
            保存配置
          </button>
          <button
            type="button"
            className="text-button danger-text"
            disabled={busy || running}
            onClick={remove}
          >
            <Trash2 size={14} />
            删除发行版
          </button>
        </div>
      </form>
    </div>
  );
}
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<App />);
