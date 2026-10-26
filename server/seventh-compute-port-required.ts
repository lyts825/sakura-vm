/** 缺少已声明的固定计算提供者时拒绝激活，不回退到私有跨域实例。 */
import type { SeventhComputePortV1 } from '../shared/contracts/seventh-common.ts';
import { AppError } from '../shared/errors.ts';
export function requiredSeventhComputePort(value: SeventhComputePortV1 | undefined): SeventhComputePortV1 {
  if (!value) throw new AppError('固定计算提供者尚未就绪', 503, 'SEVENTH_COMPUTE_UNAVAILABLE');
  return value;
}
