/**
 * 模块职责（中文）：“文件工作台”插件的文件浏览、编辑草稿、上传、历史恢复与代码检查工作台，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for files, editing, history and uploads/downloads.
 * 详细范围（中文）：公开入口包括 FileBrowser, tabs；职责覆盖文件、编辑、历史和上传下载的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include FileBrowser, tabs. The scope covers UI interaction and state presentation for files, editing, history and uploads/downloads. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { embeddedPluginComponent } from '../../src/plugin-client';
import { formatDateTime } from '../../src/localization';
import { ArrowUp, Download, FileText, Folder, Plus, RefreshCw, Save, Trash2, Upload, X } from 'lucide-react';
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { anyDirty, restoreDrafts, saveDraftResult, type EditorDraft } from '../../src/editor-drafts';
import { download, Feedback, useAction, useRemote, type FeatureProps } from '../../src/feature-shared';
import '../../src/features.css';
import { dirtyEdit, registerEditorGuard, type FileEdit } from '../../src/file-editor-state';
import { PluginGate, usePlugin } from '../../src/plugin-context';
import { PluginBoundary } from '../../src/plugin-boundary';
import { pluginGeneration } from '../../src/plugin-generation';
import { ProjectNavigator } from '../../src/ProjectNavigator';
import { transferBytes, uploadFiles, type UploadProgress } from '../../src/transfers';
import { BinaryPreview } from '../../src/BinaryPreview';
import { ThreeWayMerge } from '../../src/ThreeWayMerge';
import { clipboardFiles } from '../../src/clipboard-files';
import { NativeOpenButtons } from '../../src/NativeIntegration';
import { applyTextEdits, type LspPosition, type LspRange } from '../../shared/language-service';
/**
 * 中文：懒加载 ../code-checks/client 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码
 * English: Lazily load ../code-checks/client and adapt its selected export as the default React component, deferring this feature's UI code download
 */
const loadDebugPanel = () =>
  import('../code-checks/client').then((module) => ({ default: module.DebugPanel }));
/**
 * 中文：懒加载 ../../src/CodeEditor 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码
 * English: Lazily load ../../src/CodeEditor and adapt its selected export as the default React component, deferring this feature's UI code download
 */
const loadCodeEditor = () =>
  import('../../src/CodeEditor').then((module) => ({ default: module.CodeEditor }));

type Entry = { name: string; size: number; directory: boolean; symlink: boolean; modified: number };
/**
 * 中文：呈现文件、编辑、历史和上传下载的界面交互与状态呈现中的 DraftDialog 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the DraftDialog surface for UI interaction and state presentation for files, editing, history and uploads/downloads. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  kind,
  choose,
} 提供 kind（kind 状态）、choose（choose 状态） 上下文字段
 * English: Inputs: {
  kind,
  choose,
} provides context fields kind (kind state), choose (choose state)
 */
function DraftDialog({
  kind,
  choose,
}: {
  kind: 'leave' | 'replace' | 'discard';
  choose: /** 中文：交付草稿对话框的允许离开或取消决定；这是 DraftDialog 的调用契约 | English: Deliver the draft dialog's departure/cancel decision; this is the callable contract of DraftDialog | 中文：输入：allowed：可接受的枚举值集合 | English: Inputs: allowed: set of accepted enum values | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (allowed: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(/** 中文：当依赖 [] 变化时打开原生模态对话框；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, open a native modal dialog. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    /**
     * 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中关闭所属连接或存储对象，把输入焦点移到目标元素；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In UI interaction and state presentation for files, editing, history and uploads/downloads, close the owned connection/storage object, move input focus to the target. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="draft-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        choose(false);
      }}
    >
      <div className="modal-head">
        <h3 id="draft-dialog-title">有未保存的修改</h3>
      </div>
      <div className="content-panel">
        <p>
          {kind === 'leave'
            ? '离开后，草稿仍会保留在本机浏览器，返回文件面板可继续编辑。'
            : kind === 'replace'
              ? '打开另一个文件会替换当前草稿，请先保存需要保留的内容。'
              : '关闭编辑器会放弃当前草稿。'}
        </p>
      </div>
      <div className="modal-footer">
        <button className="secondary" autoFocus onClick={() => choose(false)}>
          继续编辑
        </button>
        <button className="primary" onClick={() => choose(true)}>
          {kind === 'leave' ? '保留草稿并离开' : '放弃草稿并继续'}
        </button>
      </div>
    </dialog>
  );
}
/**
 * 中文：呈现文件、编辑、历史和上传下载的界面交互与状态呈现中的 FileBrowser 界面，订阅 /vms/{vm.id}/history，组合 DraftDialog、Folder、ArrowUp、RefreshCw、Plus、Upload、X、ThreeWayMerge，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the FileBrowser surface for UI interaction and state presentation for files, editing, history and uploads/downloads, subscribing to /vms/{vm.id}/history and composing DraftDialog, Folder, ArrowUp, RefreshCw, Plus, Upload, X, ThreeWayMerge. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  vm,
  request,
  token,
  openFile,
  projectId,
} 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力）、token（当前传输认证凭证）、openFile（openFile 状态）、projectId（当前项目标识） 上下文字段
 * English: Inputs: {
  vm,
  request,
  token,
  openFile,
  projectId,
} provides context fields vm (vm state), request (transport capability bound to identity/authority scope), token (current transport credential), openFile (openFile state), projectId (current project identifier)
 */
export function FileBrowser({
  vm,
  request,
  token,
  openFile,
  projectId,
}: FeatureProps & { openFile?: { path: string; line?: number; revision: number; directory?: boolean } }) {
  const [path, setPath] = useState('/workspace'),
    [input, setInput] = useState('/workspace');
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const languagePlugin = usePlugin('code-checks');
  const [merging, setMerging] = useState(false);
  const [files, setFiles] = useState<Entry[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const draftKey = `sakura-drafts:${vm.id}`;
  const [workspace, setWorkspace] = useState<{ drafts: EditorDraft[]; active: string }>(/** 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中按指定 Schema 校验并解码，读取浏览器缓存值；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In UI interaction and state presentation for files, editing, history and uploads/downloads, validate/decode with the specified schema, read a browser-cache value. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：包含 drafts、active 的对象，字段供调用者读取状态或调用操作 | English: Result: an object containing drafts, active for caller state reads/operations */ () => {
    try {
      const drafts = restoreDrafts(
        JSON.parse(localStorage.getItem(draftKey) || localStorage.getItem(`sakura-draft:${vm.id}`) || 'null'),
      );
      return { drafts, active: drafts[0]?.id || '' };
    } catch {
      return { drafts: [], active: '' };
    }
  });
  const edit = workspace.drafts.find((draft) => draft.id === workspace.active) || null;
  const workspaceRef = useRef(workspace);
  // 选择代次与文件读取分离：旧文件可以进入草稿列表，但不能抢回用户在请求期间切换的活动标签。
  const selectionVersion = useRef(0);
  workspaceRef.current = workspace;
  /**
   * 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中workspace 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In UI interaction and state presentation for files, editing, history and uploads/downloads, workspace state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：value：待校验、转换或保存的输入值
   * English: Inputs: value: input value to validate/transform/save
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const setEdit = (value: FileEdit | null) => {
    const active = workspaceRef.current.active;
    if (!value) selectionVersion.current++;
    setWorkspace((current) => {
      const drafts = value
        ? current.drafts.map((draft) => (draft.id === active ? { ...value, id: draft.id } : draft))
        : current.drafts.filter((draft) => draft.id !== active);
      return { drafts, active: value ? current.active : drafts[0]?.id || '' };
    });
  };
  const [line, setLine] = useState<{ path: string; number?: number }>({ path: '' });
  const [draftError, setDraftError] = useState(''),
    [conflicts, setConflicts] = useState<Record<string, { content: string; version: string }>>({});
  const [leases, setLeases] = useState<Record<string, { token: string; expiresAt: string }>>({});
  const leaseRef = useRef(leases), requestRef = useRef(request);
  leaseRef.current = leases;
  requestRef.current = request;
  const [diagnostics, setDiagnostics] = useState<{ message: string; line?: number; column?: number }[]>([]);
  const [diagnosticNote, setDiagnosticNote] = useState('');
  const cursor = useRef<LspPosition>({ line: 0, character: 0 });
  const [languageReady, setLanguageReady] = useState<boolean | null>(null);
  const languageLifetime = useSyncExternalStore(pluginGeneration.subscribe,
    () => pluginGeneration.snapshot('official:code-checks'), () => '');
  const [languageError, setLanguageError] = useState('');
  const [languagePending, setLanguagePending] = useState<{ token: string; needsReview: boolean }[]>([]);
  const [languageRefresh, setLanguageRefresh] = useState(0);
  const [completions, setCompletions] = useState<{ label: string; detail: string; insertText: string; range: LspRange | null }[]>([]);
  const [definitions, setDefinitions] = useState<{ path: string; line: number; column: number }[]>([]);
  const [renameName, setRenameName] = useState('');
  const [renamePreview, setRenamePreview] = useState<{ token: string; files: { path: string; before: string; after: string }[] } | null>(null);
  const conflict = edit ? conflicts[edit.id] : null;
  /**
   * 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中conflicts 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In UI interaction and state presentation for files, editing, history and uploads/downloads, conflicts state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：value：待校验、转换或保存的输入值
   * English: Inputs: value: input value to validate/transform/save
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const setConflict = (value: { content: string; version: string } | null) => {
    const id = workspaceRef.current.active;
    setConflicts((current) => {
      const next = { ...current };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });
  };
  const editRef = useRef(edit);
  editRef.current = edit;
  useEffect(/** 中文：读取 GET /vms/{vm.id}/language-service?path={encodeURIComponent(edit.path)}，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互并更新completions 状态、definitions 状态、renamePreview 状态、diagnostics 状态、diagnosticNote 状态、languageReady 状态、languageError 状态、languagePending 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /vms/{vm.id}/language-service?path={encodeURIComponent(edit.path)} for UI interaction and state presentation for files, editing, history and uploads/downloads and update completions state, definitions state, renamePreview state, diagnostics state, diagnosticNote state, languageReady state, languageError state, languagePending state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    setCompletions([]);
    setDefinitions([]);
    setRenamePreview(null);
    setDiagnostics([]);
    setDiagnosticNote('');
    cursor.current = { line: 0, character: 0 };
    if (!languagePlugin || !edit || !/\.(?:[cm]?[jt]sx?|py)$/i.test(edit.path)) {
      setLanguageReady(null);
      setLanguageError('');
      setLanguagePending([]);
      return;
    }
    const abort = new AbortController();
    let alive = true;
    setLanguageReady(null);
    setLanguageError('');
    setLanguagePending([]);
    void requestRef.current<{ installed: boolean; pending?: { token: string; needsReview: boolean }[] }>(
      `/vms/${vm.id}/language-service?path=${encodeURIComponent(edit.path)}`,
      'GET', undefined, abort.signal,
    ).then((value) => { if (alive) { setLanguageReady(value.installed); setLanguagePending(value.pending || []); } })
      .catch((error) => { if (alive) setLanguageError((error as Error).message); });
    /**
     * 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In UI interaction and state presentation for files, editing, history and uploads/downloads, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => { alive = false; abort.abort(); };
  }, [edit?.id, edit?.path, vm.id, languagePlugin, languageLifetime, languageRefresh]);
  const [leaveKind, setLeaveKind] = useState<'leave' | 'replace' | 'discard' | null>(null);
  const history = useRemote<{
    items: {
      id: string;
      path: string;
      kind: 'version' | 'trash';
      createdAt: string;
      bytes: number;
      version?: string;
    }[];
  }>(request, `/vms/${vm.id}/history`, vm.status === 'running', 10000);
  const pendingLeave = useRef<{ promise: Promise<boolean>; resolve: /** 中文：兑现待处理离开判断，布尔值决定继续导航或保留草稿；这是 FileBrowser 的调用契约 | English: Fulfill the pending departure decision; its boolean continues navigation or retains drafts; this is the callable contract of FileBrowser | 中文：输入：allowed：可接受的枚举值集合 | English: Inputs: allowed: set of accepted enum values | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (allowed: boolean) => void } | null>(
    null,
  );
  /**
   * 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中leaveKind 状态，兑现当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In UI interaction and state presentation for files, editing, history and uploads/downloads, leaveKind state, fulfill the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：kind：签名所示 'leave' | 'replace' | 'discard' 业务值（缺省 'leave'）
   * English: Inputs: kind: the 'leave' | 'replace' | 'discard' domain value in the signature (default 'leave')
   */
  const leave = (kind: 'leave' | 'replace' | 'discard' = 'leave') => {
    if (!(kind === 'leave' ? anyDirty(workspaceRef.current.drafts) : dirtyEdit(editRef.current)))
      return Promise.resolve(true);
    if (pendingLeave.current) return pendingLeave.current.promise;
    let resolve!: /** 中文：兑现待处理离开判断，布尔值决定继续导航或保留草稿；这是 FileBrowser.leave 的调用契约 | English: Fulfill the pending departure decision; its boolean continues navigation or retains drafts; this is the callable contract of FileBrowser.leave | 中文：输入：allowed：可接受的枚举值集合 | English: Inputs: allowed: set of accepted enum values | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (allowed: boolean) => void;
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    pendingLeave.current = { promise, resolve };
    setLeaveKind(kind);
    return promise;
  };
  /**
   * 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中leaveKind 状态，兑现当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In UI interaction and state presentation for files, editing, history and uploads/downloads, leaveKind state, fulfill the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：allowed：可接受的枚举值集合
   * English: Inputs: allowed: set of accepted enum values
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const chooseLeave = (allowed: boolean) => {
    pendingLeave.current?.resolve(allowed);
    pendingLeave.current = null;
    setLeaveKind(null);
  };
  const draftDialog = leaveKind ? <DraftDialog kind={leaveKind} choose={chooseLeave} /> : null;
  useEffect(/** 中文：当依赖 [] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership */ () => registerEditorGuard(leave), []);
  useEffect(/** 中文：当依赖 [] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => () => pendingLeave.current?.resolve(false), []);
  useEffect(/** 中文：当依赖 [] 变化时登记浏览器或资源事件监听；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, register browser/resource event listeners. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    /**
     * 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中阻止浏览器默认行为；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In UI interaction and state presentation for files, editing, history and uploads/downloads, prevent browser default behavior. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：输入：event：触发本处理器的事件及其数据
     * English: Inputs: event: triggering event and its data
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    const unload = (event: BeforeUnloadEvent) => {
      if (anyDirty(workspaceRef.current.drafts)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    /**
     * 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In UI interaction and state presentation for files, editing, history and uploads/downloads, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  useEffect(/** 中文：当依赖 [workspace.drafts, draftKey] 变化时持久化浏览器缓存值，draftError 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [workspace.drafts, draftKey] change, persist a browser-cache value, draftError state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    try {
      if (workspace.drafts.length) localStorage.setItem(draftKey, JSON.stringify(workspace.drafts));
      else localStorage.removeItem(draftKey);
      localStorage.removeItem(`sakura-draft:${vm.id}`);
      setDraftError('');
    } catch {
      setDraftError('浏览器无法保存草稿，请及时保存文件。');
    }
  }, [workspace.drafts, draftKey]);
  useEffect(/** 中文：提交 POST /vms/{vm.id}/file-lock?path={encodeURIComponent(lockedPath)}，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/file-lock?path={encodeURIComponent(lockedPath)} for UI interaction and state presentation for files, editing, history and uploads/downloads. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const timer = window.setInterval(/** 中文：每轮为当前编辑器持有的文件锁续租，完成时仅更新仍具有同一 token 的租约；失败移除匹配旧租约并提示重新获取，避免迟到续租覆盖新锁。 | English: Renew the editor's currently held file locks each pass, updating only leases still carrying the same token. On failure remove the matching old lease/report reacquisition, preventing late renewal from replacing a new lock. | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
      for (const [lockedPath, lease] of Object.entries(leaseRef.current))
        void requestRef.current<{ expiresAt: string }>(
          `/vms/${vm.id}/file-lock?path=${encodeURIComponent(lockedPath)}`,
          'POST',
          { action: 'renew', token: lease.token },
        ).then((value) => setLeases((current) => current[lockedPath]?.token === lease.token
          ? { ...current, [lockedPath]: { ...lease, expiresAt: value.expiresAt } }
          : current)).catch(() => {
          setLeases((current) => {
            if (current[lockedPath]?.token !== lease.token) return current;
            const next = { ...current };
            delete next[lockedPath];
            return next;
          });
          setError('文件锁续租失败；请重新获取后再保存。');
        });
    }, 45000);
    return () => {
      window.clearInterval(timer);
      for (const [lockedPath, lease] of Object.entries(leaseRef.current))
        void requestRef.current(`/vms/${vm.id}/file-lock?path=${encodeURIComponent(lockedPath)}`,
          'POST', { action: 'release', token: lease.token }).catch(() => {});
    };
  }, [vm.id]);
  /**
   * 中文：提交 POST /vms/{vm.id}/file-lock?path={encodeURIComponent(lockedPath)}，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互并更新leases 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/file-lock?path={encodeURIComponent(lockedPath)} for UI interaction and state presentation for files, editing, history and uploads/downloads and update leases state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：lockedPath：签名所示 string 业务值
   * English: Inputs: lockedPath: the string domain value in the signature
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   */
  const releaseLease = async (lockedPath: string) => {
    const lease = leaseRef.current[lockedPath];
    if (!lease) return;
    await request(`/vms/${vm.id}/file-lock?path=${encodeURIComponent(lockedPath)}`,
      'POST', { action: 'release', token: lease.token });
    setLeases((current) => {
      if (current[lockedPath]?.token !== lease.token) return current;
      const next = { ...current };
      delete next[lockedPath];
      return next;
    });
  };
  const [overwrite, setOverwrite] = useState(false),
    [progress, setProgress] = useState<UploadProgress | null>(null),
    [dragging, setDragging] = useState(false);
  const upload = useRef<HTMLInputElement>(null),
    transfer = useRef<AbortController | null>(null),
    alive = useRef(true);
  const action = useAction();
  const requestVersion = useRef(0);
  /**
   * 中文：读取 GET /vms/{vm.id}/files?path={encodeURIComponent(path)}，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互并更新files 状态、loading 状态、错误反馈；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform GET /vms/{vm.id}/files?path={encodeURIComponent(path)} for UI interaction and state presentation for files, editing, history and uploads/downloads and update files state, loading state, error feedback. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    if (vm.status !== 'running') {
      setFiles([]);
      setLoading(false);
      transfer.current?.abort();
      return;
    }
    setLoading(true);
    try {
      const values = await request<Entry[]>(`/vms/${vm.id}/files?path=${encodeURIComponent(path)}`);
      if (version === requestVersion.current) {
        setFiles(values);
        setError('');
      }
    } catch (e) {
      if (version === requestVersion.current) {
        setFiles([]);
        setError((e as Error).message);
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [vm.id, vm.status, path, request]);
  useEffect(/** 中文：当依赖 [refresh] 变化时重新核对父级远端视图；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [refresh] change, reconcile the parent's remote view. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    void refresh();
    return () => {
      requestVersion.current++;
    };
  }, [refresh]);
  useEffect(/** 中文：当依赖 [] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    alive.current = true;
    /**
     * 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In UI interaction and state presentation for files, editing, history and uploads/downloads, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      alive.current = false;
      transfer.current?.abort();
    };
  }, []);
  /**
   * 中文：把当前目录去掉末尾斜杠后附文件名，统一新建、打开和上传目标。
   * English: Strip the current directory's trailing slash before appending a filename, unifying creation/open/upload targets.
   * 中文：输入：name：目标名称或文件名
   * English: Inputs: name: target name/filename
   */
  const target = (name: string) => `${path.replace(/\/$/, '')}/${name}`;
  /**
   * 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中files 状态，错误反馈，loading 状态，文件路径，input 状态，重新核对父级远端视图；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In UI interaction and state presentation for files, editing, history and uploads/downloads, files state, error feedback, loading state, file path, input state, reconcile the parent's remote view. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：next：待采用的新状态或数据
   * English: Inputs: next: new state/data to adopt
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   */
  const navigate = async (next: string) => {
    requestVersion.current++;
    setFiles([]);
    setError('');
    setLoading(true);
    setPath(next);
    setInput(next);
    if (next === path) void refresh();
  };
  /**
   * 中文：提交 POST /vms/{vm.id}/file-operation，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/file-operation for UI interaction and state presentation for files, editing, history and uploads/downloads. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：kind：签名所示 string 业务值；filePath：签名所示 string 业务值；destination：签名所示 string 业务值；recursive：此处理器的调用值（缺省 false）
   * English: Inputs: kind: the string domain value in the signature; filePath: the string domain value in the signature; destination: the string domain value in the signature; recursive: the invocation value for this handler (default false)
   */
  const operation = (kind: string, filePath: string, destination?: string, recursive = false) =>
    action.run(/** 中文：提交 POST /vms/{vm.id}/file-operation，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/file-operation for UI interaction and state presentation for files, editing, history and uploads/downloads. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
      await request(`/vms/${vm.id}/file-operation`, 'POST', {
        action: kind,
        path: filePath,
        destination,
        recursive,
        ...(leases[filePath]?.token ? { lockToken: leases[filePath].token } : {}),
      });
      await refresh();
    }, '文件操作已完成');
  /**
   * 中文：读取 GET /vms/{vm.id}/file?path={encodeURIComponent(filePath)}，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互并更新line 状态、workspace 状态、错误反馈；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform GET /vms/{vm.id}/file?path={encodeURIComponent(filePath)} for UI interaction and state presentation for files, editing, history and uploads/downloads and update line state, workspace state, error feedback. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：filePath：签名所示 string 业务值；jump：签名所示 number | undefined 业务值；signal：本次调用的取消寿命
   * English: Inputs: filePath: the string domain value in the signature; jump: the number | undefined domain value in the signature; signal: cancellation lifetime for this invocation
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作
   * English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
  const loadPath = async (filePath: string, jump: number | undefined, signal: AbortSignal) => {
    signal.throwIfAborted();
    const existing = workspaceRef.current.drafts.find((draft) => draft.path === filePath);
    setLine({ path: filePath, number: jump });
    if (existing) {
      selectionVersion.current++;
      setWorkspace((current) => ({ ...current, active: existing.id }));
      return;
    }
    if (workspaceRef.current.drafts.length >= 20) {
      setError('最多同时打开 20 个文件，请先关闭部分标签');
      return;
    }
    // Returning to the same tab is still a newer selection than this read.
    const selected = selectionVersion.current;
    const value = await request<{ content: string; version: string }>(
      `/vms/${vm.id}/file?path=${encodeURIComponent(filePath)}`,
      'GET', undefined, signal,
    );
    signal.throwIfAborted();
    const draft: EditorDraft = {
      id: crypto.randomUUID(),
      path: filePath,
      content: value.content,
      baseContent: value.content,
      version: value.version,
    };
    setWorkspace((current) => ({ drafts: [...current.drafts, draft],
      active: selectionVersion.current === selected ? draft.id : current.active }));
  };
  /**
   * 中文：把指定绝对路径与可选跳转行交给动作执行器的加载流程，沿用其取消与错误反馈。
   * English: Pass the absolute file path/optional jump line to the action runner's loading flow, retaining its cancellation/error feedback.
   * 中文：输入：filePath：签名所示 string 业务值；jump：签名所示 number 业务值
   * English: Inputs: filePath: the string domain value in the signature; jump: the number domain value in the signature
   */
  const openPath = (filePath: string, jump?: number) =>
    action.run((signal) => loadPath(filePath, jump, signal));
  /**
   * 中文：目录条目导航到子目录，文件条目加载编辑器；两者共用当前目录下目标路径生成。
   * English: Navigate directory entries into children and load file entries into the editor, sharing current-directory target construction.
   * 中文：输入：file：当前上传或处理的文件
   * English: Inputs: file: file being uploaded/processed
   */
  const open = (file: Entry) => (file.directory ? navigate(target(file.name)) : openPath(target(file.name)));
  useEffect(/** 中文：当依赖 [openFile?.revision, vm.status] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [openFile?.revision, vm.status] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (openFile && vm.status === 'running') {
      if (openFile.directory) void navigate(openFile.path);
      else void openPath(openFile.path, openFile.line);
    }
  }, [openFile?.revision, vm.status]);
  // 保存捕获提交草稿与预期文件版本；确认响应后仅更新该草稿基线，版本冲突再读取服务端内容供合并。
  /**
   * 中文：提交 PUT /vms/{vm.id}/file；GET /vms/{vm.id}/file?path={encodeURIComponent(submitted.path)}，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform PUT /vms/{vm.id}/file; GET /vms/{vm.id}/file?path={encodeURIComponent(submitted.path)} for UI interaction and state presentation for files, editing, history and uploads/downloads. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const save = () => {
    const submitted = editRef.current;
    if (!submitted) return;
    return action.run(/** 中文：提交 PUT /vms/{vm.id}/file；GET /vms/{vm.id}/file?path={encodeURIComponent(submitted.path)}，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互并更新workspace 状态、conflicts 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform PUT /vms/{vm.id}/file; GET /vms/{vm.id}/file?path={encodeURIComponent(submitted.path)} for UI interaction and state presentation for files, editing, history and uploads/downloads and update workspace state, conflicts state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：拒绝原因：另一个标签已打开同一路径。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 另一个标签已打开同一路径. These errors reach the direct caller or this function's catch handler | 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态 | English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state */ async () => {
      if (
        workspaceRef.current.drafts.some(
          (draft) => draft.id !== submitted.id && draft.path === submitted.path,
        )
      )
        throw new Error('另一个标签已打开同一路径');
      try {
        const result = await request<{ version: string }>(`/vms/${vm.id}/file`, 'PUT', {
          path: submitted.path,
          content: submitted.content,
          overwrite: !submitted.fresh,
          expectedVersion: submitted.version,
          ...(leases[submitted.path]?.token ? { lockToken: leases[submitted.path].token } : {}),
        });
        setWorkspace((current) => ({
          ...current,
          drafts: saveDraftResult(current.drafts, submitted, result.version),
        }));
        setConflicts((current) => {
          const next = { ...current };
          delete next[submitted.id];
          return next;
        });
        await refresh();
      } catch (error) {
        if (!submitted.fresh) {
          const latest = await request<{ content: string; version: string }>(
            `/vms/${vm.id}/file?path=${encodeURIComponent(submitted.path)}`,
          ).catch(() => null);
          if (latest && latest.version !== submitted.version)
            setConflicts((current) => ({ ...current, [submitted.id]: latest }));
        }
        throw error;
      }
    }, '文本已保存');
  };
  /**
   * 中文：提交 POST /vms/{vm.id}/language-service，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/language-service for UI interaction and state presentation for files, editing, history and uploads/downloads. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：kind：签名所示 'completion' | 'definition' | 'diagnostics' | 'rename' 业务值
   * English: Inputs: kind: the 'completion' | 'definition' | 'diagnostics' | 'rename' domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const languageAction = (kind: 'completion' | 'definition' | 'diagnostics' | 'rename') => {
    const submitted = editRef.current;
    if (!submitted) return;
    void action.run(/** 中文：提交 POST /vms/{vm.id}/language-service，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互并更新completions 状态、definitions 状态、diagnostics 状态、diagnosticNote 状态、renamePreview 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/language-service for UI interaction and state presentation for files, editing, history and uploads/downloads and update completions state, definitions state, diagnostics state, diagnosticNote state, renamePreview state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：拒绝原因：请先保存当前文件，再预览重命名；重命名涉及未保存的标签，请先保存这些文件。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 请先保存当前文件，再预览重命名; 重命名涉及未保存的标签，请先保存这些文件. These errors reach the direct caller or this function's catch handler */ async (signal) => {
      if (kind === 'rename' && (submitted.fresh || dirtyEdit(submitted)))
        throw new Error('请先保存当前文件，再预览重命名');
      const result = await request<any>(`/vms/${vm.id}/language-service`, 'POST', {
        action: kind, path: submitted.path, content: submitted.content,
        position: cursor.current,
        ...(kind === 'rename' ? { newName: renameName, version: submitted.version } : {}),
      }, signal).catch(error => { setLanguageRefresh(value => value + 1); throw error; });
      // 语言结果必须对应同一个活动标签和文本快照；继续编辑或切换文件后丢弃旧补全/诊断。
      if (workspaceRef.current.active !== submitted.id || editRef.current?.path !== submitted.path ||
          (kind !== 'rename' && editRef.current?.content !== submitted.content)) return;
      if (kind === 'completion') {
        setCompletions(result.items);
        setDefinitions([]);
      } else if (kind === 'definition') {
        setDefinitions(result.locations);
        setCompletions([]);
        if (result.locations.length === 1) await loadPath(result.locations[0].path, result.locations[0].line, signal);
      } else if (kind === 'diagnostics') {
        setDiagnostics(result.diagnostics);
        setDiagnosticNote(result.received
          ? result.diagnostics.length ? '' : '语言服务器未报告问题'
          : '语言服务器未在等待时间内发送诊断结果');
      } else {
        if (result.files.some((file: { path: string }) =>
          workspaceRef.current.drafts.some((draft) => draft.path === file.path && dirtyEdit(draft))))
          throw new Error('重命名涉及未保存的标签，请先保存这些文件');
        setRenamePreview(result);
      }
    }, kind === 'rename' ? '请检查重命名预览' : '语言服务已响应');
  };
  /**
   * 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中当前编辑项，completions 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In UI interaction and state presentation for files, editing, history and uploads/downloads, current edit, completions state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：item：签名所示 { insertText: string; range: LspRange | null } 业务值
   * English: Inputs: item: the { insertText: string; range: LspRange | null } domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const applyCompletion = (item: { insertText: string; range: LspRange | null }) => {
    const current = editRef.current;
    if (!current) return;
    let range = item.range;
    if (!range) {
      const lines = current.content.split('\n'),
        line = lines[cursor.current.line] || '',
        prefix = (line.slice(0, cursor.current.character).match(/[\p{L}\p{N}_$]*$/u) || [''])[0];
      range = { start: { line: cursor.current.line, character: cursor.current.character - prefix.length }, end: cursor.current };
    }
    setEdit({ ...current, content: applyTextEdits(current.content, [{ range, newText: item.insertText }]) });
    setCompletions([]);
  };
  /**
   * 中文：提交 POST /vms/{vm.id}/language-service，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/language-service for UI interaction and state presentation for files, editing, history and uploads/downloads. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const applyRename = () => {
    const preview = renamePreview;
    const submitted = editRef.current;
    if (!preview || !submitted) return;
    void action.run(/** 中文：提交 POST /vms/{vm.id}/language-service，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互并更新workspace 状态、renamePreview 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/language-service for UI interaction and state presentation for files, editing, history and uploads/downloads and update workspace state, renamePreview state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：拒绝原因：请先保存涉及的文件。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 请先保存涉及的文件. These errors reach the direct caller or this function's catch handler */ async (signal) => {
      if (preview.files.some((file) => workspaceRef.current.drafts.some((draft) =>
        draft.path === file.path && dirtyEdit(draft)))) throw new Error('请先保存涉及的文件');
      const result = await request<{ files: { path: string; content: string; version: string }[] }>(
        `/vms/${vm.id}/language-service`, 'POST', {
          action: 'apply', token: preview.token,
          ...(leases[submitted.path]?.token ? { lockToken: leases[submitted.path].token } : {}),
        }, signal);
      const updated = new Map(result.files.map((file) => [file.path, file]));
      setWorkspace((current) => ({
        ...current,
        drafts: current.drafts.map((draft) => {
          const file = updated.get(draft.path);
          return file ? { ...draft, content: dirtyEdit(draft) ? draft.content : file.content,
            baseContent: file.content, version: file.version } : draft;
        }),
      }));
      setRenamePreview(null);
      await refresh();
    }, '项目符号已重命名');
  };
  /**
   * 中文：将本批文件交给独立可取消传输，按当前目录、覆盖选择和已持有租约构造请求；finally 清除传输引用并在仍挂载时恢复进度和列表。
   * English: Upload this batch through an independently cancellable transfer, building requests from directory/overwrite choice/held leases. Finally clear transfer ownership and restore progress/list only while mounted.
   * 中文：输入：values：签名所示 FileList | File[] 业务值
   * English: Inputs: values: the FileList | File[] domain value in the signature
   */
  const send = (values: FileList | File[]) => {
    const files = Array.from(values);
    if (!files.length) return;
    return action.run(/** 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中进度快照，重新核对父级远端视图；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In UI interaction and state presentation for files, editing, history and uploads/downloads, progress snapshot, reconcile the parent's remote view. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
      const abort = new AbortController();
      transfer.current = abort;
      try {
        await uploadFiles({
          files,
          token,
          /**
           * 中文：从目标文件的现有租约提取 token，未持有租约返回 undefined 由传输层按实际权限处理。
           * English: Extract the token from a target file's existing lease, returning undefined if absent for transport authority handling.
           * 中文：输入：name：目标名称或文件名
           * English: Inputs: name: target name/filename
           */
          fileLockToken: (name) => leases[target(name)]?.token,
          signal: abort.signal,
          /**
           * 中文：编码当前目录文件路径和 overwrite 选择为实例传输 URL，保留每个文件独立目标。
           * English: Encode current-directory file paths/overwrite choice into VM transfer URLs, retaining independent targets for each file.
           * 中文：输入：name：目标名称或文件名
           * English: Inputs: name: target name/filename
           */
          url: (name) =>
            `/api/vms/${vm.id}/transfer?path=${encodeURIComponent(target(name))}&overwrite=${overwrite ? 1 : 0}`,
          progress: setProgress,
        });
      } finally {
        transfer.current = null;
        if (alive.current) {
          setProgress(null);
          await refresh();
        }
      }
    }, `${files.length} 个文件已上传`);
  };
  if (vm.status !== 'running')
    return (
      <div className="panel-empty">
        <Folder size={30} />
        <h3>启动 Linux，即可访问文件</h3>
        <p>支持文本编辑与任意类型文件传输。</p>
        {draftDialog}
      </div>
    );
  return (
    <div
      className={`content-panel feature-panel file-browser ${dragging ? 'dragging' : ''}`}
      role="region"
      aria-label="Linux 文件浏览器"
      data-clipboard-app="files"
      data-clipboard-vm={vm.id}
      tabIndex={0}
      onPaste={(event) => {
        if (
          action.busy ||
          (event.target instanceof Element &&
            event.target.closest('input,textarea,[contenteditable="true"],.cm-editor'))
        )
          return;
        const values = clipboardFiles(event.clipboardData);
        if (!values.length) return;
        event.preventDefault();
        void send(values);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!action.busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!action.busy) void send(e.dataTransfer.files);
      }}
    >
      <p className="muted">拖入文件即可上传；聚焦此面板后按 Ctrl+V 可粘贴剪贴板中的文件或图片。</p>
      <PluginGate id="project-search">
        <PluginBoundary identity="official:project-search" request={request} label="项目文件搜索">
          {(scopedRequest) => <details className="feature-card project-tree-disclosure" open>
            <summary>项目文件树与全文搜索</summary>
            <ProjectNavigator id={vm.id} request={scopedRequest} open={(path, line) => void openPath(path, line)} />
          </details>}
        </PluginBoundary>
      </PluginGate>
      <div className="file-tools">
        <button
          className="icon-button"
          aria-label="上级目录"
          disabled={action.busy}
          onClick={() => navigate(path.split('/').slice(0, -1).join('/') || '/')}
        >
          <ArrowUp size={17} />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!action.busy) navigate(input);
          }}
        >
          <Folder size={15} />
          <input
            aria-label="Linux 文件路径"
            disabled={action.busy}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </form>
        <button className="icon-button" aria-label="刷新文件" onClick={() => void refresh()}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>
      <div className="feature-actions">
        <button
          className="secondary compact"
          disabled={action.busy}
          onClick={/**
           * 中文功能：在最多 20 个草稿的限制内建立空的新文件草稿，并推进选择代次后将其设为当前编辑项。
           * English: Create an empty new-file draft within the 20-draft limit, advance the selection generation and make it the active editor item.
           * 输入 / Inputs: 无 / none.
           * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
           * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
           * 设计思路：草稿使用随机 ID，状态更新基于 current 追加，选择代次阻止旧选择的迟到读入覆盖新草稿。
           * Design: Use a random draft ID and append from current state; advancing selection generation prevents a late read for an old selection from replacing the new draft.
           */
          () => {
            if (workspace.drafts.length >= 20) {
              setError('最多同时打开 20 个文件');
              return;
            }
            const draft: EditorDraft = {
              id: crypto.randomUUID(),
              path: target(`untitled-${workspace.drafts.length + 1}.txt`),
              content: '',
              fresh: true,
            };
            selectionVersion.current++;
            setWorkspace((current) => ({ drafts: [...current.drafts, draft], active: draft.id }));
          }}
        >
          <Plus size={14} />
          文件
        </button>
        <button
          className="secondary compact"
          disabled={action.busy}
          onClick={() => {
            const name = prompt('新文件夹名称');
            if (name && !/[\/\\]/.test(name)) void operation('mkdir', target(name));
          }}
        >
          <Plus size={14} />
          文件夹
        </button>
        <button className="secondary compact" disabled={action.busy} onClick={() => upload.current?.click()}>
          <Upload size={14} />
          上传文件
        </button>
        <label className="checkbox-label">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          覆盖同名文件
        </label>
        <input
          type="file"
          ref={upload}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void send(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <Feedback error={action.error || error || draftError} message={action.message} />
      <PluginGate id="sync">
        <PluginBoundary identity="official:sync" request={request} label="同步目录入口">
          {(scopedRequest) => <NativeOpenButtons request={scopedRequest} vmId={vm.id} projectId={projectId} path={edit?.path || path} />}
        </PluginBoundary>
      </PluginGate>
      {history.data?.items.length ? (
        <details className="feature-card">
          <summary>文件历史与回收站（{history.data.items.length}）</summary>
          {history.data.items
            .slice()
            .reverse()
            .slice(0, 50)
            .map((item) => (
              <div className="development-row" key={item.id}>
                <div>
                  <code>{item.kind === 'trash' ? '回收站' : '历史版本'}</code> <b>{item.path}</b>
                  <small> · {formatDateTime(new Date(item.createdAt))}</small>
                </div>
                <div className="feature-actions">
                  <button
                    className="text-button"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(/** 中文：提交 GET /vms/{vm.id}/file?path={encodeURIComponent(item.path)}；POST /vms/{vm.id}/history，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /vms/{vm.id}/file?path={encodeURIComponent(item.path)}; POST /vms/{vm.id}/history for UI interaction and state presentation for files, editing, history and uploads/downloads. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
                        let expectedVersion: string | undefined;
                        if (item.kind === 'version') {
                          const current = await request<{ version: string }>(
                            `/vms/${vm.id}/file?path=${encodeURIComponent(item.path)}`,
                            'GET',
                            undefined,
                            signal,
                          ).catch(() => null);
                          expectedVersion = current?.version;
                        }
                        await request(
                          `/vms/${vm.id}/history`,
                          'POST',
                          {
                            action: 'restore', id: item.id,
                            ...(expectedVersion ? { expectedVersion } : {}),
                            ...(leases[item.path]?.token ? { lockToken: leases[item.path].token } : {}),
                          },
                          signal,
                        );
                        history.reload();
                      })
                    }
                  >
                    恢复
                  </button>
                  <button
                    className="text-button danger-text"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(/** 中文：提交 POST /vms/{vm.id}/history，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/history for UI interaction and state presentation for files, editing, history and uploads/downloads. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
                        await request(
                          `/vms/${vm.id}/history`,
                          'POST',
                          { action: 'purge', id: item.id },
                          signal,
                        );
                        history.reload();
                      })
                    }
                  >
                    清理
                  </button>
                </div>
              </div>
            ))}
        </details>
      ) : null}
      {action.busy && progress && (
        <div className="feature-actions" role="status">
          <span>
            {progress.name} · {progress.index}/{progress.count} · {transferBytes(progress.loaded)} /{' '}
            {transferBytes(progress.total)}
            {progress.phase ? ' · ' + progress.phase : ''}
            {progress.loaded === progress.total ? ' · 正在保存…' : ''}
          </span>
          <progress aria-label="上传进度" max={progress.total || 1} value={progress.loaded} />
          <button className="text-button" onClick={/** 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In UI interaction and state presentation for files, editing, history and uploads/downloads, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation */ () => transfer.current?.abort()}>
            取消上传
          </button>
        </div>
      )}
      <div className="browser-table">
        <p className="muted">8 MiB 以上文件支持分块续传；中断后在 24 小时内重新选择同一文件即可继续。</p>
        <div className="browser-header">
          <span>名称</span>
          <span>大小</span>
          <span>操作</span>
        </div>
        {files.map((file) => (
          <div className="browser-row" key={file.name}>
            <button className="file-open" disabled={action.busy} onClick={() => open(file)}>
              {file.directory ? <Folder size={17} /> : <FileText size={17} />}
              <span data-locale-ignore>
                {file.name}
                {file.symlink ? ' ↗' : ''}
              </span>
            </button>
            <span className="muted">{file.directory ? '—' : transferBytes(file.size)}</span>
            <div className="feature-actions">
              {!file.directory && !file.symlink && (
                <button
                  className="text-button"
                  disabled={action.busy}
                  aria-label={`预览 ${file.name}`}
                  onClick={() => setPreviewPath(target(file.name))}
                >
                  预览
                </button>
              )}
              {!file.directory && !file.symlink && (
                <button
                  className="icon-button"
                  aria-label={`下载 ${file.name}`}
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(
                      () => download(request, vm.id, { type: 'file', path: target(file.name) }),
                      '下载已开始，请在浏览器查看进度',
                    )
                  }
                >
                  <Download size={15} />
                </button>
              )}
              <button
                className="text-button"
                disabled={action.busy}
                onClick={() => {
                  const name = prompt('新名称', file.name);
                  if (name && name !== file.name && !/[\/\\]/.test(name))
                    void operation('rename', target(file.name), target(name));
                }}
              >
                重命名
              </button>
              <button
                className="icon-button danger-text"
                aria-label={`删除 ${file.name}`}
                disabled={action.busy}
                onClick={() => {
                  if (file.directory && !file.symlink) {
                    if (
                      prompt(`将永久删除 ${target(file.name)} 及其内容。输入文件夹名称确认：`) === file.name
                    )
                      void operation('delete', target(file.name), undefined, true);
                  } else if (confirm(`删除“${file.name}”？`)) void operation('delete', target(file.name));
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {!files.length && !loading && !error && <p className="muted">目录为空，可拖拽文件到此处上传。</p>}
      </div>
      <p className="subtle-note">
        {files.length} 个项目 · 可拖拽上传 · 文件传输上限 2 GiB · 文本编辑上限 1 MiB
      </p>
      {!!workspace.drafts.length && (
        <div className="editor-tabs" role="tablist" aria-label="打开的文件">
          {workspace.drafts.map((draft) => (
            <button
              key={draft.id}
              role="tab"
              data-locale-ignore
              aria-selected={draft.id === workspace.active}
              title={draft.path}
              className={draft.id === workspace.active ? 'active' : ''}
              onClick={() => {
                selectionVersion.current++;
                setWorkspace((current) => ({ ...current, active: draft.id }));
              }}
            >
              {draft.path.split('/').at(-1)}
              {dirtyEdit(draft) ? ' ●' : ''}
            </button>
          ))}
        </div>
      )}
      {edit && (
        <div className="feature-card">
          <div className="panel-heading">
            <h4>
              {edit.fresh ? '新建文本文件' : '编辑文本'}
              {dirtyEdit(edit) ? ' · 未保存' : ''}
            </h4>
            <button
              className="icon-button"
              aria-label="关闭编辑器"
              onClick={/** 中文：在文件、编辑、历史和上传下载的界面交互与状态呈现流程中当前编辑项，冲突视图；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In UI interaction and state presentation for files, editing, history and uploads/downloads, current edit, conflict view. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
                if (await leave('discard')) {
                  void releaseLease(edit.path).catch((error) => setError((error as Error).message));
                  setEdit(null);
                  setConflict(null);
                }
              }}
            >
              <X size={16} />
            </button>
          </div>
          <div className="feature-actions">
            {leases[edit.path] ? (
              <>
                <span role="status">此编辑器已锁定至 {new Date(leases[edit.path].expiresAt).toLocaleTimeString()}</span>
                <button className="secondary compact" disabled={action.busy}
                  onClick={() => void action.run(() => releaseLease(edit.path), '文件锁已释放')}>
                  释放文件锁
                </button>
              </>
            ) : (
              <button className="secondary compact" disabled={action.busy}
                onClick={() => void action.run(/** 中文：提交 POST /vms/{vm.id}/file-lock?path={encodeURIComponent(edit.path)}，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互并更新leases 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/file-lock?path={encodeURIComponent(edit.path)} for UI interaction and state presentation for files, editing, history and uploads/downloads and update leases state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
                  const value = await request<{ token: string; expiresAt: string }>(
                    `/vms/${vm.id}/file-lock?path=${encodeURIComponent(edit.path)}`,
                    'POST', { action: 'acquire' },
                  );
                  setLeases((current) => ({ ...current, [edit.path]: value }));
                }, '文件锁已获取')}>
                获取文件锁
              </button>
            )}
            <span className="muted">租约每 45 秒续期；锁定期间文件工作台的其他写入不能修改此路径。</span>
          </div>
          <label>
            文件路径
            <input
              value={edit.path}
              readOnly={!edit.fresh}
              onChange={(e) => setEdit({ ...edit, path: e.target.value })}
            />
          </label>
          <PluginBoundary identity="official:files" request={request} label="文件编辑器">
            {/**
             * 中文功能：将插件 boundary 的 lifetime 传给懒加载代码编辑器，用 Suspense 展示加载状态，并把当前草稿、光标与保存动作接入编辑器。
             * English: Pass the plugin boundary lifetime to the lazy code editor, display loading through Suspense, and connect the current draft/cursor/save actions.
             * 输入 / Inputs: _request; lifetime.
             * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
             * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
             * 设计思路：以草稿 ID 作为组件 key，内容修改时清空旧补全与定义结果，避免旧分析结果继续显示在新内容上。
             * Design: Use the draft ID as component key and clear old completion/definition results on edits so old analysis does not remain visible for changed content.
             */
            (_request, lifetime) => {
              const CodeEditor = embeddedPluginComponent('files', 'code-editor', lifetime, loadCodeEditor);
              return <Suspense fallback={<p className="muted">正在加载编辑器…</p>}>
                <CodeEditor
                  key={edit.id}
                  path={edit.path}
                  value={edit.content}
                  change={(content) => { setEdit({ ...edit, content }); setCompletions([]); setDefinitions([]); }}
                  save={() => void save()}
                  line={line.path === edit.path ? line.number : undefined}
                  positionChange={(position) => { cursor.current = position; }}
                />
              </Suspense>;
            }}
          </PluginBoundary>
          {/\.(?:[cm]?[jt]sx?|py)$/i.test(edit.path) && (
            <PluginGate id="code-checks">
              <div className="feature-card">
                <div className="panel-heading"><h4>语言服务</h4>
                  <span className="muted">{languageError || (languageReady === null ? '正在检查语言服务器…' : languageReady ? '已安装' : '需要安装')}</span>
                </div>
                <button className="secondary compact" disabled={action.busy}
                  onClick={() => setLanguageRefresh(value => value + 1)}>刷新语言服务</button>
                {!!languagePending.length && <div role="status">
                  <p className="subtle-note">有未结束的语言服务会话，可以停止后重试。</p>
                  {languagePending.map((item, index) =>
                    <button key={item.token} className="secondary compact" disabled={action.busy}
                      onClick={() => void action.run(/** 中文：提交 POST /vms/{vm.id}/language-service，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互并更新languageRefresh 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/language-service for UI interaction and state presentation for files, editing, history and uploads/downloads and update languageRefresh state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async signal => {
                        await request(`/vms/${vm.id}/language-service`, 'POST', { action: 'stop', token: item.token }, signal);
                        setLanguageRefresh(value => value + 1);
                      }, '原语言服务会话已清理')}>停止原语言服务 {index + 1}</button>)}
                </div>}
                {languageReady === false ? (
                  <button className="secondary compact" disabled={action.busy} onClick={() => void action.run(/** 中文：提交 POST /vms/{vm.id}/language-service，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互并更新languageReady 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/language-service for UI interaction and state presentation for files, editing, history and uploads/downloads and update languageReady state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
                    const path = edit.path;
                    await request(`/vms/${vm.id}/language-service`, 'POST', { action: 'install' }, signal);
                    if (editRef.current?.path === path) setLanguageReady(true);
                  }, 'TypeScript、JavaScript 与 Python 语言服务器已安装')}>
                    安装语言服务器
                  </button>
                ) : languageReady === true ? (
                  <>
                    <div className="feature-actions">
                      <button className="secondary compact" disabled={action.busy} onClick={() => languageAction('completion')}>补全</button>
                      <button className="secondary compact" disabled={action.busy} onClick={() => languageAction('definition')}>跳转到定义</button>
                      <button className="secondary compact" disabled={action.busy} onClick={() => languageAction('diagnostics')}>语言诊断</button>
                    </div>
                    <div className="feature-actions">
                      <input aria-label="重命名为" placeholder="新名称" value={renameName}
                        onChange={(event) => setRenameName(event.target.value)} />
                      <button className="secondary compact" disabled={action.busy || !renameName || dirtyEdit(edit) || !!edit.fresh}
                        onClick={() => languageAction('rename')}>预览重命名</button>
                    </div>
                    {!!completions.length && <div className="feature-card" aria-label="补全候选">
                      {completions.map((item, index) => <button key={index} className="text-button"
                        onClick={() => applyCompletion(item)} title={item.detail}>
                        {item.label}{item.detail ? ` — ${item.detail}` : ''}
                      </button>)}
                    </div>}
                    {!!definitions.length && <div className="feature-card" aria-label="定义位置">
                      {definitions.map((item, index) => <button key={index} className="text-button"
                        onClick={() => void openPath(item.path, item.line)}>
                        {item.path}:{item.line}:{item.column}
                      </button>)}
                    </div>}
                    {renamePreview && <div className="feature-card" role="status">
                      <h4>重命名预览 · {renamePreview.files.length} 个文件</h4>
                      {renamePreview.files.map((file) => <details key={file.path}>
                        <summary>{file.path}</summary>
                        <div className="feature-grid">
                          <div><b>修改前</b><pre className="feature-log">{file.before}</pre></div>
                          <div><b>修改后</b><pre className="feature-log">{file.after}</pre></div>
                        </div>
                      </details>)}
                      <div className="feature-actions">
                        <button className="primary compact" disabled={action.busy} onClick={applyRename}>应用重命名</button>
                        <button className="secondary compact" onClick={() => setRenamePreview(null)}>取消</button>
                      </div>
                    </div>}
                  </>
                ) : null}
              </div>
            </PluginGate>
          )}
          {/\.py$/i.test(edit.path) && <PluginGate id="code-checks">
            <PluginBoundary identity="official:code-checks" request={request} label="Python 调试">
              {(scopedRequest, lifetime) => {
                const DebugPanel = embeddedPluginComponent('code-checks', 'debug-panel', lifetime, loadDebugPanel);
                return <Suspense fallback={<p role="status">正在加载调试面板…</p>}>
                  <DebugPanel vmId={vm.id} request={scopedRequest} path={edit.path}
                    dirty={!!edit.fresh || dirtyEdit(edit)} openPath={openPath} />
                </Suspense>;
              }}
            </PluginBoundary>
          </PluginGate>}
          <div className="feature-actions">
            <PluginGate id="code-checks">
              <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(/** 中文：读取 GET /vms/{vm.id}/code-diagnostics?path={encodeURIComponent(submitted.path)}，完成文件、编辑、历史和上传下载的界面交互与状态呈现的数据交互并更新diagnostics 状态、diagnosticNote 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /vms/{vm.id}/code-diagnostics?path={encodeURIComponent(submitted.path)} for UI interaction and state presentation for files, editing, history and uploads/downloads and update diagnostics state, diagnosticNote state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：拒绝原因：编辑草稿已变化；AbortError。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 编辑草稿已变化; AbortError. These errors reach the direct caller or this function's catch handler | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
                    const submitted = editRef.current;
                    if (!submitted) return;
                    /**
                     * 中文：比较当前编辑的草稿 ID、路径和正文与提交快照，只有完全一致才应用会改变当前界面的操作结果。
                     * English: Compare current draft ID/path/text with the submitted snapshot; apply results affecting the current surface only when all match.
                     */
                    const current = () => editRef.current?.id === submitted.id &&
                      editRef.current.path === submitted.path && editRef.current.content === submitted.content;
                    try {
                      const result = await request<{
                        diagnostics: { message: string; line?: number; column?: number }[];
                      }>(
                        `/vms/${vm.id}/code-diagnostics?path=${encodeURIComponent(submitted.path)}`,
                        'GET', undefined, signal,
                      );
                      signal.throwIfAborted();
                      if (!current()) throw new DOMException('编辑草稿已变化', 'AbortError');
                      setDiagnostics(result.diagnostics);
                      setDiagnosticNote(result.diagnostics.length ? '' : '代码检查未发现问题');
                    } catch (error) {
                      throw current() ? error : new DOMException('编辑草稿已变化', 'AbortError');
                    }
                  }, '检查完成')
                }
              >
                运行代码检查
              </button>
            </PluginGate>
          </div>
          {(diagnostics.length > 0 || diagnosticNote) && (
            <div className="feature-card" role="status">
              <b>代码检查</b>
              {diagnosticNote && <p className="muted">{diagnosticNote}</p>}
              {diagnostics.map((item, index) => (
                <p className="machine-error" key={index}>
                  {item.line ? `${item.line}:${item.column || 1} ` : ''}
                  {item.message}
                </p>
              ))}
            </div>
          )}
          <p className="subtle-note">Ctrl / ⌘ + S 保存 · 草稿保存在本机浏览器 · UTF-8 文本上限 1 MiB</p>
          {conflict && (
            <div className="feature-card" role="alert">
              <h4>文件已在其他位置修改</h4>
              <p>左侧是服务器最新内容，右侧是当前草稿。合并后再保存。</p>
              <div className="feature-grid">
                <pre className="feature-log">{conflict.content}</pre>
                <pre className="feature-log">{edit.content}</pre>
              </div>
              <div className="feature-actions">
                <button
                  className="secondary compact"
                  disabled={edit.baseContent === undefined}
                  onClick={() => setMerging(true)}
                >
                  三方合并
                </button>
                <button
                  className="secondary compact"
                  onClick={() => {
                    setEdit({
                      ...edit,
                      content: conflict.content,
                      baseContent: conflict.content,
                      version: conflict.version,
                    });
                    setConflict(null);
                    action.clear();
                  }}
                >
                  使用最新内容
                </button>
                <button
                  className="secondary compact"
                  onClick={() => {
                    setEdit({ ...edit, baseContent: conflict.content, version: conflict.version });
                    setConflict(null);
                    action.clear();
                  }}
                >
                  保留草稿继续合并
                </button>
              </div>
              {merging && edit.baseContent !== undefined && (
                <ThreeWayMerge
                  key={edit.id + conflict.version}
                  base={edit.baseContent}
                  ours={edit.content}
                  theirs={conflict.content}
                  cancel={() => setMerging(false)}
                  apply={(content) => {
                    setEdit({ ...edit, content, baseContent: conflict.content, version: conflict.version });
                    setConflict(null);
                    setMerging(false);
                    action.clear();
                  }}
                />
              )}
            </div>
          )}
          <button className="primary compact" disabled={action.busy} onClick={() => void save()}>
            <Save size={14} />
            保存文件
          </button>
        </div>
      )}
      {previewPath && (
        <BinaryPreview request={request} id={vm.id} path={previewPath} close={() => setPreviewPath(null)} />
      )}
      {draftDialog}
    </div>
  );
}

export const tabs = { files: FileBrowser };
