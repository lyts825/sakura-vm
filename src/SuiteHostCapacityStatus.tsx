import type { SuiteHostCapacity } from '../shared/contracts/suite-capacity';
export function SuiteHostCapacityStatus({ value }: { value?: SuiteHostCapacity }) {
  if (!value) return null;
  const mib = (bytes: number) => (bytes / 1024 ** 2).toFixed(1) + ' MiB';
  return (
    <p>
      新插件包共用额度：已用 {mib(value.used)} · 已预留 {mib(value.reserved)} · 总额 {mib(value.limit)}。
      其中 {mib(value.recoveryReserve)} 留作恢复；停用插件的原占用继续计入。
      {value.retainedMetadataBytes > 0 && ` 未确认的根账本暂存 ${mib(value.retainedMetadataBytes)} 已保留计费。`}
    </p>
  );
}
