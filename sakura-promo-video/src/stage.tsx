import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Brand, clamp, ease, Icon, MockLabel, Paper, Reveal} from './components';
import {colors, font} from './theme';
import {getScene, sceneTitles, type SceneId} from './timeline';

export type SceneProps = {style?: CSSProperties};
export const useScene = (id: SceneId) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const timing = getScene(id);
  const cue = (index: number) => timing.captions[index] ? timing.captions[index].start - timing.from / fps : timing.durationInFrames / fps * index / 3 + 0.6;
  return {frame, fps, seconds: frame / fps, duration: timing.durationInFrames / fps, cue};
};
export const ScenePaper = ({id, children, style}: SceneProps & {id: SceneId; children: ReactNode}) => {
  const {frame} = useScene(id);
  const timing = getScene(id);
  return <Paper style={{opacity: id === 'closing' ? interpolate(frame, [0, 12], [0, 1], clamp) : interpolate(frame, [0, 12, timing.durationInFrames - 12, timing.durationInFrames], [0, 1, 1, 0], clamp), ...style}}>{children}</Paper>;
};
export const Chapter = ({id, number, tag, detail, optional = false}: {id: SceneId; number: string; tag: string; detail: string; optional?: boolean}) => <>
  <Reveal delay={0.1} style={{position: 'absolute', left: 108, top: 121}}>
    <div style={{display: 'flex', alignItems: 'center', gap: 20, fontSize: 24, color: colors.accent, letterSpacing: 2}}><span style={{fontFamily: font.mono, color: '#bb829f'}}>{number} / 12</span><span style={{width: 46, height: 1, background: colors.accent}}/><span>{tag}</span></div>
    <h1 style={{fontFamily: font.serif, fontSize: 78, fontWeight: 600, margin: '18px 0 0', lineHeight: 1.28}}>{sceneTitles[id]}</h1>
  </Reveal>
  <Reveal delay={0.4} style={{position: 'absolute', left: 112, top: 284, fontSize: 31, color: optional ? colors.accent : colors.muted}}>{detail}</Reveal>
  <MockLabel style={{position: 'absolute', right: 112, top: 292}} />
</>;
export const Window = ({children, title, style}: {children: ReactNode; title: string; style?: CSSProperties}) => <Reveal delay={0.5} style={{position: 'absolute', left: 108, top: 358, width: 1704, height: 543, overflow: 'hidden', borderRadius: 23, border: `1px solid ${colors.line}`, background: '#fff', boxShadow: '0 28px 80px #3b203214', ...style}}>
  <div style={{height: 63, display: 'flex', alignItems: 'center', gap: 27, padding: '0 27px', borderBottom: `1px solid ${colors.line}`, background: '#fffdff'}}><Brand size={33}/><div style={{height: 27, width: 1, background: colors.line}}/><span style={{fontSize: 25}}>{title}</span><span style={{fontSize: 20, color: colors.muted, marginLeft: 'auto'}}>本地 Linux 工作空间</span></div>
  {children}
</Reveal>;
export const Tag = ({children, color = colors.accent, style}: {children: ReactNode; color?: string; style?: CSSProperties}) => <div style={{display: 'inline-flex', alignItems: 'center', gap: 10, borderRadius: 30, color, background: color === colors.green ? colors.greenSoft : colors.blush, padding: '9px 18px', fontSize: 23, ...style}}>{children}</div>;
export const Badge = ({children, active}: {children: ReactNode; active?: boolean}) => <div style={{padding: '12px 22px', fontSize: 25, borderRadius: 10, border: `1px solid ${active ? '#dab2c6' : colors.line}`, color: active ? colors.accent : colors.muted, background: active ? colors.blush : '#fff'}}>{children}</div>;
export const Button = ({children, muted = false, style}: {children: ReactNode; muted?: boolean; style?: CSSProperties}) => <div style={{fontSize: 25, background: muted ? '#f4eef3' : colors.accent, color: muted ? colors.muted : '#fff', borderRadius: 10, padding: '12px 23px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 12, ...style}}>{children}</div>;
export const Status = ({children, active = true}: {children: ReactNode; active?: boolean}) => <div style={{display: 'flex', gap: 10, alignItems: 'center', color: active ? colors.green : colors.muted, fontSize: 23}}><span style={{width: 9, height: 9, borderRadius: 10, background: active ? colors.green : '#b19cb5'}}/>{children}</div>;
export const Terminal = ({children, title = 'terminal', style}: {children: ReactNode; title?: string; style?: CSSProperties}) => <div style={{background: colors.terminal, color: colors.terminalInk, borderRadius: 12, overflow: 'hidden', ...style}}><div style={{height: 42, padding: '0 21px', display: 'flex', gap: 12, alignItems: 'center', background: colors.terminalChrome, fontSize: 20, color: '#b7a5bd'}}><Icon type="terminal" size={24}/>{title}</div><div style={{fontFamily: font.mono, fontSize: 27, lineHeight: 1.85, padding: '23px 26px'}}>{children}</div></div>;
export const Typed = ({text, start, duration = 1, cursor = true}: {text: string; start: number; duration?: number; cursor?: boolean}) => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig();
  const count = Math.floor(interpolate(frame, [start * fps, (start + duration) * fps], [0, text.length], clamp));
  return <>{text.slice(0, count)}{cursor && <span style={{display: 'inline-block', width: 13, height: 27, background: '#e8c6d8', verticalAlign: '-4px', opacity: frame % fps < fps * 0.55 ? 1 : 0}}/>}</>;
};
export const FlowArrow = ({style}: {style?: CSSProperties}) => <div style={{fontSize: 49, color: '#b989a3', textAlign: 'center', ...style}}>→</div>;
export const StepStrip = ({steps, current, style}: {steps: string[]; current: number; style?: CSSProperties}) => <div style={{display: 'flex', alignItems: 'center', gap: 13, ...style}}>{steps.map((step, index) => <div key={step} style={{display: 'flex', gap: 13, alignItems: 'center'}}>{index > 0 && <span style={{color: '#c4b2c5', fontSize: 26}}>→</span>}<div style={{display: 'flex', gap: 11, alignItems: 'center', color: current >= index ? colors.accent : colors.muted, fontSize: 25}}><span style={{width: 29, height: 29, fontFamily: font.mono, fontSize: 18, display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: 20, background: current >= index ? colors.blush : colors.soft}}>{current > index ? <Icon type="check" size={18}/> : index + 1}</span>{step}</div></div>)}</div>;
export const SoftFocus = ({at, children, style}: {at: number; children: ReactNode; style?: CSSProperties}) => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig();
  return <div style={{opacity: interpolate(frame, [at * fps, (at + 0.5) * fps], [0, 1], {...clamp, easing: ease}), translate: `0px ${interpolate(frame, [at * fps, (at + 0.65) * fps], [22, 0], {...clamp, easing: ease})}px`, ...style}}>{children}</div>;
};
export const Background = () => <AbsoluteFill style={{background: colors.paper}}/>;
