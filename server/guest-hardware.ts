import { AppError } from './model.ts';

export function cpuSetSize(text: string) {
  if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(text.trim())) return 0;
  return text
    .trim()
    .split(',')
    .reduce((sum, range) => {
      const [from, to = from] = range.split('-').map(Number);
      if (to < from || to > 65535) throw new AppError('客户机 CPU 集合无效');
      return sum + to - from + 1;
    }, 0);
}
