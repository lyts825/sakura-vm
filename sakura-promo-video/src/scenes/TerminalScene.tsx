import {Interactive, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Brand, clamp, ease, Eyebrow, Icon, MockLabel, Paper, Reveal} from '../components';
import {colors, font} from '../theme';

const TerminalInner: React.FC<{style?: React.CSSProperties}> = ({style}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const started = frame > 1.5 * fps;
  const stopped = frame > 6 * fps && frame < 7.05 * fps;
  const command = 'uname -s';
  const command2 = 'echo "Hello, Sakura."';
  const count = Math.floor(interpolate(frame, [2.2 * fps, 3 * fps], [0, command.length], clamp));
  const count2 = Math.floor(interpolate(frame, [4.05 * fps, 5.1 * fps], [0, command2.length], clamp));
  return <Paper style={style}>
    <Reveal delay={0.1} style={{position: 'absolute', left: 106, top: 121}}><Eyebrow number="01">基础终端</Eyebrow><h1 style={{fontFamily: font.serif, fontSize: 84, fontWeight: 600, margin: '18px 0 0'}}>从一个终端开始</h1></Reveal>
    <Reveal delay={0.45} style={{position: 'absolute', left: 110, top: 284, display: 'flex', gap: 32, color: colors.muted, fontSize: 32}}><span>Alpine 实例</span><span style={{color: '#c5b6c6'}}>/</span><span>持久磁盘</span><span style={{color: '#c5b6c6'}}>/</span><span>浏览器终端</span></Reveal>
    <MockLabel style={{position: 'absolute', right: 114, top: 288}} />
    <div style={{position: 'absolute', left: 110, top: 366, width: 1700, height: 535, display: 'flex', overflow: 'hidden', border: `1px solid ${colors.line}`, borderRadius: 24, background: '#fff', boxShadow: '0 28px 80px #3b203218',
      opacity: interpolate(frame, [0.5 * fps, 1.2 * fps], [0, 1], {...clamp, easing: ease}),
      translate: `0px ${interpolate(frame, [0.5 * fps, 1.5 * fps], [55, 0], {...clamp, easing: ease})}px`} }>
      <div style={{width: 344, background: colors.soft, padding: '30px 24px', flexShrink: 0}}>
        <Brand size={39} /><div style={{fontSize: 24, color: colors.muted, margin: '35px 0 17px 4px'}}>工作空间</div>
        <div style={{background: '#fff', border: '1px solid #dab2c6', borderRadius: 15, padding: '21px 20px'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 15, fontSize: 30, fontWeight: 600}}><Icon type="terminal" size={31} color={colors.accent} /> Alpine</div>
          <div style={{display: 'flex', alignItems: 'center', gap: 9, marginTop: 17, fontSize: 23, color: started && !stopped ? colors.green : colors.muted}}><span style={{width: 8, height: 8, borderRadius: 4, background: started && !stopped ? colors.green : '#b19cb5'}} />{started ? stopped ? '已停止' : '运行中' : '创建中'}</div>
          <div style={{marginTop: 23, paddingTop: 19, borderTop: `1px solid ${colors.line}`, color: colors.muted, fontSize: 21, display: 'flex', gap: 10, alignItems: 'center'}}><Icon type="disk" size={22} />持久磁盘 · 8 GiB</div>
        </div>
        <div style={{marginTop: 23, display: 'flex', gap: 12}}><div style={{padding: '10px 25px', color: stopped ? '#fff' : colors.muted, background: stopped ? colors.accent : '#ebe3ed', borderRadius: 8, fontSize: 23}}>启动</div><div style={{padding: '10px 25px', border: `1px solid ${colors.line}`, background: '#fff', borderRadius: 8, fontSize: 23, color: colors.muted}}>停止</div></div>
      </div>
      <div style={{flex: 1, padding: '23px 25px 25px', minWidth: 0}}>
        <div style={{height: 54, display: 'flex', gap: 34, alignItems: 'flex-start', fontSize: 26}}><span style={{color: colors.accent, borderBottom: `3px solid ${colors.accent}`, paddingBottom: 14}}>终端</span><span style={{color: colors.muted}}>配置</span><span style={{marginLeft: 'auto', fontSize: 21, color: colors.muted}}>Alpine / 本地实例</span></div>
        <div style={{height: 419, background: colors.terminal, borderRadius: 12, overflow: 'hidden'}}>
          <div style={{height: 43, display: 'flex', alignItems: 'center', gap: 9, padding: '0 22px', background: colors.terminalChrome, color: '#b7a5bd', fontSize: 18}}><span style={{width: 9, height: 9, borderRadius: 6, background: '#bf7598'}}/><span style={{width: 9, height: 9, borderRadius: 6, background: '#cfb487'}}/><span style={{width: 9, height: 9, borderRadius: 6, background: '#83a591'}}/><span style={{marginLeft: 17}}>Alpine · shell</span></div>
          <div style={{padding: '24px 30px', fontFamily: font.mono, fontSize: 31, lineHeight: 1.65, color: colors.terminalInk, fontVariantLigatures: 'none'}}>
            <div style={{color: '#bea9c8', opacity: started ? 1 : 0}}>Welcome to Alpine Linux</div>
            <div style={{opacity: frame >= 2.2 * fps ? 1 : 0}}><span style={{color: '#d791b4'}}>alpine:~# </span>{command.slice(0, count)}{frame < 3 * fps && <span style={{background: '#e8c6d8', width: 15, height: 33, display: 'inline-block', verticalAlign: '-5px'}} />}</div>
            <div style={{opacity: frame > 3.2 * fps ? 1 : 0, color: '#acc5b1'}}>Linux</div>
            <div style={{opacity: frame >= 4.05 * fps ? 1 : 0}}><span style={{color: '#d791b4'}}>alpine:~# </span>{command2.slice(0, count2)}</div>
            <div style={{opacity: frame > 5.25 * fps ? 1 : 0}}>Hello, Sakura.</div>
            <div style={{opacity: frame > 5.5 * fps ? 1 : 0}}><span style={{color: '#d791b4'}}>alpine:~# </span><span style={{background: '#e8c6d8', width: 15, height: 33, display: 'inline-block', verticalAlign: '-5px', opacity: frame % fps < fps * 0.6 ? 1 : 0}} /></div>
          </div>
        </div>
      </div>
    </div>
  </Paper>;
};
export const TerminalScene = Interactive.withSchema({Component: TerminalInner, componentName: '<TerminalScene>', schema: {}, wrapInSequence: true});
