/** 各插件只公开自己的领域能力。 Independent domain ports; consumers never read private stores. */
import type { z } from 'zod';
import type * as K from '../../shared/contracts/knowledge-studio.ts';
import type { ProjectCaptureRequest } from '../../shared/contracts/files-capture.ts';
export type KnowledgeScope = { spaceId: string };
export type KnowledgeToken = KnowledgeScope & { token: string };
export type KnowledgeCreateEntry = KnowledgeScope & z.infer<typeof K.entryContentSchema>;
export type KnowledgeCreateDocument = KnowledgeScope & z.infer<typeof K.documentContentSchema>;
export interface KnowledgeSourcesV1 {
  createSpace(input: { name: string }): Promise<K.Space>;
  importSpace(input: { name: string }, construct: (space: K.Space) => Promise<void>): Promise<K.Space>;
  listSpaces(): Promise<K.Space[]>;
  space(input: KnowledgeScope): Promise<K.Space>;
  revokeSpace(input: KnowledgeScope & { expectedRevision: number; revoked: boolean }): Promise<K.Space>;
  listSources(input: KnowledgeScope): Promise<K.Source[]>;
  getSource(input: K.Pin): Promise<K.Source>;
  upload(
    input: KnowledgeScope & {
      name: string;
      format: K.Source['format'];
      data: string;
      policy: K.Policy;
      sourceId?: string;
      expectedRevision?: number;
    },
  ): Promise<K.Source>;
  redact(
    input: K.Pin & { ranges: { start: number; end: number }[]; name: string; policy: K.Policy },
  ): Promise<K.Source>;
  planCapture(
    input: KnowledgeScope & {
      request: ProjectCaptureRequest;
      policy: K.Policy;
      refresh?: { path: string; sourceId: string; expectedRevision: number }[];
    },
  ): Promise<K.Plan>;
  capture(input: KnowledgeToken, signal?: AbortSignal): Promise<K.Source[]>;
  read(input: K.Pin): Promise<{ source: K.Source; data: string }>;
  check(
    input: KnowledgeScope & { dependencies: K.Dependency[]; purpose: K.Purpose; exactPolicy?: boolean },
  ): Promise<K.Dependency[]>;
  planPolicy(
    input: KnowledgeScope & { id: string; expectedRevision: number; policy: K.Policy; revoked: boolean },
  ): Promise<K.Plan>;
  applyPolicy(input: KnowledgeToken): Promise<K.Source>;
  writeDerived(
    input: KnowledgeScope & { data: string; dependencies: K.Dependency[]; purpose: K.Purpose },
  ): Promise<K.BlobReceipt>;
  readBlob(
    input: KnowledgeScope & { id: string; purpose: K.Purpose },
  ): Promise<{ data: string; receipt: K.BlobReceipt }>;
  retain(input: KnowledgeScope & { id: string; holder: string }): Promise<K.BlobReceipt>;
  release(input: KnowledgeScope & { id: string; holder: string }): Promise<K.BlobReceipt>;
  verify(input: K.Pin): Promise<{ digest: string; bytes: number }>;
  reserveCapacity(
    input: KnowledgeScope & {
      bytes: number;
      objects: number;
      kind: K.Capacity['kind'];
      operationId: string;
      slot?: string;
    },
  ): Promise<K.Capacity>;
  commitCapacity(input: KnowledgeToken & { actual: number }): Promise<K.Capacity>;
  releaseCapacity(input: KnowledgeToken): Promise<void>;
  reserveQuarantine(input: { bytes: number; operationId: string }): Promise<K.Capacity>;
  settleQuarantine(input: { token: string; actual: number }): Promise<K.Capacity>;
  capacity(
    input: KnowledgeScope,
  ): Promise<{ used: number; reserved: number; totalLimit: number; recoveryReserve: number }>;
  planCleanup(input: KnowledgeScope): Promise<K.Plan>;
  cleanup(input: KnowledgeToken): Promise<{ removed: string[]; protected: string[]; pending: string[] }>;
}
export interface KnowledgeExtractV1 {
  plan(input: KnowledgeScope & { sources: K.Ref[] }): Promise<K.Plan>;
  run(input: KnowledgeToken, signal?: AbortSignal): Promise<K.Extraction[]>;
  get(input: K.Pin): Promise<K.Extraction>;
  list(input: KnowledgeScope): Promise<K.Extraction[]>;
  jobs(input: KnowledgeScope): Promise<K.Job[]>;
  cancel(input: KnowledgeScope & { id: string }): Promise<K.Job>;
}
export interface KnowledgeIndexV1 {
  plan(input: KnowledgeScope & { extractions: K.Ref[] }): Promise<K.Plan>;
  build(input: KnowledgeToken, signal?: AbortSignal): Promise<K.Index>;
  search(input: KnowledgeScope & { query: string; generation?: K.Ref; limit: number }): Promise<K.Search>;
  coverage(input: KnowledgeScope): Promise<{ indexed: number; omitted: number; stale: boolean }>;
  jobs(input: KnowledgeScope): Promise<K.Job[]>;
  cancel(input: KnowledgeScope & { id: string }): Promise<K.Job>;
}
export interface KnowledgeEvidenceV1 {
  create(input: KnowledgeScope & { extraction: K.Ref; start: number; end: number }): Promise<K.Citation>;
  inspect(input: K.Pin): Promise<K.Citation>;
  check(input: K.Pin): Promise<K.EvidenceCheck>;
  migrate(
    input: K.Pin & { target: K.Ref },
  ): Promise<{ candidates: { start: number; end: number; locator: string }[]; ambiguous: boolean }>;
  list(input: KnowledgeScope): Promise<K.Citation[]>;
}
export interface KnowledgeEntriesV1 {
  create(input: KnowledgeCreateEntry): Promise<K.Entry>;
  revise(input: KnowledgeCreateEntry & { id: string; expectedRevision: number }): Promise<K.Entry>;
  readPinned(input: K.Pin): Promise<K.Entry>;
  list(input: KnowledgeScope): Promise<K.Entry[]>;
  compare(
    input: KnowledgeScope & { id: string; left: number; right: number },
  ): Promise<{ left: K.Entry; right: K.Entry }>;
  archive(input: KnowledgeScope & { id: string; expectedRevision: number }): Promise<K.Entry>;
}
export interface KnowledgeDocumentsV1 {
  templates(): Promise<{ id: K.Document['template']; headings: string[]; revision: 1 }[]>;
  create(input: KnowledgeCreateDocument): Promise<K.Document>;
  revise(input: KnowledgeCreateDocument & { id: string; expectedRevision: number }): Promise<K.Document>;
  readPinned(input: K.Pin): Promise<K.Document>;
  list(input: KnowledgeScope): Promise<K.Document[]>;
  compare(
    input: KnowledgeScope & { id: string; left: number; right: number },
  ): Promise<{ left: K.Document; right: K.Document }>;
  archive(input: KnowledgeScope & { id: string; expectedRevision: number }): Promise<K.Document>;
}
export interface KnowledgeReviewsV1 {
  open(input: KnowledgeScope & { document: K.Ref }): Promise<K.Review>;
  readPinned(input: K.Pin): Promise<K.Review>;
  decide(
    input: KnowledgeScope & {
      id: string;
      expectedRevision: number;
      decision: 'accepted' | 'changes-requested' | 'revoked';
      acknowledgements: string[];
      note: string;
    },
  ): Promise<K.Review>;
  recheck(input: K.Pin): Promise<K.Review>;
  list(input: KnowledgeScope): Promise<K.Review[]>;
}
export interface KnowledgePublishV1 {
  plan(input: KnowledgeScope & { document: K.Ref; review: K.Ref }): Promise<K.Plan>;
  apply(input: KnowledgeToken, signal?: AbortSignal): Promise<K.Publication>;
  read(input: KnowledgeScope & { id?: string }): Promise<K.Publication>;
  withdraw(input: KnowledgeScope & { id: string; reason: string }): Promise<K.Publication>;
  rollback(input: KnowledgeScope & { id: string }): Promise<K.Plan>;
  list(
    input: KnowledgeScope,
  ): Promise<{ id: string; revision: number; document: K.Ref; withdrawn: boolean; active: boolean }[]>;
}
export interface KnowledgeExchangeV1 {
  planExport(
    input: KnowledgeScope & { document: K.Ref; review: K.Ref; mode: K.Bundle['mode'] },
  ): Promise<K.Plan>;
  export(
    input: KnowledgeToken,
    signal?: AbortSignal,
  ): Promise<{ id: string; digest: string; mode: K.Bundle['mode'] }>;
  download(input: KnowledgeScope & { id: string }): Promise<K.Bundle>;
  inspectImport(input: { bundle: unknown }): Promise<K.Quarantine>;
  acceptImport(
    input: { id: string; name: string; acceptUnverified: boolean },
    signal?: AbortSignal,
  ): Promise<K.Quarantine>;
  imports(): Promise<K.Quarantine[]>;
  discardImport(input: { id: string }): Promise<K.Quarantine>;
}
export interface KnowledgeWorkbenchV1 {
  view(input: KnowledgeScope): Promise<{
    space: K.Space;
    sources: K.Source[];
    entries: K.Entry[];
    documents: K.Document[];
    reviews: K.Review[];
    jobs: K.Job[];
    capacity: { used: number; reserved: number; totalLimit: number; recoveryReserve: number };
  }>;
  preferences(input: KnowledgeScope & { step: string }): Promise<{ spaceId: string; step: string }>;
  example(input: {
    name: string;
    template: K.Document['template'];
  }): Promise<{ space: K.Space; sources: K.Source[] }>;
}
