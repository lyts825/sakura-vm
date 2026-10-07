/**
 * 模块职责（中文）：为需要运行中客户机的界面生成统一停机提示和启动入口。
 * Module responsibility (English): Providing consistent stopped-guest guidance and a start action.
 * 详细范围（中文）：公开入口包括 stopped；职责覆盖统一提供客户机停机提示和启动入口，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include stopped. The scope covers Providing consistent stopped-guest guidance and a start action. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import './development.css';

export const stopped = <p className="subtle-note">启动实例后可使用此功能。</p>;
