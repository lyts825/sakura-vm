import {CanvasImage, staticFile, useVideoConfig} from 'remotion';
import {Paper} from './components';
import {colors, font} from './theme';

export const Cover = () => {
  const {fps} = useVideoConfig();
  return <Paper petals={false}>
    <CanvasImage src={staticFile('brand/sakura-bough-painted.webp')} premountFor={fps} style={{position: 'absolute', width: 1840, height: 920, left: 527, top: -183, opacity: 0.88}} />
    <div style={{position: 'absolute', left: 145, top: 267, fontFamily: font.serif, fontSize: 183, fontWeight: 600, letterSpacing: -5}}>Sakura<span style={{color: colors.accent, fontSize: 56, marginLeft: 24}}>桜</span></div>
    <div style={{position: 'absolute', left: 153, top: 537, fontFamily: font.serif, fontSize: 74, letterSpacing: 2}}>让 Linux，在本地生长</div>
    <div style={{position: 'absolute', left: 157, top: 716, width: 353, height: 3, background: colors.accent}} />
    <div style={{position: 'absolute', left: 157, top: 784, fontSize: 34, color: colors.muted, letterSpacing: 2}}>从一个终端，长成你的工作空间</div>
    <div style={{position: 'absolute', left: 157, top: 859, fontSize: 26, color: colors.accent, letterSpacing: 4}}>Windows 本地 Linux 工作空间 · 完整介绍</div>
  </Paper>;
};
