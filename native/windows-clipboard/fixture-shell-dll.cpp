#define SHELL_PROBE_DLL
#include "fixture-shell.h"
static ShellPhase phases[4]{};
extern "C" __declspec(dllexport) void WINAPI ShellRecord(DWORD phase){
  if(phase<4)phases[phase]=shellPhase(phase);
  if(!phase){const auto path=shellArgument(L"--shell-first-marker=");if(!path.empty()){
    HANDLE file=CreateFileW(path.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);
    if(file==INVALID_HANDLE_VALUE)ExitProcess(85);const auto text=shellPhaseJson(phases[0]);DWORD count=0;
    if(!WriteFile(file,text.data(),DWORD(text.size()),&count,nullptr) || count!=text.size())ExitProcess(86);CloseHandle(file);
  }}
}
extern "C" __declspec(dllexport) const ShellPhase* WINAPI ShellEvidence(DWORD phase){return phase<4?phases+phase:nullptr;}
static void NTAPI shellTls(PVOID,DWORD reason,PVOID){if(reason==DLL_PROCESS_ATTACH)ShellRecord(0);}
PIMAGE_TLS_CALLBACK shellTlsCallback __attribute__((section(".CRT$XLB"),used))=shellTls;
BOOL WINAPI DllMain(HINSTANCE,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)ShellRecord(1);return TRUE;}
