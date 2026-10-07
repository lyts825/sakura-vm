/** 文件与同步章节示意，按场景时间展示文件操作、传输和同步方向。
 * Illustrate file operations/transfers/sync directions and conflict resolution from scene time. */
import {Interactive, interpolate} from 'remotion';
import {clamp, Icon} from '../components';
import {Button, Chapter, FlowArrow, ScenePaper, type SceneProps, StepStrip, Tag, useScene, Window} from '../stage';
import {colors, font} from '../theme';

/** 以标题和路径为文件列增加统一容器，并在分隔线下渲染 children，形成本地与来宾目录的并排对照。
 * Wrap file rows with a title/path and render children below the divider for side-by-side host/guest directory comparison. */
const Directory = ({title, path, children}: {title: string; path: string; children: React.ReactNode}) => <div style={{flex: 1, padding: '30px 26px', background: '#fcfafc'}}><div style={{fontSize: 32, fontFamily: font.serif}}>{title}</div><div style={{fontSize: 21, color: colors.muted, fontFamily: font.mono, marginTop: 15}}>{path}</div><div style={{height: 1, margin: '26px 0 14px', background: colors.line}}/>{children}</div>;
/** 渲染文件名、补充说明和可选冲突高亮，帮助同步场景表达本地修改与解决状态。
 * Render a filename, annotation and optional conflict highlight to illustrate local changes and their resolution in the sync scene. */
const FileLine = ({name, active, note}: {name: string; active?: boolean; note: string}) => <div style={{display: 'flex', alignItems: 'center', gap: 14, padding: '16px 10px', fontSize: 23, color: active ? colors.accent : colors.ink, background: active ? colors.blush : 'transparent', borderRadius: 9}}><Icon type="folder" size={26}/><span>{name}</span><span style={{marginLeft: 'auto', color: colors.muted, fontSize: 18}}>{note}</span></div>;
/** 按旁白时间推进同步预览、冲突出现、解决与执行状态，使用并排 Windows/Linux 目录解释同步取舍。
 * Advance sync preview, conflict, resolution and execution from narration cues, comparing Windows/Linux directories side by side. */
const FilesInner: React.FC<SceneProps> = ({style}) => {
  const {seconds, cue} = useScene('files');
  const preview = seconds > cue(0) + 2;
  const conflict = seconds > cue(1);
  const resolved = seconds > cue(1) + 2.2;
  const sync = seconds > cue(1) + 3.8;
  return <ScenePaper id="files" style={style}>
    <Chapter id="files" number="06" tag="文件与同步" detail="SFTP 文件管理 · Windows ⇄ Linux — 需启用文件与同步插件" optional/>
    <Window title="同步预览 / demo-project">
      <div style={{display: 'flex', height: 480}}>
        <Directory title="Windows 文件夹" path="D:\projects\demo"><FileLine name="app.py" active={conflict} note="本地修改"/><FileLine name="README.md" note="新增"/><FileLine name="assets" note="文件夹"/><div style={{marginTop: 40, display: 'flex', gap: 12}}><Button muted>上传</Button><Button muted>下载</Button></div></Directory>
        <div style={{width: 750, padding: '29px 28px', borderLeft: `1px solid ${colors.line}`, borderRight: `1px solid ${colors.line}`}}>
          <StepStrip steps={['预览变更', '处理冲突', '同步']} current={sync ? 3 : resolved ? 2 : conflict ? 1 : 0}/>
          <div style={{marginTop: 20, padding: '17px 24px', border: `1px solid ${conflict && !resolved ? '#d9b483' : colors.line}`, background: conflict && !resolved ? '#faf2df' : '#fcfafc', borderRadius: 13}}><div style={{display: 'flex', alignItems: 'center', gap: 17, fontSize: 28}}><Icon type={resolved ? 'check' : 'code'} size={32} color={resolved ? colors.green : colors.accent}/><span>app.py</span><span style={{marginLeft: 'auto', fontSize: 22, color: resolved ? colors.green : colors.muted}}>{resolved ? '版本已选择' : conflict ? '两端修改 · 冲突' : '等待预览'}</span></div><div style={{fontSize: 22, color: colors.muted, marginTop: 16, lineHeight: 1.5}}>{sync ? '已采用 Windows 版本并同步' : resolved ? '保留 Windows 版本，待确认同步' : conflict ? '先选择要保留的版本，再继续同步' : '检查两端变化，不直接覆盖文件'}</div><div style={{marginTop: 17, display: 'flex', gap: 16, opacity: conflict ? 1 : 0}}><Button muted={!resolved}>保留 Windows 版本</Button><Button muted>保留 Linux 版本</Button></div></div>
          <div style={{display: 'flex', alignItems: 'center', gap: 23, marginTop: 20, color: colors.muted, fontSize: 23}}><span>Windows</span><FlowArrow style={{fontSize: 39, lineHeight: 1, opacity: interpolate(seconds, [cue(0) + 2, cue(0) + 2.6], [0.2, 1], clamp)}}/><span>Linux</span><span style={{marginLeft: 'auto', color: sync ? colors.green : colors.muted}}>{sync ? '示例同步完成' : preview ? '预览中' : '等待操作'}</span></div>
          <div style={{display: 'flex', alignItems: 'center', gap: 16, marginTop: 20}}><Tag color={colors.green}>忽略规则</Tag><span style={{fontFamily: font.mono, fontSize: 21, color: colors.muted}}>node_modules / .git</span></div>
        </div>
        <Directory title="Linux 项目" path="~/demo-project"><FileLine name="app.py" active={conflict} note={sync ? '已同步' : resolved ? '待接收版本' : '客户机修改'}/><FileLine name="README.md" note={sync ? '已同步' : '待同步'}/><FileLine name="assets" note="文件夹"/><div style={{marginTop: 43, fontSize: 23, color: colors.muted, lineHeight: 1.7}}>双向同步<br/>冲突逐个决定</div></Directory>
      </div>
    </Window>
  </ScenePaper>;
};
export const FilesScene = Interactive.withSchema({Component: FilesInner, componentName: '<FilesScene>', schema: {}, wrapInSequence: true});
