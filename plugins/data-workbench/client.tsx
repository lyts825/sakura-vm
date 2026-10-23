/** 独立本地档案入口及实际实例内开发分区。 */
import { useState } from 'react';
import type { FeatureProps } from '../../src/feature-shared';
import type { PluginPageProps } from '../../src/plugin-client';
import { DataPanel, DataScopePanel } from '../../src/DataLabPanel';
const Panel = (props: FeatureProps) => <DataPanel {...props} section="workbench" />;
function Page({ request, vms, onCreate }: PluginPageProps) {
  const [scope, setScope] = useState('local');
  const local = scope === 'local' || !vms.some((vm) => vm.id === scope);
  return (
    <section>
      <header>
        <h2>数据与实验工作台</h2>
        <label>
          档案范围
          <select value={local ? 'local' : scope} onChange={(e) => setScope(e.target.value)}>
            <option value="local">本地数据档案（不需要来源实例）</option>
            {vms.map((vm) => (
              <option key={vm.id} value={vm.id}>
                {vm.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={onCreate}>创建来源实例</button>
      </header>
      <p>
        {local
          ? '本地档案可上传文件、准备独立环境并完成数据分析。项目文件和实例凭据操作需选择实际来源实例。'
          : '当前使用实际实例的默认项目档案；其他项目请进入实例开发分区。'}
      </p>
      <DataScopePanel
        request={request}
        scopeId={local ? 'local' : scope}
        projectId="default"
        localArchive={local}
        section="workbench"
      />
    </section>
  );
}
export const developmentSections = { 'data-workbench': Panel };
export const pages = { 'data-lab': Page };
