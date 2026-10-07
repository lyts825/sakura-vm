/**
 * 模块职责（中文）：Shell 孩子导入 DLL 在 TLS/DllMain 保留阶段快照，供 EXE 入口合并判断早期导入和创建预约覆盖。
 * Module responsibilities (English): A Shell child import DLL retains TLS/DllMain snapshots for EXE entry to assess early-import/creation-reservation coverage.
 */
/** Shell 子进程导入 DLL 探针，在 TLS 和 DllMain 阶段采集策略是否已生效。 */
#define SHELL_PROBE_DLL
#include "fixture-shell.h"
static ShellPhase phases[4]{};
/** 中文：在指定 DLL/TLS/入口阶段收集私有环境、策略和创建预约证据，结果存入模块静态数组。 English: Collect private-environment/policy/creation-reservation evidence at the DLL/TLS/entry phase into module static storage. 参数声明 / Declared parameters: DWORD phase. */
extern "C" __declspec(dllexport) void WINAPI ShellRecord(DWORD phase){
  if(phase<4)phases[phase]=shellPhase(phase);
  if(!phase){const auto path=shellArgument(L"--shell-first-marker=");if(!path.empty()){
    HANDLE file=CreateFileW(path.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);
    if(file==INVALID_HANDLE_VALUE)ExitProcess(85);const auto text=shellPhaseJson(phases[0]);DWORD count=0;
    if(!WriteFile(file,text.data(),DWORD(text.size()),&count,nullptr) || count!=text.size())ExitProcess(86);CloseHandle(file);
  }}
}
/** 中文：返回指定阶段的静态 Shell 证据指针，越界返回空，存储归 DLL 所有。 English: Return a static Shell evidence pointer for the requested phase or null out of range, with storage owned by the DLL. 参数声明 / Declared parameters: DWORD phase. */
extern "C" __declspec(dllexport) const ShellPhase* WINAPI ShellEvidence(DWORD phase){return phase<4?phases+phase:nullptr;}
/** 中文：DLL 进程附加 TLS 阶段保存最早 Shell 阶段 0 证据。 English: Save earliest Shell phase-0 evidence at DLL process-attach TLS. 参数声明 / Declared parameters: PVOID,DWORD reason,PVOID. */
static void NTAPI shellTls(PVOID,DWORD reason,PVOID){if(reason==DLL_PROCESS_ATTACH)ShellRecord(0);}
PIMAGE_TLS_CALLBACK shellTlsCallback __attribute__((section(".CRT$XLB"),used))=shellTls;
/** 中文：DLL 进程附加记录阶段 1，其他通知直接返回成功。 English: Record phase 1 at DLL process attach and return success for other notifications. 参数声明 / Declared parameters: HINSTANCE,DWORD reason,LPVOID. */
BOOL WINAPI DllMain(HINSTANCE,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)ShellRecord(1);return TRUE;}
