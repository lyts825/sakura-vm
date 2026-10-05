import {Interactive, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Brand, clamp, ease, Eyebrow, Icon, MockLabel, Paper, Reveal} from '../components';
import {colors, font} from '../theme';

const WorkflowInner: React.FC<{style?: React.CSSProperties}> = ({style}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const run = 'python hello.py';
  const count = Math.floor(interpolate(frame, [3.9 * fps, 5.25 * fps], [0, run.length], clamp));
  return <Paper style={style}>
    <Reveal delay={0.1} style={{position: 'absolute', left: 108, top: 121}}><Eyebrow number="04">本地工作流</Eyebrow><h1 style={{fontFamily: font.serif, fontSize: 76, fontWeight: 600, margin: '22px 0 0'}}>代码、文件、终端，连成工作流</h1></Reveal>
    <Reveal delay={0.55} style={{position: 'absolute', left: 111, top: 286, color: colors.accent, fontSize: 33}}>启用相关插件后</Reveal>
    <MockLabel style={{position: 'absolute', right: 113, top: 289}} />
    <div style={{position: 'absolute', left: 107, top: 358, width: 1706, height: 550, overflow: 'hidden', background: '#fff', border: `1px solid ${colors.line}`, borderRadius: 24, boxShadow: '0 30px 90px #3b203215',
      opacity: interpolate(frame, [0.55 * fps, 1.1 * fps], [0, 1], {...clamp, easing: ease}),
      scale: interpolate(frame, [0.55 * fps, 1.5 * fps], [0.95, 1], {...clamp, easing: ease, output: 'perceptual-scale'})}}>
      <div style={{height: 69, padding: '0 29px', borderBottom: `1px solid ${colors.line}`, display: 'flex', alignItems: 'center', gap: 32}}><Brand size={32} /><div style={{height: 28, width: 1, background: colors.line}}/><span style={{fontSize: 25}}>demo-project</span><div style={{display: 'flex', alignItems: 'center', gap: 12, fontSize: 21, color: colors.muted}}><Icon type="branch" size={23}/>main</div><div style={{marginLeft: 'auto', fontSize: 21, color: colors.green, display: 'flex', gap: 10, alignItems: 'center'}}><span style={{width: 8, height: 8, borderRadius: 9, background: colors.green}}/>Alpine 运行中</div></div>
      <div style={{display: 'flex', height: 481}}>
        <div style={{width: 293, flexShrink: 0, background: colors.soft, padding: '22px 18px'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 12, fontSize: 25, padding: '0 14px 24px'}}><Icon type="folder" size={27} color={colors.accent}/>文件</div>
          <div style={{fontSize: 23, padding: '13px 14px', color: colors.muted}}>⌄ demo-project</div>
          <div style={{marginLeft: 15, fontSize: 24, padding: '13px 14px', background: frame >= 1.7 * fps ? '#fff' : 'transparent', color: frame >= 1.7 * fps ? colors.accent : colors.ink, borderRadius: 9, display: 'flex', alignItems: 'center', gap: 11}}><Icon type="code" size={23}/>hello.py</div>
          <div style={{fontSize: 23, padding: '14px 29px', color: colors.muted}}>README.md</div>
          <div style={{position: 'absolute', left: 33, bottom: 32, color: colors.muted, fontSize: 21}}>本地项目工作空间</div>
        </div>
        <div style={{width: 878, flexShrink: 0, borderRight: `1px solid ${colors.line}`}}>
          <div style={{height: 55, background: '#fcfafc', display: 'flex', alignItems: 'center', padding: '0 24px', fontSize: 24, color: colors.accent, borderBottom: `1px solid ${colors.line}`}}><Icon type="code" size={25}/> <span style={{marginLeft: 12}}>hello.py</span><span style={{marginLeft: 'auto', fontSize: 19, color: colors.muted}}>Python</span></div>
          <div style={{position: 'relative', padding: '32px 28px', fontFamily: font.mono, fontSize: 29, lineHeight: 1.9, opacity: interpolate(frame, [1.7 * fps, 2.3 * fps], [0, 1], {...clamp, easing: ease})}}>
            <div><span style={{display: 'inline-block', width: 53, color: '#b6a5ba'}}>1</span><span style={{color: colors.accent}}>from</span> pathlib <span style={{color: colors.accent}}>import</span> Path</div>
            <div><span style={{display: 'inline-block', width: 53, color: '#b6a5ba'}}>2</span></div>
            <div><span style={{display: 'inline-block', width: 53, color: '#b6a5ba'}}>3</span>workspace = Path(<span style={{color: colors.green}}>"."</span>)</div>
            <div style={{background: frame > 3.25 * fps ? colors.blush : 'transparent', borderRadius: 7}}><span style={{display: 'inline-block', width: 53, color: '#b6a5ba'}}>4</span><span style={{color: '#8b579a'}}>print</span>(<span style={{color: colors.green}}>"Hello, Sakura."</span>)</div>
            <div><span style={{display: 'inline-block', width: 53, color: '#b6a5ba'}}>5</span></div>
          </div>
          <div style={{position: 'absolute', left: 317, bottom: 27, display: 'flex', gap: 10, alignItems: 'center', fontSize: 21, color: colors.green}}><Icon type="check" size={23}/>已保存</div>
        </div>
        <div style={{flex: 1, background: colors.terminal, color: colors.terminalInk}}>
          <div style={{height: 55, display: 'flex', alignItems: 'center', gap: 13, padding: '0 25px', background: colors.terminalChrome, fontSize: 24, color: '#d5c8d9'}}><Icon type="terminal" size={26}/>终端</div>
          <div style={{padding: '31px 25px', fontFamily: font.mono, fontSize: 26, lineHeight: 1.95}}><div style={{color: '#b7a5bd', fontSize: 22}}>~/demo-project</div><div style={{marginTop: 20}}><span style={{color: '#d791b4'}}>$ </span>{run.slice(0, count)}<span style={{display: frame < 5.25 * fps && frame % 30 < 19 ? 'inline-block' : 'none', width: 13, height: 26, background: '#e8c6d8', verticalAlign: '-4px'}}/></div><div style={{opacity: frame > 5.6 * fps ? 1 : 0, color: '#cadacb'}}>Hello, Sakura.</div><div style={{opacity: frame > 6 * fps ? 1 : 0, color: '#d791b4'}}>$ <span style={{display: 'inline-block', width: 13, height: 26, background: '#e8c6d8', verticalAlign: '-4px', opacity: frame % fps < fps * 0.6 ? 1 : 0}}/></div></div>
          <div style={{position: 'absolute', right: 27, bottom: 27, fontFamily: font.sans, fontSize: 21, color: '#b7a5bd'}}>文件 → 代码 → 运行</div>
        </div>
      </div>
    </div>
  </Paper>;
};
export const WorkflowScene = Interactive.withSchema({Component: WorkflowInner, componentName: '<WorkflowScene>', schema: {}, wrapInSequence: true});
