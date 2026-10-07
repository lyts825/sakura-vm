/**
 * 模块职责（中文）：定义 Detours 早期载荷 GUID 与跨架构固定 ABI，绑定构建、进程创建时间和策略段。载荷在服务持久接管暂停孩子后复制，原应用导入初始化前验证。
 * Module responsibilities (English): Define the Detours early-payload GUID/fixed cross-architecture ABI binding build/process creation time/policy section, copied after durable service ownership and verified before original application imports initialize.
 */
/** Detours 早期导入载荷 ABI，绑定策略段、进程创建时间和构建摘要，用于原应用初始化代码运行前配置策略。 */
#pragma once
#include "protocol.h"
#include "vendor/detours/src/detours.h"

// The controller copies this payload only after the service durably owns the
// suspended child and authorizes attachment. It contains no clipboard content.
constexpr GUID SakuraClipboardEarlyGuid = {
  0x0517e630,0x55cd,0x41b0,{0xaf,0x0a,0x1b,0x83,0x4e,0xf0,0x39,0x35}
};
struct alignas(8) SakuraClipboardEarly {
  uint32_t magic,version,pid,reserved;
  uint64_t creationTime;
  char build[65];
  wchar_t section[192];
};
static_assert(sizeof(SakuraClipboardEarly)==480,"The early configuration must have the same ABI on x64 and x86");
