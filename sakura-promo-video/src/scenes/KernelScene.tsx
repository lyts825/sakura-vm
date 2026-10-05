import {Video} from '@remotion/media';
import {Freeze, Interactive, Sequence, staticFile, useVideoConfig} from 'remotion';
import {Eyebrow, Icon, Paper, Reveal} from '../components';
import {colors, font} from '../theme';

const KernelInner: React.FC<{style?: React.CSSProperties}> = ({style}) => {
  const {fps} = useVideoConfig();
  return <Paper style={style}>
    <Reveal delay={0.1} style={{position: 'absolute', left: 107, top: 122}}><Eyebrow number="02">内核与编排</Eyebrow></Reveal>
    <Reveal delay={0.3} style={{position: 'absolute', left: 108, top: 264, width: 525}}>
      <h1 style={{fontFamily: font.serif, fontSize: 76, lineHeight: 1.36, fontWeight: 600, margin: 0}}>真正运行<br/><span style={{color: colors.accent}}>Linux 内核</span></h1>
      <div style={{height: 3, width: 118, background: colors.accent, marginTop: 38}} />
    </Reveal>
    <Reveal delay={1.05} style={{position: 'absolute', left: 112, top: 529, width: 490, fontSize: 32, color: colors.muted, lineHeight: 1.7}}>PosixLoom<br/><span style={{color: colors.ink, fontSize: 36}}>命令编排 · 会话管理</span></Reveal>
    <Reveal delay={2} style={{position: 'absolute', left: 112, top: 663, width: 490, fontSize: 32, color: colors.muted, lineHeight: 1.7}}>QEMU<br/><span style={{color: colors.ink, fontSize: 36}}>虚拟化 · Linux 实例</span></Reveal>
    <div style={{position: 'absolute', left: 667, top: 233, width: 1152, height: 648, borderRadius: 26, overflow: 'hidden', border: `1px solid ${colors.line}`}}>
      <Sequence name="Manim — 核心原理" durationInFrames={8 * fps} premountFor={fps}>
        <Video name="Manim kernel flow" src={staticFile('manim/kernel-flow.mp4')} muted premountFor={fps} style={{width: '100%', height: '100%'}} />
      </Sequence>
      <Sequence name="Manim — 尾帧保持" from={8 * fps} premountFor={fps}><Freeze frame={8 * fps - 1}><Video src={staticFile('manim/kernel-flow.mp4')} muted premountFor={fps} style={{width: '100%', height: '100%'}} /></Freeze></Sequence>
    </div>
    <div style={{position: 'absolute', right: 112, top: 183, display: 'flex', gap: 11, alignItems: 'center', color: colors.muted, fontSize: 23}}><Icon type="grid" size={24} />运行原理示意 · Manim</div>
  </Paper>;
};
export const KernelScene = Interactive.withSchema({Component: KernelInner, componentName: '<KernelScene>', schema: {}, wrapInSequence: true});
