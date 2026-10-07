/** 自动化章节的 UI 示意，按旁白 cue 展示命令预设、任务执行和维护状态。 */
import {Interactive, interpolate} from 'remotion';
import {clamp, Icon} from '../components';
import {Chapter, ScenePaper, type SceneProps, SoftFocus, Status, Tag, useScene, Window} from '../stage';
import {colors, font} from '../theme';

const ResourceChart = () => {
  const {seconds, duration} = useScene('automation');
  const length = interpolate(seconds, [1, duration - 1], [0, 925], clamp);
  return <svg viewBox="0 0 850 185" width="100%" height="150" preserveAspectRatio="none"><defs><clipPath id="chart-reveal"><rect width={length} height="185"/></clipPath></defs><g stroke="#e8dfe7" strokeWidth="1"><path d="M20 30H830M20 75H830M20 120H830M20 165H830"/></g><g clipPath="url(#chart-reveal)"><path d="M20 139C65 135 85 120 124 127S190 154 220 130S265 63 306 84S365 126 404 92S445 28 486 58S540 127 580 96S642 115 682 83S761 99 830 61" fill="none" stroke="#ad416f" strokeWidth="3.5"/><path d="M20 153C111 149 138 141 224 146S335 128 423 136S541 120 620 129S723 118 830 109" fill="none" stroke="#77a38c" strokeWidth="3"/></g></svg>;
};
const TaskRow = ({title, state, time, active}: {title: string; state: string; time: string; active?: boolean}) => <div style={{height: 58, display: 'flex', alignItems: 'center', gap: 14, padding: '0 17px', borderBottom: `1px solid ${colors.line}`, background: active ? colors.blush : '#fff'}}><Icon type={state === '已完成' ? 'check' : 'terminal'} size={23} color={state === '已完成' ? colors.green : colors.accent}/><span style={{fontSize: 22, flex: 1}}>{title}</span><span style={{fontSize: 19, color: colors.muted}}>{time}</span><span style={{fontSize: 20, color: state === '已完成' ? colors.green : colors.accent}}>{state}</span></div>;
const AutomationInner: React.FC<SceneProps> = ({style}) => {
  const {seconds, cue} = useScene('automation');
  const run = seconds > cue(0) + 1.4;
  const complete = seconds > cue(1) + 1.8;
  const diagnose = seconds > cue(2);
  return <ScenePaper id="automation" style={style}>
    <Chapter id="automation" number="09" tag="自动化与维护" detail="计划启停 · 资源监控 · 任务日志 · 故障诊断 — 需启用相关插件" optional/>
    <Window title="任务与监控">
      <div style={{display: 'flex', height: 480}}>
        <div style={{width: 410, padding: '29px 26px', background: colors.soft, borderRight: `1px solid ${colors.line}`}}><div style={{fontSize: 29, fontWeight: 600}}>计划与规则</div><div style={{marginTop: 27, padding: '21px 22px', borderRadius: 13, border: `1px solid ${run ? '#dab2c6' : colors.line}`, background: '#fff'}}><Tag>工作日 · 09:00</Tag><div style={{fontFamily: font.serif, fontSize: 35, marginTop: 22}}>启动开发实例</div><div style={{marginTop: 19}}><Status active={run}>{complete ? '已完成' : run ? '任务已触发' : '等待计划'}</Status></div></div><div style={{fontSize: 25, marginTop: 29, display: 'flex', gap: 12, alignItems: 'center'}}><Icon type="power" size={26} color={colors.accent}/>空闲停止</div><div style={{fontSize: 22, color: colors.muted, lineHeight: 1.6, marginTop: 17}}>按规则停止闲置实例<br/>使用相关调度服务</div></div>
        <div style={{width: 910, padding: '24px 27px', borderRight: `1px solid ${colors.line}`}}><div style={{display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8}}><span style={{fontSize: 27, fontWeight: 600}}>资源历史</span><span style={{fontSize: 20, color: colors.accent}}>CPU</span><span style={{fontSize: 20, color: '#77a38c'}}>内存</span><span style={{marginLeft: 'auto', fontSize: 19, color: colors.muted}}>曲线与数值示意</span></div><ResourceChart/><div style={{display: 'flex', justifyContent: 'space-between', margin: '9px 0 12px', fontSize: 23}}><span>统一任务日志</span><span style={{fontSize: 20, color: colors.muted}}>取消 / 重试</span></div><div style={{border: `1px solid ${colors.line}`, borderRadius: 11, overflow: 'hidden'}}><TaskRow title="计划启动 / demo-project" state={complete ? '已完成' : run ? '运行中' : '待执行'} time="09:00" active={run && !complete}/><TaskRow title="资源采样" state="已完成" time="09:01"/><TaskRow title="服务诊断" state={diagnose ? '报告已生成' : '待执行'} time="09:02" active={diagnose}/></div></div>
        <div style={{flex: 1, padding: '25px 25px', background: '#fcfafc'}}><div style={{fontSize: 28, fontWeight: 600}}>故障诊断</div><div style={{fontSize: 23, color: colors.muted, lineHeight: 1.5, marginTop: 20}}>查看失败阶段<br/>定位关联日志<br/>导出脱敏报告</div><SoftFocus at={cue(2)} style={{marginTop: 24, padding: '17px 18px', background: colors.blush, borderRadius: 13}}><div style={{display: 'flex', gap: 10, alignItems: 'center', color: colors.accent, fontSize: 24}}><Icon type="snapshot" size={27}/>诊断报告</div><div style={{fontSize: 21, color: colors.muted, lineHeight: 1.55, marginTop: 14}}>服务连接异常<br/>查看详细检查结果</div></SoftFocus><div style={{fontSize: 19, color: colors.muted, lineHeight: 1.45, marginTop: 18}}>从失败阶段<br/>追查原因</div></div>
      </div>
    </Window>
  </ScenePaper>;
};
export const AutomationScene = Interactive.withSchema({Component: AutomationInner, componentName: '<AutomationScene>', schema: {}, wrapInSequence: true});
