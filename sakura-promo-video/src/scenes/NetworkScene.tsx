import {Interactive, interpolate} from 'remotion';
import {clamp, Icon} from '../components';
import {Chapter, FlowArrow, ScenePaper, type SceneProps, SoftFocus, Status, Tag, Terminal, Typed, useScene, Window} from '../stage';
import {colors, font} from '../theme';

const ServiceNode = ({name, subtitle, active}: {name: string; subtitle: string; active: boolean}) => <div style={{width: 198, border: `1px solid ${active ? '#afc4b8' : colors.line}`, padding: '12px 18px', borderRadius: 12, background: active ? colors.greenSoft : '#fff'}}><div style={{fontSize: 25, fontWeight: 600}}>{name}</div><div style={{fontSize: 18, color: colors.muted, marginTop: 8}}>{subtitle}</div><div style={{fontSize: 17, marginTop: 8, color: active ? colors.green : colors.muted}}>{active ? '就绪检查通过' : '等待依赖'}</div></div>;
const NetworkInner: React.FC<SceneProps> = ({style}) => {
  const {seconds, cue} = useScene('network');
  const ready = seconds > cue(0) + 2;
  const database = seconds > cue(1) + 0.1;
  const api = seconds > cue(1) + 0.8;
  const web = seconds > cue(1) + 1.5;
  return <ScenePaper id="network" style={style}>
    <Chapter id="network" number="08" tag="网络与服务" detail="TCP 端口转发 · 多服务启动依赖与健康检查 — 需启用相关插件" optional/>
    <Window title="项目服务 / 本机预览">
      <div style={{display: 'flex', height: 480}}>
        <div style={{width: 610, padding: '28px 27px', background: '#fcfafc', borderRight: `1px solid ${colors.line}`}}><div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 22}}><Tag>Linux Web 服务</Tag><Status active={ready}>{ready ? '服务已就绪' : '启动中'}</Status></div><Terminal title="demo-project / web" style={{height: 235}}><div><span style={{color: '#d791b4'}}>$ </span><Typed text="npm run dev" start={cue(0) + 0.4}/></div><div style={{opacity: ready ? 1 : 0, color: '#acc5b1', fontSize: 25}}>Listening on 0.0.0.0:3000</div><div style={{opacity: ready ? 1 : 0, color: '#b7a5bd', fontSize: 22}}>service: web · log: web.log</div></Terminal><div style={{display: 'flex', alignItems: 'center', marginTop: 23, gap: 18, fontSize: 25, color: colors.muted}}><span style={{fontFamily: font.mono}}>TCP :3000</span><FlowArrow/><span style={{fontFamily: font.mono}}>本机 :8080</span></div></div>
        <div style={{flex: 1, padding: '24px 25px'}}>
          <div style={{height: 177, borderRadius: 12, border: `1px solid ${colors.line}`, overflow: 'hidden', background: '#faf7f9'}}><div style={{height: 40, display: 'flex', alignItems: 'center', padding: '0 19px', gap: 14, background: colors.soft}}><span style={{color: colors.muted, fontSize: 18}}>● ● ●</span><span style={{fontFamily: font.mono, fontSize: 18, padding: '3px 19px', background: '#fff', borderRadius: 7, color: colors.muted}}>http://127.0.0.1:8080</span><span style={{marginLeft: 'auto', fontSize: 18, color: colors.muted}}>浏览器预览示意</span></div><div style={{padding: '22px 30px', opacity: interpolate(seconds, [cue(0) + 2, cue(0) + 2.7], [0, 1], clamp)}}><div style={{fontFamily: font.serif, fontSize: 44}}>Hello, Sakura.</div><div style={{fontSize: 24, color: colors.muted, marginTop: 15}}>从本机，访问你的 Linux 服务。</div></div></div>
          <SoftFocus at={cue(1)} style={{marginTop: 18}}><div style={{fontSize: 22, color: colors.muted, marginBottom: 10}}>按依赖启动 · 日志分别保留</div><div style={{display: 'flex', alignItems: 'center', gap: 15}}><ServiceNode name="数据库" subtitle="database" active={database}/><FlowArrow style={{fontSize: 34}}/><ServiceNode name="API" subtitle="backend" active={api}/><FlowArrow style={{fontSize: 34}}/><ServiceNode name="网页" subtitle="frontend" active={web}/></div></SoftFocus>
          <SoftFocus at={cue(2)} style={{display: 'flex', alignItems: 'center', gap: 13, marginTop: 17, color: colors.accent, fontSize: 22}}><Icon type="code" size={25}/>VS Code Remote-SSH <span style={{color: colors.muted}}>· Debian / Ubuntu，满足环境条件后接入</span></SoftFocus>
        </div>
      </div>
    </Window>
  </ScenePaper>;
};
export const NetworkScene = Interactive.withSchema({Component: NetworkInner, componentName: '<NetworkScene>', schema: {}, wrapInSequence: true});
