// An owned application import DLL deliberately calls clipboard APIs from its
// first TLS and DllMain initialization code. All calls require a verified private
// fixture window station, including when policy initialization failed.
#define SAKURA_EARLY_DLL
#include "fixture-early.h"
#include <cstring>
#include <cwchar>

static SakuraEarlyEvidence evidence[4]{};
static bool systemModule(const wchar_t* name) {
  wchar_t actual[MAX_PATH]{},system[MAX_PATH]{};
  const HMODULE module=GetModuleHandleW(name);
  const UINT length=GetSystemDirectoryW(system,MAX_PATH);
  if(!module || !length || length>=MAX_PATH || !GetModuleFileNameW(module,actual,MAX_PATH))return false;
  return CompareStringOrdinal(actual,int(length),system,int(length),TRUE)==CSTR_EQUAL && actual[length]==L'\\' &&
    CompareStringOrdinal(actual+length+1,-1,name,-1,TRUE)==CSTR_EQUAL;
}
extern "C" __declspec(dllexport) void WINAPI SakuraEarlyRecord(unsigned phase) {
  if(phase>=4)return;
  auto& value=evidence[phase];value.phase=phase;value.pid=GetCurrentProcessId();value.thread=GetCurrentThreadId();
  value.created=processCreation(GetCurrentProcess());
  wchar_t owner[64]{},stationName[256]{},actual[256]{};DWORD bytes=0;
  if(!earlyArgument(L"--early-station=",stationName,256) || !earlyArgument(L"--early-owner=",owner,64) ||
      std::wcslen(owner)!=36 || CompareStringOrdinal(stationName,-1,L"WinSta0",-1,TRUE)==CSTR_EQUAL)ExitProcess(70);
  HWINSTA station=OpenWindowStationW(stationName,FALSE,WINSTA_ALL_ACCESS);
  if(!station || !SetProcessWindowStation(station) ||
      !GetUserObjectInformationW(GetProcessWindowStation(),UOI_NAME,actual,sizeof(actual),&bytes) ||
      CompareStringOrdinal(stationName,-1,actual,-1,TRUE)!=CSTR_EQUAL ||
      CompareStringOrdinal(actual,-1,L"WinSta0",-1,TRUE)==CSTR_EQUAL)ExitProcess(71);
  HDESK desktop=CreateDesktopW(L"default",nullptr,nullptr,0,GENERIC_ALL,nullptr);
  if(!desktop || !SetThreadDesktop(desktop))ExitProcess(72);
  value.privateStation=1;
  if(phase==0) {
    wchar_t marker[1024]{};
    if(earlyArgument(L"--early-marker=",marker,1024)) {
      const HANDLE output=CreateFileW(marker,GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);
      if(output==INVALID_HANDLE_VALUE)ExitProcess(77);
      CloseHandle(output);
    }
  }
  // Join before any clipboard API. This guard is independent of the policy DLL.
  wchar_t mapping[192]{};
  std::swprintf(mapping,192,L"Local\\SakuraClipboard.%ls.%lu.%llu",owner,value.pid,
    static_cast<unsigned long long>(value.created));
  HANDLE object=OpenFileMappingW(FILE_MAP_READ,FALSE,mapping);
  const auto policy=object?static_cast<const SakuraClipboardPolicy*>(MapViewOfFile(object,FILE_MAP_READ,0,0,sizeof(SakuraClipboardPolicy))):nullptr;
  const bool library=GetModuleHandleW(sizeof(void*)==8?L"SakuraClipboardPolicy.dll":L"SakuraClipboardPolicy-x86.dll")!=nullptr;
  value.ready=library && policy && policy->magic==SakuraClipboardMagic && policy->version==SakuraClipboardVersion &&
    policy->pid==value.pid && policy->creationTime==value.created && policy->status==1 && !(policy->sequence&1);
  if(policy){value.active=policy->active;value.flags=policy->flags;}
  value.systemUser32=systemModule(L"user32.dll");value.systemOle32=systemModule(L"ole32.dll");
  if(!OpenClipboard(nullptr))ExitProcess(73);
  SetLastError(0);EmptyClipboard();value.copyError=GetLastError();
  SetLastError(0);GetClipboardData(CF_UNICODETEXT);value.pasteError=GetLastError();CloseClipboard();
  IDataObject* data=nullptr;
  value.oleCopy=OleSetClipboard(nullptr);value.olePaste=OleGetClipboard(&data);
  if(data)data->Release();
  if(policy){value.copies=policy->blockedCopy;value.pastes=policy->blockedPaste;UnmapViewOfFile(policy);}
  if(object)CloseHandle(object);
  // The test keeps station/desktop handles alive through all initialization
  // callbacks, then the owned process exit reclaims them.
}
extern "C" __declspec(dllexport) const SakuraEarlyEvidence* WINAPI SakuraEarlyEvidenceAt(unsigned phase) {
  return phase<4?evidence+phase:nullptr;
}
static void NTAPI earlyDllTls(PVOID,DWORD reason,PVOID) {
  if(reason==DLL_PROCESS_ATTACH)SakuraEarlyRecord(0);
}
// MinGW linker retains the CRT's TLS directory and this actual callback slot.
PIMAGE_TLS_CALLBACK earlyDllCallback __attribute__((section(".CRT$XLB"),used))=earlyDllTls;
BOOL WINAPI DllMain(HINSTANCE,DWORD reason,LPVOID) {
  if(reason==DLL_PROCESS_ATTACH)SakuraEarlyRecord(1);
  return TRUE;
}
