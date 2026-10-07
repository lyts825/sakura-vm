/**
 * 模块职责（中文）：为 DLL、原生和 CLR 后代场景共用有界参数、分别引用的命令行与初始化创建证据，所有启动显式指向私有 station 和控制管道。
 * Module responsibilities (English): Share bounded arguments/separately quoted commands/initialization evidence across DLL/native/CLR descendants, explicitly targeting private stations/control pipes for every launch.
 */
/** 后代初始化夹具的共同数据与创建逻辑，供 EXE、DLL 和令牌场景复用。 */
#pragma once
#include "fixture-early.h"
#include <string>
#include <vector>

struct SakuraDescendantInitEvidence { DWORD pid,error; uint64_t created; BOOL started; };
/** 中文：用有界早期参数解析器读取指定前缀，缺少或过长返回空字符串。 English: Read a prefixed argument with the bounded early parser, returning empty for absence/overflow. 参数声明 / Declared parameters: const wchar_t* prefix. */
inline std::wstring descendantFixtureArgument(const wchar_t* prefix) {
  wchar_t value[2048]{};return earlyArgument(prefix,value,2048)?value:L"";
}
/** 中文：按 parent/managed/early 夹具类型组装私有管道、station、owner 和 marker 参数，每个 argv 单独 CRT 引用。 English: Build private pipe/station/owner/marker arguments for parent/managed/early fixtures, quoting each argv separately with CRT rules. 参数声明 / Declared parameters: const std::wstring& image,const std::wstring& pipe, const std::wstring& station,const std::wstring& owner,const std::wstring& kind,const std::wstring& marker. */
inline std::wstring descendantFixtureCommand(const std::wstring& image,const std::wstring& pipe,
    const std::wstring& station,const std::wstring& owner,const std::wstring& kind,const std::wstring& marker) {
  std::vector<std::wstring> arguments;
  if(kind==L"parent")arguments={L"--descendant-station="+station,L"--descendant-owner="+owner,L"--descendant-pipe="+pipe};
  else if(kind==L"managed")arguments={L"--station="+station,L"--owner="+owner,L"--pipe="+pipe.substr(9),L"--marker="+marker};
  else arguments={L"--early-station="+station,L"--early-owner="+owner,L"--early-pipe="+pipe,L"--early-marker="+marker};
  std::wstring command=clipboardArgument(image);
  for(const auto& argument:arguments)command+=L" "+clipboardArgument(argument);
  return command;
}
/** 中文：只在指定 TLS/DllMain 阶段创建受控子 EXE，先验证私有参数；记录启动错误或 PID/创建时间并关闭暂持进程线程句柄。 English: Create a controlled child EXE only at the requested TLS/DllMain phase after private-argument checks; record error or PID/creation time and close temporary process/thread handles. 参数声明 / Declared parameters: const wchar_t* phase. */
inline SakuraDescendantInitEvidence descendantFixtureInitialize(const wchar_t* phase) {
  SakuraDescendantInitEvidence answer{};
  if(descendantFixtureArgument(L"--spawn-phase=")!=phase)return answer;
  const auto image=descendantFixtureArgument(L"--spawn-child="),pipe=descendantFixtureArgument(L"--spawn-pipe="),
    station=descendantFixtureArgument(L"--descendant-station="),owner=descendantFixtureArgument(L"--descendant-owner="),
    marker=descendantFixtureArgument(L"--spawn-marker=");
  if(image.empty() || pipe.empty() || station.empty() || owner.empty() ||
      CompareStringOrdinal(station.c_str(),-1,L"WinSta0",-1,TRUE)==CSTR_EQUAL)ExitProcess(91);
  auto command=descendantFixtureCommand(image,pipe,station,owner,descendantFixtureArgument(L"--spawn-kind="),marker);
  std::wstring desktop=station+L"\\default";
  STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.lpDesktop=desktop.data();PROCESS_INFORMATION child{};
  const auto api=descendantFixtureArgument(L"--spawn-api=");HANDLE token=nullptr;
  if(api==L"as-user-W"){
    if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY|TOKEN_DUPLICATE|TOKEN_ASSIGN_PRIMARY,&token)){answer.error=GetLastError();return answer;}
    answer.started=CreateProcessAsUserW(token,image.c_str(),command.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW,nullptr,nullptr,&startup,&child);
  }else answer.started=CreateProcessW(image.c_str(),command.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW,nullptr,nullptr,&startup,&child);
  answer.error=answer.started?0:GetLastError();
  if(token)CloseHandle(token);
  if(answer.started){answer.pid=child.dwProcessId;answer.created=processCreation(child.hProcess);CloseHandle(child.hThread);CloseHandle(child.hProcess);}
  return answer;
}
#ifdef SAKURA_DESCENDANT_INIT_DLL
#define SAKURA_DESCENDANT_INIT_API __declspec(dllexport)
#else
#define SAKURA_DESCENDANT_INIT_API __declspec(dllimport)
#endif
/** 中文：导出或导入 DLL 初始化阶段捕获的后代证据指针，存储由 DLL 生命周期持有。 English: Export/import the pointer to descendant evidence captured during DLL initialization, with storage retained for the DLL lifetime. */
extern "C" SAKURA_DESCENDANT_INIT_API const SakuraDescendantInitEvidence* WINAPI SakuraDescendantInitialization();
