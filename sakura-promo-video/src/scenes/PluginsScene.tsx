import {Interactive, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Brand, clamp, ease, Eyebrow, Icon, MockLabel, Paper, Reveal} from '../components';
import {colors, font} from '../theme';

const PluginRow = ({title, detail, icon, at}: {title: string; detail: string; icon: 'folder' | 'terminal' | 'branch' | 'snapshot'; at: number}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const selected = frame >= at * fps;
  return <div style={{display: 'flex', gap: 18, alignItems: 'center', height: 91, padding: '0 25px', borderRadius: 13,
    background: selected ? colors.blush : '#fff', border: `1px solid ${selected ? '#dab2c6' : colors.line}`,
    opacity: interpolate(frame, [(at - 1.2) * fps, (at - 0.7) * fps], [0, 1], {...clamp, easing: ease}),
    translate: `${interpolate(frame, [(at - 1.2) * fps, (at - 0.65) * fps], [30, 0], {...clamp, easing: ease})}px 0px`} }>
    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: 51, height: 51, color: colors.accent}}><Icon type={icon} size={39} /></div>
    <div style={{fontSize: 29, fontWeight: 600, width: 188}}>{title}</div>
    <div style={{fontSize: 24, color: colors.muted, flex: 1}}>{detail}</div>
    <div style={{width: 51, height: 29, borderRadius: 18, background: selected ? colors.accent : '#d7cad7', position: 'relative'}}>
      <span style={{position: 'absolute', top: 4, left: 4, width: 21, height: 21, borderRadius: 13, background: '#fff', translate: `${interpolate(frame, [at * fps, (at + 0.3) * fps], [0, 22], {...clamp, easing: ease})}px 0px`}} />
    </div>
  </div>;
};

const PluginsInner: React.FC<{style?: React.CSSProperties}> = ({style}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const selected = [1.8, 3.1, 4.4, 5.7].filter((at) => frame >= at * fps).length;
  const saved = frame > 7.5 * fps;
  return <Paper style={style}>
    <Reveal delay={0.1} style={{position: 'absolute', left: 108, top: 122}}><Eyebrow number="03">插件扩展</Eyebrow><h1 style={{fontFamily: font.serif, fontSize: 84, fontWeight: 600, margin: '18px 0 0'}}>让工具，按需生长</h1></Reveal>
    <Reveal delay={0.5} style={{position: 'absolute', left: 111, top: 283, fontSize: 33, color: colors.accent}}>可选插件 · 启用并重启后生效</Reveal>
    <MockLabel style={{position: 'absolute', right: 113, top: 289}} />
    <Reveal delay={0.55} style={{position: 'absolute', left: 108, top: 357, width: 1706, height: 550, display: 'flex', overflow: 'hidden', border: `1px solid ${colors.line}`, borderRadius: 24, background: '#fff', boxShadow: '0 28px 80px #3b203212'}}>
      <div style={{width: 292, background: colors.soft, padding: '29px 26px', flexShrink: 0}}>
        <Brand size={39} /><div style={{fontSize: 25, color: colors.muted, marginTop: 37, padding: '13px 18px'}}>工作空间</div>
        <div style={{fontSize: 25, color: colors.accent, background: '#fff', marginTop: 12, borderRadius: 12, padding: '15px 18px', display: 'flex', alignItems: 'center', gap: 13}}><Icon type="grid" size={26} />插件中心</div>
        <div style={{fontSize: 25, color: colors.muted, marginTop: 12, padding: '13px 18px'}}>系统设置</div>
        <div style={{marginTop: 39, padding: '24px 16px', borderTop: `1px solid ${colors.line}`}}><div style={{fontSize: 22, color: colors.muted}}>从基础版开始</div><div style={{fontFamily: font.serif, fontSize: 32, marginTop: 11}}>默认未启用</div></div>
      </div>
      <div style={{padding: '26px 27px', width: 931, borderRight: `1px solid ${colors.line}`}}>
        <div style={{fontSize: 29, fontWeight: 600, marginBottom: 23}}>选择需要的能力<span style={{fontSize: 21, color: colors.muted, marginLeft: 19, fontWeight: 400}}>示例选择</span></div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 13}}>
          <PluginRow title="文件" detail="浏览与管理实例文件" icon="folder" at={1.8} />
          <PluginRow title="多终端" detail="为不同任务保留独立终端" icon="terminal" at={3.1} />
          <PluginRow title="项目与 Git" detail="连接代码、项目与版本" icon="branch" at={4.4} />
          <PluginRow title="快照" detail="停机保存磁盘状态" icon="snapshot" at={5.7} />
        </div>
      </div>
      <div style={{flex: 1, padding: '33px 33px', background: '#fcfafc'}}>
        <div style={{fontSize: 25, color: colors.muted}}>当前选择</div><div style={{display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 10}}><span style={{fontFamily: font.serif, fontSize: 99, color: colors.accent, lineHeight: 1.3}}>{selected}</span><span style={{fontSize: 28, color: colors.muted}}>组能力</span></div>
        <div style={{fontSize: 26, color: colors.ink, lineHeight: 1.75, marginTop: 15}}>只装你需要的工具<br/>让工作空间自然展开</div>
        <div style={{marginTop: 27, padding: '15px 23px', textAlign: 'center', background: saved ? colors.green : colors.accent, color: '#fff', borderRadius: 12, fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 13}}>{saved && <Icon type="check" size={28} />}{saved ? '选择已保存' : '保存选择'}</div>
        <div style={{marginTop: 23, color: saved ? colors.accent : colors.muted, fontSize: 23, lineHeight: 1.65}}>{saved ? <>重新启动 Sakura 服务<br/>后，所选插件生效</> : <>选择保存后<br/>需要重新启动服务</>}</div>
      </div>
    </Reveal>
  </Paper>;
};
export const PluginsScene = Interactive.withSchema({Component: PluginsInner, componentName: '<PluginsScene>', schema: {}, wrapInSequence: true});
