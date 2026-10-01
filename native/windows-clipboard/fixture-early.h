#pragma once
#include "protocol.h"
#include <ole2.h>
#include <cwchar>

struct SakuraEarlyEvidence {
  uint32_t phase,pid,thread,flags;
  uint64_t created;
  LONG ready,active,privateStation,systemUser32,systemOle32;
  DWORD copyError,pasteError;
  HRESULT oleCopy,olePaste;
  LONG64 copies,pastes;
};
#ifdef SAKURA_EARLY_DLL
#define SAKURA_EARLY_API __declspec(dllexport)
#else
#define SAKURA_EARLY_API __declspec(dllimport)
#endif
extern "C" SAKURA_EARLY_API void WINAPI SakuraEarlyRecord(unsigned phase);
extern "C" SAKURA_EARLY_API const SakuraEarlyEvidence* WINAPI SakuraEarlyEvidenceAt(unsigned phase);
// Test-only arguments are always separately quoted by the real controller.
// Parsing uses only the already-initialized CRT/Kernel32; no shell or loader call.
inline bool earlyArgument(const wchar_t* prefix,wchar_t* out,size_t maximum) {
  const wchar_t* text=std::wcsstr(GetCommandLineW(),prefix);
  if(!text || text==GetCommandLineW() || text[-1]!=L'"')return false;
  text+=std::wcslen(prefix);
  const wchar_t* end=std::wcschr(text,L'"');
  if(!end || end==text || size_t(end-text)>=maximum)return false;
  std::wmemcpy(out,text,size_t(end-text));out[end-text]=0;return true;
}
