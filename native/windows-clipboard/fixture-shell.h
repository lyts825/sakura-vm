/**
 * 模块职责（中文）：共用 Shell 阶段结构、私有 station、UTF/JSON、管道和标准句柄证据工具；证据只描述自有夹具环境，不成为宽泛进程清理授权。
 * Module responsibilities (English): Share Shell phase structures/private station/UTF-JSON/pipe/standard-handle evidence helpers; evidence describes owned fixture environments and never grants broad cleanup authority.
 */
/** Shell 夹具共用的阶段证据与私有环境检查，供父进程、子进程及导入 DLL 共享。 */
#pragma once
#include "protocol.h"
#include "descendant-reservation.h"
#include <cstdio>
#include <cwchar>
#include <sstream>
#include <vector>

/** 中文：从控制器分别引用的命令行参数取得指定前缀值，缺少引号边界返回空。 English: Read a prefixed value from separately quoted controller arguments, returning empty without quote boundaries. 参数声明 / Declared parameters: const wchar_t* prefix. */
inline std::wstring shellArgument(const wchar_t* prefix) {
  const auto begin=std::wcsstr(GetCommandLineW(),prefix);
  if(!begin || begin==GetCommandLineW() || begin[-1]!=L'"')return {};
  const auto start=begin+std::wcslen(prefix),end=std::wcschr(start,L'"');
  return end?std::wstring(start,end):L"";
}
/** 中文：严格按 UTF-8 编码宽字符串，返回字节串供私有管道和 JSON 使用。 English: Encode wide text strictly as UTF-8 bytes for private-pipe/JSON use. 参数声明 / Declared parameters: const std::wstring& value. */
inline std::string shellUtf8(const std::wstring& value) {
  const int length=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value.data(),int(value.size()),nullptr,0,nullptr,nullptr);
  std::string result(length,'\0');if(length)WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value.data(),int(value.size()),result.data(),length,nullptr,nullptr);return result;
}
/** 中文：按严格 UTF-8 解码私有管道字段为宽字符串，供系统宽字符 API 使用。 English: Strictly decode private-pipe UTF-8 fields into wide text for Windows wide APIs. 参数声明 / Declared parameters: const std::string& value. */
inline std::wstring shellWide(const std::string& value) {
  const int length=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),int(value.size()),nullptr,0);
  std::wstring result(length,L'\0');if(length)MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),int(value.size()),result.data(),length);return result;
}
/** 中文：按 ACP 转换宽参数并保留末尾 NUL，供原 ANSI Shell API 的直接参数。 English: Convert wide parameters with ACP and retain trailing NUL for direct ANSI Shell API arguments. 参数声明 / Declared parameters: const std::wstring& value. */
inline std::string shellAnsi(const std::wstring& value) {
  const int length=WideCharToMultiByte(CP_ACP,0,value.c_str(),-1,nullptr,0,nullptr,nullptr);
  std::string result(length,'\0');if(length)WideCharToMultiByte(CP_ACP,0,value.c_str(),-1,result.data(),length,nullptr,nullptr);return result;
}
/** 中文：把 UTF-8 文本的引号、反斜杠和控制字节转义为一个 JSON 字符串值。 English: Escape UTF-8 quotes/backslashes/control bytes as one JSON string value. 参数声明 / Declared parameters: const std::wstring& value. */
inline std::string shellJson(const std::wstring& value) {
  std::string result="\"";
  for(unsigned char character:shellUtf8(value)){if(character=='\\' || character=='"')result+='\\';if(character<32){char escaped[8]{};std::snprintf(escaped,sizeof(escaped),"\\u%04x",unsigned(character));result+=escaped;}else result+=char(character);}return result+'"';
}
/** 中文：通过进程快照读取指定 PID 的父 PID 并关闭快照，仅作为证据而非清理授权。 English: Read a PID's parent PID from a process snapshot and close it, using this only as evidence rather than cleanup authority. 参数声明 / Declared parameters: DWORD pid. */
inline DWORD shellParent(DWORD pid) {
  DWORD result=0;HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);PROCESSENTRY32W entry{};entry.dwSize=sizeof(entry);
  if(snapshot!=INVALID_HANDLE_VALUE && Process32FirstW(snapshot,&entry))do{if(entry.th32ProcessID==pid){result=entry.th32ParentProcessID;break;}}while(Process32NextW(snapshot,&entry));
  if(snapshot!=INVALID_HANDLE_VALUE)CloseHandle(snapshot);return result;
}
/** 中文：读取精确进程句柄的完整映像，失败返回空，成功按实际长度裁剪。 English: Read an exact process handle's full image, return empty on failure and resize to actual length on success. 参数声明 / Declared parameters: HANDLE process. */
inline std::wstring shellImage(HANDLE process) {
  std::wstring result(32768,L'\0');DWORD length=DWORD(result.size());
  if(!QueryFullProcessImageNameW(process,0,result.data(),&length))return {};result.resize(length);return result;
}
/** 中文：要求指定 station 非 WinSta0，打开并核对实际名称后绑定 default desktop；无法确认私有环境立即退出夹具。 English: Require a non-WinSta0 station, open/verify its actual name and bind default desktop; exit immediately if the private environment cannot be confirmed. */
inline std::wstring shellPrivateStation() {
  const auto expected=shellArgument(L"--shell-station=");
  if(expected.empty() || CompareStringOrdinal(expected.c_str(),-1,L"WinSta0",-1,TRUE)==CSTR_EQUAL)ExitProcess(81);
  HWINSTA station=OpenWindowStationW(expected.c_str(),FALSE,WINSTA_ALL_ACCESS);wchar_t actual[256]{};DWORD bytes=0;
  if(!station || !SetProcessWindowStation(station) || !GetUserObjectInformationW(station,UOI_NAME,actual,sizeof(actual),&bytes) ||
      CompareStringOrdinal(actual,-1,expected.c_str(),-1,TRUE)!=CSTR_EQUAL)ExitProcess(82);
  HDESK desktop=OpenDesktopW(L"default",0,FALSE,GENERIC_ALL);
  if(!desktop || !SetThreadDesktop(desktop))ExitProcess(83);return actual;
}
struct ShellPhase {
  DWORD phase,pid,parent,thread,flags;
  uint64_t created;
  bool ready,active,library,build,anyJob,reserved,privateStation;
};
/** 中文：采集当前阶段 PID/创建时间、父线程、共享策略、DLL 构建、Job 和预约成员证据，先核验私有 station 并释放查询资源。 English: Collect phase PID/creation time/parent/thread/shared policy/DLL build/Job/reservation evidence after private-station checks and release query resources. 参数声明 / Declared parameters: DWORD phase. */
inline ShellPhase shellPhase(DWORD phase) {
  const auto station=shellPrivateStation(),owner=shellArgument(L"--shell-owner=");
  ShellPhase result{};result.phase=phase;result.pid=GetCurrentProcessId();result.parent=shellParent(result.pid);result.thread=GetCurrentThreadId();result.created=processCreation(GetCurrentProcess());result.privateStation=!station.empty();
  const auto name=L"Local\\SakuraClipboard."+owner+L"."+std::to_wstring(result.pid)+L"."+std::to_wstring(result.created);
  HANDLE section=OpenFileMappingW(FILE_MAP_READ,FALSE,name.c_str());
  const auto policy=section?static_cast<const SakuraClipboardPolicy*>(MapViewOfFile(section,FILE_MAP_READ,0,0,sizeof(SakuraClipboardPolicy))):nullptr;
  result.library=GetModuleHandleW(sizeof(void*)==8?L"SakuraClipboardPolicy.dll":L"SakuraClipboardPolicy-x86.dll")!=nullptr;
  if(policy){result.ready=result.library && policy->magic==SakuraClipboardMagic && policy->version==SakuraClipboardVersion && policy->pid==result.pid && policy->creationTime==result.created && policy->status==1 && !(policy->sequence&1);result.active=policy->active!=0;result.flags=policy->flags;result.build=std::memcmp(policy->build,SAKURA_CLIPBOARD_BUILD,65)==0;UnmapViewOfFile(policy);}
  if(section)CloseHandle(section);BOOL member=FALSE;result.anyJob=IsProcessInJob(GetCurrentProcess(),nullptr,&member) && member;
  try{result.reserved=descendantCreationPending(owner,result.pid,result.created);}catch(...){ExitProcess(84);}return result;
}
/** 中文：把单阶段固定证据编码为有界 JSON，对 64 位创建时间使用字符串保持精度。 English: Encode fixed phase evidence as bounded JSON with 64-bit creation time as a string to retain precision. 参数声明 / Declared parameters: const ShellPhase& phase. */
inline std::string shellPhaseJson(const ShellPhase& phase) {
  char text[768]{};std::snprintf(text,sizeof(text),"{\"phase\":%lu,\"pid\":%lu,\"parentPid\":%lu,\"thread\":%lu,\"created\":\"%llu\",\"flags\":%lu,\"ready\":%s,\"active\":%s,\"library\":%s,\"build\":%s,\"anyJob\":%s,\"creationReserved\":%s,\"privateStation\":%s}",phase.phase,phase.pid,phase.parent,phase.thread,static_cast<unsigned long long>(phase.created),phase.flags,phase.ready?"true":"false",phase.active?"true":"false",phase.library?"true":"false",phase.build?"true":"false",phase.anyJob?"true":"false",phase.reserved?"true":"false",phase.privateStation?"true":"false");return text;
}
/** 中文：完整写入私有响应，短写或 API 失败返回 false。 English: Write a complete private response, returning false for short writes/API failure. 参数声明 / Declared parameters: HANDLE pipe,const std::string& text. */
inline bool shellWrite(HANDLE pipe,const std::string& text) {DWORD count=0;return WriteFile(pipe,text.data(),DWORD(text.size()),&count,nullptr) && count==text.size();}
/** 中文：逐字节读取至换行，忽略 CR 并限制 32768 字节，断开或超限返回 false。 English: Read bytewise to newline, ignore CR and bound text to 32768 bytes, returning false on disconnect/overflow. 参数声明 / Declared parameters: HANDLE pipe,std::string& text. */
inline bool shellRead(HANDLE pipe,std::string& text) {text.clear();char c=0;DWORD count=0;while(ReadFile(pipe,&c,1,&count,nullptr) && count){if(c=='\n')return true;if(c!='\r')text+=c;if(text.size()>32768)return false;}return false;}
/** 中文：按 tab 分解私有命令字段，保留字段顺序交给上层严格数量校验。 English: Split private command fields by tab in order for strict caller count validation. 参数声明 / Declared parameters: const std::string& text. */
inline std::vector<std::string> shellFields(const std::string& text) {std::istringstream stream(text);std::vector<std::string> fields;std::string field;while(std::getline(stream,field,'\t'))fields.push_back(field);return fields;}
/** 中文：记录当前三个标准句柄有效性、类型及普通文件对象身份，不接管或关闭系统标准句柄。 English: Record validity/type/ordinary-file identity for three standard handles without taking ownership or closing them. */
inline std::string shellStandardHandles() {
  std::string result="[";unsigned index=0;
  for(DWORD kind:{DWORD(STD_INPUT_HANDLE),DWORD(STD_OUTPUT_HANDLE),DWORD(STD_ERROR_HANDLE)}){
    HANDLE handle=GetStdHandle(kind);BY_HANDLE_FILE_INFORMATION file{};const bool valid=handle && handle!=INVALID_HANDLE_VALUE;
    const bool ordinaryFile=valid && GetFileInformationByHandle(handle,&file);if(index++)result+=',';
    result+="{\"valid\":"+std::string(valid?"true":"false")+",\"type\":"+std::to_string(valid?GetFileType(handle):0)+",\"ordinaryFile\":"+(ordinaryFile?"true":"false")+",\"volume\":"+std::to_string(file.dwVolumeSerialNumber)+",\"indexHigh\":"+std::to_string(file.nFileIndexHigh)+",\"indexLow\":"+std::to_string(file.nFileIndexLow)+"}";
  }
  return result+']';
}
/** 中文：按三个明确私有文件参数创建可继承标准句柄并返回自有句柄列表；不完整参数返回已有列表，API 失败退出，调用者最终关闭。 English: Create inheritable standard handles from three explicit private-file arguments and return owned handles; incomplete arguments return the existing list, API failure exits and callers eventually close them. */
inline std::vector<HANDLE> shellSetOwnedStandardHandles() {
  std::vector<HANDLE> result;unsigned index=0;
  for(const wchar_t* argument:{L"--shell-stdin=",L"--shell-stdout=",L"--shell-stderr="}){
    const auto path=shellArgument(argument);if(path.empty())return result;
    SECURITY_ATTRIBUTES security{sizeof(security),nullptr,TRUE};HANDLE file=CreateFileW(path.c_str(),GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,&security,OPEN_ALWAYS,FILE_ATTRIBUTE_NORMAL,nullptr);
    if(file==INVALID_HANDLE_VALUE || !SetStdHandle(index==0?STD_INPUT_HANDLE:index==1?STD_OUTPUT_HANDLE:STD_ERROR_HANDLE,file))ExitProcess(97);
    result.push_back(file);++index;
  }
  return result;
}
#ifdef SHELL_PROBE_DLL
#define SHELL_PROBE_API __declspec(dllexport)
#else
#define SHELL_PROBE_API __declspec(dllimport)
#endif
/** 中文：在指定 DLL/TLS/入口阶段收集私有环境、策略和创建预约证据，结果存入模块静态数组。 English: Collect private-environment/policy/creation-reservation evidence at the DLL/TLS/entry phase into module static storage. 参数声明 / Declared parameters: DWORD phase. */
extern "C" SHELL_PROBE_API void WINAPI ShellRecord(DWORD phase);
/** 中文：返回指定阶段的静态 Shell 证据指针，越界返回空，存储归 DLL 所有。 English: Return a static Shell evidence pointer for the requested phase or null out of range, with storage owned by the DLL. 参数声明 / Declared parameters: DWORD phase. */
extern "C" SHELL_PROBE_API const ShellPhase* WINAPI ShellEvidence(DWORD phase);
