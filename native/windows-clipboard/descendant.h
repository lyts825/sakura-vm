/**
 * 模块职责（中文）：定义后代端点和固定消息 ABI 及有界重叠传输。消息只传精确身份、授权和句柄 token，不传剪贴板内容；超时取消后等待 I/O 收束再释放资源。
 * Module responsibilities (English): Define descendant endpoint/fixed-message ABI and bounded overlapped transfer. Messages carry exact identity/authorization/handle tokens rather than clipboard contents; cancel and settle timed-out I/O before releasing resources.
 */
/** 后代代理独立 ABI：定义端点、精确句柄请求与回复；每次调用解析当前代理以支持服务重启后的恢复。 */
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

/** 中文：组合 owner 为代理端点映射名，调用者继续验证结构、构建与代理创建时间。 English: Build the owner-scoped broker endpoint name; callers still verify structure/build/broker creation time. 参数声明 / Declared parameters: const std::wstring& owner. */
inline std::wstring descendantEndpointName(const std::wstring& owner) {
  return L"Local\\SakuraClipboard.Descendants."+owner;
}
// Every pipe operation is bounded, including calls made in an application's
// import/TLS initializer. No same-process worker or loader-bound thread is used.
/** 中文：用重叠 I/O 有界收发完整固定尺寸消息，超时先取消并等待 I/O 收束后释放 event，短传输返回 false。 English: Boundedly transfer complete fixed-size messages with overlapped I/O, cancel/wait for settlement before event release on timeout and return false for short transfers. 参数声明 / Declared parameters: HANDLE pipe,void* data,DWORD size,bool writing,DWORD timeout=120000. */
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
