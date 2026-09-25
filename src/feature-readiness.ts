export type FeatureExecutionState = {
  featureId: string;
  ready: boolean;
  executed?: boolean;
  result?: { executed?: boolean; reason?: string; message?: string; code?: number; error?: string };
};

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
