import type { EgressInput, EgressPlan } from '../../shared/contracts/egress-rules.ts';
/** 计划与回执绑定真实消费者及 VM 创建、运行、启动身份。 */
export interface EgressRulesV1 {
  preview(input: EgressInput): Promise<EgressPlan>;
  apply(id: string, digest: string): Promise<EgressPlan>;
  observe(id: string): Promise<EgressPlan>;
  revoke(id: string): Promise<EgressPlan>;
  list(owner: string): Promise<EgressPlan[]>;
}
