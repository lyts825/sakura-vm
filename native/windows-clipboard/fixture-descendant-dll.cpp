/**
 * 模块职责（中文）：自有 DLL 在最早 TLS 或 DllMain 中按场景创建另一 EXE，保留阶段证据供祖先进程汇报，以验证 Main 前的后代拦截。
 * Module responsibilities (English): An owned DLL creates another EXE at earliest TLS/DllMain per scenario and retains evidence for ancestor reporting to test pre-Main descendant interception.
 */
/** 在自有 DLL 的 TLS 和 DllMain 初始化阶段创建后代并保留证据，检查入口前的策略继承。 */
#define SAKURA_DESCENDANT_INIT_DLL
#include "fixture-descendant.h"
static SakuraDescendantInitEvidence evidence{};
/** 中文：在 DLL 进程附加 TLS 阶段执行指定创建并保存最早证据，其他通知忽略。 English: Create at the requested DLL process-attach TLS stage and retain earliest evidence, ignoring other notifications. 参数声明 / Declared parameters: PVOID,DWORD reason,PVOID. */
static void NTAPI descendantFixtureTls(PVOID,DWORD reason,PVOID) {
  if(reason==DLL_PROCESS_ATTACH)evidence=descendantFixtureInitialize(L"dll-tls");
}
PIMAGE_TLS_CALLBACK descendantFixtureCallback __attribute__((section(".CRT$XLB"),used))=descendantFixtureTls;
/** 中文：返回 DLL 初始化保存的后代证据地址，调用者读取而不释放。 English: Return the address of descendant evidence saved during DLL initialization for caller reading without freeing. */
extern "C" __declspec(dllexport) const SakuraDescendantInitEvidence* WINAPI SakuraDescendantInitialization(){return &evidence;}
/** 中文：在进程附加时执行指定 DllMain 创建场景，仅当本阶段产生启动或错误证据才替换已保存记录；其他通知直接成功。 English: Run the requested DllMain creation on process attach and replace saved evidence only if this stage reports a start/error; return success for other notifications. 参数声明 / Declared parameters: HINSTANCE,DWORD reason,LPVOID. */
BOOL WINAPI DllMain(HINSTANCE,DWORD reason,LPVOID) {
  if(reason==DLL_PROCESS_ATTACH){const auto result=descendantFixtureInitialize(L"dll-main");if(result.started || result.error)evidence=result;}
  return TRUE;
}
