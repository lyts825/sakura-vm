/**
 * 模块职责（中文）：按实例保存当前项目选择，重新读取项目列表时保留仍有效的选择并回退到服务端活动项目。
 * Module responsibility (English): Keeping valid project selections per VM and isolating obsolete requests.
 * 详细范围（中文）：公开入口包括 useProjectSelection；职责覆盖按实例保存有效项目选择并隔离过期请求，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include useProjectSelection. The scope covers Keeping valid project selections per VM and isolating obsolete requests. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useCallback, useEffect, useState } from 'react';
import type { ProjectIndex } from '../../shared/contracts/controller.ts';
import { api } from '../controller-session';

/**
 * 中文：提交 operation /vms/{selected}/projects，完成按实例保存有效项目选择并隔离过期请求的数据交互；异步失败传给此处的捕获分支或外层动作反馈
 * English: Perform operation /vms/{selected}/projects for Keeping valid project selections per VM and isolating obsolete requests. Propagate asynchronous failure to this catch path or the outer action feedback
 * 中文：输入：selected：签名所示 string 业务值；hasProjects：签名所示 boolean 业务值；token：当前传输认证凭证
 * English: Inputs: selected: the string domain value in the signature; hasProjects: the boolean domain value in the signature; token: current transport credential
 * 中文：结果：包含 projectId、projectLoadError、onProjectChange、selectProject、reloadProject 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing projectId, projectLoadError, onProjectChange, selectProject, reloadProject for caller state reads/operations
 */
export function useProjectSelection(selected: string, hasProjects: boolean, token: string) {
  const [projectSelections, setProjectSelections] = useState<Record<string, string>>({});
  const [projectLoadError, setProjectLoadError] = useState('');
  const [projectRevision, setProjectRevision] = useState(0);
  /**
   * 中文：在按实例保存有效项目选择并隔离过期请求流程中projectSelections 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Keeping valid project selections per VM and isolating obsolete requests, projectSelections state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：next：待采用的新状态或数据
   * English: Inputs: next: new state/data to adopt
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const onProjectChange = useCallback(
    (next: string) => {
      if (!selected) return;
      setProjectSelections((current) =>
        current[selected] === next ? current : { ...current, [selected]: next },
      );
    },
    [selected],
  );
  useEffect(/** 中文：提交 operation /vms/{selected}/projects，完成按实例保存有效项目选择并隔离过期请求的数据交互并更新projectLoadError 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /vms/{selected}/projects for Keeping valid project selections per VM and isolating obsolete requests and update projectLoadError state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
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
    /**
     * 中文：在按实例保存有效项目选择并隔离过期请求流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Keeping valid project selections per VM and isolating obsolete requests, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      alive = false;
      abort.abort();
    };
  }, [selected, hasProjects, token, projectRevision]);
  /**
   * 中文：在按实例保存有效项目选择并隔离过期请求流程中projectSelections 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Keeping valid project selections per VM and isolating obsolete requests, projectSelections state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：vmId：当前实例标识；projectId：当前项目标识
   * English: Inputs: vmId: current VM identifier; projectId: current project identifier
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const selectProject = useCallback((vmId: string, projectId: string) => {
    setProjectSelections((current) => ({ ...current, [vmId]: projectId }));
  }, []);
  /**
   * 中文：在按实例保存有效项目选择并隔离过期请求流程中projectRevision 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Keeping valid project selections per VM and isolating obsolete requests, projectRevision state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   */
  const reloadProject = useCallback(() => setProjectRevision((value) => value + 1), []);
  return {
    projectId: projectSelections[selected],
    projectLoadError,
    onProjectChange,
    selectProject,
    reloadProject,
  };
}
