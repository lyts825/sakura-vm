/** 场景舞台与 UI 示意组件，统一局部帧、旁白 cue、转场和终端打字动画的时间基准。
 * Share local-frame/narration-cue/transition/terminal-typing timing and illustrative UI components across scenes. */
import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Brand, clamp, ease, Icon, MockLabel, Paper, Reveal} from './components';
import {colors, font} from './theme';
import {getScene, sceneTitles, type SceneId} from './timeline';

export type SceneProps = {style?: CSSProperties};
/** 返回指定章节的局部帧、秒数、时长及旁白 cue 查找器；全片字幕起点减去章节起点后转为局部秒数，缺失字幕按章节三等分回退。
 * Return scene-local frames, seconds, duration and a narration-cue lookup; subtract the chapter start from global caption starts, falling back to thirds of the scene when captions are absent. */
export const useScene = (id: SceneId) => {
  // Sequence 内 frame 为局部帧，字幕 start 为全片秒数；减去场景起点才能驱动场景动画。
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const timing = getScene(id);
  /** 把第 index 条全片字幕起点换算为当前场景局部秒数；无对应条目时使用章节时长的三等分加 0.6 秒作为预览节奏。
   * Convert caption index’s global start to scene-local seconds; missing entries use one-third scene spacing plus 0.6 seconds for preview timing. */
  const cue = (index: number) => timing.captions[index] ? timing.captions[index].start - timing.from / fps : timing.durationInFrames / fps * index / 3 + 0.6;
  return {frame, fps, seconds: frame / fps, duration: timing.durationInFrames / fps, cue};
};
/** 按章节局部帧设置 12 帧入出淡化并渲染纸面；closing 只淡入，保持片尾最终画面，调用方 style 可覆盖外观。
 * Fade the paper over twelve local frames at scene boundaries; closing only fades in so the final picture holds, and caller style can override appearance. */
export const ScenePaper = ({id, children, style}: SceneProps & {id: SceneId; children: ReactNode}) => {
  const {frame} = useScene(id);
  const timing = getScene(id);
  return <Paper style={{opacity: id === 'closing' ? interpolate(frame, [0, 12], [0, 1], clamp) : interpolate(frame, [0, 12, timing.durationInFrames - 12, timing.durationInFrames], [0, 1, 1, 0], clamp), ...style}}>{children}</Paper>;
};
/** 从 sceneTitles 读取章标题并显示编号、标签、功能详情与界面示意标识；optional 使用强调色表达需要启用插件的能力。
 * Read the title from sceneTitles and show chapter number, tag, details and mock-UI marker; optional emphasizes capabilities requiring enabled plugins. */
export const Chapter = ({id, number, tag, detail, optional = false}: {id: SceneId; number: string; tag: string; detail: string; optional?: boolean}) => <>
  <Reveal delay={0.1} style={{position: 'absolute', left: 108, top: 121}}>
    <div style={{display: 'flex', alignItems: 'center', gap: 20, fontSize: 24, color: colors.accent, letterSpacing: 2}}><span style={{fontFamily: font.mono, color: '#bb829f'}}>{number} / 12</span><span style={{width: 46, height: 1, background: colors.accent}}/><span>{tag}</span></div>
    <h1 style={{fontFamily: font.serif, fontSize: 78, fontWeight: 600, margin: '18px 0 0', lineHeight: 1.28}}>{sceneTitles[id]}</h1>
  </Reveal>
  <Reveal delay={0.4} style={{position: 'absolute', left: 112, top: 284, fontSize: 31, color: optional ? colors.accent : colors.muted}}>{detail}</Reveal>
  <MockLabel style={{position: 'absolute', right: 112, top: 292}} />
</>;
/** 为传入内容绘制统一标题栏和品牌框架，并以半秒延迟入场，style 可调整尺寸位置以适配章节构图。
 * Frame supplied content with the shared title bar/brand and a half-second entrance delay; style adjusts dimensions/position for scene composition. */
export const Window = ({children, title, style}: {children: ReactNode; title: string; style?: CSSProperties}) => <Reveal delay={0.5} style={{position: 'absolute', left: 108, top: 358, width: 1704, height: 543, overflow: 'hidden', borderRadius: 23, border: `1px solid ${colors.line}`, background: '#fff', boxShadow: '0 28px 80px #3b203214', ...style}}>
  <div style={{height: 63, display: 'flex', alignItems: 'center', gap: 27, padding: '0 27px', borderBottom: `1px solid ${colors.line}`, background: '#fffdff'}}><Brand size={33}/><div style={{height: 27, width: 1, background: colors.line}}/><span style={{fontSize: 25}}>{title}</span><span style={{fontSize: 20, color: colors.muted, marginLeft: 'auto'}}>本地 Linux 工作空间</span></div>
  {children}
</Reveal>;
/** 渲染紧凑标签，绿色采用对应浅底，其他颜色采用品牌浅底，并允许外部布局样式。
 * Render a compact tag with a matching pale green background for green text and the brand tint otherwise, accepting external layout style. */
export const Tag = ({children, color = colors.accent, style}: {children: ReactNode; color?: string; style?: CSSProperties}) => <div style={{display: 'inline-flex', alignItems: 'center', gap: 10, borderRadius: 30, color, background: color === colors.green ? colors.greenSoft : colors.blush, padding: '9px 18px', fontSize: 23, ...style}}>{children}</div>;
/** 依据 active 切换能力或模板的选中配色，内容仅承担影片中的选择状态示意。
 * Switch capability/template selection colors from active; content represents selection state within the film. */
export const Badge = ({children, active}: {children: ReactNode; active?: boolean}) => <div style={{padding: '12px 22px', fontSize: 25, borderRadius: 10, border: `1px solid ${active ? '#dab2c6' : colors.line}`, color: active ? colors.accent : colors.muted, background: active ? colors.blush : '#fff'}}>{children}</div>;
/** 绘制示意按钮并根据 muted 调整强调程度，children 和 style 提供文案、图标与布局。
 * Draw an illustrative button, reduce emphasis with muted and accept label/icons/layout through children and style. */
export const Button = ({children, muted = false, style}: {children: ReactNode; muted?: boolean; style?: CSSProperties}) => <div style={{fontSize: 25, background: muted ? '#f4eef3' : colors.accent, color: muted ? colors.muted : '#fff', borderRadius: 10, padding: '12px 23px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 12, ...style}}>{children}</div>;
/** 用状态圆点和文字表示 active 的绿色就绪状态或灰色等待状态。
 * Represent active readiness with a green dot/text or waiting with muted styling. */
export const Status = ({children, active = true}: {children: ReactNode; active?: boolean}) => <div style={{display: 'flex', gap: 10, alignItems: 'center', color: active ? colors.green : colors.muted, fontSize: 23}}><span style={{width: 9, height: 9, borderRadius: 10, background: active ? colors.green : '#b19cb5'}}/>{children}</div>;
/** 为 children 绘制终端标题栏和等宽内容区域，统一命令演示的行高、颜色与内边距。
 * Draw terminal chrome and a monospaced content area around children, standardizing command-demo line height, colors and padding. */
export const Terminal = ({children, title = 'terminal', style}: {children: ReactNode; title?: string; style?: CSSProperties}) => <div style={{background: colors.terminal, color: colors.terminalInk, borderRadius: 12, overflow: 'hidden', ...style}}><div style={{height: 42, padding: '0 21px', display: 'flex', gap: 12, alignItems: 'center', background: colors.terminalChrome, fontSize: 20, color: '#b7a5bd'}}><Icon type="terminal" size={24}/>{title}</div><div style={{fontFamily: font.mono, fontSize: 27, lineHeight: 1.85, padding: '23px 26px'}}>{children}</div></div>;
/** 在 start 至 start+duration 秒内按帧截取文本，夹住字符数并可显示周期闪烁光标；输出完全由当前帧决定，不执行命令。
 * Reveal a clamped substring over start to start+duration seconds and optionally show a periodic cursor; output depends entirely on the current frame and executes no commands. */
export const Typed = ({text, start, duration = 1, cursor = true}: {text: string; start: number; duration?: number; cursor?: boolean}) => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig();
  const count = Math.floor(interpolate(frame, [start * fps, (start + duration) * fps], [0, text.length], clamp));
  return <>{text.slice(0, count)}{cursor && <span style={{display: 'inline-block', width: 13, height: 27, background: '#e8c6d8', verticalAlign: '-4px', opacity: frame % fps < fps * 0.55 ? 1 : 0}}/>}</>;
};
/** 绘制可定制布局的方向箭头，连接流程示意节点。
 * Draw a direction arrow with customizable layout to connect illustrative flow nodes. */
export const FlowArrow = ({style}: {style?: CSSProperties}) => <div style={{fontSize: 49, color: '#b989a3', textAlign: 'center', ...style}}>→</div>;
/** 按 current 将更早步骤标为完成、当前步骤强调、后续步骤弱化，并按原数组顺序连接箭头。
 * Mark steps before current complete, emphasize the current step and mute later ones, connecting them in original array order. */
export const StepStrip = ({steps, current, style}: {steps: string[]; current: number; style?: CSSProperties}) => <div style={{display: 'flex', alignItems: 'center', gap: 13, ...style}}>{steps.map((step, index) => <div key={step} style={{display: 'flex', gap: 13, alignItems: 'center'}}>{index > 0 && <span style={{color: '#c4b2c5', fontSize: 26}}>→</span>}<div style={{display: 'flex', gap: 11, alignItems: 'center', color: current >= index ? colors.accent : colors.muted, fontSize: 25}}><span style={{width: 29, height: 29, fontFamily: font.mono, fontSize: 18, display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: 20, background: current >= index ? colors.blush : colors.soft}}>{current > index ? <Icon type="check" size={18}/> : index + 1}</span>{step}</div></div>)}</div>;
/** 从 at 秒开始在半秒内淡入、0.65 秒内上移到位，使用相同缓动与夹持边界配合旁白 cue。
 * Fade in from at over half a second and settle translation over 0.65 seconds, using shared easing/clamping to align with narration cues. */
export const SoftFocus = ({at, children, style}: {at: number; children: ReactNode; style?: CSSProperties}) => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig();
  return <div style={{opacity: interpolate(frame, [at * fps, (at + 0.5) * fps], [0, 1], {...clamp, easing: ease}), translate: `0px ${interpolate(frame, [at * fps, (at + 0.65) * fps], [22, 0], {...clamp, easing: ease})}px`, ...style}}>{children}</div>;
};
/** 返回覆盖合成画面的品牌纸色底层，供章节或封面建立一致背景。
 * Return a full-composition paper-color layer for a consistent scene/cover background. */
export const Background = () => <AbsoluteFill style={{background: colors.paper}}/>;
