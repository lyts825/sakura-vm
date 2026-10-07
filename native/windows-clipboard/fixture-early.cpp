/**
 * 模块职责（中文）：真实 EXE TLS 和入口探针合并四个阶段证据，有界 JSON 与私有管道报告初始化顺序、策略及系统映像来源。
 * Module responsibilities (English): Real EXE TLS/entry probes combine four-stage evidence into bounded JSON/private-pipe reporting of initialization order/policy/system image provenance.
 */
/** 原生 EXE 早期初始化探针，记录 TLS 和入口处的剪贴板策略结果及映像身份。 */
#include "fixture-early.h"
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <io.h>
#include <fcntl.h>
#include <string>

/** 中文：严格将终止宽路径转为 UTF-8 并转义 JSON 特殊字节，控制字符或转换失败返回空。 English: Strictly convert a terminated wide path to UTF-8 and escape JSON bytes, returning empty on control characters/conversion failure. 参数声明 / Declared parameters: const wchar_t* path. */
static std::string jsonPath(const wchar_t* path) {
  const int count=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,path,-1,nullptr,0,nullptr,nullptr);
  if(count<=0)return {};
  std::string text(size_t(count),'\0');
  if(WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,path,-1,text.data(),count,nullptr,nullptr)!=count)return {};
  text.resize(size_t(count-1));
  std::string escaped;
  for(const unsigned char character:text) {
    if(character=='\\' || character=='"')escaped+='\\';
    if(character<32)return {};
    escaped+=char(character);
  }
  return escaped;
}

/** 中文：EXE 进程附加 TLS 阶段记录阶段 2 的真实剪贴板证据。 English: Record phase-2 actual clipboard evidence at EXE process-attach TLS. 参数声明 / Declared parameters: PVOID,DWORD reason,PVOID. */
static void NTAPI earlyExeTls(PVOID,DWORD reason,PVOID) {
  if(reason==DLL_PROCESS_ATTACH)SakuraEarlyRecord(2);
}
PIMAGE_TLS_CALLBACK earlyExeCallback __attribute__((section(".CRT$XLB"),used))=earlyExeTls;
/** 中文：记录阶段 3，合并四个初始化阶段证据到有界 JSON 缓冲并完整写入私有管道，超限/短写失败，读取控制命令后关闭通道。 English: Record phase 3, combine four initialization phases into bounded JSON and fully write the private pipe; fail on overflow/short writes and close after the control command. */
int wmain() {
  SakuraEarlyRecord(3);
  wchar_t pipeName[256]{};
  if(!earlyArgument(L"--early-pipe=",pipeName,256))return 74;
  HANDLE pipe=CreateFileW(pipeName,GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr);
  if(pipe==INVALID_HANDLE_VALUE)return 75;
  char output[16384]{};size_t offset=0;
  offset+=std::snprintf(output+offset,sizeof(output)-offset,"{\"pid\":%lu,\"created\":\"%llu\",\"phases\":[",GetCurrentProcessId(),
    static_cast<unsigned long long>(processCreation(GetCurrentProcess())));
  for(unsigned index=0;index<4;++index) {
    const auto value=SakuraEarlyEvidenceAt(index);
    offset+=std::snprintf(output+offset,sizeof(output)-offset,
      "%s{\"phase\":%lu,\"thread\":%lu,\"pid\":%lu,\"created\":\"%llu\",\"ready\":%s,\"active\":%s,\"privateStation\":%s,"
      "\"systemUser32\":%s,\"systemOle32\":%s,\"protectedCommonControls\":%s,\"commonControlsPath\":\"%s\",\"flags\":%lu,\"copyError\":%lu,\"pasteError\":%lu,\"oleCopy\":%lu,\"olePaste\":%lu,\"copies\":%lld,\"pastes\":%lld}",
      index?",":"",value->phase,value->thread,value->pid,static_cast<unsigned long long>(value->created),
      value->ready?"true":"false",value->active?"true":"false",value->privateStation?"true":"false",
      value->systemUser32?"true":"false",value->systemOle32?"true":"false",value->protectedCommonControls?"true":"false",
      jsonPath(value->commonControlsPath).c_str(),value->flags,value->copyError,value->pasteError,
      static_cast<DWORD>(value->oleCopy),static_cast<DWORD>(value->olePaste),static_cast<long long>(value->copies),static_cast<long long>(value->pastes));
  }
  offset+=std::snprintf(output+offset,sizeof(output)-offset,"]}\n");DWORD written=0;
  if(offset>=sizeof(output) || !WriteFile(pipe,output,DWORD(offset),&written,nullptr) || written!=offset)return 76;
  char command[16]{};DWORD count=0;ReadFile(pipe,command,sizeof(command),&count,nullptr);CloseHandle(pipe);return 0;
}
