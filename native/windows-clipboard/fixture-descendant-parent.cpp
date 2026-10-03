#include "fixture-descendant.h"
#include <cstdio>
#include <sstream>

static SakuraDescendantInitEvidence exeInitialization{};
static void NTAPI descendantFixtureExeTls(PVOID,DWORD reason,PVOID) {
  if(reason==DLL_PROCESS_ATTACH)exeInitialization=descendantFixtureInitialize(L"exe-tls");
}
PIMAGE_TLS_CALLBACK descendantFixtureExeCallback __attribute__((section(".CRT$XLB"),used))=descendantFixtureExeTls;
static std::wstring fromUtf8(const std::string& text) {
  const int size=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text.data(),int(text.size()),nullptr,0);
  if(size<=0)return {};std::wstring answer(size,L'\0');
  if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text.data(),int(text.size()),answer.data(),size))return {};
  return answer;
}
static bool parentReady(const std::wstring& owner) {
  const auto name=L"Local\\SakuraClipboard."+owner+L"."+std::to_wstring(GetCurrentProcessId())+L"."+std::to_wstring(processCreation(GetCurrentProcess()));
  HANDLE section=OpenFileMappingW(FILE_MAP_READ,FALSE,name.c_str());
  const auto data=section?static_cast<const SakuraClipboardPolicy*>(MapViewOfFile(section,FILE_MAP_READ,0,0,sizeof(SakuraClipboardPolicy))):nullptr;
  const bool ready=data && data->status==1 && data->active && data->pid==GetCurrentProcessId() && !(data->sequence&1);
  if(data)UnmapViewOfFile(data);if(section)CloseHandle(section);return ready;
}
static bool lineWrite(HANDLE pipe,const std::string& text) {
  DWORD count=0;return WriteFile(pipe,text.data(),DWORD(text.size()),&count,nullptr) && count==text.size();
}
static bool lineRead(HANDLE pipe,std::string& result) {
  result.clear();char character=0;DWORD count=0;
  while(ReadFile(pipe,&character,1,&count,nullptr) && count) {
    if(character=='\n')return true;if(character!='\r')result+=character;if(result.size()>32768)return false;
  }
  return false;
}
int wmain() {
  const auto owner=descendantFixtureArgument(L"--descendant-owner=");const bool entry=parentReady(owner);
  const auto stationName=descendantFixtureArgument(L"--descendant-station="),pipeName=descendantFixtureArgument(L"--descendant-pipe=");
  if(stationName.empty() || owner.empty() || pipeName.empty() || CompareStringOrdinal(stationName.c_str(),-1,L"WinSta0",-1,TRUE)==CSTR_EQUAL)return 92;
  HWINSTA station=OpenWindowStationW(stationName.c_str(),FALSE,WINSTA_ALL_ACCESS);
  if(!station || !SetProcessWindowStation(station))return 93;
  HDESK desktop=OpenDesktopW(L"default",0,FALSE,GENERIC_ALL);
  if(!desktop || !SetThreadDesktop(desktop))return 94;
  HANDLE pipe=CreateFileW(pipeName.c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr);
  if(pipe==INVALID_HANDLE_VALUE)return 95;
  const auto imported=SakuraDescendantInitialization();const auto initial=exeInitialization.started || exeInitialization.error?&exeInitialization:imported;
  char first[1024]{};
  std::snprintf(first,sizeof(first),"{\"pid\":%lu,\"created\":\"%llu\",\"entryReady\":%s,\"initial\":{\"started\":%s,\"pid\":%lu,\"created\":\"%llu\",\"error\":%lu}}\n",
    GetCurrentProcessId(),static_cast<unsigned long long>(processCreation(GetCurrentProcess())),entry?"true":"false",
    initial->started?"true":"false",initial->pid,static_cast<unsigned long long>(initial->created),initial->error);
  if(!lineWrite(pipe,first))return 96;
  std::vector<PROCESS_INFORMATION> children;std::string line;
  while(lineRead(pipe,line)) {
    if(line=="exit")break;
    std::istringstream input(line);std::vector<std::string> fields;std::string field;
    while(std::getline(input,field,'\t'))fields.push_back(field);
    if(fields.size()==2 && fields[0]=="resume") {
      const DWORD pid=DWORD(std::stoul(fields[1]));DWORD previous=DWORD(-1);
      for(auto& child:children)if(child.dwProcessId==pid)previous=ResumeThread(child.hThread);
      char answer[128]{};std::snprintf(answer,sizeof(answer),"{\"resumed\":%lu}\n",previous);lineWrite(pipe,answer);continue;
    }
    if(fields.size()!=7 || fields[0]!="spawn")return 97;
    const auto image=fromUtf8(fields[2]),childPipe=fromUtf8(fields[3]),kind=fromUtf8(fields[4]),marker=fromUtf8(fields[5]),directory=fromUtf8(fields[6]);
    auto command=descendantFixtureCommand(image,childPipe,stationName,owner,kind,marker);
    std::wstring childDesktop=stationName+L"\\default";STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.lpDesktop=childDesktop.data();
    PROCESS_INFORMATION child{};BOOL created=FALSE;const DWORD flags=CREATE_NO_WINDOW|(fields[1]=="suspended"?CREATE_SUSPENDED:0);
    if(fields[1]=="A") {
      const int pathSize=WideCharToMultiByte(CP_ACP,0,image.c_str(),-1,nullptr,0,nullptr,nullptr),
        commandSize=WideCharToMultiByte(CP_ACP,0,command.c_str(),-1,nullptr,0,nullptr,nullptr),
        desktopSize=WideCharToMultiByte(CP_ACP,0,childDesktop.c_str(),-1,nullptr,0,nullptr,nullptr);
      std::string path(pathSize,'\0'),ansi(commandSize,'\0'),ansiDesktop(desktopSize,'\0');
      WideCharToMultiByte(CP_ACP,0,image.c_str(),-1,path.data(),pathSize,nullptr,nullptr);
      WideCharToMultiByte(CP_ACP,0,command.c_str(),-1,ansi.data(),commandSize,nullptr,nullptr);
      WideCharToMultiByte(CP_ACP,0,childDesktop.c_str(),-1,ansiDesktop.data(),desktopSize,nullptr,nullptr);
      STARTUPINFOA info{};info.cb=sizeof(info);info.lpDesktop=ansiDesktop.data();
      created=CreateProcessA(path.c_str(),ansi.data(),nullptr,nullptr,FALSE,flags,nullptr,nullptr,&info,&child);
    } else if(fields[1]=="extended") {
      STARTUPINFOEXW info{};info.StartupInfo=startup;info.StartupInfo.cb=sizeof(info);
      created=CreateProcessW(image.c_str(),command.data(),nullptr,nullptr,FALSE,flags|EXTENDED_STARTUPINFO_PRESENT,nullptr,nullptr,&info.StartupInfo,&child);
    } else {
      created=CreateProcessW(fields[1]=="implicit"?nullptr:image.c_str(),command.data(),nullptr,nullptr,FALSE,flags,nullptr,directory.empty()?nullptr:directory.c_str(),&startup,&child);
    }
    const DWORD error=created?0:GetLastError();DWORD suspension=DWORD(-1);uint64_t time=0;
    if(created){time=processCreation(child.hProcess);suspension=SuspendThread(child.hThread);if(suspension!=DWORD(-1))ResumeThread(child.hThread);children.push_back(child);}
    char answer[1024]{};
    std::snprintf(answer,sizeof(answer),"{\"started\":%s,\"pid\":%lu,\"created\":\"%llu\",\"error\":%lu,\"suspension\":%lu}\n",
      created?"true":"false",child.dwProcessId,static_cast<unsigned long long>(time),error,suspension);
    if(!lineWrite(pipe,answer))break;
  }
  for(const auto& child:children){CloseHandle(child.hThread);CloseHandle(child.hProcess);}
  CloseHandle(pipe);return 0;
}
