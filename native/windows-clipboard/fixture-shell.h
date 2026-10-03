#pragma once
#include "protocol.h"
#include "descendant-reservation.h"
#include <cstdio>
#include <cwchar>
#include <sstream>
#include <vector>

inline std::wstring shellArgument(const wchar_t* prefix) {
  const auto begin=std::wcsstr(GetCommandLineW(),prefix);
  if(!begin || begin==GetCommandLineW() || begin[-1]!=L'"')return {};
  const auto start=begin+std::wcslen(prefix),end=std::wcschr(start,L'"');
  return end?std::wstring(start,end):L"";
}
inline std::string shellUtf8(const std::wstring& value) {
  const int length=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value.data(),int(value.size()),nullptr,0,nullptr,nullptr);
  std::string result(length,'\0');if(length)WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value.data(),int(value.size()),result.data(),length,nullptr,nullptr);return result;
}
inline std::wstring shellWide(const std::string& value) {
  const int length=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),int(value.size()),nullptr,0);
  std::wstring result(length,L'\0');if(length)MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),int(value.size()),result.data(),length);return result;
}
inline std::string shellAnsi(const std::wstring& value) {
  const int length=WideCharToMultiByte(CP_ACP,0,value.c_str(),-1,nullptr,0,nullptr,nullptr);
  std::string result(length,'\0');if(length)WideCharToMultiByte(CP_ACP,0,value.c_str(),-1,result.data(),length,nullptr,nullptr);return result;
}
inline std::string shellJson(const std::wstring& value) {
  std::string result="\"";
  for(unsigned char character:shellUtf8(value)){if(character=='\\' || character=='"')result+='\\';if(character<32){char escaped[8]{};std::snprintf(escaped,sizeof(escaped),"\\u%04x",unsigned(character));result+=escaped;}else result+=char(character);}return result+'"';
}
inline DWORD shellParent(DWORD pid) {
  DWORD result=0;HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);PROCESSENTRY32W entry{};entry.dwSize=sizeof(entry);
  if(snapshot!=INVALID_HANDLE_VALUE && Process32FirstW(snapshot,&entry))do{if(entry.th32ProcessID==pid){result=entry.th32ParentProcessID;break;}}while(Process32NextW(snapshot,&entry));
  if(snapshot!=INVALID_HANDLE_VALUE)CloseHandle(snapshot);return result;
}
inline std::wstring shellImage(HANDLE process) {
  std::wstring result(32768,L'\0');DWORD length=DWORD(result.size());
  if(!QueryFullProcessImageNameW(process,0,result.data(),&length))return {};result.resize(length);return result;
}
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
inline std::string shellPhaseJson(const ShellPhase& phase) {
  char text[768]{};std::snprintf(text,sizeof(text),"{\"phase\":%lu,\"pid\":%lu,\"parentPid\":%lu,\"thread\":%lu,\"created\":\"%llu\",\"flags\":%lu,\"ready\":%s,\"active\":%s,\"library\":%s,\"build\":%s,\"anyJob\":%s,\"creationReserved\":%s,\"privateStation\":%s}",phase.phase,phase.pid,phase.parent,phase.thread,static_cast<unsigned long long>(phase.created),phase.flags,phase.ready?"true":"false",phase.active?"true":"false",phase.library?"true":"false",phase.build?"true":"false",phase.anyJob?"true":"false",phase.reserved?"true":"false",phase.privateStation?"true":"false");return text;
}
inline bool shellWrite(HANDLE pipe,const std::string& text) {DWORD count=0;return WriteFile(pipe,text.data(),DWORD(text.size()),&count,nullptr) && count==text.size();}
inline bool shellRead(HANDLE pipe,std::string& text) {text.clear();char c=0;DWORD count=0;while(ReadFile(pipe,&c,1,&count,nullptr) && count){if(c=='\n')return true;if(c!='\r')text+=c;if(text.size()>32768)return false;}return false;}
inline std::vector<std::string> shellFields(const std::string& text) {std::istringstream stream(text);std::vector<std::string> fields;std::string field;while(std::getline(stream,field,'\t'))fields.push_back(field);return fields;}
inline std::string shellStandardHandles() {
  std::string result="[";unsigned index=0;
  for(DWORD kind:{DWORD(STD_INPUT_HANDLE),DWORD(STD_OUTPUT_HANDLE),DWORD(STD_ERROR_HANDLE)}){
    HANDLE handle=GetStdHandle(kind);BY_HANDLE_FILE_INFORMATION file{};const bool valid=handle && handle!=INVALID_HANDLE_VALUE;
    const bool ordinaryFile=valid && GetFileInformationByHandle(handle,&file);if(index++)result+=',';
    result+="{\"valid\":"+std::string(valid?"true":"false")+",\"type\":"+std::to_string(valid?GetFileType(handle):0)+",\"ordinaryFile\":"+(ordinaryFile?"true":"false")+",\"volume\":"+std::to_string(file.dwVolumeSerialNumber)+",\"indexHigh\":"+std::to_string(file.nFileIndexHigh)+",\"indexLow\":"+std::to_string(file.nFileIndexLow)+"}";
  }
  return result+']';
}
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
extern "C" SHELL_PROBE_API void WINAPI ShellRecord(DWORD phase);
extern "C" SHELL_PROBE_API const ShellPhase* WINAPI ShellEvidence(DWORD phase);
