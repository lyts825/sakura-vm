#include "fixture-early.h"
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <io.h>
#include <fcntl.h>

static void NTAPI earlyExeTls(PVOID,DWORD reason,PVOID) {
  if(reason==DLL_PROCESS_ATTACH)SakuraEarlyRecord(2);
}
PIMAGE_TLS_CALLBACK earlyExeCallback __attribute__((section(".CRT$XLB"),used))=earlyExeTls;
int wmain() {
  SakuraEarlyRecord(3);
  wchar_t pipeName[256]{};
  if(!earlyArgument(L"--early-pipe=",pipeName,256))return 74;
  HANDLE pipe=CreateFileW(pipeName,GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr);
  if(pipe==INVALID_HANDLE_VALUE)return 75;
  char output[8192]{};size_t offset=0;
  offset+=std::snprintf(output+offset,sizeof(output)-offset,"{\"pid\":%lu,\"created\":\"%llu\",\"phases\":[",GetCurrentProcessId(),
    static_cast<unsigned long long>(processCreation(GetCurrentProcess())));
  for(unsigned index=0;index<4;++index) {
    const auto value=SakuraEarlyEvidenceAt(index);
    offset+=std::snprintf(output+offset,sizeof(output)-offset,
      "%s{\"phase\":%lu,\"thread\":%lu,\"pid\":%lu,\"created\":\"%llu\",\"ready\":%s,\"active\":%s,\"privateStation\":%s,"
      "\"systemUser32\":%s,\"systemOle32\":%s,\"flags\":%lu,\"copyError\":%lu,\"pasteError\":%lu,\"oleCopy\":%lu,\"olePaste\":%lu,\"copies\":%lld,\"pastes\":%lld}",
      index?",":"",value->phase,value->thread,value->pid,static_cast<unsigned long long>(value->created),
      value->ready?"true":"false",value->active?"true":"false",value->privateStation?"true":"false",
      value->systemUser32?"true":"false",value->systemOle32?"true":"false",value->flags,value->copyError,value->pasteError,
      static_cast<DWORD>(value->oleCopy),static_cast<DWORD>(value->olePaste),static_cast<long long>(value->copies),static_cast<long long>(value->pastes));
  }
  offset+=std::snprintf(output+offset,sizeof(output)-offset,"]}\n");DWORD written=0;
  if(offset>=sizeof(output) || !WriteFile(pipe,output,DWORD(offset),&written,nullptr) || written!=offset)return 76;
  char command[16]{};DWORD count=0;ReadFile(pipe,command,sizeof(command),&count,nullptr);CloseHandle(pipe);return 0;
}
