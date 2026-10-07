/**
 * 模块职责（中文）：根据已启用插件装配开发能力分区，并提供开发项目的统一上下文。
 * Module responsibility (English): Composing plugin development sections in the current VM and project context.
 * 详细范围（中文）：公开入口包括 DevelopmentPanel；职责覆盖以当前实例和项目上下文装配插件开发分区，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include DevelopmentPanel. The scope covers Composing plugin development sections in the current VM and project context. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useMemo, useState } from 'react';
import { developmentSections, PLUGINS } from '../shared/plugins';
import './development.css';
import type { FeatureProps } from './feature-shared';
import './features.css';
import { PluginDevelopmentSection } from './plugin-client';
import { usePlugins } from './plugin-context';
import { workspaceRequest } from './workspace-request';
import { sectionLabels } from './plugin-navigation';

/**
 * 中文：呈现以当前实例和项目上下文装配插件开发分区中的 DevelopmentPanel 界面，组合 PluginDevelopmentSection，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the DevelopmentPanel surface for Composing plugin development sections in the current VM and project context and composing PluginDevelopmentSection. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：props：签名所示 FeatureProps 业务值
 * English: Inputs: props: the FeatureProps domain value in the signature
 */
export function DevelopmentPanel(props: FeatureProps) {
  const available = developmentSections(usePlugins());
  const scopedRequest = useMemo(
    () => workspaceRequest(props.request, props.projectId),
    [props.projectId, props.request],
  );
  const scopedProps = { ...props, request: scopedRequest };
  const [choice, setSection] = useState<string>(available[0] || '');
  const section = available.some((id) => id === choice) ? choice : available[0];
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>开发设置</h3>
          <p>管理当前已启用的开发配套。</p>
        </div>
      </div>
      <div className="feature-actions development-sections" aria-label="开发设置分类">
        {available.map((id) => (
          <button
            key={id}
            className={`${section === id ? 'primary' : 'secondary'} compact`}
            aria-pressed={section === id}
            onClick={() => setSection(id)}
          >
            {sectionLabels[id] ||
              PLUGINS.find((plugin) => plugin.contributes.developmentSections.includes(id))?.name ||
              id}
          </button>
        ))}
      </div>
      {section && <PluginDevelopmentSection id={section} {...scopedProps} />}
    </div>
  );
}
