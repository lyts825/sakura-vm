import { useMemo, useState } from 'react';
import { developmentSections, PLUGINS } from '../shared/plugins';
import './development.css';
import type { FeatureProps } from './feature-shared';
import './features.css';
import { PluginDevelopmentSection } from './plugin-client';
import { usePlugins } from './plugin-context';
import { workspaceRequest } from './workspace-request';

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
        {[
          ['tools', '开发工具'],
          ['network', '网络配置'],
          ['secrets', '私密配置'],
          ['commands', '收藏命令'],
          ['pipelines', '流水线'],
          ['runtimes', '版本'],
          ...PLUGINS.flatMap((plugin) =>
            plugin.contributes.developmentSections
              .filter(
                (id) => !['tools', 'network', 'secrets', 'commands', 'pipelines', 'runtimes'].includes(id),
              )
              .map((id) => [id, plugin.name]),
          ),
        ]
          .filter(([id]) => available.some((section) => section === id))
          .map(([id, label]) => (
            <button
              key={id}
              className={`${section === id ? 'primary' : 'secondary'} compact`}
              aria-pressed={section === id}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
      </div>
      {section && <PluginDevelopmentSection id={section} {...scopedProps} />}
    </div>
  );
}
