/** 实验性桌面章节示意，展示桌面会话与应用入口并保留环境条件提示。
 * Illustrate experimental desktop sessions/application entries while preserving environment/plugin conditions. */
import {Interactive, interpolate} from 'remotion';
import {clamp, Icon} from '../components';
import {Chapter, ScenePaper, type SceneProps, SoftFocus, Tag, Terminal, Typed, useScene, Window} from '../stage';
import {colors, font} from '../theme';

/** 按桌面章节的旁白时间展示实验性 KDE/VNC 桌面与应用演示，并明确标示桌面插件依赖。
 * Illustrate experimental KDE/VNC desktop and applications at narration cues, explicitly labeling the desktop-plugin requirement. */
const DesktopInner: React.FC<SceneProps> = ({style}) => {
  const {seconds, cue} = useScene('desktop');
  return <ScenePaper id="desktop" style={style}>
    <Chapter id="desktop" number="11" tag="实验性桌面" detail="KDE Plasma · 浏览器 VNC 连接 — 需启用桌面插件" optional/>
    <Window title="桌面 / 浏览器 VNC">
      <div style={{display: 'flex', height: 480}}>
        <div style={{width: 1220, height: 480, background: '#e9dfe9', position: 'relative', padding: '28px 31px', overflow: 'hidden'}}>
          <div style={{position: 'absolute', right: 32, top: 22}}><Tag>实验性 · 桌面示意</Tag></div><div style={{position: 'absolute', left: 0, right: 0, top: 172, height: 190, borderTop: '1px solid #d7c7d5', borderBottom: '1px solid #dfd0dc', rotate: '-9deg', background: '#f3ebf1'}}/>
          <div style={{position: 'absolute', left: 39, top: 83, width: 643, height: 289, border: '1px solid #cfc0ce', borderRadius: 11, background: '#fff', overflow: 'hidden', boxShadow: '0 15px 38px #3b203212', translate: `0px ${interpolate(seconds, [0.7, 1.6], [24, 0], clamp)}px`}}><div style={{height: 42, background: '#f7f2f6', display: 'flex', alignItems: 'center', padding: '0 18px', gap: 15, color: colors.muted, fontSize: 20}}><Icon type="folder" size={22}/>文件管理器<span style={{marginLeft: 'auto'}}>− □ ×</span></div><div style={{display: 'flex', height: 247}}><div style={{width: 146, padding: '21px 15px', background: colors.soft, fontSize: 20, lineHeight: 2.3, color: colors.muted}}>主目录<br/>文档<br/>下载<br/>项目</div><div style={{padding: '24px 27px', flex: 1}}><div style={{fontFamily: font.mono, fontSize: 18, color: colors.muted, marginBottom: 24}}>~/demo-project</div><div style={{display: 'flex', gap: 38, textAlign: 'center', fontSize: 19}}><div><Icon type="folder" size={48} color={colors.accent}/><div style={{marginTop: 10}}>src</div></div><div><Icon type="code" size={48} color={colors.accent}/><div style={{marginTop: 10}}>app.py</div></div><div><Icon type="folder" size={48} color={colors.accent}/><div style={{marginTop: 10}}>assets</div></div></div></div></div></div>
          <div style={{position: 'absolute', left: 609, top: 178, width: 531, opacity: interpolate(seconds, [1.7, 2.4], [0, 1], clamp), translate: `0px ${interpolate(seconds, [1.7, 2.4], [21, 0], clamp)}px`}}><Terminal title="Konsole · shell" style={{height: 235, boxShadow: '0 17px 46px #3b20321a'}}><div style={{fontSize: 22, color: '#b7a5bd'}}>~/demo-project</div><div style={{fontSize: 25}}><span style={{color: '#d791b4'}}>$ </span><Typed text="echo Sakura" start={2.6}/></div><div style={{fontSize: 25, opacity: seconds > 3.8 ? 1 : 0}}>Sakura</div></Terminal></div>
          <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 41, background: '#f7f2f6e8', borderTop: '1px solid #d7c7d5', display: 'flex', alignItems: 'center', gap: 19, padding: '0 22px', color: colors.accent}}><Icon type="grid" size={26}/><Icon type="folder" size={24}/><Icon type="terminal" size={24}/><span style={{marginLeft: 'auto', fontSize: 18, color: colors.muted}}>KDE Plasma</span></div>
        </div>
        <div style={{flex: 1, padding: '27px 30px', background: '#fcfafc', borderLeft: `1px solid ${colors.line}`}}><Tag>按需尝试</Tag><div style={{fontFamily: font.serif, fontSize: 36, lineHeight: 1.3, marginTop: 22}}>浏览器连接<br/>完整 Linux 桌面</div><SoftFocus at={cue(1)} style={{marginTop: 26}}><div style={{fontSize: 25, lineHeight: 1.7, color: colors.muted}}>首次安装需联网<br/>建议 2 GiB 内存<br/>网页无独立音频流</div><div style={{fontSize: 20, color: colors.muted, marginTop: 18, lineHeight: 1.45}}>实验性能力<br/>不提供 WSLg 单应用窗口集成</div></SoftFocus></div>
      </div>
    </Window>
  </ScenePaper>;
};
export const DesktopScene = Interactive.withSchema({Component: DesktopInner, componentName: '<DesktopScene>', schema: {}, wrapInSequence: true});
