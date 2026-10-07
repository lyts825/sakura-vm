/** 恢复章节示意，对齐快照、克隆、备份说明与 Manim 流程，并保留停机前提。 */
import {Interactive} from 'remotion';
import {Icon} from '../components';
import {Chapter, ScenePaper, type SceneProps, SoftFocus, Tag, useScene} from '../stage';
import {colors} from '../theme';
import {ManimClip} from './KernelScene';

const RecoveryInner: React.FC<SceneProps> = ({style}) => {
  const {cue} = useScene('recovery');
  return <ScenePaper id="recovery" style={style}>
    <Chapter id="recovery" number="07" tag="快照与备份" detail="先停止实例，再保存状态 — 需启用相关插件" optional/>
    <div style={{position: 'absolute', left: 108, top: 379, width: 515}}>
      <SoftFocus at={cue(0)}><Tag>停机快照</Tag><div style={{fontSize: 35, marginTop: 21, lineHeight: 1.5}}>恢复原实例的磁盘状态</div></SoftFocus>
      <SoftFocus at={cue(1)} style={{marginTop: 35}}><Tag>独立克隆</Tag><div style={{fontSize: 35, marginTop: 21, lineHeight: 1.5}}>创建另一套独立环境</div></SoftFocus>
      <SoftFocus at={cue(2)} style={{marginTop: 35}}><Tag>定时备份</Tag><div style={{fontSize: 30, marginTop: 20, lineHeight: 1.5}}>保留策略 · 完整性校验<br/>恢复为新实例</div></SoftFocus>
    </div>
    <div style={{position: 'absolute', left: 645, top: 353, width: 1170, height: 550, border: `1px solid ${colors.line}`, borderRadius: 22, overflow: 'hidden'}}><div style={{position: 'absolute', width: 1170, height: 658.125, top: -54}}><ManimClip src="manim/recovery-flow.mp4" seconds={10}/></div></div>
    <div style={{position: 'absolute', left: 114, top: 855, fontSize: 21, color: colors.muted, display: 'flex', gap: 10, alignItems: 'center'}}><Icon type="power" size={23}/>快照与备份要求实例已停止</div>
  </ScenePaper>;
};
export const RecoveryScene = Interactive.withSchema({Component: RecoveryInner, componentName: '<RecoveryScene>', schema: {}, wrapInSequence: true});
