#pragma once
#include "fixture-early.h"
#include <string>
#include <vector>

struct SakuraDescendantInitEvidence { DWORD pid,error; uint64_t created; BOOL started; };
inline std::wstring descendantFixtureArgument(const wchar_t* prefix) {
  wchar_t value[2048]{};return earlyArgument(prefix,value,2048)?value:L"";
}
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
  answer.started=CreateProcessW(image.c_str(),command.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW,nullptr,nullptr,&startup,&child);
  answer.error=answer.started?0:GetLastError();
  if(answer.started){answer.pid=child.dwProcessId;answer.created=processCreation(child.hProcess);CloseHandle(child.hThread);CloseHandle(child.hProcess);}
  return answer;
}
#ifdef SAKURA_DESCENDANT_INIT_DLL
#define SAKURA_DESCENDANT_INIT_API __declspec(dllexport)
#else
#define SAKURA_DESCENDANT_INIT_API __declspec(dllimport)
#endif
extern "C" SAKURA_DESCENDANT_INIT_API const SakuraDescendantInitEvidence* WINAPI SakuraDescendantInitialization();
