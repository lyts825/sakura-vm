/** 固定来源、凭据版本与预算的只读数据库捕获端口。 */
import type { DataScope, DataSource } from '../../shared/contracts/data-common.ts';
import type { DataPg } from '../../shared/contracts/data-services.ts';
export interface DataReadonlyDatabaseV1 {
  captureDatabase(
    scope: DataScope,
    input: { name: string; connection: DataPg },
    signal?: AbortSignal,
  ): Promise<DataSource>;
}
