/**
 * 模块职责（中文）：装配 CodeMirror 文本编辑器、语言扩展及快捷操作，并把内容与光标变化交给文件工作台。
 * Module responsibility (English): Reusing a CodeMirror instance while synchronizing text, language mode and cursor position.
 * 详细范围（中文）：公开入口包括 CodeEditor；职责覆盖复用 CodeMirror 实例并同步文本、语言模式与光标位置，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include CodeEditor. The scope covers Reusing a CodeMirror instance while synchronizing text, language mode and cursor position. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useEffect, useRef } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { StreamLanguage } from '@codemirror/language';
import type { LspPosition } from '../shared/language-service';

/**
 * 中文：按文件扩展名懒加载 CodeMirror 语言支持，未知类型使用空扩展；不用大包一次加载所有语法。
 * English: Lazily load CodeMirror language support by extension, using no extension for unknown types rather than loading all grammars at once.
 * 中文：输入：path：目标文件或请求路径
 * English: Inputs: path: target file/request path
 * 中文：结果：Promise<Extension>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<Extension> carrying the described computation/transport result; throwing branches do not provide success
 */
async function language(path: string): Promise<Extension> {
  if (/\.[jt]sx?$/.test(path))
    return (await import('@codemirror/lang-javascript')).javascript({
      typescript: /\.tsx?$/.test(path),
      jsx: /x$/.test(path),
    });
  if (/\.json$/.test(path)) return (await import('@codemirror/lang-json')).json();
  if (/\.py$/.test(path)) return (await import('@codemirror/lang-python')).python();
  if (/\.html?$/.test(path)) return (await import('@codemirror/lang-html')).html();
  if (/\.css$/.test(path)) return (await import('@codemirror/lang-css')).css();
  if (/\.md$/.test(path)) return (await import('@codemirror/lang-markdown')).markdown();
  if (/\.java$/.test(path)) return (await import('@codemirror/lang-java')).java();
  if (/\.rs$/.test(path)) return (await import('@codemirror/lang-rust')).rust();
  if (/\.go$/.test(path)) return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/go')).go);
  if (/\.ya?ml$/.test(path))
    return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/yaml')).yaml);
  if (/\.(sh|bash)$/.test(path) || /\/(Dockerfile|\.bashrc|\.profile)$/.test(path))
    return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell);
  return [];
}
/**
 * 中文：呈现复用 CodeMirror 实例并同步文本、语言模式与光标位置中的 CodeEditor 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the CodeEditor surface for Reusing a CodeMirror instance while synchronizing text, language mode and cursor position. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  path,
  value,
  change,
  save,
  line,
  positionChange,
} 提供 path（目标文件或请求路径）、value（待校验、转换或保存的输入值）、change（change 状态）、save（save 状态）、line（line 状态）、positionChange（positionChange 状态） 上下文字段
 * English: Inputs: {
  path,
  value,
  change,
  save,
  line,
  positionChange,
} provides context fields path (target file/request path), value (input value to validate/transform/save), change (change state), save (save state), line (line state), positionChange (positionChange state)
 */
export function CodeEditor({
  path,
  value,
  change,
  save,
  line,
  positionChange,
}: {
  path: string;
  value: string;
  change: /** 中文：把修改后的字段或文档交给父级状态所有者；这是 CodeEditor 的调用契约 | English: Deliver modified fields/documents to the parent state owner; this is the callable contract of CodeEditor | 中文：输入：value：待校验、转换或保存的输入值 | English: Inputs: value: input value to validate/transform/save | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (value: string) => void;
  save: /** 中文：提交当前编辑内容并返回保存结果，失败允许调用者保留草稿；这是 CodeEditor 的调用契约 | English: Submit current edit content and return its save result, allowing callers to retain drafts on failure; this is the callable contract of CodeEditor | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
  line?: number;
  positionChange?: /** 中文：通知编辑器光标行列变化，供语言服务按当前位置查询；这是 CodeEditor 的调用契约 | English: Notify editor cursor line/character changes for language-service position queries; this is the callable contract of CodeEditor | 中文：输入：position：签名所示 LspPosition 业务值 | English: Inputs: position: the LspPosition domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (position: LspPosition) => void;
}) {
  const parent = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    callbacks = useRef({ change, save, positionChange }),
    configuring = useRef(false);
  // 编辑器实例只创建一次，事件处理通过 ref 读取最新回调，避免每次 React 渲染重建编辑器和撤销历史。
  callbacks.current = { change, save, positionChange };
  const mode = useRef(new Compartment());
  useEffect(/** 中文：当依赖 [] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const editor = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of([
            {
              key: 'Mod-s',
              /**
               * 中文：读取最新保存回调引用处理快捷键，避免长期存活编辑器捕获旧 props 的保存函数。
               * English: Read the latest save-callback reference for keyboard commands, preventing a long-lived editor from capturing an obsolete prop callback.
               */
              run: () => {
                callbacks.current.save();
                return true;
              },
            },
          ]),
          basicSetup,
          mode.current.of([]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': '文件内容', spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !configuring.current)
              callbacks.current.change(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head;
              const selectedLine = update.state.doc.lineAt(head);
              callbacks.current.positionChange?.({ line: selectedLine.number - 1, character: head - selectedLine.from });
            }
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, []);
  useEffect(/** 中文：当依赖 [value] 变化时把动作交给状态机或编辑器；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [value] change, dispatch actions to the state machine/editor. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      // 外部 value 同步不应再次触发用户编辑回调，否则会把程序性更新当成新的未保存修改。
      configuring.current = true;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
      configuring.current = false;
    }
  }, [value]);
  useEffect(/** 中文：当依赖 [path] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [path] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    let alive = true;
    // 语言扩展异步按路径加载；路径切换后旧扩展返回也不能覆盖当前文件的语言模式。
    void language(path)
      .then((extension) => {
        if (alive) view.current?.dispatch({ effects: mode.current.reconfigure(extension) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);
  useEffect(/** 中文：当依赖 [line] 变化时把动作交给状态机或编辑器，把输入焦点移到目标元素；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [line] change, dispatch actions to the state machine/editor, move input focus to the target. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (line && view.current) {
      const editor = view.current,
        position = editor.state.doc.line(Math.min(Math.max(1, line), editor.state.doc.lines)).from;
      editor.dispatch({ selection: { anchor: position }, scrollIntoView: true });
      editor.focus();
    }
  }, [line]);
  return (
    <div className="code-editor">
      <div className="feature-actions">
        <button className="text-button" onClick={() => view.current && openSearchPanel(view.current)}>
          查找 / 替换
        </button>
        <span className="muted">Ctrl / ⌘ + F 查找 · Ctrl / ⌘ + S 保存</span>
      </div>
      <div ref={parent} />
    </div>
  );
}
