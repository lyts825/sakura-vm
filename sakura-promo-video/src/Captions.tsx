/** 按全片当前秒数选择 transcript 字幕并绘制字幕条，确保字幕随实际旁白时间显示。
 * Select transcript captions from global film frames and render the timed caption bar aligned to actual narration. */
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {captions} from './timeline';
import {clamp} from './components';
import {colors, font} from './theme';

/** Sentence timing comes from the actual spoken audio, shared with the SRT. */
/** 按全片帧数选择 start 含端点、end 不含端点的字幕，并应用短入出淡化；字幕区间之外返回 null，字幕不依赖场景局部帧。
 * Select captions using global frames with an inclusive start and exclusive end, applying short fades; return null outside caption intervals, independently of scene-local frames. */
export const Captions = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const caption = captions.find(({start, end}) => frame >= start * fps && frame < end * fps);
  if (!caption) return null;
  return <div style={{position: 'absolute', left: 104, right: 104, top: 924, height: 126, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
    opacity: interpolate(frame, [caption.start * fps, (caption.start + 0.12) * fps, (caption.end - 0.10) * fps, caption.end * fps], [0, 1, 1, 0], clamp)}}>
    <div style={{fontFamily: font.sans, fontSize: 36, color: colors.ink, letterSpacing: 1, lineHeight: 1.4, padding: '12px 31px', background: '#faf7f9eb', borderRadius: 25, textAlign: 'center', maxWidth: 1540}}>{caption.text}</div>
  </div>;
};
