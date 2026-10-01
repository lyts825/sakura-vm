#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0a00
#endif
#include "protocol.h"
#include "early-import.h"
#include <tlhelp32.h>
#include <sddl.h>
#include <wincrypt.h>
#include <xmllite.h>
#include <shlwapi.h>
#include <algorithm>
#include <cstring>
#include <exception>
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
static void state(const wchar_t* owner,DWORD pid,uint64_t created,bool newline=true) {
  const auto name=mapping(owner,pid,created);
  Handle object(OpenFileMappingW(FILE_MAP_READ,FALSE,name.c_str()));
  if (!object.value) { std::cout<<"{\"present\":false}"<<(newline?"\n":""); return; }
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
    <<",\"flags\":"<<value.flags<<",\"maximum\":"<<value.maxTextBytes<<",\"blockedCopy\":"<<value.blockedCopy<<",\"blockedPaste\":"<<value.blockedPaste<<'}'<<(newline?"\n":"");
  UnmapViewOfFile(data);
}
static void apply(const wchar_t* owner,DWORD pid,uint64_t created,const std::wstring& expected,const std::wstring& library,uint32_t flags,uint32_t maximum,bool active,bool report=true) {
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
  if (report) { state(owner,pid,created); std::cout.flush(); }
}
static std::string fileDigest(HANDLE file) {
  LARGE_INTEGER size{}, start{};
  if (!GetFileSizeEx(file,&size) || size.QuadPart<=0 || size.QuadPart>512ll*1024*1024 ||
      !SetFilePointerEx(file,start,nullptr,FILE_BEGIN)) throw std::runtime_error("invalid application file");
  HCRYPTPROV provider=0; HCRYPTHASH hash=0;
  if (!CryptAcquireContextW(&provider,nullptr,nullptr,PROV_RSA_AES,CRYPT_VERIFYCONTEXT))
    throw std::runtime_error("application digest unavailable");
  if (!CryptCreateHash(provider,CALG_SHA_256,0,0,&hash)) {
    CryptReleaseContext(provider,0); throw std::runtime_error("application digest unavailable");
  }
  unsigned char buffer[65536], digest[32]; DWORD count=0,length=32;
  bool good=true;
  do {
    if (!ReadFile(file,buffer,sizeof(buffer),&count,nullptr) || (count && !CryptHashData(hash,buffer,count,0))) {good=false;break;}
  } while (count);
  good=good && CryptGetHashParam(hash,HP_HASHVAL,digest,&length,0) && length==32;
  CryptDestroyHash(hash); CryptReleaseContext(provider,0);
  if (!good) throw std::runtime_error("application digest unavailable");
  std::string value;
  constexpr char hex[]="0123456789abcdef";
  for (const unsigned char byte:digest) {value+=hex[byte>>4];value+=hex[byte&15];}
  return value;
}
static void selectedFile(HANDLE file,const std::wstring& expected,const std::wstring& wantedDigest) {
  if (wantedDigest.size()!=64 || !std::all_of(wantedDigest.begin(),wantedDigest.end(),[](wchar_t c){
      return (c>=L'0'&&c<=L'9') || (c>=L'a'&&c<=L'f');})) throw std::runtime_error("invalid application digest");
  FILE_ATTRIBUTE_TAG_INFO information{};
  if (!GetFileInformationByHandleEx(file,FileAttributeTagInfo,&information,sizeof(information)) ||
      (information.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT)))
    throw std::runtime_error("application must be a regular file");
  std::wstring actual(32768,L'\0');
  const DWORD size=GetFinalPathNameByHandleW(file,actual.data(),DWORD(actual.size()),FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);
  if (!size || size>=actual.size()) throw std::runtime_error("application path unavailable");
  actual.resize(size);
  if (actual.rfind(L"\\\\?\\",0)==0) actual.erase(0,4);
  if (!same(actual,expected) || fileDigest(file)!=utf8(wantedDigest))
    throw std::runtime_error("application file identity changed");
}
static void primarySuspended(HANDLE thread) {
  const DWORD previous=SuspendThread(thread);
  if (previous==DWORD(-1)) throw std::runtime_error("primary thread suspension unavailable");
  const DWORD restored=ResumeThread(thread);
  if (previous!=1 || restored!=2) throw std::runtime_error("primary thread is no longer exclusively suspended");
}
static void nativeExecutable(HANDLE file) {
  // Do not let Detours convert CLR/AnyCPU or a mismatched PE into a different
  // startup path. Only native x86/x64 GUI/console images are supported here.
  const auto read=[&](uint64_t offset,void* output,DWORD length) {
    LARGE_INTEGER position{};position.QuadPart=offset;DWORD count=0;
    return SetFilePointerEx(file,position,nullptr,FILE_BEGIN) &&
      ReadFile(file,output,length,&count,nullptr) && count==length;
  };
  IMAGE_DOS_HEADER dos{};IMAGE_NT_HEADERS pe{};
  if(!read(0,&dos,sizeof(dos)) || dos.e_magic!=IMAGE_DOS_SIGNATURE || dos.e_lfanew<sizeof(dos) ||
      dos.e_lfanew>1048576 || !read(dos.e_lfanew,&pe,sizeof(pe)) || pe.Signature!=IMAGE_NT_SIGNATURE ||
      pe.FileHeader.Machine!=(sizeof(void*)==8?IMAGE_FILE_MACHINE_AMD64:IMAGE_FILE_MACHINE_I386) ||
      !(pe.FileHeader.Characteristics&IMAGE_FILE_EXECUTABLE_IMAGE) || pe.FileHeader.Characteristics&IMAGE_FILE_DLL ||
      pe.FileHeader.SizeOfOptionalHeader!=sizeof(pe.OptionalHeader) ||
      pe.OptionalHeader.Magic!=IMAGE_NT_OPTIONAL_HDR_MAGIC || pe.OptionalHeader.NumberOfRvaAndSizes<16 ||
      (pe.OptionalHeader.Subsystem!=IMAGE_SUBSYSTEM_WINDOWS_GUI && pe.OptionalHeader.Subsystem!=IMAGE_SUBSYSTEM_WINDOWS_CUI) ||
      pe.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_COM_DESCRIPTOR].VirtualAddress ||
      pe.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_COM_DESCRIPTOR].Size)
    throw std::runtime_error("controlled early initialization requires a native matching x86/x64 executable");
}
static std::string importPath(const std::wstring& library) {
  if(library.size()<7 || library.size()>=MAX_PATH || library[1]!=L':' || library[2]!=L'\\' ||
      !same(library.substr(library.size()-4),L".dll"))throw std::runtime_error("early policy requires a complete DLL path");
  // Detours writes narrow PE import names. Reject a lossy conversion rather
  // than load an alias, short path, or another library under the active ACP.
  const UINT encoding=GetACP();BOOL substituted=FALSE;
  const DWORD flags=encoding==CP_UTF8?WC_ERR_INVALID_CHARS:WC_NO_BEST_FIT_CHARS;
  BOOL* used=encoding==CP_UTF8?nullptr:&substituted;
  const int length=WideCharToMultiByte(encoding,flags,library.data(),int(library.size()),nullptr,0,nullptr,used);
  if(!length || substituted)throw std::runtime_error("early DLL path cannot be represented by the Windows import encoding");
  std::string result(length,'\0');
  if(!WideCharToMultiByte(encoding,flags,library.data(),int(library.size()),result.data(),length,nullptr,used) || substituted)
    throw std::runtime_error("early DLL path cannot be represented by the Windows import encoding");
  std::wstring restored(library.size(),L'\0');
  const int characters=MultiByteToWideChar(encoding,MB_ERR_INVALID_CHARS,result.data(),length,restored.data(),int(restored.size()));
  if(characters!=int(library.size()) || restored!=library)
    throw std::runtime_error("early DLL path cannot be represented by the Windows import encoding");
  return result;
}
static bool exists(const std::wstring& path) {
  if(GetFileAttributesW(path.c_str())!=INVALID_FILE_ATTRIBUTES)return true;
  const DWORD error=GetLastError();
  if(error!=ERROR_FILE_NOT_FOUND && error!=ERROR_PATH_NOT_FOUND)
    throw std::runtime_error("early dependency redirection metadata unavailable");
  return false;
}
static bool policyDependency(const std::wstring& path,const std::wstring& library) {
  const auto name=path.substr(path.find_last_of(L"\\/")+1);
  const auto policy=library.substr(library.find_last_of(L"\\/")+1);
  if(same(name,policy))return true;
  const std::wstring protectedNames[]{L"kernel32.dll",L"kernelbase.dll",L"user32.dll",L"ole32.dll",L"combase.dll",L"ucrtbase.dll",L"msvcrt.dll"};
  for(const auto& item:protectedNames)if(same(name,item))return true;
  // KnownDLL's own dependencies are also resolved from Windows. A manifest can
  // precede that resolution, so protect the current OS's entire KnownDLL set,
  // including transitive User32/OLE dependencies rather than a fixed DLL list.
  static const std::vector<std::wstring> known=[]() {
    HKEY raw=nullptr;
    if(RegOpenKeyExW(HKEY_LOCAL_MACHINE,L"SYSTEM\\CurrentControlSet\\Control\\Session Manager\\KnownDLLs",0,KEY_QUERY_VALUE|KEY_WOW64_64KEY,&raw)!=ERROR_SUCCESS)
      throw std::runtime_error("Windows early system dependency list unavailable");
    std::vector<std::wstring> values;
    try {
      for(DWORD index=0;;++index) {
        wchar_t key[256]{},value[512]{};DWORD keyLength=256,length=sizeof(value),type=0;
        const LSTATUS answer=RegEnumValueW(raw,index,key,&keyLength,nullptr,&type,reinterpret_cast<BYTE*>(value),&length);
        if(answer==ERROR_NO_MORE_ITEMS)break;
        if(answer!=ERROR_SUCCESS || index>4096)throw std::runtime_error("Windows early system dependency list unavailable");
        if(type==REG_SZ && length>=sizeof(wchar_t) && length<=sizeof(value) && value[length/sizeof(wchar_t)-1]==0)values.emplace_back(value);
      }
    } catch(...) {RegCloseKey(raw);throw;}
    RegCloseKey(raw);
    if(std::none_of(values.begin(),values.end(),[](const std::wstring& item){return same(item,L"user32.dll");}) ||
        std::none_of(values.begin(),values.end(),[](const std::wstring& item){return same(item,L"ole32.dll");}))
      throw std::runtime_error("Windows early clipboard dependencies are not known system DLLs");
    return values;
  }();
  for(const auto& item:known)if(same(name,item))return true;
  return name.size()>4 && (same(name.substr(0,4),L"api-") || same(name.substr(0,4),L"ext-"));
}
static std::vector<unsigned char> activationData(HANDLE context,ULONG type,void* index,size_t minimum) {
  SIZE_T length=0;
  if(QueryActCtxW(0,context,index,type,nullptr,0,&length) || GetLastError()!=ERROR_INSUFFICIENT_BUFFER ||
      length<minimum || length>8*1024*1024)throw std::runtime_error("early activation context unavailable");
  std::vector<unsigned char> data(length);
  if(!QueryActCtxW(0,context,index,type,data.data(),data.size(),&length))
    throw std::runtime_error("early activation context unavailable");
  return data;
}
static void manifestXml(const void* contents,DWORD length,const std::wstring& library) {
  if(!contents || !length || length>8*1024*1024)throw std::runtime_error("early application manifest is too large or empty");
  IStream* stream=SHCreateMemStream(static_cast<const BYTE*>(contents),length);
  IXmlReader* reader=nullptr;
  if(!stream)throw std::runtime_error("early application manifest reader unavailable");
  try {
    if(FAILED(CreateXmlReader(__uuidof(IXmlReader),reinterpret_cast<void**>(&reader),nullptr)) || !reader ||
        FAILED(reader->SetProperty(XmlReaderProperty_ConformanceLevel,XmlConformanceLevel_Document)) ||
        FAILED(reader->SetProperty(XmlReaderProperty_DtdProcessing,DtdProcessing_Prohibit)) ||
        FAILED(reader->SetProperty(XmlReaderProperty_XmlResolver,0)) ||
        FAILED(reader->SetProperty(XmlReaderProperty_MaxElementDepth,128)) || FAILED(reader->SetInput(stream)))
      throw std::runtime_error("early application manifest reader unavailable");
    XmlNodeType type{};HRESULT answer=S_OK;
    while((answer=reader->Read(&type))==S_OK) {
      if(type!=XmlNodeType_Element)continue;
      const wchar_t* name=nullptr;UINT count=0;
      if(FAILED(reader->GetLocalName(&name,&count)) || !name)
        throw std::runtime_error("early application manifest could not be verified");
      if(!same(std::wstring(name,count),L"file"))continue;
      if(reader->MoveToAttributeByName(L"name",nullptr)!=S_OK ||
          FAILED(reader->GetValue(&name,&count)) || !name || !count || count>=32768)
        throw std::runtime_error("early application manifest file name unavailable");
      // XmlLite decodes both UTF-8/UTF-16 and XML character references. No DTD,
      // external resolver, or application code is involved in this metadata read.
      if(policyDependency(std::wstring(name,count),library))
        throw std::runtime_error("application manifest redirects an early policy dependency");
    }
    if(answer!=S_FALSE)throw std::runtime_error("early application manifest could not be verified");
  } catch(...) {if(reader)reader->Release();stream->Release();throw;}
  reader->Release();stream->Release();
}
struct ManifestResources {
  const std::wstring& library;
  bool executable;
  unsigned count=0;
  std::exception_ptr failure;
};
static BOOL CALLBACK manifestLanguage(HMODULE data,LPCWSTR type,LPCWSTR name,WORD language,LONG_PTR parameter) {
  auto& read=*reinterpret_cast<ManifestResources*>(parameter);
  try {
    if(++read.count>1024)throw std::runtime_error("early manifest has too many resources");
    const HRSRC resource=FindResourceExW(data,type,name,language);
    const HGLOBAL loaded=resource?LoadResource(data,resource):nullptr;
    manifestXml(loaded?LockResource(loaded):nullptr,resource?SizeofResource(data,resource):0,read.library);
    return TRUE;
  } catch(...) {read.failure=std::current_exception();return FALSE;}
}
static BOOL CALLBACK manifestResource(HMODULE data,LPCWSTR type,LPWSTR name,LONG_PTR parameter) {
  auto& read=*reinterpret_cast<ManifestResources*>(parameter);
  // The process root selects resource 1. A resolved private assembly image's
  // selected resource ID is not in QueryActCtx's file path; check every local
  // RT_MANIFEST resource/language rather than silently skip an unknown one.
  if(read.executable && (!IS_INTRESOURCE(name) || reinterpret_cast<uintptr_t>(name)!=1))return TRUE;
  if(!EnumResourceLanguagesExW(data,type,name,manifestLanguage,parameter,RESOURCE_ENUM_LN,0)) {
    if(!read.failure)read.failure=std::make_exception_ptr(std::runtime_error("early manifest languages unavailable"));
    return FALSE;
  }
  return TRUE;
}
static void manifestMetadata(const std::wstring& path,const std::wstring& library,bool image,bool required=false) {
  if(image) {
    // DATAFILE/IMAGE_RESOURCE maps metadata only; it never resolves application
    // imports or executes that image's DllMain/TLS during the helper's precheck.
    HMODULE data=LoadLibraryExW(path.c_str(),nullptr,LOAD_LIBRARY_AS_DATAFILE_EXCLUSIVE|LOAD_LIBRARY_AS_IMAGE_RESOURCE);
    if(!data)throw std::runtime_error("early application manifest resource unavailable");
    try {
      ManifestResources read{library,!required};
      const BOOL scanned=EnumResourceNamesExW(data,MAKEINTRESOURCEW(24),manifestResource,
        reinterpret_cast<LONG_PTR>(&read),RESOURCE_ENUM_LN,0);
      if(read.failure)std::rethrow_exception(read.failure);
      if(!scanned) {
        const DWORD error=GetLastError();
        if(error!=ERROR_RESOURCE_TYPE_NOT_FOUND && error!=ERROR_RESOURCE_NAME_NOT_FOUND && error!=ERROR_RESOURCE_DATA_NOT_FOUND)
          throw std::runtime_error("early application manifest resource unavailable");
      }
      if(required && !read.count)throw std::runtime_error("resolved early assembly manifest resource unavailable");
    } catch(...) {FreeLibrary(data);throw;}
    FreeLibrary(data);return;
  }
  Handle file(CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr));
  LARGE_INTEGER length{};DWORD count=0;
  if(file.value==INVALID_HANDLE_VALUE || !GetFileSizeEx(file.value,&length) || length.QuadPart<=0 || length.QuadPart>8*1024*1024)
    throw std::runtime_error("early application manifest file unavailable");
  std::vector<unsigned char> contents(size_t(length.QuadPart));
  if(!ReadFile(file.value,contents.data(),DWORD(contents.size()),&count,nullptr) || count!=contents.size())
    throw std::runtime_error("early application manifest file unavailable");
  manifestXml(contents.data(),count,library);
}
static void activationDependencies(const std::wstring& source,const std::wstring& library,bool image) {
  manifestMetadata(source,library,image);
  ACTCTXW request{};request.cbSize=sizeof(request);request.lpSource=source.c_str();
  if(image){request.dwFlags=ACTCTX_FLAG_RESOURCE_NAME_VALID;request.lpResourceName=MAKEINTRESOURCEW(1);}
  const HANDLE context=CreateActCtxW(&request);
  if(context==INVALID_HANDLE_VALUE) {
    const DWORD error=GetLastError();
    if(image && (error==ERROR_RESOURCE_TYPE_NOT_FOUND || error==ERROR_RESOURCE_NAME_NOT_FOUND || error==ERROR_RESOURCE_DATA_NOT_FOUND))return;
    throw std::runtime_error("early application manifest could not be verified");
  }
  try {
    const auto details=activationData(context,ActivationContextDetailedInformation,nullptr,sizeof(ACTIVATION_CONTEXT_DETAILED_INFORMATION));
    const DWORD assemblies=reinterpret_cast<const ACTIVATION_CONTEXT_DETAILED_INFORMATION*>(details.data())->ulAssemblyCount;
    if(assemblies>1024)throw std::runtime_error("early activation context is too large");
    for(DWORD assembly=1;assembly<=assemblies;++assembly) {
      const auto data=activationData(context,AssemblyDetailedInformationInActivationContext,&assembly,sizeof(ACTIVATION_CONTEXT_ASSEMBLY_DETAILED_INFORMATION));
      const auto description=reinterpret_cast<const ACTIVATION_CONTEXT_ASSEMBLY_DETAILED_INFORMATION*>(data.data());
      // ulFileCount can be zero even when DLL redirection is active. Read the
      // manifests in the OS-resolved assembly graph as XML rather than treat a
      // zero enumeration as proof that no file redirection exists.
      if(!description->lpAssemblyManifestPath || !description->ulManifestPathLength || description->ulManifestPathLength>=32768)
        throw std::runtime_error("early assembly manifest path unavailable");
      const std::wstring path(description->lpAssemblyManifestPath);
      if(!same(path,source))manifestMetadata(path,library,path.size()>4 &&
        (same(path.substr(path.size()-4),L".exe") || same(path.substr(path.size()-4),L".dll")),true);
      const DWORD files=description->ulFileCount;
      if(files>65536)throw std::runtime_error("early activation context is too large");
      for(DWORD file=0;file<files;++file) {
        ACTIVATION_CONTEXT_QUERY_INDEX index{assembly,file};
        const auto item=activationData(context,FileInformationInAssemblyOfAssemblyInActivationContext,&index,sizeof(ASSEMBLY_FILE_DETAILED_INFORMATION));
        const auto information=reinterpret_cast<const ASSEMBLY_FILE_DETAILED_INFORMATION*>(item.data());
        if(!information->lpFileName || policyDependency(information->lpFileName,library))
          throw std::runtime_error("application manifest redirects an early policy dependency");
      }
    }
  } catch(...) {ReleaseActCtx(context);throw;}
  ReleaseActCtx(context);
}
static void earlyDependencies(const std::wstring& expected,const std::wstring& library) {
  // Redirection precedes KnownDLL resolution, even for a fully qualified import.
  // Inspect manifests as data with supported SxS queries, never by loading app
  // code. Ordinary manifests/Common Controls remain supported; redirects of the
  // policy or its system dependencies must fail before the loader can run.
  policyDependency(L"verify-known-system-dependencies",library);
  if(exists(expected+L".local"))throw std::runtime_error("DLL .local redirection does not support controlled early initialization");
  if(exists(expected.substr(0,expected.find_last_of(L'\\'))+L"\\microsoft.system.package.metadata\\application.local"))
    throw std::runtime_error("packaged DLL redirection does not support controlled early initialization");
  activationDependencies(expected,library,true);
  if(exists(expected+L".manifest"))activationDependencies(expected+L".manifest",library,false);
}
struct EarlyPolicy {
  Handle object;
  SakuraClipboardPolicy* data;
  std::wstring name;
  EarlyPolicy(const wchar_t* owner,DWORD pid,uint64_t created,uint32_t flags,uint32_t maximum):
      object(nullptr),data(nullptr),name(mapping(owner,pid,created)) {
    const auto token=user(GetCurrentProcess());wchar_t* sid=nullptr;
    if(!ConvertSidToStringSidW(reinterpret_cast<const TOKEN_USER*>(token.data())->User.Sid,&sid))
      throw std::runtime_error("early policy ACL unavailable");
    const std::wstring descriptor=L"D:P(A;;GA;;;"+std::wstring(sid)+L")(A;;GA;;;SY)";LocalFree(sid);
    PSECURITY_DESCRIPTOR security=nullptr;
    if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(descriptor.c_str(),SDDL_REVISION_1,&security,nullptr))
      throw std::runtime_error("early policy ACL unavailable");
    SECURITY_ATTRIBUTES attributes{sizeof(attributes),security,FALSE};
    object.value=CreateFileMappingW(INVALID_HANDLE_VALUE,&attributes,PAGE_READWRITE,0,sizeof(SakuraClipboardPolicy),name.c_str());
    const DWORD error=GetLastError();LocalFree(security);
    if(!object.value || error==ERROR_ALREADY_EXISTS)throw std::runtime_error("fresh early policy section unavailable");
    data=static_cast<SakuraClipboardPolicy*>(MapViewOfFile(object.value,FILE_MAP_ALL_ACCESS,0,0,sizeof(SakuraClipboardPolicy)));
    if(!data)throw std::runtime_error("fresh early policy section unavailable");
    std::memset(data,0,sizeof(*data));data->sequence=1;
    data->magic=SakuraClipboardMagic;data->version=SakuraClipboardVersion;data->pid=pid;data->creationTime=created;
    data->active=1;data->flags=flags;data->maxTextBytes=maximum;std::memcpy(data->build,SAKURA_CLIPBOARD_BUILD,65);
    MemoryBarrier();InterlockedExchange(&data->sequence,2);
  }
  ~EarlyPolicy(){if(data)UnmapViewOfFile(data);}
  void insert(HANDLE process,const std::string& library) {
    PROCESS_MITIGATION_DYNAMIC_CODE_POLICY dynamic{};PROCESS_MITIGATION_BINARY_SIGNATURE_POLICY signatures{};
    if(!GetProcessMitigationPolicy(process,ProcessDynamicCodePolicy,&dynamic,sizeof(dynamic)) || dynamic.ProhibitDynamicCode ||
        !GetProcessMitigationPolicy(process,ProcessSignaturePolicy,&signatures,sizeof(signatures)) ||
        signatures.MicrosoftSignedOnly || signatures.StoreSignedOnly)
      throw std::runtime_error("process mitigation rejects early native policy injection");
    SakuraClipboardEarly input{};
    input.magic=SakuraClipboardMagic;input.version=SakuraClipboardVersion;input.pid=data->pid;input.creationTime=data->creationTime;
    std::memcpy(input.build,SAKURA_CLIPBOARD_BUILD,65);std::copy(name.begin(),name.end(),input.section);
    LPCSTR imported=library.c_str();
    if(!DetourCopyPayloadToProcess(process,SakuraClipboardEarlyGuid,&input,sizeof(input)) ||
        !DetourUpdateProcessWithDll(process,&imported,1))
      throw std::runtime_error("suspended process rejects early policy import");
  }
  void ready() {
    if(data->status!=1 || data->sequence&1 || !data->active || data->magic!=SakuraClipboardMagic ||
        data->version!=SakuraClipboardVersion || std::memcmp(data->build,SAKURA_CLIPBOARD_BUILD,65)!=0)
      throw std::runtime_error("early native policy did not initialize before application imports");
  }
};
static void initializeLoader(HANDLE process,DWORD pid) {
  // The first import is already our synchronously configured policy DLL. This
  // thread lets the loader finish original application imports/TLS while the
  // primary thread remains suspended; it never starts the application entry.
  const HMODULE local=GetModuleHandleW(L"ntdll.dll");
  const auto exit=GetProcAddress(local,"RtlExitUserThread");
  // Toolhelp has no module list until this fresh process's loader runs. Locate
  // the exact same mapped system ntdll image, without assuming ASLR addresses.
  using MappedName=DWORD(WINAPI*)(HANDLE,LPVOID,LPWSTR,DWORD);
  const auto mappedName=reinterpret_cast<MappedName>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"K32GetMappedFileNameW"));
  wchar_t localName[32768]{};
  if(!mappedName || !mappedName(GetCurrentProcess(),local,localName,32768))
    throw std::runtime_error("system loader image unavailable");
  uintptr_t base=0,address=0;
  MEMORY_BASIC_INFORMATION information{};
  while(VirtualQueryEx(process,reinterpret_cast<void*>(address),&information,sizeof(information))==sizeof(information)) {
    if(information.State==MEM_COMMIT && information.Type==MEM_IMAGE && information.AllocationBase==information.BaseAddress) {
      wchar_t targetName[32768]{};
      if(mappedName(process,information.AllocationBase,targetName,32768) && same(localName,targetName)) {
        base=reinterpret_cast<uintptr_t>(information.AllocationBase);break;
      }
    }
    const uintptr_t next=reinterpret_cast<uintptr_t>(information.BaseAddress)+information.RegionSize;
    if(next<=address)break;address=next;
  }
  if (!local || !exit || !base) throw std::runtime_error("suspended process loader unavailable");
  Handle thread(CreateRemoteThread(process,nullptr,0,reinterpret_cast<LPTHREAD_START_ROUTINE>(
    base+(reinterpret_cast<uintptr_t>(exit)-reinterpret_cast<uintptr_t>(local))),nullptr,0,nullptr));
  if (!thread.value || WaitForSingleObject(thread.value,30000)!=WAIT_OBJECT_0 || !module(pid,L"kernel32.dll",true))
    throw std::runtime_error("suspended process initialization did not complete");
}
static void printIdentity(DWORD pid,uint64_t created,const std::wstring& expected,unsigned architecture) {
  std::cout<<"{\"pid\":"<<pid<<",\"created\":\""<<created<<"\",\"image\":"<<json(expected)<<",\"bits\":"<<architecture<<'}';
}
static void permission(const std::wstring& nonce,const char* phase) {
  std::string line;
  if (!std::getline(std::cin,line) || line!=std::string(phase)+" "+utf8(nonce))
    throw std::runtime_error("controlled launch was not authorized");
}
static void published() {
  std::cout.flush();
  if(!std::cout.good())throw std::runtime_error("controlled launch response unavailable");
}
static void launch(const wchar_t* owner,const std::wstring& expected,const std::wstring& digest,
    const std::wstring& library,uint32_t flags,uint32_t maximum,const std::wstring& nonce,
    int count,wchar_t** arguments) {
  mapping(owner,1,1); mapping(nonce.c_str(),1,1);
  if (flags>15 || maximum<1024 || maximum>1048576 || count<0 || unsigned(count)>SakuraClipboardLaunchArguments)
    throw std::runtime_error("invalid controlled launch arguments");
  if (expected.size()<7 || expected[1]!=L':' || expected[2]!=L'\\' ||
      expected.find(L'\"')!=std::wstring::npos || !same(expected.substr(expected.size()-4),L".exe"))
    throw std::runtime_error("controlled launch requires a complete executable path");
  std::wstring command=clipboardArgument(expected); size_t length=0;
  for (int index=0;index<count;++index) {
    const std::wstring argument(arguments[index]); length+=argument.size();
    if (argument.size()>2048 || length>SakuraClipboardLaunchCharacters)
      throw std::runtime_error("controlled launch arguments too long");
    command+=L' ';command+=clipboardArgument(argument);
  }
  if (command.size()>=32767) throw std::runtime_error("controlled launch command too long");
  // Deny writes and replacement until the selected image is created and committed.
  Handle file(CreateFileW(expected.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
  if (file.value==INVALID_HANDLE_VALUE) throw std::runtime_error("application file unavailable for controlled launch");
  selectedFile(file.value,expected,digest);
  nativeExecutable(file.value);
  const auto imported=importPath(library);
  earlyDependencies(expected,library);
  Handle job(CreateJobObjectW(nullptr,nullptr));
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!job.value || !SetInformationJobObject(job.value,JobObjectExtendedLimitInformation,&limits,sizeof(limits)))
    throw std::runtime_error("controlled launch job unavailable");
  SIZE_T bytes=0; InitializeProcThreadAttributeList(nullptr,1,0,&bytes);
  std::vector<unsigned char> storage(bytes);
  auto attributes=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
  if (!bytes || !InitializeProcThreadAttributeList(attributes,1,0,&bytes))
    throw std::runtime_error("controlled launch attributes unavailable");
  const BOOL assigned=UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,&job.value,sizeof(HANDLE),nullptr,nullptr);
  STARTUPINFOEXW startup{}; startup.StartupInfo.cb=sizeof(startup); startup.lpAttributeList=attributes;
  // A launched application must not keep the controller's private RPC pipes
  // open after it exits. No shell or inherited standard handle is exposed.
  startup.StartupInfo.dwFlags=STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput=nullptr;startup.StartupInfo.hStdOutput=nullptr;startup.StartupInfo.hStdError=nullptr;
  PROCESS_INFORMATION child{};
  const auto separator=expected.find_last_of(L'\\');
  const auto directory=expected.substr(0,separator==2?3:separator);
  // The controller reports loader failures over its private RPC channel. A
  // rejected injected DLL must not leave a Windows hard-error dialog pending.
  SetErrorMode(SEM_FAILCRITICALERRORS|SEM_NOGPFAULTERRORBOX|SEM_NOOPENFILEERRORBOX);
  const BOOL created=assigned && CreateProcessW(expected.c_str(),command.data(),nullptr,nullptr,FALSE,
    CREATE_SUSPENDED|CREATE_NO_WINDOW|EXTENDED_STARTUPINFO_PRESENT|CREATE_UNICODE_ENVIRONMENT,nullptr,directory.c_str(),&startup.StartupInfo,&child);
  DeleteProcThreadAttributeList(attributes);
  if (!created) throw std::runtime_error("controlled suspended process creation failed");
  Handle process(child.hProcess),thread(child.hThread);
  try {
    const auto creation=processCreation(process.value);
    const auto architecture=bits(process.value);
    using InspectPackage=LONG(WINAPI*)(HANDLE,UINT32*,PWSTR);
    const auto inspectPackage=reinterpret_cast<InspectPackage>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"GetPackageFullName"));
    UINT32 packageLength=0;
    if(!inspectPackage || inspectPackage(process.value,&packageLength,nullptr)!=APPMODEL_ERROR_NO_PACKAGE)
      throw std::runtime_error("controlled early initialization requires an unpackaged native executable");
    DWORD targetSession=0,ownSession=0;
    const auto check=[&]() {
      BOOL inJob=FALSE;
      if (!creation || architecture!=sizeof(void*)*8 || !ownUser(process.value) ||
          !IsProcessInJob(process.value,job.value,&inJob) || !inJob ||
          !ProcessIdToSessionId(child.dwProcessId,&targetSession) || !ProcessIdToSessionId(GetCurrentProcessId(),&ownSession) ||
          targetSession!=ownSession || processCreation(process.value)!=creation || !same(image(process.value),expected) ||
          WaitForSingleObject(process.value,0)!=WAIT_TIMEOUT || GetProcessIdOfThread(thread.value)!=child.dwProcessId)
        throw std::runtime_error("controlled process identity changed");
      primarySuspended(thread.value);
    };
    check();
    std::cout<<"{\"stage\":\"prepared\",\"launchId\":"<<json(nonce)<<",\"process\":";
    printIdentity(child.dwProcessId,creation,expected,architecture);std::cout<<'}'<<std::endl;published();
    permission(nonce,"attach");
    check();
    // Creating the section, changing imports and running the loader all happen
    // after the durable ownership journal has authorized this exact child.
    Handle policyFile(CreateFileW(library.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
    if(policyFile.value==INVALID_HANDLE_VALUE)throw std::runtime_error("early policy file unavailable");
    const auto policyDigest=fileDigest(policyFile.value);std::wstring policyHash(policyDigest.begin(),policyDigest.end());
    selectedFile(policyFile.value,library,policyHash);
    EarlyPolicy early(owner,child.dwProcessId,creation,flags,maximum);
    earlyDependencies(expected,library);
    early.insert(process.value,imported);check();
    initializeLoader(process.value,child.dwProcessId);early.ready();check();
    if(!module(child.dwProcessId,library))throw std::runtime_error("early policy loaded from an unexpected image");
    std::cout<<"{\"stage\":\"attached\",\"launchId\":"<<json(nonce)<<",\"process\":";
    printIdentity(child.dwProcessId,creation,expected,architecture);std::cout<<",\"state\":";
    state(owner,child.dwProcessId,creation,false);std::cout<<'}'<<std::endl;published();
    permission(nonce,"resume");
    check();early.ready();selectedFile(file.value,expected,digest);selectedFile(policyFile.value,library,policyHash);
    if (ResumeThread(thread.value)!=1) throw std::runtime_error("controlled primary thread could not resume");
    // Keep fail-closed Job ownership until resume succeeds. Only this fresh Job
    // is released; no existing application or system process is ever terminated.
    limits.BasicLimitInformation.LimitFlags=0;
    if (!SetInformationJobObject(job.value,JobObjectExtendedLimitInformation,&limits,sizeof(limits)))
      throw std::runtime_error("controlled launch job could not commit");
    std::cout<<"{\"stage\":\"committed\",\"launchId\":"<<json(nonce)<<",\"process\":";
    printIdentity(child.dwProcessId,creation,expected,architecture);std::cout<<'}'<<std::endl;published();
  } catch (...) {
    TerminateJobObject(job.value,1);WaitForSingleObject(process.value,30000);throw;
  }
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
    if (argc>=9 && std::wstring(argv[1])==L"launch") {
      const auto flags=number(argv[6]),maximum=number(argv[7]);
      if (flags>15 || maximum>1048576) throw std::runtime_error("invalid controlled launch rule");
      launch(argv[2],argv[3],argv[4],argv[5],uint32_t(flags),uint32_t(maximum),argv[8],argc-9,argv+9); return 0;
    }
    throw std::runtime_error("invalid native controller command");
  } catch (const std::exception& error) {
    std::wstring reason;
    for (const unsigned char c:std::string(error.what())) reason+=wchar_t(c);
    std::cout<<"{\"error\":"<<json(reason)<<",\"systemError\":"<<GetLastError()<<'}'<<std::endl;
    return 1;
  }
}
