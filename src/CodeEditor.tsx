import { useEffect, useRef } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { StreamLanguage } from '@codemirror/language';

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
export function CodeEditor({
  path,
  value,
  change,
  save,
  line,
}: {
  path: string;
  value: string;
  change: (value: string) => void;
  save: () => void;
  line?: number;
}) {
  const parent = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    callbacks = useRef({ change, save }),
    configuring = useRef(false);
  callbacks.current = { change, save };
  const mode = useRef(new Compartment());
  useEffect(() => {
    const editor = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of([
            {
              key: 'Mod-s',
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
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      configuring.current = true;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
      configuring.current = false;
    }
  }, [value]);
  useEffect(() => {
    let alive = true;
    void language(path)
      .then((extension) => {
        if (alive) view.current?.dispatch({ effects: mode.current.reconfigure(extension) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);
  useEffect(() => {
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
