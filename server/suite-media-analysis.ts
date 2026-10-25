import { z } from 'zod';
import * as M from '../shared/contracts/media-studio.ts';
export function validateMediaRecipe(
  recipe: z.infer<typeof M.mediaRecipe>,
  facts: z.infer<typeof M.mediaFacts>,
) {
  const value = M.mediaRecipe.parse(recipe);
  if (value.kind === 'image' && !['png', 'jpeg', 'webp'].includes(facts.format))
    throw new Error('MEDIA_IMAGE_REQUIRED');
  if (value.kind === 'video' && facts.format !== 'mp4') throw new Error('MEDIA_VIDEO_REQUIRED');
  if (value.kind === 'audio' && (!['wav', 'mp4'].includes(facts.format) || !facts.channels))
    throw new Error('MEDIA_AUDIO_REQUIRED');
  if (value.kind !== 'image' && value.startMs + value.durationMs > facts.durationMs)
    throw new Error('MEDIA_CLIP_OUT_OF_RANGE');
  return value;
}
export function parseMediaCaptions(text: string, durationMs: number) {
  const clock = (s: string) => {
    const m = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(s);
    if (!m || +m[2] > 59 || +m[3] > 59) throw new Error('MEDIA_CAPTION_TIME');
    return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
  };
  const blocks = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n\s*\n/);
  const cues = blocks.map((block, index) => {
    const lines = block.split('\n');
    if (lines.shift() !== String(index + 1)) throw new Error('MEDIA_CAPTION_SEQUENCE');
    const times = lines.shift()?.split(' --> ');
    if (times?.length !== 2) throw new Error('MEDIA_CAPTION_RANGE');
    return M.mediaCue.parse({ startMs: clock(times[0]), endMs: clock(times[1]), text: lines.join('\n') });
  });
  if (!cues.length || cues.length > 200) throw new Error('MEDIA_CAPTION_COUNT');
  for (let i = 0; i < cues.length; i++)
    if (
      cues[i].endMs <= cues[i].startMs ||
      cues[i].endMs > durationMs ||
      (i > 0 && cues[i].startMs < cues[i - 1].endMs)
    )
      throw new Error('MEDIA_CAPTION_OVERLAP_OR_DURATION');
  return cues;
}
export function formatMediaCaptions(cues: z.infer<typeof M.mediaCue>[]) {
  const stamp = (ms: number) =>
    `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  return (
    cues.map((c, i) => `${i + 1}\n${stamp(c.startMs)} --> ${stamp(c.endMs)}\n${c.text}`).join('\n\n') + '\n'
  );
}
export function mediaSummary(value: z.infer<typeof M.mediaWorkerResult>) {
  return M.mediaStoredResult.parse({
    ...value,
    items: value.items.map((item) => ({
      ...item,
      outputs: item.outputs.map((output) => ({
        ...output,
        bytes: { bytes: output.bytes.bytes, digest: output.bytes.digest },
      })),
    })),
  });
}
