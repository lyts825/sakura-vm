import {CanvasImage, Interactive, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {clamp, ease, Icon, Reveal} from '../components';
import {ScenePaper, useScene} from '../stage';
import {colors, font} from '../theme';

const OpeningInner: React.FC<{style?: React.CSSProperties}> = ({style}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {cue} = useScene('opening');
  return <ScenePaper id="opening" style={style}>
    <CanvasImage src={staticFile('brand/sakura-bough-painted.webp')} premountFor={fps} style={{position: 'absolute', width: 1760, height: 880, left: 570, top: -200,
      opacity: interpolate(frame, [0, 1.8 * fps], [0, 0.88], {...clamp, easing: ease}),
      translate: `${interpolate(frame, [0, 3 * fps], [90, 0], {...clamp, easing: ease})}px ${interpolate(frame, [0, 3 * fps], [-25, 0], {...clamp, easing: ease})}px`}} />
    <Reveal delay={0.25} style={{position: 'absolute', left: 147, top: 260}}>
      <div style={{fontFamily: font.serif, fontSize: 188, fontWeight: 600, letterSpacing: -6, lineHeight: 1.1}}>Sakura<span style={{color: colors.accent, fontSize: 55, marginLeft: 22}}>桜</span></div>
    </Reveal>
    <Reveal delay={1.1} style={{position: 'absolute', left: 154, top: 516}}>
      <div style={{fontFamily: font.serif, fontSize: 74, lineHeight: 1.45, letterSpacing: 3}}>让 Linux，在本地生长</div>
    </Reveal>
    <div style={{position: 'absolute', left: 156, top: 687, height: 3, width: interpolate(frame, [1.8 * fps, 3.2 * fps], [0, 348], {...clamp, easing: ease}), background: colors.accent}} />
    <Reveal delay={2} style={{position: 'absolute', left: 156, top: 748, color: colors.muted, fontSize: 34, letterSpacing: 2}}>Windows 上的本地 Linux 工作空间</Reveal>
    <Reveal delay={2.6} style={{position: 'absolute', left: 156, top: 818, color: colors.accent, fontSize: 26, letterSpacing: 5}}>轻量起步 · 按需扩展</Reveal>
    <Reveal delay={cue(1)} style={{position: 'absolute', left: 1224, top: 540, width: 510}}>
      <div style={{display: 'flex', flexDirection: 'column', gap: 29}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 25, color: colors.accent, fontSize: 37, translate: `${Math.sin(frame / (fps * 2)) * 8}px 0px`}}><Icon type="terminal" size={43}/><span>终端</span><span style={{height: 1, width: 160, background: '#dab2c6'}}/></div>
        <div style={{display: 'flex', alignItems: 'center', gap: 25, color: colors.accent, fontSize: 37, marginLeft: 56, translate: `${Math.sin(frame / (fps * 2) + 1) * 8}px 0px`}}><Icon type="code" size={43}/><span>代码</span><span style={{height: 1, width: 105, background: '#dab2c6'}}/></div>
        <div style={{display: 'flex', alignItems: 'center', gap: 25, color: colors.accent, fontSize: 37, marginLeft: 112, translate: `${Math.sin(frame / (fps * 2) + 2) * 8}px 0px`}}><Icon type="folder" size={43}/><span>文件</span></div>
      </div>
    </Reveal>
  </ScenePaper>;
};

export const OpeningScene = Interactive.withSchema({Component: OpeningInner, componentName: '<OpeningScene>', schema: {}, wrapInSequence: true});
