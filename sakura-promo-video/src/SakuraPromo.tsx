import {Audio} from '@remotion/media';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {staticFile, useVideoConfig} from 'remotion';
import {OpeningScene} from './scenes/OpeningScene';
import {TerminalScene} from './scenes/TerminalScene';
import {KernelScene} from './scenes/KernelScene';
import {PluginsScene} from './scenes/PluginsScene';
import {WorkflowScene} from './scenes/WorkflowScene';
import {ClosingScene} from './scenes/ClosingScene';
import {Captions} from './Captions';

// Each outgoing scene contains 0.4s of overlap. New scenes still begin at
// exactly 6 / 14 / 22 / 32 / 40 seconds; the finished timeline is 45 seconds.
export const SakuraPromo = () => {
  const {fps} = useVideoConfig();
  return <>
    <Audio name="中文旁白" src={staticFile('audio/narration.wav')} volume={1} premountFor={fps} />
    <Audio name="原创配乐（已含尾淡出）" src={staticFile('audio/soundtrack.wav')} volume={1} premountFor={fps} />
    <TransitionSeries
      style={{
        scale: 0.999
      }}
    >
      <TransitionSeries.Sequence name="01 — 让 Linux 在本地生长" durationInFrames={6.4 * fps} premountFor={fps}><OpeningScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: 0.4 * fps})} />
      <TransitionSeries.Sequence name="02 — 基础终端" durationInFrames={8.4 * fps} premountFor={fps}><TerminalScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: 0.4 * fps})} />
      <TransitionSeries.Sequence name="03 — Linux 内核 / Manim" durationInFrames={8.4 * fps} premountFor={fps}><KernelScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: 0.4 * fps})} />
      <TransitionSeries.Sequence name="04 — 按需扩展" durationInFrames={10.4 * fps} premountFor={fps}><PluginsScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: 0.4 * fps})} />
      <TransitionSeries.Sequence name="05 — 本地工作流" durationInFrames={8.4 * fps} premountFor={fps}><WorkflowScene /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: 0.4 * fps})} />
      <TransitionSeries.Sequence name="06 — 工作空间" durationInFrames={5 * fps} premountFor={fps}><ClosingScene /></TransitionSeries.Sequence>
    </TransitionSeries>
    <Captions />
  </>;
};
