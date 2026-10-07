/** 宣传视频配色、字体和本地字体加载声明，供所有场景与封面复用品牌视觉。 */
import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';

await Promise.all([
  loadFont({family: 'Sakura Sans', url: staticFile('brand/fonts/sakura-sans-ui.woff2'), weight: '400 700'}),
  loadFont({family: 'Sakura Serif', url: staticFile('brand/fonts/sakura-serif-ui.woff2'), weight: '400 700'}),
  loadFont({family: 'Sakura Mono', url: staticFile('brand/fonts/sakura-mono.woff2'), weight: '400 700'}),
]);

export const colors = {
  paper: '#faf7f9', surface: '#ffffff', soft: '#f4eef3', ink: '#3b303f',
  muted: '#706374', line: '#e8dfe7', accent: '#ad416f', blush: '#f7e7ef',
  terminal: '#26212c', terminalChrome: '#2e2735', terminalInk: '#eee6ef',
  green: '#397759', greenSoft: '#edf5ef',
};
export const font = {
  sans: '"Sakura Sans", "Microsoft YaHei", sans-serif',
  serif: '"Sakura Serif", "Microsoft YaHei", serif',
  mono: '"Sakura Mono", Consolas, monospace',
};
