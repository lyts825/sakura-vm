import { Download } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '../../server/workspaces';
import { saveText } from '../../src/export-file';
import type { FeatureProps, Request } from '../../src/feature-shared';
import { Feedback, useAction } from '../../src/feature-shared';
import '../../src/features.css';

export function RecipeConnection({
  vm,
  request,
  applied,
}: FeatureProps & { applied: (project: Project) => void }) {
  const [recipe, setRecipe] = useState('');
  const action = useAction();
  return (
    <>
      <details className="feature-card">
        <summary>分享与导入项目环境</summary>
        <p className="subtle-note">
          sakura.json 保存资源、环境和服务配置。导入后可以先检查命令，再点击“准备环境”。
        </p>
        <div className="feature-actions">
          <button
            className="secondary compact"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const result = await request(`/vms/${vm.id}/recipe`);
                setRecipe(JSON.stringify(result, null, 2));
                saveText('sakura.json', result);
              })
            }
          >
            <Download size={14} />
            导出配置
          </button>
          <button
            className="secondary compact"
            disabled={action.busy || vm.status !== 'running'}
            onClick={() =>
              void action.run(async () => {
                const value = await request(`/vms/${vm.id}/recipe`, 'POST', { action: 'read' });
                setRecipe(JSON.stringify(value, null, 2));
              }, '已读取项目目录中的 sakura.json')
            }
          >
            从项目读取
          </button>
          <button
            className="secondary compact"
            disabled={action.busy || vm.status !== 'running'}
            onClick={() =>
              void action.run(
                () => request(`/vms/${vm.id}/recipe`, 'POST', { action: 'write' }),
                '已在项目目录新建 sakura.json',
              )
            }
          >
            写入项目目录
          </button>
        </div>
        <label>
          待应用的环境配置
          <textarea
            rows={10}
            value={recipe}
            onChange={(e) => setRecipe(e.target.value)}
            placeholder="粘贴 sakura.json 内容"
          />
        </label>
        <button
          className="primary compact"
          disabled={action.busy || !recipe.trim()}
          onClick={() =>
            void action.run(async () => {
              const result = await request(`/vms/${vm.id}/recipe`, 'PUT', JSON.parse(recipe));
              applied(result.project);
            }, '项目配置已应用，启动时生效')
          }
        >
          应用项目配置
        </button>
        <p className="subtle-note">应用到现有实例会更新项目配置；资源参数在创建新实例时使用。</p>
      </details>
      <Feedback error={action.error} message={action.message} />
    </>
  );
}

export function RecipeImporter({ request, refresh }: { request: Request; refresh: () => Promise<unknown> }) {
  const [name, setName] = useState('shared-dev'),
    [recipe, setRecipe] = useState('');
  const action = useAction();
  return (
    <details className="feature-card">
      <summary>从 sakura.json 创建环境</summary>
      <label>
        新实例名称
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        选择配置文件
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void action.run(async () => {
                if (file.size > 1024 ** 2) throw new Error('配置文件不能超过 1 MiB');
                setRecipe(await file.text());
              });
          }}
        />
      </label>
      <label>
        配置内容
        <textarea rows={8} value={recipe} onChange={(e) => setRecipe(e.target.value)} />
      </label>
      <button
        className="primary compact"
        disabled={action.busy || !recipe}
        onClick={() =>
          void action.run(async () => {
            await request('/recipes', 'POST', { name, recipe: JSON.parse(recipe) });
            await refresh();
          }, '环境已创建，可在项目面板准备环境并启动')
        }
      >
        创建环境
      </button>
      <Feedback error={action.error} message={action.message} />
    </details>
  );
}
