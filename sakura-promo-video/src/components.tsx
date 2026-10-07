/** 宣传视频共用的纸面、品牌、图标和入场动画组件，以当前帧计算确定性画面。
 * Share paper/brand/icon/entrance components with deterministic visuals derived from the current frame. */
import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, CanvasImage, Easing, interpolate, useCurrentFrame, useVideoConfig, staticFile} from 'remotion';
import {colors, font} from './theme';

export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
export const ease = Easing.bezier(0.16, 1, 0.3, 1);

/** 创建纸面背景、统一字体和边界，再用当前帧计算确定性的花瓣位置；petals 可关闭装饰，style 允许调用方调整纸面。
 * Build the paper background, shared typography and bounds, deriving deterministic petal positions from the current frame; petals disables decoration and style customizes the surface. */
export const Paper = ({children, petals = true, style}: {children: ReactNode; petals?: boolean; style?: CSSProperties}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return <AbsoluteFill style={{background: colors.paper, color: colors.ink, fontFamily: font.sans, lineHeight: 1.35, overflow: 'hidden', ...style}}>
    <style>{'*, *::before, *::after {box-sizing: border-box;}'}</style>
    <AbsoluteFill style={{backgroundImage: 'radial-gradient(ellipse at 85% 8%, #f7e7ef88 0%, #faf7f900 48%)'}} />
    <div style={{position: 'absolute', left: 104, right: 104, top: 72, height: 1, background: colors.line}} />
    <div style={{position: 'absolute', left: 106, top: 37, color: colors.muted, fontSize: 20, letterSpacing: 5}}>SAKURA / LOCAL LINUX WORKSPACE</div>
    {petals && <AbsoluteFill style={{pointerEvents: 'none'}}>
      {[0, 1, 2, 3, 4, 5].map((i) => <svg key={i} viewBox="0 0 40 50" style={{position: 'absolute', width: 17 + i * 3, height: 24 + i * 4,
        left: 160 + i * 298 + Math.sin(frame / (fps * 2.8) + i) * 48,
        top: ((i * 173 + frame * (0.42 + i * 0.05)) % 1280) - 110,
        rotate: `${i * 47 + frame * 0.12}deg`, opacity: 0.18 + (i % 2) * 0.11}}>
        <path d="M20 47C-8 26 9 4 20 3C32 0 47 25 20 47Z" fill="#d69bb5" />
      </svg>)}
    </AbsoluteFill>}
    {children}
  </AbsoluteFill>;
};

/** 按 size 比例摆放品牌 SVG 与衬线名称，提前加载图像，允许外部 style 调整布局。
 * Place the brand SVG and serif wordmark proportionally to size, premount the image and allow layout overrides through style. */
export const Brand = ({style, size = 44}: {style?: CSSProperties; size?: number}) => {
  const {fps} = useVideoConfig();
  return <div style={{display: 'flex', alignItems: 'center', gap: size * 0.32, ...style}}>
    <CanvasImage src={staticFile('brand/sakura.svg')} premountFor={fps} style={{width: size, height: size}} />
    <span style={{fontFamily: font.serif, fontSize: size * 0.88, fontWeight: 600, color: colors.ink}}>Sakura</span>
  </div>;
};

/** 组合章节编号、分隔线和传入标题内容，保持相同的章节引导排版。
 * Combine the chapter number, separator and supplied heading content using consistent chapter-introduction typography. */
export const Eyebrow = ({number, children, style}: {number: string; children: ReactNode; style?: CSSProperties}) => <div style={{display: 'flex', alignItems: 'center', gap: 20,
  fontSize: 25, color: colors.accent, letterSpacing: 2, ...style}}><span style={{fontFamily: font.mono, opacity: 0.66}}>{number}</span><span style={{width: 48, height: 1, background: colors.accent}} /><span>{children}</span></div>;

/** 从受类型限制的图标集合选择 SVG 路径，并按 size/color 绘制等宽描边，所有场景复用同一视觉尺寸体系。
 * Select SVG paths from the typed icon set and draw uniform strokes at size/color, giving scenes one consistent icon scale. */
export const Icon = ({type, size = 30, color = 'currentColor'}: {type: 'terminal' | 'folder' | 'branch' | 'snapshot' | 'code' | 'disk' | 'check' | 'power' | 'grid'; size?: number; color?: string}) => {
  const paths = {
    terminal: <><rect x="3" y="4" width="26" height="23" rx="4"/><path d="m9 11 5 5-5 5m9 0h6"/></>,
    folder: <path d="M3 9V6h10l4 4h12v17H3V9Zm0 4h26"/>,
    branch: <><circle cx="9" cy="6" r="3"/><circle cx="24" cy="9" r="3"/><circle cx="9" cy="27" r="3"/><path d="M9 9v15m0-5c0-9 15 1 15-7"/></>,
    snapshot: <><rect x="4" y="4" width="24" height="24" rx="5"/><path d="M8 12a8 8 0 1 1 0 9m0-9v6h6m2-9v7l4 3"/></>,
    code: <><path d="m10 8-7 8 7 8m12-16 7 8-7 8m-4-20-4 24"/></>,
    disk: <><ellipse cx="16" cy="7" rx="12" ry="4"/><path d="M4 7v17c0 5 24 5 24 0V7M4 15c0 5 24 5 24 0"/></>,
    check: <path d="m6 16 7 7L27 8"/>,
    power: <><path d="M16 3v13m-7-9a12 12 0 1 0 14 0"/></>,
    grid: <><rect x="4" y="4" width="9" height="9" rx="2"/><rect x="19" y="4" width="9" height="9" rx="2"/><rect x="4" y="19" width="9" height="9" rx="2"/><rect x="19" y="19" width="9" height="9" rx="2"/></>,
  };
  return <svg viewBox="0 0 32 32" width={size} height={size} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0}}>{paths[type]}</svg>;
};

/** 显示可覆盖的界面示意标签，让观众理解画面表达的是功能演示；style 只调整标签位置与外观。
 * Render an overridable mock-interface label to identify illustrative UI; style controls its placement and appearance. */
export const MockLabel = ({children = '界面示意', style}: {children?: ReactNode; style?: CSSProperties}) => <div style={{fontSize: 23, color: colors.muted, letterSpacing: 2, ...style}}>{children}</div>;

/** 把秒单位 delay 转为当前 fps 的局部帧，分别在 0.7/0.85 秒内插值透明度和位移，并夹住端点保证逐帧可复现。
 * Convert delay seconds to local frames at the current fps, interpolate opacity/translation over 0.7/0.85 seconds and clamp endpoints for reproducible frames. */
export const Reveal = ({children, delay = 0, style}: {children: ReactNode; delay?: number; style?: CSSProperties}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return <div style={{opacity: interpolate(frame, [delay * fps, (delay + 0.7) * fps], [0, 1], {...clamp, easing: ease}),
    translate: `0px ${interpolate(frame, [delay * fps, (delay + 0.85) * fps], [35, 0], {...clamp, easing: ease})}px`, ...style}}>{children}</div>;
};
