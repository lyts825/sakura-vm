/** 将修复插件服务绑定到独立版本契约与公共成员目录。
 * Bind the repair plugin service to its independent version contract and public member catalog. */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = { repair: serviceRef('repair', 'repair', serviceContracts.RepairSessions) };
