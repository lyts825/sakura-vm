/** 片尾品牌收束画面，按当前帧展示产品口号、能力提示和品牌资源。
 * Use current frames to compose the closing brand/tagline/capability reminders and hold the final image. */
import {CanvasImage, Interactive, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {clamp, ease, Reveal} from '../components';
import {ScenePaper} from '../stage';
import {colors, font} from '../theme';

/** 按帧缓慢显现樱枝和品牌收尾内容，保留最终纸面构图供影片结束停留。
 * Gradually reveal the painted bough and closing brand from frame time, retaining the final paper composition at the film’s end. */
const ClosingInner: React.FC<{style?: React.CSSProperties}> = ({style}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return <ScenePaper id="closing" style={style}>
    <CanvasImage src={staticFile('brand/sakura-bough-painted.webp')} premountFor={fps} style={{position: 'absolute', width: 1790, height: 895, left: 599, top: -194,
      opacity: interpolate(frame, [0, 1.8 * fps], [0.45, 0.87], {...clamp, easing: ease}),
      translate: `${interpolate(frame, [0, 4.5 * fps], [34, 0], {...clamp, easing: ease})}px 0px`}} />
    <Reveal delay={0.35} style={{position: 'absolute', left: 147, top: 248}}><div style={{fontFamily: font.serif, fontSize: 170, fontWeight: 600, lineHeight: 1.15, letterSpacing: -5}}>Sakura<span style={{color: colors.accent, fontSize: 51, marginLeft: 24}}>桜</span></div></Reveal>
    <Reveal delay={0.85} style={{position: 'absolute', left: 154, top: 496}}><div style={{fontFamily: font.serif, fontSize: 65, letterSpacing: 2, lineHeight: 1.7}}>从一个终端，<br/>长成你的工作空间。</div></Reveal>
    <div style={{position: 'absolute', left: 158, top: 774, height: 3, width: interpolate(frame, [1.4 * fps, 2.5 * fps], [0, 350], {...clamp, easing: ease}), background: colors.accent}} />
    <Reveal delay={1.6} style={{position: 'absolute', left: 158, top: 831, fontSize: 28, color: colors.muted, letterSpacing: 4}}>本地运行 · 按需扩展 · 专注创造</Reveal>
  </ScenePaper>;
};
export const ClosingScene = Interactive.withSchema({Component: ClosingInner, componentName: '<ClosingScene>', schema: {}, wrapInSequence: true});
