/**
 * 模块职责（中文）：展示三方合并片段，收集冲突选择和手工编辑后输出最终合并文本。
 * Module responsibility (English): Collecting conflict choices and producing complete merged text.
 * 详细范围（中文）：公开入口包括 ThreeWayMerge；职责覆盖收集冲突选择并输出完整合并文本，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ThreeWayMerge. The scope covers Collecting conflict choices and producing complete merged text. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useMemo, useState } from 'react';
import { threeWayMerge, resolvedMerge } from '../shared/three-way-merge';

/**
 * 中文：呈现收集冲突选择并输出完整合并文本中的 ThreeWayMerge 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ThreeWayMerge surface for Collecting conflict choices and producing complete merged text. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  base,
  ours,
  theirs,
  apply,
  cancel,
  oursLabel = '当前草稿',
  theirsLabel = '外部修改',
} 提供 base（base 状态）、ours（ours 状态）、theirs（theirs 状态）、apply（apply 状态）、cancel（cancel 状态）、oursLabel（oursLabel 状态）、theirsLabel（theirsLabel 状态） 上下文字段
 * English: Inputs: {
  base,
  ours,
  theirs,
  apply,
  cancel,
  oursLabel = '当前草稿',
  theirsLabel = '外部修改',
} provides context fields base (base state), ours (ours state), theirs (theirs state), apply (apply state), cancel (cancel state), oursLabel (oursLabel state), theirsLabel (theirsLabel state)
 */
export function ThreeWayMerge({
  base,
  ours,
  theirs,
  apply,
  cancel,
  oursLabel = '当前草稿',
  theirsLabel = '外部修改',
}: {
  base: string;
  ours: string;
  theirs: string;
  apply: /** 中文：交付完整合并或编辑结果，供调用者保存；这是 ThreeWayMerge 的调用契约 | English: Deliver the complete merge/edit result for the caller to save; this is the callable contract of ThreeWayMerge | 中文：输入：content：当前文件文本内容 | English: Inputs: content: current file text | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (content: string) => void;
  cancel: /** 中文：取消当前编辑或冲突决策流程；这是 ThreeWayMerge 的调用契约 | English: Cancel the current edit/conflict-decision flow; this is the callable contract of ThreeWayMerge | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
  oursLabel?: string;
  theirsLabel?: string;
}) {
  const [resolution, setResolution] = useState({ base, ours, theirs, values: {} as Record<number, string> });
  const choices =
    resolution.base === base && resolution.ours === ours && resolution.theirs === theirs
      ? resolution.values
      : {};
  /**
   * 中文：在收集冲突选择并输出完整合并文本流程中resolution 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Collecting conflict choices and producing complete merged text, resolution state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：values：签名所示 Record<number, string> 业务值
   * English: Inputs: values: the Record<number, string> domain value in the signature
   */
  const setChoices = (values: Record<number, string>) => setResolution({ base, ours, theirs, values });
  const parsed = useMemo(/** 中文：为收集冲突选择并输出完整合并文本构造包含 parts、error 的局部数据对象，字段取自本次输入和明确默认值，供后续表单或状态流程使用 | English: Build a local data object containing parts, error for Collecting conflict choices and producing complete merged text, using current inputs/explicit defaults for subsequent form/state processing | 中文：结果：包含 parts、error 的对象，字段供调用者读取状态或调用操作 | English: Result: an object containing parts, error for caller state reads/operations */ () => {
    try {
      return { parts: threeWayMerge(base, ours, theirs), error: '' };
    } catch (error) {
      return { parts: [], error: (error as Error).message };
    }
  }, [base, ours, theirs]);
  const pending = parsed.parts.filter(
    (part, index) => part.kind === 'conflict' && !Object.hasOwn(choices, index),
  ).length;
  return (
    <section className="merge-editor" aria-label="三方合并编辑器">
      <div className="merge-columns">
        {[
          ['共同版本', base],
          [oursLabel, ours],
          [theirsLabel, theirs],
        ].map(([name, text]) => (
          <label key={name}>
            {name}
            <textarea readOnly rows={8} value={text} />
          </label>
        ))}
      </div>
      {parsed.error ? (
        <p role="alert">{parsed.error}</p>
      ) : (
        <>
          <p role="status">{pending ? `还有 ${pending} 处冲突需要处理` : '冲突已处理，可应用合并结果'}</p>
          {parsed.parts.map(
            (part, index) =>
              part.kind === 'conflict' && (
                <fieldset key={index}>
                  <legend>共同版本第 {part.line} 行附近</legend>
                  <div className="feature-actions">
                    <button onClick={() => setChoices({ ...choices, [index]: part.ours })}>采用草稿</button>
                    <button onClick={() => setChoices({ ...choices, [index]: part.theirs })}>
                      采用外部修改
                    </button>
                    <button onClick={() => setChoices({ ...choices, [index]: part.ours + part.theirs })}>
                      保留双方
                    </button>
                  </div>
                  <label>
                    冲突 {index + 1} 的合并内容
                    <textarea
                      rows={5}
                      value={choices[index] ?? ''}
                      placeholder="选择版本或手动填写，包括删除此段"
                      onChange={(event) => setChoices({ ...choices, [index]: event.target.value })}
                    />
                  </label>
                </fieldset>
              ),
          )}
          <button
            className="primary compact"
            disabled={pending > 0}
            onClick={() => apply(resolvedMerge(parsed.parts, choices))}
          >
            应用合并结果
          </button>
        </>
      )}
      <button className="secondary compact" onClick={cancel}>
        取消合并
      </button>
    </section>
  );
}
