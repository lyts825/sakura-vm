#pragma once
#include "protocol.h"

// Separate from the stable clipboard ABI. Every opted-in process resolves the
// current broker on each call, so a service restart can recover the same owner.
constexpr uint32_t SakuraDescendantMagic=0x53434453;
constexpr uint32_t SakuraDescendantVersion=1;
struct alignas(8) SakuraDescendantEndpoint {
  uint32_t magic,version,pid,reserved;
  uint64_t creationTime;
  char build[65];
  wchar_t pipe[192];
};
struct alignas(8) SakuraDescendantRequest {
  uint32_t magic,version,parentPid,suspended;
  // These values belong to the authenticated pipe caller. The broker copies
  // them itself; a failed/ambiguous send never transfers handle-close ownership.
  uint64_t parentCreated,process,thread,job,file;
};
struct SakuraDescendantReply { uint32_t magic,version,error,reserved; };
static_assert(sizeof(SakuraDescendantEndpoint)==480,"Descendant endpoint ABI");
static_assert(sizeof(SakuraDescendantRequest)==56,"Descendant handle ABI");

inline std::wstring descendantEndpointName(const std::wstring& owner) {
  return L"Local\\SakuraClipboard.Descendants."+owner;
}
// Every pipe operation is bounded, including calls made in an application's
// import/TLS initializer. No same-process worker or loader-bound thread is used.
inline bool descendantTransfer(HANDLE pipe,void* data,DWORD size,bool writing,DWORD timeout=120000) {
  HANDLE event=CreateEventW(nullptr,TRUE,FALSE,nullptr);
  if(!event)return false;
  OVERLAPPED operation{};operation.hEvent=event;DWORD count=0;
  const BOOL started=writing?WriteFile(pipe,data,size,&count,&operation):ReadFile(pipe,data,size,&count,&operation);
  bool good=started && count==size;
  if(!started && GetLastError()==ERROR_IO_PENDING) {
    good=WaitForSingleObject(event,timeout)==WAIT_OBJECT_0 && GetOverlappedResult(pipe,&operation,&count,FALSE) && count==size;
    if(!good){CancelIoEx(pipe,&operation);WaitForSingleObject(event,INFINITE);}
  }
  CloseHandle(event);return good;
}
