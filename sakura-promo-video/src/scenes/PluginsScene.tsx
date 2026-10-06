import {Interactive, interpolate} from 'remotion';
import {clamp, Icon} from '../components';
import {Button, Chapter, ScenePaper, type SceneProps, StepStrip, Tag, useScene, Window} from '../stage';
import {colors, font} from '../theme';

const Bundle = ({title, detail, icon, at, selected}: {title: string; detail: string; icon: 'folder' | 'code' | 'snapshot' | 'grid'; at: number; selected?: boolean}) => {
  const {seconds} = useScene('plugins');
  return <div style={{display: 'flex', alignItems: 'center', gap: 23, border: `1px solid ${selected ? '#dab2c6' : colors.line}`, borderRadius: 12, padding: '15px 22px', height: 79, background: selected ? colors.blush : '#fff',
    opacity: interpolate(seconds, [at, at + 0.55], [0, 1], clamp), translate: `${interpolate(seconds, [at, at + 0.55], [28, 0], clamp)}px 0px`}}><Icon type={icon} size={35} color={colors.accent}/><div style={{fontSize: 28, fontWeight: 600, width: 190}}>{title}</div><span style={{fontSize: 23, color: colors.muted, flex: 1}}>{detail}</span><div style={{borderRadius: 7, border: `1px solid ${selected ? colors.accent : '#d6c7d3'}`, background: selected ? colors.accent : '#fff', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff'}}>{selected && <Icon type="check" size={21}/>}</div></div>;
};
const PluginsInner: React.FC<SceneProps> = ({style}) => {
  const {seconds, cue} = useScene('plugins');
  const choose = seconds > cue(1) + 2;
  const save = seconds > cue(2) + 0.6;
  const restart = seconds > cue(2) + 2;
  return <ScenePaper id="plugins" style={style}>
    <Chapter id="plugins" number="04" tag="可选插件" detail="默认全部关闭 · 选择、保存并重启服务后生效" optional/>
    <Window title="插件中心">
      <div style={{display: 'flex', height: 480}}>
        <div style={{width: 290, padding: '28px 27px', background: colors.soft, flexShrink: 0}}><div style={{fontSize: 24, color: colors.muted}}>可选能力</div><div style={{fontFamily: font.serif, fontSize: 86, lineHeight: 1.1, color: colors.accent, marginTop: 5}}>32<span style={{fontSize: 29, marginLeft: 13}}>插件</span></div><div style={{fontFamily: font.serif, fontSize: 72, lineHeight: 1.1, color: colors.ink, marginTop: 1}}>9<span style={{fontSize: 29, marginLeft: 13}}>整合包</span></div><div style={{height: 1, background: colors.line, margin: '23px 0'}}/><Tag>基础版先起步</Tag><div style={{fontSize: 23, color: colors.muted, lineHeight: 1.65, marginTop: 17}}>插件已内置<br/>默认未启用</div></div>
        <div style={{width: 970, padding: '23px 25px', borderRight: `1px solid ${colors.line}`}}><div style={{display: 'flex', gap: 29, alignItems: 'center', marginBottom: 19}}><span style={{fontSize: 28, fontWeight: 600}}>按场景选择</span><span style={{fontSize: 21, color: colors.muted}}>也可单独选择插件</span></div><div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
          <Bundle title="日常使用" detail="文件 · 镜像 · 快照 · 多终端" icon="folder" at={0.6}/>
          <Bundle title="开发工作台" detail="项目 · 代码 · Git · 工具" icon="code" at={1.05} selected={choose}/>
          <Bundle title="运维与备份" detail="备份 · 同步 · 监控 · 诊断" icon="snapshot" at={1.5}/>
          <Bundle title="实验室" detail="沙箱 · 自动化 · 容器" icon="grid" at={1.95}/>
        </div></div>
        <div style={{flex: 1, background: '#fcfafc', padding: '24px 28px'}}><div style={{fontSize: 26, fontWeight: 600}}>开发工作台</div><div style={{fontSize: 23, color: colors.muted, lineHeight: 1.6, marginTop: 18}}>只选择需要的工具<br/>必需依赖自动补齐</div><div style={{marginTop: 22}}><Button muted={!choose}>{save ? <><Icon type="check" size={25}/>已保存选择</> : '保存选择'}</Button></div><div style={{marginTop: 21}}><StepStrip steps={['选择', '保存']} current={save ? 2 : choose ? 1 : 0}/></div><div style={{color: restart ? colors.accent : colors.muted, fontSize: 23, lineHeight: 1.5, marginTop: 17}}>重新启动 Sakura 服务<br/>后生效</div><div style={{fontSize: 20, color: colors.muted, lineHeight: 1.45, marginTop: 15}}>仅刷新浏览器无效<br/>重启会停止当前实例</div></div>
      </div>
    </Window>
  </ScenePaper>;
};
export const PluginsScene = Interactive.withSchema({Component: PluginsInner, componentName: '<PluginsScene>', schema: {}, wrapInSequence: true});
