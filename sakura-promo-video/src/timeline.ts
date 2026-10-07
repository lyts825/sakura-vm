/** 将 STORYBOARD 与实际 transcript 合并为场景帧时间线；旁白未就绪时用目标时长供预览，全片渲染依赖完整语音时间。
 * Combine storyboard/actual transcript into scene-frame timing; previews use target durations only before audio readiness and final renders require complete speech timing. */
import storyboard from '../STORYBOARD.json';
import rawTranscript from '../public/audio/transcript.json';

export type SceneId = 'opening' | 'kernel' | 'instances' | 'plugins' | 'development' | 'files' | 'recovery' | 'network' | 'automation' | 'isolation' | 'desktop' | 'closing';
export type Caption = {start: number; end: number; text: string};
export type SceneTiming = {id: SceneId; from: number; durationInFrames: number; start: number; end: number; speechStart: number; speechEnd: number; text: string; captions: Caption[]};
type AudioTranscript = {durationInFrames?: number; duration?: number; captions: Caption[]; scenes: Partial<SceneTiming>[]};

const transcript = rawTranscript as unknown as AudioTranscript;
export const audioReady = storyboard.scenes.every(({id}) => transcript.scenes.some((scene) => scene.id === id && Number.isInteger(scene.from) && Number.isInteger(scene.durationInFrames)));
// 必须整条时间线都有语音帧数据才采用 transcript，避免已合成和估计章节混用两个时间基准。
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
/** 按稳定章节 ID 查询统一时间线；未知 ID 抛错而不返回不完整时序，调用方据此设置剪辑起点和时长。
 * Look up shared timing by stable scene ID; throw on unknown IDs instead of returning incomplete timing used for clip starts and durations. */
export const getScene = (id: SceneId) => {
  const scene = timeline.find((entry) => entry.id === id);
  if (!scene) throw new Error(`Unknown scene ${id}`);
  return scene;
};
export const totalFrames = audioReady && Number.isInteger(transcript.durationInFrames) ? transcript.durationInFrames! : Math.max(...timeline.map(({from, durationInFrames}) => from + durationInFrames));
export const captions = audioReady ? transcript.captions : timeline.reduce<Caption[]>((all, scene) => [...all, ...scene.captions], []);
export const sceneTitles = storyboard.scenes.reduce((all, {id, title}) => ({...all, [id]: title}), {} as Record<SceneId, string>);
