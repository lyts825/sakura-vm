#include "fixture-shell.h"
#include <shellapi.h>
#include "fixture-shell-call.h"

int wmain(){
  const auto entry=shellPhase(3);const auto station=shellPrivateStation(),pipeName=shellArgument(L"--shell-pipe="),com=shellArgument(L"--shell-com=");
  const auto standards=shellSetOwnedStandardHandles();
  const HRESULT initialized=CoInitializeEx(nullptr,(com==L"mta"?COINIT_MULTITHREADED:COINIT_APARTMENTTHREADED)|COINIT_DISABLE_OLE1DDE);
  HANDLE pipe=CreateFileW(pipeName.c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr);if(pipe==INVALID_HANDLE_VALUE)return 90;
  const auto first="{\"pid\":"+std::to_string(entry.pid)+",\"created\":\""+std::to_string(entry.created)+"\",\"entryReady\":"+(entry.ready?"true":"false")+",\"active\":"+(entry.active?"true":"false")+",\"station\":"+shellJson(station)+",\"com\":"+shellJson(com)+",\"comResult\":"+std::to_string(DWORD(initialized))+",\"standards\":"+shellStandardHandles()+"}\n";
  if(!shellWrite(pipe,first))return 91;
  std::vector<HANDLE> owned;std::string line;
  while(shellRead(pipe,line)){
    if(line=="exit")break;const auto fields=shellFields(line);
    if(fields.size()==4 && fields[0]=="track"){
      const DWORD pid=DWORD(std::stoul(fields[1]));const auto created=std::stoull(fields[2]);const auto expected=shellWide(fields[3]);
      HANDLE process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,pid);
      if(!process || processCreation(process)!=created || CompareStringOrdinal(shellImage(process).c_str(),-1,expected.c_str(),-1,TRUE)!=CSTR_EQUAL){if(process)CloseHandle(process);shellWrite(pipe,"{\"tracked\":false}\n");continue;}
      owned.push_back(process);shellWrite(pipe,"{\"tracked\":true}\n");continue;
    }
    if(fields.size()==3 && fields[0]=="wait"){
      const DWORD pid=DWORD(std::stoul(fields[1]));const auto created=std::stoull(fields[2]);bool found=false;DWORD code=STILL_ACTIVE;
      for(HANDLE process:owned)if(GetProcessId(process)==pid && processCreation(process)==created){found=true;if(WaitForSingleObject(process,10000)==WAIT_OBJECT_0)GetExitCodeProcess(process,&code);break;}
      shellWrite(pipe,"{\"exactHandle\":"+std::string(found?"true":"false")+",\"exitCode\":"+std::to_string(code)+"}\n");continue;
    }
    if(fields.size()==8 && fields[0]=="parallel"){
      shellCallInstall();const auto stationName=shellArgument(L"--shell-station=");
      std::string results[2];HANDLE processes[2]{};std::thread workers[2];
      for(size_t index=0;index<2;++index)workers[index]=std::thread([&,index]{
        HWINSTA window=OpenWindowStationW(stationName.c_str(),FALSE,WINSTA_ALL_ACCESS);HDESK desktop=OpenDesktopW(L"default",0,FALSE,GENERIC_ALL);
        if(!window || !desktop || !SetThreadDesktop(desktop))ExitProcess(98);
        const HRESULT comResult=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED|COINIT_DISABLE_OLE1DDE);if(FAILED(comResult))ExitProcess(99);
        const auto file=shellWide(fields[2+index*3]),parameters=shellWide(fields[3+index*3]),directory=shellWide(fields[4+index*3]);
        SHELLEXECUTEINFOW info{};info.cbSize=sizeof(info);info.fMask=SEE_MASK_NOASYNC|SEE_MASK_FLAG_NO_UI|SEE_MASK_NOCLOSEPROCESS|SEE_MASK_NO_CONSOLE;
        info.lpVerb=L"open";info.lpFile=file.c_str();info.lpParameters=parameters.c_str();info.lpDirectory=directory.c_str();info.nShow=SW_HIDE;
        SetLastError(0);const BOOL created=ShellExecuteExW(&info);const DWORD error=GetLastError();processes[index]=info.hProcess;
        results[index]="{\"started\":"+std::string(created?"true":"false")+",\"error\":"+std::to_string(error)+",\"thread\":"+std::to_string(GetCurrentThreadId())+",\"pid\":"+std::to_string(info.hProcess?GetProcessId(info.hProcess):0)+",\"created\":\""+std::to_string(info.hProcess?processCreation(info.hProcess):0)+"\",\"systemCreation\":"+shellCallEvidence+"}";
        CoUninitialize();CloseDesktop(desktop);CloseWindowStation(window);
      });
      for(auto& worker:workers)worker.join();for(HANDLE process:processes)if(process)owned.push_back(process);
      shellWrite(pipe,"{\"parallel\":["+results[0]+','+results[1]+"]}\n");continue;
    }
    if(fields.size()!=5 || fields[0]!="spawn")return 92;
    const auto& requested=fields[1];const auto split=requested.find(':');const auto mode=requested.substr(0,split);
    shellCallFault=split==std::string::npos?"":requested.substr(split+1);shellCallControl=pipe;
    const auto image=shellWide(fields[2]),parameters=shellWide(fields[3]),directory=shellWide(fields[4]);
    ULONG mask=SEE_MASK_NOCLOSEPROCESS|SEE_MASK_FLAG_NO_UI|SEE_MASK_NO_CONSOLE|((mode.find("default")==std::string::npos)?SEE_MASK_NOASYNC:0);
    if(mode.find("no-handle")!=std::string::npos)mask&=~SEE_MASK_NOCLOSEPROCESS;
    if(shellCallFault=="unsupported-flags")mask|=SEE_MASK_INVOKEIDLIST;
    const wchar_t* verb=shellCallFault=="runas"?L"runas":shellCallFault=="unknown-verb"?L"sakura-owned-unknown-verb":shellCallFault=="null-verb"?nullptr:L"open";
    const char* ansiVerb=shellCallFault=="runas"?"runas":shellCallFault=="unknown-verb"?"sakura-owned-unknown-verb":shellCallFault=="null-verb"?nullptr:"open";
    SetEnvironmentVariableW(L"SAKURA_SHELL_LITERAL",L"space 中文 \\ trailing\\ \"quote\"");
    BOOL started=FALSE;HINSTANCE result=nullptr;HANDLE process=nullptr;
    if(shellCallFault=="cold")shellCallEvidence="[]";else shellCallInstall();
    SetLastError(0);
    if(mode=="W")result=ShellExecuteW(nullptr,verb,image.c_str(),parameters.c_str(),directory.c_str(),SW_HIDE);
    else if(mode=="A"){const auto file=shellAnsi(image),arguments=shellAnsi(parameters),cwd=shellAnsi(directory);result=ShellExecuteA(nullptr,ansiVerb,file.c_str(),arguments.c_str(),cwd.c_str(),SW_HIDE);}
    else if(mode.find("ExW")==0){SHELLEXECUTEINFOW info{};info.cbSize=shellCallFault=="invalid-cb"?sizeof(info)-1:sizeof(info);info.fMask=mask;info.lpVerb=verb;info.lpFile=image.c_str();info.lpParameters=parameters.c_str();info.lpDirectory=directory.c_str();info.nShow=SW_HIDE;started=ShellExecuteExW(&info);result=info.hInstApp;process=info.hProcess;}
    else {const auto file=shellAnsi(image),arguments=shellAnsi(parameters),cwd=shellAnsi(directory);SHELLEXECUTEINFOA info{};info.cbSize=shellCallFault=="invalid-cb"?sizeof(info)-1:sizeof(info);info.fMask=mask;info.lpVerb=ansiVerb;info.lpFile=file.c_str();info.lpParameters=arguments.c_str();info.lpDirectory=cwd.c_str();info.nShow=SW_HIDE;started=ShellExecuteExA(&info);result=info.hInstApp;process=info.hProcess;}
    if(mode=="W" || mode=="A")started=INT_PTR(result)>32;
    const DWORD nativeLastError=GetLastError();
    const DWORD error=started?0:GetLastError();
    const DWORD pid=process?GetProcessId(process):0;const auto created=process?processCreation(process):0;const auto actual=process?shellImage(process):L"";
    if(process)owned.push_back(process);
    const std::string output="{\"started\":"+std::string(started?"true":"false")+",\"error\":"+std::to_string(error)+",\"nativeLastError\":"+std::to_string(nativeLastError)+",\"thread\":"+std::to_string(GetCurrentThreadId())+",\"hInstApp\":"+std::to_string(INT_PTR(result))+",\"returnedProcess\":"+(process?"true":"false")+",\"pid\":"+std::to_string(pid)+",\"created\":\""+std::to_string(created)+"\",\"image\":"+shellJson(actual)+",\"mask\":"+std::to_string(mask)+",\"systemCreation\":"+shellCallEvidence+"}\n";
    if(!shellWrite(pipe,output))break;
  }
  for(HANDLE process:owned)CloseHandle(process);for(HANDLE handle:standards)CloseHandle(handle);CloseHandle(pipe);if(SUCCEEDED(initialized))CoUninitialize();return 0;
}
