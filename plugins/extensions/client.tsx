/**
 * 模块职责（中文）：“工程扩展适配器”插件的工程扩展能力中心的页面导出入口，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for engineering extensions and capability checks.
 * 详细范围（中文）：内部入口供相邻界面或契约模块使用；职责覆盖工程扩展与能力检查的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Internal entry points support adjacent UI/contract modules. The scope covers UI interaction and state presentation for engineering extensions and capability checks. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import '../../src/features.css';
export { pages } from '../automation/client';
