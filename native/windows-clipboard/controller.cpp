#include "protocol.h"
#include <tlhelp32.h>
#include <sddl.h>
#include <algorithm>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

#ifndef SAKURA_CLIPBOARD_BUILD
#error The native build identity is required
#endif
struct Handle {
  HANDLE value;
  explicit Handle(HANDLE h):value(h) {}
  ~Handle() { if (value && value!=INVALID_HANDLE_VALUE) CloseHandle(value); }
  Handle(const Handle&)=delete;
};
static std::string utf8(const std::wstring& value) {
  const int count=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value.data(),int(value.size()),nullptr,0,nullptr,nullptr);
  if (!count && !value.empty()) throw std::runtime_error("invalid Unicode path");
  std::string result(count,'\0');
  if (count) WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,value.data(),int(value.size()),result.data(),count,nullptr,nullptr);
  return result;
}
static std::string json(const std::wstring& value) {
  const auto encoded=utf8(value);
  std::string result="\"";
  for (const unsigned char c:encoded) {
    if (c=='"' || c=='\\') { result+='\\'; result+=char(c); }
    else if (c<32) {
      constexpr char hex[]="0123456789abcdef";
      result+="\\u00"; result+=hex[c>>4]; result+=hex[c&15];
    } else result+=char(c);
  }
  return result+'"';
}
static bool same(const std::wstring& a,const std::wstring& b) {
  return CompareStringOrdinal(a.data(),int(a.size()),b.data(),int(b.size()),TRUE)==CSTR_EQUAL;
}
static std::vector<unsigned char> user(HANDLE process) {
  HANDLE tokenRaw=nullptr;
  if (!OpenProcessToken(process,TOKEN_QUERY,&tokenRaw)) throw std::runtime_error("process token unavailable");
  Handle token(tokenRaw); DWORD length=0;
  GetTokenInformation(token.value,TokenUser,nullptr,0,&length);
  if (!length || length>65536) throw std::runtime_error("invalid process token");
  std::vector<unsigned char> bytes(length);
  if (!GetTokenInformation(token.value,TokenUser,bytes.data(),length,&length)) throw std::runtime_error("process token unavailable");
  return bytes;
}
static bool ownUser(HANDLE process) {
  const auto actual=user(process), expected=user(GetCurrentProcess());
  return EqualSid(reinterpret_cast<const TOKEN_USER*>(actual.data())->User.Sid,
    reinterpret_cast<const TOKEN_USER*>(expected.data())->User.Sid)!=FALSE;
}
static std::wstring image(HANDLE process) {
  std::wstring result(32768,L'\0'); DWORD length=DWORD(result.size());
  if (!QueryFullProcessImageNameW(process,0,result.data(),&length)) throw std::runtime_error("process image unavailable");
  result.resize(length); return result;
}
static uint64_t number(const wchar_t* value) {
  if (!value || !*value || !std::all_of(value,value+wcslen(value),[](wchar_t c){return c>=L'0' && c<=L'9';}))
    throw std::runtime_error("invalid integer");
  wchar_t* last=nullptr; errno=0;
  const auto result=wcstoull(value,&last,10);
  if (errno || !last || *last) throw std::runtime_error("invalid integer");
  return result;
}
static std::wstring mapping(const wchar_t* owner,DWORD pid,uint64_t created) {
  const std::wstring name(owner);
  if (name.size()!=36 || !std::all_of(name.begin(),name.end(),[](wchar_t c){return (c>=L'a'&&c<=L'f') || (c>=L'0'&&c<=L'9') || c==L'-';}))
    throw std::runtime_error("invalid policy owner");
  return L"Local\\SakuraClipboard."+name+L"."+std::to_wstring(pid)+L"."+std::to_wstring(created);
}
static unsigned bits(HANDLE process) {
  USHORT wow=0,native=0;
  using Inspect=BOOL (WINAPI *)(HANDLE,USHORT*,USHORT*);
  const auto inspect=reinterpret_cast<Inspect>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"IsWow64Process2"));
  if (!inspect || !inspect(process,&wow,&native)) return 0;
  if (wow==IMAGE_FILE_MACHINE_I386) return 32;
  return wow==IMAGE_FILE_MACHINE_UNKNOWN && native==IMAGE_FILE_MACHINE_AMD64 ? 64 : 0;
}
static uintptr_t module(DWORD pid,const std::wstring& wanted,bool basename=false) {
  Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPMODULE|TH32CS_SNAPMODULE32,pid));
  if (snapshot.value==INVALID_HANDLE_VALUE) throw std::runtime_error("process modules unavailable");
  MODULEENTRY32W entry{}; entry.dwSize=sizeof(entry);
  if (Module32FirstW(snapshot.value,&entry)) do {
    if (same(basename ? entry.szModule : entry.szExePath,wanted)) return reinterpret_cast<uintptr_t>(entry.modBaseAddr);
  } while (Module32NextW(snapshot.value,&entry));
  return 0;
}
static DWORD remote(HANDLE process,uintptr_t function,const void* contents,size_t length) {
  void* memory=VirtualAllocEx(process,nullptr,length,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);
  if (!memory) throw std::runtime_error("remote argument allocation failed");
  SIZE_T written=0;
  if (!WriteProcessMemory(process,memory,contents,length,&written) || written!=length) {
    VirtualFreeEx(process,memory,0,MEM_RELEASE); throw std::runtime_error("remote argument write failed");
  }
  Handle thread(CreateRemoteThread(process,nullptr,0,reinterpret_cast<LPTHREAD_START_ROUTINE>(function),memory,0,nullptr));
  if (!thread.value) {
    VirtualFreeEx(process,memory,0,MEM_RELEASE); throw std::runtime_error("process rejects native attachment");
  }
  const DWORD wait=WaitForSingleObject(thread.value,30000);
  if (wait!=WAIT_OBJECT_0) {
    // The target still owns this argument. Freeing it would race its initializer.
    throw std::runtime_error("native attachment still pending");
  }
  DWORD result=0; const BOOL read=GetExitCodeThread(thread.value,&result);
  VirtualFreeEx(process,memory,0,MEM_RELEASE);
  if (!read) throw std::runtime_error("native attachment result unavailable");
  return result;
}
static void loaded(HANDLE process,DWORD pid,const std::wstring& library) {
  if (library.size()>=MAX_PATH || library.empty()) throw std::runtime_error("native library path too long");
  if (module(pid,library)) return;
  HMODULE owner=nullptr;
  const auto load=GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"LoadLibraryW");
  if (!load || !GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
      reinterpret_cast<LPCWSTR>(load),&owner)) throw std::runtime_error("system loader unavailable");
  wchar_t ownerPath[MAX_PATH]{};
  if (!GetModuleFileNameW(owner,ownerPath,MAX_PATH)) throw std::runtime_error("system loader unavailable");
  const std::wstring full(ownerPath);
  const auto base=module(pid,full.substr(full.find_last_of(L"\\/")+1),true);
  if (!base) throw std::runtime_error("target system loader unavailable");
  const auto address=base+(reinterpret_cast<uintptr_t>(load)-reinterpret_cast<uintptr_t>(owner));
  remote(process,address,library.c_str(),(library.size()+1)*sizeof(wchar_t));
  if (!module(pid,library)) throw std::runtime_error("native library did not load");
}
static DWORD configure(HANDLE process,DWORD pid,const std::wstring& library,const std::wstring& name) {
  HMODULE local=LoadLibraryExW(library.c_str(),nullptr,DONT_RESOLVE_DLL_REFERENCES|LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR);
  if (!local) throw std::runtime_error("native library metadata unavailable");
  const auto symbol=GetProcAddress(local,"SakuraConfigureClipboard");
  const auto offset=reinterpret_cast<uintptr_t>(symbol)-reinterpret_cast<uintptr_t>(local);
  FreeLibrary(local);
  if (!symbol) throw std::runtime_error("native library entry missing");
  SakuraClipboardConfigure request{SakuraClipboardMagic,SakuraClipboardVersion,{}};
  if (name.size()>=192) throw std::runtime_error("policy section name too long");
  std::copy(name.begin(),name.end(),request.section);
  return remote(process,module(pid,library)+offset,&request,sizeof(request));
}
static void list() {
  Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0));
  if (snapshot.value==INVALID_HANDLE_VALUE) throw std::runtime_error("process list unavailable");
  PROCESSENTRY32W entry{}; entry.dwSize=sizeof(entry);
  DWORD ownSession=0; ProcessIdToSessionId(GetCurrentProcessId(),&ownSession);
  bool first=true; std::cout<<"{\"processes\":[";
  if (Process32FirstW(snapshot.value,&entry)) do {
    if (entry.th32ProcessID==GetCurrentProcessId()) continue;
    DWORD sessionId=0;
    if (!ProcessIdToSessionId(entry.th32ProcessID,&sessionId) || sessionId!=ownSession) continue;
    Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,entry.th32ProcessID));
    if (!process.value) continue;
    try {
      if (!ownUser(process.value)) continue;
      const auto name=image(process.value);
      const auto created=processCreation(process.value);
      if (!created) continue;
      if (!first) std::cout<<',';
      first=false;
      std::cout<<"{\"pid\":"<<entry.th32ProcessID<<",\"created\":\""<<created<<"\",\"image\":"<<json(name)<<",\"bits\":"<<bits(process.value)<<'}';
    } catch (...) {}
  } while (Process32NextW(snapshot.value,&entry));
  std::cout<<"]}"<<std::endl;
}
static void state(const wchar_t* owner,DWORD pid,uint64_t created) {
  const auto name=mapping(owner,pid,created);
  Handle object(OpenFileMappingW(FILE_MAP_READ,FALSE,name.c_str()));
  if (!object.value) { std::cout<<"{\"present\":false}"<<std::endl; return; }
  const auto data=static_cast<const SakuraClipboardPolicy*>(MapViewOfFile(object.value,FILE_MAP_READ,0,0,sizeof(SakuraClipboardPolicy)));
  if (!data) throw std::runtime_error("policy section unavailable");
  SakuraClipboardPolicy value{};
  bool stable=false;
  for (int attempt=0;attempt<32;++attempt) {
    const LONG before=data->sequence;
    if (before & 1) continue;
    MemoryBarrier(); std::memcpy(&value,data,sizeof(value)); MemoryBarrier();
    if (before==data->sequence) { stable=true; break; }
  }
  if (!stable) { UnmapViewOfFile(data); throw std::runtime_error("native policy update still pending"); }
  if (value.magic!=SakuraClipboardMagic || value.version!=SakuraClipboardVersion || value.pid!=pid || value.creationTime!=created) {
    UnmapViewOfFile(data); throw std::runtime_error("existing native policy version differs");
  }
  std::cout<<"{\"present\":true,\"ready\":"<<(value.status==1 ? "true":"false")<<",\"active\":"<<(value.active ? "true":"false")
    <<",\"compatible\":"<<(std::memcmp(value.build,SAKURA_CLIPBOARD_BUILD,65)==0?"true":"false")
    <<",\"flags\":"<<value.flags<<",\"maximum\":"<<value.maxTextBytes<<",\"blockedCopy\":"<<value.blockedCopy<<",\"blockedPaste\":"<<value.blockedPaste<<'}'<<std::endl;
  UnmapViewOfFile(data);
}
static void apply(const wchar_t* owner,DWORD pid,uint64_t created,const std::wstring& expected,const std::wstring& library,uint32_t flags,uint32_t maximum,bool active) {
  if (flags>15 || maximum<1024 || maximum>1048576) throw std::runtime_error("invalid clipboard rule");
  Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|PROCESS_CREATE_THREAD|PROCESS_VM_OPERATION|PROCESS_VM_WRITE|PROCESS_VM_READ|SYNCHRONIZE,FALSE,pid));
  if (!process.value) throw std::runtime_error("process rejects native attachment");
  DWORD targetSession=0, ownSession=0;
  if (!ProcessIdToSessionId(pid,&targetSession) || !ProcessIdToSessionId(GetCurrentProcessId(),&ownSession) ||
      targetSession!=ownSession || !ownUser(process.value) || processCreation(process.value)!=created || !same(image(process.value),expected))
    throw std::runtime_error("process identity changed");
  const auto architecture=bits(process.value);
  if (architecture!=32 && architecture!=64) throw std::runtime_error("native process architecture unsupported");
  const auto name=mapping(owner,pid,created);
  const auto token=user(GetCurrentProcess()); wchar_t* sid=nullptr;
  if (!ConvertSidToStringSidW(reinterpret_cast<const TOKEN_USER*>(token.data())->User.Sid,&sid)) throw std::runtime_error("policy ACL unavailable");
  const std::wstring descriptor=L"D:P(A;;GA;;;"+std::wstring(sid)+L")(A;;GA;;;SY)";
  LocalFree(sid);
  PSECURITY_DESCRIPTOR security=nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(descriptor.c_str(),SDDL_REVISION_1,&security,nullptr)) throw std::runtime_error("policy ACL unavailable");
  SECURITY_ATTRIBUTES attributes{sizeof(attributes),security,FALSE};
  Handle object(CreateFileMappingW(INVALID_HANDLE_VALUE,&attributes,PAGE_READWRITE,0,sizeof(SakuraClipboardPolicy),name.c_str()));
  const bool exists=GetLastError()==ERROR_ALREADY_EXISTS;
  Handle writer(CreateMutexW(&attributes,FALSE,(name+L".writer").c_str()));
  LocalFree(security);
  if (!object.value || !writer.value) throw std::runtime_error("policy section unavailable");
  const DWORD acquired=WaitForSingleObject(writer.value,30000);
  if (acquired!=WAIT_OBJECT_0 && acquired!=WAIT_ABANDONED) throw std::runtime_error("native policy writer still pending");
  auto data=static_cast<SakuraClipboardPolicy*>(MapViewOfFile(object.value,FILE_MAP_ALL_ACCESS,0,0,sizeof(SakuraClipboardPolicy)));
  if (!data) { ReleaseMutex(writer.value); throw std::runtime_error("policy section unavailable"); }
  try {
    if (!exists) {
      std::memset(data,0,sizeof(*data));
      data->magic=SakuraClipboardMagic; data->version=SakuraClipboardVersion; data->pid=pid; data->creationTime=created;
      std::memcpy(data->build,SAKURA_CLIPBOARD_BUILD,65);
    } else if (data->magic!=SakuraClipboardMagic || data->version!=SakuraClipboardVersion || data->pid!=pid ||
        data->creationTime!=created || (active && std::memcmp(data->build,SAKURA_CLIPBOARD_BUILD,65)!=0))
      throw std::runtime_error("existing native policy version differs");
    const LONG revision=InterlockedCompareExchange(&data->sequence,0,0);
    InterlockedExchange(&data->sequence,revision|1);
    data->active=active; data->flags=flags; data->maxTextBytes=maximum;
    MemoryBarrier(); InterlockedExchange(&data->sequence,LONG(uint32_t(revision|1)+1u));
    // The process's DLL owns a ready mapping. Reuse it when the same build is
    // installed at a new path after an update; loading a second copy would
    // stack duplicate detours and OLE wrappers in an otherwise current process.
    if ((active || !exists) && data->status!=1) {
      if (architecture!=sizeof(void*)*8) throw std::runtime_error("native attachment requires a matching architecture controller");
      loaded(process.value,pid,library);
      const DWORD answer=configure(process.value,pid,library,name);
      if (answer || data->status!=1) throw std::runtime_error("native clipboard API attachment failed");
    }
  } catch (...) { UnmapViewOfFile(data); ReleaseMutex(writer.value); throw; }
  UnmapViewOfFile(data); ReleaseMutex(writer.value);
  state(owner,pid,created);
}
int wmain(int argc,wchar_t** argv) {
  try {
    if (argc==2 && std::wstring(argv[1])==L"list") { list(); return 0; }
    if (argc==5 && std::wstring(argv[1])==L"status") {
      const auto pid=number(argv[3]);
      if (!pid || pid>MAXDWORD) throw std::runtime_error("invalid process ID");
      state(argv[2],DWORD(pid),number(argv[4])); return 0;
    }
    if (argc==10 && std::wstring(argv[1])==L"apply") {
      const auto pid=number(argv[3]),flags=number(argv[7]),maximum=number(argv[8]),active=number(argv[9]);
      if (!pid || pid>MAXDWORD || flags>15 || maximum>1048576 || active>1) throw std::runtime_error("invalid rule argument");
      apply(argv[2],DWORD(pid),number(argv[4]),argv[5],argv[6],uint32_t(flags),uint32_t(maximum),active!=0); return 0;
    }
    throw std::runtime_error("invalid native controller command");
  } catch (const std::exception& error) {
    std::wstring reason;
    for (const unsigned char c:std::string(error.what())) reason+=wchar_t(c);
    std::cout<<"{\"error\":"<<json(reason)<<",\"systemError\":"<<GetLastError()<<'}'<<std::endl;
    return 1;
  }
}
