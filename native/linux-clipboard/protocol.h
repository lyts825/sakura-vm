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
struct Policy {
  uint32_t magic, version, flags, maximum;
  uint64_t generation;
  char build[65];
  char reserved[39];
};
struct Status {
  uint32_t magic, version;
  uint64_t loaded, blockedCopy, blockedPaste;
  char build[65];
  char reserved[31];
};
static_assert(sizeof(Policy)==128 && sizeof(Status)==128);
}
