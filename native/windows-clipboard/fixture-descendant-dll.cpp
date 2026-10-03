#define SAKURA_DESCENDANT_INIT_DLL
#include "fixture-descendant.h"
static SakuraDescendantInitEvidence evidence{};
static void NTAPI descendantFixtureTls(PVOID,DWORD reason,PVOID) {
  if(reason==DLL_PROCESS_ATTACH)evidence=descendantFixtureInitialize(L"dll-tls");
}
PIMAGE_TLS_CALLBACK descendantFixtureCallback __attribute__((section(".CRT$XLB"),used))=descendantFixtureTls;
extern "C" __declspec(dllexport) const SakuraDescendantInitEvidence* WINAPI SakuraDescendantInitialization(){return &evidence;}
BOOL WINAPI DllMain(HINSTANCE,DWORD reason,LPVOID) {
  if(reason==DLL_PROCESS_ATTACH){const auto result=descendantFixtureInitialize(L"dll-main");if(result.started || result.error)evidence=result;}
  return TRUE;
}
