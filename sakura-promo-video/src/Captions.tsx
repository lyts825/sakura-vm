import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {captions} from './timeline';
import {clamp} from './components';
import {colors, font} from './theme';

/** Sentence timing comes from the actual spoken audio, shared with the SRT. */
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
