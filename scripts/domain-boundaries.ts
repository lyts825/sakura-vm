/** 声明服务领域依赖图，并通过 AST 识别跨领域导入和访问，供架构检查统一报告违规边界。
 * Declare service-domain dependency rules and detect cross-domain imports/access through the AST for consolidated architecture diagnostics. */
import { posix } from 'node:path';
import ts from 'typescript';
import { staticString } from './network-boundaries.ts';

/** Only coordinators depend on their resource owners. Owners receive narrow ports back. */
export const domainDependencies = {
  composition: ['vm-lifecycle', 'peers', 'peer-sessions', 'storage', 'sandbox', 'files', 'identity', 'migration', 'replication', 'failover', 'network'],
  'vm-lifecycle': ['storage', 'sandbox', 'failover', 'files', 'identity', 'network', 'migration'],
  peers: ['peer-sessions', 'replication', 'migration', 'failover', 'network'],
  'peer-sessions': ['network'],
  storage: ['identity', 'network'],
  sandbox: ['storage', 'files', 'identity', 'network'],
  files: ['storage', 'identity', 'network'],
  identity: ['network'],
  migration: ['storage', 'identity', 'network'],
  replication: ['storage', 'migration', 'identity', 'network'],
  failover: ['replication', 'migration', 'storage', 'identity', 'network'],
  network: [],
} as const;
export type Domain = keyof typeof domainDependencies;

const owners: Record<string, Domain> = {
  'server/domain-recovery-sources': 'composition',
  'server/machines': 'vm-lifecycle',
  'server/vm-transport': 'vm-lifecycle',
  'server/vm-lifetime': 'vm-lifecycle',
  'server/host-peers': 'peers',
  'server/domains/peer-migration-sessions': 'peer-sessions',
  'server/domains/peer-replica-operations': 'replication',
  'server/domains/vm-disk-encryption': 'storage',
  'server/domains/vm-snapshots': 'storage',
  'server/domains/vm-storage-placement': 'storage',
  'server/domains/sandbox-lifetimes': 'sandbox',
  'server/domains/vm-ha-authority': 'failover',
  'server/disk-encryption': 'storage',
  'server/disk-maintenance': 'storage',
  'server/storage-pools': 'storage',
  'server/storage-runtime': 'storage',
  'server/vm-storage': 'storage',
  'server/bundles': 'storage',
  'server/disk-imports': 'storage',
  'server/secure-erase': 'storage',
  'server/sandboxes': 'sandbox',
  'server/sandbox-artifacts': 'sandbox',
  'server/single-app-sandbox': 'sandbox',
  'server/files': 'files',
  'server/history': 'files',
  'server/file-locks': 'files',
  'server/secrets': 'identity',
  'server/secret-rotation': 'identity',
  'server/snapshot-replications': 'replication',
  'server/cold-migration': 'migration',
  'server/host-imports': 'migration',
};
/** 统一斜线并去除源码扩展名，使领域所属判断不受 import 扩展影响。
 * Normalize slashes/remove source extensions for import-independent domain ownership lookup. */
const canonical = (file: string) => file.replaceAll('\\', '/').replace(/\.[cm]?[jt]sx?$/, '');
/** 按明确声明或受支持服务前缀返回领域 owner，未登记路径返回 undefined。
 * Resolve ownership from declarations/supported service prefixes, returning undefined for unregistered paths. */
export function domainOwner(file: string): Domain | undefined {
  file = canonical(file);
  if (owners[file]) return owners[file];
  if (/^server\/application(?:-|$)/.test(file) || file === 'server/system-services') return 'composition';
  if (/^server\/ha(?:-|$)/.test(file)) return 'failover';
  if (/^server\/live-migration(?:-|$)/.test(file)) return 'migration';
  if (file.startsWith('server/network/')) return 'network';
}

/** Check eager, lazy and type dependencies; public shared and service contracts remain neutral. */
/** 按当前领域依赖矩阵检查导入与资源 owner 使用，未声明资源域也报告，返回诊断列表。
 * Check imports/resource-owner usage against the domain matrix, including undeclared resource domains, returning diagnostics. */
export function domainBoundaryErrors(file: string, source: ts.SourceFile) {
  file = file.replaceAll('\\', '/');
  const owner = domainOwner(file);
  const errors: string[] = [];
  /** 附带源文件与一基行号累计边界诊断，不中断遍历，以便一次报告全部违规。
   * Accumulate boundary diagnostics with source path/one-based line without stopping traversal, reporting all violations together. */
  const report = (node: ts.Node, message: string) => errors.push(
    `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`);
  if (!owner) {
    if (file.startsWith('server/domains/')) report(source, 'Domain resource owners must declare an allowed dependency row');
    return errors;
  }
  /** 解析相对 specifier 的目标领域，检查同域/基础契约/明确允许依赖，越界累计诊断。
   * Resolve relative target domains and validate same-domain/foundation/allowed dependencies, recording boundary violations. */
  const dependency = (node: ts.Node, specifier: string | undefined) => {
    if (!specifier?.startsWith('.')) return;
    const target = posix.normalize(posix.join(posix.dirname(file), specifier));
    const targetOwner = domainOwner(target);
    if (!targetOwner) {
      if (file.startsWith('server/domains/') && target.startsWith('server/') &&
        !/^server\/(?:paths|qmp|runtime|vm-access|vm-ports|local-store)(?:\.[cm]?[jt]sx?)?$/.test(target) && !target.startsWith('server/service-contracts/'))
        report(node, `Domain resource owner dependency requires an explicit owner or foundation contract (${target})`);
      return;
    }
    if (targetOwner === owner) return;
    const allowed: readonly string[] = domainDependencies[owner];
    if (!allowed.includes(targetOwner)) report(node,
      `Domain dependency ${owner} -> ${targetOwner} is not allowed (${target}); use an explicit contract or injected port`);
  };
  /** 递归检查 import/export/type/require 表达式及领域资源访问，防止动态语法绕开规则。
   * Inspect imports/exports/types/require and domain resource access recursively to prevent syntax-based bypass. */
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) dependency(node, staticString(node.moduleSpecifier));
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      dependency(node, staticString(node.moduleReference.expression));
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) dependency(node, staticString(node.argument.literal));
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      const specifier = staticString(node.arguments[0]);
      if (!specifier && file.startsWith('server/domains/')) report(node, 'Domain resource owners require statically declared module dependencies');
      dependency(node, specifier);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}
