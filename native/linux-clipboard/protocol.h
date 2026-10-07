/**
 * 中文：X11 控制器和注入库共享的策略/状态 ABI，定义固定布局、复制粘贴权限及 INCR、MULTIPLE、fork 的硬资源上限。策略通过原子替换读取，状态只通过已授权 fd 更新。
 * English: Policy/status ABI shared by the X11 controller and injected library, defining fixed layouts, copy/paste permissions and hard INCR, MULTIPLE and fork limits. Policies are read through atomic replacement, while status is updated only through an authorized fd.
 */
#pragma once
#include <cstdint>

// Files are replaced atomically by the root controller. The application reads
// policy bytes, while only a passed descriptor permits writing status counters.
namespace sakura {
constexpr uint32_t Magic = 0x58434c50;
// INCR bytes stay private until the terminating property has been validated.
// These are hard process limits, including when a rule is disabled mid-stream.
constexpr uint32_t IncrementalMaximum = 16 * 1024 * 1024;
constexpr uint32_t IncrementalBudget = 32 * 1024 * 1024;
constexpr uint32_t IncrementalSlots = 32;
constexpr uint32_t IncrementalTimeoutMs = 8000;
constexpr uint32_t MultiplePairs = 128;
constexpr uint32_t MultipleGroups = 32;
constexpr uint32_t MultipleTimeoutMs = 12000;
// Quarantined no-exec fork metadata and inherited connection identities remain
// bounded. Abandoned payload allocations still share IncrementalBudget.
constexpr uint32_t ForkDepth = 32;
constexpr uint32_t ConnectionIdentities = 4096;
enum Flags : uint32_t { Copy=1, Paste=2, Files=4, Sensitive=8, Active=16 };
/**
 * 中文：只读策略快照，含方向/格式/敏感限制、长度上限、世代和构建绑定。
 * English: Read-only policy snapshot containing direction/format/sensitivity flags, size limit, generation and build binding.
 */
struct Policy {
  uint32_t magic, version, flags, maximum;
  uint64_t generation;
  char build[65];
  char reserved[39];
};
/**
 * 中文：仅经授权 fd 可写的加载与拒绝计数，固定构建标识防止错误库更新状态。
 * English: Load/denial counters writable only through an authorized fd, with build identity preventing mismatched-library updates.
 */
struct Status {
  uint32_t magic, version;
  uint64_t loaded, blockedCopy, blockedPaste;
  char build[65];
  char reserved[31];
};
static_assert(sizeof(Policy)==128 && sizeof(Status)==128);
}
