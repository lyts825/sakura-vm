/** 复盘审阅与报告的独立公共声明。 */
import type { z } from 'zod';
import type * as S from '../../shared/contracts/suite-common.ts';
import type * as R from '../../shared/contracts/incident-reviews.ts';
export interface IncidentReviewsV1 extends S.SuiteRecordsV1 {
  open(input: z.input<typeof R.incidentReviewOpen>): Promise<S.SuiteRecord>;
  decide(input: z.infer<typeof R.incidentReviewDecide>): Promise<S.SuiteRecord>;
  recheck(input: z.infer<typeof R.incidentReviewPin>): Promise<R.IncidentReviewCheck>;
  latestDecision(input: z.infer<typeof R.incidentReviewPin>): Promise<R.IncidentReviewLatestDecision>;
}
export interface IncidentReportsV1 extends S.SuiteRecordsV1 {
  draft(input: z.infer<typeof R.incidentReportDraft>): Promise<S.SuiteRecord>;
  seal(input: z.infer<typeof R.incidentReportSeal>): Promise<S.SuiteRecord>;
  compare(input: z.infer<typeof R.incidentReportCompare>): Promise<S.SuiteRecord>;
}
