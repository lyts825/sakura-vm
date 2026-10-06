import {Interactive} from 'remotion';
import {Icon} from '../components';
import {Badge, Chapter, ScenePaper, type SceneProps, SoftFocus, Terminal, Typed, useScene, Window} from '../stage';
import {colors, font} from '../theme';

const DevelopmentInner: React.FC<SceneProps> = ({style}) => {
  const {seconds, cue} = useScene('development');
  const edited = seconds > cue(1) + 1;
  const diff = seconds > cue(1) + 2.6;
  const run = seconds > cue(1) + 3.2;
  return <ScenePaper id="development" style={style}>
    <Chapter id="development" number="05" tag="开发工作台" detail="项目模板 · 编辑器 · Git · 多终端 — 需启用相关开发插件" optional/>
    <Window title="开发工作台 / demo-project">
      <div style={{height: 60, display: 'flex', alignItems: 'center', gap: 17, padding: '0 28px', borderBottom: `1px solid ${colors.line}`, background: '#fcfafc'}}><span style={{fontSize: 24, color: colors.muted, marginRight: 8}}>项目模板</span><Badge>Node.js</Badge><Badge active={seconds > cue(0) + 0.9}>Python</Badge><Badge>Rust</Badge><div style={{fontSize: 21, color: colors.muted, marginLeft: 'auto'}}>~/demo-project</div></div>
      <div style={{display: 'flex', height: 420}}>
        <div style={{width: 300, background: colors.soft, padding: '25px 20px'}}><div style={{fontSize: 24, color: colors.muted}}>项目文件</div><div style={{marginTop: 27, padding: '13px 14px', color: colors.accent, background: '#fff', borderRadius: 9, fontSize: 25, display: 'flex', gap: 12}}><Icon type="code" size={26}/>app.py</div><div style={{padding: '16px 14px', color: colors.muted, fontSize: 23}}>README.md</div><div style={{padding: '9px 14px', color: colors.muted, fontSize: 23}}>requirements.txt</div><div style={{marginTop: 63, display: 'flex', alignItems: 'center', gap: 11, color: colors.accent, fontSize: 24}}><Icon type="branch" size={25}/>main <span style={{color: colors.muted, fontSize: 20}}>· {edited ? '1 个改动' : '工作区干净'}</span></div></div>
        <div style={{width: 873, borderRight: `1px solid ${colors.line}`}}><div style={{height: 49, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 23, color: colors.accent, borderBottom: `1px solid ${colors.line}`}}><span>app.py</span><span style={{fontSize: 19, color: colors.muted}}>{edited ? '已保存' : 'Python'}</span></div>
          <div style={{fontFamily: font.mono, fontSize: 28, lineHeight: 1.95, padding: '24px 26px'}}><div><span style={{color: '#b6a5ba', marginRight: 25}}>1</span>message = <span style={{color: colors.green}}>"Hello, {edited ? 'Linux' : 'Sakura'}."</span></div><div><span style={{color: '#b6a5ba', marginRight: 25}}>2</span><span style={{color: '#8b579a'}}>print</span>(message)</div></div>
          <SoftFocus at={cue(1) + 2.6} style={{padding: '17px 25px', background: '#fcfafc', borderTop: `1px solid ${colors.line}`}}><div style={{display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, marginBottom: 15, color: colors.muted}}><Icon type="branch" size={24}/>Git 改动预览</div><div style={{fontFamily: font.mono, fontSize: 24, lineHeight: 1.8, opacity: diff ? 1 : 0}}><div style={{background: '#fbecef', color: '#a94e6b', paddingLeft: 14}}>− message = "Hello, Sakura."</div><div style={{background: '#edf5ef', color: colors.green, paddingLeft: 14}}>+ message = "Hello, Linux."</div></div></SoftFocus>
        </div>
        <div style={{flex: 1, padding: '13px 14px', background: '#fcfafc', display: 'flex', flexDirection: 'column', gap: 13}}>
          <Terminal title="运行 / Python" style={{height: 193}}><div style={{fontSize: 24, opacity: run ? 1 : 0}}><span style={{color: '#d791b4'}}>$ </span><Typed text="python app.py" start={cue(1) + 3.2}/></div><div style={{fontSize: 24, opacity: seconds > cue(1) + 4.4 ? 1 : 0, color: '#acc5b1'}}>Hello, Linux.</div></Terminal>
          <Terminal title="调试 / 独立终端" style={{height: 172}}><div style={{fontSize: 23, color: '#b7a5bd'}}>~/demo-project</div><div style={{fontSize: 23, opacity: seconds > cue(2) ? 1 : 0}}><span style={{color: '#d791b4'}}>$ </span><Typed text="git status --short" start={cue(2)}/></div></Terminal>
          <div style={{color: colors.muted, fontSize: 18, textAlign: 'right'}}>tmux 会话恢复需客户机已安装</div>
        </div>
      </div>
    </Window>
  </ScenePaper>;
};
export const DevelopmentScene = Interactive.withSchema({Component: DevelopmentInner, componentName: '<DevelopmentScene>', schema: {}, wrapInSequence: true});
