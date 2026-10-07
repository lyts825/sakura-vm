/**
 * 模块职责（中文）：“Git 工作台”插件的有类型服务引用（git），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 * Module responsibility (English): binding service names to public contracts for broker checks in Git status, branches and conflict resolution.
 * 详细范围（中文）：公开入口包括 services；职责覆盖将Git 状态、分支与冲突处理的服务名称绑定到公共契约，供宿主代理检查，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include services. The scope covers binding service names to public contracts for broker checks in Git status, branches and conflict resolution. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  git: serviceRef('git', 'git', serviceContracts.GitWorkbench),
};
