/** 运行边界章节，将项目账户和目录隔离的 Manim 片段与说明文本按旁白 cue 对齐。
 * Align project-account/IDMAP isolation diagrams and boundary explanations with narration cues. */
import {Interactive} from 'remotion';
import {Icon} from '../components';
import {Chapter, ScenePaper, type SceneProps, SoftFocus, Tag, useScene} from '../stage';
import {colors} from '../theme';
import {ManimClip} from './KernelScene';

/** 按 cue 显现本机入口、项目 UID/Home 与可选沙箱边界，组合预渲染项目隔离图解解释运行权限。
 * Reveal local entry points, project UID/Home and optional sandbox boundaries at cues, using the prerendered isolation diagram to explain execution authority. */
const IsolationInner: React.FC<SceneProps> = ({style}) => {
  const {cue} = useScene('isolation');
  return <ScenePaper id="isolation" style={style}>
    <Chapter id="isolation" number="10" tag="运行边界" detail="本机管理入口 · 项目账号与主目录 · 可选沙箱"/>
    <div style={{position: 'absolute', left: 110, top: 377, width: 500}}>
      <SoftFocus at={cue(0)}><Tag>本机控制</Tag><div style={{fontSize: 30, lineHeight: 1.55, marginTop: 18}}>回环监听<br/>随机访问凭证</div></SoftFocus>
      <SoftFocus at={cue(1)} style={{marginTop: 20}}><Tag>项目账号</Tag><div style={{fontSize: 29, lineHeight: 1.55, marginTop: 18}}>独立 UID / GID 与 Home<br/>命令、进程按项目归属</div></SoftFocus>
      <SoftFocus at={cue(2)} style={{marginTop: 20, padding: '14px 22px', border: '1px solid #dab2c6', borderRadius: 14, background: colors.blush}}><div style={{fontSize: 27, color: colors.accent, display: 'flex', gap: 11, alignItems: 'center'}}><Icon type="grid" size={29}/>沙箱插件 · 独立虚拟机</div><div style={{fontSize: 24, lineHeight: 1.55, marginTop: 12}}>默认隔离网络 · 资源配额<br/>到期停止或清理</div></SoftFocus>
    </div>
    <div style={{position: 'absolute', left: 645, top: 353, width: 1170, height: 550, border: `1px solid ${colors.line}`, borderRadius: 22, overflow: 'hidden'}}><div style={{position: 'absolute', width: 1170, height: 658.125, top: -54}}><ManimClip src="manim/project-isolation.mp4" seconds={10}/></div></div>
  </ScenePaper>;
};
export const IsolationScene = Interactive.withSchema({Component: IsolationInner, componentName: '<IsolationScene>', schema: {}, wrapInSequence: true});
