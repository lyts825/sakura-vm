import {CanvasImage, Interactive, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {clamp, ease, Paper, Reveal} from '../components';
import {colors, font} from '../theme';

const ClosingInner: React.FC<{style?: React.CSSProperties}> = ({style}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return <Paper style={style}>
    <CanvasImage src={staticFile('brand/sakura-bough-painted.webp')} premountFor={fps} style={{position: 'absolute', width: 1790, height: 895, left: 599, top: -194,
      opacity: interpolate(frame, [0, 1.8 * fps], [0.45, 0.87], {...clamp, easing: ease}),
      translate: `${interpolate(frame, [0, 4.5 * fps], [34, 0], {...clamp, easing: ease})}px 0px`}} />
    <Reveal delay={0.35} style={{position: 'absolute', left: 147, top: 248}}><div style={{fontFamily: font.serif, fontSize: 170, fontWeight: 600, lineHeight: 1.15, letterSpacing: -5}}>Sakura<span style={{color: colors.accent, fontSize: 51, marginLeft: 24}}>桜</span></div></Reveal>
    <Reveal delay={0.85} style={{position: 'absolute', left: 154, top: 496}}><div style={{fontFamily: font.serif, fontSize: 65, letterSpacing: 2, lineHeight: 1.7}}>从一个终端，<br/>长成你的工作空间。</div></Reveal>
    <div style={{position: 'absolute', left: 158, top: 774, height: 3, width: interpolate(frame, [1.4 * fps, 2.5 * fps], [0, 350], {...clamp, easing: ease}), background: colors.accent}} />
    <Reveal delay={1.6} style={{position: 'absolute', left: 158, top: 831, fontSize: 28, color: colors.muted, letterSpacing: 4}}>本地 Linux · 基础终端 · 按需扩展</Reveal>
  </Paper>;
};
export const ClosingScene = Interactive.withSchema({Component: ClosingInner, componentName: '<ClosingScene>', schema: {}, wrapInSequence: true});
