/** 宣传视频 CLI 渲染配置，固定 H.264、yuv420p、BT.709 和质量参数；Node API 调用需显式传入相同选项。
 * Fix H.264/yuv420p/BT.709/quality CLI render settings; Node API rendering must supply equivalent options explicitly. */
/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setColorSpace("bt709");
Config.setCrf(18);
