/**
 * 模块职责（中文）：定义跨 DLL/EXE 初始化证据和导入/导出契约，参数解析仅接受控制器已单独引用的有界值，不调用 shell 或加载器。
 * Module responsibilities (English): Define DLL/EXE initialization evidence/import-export contracts, accepting only separately quoted bounded controller arguments without a shell/loader.
 */
/** 早期初始化夹具的公共探针与证据结构，统一核对私有桌面和 Win32/OLE 剪贴板结果。 */
#pragma once
#include "protocol.h"
#include <ole2.h>
#include <cwchar>

struct SakuraEarlyEvidence {
  uint32_t phase,pid,thread,flags;
  uint64_t created;
  LONG ready,active,privateStation,systemUser32,systemOle32,protectedCommonControls;
  wchar_t commonControlsPath[MAX_PATH];
  DWORD copyError,pasteError;
  HRESULT oleCopy,olePaste;
  LONG64 copies,pastes;
};
#ifdef SAKURA_EARLY_DLL
#define SAKURA_EARLY_API __declspec(dllexport)
#else
#define SAKURA_EARLY_API __declspec(dllimport)
#endif
/** 中文：在给定初始化阶段核验私有 station 并记录真实 Win32/OLE 调用和共享策略证据，存储由探针 DLL 持有。 English: Validate private station and record actual Win32/OLE/shared-policy evidence at the requested initialization phase in probe-DLL-owned storage. 参数声明 / Declared parameters: unsigned phase. */
extern "C" SAKURA_EARLY_API void WINAPI SakuraEarlyRecord(unsigned phase);
/** 中文：返回 0–3 阶段的稳定证据指针，越界返回空，调用者不释放 DLL 静态存储。 English: Return a stable evidence pointer for phases 0–3 or null outside the range; callers do not free DLL static storage. 参数声明 / Declared parameters: unsigned phase. */
extern "C" SAKURA_EARLY_API const SakuraEarlyEvidence* WINAPI SakuraEarlyEvidenceAt(unsigned phase);
// Test-only arguments are always separately quoted by the real controller.
// Parsing uses only the already-initialized CRT/Kernel32; no shell or loader call.
/** 中文：仅解析控制器单独引号包围的前缀参数，要求非空且能放入包含终止符的输出容量；不用 shell 或加载器。 English: Parse only separately quoted controller prefix arguments, requiring nonempty text fitting the terminated output capacity without using a shell/loader. 参数声明 / Declared parameters: const wchar_t* prefix,wchar_t* out,size_t maximum. */
inline bool earlyArgument(const wchar_t* prefix,wchar_t* out,size_t maximum) {
  const wchar_t* text=std::wcsstr(GetCommandLineW(),prefix);
  if(!text || text==GetCommandLineW() || text[-1]!=L'"')return false;
  text+=std::wcslen(prefix);
  const wchar_t* end=std::wcschr(text,L'"');
  if(!end || end==text || size_t(end-text)>=maximum)return false;
  std::wmemcpy(out,text,size_t(end-text));out[end-text]=0;return true;
}
