/** 交付定义的独立公共契约。 Independent public contract for delivery definitions. */
import type { DeliveryScope, DeliveryDefinition } from '../../shared/contracts/delivery-common.ts';
import type {
  DeliveryDefinitionRecord,
  DeliveryWorkbenchView,
} from '../../shared/contracts/delivery-workbench.ts';
export interface DeliveryWorkbenchV1 {
  /** 读取作用域内定义与模板，不执行项目。 Read scoped definitions and templates without execution. */
  view(scope: DeliveryScope): Promise<DeliveryWorkbenchView>;
  /** 按预期修订保存并返回新记录，冲突拒绝。 Save using an expected revision; reject conflicts. */
  save(
    scope: DeliveryScope,
    input: { id?: string; expectedRevision: number; definition: DeliveryDefinition },
  ): Promise<DeliveryDefinitionRecord>;
  /** 归档指定修订，保留内容。 Archive the specified revision while retaining its content. */
  archive(scope: DeliveryScope, id: string, expectedRevision: number): Promise<DeliveryDefinitionRecord>;
  /** 复制为新身份，不继承执行证据。 Copy under a fresh identity without execution evidence. */
  copy(scope: DeliveryScope, id: string): Promise<DeliveryDefinitionRecord>;
  /** 解析有界外部定义，不保存或执行。 Parse a bounded external definition without persistence or execution. */
  previewImport(scope: DeliveryScope, text: string): Promise<DeliveryDefinition>;
}
