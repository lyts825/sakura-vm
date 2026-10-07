/**
 * 模块职责（中文）：将能力检查记录中的就绪、实际执行和退出码转换为状态徽标，区分前置条件通过与执行结果。
 * Module responsibility (English): Distinguishing capability prerequisites, actual execution and exit outcomes.
 * 详细范围（中文）：公开入口包括 FeatureExecutionState, featureReadiness；职责覆盖区分能力前置条件、实际执行与退出结果，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include FeatureExecutionState, featureReadiness. The scope covers Distinguishing capability prerequisites, actual execution and exit outcomes. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type FeatureExecutionState = {
  featureId: string;
  ready: boolean;
  executed?: boolean;
  result?: { executed?: boolean; reason?: string; message?: string; code?: number; error?: string };
};

/**
 * 中文：按实际执行证据、退出码和前置条件生成能力就绪提示；前置检查成功不等同操作执行成功，部分未执行结果单独反馈。
 * English: Derive readiness feedback from execution evidence, exit code and prerequisites. Successful prerequisite checks do not imply successful execution; represent nonexecution separately.
 * 中文：输入：records：签名所示 FeatureExecutionState[] | undefined 业务值；id：目标资源标识
 * English: Inputs: records: the FeatureExecutionState[] | undefined domain value in the signature; id: target resource identifier
 * 中文：结果：包含 label、className、title 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing label, className, title for caller state reads/operations
 */
export function featureReadiness(records: FeatureExecutionState[] | undefined, id: string) {
  const current = records?.find((record) => record.featureId === id);
  if (!current) return { label: '待检查', className: 'badge', title: '尚未检查当前环境' };
  const executed = current.executed ?? current.result?.executed;
  if (executed && typeof current.result?.code === 'number' && current.result.code !== 0)
    return {
      label: '执行失败',
      className: 'badge error',
      title: current.result.error || '工程检查或执行未通过',
    };
  if (current.ready)
    return {
      label: executed === false ? '前置条件通过' : '可用',
      className: 'badge running',
      title: current.result?.message || '检查通过',
    };
  if (executed)
    return {
      label: '仅本地记录',
      className: 'badge',
      title: current.result?.reason || '尚未完成对应的实际能力',
    };
  return { label: '不可用', className: 'badge error', title: current.result?.reason || '检查未通过' };
}
