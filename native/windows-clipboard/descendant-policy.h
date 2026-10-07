/**
 * 模块职责（中文）：拦截普通进程创建，在系统创建前预绑定关闭即终止 Job 并固定文件和源 token；保持调用者原参数与暂停意图，通过精确代理确认后交付孩子，任何不可证明路径失败关闭。
 * Module responsibilities (English): Intercept ordinary process creation, prebind a kill-on-close Job and pin image/source token before OS creation; retain original arguments/suspension intent and deliver only after exact broker confirmation, refusing unprovable paths.
 */
/** 拦截常规 CreateProcess 系列入口，为子进程固定映像、预留 Job 并保持挂起，直到后代代理完成策略接管。 */
#pragma once
#include "descendant.h"
#include "descendant-reservation.h"
#include "descendant-token.h"
#include <memory>

/** 中文：保留宽字符 CreateProcess 的完整调用参数契约，受控路径仅包围授权、暂停和 Job 绑定。 English: Retain the complete wide CreateProcess calling contract, with controlled paths surrounding authorization/suspension/Job binding. 参数声明 / Declared parameters: LPCWSTR,LPWSTR,LPSECURITY_ATTRIBUTES,LPSECURITY_ATTRIBUTES,BOOL,DWORD,LPVOID,LPCWSTR,LPSTARTUPINFOW,LPPROCESS_INFORMATION. */
using DescendantCreateW=BOOL(WINAPI*)(LPCWSTR,LPWSTR,LPSECURITY_ATTRIBUTES,LPSECURITY_ATTRIBUTES,BOOL,DWORD,LPVOID,LPCWSTR,LPSTARTUPINFOW,LPPROCESS_INFORMATION);
/** 中文：保留 ANSI CreateProcess 的完整调用参数契约，避免在 hook 层改变调用者编码和参数 ABI。 English: Retain the complete ANSI CreateProcess calling contract without changing caller encoding/argument ABI at the hook layer. 参数声明 / Declared parameters: LPCSTR,LPSTR,LPSECURITY_ATTRIBUTES,LPSECURITY_ATTRIBUTES,BOOL,DWORD,LPVOID,LPCSTR,LPSTARTUPINFOA,LPPROCESS_INFORMATION. */
using DescendantCreateA=BOOL(WINAPI*)(LPCSTR,LPSTR,LPSECURITY_ATTRIBUTES,LPSECURITY_ATTRIBUTES,BOOL,DWORD,LPVOID,LPCSTR,LPSTARTUPINFOA,LPPROCESS_INFORMATION);
static DescendantCreateW originalProcessW=nullptr;
static DescendantCreateA originalProcessA=nullptr;
static decltype(&CreateProcessAsUserW) originalProcessAsUserW=nullptr;
static decltype(&CreateProcessAsUserA) originalProcessAsUserA=nullptr;
static decltype(&CreateProcessWithTokenW) originalProcessWithTokenW=nullptr;
static decltype(&CreateProcessWithLogonW) originalProcessWithLogonW=nullptr;
static thread_local unsigned descendantSystemDepth=0;
struct DescendantSystemScope {
  /** 中文：增加线程局部系统调用深度，原 API 内部调用重入时绕过重复代理而不影响其他线程。 English: Increment thread-local system-call depth so internal original-API reentry bypasses duplicate brokering without affecting other threads. */
  DescendantSystemScope(){++descendantSystemDepth;}
  /** 中文：递减本线程重入深度，恢复外层正常后代策略拦截。 English: Decrement this thread's reentry depth, restoring normal outer descendant interception. */
  ~DescendantSystemScope(){--descendantSystemDepth;}
};
struct DescendantFailure {
  DWORD error=ERROR_ACCESS_DENIED;
  bool failed=false;
  /** 中文：仅在失败标记成立时恢复保存的 Win32 错误，避免清理 API 覆盖真实创建失败原因。 English: Restore saved Win32 error only for marked failure so cleanup APIs cannot overwrite the actual creation error. */
  ~DescendantFailure(){if(failed)SetLastError(error);}
};
struct DescendantHandle {
  HANDLE value;
  /** 中文：保存本层独占的后代句柄，禁止复制使相同数字句柄不会被多次释放。 English: Retain this layer's exclusively owned descendant handle and prohibit copies to avoid repeated release. 参数声明 / Declared parameters: HANDLE input=nullptr. */
  explicit DescendantHandle(HANDLE input=nullptr):value(input){}
  /** 中文：关闭本层保留的有效精确句柄，失败路径展开也回收资源。 English: Close this layer's valid exact handle during normal destruction or failure unwinding. */
  ~DescendantHandle(){if(value && value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
  /** 中文：删除此类型的复制构造，避免裸句柄或自有缓冲区被多个对象重复释放；传入对象不能通过此声明复制。 English: Delete this type's copy constructor to prevent multiple objects releasing the same raw handle/owned buffer; the supplied object cannot be copied through this declaration. 参数声明 / Declared parameters: const DescendantHandle&. */
  DescendantHandle(const DescendantHandle&)=delete;
};
/** 中文：将 ANSI 参数按当前 ACP 转宽文本，空指针保留空值，转换失败抛错。 English: Convert ANSI arguments with current ACP, retain empty values for null pointers and throw on conversion failure. 参数声明 / Declared parameters: const char* value. */
static std::wstring descendantWide(const char* value) {
  if(!value)return {};
  const int size=MultiByteToWideChar(CP_ACP,0,value,-1,nullptr,0);
  if(size<=0)throw std::runtime_error("child ANSI path unavailable");
  std::wstring answer(size,L'\0');
  if(!MultiByteToWideChar(CP_ACP,0,value,-1,answer.data(),size))throw std::runtime_error("child ANSI path unavailable");
  answer.resize(size-1);return answer;
}
/** 中文：从固定文件句柄取规范 DOS 路径并移除长路径前缀，查询失败返回空值供上层拒绝。 English: Read normalized DOS paths from pinned files/remove the long-path prefix, returning empty on failure for caller refusal. 参数声明 / Declared parameters: HANDLE file. */
static std::wstring descendantFilePath(HANDLE file) {
  std::wstring path(32768,L'\0');
  const DWORD size=GetFinalPathNameByHandleW(file,path.data(),DWORD(path.size()),FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);
  if(!size || size>=path.size())return {};
  path.resize(size);if(path.rfind(L"\\\\?\\",0)==0)path.erase(0,4);return path;
}
// Pin possible executable resolutions before CreateProcess, then require that
// the OS-selected image is one of those exact locked files. This supports an
// explicit application name and the documented quoted/unquoted command search.
// A replacement cannot make the persisted digest describe a different image.
/** 中文：按显式应用名或文档化 EXE 搜索顺序打开候选，仅 FILE_SHARE_READ 保持字节与路径不被替换，拒绝目录及重解析点。 English: Open candidates by explicit app name/documented EXE search order with FILE_SHARE_READ to prevent byte/path replacement, rejecting directories/reparse points. 参数声明 / Declared parameters: const std::wstring& value,bool search. */
static HANDLE descendantPinCandidate(const std::wstring& value,bool search) {
  std::wstring name=value;
  const auto slash=name.find_last_of(L"\\/");
  if(name.find(L'.',slash==std::wstring::npos?0:slash+1)==std::wstring::npos)name+=L".exe";
  std::vector<std::wstring> paths;
  if(!search || name.find_first_of(L"\\/:")!=std::wstring::npos)paths.push_back(name);
  else {
    wchar_t folder[32768]{};
    DWORD length=GetModuleFileNameW(nullptr,folder,32768);
    if(length && length<32768){std::wstring parent(folder,length);const auto last=parent.find_last_of(L"\\/");if(last!=std::wstring::npos)paths.push_back(parent.substr(0,last+1)+name);}
    length=GetCurrentDirectoryW(32768,folder);if(length && length<32768)paths.push_back(std::wstring(folder,length)+L"\\"+name);
    length=GetSystemDirectoryW(folder,32768);if(length && length<32768)paths.push_back(std::wstring(folder,length)+L"\\"+name);
    length=GetWindowsDirectoryW(folder,32768);if(length && length<32768){paths.push_back(std::wstring(folder,length)+L"\\System\\"+name);paths.push_back(std::wstring(folder,length)+L"\\"+name);}
    length=GetEnvironmentVariableW(L"PATH",folder,32768);
    if(length && length<32768){std::wstring all(folder,length);size_t start=0;while(start<=all.size()){
      const auto end=all.find(L';',start);std::wstring part=all.substr(start,end==std::wstring::npos?end:end-start);
      if(part.size()>1 && part.front()==L'"' && part.back()==L'"')part=part.substr(1,part.size()-2);
      if(!part.empty())paths.push_back(part+L"\\"+name);
      if(end==std::wstring::npos)break;start=end+1;
    }}
  }
  for(const auto& path:paths) {
    HANDLE file=CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
    if(file!=INVALID_HANDLE_VALUE){BY_HANDLE_FILE_INFORMATION info{};if(GetFileInformationByHandle(file,&info) && !(info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT)))return file;CloseHandle(file);}
  }
  return nullptr;
}
struct DescendantPins {
  std::vector<HANDLE> files;
  /** 中文：关闭所有已固定候选文件，结束本次创建的映像约束寿命。 English: Close all pinned candidate files, ending this creation's image-constraint lifetime. */
  ~DescendantPins(){for(HANDLE file:files)CloseHandle(file);}
  /** 中文：把非空候选句柄纳入所有权集合，容器分配失败先关闭句柄再重抛。 English: Own a nonnull candidate handle, closing it before rethrow if collection allocation fails. 参数声明 / Declared parameters: HANDLE file. */
  void remember(HANDLE file) {
    if(!file)return;
    try{files.push_back(file);}catch(...){CloseHandle(file);throw;}
  }
  /** 中文：在原系统创建前解析显式/引号/非引号应用候选并固定实际可能选中的文件，不通过事后同名路径证明早期身份。 English: Resolve/pin explicit/quoted/unquoted executable candidates before original creation, without using a later same-name path as proof of early identity. 参数声明 / Declared parameters: const std::wstring& application,const std::wstring& command. */
  DescendantPins(const std::wstring& application,const std::wstring& command) {
    if(!application.empty()){remember(descendantPinCandidate(application,false));return;}
    size_t start=command.find_first_not_of(L" \t");if(start==std::wstring::npos)return;
    if(command[start]==L'"') {
      const auto end=command.find(L'"',start+1);
      if(end!=std::wstring::npos)remember(descendantPinCandidate(command.substr(start+1,end-start-1),true));
      return;
    }
    for(size_t end=start;end<=command.size() && files.size()<64;++end) {
      if(end<command.size() && command[end]!=L' ' && command[end]!=L'\t')continue;
      if(end>start)remember(descendantPinCandidate(command.substr(start,end-start),true));
      if(files.size() || end==command.size())break;
    }
  }
  /** 中文：把实际子进程映像路径与已锁候选最终路径比较，返回匹配的原文件句柄；没有匹配拒绝受控接管。 English: Compare the child's actual image with pinned candidates' final paths and return the original matching file handle; absence rejects controlled takeover. 参数声明 / Declared parameters: HANDLE process. */
  HANDLE matching(HANDLE process) {
    std::wstring image(32768,L'\0');DWORD size=DWORD(image.size());
    if(!QueryFullProcessImageNameW(process,0,image.data(),&size))return nullptr;image.resize(size);
    for(HANDLE file:files){const auto path=descendantFilePath(file);if(!path.empty() && CompareStringOrdinal(path.c_str(),-1,image.c_str(),-1,TRUE)==CSTR_EQUAL)return file;}
    return nullptr;
  }
};
struct DescendantAttributes {
  LPPROC_THREAD_ATTRIBUTE_LIST value;
  /** 中文：调用 DeleteProcThreadAttributeList 释放本层创建的属性表，不接管 caller 的不透明属性。 English: Delete this layer's created attribute list without taking ownership of the caller's opaque attributes. */
  ~DescendantAttributes(){if(value)DeleteProcThreadAttributeList(value);}
};
#include "shell-policy.h"
template<class Startup,class Extended,class Call>
/** 中文：只支持可证明的常规 startup 或本 Shell scope 来源表；创建前放入预留 Job并固定候选，强制子挂起并核对实际映像/令牌，再向精确 broker 交付句柄。只有服务回复已提交才返回子句柄，失败终止本次精确子，caller 的原 suspended 意图保留。 English: Support only provable ordinary startup or this Shell scope's source table. Reserve a creation-time Job/pin candidates, force suspension/check actual image-token and hand exact handles to the pinned broker. Return child handles only after committed service reply; fail by terminating this exact child while retaining caller suspension intent. 参数声明 / Declared parameters: const std::wstring& application,const std::wstring& command,DWORD flags, Startup* startup,PROCESS_INFORMATION* output,Call call,const DescendantToken* token=nullptr. */
static BOOL descendantCreate(const std::wstring& application,const std::wstring& command,DWORD flags,
    Startup* startup,PROCESS_INFORMATION* output,Call call,const DescendantToken* token=nullptr) {
  if(!current().active){if(shellScope){SetLastError(ERROR_ACCESS_DENIED);return FALSE;}return call(flags,startup,output);}
  // Windows exposes no API for cloning an opaque caller attribute list and
  // adding a creation-time Job. Refuse that unsupported path explicitly.
  const bool shellExtended=shellScope && startup && startup->cb==sizeof(Extended) && (flags&EXTENDED_STARTUPINFO_PRESENT);
  if(!startup || !output || (shellScope && !shellExtended) || (!shellExtended && startup->cb!=sizeof(Startup)) ||
      flags&(DEBUG_PROCESS|DEBUG_ONLY_THIS_PROCESS) || ((flags&EXTENDED_STARTUPINFO_PRESENT) && !shellExtended)){
    SetLastError(ERROR_NOT_SUPPORTED);return FALSE;
  }
  ShellAttributeLedger::Pointer shellTable;
  if(shellExtended){
    if(!shellScope->sourceValid() || !(shellTable=shellAttributes.claim(reinterpret_cast<Extended*>(startup)->lpAttributeList,shellScope->generation,GetCurrentThreadId()))){SetLastError(ERROR_NOT_SUPPORTED);return FALSE;}
  }
  DescendantFailure result;
  DWORD failure=ERROR_ACCESS_DENIED;PROCESS_INFORMATION child{};
  DescendantHandle job,pipe,broker,endpointSection;
  std::unique_ptr<DescendantReservation> reservation;
  try {
    const std::wstring prefix=L"Local\\SakuraClipboard.";
    if(sectionName.rfind(prefix,0)!=0 || sectionName.size()<prefix.size()+37)throw std::runtime_error("child policy owner unavailable");
    const auto name=descendantEndpointName(sectionName.substr(prefix.size(),36));
    endpointSection.value=OpenFileMappingW(FILE_MAP_READ,FALSE,name.c_str());
    if(!endpointSection.value)throw std::runtime_error("child policy broker unavailable");
    const auto data=static_cast<const SakuraDescendantEndpoint*>(MapViewOfFile(endpointSection.value,FILE_MAP_READ,0,0,sizeof(SakuraDescendantEndpoint)));
    if(!data)throw std::runtime_error("child broker endpoint unavailable");
    const SakuraDescendantEndpoint endpoint=*data;UnmapViewOfFile(data);
    CloseHandle(endpointSection.value);endpointSection.value=nullptr;
    if(endpoint.magic!=SakuraDescendantMagic || endpoint.version!=SakuraDescendantVersion || endpoint.reserved ||
        !endpoint.pid || !endpoint.creationTime || std::memcmp(endpoint.build,SAKURA_CLIPBOARD_BUILD,65) ||
        std::find(endpoint.pipe,endpoint.pipe+192,L'\0')==endpoint.pipe+192)throw std::runtime_error("child broker endpoint differs");
    broker.value=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,endpoint.pid);
    if(!broker.value || processCreation(broker.value)!=endpoint.creationTime || WaitForSingleObject(broker.value,0)!=WAIT_TIMEOUT)
      throw std::runtime_error("child broker identity changed");
    for(unsigned attempt=0;attempt<8;++attempt){
      pipe.value=CreateFileW(endpoint.pipe,GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,FILE_FLAG_OVERLAPPED|SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION,nullptr);
      if(pipe.value!=INVALID_HANDLE_VALUE)break;
      if(GetLastError()!=ERROR_PIPE_BUSY || !WaitNamedPipeW(endpoint.pipe,5000))break;
    }
    ULONG serverPid=0;
    if(pipe.value==INVALID_HANDLE_VALUE || !GetNamedPipeServerProcessId(pipe.value,&serverPid) || serverPid!=endpoint.pid ||
        processCreation(broker.value)!=endpoint.creationTime)throw std::runtime_error("child pipe owner differs");
    reservation=std::make_unique<DescendantReservation>(sectionName.substr(prefix.size(),36));
    job.value=reservation->releaseJob();
    SIZE_T size=0;std::vector<unsigned char> storage;DescendantAttributes attributeOwner{nullptr};
    Extended extended{};extended.StartupInfo=*startup;extended.StartupInfo.cb=sizeof(Extended);
    BOOL assigned=FALSE;
    if(shellExtended){
      if(!shellScope->sourceValid())throw std::runtime_error("Shell source policy changed before attributes");
      extended.lpAttributeList=reinterpret_cast<Extended*>(startup)->lpAttributeList;
      assigned=shellAttributes.append(shellTable,job.value,originalShellUpdate);
    }else{
      InitializeProcThreadAttributeList(nullptr,1,0,&size);storage.resize(size);
      auto attributes=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
      if(!size || !InitializeProcThreadAttributeList(attributes,1,0,&size))throw std::runtime_error("child attributes unavailable");
      attributeOwner.value=attributes;extended.lpAttributeList=attributes;
      assigned=UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,&job.value,sizeof(HANDLE),nullptr,nullptr);
    }
    DescendantPins pins(application,command);
    BOOL created=FALSE;
    if(assigned){
      if(token)token->verifySource();DescendantSystemScope systemCall;
      /** 中文：在原 CreateProcess 调用前复核 Shell source，附加 CREATE_SUSPENDED和创建时 Job 属性；原调用同步部分受 ledger 锁保护。 English: Recheck Shell source immediately before original CreateProcess and add CREATE_SUSPENDED/creation-time Job attributes; ledger lock protects the synchronous original call. */
      const auto create=[&]{if(shellExtended && !shellScope->sourceValid()){SetLastError(ERROR_ACCESS_DENIED);return FALSE;}return call(flags|CREATE_SUSPENDED|EXTENDED_STARTUPINFO_PRESENT,shellExtended?startup:&extended.StartupInfo,&child);};
      created=shellExtended?shellAttributes.invoke(shellTable,child,create):create();
    }
    failure=GetLastError();if(attributeOwner.value){DeleteProcThreadAttributeList(attributeOwner.value);attributeOwner.value=nullptr;}
    if(!created){result.failed=true;result.error=failure;return FALSE;}
    failure=ERROR_ACCESS_DENIED;
    if(shellExtended && (!shellScope->matches(child.hProcess) || !shellAttributes.created(shellTable)))throw std::runtime_error("Shell creation identity or attribute lifetime changed");
    if(token)token->verifyChild(child.hProcess);
    HANDLE imageFile=pins.matching(child.hProcess);
    if(!imageFile)throw std::runtime_error("OS-selected child image was not locked before creation");
    SakuraDescendantRequest request{SakuraDescendantMagic,SakuraDescendantVersion,GetCurrentProcessId(),(flags&CREATE_SUSPENDED)?1u:0u,
      processCreation(GetCurrentProcess()),uint64_t(uintptr_t(child.hProcess)),uint64_t(uintptr_t(child.hThread)),uint64_t(uintptr_t(job.value)),uint64_t(uintptr_t(imageFile))};
    if(!descendantTransfer(pipe.value,&request,sizeof(request),true))throw std::runtime_error("child handoff unavailable");
    SakuraDescendantReply reply{};
    if(!descendantTransfer(pipe.value,&reply,sizeof(reply),false) || reply.magic!=SakuraDescendantMagic || reply.version!=SakuraDescendantVersion || reply.reserved || reply.error)throw std::runtime_error("child policy was not committed");
    uint32_t acknowledged=SakuraDescendantMagic;
    descendantTransfer(pipe.value,&acknowledged,sizeof(acknowledged),true,5000);
    if(shellExtended && !shellAttributes.commit(shellTable))throw std::runtime_error("Shell attribute lifetime changed before commit");
    *output=child;return TRUE;
  } catch(...) {
    if(child.hProcess){sakuraTerminateOwnedChild(job.value,child.hProcess);CloseHandle(child.hThread);CloseHandle(child.hProcess);}
    result.failed=true;result.error=failure;return FALSE;
  }
}
/** 中文：宽字符 CreateProcess 钩子保留原参数，系统内部重入或非活动策略直接委托，否则进入固定映像、预留 Job和代理提交。 English: Preserve wide CreateProcess arguments, delegate system reentry/inactive policy directly and otherwise use pinned-image/reservation-Job/broker commit handling. 参数声明 / Declared parameters: LPCWSTR application,LPWSTR command,LPSECURITY_ATTRIBUTES processSecurity,LPSECURITY_ATTRIBUTES threadSecurity, BOOL inherit,DWORD flags,LPVOID environment,LPCWSTR directory,LPSTARTUPINFOW startup,LPPROCESS_INFORMATION output. */
static BOOL WINAPI descendantCreateW(LPCWSTR application,LPWSTR command,LPSECURITY_ATTRIBUTES processSecurity,LPSECURITY_ATTRIBUTES threadSecurity,
    BOOL inherit,DWORD flags,LPVOID environment,LPCWSTR directory,LPSTARTUPINFOW startup,LPPROCESS_INFORMATION output) {
  if(descendantSystemDepth || (!shellScope && !current().active))return originalProcessW(application,command,processSecurity,threadSecurity,inherit,flags,environment,directory,startup,output);
  try{return descendantCreate<STARTUPINFOW,STARTUPINFOEXW>(application?application:L"",command?command:L"",flags,startup,output,
    [&](DWORD actual,LPSTARTUPINFOW info,LPPROCESS_INFORMATION result){return originalProcessW(application,command,processSecurity,threadSecurity,inherit,actual,environment,directory,info,result);});}
  catch(...){SetLastError(ERROR_ACCESS_DENIED);return FALSE;}
}
/** 中文：ANSI CreateProcess 钩子仅转换身份检查所需路径，原参数仍交给原 API，受控创建共用同一挂起/提交边界。 English: Convert only paths needed for identity checks in the ANSI hook while retaining original API arguments/shared suspended-commit boundaries. 参数声明 / Declared parameters: LPCSTR application,LPSTR command,LPSECURITY_ATTRIBUTES processSecurity,LPSECURITY_ATTRIBUTES threadSecurity, BOOL inherit,DWORD flags,LPVOID environment,LPCSTR directory,LPSTARTUPINFOA startup,LPPROCESS_INFORMATION output. */
static BOOL WINAPI descendantCreateA(LPCSTR application,LPSTR command,LPSECURITY_ATTRIBUTES processSecurity,LPSECURITY_ATTRIBUTES threadSecurity,
    BOOL inherit,DWORD flags,LPVOID environment,LPCSTR directory,LPSTARTUPINFOA startup,LPPROCESS_INFORMATION output) {
  if(descendantSystemDepth || (!shellScope && !current().active))return originalProcessA(application,command,processSecurity,threadSecurity,inherit,flags,environment,directory,startup,output);
  try{return descendantCreate<STARTUPINFOA,STARTUPINFOEXA>(descendantWide(application),descendantWide(command),flags,startup,output,
    [&](DWORD actual,LPSTARTUPINFOA info,LPPROCESS_INFORMATION result){return originalProcessA(application,command,processSecurity,threadSecurity,inherit,actual,environment,directory,info,result);});}
  catch(...){SetLastError(ERROR_ACCESS_DENIED);return FALSE;}
}
/** 中文：固定并校验显式或允许的隐式用户令牌后调用宽字符原 API，源与实际子令牌需一致，不改变 token 权限掩码。 English: Pin/validate explicit or allowed implicit user tokens for the wide API, requiring source/actual child identity consistency without altering token access masks. 参数声明 / Declared parameters: HANDLE token,LPCWSTR application,LPWSTR command,LPSECURITY_ATTRIBUTES processSecurity,LPSECURITY_ATTRIBUTES threadSecurity, BOOL inherit,DWORD flags,LPVOID environment,LPCWSTR directory,LPSTARTUPINFOW startup,LPPROCESS_INFORMATION output. */
static BOOL WINAPI descendantCreateAsUserW(HANDLE token,LPCWSTR application,LPWSTR command,LPSECURITY_ATTRIBUTES processSecurity,LPSECURITY_ATTRIBUTES threadSecurity,
    BOOL inherit,DWORD flags,LPVOID environment,LPCWSTR directory,LPSTARTUPINFOW startup,LPPROCESS_INFORMATION output) {
  if(descendantSystemDepth || (!shellScope && !current().active))return originalProcessAsUserW(token,application,command,processSecurity,threadSecurity,inherit,flags,environment,directory,startup,output);
  try{
    DescendantToken identity(token,true);
    return descendantCreate<STARTUPINFOW,STARTUPINFOEXW>(application?application:L"",command?command:L"",flags,startup,output,
      [&](DWORD actual,LPSTARTUPINFOW info,LPPROCESS_INFORMATION result){return originalProcessAsUserW(identity.argument(),application,command,processSecurity,threadSecurity,inherit,actual,environment,directory,info,result);},&identity);
  }catch(...){SetLastError(ERROR_ACCESS_DENIED);return FALSE;}
}
/** 中文：保留 ANSI 参数并固定指定用户令牌，前后核对身份后共用受控创建流程。 English: Retain ANSI arguments/pin the user token and share controlled creation after identity checks around the call. 参数声明 / Declared parameters: HANDLE token,LPCSTR application,LPSTR command,LPSECURITY_ATTRIBUTES processSecurity,LPSECURITY_ATTRIBUTES threadSecurity, BOOL inherit,DWORD flags,LPVOID environment,LPCSTR directory,LPSTARTUPINFOA startup,LPPROCESS_INFORMATION output. */
static BOOL WINAPI descendantCreateAsUserA(HANDLE token,LPCSTR application,LPSTR command,LPSECURITY_ATTRIBUTES processSecurity,LPSECURITY_ATTRIBUTES threadSecurity,
    BOOL inherit,DWORD flags,LPVOID environment,LPCSTR directory,LPSTARTUPINFOA startup,LPPROCESS_INFORMATION output) {
  if(descendantSystemDepth || (!shellScope && !current().active))return originalProcessAsUserA(token,application,command,processSecurity,threadSecurity,inherit,flags,environment,directory,startup,output);
  try{
    DescendantToken identity(token,true);
    return descendantCreate<STARTUPINFOA,STARTUPINFOEXA>(descendantWide(application),descendantWide(command),flags,startup,output,
      [&](DWORD actual,LPSTARTUPINFOA info,LPPROCESS_INFORMATION result){return originalProcessAsUserA(identity.argument(),application,command,processSecurity,threadSecurity,inherit,actual,environment,directory,info,result);},&identity);
  }catch(...){SetLastError(ERROR_ACCESS_DENIED);return FALSE;}
}
/** 中文：活动策略下先核验指定 primary token，再因实际 API 不支持带 Job 的扩展 startup 返回 NOT_SUPPORTED；不能先创建再绑定 Job。非活动或系统重入仍委托原 API。 English: Under active policy validate the supplied primary token then return NOT_SUPPORTED because the actual API rejects Job-bearing extended startup; never create before Job assignment. Delegate the original API when inactive or internally reentered. 参数声明 / Declared parameters: HANDLE token,DWORD logon,LPCWSTR application,LPWSTR command,DWORD flags, LPVOID environment,LPCWSTR directory,LPSTARTUPINFOW startup,LPPROCESS_INFORMATION output. */
static BOOL WINAPI descendantCreateWithTokenW(HANDLE token,DWORD logon,LPCWSTR application,LPWSTR command,DWORD flags,
    LPVOID environment,LPCWSTR directory,LPSTARTUPINFOW startup,LPPROCESS_INFORMATION output) {
  if(descendantSystemDepth || (!shellScope && !current().active))return originalProcessWithTokenW(token,logon,application,command,flags,environment,directory,startup,output);
  try{DescendantToken identity(token,false);}catch(...){SetLastError(ERROR_ACCESS_DENIED);return FALSE;}
  // The documented extended structure is rejected with ERROR_INVALID_PARAMETER
  // by the actual WithToken implementation on the verified host, even with an
  // empty attribute list. Never create first and assign a Job afterward.
  SetLastError(ERROR_NOT_SUPPORTED);return FALSE;
}
/** 中文：活动策略下因 WithLogon 不支持带 Job 的扩展 startup 直接返回 NOT_SUPPORTED，不尝试认证、配置文件或网络副作用；非活动或系统重入委托原 API。 English: Under active policy return NOT_SUPPORTED because WithLogon does not support Job-bearing extended startup, without attempting authentication/profile/network side effects; delegate when inactive or internally reentered. 参数声明 / Declared parameters: LPCWSTR user,LPCWSTR domain,LPCWSTR password,DWORD logon,LPCWSTR application,LPWSTR command,DWORD flags, LPVOID environment,LPCWSTR directory,LPSTARTUPINFOW startup,LPPROCESS_INFORMATION output. */
static BOOL WINAPI descendantCreateWithLogonW(LPCWSTR user,LPCWSTR domain,LPCWSTR password,DWORD logon,LPCWSTR application,LPWSTR command,DWORD flags,
    LPVOID environment,LPCWSTR directory,LPSTARTUPINFOW startup,LPPROCESS_INFORMATION output) {
  if(descendantSystemDepth || (!shellScope && !current().active))return originalProcessWithLogonW(user,domain,password,logon,application,command,flags,environment,directory,startup,output);
  // WithLogon documents STARTUPINFO only and the verified system rejects the
  // Job-bearing extended form. No authentication, profile or network side
  // effect is attempted while the controlled policy is active.
  SetLastError(ERROR_NOT_SUPPORTED);return FALSE;
}
