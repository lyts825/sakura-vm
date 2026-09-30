#pragma once
#include <cstdint>

// Files are replaced atomically by the root controller. The application reads
// policy bytes, while only a passed descriptor permits writing status counters.
namespace sakura {
constexpr uint32_t Magic = 0x58434c50;
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
