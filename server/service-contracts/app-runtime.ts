/** 应用服务公开接口；每个提供者仅接收本领域的严格动作。 */
import type { AppView, AppCheckpoint } from '../../shared/contracts/app-runtime.ts';
import type { AppAction } from '../../shared/contracts/app-http.ts';
export interface AppDomainV1 {
  view(appId?: string): Promise<AppView>;
  act(appId: string, input: AppAction): Promise<AppView>;
}
export interface AppTargetsV1 extends AppDomainV1 {}
export interface AppPackagesV1 extends AppDomainV1 {
  files(
    appId: string,
    packageId: string,
  ): Promise<Array<{ path: string; blobId: string; sha256: string; bytes: number; mode: number }>>;
  read(
    appId: string,
    blobId: string,
    offset: number,
    length: number,
  ): Promise<{ data: string; offset: number; eof: boolean; sha256: string }>;
}
export interface AppConfigV1 extends AppDomainV1 {
  resolve(appId: string, id: string): Promise<Record<string, string>>;
}
export interface AppDataV1 extends AppDomainV1 {}
export interface AppObserveV1 extends AppDomainV1 {}
export interface AppRoutesV1 extends AppDomainV1 {}
export interface AppRecoveryV1 extends AppDomainV1 {
  checkpoint(appId: string, leaseId: string): Promise<AppCheckpoint>;
}
export interface AppDeployV1 extends AppDomainV1 {}
export interface AppWorkbenchV1 extends AppDomainV1 {}
