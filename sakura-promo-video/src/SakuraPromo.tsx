/** 将十二个章节按旁白时间线组装成全片，同步旁白、配乐、字幕与章节进度。
 * Assemble twelve narration-aligned chapters with global narration/music/captions/progress and scene-local animation frames. */
import {Audio} from '@remotion/media';
import {AbsoluteFill, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {Captions} from './Captions';
import {colors, font} from './theme';
import {audioReady, getScene, sceneTitles, timeline, totalFrames} from './timeline';
import {OpeningScene} from './scenes/OpeningScene';
import {KernelScene} from './scenes/KernelScene';
import {InstancesScene} from './scenes/InstancesScene';
import {PluginsScene} from './scenes/PluginsScene';
import {DevelopmentScene} from './scenes/DevelopmentScene';
import {FilesScene} from './scenes/FilesScene';
import {RecoveryScene} from './scenes/RecoveryScene';
import {NetworkScene} from './scenes/NetworkScene';
import {AutomationScene} from './scenes/AutomationScene';
import {IsolationScene} from './scenes/IsolationScene';
import {DesktopScene} from './scenes/DesktopScene';
import {ClosingScene} from './scenes/ClosingScene';

/** 根据全片帧定位当前章节，显示章节标题与线性总进度；找不到区间时使用完整介绍标签，首帧也保持合法章节编号。
 * Locate the chapter from global frames and show its title and linear film progress; use the full-introduction label outside intervals and keep a valid chapter number at the first frame. */
const Progress = () => {
  const frame = useCurrentFrame();
  const active = timeline.findIndex(({from, durationInFrames}) => frame >= from && frame < from + durationInFrames);
  return <><div style={{position: 'absolute', top: 37, right: 108, fontFamily: font.sans, fontSize: 20, color: colors.muted, letterSpacing: 1.6}}>{String(Math.max(active + 1, 1)).padStart(2, '0')} / 12 <span style={{marginLeft: 19, letterSpacing: 1}}>{active >= 0 ? sceneTitles[timeline[active].id] : '完整介绍'}</span></div><div style={{position: 'absolute', left: 104, top: 72, width: 1712 * frame / (totalFrames - 1), height: 2, background: '#ad416f66'}}/></>;
};

/** The audio transcript owns every start and duration. No fixed 150s limit. */
/** 按统一全片起点与时长编排十二个 Sequence，音频准备完成后一次播放旁白与配乐；字幕和进度置于全局层，场景子组件读取各自局部帧。
 * Schedule twelve sequences from shared global starts/durations and play narration and soundtrack once when audio is ready; captions/progress remain global while scenes consume local frames. */
export const SakuraPromo = () => {
  const {fps} = useVideoConfig();
  return <AbsoluteFill style={{background: colors.paper, scale: 0.999}}>
    {audioReady && <Audio name="中文讲解 · 自然晓伊女声" src={staticFile('audio/narration.wav')} volume={1} premountFor={fps}/>}
    {audioReady && <Audio name="原创配乐 · 已含片尾淡出" src={staticFile('audio/soundtrack.wav')} volume={1} premountFor={fps}/>}
    <Sequence name="01 — 品牌定位" from={getScene('opening').from} durationInFrames={getScene('opening').durationInFrames} premountFor={fps}><OpeningScene/></Sequence>
    <Sequence name="02 — 真正的 Linux 内核" from={getScene('kernel').from} durationInFrames={getScene('kernel').durationInFrames} premountFor={fps}><KernelScene/></Sequence>
    <Sequence name="03 — 基础实例" from={getScene('instances').from} durationInFrames={getScene('instances').durationInFrames} premountFor={fps}><InstancesScene/></Sequence>
    <Sequence name="04 — 按需插件" from={getScene('plugins').from} durationInFrames={getScene('plugins').durationInFrames} premountFor={fps}><PluginsScene/></Sequence>
    <Sequence name="05 — 开发流程" from={getScene('development').from} durationInFrames={getScene('development').durationInFrames} premountFor={fps}><DevelopmentScene/></Sequence>
    <Sequence name="06 — 文件与同步" from={getScene('files').from} durationInFrames={getScene('files').durationInFrames} premountFor={fps}><FilesScene/></Sequence>
    <Sequence name="07 — 快照与备份" from={getScene('recovery').from} durationInFrames={getScene('recovery').durationInFrames} premountFor={fps}><RecoveryScene/></Sequence>
    <Sequence name="08 — 网络与服务" from={getScene('network').from} durationInFrames={getScene('network').durationInFrames} premountFor={fps}><NetworkScene/></Sequence>
    <Sequence name="09 — 自动化与维护" from={getScene('automation').from} durationInFrames={getScene('automation').durationInFrames} premountFor={fps}><AutomationScene/></Sequence>
    <Sequence name="10 — 运行边界" from={getScene('isolation').from} durationInFrames={getScene('isolation').durationInFrames} premountFor={fps}><IsolationScene/></Sequence>
    <Sequence name="11 — 实验性桌面" from={getScene('desktop').from} durationInFrames={getScene('desktop').durationInFrames} premountFor={fps}><DesktopScene/></Sequence>
    <Sequence name="12 — 品牌收束" from={getScene('closing').from} durationInFrames={getScene('closing').durationInFrames} premountFor={fps}><ClosingScene/></Sequence>
    <Progress/>
    <Captions/>
  </AbsoluteFill>;
};
