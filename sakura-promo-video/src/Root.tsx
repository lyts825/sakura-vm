import {Composition, Folder, Still} from 'remotion';
import {SakuraPromo} from './SakuraPromo';
import {OpeningScene} from './scenes/OpeningScene';
import {TerminalScene} from './scenes/TerminalScene';
import {KernelScene} from './scenes/KernelScene';
import {PluginsScene} from './scenes/PluginsScene';
import {WorkflowScene} from './scenes/WorkflowScene';
import {ClosingScene} from './scenes/ClosingScene';
import {Cover} from './Cover';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="SakuraPromo" component={SakuraPromo} durationInFrames={1350} fps={30} width={1920} height={1080} />
      <Still id="SakuraCover" component={Cover} width={1920} height={1080} />
      <Folder name="Scenes">
        <Composition id="Opening" component={OpeningScene} durationInFrames={192} fps={30} width={1920} height={1080} />
        <Composition id="Terminal" component={TerminalScene} durationInFrames={252} fps={30} width={1920} height={1080} />
        <Composition id="Kernel" component={KernelScene} durationInFrames={252} fps={30} width={1920} height={1080} />
        <Composition id="Plugins" component={PluginsScene} durationInFrames={312} fps={30} width={1920} height={1080} />
        <Composition id="Workflow" component={WorkflowScene} durationInFrames={252} fps={30} width={1920} height={1080} />
        <Composition id="Closing" component={ClosingScene} durationInFrames={150} fps={30} width={1920} height={1080} />
      </Folder>
    </>
  );
};
