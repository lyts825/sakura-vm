/** 工作台聚合读取各原领域服务，模板由用户核对后单独创建案例。 */
import type { z } from 'zod';
import type * as S from '../../shared/contracts/suite-common.ts';
import type * as W from '../../shared/contracts/incident-workbench.ts';
export interface IncidentWorkbenchV1 extends S.SuiteRecordsV1 {
  templates(): Promise<W.IncidentWorkbenchTemplate[]>;
  view(input: z.input<typeof W.incidentWorkbenchViewRequest>): Promise<W.IncidentWorkbenchView>;
}
