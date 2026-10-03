#pragma once
#include "fixture-shell.h"
#include <shellapi.h>
#include <thread>

// Owned fixture only. Observe the actual Shell CreateProcess call without
// intercepting attribute operations or changing their trusted caller origin.
static decltype(&CreateProcessW) shellCallOriginal=nullptr;
static thread_local HANDLE shellCallControl=nullptr;
static thread_local std::string shellCallFault;
static thread_local std::string shellCallEvidence="[]";
static BOOL WINAPI shellCallCreate(LPCWSTR image,LPWSTR command,LPSECURITY_ATTRIBUTES processSecurity,LPSECURITY_ATTRIBUTES threadSecurity,
    BOOL inherit,DWORD flags,LPVOID environment,LPCWSTR directory,LPSTARTUPINFOW startup,LPPROCESS_INFORMATION output) {
  const DWORD incoming=GetLastError();const DWORD thread=GetCurrentThreadId();
  const STARTUPINFOEXW before=startup && startup->cb==sizeof(STARTUPINFOEXW)?*reinterpret_cast<STARTUPINFOEXW*>(startup):STARTUPINFOEXW{};
  if(shellCallFault=="policy-off" || shellCallFault=="policy-change"){
    shellWrite(shellCallControl,"{\"beforeCreate\":true,\"thread\":"+std::to_string(thread)+"}\n");
    std::string answer;if(!shellRead(shellCallControl,answer) || answer!="continue"){SetLastError(ERROR_OPERATION_ABORTED);return FALSE;}
  }
  DWORD reentry=0;
  if(shellCallFault=="reentry"){
    SHELLEXECUTEINFOW nested{};nested.cbSize=sizeof(nested);nested.fMask=SEE_MASK_NOASYNC|SEE_MASK_FLAG_NO_UI|SEE_MASK_NOCLOSEPROCESS|SEE_MASK_NO_CONSOLE;
    nested.lpFile=image;nested.lpVerb=L"open";nested.nShow=SW_HIDE;
    if(ShellExecuteExW(&nested)){if(nested.hProcess){TerminateProcess(nested.hProcess,1);CloseHandle(nested.hProcess);}SetLastError(ERROR_INVALID_DATA);return FALSE;}
    reentry=GetLastError();
  }
  SetLastError(incoming);BOOL result=FALSE;
  if(shellCallFault=="plain-startup"){
    STARTUPINFOW ordinary=*startup;ordinary.cb=sizeof(ordinary);
    result=shellCallOriginal(image,command,processSecurity,threadSecurity,inherit,flags&~EXTENDED_STARTUPINFO_PRESENT,environment,directory,&ordinary,output);
  }else if(shellCallFault=="cross-thread"){
    std::thread worker([&]{result=shellCallOriginal(image,command,processSecurity,threadSecurity,inherit,flags,environment,directory,startup,output);reentry=GetLastError();});
    worker.join();SetLastError(reentry);
  }else result=shellCallOriginal(image,command,processSecurity,threadSecurity,inherit,flags,environment,directory,startup,output);
  const DWORD error=GetLastError();DWORD suspension=DWORD(-1);
  if(result){suspension=SuspendThread(output->hThread);if(suspension!=DWORD(-1))ResumeThread(output->hThread);}
  const bool preserved=startup && startup->cb==sizeof(before) && std::memcmp(&before,startup,sizeof(before))==0;
  shellCallEvidence="[{\"thread\":"+std::to_string(thread)+",\"flags\":"+std::to_string(flags)+",\"inherit\":"+(inherit?"true":"false")+",\"startupCb\":"+std::to_string(startup?startup->cb:0)+",\"startupFlags\":"+std::to_string(startup?startup->dwFlags:0)+",\"startupPreserved\":"+(preserved?"true":"false")+",\"stdin\":\""+std::to_string(uintptr_t(startup?startup->hStdInput:nullptr))+"\",\"stdout\":\""+std::to_string(uintptr_t(startup?startup->hStdOutput:nullptr))+"\",\"stderr\":\""+std::to_string(uintptr_t(startup?startup->hStdError:nullptr))+"\",\"suspendedBeforeShellResume\":"+std::to_string(suspension)+",\"reentryError\":"+std::to_string(reentry)+",\"started\":"+(result?"true":"false")+",\"error\":"+std::to_string(error)+"}]";
  SetLastError(error);return result;
}
static void shellCallInstall() {
  const DWORD incoming=GetLastError();
  LoadLibraryExW(L"windows.storage.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32);
  for(const wchar_t* name:{L"shell32.dll",L"windows.storage.dll"}){
    const HMODULE module=GetModuleHandleW(name);if(!module)continue;const auto base=reinterpret_cast<unsigned char*>(module);
    const auto dos=reinterpret_cast<const IMAGE_DOS_HEADER*>(base);const auto nt=reinterpret_cast<const IMAGE_NT_HEADERS*>(base+dos->e_lfanew);
    const auto directory=nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];if(!directory.VirtualAddress)continue;
    for(auto imported=reinterpret_cast<IMAGE_IMPORT_DESCRIPTOR*>(base+directory.VirtualAddress);imported->Name;++imported){
      if(!imported->OriginalFirstThunk)continue;const auto names=reinterpret_cast<const IMAGE_THUNK_DATA*>(base+imported->OriginalFirstThunk);
      auto slots=reinterpret_cast<IMAGE_THUNK_DATA*>(base+imported->FirstThunk);
      for(size_t index=0;names[index].u1.AddressOfData;++index){
        if(IMAGE_SNAP_BY_ORDINAL(names[index].u1.Ordinal))continue;
        const auto api=reinterpret_cast<const IMAGE_IMPORT_BY_NAME*>(base+names[index].u1.AddressOfData)->Name;
        if(std::strcmp(reinterpret_cast<const char*>(api),"CreateProcessW"))continue;
        auto slot=reinterpret_cast<void**>(&slots[index].u1.Function);
        if(*slot==reinterpret_cast<void*>(&shellCallCreate))continue;
        if(shellCallOriginal && *slot!=reinterpret_cast<void*>(shellCallOriginal))continue;
        shellCallOriginal=reinterpret_cast<decltype(shellCallOriginal)>(*slot);DWORD previous=0,restored=0;
        if(VirtualProtect(slot,sizeof(void*),PAGE_READWRITE,&previous)){InterlockedExchangePointer(slot,reinterpret_cast<void*>(&shellCallCreate));VirtualProtect(slot,sizeof(void*),previous,&restored);}
      }
    }
  }
  shellCallEvidence="[]";SetLastError(incoming);
}
