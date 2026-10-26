/** 固定页坐标上的字段、表格与纠错；extracts structured fields with immutable page provenance. */
import {
  type Data,
  digest,
  list,
  number,
  object,
  reject,
  rows,
  strings,
  text,
  unique,
} from './seventh-creation-common.ts';

function pages(input: Data) {
  const result = rows(input.pages, 200);
  unique(result.map((p) => text(p.id)));
  for (const p of result) {
    number(p.width, 1, 100000);
    number(p.height, 1, 100000);
    for (const s of rows(p.spans ?? [], 100000)) {
      const box = list(s.bbox, 4).map((v) => number(v, 0));
      if (
        box.length !== 4 ||
        box[0] > box[2] ||
        box[1] > box[3] ||
        box[2] > number(p.width) ||
        box[3] > number(p.height)
      )
        reject('EXTRACT_COORDINATE_RANGE');
    }
  }
  return result;
}
export function computeExtraction(action: string, input: Data): unknown {
  const source = pages(input);
  if (action === 'fields.extract') {
    const fields = rows(input.fields, 1000);
    unique(fields.map((f) => text(f.id)));
    return {
      fields: fields.map((f) => {
        const page = source.find((p) => p.id === f.pageId);
        if (!page) reject('EXTRACT_PAGE_REFERENCE');
        const spans = rows(page.spans ?? [], 100000);
        const region = f.region ? list(f.region, 4).map((v) => number(v, 0)) : null;
        const selected = region
          ? spans.filter((s) => {
              const b = list(s.bbox, 4).map((v) => number(v));
              return b[0] >= region[0] && b[1] >= region[1] && b[2] <= region[2] && b[3] <= region[3];
            })
          : spans;
        const original = selected.map((s) => text(s.text)).join(' ');
        let value: unknown = original;
        if (f.anchor) {
          const anchor = text(f.anchor);
          const position = original.indexOf(anchor);
          value = position < 0 ? null : original.slice(position + anchor.length).trim();
        }
        if (f.type === 'number' && value !== null) {
          if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value)))
            return { id: f.id, pageId: page.id, original, value: null, state: 'type-error' };
          value = String(value);
        }
        return {
          id: f.id,
          pageId: page.id,
          original,
          value,
          spans: selected.map((s) => ({ bbox: s.bbox, text: s.text })),
          state: value === null ? 'missing' : 'extracted',
          sourceDigest: digest(page),
        };
      }),
      scope: 'fixed regions and anchors',
    };
  }
  if (action === 'tables.reconstruct') {
    const rowTolerance = number(input.rowTolerance ?? 3, 0, 100);
    return {
      tables: source.map((p) => {
        const spans = rows(p.spans ?? [], 100000).sort(
          (a, b) =>
            number(list(a.bbox)[1]) - number(list(b.bbox)[1]) ||
            number(list(a.bbox)[0]) - number(list(b.bbox)[0]),
        );
        const lines: { y: number; spans: Data[] }[] = [];
        for (const s of spans) {
          const y = number(list(s.bbox)[1]);
          const line = lines.find((l) => Math.abs(l.y - y) <= rowTolerance);
          if (line) line.spans.push(s);
          else lines.push({ y, spans: [s] });
        }
        return {
          pageId: p.id,
          rows: lines.map((l, index) => ({
            id: `${p.id}-r${index + 1}`,
            cells: l.spans
              .sort((a, b) => number(list(a.bbox)[0]) - number(list(b.bbox)[0]))
              .map((s, i) => ({
                id: `${p.id}-r${index + 1}-c${i + 1}`,
                text: s.text,
                bbox: s.bbox,
                state: 'candidate',
              })),
          })),
          state: 'requires-review',
        };
      }),
    };
  }
  if (action === 'corrections.apply') {
    const edits = rows(input.edits, 10000);
    const output = structuredClone(source);
    const changes: Data[] = [];
    for (const edit of edits) {
      const page = output.find((p) => p.id === edit.pageId);
      if (!page) reject('EXTRACT_PAGE_REFERENCE');
      if (edit.expectedDigest !== digest(source.find((p) => p.id === edit.pageId)))
        reject('EXTRACT_REVISION_CONFLICT');
      const spans = rows(page.spans);
      const index = number(edit.span, 0, spans.length - 1);
      if (!Number.isInteger(index)) reject('EXTRACT_SPAN_REFERENCE');
      const previous = spans[index].text;
      spans[index] = {
        ...spans[index],
        text: text(edit.value),
        source: 'human-correction',
        original: previous,
      };
      page.spans = spans;
      changes.push({ pageId: page.id, span: index, previous, value: edit.value });
    }
    return { pages: output, changes, digest: digest(output) };
  }
  reject('CREATION_ACTION_UNSUPPORTED');
}
