#include "fixture-shell.h"
#include <shellapi.h>
#include "fixture-shell-call.h"
static void NTAPI shellTls(PVOID,DWORD reason,PVOID){if(reason==DLL_PROCESS_ATTACH)ShellRecord(2);}
PIMAGE_TLS_CALLBACK shellTlsCallback __attribute__((section(".CRT$XLB"),used))=shellTls;
int wmain(){
  ShellRecord(3);const auto station=shellPrivateStation(),pipeName=shellArgument(L"--shell-pipe="),marker=shellArgument(L"--shell-marker=");
  HANDLE reached=CreateFileW(marker.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);if(reached==INVALID_HANDLE_VALUE)return 85;CloseHandle(reached);
  HANDLE pipe=CreateFileW(pipeName.c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr);if(pipe==INVALID_HANDLE_VALUE)return 86;
  wchar_t cwd[32768]{};if(!GetCurrentDirectoryW(32768,cwd))return 87;
  wchar_t environment[4096]{};GetEnvironmentVariableW(L"SAKURA_SHELL_LITERAL",environment,4096);
  int argc=0;auto argv=CommandLineToArgvW(GetCommandLineW(),&argc);if(!argv)return 88;
  std::string arguments="[";for(int index=0;index<argc;++index){if(index)arguments+=',';arguments+=shellJson(argv[index]);}arguments+=']';LocalFree(argv);
  std::string text="{\"pid\":"+std::to_string(GetCurrentProcessId())+",\"created\":\""+std::to_string(processCreation(GetCurrentProcess()))+"\",\"bits\":"+std::to_string(sizeof(void*)*8)+",\"image\":"+shellJson(shellImage(GetCurrentProcess()))+",\"station\":"+shellJson(station)+",\"cwd\":"+shellJson(cwd)+",\"environment\":"+shellJson(environment)+",\"commandLine\":"+shellJson(GetCommandLineW())+",\"argv\":"+arguments+",\"phases\":[";
  for(DWORD phase=0;phase<4;++phase){if(phase)text+=',';text+=shellPhaseJson(*ShellEvidence(phase));}text+="],\"standards\":"+shellStandardHandles()+"}\n";
  if(!shellWrite(pipe,text))return 89;
  const HRESULT com=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED|COINIT_DISABLE_OLE1DDE);
  std::vector<HANDLE> owned;std::string command;
  while(shellRead(pipe,command)){
    if(command=="exit")break;const auto fields=shellFields(command);
    if(fields.size()==4 && fields[0]=="track"){
      HANDLE process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,DWORD(std::stoul(fields[1])));
      const bool exact=process && processCreation(process)==std::stoull(fields[2]) && CompareStringOrdinal(shellImage(process).c_str(),-1,shellWide(fields[3]).c_str(),-1,TRUE)==CSTR_EQUAL;
      if(exact)owned.push_back(process);else if(process)CloseHandle(process);
      shellWrite(pipe,"{\"tracked\":"+std::string(exact?"true":"false")+"}\n");continue;
    }
    if(fields.size()==3 && fields[0]=="wait"){
      bool found=false;DWORD code=STILL_ACTIVE;
      for(HANDLE process:owned)if(GetProcessId(process)==DWORD(std::stoul(fields[1])) && processCreation(process)==std::stoull(fields[2])){found=true;if(WaitForSingleObject(process,10000)==WAIT_OBJECT_0)GetExitCodeProcess(process,&code);break;}
      shellWrite(pipe,"{\"exactHandle\":"+std::string(found?"true":"false")+",\"exitCode\":"+std::to_string(code)+"}\n");continue;
    }
    if(fields.size()!=5 || fields[0]!="spawn" || fields[1]!="ExW")return 94;
    shellCallInstall();const auto file=shellWide(fields[2]),parameters=shellWide(fields[3]),directory=shellWide(fields[4]);
    SHELLEXECUTEINFOW info{};info.cbSize=sizeof(info);info.fMask=SEE_MASK_NOASYNC|SEE_MASK_FLAG_NO_UI|SEE_MASK_NOCLOSEPROCESS|SEE_MASK_NO_CONSOLE;
    info.lpVerb=L"open";info.lpFile=file.c_str();info.lpParameters=parameters.c_str();info.lpDirectory=directory.c_str();info.nShow=SW_HIDE;
    SetLastError(0);const BOOL created=ShellExecuteExW(&info);const DWORD error=GetLastError();if(info.hProcess)owned.push_back(info.hProcess);
    shellWrite(pipe,"{\"started\":"+std::string(created?"true":"false")+",\"error\":"+std::to_string(error)+",\"nativeLastError\":"+std::to_string(error)+",\"returnedProcess\":"+(info.hProcess?"true":"false")+",\"pid\":"+std::to_string(info.hProcess?GetProcessId(info.hProcess):0)+",\"created\":\""+std::to_string(info.hProcess?processCreation(info.hProcess):0)+"\",\"image\":"+shellJson(info.hProcess?shellImage(info.hProcess):L"")+",\"thread\":"+std::to_string(GetCurrentThreadId())+",\"systemCreation\":"+shellCallEvidence+"}\n");
  }
  for(HANDLE process:owned)CloseHandle(process);if(SUCCEEDED(com))CoUninitialize();CloseHandle(pipe);return 0;
}
