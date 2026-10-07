/** 注册全片、封面和独立场景 Composition，以已生成旁白的时间线决定视频帧数。 */
import {Composition, Folder, Still} from 'remotion';
import {SakuraPromo} from './SakuraPromo';
import {Cover} from './Cover';
import {getScene, totalFrames} from './timeline';
import {OpeningScene} from './scenes/OpeningScene';
import {KernelScene} from './scenes/KernelScene';
import {InstancesScene} from './scenes/InstancesScene';
import {PluginsScene} from './scenes/PluginsScene';
import {DevelopmentScene} from './scenes/DevelopmentScene';
import {FilesScene} from './scenes/FilesScene';
import {RecoveryScene} from './scenes/RecoveryScene';
import {NetworkScene} from './scenes/NetworkScene';
import {AutomationScene} from './scenes/AutomationScene';
import {IsolationScene} from './scenes/IsolationScene';
import {DesktopScene} from './scenes/DesktopScene';
import {ClosingScene} from './scenes/ClosingScene';

export const RemotionRoot = () => <>
  <Composition id="SakuraPromo" component={SakuraPromo} durationInFrames={totalFrames} fps={30} width={1920} height={1080}/>
  <Still id="SakuraCover" component={Cover} width={1920} height={1080}/>
  <Folder name="Scenes">
    <Composition id="Opening" component={OpeningScene} durationInFrames={getScene('opening').durationInFrames} fps={30} width={1920} height={1080}/>
    <Composition id="Kernel" component={KernelScene} durationInFrames={getScene('kernel').durationInFrames} fps={30} width={1920} height={1080}/>
    <Composition id="Instances" component={InstancesScene} durationInFrames={getScene('instances').durationInFrames} fps={30} width={1920} height={1080}/>
    <Composition id="Plugins" component={PluginsScene} durationInFrames={getScene('plugins').durationInFrames} fps={30} width={1920} height={1080}/>
    <Composition id="Development" component={DevelopmentScene} durationInFrames={getScene('development').durationInFrames} fps={30} width={1920} height={1080}/>
    <Composition id="Files" component={FilesScene} durationInFrames={getScene('files').durationInFrames} fps={30} width={1920} height={1080}/>
    <Composition id="Recovery" component={RecoveryScene} durationInFrames={getScene('recovery').durationInFrames} fps={30} width={1920} height={1080}/>
    <Composition id="Network" component={NetworkScene} durationInFrames={getScene('network').durationInFrames} fps={30} width={1920} height={1080}/>
    <Composition id="Automation" component={AutomationScene} durationInFrames={getScene('automation').durationInFrames} fps={30} width={1920} height={1080}/>
    <Composition id="Isolation" component={IsolationScene} durationInFrames={getScene('isolation').durationInFrames} fps={30} width={1920} height={1080}/>
    <Composition id="Desktop" component={DesktopScene} durationInFrames={getScene('desktop').durationInFrames} fps={30} width={1920} height={1080}/>
    <Composition id="Closing" component={ClosingScene} durationInFrames={getScene('closing').durationInFrames} fps={30} width={1920} height={1080}/>
  </Folder>
</>;
