/**
 * 模块职责：按实例保存当前项目选择，重新读取项目列表时保留仍有效的选择并回退到服务端活动项目。
 */
import { useCallback, useEffect, useState } from 'react';
import type { ProjectIndex } from '../../shared/contracts/controller.ts';
import { api } from '../controller-session';

export function useProjectSelection(selected: string, hasProjects: boolean, token: string) {
  const [projectSelections, setProjectSelections] = useState<Record<string, string>>({});
  const [projectLoadError, setProjectLoadError] = useState('');
  const [projectRevision, setProjectRevision] = useState(0);
  const onProjectChange = useCallback(
    (next: string) => {
      if (!selected) return;
      setProjectSelections((current) =>
        current[selected] === next ? current : { ...current, [selected]: next },
      );
    },
    [selected],
  );
  useEffect(() => {
    if (!selected || !hasProjects) return;
    setProjectLoadError('');
    // 实例、凭证或列表修订变化后取消旧请求，同时用 alive 防止已完成但尚未派发的旧回调写入状态。
    const abort = new AbortController();
    let alive = true;
    void api<ProjectIndex>(`/vms/${selected}/projects`, 'GET', undefined, abort.signal)
      .then((data) => {
        if (alive)
          setProjectSelections((current) => ({
            ...current,
            [selected]: data.projects.some((p) => p.id === current[selected])
              ? current[selected]
              : data.active,
          }));
      })
      .catch((error) => {
        if (alive) setProjectLoadError(error instanceof Error ? error.message : '无法加载工作项目');
      });
    return () => {
      alive = false;
      abort.abort();
    };
  }, [selected, hasProjects, token, projectRevision]);
  const selectProject = useCallback((vmId: string, projectId: string) => {
    setProjectSelections((current) => ({ ...current, [vmId]: projectId }));
  }, []);
  const reloadProject = useCallback(() => setProjectRevision((value) => value + 1), []);
  return {
    projectId: projectSelections[selected],
    projectLoadError,
    onProjectChange,
    selectProject,
    reloadProject,
  };
}
