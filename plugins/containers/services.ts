/**
 * 模块职责（中文）：“容器工作台”插件的有类型服务引用（containers），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 * Module responsibility (English): binding service names to public contracts for broker checks in containers, Compose and development containers.
 * 详细范围（中文）：公开入口包括 services；职责覆盖将容器、Compose 与开发容器的服务名称绑定到公共契约，供宿主代理检查，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include services. The scope covers binding service names to public contracts for broker checks in containers, Compose and development containers. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  containers: serviceRef('containers', 'containers', serviceContracts.Containers),
};
