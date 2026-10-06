import storyboard from '../STORYBOARD.json';
import rawTranscript from '../public/audio/transcript.json';

export type SceneId = 'opening' | 'kernel' | 'instances' | 'plugins' | 'development' | 'files' | 'recovery' | 'network' | 'automation' | 'isolation' | 'desktop' | 'closing';
export type Caption = {start: number; end: number; text: string};
export type SceneTiming = {id: SceneId; from: number; durationInFrames: number; start: number; end: number; speechStart: number; speechEnd: number; text: string; captions: Caption[]};
type AudioTranscript = {durationInFrames?: number; duration?: number; captions: Caption[]; scenes: Partial<SceneTiming>[]};

const transcript = rawTranscript as unknown as AudioTranscript;
export const audioReady = storyboard.scenes.every(({id}) => transcript.scenes.some((scene) => scene.id === id && Number.isInteger(scene.from) && Number.isInteger(scene.durationInFrames)));
let cursor = 0;
export const timeline: SceneTiming[] = storyboard.scenes.map((scene) => {
  const spoken = transcript.scenes.find(({id}) => id === scene.id);
  if (audioReady && spoken) return spoken as SceneTiming;
  const durationInFrames = Math.round(scene.targetDurationSeconds * storyboard.fps);
  const start = cursor / storyboard.fps;
  const timing: SceneTiming = {id: scene.id as SceneId, from: cursor, durationInFrames, start, end: start + scene.targetDurationSeconds, speechStart: start + 0.6,
    speechEnd: start + scene.targetDurationSeconds - 0.6, text: scene.lines.map(({text}) => text).join(''),
    captions: scene.lines.map(({text}, index) => ({text, start: start + 0.6 + index * (scene.targetDurationSeconds - 1.2) / scene.lines.length, end: start + 0.6 + (index + 1) * (scene.targetDurationSeconds - 1.2) / scene.lines.length}))};
  cursor += durationInFrames;
  return timing;
});
export const getScene = (id: SceneId) => {
  const scene = timeline.find((entry) => entry.id === id);
  if (!scene) throw new Error(`Unknown scene ${id}`);
  return scene;
};
export const totalFrames = audioReady && Number.isInteger(transcript.durationInFrames) ? transcript.durationInFrames! : Math.max(...timeline.map(({from, durationInFrames}) => from + durationInFrames));
export const captions = audioReady ? transcript.captions : timeline.reduce<Caption[]>((all, scene) => [...all, ...scene.captions], []);
export const sceneTitles = storyboard.scenes.reduce((all, {id, title}) => ({...all, [id]: title}), {} as Record<SceneId, string>);
