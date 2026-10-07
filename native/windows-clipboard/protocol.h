/**
 * 模块职责（中文）：定义 x86/x64 一致的共享策略 ABI、方向标志、创建身份和显式 EXE argv 引用；共享段只包含授权/状态/计数，不包含剪贴板正文。
 * Module responsibilities (English): Define identical x86/x64 shared policy ABI/direction flags/creation identity/explicit EXE argv quoting, with sections carrying authorization/status/counters rather than clipboard text.
 */
/** Windows 剪贴板共享策略 ABI、方向标志及进程创建时间工具，连接控制器、注入库和验证夹具。 */
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
/** 中文：按 Windows CRT 反斜杠与引号规则编码一个 argv 元素，包含空参数和末尾反斜杠；结果用于显式 EXE 的命令行而非 shell。 English: Encode one argv element using Windows CRT backslash/quote rules, including empty values/trailing slashes, for an explicit EXE command line rather than a shell. 参数声明 / Declared parameters: const std::wstring& value. */
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
/** 中文：返回精确进程句柄的 FILETIME 创建时间，失败返回零；与 PID 一起区分复用的进程身份。 English: Return FILETIME creation time for an exact process handle, or zero on failure, pairing it with PID to distinguish reused identities. 参数声明 / Declared parameters: HANDLE process. */
inline uint64_t processCreation(HANDLE process) {
  FILETIME created{}, exited{}, kernel{}, user{};
  if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) return 0;
  return (uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime;
}
