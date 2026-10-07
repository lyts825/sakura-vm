/** 注册 Remotion 根组件，供 Studio 与命令行渲染发现全片、场景和封面。
 * Register the Remotion root so Studio/CLI can discover the film, scenes and cover. */
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
