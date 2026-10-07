/**
 * 模块职责（中文）：受控 token 孩子在私有 station 报告入口策略、argv、环境、目录、session 和标准句柄证据，marker 用于发现本应拒绝时的意外执行。
 * Module responsibilities (English): A controlled token child reports entry policy/argv/environment/directory/session/standard-handle evidence in a private station, with a marker detecting accidental execution on refused paths.
 */
/** 后代令牌场景入口，在策略就绪状态下调用共享令牌夹具并输出 JSON 证据。 */
#include "fixture-descendant-token.h"
#include <shellapi.h>

/** 中文：把宽字符串转为 UTF-8 并转义 JSON 引号、反斜杠和控制字节，供身份和 argv 输出。 English: Convert wide text to UTF-8 and escape JSON quotes/backslashes/control bytes for identity/argv output. 参数声明 / Declared parameters: const std::wstring& wide. */
static std::string tokenJson(const std::wstring& wide) {
  const int size=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,wide.data(),int(wide.size()),nullptr,0,nullptr,nullptr);
  std::string bytes(size,'\0'),result="\"";if(size)WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,wide.data(),int(wide.size()),bytes.data(),size,nullptr,nullptr);
  for(const unsigned char c:bytes){if(c=='\\' || c=='"')result+='\\';if(c<32){char value[8]{};std::snprintf(value,sizeof(value),"\\u%04x",unsigned(c));result+=value;}else result+=char(c);}return result+'"';
}
/** 中文：按 owner/PID/创建时间核验共享 ABI、活动和就绪状态，结束释放映射与句柄。 English: Validate shared ABI/active/readiness by owner/PID/creation time and release mapping/handle afterward. */
static bool tokenEntryPolicy() {
  const auto owner=descendantFixtureArgument(L"--token-owner=");
  const auto name=L"Local\\SakuraClipboard."+owner+L"."+std::to_wstring(GetCurrentProcessId())+L"."+std::to_wstring(processCreation(GetCurrentProcess()));
  HANDLE section=OpenFileMappingW(FILE_MAP_READ,FALSE,name.c_str());
  const auto policy=section?static_cast<const SakuraClipboardPolicy*>(MapViewOfFile(section,FILE_MAP_READ,0,0,sizeof(SakuraClipboardPolicy))):nullptr;
  const bool ready=policy && policy->magic==SakuraClipboardMagic && policy->version==SakuraClipboardVersion && policy->pid==GetCurrentProcessId() && policy->creationTime==processCreation(GetCurrentProcess()) && policy->status==1 && policy->active && !(policy->sequence&1);
  if(policy)UnmapViewOfFile(policy);if(section)CloseHandle(section);return ready;
}
/** 中文：选择私有 station 后写入入口 marker，并经私有管道报告真实 argv、工作目录、环境、令牌和标准句柄证据，等控制命令后关闭管道。 English: Select private station, create an entry marker and report actual argv/cwd/environment/token/standard-handle evidence through a private pipe, closing it after the control command. */
int wmain() {
  const bool entryReady=tokenEntryPolicy();
  const auto marker=descendantFixtureArgument(L"--token-marker="),stationName=descendantFixtureArgument(L"--token-station="),pipeName=descendantFixtureArgument(L"--token-pipe=");
  if(stationName.empty() || CompareStringOrdinal(stationName.c_str(),-1,L"WinSta0",-1,TRUE)==CSTR_EQUAL)return 90;
  HWINSTA station=OpenWindowStationW(stationName.c_str(),FALSE,WINSTA_ALL_ACCESS);if(!station || !SetProcessWindowStation(station))return 91;
  wchar_t actualStation[256]{};DWORD bytes=0;if(!GetUserObjectInformationW(station,UOI_NAME,actualStation,sizeof(actualStation),&bytes))return 92;
  const HANDLE reached=CreateFileW(marker.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);if(reached==INVALID_HANDLE_VALUE)return 93;CloseHandle(reached);
  HANDLE pipe=CreateFileW(pipeName.c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr);if(pipe==INVALID_HANDLE_VALUE)return 94;
  wchar_t directory[32768]{},environment[32768]{};DWORD session=0,type=0;
  if(!GetCurrentDirectoryW(32768,directory))return 95;GetEnvironmentVariableW(L"SAKURA_TOKEN_LITERAL",environment,32768);
  const auto authentication=tokenFixtureAuthentication(GetCurrentProcess(),session,type);
  int argc=0;auto argv=CommandLineToArgvW(GetCommandLineW(),&argc);if(!argv)return 96;
  std::string arguments="[";for(int index=0;index<argc;++index){if(index)arguments+=',';arguments+=tokenJson(argv[index]);}arguments+=']';LocalFree(argv);
  const std::string output="{\"pid\":"+std::to_string(GetCurrentProcessId())+",\"created\":\""+std::to_string(processCreation(GetCurrentProcess()))+"\",\"entryReady\":"+(entryReady?"true":"false")+",\"station\":"+tokenJson(actualStation)+",\"directory\":"+tokenJson(directory)+",\"literal\":"+tokenJson(environment)+",\"argv\":"+arguments+",\"session\":"+std::to_string(session)+",\"tokenType\":"+std::to_string(type)+",\"authentication\":\""+std::to_string(authentication)+"\",\"stdin\":\""+std::to_string(uintptr_t(GetStdHandle(STD_INPUT_HANDLE)))+"\",\"stdout\":\""+std::to_string(uintptr_t(GetStdHandle(STD_OUTPUT_HANDLE)))+"\",\"stderr\":\""+std::to_string(uintptr_t(GetStdHandle(STD_ERROR_HANDLE)))+"\"}\n";
  DWORD written=0;if(!WriteFile(pipe,output.data(),DWORD(output.size()),&written,nullptr) || written!=output.size())return 97;
  char command[16]{};DWORD count=0;ReadFile(pipe,command,sizeof(command),&count,nullptr);CloseHandle(pipe);return 0;
}
