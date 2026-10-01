#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdint>
#include <string>

// Native ABI, shared only by the current user's controller and the opted-in process.
// No clipboard content is written to this section.
constexpr uint32_t SakuraClipboardMagic = 0x53434c50;
constexpr uint32_t SakuraClipboardVersion = 1;
constexpr uint32_t CopyAllowed = 1, PasteAllowed = 2, FilesAllowed = 4, Sensitive = 8;
constexpr unsigned SakuraClipboardLaunchArguments = 64;
constexpr unsigned SakuraClipboardLaunchCharacters = 8192;

// CreateProcessW receives an explicit executable and one command line, never a shell.
// Quote each argv element using the Windows CRT backslash/quote rules.
inline std::wstring clipboardArgument(const std::wstring& value) {
  std::wstring output=L"\"";
  size_t slashes=0;
  for (const wchar_t character:value) {
    if (character==L'\\') { ++slashes; continue; }
    if (character==L'\"') output.append(slashes*2+1,L'\\');
    else output.append(slashes,L'\\');
    slashes=0; output+=character;
  }
  output.append(slashes*2,L'\\'); output+=L'\"';
  return output;
}
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
static_assert(sizeof(SakuraClipboardPolicy)==128, "The shared policy must have the same ABI in x64 and x86 controllers");
inline uint64_t processCreation(HANDLE process) {
  FILETIME created{}, exited{}, kernel{}, user{};
  if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) return 0;
  return (uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime;
}
