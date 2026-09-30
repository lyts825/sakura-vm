#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdint>

// Native ABI, shared only by the current user's controller and the opted-in process.
// No clipboard content is written to this section.
constexpr uint32_t SakuraClipboardMagic = 0x53434c50;
constexpr uint32_t SakuraClipboardVersion = 1;
constexpr uint32_t CopyAllowed = 1, PasteAllowed = 2, FilesAllowed = 4, Sensitive = 8;
struct alignas(8) SakuraClipboardPolicy {
  uint32_t magic, version;
  volatile LONG sequence;
  uint32_t active, pid, flags, maxTextBytes;
  volatile LONG status;
  uint64_t creationTime;
  volatile LONG64 blockedCopy, blockedPaste;
  char build[65];
};
struct SakuraClipboardConfigure {
  uint32_t magic, version;
  wchar_t section[192];
};
inline uint64_t processCreation(HANDLE process) {
  FILETIME created{}, exited{}, kernel{}, user{};
  if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) return 0;
  return (uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime;
}
