import { useMemo, useState } from 'react';
import { threeWayMerge, resolvedMerge } from '../shared/three-way-merge';

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
  apply: (content: string) => void;
  cancel: () => void;
  oursLabel?: string;
  theirsLabel?: string;
}) {
  const [resolution, setResolution] = useState({ base, ours, theirs, values: {} as Record<number, string> });
  const choices =
    resolution.base === base && resolution.ours === ours && resolution.theirs === theirs
      ? resolution.values
      : {};
  const setChoices = (values: Record<number, string>) => setResolution({ base, ours, theirs, values });
  const parsed = useMemo(() => {
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
