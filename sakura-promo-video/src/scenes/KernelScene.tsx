import {Video} from '@remotion/media';
import {Freeze, Interactive, Sequence, staticFile, useVideoConfig} from 'remotion';
import {Chapter, ScenePaper, type SceneProps, SoftFocus, Tag, useScene} from '../stage';
import {colors, font} from '../theme';

export const ManimClip = ({src, seconds}: {src: string; seconds: number}) => {
  const {fps} = useVideoConfig();
  return <>
    <Sequence name="Manim 动画" durationInFrames={seconds * fps} premountFor={fps}><Video name={src} src={staticFile(src)} muted premountFor={fps} style={{width: '100%', height: '100%'}}/></Sequence>
    <Sequence name="图解停留" from={seconds * fps} premountFor={fps}><Freeze frame={seconds * fps - 1}><Video src={staticFile(src)} muted premountFor={fps} style={{width: '100%', height: '100%'}}/></Freeze></Sequence>
  </>;
};
const KernelInner: React.FC<SceneProps> = ({style}) => {
  const {cue} = useScene('kernel');
  return <ScenePaper id="kernel" style={style}>
    <Chapter id="kernel" number="02" tag="内核与编排" detail="原生 Windows 后端 · 不依赖已有 WSL"/>
    <SoftFocus at={0.65} style={{position: 'absolute', left: 112, top: 391, width: 490}}><div style={{fontFamily: font.serif, fontSize: 63, lineHeight: 1.45}}>真正运行<br/><span style={{color: colors.accent}}>Linux 内核</span></div></SoftFocus>
    <SoftFocus at={cue(1)} style={{position: 'absolute', left: 112, top: 602, width: 515}}><div style={{fontSize: 31, color: colors.muted}}>QEMU</div><div style={{fontSize: 33, marginTop: 13}}>虚拟化引擎</div><div style={{fontSize: 29, color: colors.muted, marginTop: 28}}>PosixLoom</div><div style={{fontSize: 31, marginTop: 12}}>命令与会话编排</div></SoftFocus>
    <SoftFocus at={cue(2)} style={{position: 'absolute', left: 109, top: 851}}><Tag>无需已有 WSL · 无需管理员权限</Tag></SoftFocus>
    <div style={{position: 'absolute', left: 655, top: 353, width: 1160, height: 550, borderRadius: 22, border: `1px solid ${colors.line}`, overflow: 'hidden'}}><div style={{position: 'absolute', width: 1160, height: 652.5, top: -51}}><ManimClip src="manim/kernel-flow.mp4" seconds={8}/></div></div>
  </ScenePaper>;
};
export const KernelScene = Interactive.withSchema({Component: KernelInner, componentName: '<KernelScene>', schema: {}, wrapInSequence: true});
