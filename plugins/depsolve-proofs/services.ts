/** 结果核验的独立版本服务引用。 */
import {serviceRef} from '../../server/service-ref.ts';
import {serviceContracts} from '../../server/service-contracts.ts';
export const services={domain:serviceRef('depsolve-proofs','depsolveProofs',serviceContracts.DepsolveProofs)};
