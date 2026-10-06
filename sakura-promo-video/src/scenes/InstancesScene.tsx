import {Interactive, interpolate} from 'remotion';
import {clamp, Icon} from '../components';
import {Badge, Button, Chapter, ScenePaper, type SceneProps, SoftFocus, Status, StepStrip, Tag, Terminal, Typed, useScene, Window} from '../stage';
import {colors, font} from '../theme';

const InstancesInner: React.FC<SceneProps> = ({style}) => {
  const {seconds, cue} = useScene('instances');
  const boot = seconds > cue(0) + 1.3;
  const terminal = seconds > cue(0) + 2.7;
  const resource = seconds >= cue(2);
  return <ScenePaper id="instances" style={style}>
    <Chapter id="instances" number="03" tag="基础实例" detail="Alpine 基础版 · 创建 / 启停 / 单终端"/>
    <Window title="工作空间 / Alpine">
      <div style={{display: 'flex', height: 480}}>
        <div style={{width: 330, padding: '27px 24px', background: colors.soft, flexShrink: 0}}>
          <div style={{fontSize: 25, color: colors.muted, marginBottom: 21}}>本地实例</div>
          <div style={{background: '#fff', border: '1px solid #dab2c6', padding: '18px 20px', borderRadius: 14}}><div style={{fontSize: 31, fontWeight: 600, display: 'flex', gap: 14, alignItems: 'center'}}><Icon type="terminal" size={30} color={colors.accent}/>Alpine</div><div style={{marginTop: 18}}><Status active={terminal}>{terminal ? '运行中' : boot ? '启动中' : '已停止'}</Status></div><div style={{fontSize: 23, color: colors.muted, marginTop: 21, borderTop: `1px solid ${colors.line}`, paddingTop: 19, display: 'flex', gap: 10, alignItems: 'center'}}><Icon type="disk" size={24}/>8 GiB 持久磁盘</div></div>
          <div style={{display: 'flex', gap: 11, marginTop: 20}}><Button muted={boot}>启动</Button><Button muted>停止</Button></div>
          <div style={{fontSize: 21, color: colors.muted, marginTop: 22, lineHeight: 1.6}}>每个实例<br/>保留自己的 QCOW2 磁盘</div>
        </div>
        <div style={{width: 900, padding: '24px 26px', borderRight: `1px solid ${colors.line}`}}>
          <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 21}}><StepStrip steps={['创建实例', '启动', '打开终端']} current={terminal ? 2 : boot ? 1 : 0}/><span style={{fontSize: 20, color: colors.muted}}>过程示意</span></div>
          <Terminal title={terminal ? 'Alpine · shell' : 'Alpine · 启动日志'} style={{height: 331}}>
            {!terminal ? <><div style={{color: '#b7a5bd'}}>Preparing local instance...</div><div style={{opacity: boot ? 1 : 0}}>Booting Linux kernel</div><div style={{opacity: seconds > cue(0) + 2 ? 1 : 0, color: '#acc5b1'}}>Connecting to Alpine...</div></> : <><div style={{color: '#b7a5bd'}}>Welcome to Alpine Linux</div><div><span style={{color: '#d791b4'}}>alpine:~$ </span><Typed text="uname -s" start={cue(0) + 3} duration={0.85}/></div><div style={{opacity: seconds > cue(0) + 4 ? 1 : 0, color: '#acc5b1'}}>Linux</div><div style={{opacity: seconds > cue(1) ? 1 : 0}}><span style={{color: '#d791b4'}}>alpine:~$ </span><Typed text="ls /home" start={cue(1)} duration={0.7}/></div><div style={{opacity: seconds > cue(1) + 0.9 ? 1 : 0}}>workspace</div></>}
          </Terminal>
        </div>
        <div style={{flex: 1, padding: '28px 26px', background: '#fcfafc'}}><div style={{fontSize: 26, fontWeight: 600}}>按需配置</div>
          <div style={{marginTop: 18, display: 'flex', gap: 10}}><Badge active={resource}>CPU</Badge><Badge active={resource}>内存</Badge></div>
          <div style={{fontSize: 21, color: colors.muted, marginTop: 15}}>停机后修改资源配置</div>
          <div style={{height: 1, background: colors.line, margin: '22px 0'}}/>
          <SoftFocus at={cue(2)}><Tag>镜像插件</Tag><div style={{fontFamily: font.serif, fontSize: 32, marginTop: 19}}>Debian 12</div><div style={{fontFamily: font.serif, fontSize: 32, marginTop: 12}}>Ubuntu 24.04</div><div style={{fontSize: 20, color: colors.muted, marginTop: 14, opacity: interpolate(seconds, [cue(2), cue(2) + 0.5], [0, 1], clamp)}}>启用插件后可选择</div></SoftFocus>
        </div>
      </div>
    </Window>
  </ScenePaper>;
};
export const InstancesScene = Interactive.withSchema({Component: InstancesInner, componentName: '<InstancesScene>', schema: {}, wrapInSequence: true});
